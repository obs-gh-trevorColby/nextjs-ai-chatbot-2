import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger, meter, tracer } from "@/otel-server";

// Initialize metrics
const documentRequestCounter = meter.createCounter("document_requests_total", {
  description: "Total number of document requests",
});

const documentRequestDuration = meter.createHistogram(
  "document_request_duration_ms",
  {
    description: "Duration of document requests in milliseconds",
  }
);

export function GET(request: Request) {
  const startTime = Date.now();

  return tracer.startActiveSpan("document.get", async (span: Span) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/document",
        "document.id": id || "unknown",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document GET request started",
        attributes: {
          "document.id": id || "unknown",
        },
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing document ID",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Missing document ID in GET request",
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameter id is missing"
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized document access attempt",
          attributes: { "document.id": id },
        });

        return new ChatSDKError("unauthorized:document").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const documents = await getDocumentsById({ id });
      const [document] = documents;

      if (!document) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Document not found",
        });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Document not found",
          attributes: {
            "document.id": id,
            "user.id": session.user.id,
          },
        });

        return new ChatSDKError("not_found:document").toResponse();
      }

      if (document.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden document access attempt",
          attributes: {
            "document.id": id,
            "user.id": session.user.id,
            "document.owner_id": document.userId,
          },
        });

        return new ChatSDKError("forbidden:document").toResponse();
      }

      const duration = Date.now() - startTime;

      span.setAttributes({
        "document.title": document.title,
        "document.kind": document.kind,
        "response.documents_count": documents.length,
        "request.duration_ms": duration,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      documentRequestCounter.add(1, {
        method: "GET",
        status: "success",
      });

      documentRequestDuration.record(duration, {
        method: "GET",
        status: "success",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document retrieved successfully",
        attributes: {
          "document.id": id,
          "document.title": document.title,
          "user.id": session.user.id,
          "request.duration_ms": duration,
        },
      });

      return Response.json(documents, { status: 200 });
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      documentRequestCounter.add(1, {
        method: "GET",
        status: "error",
      });

      documentRequestDuration.record(duration, {
        method: "GET",
        status: "error",
      });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in document GET request",
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

export function POST(request: Request) {
  const startTime = Date.now();

  return tracer.startActiveSpan("document.post", async (span: Span) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      span.setAttributes({
        "http.method": "POST",
        "http.route": "/api/document",
        "document.id": id || "unknown",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document POST request started",
        attributes: {
          "document.id": id || "unknown",
        },
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing document ID",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Missing document ID in POST request",
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameter id is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized document save attempt",
          attributes: { "document.id": id },
        });

        return new ChatSDKError("not_found:document").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const {
        content,
        title,
        kind,
      }: { content: string; title: string; kind: ArtifactKind } =
        await request.json();

      span.setAttributes({
        "document.title": title,
        "document.kind": kind,
        "document.content_length": content.length,
      });

      const documents = await getDocumentsById({ id });

      if (documents.length > 0) {
        const [doc] = documents;

        if (doc.userId !== session.user.id) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

          logger.emit({
            severityNumber: SeverityNumber.WARN,
            severityText: "WARN",
            body: "Forbidden document save attempt",
            attributes: {
              "document.id": id,
              "user.id": session.user.id,
              "document.owner_id": doc.userId,
            },
          });

          return new ChatSDKError("forbidden:document").toResponse();
        }

        span.setAttributes({ "document.exists": true });
      } else {
        span.setAttributes({ "document.exists": false });
      }

      const document = await saveDocument({
        id,
        content,
        title,
        kind,
        userId: session.user.id,
      });

      const duration = Date.now() - startTime;

      span.setAttributes({
        "document.saved": true,
        "request.duration_ms": duration,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      documentRequestCounter.add(1, {
        method: "POST",
        status: "success",
      });

      documentRequestDuration.record(duration, {
        method: "POST",
        status: "success",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document saved successfully",
        attributes: {
          "document.id": id,
          "document.title": title,
          "document.kind": kind,
          "user.id": session.user.id,
          "request.duration_ms": duration,
        },
      });

      return Response.json(document, { status: 200 });
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      documentRequestCounter.add(1, {
        method: "POST",
        status: "error",
      });

      documentRequestDuration.record(duration, {
        method: "POST",
        status: "error",
      });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in document POST request",
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

export function DELETE(request: Request) {
  const startTime = Date.now();

  return tracer.startActiveSpan("document.delete", async (span: Span) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");
      const timestamp = searchParams.get("timestamp");

      span.setAttributes({
        "http.method": "DELETE",
        "http.route": "/api/document",
        "document.id": id || "unknown",
        "query.timestamp": timestamp || "unknown",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document DELETE request started",
        attributes: {
          "document.id": id || "unknown",
          "query.timestamp": timestamp || "unknown",
        },
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing document ID",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Missing document ID in DELETE request",
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameter id is required."
        ).toResponse();
      }

      if (!timestamp) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing timestamp",
        });

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Missing timestamp in DELETE request",
          attributes: { "document.id": id },
        });

        return new ChatSDKError(
          "bad_request:api",
          "Parameter timestamp is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Unauthorized document deletion attempt",
          attributes: { "document.id": id },
        });

        return new ChatSDKError("unauthorized:document").toResponse();
      }

      span.setAttributes({ "user.id": session.user.id });

      const documents = await getDocumentsById({ id });
      const [document] = documents;

      if (document.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });

        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Forbidden document deletion attempt",
          attributes: {
            "document.id": id,
            "user.id": session.user.id,
            "document.owner_id": document.userId,
          },
        });

        return new ChatSDKError("forbidden:document").toResponse();
      }

      const documentsDeleted = await deleteDocumentsByIdAfterTimestamp({
        id,
        timestamp: new Date(timestamp),
      });

      const duration = Date.now() - startTime;

      span.setAttributes({
        "documents.deleted_count": documentsDeleted.length,
        "request.duration_ms": duration,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      documentRequestCounter.add(1, {
        method: "DELETE",
        status: "success",
      });

      documentRequestDuration.record(duration, {
        method: "DELETE",
        status: "success",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Documents deleted successfully",
        attributes: {
          "document.id": id,
          "documents.deleted_count": documentsDeleted.length,
          "user.id": session.user.id,
          "request.duration_ms": duration,
        },
      });

      return Response.json(documentsDeleted, { status: 200 });
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      documentRequestCounter.add(1, {
        method: "DELETE",
        status: "error",
      });

      documentRequestDuration.record(duration, {
        method: "DELETE",
        status: "error",
      });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error in document DELETE request",
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
