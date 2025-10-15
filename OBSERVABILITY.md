# Observability Setup

This Next.js AI chatbot application includes comprehensive observability instrumentation using OpenTelemetry. The setup provides distributed tracing, structured logging, and metrics collection for both server-side and client-side components.

## Features

- **Distributed Tracing**: Track requests across the entire application stack
- **Structured Logging**: Correlated logs with trace and span IDs
- **Metrics Collection**: Performance metrics, error rates, and business metrics
- **Health Monitoring**: Built-in health check endpoint
- **Client-Side Observability**: Browser-based tracing and logging
- **Database Instrumentation**: Automatic database operation tracking
- **AI Operation Monitoring**: Specialized instrumentation for AI/LLM operations

## Architecture

### Server-Side Components

- **`otel-server.ts`**: Main OpenTelemetry configuration for Node.js
- **`instrumentation.ts`**: Next.js instrumentation hook
- **`lib/observability.ts`**: Utility functions for common instrumentation patterns
- **Database Queries**: Instrumented with automatic tracing and logging

### Client-Side Components

- **`otel-client.ts`**: Browser-specific OpenTelemetry configuration
- **`components/otel-client-init.tsx`**: Client-side initialization component
- **Automatic Instrumentation**: Fetch, XHR, and document load tracking

## Configuration

### Environment Variables

Set the following environment variables to configure OpenTelemetry:

```bash
# Server-side configuration
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here

# Client-side configuration (Next.js public variables)
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here
```

### OTLP Collector Setup

The application sends telemetry data to an OTLP endpoint. You can use:

1. **Local OpenTelemetry Collector**
2. **Observe.ai** (recommended for production)
3. **Jaeger** (for development/testing)
4. **Other OTLP-compatible backends**

## Usage Examples

### Basic Logging

```typescript
import { logEvent } from "@/lib/observability";

// Log structured events
await logEvent("INFO", "User action completed", {
  userId: "123",
  action: "chat_message",
  duration: 150
});
```

### Database Operation Instrumentation

```typescript
import { instrumentDatabaseOperation } from "@/lib/observability";

export async function getUser(id: string) {
  return instrumentDatabaseOperation(
    "getUser",
    async () => {
      return await db.select().from(users).where(eq(users.id, id));
    },
    { userId: id }
  );
}
```

### AI Operation Instrumentation

```typescript
import { instrumentAIOperation } from "@/lib/observability";

export async function generateResponse(prompt: string) {
  return instrumentAIOperation(
    "generateResponse",
    async () => {
      return await aiModel.generate(prompt);
    },
    { promptLength: prompt.length, model: "gpt-4" }
  );
}
```

### Custom Metrics

```typescript
import { recordMetric } from "@/lib/observability";

// Record custom metrics
await recordMetric("user_actions_total", 1, "counter", {
  action: "chat_message",
  user_type: "premium"
});

await recordMetric("response_time_ms", 250, "histogram", {
  endpoint: "/api/chat"
});
```

## Monitoring Endpoints

### Health Check

- **URL**: `/api/health`
- **Method**: GET
- **Response**: JSON with service health status, uptime, and version

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "production"
}
```

## Key Metrics

The application automatically collects the following metrics:

### Request Metrics
- `chat_requests_total`: Total number of chat API requests
- `chat_request_duration_ms`: Duration of chat requests
- `health_checks_total`: Health check requests

### AI Metrics
- `ai_operations_total`: Total AI operations (by type and status)
- `ai_operation_duration_ms`: AI operation duration

### Database Metrics
- Automatic database operation tracing
- Query duration and success/failure rates

## Traces and Spans

### Automatic Instrumentation
- HTTP requests and responses
- Database operations
- External API calls
- File system operations

### Custom Spans
- Chat message processing
- AI model interactions
- Document operations
- User authentication flows

## Logs

All logs include:
- Trace ID and Span ID for correlation
- Structured attributes
- Appropriate severity levels
- Contextual information

### Log Levels
- **DEBUG**: Detailed diagnostic information
- **INFO**: General application flow
- **WARN**: Warning conditions
- **ERROR**: Error conditions and exceptions

## Development

### Local Testing

1. Start an OTLP collector (e.g., Jaeger):
```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 14250:14250 \
  -p 4317:4317 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

2. Set environment variables:
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

3. Start the application:
```bash
pnpm dev
```

4. View traces at http://localhost:16686

### Production Deployment

For production deployments:

1. Configure your OTLP endpoint (e.g., Observe.ai)
2. Set authentication tokens
3. Ensure proper resource attributes
4. Configure appropriate sampling rates
5. Set up alerting based on metrics and logs

## Troubleshooting

### Common Issues

1. **OpenTelemetry not initializing**: Check that `instrumentation.ts` is properly configured
2. **Missing traces**: Verify OTLP endpoint connectivity
3. **Client-side issues**: Ensure public environment variables are set
4. **Performance impact**: Adjust sampling rates if needed

### Debug Mode

Enable debug logging by setting:
```bash
export OTEL_LOG_LEVEL=debug
```

## Best Practices

1. **Use structured logging** with consistent attribute names
2. **Add context** to spans with relevant attributes
3. **Handle errors gracefully** in instrumentation code
4. **Monitor performance impact** of observability overhead
5. **Use appropriate sampling** for high-volume applications
6. **Correlate logs and traces** using trace IDs
7. **Set up alerting** on key metrics and error rates
