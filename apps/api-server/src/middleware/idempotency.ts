/**
 * Per-route idempotency wiring for side-effectful mutations (marketplace
 * orders, payment initialisation, credit spends).
 *
 * Exports `idempotencyMiddleware(options)`, which attaches
 * `req.idempotencyKey` and `req.runIdempotent(handler)`, and
 * `setIdempotencyClient` for server bootstrap. The middleware itself is only
 * plumbing: the replay store lives in `services/idempotency`, which persists
 * `(user_id, operation, key)` and the recorded response in Supabase.
 *
 * Key resolution: the `Idempotency-Key` request header first, then the route's
 * `fallbackKey(req)` if it has one. With `requireKey` the route 400s when
 * neither yields a key.
 *
 * Contract: `runIdempotent` is a no-op passthrough for an unauthenticated
 * request (no user to scope the key to) and for a null key, so a handler must
 * not treat being wrapped as a guarantee of replay protection. CAS PATCHes
 * should not use this — they are already idempotent by version check.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { normalizeIdempotencyKey, withIdempotency } from '../services/idempotency';

export type IdempotencyMiddlewareOptions = {
  operation: string;
  requireKey?: boolean;
  /** Used when Idempotency-Key header is absent (legacy windowed keys). */
  fallbackKey?: (req: Request) => string | null;
  /**
   * Passed straight to `withIdempotency` (#117). Opt IN only for a route whose
   * handler can run a second time after a crash without duplicating anything —
   * see the per-caller table in `docs/idempotency-lease.md`. Left out, an
   * abandoned claim is retired rather than replayed.
   */
  leaseReclaim?: boolean;
};

export type IdempotentRequest = Request & {
  user?: { id?: string; [key: string]: unknown };
  idempotencyKey?: string | null;
  runIdempotent?: <T extends Record<string, unknown>>(handler: () => Promise<T>) => Promise<T>;
};

let clientFactory: (() => SupabaseClient) | null = null;

/** Call once from server bootstrap, after the data layer is built. */
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
      return withIdempotency(getServiceClient(), userId, options.operation, key, handler, {
        leaseReclaim: options.leaseReclaim,
      });
    };

    next();
  };
}

export { normalizeIdempotencyKey, withIdempotency };
