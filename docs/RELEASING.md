# Releasing Lantern Study Mobile

The source repo is private; binaries are distributed through the **public**
releases repo `bjamilk/lantern-study-releases`. The website's "Download for
Android" link points at the stable URL
`https://github.com/bjamilk/lantern-study-releases/releases/latest/download/lantern-study.apk`,
which always serves the newest release asset with that filename — publishing a
new release updates the site link with no web deploy needed.

## Android (every release)

1. **Bump `version`** in `apps/mobile/app.config.ts` (this is also the OTA
   runtime version — see the OTA section). Commit.
2. **Build locally** (zero EAS credits; ~11 min — toolchain prerequisites in
   `docs/HANDOVER-2026-08-10-mobile-offline-payments.md` and the
   `lantern-study-local-android-build` memory):

   ```bash
   cd apps/mobile
   nvm use 20
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   export ANDROID_HOME=~/Library/Android/sdk
   npx eas-cli build --platform android --profile preview --local
   ```

   If mobile dependencies changed since the last release, regenerate
   `scripts/package-lock.eas-mobile.json` first (recipe in commit `8ea492d`).
3. **Record what shipped** in `components/admin/productFeatures.ts`
   (`PRODUCT_FEATURES`). Admin → Features is what support and QA read to find
   out what a release contains, and nothing generates it from git — the
   registry silently fell a month behind once, leaving the Marketplace and
   Platform filters empty while both had shipped work. Use `status: 'partial'`
   for a feature that shipped incomplete and say what is missing in
   `adminNotes`. CI enforces this: the `feature-registry` job fails when
   `version` moves and that file is untouched. For a bump that genuinely ships
   nothing user-visible, put `[skip registry]` in a commit message.
4. **Smoke-test the APK on the emulator** before publishing: install with
   `adb install -r`, cold boot, sign in, download an offline test.
5. **Publish** (stable asset name is what makes the latest-URL work):

   ```bash
   VERSION=1.0.x
   APK=apps/mobile/build-<timestamp>.apk
   cp "$APK" /tmp/lantern-study.apk
   shasum -a 256 /tmp/lantern-study.apk   # put this in the notes
   gh release create "v$VERSION" /tmp/lantern-study.apk \
     --repo bjamilk/lantern-study-releases \
     --title "Lantern Study $VERSION (Android)" \
     --notes "<changelog + sha256>"
   git tag "v$VERSION" && git push origin "v$VERSION"   # tag the source repo too
   ```

## iOS simulator (local, no Apple account)

Distribution needs the Apple Developer membership; **running the app locally does
not**. Simulator builds are unsigned, so this path works today:

```bash
cd apps/mobile
./scripts/run-ios-simulator.sh              # dev variant, com.lanternstudy.app.dev
./scripts/run-ios-simulator.sh production   # real bundle id, baked endpoints, OTA on
./scripts/run-ios-simulator.sh dev --no-prebuild   # skip regenerate + pod install
```

Both variants can be installed at once — the bundle ids differ. First run takes
a while (CocoaPods plus a cold Xcode build).

Four things the script encodes, each of which cost a debugging cycle:

- **`npx expo run:ios` is broken under Xcode 26.** It fails with *"No code signing
  certificates are available"* without compiling anything: Xcode 26 changed
  `devicectl`'s JSON output, Expo cannot parse it, and its device detection then
  treats a *simulator* UDID as a physical iPhone. Driving `xcodebuild` with an
  explicit simulator destination avoids it. Retry after an Expo upgrade.
- **`APP_VARIANT` and `EAS_BUILD_PROFILE` must be exported for the xcodebuild step
  too**, not just prebuild. The "Bundle React Native code and images" phase
  re-evaluates `app.config.ts`; setting them only for prebuild produces a native
  shell with one identity wrapping JS built as the other.
- **Release, not Debug.** Debug only runs while Metro is attached; Release embeds
  the bundle so the app opens from the home screen indefinitely.
- **`ios/` is gitignored and goes stale**, keeping whatever version, bundle id and
  associated domains it was generated with. `--clean` regeneration is the
  difference between "an iOS build" and "the current iOS build".

Sentry is **active in either variant**: the DSN is gated on `__DEV__`, which is
false in any Release build regardless of app variant. Crashes from a simulator
run reach the `lantern-study-mobile` project.

## iOS (EAS cloud + TestFlight)

There is no local iOS *release* path (`eas build --local` for iOS needs fastlane
and signing certificates; fastlane is not installed on this machine). The
supported path is EAS cloud build + TestFlight. For local running, use the
simulator script above.

**One-time prerequisites (account owner only — never share these credentials):**

1. Join the [Apple Developer Program](https://developer.apple.com/programs/)
   ($99/yr) with the Apple ID that will own the app.
2. In [App Store Connect](https://appstoreconnect.apple.com), create the app
   record for bundle id `com.lanternstudy.app`.

**Per release:**

```bash
cd apps/mobile
npm run build:ios      # EAS cloud build; prompts for Apple login on first run
                       # and auto-manages certificates/profiles. Free-tier
                       # queues can wait 3+ hours.
npm run submit:ios     # uploads the finished build to TestFlight
```

Then in App Store Connect → TestFlight: add internal testers (up to 100, no
review) or external testers (needs a brief beta review). Testers install via
the TestFlight app.

## OTA updates (JS-only changes)

`runtimeVersion.policy` is `appVersion`: updates only reach binaries whose app
version matches the version the update was published from.

- **⚠ Read the `lantern-study-ota-crash` memory / Aug 10 handover before any
  `eas update`.** An OTA published from a tree whose export bundle mismatched
  the native runtime crash-looped every Android install; the 1.0.2 channel is
  pinned to the Aug 7 rollback and must never receive new JS.
- Publish with `npm run update:preview` from `apps/mobile`. Verify on an
  emulator install of the same app version (launch twice, watch logcat for
  `NativeProxy.initHybrid` SIGABRT) before considering it live.
- Rollback: `npx eas-cli update:republish --group <last-good-group-id>`, or
  `npx eas-cli update:delete <group-id>` if there is no earlier good group for
  that runtime.

## Web + API

See `DEVELOPMENT.md` — web deploys are manual (`wrangler pages deploy`,
Cloudflare Pages is NOT git-connected); the API auto-deploys from `main` on
Render.
