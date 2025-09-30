import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
} from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";
import {
  getUserAttributes,
  logApiRequest,
  logApiResponse,
  withSpan,
} from "@/lib/otel-utils";

export async function GET(request: Request) {
  const startTime = Date.now();

  return withSpan(
    "document.get",
    async (span) => {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      logApiRequest("GET", "/api/document", undefined, { documentId: id });

      if (!id) {
        const error = new ChatSDKError(
          "bad_request:api",
          "Parameter id is missing"
        );
        logApiResponse("GET", "/api/document", 400, Date.now() - startTime);
        return error.toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        const error = new ChatSDKError("unauthorized:document");
        logApiResponse("GET", "/api/document", 401, Date.now() - startTime);
        return error.toResponse();
      }

      const userAttributes = getUserAttributes(session);
      span.setAttributes({
        "document.id": id,
        ...userAttributes,
      });

      const documents = await getDocumentsById({ id });

      const [document] = documents;

      if (!document) {
        const error = new ChatSDKError("not_found:document");
        logApiResponse(
          "GET",
          "/api/document",
          404,
          Date.now() - startTime,
          session.user.id
        );
        return error.toResponse();
      }

      if (document.userId !== session.user.id) {
        const error = new ChatSDKError("forbidden:document");
        logApiResponse(
          "GET",
          "/api/document",
          403,
          Date.now() - startTime,
          session.user.id
        );
        return error.toResponse();
      }

      logApiResponse(
        "GET",
        "/api/document",
        200,
        Date.now() - startTime,
        session.user.id
      );
      return Response.json(documents, { status: 200 });
    },
    {
      "http.method": "GET",
      "http.route": "/api/document",
    }
  );
}

export async function POST(request: Request) {
  const startTime = Date.now();

  return withSpan(
    "document.post",
    async (span) => {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      logApiRequest("POST", "/api/document", undefined, { documentId: id });

      if (!id) {
        const error = new ChatSDKError(
          "bad_request:api",
          "Parameter id is required."
        );
        logApiResponse("POST", "/api/document", 400, Date.now() - startTime);
        return error.toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        const error = new ChatSDKError("not_found:document");
        logApiResponse("POST", "/api/document", 404, Date.now() - startTime);
        return error.toResponse();
      }

      const {
        content,
        title,
        kind,
      }: { content: string; title: string; kind: ArtifactKind } =
        await request.json();

      const userAttributes = getUserAttributes(session);
      span.setAttributes({
        "document.id": id,
        "document.kind": kind,
        "document.title": title,
        ...userAttributes,
      });

      const documents = await getDocumentsById({ id });

      if (documents.length > 0) {
        const [doc] = documents;

        if (doc.userId !== session.user.id) {
          const error = new ChatSDKError("forbidden:document");
          logApiResponse(
            "POST",
            "/api/document",
            403,
            Date.now() - startTime,
            session.user.id
          );
          return error.toResponse();
        }
      }

      const document = await saveDocument({
        id,
        content,
        title,
        kind,
        userId: session.user.id,
      });

      logApiResponse(
        "POST",
        "/api/document",
        200,
        Date.now() - startTime,
        session.user.id
      );
      return Response.json(document, { status: 200 });
    },
    {
      "http.method": "POST",
      "http.route": "/api/document",
    }
  );
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
