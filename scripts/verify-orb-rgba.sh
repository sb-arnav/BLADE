#!/usr/bin/env bash
# scripts/verify-orb-rgba.sh — Phase 4 Plan 04-07 Voice Orb blur regression guard.
#
# D-07 blur-layer cap (3 per viewport) combined with D-18 (sole documented
# `backdrop-filter: blur(48px)` exception lives on `.qa-voice` in
# `src/features/quickask/quickask.css` ONLY) imply the Voice Orb renderer must
# not introduce any backdrop-filter on its core visual elements (the rings,
# arcs, core, or overlay wrapper). Adding blur to those surfaces re-runs the
# GPU-expensive shader every rAF tick and wrecks SC-2's ≥60fps budget on
# integrated GPUs.
#
# This script fails CI if `backdrop-filter` appears on ANY of the orb's
# visual rule selectors:
#   .orb-overlay, .orb-rings, .orb-arcs, .orb-core, .orb-compact, .ring, .arc
# The mic-error toast (`.orb-mic-error`) — a transient banner shown only on
# microphone permission-denied — is allowed to retain its 12px blur because
# it is not in the rAF render path (appears ≤ once per session on failure).
#
# @see .planning/phases/01-foundation/01-CONTEXT.md §D-07
# @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-18, §D-103, §SC-2
# @see src/features/voice-orb/orb.css
# @see scripts/verify-chat-rgba.sh (Phase 3 sibling — same pattern for chat)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORB_DIR="$ROOT_DIR/src/features/voice-orb"

if [ ! -d "$ORB_DIR" ]; then
  echo "[verify-orb-rgba] FAIL — voice-orb directory missing: $ORB_DIR"
  exit 1
fi

# Collect all css files under the orb module.
mapfile -t CSS_FILES < <(find "$ORB_DIR" -type f -name '*.css' | sort)

if [ "${#CSS_FILES[@]}" -eq 0 ]; then
  echo "[verify-orb-rgba] WARN — no CSS files under $ORB_DIR; nothing to check."
  exit 0
fi

# Collect every selector block that contains `backdrop-filter:` and then
# filter out the allowlisted `.orb-mic-error` selector. Any hit on an orb
# visual surface is a regression.
FAIL=0
VIOLATIONS=""
for f in "${CSS_FILES[@]}"; do
  # Use awk to emit "file:lineno:selector::backdrop-filter-line" so downstream
  # grep can filter by selector.
  hits=$(awk '
    /^[[:space:]]*\.[a-zA-Z][a-zA-Z0-9_-]*[^{]*\{/ { sel = $0 }
    /backdrop-filter[[:space:]]*:/ {
      # Normalise whitespace in the recorded selector for the report.
      s = sel; gsub(/^[[:space:]]+|[[:space:]]+$/, "", s);
      print FILENAME ":" NR ":" s ":: " $0
    }
  ' "$f" || true)

  if [ -z "$hits" ]; then
    continue
  fi

  # Filter out .orb-mic-error (allowed — rare error banner, not rAF path).
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # The selector portion is between the 3rd colon-separator and the '::'.
    # Simpler: skip if the line's recorded selector contains '.orb-mic-error'.
    if echo "$line" | grep -q "\.orb-mic-error"; then
      continue
    fi
    VIOLATIONS="$VIOLATIONS"$'\n'"$line"
    FAIL=1
  done <<< "$hits"
done

if [ "$FAIL" = "1" ]; then
  echo "[verify-orb-rgba] FAIL — backdrop-filter found on Voice Orb rendering surface (D-07 / SC-2 violation):"
  echo "$VIOLATIONS"
  echo ""
  echo "  D-18 restricts backdrop-filter: blur(48px) to .qa-voice in src/features/quickask/quickask.css ONLY."
  echo "  D-07 caps blur layers; adding blur to orb visuals collapses ≥60fps SC-2 budget on integrated GPU."
  echo "  If this selector is intentionally exempt (e.g. a rare error banner),"
  echo "  extend the allowlist in scripts/verify-orb-rgba.sh."
  exit 1
fi

echo "[verify-orb-rgba] OK — no backdrop-filter on orb visual surfaces (D-07/D-18/SC-2 preserved)."
exit 0
