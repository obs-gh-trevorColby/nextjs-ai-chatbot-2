import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { loggerProvider } from "@/otel-server";

export async function GET(request: NextRequest) {
  const tracer = trace.getTracer("ai-chatbot");
  const logger = loggerProvider.getLogger("ai-chatbot");

  return tracer.startActiveSpan("history.get", async (span) => {
    try {
      const { searchParams } = request.nextUrl;

      const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
      const startingAfter = searchParams.get("starting_after");
      const endingBefore = searchParams.get("ending_before");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/history",
        "query.limit": limit,
        "query.starting_after": startingAfter || "none",
        "query.ending_before": endingBefore || "none",
      });

      if (startingAfter && endingBefore) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid query parameters",
        });
        return new ChatSDKError(
          "bad_request:api",
          "Only one of starting_after or ending_before can be provided."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      span.setAttributes({
        "user.id": session.user.id,
      });

      const chats = await getChatsByUserId({
        id: session.user.id,
        limit,
        startingAfter,
        endingBefore,
      });

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "http.status_code": 200,
        "response.chats_count": chats.chats.length,
        "response.has_more": chats.hasMore,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat history retrieved successfully",
        attributes: {
          userId: session.user.id,
          chatsCount: chats.chats.length,
          hasMore: chats.hasMore,
          limit,
        },
      });

      return Response.json(chats);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error retrieving chat history",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
