import { type Span, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { NextRequest } from "next/server";
import { logger, meter, tracer } from "@/otel-server";

// Initialize health check metrics
const healthCheckCounter = meter.createCounter("health_checks_total", {
  description: "Total number of health check requests",
});

const healthCheckDuration = meter.createHistogram("health_check_duration_ms", {
  description: "Duration of health check requests in milliseconds",
});

export function GET(_request: NextRequest) {
  const startTime = Date.now();

  return tracer.startActiveSpan("health.check", (span: Span) => {
    try {
      // Basic health check - could be extended to check database, external services, etc.
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || "unknown",
        environment: process.env.NODE_ENV || "unknown",
      };

      const duration = Date.now() - startTime;

      span.setStatus({ code: SpanStatusCode.OK });
      span.setAttributes({
        "health.status": health.status,
        "health.uptime": health.uptime,
        "response.duration_ms": duration,
      });

      healthCheckCounter.add(1, { status: "success" });
      healthCheckDuration.record(duration);

      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Health check completed",
        attributes: {
          status: health.status,
          uptime: health.uptime,
          duration,
        },
      });

      return Response.json(health, { status: 200 });
    } catch (error) {
      const duration = Date.now() - startTime;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.recordException(error as Error);

      healthCheckCounter.add(1, { status: "error" });
      healthCheckDuration.record(duration);

      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "Health check failed",
        attributes: {
          error: (error as Error).message,
          duration,
        },
      });

      return Response.json(
        {
          status: "unhealthy",
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );
    } finally {
      span.end();
    }
  });
}
