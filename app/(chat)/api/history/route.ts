import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger, meter, tracer } from "@/otel-server";

// Initialize metrics for history endpoint
const historyRequestCounter = meter.createCounter("history_requests_total", {
  description: "Total number of history requests",
});

const historyRequestDuration = meter.createHistogram(
  "history_request_duration_ms",
  {
    description: "Duration of history requests in milliseconds",
  }
);

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  return tracer.startActiveSpan("history.get", async (span: Span) => {
    try {
      const { searchParams } = request.nextUrl;

      const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
      const startingAfter = searchParams.get("starting_after");
      const endingBefore = searchParams.get("ending_before");

      span.setAttributes({
        "history.limit": limit,
        "history.starting_after": startingAfter || "none",
        "history.ending_before": endingBefore || "none",
      });

      if (startingAfter && endingBefore) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid pagination parameters",
        });

        historyRequestCounter.add(1, {
          status: "error",
          error_type: "bad_request",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Invalid history request parameters",
          attributes: { startingAfter, endingBefore },
        });

        return new ChatSDKError(
          "bad_request:api",
          "Only one of starting_after or ending_before can be provided."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        historyRequestCounter.add(1, {
          status: "error",
          error_type: "unauthorized",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized history request",
        });

        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const chatsResult = await getChatsByUserId({
        id: session.user.id,
        limit,
        startingAfter,
        endingBefore,
      });

      const duration = Date.now() - startTime;

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "history.chat_count": chatsResult.chats.length,
        "history.has_more": chatsResult.hasMore,
        "response.duration_ms": duration,
      });

      historyRequestCounter.add(1, { status: "success" });
      historyRequestDuration.record(duration);

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "History request completed successfully",
        attributes: {
          userId: session.user.id,
          chatCount: chatsResult.chats.length,
          hasMore: chatsResult.hasMore,
          limit,
          duration,
        },
      });

      return Response.json(chatsResult);
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      historyRequestCounter.add(1, {
        status: "error",
        error_type: "unhandled",
      });
      historyRequestDuration.record(duration);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in history request",
        attributes: { error: (error as Error).message, duration },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
