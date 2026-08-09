# Preview CI/CD — test implementations per PR

Use GitHub branches + Cloudflare Pages **preview aliases** to try different
implementations without deploying to `lanternstudy.com`.

## Lanes

| Lane | Trigger | Where it goes |
|------|---------|----------------|
| **CI** | Every PR + push to `main` | Checks only (`.github/workflows/ci.yml`) |
| **Web preview** | Same-repo PR open/sync | `https://<branch>.lantern-study.pages.dev` |
| **Web production** | Manual `workflow_dispatch` | `https://lanternstudy.com` |
| **API production** | Manual `workflow_dispatch` | Render `lantern-study-api` |
| **Mobile preview** | `eas update --channel preview` | OTA to preview binaries |
| **Mobile production** | `eas update --channel production` | OTA to store binaries |

Production web/API stay **manual on purpose**. Preview web is automatic per PR.

## One-time GitHub setup

### 1. Create Environment: `preview`

Repo → **Settings → Environments → New environment** → name it `preview`.

Add the same Cloudflare secrets you use for production deploys:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Pages Edit (+ Account Settings Read) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

Add Variables (same values as production builds):

| Variable | Example |
|----------|---------|
| `VITE_SUPABASE_URL` | `https://tiizkjhbrnaibaagmurl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | cloud anon JWT |
| `VITE_API_URL` | `https://lantern-study-api.onrender.com` |
| `VITE_SENTRY_DSN` | optional |

> Preview builds currently hit the **production** API + Supabase. Do not use
> local `127.0.0.1` values. A dedicated staging API can be wired later by
> pointing `VITE_API_URL` at a Render staging service.

### 2. Confirm Actions permissions

Repo → **Settings → Actions → General**:

- Allow GitHub Actions to create/update PR comments (default for `pull-requests: write`)

### 3. Workflow file

`.github/workflows/preview-web.yml` runs on every same-repo PR and posts a sticky
comment with the preview URL.

Fork PRs are skipped (no access to secrets).

## Day-to-day workflow

```bash
git checkout -b cursor/my-experiment-82b1
# ... implement ...
git push -u origin HEAD
gh pr create --fill
```

1. Wait for **CI** + **Preview web** to go green.
2. Open the URL from the bot comment on the PR (`## Web preview`).
3. Compare implementations across PRs — each branch keeps its own Pages alias.
4. When ready, merge to `main`, then manually run:
   - **Deploy web (Cloudflare Pages)**
   - **Deploy API (Render)** (if the API changed)
   - `eas update --channel preview|production` (if mobile JS changed)

## Manual preview (no PR)

Actions → **Preview web (Cloudflare Pages)** → **Run workflow** → set `ref` to a
branch name.

## Mobile experiments

```bash
cd apps/mobile
eas update --channel preview --message "Try experiment X"
```

Force-quit and reopen the preview app to pick up the OTA. Production channel is
untouched.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Preview job: missing Cloudflare secrets | Add them to Environment `preview` |
| Preview job: Vite vars not inlined | Set `VITE_*` on Environment `preview` |
| Preview URL 404 | Wait 1–2 minutes; confirm Actions log shows deploy success |
| Login fails on preview | Must use a **cloud** Supabase account (not localhost) |
| Fork PR skipped | Push the branch to `bjamilk/lantern-study` instead |

## Next upgrades (not in this pass)

- Staging Render API service + preview `VITE_API_URL`
- Staging Supabase project for schema experiments
- Auto EAS Update on mobile-touching PRs
