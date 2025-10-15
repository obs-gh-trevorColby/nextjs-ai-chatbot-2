# Observability Setup

This Next.js AI chatbot application includes comprehensive observability instrumentation using OpenTelemetry. The setup provides distributed tracing, structured logging, and metrics collection for both server-side and client-side operations.

## Features

- **Distributed Tracing**: Track requests across the entire application stack
- **Structured Logging**: Correlated logs with trace and span IDs
- **Metrics Collection**: Application performance and business metrics
- **Health Checks**: Monitoring endpoints for application health
- **Error Tracking**: Comprehensive error monitoring and alerting

## Architecture

### Server-Side Instrumentation
- **File**: `otel-server.ts`
- **Features**: Auto-instrumentation for Node.js, HTTP requests, database operations
- **Exporters**: OTLP HTTP for traces, metrics, and logs

### Client-Side Instrumentation
- **File**: `otel-client.ts`
- **Features**: Browser instrumentation for fetch requests, document load, XHR
- **Exporters**: OTLP HTTP for traces, metrics, and logs

### Key Instrumented Components
- Chat API endpoints (`/api/chat`)
- Database operations (queries.ts)
- Authentication flows
- File upload operations
- Health check endpoints

## Configuration

### Environment Variables

```bash
# OTLP endpoint for sending telemetry data
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Optional: Bearer token for authentication
OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here

# Client-side configuration (must be prefixed with NEXT_PUBLIC_)
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here

# Optional: Enable/disable observability
OTEL_ENABLED=true
```

### OpenTelemetry Collector

To receive and process telemetry data, you'll need an OpenTelemetry Collector or compatible backend. Example collector configuration:

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
  # Configure your preferred backend (Jaeger, Prometheus, etc.)
  logging:
    loglevel: debug

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [logging]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [logging]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [logging]
```

## Metrics

### Application Metrics
- `chat_requests_total`: Total number of chat requests
- `chat_request_duration_ms`: Duration of chat requests
- `chat_errors_total`: Total number of chat errors
- `health_checks_total`: Total number of health checks
- `health_check_duration_ms`: Duration of health checks

### Database Metrics
- Database operation traces with timing
- Query performance monitoring
- Connection pool metrics (via auto-instrumentation)

## Health Checks

The application includes a health check endpoint at `/api/health` that provides:
- Application status
- Uptime information
- Memory usage
- Database connectivity status
- Environment information

Example response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "1.0.0",
  "checks": {
    "database": "healthy",
    "memory": {
      "used": 50000000,
      "total": 100000000
    }
  }
}
```

## Monitoring Queries

### Example Observe Queries

```sql
-- Request rate by endpoint
SELECT 
  attributes['http.route'] as endpoint,
  COUNT(*) as request_count
FROM traces 
WHERE span_name LIKE 'chat.%'
GROUP BY endpoint
ORDER BY request_count DESC

-- Error rate analysis
SELECT 
  attributes['error_type'] as error_type,
  COUNT(*) as error_count
FROM traces 
WHERE status_code = 'ERROR'
GROUP BY error_type

-- Response time percentiles
SELECT 
  PERCENTILE(duration_ms, 50) as p50,
  PERCENTILE(duration_ms, 95) as p95,
  PERCENTILE(duration_ms, 99) as p99
FROM traces 
WHERE span_name = 'chat.post'

-- Database operation performance
SELECT 
  attributes['db.operation'] as operation,
  attributes['db.table'] as table_name,
  AVG(duration_ms) as avg_duration,
  COUNT(*) as operation_count
FROM traces 
WHERE span_name LIKE 'db.%'
GROUP BY operation, table_name
```

## Development

### Local Setup

1. Start an OpenTelemetry Collector:
```bash
docker run -p 4317:4317 -p 4318:4318 \
  -v $(pwd)/otel-collector.yaml:/etc/otel-collector.yaml \
  otel/opentelemetry-collector:latest \
  --config=/etc/otel-collector.yaml
```

2. Set environment variables in `.env.local`:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

3. Start the application:
```bash
pnpm dev
```

### Testing Observability

1. Make requests to the application
2. Check the health endpoint: `curl http://localhost:3000/api/health`
3. View traces and metrics in your observability backend
4. Monitor logs for correlation with traces

## Production Deployment

### Vercel Deployment
- The application includes Vercel-specific optimizations
- Environment variables are automatically configured
- Use Vercel's built-in observability features alongside OpenTelemetry

### Other Platforms
- Ensure OpenTelemetry Collector is accessible
- Configure environment variables appropriately
- Consider using managed observability services (Observe, Datadog, New Relic, etc.)

## Troubleshooting

### Common Issues

1. **Telemetry not appearing**: Check OTLP endpoint configuration
2. **High overhead**: Adjust sampling rates in production
3. **Missing traces**: Verify instrumentation initialization order
4. **Client-side issues**: Ensure NEXT_PUBLIC_ prefix for environment variables

### Debug Mode

Enable debug logging by setting:
```bash
OTEL_LOG_LEVEL=debug
```

This will provide detailed information about telemetry export and any issues.
