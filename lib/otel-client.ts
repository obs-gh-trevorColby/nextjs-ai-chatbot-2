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
const serviceName = process.env.NEXT_PUBLIC_SERVICE_NAME || "ai-chatbot-client";

// Define regex patterns at top level for performance
const NEXT_JS_REGEX = /\/_next\//;
const AUTH_API_REGEX = /\/api\/auth\//;

// Use Observe.ai endpoint if available, otherwise default to localhost
const otlpEndpoint = process.env.NEXT_PUBLIC_OBSERVE_INGEST_TOKEN
  ? "https://collect.observeinc.com"
  : (process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://localhost:4318");

// Use Observe.ai token if available, otherwise use generic bearer token
const otlpEndpointBearerToken = process.env.NEXT_PUBLIC_OBSERVE_INGEST_TOKEN
  ? process.env.NEXT_PUBLIC_OBSERVE_INGEST_TOKEN
  : process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN;

const authHeader = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : {};

// Create resource with additional attributes for Observe.ai
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  ...(process.env.NEXT_PUBLIC_OBSERVE_CUSTOMER_ID && {
    "observe.customer_id": process.env.NEXT_PUBLIC_OBSERVE_CUSTOMER_ID,
  }),
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

// Export logger instance
export const logger = loggerProvider.getLogger(serviceName);

// Initialize OpenTelemetry and return initialized components
export function initOtel() {
  try {
    // Registering instrumentations / plugins
    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          ignoreUrls: [new RegExp(`.*${otlpEndpoint}.*`)],
          // Don't instrument internal Next.js requests
          ignoreUrls: [
            NEXT_JS_REGEX,
            AUTH_API_REGEX,
            new RegExp(`.*${otlpEndpoint}.*`),
          ],
        }),
        new XMLHttpRequestInstrumentation({
          ignoreUrls: [
            NEXT_JS_REGEX,
            AUTH_API_REGEX,
            new RegExp(`.*${otlpEndpoint}.*`),
          ],
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
      },
    });

    return { logger, provider };
  } catch (error) {
    logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Error starting OpenTelemetry Web SDK",
      attributes: { error: (error as Error).message },
    });
    throw error;
  }
}
