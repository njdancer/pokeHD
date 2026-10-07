#!/usr/bin/env bash
# Makes a friend invite code (D19): `pnpm invite "for Sam"`. The code works once, for 7 days.
# Needs the Worker's ADMIN_TOKEN secret, from POKEHD_ADMIN_TOKEN or ~/.config/pokehd/admin-token
# (where it was generated on Nick's Mac). Never print or commit the token.
# POKEHD_URL picks the deployment (http://localhost:5173 for `pnpm dev`, with ADMIN_TOKEN in
# apps/web/.dev.vars).
set -euo pipefail

URL="${POKEHD_URL:-https://pokehd.nick-01a.workers.dev}/api/admin/invites"
TOKEN_FILE="$HOME/.config/pokehd/admin-token"
if [[ -z "${POKEHD_ADMIN_TOKEN:-}" && -f "$TOKEN_FILE" ]]; then
  POKEHD_ADMIN_TOKEN=$(<"$TOKEN_FILE")
fi
if [[ -z "${POKEHD_ADMIN_TOKEN:-}" ]]; then
  echo "No admin token: set POKEHD_ADMIN_TOKEN or put it in $TOKEN_FILE." >&2
  exit 1
fi

note="${1:-}"
body=$(node -e 'console.log(JSON.stringify({ note: process.argv[1] }))' "$note")
# The admin routes answer 404 to a wrong token, so a 404 here usually means that.
response=$(curl -fsS -X POST "$URL" \
  -H "authorization: Bearer $POKEHD_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data "$body")
node -e 'const { code, expiresAt } = JSON.parse(process.argv[1]);
  console.log(`${code}  (works once, until ${new Date(expiresAt).toISOString().slice(0, 16)}Z)`);' \
  "$response"
