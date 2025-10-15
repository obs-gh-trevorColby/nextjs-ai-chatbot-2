import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { NextResponse } from "next/server";
import { logger, meter, tracer } from "@/otel-server";

// Health check metrics
const healthCheckCounter = meter.createCounter("health_checks_total", {
  description: "Total number of health checks",
});

const healthCheckDuration = meter.createHistogram("health_check_duration_ms", {
  description: "Duration of health checks in milliseconds",
});

export async function GET() {
  const startTime = Date.now();

  return tracer.startActiveSpan("health.check", async (span: Span) => {
    try {
      span.setAttributes({
        "http.method": "GET",
        "http.route": "/api/health",
      });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Health check requested",
      });

      healthCheckCounter.add(1, { status: "requested" });

      // Basic health checks
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || "unknown",
        checks: {
          database: "healthy", // Could add actual DB ping here
          memory: {
            used: process.memoryUsage().heapUsed,
            total: process.memoryUsage().heapTotal,
          },
        },
      };

      span.setAttributes({
        "health.status": health.status,
        "health.uptime": health.uptime,
        "health.memory.used": health.checks.memory.used,
        "health.memory.total": health.checks.memory.total,
      });

      span.setStatus({ code: SpanStatusCode.OK });

      healthCheckCounter.add(1, { status: "healthy" });

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Health check completed",
        attributes: {
          "health.status": health.status,
          "health.uptime": health.uptime,
        },
      });

      return NextResponse.json(health, { status: 200 });
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      healthCheckCounter.add(1, { status: "unhealthy" });

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Health check failed",
        attributes: {
          error: (error as Error).message,
        },
      });

      return NextResponse.json(
        {
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          error: (error as Error).message,
        },
        { status: 500 }
      );
    } finally {
      span.end();
      const duration = Date.now() - startTime;
      healthCheckDuration.record(duration);
    }
  });
}
