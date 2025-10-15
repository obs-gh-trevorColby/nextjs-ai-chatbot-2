# Observability Setup

This document describes the comprehensive observability instrumentation added to the AI Chatbot application using OpenTelemetry.

## Overview

The application now includes:
- **Distributed Tracing**: Track requests across all components
- **Structured Logging**: Correlated logs with trace context
- **Metrics Collection**: Performance and business metrics
- **Error Tracking**: Comprehensive error monitoring
- **Health Checks**: Application and dependency health monitoring

## Architecture

### Server-Side Instrumentation
- **File**: `lib/otel-server.ts`
- **Features**: NodeSDK with auto-instrumentation, OTLP exporters
- **Scope**: API routes, database operations, AI operations

### Client-Side Instrumentation  
- **File**: `lib/otel-client.ts`
- **Features**: Web SDK with browser instrumentation
- **Scope**: User interactions, fetch requests, page loads

### Observability Utilities
- **File**: `lib/observability.ts`
- **Features**: Helper functions for logging, tracing, metrics
- **Usage**: Easy-to-use wrappers for common observability patterns

## Configuration

### Environment Variables

#### Required
```bash
# OpenTelemetry Collector endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Optional: Authentication token
OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here
```

#### Client-Side (Next.js Public Variables)
```bash
# Client-side OTLP endpoint
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Optional: Client-side authentication token
NEXT_PUBLIC_OTEL_EXPORTER_OTLP_BEARER_TOKEN=your-token-here
```

#### Optional Configuration
```bash
# Feature toggles
OTEL_ENABLE_TRACING=true
OTEL_ENABLE_METRICS=true
OTEL_ENABLE_LOGGING=true

# Performance tuning
OTEL_TRACE_SAMPLE_RATE=1.0
OTEL_METRIC_EXPORT_INTERVAL=10000
OTEL_LOG_EXPORT_INTERVAL=5000

# Service identification
OTEL_SERVICE_NAME=ai-chatbot
OTEL_SERVICE_VERSION=3.1.0
OTEL_DEPLOYMENT_ENVIRONMENT=production
```

## Instrumented Components

### API Routes
- **Chat API** (`/api/chat`): Full request lifecycle tracing
- **Health Check** (`/api/health`): System health monitoring
- **Document API**: Document operations tracking
- **History API**: Chat history operations

### Database Operations
- All database queries are automatically instrumented
- Performance metrics for slow queries
- Error tracking for failed operations

### AI Operations
- Model inference tracking
- Token usage monitoring
- Response time metrics

### Client-Side
- Page load performance
- User interaction tracking
- API request monitoring
- Error boundary integration

## Metrics Collected

### HTTP Metrics
- `http_requests_total`: Total HTTP requests by method, path, status
- `http_request_duration_ms`: Request duration histogram

### Chat Metrics
- `chat_messages_total`: Total chat messages by type
- Message length distribution
- Model usage statistics

### Database Metrics
- `database_operations_total`: Database operations by type, table
- `database_operation_duration_ms`: Query performance
- Connection pool metrics

### AI Metrics
- Model inference duration
- Token usage (input/output)
- Error rates by model

### System Metrics
- Memory usage
- CPU utilization
- Error rates

## Logging

### Log Levels
- **INFO**: Normal operations, request completion
- **WARN**: Recoverable errors, rate limits
- **ERROR**: Unhandled errors, system failures
- **DEBUG**: Detailed debugging (development only)

### Log Correlation
All logs include:
- Trace ID and Span ID for correlation
- User ID (when available)
- Request ID
- Timestamp
- Service context

### Structured Format
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "INFO",
  "message": "Chat request completed",
  "traceId": "abc123...",
  "spanId": "def456...",
  "attributes": {
    "chatId": "chat-123",
    "userId": "user-456",
    "model": "gpt-4",
    "duration": 1500
  }
}
```

## Health Checks

### Endpoint: `/api/health`

Returns comprehensive health status:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "ai-chatbot",
  "version": "3.1.0",
  "environment": "production",
  "observability": {
    "service": "ai-chatbot",
    "endpoint": "http://localhost:4318",
    "initialized": true
  },
  "checks": {
    "database": { "status": "healthy", "latency": 25 },
    "redis": { "status": "healthy", "latency": 5 },
    "ai_provider": { "status": "healthy" }
  }
}
```

## Usage Examples

### Adding Custom Metrics
```typescript
import { meter } from "@/lib/otel-server";

const customCounter = meter.createCounter("custom_operations_total", {
  description: "Total custom operations",
});

customCounter.add(1, { operation: "custom", status: "success" });
```

### Custom Tracing
```typescript
import { createSpan } from "@/lib/observability";

const result = await createSpan("custom.operation", async (span) => {
  span.setAttributes({ customAttribute: "value" });
  return await performOperation();
});
```

### Structured Logging
```typescript
import { observabilityLogger } from "@/lib/observability";

observabilityLogger.info("Operation completed", {
  operationId: "op-123",
  duration: 1500,
  result: "success"
});
```

## Deployment

### Development
1. Start OpenTelemetry Collector locally
2. Set environment variables
3. Run the application

### Production
1. Configure OTLP endpoint to point to your observability backend
2. Set authentication tokens
3. Adjust sampling rates for performance
4. Monitor resource usage

## Troubleshooting

### Common Issues

1. **No telemetry data**: Check OTLP endpoint configuration
2. **High memory usage**: Reduce batch sizes or sampling rate
3. **Missing traces**: Verify instrumentation initialization order
4. **Client errors**: Check browser console for CORS issues

### Debug Mode
Set `NODE_ENV=development` to enable:
- Debug logging
- Detailed error messages
- Additional instrumentation

## Integration with Observe

This setup is optimized for Observe.ai but works with any OpenTelemetry-compatible backend:

1. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your Observe endpoint
2. Configure authentication token
3. Verify data ingestion in Observe dashboard

## Performance Impact

The observability instrumentation is designed to be lightweight:
- Async export to avoid blocking requests
- Configurable sampling rates
- Minimal memory overhead
- Graceful degradation on errors

Monitor the `/api/health` endpoint to track observability system health.
