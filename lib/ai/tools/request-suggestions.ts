import { SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { streamObject, tool, type UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { z } from "zod";
import { getDocumentById, saveSuggestions } from "@/lib/db/queries";
import type { Suggestion } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import { logger } from "@/otel-server";
import { myProvider } from "../providers";

type RequestSuggestionsProps = {
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
};

export const requestSuggestions = ({
  session,
  dataStream,
}: RequestSuggestionsProps) =>
  tool({
    description: "Request suggestions for a document",
    inputSchema: z.object({
      documentId: z
        .string()
        .describe("The ID of the document to request edits"),
    }),
    execute: async ({ documentId }) => {
      const tracer = trace.getTracer("ai-tools");

      return tracer.startActiveSpan(
        "tool.request_suggestions",
        async (span) => {
          const startTime = Date.now();

          try {
            span.setAttributes({
              "tool.name": "request_suggestions",
              "document.id": documentId,
            });

            logger.emit({
              severityNumber: SeverityNumber.INFO,
              severityText: "INFO",
              body: "Request suggestions tool execution started",
              attributes: {
                "tool.name": "request_suggestions",
                "document.id": documentId,
              },
            });

            const document = await getDocumentById({ id: documentId });

            if (!document || !document.content) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: "Document not found",
              });
              logger.emit({
                severityNumber: SeverityNumber.WARN,
                severityText: "WARN",
                body: "Document not found for suggestions",
                attributes: {
                  "tool.name": "request_suggestions",
                  "document.id": documentId,
                },
              });
              return {
                error: "Document not found",
              };
            }

            span.setAttributes({
              "document.title": document.title,
              "document.kind": document.kind,
              "document.content_length": document.content.length,
            });

            const suggestions: Omit<
              Suggestion,
              "userId" | "createdAt" | "documentCreatedAt"
            >[] = [];

            const { elementStream } = streamObject({
              model: myProvider.languageModel("artifact-model"),
              system:
                "You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words. Max 5 suggestions.",
              prompt: document.content,
              output: "array",
              schema: z.object({
                originalSentence: z.string().describe("The original sentence"),
                suggestedSentence: z
                  .string()
                  .describe("The suggested sentence"),
                description: z
                  .string()
                  .describe("The description of the suggestion"),
              }),
            });

            for await (const element of elementStream) {
              // @ts-expect-error todo: fix type
              const suggestion: Suggestion = {
                originalText: element.originalSentence,
                suggestedText: element.suggestedSentence,
                description: element.description,
                id: generateUUID(),
                documentId,
                isResolved: false,
              };

              dataStream.write({
                type: "data-suggestion",
                data: suggestion,
                transient: true,
              });

              suggestions.push(suggestion);
            }

            if (session.user?.id) {
              const userId = session.user.id;

              await saveSuggestions({
                suggestions: suggestions.map((suggestion) => ({
                  ...suggestion,
                  userId,
                  createdAt: new Date(),
                  documentCreatedAt: document.createdAt,
                })),
              });
            }

            const duration = Date.now() - startTime;
            span.setAttributes({
              "tool.duration_ms": duration,
              "suggestions.count": suggestions.length,
            });
            span.setStatus({ code: SpanStatusCode.OK });

            logger.emit({
              severityNumber: SeverityNumber.INFO,
              severityText: "INFO",
              body: "Request suggestions tool execution completed",
              attributes: {
                "tool.name": "request_suggestions",
                "document.id": documentId,
                "tool.duration_ms": duration,
                "suggestions.count": suggestions.length,
              },
            });

            return {
              id: documentId,
              title: document.title,
              kind: document.kind,
              message: "Suggestions have been added to the document",
            };
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
              body: "Request suggestions tool execution failed",
              attributes: {
                "tool.name": "request_suggestions",
                "document.id": documentId,
                "tool.duration_ms": duration,
                "error.message": (error as Error).message,
              },
            });

            throw error;
          } finally {
            span.end();
          }
        }
      );
    },
  });
