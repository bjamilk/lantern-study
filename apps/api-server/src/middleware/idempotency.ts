import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { normalizeIdempotencyKey, withIdempotency } from '../services/idempotency';

export type IdempotencyMiddlewareOptions = {
  operation: string;
  requireKey?: boolean;
  /** Used when Idempotency-Key header is absent (legacy windowed keys). */
  fallbackKey?: (req: Request) => string | null;
};

export type IdempotentRequest = Request & {
  user?: { id?: string; [key: string]: unknown };
  idempotencyKey?: string | null;
  runIdempotent?: <T extends Record<string, unknown>>(handler: () => Promise<T>) => Promise<T>;
};

let clientFactory: (() => SupabaseClient) | null = null;

/** Call once from server bootstrap after SupabaseService is constructed. */
export function setIdempotencyClient(factory: () => SupabaseClient): void {
  clientFactory = factory;
}

function getServiceClient(): SupabaseClient {
  if (!clientFactory) {
    throw new Error('Idempotency middleware not initialized (setIdempotencyClient)');
  }
  return clientFactory();
}

/**
 * Attaches `req.runIdempotent(handler)` backed by `withIdempotency`.
 * Side-effectful money/create mutations should use this; CAS PATCHes should not.
 */
export function idempotencyMiddleware(options: IdempotencyMiddlewareOptions) {
  return (req: IdempotentRequest, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    let key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key && options.fallbackKey) {
      key = options.fallbackKey(req);
    }

    if (!key && options.requireKey) {
      res.status(400).json({
        success: false,
        error: 'Idempotency-Key header is required',
      });
      return;
    }

    req.idempotencyKey = key;
    req.runIdempotent = async <T extends Record<string, unknown>>(handler: () => Promise<T>) => {
      if (!userId) {
        return handler();
      }
      return withIdempotency(getServiceClient(), userId, options.operation, key, handler);
    };

    next();
  };
}

export { normalizeIdempotencyKey, withIdempotency };
