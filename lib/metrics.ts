import { metrics } from "@opentelemetry/api";

// Get meter instance
const meter = metrics.getMeter("ai-chatbot");

// Create metrics
export const chatRequestCounter = meter.createCounter("chat_requests_total", {
  description: "Total number of chat requests",
});

export const chatRequestDuration = meter.createHistogram(
  "chat_request_duration_ms",
  {
    description: "Duration of chat requests in milliseconds",
  }
);

export const messageCounter = meter.createCounter("messages_total", {
  description: "Total number of messages processed",
});

export const userActiveGauge = meter.createUpDownCounter("active_users", {
  description: "Number of active users",
});

export const dbOperationDuration = meter.createHistogram(
  "db_operation_duration_ms",
  {
    description: "Duration of database operations in milliseconds",
  }
);

export const dbOperationCounter = meter.createCounter("db_operations_total", {
  description: "Total number of database operations",
});

export const errorCounter = meter.createCounter("errors_total", {
  description: "Total number of errors",
});

export const aiModelUsageCounter = meter.createCounter("ai_model_usage_total", {
  description: "Total AI model usage",
});

export const tokenUsageCounter = meter.createCounter("tokens_total", {
  description: "Total tokens used",
});

// Helper functions to record metrics
export function recordChatRequest(model: string, status: "success" | "error") {
  chatRequestCounter.add(1, { model, status });
}

export function recordChatDuration(duration: number, model: string) {
  chatRequestDuration.record(duration, { model });
}

export function recordMessage(role: "user" | "assistant") {
  messageCounter.add(1, { role });
}

export function recordDbOperation(
  operation: string,
  duration: number,
  status: "success" | "error"
) {
  dbOperationCounter.add(1, { operation, status });
  dbOperationDuration.record(duration, { operation, status });
}

export function recordError(type: string, operation?: string) {
  errorCounter.add(1, { type, operation: operation || "unknown" });
}

export function recordAiModelUsage(model: string, tokens: number) {
  aiModelUsageCounter.add(1, { model });
  tokenUsageCounter.add(tokens, { model });
}
