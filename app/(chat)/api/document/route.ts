import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

const tracer = trace.getTracer("ai-chatbot-api");
const _logger = logs.getLogger("ai-chatbot-api");

export function GET(request: Request) {
  return tracer.startActiveSpan("document.get", async (span) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    span.setAttributes({
      "http.method": "GET",
      "http.route": "/api/document",
      "document.id": id || "missing",
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

    span.setAttributes({ "user.id": session.user.id });

    const documents = await tracer.startActiveSpan(
      "db.getDocumentsById",
      async (dbSpan) => {
        dbSpan.setAttributes({
          "db.operation": "getDocumentsById",
          "document.id": id,
        });
        return await getDocumentsById({ id });
      }
    );

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

    span.setAttributes({
      "document.title": document.title,
      "document.kind": document.kind,
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    return Response.json(documents, { status: 200 });
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
