/**
 * Transport-level hardening: security headers, request ids, and the input
 * sanitiser that walks every parsed request body, query and params object.
 *
 * Exports: `securityHeaders` (helmet), `requestIdMiddleware`,
 * `sanitizationMiddleware`, the `sanitizeInput` / `sanitizeObject` primitives
 * the sanitiser is built from, `shouldSkipBodySanitization`,
 * `shouldPreserveBodyText`, `stripDangerousKeysInPlace` and the scan-budget
 * helpers, and the Joi `validateRequest` factory used by individual routes.
 *
 * Mount order (server.ts): `sanitizationMiddleware` is mounted inside
 * `startServer()` immediately AFTER `anonymousIpRateLimit` and before any route,
 * alongside `validateBodyShape()`. It used to run in the pre-route block ahead
 * of the limiter, which let an unauthenticated caller buy body-sized CPU per
 * request; `security.test.ts` asserts the current order against server.ts.
 *
 * CORS and authentication no longer live here — `corsConfig` and
 * `strictAuthMiddleware` were dead duplicates and were deleted (see the notes
 * below). server.ts owns CORS, `middleware/auth.ts` owns authentication.
 */
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

// Extended Request type
interface AuthenticatedRequest extends Request {
  user?: { userId: string; email?: string };
  requestId?: string;
}

// NOTE: `strictAuthMiddleware` was deleted here — dead code (no importer) that
// built its own Supabase client per request and duplicated middleware/auth.ts.

// Security headers (rate limiting lives in middleware/rateLimit.ts)
export const securityHeaders = helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:', 'http://localhost:55421'],
      connectSrc: ["'self'", process.env.SUPABASE_URL || 'http://127.0.0.1:55421', 'http://localhost:3001'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production' ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  } : false,
});

// NOTE: `corsConfig` was deleted here — dead code (only the removed
// applyProductionMiddleware used it). server.ts owns the live CORS block.

// 5. Request ID Tracking
export const requestIdMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'] as string || 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

// ============ Input sanitisation ============
//
// FIXED (F7b): the sanitiser used to STRIP ON INGEST everywhere, so legitimate
// student content containing `javascript:`, an `on…=` sequence or a `<script>`
// example was silently rewritten before the route ever saw it — data loss, not
// defence, because the write succeeded and the user was never told.
//
// Escaping is the renderer's job, and both renderers already do it: the web app
// contains no `dangerouslySetInnerHTML` (React escapes every interpolation) and
// React Native `<Text>` never parses markup. So on the routes that carry
// authored study material — notes, AI/companion prompts, decks, flashcards,
// tests, study sets — the body now goes through a KEYS-ONLY pass
// (`TEXT_PRESERVE_PATTERNS` below): prototype-polluting keys are still removed,
// string values are stored exactly as the student typed them.
//
// Everything else still gets the full strip-and-truncate pass, and the
// key-based prototype-pollution block runs on EVERY path, including the
// large-payload routes that previously skipped the body entirely.

// Keys that carry raw base64 file payloads — must not be truncated or regex-sanitized.
const BINARY_PAYLOAD_KEYS = new Set([
  'base64Data',
  'audioBase64',
  'apkgBase64',
]);

// Keys that can reach Object.prototype when a body is rebuilt with `obj[key] = …`.
// `__proto__` is the dangerous one (it hits the setter); `constructor`/`prototype`
// are dropped as defence in depth so nothing downstream can walk into them.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Total bytes of string content a single request may have regex-scanned.
 * Beyond this the sanitiser still truncates and normalises, but stops running
 * the strip patterns — otherwise a multi-megabyte body costs O(bytes) regex
 * work per string on an unauthenticated path.
 */
export const MAX_SANITIZE_SCAN_BYTES = 256 * 1024;

export interface SanitizeBudget {
  remaining: number;
}

export const createSanitizeBudget = (): SanitizeBudget => ({ remaining: MAX_SANITIZE_SCAN_BYTES });

// 6. Input Sanitization
//
// The old `<script>` pattern was `/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi`,
// which backtracks quadratically: 128 KB of repeated `<script>` took ~3.7 s, and it ran
// BEFORE truncation on every string of every body, ahead of the rate limiter. The lazy
// form below is linear. Truncation now happens FIRST so no pattern ever sees more than
// `maxLength` characters.
// Even the lazy form `/<script\b[\s\S]*?<\/script>/gi` is quadratic: every `<script`
// start position rescans to the end of the string hunting for a close tag that is
// never there (256 KB of repeated `<script>` = ~4.4 s). This index walk is linear —
// the open and close cursors only ever move forward, and the moment no `</script>`
// remains no later `<script` can match either, so it stops.
const SCRIPT_OPEN = '<script';
const SCRIPT_CLOSE = '</script>';

function stripScriptTags(value: string): string {
  const lower = value.toLowerCase();
  if (lower.indexOf(SCRIPT_OPEN) === -1) return value;

  let out = '';
  let copiedTo = 0;
  let cursor = 0;

  while (cursor < lower.length) {
    const open = lower.indexOf(SCRIPT_OPEN, cursor);
    if (open === -1) break;
    // Require a tag boundary after "<script" so <scripted> is not treated as a tag.
    const after = lower.charCodeAt(open + SCRIPT_OPEN.length);
    const isWordChar =
      (after >= 97 && after <= 122) || (after >= 48 && after <= 57) || after === 95;
    if (isWordChar) {
      cursor = open + SCRIPT_OPEN.length;
      continue;
    }
    const close = lower.indexOf(SCRIPT_CLOSE, open + SCRIPT_OPEN.length);
    // No close tag left anywhere — nothing after this point can match either.
    if (close === -1) break;
    out += value.slice(copiedTo, open);
    copiedTo = close + SCRIPT_CLOSE.length;
    cursor = copiedTo;
  }

  return copiedTo === 0 ? value : out + value.slice(copiedTo);
}

const JS_PROTOCOL = /javascript:/gi;
const EVENT_HANDLER = /on\w+=/gi;

export const sanitizeInput = (
  input: string,
  options?: { maxLength?: number; budget?: SanitizeBudget }
): string => {
  if (typeof input !== 'string') return input;

  const maxLength = options?.maxLength ?? 50000;
  // Truncate BEFORE any regex — this is the cap that makes the work bounded.
  const truncated = input.length > maxLength ? input.substring(0, maxLength) : input;

  const budget = options?.budget;
  if (budget) {
    if (budget.remaining <= 0) return truncated.trim();
    budget.remaining -= truncated.length;
  }

  return stripScriptTags(truncated)
    .replace(JS_PROTOCOL, '')
    .replace(EVENT_HANDLER, '')
    .trim();
};

/**
 * Recursively sanitises a parsed body, rebuilding objects onto a fresh literal.
 *
 * Because the rebuild assigns with `obj[key] = …`, a raw `__proto__` key from
 * JSON would hit the prototype setter rather than land as an own property —
 * which is why `DANGEROUS_KEYS` is skipped both before and after key
 * sanitisation. `validateBody.ts` strips the same keys independently so the
 * guarantee survives a change in middleware order.
 */
export const sanitizeObject = (
  obj: any,
  depth = 0,
  parentKey?: string,
  budget?: SanitizeBudget
): any => {
  if (depth > 8) return obj;
  if (typeof obj === 'string') {
    if (parentKey && BINARY_PAYLOAD_KEYS.has(parentKey)) {
      return obj;
    }
    return sanitizeInput(obj, { budget });
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1, parentKey, budget));
  }
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      const safeKey = sanitizeInput(key, { maxLength: 200, budget });
      if (DANGEROUS_KEYS.has(safeKey)) continue;
      sanitized[safeKey] = sanitizeObject(value, depth + 1, key, budget);
    }
    return sanitized;
  }
  return obj;
};

/** Mutate query/params in place — Express 5 exposes them as read-only getters. */
function sanitizeMutableObject(
  obj: Record<string, unknown>,
  depth = 0,
  budget?: SanitizeBudget
): void {
  if (!obj || typeof obj !== 'object' || depth > 8) return;
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      delete obj[key];
      continue;
    }
    const value = obj[key];
    if (typeof value === 'string') {
      obj[key] = sanitizeInput(value, { budget });
    } else if (Array.isArray(value)) {
      obj[key] = sanitizeObject(value, depth + 1, undefined, budget);
    } else if (value && typeof value === 'object') {
      sanitizeMutableObject(value as Record<string, unknown>, depth + 1, budget);
    }
  }
}

/**
 * Routes whose bodies are large by design AND validated field-by-field by their
 * own service layer (question/flashcard shape checks, 2 MB per-field caps).
 * Walking and rebuilding a 35-50 MB body here bought nothing and corrupted the
 * content it copied. Exact paths / anchored patterns only — never substrings.
 */
const SANITIZE_SKIP_PATTERNS: RegExp[] = [
  /^\/api\/v1\/offline-bundles(\/|$)/,
  /^\/api\/v1\/marketplace\/(question-banks|study-packs)(\/|$)/,
  /\/notes\/(transcribe-audio|upload-lecture-audio|upload-pdf|upload-presentation|upload-images)$/,
  /\/notes\/[^/]+\/regenerate-preview$/,
  /\/notes\/[^/]+\/attachments\/upload-images$/,
  /\/ai\/companion\/attachments$/,
  /^\/api\/v1\/(flashcards|marketplace|messages)\/[^?]*upload[^/?]*$/,
];

export const shouldSkipBodySanitization = (pathname: string): boolean =>
  SANITIZE_SKIP_PATTERNS.some((pattern) => pattern.test(pathname));

/**
 * Routes whose bodies carry authored study material. Their string values are
 * stored verbatim — a note about XSS, a flashcard whose answer is
 * `<script>alert(1)</script>`, a companion prompt asking what `javascript:`
 * does, a code block full of angle brackets. Stripping those on ingest lost the
 * student's work silently and bought nothing: nothing in this product renders
 * user text as HTML.
 *
 * Keys are still walked and prototype-polluting ones dropped — that is the part
 * that is actually a defence, and it runs everywhere.
 */
const TEXT_PRESERVE_PATTERNS: RegExp[] = [
  /^\/api\/v1\/notes(\/|$)/,
  /^\/api\/v1\/ai(\/|$)/,
  /^\/api\/v1\/decks(\/|$)/,
  /^\/api\/v1\/flashcards(\/|$)/,
  /^\/api\/v1\/tests(\/|$)/,
  /^\/api\/v1\/users\/me\/study-sets(\/|$)/,
];

/** True when the route stores raw text and only keys should be sanitised. */
export const shouldPreserveBodyText = (pathname: string): boolean =>
  TEXT_PRESERVE_PATTERNS.some((pattern) => pattern.test(pathname));

/**
 * The prototype-pollution half of the sanitiser, on its own: drops
 * `__proto__` / `constructor` / `prototype` in place, leaves every string value
 * exactly as it arrived, and allocates nothing. Used on the text-preserving
 * routes AND on the large-payload routes, which previously skipped the body
 * outright and so had no key guard at this layer at all.
 */
export const stripDangerousKeysInPlace = (value: unknown, depth = 0): void => {
  if (depth > 32 || value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) stripDangerousKeysInPlace(item, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of DANGEROUS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) delete obj[key];
  }
  for (const key of Object.keys(obj)) stripDangerousKeysInPlace(obj[key], depth + 1);
};

/**
 * Sanitises body, query and params under one shared per-request scan budget.
 * The body is replaced wholesale; query and params are mutated in place because
 * Express 5 exposes them as read-only getters.
 */
export const sanitizationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const budget = createSanitizeBudget();
  const pathname = (req.originalUrl || req.url || '').split('?')[0] || '';
  if (req.body) {
    // FIXED (F7b): the large-payload branch used to leave the body completely
    // alone. It now still gets the key guard — just not the string rewriting.
    if (shouldSkipBodySanitization(pathname) || shouldPreserveBodyText(pathname)) {
      stripDangerousKeysInPlace(req.body);
    } else {
      req.body = sanitizeObject(req.body, 0, undefined, budget);
    }
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeMutableObject(req.query as Record<string, unknown>, 0, budget);
  }
  if (req.params && typeof req.params === 'object') {
    sanitizeMutableObject(req.params as Record<string, unknown>, 0, budget);
  }
  next();
};

// 7. Joi Validation Middleware
import Joi from 'joi';

export const validateRequest = (schema: Joi.Schema, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[property];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });
    
    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
      return;
    }
    
    (req as any)[property] = value;
    next();
  };
};
