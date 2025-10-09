import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

const tracer = trace.getTracer("ai-chatbot");
const logger = logs.getLogger("ai-chatbot");

export async function GET(request: Request) {
  return tracer.startActiveSpan("vote.get", async (span) => {
    try {
      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/vote",
      });

      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      if (!chatId) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing chatId",
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
        return new ChatSDKError("unauthorized:vote").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Chat not found",
        });
        return new ChatSDKError("not_found:chat").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        return new ChatSDKError("forbidden:vote").toResponse();
      }

      const votes = await getVotesByChatId({ id: chatId });

      span.setStatus({ code: SpanStatusCode.OK });
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Votes retrieved successfully",
        attributes: { "chat.id": chatId, "user.id": session.user.id },
      });

      return Response.json(votes, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Get votes error",
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Get votes error",
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
      span.setAttributes({
        "http.method": "PATCH",
        "http.route": "/api/vote",
      });

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
        return new ChatSDKError("unauthorized:vote").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Chat not found",
        });
        return new ChatSDKError("not_found:vote").toResponse();
      }

      if (chat.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
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
        message: "Vote message error",
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Vote message error",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
