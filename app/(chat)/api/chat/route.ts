import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
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

export const maxDuration = 60;

// OpenTelemetry setup
const tracer = trace.getTracer("ai-chatbot-api");
const logger = logs.getLogger("ai-chatbot-api");

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

export function POST(request: Request) {
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
        body: "Chat API request started",
        attributes: {
          "http.method": "POST",
          "http.route": "/api/chat",
        },
      });

      const json = await request.json();
      requestBody = postRequestBodySchema.parse(json);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Invalid request body",
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Invalid request body",
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

      span.setAttributes({
        "chat.id": id,
        "chat.model": selectedChatModel,
        "chat.visibility": selectedVisibilityType,
        "message.id": message.id,
        "message.role": message.role,
      });

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized chat request",
          attributes: { "chat.id": id },
        });
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      const userType: UserType = session.user.type;
      span.setAttributes({
        "user.id": session.user.id,
        "user.type": userType,
      });

      const messageCount = await tracer.startActiveSpan(
        "db.getMessageCount",
        async (dbSpan) => {
          dbSpan.setAttributes({
            "db.operation": "getMessageCountByUserId",
            "user.id": session.user.id,
          });
          return await getMessageCountByUserId({
            id: session.user.id,
            differenceInHours: 24,
          });
        }
      );

      span.setAttributes({
        "user.messageCount": messageCount,
        "user.maxMessages": entitlementsByUserType[userType].maxMessagesPerDay,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Rate limit exceeded",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Rate limit exceeded",
          attributes: {
            "user.id": session.user.id,
            "user.messageCount": messageCount,
            "user.maxMessages":
              entitlementsByUserType[userType].maxMessagesPerDay,
          },
        });
        return new ChatSDKError("rate_limit:chat").toResponse();
      }

      const chat = await tracer.startActiveSpan(
        "db.getChatById",
        async (dbSpan) => {
          dbSpan.setAttributes({
            "db.operation": "getChatById",
            "chat.id": id,
          });
          return await getChatById({ id });
        }
      );

      if (chat) {
        if (chat.userId !== session.user.id) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Forbidden chat access",
          });
          logger.emit({
            severityNumber: SeverityNumber.WARN,
            severityText: "WARN",
            body: "Forbidden chat access",
            attributes: {
              "user.id": session.user.id,
              "chat.id": id,
              "chat.owner": chat.userId,
            },
          });
          return new ChatSDKError("forbidden:chat").toResponse();
        }
        span.setAttributes({ "chat.exists": true });
      } else {
        span.setAttributes({ "chat.exists": false });

        const title = await tracer.startActiveSpan(
          "ai.generateTitle",
          async (aiSpan) => {
            aiSpan.setAttributes({
              "ai.operation": "generateTitle",
              "message.id": message.id,
            });
            return await generateTitleFromUserMessage({ message });
          }
        );

        await tracer.startActiveSpan("db.saveChat", async (dbSpan) => {
          dbSpan.setAttributes({
            "db.operation": "saveChat",
            "chat.id": id,
            "chat.title": title,
            "chat.visibility": selectedVisibilityType,
          });
          await saveChat({
            id,
            userId: session.user.id,
            title,
            visibility: selectedVisibilityType,
          });
        });
      }

      const messagesFromDb = await tracer.startActiveSpan(
        "db.getMessagesByChatId",
        async (dbSpan) => {
          dbSpan.setAttributes({
            "db.operation": "getMessagesByChatId",
            "chat.id": id,
          });
          return await getMessagesByChatId({ id });
        }
      );

      const uiMessages = [...convertToUIMessages(messagesFromDb), message];
      span.setAttributes({ "messages.count": uiMessages.length });

      const { longitude, latitude, city, country } = geolocation(request);

      const requestHints: RequestHints = {
        longitude,
        latitude,
        city,
        country,
      };

      span.setAttributes({
        "geo.longitude": longitude,
        "geo.latitude": latitude,
        "geo.city": city,
        "geo.country": country,
      });

      await tracer.startActiveSpan("db.saveMessages", async (dbSpan) => {
        dbSpan.setAttributes({
          "db.operation": "saveMessages",
          "message.id": message.id,
          "message.role": "user",
        });
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
      });

      const streamId = generateUUID();
      await tracer.startActiveSpan("db.createStreamId", async (dbSpan) => {
        dbSpan.setAttributes({
          "db.operation": "createStreamId",
          "stream.id": streamId,
          "chat.id": id,
        });
        await createStreamId({ streamId, chatId: id });
      });

      let finalMergedUsage: AppUsage | undefined;

      const stream = createUIMessageStream({
        execute: ({ writer: dataStream }) => {
          const aiSpan = tracer.startSpan("ai.streamText");
          aiSpan.setAttributes({
            "ai.model": selectedChatModel,
            "ai.operation": "streamText",
            "ai.messages.count": uiMessages.length,
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
              aiSpan.setAttributes({
                "ai.usage.promptTokens": usage.promptTokens,
                "ai.usage.completionTokens": usage.completionTokens,
                "ai.usage.totalTokens": usage.totalTokens,
              });
              aiSpan.setStatus({ code: SpanStatusCode.OK });
              aiSpan.end();

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
                logger.emit({
                  severityNumber: SeverityNumber.WARN,
                  severityText: "WARN",
                  body: "TokenLens enrichment failed",
                  attributes: { error: (err as Error).message },
                });
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
          await tracer.startActiveSpan(
            "db.saveMessages.response",
            async (dbSpan) => {
              dbSpan.setAttributes({
                "db.operation": "saveMessages",
                "messages.count": messages.length,
                "chat.id": id,
              });
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
            }
          );

          if (finalMergedUsage) {
            try {
              await tracer.startActiveSpan(
                "db.updateChatLastContext",
                async (dbSpan) => {
                  dbSpan.setAttributes({
                    "db.operation": "updateChatLastContext",
                    "chat.id": id,
                  });
                  await updateChatLastContextById({
                    chatId: id,
                    context: finalMergedUsage,
                  });
                }
              );
            } catch (err) {
              console.warn("Unable to persist last usage for chat", id, err);
              logger.emit({
                severityNumber: SeverityNumber.WARN,
                severityText: "WARN",
                body: "Unable to persist last usage for chat",
                attributes: {
                  "chat.id": id,
                  error: (err as Error).message,
                },
              });
            }
          }
        },
        onError: (error) => {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Stream error",
          });
          span.recordException(error);
          logger.emit({
            severityNumber: SeverityNumber.ERROR,
            severityText: "ERROR",
            body: "Stream error occurred",
            attributes: {
              "chat.id": id,
              error: error.message,
            },
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

      const duration = Date.now() - startTime;
      span.setAttributes({ "http.duration": duration });
      span.setStatus({ code: SpanStatusCode.OK });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat API request completed successfully",
        attributes: {
          "chat.id": id,
          "http.duration": duration,
          "user.id": session.user.id,
        },
      });

      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    } catch (error) {
      const vercelId = request.headers.get("x-vercel-id");
      const duration = Date.now() - startTime;

      span.setAttributes({
        "http.duration": duration,
        "error.type":
          error instanceof Error ? error.constructor.name : "unknown",
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Chat API error" });
      span.recordException(error as Error);

      if (error instanceof ChatSDKError) {
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat SDK error",
          attributes: {
            "error.code": error.code,
            "error.message": error.message,
            "http.duration": duration,
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

      console.error("Unhandled error in chat API:", error, { vercelId });
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Unhandled error in chat API",
        attributes: {
          "error.message": (error as Error).message,
          "vercel.id": vercelId,
          "http.duration": duration,
        },
      });
      return new ChatSDKError("offline:chat").toResponse();
    } finally {
      span.end();
    }
  });
}

export function DELETE(request: Request) {
  return tracer.startActiveSpan("chat.delete", async (span) => {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    span.setAttributes({
      "http.method": "DELETE",
      "http.route": "/api/chat",
      "chat.id": id || "missing",
    });

    if (!id) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Missing chat ID",
      });
      logger.emit({
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        body: "Delete chat request missing ID",
      });
      return new ChatSDKError("bad_request:api").toResponse();
    }

    const session = await auth();

    if (!session?.user) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
      logger.emit({
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        body: "Unauthorized delete chat request",
        attributes: { "chat.id": id },
      });
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    span.setAttributes({ "user.id": session.user.id });

    const chat = await tracer.startActiveSpan(
      "db.getChatById",
      async (dbSpan) => {
        dbSpan.setAttributes({
          "db.operation": "getChatById",
          "chat.id": id,
        });
        return await getChatById({ id });
      }
    );

    if (chat?.userId !== session.user.id) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
      logger.emit({
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        body: "Forbidden delete chat request",
        attributes: {
          "chat.id": id,
          "user.id": session.user.id,
          "chat.owner": chat?.userId,
        },
      });
      return new ChatSDKError("forbidden:chat").toResponse();
    }

    const deletedChat = await tracer.startActiveSpan(
      "db.deleteChatById",
      async (dbSpan) => {
        dbSpan.setAttributes({
          "db.operation": "deleteChatById",
          "chat.id": id,
        });
        return await deleteChatById({ id });
      }
    );

    const duration = Date.now() - startTime;
    span.setAttributes({ "http.duration": duration });
    span.setStatus({ code: SpanStatusCode.OK });

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "Chat deleted successfully",
      attributes: {
        "chat.id": id,
        "user.id": session.user.id,
        "http.duration": duration,
      },
    });

    span.end();
    return Response.json(deletedChat, { status: 200 });
  });
}
