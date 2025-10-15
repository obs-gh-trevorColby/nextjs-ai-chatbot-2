import { SpanStatusCode } from "@opentelemetry/api";
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
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

// Import OpenTelemetry components - use dynamic import to avoid issues during build
let globalLogger: any;
let globalTracer: any;
let globalMeter: any;

// Initialize OpenTelemetry components
async function getOtelComponents() {
  if (!globalLogger || !globalTracer || !globalMeter) {
    try {
      const otel = await import("@/otel-server");
      globalLogger = otel.logger;
      globalTracer = otel.tracer;
      globalMeter = otel.meter;
    } catch (error) {
      // Fallback if OpenTelemetry is not available
      console.warn("OpenTelemetry components not available:", error);
    }
  }
  return { logger: globalLogger, tracer: globalTracer, meter: globalMeter };
}

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
  const { logger, tracer, meter } = await getOtelComponents();
  const startTime = Date.now();

  // Create metrics
  const requestCounter = meter?.createCounter("chat_requests_total", {
    description: "Total number of chat requests",
  });
  const requestDuration = meter?.createHistogram("chat_request_duration_ms", {
    description: "Duration of chat requests in milliseconds",
  });

  return (
    tracer?.startActiveSpan("chat.post", async (span: any) => {
      let requestBody: PostRequestBody;

      try {
        span?.setAttributes({
          "http.method": "POST",
          "http.route": "/api/chat",
        });

        logger?.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Chat request started",
          attributes: {
            method: "POST",
            route: "/api/chat",
          },
        });

        const json = await request.json();
        requestBody = postRequestBodySchema.parse(json);

        span?.setAttributes({
          "chat.id": requestBody.id,
          "chat.model": requestBody.selectedChatModel,
          "chat.visibility": requestBody.selectedVisibilityType,
        });
      } catch (error) {
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid request body",
        });
        span?.recordException(error as Error);

        logger?.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Invalid request body",
          attributes: { error: (error as Error).message },
        });

        requestCounter?.add(1, { status: "error", error_type: "bad_request" });
        span?.end();
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

        // Log successful completion
        const duration = Date.now() - startTime;
        requestCounter?.add(1, { status: "success" });
        requestDuration?.record(duration);

        logger?.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Chat request completed successfully",
          attributes: {
            "chat.id": requestBody.id,
            "chat.model": requestBody.selectedChatModel,
            duration_ms: duration,
          },
        });

        span?.setStatus({ code: SpanStatusCode.OK });
        span?.end();

        return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
      } catch (error) {
        const vercelId = request.headers.get("x-vercel-id");
        const duration = Date.now() - startTime;

        // Record error metrics and logs
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span?.recordException(error as Error);

        logger?.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Chat request failed",
          attributes: {
            error: (error as Error).message,
            vercelId: vercelId || "unknown",
            duration_ms: duration,
          },
        });

        if (error instanceof ChatSDKError) {
          requestCounter?.add(1, {
            status: "error",
            error_type: "chat_sdk_error",
          });
          span?.end();
          return error.toResponse();
        }

        // Check for Vercel AI Gateway credit card error
        if (
          error instanceof Error &&
          error.message?.includes(
            "AI Gateway requires a valid credit card on file to service requests"
          )
        ) {
          requestCounter?.add(1, {
            status: "error",
            error_type: "gateway_credit_card",
          });
          span?.end();
          return new ChatSDKError("bad_request:activate_gateway").toResponse();
        }

        console.error("Unhandled error in chat API:", error, { vercelId });
        requestCounter?.add(1, { status: "error", error_type: "unhandled" });
        span?.end();
        return new ChatSDKError("offline:chat").toResponse();
      }
    }) || new Response("OpenTelemetry not available", { status: 500 })
  );
}

export async function DELETE(request: Request) {
  const { logger, tracer } = await getOtelComponents();

  return (
    tracer?.startActiveSpan("chat.delete", async (span: any) => {
      try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        span?.setAttributes({
          "http.method": "DELETE",
          "http.route": "/api/chat",
          "chat.id": id || "unknown",
        });

        logger?.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Chat deletion request started",
          attributes: {
            method: "DELETE",
            chatId: id || "unknown",
          },
        });

        if (!id) {
          span?.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Missing chat ID",
          });
          span?.end();
          return new ChatSDKError("bad_request:api").toResponse();
        }

        const session = await auth();

        if (!session?.user) {
          span?.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Unauthorized",
          });
          span?.end();
          return new ChatSDKError("unauthorized:chat").toResponse();
        }

        const chat = await getChatById({ id });

        if (chat?.userId !== session.user.id) {
          span?.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
          span?.end();
          return new ChatSDKError("forbidden:chat").toResponse();
        }

        const deletedChat = await deleteChatById({ id });

        logger?.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Chat deleted successfully",
          attributes: {
            chatId: id,
            userId: session.user.id,
          },
        });

        span?.setStatus({ code: SpanStatusCode.OK });
        span?.end();
        return Response.json(deletedChat, { status: 200 });
      } catch (error) {
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span?.recordException(error as Error);

        logger?.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Chat deletion failed",
          attributes: { error: (error as Error).message },
        });

        span?.end();
        throw error;
      }
    }) || new Response("OpenTelemetry not available", { status: 500 })
  );
}
