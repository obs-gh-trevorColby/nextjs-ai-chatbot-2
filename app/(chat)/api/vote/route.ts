import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

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

export async function GET(request: Request) {
  return tracer.startActiveSpan("vote.get", async (span) => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/vote",
        "chat.id": chatId || "unknown",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Get votes request started",
        attributes: { "chat.id": chatId || "unknown" },
      });

      if (!chatId) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chatId parameter",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Get votes failed: missing chatId parameter",
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameter chatId is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized get votes request",
          attributes: { "chat.id": chatId },
        });

        return new ChatSDKError("unauthorized:vote").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Chat not found",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat not found for votes request",
          attributes: { "chat.id": chatId, "user.id": session.user.id },
        });

        return new ChatSDKError("not_found:chat").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden get votes request",
          attributes: {
            "chat.id": chatId,
            "user.id": session.user.id,
            "chat.owner": chat.userId,
          },
        });

        return new ChatSDKError("forbidden:vote").toResponse();
      }

      const votes = await getVotesByChatId({ id: chatId });

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({ "votes.count": votes.length });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Get votes completed successfully",
        attributes: {
          "chat.id": chatId,
          "user.id": session.user.id,
          "votes.count": votes.length,
        },
      });

      return Response.json(votes, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error getting votes",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

export async function PATCH(request: Request) {
  return tracer.startActiveSpan("vote.patch", async (span) => {
    try {
      const {
        chatId,
        messageId,
        type,
      }: { chatId: string; messageId: string; type: "up" | "down" } =
        await request.json();

      span.setAttributes({
        "http.method": "PATCH",
        "http.route": "/api/vote",
        "chat.id": chatId || "unknown",
        "message.id": messageId || "unknown",
        "vote.type": type || "unknown",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Vote message request started",
        attributes: {
          "chat.id": chatId || "unknown",
          "message.id": messageId || "unknown",
          "vote.type": type || "unknown",
        },
      });

      if (!chatId || !messageId || !type) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing required parameters",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Vote message failed: missing required parameters",
          attributes: {
            "chat.id": chatId || "missing",
            "message.id": messageId || "missing",
            "vote.type": type || "missing",
          },
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameters chatId, messageId, and type are required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized vote message request",
          attributes: { "chat.id": chatId, "message.id": messageId },
        });

        return new ChatSDKError("unauthorized:vote").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Chat not found",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat not found for vote message request",
          attributes: {
            "chat.id": chatId,
            "message.id": messageId,
            "user.id": session.user.id,
          },
        });

        return new ChatSDKError("not_found:vote").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden vote message request",
          attributes: {
            "chat.id": chatId,
            "message.id": messageId,
            "user.id": session.user.id,
            "chat.owner": chat.userId,
          },
        });

        return new ChatSDKError("forbidden:vote").toResponse();
      }

      await voteMessage({
        chatId,
        messageId,
        type,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Message voted successfully",
        attributes: {
          "chat.id": chatId,
          "message.id": messageId,
          "vote.type": type,
          "user.id": session.user.id,
        },
      });

      return new Response("Message voted", { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error voting message",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
