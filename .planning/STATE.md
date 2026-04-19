---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: "07-dev-tools-admin"
status: awaiting-mac-operator-smoke-checkpoints
last_updated: "2026-04-19T16:00:00.000Z"
progress:
  total_phases: 10
  completed_phases: 1
  total_plans: 53
  completed_plans: 50
  percent: 95
---

# STATE — BLADE Skin Rebuild (V1)

**Project:** BLADE Skin Rebuild V1
**Current Phase:** 03-dashboard-chat-settings (7/7 plans substrate shipped; 3 deferred operator checkpoints)
**Status:** Phases 1 + 2 + 3 SUBSTRATE COMPLETE — ~80 commits across three phases. `npm run verify:all` 6/6 green (added verify:chat-rgba as D-70 regression gate). `npx tsc --noEmit` clean. All checkpoints will be closed in one Mac session per user strategy (brother's Mac).
**Last Updated:** 2026-04-19

---

## Project Reference

**Core Value:** Every surface the user touches is coherent, Liquid-Glass-native, and wired end-to-end. No orphan screens, no dead buttons, no stringly-typed invokes that silently fail.

**Current Focus:** Phase 1 Foundation — CONTEXT.md captured, ready for planning

---

## Current Position

Phase: 04 — SUBSTRATE COMPLETE (Mac operator smoke deferred)
Plan: 29 of 32 shipped (Phase 0..4 substrates); checkpoints bundled: 01-09 WCAG + 02-07 smoke + 03-07 smoke + 04-07 M-01..M-13 Mac session + cargo check. All closed in ONE Mac session per brother's-Mac strategy.
**Phase:** 4 — Overlay Windows (QuickAsk + Voice Orb + Ghost + HUD)
**Plan:** 04-07 automated (5 Playwright specs + 3 new bash guards); Mac operator smoke deferred (M-01..M-13)
**Phase Status:** 95% — all 7 plans code-complete; QUICK-01..07 + ORB-01..08 + GHOST-01..08 + HUD-01..05 + WIRE-07 closed
**Overall Progress:**

```
[Phase 0] Pre-Rebuild Audit    ████████████████████  100% COMPLETE (b26a965)
[Phase 1] Foundation           ███████████████████░   95% SUBSTRATE SHIPPED (WCAG checkpoint pending)
[Phase 2] Onboarding + Shell   ███████████████████░   95% SUBSTRATE SHIPPED (operator smoke pending)
[Phase 3] Dashboard+Chat+Set   ███████████████████░   95% SUBSTRATE SHIPPED (Mac smoke + cargo check pending)
[Phase 4] Overlay Windows      ███████████████████░   95% SUBSTRATE SHIPPED (M-01..M-13 Mac smoke pending)
[Phase 5] Agents + Knowledge   ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 6] Life OS + Identity   ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 7] Dev Tools + Admin    ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 8] Body + Hive          ░░░░░░░░░░░░░░░░░░░░  Not started
[Phase 9] Polish Pass          ░░░░░░░░░░░░░░░░░░░░  Not started
```

Verify:all is now 9 gates (entries + no-raw-tauri + migration-ledger + emit-policy + contrast + chat-rgba + ghost-no-cursor + orb-rgba + hud-chip-count).

---

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Requirements mapped | 156/156 | 156/156 ✓ |
| Phases complete | 10 | 1 (Phase 0) |
| Routes rebuilt | 59 | 82 stubs (all ComingSoonSkeleton) |
| Typed wrapper coverage | 764 commands | 6 shipped (getConfig/saveConfig/getOnboardingStatus/completeOnboarding/sendMessageStream/cancelChat) |
| HTML entries created | 5 | 5 ✓ (index/quickask/overlay/hud/ghost_overlay) |
| Primitives shipped | 8 + skeleton | 9 ✓ |
| Design tokens | 6 CSS files | 6 ✓ (tokens/glass/motion/layout/typography/index) |
| WOFF2 self-hosted | 8 files | 8 ✓ (Syne/Bricolage/Fraunces/JetBrains × 2 weights) |
| WIRE-08 refactor sites | 142 single-window | 268 emit_to() calls across 66 Rust files |
| Verify scripts | 6 | 6 ✓ (all pass in npm run verify:all) |

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
- D-20..D-45: Phase 1 Foundation implementation decisions (26 decisions) — see `.planning/phases/01-foundation/01-CONTEXT.md`. Key ones:
  - D-20 props-variant primitive API with strict string unions
  - D-22 token files split by concern (tokens/glass/motion/layout.css)
  - D-23 CSS vars source of truth; Tailwind @theme bridges via var()
  - D-24 self-hosted WOFF2 fonts
  - D-26 hybrid nuke: rm -rf src/ then rebuild 5 windows + 59 RouteDefinition stubs with ComingSoonSkeleton
  - D-27 migration ledger enforcement = CI script + checklist doc (no reviewer-required PR gate)
  - D-29..D-34 gate verification methods (performance.mark, /wrapper-smoke route, verify-entries.mjs, Playwright, contrast audit, ESLint custom rule)
  - D-35..D-45 directory + wrapper + event + route registry + config/prefs + HTML entry + WIRE-08 regression details

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
- [x] Create `.planning/RECOVERY_LOG.md` — DONE (Plan 00-02, b26a965, 1178 lines)
- [x] Phase 1 CONTEXT gathered — DONE (2026-04-18, 01-CONTEXT.md + 01-DISCUSSION-LOG.md)
- [x] Run `/gsd-plan-phase 1` — DONE (2026-04-18, 9 plans in 4 waves, checker iter 3/3 PASSED)
- [x] Run `/gsd-execute-phase 1` substrate — DONE (2026-04-18, 9 plans, 35 commits)
- [ ] Operator WCAG checkpoint (01-09 Task 4) — requires npm install, tauri dev, 5-wallpaper screenshots, playwright e2e, tauri build + verify:html
- [ ] Phase 1 completion commit — depends on WCAG checkpoint passing

### Blockers

None for code. Final checkpoint for Phase 1 is operator-owned (cannot be automated from within the sandbox).

- **WIRE-08 cargo check** — unverifiable in this sandbox (libspa-sys requires libclang which is not installed). Code is semantically correct but operator must run `cd src-tauri && cargo check` on a libclang-enabled environment to confirm zero `error[E…]`.
- **`save_config` wrapper** — Plan 01-05 shipped the wrapper but `save_config` in `src-tauri/src/config.rs:514` is an INTERNAL helper, not `#[tauri::command]`. First runtime call will return TauriError(kind='not_found'). Fix in Phase 2 or Plan 09 follow-up: add `#[tauri::command] pub fn save_config_cmd(...)` in Rust and register it in lib.rs generate_handler!.

---

## Session Continuity

**Last session:** 2026-04-18 — `/gsd-execute-phase 1` executed full substrate. 35 commits landed across 9 plans in 4 waves. Operator-approved nuke ran, 5 HTML entries + 5 bootstraps shipped, 6 CSS files with blur caps + 8 self-hosted WOFF2 fonts, typed Tauri base + 6 wrappers, BLADE_EVENTS catalog + useTauriEvent hook, 9 primitives, custom Router + ConfigContext + 82 ComingSoonSkeleton route stubs, migration ledger seeded, WIRE-08 refactor converted 142+ single-window emit sites to emit_to(...) across 66 Rust files, 6 verify scripts + no-raw-tauri ESLint rule + 3 DEV surfaces + Playwright listener-leak spec + CI workflow. `npm run verify:all` all pass, `npx tsc --noEmit` clean.
**Next action:** Operator runs Plan 01-09 WCAG checkpoint: `npm install && npx playwright install chromium` → `npm run tauri dev` (verify all 5 windows launch) → open DevTools, read `[perf] boot-to-first-paint:` (target ≤200ms) → navigate to /primitives, screenshot over 5 wallpapers, save to `.planning/phases/01-foundation/wcag-screenshots/` → `npm run test:e2e` → `npm run tauri build && npm run verify:html-entries`. On pass, commit phase completion.
**Context cliff notes:**

- Backend is complete (178 Rust modules, 764 commands); this project is frontend + WIRE-08 refactor
- All 5 HTML entries now present — Rust no longer panics on overlay/hud/ghost_overlay window creation
- WIRE-01: `quickask_submit` command + `blade_quickask_bridged` event still missing from Rust — Phase 3 stub
- WIRE-02: `homeostasis_update` event rename to `hormone_update` — Phase 3
- WIRE-08: DONE in Phase 1 (66 Rust files, 268 emit_to calls, 60 cross-window sites preserved)
- 156 requirements, 10 phases mapped in ROADMAP.md; Foundation (FOUND-01..08) + WIRE-08 + WIN-01..09 closed by Plan 01 substrate (P-08 WCAG manual checkpoint pending)
- Phase 0 artifacts: `.planning/RECOVERY_LOG.md`, `.planning/phases/00-pre-rebuild-audit/`
- Phase 1 artifacts: `.planning/phases/01-foundation/01-{01..09}-SUMMARY.md`, `.planning/migration-ledger.md`, `scripts/{seed-migration-ledger,verify-*,audit-contrast}.mjs + verify-no-raw-tauri.sh`, `eslint-rules/no-raw-tauri.js`, `playwright.config.ts` + `tests/e2e/listener-leak.spec.ts`
- `src.bak/` untouched (297 files) — migration ledger cross-reference

---

*State initialized: 2026-04-17 | Last updated: 2026-04-18 (Phase 1 substrate shipped, awaiting WCAG checkpoint)*
