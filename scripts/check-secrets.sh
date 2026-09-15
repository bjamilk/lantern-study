#!/usr/bin/env bash
# Fail when credential-shaped strings appear in tracked files.
#
# Runs in three places: the `secrets` job in CI, the pre-commit hook
# (`--staged`), and as the first gate of both deploy workflows. The repo is
# public, so a key that reaches a commit is scraped by bots within minutes —
# which is why the pre-commit path exists at all. See docs/PIPELINE.md.
#
# Usage:
#   bash scripts/check-secrets.sh            # whole tree
#   bash scripts/check-secrets.sh --staged   # only files staged for commit
#
# Exits 0 when clean; 1 listing every offending file:line:pattern otherwise.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAGED=0
[ "${1:-}" = "--staged" ] && STAGED=1

# ---------------------------------------------------------------------------
# Allowlist: PATH_FRAGMENT|PATTERN_ID pairs.
#
# An entry exempts exactly one pattern under one path — never a whole file — so
# allowlisting one known-safe string in a file cannot also hide a payment key
# that lands in the same file later. Pattern ids are the ones in SCAN below.
# `jwt-service-role` is deliberately not allowlistable anywhere.
# ---------------------------------------------------------------------------
ALLOWLIST=(
  # This scanner and its documentation contain the literal patterns they hunt
  # for, so every pattern is exempt in these two files only.
  'scripts/check-secrets.sh|*'
  'docs/PIPELINE.md|*'
  # Placeholder assignments in the committed env templates. These are the
  # values a developer is meant to REPLACE; the shape rules below already
  # require a real key prefix (eyJ / sb_secret_), so a real value pasted over
  # the placeholder still fails.
  '.env.example|service-role-literal'
)

is_allowlisted() { # file, pattern_id
  local file="$1" pid="$2" entry apath apid
  for entry in "${ALLOWLIST[@]}"; do
    apath="${entry%%|*}"
    apid="${entry##*|}"
    if [[ "$file" == *"$apath"* ]] && { [[ "$apid" == '*' ]] || [[ "$apid" == "$pid" ]]; }; then
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Patterns: `id|description|extended-regex`
#
# Notes on the two rules that were wrong before:
#   * sk-… is OpenAI's hyphen form. Paystack and Stripe use sk_live_/sk_test_,
#     which the old regex did not match at all — so a live Paystack key pasted
#     into source passed CI silently, into a public repo.
#   * service_role: the old rule matched the bare string "service_role", which
#     fires on every SQL `GRANT ... TO service_role` (correct, ordinary code) —
#     a hundred false positives that train people to ignore the scanner. The
#     real detection is the decoded JWT rule below; this rule now only matches
#     an assignment whose VALUE has a real key prefix.
# ---------------------------------------------------------------------------
SCAN=(
  'payment-secret-key|Stripe/Paystack secret key|sk_(live|test)_[A-Za-z0-9]{10,}'
  'openai-secret-key|OpenAI secret key|sk-(proj-)?[A-Za-z0-9]{20,}'
  'service-role-literal|service-role key assignment|(SUPABASE_)?SERVICE_ROLE_KEY[[:space:]]*[=:][[:space:]]*["'"'"']?(eyJ|sb_secret_)'
  'supabase-secret-key|Supabase secret (sb_secret_) key|sb_secret_[A-Za-z0-9_-]{16,}'
  'aws-access-key|AWS access key id|(A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}'
  'aws-secret-key|AWS secret access key assignment|aws_secret_access_key[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9/+=]{40}'
  'gcp-private-key|GCP/PEM private key block|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'gcp-api-key|Google API key|AIza[0-9A-Za-z_-]{35}'
  'github-token|GitHub token|gh[pousr]_[A-Za-z0-9]{36}'
  'slack-token|Slack token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'paystack-live|Paystack live key|pk_live_[A-Za-z0-9]{10,}'
)

JWT_RE='eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'

FAILURES=0
report() { # file, line, pattern_id, description
  echo "SECRET SCAN FAIL: $4 in $1:$2  [pattern: $3]"
  FAILURES=$((FAILURES + 1))
}

# ---------------------------------------------------------------------------
# File selection. The old scanner listed nine subdirectories, leaving the repo
# root, supabase/ (208 migrations), docs/, public/ and patches/ unscanned — a
# key pasted into a migration or a root script was invisible to it. It also
# omitted .cjs/.mjs. This scans the whole tree with build output pruned.
# ---------------------------------------------------------------------------
EXT_RE='\.(ts|tsx|js|jsx|cjs|mjs|json|ya?ml|sql|md|ps1|sh|bash|txt|toml|xml|properties|gradle)$'

should_scan() { # path
  local f="$1"
  case "$f" in
    */node_modules/*|node_modules/*) return 1;;
    */dist/*|dist/*) return 1;;
    */build/*|build/*) return 1;;
    */coverage/*|coverage/*) return 1;;
    .git/*|*/.git/*) return 1;;
    .expo/*|*/.expo/*) return 1;;
    .turbo/*|*/.turbo/*) return 1;;
    # Agent worktrees are throwaway checkouts of this same repo; scanning them
    # double-reports every finding against files that are not in this tree.
    .claude/*|*/.claude/*) return 1;;
    *.apk|*.aab|*.keystore|*.jks) return 1;;
  esac
  # Real env files are gitignored and never committed; the .example templates
  # ARE scanned — they must never carry a real value.
  case "$(basename "$f")" in
    .env|.env.*) [[ "$f" == *.example ]] || return 1;;
  esac
  [[ "$f" =~ $EXT_RE ]] || return 1
  return 0
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILELIST="$TMP/files"
: > "$FILELIST"

if [ "$STAGED" -eq 1 ]; then
  echo "Scanning staged files..."
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    should_scan "$f" || continue
    printf '%s\0' "$f" >> "$FILELIST"
  done < <(git diff --cached --name-only --diff-filter=ACMR)
else
  echo "Scanning the tree..."
  while IFS= read -r -d '' f; do
    f="${f#./}"
    should_scan "$f" || continue
    printf '%s\0' "$f" >> "$FILELIST"
  done < <(find . \
    \( -name node_modules -o -name dist -o -name build -o -name .git -o -name coverage \
       -o -name .expo -o -name .turbo -o -name .claude \) -prune -o \
    -type f -print0)
fi

FILE_COUNT=$(tr -cd '\0' < "$FILELIST" | wc -c | tr -d ' ')
echo "$FILE_COUNT file(s) in scope."
if [ "$FILE_COUNT" = "0" ]; then
  echo "Secret scan passed."
  exit 0
fi

# One grep pass per pattern over the whole list (rather than one grep per
# pattern per file): 11 processes instead of ~40,000.
grep_all() { # regex -> file:line:match on stdout
  xargs -0 grep -HnEo "$1" < "$FILELIST" 2>/dev/null || true
}

for entry in "${SCAN[@]}"; do
  pid="${entry%%|*}"
  rest="${entry#*|}"
  desc="${rest%%|*}"
  re="${rest#*|}"
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    file="${hit%%:*}"
    rest_hit="${hit#*:}"
    line="${rest_hit%%:*}"
    is_allowlisted "$file" "$pid" && continue
    report "$file" "$line" "$pid" "$desc"
  done < <(grep_all "$re")
done

# JWTs are split by DECODED role rather than by a string test:
#   role=service_role -> hard fail everywhere, never allowlistable.
#   role=anon         -> pass. Anon keys ship in every client bundle by design
#                        and are governed by RLS; decoding proves it is one.
#   anything else     -> fail (a user access_token, or a token we cannot read).
# The old code ran `grep -qv supabase-demo` per FILE, which is true of any file
# with two lines — so the dev-token exemption never applied and the rule was in
# practice "every JWT fails", allowlisted file by file.
decode_role() {
  python3 - "$1" <<'PY' 2>/dev/null || true
import base64, json, sys
try:
    p = sys.argv[1].split('.')[1]
    p += '=' * (-len(p) % 4)
    print(json.loads(base64.urlsafe_b64decode(p)).get('role', '') or '')
except Exception:
    pass
PY
}

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  file="${hit%%:*}"
  rest_hit="${hit#*:}"
  line="${rest_hit%%:*}"
  token="${rest_hit#*:}"
  role="$(decode_role "$token")"
  case "$role" in
    anon) ;;
    service_role) report "$file" "$line" "jwt-service-role" "Supabase SERVICE ROLE JWT" ;;
    *)
      is_allowlisted "$file" "jwt-other" && continue
      report "$file" "$line" "jwt-other" "JWT-like token (role='${role:-unreadable}')"
      ;;
  esac
done < <(grep_all "$JWT_RE")

if [ "$FAILURES" -gt 0 ]; then
  echo ""
  echo "$FAILURES potential secret(s) found."
  echo "If a hit is a false positive, add a PATH|PATTERN_ID pair to ALLOWLIST in this file"
  echo "with a comment saying why it is safe. Never allowlist jwt-service-role."
  exit 1
fi

echo "Secret scan passed."
