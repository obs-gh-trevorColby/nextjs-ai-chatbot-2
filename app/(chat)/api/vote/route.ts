import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

export async function GET(request: Request) {
  const tracer = trace.getTracer("vote-api");
  const logger = logs.getLogger("vote-api");

  return tracer.startActiveSpan("vote.get", async (span) => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/vote",
        "chat.id": chatId || "unknown",
      });

      if (!chatId) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chatId parameter",
        });
        span.end();
        return new ChatSDKError(
          "bad_request:api",
          "Parameter chatId is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        span.end();
        return new ChatSDKError("unauthorized:vote").toResponse();
      }

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Chat not found",
        });
        span.end();
        return new ChatSDKError("not_found:chat").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        span.end();
        return new ChatSDKError("forbidden:vote").toResponse();
      }

      const votes = await getVotesByChatId({ id: chatId });

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

      span.end();
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
        body: "Error retrieving votes",
        attributes: { error: (error as Error).message },
      });

      span.end();
      throw error;
    }
  });
}

export async function PATCH(request: Request) {
  const tracer = trace.getTracer("vote-api");
  const logger = logs.getLogger("vote-api");

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

      if (!chatId || !messageId || !type) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing required parameters",
        });
        span.end();
        return new ChatSDKError(
          "bad_request:api",
          "Parameters chatId, messageId, and type are required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        span.end();
        return new ChatSDKError("unauthorized:vote").toResponse();
      }

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Chat not found",
        });
        span.end();
        return new ChatSDKError("not_found:vote").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        span.end();
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
          voteType: type,
          userId: session.user.id,
        },
      });

      span.end();
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
        body: "Error voting on message",
        attributes: { error: (error as Error).message },
      });

      span.end();
      throw error;
    }
  });
}
