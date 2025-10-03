import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

const tracer = trace.getTracer("ai-chatbot-api");
const logger = logs.getLogger("ai-chatbot-api");

export function GET(request: NextRequest) {
  return tracer.startActiveSpan("history.get", async (span) => {
    const { searchParams } = request.nextUrl;

    const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
    const startingAfter = searchParams.get("starting_after");
    const endingBefore = searchParams.get("ending_before");

    span.setAttributes({
      "http.method": "GET",
      "http.route": "/api/history",
      "query.limit": limit,
      "query.startingAfter": startingAfter || "none",
      "query.endingBefore": endingBefore || "none",
    });

    if (startingAfter && endingBefore) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Invalid pagination parameters",
      });
      logger.emit({
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        body: "Invalid pagination parameters in history request",
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
      return new ChatSDKError("unauthorized:chat").toResponse();
    }

    span.setAttributes({ "user.id": session.user.id });

    const chats = await tracer.startActiveSpan(
      "db.getChatsByUserId",
      async (dbSpan) => {
        dbSpan.setAttributes({
          "db.operation": "getChatsByUserId",
          "user.id": session.user.id,
          "query.limit": limit,
        });
        return await getChatsByUserId({
          id: session.user.id,
          limit,
          startingAfter,
          endingBefore,
        });
      }
    );

    span.setAttributes({ "chats.count": chats.length });
    span.setStatus({ code: SpanStatusCode.OK });

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "Chat history retrieved successfully",
      attributes: {
        "user.id": session.user.id,
        "chats.count": chats.length,
        "query.limit": limit,
      },
    });

    span.end();
    return Response.json(chats);
  });
}
