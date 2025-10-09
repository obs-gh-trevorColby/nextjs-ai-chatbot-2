import { NextRequest, NextResponse } from "next/server";
import { createAPISpan, logEvent, logError } from "@/lib/telemetry/server";
import { trace } from "@opentelemetry/api";

export async function POST(request: NextRequest) {
  const span = createAPISpan("POST /api/telemetry/traces", request);
  
  try {
    const body = await request.json();
    
    // Log the received trace data
    logEvent("info", "Received client trace data", {
      "trace.count": body.resourceSpans?.length || 0,
      "client.user_agent": request.headers.get("user-agent") || "",
    });

    // In a real implementation, you would forward this to your telemetry backend
    // For now, we'll just log it and return success
    console.log("Client trace data received:", JSON.stringify(body, null, 2));

    span.setAttributes({
      "telemetry.type": "traces",
      "telemetry.source": "client",
      "trace.spans.count": body.resourceSpans?.reduce(
        (total: number, resource: any) => 
          total + (resource.scopeSpans?.reduce(
            (scopeTotal: number, scope: any) => scopeTotal + (scope.spans?.length || 0), 0
          ) || 0), 0
      ) || 0,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logError(error as Error, {
      "api.endpoint": "/api/telemetry/traces",
      "request.method": "POST",
    });
    
    return NextResponse.json(
      { error: "Failed to process trace data" },
      { status: 500 }
    );
  } finally {
    span.end();
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
