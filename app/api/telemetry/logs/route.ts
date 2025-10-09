import { NextRequest, NextResponse } from "next/server";
import { createAPISpan, logEvent, logError } from "@/lib/telemetry/server";

export async function POST(request: NextRequest) {
  const span = createAPISpan("POST /api/telemetry/logs", request);
  
  try {
    const body = await request.json();
    
    // Log the received log data
    logEvent("info", "Received client log data", {
      "log.count": body.resourceLogs?.length || 0,
      "client.user_agent": request.headers.get("user-agent") || "",
    });

    // In a real implementation, you would forward this to your telemetry backend
    // For now, we'll just log it and return success
    console.log("Client log data received:", JSON.stringify(body, null, 2));

    span.setAttributes({
      "telemetry.type": "logs",
      "telemetry.source": "client",
      "log.records.count": body.resourceLogs?.reduce(
        (total: number, resource: any) => 
          total + (resource.scopeLogs?.reduce(
            (scopeTotal: number, scope: any) => scopeTotal + (scope.logRecords?.length || 0), 0
          ) || 0), 0
      ) || 0,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logError(error as Error, {
      "api.endpoint": "/api/telemetry/logs",
      "request.method": "POST",
    });
    
    return NextResponse.json(
      { error: "Failed to process log data" },
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
