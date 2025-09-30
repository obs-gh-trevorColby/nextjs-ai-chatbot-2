import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import { logger } from "@/otel-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError(
      "bad_request:api",
      "Parameter id is missing"
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:document").toResponse();
  }

  const documents = await getDocumentsById({ id });

  const [document] = documents;

  if (!document) {
    return new ChatSDKError("not_found:document").toResponse();
  }

  if (document.userId !== session.user.id) {
    return new ChatSDKError("forbidden:document").toResponse();
  }

  return Response.json(documents, { status: 200 });
}

export async function POST(request: Request) {
  const tracer = trace.getTracer("document-api");

  return tracer.startActiveSpan("document.post", async (span) => {
    const startTime = Date.now();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    try {
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
          "http.method": "POST",
          "document.id": id || "unknown",
        },
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing document ID",
        });
        logger.emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Document POST request missing ID",
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
          body: "Unauthorized document POST request",
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
            body: "Forbidden document POST request",
            attributes: {
              "document.id": id,
              "user.id": session.user.id,
              "document.owner_id": doc.userId,
            },
          });
          return new ChatSDKError("forbidden:document").toResponse();
        }
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
        "document.duration_ms": duration,
        "http.status_code": 200,
      });
      span.setStatus({ code: SpanStatusCode.OK });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document saved successfully",
        attributes: {
          "document.id": id,
          "document.title": title,
          "document.kind": kind,
          "user.id": session.user.id,
          "document.duration_ms": duration,
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

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error saving document",
        attributes: {
          "document.id": id || "unknown",
          "error.message": (error as Error).message,
          "document.duration_ms": duration,
        },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const timestamp = searchParams.get("timestamp");

  if (!id) {
    return new ChatSDKError(
      "bad_request:api",
      "Parameter id is required."
    ).toResponse();
  }

  if (!timestamp) {
    return new ChatSDKError(
      "bad_request:api",
      "Parameter timestamp is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:document").toResponse();
  }

  const documents = await getDocumentsById({ id });

  const [document] = documents;

  if (document.userId !== session.user.id) {
    return new ChatSDKError("forbidden:document").toResponse();
  }

  const documentsDeleted = await deleteDocumentsByIdAfterTimestamp({
    id,
    timestamp: new Date(timestamp),
  });

  return Response.json(documentsDeleted, { status: 200 });
}
