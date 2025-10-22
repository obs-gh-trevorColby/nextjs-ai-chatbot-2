import { trace, SpanStatusCode } from '@opentelemetry/api';
import { createAILogger, Logger } from './logger';
import { nanoid } from 'nanoid';

// AI operation types
export type AIOperation = 
  | 'chat-completion'
  | 'title-generation'
  | 'document-creation'
  | 'document-update'
  | 'weather-query'
  | 'suggestions-request'
  | 'reasoning';

// AI model performance metrics
export interface AIMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  duration?: number;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopReason?: string;
  finishReason?: string;
}

// AI operation context
export interface AIContext {
  operationId?: string;
  userId?: string;
  chatId?: string;
  messageId?: string;
  model?: string;
  operation?: AIOperation;
  promptLength?: number;
  responseLength?: number;
  tools?: string[];
  [key: string]: any;
}

// Enhanced AI logger with operation tracking
export class AIInstrumentationLogger {
  private logger: Logger;
  private tracer = trace.getTracer('ai-chatbot-ai-operations');

  constructor(model?: string, operation?: AIOperation) {
    this.logger = createAILogger(model, operation);
  }

  // Log AI operation start
  logOperationStart(
    operation: AIOperation,
    context: AIContext,
    prompt?: string
  ): string {
    const operationId = context.operationId || nanoid();
    
    this.logger.info(`AI operation started: ${operation}`, {
      ...context,
      operationId,
      promptLength: prompt?.length,
      promptPreview: prompt ? this.truncateText(prompt, 200) : undefined
    });

    return operationId;
  }

  // Log AI operation completion
  logOperationComplete(
    operation: AIOperation,
    operationId: string,
    context: AIContext,
    metrics: AIMetrics,
    response?: string
  ): void {
    this.logger.info(`AI operation completed: ${operation}`, {
      ...context,
      operationId,
      ...metrics,
      responseLength: response?.length,
      responsePreview: response ? this.truncateText(response, 200) : undefined,
      tokensPerSecond: metrics.duration && metrics.totalTokens 
        ? Math.round((metrics.totalTokens / metrics.duration) * 1000)
        : undefined
    });
  }

  // Log AI operation error
  logOperationError(
    operation: AIOperation,
    operationId: string,
    context: AIContext,
    error: Error,
    metrics?: Partial<AIMetrics>
  ): void {
    this.logger.error(`AI operation failed: ${operation}`, error, {
      ...context,
      operationId,
      ...metrics
    });
  }

  // Log token usage and costs
  logTokenUsage(
    model: string,
    metrics: AIMetrics,
    context?: AIContext
  ): void {
    this.logger.info('AI token usage', {
      ...context,
      model,
      ...metrics,
      efficiency: metrics.completionTokens && metrics.promptTokens
        ? Math.round((metrics.completionTokens / metrics.promptTokens) * 100) / 100
        : undefined
    });
  }

  // Log prompt/response pairs for debugging
  logPromptResponse(
    operation: AIOperation,
    prompt: string,
    response: string,
    context: AIContext,
    metrics?: AIMetrics
  ): void {
    // Only log full prompt/response in development
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    this.logger.debug(`AI prompt/response for ${operation}`, {
      ...context,
      prompt: isDevelopment ? prompt : this.truncateText(prompt, 500),
      response: isDevelopment ? response : this.truncateText(response, 500),
      promptLength: prompt.length,
      responseLength: response.length,
      ...metrics
    });
  }

  // Wrapper for AI operations with automatic instrumentation
  async instrumentAIOperation<T>(
    operation: AIOperation,
    context: AIContext,
    aiFunction: () => Promise<T>,
    extractMetrics?: (result: T) => AIMetrics,
    extractResponse?: (result: T) => string
  ): Promise<T> {
    const operationId = nanoid();
    const spanName = `ai-${operation}`;
    
    return this.tracer.startActiveSpan(spanName, async (span) => {
      const startTime = Date.now();
      
      try {
        // Set span attributes
        span.setAttributes({
          'ai.operation': operation,
          'ai.operation_id': operationId,
          'ai.model': context.model || 'unknown',
          'ai.user_id': context.userId || 'unknown',
          'ai.chat_id': context.chatId || 'unknown',
          ...context
        });

        this.logOperationStart(operation, { ...context, operationId });

        // Execute AI operation
        const result = await aiFunction();
        const duration = Date.now() - startTime;

        // Extract metrics and response if provided
        const metrics: AIMetrics = {
          duration,
          ...(extractMetrics ? extractMetrics(result) : {})
        };

        const response = extractResponse ? extractResponse(result) : undefined;

        // Log completion
        this.logOperationComplete(operation, operationId, context, metrics, response);

        // Update span with metrics
        span.setAttributes({
          'ai.duration': duration,
          'ai.prompt_tokens': metrics.promptTokens || 0,
          'ai.completion_tokens': metrics.completionTokens || 0,
          'ai.total_tokens': metrics.totalTokens || 0
        });

        span.setStatus({ code: SpanStatusCode.OK });
        return result;

      } catch (error) {
        const duration = Date.now() - startTime;
        const err = error as Error;

        this.logOperationError(operation, operationId, context, err, { duration });

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

  // Utility to truncate text for logging
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}

// Factory function for creating AI instrumentation loggers
export function createAIInstrumentationLogger(
  model?: string, 
  operation?: AIOperation
): AIInstrumentationLogger {
  return new AIInstrumentationLogger(model, operation);
}

// Utility functions for common AI logging patterns
export function logModelSelection(
  selectedModel: string,
  availableModels: string[],
  context?: AIContext
): void {
  const logger = createAILogger('model-selector');
  logger.info('AI model selected', {
    ...context,
    selectedModel,
    availableModels,
    modelCount: availableModels.length
  });
}

export function logToolUsage(
  tools: string[],
  activeTools: string[],
  context?: AIContext
): void {
  const logger = createAILogger('tools');
  logger.info('AI tools configuration', {
    ...context,
    availableTools: tools,
    activeTools,
    toolCount: tools.length,
    activeToolCount: activeTools.length
  });
}

export function logStreamingStart(
  model: string,
  messageCount: number,
  context?: AIContext
): void {
  const logger = createAILogger(model, 'chat-completion');
  logger.info('AI streaming started', {
    ...context,
    model,
    messageCount,
    streaming: true
  });
}

export function logStreamingComplete(
  model: string,
  metrics: AIMetrics,
  context?: AIContext
): void {
  const logger = createAILogger(model, 'chat-completion');
  logger.info('AI streaming completed', {
    ...context,
    model,
    ...metrics,
    streaming: true
  });
}

// Export singleton instance
export const aiInstrumentation = new AIInstrumentationLogger();
