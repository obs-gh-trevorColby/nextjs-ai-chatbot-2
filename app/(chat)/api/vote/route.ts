import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger, meter, tracer } from "@/otel-server";

// Initialize metrics
const voteRequestCounter = meter.createCounter("vote_request_count", {
  description: "Total number of vote requests",
});

const voteRequestDuration = meter.createHistogram("vote_request_duration", {
  description: "Duration of vote requests in milliseconds",
});

export async function GET(request: Request) {
  const startTime = Date.now();

  return tracer.startActiveSpan("vote.get", async (span) => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      span.setAttributes({ "vote.chat_id": chatId || "unknown" });

      if (!chatId) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chatId parameter",
        });

        voteRequestCounter.add(1, {
          method: "GET",
          status: "error",
          error_type: "bad_request",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Get votes request missing chatId",
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameter chatId is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        voteRequestCounter.add(1, {
          method: "GET",
          status: "error",
          error_type: "unauthorized",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized get votes request",
          attributes: { chat_id: chatId },
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

        voteRequestCounter.add(1, {
          method: "GET",
          status: "error",
          error_type: "not_found",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat not found for get votes request",
          attributes: { chat_id: chatId, user_id: session.user.id },
        });

        return new ChatSDKError("not_found:chat").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

        voteRequestCounter.add(1, {
          method: "GET",
          status: "error",
          error_type: "forbidden",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden get votes request",
          attributes: {
            chat_id: chatId,
            user_id: session.user.id,
            chat_owner: chat.userId,
          },
        });

        return new ChatSDKError("forbidden:vote").toResponse();
      }

      const votes = await getVotesByChatId({ id: chatId });

      span.setAttributes({ "vote.result_count": votes.length });
      span.setStatus({ code: SpanStatusCode.OK });

      voteRequestCounter.add(1, { method: "GET", status: "success" });
      voteRequestDuration.record(Date.now() - startTime, {
        method: "GET",
        status: "success",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Get votes request completed successfully",
        attributes: {
          chat_id: chatId,
          user_id: session.user.id,
          result_count: votes.length,
          duration: Date.now() - startTime,
        },
      });

      return Response.json(votes, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      voteRequestCounter.add(1, {
        method: "GET",
        status: "error",
        error_type: "unhandled",
      });
      voteRequestDuration.record(Date.now() - startTime, {
        method: "GET",
        status: "error",
      });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in get votes request",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

export async function PATCH(request: Request) {
  const startTime = Date.now();

  return tracer.startActiveSpan("vote.patch", async (span) => {
    try {
      const {
        chatId,
        messageId,
        type,
      }: { chatId: string; messageId: string; type: "up" | "down" } =
        await request.json();

      span.setAttributes({
        "vote.chat_id": chatId || "unknown",
        "vote.message_id": messageId || "unknown",
        "vote.type": type || "unknown",
      });

      if (!chatId || !messageId || !type) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing required parameters",
        });

        voteRequestCounter.add(1, {
          method: "PATCH",
          status: "error",
          error_type: "bad_request",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Vote message request missing required parameters",
          attributes: {
            chat_id: chatId,
            message_id: messageId,
            type,
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

        voteRequestCounter.add(1, {
          method: "PATCH",
          status: "error",
          error_type: "unauthorized",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized vote message request",
          attributes: {
            chat_id: chatId,
            message_id: messageId,
            type,
          },
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

        voteRequestCounter.add(1, {
          method: "PATCH",
          status: "error",
          error_type: "not_found",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Chat not found for vote message request",
          attributes: {
            chat_id: chatId,
            message_id: messageId,
            user_id: session.user.id,
          },
        });

        return new ChatSDKError("not_found:vote").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

        voteRequestCounter.add(1, {
          method: "PATCH",
          status: "error",
          error_type: "forbidden",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden vote message request",
          attributes: {
            chat_id: chatId,
            message_id: messageId,
            user_id: session.user.id,
            chat_owner: chat.userId,
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

      voteRequestCounter.add(1, {
        method: "PATCH",
        status: "success",
        vote_type: type,
      });
      voteRequestDuration.record(Date.now() - startTime, {
        method: "PATCH",
        status: "success",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Vote message request completed successfully",
        attributes: {
          chat_id: chatId,
          message_id: messageId,
          user_id: session.user.id,
          vote_type: type,
          duration: Date.now() - startTime,
        },
      });

      return new Response("Message voted", { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      voteRequestCounter.add(1, {
        method: "PATCH",
        status: "error",
        error_type: "unhandled",
      });
      voteRequestDuration.record(Date.now() - startTime, {
        method: "PATCH",
        status: "error",
      });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in vote message request",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
