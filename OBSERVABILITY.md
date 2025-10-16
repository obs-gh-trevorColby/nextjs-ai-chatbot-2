# Observability Setup

This AI chatbot application includes comprehensive observability instrumentation using OpenTelemetry, providing deep visibility into application behavior, performance, and errors.

## Features

### 🔍 Distributed Tracing
- **Server-side tracing**: Automatic instrumentation of HTTP requests, database queries, and external API calls
- **Client-side tracing**: Browser-based tracing for user interactions and API calls
- **Custom spans**: Manual instrumentation for key business operations like chat message processing
- **Trace correlation**: Logs and metrics are correlated with trace IDs for complete request visibility

### 📊 Metrics Collection
- **Request metrics**: Request count, duration, and error rates for all API endpoints
- **Business metrics**: Chat-specific metrics like message count, model usage, and user activity
- **System metrics**: Application uptime, resource usage, and performance indicators
- **Custom metrics**: Counters and histograms for key application events

### 📝 Structured Logging
- **Contextual logging**: All logs include trace and span IDs for correlation
- **Structured format**: JSON-formatted logs with consistent attributes
- **Log levels**: Appropriate severity levels (INFO, WARN, ERROR) for different events
- **Error tracking**: Detailed error logging with stack traces and context

### 🏥 Health Monitoring
- **Health check endpoint**: `/api/health` provides application status
- **Uptime tracking**: Monitor application availability and performance
- **Dependency checks**: Can be extended to check database and external service health

## Configuration

### Environment Variables

Add these environment variables to your `.env.local` file:

```bash
# Server-side OpenTelemetry endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here

# Client-side OpenTelemetry endpoint (must be prefixed with NEXT_PUBLIC_)
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here
```

### OpenTelemetry Collector

To collect and export telemetry data, you'll need an OpenTelemetry Collector running. Here's a basic configuration:

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:

exporters:
  # Export to your observability backend (e.g., Observe, Jaeger, Prometheus)
  otlp:
    endpoint: "your-backend-endpoint"
    headers:
      authorization: "Bearer your-token"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
```

Run the collector with:
```bash
docker run -p 4317:4317 -p 4318:4318 -v $(pwd)/otel-collector.yaml:/etc/otel-collector-config.yaml otel/opentelemetry-collector:latest --config=/etc/otel-collector-config.yaml
```

## Instrumented Components

### API Routes
- **Chat API** (`/api/chat`): Full request tracing, error handling, and performance metrics
- **History API** (`/api/history`): Request tracking and user activity monitoring
- **Health Check** (`/api/health`): Application health and uptime monitoring

### Client Components
- **Chat Component**: User interaction tracking, message completion monitoring
- **Error Handling**: Client-side error tracking and user experience monitoring

### Key Metrics

#### Request Metrics
- `chat_requests_total`: Total number of chat requests by status and model
- `chat_request_duration_ms`: Chat request duration histogram
- `chat_errors_total`: Chat error count by error type
- `history_requests_total`: History API request count
- `health_checks_total`: Health check request count

#### Business Metrics
- Message processing time by AI model
- User activity patterns and engagement
- Error rates by user type and model
- Rate limiting effectiveness

## Monitoring Queries

### Example Observe Queries

#### Request Rate and Errors
```sql
-- Request rate over time
SELECT 
  time_bucket('1m', timestamp) as time,
  count(*) as requests_per_minute
FROM traces 
WHERE service_name = 'ai-chatbot'
GROUP BY time
ORDER BY time;

-- Error rate by endpoint
SELECT 
  span_name,
  count(*) as total_requests,
  sum(case when status_code = 'ERROR' then 1 else 0 end) as errors,
  (sum(case when status_code = 'ERROR' then 1 else 0 end) * 100.0 / count(*)) as error_rate
FROM traces
WHERE service_name = 'ai-chatbot'
GROUP BY span_name;
```

#### Performance Analysis
```sql
-- P95 response times by endpoint
SELECT 
  span_name,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms
FROM traces
WHERE service_name = 'ai-chatbot'
GROUP BY span_name;

-- Slowest requests
SELECT 
  trace_id,
  span_name,
  duration_ms,
  attributes
FROM traces
WHERE service_name = 'ai-chatbot'
ORDER BY duration_ms DESC
LIMIT 10;
```

## Development

### Adding Custom Instrumentation

#### Server-side
```typescript
import { tracer, logger, meter } from "@/otel-server";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";

export async function myFunction() {
  return tracer.startActiveSpan("my.operation", async (span) => {
    try {
      // Your business logic here
      const result = await someOperation();
      
      span.setAttributes({
        "operation.result": result,
      });
      
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Operation completed successfully",
        attributes: { result },
      });
      
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

#### Client-side
```typescript
import { tracer, logger } from "../otel-client";

// Track user interactions
const handleUserAction = () => {
  if (logger) {
    logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: "User action performed",
      attributes: { action: "button_click" },
    });
  }
};
```

## Troubleshooting

### Common Issues

1. **No telemetry data**: Check that the OpenTelemetry Collector is running and accessible
2. **Client-side errors**: Ensure environment variables are prefixed with `NEXT_PUBLIC_`
3. **Missing traces**: Verify that the instrumentation is initialized before other imports
4. **Performance impact**: Monitor the overhead of telemetry collection in production

### Debug Mode

Enable debug logging by setting:
```bash
OTEL_LOG_LEVEL=debug
```

This will provide detailed information about telemetry collection and export.
