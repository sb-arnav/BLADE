---
phase: 00-pre-rebuild-audit
plan: 01
subsystem: audit
tags: [tauri, rust, typescript, liquid-glass, voice-orb, quickask, onboarding]

# Dependency graph
requires: []
provides:
  - Backend contract map (764 commands, event catalog, WIRE gaps identified)
  - emit_all classification table (247 sites, D-14 compliance verdict per site)
  - Prototype-to-flow contracts for all 11 design screens
  - Liquid Glass token reference (C.1–C.5)
  - OpenClaw orb phase math documented verbatim
  - Ghost card format spec (D-10)
  - QuickAsk bridge contract (D-11, WIRE-01 flagged)
  - Backdrop-filter budget audit (D-07 compliance table)
  - Navigation graph across all 5 Tauri windows
  - 3 missing HTML entry files confirmed (overlay, hud, ghost_overlay)
affects:
  - 00-pre-rebuild-audit/00-02 (Wave 2 synthesis — RECOVERY_LOG.md)
  - phase-01-foundation (useTauriEvent hook, HTML file creation, route registry)
  - phase-02-onboarding (onboarding contract from BACKEND-EXTRACT)
  - phase-03-dashboard-chat (streaming event wiring, WIRE-01–WIRE-08)
  - phase-04-overlay-windows (voice orb phase math, quickask bridge)

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md
    - .planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md
    - .planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md
  modified: []

key-decisions:
  - "D-17: src.bak is dead reference — backend + prototypes are canonical audit sources"
  - "D-18: Hybrid execution (direct extraction, no nested subagents) — all source material in context"
  - "D-19: PROTO-FLOW covers token extraction; RECOVERY_LOG.md produced in Wave 2 only"
  - "WIRE-01 confirmed: quickask_submit command and blade_quickask_bridged event are missing from Rust"
  - "WIRE-02 confirmed: homeostasis emits homeostasis_update not hormone_update — rename needed in Phase 3"
  - "Ghost card format locked: ≤6-word headline, 1-2 bullets, ≤60 chars/line (D-10 confirmed from prototype)"
  - "QuickAsk-voice uses blur(48px) — documented as intentional override (sole backdrop-filter on screen)"

patterns-established:
  - "Extraction artifacts are intermediate; do not produce RECOVERY_LOG.md in Wave 1"
  - "Acceptance criteria verified by line count + grep before commit"

requirements-completed: []

# Metrics
duration: ~60min
completed: 2026-04-18
---

# Phase 00, Plan 01: Pre-Rebuild Audit Wave 1 Summary

**Backend contract, emit_all audit, and prototype flow contracts extracted for all 11 design screens — Wave 2 synthesis inputs complete**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-04-18T08:00Z
- **Completed:** 2026-04-18T09:00Z
- **Tasks:** 3 (1.1 BACKEND-EXTRACT, 1.2 EMIT-AUDIT, 1.3 PROTO-FLOW)
- **Files created:** 3

## Accomplishments

- Mined all 5 key backend modules (`commands.rs`, `voice_global.rs`, `wake_word.rs`, `homeostasis.rs`, `config.rs`) for command signatures, event catalog, and WIRE gaps. 316-line output.
- Classified all 247 emit sites in the Rust codebase against D-14 policy (emit_all vs emit_to). Proposed replacements per window label. 338-line output with 314 table rows.
- Documented all 11 HTML prototypes as user-flow contracts with backend wiring requirements, navigation graph, backdrop-filter budget, and full Liquid Glass token extraction. 812-line output.

## Task Commits

1. **Tasks 1.1 + 1.2 + 1.3 (atomic)** — `c6957a1` (audit: Wave 1 extraction artifacts)

## Files Created

- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — Backend contract (316 lines)
- `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` — Emit audit (338 lines, 247 sites)
- `.planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md` — Prototype flows (812 lines, 11 screens)

## Decisions Made

- Performed direct extraction (read source files inline) rather than dispatching nested subagents — all material was already accessible and subagent overhead was unnecessary.
- All three files committed atomically in a single commit; acceptance criteria verified by line count + grep before commit.

## Deviations from Plan

None — plan executed as specified. Three tasks produced, acceptance criteria all pass.

## Issues Encountered

- `commands.rs` (2485 lines) exceeded single-read limit — solved by reading in 500-line chunks and targeting specific patterns with Grep.
- The emit grep produced 247 sites; piped to temp file and read back for full classification.

## User Setup Required

None.

## Next Phase Readiness

Wave 2 (Plan 00-02) can begin immediately:
- Inputs: BACKEND-EXTRACT.md, EMIT-AUDIT.md, PROTO-FLOW.md (all present)
- Output target: `.planning/RECOVERY_LOG.md` (master pre-rebuild contract)
- Blockers: None

Key findings for Phase 1 (Foundation):
- 3 HTML entry files missing: `overlay.html`, `hud.html`, `ghost_overlay.html` — must be created Day 1 (P-05)
- WIRE-01: `quickask_submit` + `blade_quickask_bridged` need to be added to Rust in Phase 3
- WIRE-02: `homeostasis_update` rename to `hormone_update` needed in Phase 3
- D-07 compliance: dashboard, dashboard-chat, and settings are all at 3/3 backdrop-filter budget — no additional layers can be added without removing one

---
*Phase: 00-pre-rebuild-audit*
*Plan: 01*
*Completed: 2026-04-18*
