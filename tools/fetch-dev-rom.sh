#!/usr/bin/env bash
# Downloads Nick's test ROM into rom/pokeblue.gb for agents and sandboxes that don't have it.
# Needs POKEHD_DEV_ROM_TOKEN (the same token as the #dev=… link). Never print or commit the token.
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED="d7037c83e1ae5b39bde3c30787637ba1d4c48ce2"
OUT="rom/pokeblue.gb"
URL="${POKEHD_URL:-https://pokehd.nick-01a.workers.dev}/api/dev-rom"

if [[ -f "$OUT" ]] && [[ "$(shasum "$OUT" | cut -d' ' -f1)" == "$EXPECTED" ]]; then
  echo "rom/pokeblue.gb already present and verified."
  exit 0
fi
if [[ -z "${POKEHD_DEV_ROM_TOKEN:-}" ]]; then
  echo "POKEHD_DEV_ROM_TOKEN is not set; ask Nick to add it to this environment." >&2
  exit 1
fi

mkdir -p rom
curl -fsS -H "authorization: Bearer ${POKEHD_DEV_ROM_TOKEN}" "$URL" -o "$OUT.tmp"
if [[ "$(shasum "$OUT.tmp" | cut -d' ' -f1)" != "$EXPECTED" ]]; then
  rm -f "$OUT.tmp"
  echo "Downloaded ROM failed the SHA-1 check." >&2
  exit 1
fi
mv "$OUT.tmp" "$OUT"
echo "rom/pokeblue.gb downloaded and verified."
