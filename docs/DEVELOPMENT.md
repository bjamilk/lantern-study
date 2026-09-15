# Development, verification and deploy runbook

Everything needed to change, verify, commit and ship this app on macOS. Written
after a session where several of these steps failed in non-obvious ways — the
warnings are all things that actually bit us.

## One-time setup

The shell environment lives in `~/.zshrc` under `# ---------- LANTERN DEV ENV ----------`.
It sets Homebrew first on `PATH` (so `brew`'s Ruby beats macOS's Ruby 2.6),
`ANDROID_HOME`, `JAVA_HOME` (Temurin 21), and `RCT_METRO_PORT=8082`.

| Tool | Why | Install |
| --- | --- | --- |
| Node 20 (via nvm) | `apps/mobile` requires `>=20.19.4 <21` | `nvm install 20` |
| Homebrew | provides a modern Ruby for CocoaPods | https://brew.sh |
| CocoaPods | iOS native builds | `brew install cocoapods` |
| JDK 21 (Temurin) | Android Gradle builds | Android Studio's bundled JBR is Java 25 and Gradle rejects it |
| Android SDK + Pixel_8_API35 AVD | Android emulator | Android Studio |
| gh | GitHub auth with the right scopes | `brew install gh` |
| eas-cli | mobile store / OTA builds | `npm i -g eas-cli` |

> **Use `brew install cocoapods`, not `gem install`.** macOS ships Ruby 2.6.10;
> CocoaPods' `ffi` dependency requires Ruby >= 3.0, so the gem route fails.

## Running the app

```bash
npm run dev:web                       # web  → http://localhost:5173
```

Mobile needs Node 20 and Metro in **dev-client** mode on **port 8082**:

```bash
nvm use 20
cd apps/mobile && npx expo start --dev-client --port 8082
```

> **Port 8081 is occupied by Cursor** on IPv4. The Android emulator's
> `adb reverse` then reaches Cursor instead of Metro and serves a stale bundle.
> Always use 8082.

> **Expo Go does not work for this app** — it needs the custom dev client
> (`com.lanternstudy.app.dev`).

**Android:**

```bash
adb reverse tcp:8082 tcp:8082
adb shell am start -a android.intent.action.VIEW \
  -d "lanternstudy://expo-development-client/?url=http://10.0.2.2:8082"
```

**iOS:** install the prebuilt client once, then open the deep link.

```bash
xcrun simctl install booted ~/LanternStudyDev.app
xcrun simctl openurl booted "lanternstudy://expo-development-client/?url=http://localhost:8082"
```

Rebuild a native client only when native code or config changes:
`npx expo run:android --port 8082` / `npx expo run:ios --port 8082`.

## Verify before every commit

```bash
bash scripts/verify-all.sh            # add --quick to skip tests and the web build
```

It runs, in order: override check, secret scan, shared + api-server builds,
lint, api-server tests, web tests, web production build, and a check that the
built bundle points at production.

## ⚠️ The web bundle bakes in environment variables

Vite inlines `VITE_*` at **build time**. A `dist/` built with local `.env.local`
values deploys cleanly and then fails in production with **"Invalid API key"**,
because the bundle carries `http://127.0.0.1:55421` and the `supabase-demo`
anon key. This has already caused one production outage.

Two defences:

1. **Prefer deploying from the Cloudflare dashboard**, which builds on
   Cloudflare's servers using the project's own environment variables.
2. If you must deploy a local build, `scripts/verify-all.sh` fails when the
   bundle contains local dev config. Confirm before shipping:

```bash
grep -l "supabase-demo\|127.0.0.1:55421" apps/web/dist/assets/*.js   # must print nothing
```

## Deploying

Nothing deploys automatically. Pushing to `main` does **not** publish the web
app — Cloudflare Pages is **not** git-connected. Deploys are explicit actions.

**Web → Cloudflare Pages → lanternstudy.com** — canonical path: the
**`Deploy web (Cloudflare Pages)` GitHub workflow**
([.github/workflows/deploy-web.yml](../.github/workflows/deploy-web.yml)).
GitHub → Actions → "Deploy web (Cloudflare Pages)" → Run workflow (pick the
ref, defaults to `main`). It builds with the repository's production env vars,
verifies the bundle points at production Supabase, publishes via wrangler, and
polls the live `sw.js` until the new build is confirmed serving — all with an
audit trail.

Fallback only — local wrangler deploy from a machine, after a verified build.
Use this only when Actions is unavailable; a locally built dist once shipped
local dev values to production:

```bash
npx wrangler login                    # opens a browser; token stays in your keychain
npm run build:web
# Must run from the repo root. Wrangler compiles ./functions (the same-origin
# /api proxy) relative to cwd, not apps/web/dist. Deploying from apps/web
# ships static assets only; POST /api/v1/auth/refresh then 405s and sign-in
# fails with HTML-as-JSON on profile fetch.
npx wrangler pages deploy apps/web/dist --project-name lantern-study --branch main
```

Whichever path you use, confirm the deploy landed — this must change after
every release:

```bash
curl -s https://lanternstudy.com/sw.js | grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+' | head -1
# Same-origin API proxy: 401 JSON, never 405 / HTML
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  -X POST https://lanternstudy.com/api/v1/auth/refresh \
  -H 'Content-Type: application/json' -d '{}'
```

**API → Render** (`lantern-study-api`, Docker, built from `main`) — canonical
path: the **`Deploy API (Render)` GitHub workflow**
([.github/workflows/deploy-api.yml](../.github/workflows/deploy-api.yml)), which
compiles and tests the ref before triggering Render. Fallback: Render dashboard
→ Manual Deploy → Deploy latest commit. Either way, a failed deploy keeps the
previous version serving, so a healthy `/health` does **not** prove your commit
is live.

**Mobile.** Full release recipe (Android local build + public releases repo,
iOS via EAS cloud + TestFlight, OTA safety rules) lives in
[docs/RELEASING.md](RELEASING.md). The short version: Android builds
locally and ships as an APK through `bjamilk/lantern-study-releases`; after an
architecture or native dependency change you need a **new native build**, not
an OTA update — an OTA would push new JS onto old native binaries and break
live users.

## Dependency changes — read this first

**Never delete `package-lock.json`.** Regenerating it once drifted 286 packages,
including Supabase 2.86→2.109, pdfjs-dist 4→5 and a node-fetch downgrade, and
broke the Render build. Reverting cost more than the original change.

**npm silently ignores a new override** when the existing lockfile already
satisfies the range — it prints "up to date" and changes nothing. Use
`npm update <pkg>` to force re-resolution, then confirm with
`node scripts/check-overrides.mjs`. Also check the range is publishable: an
override pinning `lodash@^4.17.24`, a version that was never released, silently
did nothing for months.

After any dependency change, run the full `verify-all.sh` — not just a build.
