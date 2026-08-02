# AGENTS.md

## Cursor Cloud specific instructions

Lantern Study is a turbo + npm-workspaces monorepo. The end-to-end product for local
development is **web + api-server + a local Supabase stack**. `apps/mobile` (Expo) is
optional and not part of the web+API flow.

### Services

| Service | Dir | Dev command | Port |
|---|---|---|---|
| Web (Vite/React SPA) | root (Vite `root` = repo root) | see web command below | 5173 |
| API server (Express) | `apps/api-server` | `npm run dev:api` | 3001 |
| Supabase (Postgres/Auth/Storage, via Docker) | `supabase/` | `sudo supabase start` | API 55421, DB 55422, Studio 55430, Mailpit 55424 |

Redis is optional (`REDIS_ENABLED=false`; an in-memory LRU cache is used). AI providers
(Groq/Gemini/OpenAI/etc.) are optional; AI features degrade gracefully without keys.

### Startup order (services are NOT started by the update script)

1. Ensure Docker is running: `sudo service docker start` (Docker + the `supabase` CLI are
   preinstalled in the VM). Docker uses the `fuse-overlayfs` storage driver here.
2. `sudo supabase start` from the repo root. The **first** start applies ~133 migrations +
   `supabase/seed.sql` and is slow under fuse-overlayfs (several minutes); the `supabase_db_*`
   container reports `unhealthy` while migrations run — this is normal, just wait.
3. `npm run dev:api` — API on :3001 (its `predev` builds `@lantern/shared` first).
4. Web dev server (see gotcha below).

### Non-obvious gotchas

- **Web must proxy to the local API, and you must bypass Turbo for it.** On a Vite dev port
  the shared config (`packages/shared/src/config`) forces browser API calls through the
  same-origin `/__lantern_api` proxy, which **defaults to the production Render API**. Start
  the web app with the proxy pointed at the local API AND run Vite directly (Turbo 2's strict
  env mode strips the variable):
  `LANTERN_API_PROXY_TARGET=http://localhost:3001 npm run dev --workspace=@lantern/web`
  Do **not** use `npm run dev:web` for local full-stack work — Turbo drops
  `LANTERN_API_PROXY_TARGET`, so the browser logs into local Supabase but sends profile/API
  calls to prod and gets 401s.
- **`.env` files are gitignored** and hold local Supabase keys. Root `.env` has `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=http://localhost:3001`. `apps/api-server/.env` has
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL=http://localhost:5173`,
  `REDIS_ENABLED=false`. Recreate them from `sudo supabase status -o env` (`ANON_KEY`,
  `SERVICE_ROLE_KEY`) if missing. The local stack still accepts the legacy demo JWT anon/service
  keys; local access tokens are ES256, and the API verifies them via `auth.getUser()`.
- **Seed / test users.** `supabase/seed.sql` creates test users (e.g. `alice@example.com`,
  `bob@example.com`, `dev1@example.com`) — all with password `password123`. A DB trigger
  (`on_auth_user_created`) auto-creates `profiles`, so the seed uses upserts/`ON CONFLICT`.
  A `profiles_preserve_gamification` trigger intentionally strips client-set `points`/`badges`,
  so seeded points stay 0 — expected.
- **Lint doesn't work as committed:** `npm run lint` fails because `eslint` is not a dependency
  and there is no eslint config anywhere. Use `npm run typecheck` (tsc) for static checks.
- **Tests:** `npm test --workspace=@lantern/api-server` (jest). Two suites fail for pre-existing
  reasons unrelated to setup: `accountExportSign.test.ts` imports `vitest` but is picked up by
  jest, and one `storageAccess.test.ts` case makes a live `fetch`.

### Mobile (Expo) iOS builds

The iOS Simulator cannot run on this Linux VM (needs macOS + Xcode), but EAS iOS builds can be
triggered from here (they compile on Expo's cloud macOS builders). Notes:
- Auth via the `EXPO_TOKEN` secret; then e.g. `eas build -p ios --profile ios-simulator --non-interactive`.
- Always pass `EAS_SKIP_AUTO_FINGERPRINT=1` — the repo's `brace-expansion`/`minimatch`
  `overrides` break `@expo/fingerprint` (`brace_expansion_1.expand is not a function`).
- EAS mobile installs use a **slim** trimmed lockfile via `scripts/eas-prepare-mobile-install.js`
  (full-repo install OOMs). If you change `apps/mobile` deps, regenerate
  `scripts/package-lock.eas-mobile.json` or the EAS "Install dependencies" phase fails
  (strict `npm ci`). That script also must keep the markdown/math libs
  (`remark-math`, `rehype-katex`, `katex`, `react-markdown`, `remark-gfm`, `rehype-sanitize`)
  that `@lantern/shared` (`MarkdownRenderer.tsx`) imports, or Metro bundling fails to resolve them.
- The `ios-simulator` profile builds a standalone (non-dev-client) simulator app pointing at the
  cloud backend; the artifact is a `.tar.gz` containing a `.app` to install on a Mac Simulator.
- **Chat voice notes cannot be recorded in the iOS Simulator** (Apple/`expo-av` limitation). On
  Simulator the mic alerts and offers a silent **Send test note** to verify upload/playback. Real
  mic recording requires a physical iPhone (TestFlight / device development build).
