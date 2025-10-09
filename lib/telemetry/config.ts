/**
 * OpenTelemetry configuration for the AI Chatbot application
 */

// Environment detection
export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = process.env.NODE_ENV === "development";
export const isVercelDeployment = !!process.env.VERCEL;
export const isTestEnvironment = process.env.NODE_ENV === "test";

// Service information
export const serviceName = "ai-chatbot";
export const serviceVersion = process.env.npm_package_version || "1.0.0";

// OpenTelemetry configuration
export const telemetryConfig = {
  // Service identification
  service: {
    name: serviceName,
    version: serviceVersion,
    environment: process.env.NODE_ENV || "development",
    deployment: isVercelDeployment ? "vercel" : "local",
  },

  // Tracing configuration
  tracing: {
    enabled: process.env.OTEL_TRACES_ENABLED !== "false",
    endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "http://localhost:4318/v1/traces",
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
      JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS) : {},
    sampleRate: Number(process.env.OTEL_TRACES_SAMPLE_RATE) || 1.0,
  },

  // Metrics configuration
  metrics: {
    enabled: process.env.OTEL_METRICS_ENABLED !== "false",
    endpoint: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || "http://localhost:4318/v1/metrics",
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
      JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS) : {},
    exportIntervalMs: Number(process.env.OTEL_METRICS_EXPORT_INTERVAL_MS) || 30000,
  },

  // Logging configuration
  logging: {
    enabled: process.env.OTEL_LOGS_ENABLED !== "false",
    endpoint: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || "http://localhost:4318/v1/logs",
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ? 
      JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS) : {},
    level: process.env.OTEL_LOG_LEVEL || "info",
  },

  // Instrumentation configuration
  instrumentation: {
    // HTTP instrumentation
    http: {
      enabled: true,
      ignoreIncomingRequestHook: (req: any) => {
        // Ignore health checks and static assets
        const url = req.url || req.path || "";
        return url.includes("/_next/") || 
               url.includes("/favicon.ico") || 
               url.includes("/ping") ||
               url.includes("/health");
      },
      ignoreOutgoingRequestHook: (options: any) => {
        // Ignore telemetry endpoints to prevent loops
        const hostname = options.hostname || options.host || "";
        return hostname.includes("localhost:4318") || 
               hostname.includes("otel-collector");
      },
    },

    // Database instrumentation
    database: {
      enabled: true,
      captureStatements: !isProduction, // Only capture SQL in non-production
    },

    // File system instrumentation
    fs: {
      enabled: isProduction, // Only enable in production to reduce noise
    },

    // DNS instrumentation
    dns: {
      enabled: isProduction, // Only enable in production to reduce noise
    },

    // Redis instrumentation
    redis: {
      enabled: true,
    },
  },

  // Client-side configuration
  client: {
    tracing: {
      enabled: process.env.NEXT_PUBLIC_OTEL_TRACES_ENABLED !== "false",
      endpoint: process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "/api/telemetry/traces",
    },
    logging: {
      enabled: process.env.NEXT_PUBLIC_OTEL_LOGS_ENABLED !== "false",
      endpoint: process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || "/api/telemetry/logs",
    },
  },
};

// Resource attributes
export const resourceAttributes = {
  "service.name": telemetryConfig.service.name,
  "service.version": telemetryConfig.service.version,
  "service.environment": telemetryConfig.service.environment,
  "deployment.environment": telemetryConfig.service.deployment,
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.language": "javascript",
  "telemetry.sdk.version": "1.0.0",
};

// Common span attributes
export const commonSpanAttributes = {
  "service.name": telemetryConfig.service.name,
  "service.version": telemetryConfig.service.version,
};

// Semantic conventions for custom attributes
export const customSemanticConventions = {
  // Chat-specific attributes
  CHAT_ID: "chat.id",
  CHAT_MODEL: "chat.model",
  CHAT_VISIBILITY: "chat.visibility",
  CHAT_MESSAGES_TOTAL: "chat.messages.total",
  CHAT_MESSAGES_FROM_DB: "chat.messages.from_db",

  // Message-specific attributes
  MESSAGE_ID: "message.id",
  MESSAGE_ROLE: "message.role",
  MESSAGE_CONTENT_LENGTH: "message.content.length",

  // User-specific attributes
  USER_ID: "user.id",
  USER_TYPE: "user.type",
  USER_MESSAGE_COUNT_24H: "user.message_count_24h",
  USER_RATE_LIMIT: "user.rate_limit",

  // AI-specific attributes
  AI_MODEL_NAME: "ai.model.name",
  AI_OPERATION: "ai.operation",
  AI_SYSTEM: "ai.system",
  AI_USAGE_TOTAL_TOKENS: "ai.usage.total_tokens",
  AI_USAGE_PROMPT_TOKENS: "ai.usage.prompt_tokens",
  AI_USAGE_COMPLETION_TOKENS: "ai.usage.completion_tokens",

  // Database-specific attributes
  DB_OPERATION: "db.operation",
  DB_TABLE: "db.table",
  DB_OPERATION_SUCCESS: "db.operation.success",

  // External service attributes
  EXTERNAL_SERVICE: "external.service",
  EXTERNAL_OPERATION: "external.operation",

  // Error attributes
  ERROR_TYPE: "error.type",
  ERROR_NAME: "error.name",
  ERROR_MESSAGE: "error.message",
  ERROR_STACK: "error.stack",
};

// Helper function to get telemetry configuration
export function getTelemetryConfig() {
  return telemetryConfig;
}

// Helper function to check if telemetry is enabled
export function isTelemetryEnabled() {
  return telemetryConfig.tracing.enabled || 
         telemetryConfig.metrics.enabled || 
         telemetryConfig.logging.enabled;
}

// Helper function to get resource attributes
export function getResourceAttributes() {
  return resourceAttributes;
}
