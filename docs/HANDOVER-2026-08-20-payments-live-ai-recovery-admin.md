# Handover — 2026-08-20: Paystack live (test mode), AI outage root-caused, admin telemetry

Everything below is committed on `main`, and the API (`175986b`) + web (`index-aj3oM4Dn.js`)
are **deployed and verified live**. Mobile code through 1.0.25 is released; a batch of
mobile UI fixes is committed but **awaits the next build** (see "Next mobile release").

## The headline: real payments work

Paystack marketplace checkout is **ON in production (test mode)** and verified end to
end with money movement on 2026-08-20:

> David (emulator) bought Benjamin's ₦3,500 listing → Buy Now itemized ₦3,500 + 5%
> (₦3,675) → order `awaiting_payment` → Paystack test checkout → callback redirect →
> webhook settled → order `paid` with `paid_at` stamped → buyer confirm_received →
> **transfer to seller's bank recipient** → order `completed`, receipt available.

- Config (set by hand in Render, declared `sync:false` in render.yaml): `PAYSTACK_SECRET_KEY`
  (sk_test), `PAYSTACK_PUBLIC_KEY`, `MARKETPLACE_PAYSTACK_CHECKOUT=true`. Webhook:
  `https://lantern-study-api.onrender.com/webhooks/paystack`. Check state via
  authenticated `GET /api/v1/marketplace/payments/config` → `paystackEnabled`.
- Migrations `20260815120000` (payments tables) and `20260820120000` (orders.paid_at +
  backfill) are **applied** in prod Supabase (hand-applied, as always in this repo).
- **Trap: with Paystack on, buyers cannot check out a seller who has no active payout
  profile** (`assertSellerCanReceivePayout`). Benjamin has one (test bank 057 /
  0000000000). Every other seller does not. Decide policy: onboard sellers, or fall
  back to the cash flow for bankless sellers (currently: hard block with a clear error).
- Test-mode E2E recipe: checkout URL is `https://checkout.paystack.com/{access_code}`;
  when the emulator opens it, grab it with
  `adb shell dumpsys activity recents | grep checkout.paystack` and finish on desktop
  Chrome — Paystack test mode shows a Success/Decline simulator, no card entry needed.
- **Go-live to real money** (not done): Paystack business verification for live keys,
  swap the three Render vars, set the live-mode webhook, enable settlement-to-balance
  so Transfers can draw funds.

## Payments: what was broken and what changed (`2d3883c`, `175986b`)

The Aug-10 audit's fallback path was still minting fake payments. Confirmed by a
5-reader + 6-verifier audit (one verifier probed prod live):

- Orders were **born `status='paid'`** unless the seller opted into confirmation.
- The **buyer could `mark_paid` their own order** with one authenticated request.
- Seller's **"Request payment" flipped the order to paid** as a side effect.
- "Escrow" moved no funds; webhook amount mismatches were swallowed with a 200 AND
  consumed by dedupe; currency was never validated; checkout retries leaked orphan
  `initialized` payment rows; signature compare wasn't constant-time.

All fixed in `175986b` ("honest payment states"): every order starts `pending_payment`;
only a verified Paystack settlement or the **seller's** confirmation may assert payment
(`paid_at` stamped after the status commits, best-effort + logged until the migration
landed — it has now); "Request payment" only notifies; settlement mismatches go to
Sentry + a `settlement_mismatch` stamp in payment metadata; checkout retries reuse the
open session; both clients' timelines show payment **evidence** ("Paid via Paystack" vs
"Payment confirmed by seller"), never status-ordering inference, and never `payment_id`
alone — that exists from checkout *initialization*.

An adversarial review of the first version of this diff (13 findings, 10 confirmed)
caught two highs before shipping: `payment_id`-as-evidence (abandoned checkouts showed
"Paid via Paystack ✓") and manual cash sales stalling because neither client exposed
seller actions at `pending_payment`. Both fixed; the now-inert seller
"require payment confirmation" toggle became a static note.

## AI: the outage, the recovery, the cost telemetry

**Root cause of "AI is temporarily unavailable": Groq decommissioned
`llama-3.3-70b-versatile` on 2026-08-16.** Every chat call failed for three days.
Now: Groq runs `openai/gpt-oss-120b` (Groq's own replacement; `GROQ_MODEL` overrides
without deploy), with **Fireworks as paid standby** (`accounts/fireworks/models/gpt-oss-120b`,
`FIREWORKS_MODEL` overrides; spend-guard `FIREWORKS_DAILY_LIMIT`, default 1000/day).
`/health` reports per-provider key presence under `ai:`; currently groq+fireworks on.

Both models **reason before answering** — traces are stripped before JSON parsing
(brace-laden `<think>` blocks broke extractJSON) and token budgets carry +1024 headroom
(a 350-token summary budget could be eaten entirely by thinking).

Reliability/billing fixes that came out of the same incident:
- **Failed AI requests refund their credits** (global + feature) via a `finish` hook;
  the usage headers restate pre-charge counts on non-2xx so the badge stops counting
  down for nothing. 20/day cap (`AI_DAILY_LIMIT`), costs cached at `AI_COST_PER_MTOKEN_USD`.
- **AI response cache** (7-day, per feature+source+options) now versioned (`v2` in
  `aiResponseCache.ts`) — bump `CACHE_VERSION` to retire poisoned entries; degenerate
  output (quizzes with no options, blank flashcards) is **rejected before caching**.
- **Token usage recorded per call** (prompt/cached/completion) → structured log line,
  per-provider `tokensToday` on `/api/v1/ai/health`, real totals in
  `ai_inference_log.token_estimate` (cache replays = provider `cache`, zero tokens).
- **Admin probe**: `GET /api/v1/admin/ai/provider-probe?provider=groq|fireworks` calls
  ONE provider directly (no fallback masking) and returns usage — probe twice to see
  `cachedTokens > 0`. Also surfaced as a button in Admin → AI Ops (`e982127`).
- ⚠ **Fireworks has still never returned a verified success.** The key was replaced
  after a 401; nobody has probed since. The feature-registry entry keeps AI reliability
  at `partial` until a probe passes. One click in Admin → AI Ops settles it.

## Sentry: 30 unresolved → 8, and it now hears what it was deaf to

- Fixed real bugs: flashcard swipe-to-grade **fatal** (worklet calling plain JS —
  broken since the component existed; 1.0.24), chat sidebar `k.map` crash, signup
  logging a 401 *after succeeding* (profile write needs a session; with email
  confirmation there is none — profile now created on first sign-in), webview
  `localStorage:null` white screen (`utils/storageFallback.ts`, must stay the FIRST
  import in index.tsx), flashcard check-constraint 500s.
- Killed the noise: 4.4k `Not allowed by CORS` events were my own localhost dev hits —
  status-less errors report as 500s, so expected rejections got real statuses
  (CORS 403, upload validation 400, note-access 404).
- **Web now captures what never throws** (`6c2183e`): failed fetch/XHR responses, CSP
  violations, and **unexpected sign-outs** (a session dying without user action — the
  exact class the user hit when the app logged them out). Expected conditions
  (rate limits, offline, Safari codec gaps) are filtered so real crashes stay visible.
- Remaining 8 are evidence-starved singles + two App Hanging reports (Aug 2, breadcrumbs
  point at offline connectivity checks). Don't chase without new events.

## Admin console upgrades (`b43b92e`, `d099a1f`, `dbcc4d1`)

- **AI Ops tab leads with money**: tokens over period, paid-vs-cache share, tokens by
  feature/day, live per-provider gauge (cached-input volume), provider health probes.
  Companion event cards renamed to say what they are (clicks, not spend).
- **Analytics tab: raw Event stream** (all product_events, web/mobile split, distinct
  users; 10k-row window, labeled when truncated). Overview "AI cost (7d)" computes from
  real tokens (`AI_COST_PER_MTOKEN_USD`, default $0.30/1M) with the old flat guess as
  pre-token-history fallback.
- **Feature registry brought current** (13 → 28 entries incl. payments) and **CI now
  fails a mobile version bump that doesn't touch it** (`scripts/check-feature-registry.mjs`,
  `feature-registry` job; escape hatch `[skip registry]` in a commit message; verified
  green on GitHub). RELEASING.md step 3 documents it.

## Next mobile release (1.0.26 — not yet built)

Committed and waiting: seller actions at `pending_payment` (confirm payment without
proof for cash, mark ready), evidence-based order timeline, inert toggle removed.
Shipped 1.0.25 handles the **Paystack** path fine; only the manual cash path is
UI-stalled there (workaround: web, or buyer uploads any image as "proof").
Registry entry exists, so the CI gate will pass. Build/publish recipe unchanged
(RELEASING.md; APK repo `bjamilk/lantern-study-releases`, latest is v1.0.24 — 1.0.25
was built+installed on emulator/simulator but **never published as a release**; publish
it or fold into 1.0.26).

## Deployment state

- **API → Render: `175986b`** (`curl -s https://lantern-study-api.onrender.com/health`
  → commit + `ai` key presence + turnstile + sentry).
- **Web → Cloudflare Pages: `index-aj3oM4Dn.js`** — Pages is NOT git-connected; deploy
  is manual (`npm run build:web && npx wrangler pages deploy apps/web/dist
  --project-name lantern-study --branch main`), verify by bundle hash on lanternstudy.com.
- **Mobile: 1.0.25 on emulator + iOS simulator; latest published APK is v1.0.24.**
- Suites at handover: API 341, web 37, mobile 53, all green; `tsc` clean in api/mobile;
  web has a pre-existing 3,097-error baseline — compare counts, never absolutes.

## Session accounts & test world

Web Chrome (Browser 1) = Benjamin Amadi (`1e547f81…`, platform admin, has payout
profile). Emulator Pixel_8 = David Amadi (buyer in the E2E). iOS simulator = nimaj22,
signs out after clean prebuilds. Order `7853ad2c-37f0-4b3e-b049-bf34135987f6` is the
completed E2E purchase; the ₦3,500 test transfer is visible in Paystack → Transfers.
