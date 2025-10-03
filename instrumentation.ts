export async function register() {
  if (
    typeof window === "undefined" &&
    typeof process !== "undefined" &&
    process.env.NODE_ENV
  ) {
    // Only run on server side
    try {
      const { initOtel } = await import("./lib/otel-server");
      initOtel();
    } catch (error) {
      console.warn("Failed to initialize OpenTelemetry:", error);
    }
  }
}
