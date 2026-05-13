# Roadmap — BLADE

**Current Milestone:** v1.6 — Narrowing Pass
**Created:** 2026-05-13 (retroactive scaffold) | **Source:** VISION.md cut list (locked 2026-05-10) + V2-AUTONOMOUS-HANDOFF.md §0
**Phases:** 39–44 (continues global numbering; v1.5 ended at Phase 38)

---

## Milestones

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ Shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ Shipped (tech_debt) | 10–15 | 2026-04-27 |
| v1.2 | Acting Layer with Brain Foundation | ✅ Shipped (tech_debt) | 16–20 | 2026-04-30 |
| v1.3 | Self-extending Agent Substrate | ✅ Shipped | 21–24 | 2026-05-02 |
| v1.4 | Cognitive Architecture | ✅ Shipped | 25–31 | 2026-05-03 |
| v1.5 | Intelligence Layer | ✅ Shipped (tech_debt) | 32–38 | 2026-05-08 |
| **v1.6** | **Narrowing Pass** | 🔄 Active | **39–44** | — |

---

## v1.6 Phases

### Summary Checklist

- [x] **Phase 39: Vertical Deletions** — 7 `chore(v1.6)` commits (financial_brain, health_guardian, security_monitor, pentest, workflow_builder, deeplearn, deep_scan). Shipped 2026-05-12/13.
- [ ] **Phase 40: Always-On → On-Demand** — Total Recall background loop OFF, Audio Timeline transcription OFF, tentacle observation defaults OFF. On-demand paths preserved.
- [ ] **Phase 41: Persona Auto-Extraction Removal** — Rip silent inference from `persona_engine.rs` + `personality_mirror.rs`. Voice from user-stated core command + actual chat history only.
- [ ] **Phase 42: Background Agent Delegation** — Rip arbitrary-agent spawning in `background_agent.rs`. Replace with detection + route to user's Claude Code / Cursor / Goose / Aider.
- [ ] **Phase 43: Pulse Reduction** — Cron primitive stays; daily-summary engine cuts. Proactive interjection routes through `decision_gate`.
- [ ] **Phase 44: Close** — CHANGELOG v1.6, MILESTONE-AUDIT, phase archive, README narrowed-scope update, MILESTONES.md entry.

### Sequencing

```
   Phase 39 (Vertical Deletions) ✅ SHIPPED
       │
       ▼
   Phase 40 (Always-On → On-Demand)              independent of 41-43
       │
       ▼
   Phase 41 (Persona Auto-Extraction Removal)   touches persona_engine + personality_mirror
       │
       ▼
   Phase 42 (Background Agent Delegation)        touches background_agent.rs only
       │
       ▼
   Phase 43 (Pulse Reduction)                    touches pulse.rs + decision_gate.rs
       │
       ▼
   Phase 44 (Close)                              gates on all prior phases
```

Phases 40–43 have no inter-dependencies — they touch different modules. Executed sequentially for clean atomic commits, but `/gsd-autonomous` may parallelize per its wave-based scheduler.

### Success Criteria (milestone-level)

1. All 7 "Removed (locked)" items from VISION.md are out of the codebase (Phase 39 — DONE)
2. All 6 "Significantly reduced" items from VISION.md are converted per their stay-rule (Phases 40–43)
3. `verify:all` ≥36/38 (OEVAL-01c v1.4 carry-forward documented in tech_debt)
4. cargo check + tsc --noEmit clean
5. CHANGELOG + MILESTONE-AUDIT + phase archive shipped (Phase 44)
6. Onboarding Steps removal NOT in v1.6 — folded into v2.0 Phase 1 per handoff decision

### Phase Details

#### Phase 39: Vertical Deletions [SHIPPED — retroactive scaffold]

**Goal**: Cut every VISION "Removed (locked)" vertical from the codebase before v2.0 builds setup-as-conversation on a clean substrate.
**Requirements**: DEL-01..07
**Commits**: `ae54a15`, `b775857`, `7083d14`, `c0bf13f`, `2686761`, `568b236`, `aa789f7`
**Success Criteria**:
  1. ✅ All 7 verticals removed from `src-tauri/src/` and `src/components/`
  2. ✅ All `lib.rs` `generate_handler!` entries and `mod` registrations for cut modules removed
  3. ✅ Routes and command palette entries for cut modules removed
  4. ✅ `verify:all` remained ≥36/38 across all 7 commits

#### Phase 40: Always-On → On-Demand

**Goal**: Three perception loops (screen capture, audio capture, tentacle passive observation) flip from default-on to default-off. On-demand paths preserved.
**Depends on**: Phase 39
**Requirements**: REDUCE-02, REDUCE-03, REDUCE-04
**Success Criteria**:
  1. `screen_timeline.rs` background capture loop in `lib.rs` start-up removed; `capture_screen_now` Tauri command remains for LLM tool-use
  2. `audio_timeline.rs` always-on Whisper transcription removed; on-demand path stays
  3. All observer-class tentacles in `tentacles/*` default to `enabled: false` in `DiskConfig::default()` and `BladeConfig::default()`
  4. `verify:all` ≥36/38; chat smoke test passes (send message, reply renders)

#### Phase 41: Persona Auto-Extraction Removal

**Goal**: Strip silent personality inference from `persona_engine.rs` (~1,317 LOC) and `personality_mirror.rs` (~821 LOC). Voice comes from user-stated core command (filled by v2.0 hunt) + actual chat history only.
**Depends on**: Phase 39
**Requirements**: REDUCE-01
**Success Criteria**:
  1. Filename-based personality inference removed
  2. Shell-history-based personality inference removed
  3. Modules retained as ingestion targets for v2.0 hunt output (`~/.blade/who-you-are.md`)
  4. Chat-history-based extraction path preserved
  5. Net LOC reduction ≥1,000 across the two files combined

#### Phase 42: Background Agent Delegation

**Goal**: BLADE stops spawning arbitrary agents. Detect user's installed agent stack (Claude Code / Cursor / Goose / Aider) and route code work to whatever is present.
**Depends on**: Phase 39
**Requirements**: REDUCE-05
**Success Criteria**:
  1. `background_agent.rs` spawn-arbitrary code removed (~600 LOC reduction target)
  2. Detection layer added: `which claude`, `which cursor`, `which goose`, `which aider`
  3. Route code tasks to detected agent via shell invocation; if none detected, BLADE handles inline
  4. UI surfaces which agent BLADE detected and routed to in chat-line

#### Phase 43: Pulse Reduction

**Goal**: Pulse keeps cron primitive (the scheduler). Daily-summary engine and morning-briefing UX retires. Proactive interjection routes through `decision_gate` so it only fires when something matters per the core command.
**Depends on**: Phase 39
**Requirements**: REDUCE-06
**Success Criteria**:
  1. Daily-summary generation code in `pulse.rs` removed (~600 LOC reduction target)
  2. Cron scheduler primitive retained for future cron-driven work
  3. Any `pulse.rs` → chat path that fires unconditionally re-routes through `decision_gate::should_act`
  4. Morning-briefing UI surface (if present) removed from Dashboard

#### Phase 44: Close

**Goal**: v1.6 milestone closed cleanly. CHANGELOG entry, milestone audit doc, phase archive, README scope-narrowing update.
**Depends on**: Phase 40, 41, 42, 43
**Requirements**: CLOSE-01..04
**Success Criteria**:
  1. CHANGELOG.md gets v1.6 entry with all 13 requirement IDs covered
  2. `.planning/milestones/v1.6-MILESTONE-AUDIT.md` written (3-source: VISION cut list + REQUIREMENTS + git log)
  3. Phase 39–44 directories archived to `.planning/milestones/v1.6-phases/`
  4. README updated to no longer claim Financial Brain / Health Guardian / Security Fortress / Workflow Builder / Pentest as features
  5. MILESTONES.md gets v1.6 entry
  6. `verify:all` exits 0; cargo check clean; tsc --noEmit clean
  7. git tag `v1.6` pushed

---

## v1.5 Phases (Validated — Intelligence Layer)

See `.planning/milestones/v1.5-ROADMAP.md` for full text. All 7 phases code-complete; closed 2026-05-08 at `tech_debt` status. Runtime UAT operator-deferred per feedback_deferred_uat_pattern.md.

---

## Risk Register (v1.6)

| Risk | Phase impacted | Mitigation |
|---|---|---|
| Deletion regression — a cut module had a downstream caller missed by the chore commit | 39 retro / 40-43 | Run `verify:all` per phase; if regression appears, fix-forward (don't revert; the cut is locked) |
| On-demand conversion (Phase 40) breaks the on-demand command path while removing the loop | 40 | Keep on-demand Tauri command intact; only remove the start_*_loop call in lib.rs; smoke-test chat-driven invocation |
| Persona module LOC reduction (Phase 41) accidentally rips chat-history path (the part that stays) | 41 | Surface-level: filename + shell_history inference functions deleted; ChatHistoryExtractor unchanged |
| Background agent delegation (Phase 42) detection layer fails on systems with no installed agent | 42 | Fallback to BLADE-inline handling; UI surfaces which agent (or none) was detected |
| Pulse reduction (Phase 43) breaks unrelated cron-driven feature | 43 | Audit cron callers before deletion; only morning-briefing daily-summary path cuts |
| OEVAL-01c v1.4 organism-eval carry-forward might count against the 36/38 floor if it regresses further | 44 close | Document as v1.5-inherited tech_debt; v1.6 doesn't touch organism modules, so no new drift expected |

---

## Notes

- **Phase numbering continues globally** per M-05/M-12. v1.6 starts at Phase 39; v2.0 will start at Phase 45.
- **v1.6 = pure deletion + reduction** per `.planning/decisions.md` 2026-05-13. The agent-native audit's recs #2-10 (slash commands, crud_tools! macro, build-time codegen) roll into **v2.0**, not v1.6.
- **Onboarding Steps cut folded to v2.0** per V2-AUTONOMOUS-HANDOFF.md §0 item 7 — the hunt replaces Steps wholesale, no point in two passes on the same files.
- **Static gates ≠ done** per CLAUDE.md Verification Protocol. The v1.1 lesson applies: chat must still render replies after each cut. Per V2-AUTONOMOUS-HANDOFF §1: runtime UAT operator-owned; static gates green is the close bar.
- **Wake conditions** per V2-AUTONOMOUS-HANDOFF §7: GSD verifier BLOCKED twice on same phase after one self-fix; verify gates regress below 36/38 and code-fixer fails; authority gap. Otherwise grind.

---

*Last updated: 2026-05-13 — v1.6 retroactive scaffold per V2-AUTONOMOUS-HANDOFF.md execution loop §4.*
