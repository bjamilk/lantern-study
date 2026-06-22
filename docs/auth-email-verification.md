# Email verification and password reset

Lantern Study uses Supabase Auth email confirmations (6-digit OTP + magic link) and password reset flows on web and mobile.

## Supabase Dashboard (production)

1. **Authentication → Providers → Email** — enable **Confirm email**.
2. **Authentication → Email Templates → Confirm signup** — include the OTP token:
   ```html
   <p>Your verification code: {{ .Token }}</p>
   ```
   Keep the default confirmation link as well so users can verify by clicking the email link.
3. **Authentication → URL Configuration** — Site URL: `https://lanternstudy.com`. Redirect URLs include:
   - Web: `https://lanternstudy.com/reset-password` (and your local dev origin, e.g. `http://localhost:5173/reset-password`)
   - Mobile: `lanternstudy://reset-password`, `lanternstudy://verify-email`
   - Add any Expo dev redirect URIs you use during development (from `makeRedirectUri`).

## Local development

`supabase/config.toml` sets `[auth.email] enable_confirmations = true`.

Test emails are captured by **Inbucket** at `http://127.0.0.1:54324` when running local Supabase.

## Web flows

| Flow | Entry | Notes |
|------|--------|--------|
| Sign up | Auth screen → verify view | No auto sign-in until email is confirmed |
| Unverified login | Redirects to verify view with resend + OTP |
| Forgot password | Resend reset email with 60s cooldown |
| Reset password | `/reset-password` from email link | `ResetPasswordScreen` after `PASSWORD_RECOVERY` session |

## Mobile flows

| Screen | Deep link |
|--------|-----------|
| Verify email | `lanternstudy://verify-email` |
| Forgot password | `lanternstudy://forgot-password` |
| Reset password | `lanternstudy://reset-password` |

Reset links establish a recovery session via `establishSessionFromAuthUrl` before the user sets a new password.

## Client resend cooldown

Both platforms enforce a **60-second** client-side cooldown between resend requests (`RESEND_COOLDOWN_SECONDS` in `@lantern/shared`). Supabase may apply additional server-side rate limits.

## Related code

- Shared helpers: `packages/shared/src/auth/emailAuth.ts`
- Web: `components/AuthScreen.tsx`, `components/ResetPasswordScreen.tsx`
- Mobile: `apps/mobile/src/screens/auth/*`
- Supabase wrappers: `services/supabase.ts`, `apps/mobile/src/services/supabase.ts`
