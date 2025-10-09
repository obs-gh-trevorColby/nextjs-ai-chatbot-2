import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai";
import { unstable_cache as cache } from "next/cache";
import { after } from "next/server";
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from "resumable-stream";
import type { ModelCatalog } from "tokenlens/core";
import { fetchModels } from "tokenlens/fetch";
import { getUsage } from "tokenlens/helpers";
import { auth, type UserType } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/visibility-selector";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import type { ChatModel } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { myProvider } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";
import {
  createAPISpan,
  createAISpan,
  createDatabaseSpan,
  traceAsyncOperation,
  logEvent,
  logError,
  addSpanAttributes,
  recordException
} from "@/lib/telemetry/server";

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      console.warn(
        "TokenLens: catalog fetch failed, using default catalog",
        err
      );
      return; // tokenlens helpers will fall back to defaultCatalog
    }
  },
  ["tokenlens-catalog"],
  { revalidate: 24 * 60 * 60 } // 24 hours
);

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      if (error.message.includes("REDIS_URL")) {
        console.log(
          " > Resumable streams are disabled due to missing REDIS_URL"
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  const span = createAPISpan("POST /api/chat", request);
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    recordException(error as Error);
    logError(error as Error, { "api.endpoint": "/api/chat", "error.type": "request_parsing" });
    return new ChatSDKError("bad_request:api").toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel["id"];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    // Add telemetry attributes
    addSpanAttributes({
      "chat.id": id,
      "chat.model": selectedChatModel,
      "chat.visibility": selectedVisibilityType,
      "message.type": message.role,
      "message.content.length": message.content.length,
    });

    const session = await traceAsyncOperation("auth.getSession", () => auth());

    if (!session?.user) {
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;

    // Add user context to telemetry
    addSpanAttributes({
      "user.id": session.user.id,
      "user.type": userType,
    });

    const messageCount = await traceAsyncOperation(
      "db.getMessageCountByUserId",
      () => getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      }),
      { "user.id": session.user.id }
    );

    addSpanAttributes({
      "user.message_count_24h": messageCount,
      "user.rate_limit": entitlementsByUserType[userType].maxMessagesPerDay,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      logEvent("warn", "Rate limit exceeded", {
        "user.id": session.user.id,
        "user.type": userType,
        "message_count": messageCount,
        "rate_limit": entitlementsByUserType[userType].maxMessagesPerDay,
      });
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const chat = await traceAsyncOperation(
      "db.getChatById",
      () => getChatById({ id }),
      { "chat.id": id }
    );

    if (chat) {
      if (chat.userId !== session.user.id) {
        logEvent("warn", "Unauthorized chat access attempt", {
          "chat.id": id,
          "chat.owner": chat.userId,
          "user.id": session.user.id,
        });
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      addSpanAttributes({ "chat.exists": true });
    } else {
      addSpanAttributes({ "chat.exists": false });

      const title = await traceAsyncOperation(
        "ai.generateTitle",
        () => generateTitleFromUserMessage({ message }),
        { "message.role": message.role }
      );

      await traceAsyncOperation(
        "db.saveChat",
        () => saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        }),
        {
          "chat.id": id,
          "chat.title": title,
          "chat.visibility": selectedVisibilityType,
        }
      );
    }

    const messagesFromDb = await traceAsyncOperation(
      "db.getMessagesByChatId",
      () => getMessagesByChatId({ id }),
      { "chat.id": id }
    );
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    addSpanAttributes({
      "chat.messages.total": uiMessages.length,
      "chat.messages.from_db": messagesFromDb.length,
    });

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: "user",
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    let finalMergedUsage: AppUsage | undefined;

    const stream = createUIMessageStream({
      execute: ({ writer: dataStream }) => {
        const result = streamText({
          model: myProvider.languageModel(selectedChatModel),
          system: systemPrompt({ selectedChatModel, requestHints }),
          messages: convertToModelMessages(uiMessages),
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            selectedChatModel === "chat-model-reasoning"
              ? []
              : [
                  "getWeather",
                  "createDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
          experimental_transform: smoothStream({ chunking: "word" }),
          tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
            }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
          onFinish: async ({ usage }) => {
            try {
              const providers = await getTokenlensCatalog();
              const modelId =
                myProvider.languageModel(selectedChatModel).modelId;
              if (!modelId) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              if (!providers) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              const summary = getUsage({ modelId, usage, providers });
              finalMergedUsage = { ...usage, ...summary, modelId } as AppUsage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            } catch (err) {
              console.warn("TokenLens enrichment failed", err);
              finalMergedUsage = usage;
              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            }
          },
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
          })
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        await traceAsyncOperation(
          "db.saveMessages",
          () => saveMessages({
            messages: messages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          }),
          {
            "chat.id": id,
            "messages.count": messages.length,
          }
        );

        if (finalMergedUsage) {
          try {
            await traceAsyncOperation(
              "db.updateChatLastContext",
              () => updateChatLastContextById({
                chatId: id,
                context: finalMergedUsage,
              }),
              {
                "chat.id": id,
                "usage.total_tokens": finalMergedUsage.totalTokens,
              }
            );
          } catch (err) {
            logError(err as Error, {
              "chat.id": id,
              "operation": "updateChatLastContext",
            });
            console.warn("Unable to persist last usage for chat", id, err);
          }
        }

        logEvent("info", "Chat stream completed", {
          "chat.id": id,
          "messages.count": messages.length,
          "usage.total_tokens": finalMergedUsage?.totalTokens || 0,
        });
      },
      onError: (error) => {
        logError(error as Error, {
          "chat.id": id,
          "operation": "ai_stream",
        });
        recordException(error as Error);
        return "Oops, an error occurred!";
      },
    });

    // const streamContext = getStreamContext();

    // if (streamContext) {
    //   return new Response(
    //     await streamContext.resumableStream(streamId, () =>
    //       stream.pipeThrough(new JsonToSseTransformStream())
    //     )
    //   );
    // }

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    recordException(error as Error);
    logError(error as Error, {
      "api.endpoint": "/api/chat",
      "vercel.id": vercelId,
      "error.type": "unhandled",
    });

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    // Check for Vercel AI Gateway credit card error
    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatSDKError("offline:chat").toResponse();
  } finally {
    span.end();
  }
}

export async function DELETE(request: Request) {
  const span = createAPISpan("DELETE /api/chat", request);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      logEvent("warn", "DELETE chat request missing ID", {
        "api.endpoint": "/api/chat",
        "error.type": "missing_parameter",
      });
      return new ChatSDKError("bad_request:api").toResponse();
    }

    addSpanAttributes({ "chat.id": id });

    const session = await traceAsyncOperation("auth.getSession", () => auth());

    if (!session?.user) {
      logEvent("warn", "Unauthorized DELETE chat request", {
        "chat.id": id,
        "error.type": "unauthorized",
      });
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    addSpanAttributes({ "user.id": session.user.id });

    const chat = await traceAsyncOperation(
      "db.getChatById",
      () => getChatById({ id }),
      { "chat.id": id }
    );

    if (chat?.userId !== session.user.id) {
      logEvent("warn", "Forbidden DELETE chat request", {
        "chat.id": id,
        "chat.owner": chat?.userId,
        "user.id": session.user.id,
        "error.type": "forbidden",
      });
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    const deletedChat = await traceAsyncOperation(
      "db.deleteChatById",
      () => deleteChatById({ id }),
      { "chat.id": id }
    );

    logEvent("info", "Chat deleted successfully", {
      "chat.id": id,
      "user.id": session.user.id,
    });

    return Response.json(deletedChat, { status: 200 });
  } catch (error) {
    recordException(error as Error);
    logError(error as Error, {
      "api.endpoint": "/api/chat",
      "request.method": "DELETE",
    });
    throw error;
  } finally {
    span.end();
  }
}
