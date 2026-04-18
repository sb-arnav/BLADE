---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: Phase 0 — Pre-Rebuild Audit
status: executing
last_updated: "2026-04-18T07:58:05.538Z"
progress:
  total_phases: 10
  completed_phases: 0
  total_plans: 2
  completed_plans: 0
  percent: 0
---

# STATE — BLADE Skin Rebuild (V1)

**Project:** BLADE Skin Rebuild V1
**Current Phase:** Phase 0 — Pre-Rebuild Audit
**Status:** Ready to execute
**Last Updated:** 2026-04-17

---

## Project Reference

**Core Value:** Every surface the user touches is coherent, Liquid-Glass-native, and wired end-to-end. No orphan screens, no dead buttons, no stringly-typed invokes that silently fail.

**Current Focus:** Phase 0 — reading only. Document the QuickAsk bridge, voice orb patterns, event listeners, and onboarding wiring from `src.bak/` before a single line of new code is written. Output: `.planning/RECOVERY_LOG.md`.

---

## Current Position

**Phase:** 0 — Pre-Rebuild Audit
**Plan:** None (no plans in Phase 0; it is audit-only)
**Phase Status:** Not started
**Overall Progress:**

```
[Phase 0] Pre-Rebuild Audit    ░░░░░░░░░░░░░░░░░░░░  Not started
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

- [ ] Create `.planning/RECOVERY_LOG.md` (Phase 0 output)
- [ ] Read `src.bak/src/quickask.tsx` and document bridge contract
- [ ] Audit `src.bak/` for voice orb, event listeners, onboarding patterns
- [ ] Audit all `emit_all` calls in `src-tauri/src/`
- [ ] Get Arnav review before Phase 1 begins

### Blockers

None. Phase 0 can start immediately.

---

## Session Continuity

**Last session:** 2026-04-17 — Roadmap and STATE initialized by `/gsd-roadmapper` agent.
**Next action:** Start Phase 0 Pre-Rebuild Audit — read `src.bak/src/quickask.tsx`, `src.bak/src/VoiceOrb.tsx` (or equivalent), and audit `emit_all` in Rust. Produce `RECOVERY_LOG.md`.
**Context cliff notes:**

- Backend is complete (178 Rust modules, 764 commands); this project is frontend only
- `src.bak/` is the backup of the old `src/` — read-only reference, never import from it
- Three HTML files are missing: `overlay.html`, `hud.html`, `ghost_overlay.html` — Rust crashes without them
- `src/` is currently the old frontend (not yet nuked); nuke happens at Phase 1 start
- 156 requirements, 10 phases, all mapped in ROADMAP.md

---

*State initialized: 2026-04-17*
