import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

// Get the service name from environment or default
const serviceName = process.env.SERVICE_NAME || "ai-chatbot";

// Export logger, tracer, and meter for use throughout the application
export const logger = logs.getLogger(serviceName);
export const tracer = trace.getTracer(serviceName);
export const meter = metrics.getMeter(serviceName);

// Re-export the SDK and init function from instrumentation
export { initOtel, sdk, shutdownOtel } from "../instrumentation";
