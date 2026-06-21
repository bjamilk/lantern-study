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
