# @lantern/web — the web build and test harness

**This package is not the web app.** The web application source lives at the **repository
root**: `App.tsx`, `index.tsx`, `index.html`, `index.css`, `components/`, `hooks/`,
`stores/`, `services/`, `utils/`, `design/`. This package contains only the machinery that
builds and tests it.

## What is in here

| Path | Purpose |
|---|---|
| `vite.config.ts` | The live Vite config. Sets `root` to the repo root, `build.outDir` to `apps/web/dist`, the React/`react-native` aliases, the dev proxy, **and the vitest config** (there is no separate vitest config file). |
| `turbo.json` | The stale-bundle guard — see below. |
| `tsconfig.json` | `include`s `src` and `packages/shared/src`. |
| `src/*.test.ts` | Vitest suites. They reach the app through `../../../` (e.g. `../../../stores/companionStore`). |
| `src/stubs/react-native.ts` | Aliased in the Vite config so root code importing `react-native` still bundles for web. |
| `e2e/` | Playwright specs. |
| `scripts/*.mjs` | Post-build steps: `inject-sw-build-id.mjs`, `inject-csp-headers.mjs`, the responsive audit tooling. |

## Run and test

```bash
npm run dev:web                       # from the repo root
npm run build --workspace=@lantern/web
cd apps/web && npx vitest run         # unit tests
npx playwright test -c playwright.config.ts   # responsive/e2e
```

`build` is `tsc && vite build && inject-sw-build-id && inject-csp-headers` — all four steps
matter; the last two write into `dist/`.

## Gotchas

- **`build.outDir` must stay `apps/web/dist`.** Turbo's `outputs: ["dist/**"]` resolves
  relative to this package; when `outDir` pointed elsewhere the cache captured *nothing*, so
  a warm hit "succeeded" while restoring no artifacts and the deploy shipped a stale bundle.
- **`turbo.json` hand-lists every root input** (`../../components/**`, `../../App.tsx`,
  `../../public/**`, `../../scripts/**`, …) because the sources live outside the package.
  **Any file added or moved at the root must be mirrored there**, or the next deploy silently
  ships the previous bundle. `../../public/**` and `../../scripts/**` are both in the list
  because each has already shipped stale once. Note `../../design/**` is *not* listed.
- **The vitest `include` globs are repo-root-relative** and explicit
  (`apps/web/src/**`, `components/**`, `utils/**`, `stores/**`, `services/**`,
  `packages/shared/src/learning/**`). Omitting one silently stops a whole real suite from
  running — this has happened. An explicit `include` is also mandatory: without it Vitest
  walks the monorepo and collects the API's Jest suites, which fail with
  "describe is not defined".
- **Tailwind resolves through an absolute path.** The root `postcss.config.js` pins
  `tailwind.config.js` by `path.join(__dirname, …)`; that is the only reason the root-relative
  content globs work while Vite runs from this directory. A purge failure is silent — an
  unstyled app with a zero exit code.
- `scripts/assert-prod-endpoints.mjs` has no invoker and resolves a `dist/` path the build no
  longer writes. Do not wire it up without fixing the path first.
