import { tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  artifactKinds,
  documentHandlersByArtifactKind,
} from "@/lib/artifacts/server";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { createAIInstrumentationLogger } from "../../observability/ai-instrumentation";

type CreateDocumentProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const createDocument = ({ session, dataStream }: CreateDocumentProps) =>
  tool({
    description:
      "Create a document for a writing or content creation activities. This tool will call other functions that will generate the contents of the document based on the title and kind.",
    inputSchema: z.object({
      title: z.string(),
      kind: z.enum(artifactKinds),
    }),
    execute: async ({ title, kind }) => {
      const id = generateUUID();
      const logger = createAIInstrumentationLogger('artifact-model', 'document-creation');

      logger.logOperationStart('document-creation', {
        userId: session.user?.id,
        documentId: id,
        title,
        kind,
        tool: 'create-document'
      });

      dataStream.write({
        type: "data-kind",
        data: kind,
        transient: true,
      });

      dataStream.write({
        type: "data-id",
        data: id,
        transient: true,
      });

      dataStream.write({
        type: "data-title",
        data: title,
        transient: true,
      });

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === kind
      );

      if (!documentHandler) {
        const error = new Error(`No document handler found for kind: ${kind}`);
        logger.logOperationError('document-creation', id, {
          userId: session.user?.id,
          documentId: id,
          title,
          kind
        }, error);
        throw error;
      }

      try {
        await documentHandler.onCreateDocument({
          id,
          title,
          dataStream,
          session,
        });

        dataStream.write({ type: "data-finish", data: null, transient: true });

        const result = {
          id,
          title,
          kind,
          content: "A document was created and is now visible to the user.",
        };

        logger.logOperationComplete('document-creation', id, {
          userId: session.user?.id,
          documentId: id,
          title,
          kind,
          tool: 'create-document'
        }, {
          responseLength: result.content.length
        }, result.content);

        return result;
      } catch (error) {
        logger.logOperationError('document-creation', id, {
          userId: session.user?.id,
          documentId: id,
          title,
          kind
        }, error as Error);
        throw error;
      }
    },
  });
