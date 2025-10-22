# Observability and Logging Guide

This document provides comprehensive information about the observability and logging capabilities integrated into the AI Chatbot application using Observe.com.

## Overview

The application includes extensive instrumentation for monitoring, logging, and tracing across all major components:

- **Request/Response Lifecycle**: Complete tracking of HTTP requests from middleware to response
- **AI Operations**: Detailed monitoring of model interactions, token usage, and performance
- **Database Operations**: Query performance, connection health, and data access patterns
- **Error Handling**: Structured error logging with context and stack traces
- **User Interactions**: Authentication, authorization, and user behavior tracking

## Architecture

### Logging Components

1. **Centralized Logger** (`lib/observability/logger.ts`)
   - Winston-based structured logging
   - OpenTelemetry integration for trace correlation
   - Environment-based configuration
   - Child logger creation for component-specific logging

2. **Request Middleware** (`lib/observability/middleware.ts`)
   - Request/response logging with timing
   - Performance monitoring utilities
   - Correlation ID generation and propagation

3. **AI Instrumentation** (`lib/observability/ai-instrumentation.ts`)
   - AI operation tracking and metrics
   - Token usage and cost monitoring
   - Prompt/response logging (configurable)

4. **Database Instrumentation** (`lib/db/queries.ts`)
   - Query performance monitoring
   - Connection health tracking
   - Operation-specific logging

5. **Error Enhancement** (`lib/errors.ts`)
   - Enhanced ChatSDKError with structured logging
   - OpenTelemetry span error correlation
   - Context-aware error reporting

## Configuration

### Environment Variables

```bash
# Required for Observe integration
OBSERVE_API_KEY=your_api_key_here
OBSERVE_ENDPOINT=https://collect.observeinc.com

# Optional service identification
SERVICE_NAME=ai-chatbot
SERVICE_VERSION=3.1.0

# Environment affects log levels and behavior
NODE_ENV=production|development|test
```

### Log Levels

- **Production**: INFO and above
- **Development**: DEBUG and above
- **Test**: WARN and above

### Configuration Validation

The application automatically validates configuration on startup:

```typescript
import { validateAndLogConfig } from './lib/observability/config';

// Call during application startup
validateAndLogConfig();
```

## Usage Examples

### Creating Component-Specific Loggers

```typescript
import { Logger, createAILogger, createDatabaseLogger } from './lib/observability/logger';

// General component logger
const logger = new Logger('my-component');

// Specialized loggers
const aiLogger = createAILogger('gpt-4', 'chat-completion');
const dbLogger = createDatabaseLogger('user-queries');
```

### Request-Scoped Logging

```typescript
import { createRequestScopedLogger } from './lib/observability/middleware';

export async function POST(request: Request) {
  const logger = createRequestScopedLogger(request);
  
  logger.info('Processing chat request', {
    userId: session.user.id,
    model: selectedModel
  });
}
```

### AI Operation Instrumentation

```typescript
import { createAIInstrumentationLogger } from './lib/observability/ai-instrumentation';

const aiLogger = createAIInstrumentationLogger('gpt-4', 'chat-completion');

const result = await aiLogger.instrumentAIOperation(
  'chat-completion',
  { userId, chatId, model: 'gpt-4' },
  async () => {
    return await streamText({ model, messages });
  },
  (result) => ({
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens
  })
);
```

### Database Operation Logging

```typescript
// Database operations are automatically instrumented
const user = await getUser(email); // Automatically logged with timing

// Manual instrumentation for custom operations
const result = await withDatabaseLogging(
  'complex-query',
  async () => {
    return await db.select().from(users).where(complex_condition);
  },
  { queryType: 'complex', userId }
);
```

### Error Handling with Context

```typescript
import { ChatSDKError } from './lib/errors';

// Create error with context
throw new ChatSDKError('bad_request:api', 'Invalid input', {
  userId: session.user.id,
  requestId,
  inputData: sanitizedInput
});

// Add context to existing error
const error = new ChatSDKError('offline:chat');
throw error.withContext({ chatId, model, retryCount });
```

## Log Structure

### Standard Log Fields

All logs include these standard fields:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "User authenticated",
  "service": "ai-chatbot",
  "version": "3.1.0",
  "environment": "production",
  "traceId": "abc123...",
  "spanId": "def456...",
  "correlationId": "xyz789..."
}
```

### Component-Specific Fields

**Request Logs:**
```json
{
  "requestId": "req_123",
  "method": "POST",
  "url": "/api/chat",
  "statusCode": 200,
  "responseTime": 1250,
  "userId": "user_456"
}
```

**AI Operation Logs:**
```json
{
  "operation": "chat-completion",
  "model": "gpt-4",
  "promptTokens": 150,
  "completionTokens": 75,
  "totalTokens": 225,
  "duration": 2300,
  "tokensPerSecond": 97.8
}
```

**Database Logs:**
```json
{
  "operation": "get-user",
  "duration": 45,
  "userId": "user_456",
  "queryType": "select"
}
```

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Response Times**
   - API endpoint response times
   - Database query performance
   - AI model response times

2. **Error Rates**
   - HTTP error rates by endpoint
   - Database connection errors
   - AI model failures

3. **Usage Metrics**
   - Token consumption by model
   - Request volume by user
   - Feature usage patterns

4. **System Health**
   - Memory usage
   - Database connection pool status
   - External API availability

### Recommended Alerts

- Response time > 5 seconds for chat endpoints
- Error rate > 5% for any component
- Token usage exceeding budget thresholds
- Database connection failures
- Authentication failures spike

## Troubleshooting

### Common Issues

**No logs appearing in Observe:**
1. Verify `OBSERVE_API_KEY` and `OBSERVE_ENDPOINT` are set
2. Check network connectivity to Observe endpoint
3. Ensure API key has correct permissions
4. Review application startup logs for configuration errors

**High log volume:**
1. Adjust log levels in production (`NODE_ENV=production`)
2. Configure log sampling for high-traffic endpoints
3. Review debug logging in production code

**Missing trace correlation:**
1. Ensure OpenTelemetry is properly initialized
2. Check that spans are being created correctly
3. Verify trace context propagation

**Performance impact:**
1. Logging is asynchronous and batched
2. Monitor application performance metrics
3. Adjust batch sizes if needed

### Debug Mode

Enable debug logging for troubleshooting:

```bash
NODE_ENV=development
```

This will:
- Enable DEBUG level logging
- Log full prompt/response pairs
- Include additional diagnostic information
- Provide more verbose error messages

## Best Practices

1. **Use Structured Logging**: Always include relevant context in log messages
2. **Correlation IDs**: Ensure all related operations share correlation IDs
3. **Error Context**: Include sufficient context for debugging errors
4. **Performance Monitoring**: Log timing information for critical operations
5. **Security**: Never log sensitive information like passwords or API keys
6. **Log Levels**: Use appropriate log levels for different types of information
7. **Batch Operations**: Use batch logging for high-volume operations

## Integration with CI/CD

The observability setup integrates well with CI/CD pipelines:

- Configuration validation prevents deployment with invalid settings
- Structured logs enable automated log analysis
- Metrics can trigger deployment rollbacks
- Trace data helps identify deployment issues

For production deployments, ensure:
- `OBSERVE_API_KEY` is securely stored
- Log levels are appropriate for production
- Monitoring alerts are configured
- Log retention policies are set
