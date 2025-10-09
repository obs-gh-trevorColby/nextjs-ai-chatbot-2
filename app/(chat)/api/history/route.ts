import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

const tracer = trace.getTracer("ai-chatbot-api");

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  return tracer.startActiveSpan("history_api_get", async (span) => {
    let logger: any;

    try {
      const { logger: otelLogger } = await import("@/otel-server");
      logger = otelLogger;
    } catch (error) {
      // Fallback if otel-server is not available
    }

    try {
      const { searchParams } = request.nextUrl;

      const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
      const startingAfter = searchParams.get("starting_after");
      const endingBefore = searchParams.get("ending_before");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/history",
        "pagination.limit": limit,
        "pagination.starting_after": startingAfter || "",
        "pagination.ending_before": endingBefore || "",
      });

      if (startingAfter && endingBefore) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid pagination parameters",
        });

        if (logger) {
          logger.emit({
            severityNumber: SeverityNumber.WARN,
            severityText: "WARN",
            body: "Invalid pagination parameters in history API",
            attributes: { startingAfter, endingBefore },
          });
        }

        span.end();
        return new ChatSDKError(
          "bad_request:api",
          "Only one of starting_after or ending_before can be provided."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        if (logger) {
          logger.emit({
            severityNumber: SeverityNumber.WARN,
            severityText: "WARN",
            body: "Unauthorized history API request",
          });
        }

        span.end();
        return new ChatSDKError("unauthorized:chat").toResponse();
      }

      span.setAttributes({
        "user.id": session.user.id,
        "user.type": session.user.type,
      });

      const chatsResult = await getChatsByUserId({
        id: session.user.id,
        limit,
        startingAfter,
        endingBefore,
      });

      const duration = Date.now() - startTime;
      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "request.duration_ms": duration,
        "response.chats_count": chatsResult.chats.length,
        "response.has_more": chatsResult.hasMore,
      });

      if (logger) {
        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "History API request completed",
          attributes: {
            userId: session.user.id,
            chatsCount: chatsResult.chats.length,
            hasMore: chatsResult.hasMore,
            duration,
          },
        });
      }

      span.end();
      return Response.json(chatsResult);
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);
      span.setAttributes({ "request.duration_ms": duration });

      if (logger) {
        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "History API request failed",
          attributes: {
            error: (error as Error).message,
            duration,
          },
        });
      }

      span.end();
      throw error;
    }
  });
}
