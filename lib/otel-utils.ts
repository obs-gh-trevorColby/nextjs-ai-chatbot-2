import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { logger } from "../otel-server";

// Get tracer instance
export const tracer = trace.getTracer("ai-chatbot");

// Helper function to create and manage spans for API routes
export async function withSpan<T>(
  name: string,
  operation: (span: any) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      // Set span in context
      trace.setSpan(context.active(), span);

      // Add attributes if provided
      if (attributes) {
        span.setAttributes(attributes);
      }

      const result = await operation(span);

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      span.recordException(error as Error);

      // Log the error
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: `Error in ${name}`,
        attributes: {
          error: error instanceof Error ? error.message : "Unknown error",
          spanName: name,
          ...attributes,
        },
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

// Helper function to log API requests
export function logApiRequest(
  method: string,
  path: string,
  userId?: string,
  additionalAttributes?: Record<string, any>
) {
  logger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: `API request: ${method} ${path}`,
    attributes: {
      method,
      path,
      userId,
      ...additionalAttributes,
    },
  });
}

// Helper function to log API responses
export function logApiResponse(
  method: string,
  path: string,
  statusCode: number,
  duration?: number,
  userId?: string,
  additionalAttributes?: Record<string, any>
) {
  const severity =
    statusCode >= 400 ? SeverityNumber.WARN : SeverityNumber.INFO;

  logger.emit({
    severityNumber: severity,
    severityText: severity === SeverityNumber.WARN ? "WARN" : "INFO",
    body: `API response: ${method} ${path} - ${statusCode}`,
    attributes: {
      method,
      path,
      statusCode,
      duration,
      userId,
      ...additionalAttributes,
    },
  });
}

// Helper function to extract user info from session
export function getUserAttributes(session: any) {
  if (!session?.user) return {};

  return {
    userId: session.user.id,
    userEmail: session.user.email,
    userType: session.user.type,
  };
}
