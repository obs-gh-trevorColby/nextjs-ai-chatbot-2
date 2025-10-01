import { registerOTel } from "@vercel/otel";
import { initOtel } from "./lib/otel-server";

export function register() {
  // Initialize our comprehensive OpenTelemetry setup
  initOtel();

  // Keep Vercel's OTEL for additional Vercel-specific instrumentation
  registerOTel({ serviceName: "ai-chatbot" });
}
