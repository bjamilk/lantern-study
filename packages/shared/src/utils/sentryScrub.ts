const SENSITIVE_KEY_PATTERN =
  /password|token|secret|authorization|api[_-]?key|service[_-]?role|cookie|session/i;

function scrubValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[Filtered]';
  }
  if (value && typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>);
  }
  return value;
}

function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = scrubValue(key, value);
  }
  return out;
}

/** Redact tokens/passwords from Sentry event payloads before upload. */
export function scrubSentryEvent(event: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...event };

  if (next.user && typeof next.user === 'object') {
    const user = { ...(next.user as Record<string, unknown>) };
    delete user.email;
    delete user.ip_address;
    next.user = user;
  }

  if (next.request && typeof next.request === 'object') {
    const request = { ...(next.request as Record<string, unknown>) };
    if (request.headers && typeof request.headers === 'object') {
      request.headers = scrubObject(request.headers as Record<string, unknown>);
    }
    if (request.cookies && typeof request.cookies === 'object') {
      request.cookies = scrubObject(request.cookies as Record<string, unknown>);
    }
    next.request = request;
  }

  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => {
      if (!crumb || typeof crumb !== 'object') return crumb;
      const c = { ...(crumb as Record<string, unknown>) };
      if (c.data && typeof c.data === 'object') {
        c.data = scrubObject(c.data as Record<string, unknown>);
      }
      return c;
    });
  }

  return next;
}
