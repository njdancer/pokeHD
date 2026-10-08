#!/usr/bin/env bash
# Adds a friend (D23): `pnpm invite sam@example.com Sam [--send]`. Prints a sign-in link that
# works once, for 7 days; with --send, Email Service emails it to them too. After that they sign
# in with their email. Nick can do the same from the game (Settings, Friends) or /login.
# Needs the Worker's ADMIN_TOKEN secret, from POKEHD_ADMIN_TOKEN or ~/.config/pokehd/admin-token
# (where it was generated on Nick's Mac). Never print or commit the token.
# POKEHD_URL picks the deployment (http://localhost:5173 for `pnpm dev`, with ADMIN_TOKEN in
# apps/web/.dev.vars).
set -euo pipefail

URL="${POKEHD_URL:-https://pokehd.nick-01a.workers.dev}/api/admin/players"
TOKEN_FILE="$HOME/.config/pokehd/admin-token"
if [[ -z "${POKEHD_ADMIN_TOKEN:-}" && -f "$TOKEN_FILE" ]]; then
  POKEHD_ADMIN_TOKEN=$(<"$TOKEN_FILE")
fi
if [[ -z "${POKEHD_ADMIN_TOKEN:-}" ]]; then
  echo "No admin token: set POKEHD_ADMIN_TOKEN or put it in $TOKEN_FILE." >&2
  exit 1
fi
if [[ $# -lt 2 ]]; then
  echo "Usage: pnpm invite <email> <name> [--send]" >&2
  exit 1
fi

send=false
[[ "${3:-}" == "--send" ]] && send=true
body=$(node -e 'console.log(JSON.stringify({ email: process.argv[1], name: process.argv[2], send: process.argv[3] === "true" }))' "$1" "$2" "$send")
# The admin routes answer 404 to a wrong token, so a 404 here usually means that.
response=$(curl -sS -X POST "$URL" \
  -H "authorization: Bearer $POKEHD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data "$body")
node -e 'const r = JSON.parse(process.argv[1]);
  if (r.error) { console.error(`Not added: ${r.error}`); process.exit(1); }
  console.log(r.link);
  console.log(`Works once, until ${new Date(r.expiresAt).toISOString().slice(0, 16)}Z.${r.sent ? " Emailed." : ""}`);' \
  "$response"
