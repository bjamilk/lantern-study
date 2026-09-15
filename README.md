# Lantern Study

Collaborative study platform for university students: flashcards with FSRS scheduling,
practice tests and exam mode, notes, study groups and community lounges, an AI study
companion, and a creator marketplace for study packs, notes and question banks.

**Production web app:** [https://lanternstudy.com](https://lanternstudy.com)
**Android:** [latest release APK](https://github.com/bjamilk/lantern-study/releases/latest/download/lantern-study.apk)

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

---

## Repository map

npm workspaces + Turborepo. **Four** deployable things, but only three live under `apps/`.

> **The web app lives at the repository root**, not in `apps/web`. `apps/web` is the web
> app's build and test harness: its `vite.config.ts` sets Vite's `root` to the repo root and
> writes the bundle to `apps/web/dist`. This is the single most confusing thing about the
> layout — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Top-level entry | What it is |
|---|---|
| `App.tsx`, `index.tsx`, `index.html`, `index.css` | Web app entry point, root component, Vite HTML, and the **only** home of the theme tokens (`:root` / `.dark`). |
| `components/`, `hooks/`, `stores/`, `services/`, `utils/` | Web app source: UI, extracted `App.tsx` logic, Zustand stores, the network/data layer, helpers. |
| `design/` | Web type-scale **code**, not docs: `type.css` (imported by `index.tsx`) and `typeScaleAllowlist.ts` (asserted by a CI lint test). |
| `design-system/` | Authored design **guidance** in Markdown. No programmatic reader. Not the same thing as `design/`. |
| `types.ts`, `gamification.ts`, `env-bootstrap.ts` | Root shims. `env-bootstrap.ts` sets the `__LANTERN_VITE_*__` globals the deploy gate greps out of the built bundle — do not rename it or them. |
| `public/` | Copied verbatim into the bundle: `_headers`, `_redirects`, `_routes.json`, `sw.js`, `manifest.json`, fonts. |
| `functions/` | Cloudflare Pages Functions, deployed from the repo root alongside the web bundle. Includes the same-origin `/api` proxy that makes cookie auth work. |
| `apps/web/` | Web build + test harness only (Vite config, vitest config and suites, Playwright, build scripts). **No app source.** |
| `apps/api-server/` | Express 5 + BullMQ. One Dockerfile, two Render services (API and worker). |
| `apps/mobile/` | Expo SDK 54 / React Native 0.81.5, shipped via EAS. |
| `packages/shared/` | The common core consumed by all three apps (types, API client, domain logic). |
| `supabase/` | `config.toml` plus the migration history. Migrations are hand-applied. |
| `scripts/` | CI gates, the CSP builder Vite imports, SEO helpers, deploy PowerShell scripts, and the slim EAS lockfile. |
| `patches/` | `patch-package` patches applied by the root `postinstall`. |
| `docs/` | All documentation — runbooks, handovers, deploy guides, compliance, phase contracts. |

---

## Running each app

Node 20 is required (`~/.nvm/versions/node/v20.20.2` on the maintainer's machine). Install
once from the repo root with `npm install`.

```bash
npm run dev:web      # web app on Vite (runs from apps/web, serves the repo root)
npm run dev:api      # Express API + ts-node (builds @lantern/shared first)
npm run dev:mobile   # Expo
```

Mobile needs more setup than a single command — JDK/Temurin, the Metro-on-8082 workaround,
CocoaPods. The full runbook is [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

The API worker runs separately: `npm run worker:dev --workspace=@lantern/api-server`.
`docker-compose.yml` brings up a production-like API + Redis stack locally.

---

## Testing — the exact gate commands

```bash
# Full monorepo build (the real web typecheck lives here, not in root tsc)
npx turbo run build --force

# Web unit tests (vitest; config is the `test` key inside apps/web/vite.config.ts)
cd apps/web && npx vitest run

# Mobile typecheck (baseline is 0 errors)
cd apps/mobile && npx tsc --noEmit -p .

# API tests (Jest; needs @lantern/shared built first)
npm run build --workspace=@lantern/shared && npm test --workspace=@lantern/api-server
```

**Two false gates to know about.** Root `npx tsc --noEmit` sweeps the API's Jest suites
without Jest types and reports thousands of pre-existing errors — it is not a signal; use
`npm run build`. And a stale `packages/shared/dist` makes `tsc` report success on code that
does not compile — rebuild shared before trusting an API typecheck.

---

## Shipping

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the branch, review and PR flow, and
[docs/RELEASING.md](docs/RELEASING.md) for cutting a release.

Web deploys to Cloudflare Pages automatically on push to `main`
(`.github/workflows/deploy-web.yml`). The API deploys to Render on manual dispatch
(`.github/workflows/deploy-api.yml`). Mobile ships through EAS. Supabase migrations are
**hand-applied** — merging a migration does not run it.

---

## Where secrets live

No secret is ever committed. Names only:

- **Repo root `.env` / `.env.local`** — local web dev (`VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`). Template: `.env.example`.
- **`apps/api-server/.env`** — the API's full variable set (Supabase service role, Redis,
  AI provider keys, Paystack, Sentry). Template: `apps/api-server/.env.example`.
- **GitHub repository secrets and variables** — consumed by the deploy workflows.
- **Render dashboard** — the deployed API and worker environment groups.
- **Cloudflare Pages project settings** — the web build's environment.
- **EAS secrets** — mobile build-time values.
- **Operator-only templates at the repo root** — `.env.cloudflare.example`,
  `.env.render.example`, `.env.resend.example`, `.env.sentry.example`,
  `.env.production.example`. These stay at the root because `.dockerignore` allow-lists
  `.env.production.example` by path and several `scripts/*.ps1` deploy helpers and
  `docs/deploy/*` instruct operators to copy them from there.

---

## Start here

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit, the request path, and the known traps.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — the local setup runbook.
- [docs/HANDOVER.md](docs/HANDOVER.md) — the canonical "resume here" pointer for ongoing work.
- [docs/PRODUCTION_CHECKLIST.md](docs/PRODUCTION_CHECKLIST.md) — production readiness and compliance index.
