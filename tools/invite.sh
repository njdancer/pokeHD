#!/usr/bin/env bash
# Makes a friend invite code (D19): `pnpm invite "for Sam"`. The code works once, for 7 days.
# Needs POKEHD_ADMIN_TOKEN, the Worker's ADMIN_TOKEN secret. Never print or commit the token.
# POKEHD_URL picks the deployment (http://localhost:5173 for `pnpm dev`, with ADMIN_TOKEN in
# apps/web/.dev.vars).
set -euo pipefail

URL="${POKEHD_URL:-https://pokehd.nick-01a.workers.dev}/api/admin/invites"
if [[ -z "${POKEHD_ADMIN_TOKEN:-}" ]]; then
  echo "POKEHD_ADMIN_TOKEN is not set (it's the Worker's ADMIN_TOKEN secret)." >&2
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
