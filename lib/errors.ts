import { Logger } from "./observability/logger";
import { trace, SpanStatusCode } from "@opentelemetry/api";

export type ErrorType =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "offline";

export type Surface =
  | "chat"
  | "auth"
  | "api"
  | "stream"
  | "database"
  | "history"
  | "vote"
  | "document"
  | "suggestions"
  | "activate_gateway";

export type ErrorCode = `${ErrorType}:${Surface}`;

export type ErrorVisibility = "response" | "log" | "none";

export const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  database: "log",
  chat: "response",
  auth: "response",
  stream: "response",
  api: "response",
  history: "response",
  vote: "response",
  document: "response",
  suggestions: "response",
  activate_gateway: "response",
};

export class ChatSDKError extends Error {
  type: ErrorType;
  surface: Surface;
  statusCode: number;
  errorCode: ErrorCode;
  context?: Record<string, any>;
  private logger: Logger;

  constructor(errorCode: ErrorCode, cause?: string, context?: Record<string, any>) {
    super();

    const [type, surface] = errorCode.split(":");

    this.type = type as ErrorType;
    this.cause = cause;
    this.surface = surface as Surface;
    this.errorCode = errorCode;
    this.context = context;
    this.message = getMessageByErrorCode(errorCode);
    this.statusCode = getStatusCodeByType(this.type);
    this.logger = new Logger('error-handler');

    // Log the error creation with full context
    this.logError();

    // Set span status if we have an active span
    this.setSpanError();
  }

  private logError(): void {
    const visibility = visibilityBySurface[this.surface];

    // Always log errors with full context for observability
    this.logger.error(`ChatSDKError: ${this.errorCode}`, this, {
      errorCode: this.errorCode,
      type: this.type,
      surface: this.surface,
      statusCode: this.statusCode,
      cause: this.cause,
      visibility,
      ...this.context
    });
  }

  private setSpanError(): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: this.message
      });
      activeSpan.recordException(this);
      activeSpan.setAttributes({
        'error.type': this.type,
        'error.surface': this.surface,
        'error.code': this.errorCode,
        'error.status_code': this.statusCode
      });
    }
  }

  // Enhanced method to add additional context after creation
  withContext(additionalContext: Record<string, any>): ChatSDKError {
    this.context = { ...this.context, ...additionalContext };

    // Re-log with additional context
    this.logger.error(`ChatSDKError updated with context: ${this.errorCode}`, this, {
      errorCode: this.errorCode,
      type: this.type,
      surface: this.surface,
      statusCode: this.statusCode,
      cause: this.cause,
      ...this.context
    });

    return this;
  }

  toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    // Log response generation
    this.logger.debug(`Generating error response for ${this.errorCode}`, {
      errorCode: this.errorCode,
      visibility,
      statusCode,
      willExposeDetails: visibility !== "log"
    });

    if (visibility === "log") {
      // For log-only errors, don't expose internal details
      return Response.json(
        { code: "", message: "Something went wrong. Please try again later." },
        { status: statusCode }
      );
    }

    return Response.json({ code, message, cause }, { status: statusCode });
  }
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  if (errorCode.includes("database")) {
    return "An error occurred while executing a database query.";
  }

  switch (errorCode) {
    case "bad_request:api":
      return "The request couldn't be processed. Please check your input and try again.";

    case "bad_request:activate_gateway":
      return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";

    case "unauthorized:auth":
      return "You need to sign in before continuing.";
    case "forbidden:auth":
      return "Your account does not have access to this feature.";

    case "rate_limit:chat":
      return "You have exceeded your maximum number of messages for the day. Please try again later.";
    case "not_found:chat":
      return "The requested chat was not found. Please check the chat ID and try again.";
    case "forbidden:chat":
      return "This chat belongs to another user. Please check the chat ID and try again.";
    case "unauthorized:chat":
      return "You need to sign in to view this chat. Please sign in and try again.";
    case "offline:chat":
      return "We're having trouble sending your message. Please check your internet connection and try again.";

    case "not_found:document":
      return "The requested document was not found. Please check the document ID and try again.";
    case "forbidden:document":
      return "This document belongs to another user. Please check the document ID and try again.";
    case "unauthorized:document":
      return "You need to sign in to view this document. Please sign in and try again.";
    case "bad_request:document":
      return "The request to create or update the document was invalid. Please check your input and try again.";

    default:
      return "Something went wrong. Please try again later.";
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limit":
      return 429;
    case "offline":
      return 503;
    default:
      return 500;
  }
}

// Utility functions for creating errors with context
export function createChatError(
  cause?: string,
  context?: Record<string, any>
): ChatSDKError {
  return new ChatSDKError("offline:chat", cause, context);
}

export function createDatabaseError(
  cause?: string,
  context?: Record<string, any>
): ChatSDKError {
  return new ChatSDKError("bad_request:database", cause, context);
}

export function createAuthError(
  type: "unauthorized" | "forbidden" = "unauthorized",
  cause?: string,
  context?: Record<string, any>
): ChatSDKError {
  return new ChatSDKError(`${type}:auth`, cause, context);
}

export function createAPIError(
  cause?: string,
  context?: Record<string, any>
): ChatSDKError {
  return new ChatSDKError("bad_request:api", cause, context);
}

export function createRateLimitError(
  surface: Surface = "chat",
  cause?: string,
  context?: Record<string, any>
): ChatSDKError {
  return new ChatSDKError(`rate_limit:${surface}`, cause, context);
}

// Global error handler for unhandled errors
export function handleUnexpectedError(
  error: unknown,
  context?: Record<string, any>
): ChatSDKError {
  const logger = new Logger('global-error-handler');

  if (error instanceof ChatSDKError) {
    // Already a ChatSDKError, just add context if provided
    return context ? error.withContext(context) : error;
  }

  if (error instanceof Error) {
    logger.error("Unexpected error occurred", error, context);
    return new ChatSDKError("offline:api", error.message, {
      originalError: error.name,
      stack: error.stack,
      ...context
    });
  }

  // Unknown error type
  logger.error("Unknown error type occurred", new Error(String(error)), context);
  return new ChatSDKError("offline:api", "An unknown error occurred", {
    originalError: String(error),
    ...context
  });
}
