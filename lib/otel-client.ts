import { metrics, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  SimpleSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

// Configuration
const serviceName = "ai-chatbot-client";
const serviceVersion = "3.1.0";

// Client side environment variables for Next.js
const otlpEndpoint =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  "http://localhost:4318";
const otlpEndpointBearerToken =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN;

const authHeader: Record<string, string> = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : {};

// Create resource
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: serviceVersion,
});

const provider = new WebTracerProvider({
  resource,
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: `${otlpEndpoint}/v1/traces`,
        headers: {
          ...authHeader,
          "x-observe-target-package": "Tracing",
        },
      })
    ),
  ],
});

// Initialize Meter Provider
const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${otlpEndpoint}/v1/metrics`,
        headers: {
          ...authHeader,
          "x-observe-target-package": "Metrics",
          "Content-Type": "application/x-protobuf",
        },
      }),
      exportIntervalMillis: 15_000, // Export every 15 seconds for client
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
        // Optimized for client-side
        maxExportBatchSize: 50,
        exportTimeoutMillis: 3000,
        scheduledDelayMillis: 2000,
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
    // Only initialize in browser environment
    if (typeof window === "undefined") {
      return;
    }

    // Registering instrumentations / plugins
    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          ignoreUrls: [
            // Ignore internal Next.js requests
            /.*\/_next\/.*/,
            // Ignore hot reload requests in development
            /.*\/__nextjs_original-stack-frame.*/,
            // Ignore the OTEL endpoint to prevent loops
            new RegExp(`.*${otlpEndpoint}.*`),
          ],
          propagateTraceHeaderCorsUrls: [
            // Allow trace headers for same-origin requests
            new RegExp(`${window.location.origin}/.*`),
          ],
        }),
        new XMLHttpRequestInstrumentation({
          ignoreUrls: [
            /.*\/_next\/.*/,
            /.*\/__nextjs_original-stack-frame.*/,
            new RegExp(`.*${otlpEndpoint}.*`),
          ],
        }),
      ],
    });

    logs.setGlobalLoggerProvider(loggerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
    provider.register({});

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "OpenTelemetry Web SDK started",
      attributes: {
        service: serviceName,
        version: serviceVersion,
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
    });

    console.log("✅ OpenTelemetry Web SDK initialized successfully");
  } catch (error) {
    console.error("❌ Error starting OpenTelemetry Web SDK:", error);
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error starting OpenTelemetry Web SDK",
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
    initialized: typeof window !== "undefined",
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== "undefined" ? navigator.userAgent : "server",
  };
}
