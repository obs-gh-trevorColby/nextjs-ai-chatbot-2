import { registerOTel } from "@vercel/otel";
import { initOtel } from "@/lib/otel-server";

export function register() {
  // Initialize our comprehensive OpenTelemetry setup
  initOtel();

  // Keep Vercel's OTel for additional Vercel-specific instrumentation
  registerOTel({ serviceName: process.env.SERVICE_NAME || "ai-chatbot" });
}
