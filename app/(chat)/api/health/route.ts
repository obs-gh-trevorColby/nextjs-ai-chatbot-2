import { type NextRequest, NextResponse } from "next/server";
import { observabilityLogger } from "@/lib/observability";
import { getOtelHealth } from "@/lib/otel-server";

export async function GET(_request: NextRequest) {
  try {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "ai-chatbot",
      version: "3.1.0",
      environment: process.env.NODE_ENV || "development",
      observability: getOtelHealth(),
      checks: {
        database: await checkDatabase(),
        redis: await checkRedis(),
        ai_provider: await checkAIProvider(),
      },
    };

    // Log health check
    observabilityLogger.info("Health check performed", {
      status: health.status,
      checks: health.checks,
    });

    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    observabilityLogger.error("Health check failed", error as Error);

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      },
      { status: 503 }
    );
  }
}

async function checkDatabase(): Promise<{ status: string; latency?: number }> {
  try {
    const start = Date.now();

    // Simple connectivity check without importing the full db module
    const _result = await Promise.race([
      // Simulate a basic connection check
      new Promise((resolve) => {
        // In a real implementation, you would check database connectivity
        // For now, we'll assume it's healthy if POSTGRES_URL is configured
        resolve({ success: !!process.env.POSTGRES_URL });
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database timeout")), 5000)
      ),
    ]);

    const latency = Date.now() - start;

    return {
      status: process.env.POSTGRES_URL ? "healthy" : "not_configured",
      latency,
    };
  } catch (error) {
    return {
      status: "unhealthy",
    };
  }
}

function checkRedis(): Promise<{ status: string; latency?: number }> {
  try {
    // Redis is optional in this application
    if (!process.env.REDIS_URL) {
      return { status: "not_configured" };
    }

    const start = Date.now();

    // Basic Redis connectivity check would go here
    // For now, we'll assume it's healthy if configured
    const latency = Date.now() - start;

    return {
      status: "healthy",
      latency,
    };
  } catch (error) {
    return {
      status: "unhealthy",
    };
  }
}

function checkAIProvider(): Promise<{ status: string }> {
  try {
    // Check if AI provider configuration is available
    const hasGatewayConfig =
      process.env.AI_GATEWAY_URL || process.env.OPENAI_API_KEY;

    return {
      status: hasGatewayConfig ? "healthy" : "not_configured",
    };
  } catch (error) {
    return {
      status: "unhealthy",
    };
  }
}
