# Handover — mobile release path, production audit, AI credits, XP overhaul

Written late Aug 11 2026. Everything below is **on `main` and pushed** (level with
`origin/main`, tree clean). Continues
[`HANDOVER-2026-08-10-mobile-offline-payments.md`](./HANDOVER-2026-08-10-mobile-offline-payments.md).

## Deployment state

- **API → Render: live on `1d14c60`** (`curl -s https://lantern-study-api.onrender.com/health`
  now returns the commit — use it, don't guess). Pushing to `main` auto-deploys.
- **Web → Cloudflare Pages: live**, service-worker id `lantern-msp6ei5r-5e0c160b`
  (built from the `ed89f09` tree). Pages is **not** git-connected; deploy with
  the `Deploy web (Cloudflare Pages)` workflow (canonical) or
  `npx wrangler pages deploy apps/web/dist --project-name lantern-study --branch main`.
  **Note the path change** — Vite now writes to `apps/web/dist`, not repo-root `dist/`.
- **Mobile: 1.0.6 (versionCode 51) SHIPPED** and publicly downloadable at
  `https://github.com/bjamilk/lantern-study-releases/releases/latest/download/lantern-study.apk`
  (verified: downloaded from that URL, SHA-256 matches the local build byte for byte).
  Both emulator and simulator are running 1.0.6 with sessions intact.
- **CI: green on `1d14c60`** (CI + Security regression).

## Commits (oldest → newest)

| Commit | What |
|---|---|
| `930dba3` | Bump app version 1.0.2 → 1.0.3 (moves the OTA runtime fence) |
| `5fd746d` | **Offline Download Options footer fixed** — the fourth attempt, and the one that worked |
| `5880f7a` | **security-audit CI green**: real pdfjs-dist fix + curated GHSA allowlist gate |
| `e973db4` | `docs/RELEASING.md` — full Android/iOS/OTA release recipe |
| `0563223` | Landing page "Download for Android" links |
| `d8f52d7` | **Marketplace honesty**: escrow copy gated on `paystackEnabled`; `PublicError` unmasks real 400s |
| `b9d01dc` | **CI truthfulness**: `pwsh` fix, mobile+web suites now run, secret scan widened |
| `a38ed29` | **Real NetInfo on Android**, SecureStore write-through cache, loud `getAuthHeaders` |
| `ae40be3` | Vite → `apps/web/dist` (Turbo cache was restoring nothing); inject scripts hard-fail |
| `ba2aa33` | **Mobile typecheck 51 → 0**, seven latent runtime bugs fixed |
| `df48136` | 1.0.4; deleted the stale `app.json` version decoy |
| `7ab51f4` | **AI generate sheets** no longer collapse to a title bar; 1.0.5 |
| `dcf7a37` | **Transient auth stalls no longer sign users out** |
| `3b9eab7` | **Smart Notes**: guidance + depth presets + deeper synthesis + critique pass |
| `235c862` | **AI credit counter connected** to Smart Notes / flashcards / practice tests |
| `ed89f09` | **XP measures real study work** (volume + quality + re-sloped curve) |
| `1d14c60` | 1.0.6; `.claude/` ignored |

## ⚠ OTA is still unusable — now proven, not suspected

The Aug 10 crash was **reproduced on runtime 1.0.3** (group
`e68d9cb8-653d-4cec-946c-0364e9c39bd7`): the emulator downloaded the fenced
update, self-reloaded, and SIGABRT'd in `NativeProxy.initHybrid` on `mqt_js`.
The export `.hbc` was 6.19 MB vs the gradle bundle's 6.30 MB, so **bundle size is
not the discriminator** — the bug is in the export pipeline itself, independent
of runtime version.

- Recovery used and verified: `eas update:delete <group-id>` empties the channel
  for that runtime (checks then return `CheckCompleteUnavailable` and the
  embedded bundle runs). A crash-looped device needs uninstall + reinstall.
- The app **self-reloads into a downloaded update on FIRST launch**
  (`checkAndApplyOtaUpdate`), so a bad publish kills the first session, not the second.
- **Ship every mobile change as a full build until this is root-caused.** A task
  chip with the full investigation trail exists.

## Two divergent repo copies — the session's biggest time sink

`~/Desktop/lantern-study` is the real repo. **`~/Desktop/Lanternstudy` (no hyphen)
is a stale clone at "Initial commit"**, and `~/Documents/lantern-study` is a third.
The stale one produced three wrong results in one day:

1. A readiness-audit subagent audited it and "corrected" true premises (concluded
   Paystack doesn't exist).
2. Two `isolation: worktree` subagents got worktrees cut from it — **worktree
   isolation follows the session cwd, not the path in the prompt**. Their commits
   landed on stale-repo branches and had to be transplanted with
   `git format-patch | git apply --3way`, then re-verified in the real repo.
3. `/code-review ultra` and `/security-review` ran there and saw an empty diff.

**Delete the stale copies.** Until then: pin subagent prompts to the absolute real
path AND verify afterwards which repo the commit landed in
(`git -C <real> cat-file -t <hash>`). Also note the api-server tsc baseline differs
between the trees, so agent-reported "verification" from the stale tree is meaningless.

## AI credits — how charging works now

Costs live in `packages/shared/src/utils/aiCredits.ts` (server charges and clients
display the same numbers): Smart Notes concise/standard **1**, deep **3**;
flashcards **1**; practice test **1**; OCR **2**.

- `reserveUsage` in `apps/api-server/src/middleware/aiRateLimit.ts` is the single
  primitive: one atomic `INCRBY` with full rollback. A denial can never partially
  consume — this also silently fixed the old OCR partial-burn bug.
- `aiRateLimitWithCost(getCost)` reserves depth-based credits **before** the
  summarize handler runs; a user 2 credits short of a Deep dive gets a 429 naming
  cost and remaining, having consumed nothing. The too-short-note 400 refunds.
- **The bug that made this feel broken**: `server.ts` CORS exposed only the legacy
  `X-AI-Usage-*` trio, so browsers could never read `X-AI-Global-Usage-*` or
  `X-AI-Feature` — feature counts (x/15) overwrote the global badge (x/100).
  `exposedHeaders` now spreads `AI_USAGE_EXPOSED_HEADERS`, mirrored in
  `security.ts`, with a header-invariant test so it can't drift again.
- 429 bodies now update the badge on both clients.

**Unresolved**: a single Deep dive appeared to consume **9 credits** (100 → 91 on
the badge) before this work landed. Static reading found no mechanism — the route
charges once, job polling is free, nothing double-charges. Prime untested
hypothesis: **lecture transcription charges 1 global credit per chunk**
(`POST /notes/transcribe-audio` uses `aiRateLimit`), and that note was a recorded
lecture. A background session is investigating; a task chip has the evidence.

## XP now measures studying, not logins

Before: the only repeatable source was daily quests — a fixed **70 XP/day** ceiling
regardless of effort. One test earned 25 XP; ten tests also earned 25.

- **Volume** (`packages/shared/src/utils/xp.ts`, awarded in
  `POST /gamification/activity/record`): tests 15 for the first 3/day then 5
  (cap 75); duels 10 then 3 (cap 45); flashcards 1 per 2 cards (cap 20); practice
  questions 2 then 0.5 (cap 30); daily quiz 5. Award is best-effort — it can never
  fail the activity recording.
- **Quality**: scored types scale by `0.5 + 0.5 × score`, so a perfect test is
  worth exactly twice a failed one. Both clients pass real percentages.
- **Curve**: Grandmaster's span was the only one that grew *cheaper* relative to
  the trend (1.25× vs 1.5–2×). Spans are now …2500, 4000, 6500, 10500; Champion
  starts at 16,500, Legend at 27,000.

Ceiling moves from 70/day of logins to ~245/day of real work.

**Not yet verified end to end**: nobody has watched a completed test move the
dashboard XP by the score-weighted amount against the live API. Do this first.

## Production readiness — audited, and the headline gap

Three parallel audits ran against the real repo. Genuinely production-grade:
auth middleware coverage across all 28 route files, DB-backed admin auth, tiered
rate limiting that hard-fails prod boot without Redis, **RLS on all 86 tables**,
real legal content with working GDPR export/deletion, deploy workflows with real
proof-of-deploy gates.

**The blocker is observability: the system has no way to learn it is broken.**
`SENTRY_DSN` is absent from `render.yaml` (Sentry is fully wired but no-ops),
production logging is console-only (`logger.ts` gates file transports off in
prod), the BullMQ worker registers no crash handlers and no Sentry — a dead worker
silently stops job alerts and GDPR retention purges — and nothing consumes
`/health`. **The user deferred this ("I will come back to 1"); it is still open
and is the highest-leverage remaining item.**

Also open from the audit: backup/restore has never been tested (BCP RPO/RTO are
aspirational); iOS `PrivacyInfo.xcprivacy` declares an empty
`NSPrivacyCollectedDataTypes` and lives in gitignored `ios/` so it evaporates on
the next prebuild; all four app icons are the same byte-identical 1024px PNG
(Android's adaptive mask will crop the logo); no user-facing reporting path for
notes/decks/groups/messages.

## Verified working on device this session

- **Group duel end to end, iOS vs web**: authored 5 True/False questions, realtime
  sync to the other device, community verification flipping Pending → Verified,
  challenge → accept → both play → results podium, XP awarded. Final 2950 vs 0.
- **Offline downloads** on the Android release build (the footer fix).
- **Smart Notes guidance + Deep dive** on Android: guidance "focus on nursing
  interventions and red-flag symptoms" visibly steered the output (a
  "Recognition and Intervention" section, "Why it matters" explanations, the
  3 H's of PE as a remember-hook, an elaborated clinical example).
- **The auth fix**: an emulator restart that previously destroyed the session now
  restores it cleanly.

## Outstanding

1. **Observability (deferred item 1)**: Sentry DSN on both Render services,
   `initSentry()` + crash handlers in `worker.ts`, UptimeRobot on `/health` and
   lanternstudy.com, `RESEND_API_KEY`/`CONTACT_TO_EMAIL` (the contact form 503s in
   prod today — the only in-app support channel).
2. **Verify XP end to end** — complete one test, watch dashboard XP move.
3. **Duel second pass** — both devices are on 1.0.6 now; the iOS post-duel exit to
   home screen was never root-caused (background session + task chip on it).
4. **The 9-credit mystery** (background session + chip).
5. **Paystack**: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`,
   `MARKETPLACE_PAYSTACK_CHECKOUT=true` on Render + the dashboard webhook URL.
   Until then the banner correctly tells users payment is arranged directly.
6. **iOS distribution**: needs Apple Developer Program + App Store Connect record,
   then `npm run build:ios` / `submit:ios` (recipe in `docs/RELEASING.md`).
7. Inherited: `zz-verify-temp` still undeleted; test budget expenses to clean up;
   13 stray APKs (~1 GB) in `apps/mobile/` (gitignored, harmless, worth sweeping).

## Baselines at handover

- Tests: shared **431**, api-server **220**, web **24**, mobile **32** — all green.
- `apps/mobile` typecheck: **0 errors** (was 51).
- api-server and web typecheck clean; `npm run build:web` clean and now producing
  real cached artifacts.
- Local Android build: `npx eas-cli build --platform android --profile preview --local`
  from `apps/mobile`, ~11 min, zero EAS credits. **Kill the emulator first** (16 GB machine).
- Local iOS simulator build: `expo prebuild -p ios --clean` + `xcodebuild -sdk
  iphonesimulator` with `CODE_SIGN_IDENTITY="-"`. Two traps: CocoaPods on Ruby 4
  needs `LANG=en_US.UTF-8`, and the workspace is `LanternStudy.xcworkspace` only
  when `EAS_BUILD_PROFILE=preview` (otherwise you get `LanternStudyDev`).
