# Handover — marketplace & jobs audit, plus the chat loose ends

Written Aug 10 2026. Everything below is **on `main` and pushed**. Continues
[`HANDOVER-2026-08-09-loose-ends.md`](./HANDOVER-2026-08-09-loose-ends.md),
which covers the chat-phase items and should be read first for that context.

> **Superseded for current state** by
> [`HANDOVER-2026-08-10-mobile-offline-payments.md`](./HANDOVER-2026-08-10-mobile-offline-payments.md).
> Read that one for what is live now; this file is the record of the
> marketplace/jobs work and the reasoning behind it. Two items in "Outstanding"
> below were closed by later commits: the malformed job id returning 500
> (`f76a03a`) and the jobs-board polish gaps (`580dceb`).

## Commits

| Commit | What |
|---|---|
| `5e8a6fd` | Close the reachable pdfjs RCE + three other high advisories |
| `0e24828` | Fix Group Settings ignoring light mode |
| `eb0a0eb` | Unify DM/group chat bubbles; stop chat repeating itself to TalkBack |
| `8aa164b` | Handover doc for the chat-phase outstanding list |
| `c5d2db3` | **Three marketplace bugs** found auditing Explore on device |
| `ebe1590` | Clear the floating tab bar on all remaining marketplace screens |
| `9c8853e` | First tranche of Explore gaps: photos, recent searches, trust, price drops |
| `7a94214` | **Make turbo see the web app's real sources** — stale bundles were deploying |
| `399ed59` | Inset the jobs screens below the status bar |
| `0cafc9d` | Close the six jobs-board gaps from the audit |
| `c660683` | Deliver job alerts by push and email, not just in-app |

## Deployment state

- **API → Render: live on `c660683`.** `/health` now returns a commit marker —
  `curl -s https://lantern-study-api.onrender.com/health` → `{"status":"ok","commit":"c660683"}`.
  Use it. It is far better than the old "poll a route for a new field" dance.
- **Web → Cloudflare Pages: live.** Build id `lantern-msn1sg0x-96f72d52`
  (`curl -s https://lanternstudy.com/sw.js | grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'`).
- **Mobile → not shipped.** Everything mobile below is in the repo only. That
  includes two flows that are *broken in any currently shipped binary*: Publish
  Listing and cart checkout (both buttons sat under the tab bar). **An EAS build
  is the single highest-value action outstanding.**

## The bugs that mattered

Found by driving the real app on the Android emulator against the live API, not
by reading code.

1. **Selling from mobile was broken** (`c5d2db3`). The Publish Listing button
   came to rest exactly under the absolutely-positioned bottom tab bar, which
   consumed every tap — verified by watching taps land on the Chat tab.
2. **Checkout was broken the same way** (`ebe1590`). CartScreen's footer was
   `absolute bottom-0` with `pb-8`, putting "Pay with Paystack" in the covered
   zone. Measured: y=2281 (inside the bar) before, y=2076 after.
3. **Every listing said "Your Listing" to logged-out web visitors** (`c5d2db3`),
   live on production. Ownership was `listing.user_id === currentUser?.id`; in
   guest mode both sides are `undefined`.
4. **Saved searches changed meaning across devices** (`c5d2db3`). Mobile's
   omitted-`sortBy` default was `trending`, web's was `created_at`, so a search
   saved on web as Newest came back on mobile as Trending. Fixing it turned the
   long-standing "pre-existing" mobile test failure green — **mobile is now
   32/32 for the first time in the recorded baselines.**
5. **All eight jobs screens rendered under the status bar** (`399ed59`). The
   jobs stack is the only `ScreenHeader` consumer of 22 that doesn't wrap in
   `SafeAreaView`. `ScreenHeader` gained an opt-in `safeTop` prop; the other 14
   consumers correctly don't pass it because they already wrap.

## Features added

**Explore / marketplace** (`9c8853e`): photo nudge before publishing a photoless
listing (both platforms, a nudge not a gate); recent-search chips backed by
AsyncStorage/localStorage; price-drop badges on Saved Listings (local price
snapshot at favorite time — the server records membership, not the price you
saw); "Member since" + the server's existing Trusted/Top seller badges on the
seller profile, which were computed but never rendered.

Two audit items turned out to be **already built**: per-listing OG tags (a
bot-gated Pages Function, verified with a `facebookexternalhit` UA) and an
itemized checkout confirmation on both platforms.

**Jobs** (`0cafc9d`): urgency-aware deadlines ("Closes in 3 days"); Easy Apply
chips; `minPay` filter end-to-end; a dated status timeline on My Applications;
"Be an early applicant" under 5 applications; and `GET /jobs-board/saved-searches/:id/matches`
for the in-app alerts badge.

**Job alert delivery** (`c660683`) — the piece the last handover called future
work. A `cron.jobAlerts` sweep already ran every 15 min on the
`lantern-study-worker` Render service and created in-app notifications; delivery
stopped there for two findable reasons:

- **Push**: `createNotification`'s Expo path has an allow-set of notification
  types and `job_alert` was not in it. Alerts were created and silently never
  pushed. Added `job_alert`, `job_interview_reminder`, `job_offer_reminder`.
- **Email**: new `alertMail` service on the same Resend transport the contact
  form uses. **One digest per saved search per sweep**, never one mail per
  posting. Gated on `emailEnabled`; dedupe rides the sweep's existing watermark
  and already-notified set; failures are logged and swallowed.

## Outstanding

1. **EAS mobile build.** Nothing mobile from this session is in users' hands,
   including the two broken-flow fixes above.
2. **`RESEND_API_KEY` on the worker service.** It is not in `render.yaml` and
   must be a dashboard secret. Without it the job-alert email path no-ops
   cleanly (push and in-app still deliver). Add under Render →
   `lantern-study-worker` → Environment.
3. **End-to-end proof of an alert delivery** has not been observed. It needs a
   new posting that matches a `notify=true` saved search after the deploy.
   Watch the worker log for `Job alert email sent`.
4. **`zz-verify-temp`** is still undeleted (item 1 of the previous handover) and
   now carries ~50 more junk messages from the B5 seeding. Permanent deletion of
   real account data is yours to press: ⋮ → About group → Danger → Delete
   Permanently.
5. **`security-audit` CI stays red** — 12 high remain (down from 18). Ten are
   the expo/metro/react-native toolchain where npm's "fix" is a downgrade; two
   are officeparser's pinned `pdfjs-dist`, upstream-blocked (7.5.1 still pins
   6.1.200, inside the advisory range). Do not retry an `officeparser →
   pdfjs-dist` override: npm drops the nested copy and resolves against web's
   hoisted 4.10.38, which is worse.
6. **Jobs polish not done**: `DELETE /postings/:id/save` returns 500 for a
   malformed UUID (should be 400); JobDetail's loading/error early-returns
   render without the header.
7. **Screen-reader residual**: the child-text silencing cannot be observed
   through `uiautomator` (it sets `FLAG_INCLUDE_NOT_IMPORTANT_VIEWS`; TalkBack
   does not). A literal listen on a real device is the only way to close it.

## Traps learned this session — read before deploying web

**Turbo was serving stale web bundles.** `apps/web`'s vite root is the repo
root; the app lives in root `components/`, `hooks/`, `stores/`, `App.tsx`. Turbo
hashed only `apps/web/**`, so root-source edits reused the cached `dist` —
"built in 5.77s" every time was the tell, and **two wrangler deploys shipped
pre-change JavaScript while reporting success.** Fixed in `apps/web/turbo.json`
(`7a94214`) with explicit inputs. Verify a web deploy by *behavior* or by the
`index-*.js` chunk hash changing — never by the build having run, and never by
the `sw.js` cache id, which is date-based, not content-based.

> **CORRECTION (Aug 11 2026).** The paragraph that stood here claimed the Pages
> project was git-connected and that pushing to `main` deployed the web app. That
> was **wrong**, and acting on it cost a later session a deploy cycle with
> production sitting stale. Verified with `npx wrangler pages project list` →
> `Git Provider: No` for `lantern-study`.
>
> **Pushing to `main` deploys ONLY the API (Render).** Web still needs, from the
> repo root after `npm run build:web`:
> `npx wrangler pages deploy dist --project-name lantern-study --branch main`.
> Check what production actually serves with
> `npx wrangler pages deployment list --project-name lantern-study` — the top
> row's commit is the truth, and it is routinely behind `main`.

**The in-app Browser pane holds a signed-in lanternstudy.com session** (the
user's own account). Invaluable for authed prod checks without touching
credentials — check `localStorage['sb-…-auth-token']` before assuming a tab is a
guest. It also explains a scare: one "Your Listing" badge remaining on prod was
correct, because that listing *is* theirs.

**The offline-first service worker serves stale assets.** Before checking a web
change in a browser, unregister the SW and clear CacheStorage, or you will
verify the previous build.

**Scripted `adb` chat sends silently merge.** `ChatComposer` disables Send while
`sending` is true, so a tap during the round trip is swallowed and the next
`input text` appends to the un-sent draft. A blind fixed-delay loop lost ~2 of
every 3 sends. Poll for the placeholder before typing the next one — or don't
seed at all and pad the list in code, as the B5 run ended up doing.

**`packages/shared` runs jest, not vitest.** `npx vitest run` there fails all 57
suites with `describe is not defined` and looks like a catastrophic regression.

## Baselines — all matched at handover

- `apps/mobile` typecheck: **51 `src/` lines**, error set unchanged. Diff the
  *set*, never the count.
- Tests: mobile **32/32** (the marketplaceFilters failure is fixed — do not
  expect the old "1 pre-existing failure"), shared 413, api-server 204, web 24.
- `apps/api-server` and `apps/web` typecheck clean; `npm run build:web` clean
  under the new turbo inputs.
- `.claude/launch.json` is untracked and predates this work — left alone
  deliberately.
