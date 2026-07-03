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
  return { maxKeys: DEFAULT_MAX_KEYS, maxDepth: DEFAULT_MAX_DEPTH };
}

function objectDepth(value: unknown, depth = 0): number {
  if (value == null || typeof value !== 'object') return depth;
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, objectDepth(item, depth + 1)), depth + 1);
  }
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (max, item) => Math.max(max, objectDepth(item, depth + 1)),
    depth + 1
  );
}

function countKeys(value: unknown): number {
  if (value == null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + countKeys(item), 0);
  }
  const obj = value as Record<string, unknown>;
  return Object.keys(obj).length + Object.values(obj).reduce<number>((sum, item) => sum + countKeys(item), 0);
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
    const { maxKeys, maxDepth } = resolveBodyLimits(path);
    if (objectDepth(req.body) > maxDepth) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Request body is nested too deeply',
      });
      return;
    }
    if (countKeys(req.body) > maxKeys) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Request body has too many fields',
      });
      return;
    }
    next();
  };
}
