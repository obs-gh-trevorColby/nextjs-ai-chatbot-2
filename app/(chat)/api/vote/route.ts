import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger, tracer } from "@/otel-server";

export async function GET(request: Request) {
  return tracer.startActiveSpan("vote.get", async (span: Span) => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      if (!chatId) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chatId",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Get votes request missing chatId",
        });
        return new ChatSDKError(
          "bad_request:api",
          "Parameter chatId is required."
        ).toResponse();
      }

      span.setAttributes({ "chat.id": chatId });

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized get votes request",
          attributes: { chatId },
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
          attributes: { chatId, userId: session.user.id },
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
            chatId,
            userId: session.user.id,
            chatOwnerId: chat.userId,
          },
        });
        return new ChatSDKError("forbidden:vote").toResponse();
      }

      const votes = await getVotesByChatId({ id: chatId });

      span.setAttributes({ "votes.count": votes.length });
      span.setStatus({ code: SpanStatusCode.OK });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Votes retrieved successfully",
        attributes: {
          chatId,
          userId: session.user.id,
          voteCount: votes.length,
        },
      });

      return Response.json(votes, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Get votes failed",
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error retrieving votes",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

export async function PATCH(request: Request) {
  return tracer.startActiveSpan("vote.patch", async (span: Span) => {
    try {
      const {
        chatId,
        messageId,
        type,
      }: { chatId: string; messageId: string; type: "up" | "down" } =
        await request.json();

      if (!chatId || !messageId || !type) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing required parameters",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Vote request missing required parameters",
          attributes: { chatId, messageId, type },
        });
        return new ChatSDKError(
          "bad_request:api",
          "Parameters chatId, messageId, and type are required."
        ).toResponse();
      }

      span.setAttributes({
        "chat.id": chatId,
        "message.id": messageId,
        "vote.type": type,
      });

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized vote request",
          attributes: { chatId, messageId, type },
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
          body: "Chat not found for vote request",
          attributes: { chatId, messageId, type, userId: session.user.id },
        });
        return new ChatSDKError("not_found:vote").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden vote request",
          attributes: {
            chatId,
            messageId,
            type,
            userId: session.user.id,
            chatOwnerId: chat.userId,
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
          chatId,
          messageId,
          type,
          userId: session.user.id,
        },
      });

      return new Response("Message voted", { status: 200 });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Vote failed" });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error voting on message",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
