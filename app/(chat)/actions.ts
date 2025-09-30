"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import { myProvider } from "@/lib/ai/providers";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from "@/lib/db/queries";

export async function saveChatModelAsCookie(model: string) {
  const tracer = trace.getTracer("chat-actions");
  const logger = logs.getLogger("chat-actions");

  return tracer.startActiveSpan("chat.saveChatModelAsCookie", async (span) => {
    try {
      span.setAttributes({
        "action.name": "saveChatModelAsCookie",
        "chat.model": model,
      });

      const cookieStore = await cookies();
      cookieStore.set("chat-model", model);

      span.setStatus({ code: SpanStatusCode.OK });
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat model saved as cookie",
        attributes: { model },
      });

      span.end();
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error saving chat model cookie",
        attributes: { error: (error as Error).message, model },
      });

      span.end();
      throw error;
    }
  });
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const tracer = trace.getTracer("chat-actions");
  const logger = logs.getLogger("chat-actions");

  return tracer.startActiveSpan(
    "chat.generateTitleFromUserMessage",
    async (span) => {
      try {
        span.setAttributes({
          "action.name": "generateTitleFromUserMessage",
          "message.id": message.id,
          "message.role": message.role,
        });

        const { text: title } = await generateText({
          model: myProvider.languageModel("title-model"),
          system: `\n
        - you will generate a short title based on the first message a user begins a conversation with
        - ensure it is not more than 80 characters long
        - the title should be a summary of the user's message
        - do not use quotes or colons`,
          prompt: JSON.stringify(message),
        });

        span.setAttributes({
          "title.length": title.length,
        });

        span.setStatus({ code: SpanStatusCode.OK });
        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Title generated from user message",
          attributes: {
            messageId: message.id,
            titleLength: title.length,
          },
        });

        span.end();
        return title;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span.recordException(error as Error);

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Error generating title from user message",
          attributes: {
            error: (error as Error).message,
            messageId: message.id,
          },
        });

        span.end();
        throw error;
      }
    }
  );
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
