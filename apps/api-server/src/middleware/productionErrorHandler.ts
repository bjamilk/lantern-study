import { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger';

// ============ CUSTOM ERROR CLASSES ============

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code: string = 'INTERNAL_ERROR',
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(404, `${resource} not found`, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(403, message, 'FORBIDDEN');
  }
}

export class ValidationError extends AppError {
  constructor(details: any) {
    super(400, 'Validation failed', 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(409, message, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super(429, 'Too many requests', 'RATE_LIMITED', { retryAfter });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request') {
    super(400, message, 'BAD_REQUEST');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(503, message, 'SERVICE_UNAVAILABLE');
  }
}

// ============ ASYNC HANDLER WRAPPER ============

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ============ GLOBAL ERROR HANDLER ============

export const globalErrorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = (req as any).requestId;
  const userId = (req as any).user?.userId || (req as any).user?.id;

  // Log the error
  logger.error(
    err.message,
    err,
    {
      requestId,
      userId,
      path: req.path,
      method: req.method,
      body: process.env.NODE_ENV !== 'production' ? req.body : undefined,
    }
  );

  // Handle known AppError types
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      details: err.details,
      requestId,
    });
  }

  // Handle Joi validation errors
  if (err.name === 'ValidationError' && 'details' in (err as any)) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: (err as any).details,
      requestId,
    });
  }

  // Handle Supabase/PostgreSQL errors
  if ('code' in err && typeof (err as any).code === 'string') {
    const supabaseError = err as any;
    
    // Row not found
    if (supabaseError.code === 'PGRST116') {
      return res.status(404).json({
        success: false,
        error: 'Resource not found',
        code: 'NOT_FOUND',
        requestId,
      });
    }
    
    // Unique constraint violation
    if (supabaseError.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'Resource already exists',
        code: 'CONFLICT',
        requestId,
      });
    }
    
    // Foreign key violation
    if (supabaseError.code === '23503') {
      return res.status(400).json({
        success: false,
        error: 'Referenced resource does not exist',
        code: 'FOREIGN_KEY_VIOLATION',
        requestId,
      });
    }
    
    // Permission denied
    if (supabaseError.code === '42501') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        code: 'FORBIDDEN',
        requestId,
      });
    }

    // RLS policy violation
    if (supabaseError.message?.includes('row-level security')) {
      return res.status(403).json({
        success: false,
        error: 'Access denied by security policy',
        code: 'RLS_VIOLATION',
        requestId,
      });
    }
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
      code: 'INVALID_TOKEN',
      requestId,
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token expired',
      code: 'TOKEN_EXPIRED',
      requestId,
    });
  }

  // Handle syntax errors (malformed JSON)
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON in request body',
      code: 'INVALID_JSON',
      requestId,
    });
  }

  // Default to 500 for unknown errors
  const statusCode = 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    code: 'INTERNAL_ERROR',
    requestId,
    ...(process.env.NODE_ENV !== 'production' && { 
      stack: err.stack,
      details: (err as any).details,
    }),
  });
};

// ============ 404 HANDLER ============

export const notFoundHandler = (req: Request, res: Response) => {
  const requestId = (req as any).requestId;
  
  logger.warn(`Route not found: ${req.method} ${req.path}`, { requestId });
  
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'ROUTE_NOT_FOUND',
    requestId,
  });
};

// ============ DATABASE ERROR HANDLER ============

export const databaseErrorHandler = (error: any): never => {
  if (error.code === 'PGRST116') {
    throw new NotFoundError();
  }
  if (error.code === '23505') {
    throw new ConflictError();
  }
  if (error.code === '23503') {
    throw new BadRequestError('Referenced resource does not exist');
  }
  if (error.code === '42501') {
    throw new ForbiddenError();
  }
  throw error;
};

// ============ VALIDATION ERROR HANDLER ============

export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  // This is a placeholder - actual validation happens in validateRequest middleware
  next();
};

// ============ SUPABASE ERROR HANDLER ============

export const supabaseErrorHandler = (error: any): never => {
  if (error.message?.includes('row-level security')) {
    throw new ForbiddenError('Access denied by security policy');
  }
  if (error.message?.includes('JWT')) {
    throw new UnauthorizedError('Invalid or expired token');
  }
  throw error;
};
