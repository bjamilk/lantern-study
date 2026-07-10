const ACTIVITY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addUtcDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Allow only today ±1 day (UTC) for client-supplied activity dates. */
export function resolveAllowedActivityDate(input?: unknown): string {
  const today = new Date().toISOString().slice(0, 10);
  const allowed = new Set([today, addUtcDays(today, -1), addUtcDays(today, 1)]);

  if (typeof input === 'string' && ACTIVITY_DATE_RE.test(input) && allowed.has(input)) {
    return input;
  }

  return today;
}

export { ACTIVITY_DATE_RE };
