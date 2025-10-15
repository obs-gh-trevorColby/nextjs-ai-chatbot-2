import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { logger, meter, tracer } from "./otel-server";

// Metrics
const requestCounter = meter.createCounter("http_requests_total", {
  description: "Total number of HTTP requests",
});

const requestDuration = meter.createHistogram("http_request_duration_ms", {
  description: "Duration of HTTP requests in milliseconds",
});

const chatMessageCounter = meter.createCounter("chat_messages_total", {
  description: "Total number of chat messages processed",
});

const databaseOperationCounter = meter.createCounter(
  "database_operations_total",
  {
    description: "Total number of database operations",
  }
);

const databaseOperationDuration = meter.createHistogram(
  "database_operation_duration_ms",
  {
    description: "Duration of database operations in milliseconds",
  }
);

const errorCounter = meter.createCounter("errors_total", {
  description: "Total number of errors",
});

// Logging utilities
export const observabilityLogger = {
  info: (message: string, attributes?: Record<string, any>) => {
    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: message,
      attributes: {
        timestamp: new Date().toISOString(),
        ...attributes,
      },
    });
  },

  warn: (message: string, attributes?: Record<string, any>) => {
    logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      body: message,
      attributes: {
        timestamp: new Date().toISOString(),
        ...attributes,
      },
    });
  },

  error: (message: string, error?: Error, attributes?: Record<string, any>) => {
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: message,
      attributes: {
        timestamp: new Date().toISOString(),
        error: error?.message,
        stack: error?.stack,
        ...attributes,
      },
    });

    // Increment error counter
    errorCounter.add(1, {
      error_type: error?.name || "unknown",
      ...attributes,
    });
  },

  debug: (message: string, attributes?: Record<string, any>) => {
    if (process.env.NODE_ENV === "development") {
      logger.emit({
        severityNumber: SeverityNumber.DEBUG,
        severityText: "DEBUG",
        body: message,
        attributes: {
          timestamp: new Date().toISOString(),
          ...attributes,
        },
      });
    }
  },
};

// Tracing utilities
export function createSpan<T>(
  name: string,
  fn: (span: any) => Promise<T> | T,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, any>;
  }
): Promise<T> {
  return tracer.startActiveSpan(name, { kind: options?.kind }, async (span) => {
    try {
      if (options?.attributes) {
        span.setAttributes(options.attributes);
      }

      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// HTTP request instrumentation
export function instrumentHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  attributes?: Record<string, any>
) {
  const labels = {
    method,
    path,
    status_code: statusCode.toString(),
    ...attributes,
  };

  requestCounter.add(1, labels);
  requestDuration.record(duration, labels);

  observabilityLogger.info("HTTP request completed", {
    method,
    path,
    statusCode,
    duration,
    ...attributes,
  });
}

// Chat message instrumentation
export function instrumentChatMessage(
  messageType: "user" | "assistant",
  chatId: string,
  messageLength: number,
  attributes?: Record<string, any>
) {
  const labels = {
    message_type: messageType,
    chat_id: chatId,
    ...attributes,
  };

  chatMessageCounter.add(1, labels);

  observabilityLogger.info("Chat message processed", {
    messageType,
    chatId,
    messageLength,
    ...attributes,
  });
}

// Database operation instrumentation
export function instrumentDatabaseOperation<T>(
  operation: string,
  table: string,
  fn: () => Promise<T> | T
): Promise<T> {
  return createSpan(
    `db.${operation}`,
    async (span) => {
      const startTime = Date.now();

      try {
        span.setAttributes({
          "db.operation": operation,
          "db.table": table,
          "db.system": "postgresql",
        });

        const result = await fn();
        const duration = Date.now() - startTime;

        databaseOperationCounter.add(1, {
          operation,
          table,
          status: "success",
        });

        databaseOperationDuration.record(duration, {
          operation,
          table,
        });

        observabilityLogger.debug("Database operation completed", {
          operation,
          table,
          duration,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        databaseOperationCounter.add(1, {
          operation,
          table,
          status: "error",
        });

        databaseOperationDuration.record(duration, {
          operation,
          table,
        });

        observabilityLogger.error("Database operation failed", error as Error, {
          operation,
          table,
          duration,
        });

        throw error;
      }
    },
    { kind: SpanKind.CLIENT }
  );
}

// AI operation instrumentation
export function instrumentAIOperation<T>(
  operation: string,
  model: string,
  fn: () => Promise<T> | T,
  attributes?: Record<string, any>
): Promise<T> {
  return createSpan(
    `ai.${operation}`,
    async (span) => {
      const startTime = Date.now();

      try {
        span.setAttributes({
          "ai.operation": operation,
          "ai.model": model,
          ...attributes,
        });

        const result = await fn();
        const duration = Date.now() - startTime;

        observabilityLogger.info("AI operation completed", {
          operation,
          model,
          duration,
          ...attributes,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        observabilityLogger.error("AI operation failed", error as Error, {
          operation,
          model,
          duration,
          ...attributes,
        });

        throw error;
      }
    },
    { kind: SpanKind.CLIENT }
  );
}

// Performance monitoring
export function measurePerformance<T>(
  name: string,
  fn: () => Promise<T> | T,
  attributes?: Record<string, any>
): Promise<T> {
  return createSpan(`performance.${name}`, fn, { attributes });
}

// Error tracking
export function trackError(error: Error, context?: Record<string, any>) {
  observabilityLogger.error("Unhandled error", error, context);

  // You can also send to external error tracking services here
  // e.g., Sentry, Bugsnag, etc.
}
