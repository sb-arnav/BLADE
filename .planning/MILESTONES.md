# BLADE — Milestones

Historical record of shipped versions. Each entry summarizes what shipped, what was deferred, and where to look for the full archive.

---

## v1.1 — Functionality, Wiring, Accessibility

**Shipped:** 2026-04-24 (closed 2026-04-27)
**Phases:** 10–15 (6 phases, 29 plans, ~133 commits)
**Status:** ✅ Complete (audit status: tech_debt — no blockers; 11 operator-owned UAT items deferred)

### Delivered

The v1.0 substrate became something a first-time user can actually use. Every backend has a UI surface or a documented v1.2 deferral; capability-aware provider routing landed; smart deep scan replaces the dumb sweep; observer-class tentacles auto-enable behind a runtime guardrail; the activity-log strip mounts in the main shell; the spacing/density pass tokenized the surface.

### Key Accomplishments

1. **Smart Provider Setup** (Phase 11) — paste cURL/JSON/Python → auto-extract provider+model+headers; capability probe persists vision/audio/long-context/tool-calling support; router does 3-tier capability-aware resolution with capability-filtered fallback chains; 8 capability-gap consumer surfaces with deep-link CTAs.
2. **Smart Deep Scan** (Phase 12) — replaced 12-scanner sweep with lead-following scanner across 8 source classes (filesystem walk, git remotes, IDE workspaces, AI sessions, shell history, MRU, bookmarks, `which` sweep); structured editable profile with round-trip persistence.
3. **Self-Configuring Ecosystem** (Phase 13) — 6 observer probes (repo-watcher, Slack, deploy-monitor, PR-watcher, session-bridge, calendar) auto-enable from scan; runtime `OBSERVE_ONLY: AtomicBool` guardrail rejects outbound writes; per-tentacle rationale + one-click disable in Settings.
4. **Wiring & Activity Log** (Phase 14) — closed every NOT-WIRED gap from Phase 10 audit (97 deferred-with-rationale to v1.2); replaced 3 ComingSoonCards on Dashboard with live tentacle/calendar/integrations bindings; persistent ActivityStrip + ActivityDrawer with 500-entry localStorage ring buffer.
5. **Density + Polish** (Phase 15) — spacing-ladder audit + verify gate (0 violations across 39 CSS files); empty-state copy rewrite across 18 files (173 TSX scanned, 0 bare-negation); top-bar 4-tier hierarchy with 1280/1100 responsive guardrails; Dashboard RightNowHero with 4 live-signal chips.
6. **Verify chain** — verify:all grew from 18 (v1.0) to 27 gates (v1.1), all green; tsc --noEmit clean; npx playwright specs across phases 11/14/15.

### Known Deferred Items at Close

11 operator-owned UAT items (per v1.0 Mac-smoke convention) — see STATE.md `## Deferred Items` and `.planning/milestones/v1.1-MILESTONE-AUDIT.md`. Categories:

- 4 cold-install screenshots (Phase 12 SCAN-13, Phase 13 ECOSYS-10, Phase 14 Dashboard, Phase 15 RightNowHero)
- 3 runtime persistence checks (activity-strip cross-route, drawer focus-restore, localStorage rehydrate-on-restart)
- 2 visual passes (5-wallpaper contrast for A11Y2-02 and DENSITY-03)
- 1 keyboard-nav UAT (A11Y2-01 tab traversal + focus rings)
- 1 50-route empty-state ⌘K sweep (DENSITY-05/06)

Plus 97 NOT-WIRED backend modules flagged DEFERRED_V1_2 in 10-WIRING-AUDIT.json.

### Archives

- `milestones/v1.1-ROADMAP.md` — full phase details
- `milestones/v1.1-REQUIREMENTS.md` — all 61 requirements with completion evidence
- `milestones/v1.1-MILESTONE-AUDIT.md` — 3-source coverage cross-reference + tech-debt log
- `milestones/v1.1-phases/` — phase 10..15 working directories (SUMMARYs, VERIFICATIONs, plans)

---

## v1.0 — Skin Rebuild (substrate)

**Shipped:** 2026-04-19 (~165 commits, 64 plans, 18 verify gates green)
**Phases:** 0–9 (10 phases)
**Status:** ✅ Substrate complete; Mac smoke (M-01..M-46) and WCAG 5-wallpaper checkpoints operator-owned per `HANDOFF-TO-MAC.md`. Was never formally archived via complete-milestone — phase directories remain at `.planning/phases/0[0-9]-*` for reference.

### Delivered

178+ Rust modules, 764 `#[tauri::command]`s, 73 event emitters; 5 windows boot; design tokens locked; 9 self-built primitives (no shadcn/Radix); typed Tauri wrapper + useTauriEvent + BLADE_EVENTS registry; custom router; ConfigContext; chat streaming + tool calls; Voice Orb + QuickAsk + Ghost Mode + HUD bar; 18 verify gates green; 156 v1 requirements shipped.

See `git log` before commit `6a78538` for the v1.0 REQUIREMENTS.md.

---

*Updated 2026-04-27 at v1.1 close.*
