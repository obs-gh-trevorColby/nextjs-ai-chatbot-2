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
import { loggerProvider } from "@/otel-server";

export async function GET(request: Request) {
  const tracer = trace.getTracer("ai-chatbot");
  const logger = loggerProvider.getLogger("ai-chatbot");

  return tracer.startActiveSpan("document.get", async (span) => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/document",
        "document.id": id || "unknown",
      });

      if (!id) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Missing document ID",
        });
        return new ChatSDKError(
          "bad_request:api",
          "Parameter id is missing"
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Unauthorized" });
        return new ChatSDKError("unauthorized:document").toResponse();
      }

      span.setAttributes({
        "user.id": session.user.id,
      });

      const documents = await getDocumentsById({ id });

      const [document] = documents;

      if (!document) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Document not found",
        });
        return new ChatSDKError("not_found:document").toResponse();
      }

      if (document.userId !== session.user.id) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden" });
        return new ChatSDKError("forbidden:document").toResponse();
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "http.status_code": 200,
        "document.title": document.title,
        "document.kind": document.kind,
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Document retrieved successfully",
        attributes: {
          documentId: id,
          userId: session.user.id,
          documentTitle: document.title,
        },
      });

      return Response.json(documents, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error retrieving document",
        attributes: { error: (error as Error).message },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatSDKError(
      "bad_request:api",
      "Parameter id is required."
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("not_found:document").toResponse();
  }

  const {
    content,
    title,
    kind,
  }: { content: string; title: string; kind: ArtifactKind } =
    await request.json();

  const documents = await getDocumentsById({ id });

  if (documents.length > 0) {
    const [doc] = documents;

    if (doc.userId !== session.user.id) {
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

  return Response.json(document, { status: 200 });
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
