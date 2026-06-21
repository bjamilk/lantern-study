# Step 2: Supabase Cloud

Connect the Lantern Study codebase to a hosted Supabase project (database, auth, storage, realtime).

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

| Setting | Value (production testing) |
|---------|----------------------------|
| Site URL | `https://YOUR-WEB-DOMAIN` (or temporary Pages URL) |
| Redirect URLs | See list below |

Add these redirect URLs (keep localhost for local dev):

```
http://localhost:5173
http://localhost:5173/reset-password
http://127.0.0.1:5173
http://127.0.0.1:5173/reset-password
https://YOUR-WEB-DOMAIN
https://YOUR-WEB-DOMAIN/reset-password
lanternstudy://reset-password
lanternstudy://verify-email
lanternstudy://
```

### OAuth (optional for first test)

- **Google** — Client ID + secret from Google Cloud Console; redirect URI = Supabase callback URL shown in Dashboard.
- **Apple** — Services ID + secret JWT; bundle IDs `com.lanternstudy.app`, `com.lanternstudy.app.dev`.

See also `docs/compliance/oauth-setup.md` and `docs/auth-email-verification.md`.

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

→ [03-api-hosting.md](./03-api-hosting.md) (deploy API to Railway/Render) — to be added.
