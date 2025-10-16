import { registerOTel } from "@vercel/otel";

// export function register() {
//   registerOTel({ serviceName: "ai-chatbot" });
// }

export async function register() {
  // registerOTel({ serviceName: "ai-chatbot" });
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node')
  }
}