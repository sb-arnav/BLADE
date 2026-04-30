#!/usr/bin/env bash
# BLADE UAT-evidence guard (Stop hook).
#
# Why this exists:
#   v1.1 closed with 27 verify gates green and tsc --noEmit clean. The running
#   app was actually broken — chat didn't render replies despite the API firing.
#   Static gates ≠ working app. This hook scans the recent transcript for
#   "done"-claims paired with absence of UAT evidence and prints a reminder
#   to stderr so Claude sees it before stopping.
#
# Behavior:
#   - Reads stop-hook JSON from stdin.
#   - Skips itself if stop_hook_active is already set (avoids recursion).
#   - Tails the transcript JSONL for keyword evidence (regex; no jq dep).
#   - Soft warn only: always exits 0. Never deadlocks Claude.
#
# To extend the keyword lists: edit DONE_RE and EVIDENCE_RE below.

INPUT=$(cat 2>/dev/null || echo '{}')

# Avoid recursion when this hook itself triggered another stop.
case "$INPUT" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

# Extract transcript_path with a tiny python helper (more robust than awk on JSON).
TRANSCRIPT=$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    print(json.load(sys.stdin).get("transcript_path", ""))
except Exception:
    print("")
' 2>/dev/null)

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Tail the most recent slice of the transcript. Enough to catch the current
# response + the last few tool calls without scanning the whole session.
TAIL=$(tail -n 250 "$TRANSCRIPT" 2>/dev/null || echo "")
if [ -z "$TAIL" ]; then
  exit 0
fi

DONE_RE='shipped|milestone[[:space:]]+closed|fully[[:space:]]+verified|ready[[:space:]]+to[[:space:]]+merge|all[[:space:]]+green|ready[[:space:]]+to[[:space:]]+ship|fully[[:space:]]+implemented|task[[:space:]]+complete|verified[[:space:]]+passed|phase[[:space:]]+complete|MILESTONE[[:space:]]+INITIALIZED'
EVIDENCE_RE='tauri[[:space:]]+dev|npm[[:space:]]+run[[:space:]]+dev|npm[[:space:]]+run[[:space:]]+tauri|playwright|test:e2e|webview|chrome-devtools|cdp|screenshot|\.png|browser_take_screenshot|browser_navigate'

DONE_HITS=$(printf '%s' "$TAIL" | grep -ciE "$DONE_RE" 2>/dev/null || echo 0)
EVIDENCE_HITS=$(printf '%s' "$TAIL" | grep -ciE "$EVIDENCE_RE" 2>/dev/null || echo 0)

# Strip any whitespace in case grep -c returned something exotic on this shell.
DONE_HITS=$(printf '%s' "$DONE_HITS" | tr -d '[:space:]')
EVIDENCE_HITS=$(printf '%s' "$EVIDENCE_HITS" | tr -d '[:space:]')

# Bail if we couldn't parse the counts.
case "$DONE_HITS" in ''|*[!0-9]*) exit 0 ;; esac
case "$EVIDENCE_HITS" in ''|*[!0-9]*) exit 0 ;; esac

if [ "$DONE_HITS" -gt 0 ] && [ "$EVIDENCE_HITS" -eq 0 ]; then
  cat >&2 <<'WARN'
━━━ BLADE UAT REMINDER ━━━
Heuristic detected a "done / shipped / verified / milestone closed" claim in
the recent transcript with NO evidence of dev-server smoke or UI screenshot
in this session.

v1.1 closed with 27 gates green while the chat was actually broken. Static
gates (tsc, cargo check, lints) don't catch runtime regressions.

Before stopping with a "done" claim on UI/runtime work:
  1. npm run tauri dev   (kills port 1420 first)
  2. Wait ~8s for dashboard
  3. Take a screenshot or run npx playwright test
  4. Read the screenshot back, cite it in the response

If this is research / planning / spec-only work, ignore — keyword false-positive.
━━━━━━━━━━━━━━━━━━━━━━━━
WARN
fi

exit 0
