#!/usr/bin/env bash
# scripts/verify-motion-tokens.sh — Phase 9 Plan 09-06 (POL-01).
#
# Regression guard for Plan 09-04 motion audit. Greps src/ for rogue `transition:
# … linear …` usage — every BLADE transition MUST use one of the named easings
# from tokens.css (var(--ease-spring) / var(--ease-out) / var(--ease-smooth)).
#
# `ease-linear` is an allowed Tailwind utility class name (contains "linear" as
# part of a token, not the actual timing-function value); we filter it out.
#
# Exit: 0 on pass, 1 if any rogue linear transition found.
# Runtime: ~30ms (single grep over src/).
#
# @see .planning/phases/09-polish/09-PATTERNS.md §7
# @see .planning/phases/09-polish/09-CONTEXT.md §D-219

set -euo pipefail

# Capture rogue `transition: … linear …` — `linear` as a timing-function
# keyword. Exclude `ease-linear` (Tailwind class name, token text not value).
BAD=$(grep -rnE 'transition:[^;]*\blinear\b' src/ 2>/dev/null | grep -v 'ease-linear' || true)

if [ -n "$BAD" ]; then
  echo "[verify-motion-tokens] FAIL — rogue linear transitions found:"
  echo "$BAD"
  echo ""
  echo "Replace 'linear' with one of the named easings in src/styles/tokens.css:"
  echo "  - var(--ease-spring)  — UI entrances, card expansions"
  echo "  - var(--ease-out)     — dialog dismiss, toast exit"
  echo "  - var(--ease-smooth)  — generic continuous animation"
  exit 1
fi

echo "[verify-motion-tokens] OK — no rogue linear transitions in src/."
