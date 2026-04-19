#!/usr/bin/env bash
# scripts/verify-chat-rgba.sh — D-70 / SC-5 invariant (Plan 03-07 Task 2).
#
# Chat bubbles MUST use solid rgba() fills. The GPU-layer budget (D-07 cap of
# 3 backdrop-filter layers per viewport) is already consumed by the dashboard
# hero + ambient strip + nav rail; adding blur per bubble during a streaming
# burst collapses first paint (SC-5). This script is the CI backstop that
# flags any regression where someone re-introduces `backdrop-filter` into the
# chat feature's CSS.
#
# Exits 0 when no backdrop-filter property is found inside src/features/chat/
# (excluding comments that contain the word as documentation). Exits 1 otherwise.
#
# The grep pattern matches the CSS PROPERTY `backdrop-filter:` — explanatory
# comments saying "zero backdrop-filter in this file" are fine (they use the
# word in prose without a colon), and existing comments in chat.css are
# phrased as "zero GPU blur layers" per deviation #1 of Plan 03-04 SUMMARY.
#
# @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-07, §D-70
# @see src/features/chat/chat.css
# @see scripts/verify-no-raw-tauri.sh (sibling bash backstop pattern)

set -euo pipefail

CHAT_CSS_GLOB="src/features/chat"

# Collect any occurrences of the `backdrop-filter:` property in chat CSS.
# `grep -rnE` is recursive + line-numbered + extended regex. The `|| true`
# guard keeps set -e from aborting on zero matches.
HITS=$(grep -rnE "backdrop-filter\s*:" "$CHAT_CSS_GLOB" --include='*.css' 2>/dev/null || true)

if [ -n "$HITS" ]; then
  echo "[verify-chat-rgba] FAIL: backdrop-filter property detected in $CHAT_CSS_GLOB CSS"
  echo "$HITS"
  echo ""
  echo "  D-70 invariant: chat bubbles MUST use rgba() backgrounds — never backdrop-filter."
  echo "  D-07 blur cap (3 per viewport) is already consumed by NavRail / TitleBar / dashboard glass."
  exit 1
fi

echo "[verify-chat-rgba] OK — no backdrop-filter property in $CHAT_CSS_GLOB (D-70 preserved)"
exit 0
