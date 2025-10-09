import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger, meter, tracer } from "@/otel-server";

// Initialize metrics
const historyRequestCounter = meter.createCounter("history_requests_total", {
  description: "Total number of history requests",
});

const historyRequestDuration = meter.createHistogram(
  "history_request_duration_ms",
  {
    description: "Duration of history requests in milliseconds",
  }
);

export function GET(request: NextRequest) {
  const startTime = Date.now();

  return tracer.startActiveSpan("history.get", async (span: Span) => {
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

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "History request started",
        attributes: {
          "http.method": "GET",
          "query.limit": limit,
        },
      });

      if (startingAfter && endingBefore) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid query parameters",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Invalid query parameters: both starting_after and ending_before provided",
        });

        return new ChatSDKError(
          "bad_request:api",
          "Only one of starting_after or ending_before can be provided."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

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

      span.setAttributes({
        "response.chats_count": chatsResult.chats.length,
        "response.has_more": chatsResult.hasMore,
        "request.duration_ms": duration,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      historyRequestCounter.add(1, { status: "success" });
      historyRequestDuration.record(duration, { status: "success" });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "History request completed successfully",
        attributes: {
          "user.id": session.user.id,
          "response.chats_count": chatsResult.chats.length,
          "response.has_more": chatsResult.hasMore,
          "request.duration_ms": duration,
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

      historyRequestCounter.add(1, { status: "error" });
      historyRequestDuration.record(duration, { status: "error" });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in history request",
        attributes: {
          error: (error as Error).message,
          "request.duration_ms": duration,
        },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
