#!/usr/bin/env bash
#
# Build the Google Play App Bundle (AAB) for the current app version and submit
# it to the Play INTERNAL testing track as a draft release. Companion to
# publish-android-release.sh (sideload APK -> GitHub release). One version, two
# artefacts:
#
#   preview profile    -> APK -> GitHub release     publish-android-release.sh
#   production profile -> AAB -> Play internal      this script
#
# Usage:
#   scripts/publish-android-aab.sh [--local|--cloud] [--aab <path>] [--no-submit]
#                                  [--allow-dirty] [--dry-run]
#
#   --local        build on this machine with `eas build --local` (default; no
#                  EAS build credits; same toolchain as the APK recipe in
#                  docs/RELEASING.md: Node 20, JDK 17, ANDROID_HOME)
#   --cloud        build on EAS servers instead (credits / queue) and submit
#                  the finished build with `--latest`
#   --aab <path>   skip the build and submit an existing .aab
#   --no-submit    build only (e.g. to upload by hand in Play Console)
#   --allow-dirty  build even with uncommitted changes (they will NOT be in the
#                  bundle — eas archives the committed tree)
#   --dry-run      print what would happen, build/submit nothing
#
# Prerequisites (one-time, by hand — docs/RELEASING.md "Google Play"):
#   * Play Console app record for com.lanternstudy.app, Play App Signing decided
#   * apps/mobile/play-service-account.json (Play Console API service account
#     key, gitignored) — the path eas.json `submit.production.android` uses
#   * `npx eas-cli login` once on this machine
#   * public/.well-known/assetlinks.json carries the Play signing-cert SHA-256
#     BEFORE the first store build is rolled out (see RELEASING.md)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
MODE="local"; AAB=""; SUBMIT=1; DRY=0; ALLOW_DIRTY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --local) MODE=local;;
    --cloud) MODE=cloud;;
    --aab) AAB="${2:?--aab needs a path}"; shift;;
    --no-submit) SUBMIT=0;;
    --allow-dirty) ALLOW_DIRTY=1;;
    --dry-run) DRY=1;;
    -h|--help) sed -n '2,32p' "$0"; exit 0;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
  shift
done

# Version is the single source of truth in app.config.ts (same as the APK script).
VERSION="$(grep -oE "version: '[0-9]+\.[0-9]+\.[0-9]+'" "$MOBILE/app.config.ts" | head -1 | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")"
[ -n "$VERSION" ] || { echo "Could not read version from app.config.ts" >&2; exit 1; }
echo "Version : $VERSION"
echo "Mode    : $MODE$([ -n "$AAB" ] && echo " (existing bundle: $AAB)")"
echo "Submit  : $([ "$SUBMIT" = 1 ] && echo "yes -> Play internal track (draft)" || echo "no")"

if [ -n "$AAB" ] && [ ! -f "$AAB" ]; then
  echo "AAB not found: $AAB" >&2; exit 1
fi

SA="$MOBILE/play-service-account.json"
if [ "$SUBMIT" = 1 ] && [ ! -f "$SA" ]; then
  echo "Missing $SA — put the Play Console service-account JSON there (it is gitignored)." >&2
  echo "How to create it: docs/RELEASING.md, section 'Google Play'." >&2
  [ "$DRY" = 1 ] || exit 1
fi

# `eas build --local` archives the COMMITTED tree; uncommitted edits silently
# miss the bundle. Refuse unless told otherwise.
if [ -z "$AAB" ] && [ "$ALLOW_DIRTY" = 0 ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Working tree has uncommitted changes — commit first (or pass --allow-dirty)." >&2
  [ "$DRY" = 1 ] || exit 1
fi

cd "$MOBILE"

if [ -z "$AAB" ]; then
  if [ "$MODE" = local ]; then
    NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$NODE_MAJOR" != "20" ]; then
      echo "Local EAS builds need Node 20 (have $(node -v)). Run: nvm use 20" >&2
      [ "$DRY" = 1 ] || exit 1
    fi
    export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17 2>/dev/null || true)}"
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    AAB="$MOBILE/build-$VERSION-play.aab"
    # No `buildType` on the production profile -> Gradle :bundleRelease -> .aab.
    BUILD_CMD=(npx eas-cli build --platform android --profile production --local --non-interactive --output "$AAB")
  else
    BUILD_CMD=(npx eas-cli build --platform android --profile production --non-interactive --wait)
  fi
  echo "Build   : ${BUILD_CMD[*]}"
  if [ "$DRY" = 0 ]; then
    "${BUILD_CMD[@]}"
  fi
fi

if [ -n "$AAB" ] && [ -f "$AAB" ]; then
  echo "AAB     : $AAB ($(du -h "$AAB" | awk '{print $1}'))"
  echo "SHA-256 : $(shasum -a 256 "$AAB" | awk '{print $1}')"
fi

if [ "$SUBMIT" = 1 ]; then
  # Track/releaseStatus/serviceAccountKeyPath come from eas.json submit.production.android.
  # Override per run with e.g. `--track closed` / `--release-status completed` if needed.
  if [ -n "$AAB" ]; then
    SUBMIT_CMD=(npx eas-cli submit --platform android --profile production --path "$AAB" --non-interactive)
  else
    SUBMIT_CMD=(npx eas-cli submit --platform android --profile production --latest --non-interactive)
  fi
  echo "Submit  : ${SUBMIT_CMD[*]}"
  if [ "$DRY" = 0 ]; then
    "${SUBMIT_CMD[@]}"
  fi
fi

cat <<EOF

Next (Play Console, by hand):
  1. Testing -> Internal testing -> the new DRAFT release -> review -> "Start rollout".
  2. Before promoting past internal: confirm the Play signing-cert SHA-256 is in
     public/.well-known/assetlinks.json and live on lanternstudy.com (RELEASING.md).
  3. Promote internal -> closed testing (personal account: 12 testers x 14 days)
     -> production.
The source-repo tag v$VERSION is created by publish-android-release.sh (APK); this
script does not tag.
EOF
