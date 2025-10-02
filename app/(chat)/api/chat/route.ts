import { SpanStatusCode, trace } from "@opentelemetry/api";
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
import { logger } from "@/lib/otel-server";
import type { ChatMessage } from "@/lib/types";
import type { AppUsage } from "@/lib/usage";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

// Initialize tracer
const tracer = trace.getTracer("ai-chatbot-api");

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
  return tracer.startActiveSpan("chat.post", async (span) => {
    const startTime = Date.now();
    let requestBody: PostRequestBody;

    try {
      span.setAttributes({
        "http.method": "POST",
        "http.route": "/api/chat",
        user_agent: request.headers.get("user-agent") || "",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat API request started",
        attributes: {
          method: "POST",
          route: "/api/chat",
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

      const session = await tracer.startActiveSpan(
        "auth.session",
        async (authSpan) => {
          try {
            const result = await auth();
            authSpan.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            authSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Auth failed",
            });
            authSpan.recordException(error as Error);
            throw error;
          } finally {
            authSpan.end();
          }
        }
      );

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized chat request",
          attributes: { chatId: id },
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
          try {
            const count = await getMessageCountByUserId({
              id: session.user.id,
              differenceInHours: 24,
            });
            dbSpan.setAttributes({
              "db.operation": "getMessageCountByUserId",
              "user.id": session.user.id,
              "message.count": count,
            });
            dbSpan.setStatus({ code: SpanStatusCode.OK });
            return count;
          } catch (error) {
            dbSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: "DB query failed",
            });
            dbSpan.recordException(error as Error);
            throw error;
          } finally {
            dbSpan.end();
          }
        }
      );

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
            userId: session.user.id,
            messageCount,
            limit: entitlementsByUserType[userType].maxMessagesPerDay,
          },
        });
        return new ChatSDKError("rate_limit:chat").toResponse();
      }

      const chat = await tracer.startActiveSpan(
        "db.getChatById",
        async (dbSpan) => {
          try {
            const result = await getChatById({ id });
            dbSpan.setAttributes({
              "db.operation": "getChatById",
              "chat.id": id,
              "chat.exists": !!result,
            });
            dbSpan.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            dbSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: "DB query failed",
            });
            dbSpan.recordException(error as Error);
            throw error;
          } finally {
            dbSpan.end();
          }
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
            body: "Forbidden chat access attempt",
            attributes: {
              chatId: id,
              userId: session.user.id,
              chatOwnerId: chat.userId,
            },
          });
          return new ChatSDKError("forbidden:chat").toResponse();
        }
      } else {
        await tracer.startActiveSpan("chat.create", async (createSpan) => {
          try {
            const title = await generateTitleFromUserMessage({
              message,
            });

            await saveChat({
              id,
              userId: session.user.id,
              title,
              visibility: selectedVisibilityType,
            });

            createSpan.setAttributes({
              "chat.id": id,
              "chat.title": title,
              "chat.visibility": selectedVisibilityType,
            });
            createSpan.setStatus({ code: SpanStatusCode.OK });

            logger.emit({
              severityNumber: SeverityNumber.INFO,
              severityText: "INFO",
              body: "New chat created",
              attributes: {
                chatId: id,
                userId: session.user.id,
                title,
              },
            });
          } catch (error) {
            createSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Chat creation failed",
            });
            createSpan.recordException(error as Error);
            throw error;
          } finally {
            createSpan.end();
          }
        });
      }

      const messagesFromDb = await tracer.startActiveSpan(
        "db.getMessages",
        async (dbSpan) => {
          try {
            const messages = await getMessagesByChatId({ id });
            dbSpan.setAttributes({
              "db.operation": "getMessagesByChatId",
              "chat.id": id,
              "messages.count": messages.length,
            });
            dbSpan.setStatus({ code: SpanStatusCode.OK });
            return messages;
          } catch (error) {
            dbSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Failed to get messages",
            });
            dbSpan.recordException(error as Error);
            throw error;
          } finally {
            dbSpan.end();
          }
        }
      );

      const uiMessages = [...convertToUIMessages(messagesFromDb), message];

      const { longitude, latitude, city, country } = geolocation(request);
      span.setAttributes({
        "geo.longitude": longitude || 0,
        "geo.latitude": latitude || 0,
        "geo.city": city || "",
        "geo.country": country || "",
      });

      const requestHints: RequestHints = {
        longitude,
        latitude,
        city,
        country,
      };

      await tracer.startActiveSpan("db.saveUserMessage", async (saveSpan) => {
        try {
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
          saveSpan.setAttributes({
            "db.operation": "saveMessages",
            "message.id": message.id,
            "message.role": "user",
          });
          saveSpan.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          saveSpan.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to save message",
          });
          saveSpan.recordException(error as Error);
          throw error;
        } finally {
          saveSpan.end();
        }
      });

      const streamId = generateUUID();
      await createStreamId({ streamId, chatId: id });

      span.setAttributes({
        "stream.id": streamId,
        "messages.total": uiMessages.length,
      });

      let finalMergedUsage: AppUsage | undefined;

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Starting AI stream generation",
        attributes: {
          chatId: id,
          model: selectedChatModel,
          messagesCount: uiMessages.length,
          streamId,
        },
      });

      const stream = createUIMessageStream({
        execute: ({ writer: dataStream }) => {
          return tracer.startActiveSpan("ai.streamText", (aiSpan) => {
            aiSpan.setAttributes({
              "ai.model": selectedChatModel,
              "ai.messages.count": uiMessages.length,
              "ai.tools.enabled": selectedChatModel !== "chat-model-reasoning",
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
                  aiSpan.setAttributes({
                    "ai.usage.prompt_tokens": usage.promptTokens || 0,
                    "ai.usage.completion_tokens": usage.completionTokens || 0,
                    "ai.usage.total_tokens": usage.totalTokens || 0,
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

                  aiSpan.setStatus({ code: SpanStatusCode.OK });
                  logger.emit({
                    severityNumber: SeverityNumber.INFO,
                    severityText: "INFO",
                    body: "AI stream generation completed",
                    attributes: {
                      chatId: id,
                      model: selectedChatModel,
                      promptTokens: usage.promptTokens || 0,
                      completionTokens: usage.completionTokens || 0,
                      totalTokens: usage.totalTokens || 0,
                    },
                  });
                } catch (err) {
                  aiSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: "TokenLens enrichment failed",
                  });
                  aiSpan.recordException(err as Error);
                  console.warn("TokenLens enrichment failed", err);
                  finalMergedUsage = usage;
                  dataStream.write({
                    type: "data-usage",
                    data: finalMergedUsage,
                  });
                } finally {
                  aiSpan.end();
                }
              },
            });

            result.consumeStream();

            dataStream.merge(
              result.toUIMessageStream({
                sendReasoning: true,
              })
            );

            return result;
          });
        },
        generateId: generateUUID,
        onFinish: async ({ messages }) => {
          await tracer.startActiveSpan(
            "db.saveAIMessages",
            async (saveSpan) => {
              try {
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

                saveSpan.setAttributes({
                  "db.operation": "saveMessages",
                  "messages.count": messages.length,
                  "chat.id": id,
                });
                saveSpan.setStatus({ code: SpanStatusCode.OK });

                logger.emit({
                  severityNumber: SeverityNumber.INFO,
                  severityText: "INFO",
                  body: "AI messages saved to database",
                  attributes: {
                    chatId: id,
                    messagesCount: messages.length,
                  },
                });
              } catch (error) {
                saveSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: "Failed to save AI messages",
                });
                saveSpan.recordException(error as Error);
                throw error;
              } finally {
                saveSpan.end();
              }
            }
          );

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
        onError: (error) => {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Stream error occurred",
          });
          span.recordException(error);
          logger.emit({
            severityNumber: SeverityNumber.ERROR,
            severityText: "ERROR",
            body: "Stream error occurred",
            attributes: {
              chatId: id,
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

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "http.status_code": 200,
        "response.duration_ms": Date.now() - startTime,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat API request completed successfully",
        attributes: {
          chatId: id,
          duration: Date.now() - startTime,
          statusCode: 200,
        },
      });

      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    } catch (error) {
      const vercelId = request.headers.get("x-vercel-id");

      span.setStatus({ code: SpanStatusCode.ERROR, message: "Request failed" });
      span.recordException(error as Error);
      span.setAttributes({
        "error.type":
          error instanceof ChatSDKError ? "ChatSDKError" : "UnknownError",
        "vercel.id": vercelId || "",
      });

      if (error instanceof ChatSDKError) {
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat SDK error occurred",
          attributes: {
            errorType: error.constructor.name,
            errorMessage: error.message,
            vercelId: vercelId || "",
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
            errorMessage: error.message,
            vercelId: vercelId || "",
          },
        });
        return new ChatSDKError("bad_request:activate_gateway").toResponse();
      }

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Unhandled error in chat API",
        attributes: {
          error: (error as Error).message,
          vercelId: vercelId || "",
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
  return tracer.startActiveSpan("chat.delete", async (span) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      span.setAttributes({
        "http.method": "DELETE",
        "http.route": "/api/chat",
        "chat.id": id || "",
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chat ID",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "DELETE request missing chat ID",
        });
        return new ChatSDKError("bad_request:api").toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized DELETE request",
          attributes: { chatId: id },
        });
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      span.setAttributes({
        "user.id": session.user.id,
      });

      const chat = await getChatById({ id });

      if (chat?.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden chat deletion attempt",
          attributes: {
            chatId: id,
            userId: session.user.id,
            chatOwnerId: chat?.userId,
          },
        });
        return new ChatSDKError("forbidden:chat").toResponse();
      }

      const deletedChat = await deleteChatById({ id });

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "http.status_code": 200,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat deleted successfully",
        attributes: {
          chatId: id,
          userId: session.user.id,
        },
      });

      return Response.json(deletedChat, { status: 200 });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Delete failed" });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error deleting chat",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
