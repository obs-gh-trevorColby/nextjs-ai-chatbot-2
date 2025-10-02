import { initOtel } from "@/lib/otel-server";

export function register() {
  // Initialize comprehensive OpenTelemetry instrumentation
  initOtel();
}
