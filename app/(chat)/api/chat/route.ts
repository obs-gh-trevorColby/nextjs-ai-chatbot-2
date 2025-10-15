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
import {
  createSpan,
  instrumentAIOperation,
  instrumentChatMessage,
  instrumentDatabaseOperation,
  instrumentHttpRequest,
  observabilityLogger,
  trackError,
} from "@/lib/observability";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

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
  const startTime = Date.now();
  let requestBody: PostRequestBody;

  return createSpan("chat.post", async (span) => {
    try {
      const json = await request.json();
      requestBody = postRequestBodySchema.parse(json);

      span.setAttributes({
        "http.method": "POST",
        "http.route": "/api/chat",
        "chat.id": requestBody.id,
        "chat.model": requestBody.selectedChatModel,
      });

      observabilityLogger.info("Chat request started", {
        chatId: requestBody.id,
        model: requestBody.selectedChatModel,
        messageLength: JSON.stringify(requestBody.message).length,
      });
    } catch (error) {
      observabilityLogger.error("Invalid chat request body", error as Error);
      const duration = Date.now() - startTime;
      instrumentHttpRequest("POST", "/api/chat", 400, duration, {
        error: "invalid_body",
      });
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

      const session = await instrumentDatabaseOperation("auth", "session", () =>
        auth()
      );

      if (!session?.user) {
        observabilityLogger.warn("Unauthorized chat request");
        const duration = Date.now() - startTime;
        instrumentHttpRequest("POST", "/api/chat", 401, duration, {
          error: "unauthorized",
        });
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      const userType: UserType = session.user.type;

      span.setAttributes({
        "user.id": session.user.id,
        "user.type": userType,
      });

      const messageCount = await instrumentDatabaseOperation(
        "select",
        "message",
        () =>
          getMessageCountByUserId({
            id: session.user.id,
            differenceInHours: 24,
          })
      );

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
        observabilityLogger.warn("Rate limit exceeded", {
          userId: session.user.id,
          messageCount,
          limit: entitlementsByUserType[userType].maxMessagesPerDay,
        });
        const duration = Date.now() - startTime;
        instrumentHttpRequest("POST", "/api/chat", 429, duration, {
          error: "rate_limit",
        });
        return new ChatSDKError("rate_limit:chat").toResponse();
      }

      const chat = await instrumentDatabaseOperation("select", "chat", () =>
        getChatById({ id })
      );

      if (chat) {
        if (chat.userId !== session.user.id) {
          observabilityLogger.warn("Forbidden chat access attempt", {
            chatId: id,
            userId: session.user.id,
            chatOwnerId: chat.userId,
          });
          const duration = Date.now() - startTime;
          instrumentHttpRequest("POST", "/api/chat", 403, duration, {
            error: "forbidden",
          });
          return new ChatSDKError("forbidden:chat").toResponse();
        }

        observabilityLogger.info("Continuing existing chat", {
          chatId: id,
          userId: session.user.id,
        });
      } else {
        const title = await instrumentAIOperation(
          "generate_title",
          selectedChatModel,
          () => generateTitleFromUserMessage({ message })
        );

        await instrumentDatabaseOperation("insert", "chat", () =>
          saveChat({
            id,
            userId: session.user.id,
            title,
            visibility: selectedVisibilityType,
          })
        );

        observabilityLogger.info("Created new chat", {
          chatId: id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      }

      const messagesFromDb = await instrumentDatabaseOperation(
        "select",
        "message",
        () => getMessagesByChatId({ id })
      );
      const uiMessages = [...convertToUIMessages(messagesFromDb), message];

      const { longitude, latitude, city, country } = geolocation(request);

      const requestHints: RequestHints = {
        longitude,
        latitude,
        city,
        country,
      };

      await instrumentDatabaseOperation("insert", "message", () =>
        saveMessages({
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
        })
      );

      // Instrument the chat message
      instrumentChatMessage("user", id, JSON.stringify(message.parts).length, {
        userId: session.user.id,
        model: selectedChatModel,
      });

      const streamId = generateUUID();
      await instrumentDatabaseOperation("insert", "stream", () =>
        createStreamId({ streamId, chatId: id })
      );

      let finalMergedUsage: AppUsage | undefined;

      const stream = createUIMessageStream({
        execute: ({ writer: dataStream }) => {
          // Log the AI operation start
          observabilityLogger.info("Starting AI stream text operation", {
            chatId: id,
            model: selectedChatModel,
            messageCount: uiMessages.length,
          });

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
                observabilityLogger.info("AI stream completed", {
                  chatId: id,
                  model: selectedChatModel,
                  usage,
                });

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
                finalMergedUsage = {
                  ...usage,
                  ...summary,
                  modelId,
                } as AppUsage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
              } catch (err) {
                observabilityLogger.error(
                  "TokenLens enrichment failed",
                  err as Error,
                  {
                    chatId: id,
                    model: selectedChatModel,
                  }
                );
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
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
          await instrumentDatabaseOperation("insert", "message", () =>
            saveMessages({
              messages: messages.map((currentMessage) => ({
                id: currentMessage.id,
                role: currentMessage.role,
                parts: currentMessage.parts,
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              })),
            })
          );

          // Instrument assistant messages
          for (const msg of messages) {
            if (msg.role === "assistant") {
              instrumentChatMessage(
                "assistant",
                id,
                JSON.stringify(msg.parts).length,
                {
                  userId: session.user.id,
                  model: selectedChatModel,
                }
              );
            }
          }

          if (finalMergedUsage) {
            try {
              await instrumentDatabaseOperation("update", "chat", () =>
                updateChatLastContextById({
                  chatId: id,
                  context: finalMergedUsage,
                })
              );
            } catch (err) {
              observabilityLogger.error(
                "Unable to persist last usage for chat",
                err as Error,
                {
                  chatId: id,
                }
              );
            }
          }

          const duration = Date.now() - startTime;
          instrumentHttpRequest("POST", "/api/chat", 200, duration, {
            chatId: id,
            model: selectedChatModel,
            messageCount: messages.length,
          });

          observabilityLogger.info("Chat request completed successfully", {
            chatId: id,
            userId: session.user.id,
            model: selectedChatModel,
            duration,
            messageCount: messages.length,
          });
        },
        onError: (error) => {
          observabilityLogger.error("Chat stream error", error as Error, {
            chatId: id,
            userId: session.user.id,
            model: selectedChatModel,
          });
          trackError(error as Error, {
            chatId: id,
            userId: session.user.id,
            model: selectedChatModel,
          });
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
      const duration = Date.now() - startTime;

      if (error instanceof ChatSDKError) {
        observabilityLogger.error("Chat SDK error", error, {
          chatId: requestBody?.id,
          vercelId,
        });
        instrumentHttpRequest("POST", "/api/chat", error.statusCode, duration, {
          error: error.type,
          surface: error.surface,
        });
        return error.toResponse();
      }

      // Check for Vercel AI Gateway credit card error
      if (
        error instanceof Error &&
        error.message?.includes(
          "AI Gateway requires a valid credit card on file to service requests"
        )
      ) {
        observabilityLogger.error("AI Gateway credit card error", error, {
          chatId: requestBody?.id,
          vercelId,
        });
        instrumentHttpRequest("POST", "/api/chat", 400, duration, {
          error: "gateway_credit_card",
        });
        return new ChatSDKError("bad_request:activate_gateway").toResponse();
      }

      observabilityLogger.error("Unhandled error in chat API", error as Error, {
        chatId: requestBody?.id,
        vercelId,
      });
      trackError(error as Error, {
        chatId: requestBody?.id,
        vercelId,
        endpoint: "/api/chat",
      });
      instrumentHttpRequest("POST", "/api/chat", 503, duration, {
        error: "unhandled",
      });
      return new ChatSDKError("offline:chat").toResponse();
    }
  });
}

export async function DELETE(request: Request) {
  const startTime = Date.now();

  return createSpan("chat.delete", async (span) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      observabilityLogger.error("Delete chat request missing ID");
      const duration = Date.now() - startTime;
      instrumentHttpRequest("DELETE", "/api/chat", 400, duration, {
        error: "missing_id",
      });
      return new ChatSDKError("bad_request:api").toResponse();
    }

    span.setAttributes({
      "http.method": "DELETE",
      "http.route": "/api/chat",
      "chat.id": id,
    });

    const session = await instrumentDatabaseOperation("auth", "session", () =>
      auth()
    );

    if (!session?.user) {
      observabilityLogger.warn("Unauthorized delete chat request", {
        chatId: id,
      });
      const duration = Date.now() - startTime;
      instrumentHttpRequest("DELETE", "/api/chat", 401, duration, {
        error: "unauthorized",
      });
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    span.setAttributes({
      "user.id": session.user.id,
    });

    const chat = await instrumentDatabaseOperation("select", "chat", () =>
      getChatById({ id })
    );

    if (chat?.userId !== session.user.id) {
      observabilityLogger.warn("Forbidden delete chat attempt", {
        chatId: id,
        userId: session.user.id,
        chatOwnerId: chat?.userId,
      });
      const duration = Date.now() - startTime;
      instrumentHttpRequest("DELETE", "/api/chat", 403, duration, {
        error: "forbidden",
      });
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    const deletedChat = await instrumentDatabaseOperation(
      "delete",
      "chat",
      () => deleteChatById({ id })
    );

    const duration = Date.now() - startTime;
    instrumentHttpRequest("DELETE", "/api/chat", 200, duration, {
      chatId: id,
      userId: session.user.id,
    });

    observabilityLogger.info("Chat deleted successfully", {
      chatId: id,
      userId: session.user.id,
      duration,
    });

    return Response.json(deletedChat, { status: 200 });
  });
}
