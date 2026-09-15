# How the web build is wired

Notes for anyone touching `apps/web/vite.config.ts` or `apps/web/turbo.json`.
The turbo config is JSON and carries no room for explanation, so its reasoning
lives here.

## The web app does not live in `apps/web`

`apps/web` is only the package shell: its `vite.config.ts` sets `root` to the
**repo root**. The actual application source is at the top level —
`App.tsx`, `index.tsx`, `index.html`, `index.css`, `components/`, `hooks/`,
`stores/`, `services/`, `utils/`, `design-system/`, `types.ts`.

Two consequences:

- Every path in `vite.config.ts` described as relative to `root` is relative to
  the repo root, not to `apps/web`. That is why `build.outDir` is
  `apps/web/dist` rather than `dist`.
- Turbo, left to itself, would hash only `apps/web/**` and consider the package
  unchanged after an edit to `components/` or `App.tsx`.

## Why `apps/web/turbo.json` lists `../../` inputs

The `build` task's `inputs` array explicitly names the root source directories
alongside `$TURBO_DEFAULT$`. Without them, turbo reports a cache hit and replays
a previously built `dist`, so a build can finish green in a few seconds and
deploy pre-change JavaScript while reporting success. Two web deploys shipped
stale bundles this way before the inputs were added.

Entries that exist for non-obvious reasons:

- `../../public/**` — Vite copies `public/` into `dist` verbatim, so `_headers`,
  `_redirects`, `_routes.json`, `.well-known/assetlinks.json` and `sw.js` are
  build outputs even though nothing imports them.
- `../../scripts/**` — `buildContentSecurityPolicy.mjs` lives there and is baked
  into `dist/_headers` at build time; editing the CSP without this input
  produced a cached `dist` carrying the previous policy.

**If you add a new top-level source directory that the web app imports from, add
it to `inputs` in the same change.** Nothing fails loudly when you forget; the
symptom is a stale deploy.

`outputs` is `["dist/**"]`, resolved relative to `apps/web`. That is also why
`build.outDir` in the Vite config must stay `apps/web/dist`: with any other
value, the cache captures nothing and a warm cache hit "succeeds" while
restoring no artifacts.

## Verifying a build actually rebuilt

`npm run build` for this package is `tsc && vite build`. A strict-tsc failure
(the repo sets `noUncheckedIndexedAccess`) fails the whole command, and a deploy
step pointed at `apps/web/dist` will then upload the *previous* dist with a
cheerful success message.

- Confirm the build printed `✓ built in …` and that `apps/web/dist/index.html`
  references fresh `index-*.js` hashes.
- Confirm the served bundle matches:
  `curl -s "https://lanternstudy.com/?cb=$(date +%s)" | grep -oE 'index-[^"]+\.js'`
- Do not use the service worker's cache id as evidence of a fresh deploy — it is
  a per-build id, not a content hash.

## Which gate is real

Root `npx tsc --noEmit` is **not** a gate for this app: the root tsconfig sweeps
other workspaces and produces thousands of pre-existing errors. `vitest` never
typechecks. The real gate is:

```
npx turbo run build --force --filter=@lantern/web
```

`--force` matters when you are checking a change rather than producing a
deployable artifact: a cache hit skips `tsc` entirely, so latent strict-mode
errors stay invisible until a cache miss runs a real compile.

## Vitest scoping

The `test.include` list in `vite.config.ts` is deliberately explicit. Without
it, vitest walks the whole monorepo and collects `apps/api-server`'s Jest suites,
which fail with "describe is not defined". Several directories (`utils/`,
`stores/`, `services/`) were missing from the list at various points, which meant
suites that existed had never actually run. `globals: true` is set because the
shared package's suites run under Jest and use bare `describe`/`it`.
