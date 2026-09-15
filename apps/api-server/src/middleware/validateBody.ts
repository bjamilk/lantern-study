/**
 * Body-shape guard: rejects JSON bodies that are nested too deeply or carry too
 * many keys, then strips prototype-polluting keys.
 *
 * Exports `validateBodyShape()` — mounted globally in server.ts inside
 * `startServer()`, immediately after `sanitizationMiddleware` and after
 * `anonymousIpRateLimit` — and `stripDangerousKeys` for direct use.
 *
 * Limits are per-path and env-overridable. The default write body is 100 keys
 * at depth 8; `/api/v1/tests/*` gets 20,000 keys at depth 14 (a completed test
 * session stores full question JSON); `/api/v1/offline-bundles/*` and
 * `/api/v1/marketplace/{question-banks,study-packs}/*` get 50,000 keys at depth
 * 14. Exceeding either limit is a 400 before the route runs, so a limit set too
 * low shows up to the user as a generic save failure — which is exactly how the
 * missing study-pack entry was found.
 *
 * Cost: a body that passes is walked more than once per request. `measureShape`
 * walks it, `stripDangerousKeys` walks it again, and the sanitiser mounted just
 * ahead of this has already walked and rebuilt it. Only the rate limiter in
 * front of all three bounds that work.
 */
import { Request, Response, NextFunction } from 'express';

const DEFAULT_MAX_KEYS = parseInt(process.env.REQUEST_BODY_MAX_KEYS || '100', 10);
const DEFAULT_MAX_DEPTH = parseInt(process.env.REQUEST_BODY_MAX_DEPTH || '8', 10);

/** Completed test sessions store full question JSON — much larger than typical API writes. */
const TEST_BODY_MAX_KEYS = parseInt(process.env.REQUEST_BODY_TEST_MAX_KEYS || '20000', 10);
const TEST_BODY_MAX_DEPTH = parseInt(process.env.REQUEST_BODY_TEST_MAX_DEPTH || '14', 10);

/** Offline bundles include full question payloads and optional base64 images. */
const OFFLINE_BUNDLE_BODY_MAX_KEYS = parseInt(process.env.REQUEST_BODY_OFFLINE_MAX_KEYS || '50000', 10);
const OFFLINE_BUNDLE_BODY_MAX_DEPTH = parseInt(process.env.REQUEST_BODY_OFFLINE_MAX_DEPTH || '14', 10);

function resolveBodyLimits(path: string): { maxKeys: number; maxDepth: number } {
  if (/^\/api\/v1\/tests(\/|$)/.test(path)) {
    return { maxKeys: TEST_BODY_MAX_KEYS, maxDepth: TEST_BODY_MAX_DEPTH };
  }
  if (/^\/api\/v1\/offline-bundles(\/|$)/.test(path)) {
    return { maxKeys: OFFLINE_BUNDLE_BODY_MAX_KEYS, maxDepth: OFFLINE_BUNDLE_BODY_MAX_DEPTH };
  }
  // Question-bank AND study-pack publish/update carry the same full-content
  // JSON an offline bundle does (each service adds its own question/flashcard
  // and 2MB caps). Study packs were missing here, so a deck of 45 cards — 30
  // if the cards carry tags — was rejected with 400 before the route ran, and
  // the seller saw a generic failure with nothing published.
  if (/^\/api\/v1\/marketplace\/(question-banks|study-packs)(\/|$)/.test(path)) {
    return { maxKeys: OFFLINE_BUNDLE_BODY_MAX_KEYS, maxDepth: OFFLINE_BUNDLE_BODY_MAX_DEPTH };
  }
  return { maxKeys: DEFAULT_MAX_KEYS, maxDepth: DEFAULT_MAX_DEPTH };
}

/** Keys that can reach Object.prototype through a later `obj[key] = …` rebuild. */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Strip prototype-polluting keys in place. The sanitiser drops them too; doing it
 * here as well means the guarantee survives a change in middleware order.
 */
export function stripDangerousKeys(value: unknown, depth = 0): void {
  if (depth > 32 || value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) stripDangerousKeys(item, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of DANGEROUS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) delete obj[key];
  }
  for (const key of Object.keys(obj)) stripDangerousKeys(obj[key], depth + 1);
}

type ShapeResult = { tooDeep: boolean; tooManyKeys: boolean };

/**
 * One bounded walk instead of the previous two full traversals (objectDepth then
 * countKeys). Bails out the moment either limit is exceeded, so an oversized body
 * is rejected after `maxKeys` visits rather than after counting all of them twice.
 */
function measureShape(root: unknown, maxDepth: number, maxKeys: number): ShapeResult {
  const result: ShapeResult = { tooDeep: false, tooManyKeys: false };
  let keys = 0;
  const visit = (value: unknown, depth: number): void => {
    if (result.tooDeep || result.tooManyKeys) return;
    if (value == null || typeof value !== 'object') return;
    if (depth > maxDepth) {
      result.tooDeep = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
        if (result.tooDeep || result.tooManyKeys) return;
      }
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      keys += 1;
      if (keys > maxKeys) {
        result.tooManyKeys = true;
        return;
      }
      visit(obj[key], depth + 1);
      if (result.tooDeep || result.tooManyKeys) return;
    }
  };
  visit(root, 1);
  return result;
}

/** Reject oversized or deeply nested JSON bodies on write routes. */
export function validateBodyShape(options?: { maxKeys?: number; maxDepth?: number }) {
  const maxKeys = options?.maxKeys ?? DEFAULT_MAX_KEYS;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;

  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method) || !req.body || typeof req.body !== 'object') {
      next();
      return;
    }
    const path = req.path || req.originalUrl?.split('?')[0] || '';
    // The per-path limits shadow the factory options above: whatever a caller
    // passed to validateBodyShape() is overridden here for every request.
    const { maxKeys, maxDepth } = resolveBodyLimits(path);
    const shape = measureShape(req.body, maxDepth, maxKeys);
    if (shape.tooDeep) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Request body is nested too deeply',
      });
      return;
    }
    if (shape.tooManyKeys) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Request body has too many fields',
      });
      return;
    }
    stripDangerousKeys(req.body);
    next();
  };
}
