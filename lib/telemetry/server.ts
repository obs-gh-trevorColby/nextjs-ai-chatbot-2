import { trace, context, SpanStatusCode, SpanKind, logs } from "@opentelemetry/api";
import { ATTR_HTTP_REQUEST_METHOD, ATTR_HTTP_RESPONSE_STATUS_CODE, ATTR_HTTP_ROUTE } from "@opentelemetry/semantic-conventions";

// Service information
const serviceName = "ai-chatbot-server";
const serviceVersion = process.env.npm_package_version || "1.0.0";

// Get tracer instance
const tracer = trace.getTracer(serviceName, serviceVersion);

// Get logger instance
const logger = logs.getLogger(serviceName, serviceVersion);

/**
 * Creates a span for API route handlers
 */
export function createAPISpan(
  name: string,
  request: Request,
  attributes?: Record<string, string | number | boolean>
) {
  const url = new URL(request.url);
  
  return tracer.startSpan(name, {
    kind: SpanKind.SERVER,
    attributes: {
      [ATTR_HTTP_REQUEST_METHOD]: request.method,
      [ATTR_HTTP_ROUTE]: url.pathname,
      "http.url": request.url,
      "http.scheme": url.protocol.replace(":", ""),
      "http.host": url.host,
      "http.target": url.pathname + url.search,
      "user_agent.original": request.headers.get("user-agent") || "",
      "service.name": serviceName,
      ...attributes,
    },
  });
}

/**
 * Creates a span for database operations
 */
export function createDatabaseSpan(
  operation: string,
  table?: string,
  attributes?: Record<string, string | number | boolean>
) {
  return tracer.startSpan(`db.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "db.system": "postgresql",
      "db.operation": operation,
      "db.sql.table": table,
      "service.name": serviceName,
      ...attributes,
    },
  });
}

/**
 * Creates a span for AI/LLM operations
 */
export function createAISpan(
  operation: string,
  model?: string,
  attributes?: Record<string, string | number | boolean>
) {
  return tracer.startSpan(`ai.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "ai.system": "openai",
      "ai.operation": operation,
      "ai.model.name": model,
      "service.name": serviceName,
      ...attributes,
    },
  });
}

/**
 * Creates a span for external service calls
 */
export function createExternalSpan(
  serviceName: string,
  operation: string,
  attributes?: Record<string, string | number | boolean>
) {
  return tracer.startSpan(`external.${serviceName}.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "service.name": serviceName,
      "external.service": serviceName,
      "external.operation": operation,
      ...attributes,
    },
  });
}

/**
 * Wrapper function to trace async operations
 */
export async function traceAsyncOperation<T>(
  spanName: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const span = tracer.startSpan(spanName, {
    attributes: {
      "service.name": serviceName,
      ...attributes,
    },
  });

  try {
    const result = await context.with(trace.setSpan(context.active(), span), operation);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Wrapper function to trace sync operations
 */
export function traceSyncOperation<T>(
  spanName: string,
  operation: () => T,
  attributes?: Record<string, string | number | boolean>
): T {
  const span = tracer.startSpan(spanName, {
    attributes: {
      "service.name": serviceName,
      ...attributes,
    },
  });

  try {
    const result = context.with(trace.setSpan(context.active(), span), operation);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Logs structured events
 */
export function logEvent(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  attributes?: Record<string, any>
) {
  logger.emit({
    severityText: level.toUpperCase(),
    body: message,
    attributes: {
      "service.name": serviceName,
      timestamp: Date.now(),
      ...attributes,
    },
  });
}

/**
 * Logs errors with context
 */
export function logError(error: Error, context?: Record<string, any>) {
  logger.emit({
    severityText: "ERROR",
    body: error.message,
    attributes: {
      "service.name": serviceName,
      "error.name": error.name,
      "error.message": error.message,
      "error.stack": error.stack,
      timestamp: Date.now(),
      ...context,
    },
  });
}

/**
 * Adds attributes to the current active span
 */
export function addSpanAttributes(attributes: Record<string, string | number | boolean>) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Records an exception in the current active span
 */
export function recordException(error: Error) {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

/**
 * Sets the status of the current active span
 */
export function setSpanStatus(code: SpanStatusCode, message?: string) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setStatus({ code, message });
  }
}

/**
 * Wrapper for API route handlers with automatic tracing
 */
export function withTelemetry<T extends any[], R>(
  handler: (...args: T) => Promise<R>,
  spanName?: string
) {
  return async (...args: T): Promise<R> => {
    const request = args[0] as Request;
    const name = spanName || `${request.method} ${new URL(request.url).pathname}`;
    
    return traceAsyncOperation(
      name,
      () => handler(...args),
      {
        [ATTR_HTTP_REQUEST_METHOD]: request.method,
        [ATTR_HTTP_ROUTE]: new URL(request.url).pathname,
      }
    );
  };
}
