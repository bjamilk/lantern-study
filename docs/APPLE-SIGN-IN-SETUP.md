# Apple Sign-In Setup — Lantern Study

Both Apple buttons already exist in the code and need **zero code changes**:

- **Web** (`components/AuthScreen.tsx`): `supabase.auth.signInWithOAuth({ provider: 'apple' })` — the browser OAuth flow through Supabase.
- **iOS app** (`apps/mobile/src/services/socialAuth.ts`): the **native** sheet via `expo-apple-authentication` → `supabase.auth.signInWithIdToken({ provider: 'apple' })`. The `usesAppleSignIn: true` plugin is already in `app.config.ts`.

Everything below happens in the **Apple Developer portal** and the **Supabase dashboard** (project `tiizkjhbrnaibaagmurl`).

## Prerequisites

- Apple Developer Program membership ($99/yr) — also unblocks TestFlight, which iOS distribution needs anyway.
- Supabase dashboard access.

## Part A — Apple Developer portal

1. **App ID** — *Certificates, Identifiers & Profiles → Identifiers → +* → App ID.
   - Bundle ID: `com.lanternstudy.app` (explicit, must match `app.config.ts`).
   - Capabilities: check **Sign In with Apple**.
2. **Services ID** (this is the *web* client ID) — *Identifiers → + → Services IDs*.
   - Identifier: `com.lanternstudy.app.web` (any reverse-DNS id; remember it).
   - Enable **Sign In with Apple** → *Configure*:
     - Primary App ID: `com.lanternstudy.app`.
     - Domains: `tiizkjhbrnaibaagmurl.supabase.co`
     - Return URLs: `https://tiizkjhbrnaibaagmurl.supabase.co/auth/v1/callback`
3. **Key** — *Keys → +*.
   - Enable **Sign In with Apple**, configure it to the primary App ID.
   - Download the `.p8` file — **Apple lets you download it exactly once.** Store it in your password manager.
   - Note the **Key ID** (on the key page) and your **Team ID** (top-right of the portal).

## Part B — Supabase dashboard

*Authentication → Providers → Apple* → enable, then:

- **Client IDs**: `com.lanternstudy.app.web,com.lanternstudy.app`
  - The Services ID serves web OAuth; the bundle ID authorizes the app's native `signInWithIdToken` calls. Order doesn't matter; comma-separate.
- **Secret Key**: web OAuth needs a *client secret JWT* generated from the `.p8`:
  - Easiest: Supabase's docs page for the Apple provider includes a generator snippet — paste Team ID, Key ID, Services ID, and the `.p8` contents.
  - The JWT is ES256 with `iss` = Team ID, `sub` = Services ID (`com.lanternstudy.app.web`), `aud` = `https://appleid.apple.com`, `kid` = Key ID.
  - **Apple caps its lifetime at 6 months.** Set a calendar reminder to regenerate and re-paste it — when it lapses, *web* Apple sign-in dies quietly while native keeps working (native validates the identity token against Apple's public keys and doesn't use the secret).

### ⚠️ Redirect allow-list (also affects Google — do this first)

*Authentication → URL Configuration*:

- Site URL: `https://lanternstudy.com`
- **Redirect URLs**: add `https://lanternstudy.com/login*`

The web app now sends OAuth back to `/login?next=…` so invite/share deep links survive sign-in. If that pattern isn't allow-listed, Supabase silently falls back to the Site URL — nothing breaks, but the deep-link fix stays inert. This applies to **Google today**, not just Apple.

## Part C — iOS signing (required for the native button)

The current iOS builds are simulator-only and unsigned; the native Apple sheet needs a signed build on a real device or TestFlight:

1. In the Apple portal, the App ID from Part A is the one EAS will use.
2. `cd apps/mobile && eas credentials -p ios` → let EAS create the distribution certificate + provisioning profile against your team (interactive; needs your Apple account).
3. Build: `eas build -p ios --profile production` (cloud, uses the free-tier queue) — or set up local signing.
4. Distribute via TestFlight (App Store Connect → the app appears after the first store-profile build upload).

## Part D — Test checklist

1. **Web**: signed out → `/login` → *Sign in with Apple* → Apple consent → returns to `lanternstudy.com/login` and signs in. Repeat from a group-invite link and confirm you land on the invite (the `?next=` carry).
2. **Name capture**: Apple sends the user's name **only on the very first authorization**. If it's missed, our `UsernameRequiredModal` collects username + names on first sign-in — verify it appears for a fresh Apple account.
3. **Hidden email**: choose "Hide My Email" and confirm the relay address (`…@privaterelay.appleid.com`) signs up cleanly.
4. **Revoke + retry**: appleid.apple.com → Sign-In with Apple → remove Lantern Study → sign in again; it should behave like a first-time auth.
5. **iOS native**: on a signed build, the button opens the system sheet (not a browser) and lands signed in.

## Appendix — other dashboard hardening from this round

| Setting | Where | Value |
|---|---|---|
| Password minimum | *Auth → Providers → Email → Password requirements* | **8** characters (client + local dev config already enforce 8) |
| Signup captcha | *Auth → Attack protection → Enable CAPTCHA* | Turnstile + your secret key. The web form is now fail-closed client-side; this makes the server the final word |
| PKCE flow | code change, prepared but not flipped | Set `flowType: 'pkce'` in `services/supabase.ts` `createClient` options, then run the full Part D checklist **plus** an email signup + confirmation link and a password reset link before deploying — the links switch to `?code=` exchange |
