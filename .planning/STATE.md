---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: "00-pre-rebuild-audit"
status: executing
last_updated: "2026-04-18T09:00:00.000Z"
progress:
  total_phases: 10
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
  percent: 5
---

# STATE — BLADE Skin Rebuild (V1)

**Project:** BLADE Skin Rebuild V1
**Current Phase:** 00-pre-rebuild-audit
**Status:** Executing Phase 00 — Plan 01 complete, Plan 02 (Wave 2) pending
**Last Updated:** 2026-04-18

---

## Project Reference

**Core Value:** Every surface the user touches is coherent, Liquid-Glass-native, and wired end-to-end. No orphan screens, no dead buttons, no stringly-typed invokes that silently fail.

**Current Focus:** Phase null

---

## Current Position

Phase: 00 — EXECUTING
Plan: 2 of 2
**Phase:** 0 — Pre-Rebuild Audit
**Plan:** 01 complete (Wave 1 extractions). Plan 02 (Wave 2: RECOVERY_LOG synthesis) — not started.
**Phase Status:** In progress (50% — 1 of 2 plans complete)
**Overall Progress:**

```
[Phase 0] Pre-Rebuild Audit    ██████████░░░░░░░░░░  50% (Plan 01 done)
[Phase 1] Foundation           ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 2] Onboarding + Shell   ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 3] Dashboard+Chat+Set   ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 4] Overlay Windows      ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 5] Agents + Knowledge   ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 6] Life OS + Identity   ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 7] Dev Tools + Admin    ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 8] Body + Hive          ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 9] Polish Pass          ░░░░░░░░░░░░░░░░░░░░  Not started
```

---

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Requirements mapped | 156/156 | 156/156 ✓ |
| Phases complete | 10 | 0 |
| Routes rebuilt | 59 | 0 |
| Typed wrapper coverage | 764 commands | 0 |
| HTML entries created | 5 | 2 (index.html, quickask.html) |

---

## Accumulated Context

### Key Decisions Locked

- D-01: Self-built 8 primitives, no shadcn/Radix
- D-02: CSS-only motion, no Framer Motion
- D-03: Hand-written Tauri wrappers in `src/lib/tauri/`
- D-04: `useChat` hook + ConfigContext, no Zustand
- D-05: Custom route registry, no React Router
- D-06: window-vibrancy for window chrome; CSS backdrop-filter for in-DOM panels
- D-07: Max 3 backdrop-filter per viewport; blur caps 20/12/8px
- D-08: OpenClaw animation math applied verbatim to VoiceOrb
- D-09: Ghost Mode `.content_protected(true)` at creation time; no cursor CSS
- D-10: Ghost card format ≤6-word headline, 1-2 bullets, ≤60 chars/line
- D-11: QuickAsk → Main bridge via `quickask_submit` invoke → `blade_quickask_bridged` event
- D-12: Single `blade_prefs_v1` localStorage blob; `usePrefs()` hook reads once
- D-13: `useTauriEvent` hook is the only permitted event subscription pattern
- D-14: `emit_to(window_label, ...)` for single-window; `emit_all` for cross-window only
- D-15: No light theme; single Liquid Glass dark treatment
- D-16: Token compaction at ratio > 0.65; frontend shows `blade_token_ratio` indicator
- D-17: src.bak is dead reference — backend + prototypes are canonical audit sources (Phase 0 confirmed)
- D-18: QuickAsk-voice uses blur(48px) — intentional override; sole backdrop-filter layer on that screen
- D-19: homeostasis emits `homeostasis_update` (not `hormone_update`) — rename WIRE-02 deferred to Phase 3

### Phase Gate Requirements (Phase 1 must pass ALL of these)

- **P-01**: Dashboard first paint ≤ 200ms on integrated GPU; max 3 backdrop-filter per viewport
- **P-02**: QuickAsk → Main bridge documented (from RECOVERY_LOG.md); contract explicit before QuickAsk phase
- **P-03**: Migration ledger tracking all 59 routes; no route removed before replacement ships
- **P-04**: Typed wrapper smoke-tested; snake_case arg keys confirmed at Rust entry point
- **P-05**: All 5 HTML files created Day 1; CI check validates Vite input/HTML file alignment
- **P-06**: `useTauriEvent` hook built before any component; listener leak test passing

### Backend Wiring Gaps (WIRE category)

| Gap | Location | Phase |
|-----|----------|-------|
| `quickask_submit` command | `commands.rs` | Phase 3 (stub) + Phase 4 (test) |
| `hormone_update` event | `homeostasis.rs` | Phase 3 |
| `blade_message_start` event | `commands.rs` | Phase 3 |
| `blade_thinking_chunk` event | `commands.rs` | Phase 3 |
| `blade_agent_event` event | `swarm.rs` / `agents/executor.rs` | Phase 3 (emit) + Phase 5 (consume) |
| `blade_token_ratio` event | `commands.rs` | Phase 3 |
| VAD in `audio_timeline.rs` | `audio_timeline.rs` | Phase 4 |
| `emit_all` audit + refactor | Rust codebase-wide | Phase 1 |

### Active Todos

- [x] Audit all `emit_all` calls in `src-tauri/src/` — DONE (00-EMIT-AUDIT.md, 247 sites classified)
- [x] Document backend contracts (commands, events, WIRE gaps) — DONE (00-BACKEND-EXTRACT.md)
- [x] Map all 11 prototypes to flow contracts — DONE (00-PROTO-FLOW.md)
- [ ] Create `.planning/RECOVERY_LOG.md` (Phase 0 Plan 02 — Wave 2 synthesis)
- [ ] Get Arnav review before Phase 1 begins

### Blockers

None. Plan 02 (Wave 2 synthesis → RECOVERY_LOG.md) can start immediately.

---

## Session Continuity

**Last session:** 2026-04-18 — GSD executor ran Plan 00-01 (Wave 1 extractions). All 3 artifacts produced and committed (c6957a1).
**Next action:** Run Plan 00-02 — synthesize BACKEND-EXTRACT.md + EMIT-AUDIT.md + PROTO-FLOW.md into `.planning/RECOVERY_LOG.md`. Then get Arnav sign-off before Phase 1.
**Context cliff notes:**

- Backend is complete (178 Rust modules, 764 commands); this project is frontend only
- Three HTML files are missing: `overlay.html`, `hud.html`, `ghost_overlay.html` — Rust crashes without them (P-05)
- WIRE-01: `quickask_submit` command + `blade_quickask_bridged` event missing from Rust — Phase 3 stub
- WIRE-02: `homeostasis_update` event needs rename to `hormone_update` — Phase 3
- `src/` is currently the old frontend (not yet nuked); nuke happens at Phase 1 start
- 156 requirements, 10 phases, all mapped in ROADMAP.md
- Wave 1 artifacts: `.planning/phases/00-pre-rebuild-audit/` — BACKEND-EXTRACT, EMIT-AUDIT, PROTO-FLOW

---

*State initialized: 2026-04-17 | Last updated: 2026-04-18*
