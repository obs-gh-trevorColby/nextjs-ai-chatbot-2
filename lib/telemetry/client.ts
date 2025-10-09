"use client";

import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { Resource } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { trace, logs } from "@opentelemetry/api";
import { telemetryConfig, resourceAttributes } from "./config";

// Service information
const serviceName = "ai-chatbot-client";
const serviceVersion = telemetryConfig.service.version;

// Create resource with service information
const resource = new Resource({
  ...resourceAttributes,
  "service.name": serviceName,
  "telemetry.sdk.language": "javascript",
});

let isInitialized = false;

export function initializeClientTelemetry() {
  // Prevent multiple initializations
  if (isInitialized || typeof window === "undefined") {
    return;
  }

  // Check if client-side telemetry is enabled
  if (!telemetryConfig.client.tracing.enabled && !telemetryConfig.client.logging.enabled) {
    console.log("Client-side telemetry is disabled");
    return;
  }

  try {
    // Initialize trace provider if enabled
    if (telemetryConfig.client.tracing.enabled) {
      const provider = new WebTracerProvider({
        resource,
      });

      // Configure trace exporter
      const traceExporter = new OTLPTraceExporter({
        url: telemetryConfig.client.tracing.endpoint,
        headers: {
          "Content-Type": "application/json",
        },
      });

      provider.addSpanProcessor(new BatchSpanProcessor(traceExporter));
      provider.register();
    }

    // Initialize logger provider if enabled
    if (telemetryConfig.client.logging.enabled) {
      const loggerProvider = new LoggerProvider({
        resource,
      });

      const logExporter = new OTLPLogExporter({
        url: telemetryConfig.client.logging.endpoint,
        headers: {
          "Content-Type": "application/json",
        },
      });

      loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));
      logs.setGlobalLoggerProvider(loggerProvider);
    }

    // Register instrumentations
    registerInstrumentations({
      instrumentations: [
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: [
            /^https?:\/\/localhost/,
            /^https?:\/\/.*\.vercel\.app/,
            /^https?:\/\/.*\.vercel\.dev/,
          ],
          clearTimingResources: true,
          applyCustomAttributesOnSpan: (span, request, result) => {
            // Add custom attributes for API calls
            if (request.url.includes("/api/")) {
              span.setAttributes({
                "http.request.api": true,
                "http.request.url": request.url,
              });
            }
          },
        }),
        new XMLHttpRequestInstrumentation({
          propagateTraceHeaderCorsUrls: [
            /^https?:\/\/localhost/,
            /^https?:\/\/.*\.vercel\.app/,
            /^https?:\/\/.*\.vercel\.dev/,
          ],
        }),
        new DocumentLoadInstrumentation(),
      ],
    });

    isInitialized = true;
    console.log("Client-side OpenTelemetry instrumentation initialized");
  } catch (error) {
    console.error("Failed to initialize client-side OpenTelemetry:", error);
  }
}

// Helper function to create custom spans
export function createSpan(name: string, attributes?: Record<string, string | number | boolean>) {
  const tracer = trace.getTracer(serviceName, serviceVersion);
  return tracer.startSpan(name, {
    attributes: {
      "service.name": serviceName,
      ...attributes,
    },
  });
}

// Helper function to log events
export function logEvent(level: "info" | "warn" | "error", message: string, attributes?: Record<string, any>) {
  const logger = logs.getLogger(serviceName, serviceVersion);
  logger.emit({
    severityText: level.toUpperCase(),
    body: message,
    attributes: {
      "service.name": serviceName,
      timestamp: Date.now(),
      ...attributes,
    },
  });
}

// Auto-initialize if in browser environment
if (typeof window !== "undefined") {
  // Initialize after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeClientTelemetry);
  } else {
    initializeClientTelemetry();
  }
}
