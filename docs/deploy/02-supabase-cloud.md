# Step 2: Supabase Cloud

Connect the Lantern Study codebase to a hosted Supabase project (database, auth, storage, realtime).

## Quick setup (recommended)

When the project status is **Active** in the [Dashboard](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl), run in **your own terminal** (the agent terminal cannot complete interactive `supabase login`):

```powershell
.\scripts\deploy-supabase-cloud.ps1
```

That script logs in, links the repo, and runs `supabase db push`.

## Project (this workspace)

| Setting | Value |
|---------|--------|
| Organization | **Lantern_Study** |
| Project ref | `tiizkjhbrnaibaagmurl` |
| API URL | `https://tiizkjhbrnaibaagmurl.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl |

If the project was **paused/inactive**, restore it in the dashboard or run:

```powershell
npx supabase projects restore --project-ref tiizkjhbrnaibaagmurl
```

Wait until status is **Active** before pushing migrations.

---

## 1. Link CLI to the cloud project

From the repo root (one-time):

```powershell
npx supabase login
npx supabase link --project-ref tiizkjhbrnaibaagmurl
```

Enter your database password when prompted (from Supabase Dashboard → Project Settings → Database).

---

## 2. Push migrations

Applies all SQL files in `supabase/migrations/` to the cloud database:

```powershell
npx supabase db push
```

Verify in Dashboard → **Table Editor** that tables like `profiles`, `decks`, `groups` exist.

### Migration history mismatch (MCP vs CLI)

If `db push` fails with **remote migration versions not found** or **history mismatch**, the schema may already be on cloud (e.g. applied via Supabase MCP with different version timestamps) while local filenames use different prefixes.

**Do not** re-run all migrations blindly — objects may already exist.

Reconcile history without re-applying SQL:

```powershell
.\scripts\repair-supabase-migration-history.ps1
# or
.\scripts\deploy-supabase-cloud.ps1 -RepairHistory
```

Then verify:

```powershell
npx supabase migration list --linked   # Local and Remote columns should match
npx supabase db push                     # "Remote database is up to date"
```

Spot-check schema + history:

```powershell
.\scripts\deploy-supabase-cloud.ps1      # REST table probe + history check
.\scripts\deploy-supabase-cloud.ps1 -FullCli
```

**Note:** Migration files must use **14-digit** version prefixes (e.g. `20251129000000_*`, not `20251129_*`).

---

## 3. Auth configuration (Dashboard)

### Email confirmations

1. **Authentication → Providers → Email** → enable **Confirm email**.
2. **Authentication → Email Templates → Confirm signup** — add OTP line:
   ```html
   <p>Your verification code: {{ .Token }}</p>
   ```

### URL configuration

**Authentication → URL Configuration**

Or run (requires [access token](https://supabase.com/dashboard/account/tokens)):

```powershell
$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
.\scripts\configure-supabase-auth-urls.ps1 -PagesUrl 'https://lanternstudy.com'
```

| Setting | Value (production) |
|---------|----------------------------|
| Site URL | `https://lanternstudy.com` |
| Redirect URLs | See list below |

**Important:** Accounts created on **local Supabase** (`127.0.0.1:55421`) are **not** on cloud. Users must **sign up again** on the production web app.

Add these redirect URLs (keep localhost for local dev):

```
http://localhost:5173
http://localhost:5173/reset-password
http://127.0.0.1:5173
http://127.0.0.1:5173/reset-password
https://lanternstudy.com
https://lanternstudy.com/reset-password
https://www.lanternstudy.com
https://www.lanternstudy.com/reset-password
https://lantern-study.pages.dev
https://lantern-study.pages.dev/reset-password
lanternstudy://reset-password
lanternstudy://verify-email
lanternstudy://
```

### OAuth (optional for first test)

- **Google** — Client ID + secret from Google Cloud Console; redirect URI = Supabase callback URL shown in Dashboard.
- **Apple** — Services ID + secret JWT; bundle IDs `com.lanternstudy.app`, `com.lanternstudy.app.dev`.

See also `docs/compliance/oauth-setup.md` and `docs/auth-email-verification.md`.

### Custom SMTP (Resend)

Supabase’s built-in email quota is very low and causes signup **429** errors during testing. **Resend** replaces built-in SMTP and raises the hourly send limit.

**1. Resend account**

- Sign up at [resend.com](https://resend.com) (GitHub login works).
- Create an API key at [API Keys](https://resend.com/api-keys) (permission: **Sending access** is enough for SMTP).

**2. From address**

| Stage | `RESEND_FROM_EMAIL` | Notes |
|-------|---------------------|-------|
| Quick test | `onboarding@resend.dev` | Only delivers to the email on your Resend account |
| Production | `noreply@lanternstudy.com` | Verify `lanternstudy.com` at [Resend → Domains](https://resend.com/domains) |

**3. Local secrets (never commit)**

```powershell
Copy-Item .env.resend.example .env.resend
# Edit .env.resend: RESEND_API_KEY, RESEND_FROM_EMAIL, SUPABASE_ACCESS_TOKEN
```

Get `SUPABASE_ACCESS_TOKEN` from [Dashboard → Account → Access Tokens](https://supabase.com/dashboard/account/tokens) (starts with `sbp_`).

**4. Apply to Supabase Cloud**

```powershell
.\scripts\configure-supabase-resend-smtp.ps1
```

This script:

- Enables custom SMTP: `smtp.resend.com:465`, user `resend`, password = your Resend API key
- Sets Auth Site URL + redirect URLs for `https://lanternstudy.com`
- Raises email rate limits (default 100/hour after custom SMTP)

Verify in Dashboard: [Auth → SMTP](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/smtp) and [Rate Limits](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/rate-limits).

**Manual alternative (Dashboard):** [Authentication → SMTP](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/smtp) — enable custom SMTP, host `smtp.resend.com`, port `465`, user `resend`, password = API key, sender = your verified address.

**Security:** Rotate the Resend API key if it was ever pasted in chat or committed by mistake.

### Rate limits and signup 429

Cloud signup sends a confirmation email on each attempt. Supabase enforces:

| Limit | Effect |
|-------|--------|
| **Project email quota** (built-in SMTP) | Very low; testing can hit **429** for ~1 hour project-wide |
| **Per-email signup cooldown** | Default 60s between attempts for the same address (customizable) |

**Unblock testing without waiting:**

1. [Authentication → Users](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/users) → **Add user** → enable **Auto Confirm User** → log in on production (no signup email).
2. Or run (service role in `apps/api-server/.env`):
   ```powershell
   .\scripts\create-cloud-auth-user.ps1 -Email 'you@example.com' -Password 'YourPassword123!'
   ```
3. Remove stuck unconfirmed users:
   ```powershell
   .\scripts\create-cloud-auth-user.ps1 -ListUnconfirmed
   .\scripts\create-cloud-auth-user.ps1 -RemoveUnconfirmed -Email 'stuck@example.com'
   ```

**Relax cooldowns (Management API):**

```powershell
$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
.\scripts\configure-supabase-auth-urls.ps1 -SkipUrls -SignupConfirmationSeconds 10
```

**Raise email quota:** use [custom SMTP (Resend)](#custom-smtp-resend) above, then increase **emails sent per hour** under [Rate Limits](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/rate-limits) or:

```powershell
.\scripts\configure-supabase-resend-smtp.ps1
# or, if SMTP is already set manually:
.\scripts\configure-supabase-auth-urls.ps1 -SkipUrls -EmailSentPerHour 100
```

---

## 4. Environment variables

Copy keys from **Dashboard → Project Settings → API**.

### Root `.env` (web + shared local dev)

```env
VITE_SUPABASE_URL=https://tiizkjhbrnaibaagmurl.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
VITE_API_URL=http://localhost:3001
```

### `apps/api-server/.env`

```env
SUPABASE_URL=https://tiizkjhbrnaibaagmurl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-never-in-frontend>
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

For **production API** (Railway/Render later):

```env
NODE_ENV=production
FRONTEND_URL=https://YOUR-WEB-DOMAIN
REDIS_ENABLED=true
REDIS_URL=<upstash-or-redis-url>
```

### Mobile (`apps/mobile` — EAS secrets or `.env`)

```env
EXPO_PUBLIC_SUPABASE_URL=https://tiizkjhbrnaibaagmurl.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>
EXPO_PUBLIC_API_URL=https://YOUR-API-DOMAIN
```

**Never commit** `.env` files. Only `.env.example` templates belong in Git.

---

## 5. Smoke test

1. Local web with cloud Supabase: update `.env`, run `npm run dev:web`.
2. Sign up with a real email → receive confirmation (Supabase built-in email on free tier).
3. Confirm email via OTP or link → sign in.
4. API health: with `apps/api-server/.env` pointed at cloud, `npm run dev:api` → `GET http://localhost:3001/health`.

---

## 6. Security checklist (before public launch)

- [ ] RLS enabled on all public tables (migrations include hardening)
- [ ] Service role key only on API server
- [ ] Rotate keys if anything was ever committed by mistake
- [ ] Review **Database → Advisors** in Dashboard for warnings

---

## Next step

→ [03-api-hosting.md](./03-api-hosting.md) (deploy API to Render)
