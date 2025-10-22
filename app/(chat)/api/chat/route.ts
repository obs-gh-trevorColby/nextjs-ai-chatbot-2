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
import { createRequestScopedLogger, PerformanceMonitor } from "@/lib/observability/middleware";
import { createAILogger } from "@/lib/observability/logger";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      const logger = createAILogger('tokenlens', 'catalog-fetch');
      logger.warn(
        "TokenLens: catalog fetch failed, using default catalog",
        { error: err }
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
      const logger = createRequestScopedLogger({} as any);
      if (error.message.includes("REDIS_URL")) {
        logger.info(
          "Resumable streams are disabled due to missing REDIS_URL"
        );
      } else {
        logger.error("Failed to create resumable stream context", error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const logger = createRequestScopedLogger(request as any);
  const performanceMonitor = new PerformanceMonitor('chat-api');

  logger.info('Chat API request started', {
    method: 'POST',
    url: request.url
  });

  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);

    logger.debug('Request body parsed successfully', {
      chatId: requestBody.id,
      model: requestBody.selectedChatModel,
      visibility: requestBody.selectedVisibilityType
    });
  } catch (error) {
    logger.error('Failed to parse request body', error as Error);
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

    const session = await performanceMonitor.measureAsync('auth', async () => {
      return await auth();
    });

    if (!session?.user) {
      logger.warn('Unauthorized chat request - no session');
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    const userType: UserType = session.user.type;
    logger.info('User authenticated', {
      userId: session.user.id,
      userType,
      email: session.user.email
    });

    const messageCount = await performanceMonitor.measureAsync('get-message-count', async () => {
      return await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 24,
      });
    });

    logger.debug('Message count retrieved', {
      userId: session.user.id,
      messageCount,
      limit: entitlementsByUserType[userType].maxMessagesPerDay
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
      logger.warn('Rate limit exceeded', {
        userId: session.user.id,
        messageCount,
        limit: entitlementsByUserType[userType].maxMessagesPerDay
      });
      return new ChatSDKError("rate_limit:chat").toResponse();
    }

    const chat = await performanceMonitor.measureAsync('get-chat', async () => {
      return await getChatById({ id });
    });

    if (chat) {
      if (chat.userId !== session.user.id) {
        logger.warn('Forbidden chat access attempt', {
          chatId: id,
          userId: session.user.id,
          chatOwnerId: chat.userId
        });
        return new ChatSDKError("forbidden:chat").toResponse();
      }
      logger.debug('Existing chat found', { chatId: id, title: chat.title });
    } else {
      logger.info('Creating new chat', { chatId: id });

      const title = await performanceMonitor.measureAsync('generate-title', async () => {
        return await generateTitleFromUserMessage({ message });
      });

      await performanceMonitor.measureAsync('save-chat', async () => {
        return await saveChat({
          id,
          userId: session.user.id,
          title,
          visibility: selectedVisibilityType,
        });
      });

      logger.info('New chat created', { chatId: id, title });
    }

    const messagesFromDb = await performanceMonitor.measureAsync('get-messages', async () => {
      return await getMessagesByChatId({ id });
    });

    const uiMessages = [...convertToUIMessages(messagesFromDb), message];
    logger.debug('Messages loaded', {
      chatId: id,
      messageCount: messagesFromDb.length,
      totalUIMessages: uiMessages.length
    });

    const { longitude, latitude, city, country } = geolocation(request);
    logger.debug('Geolocation extracted', { longitude, latitude, city, country });

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    await performanceMonitor.measureAsync('save-user-message', async () => {
      return await saveMessages({
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

    logger.info('User message saved', {
      chatId: id,
      messageId: message.id,
      partsCount: message.parts.length
    });

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });
    logger.debug('Stream ID created', { streamId, chatId: id });

    let finalMergedUsage: AppUsage | undefined;
    const aiLogger = createAILogger(selectedChatModel, 'stream-text');

    aiLogger.info('Starting AI stream', {
      chatId: id,
      model: selectedChatModel,
      messageCount: uiMessages.length,
      hasTools: selectedChatModel !== "chat-model-reasoning"
    });

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
            aiLogger.info('AI stream finished', {
              chatId: id,
              model: selectedChatModel,
              usage: {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens
              }
            });

            try {
              const providers = await getTokenlensCatalog();
              const modelId =
                myProvider.languageModel(selectedChatModel).modelId;
              if (!modelId) {
                aiLogger.warn('No model ID found for usage calculation', { model: selectedChatModel });
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              if (!providers) {
                aiLogger.warn('No providers catalog available for usage calculation');
                finalMergedUsage = usage;
                dataStream.write({
                  type: "data-usage",
                  data: finalMergedUsage,
                });
                return;
              }

              const summary = getUsage({ modelId, usage, providers });
              finalMergedUsage = { ...usage, ...summary, modelId } as AppUsage;

              aiLogger.info('Usage calculation completed', {
                chatId: id,
                modelId,
                usage: finalMergedUsage
              });

              dataStream.write({ type: "data-usage", data: finalMergedUsage });
            } catch (err) {
              aiLogger.error("TokenLens enrichment failed", err as Error, {
                chatId: id,
                model: selectedChatModel
              });
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
        logger.info('Stream completion - saving messages', {
          chatId: id,
          messageCount: messages.length
        });

        await performanceMonitor.measureAsync('save-ai-messages', async () => {
          return await saveMessages({
            messages: messages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        });

        if (finalMergedUsage) {
          try {
            await performanceMonitor.measureAsync('update-chat-context', async () => {
              return await updateChatLastContextById({
                chatId: id,
                context: finalMergedUsage,
              });
            });

            logger.debug('Chat context updated with usage', {
              chatId: id,
              usage: finalMergedUsage
            });
          } catch (err) {
            logger.error("Unable to persist last usage for chat", err as Error, {
              chatId: id
            });
          }
        }

        const totalTime = Date.now() - startTime;
        logger.info('Chat API request completed successfully', {
          chatId: id,
          totalTime,
          model: selectedChatModel,
          userId: session.user.id
        });
      },
      onError: (error) => {
        logger.error('Stream error occurred', error, {
          chatId: id,
          model: selectedChatModel,
          userId: session.user.id
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
    const totalTime = Date.now() - startTime;

    logger.error("Chat API error", error as Error, {
      chatId: requestBody?.id,
      model: requestBody?.selectedChatModel,
      userId: session?.user?.id,
      vercelId,
      totalTime
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
      logger.warn("AI Gateway credit card error", {
        chatId: requestBody?.id,
        userId: session?.user?.id
      });
      return new ChatSDKError("bad_request:activate_gateway").toResponse();
    }

    logger.error("Unhandled error in chat API", error as Error, {
      vercelId,
      chatId: requestBody?.id,
      totalTime
    });
    return new ChatSDKError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const startTime = Date.now();
  const logger = createRequestScopedLogger(request as any);
  const performanceMonitor = new PerformanceMonitor('chat-api-delete');

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  logger.info('Chat deletion request started', { chatId: id });

  if (!id) {
    logger.warn('Chat deletion request missing ID parameter');
    return new ChatSDKError("bad_request:api").toResponse();
  }

  const session = await performanceMonitor.measureAsync('auth', async () => {
    return await auth();
  });

  if (!session?.user) {
    logger.warn('Unauthorized chat deletion request');
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const chat = await performanceMonitor.measureAsync('get-chat', async () => {
    return await getChatById({ id });
  });

  if (chat?.userId !== session.user.id) {
    logger.warn('Forbidden chat deletion attempt', {
      chatId: id,
      userId: session.user.id,
      chatOwnerId: chat?.userId
    });
    return new ChatSDKError("forbidden:chat").toResponse();
  }

  const deletedChat = await performanceMonitor.measureAsync('delete-chat', async () => {
    return await deleteChatById({ id });
  });

  const totalTime = Date.now() - startTime;
  logger.info('Chat deleted successfully', {
    chatId: id,
    userId: session.user.id,
    totalTime
  });

  return Response.json(deletedChat, { status: 200 });
}
