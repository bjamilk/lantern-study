const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'apiKey',
  'api_key',
  'base64Data',
  'audioBase64',
  'service_role_key',
]);

const MAX_LOG_STRING = 500;

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Return a client-safe error message (hide internals in production). */
export function clientErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (!isProductionEnv()) {
    if (error instanceof Error) return error.message;
    return String(error);
  }
  return fallback;
}

/** Redact sensitive fields from objects before logging. */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_LOG_STRING ? `${value.slice(0, MAX_LOG_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactForLog(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEYS.has(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactForLog(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}
