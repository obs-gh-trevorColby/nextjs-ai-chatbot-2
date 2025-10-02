import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
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
  SimpleSpanProcessor,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Configuration
const serviceName = "ai-chatbot-client";

// Client side environment variables for Next.js
const observeCustomerId = process.env.NEXT_PUBLIC_OBSERVE_CUSTOMER_ID;
const observeIngestToken = process.env.NEXT_PUBLIC_OBSERVE_INGEST_TOKEN;

// Default to Observe platform endpoint if available, otherwise localhost
const otlpEndpoint = observeCustomerId
  ? `https://${observeCustomerId}.collect.observeinc.com`
  : (process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://localhost:4318");

const otlpEndpointBearerToken =
  observeIngestToken || process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN;

const authHeader: Record<string, string> = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : {};

// Create resource
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
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
      })
    ),
  ],
});

// Export logger for manual instrumentation
export const logger = loggerProvider.getLogger(serviceName);

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
          ignoreUrls: [new RegExp(`.*${otlpEndpoint}.*`)],
        }),
        new XMLHttpRequestInstrumentation({
          ignoreUrls: [new RegExp(`.*${otlpEndpoint}.*`)],
        }),
      ],
    });

    logs.setGlobalLoggerProvider(loggerProvider);
    provider.register({});

    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "OpenTelemetry Web SDK started",
      attributes: {
        service: serviceName,
        endpoint: otlpEndpoint,
        userAgent: navigator.userAgent,
      },
    });

    console.log(
      `OpenTelemetry Web SDK initialized for service: ${serviceName}`
    );
  } catch (error) {
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error starting OpenTelemetry SDK",
      attributes: { error: (error as Error).message },
    });
    console.error("Failed to initialize OpenTelemetry Web SDK:", error);
    throw error;
  }
}
