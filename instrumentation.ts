import { registerOTel } from "@vercel/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  telemetryConfig,
  resourceAttributes,
  isVercelDeployment,
  isProduction,
  isTelemetryEnabled
} from "@/lib/telemetry/config";

// Create resource with service information
const resource = new Resource(resourceAttributes);

export function register() {
  // Skip telemetry initialization if disabled
  if (!isTelemetryEnabled()) {
    console.log("OpenTelemetry is disabled");
    return;
  }

  // Use Vercel's built-in OpenTelemetry for Vercel deployments
  if (isVercelDeployment) {
    registerOTel({
      serviceName: telemetryConfig.service.name,
      resource: resource.attributes,
    });
    console.log("Vercel OpenTelemetry initialized");
    return;
  }

  // For local development and non-Vercel deployments, set up comprehensive instrumentation
  try {
    const sdk = new NodeSDK({
      resource,
      instrumentations: [
        getNodeAutoInstrumentations({
          // File system instrumentation
          "@opentelemetry/instrumentation-fs": {
            enabled: telemetryConfig.instrumentation.fs.enabled,
          },
          // DNS instrumentation
          "@opentelemetry/instrumentation-dns": {
            enabled: telemetryConfig.instrumentation.dns.enabled,
          },
          // HTTP instrumentation for API routes
          "@opentelemetry/instrumentation-http": {
            enabled: telemetryConfig.instrumentation.http.enabled,
            ignoreIncomingRequestHook: telemetryConfig.instrumentation.http.ignoreIncomingRequestHook,
            ignoreOutgoingRequestHook: telemetryConfig.instrumentation.http.ignoreOutgoingRequestHook,
            requestHook: (span, request) => {
              span.setAttributes({
                "http.request.header.user-agent": request.headers["user-agent"] || "",
                "http.request.header.x-forwarded-for": request.headers["x-forwarded-for"] || "",
              });
            },
          },
          // Express instrumentation for Next.js API routes
          "@opentelemetry/instrumentation-express": {
            enabled: true,
          },
          // Database instrumentation
          "@opentelemetry/instrumentation-pg": {
            enabled: telemetryConfig.instrumentation.database.enabled,
          },
          // Redis instrumentation
          "@opentelemetry/instrumentation-redis": {
            enabled: telemetryConfig.instrumentation.redis.enabled,
          },
        }),
      ],
      traceExporter: telemetryConfig.tracing.enabled ? new OTLPTraceExporter({
        url: telemetryConfig.tracing.endpoint,
        headers: telemetryConfig.tracing.headers,
      }) : undefined,
      metricReader: telemetryConfig.metrics.enabled ? new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: telemetryConfig.metrics.endpoint,
          headers: telemetryConfig.metrics.headers,
        }),
        exportIntervalMillis: telemetryConfig.metrics.exportIntervalMs,
      }) : undefined,
      logRecordProcessor: telemetryConfig.logging.enabled ? new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: telemetryConfig.logging.endpoint,
          headers: telemetryConfig.logging.headers,
        })
      ) : undefined,
    });

    sdk.start();
    console.log("OpenTelemetry instrumentation started successfully", {
      tracing: telemetryConfig.tracing.enabled,
      metrics: telemetryConfig.metrics.enabled,
      logging: telemetryConfig.logging.enabled,
    });
  } catch (error) {
    console.error("Failed to initialize OpenTelemetry:", error);
  }
}
