#!/usr/bin/env bash
#
# Publish an Android APK as the newest GitHub release so lanternstudy.com's
# download link serves it. The home page links to a STABLE url —
#   https://github.com/bjamilk/lantern-study-releases/releases/latest/download/lantern-study.apk
# — which GitHub resolves, at request time, to whatever release is marked
# "Latest", picking the asset named exactly `lantern-study.apk`. So the link
# never needs changing; it always points at the latest build AS LONG AS every
# release is published with that asset name and marked latest. This script is
# the guardrail that guarantees both (v1.0.25 was skipped once, leaving the
# download a version behind — this exists so that can't happen silently again).
#
# Usage:
#   scripts/publish-android-release.sh <path-to-apk> [--dry-run]
#
# Version, title, and notes are derived automatically from
# apps/mobile/app.config.ts and apps/mobile/RELEASE-<version>.md.
set -euo pipefail

REPO="bjamilk/lantern-study-releases"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="${1:?usage: publish-android-release.sh <path-to-apk> [--dry-run]}"
DRY_RUN="${2:-}"

[ -f "$APK" ] || { echo "APK not found: $APK" >&2; exit 1; }

# Version is the single source of truth in app.config.ts.
VERSION="$(grep -oE "version: '[0-9]+\.[0-9]+\.[0-9]+'" "$ROOT/apps/mobile/app.config.ts" | head -1 | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")"
[ -n "$VERSION" ] || { echo "Could not read version from app.config.ts" >&2; exit 1; }
TAG="v$VERSION"
NOTES_FILE="$ROOT/apps/mobile/RELEASE-$VERSION.md"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists on $REPO — nothing to do." >&2
  exit 1
fi

# The asset MUST be named lantern-study.apk — that is what the latest-URL fetches.
STAGE="$(mktemp -d)/lantern-study.apk"
cp "$APK" "$STAGE"
SHA="$(shasum -a 256 "$STAGE" | awk '{print $1}')"
echo "Version : $VERSION"
echo "APK     : $APK ($(du -h "$APK" | awk '{print $1}'))"
echo "SHA-256 : $SHA"
echo "Notes   : $([ -f "$NOTES_FILE" ] && echo "$NOTES_FILE" || echo "(auto)")"

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[dry-run] would publish $TAG as Latest with asset lantern-study.apk"
  exit 0
fi

NOTES_ARGS=()
if [ -f "$NOTES_FILE" ]; then
  # Append the checksum so downloaders can verify the APK.
  BODY="$(mktemp)"; cat "$NOTES_FILE" > "$BODY"
  printf '\n\n---\nSHA-256 `%s`\n' "$SHA" >> "$BODY"
  NOTES_ARGS=(--notes-file "$BODY")
else
  NOTES_ARGS=(--notes "Lantern Study $VERSION (Android). SHA-256 \`$SHA\`")
fi

# --latest marks it as the release the stable download URL resolves to.
gh release create "$TAG" "$STAGE" \
  --repo "$REPO" \
  --title "Lantern Study $VERSION (Android)" \
  --latest \
  "${NOTES_ARGS[@]}"

# Tag the source repo too, so the release is traceable to a commit.
if ! git -C "$ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
  git -C "$ROOT" tag "$TAG"
  git -C "$ROOT" push origin "$TAG"
fi

echo "Published $TAG. Verifying the download link resolves to it…"
for i in 1 2 3 4 5; do
  RESOLVED="$(curl -sI -L "https://github.com/$REPO/releases/latest/download/lantern-study.apk?cb=$i" 2>/dev/null | grep -ioE "releases/download/v[0-9.]+/lantern-study.apk" | head -1)"
  echo "  attempt $i: $RESOLVED"
  case "$RESOLVED" in *"$TAG"*) echo "✓ Download link now serves $TAG"; exit 0;; esac
  sleep 2
done
echo "⚠ Download link has not flipped to $TAG yet (GitHub edge cache can lag a minute); re-check shortly." >&2
