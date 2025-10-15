// Observability Configuration
// This file contains configuration for OpenTelemetry and observability features

export const observabilityConfig = {
  // Service information
  serviceName: "ai-chatbot",
  serviceVersion: "3.1.0",

  // OpenTelemetry Collector endpoint
  otlpEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",

  // Authentication
  bearerToken: process.env.OTEL_EXPORTER_OTLP_BEARER_TOKEN,

  // Client-side configuration (Next.js public env vars)
  clientOtlpEndpoint:
    process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ||
    "http://localhost:4318",
  clientBearerToken: process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN,

  // Feature flags
  enableTracing: process.env.OTEL_ENABLE_TRACING !== "false",
  enableMetrics: process.env.OTEL_ENABLE_METRICS !== "false",
  enableLogging: process.env.OTEL_ENABLE_LOGGING !== "false",

  // Environment-specific settings
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV === "development",

  // Sampling configuration
  traceSampleRate: Number.parseFloat(
    process.env.OTEL_TRACE_SAMPLE_RATE || "1.0"
  ),

  // Export intervals (in milliseconds)
  metricExportInterval: Number.parseInt(
    process.env.OTEL_METRIC_EXPORT_INTERVAL || "10000"
  ),
  logExportInterval: Number.parseInt(
    process.env.OTEL_LOG_EXPORT_INTERVAL || "5000"
  ),

  // Batch sizes
  maxTraceBatchSize: Number.parseInt(
    process.env.OTEL_MAX_TRACE_BATCH_SIZE || "512"
  ),
  maxLogBatchSize: Number.parseInt(
    process.env.OTEL_MAX_LOG_BATCH_SIZE || "512"
  ),
  maxMetricBatchSize: Number.parseInt(
    process.env.OTEL_MAX_METRIC_BATCH_SIZE || "512"
  ),

  // Resource attributes
  resourceAttributes: {
    "service.name": process.env.OTEL_SERVICE_NAME || "ai-chatbot",
    "service.version": process.env.OTEL_SERVICE_VERSION || "3.1.0",
    "deployment.environment":
      process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
      process.env.NODE_ENV ||
      "development",
    "service.namespace": process.env.OTEL_SERVICE_NAMESPACE || "ai-chatbot",
    "service.instance.id":
      process.env.OTEL_SERVICE_INSTANCE_ID || process.env.HOSTNAME || "unknown",
  },

  // Instrumentation configuration
  instrumentations: {
    // Disable noisy instrumentations in development
    fs: process.env.NODE_ENV === "production",
    dns: process.env.NODE_ENV === "production",

    // HTTP instrumentation
    http: {
      enabled: true,
      ignoreUrls: [
        /.*\/_next\/.*/,
        /.*\/__nextjs_original-stack-frame.*/,
        /.*\/favicon\.ico/,
        /.*\/health/,
      ],
    },

    // Database instrumentation
    database: {
      enabled: true,
      captureStatements: process.env.NODE_ENV !== "production",
    },
  },

  // Error tracking
  errorTracking: {
    enabled: true,
    captureStackTrace: true,
    maxStackTraceDepth: 50,
  },

  // Performance monitoring
  performance: {
    enabled: true,
    slowQueryThreshold: Number.parseInt(
      process.env.OTEL_SLOW_QUERY_THRESHOLD || "1000"
    ), // ms
    slowRequestThreshold: Number.parseInt(
      process.env.OTEL_SLOW_REQUEST_THRESHOLD || "5000"
    ), // ms
  },

  // Custom metrics
  customMetrics: {
    enabled: true,
    chatMetrics: true,
    databaseMetrics: true,
    aiMetrics: true,
  },
};

// Validation function
export function validateObservabilityConfig() {
  const errors: string[] = [];

  if (!observabilityConfig.serviceName) {
    errors.push("Service name is required");
  }

  if (!observabilityConfig.serviceVersion) {
    errors.push("Service version is required");
  }

  if (
    observabilityConfig.traceSampleRate < 0 ||
    observabilityConfig.traceSampleRate > 1
  ) {
    errors.push("Trace sample rate must be between 0 and 1");
  }

  if (errors.length > 0) {
    throw new Error(`Observability configuration errors: ${errors.join(", ")}`);
  }

  return true;
}

// Helper function to get headers for OTLP exporters
export function getOtlpHeaders(targetPackage: string) {
  const headers: Record<string, string> = {
    "x-observe-target-package": targetPackage,
  };

  if (observabilityConfig.bearerToken) {
    headers.Authorization = `Bearer ${observabilityConfig.bearerToken}`;
  }

  return headers;
}

// Helper function to get client-side headers
export function getClientOtlpHeaders(targetPackage: string) {
  const headers: Record<string, string> = {
    "x-observe-target-package": targetPackage,
  };

  if (observabilityConfig.clientBearerToken) {
    headers.Authorization = `Bearer ${observabilityConfig.clientBearerToken}`;
  }

  return headers;
}
