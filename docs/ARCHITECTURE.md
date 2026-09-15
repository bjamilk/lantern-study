# Architecture

How Lantern Study is put together, how a request travels, who owns the data, and the traps
that have already cost someone a day.

---

## 1. The pieces

Four deployable things, three of them under `apps/`, plus one shared package.

| Piece | Stack | Deployed to | Source |
|---|---|---|---|
| **Web app** | React 19 + Vite + Tailwind + Zustand | Cloudflare Pages | **the repository root** (`App.tsx`, `components/`, `hooks/`, `stores/`, `services/`, `utils/`) |
| **Pages Functions** | Cloudflare Workers runtime | Cloudflare Pages, same project | `functions/` |
| **API + worker** | Express 5, BullMQ, TypeScript (CommonJS) | Render — two services, one Dockerfile | `apps/api-server/` |
| **Mobile app** | Expo SDK 54 / React Native 0.81.5 | EAS → Play Store / TestFlight | `apps/mobile/` |
| **Shared core** | TypeScript | consumed, not deployed | `packages/shared/` |

`apps/web` holds **no application source**. It is the web build and test harness: its
`vite.config.ts` sets Vite's `root` to the repo root and writes the bundle to
`apps/web/dist`. Expect this to surprise you once.

### The shared package is consumed two different ways at once

`packages/shared/package.json#exports` maps `types` / `import` / `default` to **`./src/*.ts`**
but `require` to **`./dist/*.js`**. So Vite and Metro compile shared from *source*, while
`apps/api-server` (CommonJS) resolves every `@lantern/shared/*` subpath through its
`tsconfig.json#paths`, which point at **`packages/shared/dist/`**.

Three consequences:

1. Any API build or test must run `npm run build --workspace=@lantern/shared` first. Every
   workflow does this.
2. `packages/shared/tsconfig.server.json` `include` is a **hand-maintained file list**, not a
   glob. A new shared subpath the API needs must be added there *and* to the API's `paths` map.
3. A stale `dist` makes `tsc` report success on code that does not compile.

---

## 2. The request path

```
Browser (lanternstudy.com)
  │  fetch('/api/v1/...')  — same-origin, credentials: 'include'
  ▼
Cloudflare Pages Functions — functions/api/[[path]].ts
  │  same-origin proxy; this is what makes HttpOnly cookie auth work at all
  │  (a cross-origin call could not carry the session cookie)
  ▼
Express API — lantern-study-api.onrender.com  (apps/api-server/src/server.ts)
  │  middleware: auth → CSRF → rate limit → idempotency → load shed
  ├──────────────► Supabase PostgREST + Auth + Storage
  │                 service-role key, server-side only
  └──────────────► Redis / BullMQ  (apps/api-server/src/queue/)
                     │  AI jobs are enqueued, not awaited
                     ▼
                   Worker service — apps/api-server/dist/worker.js
                     same image, different start command
```

**Mobile** skips the Pages proxy and calls the Render API directly with a bearer token; it
does not use cookie auth. That asymmetry is why an auth bug can be web-only or mobile-only.

**Routing on Cloudflare** is driven entirely by `public/_routes.json` — there is no
`wrangler.toml` anywhere in the repo. Wrangler compiles `./functions` **relative to the
deploy cwd**, which must be the repo root; `deploy-web.yml` asserts `test -d functions/api`
and greps wrangler's output for "Uploading Functions bundle" for exactly this reason.

---

## 3. Data ownership

- **Postgres (Supabase) is the single source of truth.** All schema change goes through
  `supabase/migrations/*.sql`, applied **by hand**. Nothing in CI applies a migration —
  merging one does not run it.
- **Row Level Security is the real authorization boundary** for anything a client touches
  directly. Policies live in the migrations alongside the tables.
- **The API holds the service-role key and therefore bypasses RLS.** Any route using it owns
  its own authorization check. This matters most on public/unauthenticated endpoints, where
  a service-role query will happily return rows RLS would have hidden.
- **Storage** (avatars, chat and board images, marketplace assets) is Supabase Storage behind
  signed URLs. Signed URLs expire — anything cached must be re-signed, not stored.
- **Client caches are not authoritative.** Mobile persists to AsyncStorage and the web to
  IndexedDB/localStorage for offline work; on refresh the **server wins per id**.

---

## 4. Deployment

| Target | Trigger | Workflow |
|---|---|---|
| Web (Cloudflare Pages) | automatic on push to `main` | `.github/workflows/deploy-web.yml` |
| API + worker (Render) | manual dispatch only | `.github/workflows/deploy-api.yml` |
| Mobile (EAS) | manual `eas build` | — |
| Supabase migrations | manual, by hand | — |

`deploy-web.yml` runs entirely from the repo root and verifies its own output: it greps the
built bundle for the `__LANTERN_VITE_SUPABASE_URL__` / `__LANTERN_VITE_SUPABASE_ANON_KEY__`
globals set by `env-bootstrap.ts`, decodes the JWT issuer to prove the deploy points at
production, confirms the live `sw.js` cache id, and checks that
`POST /api/v1/auth/refresh` returns JSON. **Renaming `env-bootstrap.ts` or those globals
breaks the deploy gate.**

`render.yaml` pins `dockerfilePath: ./apps/api-server/Dockerfile` with
`dockerContext: .` — the repo root, because the image needs the whole workspace. The worker
service is the same image with `dockerCommand: node apps/api-server/dist/worker.js`.

---

## 5. Known traps

Each of these has already caused a real incident. Verified file pointers.

- **Two repos, one hijacked cwd** — `~/Desktop/Lanternstudy` (no hyphen) is a stale squashed clone whose presence as session cwd sent worktrees, code reviews and audits to the wrong tree three times, producing confidently wrong conclusions. Pointer: `~/Desktop/Lanternstudy` vs the real repo root `App.tsx`.
- **Stale web dist shipped as "deployed"** — the web sources live at the repo root, so a turbo cache miss, a failed `tsc && vite build`, or a CI Pages build superseding a manual wrangler upload can all leave production on old JavaScript while the logs report success. Pointer: `apps/web/turbo.json`, `tsconfig.base.json`.
- **Root `tsc --noEmit` is a false gate** — the root tsconfig sweeps api-server tests without Jest types and reports ~3.9k pre-existing errors, so real breakage reads as baseline noise. The real gate is `npm run build` via turbo. Pointer: `tsconfig.json`, `turbo.json`.
- **Slim EAS lockfile goes stale silently** — every Android build runs `npm ci` against a hand-maintained slim lockfile, so any mobile dependency change fails `INSTALL_DEPENDENCIES` or crash-loops at boot while the root lockfile looks innocent. Pointer: `scripts/package-lock.eas-mobile.json`, `scripts/eas-prepare-mobile-install.js`.
- **PostgREST embed ambiguity from a second FK** — adding a second foreign key from `community_members` to `profiles` made every bare `profiles!inner(...)` embed return PGRST201, breaking the members roster in every community while all test gates stayed green. Pointer: `apps/api-server/src/services/communities.ts`, `apps/api-server/src/services/communities.membersEmbed.test.ts`.
- **`onConflict` on a partial unique index** — PostgREST never sends the index predicate, so upserting `message_reactions` returned 42P10 as a generic 500 for every reaction write. Pointer: `apps/api-server/src/services/messageReactions.ts`.
- **Cookie-mode refresh self-sign-out** — under HttpOnly-cookie auth the in-memory refresh token is the literal string `cookie-managed`, so any gotrue internal refresh posts it, gets a 400, and signs the user out. Pointer: `services/authCookieSession.ts`, `services/supabase.ts`.
- **Cached chat rows overwrite the server** — `mergeChatMessagesById` is incoming-wins, and the refresh path passed the hydrated cache as the incoming side, so reactions and edits reverted after a cold start. A refresh merge must be server-wins per id. Pointer: `packages/shared/src/utils/chatMessageMerge.ts`.
- **Bare `@lantern/shared` breaks mobile Jest** — the Jest config maps only subpaths, so a bare import type-checks and bundles fine but aborts the entire mobile suite the day someone writes the first test for that file. Pointer: `apps/mobile/jest.config.js`, `apps/mobile/tsconfig.json`.
- **Font-size change remounts the whole tree** — bumping font size re-keys the app wrapper so `NavigationContainer` remounts, and React Navigation discards a pending `initialState` if the boot gate delays the first navigator by one commit, dumping the user back on Home. Pointer: `apps/mobile/src/navigation/RootNavigator.tsx`, `apps/mobile/src/theme/ThemeProvider.tsx`.
- **Flex-col vertical crush, not horizontal clipping** — an `overflow-hidden` block inside a `flex-col overflow-y-auto` container loses its automatic minimum height and gets squashed as content grows, clipping text at any window size. Pointer: `components/ui/FeatureHero.tsx`, `components/offline/OfflineBundleCard.tsx`.
- **Tailwind purge fails silently** — `tailwind.config.js` content globs are root-relative and enumerate the root web directories one by one, and `postcss.config.js` pins the config by **absolute** path. That pairing is the only reason the globs resolve while Vite runs from `apps/web`. A purge failure produces an unstyled app with a zero exit code. Pointer: `tailwind.config.js`, `postcss.config.js`.
- **Theme tokens have exactly one home** — `:root` / `.dark` live only in `index.css`. Dark mode was once dead because an inline light palette on `<html>` shadowed them. Pointer: `index.css`.

---

## 6. Where to go next

- [DEVELOPMENT.md](DEVELOPMENT.md) — local setup, Node/JDK versions, the Metro port workaround.
- [CONTRIBUTING.md](CONTRIBUTING.md) — which gate to run for which change.
- [RELEASING.md](RELEASING.md) — cutting a release, migration apply order.
- [HANDOVER.md](HANDOVER.md) — the canonical pointer to what is currently in flight.
