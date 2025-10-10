"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import { myProvider } from "@/lib/ai/providers";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from "@/lib/db/queries";

// Get OpenTelemetry instances
const tracer = trace.getTracer("ai-chatbot");
const logger = (() => {
  try {
    const { logs } = require("@opentelemetry/api-logs");
    return logs.getLogger("ai-chatbot");
  } catch {
    return { emit: () => { /* no-op fallback */ } };
  }
})();

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  return tracer.startActiveSpan("action.generateTitle", async (span) => {
    try {
      span.setAttributes({
        "action.name": "generateTitleFromUserMessage",
        "message.role": message.role,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Generating title from user message",
        attributes: {
          "message.role": message.role,
        },
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
        body: "Title generated successfully",
        attributes: {
          "title.length": title.length,
        },
      });

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
        body: "Error generating title",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
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
