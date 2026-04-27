# Roadmap — BLADE

## Milestones

- ✅ **v1.0 — Skin Rebuild** (substrate) — Phases 0–9 (shipped 2026-04-19, ~165 commits, 18 verify gates green)
- ✅ **v1.1 — Functionality, Wiring, Accessibility** — Phases 10–15 (shipped 2026-04-24, closed 2026-04-27, 29 plans, 27 verify gates green)
- 📋 **v1.2 — TBD** — to be planned via `/gsd-new-milestone` (deferred from v1.1: JARVIS push-to-talk demo, acting-class tentacles, browser-harness Q1 decision, plus 11 operator UAT carry-overs)

---

## Phases

<details>
<summary>✅ v1.0 — Skin Rebuild (Phases 0–9) — SHIPPED 2026-04-19</summary>

| Phase | Name | Status |
|-------|------|--------|
| 0 | Pre-Rebuild Audit | Complete (b26a965) |
| 1 | Foundation | Substrate shipped, WCAG checkpoint operator-owned |
| 2 | Onboarding + Main Shell | Substrate shipped, operator smoke pending |
| 3 | Dashboard + Chat + Settings | Substrate shipped, Mac smoke + cargo check pending |
| 4 | Overlay Windows (QuickAsk + Orb + Ghost + HUD) | Substrate shipped, M-01..M-13 pending |
| 5 | Agents + Knowledge | Complete |
| 6 | Life OS + Identity | Complete |
| 7 | Dev Tools + Admin | Complete |
| 8 | Body + Hive | Complete |
| 9 | Polish Pass | Complete |

Phase directories remain at `.planning/phases/0[0-9]-*` (never formally archived). Mac smoke M-01..M-46 + WCAG 5-wallpaper checkpoint operator-owned per `HANDOFF-TO-MAC.md`.

</details>

<details>
<summary>✅ v1.1 — Functionality, Wiring, Accessibility (Phases 10–15) — SHIPPED 2026-04-24</summary>

| Phase | Name | Plans | Completed |
|-------|------|-------|-----------|
| 10 | Inventory & Wiring Audit | 5/5 | 2026-04-20 |
| 11 | Smart Provider Setup (VERIFIED PASSED) | 6/6 | 2026-04-20 |
| 12 | Smart Deep Scan | 5/5 | 2026-04-20 |
| 13 | Self-Configuring Ecosystem (observe-only) | 3/3 | 2026-04-24 |
| 14 | Wiring & Accessibility Pass (human_needed) | 5/5 | 2026-04-24 |
| 15 | Density + Polish (human_needed) | 5/5 | 2026-04-24 |

Full archive: `milestones/v1.1-ROADMAP.md` | Requirements: `milestones/v1.1-REQUIREMENTS.md` | Audit: `milestones/v1.1-MILESTONE-AUDIT.md` | Phase dirs: `milestones/v1.1-phases/`.

</details>

### 📋 v1.2 — Planned (next milestone)

To be defined via `/gsd-new-milestone`. Carry-over candidates from v1.1 deferral pool:

- **JARVIS push-to-talk demo** (M-04 deferred from v1.1)
- **Acting tentacles** — Slack reply, Email reply, GitHub PR review, Calendar accept/decline, Linear ticket creation (M-03 observe-only guardrail flips per-tentacle)
- **Browser harness Q1** — `browser-use/browser-harness` vs current `browser_native.rs` decision (deadline pre-v1.2 JARVIS phase plan)
- **97 NOT-WIRED backend modules** flagged DEFERRED_V1_2 in 10-WIRING-AUDIT.json
- **11 operator UAT items** carried from v1.1 (cold-install screenshots, runtime persistence, 5-wallpaper contrast, keyboard-nav, 50-route ⌘K sweep)
- **LOG-04 time-range filter** in ActivityDrawer (advisory miss from Phase 14)
- **ROUTING_CAPABILITY_MISSING UI consumer** (toast/banner — deferred from Phase 11 → 14 → v1.2)

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 0..9 | v1.0 | per-phase | Complete | 2026-04-19 |
| 10. Inventory & Wiring Audit | v1.1 | 5/5 | Complete | 2026-04-20 |
| 11. Smart Provider Setup | v1.1 | 6/6 | Complete (VERIFIED PASSED) | 2026-04-20 |
| 12. Smart Deep Scan | v1.1 | 5/5 | Complete | 2026-04-20 |
| 13. Self-Configuring Ecosystem | v1.1 | 3/3 | Complete | 2026-04-24 |
| 14. Wiring & Accessibility Pass | v1.1 | 5/5 | Complete (human_needed) | 2026-04-24 |
| 15. Density + Polish | v1.1 | 5/5 | Complete (human_needed) | 2026-04-24 |
| 16+ | v1.2 | TBD | Not started | — |

---

*v1.0 substrate shipped 2026-04-19. v1.1 closed 2026-04-27 with audit status `tech_debt` (no blockers; 11 operator-owned UAT items deferred). See `MILESTONES.md` for the historical record.*
