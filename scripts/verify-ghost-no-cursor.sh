#!/usr/bin/env bash
# scripts/verify-ghost-no-cursor.sh — Phase 4 Plan 04-07 D-09 regression guard.
#
# D-09 (locked Phase 1): the Ghost overlay MUST NOT set any `cursor:` CSS
# property — neither in the feature module (src/features/ghost/**) nor in the
# window bootstrap (src/windows/ghost/**). The Ghost window is
# content-protected at the Rust layer (ghost_mode.rs:481
# `.content_protected(true)`); the frontend surface must stay purely visual so
# nothing about pointer affordance hints at the protected window boundary.
#
# This script fails CI if ANY `cursor:` property appears under either tree.
# Comments that happen to contain the word "cursor" without a `:` are fine —
# the grep pattern requires the property colon so prose doesn't false-trigger.
#
# @see .planning/phases/01-foundation/01-CONTEXT.md §D-09
# @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-110
# @see scripts/verify-no-raw-tauri.sh (sibling bash-backstop pattern)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FEATURE_DIR="$ROOT_DIR/src/features/ghost"
WINDOW_DIR="$ROOT_DIR/src/windows/ghost"

MATCHES=""
for target in "$FEATURE_DIR" "$WINDOW_DIR"; do
  if [ -d "$target" ]; then
    hits=$(grep -rnE "cursor[[:space:]]*:" "$target" 2>/dev/null || true)
    if [ -n "$hits" ]; then
      MATCHES="$MATCHES"$'\n'"$hits"
    fi
  fi
done

if [ -n "$MATCHES" ]; then
  echo "[verify-ghost-no-cursor] FAIL — cursor CSS property found in ghost module (D-09 violation):"
  echo "$MATCHES"
  exit 1
fi

echo "[verify-ghost-no-cursor] OK — no cursor property in src/features/ghost/** or src/windows/ghost/** (D-09 preserved)."
exit 0
