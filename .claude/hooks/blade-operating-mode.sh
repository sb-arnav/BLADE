#!/bin/bash
# BLADE UserPromptSubmit hook.
# Fires when the prompt contains strategy / milestone / vision keywords.
# Injects the operating mode so Claude can't drift mid-conversation.
#
# Uses python3 (always present) instead of jq (not installed on WSL host).

PROMPT=$(python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get("prompt", ""))
except Exception:
    pass
' 2>/dev/null)

# Pattern: strategic / planning / vision / milestone work
if echo "$PROMPT" | grep -iqE 'vision|milestone|phase|roadmap|narrowing|primitive|forge|v1\.[0-9]|v2\.[0-9]|/gsd-|strategy|architecture|decision|position'; then
  cat <<'EOF'

[BLADE OPERATING MODE — load-bearing prompt detected]

Before responding, verify:
1. VISION.md (root, locked 2026-05-10) + .planning/PROJECT.md + STATE.md + git log -15 all read.
2. ONE position with evidence — not 2-4 options for Arnav to pick.
3. Adversarial pass: what would defeat this? Address it in the response or in decisions.md.
4. Load-bearing? → log to .planning/decisions.md with falsification condition.
5. Asked to fix self / configure mode / make smarter? → DO IT, don't propose 4 options.

Full mode: AGENT_OPERATING_MODE.md

EOF
fi

exit 0
