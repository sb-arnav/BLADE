---
phase: 13-self-configuring-ecosystem
plan: "03"
status: PARTIAL
subsystem: verify/ecosystem
tags: [verify-script, guardrail, observe-only, package-json, ecosys-09, ecosys-10]
dependency_graph:
  requires:
    - ecosystem.rs (13-01)
    - EcosystemPane.tsx (13-02)
  provides:
    - scripts/verify-ecosystem-guardrail.mjs
    - package.json verify:ecosystem-guardrail script
    - package.json verify:all chain (appended)
  affects:
    - package.json
tech_stack:
  added: []
  patterns:
    - Node.js ESM verify script pattern (consistent with all other scripts/verify-*.mjs)
key_files:
  created:
    - scripts/verify-ecosystem-guardrail.mjs
  modified:
    - package.json
decisions:
  - "Script uses existsSync early-exit on ecosystem.rs absence to avoid misleading cascade failures"
  - "Check 3 (store(false) absent) is an invariant check, not a behavior check — guards against future accidental removal of the guardrail"
metrics:
  duration: "3m"
  completed_date: "2026-04-24"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 1
  files_deleted: 0
---

# Phase 13 Plan 03: Ecosystem Guardrail Verify Script — PARTIAL SUMMARY

**One-liner:** 8-check ESM verify script gates the OBSERVE_ONLY guardrail + wiring invariants; appended to verify:all; Task 2 (ECOSYS-10 cold-install trace) deferred for manual verification.

**NOTE: This summary is PARTIAL. Task 2 (human checkpoint) is pending.**

## What Was Built

### Task 1: verify-ecosystem-guardrail.mjs + package.json (COMPLETE)

New `scripts/verify-ecosystem-guardrail.mjs` (108 LOC) with 8 checks:

| Check | Pattern | Result |
|-------|---------|--------|
| 1 | `OBSERVE_ONLY: AtomicBool = AtomicBool::new(true)` in ecosystem.rs | PASS |
| 2 | `pub fn assert_observe_only_allowed` defined | PASS |
| 3 | `OBSERVE_ONLY.store(false)` absent (v1.1 invariant) | PASS |
| 4 | `ecosystem_observe_only_check` in lib.rs | PASS |
| 5 | `mod ecosystem;` in lib.rs | PASS |
| 6 | `ecosystem::auto_enable_from_scan` in deep_scan/mod.rs | PASS |
| 7 | `ecosystem_tentacles` >= 6 occurrences in config.rs (found: 11) | PASS |
| 8 | `EcosystemPane.tsx` exists with "Observe only" badge text | PASS |

`package.json` updated:
- Added `"verify:ecosystem-guardrail": "node scripts/verify-ecosystem-guardrail.mjs"` script
- Appended `&& npm run verify:ecosystem-guardrail` to `verify:all` chain

Script exits 0 against current Phase 13 codebase.

### Task 2: Cold-Install Trace — ECOSYS-10 (PENDING MANUAL CHECKPOINT)

Deferred placeholder at `.planning/phases/13-self-configuring-ecosystem/13-03-TRACE.md`.

**Requirement:** Cold install + Phase 12 deep scan -> >= 5 observer tentacles auto-enable in Settings -> Ecosystem with rationale strings, all toggleable, disabled state persists across restart.

**Expected tentacles on Arnav's machine:**
- `repo_watcher` (guaranteed — Phase 12 scan found 14+ repos)
- `pr_watcher` (likely — gh CLI in TOOLS list)
- `session_bridge` (likely — ~/.claude/projects/ exists)
- `deploy_monitor` (likely — vercel in TOOLS list)
- `slack_monitor` or `calendar_monitor` (either satisfies >= 5)

## Deviations from Plan

None — Task 1 executed exactly as written.

## Known Stubs

None in Task 1 scope.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The verify script reads source files only — no writes, no exec.

## Self-Check

### Files exist:
- [x] `scripts/verify-ecosystem-guardrail.mjs`
- [x] `package.json` (modified — 2 occurrences of verify:ecosystem-guardrail confirmed)
- [x] `.planning/phases/13-self-configuring-ecosystem/13-03-TRACE.md` (deferred placeholder)

### Commits exist:
- [x] a9aa89d — feat(13-03): verify-ecosystem-guardrail gate + package.json

## Self-Check: PASSED (Task 1)
