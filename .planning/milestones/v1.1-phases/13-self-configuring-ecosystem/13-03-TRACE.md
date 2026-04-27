---
status: deferred
requirement: ECOSYS-10
plan: 13-03
task: 2
checkpoint_type: human-verify
---

# ECOSYS-10 Cold-Install Trace — Deferred

**Status:** Pending manual verification by Arnav.

## What to verify

1. Run BLADE in dev mode: `npm run tauri dev`
2. Complete onboarding (paste any valid API key)
3. Trigger a deep scan: Settings -> Privacy -> "Re-scan" button
4. Wait for scan completion (~30-90 seconds) — watch for `[ecosystem] auto_enable_from_scan` log lines
5. Navigate to Settings -> Ecosystem
6. Confirm:
   - At least 5 tentacle rows are visible
   - Each row shows a rationale string in italic
   - Each row has a working toggle checkbox
   - Disable one tentacle (e.g. repo_watcher) — it turns grey/dimmed
   - Restart BLADE — the disabled tentacle stays OFF
   - "Observe only (v1.1)" badge visible above the list
7. Run: `npm run verify:ecosystem-guardrail` — should exit 0
8. Run: `npm run verify:all` — should exit 0

## Resume signal

Reply "approved" if >= 5 tentacles auto-enabled with rationale and disabled state persists.
Reply "skip-10" if running in a minimal environment where probes cannot detect >= 5 services.
