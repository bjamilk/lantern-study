/** Resolve stored timer config to minutes (0 = untimed). */
export function resolveAttemptTimeLimitMinutes(
  config: Record<string, any> | undefined | null
): number {
  if (!config) return 0;
  if (typeof config.timerDurationMinutes === 'number' && Number.isFinite(config.timerDurationMinutes)) {
    return Math.max(0, config.timerDurationMinutes);
  }
  const raw = config.timerDuration;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  // Values >= 60 are treated as seconds (web + mobile session payloads).
  return raw >= 60 ? Math.round(raw / 60) : Math.round(raw);
}
