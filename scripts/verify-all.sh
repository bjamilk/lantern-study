#!/usr/bin/env bash
# Run every check that must pass before committing or deploying.
#
# Ordered cheapest-first so it fails fast. Each step prints PASS/FAIL and the
# script exits non-zero if any step fails.
#
#   bash scripts/verify-all.sh            # everything except native mobile builds
#   bash scripts/verify-all.sh --quick    # skip tests and the web build
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
QUICK=${1:-}
FAILED=()

step() {
  local name="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then
    printf '  \033[32mPASS\033[0m %s\n' "$name"
  else
    printf '  \033[31mFAIL\033[0m %s\n' "$name"
    FAILED+=("$name")
  fi
}

# Node 20 is required by apps/mobile (engines >=20.19.4 <21); the root and web
# workspaces are happy on it too, so pin the whole run to one version.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || true
fi

no_ts_errors() {
  local out; out=$(npm run build --workspace="$1" 2>&1)
  local n; n=$(echo "$out" | grep -c "error TS")
  [ "$n" -eq 0 ] || { echo "$out" | grep "error TS" | head -10; return 1; }
}

# Guards a class of bug this repo has hit repeatedly: npm silently keeps the
# version already in the lockfile and ignores a newly added override.
step "security overrides applied"   node scripts/check-overrides.mjs
step "no committed secrets"         bash scripts/check-secrets.sh
step "shared builds"                no_ts_errors @lantern/shared
step "api-server builds"            no_ts_errors @lantern/api-server
step "api-server lints"             npm run lint --workspace=@lantern/api-server

if [ "$QUICK" != "--quick" ]; then
  step "api-server tests"           npm test --workspace=@lantern/api-server
  step "web tests"                  npm test --workspace=@lantern/web
  step "web production build"       npm run build:web

  # The production web bundle is built with Vite, which inlines VITE_* at build
  # time. A dist built with local .env values will happily deploy and then fail
  # in production with "Invalid API key" — this catches exactly that.
  # Do NOT test for the absence of the demo key: packages/shared/src/config has a
  # hardcoded DEV_CONFIG fallback, so that key is in every bundle by design. What
  # matters is that Vite actually inlined the production values — when it does
  # not, getEnvironment() falls through to DEV_CONFIG and the deployed app sends
  # the demo anon key, which Supabase rejects with "Invalid API key".
  check_bundle_config() {
    [ -d dist/assets ] || { echo "  no dist/assets — build first"; return 1; }
    local url key issuer
    url=$(grep -oh '__LANTERN_VITE_SUPABASE_URL__:"[^"]*"' dist/assets/index-*.js 2>/dev/null |
          head -1 | sed 's/.*:"//;s/"//')
    key=$(grep -oh '__LANTERN_VITE_SUPABASE_ANON_KEY__:"[^"]*"' dist/assets/index-*.js 2>/dev/null |
          head -1 | sed 's/.*:"//;s/"//')

    if [ -z "$url" ] || [ -z "$key" ]; then
      echo "  VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not inlined."
      echo "  The app will fall back to DEV_CONFIG and fail with 'Invalid API key'."
      return 1
    fi
    case "$url" in
      *localhost*|*127.0.0.1*|*192.168.*)
        echo "  bundle points at a local Supabase: $url"; return 1;;
    esac

    issuer=$(python3 - "$key" <<'PY' 2>/dev/null
import sys, json, base64
p = sys.argv[1].split('.')[1]
p += '=' * (-len(p) % 4)
print(json.loads(base64.urlsafe_b64decode(p)).get('iss', ''))
PY
)
    if [ "$issuer" != "supabase" ]; then
      echo "  anon key issuer is '$issuer', expected 'supabase' (a demo/dev key is baked in)"
      return 1
    fi
    echo "  url=$url  key issuer=$issuer"
  }
  step "web bundle points at production" check_bundle_config
fi

printf '\n────────────────────────────\n'
if [ ${#FAILED[@]} -eq 0 ]; then
  printf '\033[32mAll checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m%d check(s) failed:\033[0m\n' "${#FAILED[@]}"
printf '  - %s\n' "${FAILED[@]}"
exit 1
