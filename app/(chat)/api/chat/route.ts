import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
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
import { logger } from "@/otel-server";
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
  const tracer = trace.getTracer("chat-api");

  return tracer.startActiveSpan("chat.post", async (span) => {
    const startTime = Date.now();
    let requestBody: PostRequestBody;

    try {
      span.setAttributes({
        "http.method": "POST",
        "http.route": "/api/chat",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat API POST request started",
        attributes: {
          "http.method": "POST",
          "http.route": "/api/chat",
        },
      });

      const json = await request.json();
      requestBody = postRequestBodySchema.parse(json);

      span.setAttributes({
        "chat.id": requestBody.id,
        "chat.model": requestBody.selectedChatModel,
        "chat.visibility": requestBody.selectedVisibilityType,
      });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Invalid request body",
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Invalid request body in chat API",
        attributes: { error: (error as Error).message },
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

      const session = await auth();

      if (!session?.user) {
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      const userType: UserType = session.user.type;

      const messageCount = await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
        return new ChatSDKError("rate_limit:chat").toResponse();
      }

      const chat = await getChatById({ id });

      if (chat) {
        if (chat.userId !== session.user.id) {
          return new ChatSDKError("forbidden:chat").toResponse();
        }
      } else {
        const title = await generateTitleFromUserMessage({
          message,
        });

        await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      }

      const messagesFromDb = await getMessagesByChatId({ id });
      const uiMessages = [...convertToUIMessages(messagesFromDb), message];

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
                console.warn("TokenLens enrichment failed", err);
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
          await saveMessages({
            messages: messages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });

          if (finalMergedUsage) {
            try {
              await updateChatLastContextById({
                chatId: id,
                context: finalMergedUsage,
              });
            } catch (err) {
              console.warn("Unable to persist last usage for chat", id, err);
            }
          }
        },
        onError: () => {
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

      const duration = Date.now() - startTime;
      span.setAttributes({
        "chat.duration_ms": duration,
        "http.status_code": 200,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat API POST request completed successfully",
        attributes: {
          "chat.id": requestBody.id,
          "chat.model": requestBody.selectedChatModel,
          "chat.duration_ms": duration,
        },
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    } catch (error) {
      const vercelId = request.headers.get("x-vercel-id");
      const duration = Date.now() - startTime;

      span.setAttributes({
        "chat.duration_ms": duration,
        "error.type": error instanceof ChatSDKError ? error.type : "unknown",
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      if (error instanceof ChatSDKError) {
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat API error",
          attributes: {
            "error.type": error.type,
            "error.surface": error.surface,
            "error.message": error.message,
            "chat.duration_ms": duration,
          },
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
        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "AI Gateway credit card error",
          attributes: {
            "error.message": error.message,
            "vercel.id": vercelId,
          },
        });
        return new ChatSDKError("bad_request:activate_gateway").toResponse();
      }

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Unhandled error in chat API",
        attributes: {
          "error.message": (error as Error).message,
          "vercel.id": vercelId,
          "chat.duration_ms": duration,
        },
      });

      console.error("Unhandled error in chat API:", error, { vercelId });
      return new ChatSDKError("offline:chat").toResponse();
    } finally {
      span.end();
    }
  });
}

export async function DELETE(request: Request) {
  const tracer = trace.getTracer("chat-api");

  return tracer.startActiveSpan("chat.delete", async (span) => {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    try {
      span.setAttributes({
        "http.method": "DELETE",
        "http.route": "/api/chat",
        "chat.id": id || "unknown",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat DELETE request started",
        attributes: {
          "http.method": "DELETE",
          "chat.id": id || "unknown",
        },
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chat ID",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat DELETE request missing ID",
        });
        return new ChatSDKError("bad_request:api").toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized chat DELETE request",
          attributes: { "chat.id": id },
        });
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const chat = await getChatById({ id });

      if (chat?.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden chat DELETE request",
          attributes: {
            "chat.id": id,
            "user.id": session.user.id,
            "chat.owner_id": chat?.userId,
          },
        });
        return new ChatSDKError("forbidden:chat").toResponse();
      }

      const deletedChat = await deleteChatById({ id });
      const duration = Date.now() - startTime;

      span.setAttributes({
        "chat.duration_ms": duration,
        "http.status_code": 200,
      });
      span.setStatus({ code: SpanStatusCode.OK });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat deleted successfully",
        attributes: {
          "chat.id": id,
          "user.id": session.user.id,
          "chat.duration_ms": duration,
        },
      });

      return Response.json(deletedChat, { status: 200 });
    } catch (error) {
      const duration = Date.now() - startTime;
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error deleting chat",
        attributes: {
          "chat.id": id || "unknown",
          "error.message": (error as Error).message,
          "chat.duration_ms": duration,
        },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
