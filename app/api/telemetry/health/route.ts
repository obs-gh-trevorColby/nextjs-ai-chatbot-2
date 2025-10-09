import { NextRequest, NextResponse } from "next/server";
import { isTelemetryEnabled, telemetryConfig } from "@/lib/telemetry/config";

export async function GET(request: NextRequest) {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    telemetry: {
      enabled: isTelemetryEnabled(),
      config: {
        tracing: {
          enabled: telemetryConfig.tracing.enabled,
          endpoint: telemetryConfig.tracing.endpoint,
        },
        metrics: {
          enabled: telemetryConfig.metrics.enabled,
          endpoint: telemetryConfig.metrics.endpoint,
        },
        logging: {
          enabled: telemetryConfig.logging.enabled,
          endpoint: telemetryConfig.logging.endpoint,
        },
      },
      service: {
        name: telemetryConfig.service.name,
        version: telemetryConfig.service.version,
        environment: telemetryConfig.service.environment,
        deployment: telemetryConfig.service.deployment,
      },
    },
  };

  return NextResponse.json(health, { status: 200 });
}
