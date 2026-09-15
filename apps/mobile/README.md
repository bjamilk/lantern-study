# @lantern/mobile — the Expo app

React Native 0.81.5 on Expo SDK 54, shipped to the Play Store and TestFlight through EAS.
Unlike the web app, mobile calls the Render API **directly with a bearer token** — it does
not go through the Cloudflare Pages proxy and does not use cookie auth. An auth bug is
therefore often web-only or mobile-only.

## Entry points

| Path | Purpose |
|---|---|
| `app.config.ts` / `app.json` | Expo config. `app.config.ts` is the one with the real values (bundle id `com.lanternstudy.app`). |
| `eas.json` | Build profiles: `development`, `emulator`, `ios-simulator`, `preview`, `production`. |
| `src/navigation/RootNavigator.tsx` | The navigator plus a body of navigation *logic* modules with their own tests. |
| `src/screens/`, `src/components/` | UI. |
| `src/stores/`, `src/services/`, `src/hooks/` | State, network, logic. |
| `src/design/`, `src/theme/` | Mobile type scale and theming — a **separate copy** from the web's `design/`, with its own allowlist and lint test. |
| `metro.config.js`, `babel.config.js`, `jest.config.js`, `tailwind.config.js` | Build and test config (Tailwind here is NativeWind). |
| `plugins/`, `modules/` | Expo config plugins and native modules. |

## Run and test

Node 20 is required. The full local setup — JDK/Temurin, Android SDK, CocoaPods via brew —
is in [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md).

```bash
npx expo start --offline        # Metro; use port 8082 (see gotchas)
npm run android:emulator        # boot the AVD
npm run android:native          # expo run:android against a dev client
npm test --workspace=@lantern/mobile
cd apps/mobile && npx tsc --noEmit -p .   # baseline is 0 errors
```

Cloud builds: `npm run build:preview` / `build:prod` / `build:ios`. Local zero-credit
builds and the iOS simulator recipe are in `docs/DEVELOPMENT.md`.

Several `npm run` scripts here shell out to **PowerShell** (`scripts/*.ps1`) and will not
run on macOS. Use the `expo` commands directly, or the shell scripts in `scripts/`.

## Gotchas

- **The Android build does not use the root `package-lock.json`.** The
  `eas-build-pre-install` hook (`scripts/eas-prepare-mobile-install.js` at the repo root)
  trims the root manifest to the mobile + packages workspaces and copies
  `scripts/package-lock.eas-mobile.json` over it. That slim lockfile is **hand-maintained**
  and nothing regenerates it; when it drifts, every Android build fails in
  `INSTALL_DEPENDENCIES` before Gradle starts. Moving or renaming it breaks all Android builds.
- **Jest does not map the bare `@lantern/shared` specifier**, only subpaths. A bare import
  type-checks and bundles fine, then aborts the entire mobile suite the first time anyone
  writes a test for that file. Reproduce with `npx jest --no-cache`.
- **Changing the font size remounts the whole tree.** It re-keys the app wrapper, so
  `NavigationContainer` remounts; React Navigation discards a pending `initialState` if the
  boot gate delays the first navigator by one commit, dumping the user back on Home.
- **Metro's default port 8081 is often already held.** Use 8082.
- `android/`, `ios/` and `dist/` are local prebuild output — gitignored, and excluded from
  EAS uploads by the root `.easignore`. So are all `*.apk` / `*.tar.gz` artifacts; these
  accumulate here and have filled the disk before.
- Release notes for each version live in `RELEASE-1.0.*.md` in this directory.
