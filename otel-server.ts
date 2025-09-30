import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { trace, metrics } from "@opentelemetry/api";
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
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Configuration using provided environment variables
const serviceName = process.env.SERVICE_NAME || "ai-chatbot";
const observeCustomerId = process.env.OBSERVE_CUSTOMER_ID;
const observeIngestToken = process.env.OBSERVE_INGEST_TOKEN;

// Construct the OTLP endpoint using Observe credentials
const otlpEndpoint =
  observeCustomerId && observeIngestToken
    ? `https://${observeCustomerId}.collect.observeinc.com`
    : (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318");

// Use the Observe ingest token for authentication
const otlpEndpointBearerToken =
  observeIngestToken || process.env.OTEL_EXPORTER_OTLP_BEARER_TOKEN;

const authHeader: Record<string, string> = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : {};

// Create resource with service information
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  "service.version": "1.0.0",
  "deployment.environment": process.env.NODE_ENV || "development",
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
    exportIntervalMillis: 30_000, // Export metrics every 30 seconds
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable some instrumentations that might be noisy in development
      "@opentelemetry/instrumentation-fs": {
        enabled: false,
      },
      "@opentelemetry/instrumentation-dns": {
        enabled: false,
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
        // Optimize batch processing for better performance
        maxExportBatchSize: 100,
        exportTimeoutMillis: 5000,
        scheduledDelayMillis: 2000,
      }
    ),
  ],
});

// Export logger, tracer, and meter for use in application code
export const logger = logs.getLogger(serviceName);
export const tracer = trace.getTracer(serviceName);
export const meter = metrics.getMeter(serviceName);

// Initialize OpenTelemetry and return initialized components
export function initOtel() {
  try {
    logs.setGlobalLoggerProvider(loggerProvider);
    sdk.start();

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "OpenTelemetry SDK started successfully",
      attributes: {
        service: serviceName,
        endpoint: otlpEndpoint,
        environment: process.env.NODE_ENV || "development",
      },
    });

    console.log(`OpenTelemetry initialized for service: ${serviceName}`);
    console.log(`Exporting to: ${otlpEndpoint}`);
  } catch (error) {
    console.error("Error starting OpenTelemetry SDK:", error);
    const fallbackLogger = logs.getLogger(serviceName);
    fallbackLogger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error starting OpenTelemetry SDK",
      attributes: { error: (error as Error).message },
    });
    throw error;
  }
}

// Graceful shutdown
export function shutdownOtel(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Shutting down OpenTelemetry SDK",
      });

      sdk
        .shutdown()
        .then(() => {
          console.log("OpenTelemetry SDK shut down successfully");
          resolve();
        })
        .catch((error) => {
          console.error("Error shutting down OpenTelemetry SDK:", error);
          reject(error);
        });
    } catch (error) {
      console.error("Error during OpenTelemetry shutdown:", error);
      reject(error);
    }
  });
}
