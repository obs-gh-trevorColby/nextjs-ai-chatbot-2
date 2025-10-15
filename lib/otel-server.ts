import { metrics, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

// Configuration
const serviceName = "ai-chatbot";
const serviceVersion = "3.1.0";

const otlpEndpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const otlpEndpointBearerToken = process.env.OTEL_EXPORTER_OTLP_BEARER_TOKEN;

const authHeader: Record<string, string> = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : {};

// Create resource
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: serviceVersion,
});

// Initialize OpenTelemetry SDK
export const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
    headers: {
      ...authHeader,
      "x-observe-target-package": "Tracing",
    },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
      headers: {
        ...authHeader,
        "x-observe-target-package": "Metrics",
        "Content-Type": "application/x-protobuf",
      },
    }),
    exportIntervalMillis: 10_000, // Export every 10 seconds
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable some instrumentations that might be noisy in development
      "@opentelemetry/instrumentation-fs": {
        enabled: process.env.NODE_ENV === "production",
      },
      "@opentelemetry/instrumentation-dns": {
        enabled: process.env.NODE_ENV === "production",
      },
    }),
  ],
});

// Initialize Logger Provider
const loggerProvider = new LoggerProvider({
  resource,
  processors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${otlpEndpoint}/v1/logs`,
        headers: {
          ...authHeader,
          "x-observe-target-package": "Logs",
        },
      }),
      {
        // Optimized for serverless/Next.js
        maxExportBatchSize: 100,
        exportTimeoutMillis: 2000,
        scheduledDelayMillis: 1000,
      }
    ),
  ],
});

// Export logger, tracer, and meter instances
export const logger = loggerProvider.getLogger(serviceName);
export const tracer = trace.getTracer(serviceName, serviceVersion);
export const meter = metrics.getMeter(serviceName, serviceVersion);

// Initialize OpenTelemetry and return initialized components
export function initOtel() {
  try {
    logs.setGlobalLoggerProvider(loggerProvider);
    sdk.start();

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "OpenTelemetry SDK started",
      attributes: {
        service: serviceName,
        version: serviceVersion,
        environment: process.env.NODE_ENV || "development",
      },
    });

    console.log("✅ OpenTelemetry initialized successfully");
  } catch (error) {
    console.error("❌ Error starting OpenTelemetry SDK:", error);
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error starting OpenTelemetry SDK",
      attributes: { error: (error as Error).message },
    });
    throw error;
  }
}

// Graceful shutdown
export function shutdownOtel(): void {
  try {
    sdk.shutdown();
    console.log("✅ OpenTelemetry SDK shutdown successfully");
  } catch (error) {
    console.error("❌ Error shutting down OpenTelemetry SDK:", error);
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error shutting down OpenTelemetry SDK",
      attributes: { error: (error as Error).message },
    });
    throw error;
  }
}

// Health check function
export function getOtelHealth() {
  return {
    service: serviceName,
    version: serviceVersion,
    endpoint: otlpEndpoint,
    initialized: true,
    timestamp: new Date().toISOString(),
  };
}
