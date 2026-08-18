import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { isProductionEnv, redactForLog } from '../utils/safeError';

// Custom error class for API errors
export class ApiError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * A request from an origin outside the allowlist. Carries 403 deliberately:
 * the Sentry express handler treats a status-less error as a 500 and reports
 * it, so the plain Error this used to be filed 4.4k issues — every one of them
 * a dev server (localhost:5173) pointed at the production API, none of them a
 * server fault. A rejected origin is the caller's mistake, so say 403 and stay
 * out of the error budget.
 */
export function corsRejection(): ApiError {
  return new ApiError('Not allowed by CORS', 403);
}

// Error response interface
interface ErrorResponse {
  error: string;
  message: string;
  details?: any;
  timestamp: string;
  path: string;
  requestId?: string;
}

// Global error handler middleware
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let error = err;

  // Log the error (redact sensitive body fields in production)
  const logMeta: Record<string, unknown> = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    params: req.params,
    query: req.query,
  };
  if (isProductionEnv()) {
    logMeta.body = redactForLog(req.body);
  } else {
    logMeta.body = req.body;
    logMeta.rawBody = (req as any).rawBody;
  }
  logger.error('Error occurred:', logMeta);

  // Handle specific error types
  if (err.name === 'ValidationError') {
    // Mongoose validation error
    const apiError = new ApiError('Validation Error', 400);
    apiError.message = Object.values((err as any).errors)
      .map((e: any) => e.message)
      .join(', ');
    error = apiError;
  } else if (err.name === 'CastError') {
    // Mongoose bad ObjectId
    const apiError = new ApiError('Invalid ID format', 400);
    error = apiError;
  } else if ((err as any).code === 11000) {
    // MongoDB duplicate key error
    const apiError = new ApiError('Duplicate field value entered', 400);
    error = apiError;
  } else if (err.name === 'JsonWebTokenError') {
    // JWT error
    const apiError = new ApiError('Invalid token', 401);
    error = apiError;
  } else if (err.name === 'TokenExpiredError') {
    // JWT expired
    const apiError = new ApiError('Token expired', 401);
    error = apiError;
  }

  // Default to ApiError if not already one. Preserve body-parser / HTTP status codes
  // (e.g. 413 entity too large) so lecture uploads do not surface as opaque 500s.
  if (!(error instanceof ApiError)) {
    const statusFromErr =
      typeof (err as unknown as { status?: unknown }).status === 'number'
        ? Number((err as unknown as { status: number }).status)
        : typeof (err as unknown as { statusCode?: unknown }).statusCode === 'number'
          ? Number((err as unknown as { statusCode: number }).statusCode)
          : undefined;
    if (statusFromErr === 413 || /entity too large|payload.*large/i.test(err.message || '')) {
      error = new ApiError(
        'Recording is too large to upload. Try a shorter clip (under ~20 minutes).',
        413,
        true
      );
    } else if (statusFromErr && statusFromErr >= 400 && statusFromErr < 500) {
      error = new ApiError(err.message || 'Bad request', statusFromErr, true);
    } else {
      const publicMessage = isProductionEnv()
        ? 'Something went wrong'
        : (err.message || 'Something went wrong');
      error = new ApiError(publicMessage, statusFromErr && statusFromErr >= 500 ? statusFromErr : 500, false);
    }
  }

  const apiError = error as ApiError;
  const clientMessage = isProductionEnv() && apiError.statusCode >= 500 && !apiError.isOperational
    ? 'Something went wrong'
    : apiError.message;

  // Send error response
  const errorResponse: ErrorResponse = {
    error: apiError.name || 'Error',
    message: clientMessage,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    requestId: (req as any).requestId,
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.details = {
      stack: apiError.stack,
      ...((apiError as any).details || {}),
    };
  }

  res.status(apiError.statusCode).json(errorResponse);
};

// 404 handler
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const error = new ApiError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

// Async error wrapper
export const asyncHandler = (fn: Function) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  (async () => {
    await fn(req, res, next);
  })().catch(next);
};

// Rate limit error handler
export const rateLimitErrorHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  res.status(429).json({
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
};

// Database connection error handler
export const databaseErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (err.code === 'PGRST301' || err.message?.includes('connection')) {
    logger.error('Database connection error:', err);
    const apiError = new ApiError('Database connection failed', 503);
    next(apiError);
  } else {
    next(err);
  }
};

// Supabase specific error handler
export const supabaseErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Handle Supabase specific errors
  if (err.code === 'PGRST116') {
    // Row not found
    const apiError = new ApiError('Resource not found', 404);
    next(apiError);
  } else if (err.code === 'PGRST201') {
    // Foreign key violation
    const apiError = new ApiError('Invalid reference or relationship', 400);
    next(apiError);
  } else if (err.code === '23505') {
    // Unique violation
    const apiError = new ApiError('Resource already exists', 409);
    next(apiError);
  } else if (err.code === '42501') {
    // Insufficient privilege
    const apiError = new ApiError('Access denied', 403);
    next(apiError);
  } else {
    next(err);
  }
};