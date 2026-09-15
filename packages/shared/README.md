# @lantern/shared — the common core

Types, the API client, and domain logic used by all three apps (web, `apps/api-server`,
`apps/mobile`). Roughly thirty domain folders under `src/` — `academic`, `ai`, `analytics`,
`api`, `chat`, `dashboard`, `design`, `flashcards`, `jobs`, `learning`, `marketplace`,
`moderation`, `network`, `notes`, `settings`, `storage`, `stores`, `study`, `sync`, `types`,
`utils`, … — each exposed as an **explicit subpath** in `package.json#exports`.

Largest surfaces: `src/api/endpoints.ts` and `src/types/index.ts`.

## The one thing to understand: src vs dist

`package.json#exports` maps `types` / `import` / `default` to **`./src/*.ts`**, but `require`
to **`./dist/*.js`**. So:

- **Vite (web) and Metro (mobile) compile this package from source.** Edit a file, see it.
- **`apps/api-server` is CommonJS and resolves it from `dist/`**, via its own
  `tsconfig.json#paths`, which point every `@lantern/shared/*` subpath explicitly at
  `../../packages/shared/dist/…`.

## Run and test

```bash
npm run build --workspace=@lantern/shared      # tsc -p tsconfig.server.json → dist/
npm test  --workspace=@lantern/shared          # jest
npm run typecheck --workspace=@lantern/shared
```

`npm run build:all` compiles the full `tsconfig.json` rather than the server subset.

## Gotchas

- **Always rebuild before building or testing the API.** Every workflow runs
  `npm run build --workspace=@lantern/shared` first. A **stale `dist` makes `tsc` report
  success on code that does not compile** — the single most common false-green in this repo.
- **`tsconfig.server.json` `include` is a hand-maintained file list, not a glob.** Adding a
  new subpath the API needs means editing it **and** the API's `tsconfig.json#paths` map. Miss
  either and you get a confusing module-resolution failure that only reproduces in CI.
- **The web app and mobile each keep their own vitest/jest runner over parts of this
  package.** `globals: true` is set on the web side so the Jest-style suites here pass under
  Vitest too.
- **A refresh merge must be server-wins per id.** `src/utils/chatMessageMerge.ts`
  (`mergeChatMessagesById`) is *incoming*-wins; passing a hydrated local cache as the incoming
  side silently reverts reactions and edits after a cold start.
- `tsconfig.tsbuildinfo` is tracked, so it shows up as a modified file whenever anyone builds.
