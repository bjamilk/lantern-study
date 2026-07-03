#!/usr/bin/env bash
# Fail CI when committed secrets appear outside env files and known local-dev allowlists.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ALLOWLIST=(
  'packages/shared/src/config/index.ts'
  'apps/mobile/src/services/supabase.ts'
  'scripts/verify-rls-privileges.sql'
  'apps/api-server/src/utils/safeError.ts'
  'render.yaml'
)

is_allowlisted() {
  local file="$1"
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$file" == *"$allowed"* ]]; then
      return 0
    fi
  done
  return 1
}

scan_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0

  while IFS= read -r -d '' file; do
    if [[ "$file" == *"/node_modules/"* ]]; then continue; fi
    if [[ "$file" == *"/dist/"* ]]; then continue; fi
    if [[ "$file" == *.env* ]]; then continue; fi
    if is_allowlisted "$file"; then continue; fi

    if grep -qE '"service_role"|'\''service_role'\''|SUPABASE_SERVICE_ROLE_KEY=' "$file" 2>/dev/null; then
      echo "SECRET SCAN FAIL: service role material in $file"
      exit 1
    fi

    if grep -qE 'sk-[A-Za-z0-9]{10,}' "$file" 2>/dev/null; then
      echo "SECRET SCAN FAIL: API secret key pattern in $file"
      exit 1
    fi

    if grep -qE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' "$file" 2>/dev/null; then
      if grep -qv 'supabase-demo' "$file" 2>/dev/null; then
        echo "SECRET SCAN FAIL: JWT-like token in $file"
        exit 1
      fi
    fi
  done < <(find "$dir" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.ps1' -o -name '*.sh' -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' \) -print0)
}

scan_dir "apps"
scan_dir "services"

echo "Secret scan passed."
