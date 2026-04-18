#!/usr/bin/env bash
# scripts/verify-no-raw-tauri.sh (D-34 bash backstop)
#
# Runs in CI even if ESLint is bypassed (--no-lint). Bans:
#   - `from '@tauri-apps/api/core'` outside src/lib/tauri/
#   - `from '@tauri-apps/api/event'` outside src/lib/events/ (and the
#     src/lib/tauri barrel which re-exports events via @/lib/events, not raw).
#
# @see .planning/phases/01-foundation/01-CONTEXT.md §D-34

set -euo pipefail

CODE=0
TMP_INVOKE="$(mktemp)"
TMP_LISTEN="$(mktemp)"
cleanup() { rm -f "$TMP_INVOKE" "$TMP_LISTEN"; }
trap cleanup EXIT

# ---- Ban: raw invoke import outside src/lib/tauri/ -------------------------
# grep -r recursively; --include restricts to TS sources; || true prevents
# `set -e` from aborting when there are zero hits.
grep -rnE "from ['\"]@tauri-apps/api/core['\"]" src/ \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -vE "^src/lib/tauri/" > "$TMP_INVOKE" || true

if [ -s "$TMP_INVOKE" ]; then
  echo "[verify-no-raw-tauri] FAIL: raw invoke import outside src/lib/tauri/"
  cat "$TMP_INVOKE"
  CODE=1
fi

# ---- Ban: raw listen import outside src/lib/events/ ------------------------
grep -rnE "from ['\"]@tauri-apps/api/event['\"]" src/ \
  --include='*.ts' --include='*.tsx' 2>/dev/null \
  | grep -vE "^src/lib/events/" > "$TMP_LISTEN" || true

if [ -s "$TMP_LISTEN" ]; then
  echo "[verify-no-raw-tauri] FAIL: raw listen import outside src/lib/events/"
  cat "$TMP_LISTEN"
  CODE=1
fi

if [ "$CODE" -eq 0 ]; then
  echo "[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths"
fi

exit "$CODE"
