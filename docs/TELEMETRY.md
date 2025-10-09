# OpenTelemetry Instrumentation

This document describes the comprehensive OpenTelemetry instrumentation added to the AI Chatbot application for distributed tracing, metrics collection, and structured logging.

## Overview

The application now includes:

- **Distributed Tracing**: Track requests across the entire application stack
- **Metrics Collection**: Monitor application performance and usage patterns
- **Structured Logging**: Centralized logging with correlation IDs
- **Client-side Telemetry**: Browser-based observability
- **Database Instrumentation**: Track database operations and performance
- **AI/LLM Monitoring**: Monitor AI model usage and performance

## Architecture

### Server-side Instrumentation

- **Automatic Instrumentation**: HTTP, Express, PostgreSQL, Redis, and more
- **Custom Spans**: API routes, database operations, AI calls
- **Error Tracking**: Automatic exception recording and error correlation
- **Performance Monitoring**: Request duration, database query times

### Client-side Instrumentation

- **Fetch/XHR Monitoring**: Track API calls from the browser
- **Page Load Performance**: Monitor document load times
- **User Interactions**: Track user actions and navigation
- **Error Tracking**: Client-side error monitoring

## Configuration

### Environment Variables

Copy `.env.telemetry.example` to `.env.local` and configure:

```bash
# Enable/disable telemetry
OTEL_TRACES_ENABLED=true
OTEL_METRICS_ENABLED=true
OTEL_LOGS_ENABLED=true

# OTLP endpoints
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://localhost:4318/v1/logs

# Client-side telemetry
NEXT_PUBLIC_OTEL_TRACES_ENABLED=true
NEXT_PUBLIC_OTEL_LOGS_ENABLED=true
```

### Vercel Deployment

When deployed to Vercel, the application automatically uses `@vercel/otel` for built-in observability. You can still configure additional external endpoints.

## Local Development Setup

### Option 1: Docker Compose (Recommended)

Create a `docker-compose.observability.yml` file:

```yaml
version: '3.8'
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    depends_on:
      - jaeger
      - prometheus

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # Jaeger UI
    environment:
      - COLLECTOR_OTLP_ENABLED=true

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

Run with:
```bash
docker-compose -f docker-compose.observability.yml up -d
```

### Option 2: External Services

Configure endpoints for services like:
- Jaeger (tracing)
- Prometheus + Grafana (metrics)
- Honeycomb, New Relic, Datadog (all-in-one)

## Key Features

### Automatic Instrumentation

The application automatically instruments:

- **HTTP Requests**: All incoming and outgoing HTTP requests
- **Database Queries**: PostgreSQL operations with query details
- **Redis Operations**: Cache operations and performance
- **File System**: File operations (production only)
- **DNS Lookups**: Network resolution (production only)

### Custom Telemetry

#### API Routes

All API routes are automatically traced with:
- Request/response details
- User context
- Error handling
- Performance metrics

#### Database Operations

Database queries include:
- Operation type (SELECT, INSERT, UPDATE, DELETE)
- Table names
- Query performance
- Success/failure status

#### AI/LLM Operations

AI model calls are tracked with:
- Model name and provider
- Token usage
- Request/response times
- Error rates

### Telemetry Utilities

#### Server-side

```typescript
import { 
  createAPISpan, 
  createDatabaseSpan, 
  createAISpan,
  traceAsyncOperation,
  logEvent,
  logError 
} from '@/lib/telemetry/server';

// Create custom spans
const span = createAPISpan('my-operation', request);

// Trace async operations
const result = await traceAsyncOperation(
  'database-query',
  () => db.query('SELECT * FROM users'),
  { 'query.type': 'select' }
);

// Log structured events
logEvent('info', 'User action completed', {
  'user.id': userId,
  'action.type': 'chat_created'
});
```

#### Client-side

```typescript
import { createSpan, logEvent } from '@/lib/telemetry/client';

// Create custom spans
const span = createSpan('user-interaction', {
  'interaction.type': 'button_click'
});

// Log events
logEvent('info', 'User clicked button', {
  'button.id': 'submit-chat'
});
```

## Observability Dashboards

### Traces

View distributed traces to:
- Track request flows across services
- Identify performance bottlenecks
- Debug errors and failures
- Monitor API dependencies

### Metrics

Monitor key metrics:
- Request rates and latencies
- Error rates by endpoint
- Database query performance
- AI model usage and costs
- User activity patterns

### Logs

Structured logs provide:
- Centralized log aggregation
- Correlation with traces
- Error tracking and alerting
- Business intelligence data

## Best Practices

### Performance

- Sampling rates are configurable for production
- Automatic instrumentation is optimized for minimal overhead
- Client-side telemetry uses batching for efficiency

### Privacy

- User data is handled according to privacy requirements
- Sensitive information is not logged by default
- Configurable data sanitization

### Cost Management

- Configurable sampling rates
- Selective instrumentation enabling
- Efficient data export and batching

## Troubleshooting

### Common Issues

1. **No telemetry data**: Check endpoint configuration and network connectivity
2. **High overhead**: Reduce sampling rates or disable specific instrumentations
3. **Missing traces**: Verify instrumentation is enabled and properly configured

### Debug Mode

Enable debug logging:
```bash
OTEL_LOG_LEVEL=debug
```

### Health Checks

The application includes telemetry health checks at:
- `/api/telemetry/health` - Server-side telemetry status
- Browser console - Client-side telemetry status

## Integration Examples

### Grafana Dashboard

Import the provided Grafana dashboard template for:
- Request rate and latency metrics
- Error rate monitoring
- Database performance
- AI model usage

### Alerting

Set up alerts for:
- High error rates
- Slow response times
- Database connection issues
- AI model failures

## Security Considerations

- Telemetry endpoints should be secured in production
- API keys and tokens should be properly managed
- Data retention policies should be configured
- Access controls should be implemented for observability tools
