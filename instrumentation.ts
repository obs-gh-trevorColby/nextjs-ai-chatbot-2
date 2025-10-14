import { registerOTel } from "@vercel/otel";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Initialize our custom OpenTelemetry setup
    const { initOtel } = await import("./otel-server");
    initOtel();

    // Also keep Vercel's OTel for compatibility
    registerOTel({ serviceName: "ai-chatbot" });
  }
}
