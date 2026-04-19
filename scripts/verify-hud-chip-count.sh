#!/usr/bin/env bash
# scripts/verify-hud-chip-count.sh — Phase 4 Plan 04-07 HUD-02 regression guard.
#
# HUD-02: the HUD bar renders 5 chips (time / active-app / god-mode / hormone
# / meeting). The first three chips are static spans with `className="hud-chip
# hud-time|hud-app|hud-god"` in src/features/hud/HudWindow.tsx. The fourth
# chip is the HormoneChip (which renders its own `.hormone-chip` class, not
# `.hud-chip`) and the fifth is the meeting chip (`.hud-chip hud-meet`),
# conditionally rendered.
#
# This guard pins the count of LITERAL `"hud-chip ..."` className strings in
# HudWindow.tsx so that adding a 6th chip — or accidentally removing one of
# the 5 during a refactor — fails CI before it lands.
#
# Expected count: 4 class-name expressions of the form `className="hud-chip
# hud-*"`. (The 4 are: hud-time, hud-app, hud-god, hud-meet. HormoneChip is
# NOT counted here because it uses its own CSS class.)
#
# @see src/features/hud/HudWindow.tsx
# @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-113 (5-chip layout)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HUD_WINDOW="$ROOT_DIR/src/features/hud/HudWindow.tsx"
EXPECTED=4

if [ ! -f "$HUD_WINDOW" ]; then
  echo "[verify-hud-chip-count] FAIL — missing $HUD_WINDOW"
  exit 1
fi

# Count distinct occurrences of `hud-chip hud-` classNames. The full match
# pattern lets `hud-chip hud-god"` and `hud-chip hud-god"` (from multi-line
# JSX) both count once per occurrence.
ACTUAL=$(grep -cE 'hud-chip hud-[a-z]+' "$HUD_WINDOW" || true)

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "[verify-hud-chip-count] FAIL — expected exactly ${EXPECTED} \`hud-chip hud-*\` className occurrences in HudWindow.tsx; found ${ACTUAL}."
  echo ""
  grep -nE 'hud-chip hud-[a-z]+' "$HUD_WINDOW" || true
  echo ""
  echo "  HUD-02 (D-113) fixes the chip count at 5 visible chips: time, app, god-mode, hormone, meeting."
  echo "  Four of those use \`hud-chip hud-*\` (time / app / god / meet); the fifth (hormone) uses"
  echo "  \`.hormone-chip\` via HormoneChip primitive, which is NOT counted here."
  echo "  If you intentionally add / remove a \`hud-chip\` row, update EXPECTED in this script."
  exit 1
fi

echo "[verify-hud-chip-count] OK — \`hud-chip hud-*\` className count is exactly ${EXPECTED} (HUD-02 preserved)."
exit 0
