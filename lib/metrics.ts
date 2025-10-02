import { meter } from "./otel-server";

// Create metrics for key application performance indicators
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

export const userAuthCounter = meter.createCounter("user_auth_total", {
  description: "Total number of authentication attempts",
});

export const databaseOperationCounter = meter.createCounter(
  "database_operations_total",
  {
    description: "Total number of database operations",
  }
);

export const databaseOperationDuration = meter.createHistogram(
  "database_operation_duration_ms",
  {
    description: "Duration of database operations in milliseconds",
  }
);

export const errorCounter = meter.createCounter("errors_total", {
  description: "Total number of errors",
});

export const activeUsersGauge = meter.createUpDownCounter("active_users", {
  description: "Number of currently active users",
});

// Helper functions to record metrics
export function recordChatRequest(
  model: string,
  status: string,
  duration: number
) {
  chatRequestCounter.add(1, { model, status });
  chatRequestDuration.record(duration, { model, status });
}

export function recordMessage(role: string, chatId: string) {
  messageCounter.add(1, { role, chat_id: chatId });
}

export function recordUserAuth(type: string, status: string) {
  userAuthCounter.add(1, { type, status });
}

export function recordDatabaseOperation(
  operation: string,
  table: string,
  status: string,
  duration: number
) {
  databaseOperationCounter.add(1, { operation, table, status });
  databaseOperationDuration.record(duration, { operation, table, status });
}

export function recordError(type: string, endpoint: string) {
  errorCounter.add(1, { type, endpoint });
}

export function updateActiveUsers(delta: number) {
  activeUsersGauge.add(delta);
}
