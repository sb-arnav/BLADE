---
phase: 12-smart-deep-scan
plan: "05"
status: deferred
created: 2026-04-24
thresholds_met: false
notes: "Manual cold-install trace deferred — cannot run app during current execution session. To be completed when Arnav can run 'npm run tauri dev' and execute the trace."
---

# Phase 12 Plan 05: Cold-Install Trace (DEFERRED)

## Status

**DEFERRED — pending manual testing session**

This trace file is a placeholder. The code is complete and wired. The trace must be run manually when the app can be started.

## What needs to be done

1. Start the app: `npm run tauri dev`
2. Open the **Profile page** (identity sidebar → "Profile")
3. Click **"Run first scan"**
4. Wait for `complete` event — note elapsed time
5. Run in DevTools: `await window.__TAURI__.invoke('profile_get_rendered')`
6. Record these counts:

| Threshold | Required | Actual |
|-----------|----------|--------|
| `repos.length` | ≥10 | TBD |
| `accounts.length` | ≥5 | TBD |
| `rhythm_signals.length` | ≥3 | TBD |
| IDE/AI tool rows | ≥3 | TBD |
| `elapsed_ms` | ≤120,000 | TBD |

7. Paste raw counts and JSON excerpt below, then delete this deferred notice.

## Raw Output

*(pending)*
