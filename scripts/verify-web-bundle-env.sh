#!/usr/bin/env bash
# Fail if the Vite production bundle did not inline real Supabase credentials.
# Used by deploy-web.yml and preview-web.yml so local/demo keys never ship.
set -euo pipefail

shopt -s nullglob
bundles=(dist/assets/index-*.js)
if [ ${#bundles[@]} -eq 0 ]; then
  echo "::error::No dist/assets/index-*.js found. Run the web build first."
  exit 1
fi

url=$(grep -oh '__LANTERN_VITE_SUPABASE_URL__:"[^"]*"' "${bundles[@]}" | head -1 | sed 's/.*:"//;s/"//')
key=$(grep -oh '__LANTERN_VITE_SUPABASE_ANON_KEY__:"[^"]*"' "${bundles[@]}" | head -1 | sed 's/.*:"//;s/"//')

if [ -z "$url" ] || [ -z "$key" ]; then
  echo "::error::VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not inlined. Set them as repository (or environment) variables."
  exit 1
fi

case "$url" in
  *localhost*|*127.0.0.1*|*192.168.*)
    echo "::error::Bundle points at a local Supabase: $url"
    exit 1
    ;;
esac

issuer=$(python3 -c "import sys,json,base64;p=sys.argv[1].split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p)).get('iss',''))" "$key")
if [ "$issuer" != "supabase" ]; then
  echo "::error::Anon key issuer is '$issuer', expected 'supabase'. A demo/dev key is baked into the bundle."
  exit 1
fi

echo "url=$url issuer=$issuer"
