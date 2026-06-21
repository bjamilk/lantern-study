# Google & Apple OAuth Setup

**Last updated:** June 14, 2026

Lantern Study supports **Google** and **Apple** sign-in on web and mobile. Facebook and X/Twitter providers have been removed.

## Supabase Dashboard (production / staging)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Authentication** → **Providers**.
2. **Disable** Facebook and Twitter/X if they are still enabled.
3. **Google** — enable and paste OAuth client ID + secret from Google Cloud Console.
4. **Apple** — enable and configure:
   - **Services ID** (web OAuth client ID)
   - **Secret key** (JWT generated from Apple `.p8` key; expires every 6 months)
   - **Authorized Client IDs** (bundle IDs for native iOS):
     - `com.lanternstudy.app`
     - `com.lanternstudy.app.dev`
5. **Authentication** → **URL configuration**:
   - **Site URL**: your web app origin (e.g. `https://lanternstudy.app` or `http://localhost:5173` for local web)
   - **Redirect URLs** — add all of:
     - `http://localhost:5173`
     - `https://your-production-web-domain.com`
     - `lanternstudy://**` (mobile OAuth return via Expo scheme)

## Apple Developer Console

1. [Apple Developer](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles**.
2. **App ID** (`com.lanternstudy.app`) — enable **Sign in with Apple**.
3. **Services ID** — create one for web (e.g. `com.lanternstudy.app.web`):
   - Enable Sign in with Apple
   - **Domains**: your web domain and Supabase auth host (`<project-ref>.supabase.co`)
   - **Return URLs**: `https://<project-ref>.supabase.co/auth/v1/callback`
4. **Keys** — create a **Sign in with Apple** key (`.p8`):
   - Use it to generate the client secret JWT for Supabase (see [Supabase Apple docs](https://supabase.com/docs/guides/auth/social-login/auth-apple)).
5. Regenerate the secret before it expires (max 6 months).

## Google Cloud Console

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client IDs.
2. **Web client** — authorized redirect URI:
   - `https://<project-ref>.supabase.co/auth/v1/callback`
   - `http://127.0.0.1:54321/auth/v1/callback` (local Supabase)
3. **iOS client** (optional, for native) — bundle ID `com.lanternstudy.app`.
4. **Android client** (optional) — package `com.lanternstudy.app` + SHA-1 from your signing key.
5. For Expo mobile Google OAuth, ensure the redirect URI used by `makeRedirectUri({ scheme: 'lanternstudy' })` is allowed in Supabase redirect URLs (`lanternstudy://**`).

## Local Supabase (`supabase/config.toml`)

Environment variables in repo root `.env` (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `APPLE_CLIENT_ID` | Apple Services ID (web) |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | Apple client secret JWT |

Facebook and Twitter blocks are disabled in `config.toml`.

## Mobile notes

- **Google**: works on iOS and Android via in-app browser OAuth (`lanternstudy://` redirect).
- **Apple**: native Sign in with Apple on **iOS only** (requires dev/production build with `expo-apple-authentication`; not available in all Expo Go configurations).
- Rebuild the app after changing `app.config.ts` Apple plugin or bundle IDs.

## Testing checklist

- [ ] Web: Sign in with Google
- [ ] Web: Sign in with Apple
- [ ] iOS: Google OAuth returns to app with session
- [ ] iOS: Apple native sheet → signed in
- [ ] Android: Google OAuth only (no Apple button)
- [ ] New OAuth user receives a `profiles` row
