import { Request, Response, NextFunction } from 'express';

/**
 * Request timeout middleware
 * Prevents hanging requests from consuming server resources
 *
 * @param timeoutMs - Timeout in milliseconds (default: 30000 = 30 seconds)
 */
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Set request timeout
    req.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        console.warn(`Request timeout (${timeoutMs}ms): ${req.method} ${req.originalUrl}`);
        res.status(408).json({
          error: 'Request Timeout',
          message: `Request took too long to process (>${timeoutMs}ms)`,
        });
      }
    });

    // Set response timeout (for slow clients)
    res.setTimeout(timeoutMs + 5000, () => {
      if (!res.headersSent) {
        console.warn(`Response timeout: ${req.method} ${req.originalUrl}`);
        res.status(408).json({
          error: 'Request Timeout',
          message: 'Response took too long to send',
        });
      }
    });

    next();
  };
};

/**
 * Short timeout for simple operations (10 seconds)
 */
export const shortTimeout = requestTimeout(10000);

/**
 * Default timeout for most operations (30 seconds)
 */
export const defaultTimeout = requestTimeout(30000);

/**
 * Long timeout for batch operations or file uploads (60 seconds)
 */
export const longTimeout = requestTimeout(60000);

/**
 * Extended timeout for AI/generation operations (120 seconds)
 */
export const extendedTimeout = requestTimeout(120000);

/**
 * Gotenberg slide conversion can exceed 30s on cold start (wake + large decks).
 * Render's HTTP proxy times out around 100s — keep under that in noteFiles.ts retries.
 */
export const presentationTimeout = requestTimeout(180000);

/** Routes that need no default timeout cap (upload, transcribe, PPT preview). */
export const LONG_RUNNING_NOTE_PATH =
  /^\/api\/v1\/notes\/(transcribe-audio|upload-pdf|upload-presentation|finalize-pdf|finalize-presentation|[^/]+\/regenerate-preview)$/;

export const skipTimeoutForLongRunningNotes = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (LONG_RUNNING_NOTE_PATH.test(req.path)) {
    next();
    return;
  }
  defaultTimeout(req, res, next);
};
