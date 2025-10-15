import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";

// Import OpenTelemetry components - use dynamic import to avoid issues during build
let globalLogger: any;
let globalTracer: any;
let globalMeter: any;

async function getOtelComponents() {
  if (!globalLogger || !globalTracer || !globalMeter) {
    try {
      const otel = await import("@/otel-server");
      globalLogger = otel.logger;
      globalTracer = otel.tracer;
      globalMeter = otel.meter;
    } catch (error) {
      console.warn("OpenTelemetry components not available:", error);
    }
  }
  return { logger: globalLogger, tracer: globalTracer, meter: globalMeter };
}

/**
 * Utility function to instrument database operations
 */
export async function instrumentDatabaseOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const { logger, tracer } = await getOtelComponents();

  if (!tracer) {
    return operation();
  }

  return tracer.startActiveSpan(`db.${operationName}`, async (span: any) => {
    const startTime = Date.now();

    try {
      span?.setAttributes({
        "db.operation": operationName,
        ...attributes,
      });

      logger?.emit({
        severityNumber: SeverityNumber.DEBUG,
        severityText: "DEBUG",
        body: `Database operation started: ${operationName}`,
        attributes: { operation: operationName, ...attributes },
      });

      const result = await operation();
      const duration = Date.now() - startTime;

      span?.setAttributes({
        "db.duration_ms": duration,
      });

      logger?.emit({
        severityNumber: SeverityNumber.DEBUG,
        severityText: "DEBUG",
        body: `Database operation completed: ${operationName}`,
        attributes: {
          operation: operationName,
          duration_ms: duration,
          ...attributes,
        },
      });

      span?.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span?.recordException(error as Error);

      logger?.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: `Database operation failed: ${operationName}`,
        attributes: {
          operation: operationName,
          error: (error as Error).message,
          duration_ms: duration,
          ...attributes,
        },
      });

      throw error;
    } finally {
      span?.end();
    }
  });
}

/**
 * Utility function to instrument AI/LLM operations
 */
export async function instrumentAIOperation<T>(
  operationName: string,
  operation: () => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const { logger, tracer, meter } = await getOtelComponents();

  if (!tracer) {
    return operation();
  }

  return tracer.startActiveSpan(`ai.${operationName}`, async (span: any) => {
    const startTime = Date.now();

    try {
      span?.setAttributes({
        "ai.operation": operationName,
        ...attributes,
      });

      logger?.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: `AI operation started: ${operationName}`,
        attributes: { operation: operationName, ...attributes },
      });

      const result = await operation();
      const duration = Date.now() - startTime;

      // Record AI operation metrics
      const aiOperationCounter = meter?.createCounter("ai_operations_total", {
        description: "Total number of AI operations",
      });
      const aiOperationDuration = meter?.createHistogram(
        "ai_operation_duration_ms",
        {
          description: "Duration of AI operations in milliseconds",
        }
      );

      aiOperationCounter?.add(1, {
        operation: operationName,
        status: "success",
      });
      aiOperationDuration?.record(duration, { operation: operationName });

      span?.setAttributes({
        "ai.duration_ms": duration,
      });

      logger?.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: `AI operation completed: ${operationName}`,
        attributes: {
          operation: operationName,
          duration_ms: duration,
          ...attributes,
        },
      });

      span?.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record error metrics
      const aiOperationCounter = meter?.createCounter("ai_operations_total", {
        description: "Total number of AI operations",
      });
      aiOperationCounter?.add(1, { operation: operationName, status: "error" });

      span?.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span?.recordException(error as Error);

      logger?.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: `AI operation failed: ${operationName}`,
        attributes: {
          operation: operationName,
          error: (error as Error).message,
          duration_ms: duration,
          ...attributes,
        },
      });

      throw error;
    } finally {
      span?.end();
    }
  });
}

/**
 * Utility function to log structured events
 */
export async function logEvent(
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string,
  attributes?: Record<string, any>
) {
  const { logger } = await getOtelComponents();

  if (!logger) {
    console.log(`[${level}] ${message}`, attributes);
    return;
  }

  const severityMap = {
    DEBUG: SeverityNumber.DEBUG,
    INFO: SeverityNumber.INFO,
    WARN: SeverityNumber.WARN,
    ERROR: SeverityNumber.ERROR,
  };

  logger.emit({
    severityNumber: severityMap[level],
    severityText: level,
    body: message,
    attributes: attributes || {},
  });
}

/**
 * Utility function to record custom metrics
 */
export async function recordMetric(
  name: string,
  value: number,
  type: "counter" | "histogram" | "gauge" = "counter",
  attributes?: Record<string, any>
) {
  const { meter } = await getOtelComponents();

  if (!meter) {
    console.log(`[METRIC] ${name}: ${value}`, attributes);
    return;
  }

  switch (type) {
    case "counter": {
      const counter = meter.createCounter(name);
      counter.add(value, attributes);
      break;
    }
    case "histogram": {
      const histogram = meter.createHistogram(name);
      histogram.record(value, attributes);
      break;
    }
    case "gauge": {
      const gauge = meter.createGauge(name);
      gauge.record(value, attributes);
      break;
    }
    default: {
      console.warn(`Unknown metric type: ${type}`);
      break;
    }
  }
}
