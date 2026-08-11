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
3. **Smoke-test the APK on the emulator** before publishing: install with
   `adb install -r`, cold boot, sign in, download an offline test.
4. **Publish** (stable asset name is what makes the latest-URL work):

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

## iOS (EAS cloud + TestFlight)

There is no local iOS release path (`eas build --local` for iOS needs fastlane
and signing certificates). The supported path is EAS cloud build + TestFlight.

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
