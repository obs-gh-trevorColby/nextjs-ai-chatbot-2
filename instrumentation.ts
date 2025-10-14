import { registerOTel } from "@vercel/otel";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Initialize our comprehensive OpenTelemetry setup
    const { initOtel } = await import("./otel-server");
    initOtel();
  }

  // Keep Vercel's OTel for additional Vercel-specific instrumentation
  registerOTel({ serviceName: "ai-chatbot" });
}
