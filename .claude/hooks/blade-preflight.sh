#!/bin/bash
# BLADE SessionStart pre-flight.
# Outputs to stderr (visible to Claude as context) so the session opens
# with the authority hierarchy + recent activity loaded, not consulted later.

set -e
cd "${CLAUDE_PROJECT_DIR:-/home/arnav/blade}" 2>/dev/null || exit 0

echo "" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo " BLADE — session pre-flight (authority hierarchy + recent state)" >&2
echo "═══════════════════════════════════════════════════════════════" >&2
echo "" >&2

echo "▸ AGENT_OPERATING_MODE.md — read this if not already in context." >&2
echo "  Five rules: position-first, adversarial pass, authority order," >&2
echo "  self-action on self-asks, log load-bearing positions." >&2
echo "" >&2

if [ -f VISION.md ]; then
  vlock=$(grep -i "^>.*Locked:" VISION.md 2>/dev/null | head -1 | sed 's/^> *//')
  echo "▸ VISION.md: ${vlock:-present (no lock line found)}" >&2
else
  echo "▸ VISION.md MISSING — flag to Arnav before any strategy work." >&2
fi
echo "" >&2

echo "▸ Recent commits (last 10):" >&2
git log --oneline -10 2>/dev/null | sed 's/^/    /' >&2 || echo "    (git log failed)" >&2
echo "" >&2

if [ -f .planning/STATE.md ]; then
  echo "▸ STATE.md — Current Position (5-line excerpt):" >&2
  # Pull lines between "## Current Position" and the next "## " heading,
  # drop the heading itself and blank lines, take 5, indent.
  sed -n '/^## Current Position/,/^## [^C]/p' .planning/STATE.md 2>/dev/null \
    | sed '1d; /^## /d; /^[[:space:]]*$/d' \
    | head -5 \
    | sed 's/^/    /' >&2
  echo "" >&2
fi

if [ -f .planning/decisions.md ]; then
  echo "▸ Last 3 decisions logged:" >&2
  grep -E "^## [0-9]" .planning/decisions.md 2>/dev/null | head -3 | sed 's/^/    /' >&2
  echo "" >&2
fi

echo "▸ Operating mode reminder:" >&2
echo "    - Take positions, don't offer A/B/C/D options." >&2
echo "    - Adversarial pass before send." >&2
echo "    - Log load-bearing calls to .planning/decisions.md." >&2
echo "    - Act, don't propose, when asked to fix self." >&2
echo "" >&2

exit 0
