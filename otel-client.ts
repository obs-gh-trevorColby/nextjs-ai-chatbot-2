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
const serviceName = "instrumentation_test_trevor-client";

// Client side environment variables for Next.js
const otlpEndpoint = "https://collect.observeinc.com";
const otlpEndpointBearerToken = process.env.NEXT_PUBLIC_OBSERVE_INGEST_TOKEN;

const authHeader = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : null;

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

// Initialize OpenTelemetry and return initialized components
export function initOtel() {
  try {
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

    const logger = logs.getLogger(serviceName);
    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "OpenTelemetry Web SDK started",
      attributes: {
        service: serviceName,
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
    });
  } catch (error) {
    const logger = logs.getLogger(serviceName);
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error starting OpenTelemetry SDK",
      attributes: { error: (error as Error).message },
    });
    throw error;
  }
}
