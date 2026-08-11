# Handover — offline mode, mobile builds, the OTA incident, payments audit, date sweep

Written late Aug 10 2026. Everything below is **on `main` and pushed** (level with
`origin/main`, tree clean). Continues
[`HANDOVER-2026-08-10-marketplace-jobs.md`](./HANDOVER-2026-08-10-marketplace-jobs.md).

## Commits

| Commit | What |
|---|---|
| `580dceb` | Jobs polish: malformed-uuid 500→400 (guarded routes), JobDetail loading headers |
| `8ea492d` | **Refresh the slim EAS mobile lockfile** — every Android build was failing at `npm ci` |
| `f76a03a` | Router-scoped error middleware: malformed ids → 400 on the three unguarded routes too |
| `a4a544a` | Android keyboard jump: `behavior="height"` fought `adjustResize` (username gate + SignUp) |
| `917fb9f` | **Offline cold boot no longer locks the user out** (username gate on fetch failure) |
| `db29bbc` | **Offline test Start button works** (root-stack navigate silently dropped); download footer still broken |
| `d707c45` | **Paystack webhooks: capture raw body** so HMAC signatures can actually verify |
| `a705f19` | Budget dates: shared `dateOnly` helpers, nine call sites, both platforms |
| `5fc2cb2` | Date sweep finish: web streak UTC-bucketing, InvestModal deadlines, filenames, demo data |

## Deployment state

- **API → Render: live on `5fc2cb2`** (`curl -s https://lantern-study-api.onrender.com/health`).
- **Web → Cloudflare Pages: live on `5fc2cb2`**, `index-B2WZ9GI-.js`. Deployed by
  `npx wrangler pages deploy dist --project-name lantern-study --branch main` from repo
  root after `npm run build:web`. **Pages is NOT git-connected** (`wrangler pages project
  list` → `Git Provider: No`) — the Aug 9 handover claimed otherwise and cost a deploy
  cycle. Pushing to `main` deploys ONLY the API.
- **Mobile: nothing shipped, and the situation is worse than "not shipped" — read the
  OTA incident below.** Latest good local APK: `apps/mobile/build-1786388273945.apk`
  (versionCode 43, commit `db29bbc` — has every mobile fix EXCEPT the date work in
  `a705f19`/`5fc2cb2`).

## ⚠ THE OTA INCIDENT — read before touching `eas update`

An `eas update --branch preview` publish from `db29bbc` **crash-looped Android**:
`com.swmansion.reanimated.NativeProxy.initHybrid → SIGABRT` on launch. The warned-about
hazard is real: the channel's runtime version (`appVersion` policy, still `1.0.2`)
matches binaries built with Reanimated **4** native code, and today's JS pairs only with
Reanimated **3**. Recovery was republishing the last-good Aug 7 update
(`eas update:republish --group eb11735f-2614-4542-a41e-da1e0ed29a79` for android,
`d80573cd-a7bf-4064-9d31-75b00b8725de` for ios).

Consequences that persist right now:

1. **The preview channel is pinned to Aug 7 JS.** Every install that checks updates —
   including a freshly built APK on its second launch — downloads and runs Aug 7 code.
   All of today's mobile fixes are parked.
2. **Do not `eas update` again until the app `version` is bumped** (e.g. 1.0.3) so the
   new runtime version fences new JS to new binaries — then build + distribute new
   binaries and publish updates against the new runtime only.
3. The emulator exhibits this: it runs the rollback bundle, and David's session was
   dropped on a cold restart (suspected refresh race in the older JS — the guard comment
   in RootNavigator describes exactly that failure).

## Local Android builds — solved, zero EAS credits

`npx eas-cli build --platform android --profile preview --local` works on this Mac.
Requirements (details in auto-memory `lantern-study-local-android-build`): nvm Node 20,
Temurin JDK 17 (installed today), `ANDROID_HOME`, **`~/.gradle/gradle.properties` with
`-Xmx4096m -XX:MaxMetaspaceSize=1536m`** (the generated 512m OOMs `expo-updates` KSP;
`android/` is gitignored so only GRADLE_USER_HOME survives), and the emulator killed
(16 GB machine). ~11 min per build. Version codes 39–43 were consumed by iteration.

Two traps fixed permanently: the **slim EAS lockfile** (`scripts/package-lock.eas-mobile.json`)
is what `npm ci` resolves against on every Android build, cloud AND local — it had
drifted behind the Reanimated downgrade and failed every build in INSTALL_DEPENDENCIES
(`8ea492d`, regeneration recipe in the commit + memory). And **iOS local**: `eas --local`
needs fastlane (absent); use `expo prebuild -p ios --clean` + `xcodebuild -sdk
iphonesimulator` instead — with `CODE_SIGN_IDENTITY="-"`, NOT `CODE_SIGNING_ALLOWED=NO`
(the latter strips entitlements; suspected in the keychain/session issue below).

## Paystack / marketplace payments — audited end to end

**The backend is fully built and disabled in production**: `/marketplace/payments/config`
returns `paystackEnabled: false`. Three things turn it on, all missing on Render
(`lantern-study-api` → Environment):

- `PAYSTACK_SECRET_KEY` (also unblocks `/seller/banks`, currently an empty list — seller
  payout onboarding is impossible today)
- `PAYSTACK_PUBLIC_KEY`
- `MARKETPLACE_PAYSTACK_CHECKOUT=true` (explicit flag, off even with keys)

Plus the Paystack dashboard webhook URL: `https://lantern-study-api.onrender.com/webhooks/paystack`.
Start with `sk_test_`/`pk_test_` keys and a test card.

The flow (code + 212 tests + live fallback walk): checkout → per-line Paystack sessions
with idempotency → HMAC webhook with dedupe (`d707c45` fixed raw-body capture; without it
signatures matched only by luck) → `paid` → buyer *confirm received* → transfer to seller
minus 5 % fee → `payout_pending` → `paid_out`; cancel refunds via Paystack. Clients on
both platforms redirect/verify correctly and degrade gracefully.

**What production users get today** (verified live as the buyer; order created and then
cancelled for cleanup): checkout instantly creates orders with `status: "paid"` and
`payment_id: null` — no payment happens, "arrange pickup" trust flow — while the Explore
banner *promises* Paystack escrow. Known cosmetic gaps: the button says "Pay with
Paystack" even when disabled; `payment-link` on fallback orders 400s with a masked
message.

## Offline mode — fixed and verified end to end

Verified on device (v43, airplane mode): cold boot → dashboard (no username-gate lockout,
`917fb9f`) → downloaded test opens (`db29bbc` — `navigate('StudyTab',…)` from the
root-stack modal was silently dropped; it can never have worked) → scored locally →
Pending Sync 1 → reconnect → synced.

**Still broken: the Download Options modal.** Its Cancel/Download footer measures zero
height on release builds (three fix attempts: flexShrink, fixed height + flex body,
footer-inside-ScrollView — the third is committed as partial progress). New offline
downloads are impossible on a Pixel-8-sized screen. Task chip filed; iterate in a dev
client, not 11-minute release builds. Also: `adb shell input swipe` cannot scroll some
of this app's ScrollViews — use `uiautomator dump` as ground truth, not screenshots.

## Budget / Lantern AI / Settings — audited

Settings verified on device (theme applies/persists/syncs; the Settings OTA row shows the
*embedded* update id — compare with `unzip -p <apk> assets/app.manifest`). Budget verified
on both platforms against prod (web writes hit `/api/v1/budget`, `POST /transactions`
201-verified; both platforms share `budget_transactions`). Lantern AI verified on mobile
(send → response → history persists). The **date-only bug family** is fully swept
(`a705f19` + `5fc2cb2`): budget dates rendered a day early west of UTC and saved a day
off near midnight; the web study streak flipped days at 6pm local. Shared helpers in
`packages/shared/src/utils/dateOnly.ts`. **Job posting deadlines deliberately not
touched** — storage format unconfirmed; check the DB column type before applying
`parseDateOnlyLocal` there.

## iOS simulator — login saga, unresolved tail

The user could not log in. Root causes found in sequence: (1) **simulator QUIC state** —
auth requests to Supabase hung 180 s (`h3stream` timeouts in `log stream`) while the host
answered in 0.18 s; fixed by simulator restart, recurs, fix is always restart. (2) After
that, sign-in returned **200 then a 27×401 cascade**: the session never persisted
(282 `SecItemDelete` / 3 `SecItemAdd`), `getSession()` under `persistSession: true` reads
storage on every call, refresh 401s, and `getAuthHeaders()` **silently returns headers
with no Authorization**. Suspected cause: the unsigned build (`CODE_SIGNING_ALLOWED=NO`)
breaking keychain writes — a properly signed rebuild was installed fresh; **the user had
not yet confirmed login success at handover time**. If it still fails: harden
`ExpoSecureStoreAdapter` with an in-memory write-through layer and make `getAuthHeaders`
fail loudly. Those two silent-failure patterns deserve fixing regardless. Separate,
still-open: **"Try demo mode" does nothing on iOS** (pure local state; task chip has the
full trail).

## Outstanding

1. **Bump app `version`, build new binaries, ship, then re-enable OTA** — the mobile
   release path is the single highest-leverage item; everything mobile is parked on it.
2. Paystack env vars + webhook URL (user-held keys; test mode first).
3. Offline download modal footer (task chip).
4. iOS demo mode (task chip); iOS login confirmation; auth silent-failure hardening.
5. `RESEND_API_KEY` still absent (job-alert emails still no-op), `zz-verify-temp` still
   undeleted, `security-audit` CI still red (12 upstream-blocked highs) — all inherited.
6. Cleanup candidates: test budget expenses (₦1500 "verify-crossplat-lunch" on
   afterclass247, ₦750 "web-verify-snack" on nimaj22), one 0 % "Ballers_" test attempt.

## Baselines at handover

- `apps/mobile` typecheck: **51 `src/` lines** (diff the set, not the count).
- Tests: mobile **32/32**, shared **419** (413 + 6 dateOnly), api-server **212**
  (204 + 8 jobs-board error mapping), web **24**.
- api-server and web typecheck clean; `npm run build:web` clean.
- `apps/web/turbo.json` still declares `outputs: ["dist/**"]` while the build writes to
  the repo-root `dist/` — the "no output files found" warning is real and a stale-deploy
  risk; `inputs` were fixed in `7a94214` but `outputs` were not.
