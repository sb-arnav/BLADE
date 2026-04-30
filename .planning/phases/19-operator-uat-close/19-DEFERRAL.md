---
phase: 19-operator-uat-close
status: deferred
deferred_by: operator
deferred_on: 2026-04-30
deferred_to: v1.3
deferred_rationale: pure UAT/screenshot phase; chat-first pivot has paused UI/UAT work; operator lacks bandwidth + API keys to drive end-to-end demos
---

# Phase 19 — DEFERRED to v1.3

**Original goal:** Close 11 v1.1 carry-over UAT items per `STATE.md ## Deferred Items` and `milestones/v1.1-MILESTONE-AUDIT.md`. Reconcile `HANDOFF-TO-MAC.md` deletion intent.

**Operator decision (2026-04-30):** Phase 19 is **deferred to v1.3 milestone**.

## Why deferred

Three converging signals:

1. **Chat-first pivot recorded 2026-04-30** (memory: `feedback_chat_first_pivot.md`) — UI/UAT polish work is paused for v1.2; the product framing shifted to "one chat surface capable enough to do anything" and away from polishing UI surfaces.
2. **Phase 19 is 100% UAT work.** Of the 12 REQs, every one is a runtime screenshot, manual evidence capture, or operator-driven flow exercise. There is zero code surface in Phase 19 — the items are all carry-over verifications from v1.1's tech-debt close.
3. **Operator API-key constraint surfaced during Phase 18 close** — JARVIS-12's e2e cold-install demo was deferred because the operator lacks Linear/Slack/Gmail/GitHub credentials. The same constraint affects several Phase 19 items that require live integrations (UAT-04 cold-install Dashboard screenshot, UAT-05 cold-install RightNowHero, UAT-06 SCAN-13 baseline).

## Carry-over items (preserved for v1.3)

| REQ | Item | v1.3 owner |
|-----|------|-----------|
| UAT-01 | ActivityStrip persists across route navigation | runtime UAT |
| UAT-02 | ActivityDrawer focus-restore on close | runtime UAT |
| UAT-03 | localStorage rehydrate on app restart | runtime UAT |
| UAT-04 | Cold-install Dashboard screenshot (Phase 14 deferral) | runtime UAT |
| UAT-05 | Cold-install RightNowHero screenshot (Phase 15 deferral) | runtime UAT |
| UAT-06 | SCAN-13 cold-install baseline (≥10 repos / ≥5 accounts / ≥3 daily-rhythm / ≥3 IDE+AI) | runtime UAT |
| UAT-07 | Keyboard tab-traversal across full main window (A11Y2-01) | runtime UAT |
| UAT-08 | 5-wallpaper contrast UAT (A11Y2-02 + DENSITY-03) | runtime UAT |
| UAT-09 | Top-bar hierarchy at 1280×720 | runtime UAT |
| UAT-10 | 50-route empty-state ⌘K sweep (DENSITY-05/06) | runtime UAT |
| UAT-11 | Spacing-ladder spot-check across ≥5 routes | runtime UAT (token-name verify gate already covers static path) |
| UAT-12 | `HANDOFF-TO-MAC.md` deletion intent reconciled | docs (could be done now — see note below) |

## Note on UAT-12

UAT-12 is a docs-only item (reconcile `HANDOFF-TO-MAC.md` either by restoring or by formal "deleted intentionally" note in CHANGELOG.md). The current state shows `D .planning/HANDOFF-TO-MAC.md` (deleted, uncommitted). Phase 20's CHANGELOG.md entry will absorb the reconciliation: a formal "deleted intentionally" note lands in v1.2 CHANGELOG.md `### Deleted` section.

## v1.3 expected scope under this carry-forward

When v1.3 starts, the operator should run a single dedicated UAT phase that:
1. Brings up `npm run tauri dev` on a real machine with all integration creds wired
2. Walks the 11 runtime UAT items in sequence with screenshots saved to `docs/testing ss/` (literal-space directory)
3. Reads back each screenshot per CLAUDE.md Verification Protocol
4. Updates `milestones/v1.1-MILESTONE-AUDIT.md` from `tech_debt` → `complete`

Estimated v1.3 effort: ~1 day operator time + ~30 min documentation.

---

*Phase 19 deferred 2026-04-30 by operator under chat-first pivot. v1.2 close proceeds with Phase 18 + Phase 20; Phase 19 carry-overs roll into v1.3 with explicit acknowledgement that v1.1's `tech_debt` audit status persists.*
