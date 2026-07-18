# CI/CD pipeline setup (preview → staging → production)

Branch protection is on. This guide lists **what you must configure** so PR previews, staging API, Playwright smoke, and post-merge production deploys work.

## Pipeline overview

| Event | Workflow | What happens |
|-------|----------|----------------|
| Pull request (non-draft) | `preview-web.yml` | Build web → Cloudflare Pages **preview** branch `pr-<n>` → Playwright smoke on preview URL → PR comment |
| PR touching API | `deploy-staging-api.yml` | Deploy **`lantern-study-api-staging`** on Render |
| Push to `main` / manual | `deploy-production.yml` | Deploy Cloudflare Pages **production** (`main`). Optional: Render prod API via workflow input |
| Always on PR/push | `ci.yml` | Build, typecheck, API unit tests, secret scan, audit |

Local scripts (unchanged):

```powershell
.\scripts\deploy-cloudflare-pages.ps1          # prod web
.\scripts\deploy-render-api.ps1                # prod API + worker
.\scripts\deploy-render-api.ps1 -Staging       # staging API only
```

---

## 1. GitHub repository secrets

**Settings → Secrets and variables → Actions → Secrets**

| Secret | Required for | Where to get it |
|--------|--------------|-----------------|
| `CLOUDFLARE_API_TOKEN` | Preview + prod web | [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens) — Account → **Cloudflare Pages → Edit**, Account Settings → Read |
| `CLOUDFLARE_ACCOUNT_ID` | Preview + prod web | Cloudflare dashboard URL / `wrangler whoami` (also in `.env.cloudflare.example`) |
| `VITE_SUPABASE_URL` | Web builds | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Web builds | Supabase anon (public) key |
| `VITE_API_URL` | Web builds | `https://lantern-study-api.onrender.com` (browser still uses same-origin `/api` on Pages) |
| `RENDER_API_KEY` | Staging + optional prod API | [Render → API keys](https://dashboard.render.com/u/settings#api-keys) |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging/prod API deploy | Supabase → Settings → API (**service_role**, keep secret) |
| `SUPABASE_ANON_KEY` | Staging/prod API deploy | Same as Vite anon key |
| `GROQ_API_KEY` | Staging/prod API (AI) | Groq console |
| `REDIS_URL` | Prod API (and staging fallback) | Upstash / Redis URL used by production |
| `REDIS_URL_STAGING` | Staging API (recommended) | **Separate** Redis DB from prod when possible |
| `JWT_SECRET` | Prod API deploy | Long random string (match Render prod if already set) |
| `JWT_SECRET_STAGING` | Staging API (optional) | Separate secret; otherwise falls back to `JWT_SECRET` |
| `AUDIT_EMAIL` | Optional auth Playwright | Test user email (not required for public smoke) |
| `AUDIT_PASSWORD` | Optional auth Playwright | Test user password |

**Variables** (optional):

| Variable | Default if unset |
|----------|------------------|
| `PRODUCTION_WEB_URL` | `https://lanternstudy.com` |
| `GOTENBERG_URL` | `https://lantern-study-gotenberg.onrender.com` |

---

## 2. Cloudflare Pages project settings

Project name: **`lantern-study`**

### Environment variables (Workers & Pages → lantern-study → Settings → Environment variables)

| Variable | Production | Preview |
|----------|------------|---------|
| `LANTERN_API_UPSTREAM` | `https://lantern-study-api.onrender.com` | `https://lantern-study-api-staging.onrender.com` |
| `VITE_SUPABASE_URL` | (same as secret) | same |
| `VITE_SUPABASE_ANON_KEY` | (same) | same |
| `VITE_API_URL` | prod API URL | prod or staging URL (rewritten to same-origin `/api` at runtime) |
| `NODE_VERSION` | `20` | `20` |

`LANTERN_API_UPSTREAM` is read by `functions/api/[[path]].ts` so PR previews call **staging**, not production.

You can also apply these via:

```powershell
.\scripts\deploy-cloudflare-pages.ps1
```

(that script sets production vs preview upstreams when using the Cloudflare REST API path).

### Preview deployments

- If the project is **GitHub-connected**: enable **Preview deployments** for all branches / PRs (`preview_deployment_setting = all`).
- CI also deploys via Wrangler (`pr-<number>` branch) so previews work even without the GitHub integration.

### Supabase Auth URLs

Add wildcard or each preview pattern if you test magic links on previews:

- `https://*.lantern-study.pages.dev/**`
- Site URL can stay `https://lanternstudy.com`

---

## 3. Render staging service (one-time)

1. Sync blueprint or create service **`lantern-study-api-staging`** from `render.yaml`, **or** run once locally:

   ```powershell
   $env:RENDER_API_KEY = 'rnd_...'
   .\scripts\deploy-render-api.ps1 -Staging
   ```

2. In the Render dashboard for staging, set secrets:
   - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GROQ_API_KEY`
   - `REDIS_URL` (prefer a **staging** Redis instance)
   - Confirm `BULLMQ_ENABLED=false` (no staging worker)

3. Note the public URL: `https://lantern-study-api-staging.onrender.com`  
   Put that in Cloudflare **Preview** `LANTERN_API_UPSTREAM`.

Free-tier staging **sleeps** after idle; the first PR smoke after a quiet period may be slower (proxy can return until wake completes).

---

## 4. Branch protection (already on)

Recommended required checks (GitHub → Settings → Branches → your rule):

- `CI / build-and-typecheck`
- `CI / api-tests`
- `Preview web (Cloudflare + Playwright) / preview`

Do **not** require `Deploy production` on PRs (it only runs on `main`).

---

## 5. Production deploy path

After merge to `main`:

1. **`deploy-production.yml`** runs automatically → Cloudflare Pages production.
2. API/worker: either keep using `.\scripts\deploy-render-api.ps1` locally, **or** run **Actions → Deploy production → Run workflow** with **Also deploy Render production API** checked.

Production is intentionally **not** tied to every PR; only post-merge (or manual).

---

## 6. Verify end-to-end

1. Open a draft PR → preview workflow should **skip**.
2. Mark ready / open non-draft PR → preview comment with `*.pages.dev` URL.
3. Open that URL → login/public pages load; Network tab shows `/api/...` same-origin.
4. Merge to `main` → production web updates; confirm `https://lanternstudy.com`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Preview deploy fails auth | Check `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| Playwright 502 on `/api/...` | Staging asleep or `LANTERN_API_UPSTREAM` wrong on Preview env |
| CORS errors (rare; same-origin should avoid) | Staging allows `*.lantern-study.pages.dev` in `corsOrigins` |
| Staging create fails on Render | Workspace may disallow free web; upgrade staging plan or create service in dashboard |
| Prod web wrong API | Production `LANTERN_API_UPSTREAM` must point at `lantern-study-api` (not staging) |
