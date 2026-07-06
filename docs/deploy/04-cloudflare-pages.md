# Step 4: Deploy the web app (Cloudflare Pages)

Host the Lantern Study Vite web app on **Cloudflare Pages** with GitHub auto-deploy from `main`.

## What gets deployed

| Item | Value |
|------|--------|
| App | `@lantern/web` (Vite + React, monorepo root) |
| Build | `npm ci && npm run build:web` |
| Output | `dist/` |
| SPA routing | `public/_redirects` → `/* /index.html 200` |
| Production API | `https://lantern-study-api.onrender.com` |
| Production web | `https://lanternstudy.com` |
| Legacy Pages URL | `https://lantern-study.pages.dev` |
| Supabase | `https://tiizkjhbrnaibaagmurl.supabase.co` |

---

## One-time: Cloudflare + GitHub

1. Log in at [Cloudflare Dashboard](https://dash.cloudflare.com/) (you used GitHub — good).
2. Ensure the **Cloudflare Pages** GitHub App can access `bjamilk/lantern-study`:
   - GitHub → **Settings → Applications → Cloudflare Pages** → configure repository access.
3. Create an API token:
   - [Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Use **Edit Cloudflare Workers** template, or custom permissions:
     - **Account → Cloudflare Pages → Edit**
     - **Account → Account Settings → Read**
4. Copy `.env.cloudflare.example` → `.env.cloudflare` and paste the token.

---

## Quick redeploy (Wrangler — already logged in)

If you completed `npx wrangler login`, redeploy after local changes without an API token:

```powershell
npm run build:web
npx wrangler pages deploy dist --project-name=lantern-study --branch=main
```

Build reads `VITE_*` from root `.env` (via `env-bootstrap.ts`).

---

## Automated deploy (recommended)

From repo root:

```powershell
# One-time: .env.cloudflare with CLOUDFLARE_API_TOKEN
.\scripts\deploy-cloudflare-pages.ps1
```

The script will:

1. Create or update the **`lantern-study`** Pages project (GitHub `bjamilk/lantern-study`, branch `main`)
2. Set build env vars from root `.env` (`VITE_SUPABASE_*`, `VITE_API_URL`, `NODE_VERSION=20`)
3. Trigger a production deploy and wait for completion
4. Update Render **`FRONTEND_URL`** for CORS (if `.env.render` has `RENDER_API_KEY`)
5. Print Supabase Auth URL steps

**Push first:** commit and push `public/_redirects` (SPA fallback) to `main` before the first Git-based build.

---

## Manual deploy (Dashboard)

1. [Workers & Pages → Create → Pages → Connect to Git](https://dash.cloudflare.com/?to=/:account/pages/new)
2. Select **`bjamilk/lantern-study`**, branch **`main`**
3. Build settings:

| Setting | Value |
|---------|--------|
| Framework preset | None |
| Build command | `npm ci && npm run build:web` |
| Build output directory | `dist` |
| Root directory | *(empty — repo root)* |

4. **Environment variables** (Production + Preview):

| Variable | Value |
|----------|--------|
| `NODE_VERSION` | `20` |
| `VITE_SUPABASE_URL` | `https://tiizkjhbrnaibaagmurl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Legacy anon JWT from Supabase → Settings → API |
| `VITE_API_URL` | `https://lantern-study-api.onrender.com` |

5. Deploy. Your URL will look like `https://lantern-study.pages.dev`.

---

## After deploy

Automated attach:

```powershell
.\scripts\attach-cloudflare-pages-domain.ps1
```

Adds `lanternstudy.com` and `www.lanternstudy.com` to the Pages project (Wrangler login or `.env.cloudflare`).

If the site does not load, add DNS records in Cloudflare (see script output):

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `@` | `lantern-study.pages.dev` | ON |
| CNAME | `www` | `lantern-study.pages.dev` | ON |

Then wait for **Custom domains → Active** on the Pages project (2–10 minutes).

### Supabase Auth

[Authentication → URL Configuration](https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/url-configuration)

| Setting | Value |
|---------|--------|
| Site URL | `https://lanternstudy.com` |
| Redirect URLs | Add your Pages URL + `/reset-password` (keep localhost entries for dev) |

Automated update (requires [Supabase access token](https://supabase.com/dashboard/account/tokens)):

```powershell
$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
.\scripts\configure-supabase-auth-urls.ps1
```

**Local accounts:** Sign-up on localhost uses **local Supabase** (`127.0.0.1:55421`). Production uses **cloud** Supabase. You must **sign up again** on the live site; local passwords are not copied to cloud.

### Render API (CORS)

Set **`FRONTEND_URL`** on the Render service to your Pages URL (the deploy script does this automatically if `RENDER_API_KEY` is set).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **Invalid login credentials on production** | Local dev accounts live in **local Supabase only**. [Sign up again](https://lantern-study.pages.dev) on production (cloud). Existing local decks/data do not transfer automatically. |
| **Custom domain not loading** | Add CNAME `@` and `www` → `lantern-study.pages.dev` (proxied) in Cloudflare DNS; confirm Pages custom domain is **Active** |
| 404 on refresh / deep links | Ensure `public/_redirects` is committed and deployed |
| Blank app / auth errors | Check Cloudflare build logs; confirm `VITE_*` vars at build time |
| API blocked (CORS) | Set Render `FRONTEND_URL` to exact Pages origin (no trailing slash) |
| Signup **429 Too Many Requests** | Supabase email rate limit — see [02-supabase-cloud.md § Rate limits](02-supabase-cloud.md#rate-limits-and-signup-429) or use Dashboard **Add user** with Auto Confirm |
| GitHub repo not found | Re-authorize Cloudflare Pages app on GitHub for this repo |
| Build OOM on free tier | Retry; or split build: `npm ci && npm run build --workspace=@lantern/web` |

---

## Deploy checklist

- [ ] Cloudflare API token in `.env.cloudflare`
- [ ] Root `.env` has cloud `VITE_*` values
- [ ] `public/_redirects` pushed to `main`
- [ ] `.\scripts\deploy-cloudflare-pages.ps1` succeeds
- [ ] Supabase Site URL + redirect URLs updated
- [ ] Sign up / login smoke test on live URL

---

## Search engine indexing (SEO)

After deploy, confirm these URLs respond (copied from `public/`):

| URL | Purpose |
|-----|---------|
| `https://lanternstudy.com/robots.txt` | Allows crawlers; points to sitemap |
| `https://lanternstudy.com/sitemap.xml` | Lists public pages for Google/Bing |
| `https://lanternstudy.com/sitemap/marketplace.xml` | Dynamic marketplace listing URLs (proxied from API) |
| `https://lanternstudy.com/marketplace` | Public browse (guest mode) |

**Google Search Console (one-time):**

1. Open [Google Search Console](https://search.google.com/search-console)
2. Add property **URL prefix** → `https://lanternstudy.com` (not `/sitemap.xml`)
3. Verify with the HTML file at `public/google251095c8c1cce4a1.html` (served at site root after deploy)
4. Submit sitemaps (full URLs on your domain — not file paths):
   - `https://lanternstudy.com/sitemap.xml`
   - `https://lanternstudy.com/sitemap/marketplace.xml`
5. Use **URL Inspection** → **Request indexing** on the homepage

Indexing can take days to weeks. The app is login-first, so ranking improves further with backlinks (GitHub README, app stores, social profiles).
