import { SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { NextResponse } from "next/server";

// Import OpenTelemetry components - use dynamic import to avoid issues during build
let globalLogger: any;
let globalTracer: any;
let globalMeter: any;

async function getOtelComponents() {
  if (!globalLogger || !globalTracer || !globalMeter) {
    try {
      const otel = await import("@/otel-server");
      globalLogger = otel.logger;
      globalTracer = otel.tracer;
      globalMeter = otel.meter;
    } catch (error) {
      console.warn("OpenTelemetry components not available:", error);
    }
  }
  return { logger: globalLogger, tracer: globalTracer, meter: globalMeter };
}

export async function GET() {
  const { logger, tracer, meter } = await getOtelComponents();

  return (
    tracer?.startActiveSpan("health.check", async (span: any) => {
      try {
        const healthData = {
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: process.env.npm_package_version || "unknown",
          environment: process.env.NODE_ENV || "unknown",
        };

        span?.setAttributes({
          "http.method": "GET",
          "http.route": "/api/health",
          "health.status": "healthy",
          "service.uptime": process.uptime(),
        });

        logger?.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: "Health check performed",
          attributes: {
            status: "healthy",
            uptime: process.uptime(),
          },
        });

        // Record health check metric
        const healthCheckCounter = meter?.createCounter("health_checks_total", {
          description: "Total number of health checks",
        });
        healthCheckCounter?.add(1, { status: "healthy" });

        span?.setStatus({ code: SpanStatusCode.OK });
        span?.end();

        return NextResponse.json(healthData, { status: 200 });
      } catch (error) {
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span?.recordException(error as Error);

        logger?.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: "Health check failed",
          attributes: { error: (error as Error).message },
        });

        const healthCheckCounter = meter?.createCounter("health_checks_total", {
          description: "Total number of health checks",
        });
        healthCheckCounter?.add(1, { status: "error" });

        span?.end();

        return NextResponse.json(
          {
            status: "unhealthy",
            error: (error as Error).message,
            timestamp: new Date().toISOString(),
          },
          { status: 500 }
        );
      }
    }) ||
    NextResponse.json(
      { status: "unhealthy", error: "OpenTelemetry not available" },
      { status: 500 }
    )
  );
}
