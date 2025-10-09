import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { recordDbOperation, recordError } from "./metrics";

// Get tracer and logger instances
const tracer = trace.getTracer("ai-chatbot");
const logger = logs.getLogger("ai-chatbot");

/**
 * Wrapper function to instrument API route handlers with OpenTelemetry
 */
export function instrumentApiRoute<T extends any[], R>(
  operationName: string,
  handler: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    return tracer.startActiveSpan(operationName, async (span) => {
      try {
        // Add basic attributes
        span.setAttributes({
          "http.method": operationName.includes("POST")
            ? "POST"
            : operationName.includes("DELETE")
              ? "DELETE"
              : operationName.includes("PUT")
                ? "PUT"
                : "GET",
          "service.name": "ai-chatbot",
        });

        const result = await handler(...args);

        span.setStatus({ code: SpanStatusCode.OK });

        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: `${operationName} completed successfully`,
          attributes: {
            operation: operationName,
          },
        });

        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });

        span.recordException(error as Error);

        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: `${operationName} failed`,
          attributes: {
            operation: operationName,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });

        throw error;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Instrument database operations
 */
export function instrumentDbOperation<T extends any[], R>(
  operationName: string,
  operation: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    const startTime = Date.now();
    return tracer.startActiveSpan(`db.${operationName}`, async (span) => {
      try {
        span.setAttributes({
          "db.operation": operationName,
          "db.system": "postgresql", // Assuming PostgreSQL based on the imports
        });

        const result = await operation(...args);
        const duration = Date.now() - startTime;

        span.setStatus({ code: SpanStatusCode.OK });
        recordDbOperation(operationName, duration, "success");

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);

        recordDbOperation(operationName, duration, "error");
        recordError("database", operationName);

        throw error;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Create a custom span for any operation
 */
export function createSpan<T>(
  operationName: string,
  operation: (span: any) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return tracer.startActiveSpan(operationName, async (span) => {
    try {
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
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Log with trace correlation
 */
export function logWithTrace(
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  attributes?: Record<string, any>
) {
  const severityNumber =
    level === "INFO"
      ? SeverityNumber.INFO
      : level === "WARN"
        ? SeverityNumber.WARN
        : SeverityNumber.ERROR;

  logger.emit({
    severityNumber,
    severityText: level,
    body: message,
    attributes: attributes || {},
  });
}
