import { metrics } from "@opentelemetry/api";
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
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Regex patterns for ignoring URLs (defined at top level for performance)
const NEXT_JS_INTERNAL_REGEX = /\/_next\//;
const AUTH_API_REGEX = /\/api\/auth\//;
const FAVICON_REGEX = /\/favicon\.ico/;

// Configuration for client-side telemetry
const serviceName = "ai-chatbot-client";

// Client-side environment variables (Next.js requires NEXT_PUBLIC_ prefix)
// For now, we'll use the same Observe endpoint as the server
// In production, you might want to use different endpoints for client vs server telemetry
const observeCustomerId = "191369360817";
const observeIngestToken =
  "ds1wLHgaUFAIXWxeyiBP:1zqn86Tx4mkph-xBAiheNjnpcGhuNqtt";

const otlpEndpoint =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
  (typeof window !== "undefined" &&
    (window as any).__NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT) ??
  `https://${observeCustomerId}.collect.observeinc.com`;

const otlpEndpointBearerToken =
  process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN ??
  (typeof window !== "undefined" &&
    (window as any).__NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN) ??
  observeIngestToken;

const authHeader: Record<string, string> = otlpEndpointBearerToken
  ? { Authorization: `Bearer ${otlpEndpointBearerToken}` }
  : {};

// Create resource for client-side telemetry
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  "service.version": "1.0.0",
  "deployment.environment": process.env.NODE_ENV || "development",
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.language": "webjs",
});

// Initialize Web Tracer Provider
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

// Initialize Meter Provider for client-side metrics
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
      exportIntervalMillis: 60_000, // Export metrics every 60 seconds for client
    }),
  ],
});

// Initialize Logger Provider for client-side logging
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
        // Client-side optimized batch processing
        maxExportBatchSize: 50,
        exportTimeoutMillis: 3000,
        scheduledDelayMillis: 5000,
      }
    ),
  ],
});

// Export logger, tracer, and meter for use in client code
export const logger = logs.getLogger(serviceName);
export const tracer = provider.getTracer(serviceName);
export const meter = meterProvider.getMeter(serviceName);

// Initialize OpenTelemetry for client-side
export function initOtel() {
  // Only initialize in browser environment
  if (typeof window === "undefined") {
    console.warn(
      "Client-side OpenTelemetry should only be initialized in browser"
    );
    return;
  }

  try {
    // Register instrumentations for browser APIs
    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          // Ignore requests to the OTLP endpoint and internal Next.js requests
          ignoreUrls: [
            new RegExp(
              `.*${otlpEndpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`
            ),
            NEXT_JS_INTERNAL_REGEX,
            AUTH_API_REGEX,
            FAVICON_REGEX,
          ],
          // Add useful attributes to fetch spans
          requestHook: (span, request) => {
            span.setAttributes({
              "http.request.method": request.method || "GET",
              "http.url": (request as Request).url || "unknown",
            });
          },
        }),
        new XMLHttpRequestInstrumentation({
          // Ignore requests to the OTLP endpoint
          ignoreUrls: [
            new RegExp(
              `.*${otlpEndpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`
            ),
          ],
        }),
      ],
    });

    // Set global providers
    logs.setGlobalLoggerProvider(loggerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
    provider.register({});

    // Log successful initialization
    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "OpenTelemetry Web SDK started successfully",
      attributes: {
        service: serviceName,
        endpoint: otlpEndpoint,
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
    });

    console.log(
      `Client-side OpenTelemetry initialized for service: ${serviceName}`
    );
    console.log(`Exporting to: ${otlpEndpoint}`);
  } catch (error) {
    console.error("Error starting client-side OpenTelemetry SDK:", error);

    // Try to log the error even if initialization failed
    try {
      const fallbackLogger = logs.getLogger(serviceName);
      fallbackLogger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Error starting client-side OpenTelemetry SDK",
        attributes: {
          error: (error as Error).message,
          stack: (error as Error).stack,
        },
      });
    } catch (logError) {
      console.error(
        "Failed to log OpenTelemetry initialization error:",
        logError
      );
    }

    throw error;
  }
}

// Client-side shutdown (useful for SPA navigation)
export function shutdownOtel(): Promise<void> {
  return new Promise((resolve) => {
    try {
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Shutting down client-side OpenTelemetry SDK",
      });

      // Force flush any pending telemetry
      Promise.all([
        provider.forceFlush(),
        meterProvider.forceFlush(),
        loggerProvider.forceFlush(),
      ])
        .then(() => {
          console.log("Client-side OpenTelemetry SDK shut down successfully");
          resolve();
        })
        .catch((error) => {
          console.error(
            "Error during client-side OpenTelemetry shutdown:",
            error
          );
          resolve(); // Don't reject to avoid blocking app shutdown
        });
    } catch (error) {
      console.error("Error during client-side OpenTelemetry shutdown:", error);
      resolve(); // Don't reject to avoid blocking app shutdown
    }
  });
}
