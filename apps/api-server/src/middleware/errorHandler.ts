/**
 * The global error-mapping convention for the API server.
 *
 * Exports, mounted in server.ts in this order after every route:
 * `databaseErrorHandler` → `supabaseErrorHandler` → `errorHandler`, with
 * `notFoundHandler` ahead of them. Also exports the `ApiError` class every
 * route throws, `asyncHandler` (the promise wrapper route handlers use),
 * `corsRejection`, and `rateLimitErrorHandler`.
 *
 * Convention: a route signals a client problem by throwing
 * `new ApiError(message, 4xx)` — `isOperational` true, message rendered to the
 * client verbatim. Anything else becomes a 500 with `isOperational=false`, and
 * in production the client sees only "Something went wrong". Upstream errors
 * carrying their own `status`/`statusCode` keep it, so a body-parser 413 stays
 * a 413 instead of surfacing as an opaque 500 on lecture uploads.
 *
 * An upstream 4xx that is not an ApiError keeps its status but, in production,
 * NOT its message — raw PostgREST text names columns, constraints and RLS
 * policies. `GENERIC_CLIENT_MESSAGES` supplies the replacement.
 *
 * Postgres and PostgREST codes are translated by `supabaseErrorHandler` before
 * the generic handler sees them: PGRST116 → 404, 23505 → 409, 42501 → 403,
 * PGRST301 (or any "connection" message) → 503, PGRST201 → 500. Everything else
 * falls through untouched and lands on the 500 branch.
 *
 * `corsRejection` returns a 403 rather than a bare Error on purpose: the Sentry
 * express handler files a status-less error as a 500, and the plain Error this
 * used to be produced 4.4k issues that were all dev servers pointed at prod.
 */
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

/**
 * What a production client is told for an upstream 4xx that arrived as a raw
 * error rather than an `ApiError`. Never the upstream text: a PostgREST 400
 * names the column, the constraint and the RLS policy it tripped, which is a
 * free schema map for anyone probing the API.
 */
const GENERIC_CLIENT_MESSAGES: Record<number, string> = {
  400: 'That request was not valid.',
  401: 'Please sign in and try again.',
  403: 'You do not have access to that.',
  404: 'Not found.',
  405: 'That action is not supported here.',
  409: 'That conflicts with something that already exists.',
  422: 'That request was not valid.',
  429: 'Too many requests. Please try again shortly.',
};

// Error response interface
interface ErrorResponse {
  error: string;
  message: string;
  /**
   * A stable, machine-readable identifier for the failure, when the thrown
   * error declares one. Added because two different idempotency outcomes —
   * "the same key is still in flight" and "the previous attempt with this key
   * failed" — were both a 409 whose only distinguishing mark was English prose,
   * which the F7b production message-genericising then replaced. Codes are NOT
   * genericised: they carry no column, constraint or policy names.
   *
   * Only an UPPER_SNAKE identifier is passed through, so a PostgREST/Postgres
   * code (`23505`, `PGRST201`) never leaks into the contract.
   */
  code?: string;
  details?: any;
  timestamp: string;
  path: string;
  requestId?: string;
}

/**
 * `code` is part of the API contract only when it looks like one: UPPER_SNAKE
 * with at least one underscore (ACCOUNT_SUSPENDED, IDEMPOTENCY_CONCURRENT).
 * The underscore is what keeps PostgREST's own codes out — `PGRST201` is
 * otherwise indistinguishable from an API code, and it names an internal
 * PostgREST condition rather than anything a client should branch on.
 */
const PUBLIC_ERROR_CODE_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function publicErrorCode(err: unknown): string | undefined {
  const raw = (err as { code?: unknown })?.code;
  return typeof raw === 'string' && raw.length <= 64 && PUBLIC_ERROR_CODE_RE.test(raw)
    ? raw
    : undefined;
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
    // FIXED (F7b): `err.message` used to be passed straight through for any
    // upstream 4xx — the isProductionEnv() guard below covers only the 5xx
    // branch — so a PostgREST or Postgres 4xx reached production clients with its
    // raw text: column names, constraint names and RLS policy names included.
    //
    // This branch is only ever reached by errors that are NOT ApiError, i.e. raw
    // upstream throws. A route that wants its message shown to the user throws
    // `new ApiError(message, 4xx)`, which is returned untouched above. So the
    // message is safe to replace here, and in production it is.
    } else if (statusFromErr && statusFromErr >= 400 && statusFromErr < 500) {
      const upstreamMessage = isProductionEnv()
        ? GENERIC_CLIENT_MESSAGES[statusFromErr] || 'Request could not be completed'
        : err.message || 'Bad request';
      error = new ApiError(upstreamMessage, statusFromErr, true);
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

  // Send error response. The code is read off the ORIGINAL thrown error, not
  // the ApiError this handler may have substituted for it above.
  const code = publicErrorCode(err) ?? publicErrorCode(apiError);
  const errorResponse: ErrorResponse = {
    error: apiError.name || 'Error',
    message: clientMessage,
    ...(code ? { code } : {}),
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

// ============ Terminal and specialised handlers ============

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

/**
 * Translates PostgREST and Postgres error codes into ApiErrors. Mounted before
 * `errorHandler`; anything it does not recognise is forwarded unchanged.
 */
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
    // NOT a foreign key violation (that is 23503). PGRST201 is PostgREST's
    // AMBIGUOUS EMBEDDING: the query embedded a table we have more than one
    // foreign key to, without naming which constraint to resolve through.
    // That is a bug in OUR query, not in the client's request — the fix is to
    // write `other!this_table_column_fkey(...)` at the call site. See
    // services/postgrestEmbedDisambiguation.test.ts for the 2026-09-08 roster
    // outage this caused.
    //
    // It is a 500, not a 400. A client cannot cause or fix an ambiguous embed,
    // so a 400 both blames the student's request and — because 5xx is what our
    // alerting watches — hid the outage until a manual device pass found it.
    // isOperational=false marks it a genuine server fault (same path as an
    // unhandled 500): errorHandler renders 'Something went wrong' to students
    // instead of leaking 'Invalid reference or relationship', and the shared
    // request-failure vocabulary maps the 5xx to its own "this one is on our
    // side" copy. The Sentry express handler (registered before this one in
    // server.ts) already reports the raw status-less throw; the status change
    // here is what moves the FAILED RESPONSE into 5xx alerting.
    const apiError = new ApiError('Something went wrong', 500, false);
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