# Handover — 2026-08-20: Chat UX overhaul (PR #19) + spurious sign-out fix (PR #20), both LIVE

Everything below is on `main` and **deployed to production**.

- **Web → Cloudflare Pages: LIVE, bundle `index-CW8Loyo2.js`** (manual deploy —
  Pages is NOT git-connected). Verify by bundle hash on lanternstudy.com, never
  the build log: `npm run build:web && npx wrangler pages deploy apps/web/dist
  --project-name lantern-study --branch main`. Served bundle was verified after
  deploy; prod boots clean (only the expected logged-out 401s, no crashes).
- **API → Render: unchanged.** PR #19 touched only web/mobile/shared — **zero
  `apps/api-server` changes** — so no API behaviour changed. Render still
  auto-deploys from `main`.
- **Mobile: NOT in a released build.** The overhaul is on `main` and runs on the
  iOS **dev** build (Metro), but the shipped Android APK (`v1.0.26`) does NOT
  have it. A new EAS/local build + release is needed to get it onto phones.
- `main` HEAD `5278b54` (PR #19) on top of `9fe496c` (PR #20).

This session: a 16-agent audit of the chat section → implemented across web +
mobile in ~15 commits (PR #19) → multi-agent reviewed → merged → deployed. Plus a
Sentry-driven auth fix (PR #20). Full per-item detail:
[[lantern-study-chat-ux-overhaul]] in agent memory.

## What shipped — PR #19 (chat overhaul)

**Web declutter / responsive:** group-header toolbar collapsed to Question (+Test/
Study at `lg`), visibility + Summarize moved to the overflow, stats strip + the
permanent composer caption removed, question count folded into the subtitle.

**Web correctness:** `canEditChatMessage` excludes images (shared — kills the
signed-URL leak on edit, both platforms); `@AI` failures restore the typed prompt
instead of silently wiping it; **DM history now pages older messages** (was a dead
end past 50); thread auto-scroll + working in-thread reply-quote; per-composer
`@mention` scoping; `@mention` ARIA combobox.

**Web parity/polish:** image attach behind a `+` composer tray (web was
receive-only); conversation rows show last-message preview + recency.

**Mobile (full non-money pass, 6-agent parallel):** sectioned overflow sheet,
unified long-press action sheet + Copy, DM header slimmed (mute/block → overflow),
5 stacked bars → 2, `+` composer tray, entry-modal sizing + KeyboardAvoidingView,
tablet max-width columns, image pinch-zoom, swipe-commit-on-release, Chats-count
fix, contacts hydration, create-group disclosure. **Device-verified on the iOS sim.**

**Phase 6 marketplace money rework:** web money-flow correctness (offers-tab reset,
stuck-`negotiating` pill, make-offer gate, buyer Pay-now); durable inquiry
detection (dropped the fragile `[Offer]` text marker → server `getInquiryByThread`);
a **sticky deal bar** (one primary offer/order action inline + Paystack fee note);
mobile buyer pay-now on accept; **mobile order lifecycle in the DM** (Pay-now /
Mark-ready / Confirm-received, mirroring web). Inline-offer-cards was deliberately
NOT built (redundant with the sticky bar; noted in memory).

## What shipped — PR #20 (auth fix, from Sentry LANTERN-STUDY-WEB-18/17)

A Supabase refresh-token 400 was force-signing users out mid-session (a refresh
race). The `SIGNED_OUT` handler now re-reads the stored session before tearing it
down and keeps the user in if one is still live (legacy-token mode only, skips
real logouts, 15s cooldown, unexpired-only). Genuine expiries/logouts unchanged.

## Verification status

- **Web money E2E — verified LIVE**: seeded a ₦80 offer, accepted it via the
  sticky bar's Accept → order `awaiting_payment` created → seller order bar showed
  "Awaiting buyer payment". Sticky-bar seller/no-offer states also render correctly.
- Web Phase 1, image-attach tray, row previews, and the auth fix — verified live.
- Mobile non-money batch — verified on the iOS sim (Chats count, previews, DM
  header, `+` tray).
- **Mobile buyer "Pay now" order bar — NOT live-verified** (the sim's Chat nav was
  too flaky to reach it). The code is a faithful mirror of the verified web order
  bar, and the PR-review confirmed it renders. Verify it on the next real build.

## Review (multi-agent, before merge)

7-agent review. It raised a "**dead DM pager**" blocker that was a **FALSE
POSITIVE** — `useGroupHandlers` imports `fetchDirectMessages` from
`../services/supabase`, which unwraps `result.data` to an array for every call
(the reviewer traced the wrong `fetchDirectMessages`). 4 real findings were fixed
(`3012f0d`): DM pager offset (`optimistic-` → `isTempMessageId`); mobile order bar
now `reloadOrder()` after Paystack checkout returns; Offers "Make an offer" gated on
`hasLiveOrder`; softened the misleading mobile "Report" copy.

## Test data created (demo — mostly cleaned up)

Seeded to run the money E2E: listing `14457795-448f-4066-b373-a7026cccd391`
("TEST — restructure verify (delete me)", seller Benjamin), inquiry `12711ddd…`
+ ₦80 offer (accepted). Cleanup: the order was **cancelled** and the listing marked
**inactive** (out of the marketplace). Hard `DELETE` 500s server-side because of the
historical inquiry/offer records — a **pre-existing marketplace limitation**, filed
as its own task (a spawned background session was fixing the DELETE handler).

## Traps learned this session — read before shipping

1. **`X.id` in a `useCallback`/effect DEPENDENCY ARRAY crashes when X is null.** A
   `currentUser.id` dep in `handleLoadMoreDirectMessages` threw on logged-out render
   (deps eval every render) → the whole app showed "Something went wrong" for any
   logged-out user. Fixed (`1f1ccb3`). Use `currentUser?.id`. This is a whole class
   — grep new deps arrays for bare `.id` on nullables.
2. **A local `build:web` is safe to deploy despite the dev API path.** `.env.local`
   bakes `VITE_API_URL=/__lantern_api` (dev proxy) + the PROD Supabase URL/key; the
   runtime `resolveWebApiBaseUrl` rewrites `/__lantern_api` → same-origin `/api`
   (Pages Function → Render) on lanternstudy.com, and the built `_headers` CSP is
   correct (self + supabase + render + sentry). Always verify the SERVED bundle hash.
3. **The iOS-sim verify recipe works** (workspace `LanternStudy.xcworkspace`,
   scheme `LanternStudy`, bundle `com.lanternstudy.app`, Metro on **8081**, Node 20)
   — see [[lantern-study-chat-ux-overhaul]]. Sim tap coords are **device points
   (402×874)**, NOT screenshot pixels; nav taps are flaky; deep-linking a listing
   cold-launches and briefly shows login. The dev-server autoPort drifts across
   build/branch churn (56816→5173→55524…); reconnect with `preview_start {name:"web"}`.
4. **Multi-agent review findings still need scrutiny** — the top "blocker" here was
   disproved by reading the actual import. Verify before acting.

## Still outstanding

- **Ship the overhaul to mobile**: build + release a new Android APK / EAS build so
  phones get it (the released `v1.0.26` predates this work). iOS distribution is
  still not wired to the releases flow.
- **Verify the mobile order lifecycle on-device** (Pay-now/Mark-ready/Confirm-received)
  in a real build — only the web side is live-verified.
- **`DELETE` marketplace listing 500** when a listing has historical inquiry/offer
  records + a cancelled order (should archive gracefully) — own task, in progress.
- Pre-existing CI is red (known baseline) — the PR merged "UNSTABLE" by design.
