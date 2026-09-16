# Contributing

## PR flow

> **Placeholder — see CONTRIBUTING.** The branch, review and merge flow is owned by the
> CI/CD workstream and will be written here. Until it lands, follow what the existing
> workflows in `.github/workflows/` actually enforce (below) and open a PR against `main`.

## What CI enforces today

`ci.yml` runs on every PR from the repo root:

- builds `@lantern/shared`, then `@lantern/api-server`, then `npm run build:web`
- typechecks `@lantern/api-server` and `@lantern/web`
- `scripts/check-overrides.mjs` — the `overrides` block in the root `package.json` must be intact
- `scripts/migrate-design-tokens.mjs --check`
- `scripts/check-feature-registry.mjs`
- `scripts/check-secrets.sh`
- `npm audit` against `scripts/audit-allowlist.json`
- the api, mobile and web test suites

`admin-smoke.yml` is path-filtered on `apps/api-server/**`, `scripts/admin-smoke.ps1`,
`components/admin/**` and `services/admin.ts` — note the last two are **root** paths, so
moving that source moves the trigger.

## Which gate to run for which change

| You changed | Run |
|---|---|
| Web source (`components/`, `hooks/`, `stores/`, `services/`, `utils/`, `App.tsx`) | `npx turbo run build --force` and `cd apps/web && npx vitest run` |
| `packages/shared` | Rebuild shared first (`npm run build --workspace=@lantern/shared`), then the API build and tests — a stale `dist` makes `tsc` lie |
| `apps/api-server` | `npm run build --workspace=@lantern/shared && npm test --workspace=@lantern/api-server` |
| `apps/mobile` | `cd apps/mobile && npx tsc --noEmit -p .` (baseline 0) and `npm test --workspace=@lantern/mobile` |
| `public/`, `scripts/`, the CSP, `_headers`/`_redirects` | `npx turbo run build --force` — without `--force` turbo may replay a cached bundle |
| A Supabase migration | Nothing in CI applies it. Apply it by hand and record it in `docs/RELEASING.md` |

## The false gates

- **Root `npx tsc --noEmit` is not a gate.** It sweeps the API's Jest suites without Jest
  types and reports thousands of pre-existing errors. Use `npm run build`.
- **A warm turbo cache can hide a broken build.** `apps/web/turbo.json` hand-lists every
  root input because the sources live outside the package; if you move or add a root source
  directory and do not mirror it there, the next deploy ships the previous bundle. Use
  `--force` when verifying.
- **A stale `packages/shared/dist` makes the API typecheck pass on code that does not
  compile.** Rebuild shared before trusting it.
- **Your editor does not show the errors CI enforces for root web files.** VS Code
  resolves `App.tsx`, `components/`, `hooks/`, `stores/`, `services/`, `utils/` and
  `design-system/` against the repo-root `tsconfig.json`, which sets no `strict` and no
  `include`. CI holds the same files to `apps/web/tsconfig.typecheck.json` — strict, plus
  `noUncheckedIndexedAccess` — via `scripts/check-web-typecheck.mjs`. Code that looks clean
  in the IDE can fail the `web (build + vitest)` job, and the strict errors you are meant to
  be paying down are invisible. Run `node scripts/check-web-typecheck.mjs` (or
  `npx tsc -p apps/web/tsconfig.typecheck.json --noEmit` for the raw list) before pushing.
  Making the root config strict was measured and rejected — see `.vscode/settings.json`.

## House rules

- No secret is ever committed. `.env*` files are gitignored; only `*.example` templates are tracked.
- Scratch files (`tmp_*`, `temp_*`, logs, APKs, tarballs) are gitignored — do not force-add them.
- Documentation lives in `docs/`. The only Markdown at the repo root is `README.md`.
