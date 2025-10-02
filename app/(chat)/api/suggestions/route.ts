import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import { getSuggestionsByDocumentId } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger } from "@/lib/otel-server";

const tracer = trace.getTracer("ai-chatbot-api");

export async function GET(request: Request) {
  return tracer.startActiveSpan("suggestions.get", async (span) => {
    try {
      const { searchParams } = new URL(request.url);
      const documentId = searchParams.get("documentId");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/suggestions",
        "document.id": documentId || "",
      });

      if (!documentId) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing documentId",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Suggestions request missing documentId",
        });
        return new ChatSDKError(
          "bad_request:api",
          "Parameter documentId is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized suggestions request",
          attributes: { documentId },
        });
        return new ChatSDKError("unauthorized:suggestions").toResponse();
      }

      span.setAttributes({
        "user.id": session.user.id,
      });

      const suggestions = await getSuggestionsByDocumentId({
        documentId,
      });

      const [suggestion] = suggestions;

      if (!suggestion) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttributes({
          "http.status_code": 200,
          "response.suggestions_count": 0,
        });
        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "No suggestions found for document",
          attributes: { documentId, userId: session.user.id },
        });
        return Response.json([], { status: 200 });
      }

      if (suggestion.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden suggestions access attempt",
          attributes: {
            documentId,
            userId: session.user.id,
            suggestionOwnerId: suggestion.userId,
          },
        });
        return new ChatSDKError("forbidden:api").toResponse();
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "http.status_code": 200,
        "response.suggestions_count": suggestions.length,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Suggestions retrieved successfully",
        attributes: {
          documentId,
          userId: session.user.id,
          suggestionsCount: suggestions.length,
        },
      });

      return Response.json(suggestions, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "Suggestions request failed",
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error retrieving suggestions",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}
