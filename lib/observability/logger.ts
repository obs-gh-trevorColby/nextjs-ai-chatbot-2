import winston from 'winston';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { nanoid } from 'nanoid';

// Environment configuration
const OBSERVE_ENDPOINT = process.env.OBSERVE_ENDPOINT || 'https://collect.observeinc.com';
const OBSERVE_API_KEY = process.env.OBSERVE_API_KEY;
const SERVICE_NAME = process.env.SERVICE_NAME || 'ai-chatbot';
const SERVICE_VERSION = process.env.SERVICE_VERSION || '3.1.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Log levels
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'silly'
}

// Log context interface
export interface LogContext {
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  operation?: string;
  component?: string;
  [key: string]: any;
}

// Enhanced log entry interface
export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: Error;
  metadata?: Record<string, any>;
  timestamp?: Date;
}

// Custom Winston format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    
    // Extract trace context
    const activeSpan = trace.getActiveSpan();
    const spanContext = activeSpan?.spanContext();
    
    const logEntry = {
      timestamp,
      level,
      message,
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: NODE_ENV,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      ...meta
    };

    return JSON.stringify(logEntry);
  })
);

// Create Winston logger instance
const createWinstonLogger = (): winston.Logger => {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: NODE_ENV === 'development' 
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : structuredFormat
    })
  ];

  // Add HTTP transport for Observe if API key is configured
  if (OBSERVE_API_KEY && OBSERVE_ENDPOINT) {
    transports.push(
      new winston.transports.Http({
        host: new URL(OBSERVE_ENDPOINT).hostname,
        port: new URL(OBSERVE_ENDPOINT).port || (new URL(OBSERVE_ENDPOINT).protocol === 'https:' ? 443 : 80),
        path: '/v1/http',
        ssl: new URL(OBSERVE_ENDPOINT).protocol === 'https:',
        headers: {
          'Authorization': `Bearer ${OBSERVE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        format: structuredFormat
      })
    );
  }

  return winston.createLogger({
    level: NODE_ENV === 'production' ? 'info' : 'debug',
    format: structuredFormat,
    defaultMeta: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: NODE_ENV
    },
    transports,
    exitOnError: false
  });
};

// Singleton logger instance
let loggerInstance: winston.Logger | null = null;

export const getLogger = (): winston.Logger => {
  if (!loggerInstance) {
    loggerInstance = createWinstonLogger();
  }
  return loggerInstance;
};

// Enhanced logging class with correlation and trace context
export class Logger {
  private winston: winston.Logger;
  private defaultContext: LogContext;

  constructor(component?: string, defaultContext: LogContext = {}) {
    this.winston = getLogger();
    this.defaultContext = {
      component,
      ...defaultContext
    };
  }

  private enrichContext(context: LogContext = {}): LogContext {
    const activeSpan = trace.getActiveSpan();
    const spanContext = activeSpan?.spanContext();
    
    return {
      ...this.defaultContext,
      ...context,
      traceId: context.traceId || spanContext?.traceId,
      spanId: context.spanId || spanContext?.spanId,
      correlationId: context.correlationId || nanoid()
    };
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error, metadata?: Record<string, any>) {
    const enrichedContext = this.enrichContext(context);
    
    const logData: any = {
      ...enrichedContext,
      ...metadata
    };

    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    this.winston.log(level, message, logData);

    // Also log to OpenTelemetry if available
    const logger = logs.getLogger(SERVICE_NAME, SERVICE_VERSION);
    if (logger) {
      logger.emit({
        severityText: level.toUpperCase(),
        body: message,
        attributes: logData,
        timestamp: Date.now()
      });
    }
  }

  error(message: string, error?: Error, context?: LogContext, metadata?: Record<string, any>) {
    this.log(LogLevel.ERROR, message, context, error, metadata);
    
    // Set span status to error if we have an active span
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && error) {
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });
      activeSpan.recordException(error);
    }
  }

  warn(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.log(LogLevel.WARN, message, context, undefined, metadata);
  }

  info(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.log(LogLevel.INFO, message, context, undefined, metadata);
  }

  http(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.log(LogLevel.HTTP, message, context, undefined, metadata);
  }

  debug(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.log(LogLevel.DEBUG, message, context, undefined, metadata);
  }

  verbose(message: string, context?: LogContext, metadata?: Record<string, any>) {
    this.log(LogLevel.VERBOSE, message, context, undefined, metadata);
  }

  // Convenience method for timing operations
  time(label: string, context?: LogContext): () => void {
    const start = Date.now();
    const enrichedContext = this.enrichContext(context);
    
    this.debug(`Timer started: ${label}`, enrichedContext);
    
    return () => {
      const duration = Date.now() - start;
      this.info(`Timer finished: ${label}`, enrichedContext, { duration });
    };
  }

  // Create child logger with additional context
  child(additionalContext: LogContext): Logger {
    return new Logger(
      this.defaultContext.component,
      { ...this.defaultContext, ...additionalContext }
    );
  }
}

// Default logger instance
export const logger = new Logger('app');

// Utility functions for common logging patterns
export const createRequestLogger = (requestId: string, userId?: string, sessionId?: string) => {
  return new Logger('request', { requestId, userId, sessionId });
};

export const createDatabaseLogger = (operation?: string) => {
  return new Logger('database', { operation });
};

export const createAILogger = (model?: string, operation?: string) => {
  return new Logger('ai', { model, operation });
};

// Configuration validation
export const validateObserveConfig = (): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!OBSERVE_API_KEY) {
    errors.push('OBSERVE_API_KEY environment variable is required');
  }
  
  if (!OBSERVE_ENDPOINT) {
    errors.push('OBSERVE_ENDPOINT environment variable is required');
  } else {
    try {
      new URL(OBSERVE_ENDPOINT);
    } catch {
      errors.push('OBSERVE_ENDPOINT must be a valid URL');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Export configuration for debugging
export const getObserveConfig = () => ({
  endpoint: OBSERVE_ENDPOINT,
  hasApiKey: !!OBSERVE_API_KEY,
  serviceName: SERVICE_NAME,
  serviceVersion: SERVICE_VERSION,
  environment: NODE_ENV
});
