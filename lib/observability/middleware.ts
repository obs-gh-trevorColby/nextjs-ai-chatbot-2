import { NextRequest, NextResponse } from 'next/server';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { Logger, LogContext } from './logger';
import { nanoid } from 'nanoid';

// Request/Response logging middleware
export interface RequestLogContext extends LogContext {
  method?: string;
  url?: string;
  userAgent?: string;
  ip?: string;
  statusCode?: number;
  responseTime?: number;
  requestSize?: number;
  responseSize?: number;
}

export class RequestLogger {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('middleware');
  }

  // Log incoming request
  logRequest(request: NextRequest, requestId: string): void {
    const context: RequestLogContext = {
      requestId,
      method: request.method,
      url: request.url,
      userAgent: request.headers.get('user-agent') || undefined,
      ip: request.ip || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
      requestSize: this.getContentLength(request.headers)
    };

    this.logger.http('Incoming request', context);
  }

  // Log outgoing response
  logResponse(
    request: NextRequest, 
    response: NextResponse, 
    requestId: string, 
    startTime: number,
    error?: Error
  ): void {
    const responseTime = Date.now() - startTime;
    const statusCode = response.status;

    const context: RequestLogContext = {
      requestId,
      method: request.method,
      url: request.url,
      statusCode,
      responseTime,
      responseSize: this.getContentLength(response.headers)
    };

    const level = this.getLogLevel(statusCode);
    const message = `${request.method} ${request.url} ${statusCode} - ${responseTime}ms`;

    if (error) {
      this.logger.error(message, error, context);
    } else {
      this.logger[level](message, context);
    }
  }

  // Log API route performance
  logApiRoute(
    route: string,
    method: string,
    statusCode: number,
    responseTime: number,
    requestId: string,
    userId?: string,
    error?: Error
  ): void {
    const context: RequestLogContext = {
      requestId,
      userId,
      method,
      url: route,
      statusCode,
      responseTime
    };

    const message = `API ${method} ${route} ${statusCode} - ${responseTime}ms`;

    if (error) {
      this.logger.error(message, error, context);
    } else {
      const level = this.getLogLevel(statusCode);
      this.logger[level](message, context);
    }
  }

  private getContentLength(headers: Headers): number | undefined {
    const contentLength = headers.get('content-length');
    return contentLength ? parseInt(contentLength, 10) : undefined;
  }

  private getLogLevel(statusCode: number): 'info' | 'warn' | 'error' {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }
}

// Middleware wrapper for API routes
export function withRequestLogging<T extends any[], R>(
  handler: (...args: T) => Promise<R>,
  routeName?: string
) {
  return async (...args: T): Promise<R> => {
    const requestId = nanoid();
    const startTime = Date.now();
    const requestLogger = new RequestLogger();
    
    // Create a span for this request
    const tracer = trace.getTracer('ai-chatbot-middleware');
    
    return tracer.startActiveSpan(`${routeName || 'api-route'}`, async (span) => {
      try {
        // Add request ID to span attributes
        span.setAttributes({
          'request.id': requestId,
          'request.route': routeName || 'unknown'
        });

        // Execute the handler
        const result = await handler(...args);
        
        // Log successful completion
        const responseTime = Date.now() - startTime;
        requestLogger.logApiRoute(
          routeName || 'unknown',
          'unknown',
          200,
          responseTime,
          requestId
        );

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        const err = error as Error;
        
        // Log error
        requestLogger.logApiRoute(
          routeName || 'unknown',
          'unknown',
          500,
          responseTime,
          requestId,
          undefined,
          err
        );

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message
        });
        span.recordException(err);
        
        throw error;
      } finally {
        span.end();
      }
    });
  };
}

// Utility to extract user context from request
export function extractUserContext(request: NextRequest): { userId?: string; sessionId?: string } {
  // This would typically extract from JWT token or session
  // For now, we'll extract from headers if available
  const userId = request.headers.get('x-user-id') || undefined;
  const sessionId = request.headers.get('x-session-id') || undefined;
  
  return { userId, sessionId };
}

// Create request-scoped logger
export function createRequestScopedLogger(request: NextRequest, requestId?: string): Logger {
  const id = requestId || nanoid();
  const { userId, sessionId } = extractUserContext(request);
  
  return new Logger('request', {
    requestId: id,
    userId,
    sessionId,
    method: request.method,
    url: request.url
  });
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private logger: Logger;
  private timers: Map<string, number> = new Map();

  constructor(component: string) {
    this.logger = new Logger(component);
  }

  startTimer(operation: string, context?: LogContext): void {
    const key = `${operation}-${nanoid()}`;
    this.timers.set(key, Date.now());
    this.logger.debug(`Started ${operation}`, { ...context, operation });
  }

  endTimer(operation: string, context?: LogContext): number {
    const keys = Array.from(this.timers.keys()).filter(k => k.startsWith(operation));
    if (keys.length === 0) {
      this.logger.warn(`No timer found for operation: ${operation}`);
      return 0;
    }

    const key = keys[keys.length - 1]; // Get the most recent timer
    const startTime = this.timers.get(key);
    if (!startTime) return 0;

    const duration = Date.now() - startTime;
    this.timers.delete(key);

    this.logger.info(`Completed ${operation}`, { 
      ...context, 
      operation, 
      duration 
    });

    return duration;
  }

  measureAsync<T>(
    operation: string, 
    fn: () => Promise<T>, 
    context?: LogContext
  ): Promise<T> {
    return trace.getTracer('ai-chatbot-performance').startActiveSpan(operation, async (span) => {
      const startTime = Date.now();
      
      try {
        span.setAttributes({
          'operation.name': operation,
          ...context
        });

        this.logger.debug(`Starting ${operation}`, context);
        
        const result = await fn();
        const duration = Date.now() - startTime;
        
        this.logger.info(`Completed ${operation}`, { 
          ...context, 
          operation, 
          duration 
        });

        span.setAttributes({ 'operation.duration': duration });
        span.setStatus({ code: SpanStatusCode.OK });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const err = error as Error;
        
        this.logger.error(`Failed ${operation}`, err, { 
          ...context, 
          operation, 
          duration 
        });

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message
        });
        span.recordException(err);
        
        throw error;
      } finally {
        span.end();
      }
    });
  }
}

// Export singleton instances
export const requestLogger = new RequestLogger();
export const performanceMonitor = new PerformanceMonitor('app');
