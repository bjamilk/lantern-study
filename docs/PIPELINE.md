# Pipeline

How a change gets from a branch to students, and what stands in its way.

Written for a one-engineer team that is about to become a two-engineer team.
Every gate here exists because something reached production without it.

---

## The flow, end to end

```
branch ──▶ push ──▶ pull request ──▶ CI (9 jobs) ──▶ review ──▶ squash merge
                         │                                          │
                         └──▶ preview-web ──▶ pr-N.pages.dev        ▼
                                                            push to main
                                                                    │
                          ┌─────────────────────────────────────────┤
                          ▼                                         ▼
                   deploy-web.yml                            deploy-api.yml
                   provenance ──▶ ci ──▶ deploy              provenance ──▶ ci ──▶ deploy
                          │                                         │
                          ▼                                         ▼
                   Cloudflare Pages                            Render (API + worker)
                   lanternstudy.com                    lantern-study-api.onrender.com
```

Mobile is not on this path. It ships from a tag on `main` by hand — see
[Releasing mobile](#releasing-mobile).

### Why deploy can never run on red CI

`deploy-web.yml` and `deploy-api.yml` call `ci.yml` as a **reusable workflow**
(`uses: ./.github/workflows/ci.yml`), and their `deploy` job declares
`needs: [provenance, ci]`. The dependency is an edge in a single run's job
graph, so the deploy job is not merely discouraged from starting on a red tree —
it is unreachable.

The alternative, `workflow_run` (trigger the deploy when the CI *workflow*
completes with `conclusion == 'success'`), was rejected. It makes the deploy a
separate run that has to identify which commit the finished CI run was about,
and a mismatch there fails open — it deploys. Before this change the two
workflows were plain siblings on `push: main` with no edge at all, and the web
bundle shipped on a red `main` twice in 48 hours (runs `34791618300` and
`34760148524`). The cost of the reusable-workflow pattern is that CI runs again
on `main` after having run on the PR. That is a few minutes of Actions time to
make a whole class of mistake impossible, and it is worth it.

---

## Required checks

Set these as required status checks on `main` (exact names, as GitHub reports
them from the job `name:` fields in `.github/workflows/ci.yml`):

| Check name | What fails it |
|---|---|
| `shared (build + jest)` | shared build, or the shared jest suite that no job ran until now |
| `api (tsc + jest + audit)` | api lint/build/tsc/jest, `check-overrides.mjs`, `check-audit.mjs` |
| `ledger (PostgREST embed disambiguation)` | a schema or client change that makes a PostgREST embed ambiguous |
| `mobile (tsc + jest)` | mobile `tsc --noEmit`, and `jest --no-cache` (which is what reproduces the bare-specifier trap) |
| `web (build + vitest)` | `turbo build --filter=@lantern/web --force`, web tsc, web vitest |
| `design (contrast + tokens)` | `design:contrast`, `migrate-design-tokens.mjs --check` |
| `registry (feature registry bump)` | a mobile release that did not touch the admin feature registry |
| `secrets (tree scan)` | a credential-shaped string anywhere in the tree |
| `migrations (idempotency + ordering)` | a non-idempotent, destructive or out-of-order migration |

**Not required, on purpose:**

- `preview` (`preview-web.yml`) — a Cloudflare hiccup must not block a merge.
- `admin-smoke` — gated off by default; a permanently skipped job that is
  *required* blocks every merge.
- `security-regression` — **make this required the day its secrets exist**, and
  not before. It now fails when the credentials are missing, which is correct
  (see below) but would block every PR if it were required today.

### The three checks that were worse than missing

1. **`security-regression` passed green while skipping every PoC.** All six
   PowerShell proofs were gated on Supabase secrets that were never configured;
   the job warned and exited 0. A green check that asserts nothing is worse than
   a missing one, because people read it and believe it. It now **fails** with
   the missing secret names.
2. **`deploy-web` shipped on red CI** — fixed by the `needs:` edge above.
3. **`deploy-api` gated nothing** because Render auto-deployed from `main` on its
   own git hook; the build and tests in that workflow were decoration.
   `render.yaml` now sets `autoDeployTrigger: "off"` on `lantern-study-api` and
   `lantern-study-worker`, so the workflow is the only door. **This takes effect
   only when the blueprint is re-applied** — until then set Auto-Deploy to "No"
   by hand in the Render dashboard for both services. Re-applying the blueprint
   rotates `JWT_SECRET` (it is `generateValue: true`), which signs every live
   session out; the dashboard toggle is the safer move.

---

## Branch protection

The repository is **public** now, so branch protection and rulesets are free —
the audit's "$4/mo for GitHub Pro" recommendation is obsolete. Nothing needs
buying.

Two rulesets already exist (`Lantern_2`, `lantern_3`) and between them only block
branch **deletion** and **force-push**. Everything below is still unset: a direct
push to `main` lands today.

Apply to `main` (Settings → Rules → Rulesets, or edit `lantern_3`):

- [ ] **Require a pull request before merging** — 1 approval.
- [ ] **Dismiss stale approvals when new commits are pushed.**
- [ ] **Require review from Code Owners** (`.github/CODEOWNERS`).
- [ ] **Require status checks to pass** — the nine names in the table above.
- [ ] **Require branches to be up to date before merging.**
- [ ] **Block force pushes** — already on.
- [ ] **Restrict deletions** — already on.
- [ ] **Require linear history.**
- [ ] **Do not allow bypass** — while the founder is the only account with write
      access, leaving themselves on the bypass list makes the whole ruleset
      advisory. Self-approval is still possible on a personal repo; the honest
      description of "1 approval" here is a speed bump, and the real gate is CI.

Also in Settings → General → Pull Requests:

- [ ] **Allow squash merging** only — turn off merge commits and rebase, so
      history stays linear without needing the rule to enforce it.
- [ ] **Automatically delete head branches** — currently off.

```bash
# Read the current state
gh api repos/bjamilk/lantern-study/rulesets --jq '.[] | {id, name, enforcement}'
gh api repos/bjamilk/lantern-study/rulesets/19144624 --jq '[.rules[].type]'
gh repo view --json deleteBranchOnMerge,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
```

Branch protection is applied by the founder. These are the settings to tick, not
something CI can do for itself.

---

## Working a change

```bash
# 1. Branch from fresh main — the founder also commits from Cursor, so main moves.
cd /Users/jamin/Desktop/lantern-study
git checkout main && git pull --ff-only
git checkout -b fix/chat-roster-embed

# 2. Work. Then run what CI runs, before pushing.
npm run build                                   # full turbo graph
npm run typecheck --workspace=@lantern/mobile
npx jest --no-cache -w @lantern/mobile
npm run design:contrast
bash scripts/check-secrets.sh
node scripts/check-migrations.mjs

# 3. Commit (the pre-commit hook scans staged files) and push.
git add -A && git commit -m "Fix the community roster embed"
git push -u origin fix/chat-roster-embed

# 4. Open the PR — .github/pull_request_template.md fills the body.
gh pr create --base main

# 5. Watch CI, and read the preview comment the bot leaves on the PR.
gh pr checks --watch
```

### Reviewing and approving

In the UI: **Files changed → Review changes → Approve / Request changes**.

```bash
gh pr view 44 --web            # open it
gh pr diff 44                  # read the diff in the terminal
gh pr checks 44                # check status
gh pr review 44 --approve
gh pr review 44 --request-changes --body "The ownership branch still has no WITH CHECK."
gh pr merge 44 --squash --delete-branch
```

After the merge, `deploy-web.yml` and `deploy-api.yml` both fire on the push to
`main`, each running provenance → CI → deploy.

```bash
gh run watch "$(gh run list --workflow=deploy-web.yml --limit 1 --json databaseId --jq '.[0].databaseId')"

# Smoke the result
curl -s https://lantern-study-api.onrender.com/health          # .commit == merged sha
curl -s https://lanternstudy.com/sw.js | grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://lanternstudy.com/api/v1/auth/refresh -H 'Content-Type: application/json' -d '{}'
```

The deploy workflows already assert all three of those, which is the point — the
manual versions are for when you are debugging the workflow itself.

---

## The escape hatch

`scripts/check-merge-provenance.mjs` fails a deploy whose commit is not
associated with a **merged pull request**:

```bash
gh api repos/bjamilk/lantern-study/commits/<sha>/pulls --jq 'length'
```

GitHub has no pre-receive hook outside Enterprise, so a push straight to `main`
cannot be rejected — but it can be stopped from reaching production. It is a
tripwire, not a lock: the founder can always open a PR of one.

**The hatch:** a commit whose message contains `[release]` is allowed through
without a PR.

It exists for the mobile version-bump commits — bump `apps/mobile/app.config.ts`,
touch the feature registry, tag, build the APK — which are made directly on
`main` by the release process and would otherwise wedge the web deploy for
everyone. Use it for nothing else. Every use is visible:

```bash
git log --grep='\[release\]' --oneline
```

If you find yourself reaching for it to ship a fix, the fix wants a PR.

---

## Migrations

208 files in `supabase/migrations`, applied **by hand** against the linked
Supabase project. Nothing replays them, which is why the `migrations` CI job
exists. `scripts/check-migrations.mjs` lints every migration added or changed
against the base branch:

1. **Idempotent statements only.** `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
   `DROP POLICY IF EXISTS` before `CREATE POLICY`, `ADD COLUMN IF NOT EXISTS`.
   A file that fails halfway must be safe to re-run; without this, a partial
   apply leaves the remote diverged with no way back.
2. **No `DROP TABLE` / `TRUNCATE` / `DELETE FROM` / `DROP COLUMN` / `DROP SCHEMA`**
   unless the file contains a literal `-- destructive: approved` comment. The
   marker is the reviewer's signature — it is exactly what CODEOWNERS review on
   `/supabase/migrations/` exists to catch.
3. **The filename timestamp must be newer** than every migration on the base
   branch. An out-of-order timestamp applies fine on your laptop and then never
   applies on a machine that has already run a later file.

```bash
node scripts/check-migrations.mjs                 # vs origin/main
MIGRATION_CHECK_BASE=origin/main node scripts/check-migrations.mjs
node scripts/check-migrations.mjs --all           # every file; legacy ones fail, that is expected
```

### Applying them today, and the plan

Today: by hand, in the Supabase SQL editor, and the PR says whether it was done.
Two migrations have sat pending before because nothing tracked them.

The path off that, in order:

1. **A reporting job** (not yet built): `supabase migration list --linked`,
   printing the drift between repo and remote without failing. Just knowing the
   number would have caught both pending migrations.
2. **`migrate.yml` on `workflow_dispatch` + `environment: production`**: link,
   list, `supabase db push --include-all`, then re-run the PostgREST assertions.
   Needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in Actions.
   Keep it `workflow_dispatch` — **never** `pull_request`. A DB password exposed
   to a workflow that builds PR code is a DB password exposed to a malicious
   dependency in a Dependabot PR.
3. **Only after (1) and (2) have run clean for a month**, `db push` on
   `push: main`, sequenced before the API deploy.

The `ledger` CI job is the gate that addresses the failure mode a migration
linter cannot: SQL that is individually valid but breaks a client query. A
second foreign key between two tables made every PostgREST embed ambiguous and
silently emptied the community members roster in production. It runs with no
secrets at all.

---

## Releasing mobile

Mobile never deploys from a branch. Release builds come from a tag on `main`.

```bash
git checkout main && git pull --ff-only
# Bump apps/mobile/app.config.ts version + the admin feature registry.
git commit -am "Release 1.0.61: what changed [release]"
git tag v1.0.61 && git push origin main --tags
```

The `[release]` in that commit message is the provenance escape hatch — without
it the web deploy on that push fails, because a version bump is committed
straight to `main`.

Then build and publish:

- **Local APK (zero EAS credits):** Node 20 + JDK 17 + raised Gradle Metaspace,
  `eas build --local`. Upload the APK to a release in
  `bjamilk/lantern-study-releases` so the website's
  `releases/latest/download/lantern-study.apk` link resolves.
- **EAS cloud** builds are the alternative when credits exist, and the only path
  for iOS store builds.
- **Never `eas update` (OTA) from `main`** — it crash-loops Android with a
  Reanimated SIGABRT. Ship mobile via full builds only.

Trap worth automating later: `scripts/package-lock.eas-mobile.json` is a separate
slim lockfile resolved by `scripts/eas-prepare-mobile-install.js` during
`eas-build-pre-install`, and it goes stale silently. A job that regenerates it
and fails on a diff would close that.

---

## Secrets, by name and by home

### GitHub Actions secrets (repository)

| Name | Used by | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `deploy-web.yml`, `preview-web.yml` | Can publish to Pages. Rotate on a 90-day cadence. |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-web.yml`, `preview-web.yml` | |
| `RENDER_API_KEY` | `deploy-api.yml` | Can trigger deploys on **every** service the account owns. |
| `GITHUB_TOKEN` | provenance, preview comment | Provided automatically; no setup. |

### GitHub Actions variables (repository)

| Name | Notes |
|---|---|
| `VITE_API_URL` | |
| `VITE_SUPABASE_URL` | |
| `VITE_SUPABASE_ANON_KEY` | Correct as a **variable**. The anon key is public by design and RLS-governed, and `deploy-web.yml`'s issuer check reads it. Do not "fix" this by moving it to secrets. |
| `VITE_SENTRY_DSN` | Optional. |
| `RUN_ADMIN_SMOKE` | Not set. Setting it to `true` enables `admin-smoke.yml`. |

### Missing, and what their absence costs

| Name | Wanted by | Consequence today |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `security-regression.yml`, `admin-smoke.yml` | Both are inert. The regression job now fails loudly instead of passing green. |
| `VITE_SUPABASE_API_BASE_URL` | `security-regression.yml` | Still unset as of the first real run. Only the F-02 step needs it, so that step now fails by name while the five PostgREST-only PoCs run; it no longer falls back to the production API URL. F-02 mints a JWT against `VITE_SUPABASE_URL` and calls this host with it, so it must be the API server for **that same project** — a mismatch 401s every call and makes the IDOR probe read as "blocked" when nothing was blocked. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `admin-smoke.yml` | Same. |

**Point these at a staging Supabase project, never production.** The
service-role key bypasses RLS, and `security-regression.yml` runs on
`pull_request` — a compromised Action, or a malicious dependency in a Dependabot
PR, would reach production data with it.

**That staging project must have every migration in `supabase/migrations`
applied.** The PoCs seed real rows (listings, offers, inquiries, groups, notes)
through PostgREST, so they fail on a project whose schema lags: a missing table
surfaces as `PGRST205`, a missing column as `PGRST204`, and a column that became
`NOT NULL` later — `marketplace_listings.campus_id`, for one — as `23502`. The
seed listings also resolve a real `marketplace_campuses` row at run time, so the
marketplace location seed data must be present too. A failure like that is a
schema gap to close on the project, not a script to loosen.

### Elsewhere

| Home | What |
|---|---|
| **Render** | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `REDIS_URL`, `GROQ_API_KEY`, `FIREWORKS_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `MARKETPLACE_PAYSTACK_CHECKOUT` — all `sync: false`, so a blueprint sync can never switch live checkout on by itself. `JWT_SECRET` is `generateValue: true`: re-applying the blueprint rotates it and invalidates every live session. |
| **Cloudflare** | Pages project `lantern-study`. Functions in `functions/api` must be compiled from the repo root — the workflow asserts this. |
| **Supabase** | Project `tiizkjhbrnaibaagmurl`. The service-role key is the crown jewel; it appears in Render (api + worker) and in local `.env` files. Rotate only with a plan. |
| **EAS / Expo** | Account credentials, the Android keystore, iOS certs. **Keystore loss means you cannot ship an upgrade to installed users** — export and back it up with `eas credentials`. |
| **Local** | `./.env`, `./.env.local`, `apps/api-server/.env`, `apps/mobile/.env` — all gitignored; `.env.*.example` templates are committed and are scanned. |

---

## The secret scanner

`scripts/check-secrets.sh` runs in three places: the `secrets` CI job, the
pre-commit hook, and the first steps of both deploy workflows.

```bash
bash scripts/check-secrets.sh            # whole tree (~20s, ~2,900 files)
bash scripts/check-secrets.sh --staged   # what the pre-commit hook runs
```

What it catches: `sk_live_` / `sk_test_` (Paystack, Stripe), `sk-` / `sk-proj-`
(OpenAI), `sb_secret_`, service-role key **assignments**, AWS access key ids and
secret-key assignments, PEM private key blocks, Google API keys, GitHub tokens,
Slack tokens — and any JWT, split by its **decoded** `role` claim:

- `service_role` → hard fail, everywhere, not allowlistable.
- `anon` → passes. Anon keys ship in every client bundle by design.
- anything else (a user `access_token`, or one it cannot decode) → fail.

Four things were wrong with it before, all now fixed:

- The payment-key format was not covered at all (`sk_live_…` did not match), in a
  repo that integrates Paystack throughout.
- It scanned nine subdirectories, leaving the repo root, `supabase/` (208
  migrations), `docs/` and `public/` invisible, and omitted `.cjs`/`.mjs`.
- The dev-token exemption used `grep -qv 'supabase-demo'` **per file**, which is
  true of any file with two lines — so the exemption never applied and the rule
  was in practice "every JWT fails", worked around file by file.
- It matched the bare string `service_role`, which fires on every ordinary SQL
  `GRANT … TO service_role`. A scanner that cries wolf a hundred times is a
  scanner nobody reads.

**Allowlist entries are `PATH|PATTERN_ID` pairs**, so exempting a known-safe
string in one file cannot also hide a payment key that lands in that file later.
Never allowlist `jwt-service-role`.

### Pre-commit hook

`.husky/pre-commit` runs the staged-file scan, plus the mobile type-scale and
type-floor lints when the commit touches `apps/mobile`. It is installed by the
`prepare` script in `package.json`, which points `core.hooksPath` at `.husky` —
**no husky dependency**; a `git config` call is all husky would do here.

```bash
npm install            # installs the hook
git commit --no-verify # EMERGENCY BYPASS
git config --unset core.hooksPath   # uninstall
```

After a `--no-verify` commit, run `bash scripts/check-secrets.sh` before you
push. The repo is public: a key that reaches a commit is scraped by bots within
minutes, and remediation becomes rotation plus a history rewrite rather than an
amend.

---

## Rolling back

**Web.** Revert the PR and let the pipeline re-deploy:

```bash
gh pr create --title "Revert: …"      # revert commit on a branch, merged as a PR
```

That keeps provenance intact. For a genuine emergency, Cloudflare Pages keeps
every deployment — Dashboard → Pages → `lantern-study` → Deployments →
**Rollback** on the last good one. Do that first, then land the revert PR, or
the next push to `main` rolls you forward again.

**API.** Render keeps previous deploys: Dashboard → `lantern-study-api` →
Deploys → **Rollback**. Then land the revert PR. Confirm with
`curl -s https://lantern-study-api.onrender.com/health` — `.commit` must be the
sha you rolled back to.

**Mobile.** There is no rollback for an installed APK. Publish a new release
with the fix and a bumped version. Do **not** reach for `eas update` to undo a
bad build — that is the Reanimated SIGABRT crash loop.

**Migrations.** There is no automatic rollback, which is the whole reason for
the `-- destructive: approved` marker and CODEOWNERS on
`/supabase/migrations/`. Write the reversing migration by hand, with a new
(newer) timestamp.

**A leaked secret.** Rotate first, at the source (Supabase, Paystack, Render,
Cloudflare), then clean the repo. Rotation is what stops the bleeding; the
history rewrite is housekeeping. For the record, the history sweep at the time
of publication found **no secret was ever committed**.

---

## Dependabot

`.github/dependabot.yml`: npm weekly on Monday (5 PRs max, minor+patch grouped
into one), GitHub Actions monthly (3 PRs max). Majors are ignored for `expo`,
`react-native`, `react-native-reanimated`, `@react-native-community/netinfo`,
`react` and `react-dom` — those versions are pinned by architecture decisions
(the Reanimated 3 / Legacy Architecture downgrade; Hermes + New Architecture
segfaults this app on Android at boot), not by inertia. The cadence is right as
it is; the thing to watch is that Dependabot PRs get merged rather than
accumulating, since each one is a real advisory surface.
