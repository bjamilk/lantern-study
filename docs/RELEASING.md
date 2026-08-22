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
5. **Publish** with the script — it derives the version from `app.config.ts`,
   stages the asset as `lantern-study.apk` (the exact name the latest-URL
   fetches), marks the release **Latest**, appends the SHA-256 to the notes
   (from `apps/mobile/RELEASE-<version>.md` if present), tags the source repo,
   and confirms the download link flips to the new version. It refuses to
   double-publish an existing tag.

   ```bash
   scripts/publish-android-release.sh apps/mobile/build-<timestamp>.apk
   # dry-run first if you like: … build-<timestamp>.apk --dry-run
   ```

   Doing it by hand is the same three moves — the stable asset name is what
   makes the latest-URL work, so never rename it:

   ```bash
   VERSION=1.0.x
   APK=apps/mobile/build-<timestamp>.apk
   cp "$APK" /tmp/lantern-study.apk
   shasum -a 256 /tmp/lantern-study.apk   # put this in the notes
   gh release create "v$VERSION" /tmp/lantern-study.apk \
     --repo bjamilk/lantern-study-releases \
     --title "Lantern Study $VERSION (Android)" --latest \
     --notes "<changelog + sha256>"
   git tag "v$VERSION" && git push origin "v$VERSION"   # tag the source repo too
   ```

## Google Play (AAB → internal → closed testing → production)

**Status (Aug 2026): never submitted.** Only APKs have ever been built. The
code side is prepared — `eas.json` `submit.production.android` (internal track,
draft release, service-account key path), `npm run submit:android`,
`scripts/publish-android-aab.sh`, and the store drafts in `docs/store/` — the
steps marked *by hand* need the Play Console account owner.

### One-time setup (by hand)

1. **Play Console developer account.** Prefer an **organisation** account
   (D-U-N-S number + Google's identity verification; $25 one-off). A *personal*
   account created after Nov 2023 must first run **closed testing with at least
   12 testers opted in continuously for 14 days** and then *apply* for production
   access; organisation accounts skip that gate. Budget 1–2 weeks either way.
2. **Create the app**: name `Lantern Study`, English, App (not Game), Free. The
   first AAB upload locks the package name `com.lanternstudy.app`.
3. **Play App Signing — decide BEFORE the first upload** ("Signing keys" below).
4. **Service account for `eas submit`:** Play Console → *Setup → API access* →
   link/create a Google Cloud project → *Create new service account* (Cloud
   console: IAM → Service accounts → create → Keys → add JSON key) → back in Play
   Console *Users and permissions → Invite new users* with the service-account
   email and app-level permissions **Release to testing tracks** + **View app
   information** (add **Release to production** later). Save the JSON as
   `apps/mobile/play-service-account.json` — gitignored, and exactly the path
   `eas.json → submit.production.android.serviceAccountKeyPath` reads.
5. **Store presence & policy forms** (drafted in `docs/store/`):
   - Main store listing: `docs/store/store-listing.md` (copy, 8-screenshot
     shot-list, 1024×500 feature-graphic brief; hi-res icon =
     `public/icons/icon-512.png`).
   - *Policy → App content*: privacy policy `https://lanternstudy.com/privacy`;
     **Data safety** from `docs/store/google-play-data-safety.md`; Ads: no;
     **App access**: sign-in required → create a reviewer-only test account with
     seeded content; Content rating (IARC) questionnaire — user-generated content
     + user interaction + third-party purchases, answer truthfully; Target
     audience 16–17 and 18+ (Privacy Policy says 16+); News / Government /
     Health: no; Financial features: describe the budget tracker + marketplace
     honestly (not a loan/banking product).
   - **Account deletion** (required): in-app *Settings → Account → Delete
     account* (web + mobile) → `POST /api/v1/users/:id/delete-immediate`; the
     web URL to declare is `https://lanternstudy.com/privacy` until a dedicated
     deletion page exists.
6. **Testers.** *Testing → Internal testing*: up to 100 emails, no review.
   *Closed testing*: create a track (e.g. "APK users") fed by an email list or a
   Google Group and invite today's APK users — that cohort is what satisfies the
   12 × 14 rule on a personal account. Testers must opt in through the Play
   link before the app appears for them.

### Per release

Both scripts derive the version from `apps/mobile/app.config.ts`; bump + commit
first — the AAB script refuses a dirty tree because `eas build --local` bundles
the *committed* tree and uncommitted edits silently miss the build.

```bash
# APK for the website (unchanged)
scripts/publish-android-release.sh apps/mobile/build-<timestamp>.apk

# AAB for Google Play → internal track, DRAFT release
scripts/publish-android-aab.sh                 # local build (Node 20 / JDK 17 / ANDROID_HOME) + submit
scripts/publish-android-aab.sh --cloud         # EAS cloud build + `submit --latest`
scripts/publish-android-aab.sh --aab apps/mobile/build-<v>-play.aab   # submit an existing bundle
scripts/publish-android-aab.sh --dry-run       # print the commands only

# the same two moves by hand
cd apps/mobile && npm run build:prod && npm run submit:android
```

The `production` profile has no `buildType`, so Gradle produces an **.aab**; it
shares the remote `versionCode` counter (`appVersionSource: remote` +
`autoIncrement`) with the preview APKs, so a store build always outranks the
sideloaded one. The submit profile targets `track: internal` with
`releaseStatus: draft` — finish it in Play Console (*Testing → Internal testing →
Edit release → Start rollout*). Promote internal → closed → production in the
console, or resubmit with `npx eas-cli submit -p android --profile production
--path <aab> --track closed`. If a local build fails on version sync, run
`npx eas-cli build:version:sync -p android` once.

Once the listing is public, set `PLAY_STORE_URL` (and later `APP_STORE_URL`) in
`packages/shared/src/linking/index.ts` — the landing page swaps the APK download
for store badges automatically.

### Signing keys — read before the first upload

`eas.json` has no `credentialsSource`, so every build (local or cloud) signs with
the **EAS-managed upload keystore**. Which key actually signed the APKs students
have installed is not derivable from the repo (`*.jks` is gitignored). Check:

```bash
cd apps/mobile && npx eas-cli credentials -p android      # → production → Keystore → SHA-256 fingerprint
keytool -printcert -jarfile ~/Downloads/lantern-study.apk   # cert of the APK users actually installed
```

Compare both with the single fingerprint in `public/.well-known/assetlinks.json`
(`E9:C4:62:4B:…:63:3F`), then pick a path:

- **Path A (recommended — APK users keep upgrading in place):** enrol in Play
  App Signing by **uploading the existing EAS keystore as the app signing key**
  (Play Console → *Test and release → Setup → App signing* → "Use a key from
  Java keystore" → export with Google's PEPK tool; keystore + passwords come from
  `eas credentials` → download). Google then signs with the same certificate the
  APKs carry: in-place upgrades work, App Links keep verifying, and
  `assetlinks.json` needs no change.
- **Path B (Google-generated app signing key):** the Play build gets a **new
  certificate**. Two consequences: (1) every `https://lanternstudy.com/…` App
  Link breaks for Play installs until the new SHA-256 is in `assetlinks.json`;
  (2) Android treats the APK and the Play build as different apps — APK users
  must **uninstall and reinstall** (say so in the release notes and on the site).
  Before rolling the first Play release out: Play Console → *App signing* →
  **App signing key certificate → SHA-256**, add it as a SECOND entry (keep the
  existing one for sideloaded APKs), deploy the web, then verify:

  ```jsonc
  // public/.well-known/assetlinks.json — shape on Path B. The real file must
  // stay plain JSON (no comments, no TODO string): a malformed or placeholder
  // entry fails Android's verifier for BOTH fingerprints.
  "sha256_cert_fingerprints": [
    "E9:C4:62:4B:E8:95:7F:3B:6F:ED:52:C9:58:E2:A5:AB:E0:5A:61:6B:3F:51:F7:1B:FD:42:2F:4D:7B:38:63:3F",
    "<TODO: Play App signing key certificate SHA-256 from Play Console → App integrity>"
  ]
  ```

  ```bash
  curl -s https://lanternstudy.com/.well-known/assetlinks.json | jq .
  curl -s 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://lanternstudy.com&relation=delegate_permission/common.handle_all_urls'
  adb shell pm get-app-links com.lanternstudy.app     # after installing the Play build
  ```

- If the APK certificate turns out to differ from the EAS keystore (someone once
  built with a local key), APK users must reinstall once **on either path** —
  tell them.

Never switch to `credentialsSource: local` without first downloading and backing
up the EAS keystore; losing the upload key means a Play Console "reset upload
key" support ticket.

### Gotchas

- **Payments policy:** the marketplace sells digital question banks / study packs
  through Paystack (browser checkout via `expo-web-browser`, never in-app card
  entry). Play's payments policy generally requires Google Play Billing for
  digital in-app content; student-to-student sales and content also consumable
  on the web are the usual exemption arguments — get it reviewed before the
  production rollout, it is the most likely rejection reason.
- **User-generated content policy:** reporting and blocking exist; keep them
  reachable from chat, listings and profiles — reviewers look for them.
- **`RECORD_AUDIO`** is the only sensitive runtime permission (lecture recording →
  transcription); the Data safety form declares it under *Audio*.
- "Item not found" for a tester is nearly always a not-yet-opted-in tester or a
  release still in draft.

### SEO after a web deploy

`.github/workflows/deploy-web.yml` ends with `npm run seo:notify` (IndexNow
submission + Search Console hints, `continue-on-error: true`). The IndexNow key
is the public constant in `scripts/seo/constants.mjs`, served at
`/lanternstudyindex2026.txt` — **no GitHub secret is required**; `SITE_URL` only
matters for a preview origin.

### iOS (App Store)

Same per-release commands as the TestFlight section below; the App Privacy
"nutrition label" answers mirror the Play Data safety form —
`docs/store/apple-app-store.md`.

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

## Apply migrations before deploying (Supabase)

Nothing applies `supabase/migrations/` automatically — neither Render nor the
Pages workflow. Paste each file into the Supabase SQL editor, **in filename
order**, before the API build that needs it goes live. Every file is
idempotent (re-running a partial apply is safe).

The Phase 1 knowledge-network set (`docs/PLAN-2026-08-22-knowledge-network.md`,
`docs/phase1-*-contract.md`), in apply order:

1. `20260822120000_marketplace_listings_moderation_lock.sql`
2. `20260822121000_marketplace_release_escrow_moderation_safe.sql`
3. `20260822130000_academic_identity_and_courses.sql`
4. `20260822140000_rights_and_moderation.sql`
5. `20260822150000_learning_events_and_concepts.sql`
6. `20260822160000_library_search_indexes.sql`
7. `20260822170000_phase1_hardening.sql`

**The API build now REQUIRES the `130000` / `140000` / `150000` columns** — the
create paths write `course_id` and `rights_*` / `moderation_flags`
unconditionally (no `isMissingRelationError` fallback), so deploying that API
against a database without them breaks listing / question-bank publish and the
other create routes. Apply all seven first, then merge/deploy. `170000` must be
last: it re-grants `marketplace_listings` columns that `140000` creates and
backfills `offline_bundles.course_id` from `130000`.
`apps/api-server/src/services/migrations.phase1Shape.test.ts` pins the shape
of these files.

## Web + API

See `DEVELOPMENT.md` — web deploys are manual (`wrangler pages deploy`,
Cloudflare Pages is NOT git-connected); the API auto-deploys from `main` on
Render.
