/** Client-side cooldown between resend requests (seconds). */
export const RESEND_COOLDOWN_SECONDS = 60;

const EMAIL_NOT_CONFIRMED_PATTERNS = [
  'email not confirmed',
  'email_not_confirmed',
  'confirm your email',
  'email address not confirmed',
];

export function isEmailNotConfirmedError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error ?? '');
  const lower = message.toLowerCase();
  return EMAIL_NOT_CONFIRMED_PATTERNS.some((p) => lower.includes(p));
}

export function normalizeOtpCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(normalizeOtpCode(code));
}

const AUTH_RATE_LIMIT_PATTERNS = [
  'rate limit',
  'too many requests',
  'over_email_send_rate_limit',
  'email rate limit',
  '429',
];

export function isAuthRateLimitError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (status === 429) return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error ?? '');
  const lower = message.toLowerCase();
  return AUTH_RATE_LIMIT_PATTERNS.some((p) => lower.includes(p));
}

/** User-facing message for Supabase Auth 429 / email quota errors. */
export function getAuthRateLimitMessage(
  context: 'signup' | 'resend' | 'reset' | 'login' = 'signup'
): string {
  if (context === 'login') {
    // A login 429 is credential throttling, not an email quota.
    return 'Too many sign-in attempts. Wait a minute, then try again.';
  }
  if (context === 'reset') {
    return 'Too many password reset emails were sent. Wait a few minutes, then try again.';
  }
  if (context === 'resend') {
    return 'Too many confirmation emails were sent. Wait a minute, then use Resend — or log in if you already verified.';
  }
  // No internal/admin instructions here: this copy renders to end users.
  return 'Too many signup emails were sent. Wait a few minutes, then try again — or use Log in if you already signed up.';
}
