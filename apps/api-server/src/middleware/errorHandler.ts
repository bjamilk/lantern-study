import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

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

  // Log the error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    rawBody: (req as any).rawBody,
    params: req.params,
    query: req.query,
  });

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

  // Default to ApiError if not already one
  if (!(error instanceof ApiError)) {
    error = new ApiError(error.message || 'Something went wrong', 500, false);
  }

  const apiError = error as ApiError;

  // Send error response
  const errorResponse: ErrorResponse = {
    error: apiError.name || 'Error',
    message: apiError.message,
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