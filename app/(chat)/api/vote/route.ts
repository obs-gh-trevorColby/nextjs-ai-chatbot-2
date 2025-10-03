import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

const tracer = trace.getTracer("ai-chatbot-api");
const logger = logs.getLogger("ai-chatbot-api");

export function GET(request: Request) {
  return tracer.startActiveSpan("vote.get", async (span) => {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");

    span.setAttributes({
      "http.method": "GET",
      "http.route": "/api/vote",
      "chat.id": chatId || "missing",
    });

    if (!chatId) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Missing chatId parameter",
      });
      return new ChatSDKError(
        "bad_request:api",
        "Parameter chatId is required."
      ).toResponse();
    }

    const session = await auth();

    if (!session?.user) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
      return new ChatSDKError("unauthorized:vote").toResponse();
    }

    span.setAttributes({ "user.id": session.user.id });

    const chat = await getChatById({ id: chatId });

    if (!chat) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Chat not found" });
      return new ChatSDKError("not_found:chat").toResponse();
    }

    if (chat.userId !== session.user.id) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
      return new ChatSDKError("forbidden:vote").toResponse();
    }

    const votes = await getVotesByChatId({ id: chatId });

    span.setAttributes({ "votes.count": votes.length });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    return Response.json(votes, { status: 200 });
  });
}

export function PATCH(request: Request) {
  return tracer.startActiveSpan("vote.patch", async (span) => {
    const {
      chatId,
      messageId,
      type,
    }: { chatId: string; messageId: string; type: "up" | "down" } =
      await request.json();

    span.setAttributes({
      "http.method": "PATCH",
      "http.route": "/api/vote",
      "chat.id": chatId || "missing",
      "message.id": messageId || "missing",
      "vote.type": type || "missing",
    });

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

    const session = await auth();

    if (!session?.user) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
      return new ChatSDKError("unauthorized:vote").toResponse();
    }

    span.setAttributes({ "user.id": session.user.id });

    const chat = await getChatById({ id: chatId });

    if (!chat) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Chat not found" });
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

    span.end();
    return new Response("Message voted", { status: 200 });
  });
}
