#!/usr/bin/env bash
#
# Build and run Lantern Study in the iOS Simulator.
#
#   ./scripts/run-ios-simulator.sh              # dev variant (com.lanternstudy.app.dev)
#   ./scripts/run-ios-simulator.sh production   # real bundle id, baked endpoints, OTA on
#   ./scripts/run-ios-simulator.sh dev --no-prebuild   # skip regenerate + pod install
#
# Needs no Apple Developer account: simulator builds are unsigned. This is the
# only iOS path available without the $99/yr membership — device and TestFlight
# builds still require EAS cloud + an interactive Apple login (see RELEASING.md).
#
# Why this script exists instead of `npx expo run:ios`:
#
#   Xcode 26 changed the JSON that `devicectl` emits. Expo's CLI cannot parse it
#   ("Unexpected devicectl JSON version output"), so its device detection
#   misclassifies a *simulator* UDID as a physical iPhone and stops with
#   "No code signing certificates are available" — before compiling anything.
#   Driving xcodebuild with an explicit simulator destination sidesteps it.
#   Retry `expo run:ios` after an Expo upgrade; delete this note when it works.
#
set -euo pipefail

cd "$(dirname "$0")/.."

VARIANT="${1:-dev}"
SKIP_PREBUILD=0
for arg in "$@"; do
  [ "$arg" = "--no-prebuild" ] && SKIP_PREBUILD=1
done

case "$VARIANT" in
  dev|development)
    APP_VARIANT=development
    EAS_BUILD_PROFILE=ios-simulator
    SCHEME=LanternStudyDev
    BUNDLE_ID=com.lanternstudy.app.dev
    ;;
  production|prod)
    APP_VARIANT=production
    # Must be 'production' or 'preview': app.config.ts derives IS_PRODUCTION_BUILD
    # from this, which gates baked endpoints and OTA updates.
    EAS_BUILD_PROFILE=production
    SCHEME=LanternStudy
    BUNDLE_ID=com.lanternstudy.app
    ;;
  *)
    echo "usage: $0 [dev|production] [--no-prebuild]" >&2
    exit 2
    ;;
esac

# Node 20: eas.json pins 20.19.4 and the shell default is 24.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null
fi

# CocoaPods warns and can misbehave without a UTF-8 locale.
export LANG=${LANG:-en_US.UTF-8}
export LC_ALL=${LC_ALL:-en_US.UTF-8}

# Both variables must be exported for prebuild AND xcodebuild. The "Bundle
# React Native code and images" build phase re-evaluates app.config.ts, so
# setting them only for prebuild yields a native shell with the production
# bundle id wrapping JS built as the dev variant — endpoints that disagree with
# the app's own identity, visible only as odd runtime behaviour.
export APP_VARIANT EAS_BUILD_PROFILE

# Prefer an already-booted simulator; otherwise boot the first available iPhone.
UDID="$(xcrun simctl list devices available | awk -F'[()]' '/iPhone.*Booted/ {print $2; exit}')"
if [ -z "$UDID" ]; then
  UDID="$(xcrun simctl list devices available | awk -F'[()]' '/iPhone/ {print $2; exit}')"
  [ -n "$UDID" ] || { echo "No iPhone simulator available. Install one via Xcode > Settings > Components." >&2; exit 1; }
  echo "==> Booting simulator $UDID"
  xcrun simctl boot "$UDID"
fi
open -a Simulator || true

if [ "$SKIP_PREBUILD" -eq 0 ]; then
  # --clean because ios/ is gitignored and goes stale: it keeps whatever version,
  # bundle id and associated domains it was generated with. Regenerating is the
  # difference between "an iOS build" and "the current iOS build".
  echo "==> Regenerating ios/ for the $VARIANT variant (this reinstalls pods)"
  npx expo prebuild --platform ios --clean
fi

echo "==> Building $SCHEME (Release, simulator, unsigned)"
# Release, not Debug: a Debug build only runs while a Metro bundler is attached.
# Release embeds the JS bundle, so the app opens from the home screen forever.
xcodebuild \
  -workspace "ios/${SCHEME}.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${UDID}" \
  -derivedDataPath ios/build \
  CODE_SIGNING_ALLOWED=NO \
  build

APP_PATH="$(find ios/build/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' | head -1)"
[ -n "$APP_PATH" ] || { echo "Build produced no .app" >&2; exit 1; }

echo "==> Installing $APP_PATH"
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch "$UDID" "$BUNDLE_ID"

echo
echo "Running: $BUNDLE_ID on $UDID"
echo "Version: $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP_PATH/Info.plist" 2>/dev/null)"
echo
echo "Both variants can be installed at once — the bundle ids differ."
echo "Sentry is ACTIVE in either: the DSN is gated on __DEV__, which is false in"
echo "any Release build regardless of variant. Crashes reach lantern-study-mobile."
