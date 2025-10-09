import type { NextRequest } from "next/server";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

const tracer = trace.getTracer("ai-chatbot");
const logger = logs.getLogger("ai-chatbot");

export async function GET(request: NextRequest) {
  return tracer.startActiveSpan("history.get", async (span) => {
    try {
      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/history",
      });

      const { searchParams } = request.nextUrl;

      const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
      const startingAfter = searchParams.get("starting_after");
      const endingBefore = searchParams.get("ending_before");

      span.setAttributes({
        "history.limit": limit,
        "history.startingAfter": startingAfter || "none",
        "history.endingBefore": endingBefore || "none",
      });

      if (startingAfter && endingBefore) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Invalid pagination parameters" });
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

      span.setAttributes({ "user.id": session.user.id });

      const chats = await getChatsByUserId({
        id: session.user.id,
        limit,
        startingAfter,
        endingBefore,
      });

      span.setAttributes({ "history.chats.count": chats.length });
      span.setStatus({ code: SpanStatusCode.OK });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Chat history retrieved successfully",
        attributes: {
          "user.id": session.user.id,
          "history.chats.count": chats.length,
          "history.limit": limit,
        },
      });

      return Response.json(chats);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Get history error" });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Get history error",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
