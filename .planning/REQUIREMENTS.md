# Requirements: v1.2 — Acting Layer with Brain Foundation

**Defined:** 2026-04-29 | **Source:** `.planning/notes/v1-2-milestone-shape.md` (locked 2026-04-29)

**Authority:** PROJECT.md (`Current Milestone: v1.2`), STATE.md (locked decisions M-01..M-07).

**Phases:** 16–20 (continues global numbering per M-05; v1.1 ended at 15).

48 requirements grouped by 5 phase clusters. Every requirement maps to exactly one phase via the Traceability section. Requirement quality: specific, testable, atomic, independent.

---

## Eval Scaffolding (EVAL) — Phase 16

- [x] **EVAL-01
**: `tests/evals/` directory exists with shared harness pattern (fixture builders, RR/MRR helpers, scored-table printer) — *file present, exported helpers used by ≥2 eval modules*
- [x] **EVAL-02**
: Knowledge-graph integrity eval — fixture corpus stored via `add_node` / `add_edge`, idempotent-merge path exercised (resolves missing `consolidate_kg`), asserts zero orphan nodes + edge endpoints all present + edge upsert no-dup — *cargo test --lib evals::kg_integrity_eval green; 5/5 dimensions pass; MRR 1.000 (Plan 16-04)*
- [x] **EVAL-03
**: BM25 / hybrid-search regression gate preserves existing 8/8-asserted floor (synthetic 4-dim) + 3 new adversarial fixtures (long content, unicode, near-duplicates) — *embeddings::memory_recall_eval extends with adversarial cases, MRR ≥ 0.6 floor holds*
- [x] **EVAL-04**: typed_memory category recall eval — 7-category fixture (Fact / Preference / Decision / Skill / Goal / Routine / Relationship), `recall_by_category` returns expected sets — *cargo test --lib evals::typed_memory_eval green; 7/7 categories round-trip + cross-category isolation; MRR 1.000 (Plan 16-05)*
- [x] **EVAL-05**: Evolution capability-gap detection eval — synthetic stderr / command-failure blobs fed to `detect_missing_tool`, asserts correct catalog entry returned for each — *cargo test --lib evals::capability_gap_eval green; 7/7 cases pass (4 positive + 1 false-positive regression + 2 negative); MRR 1.000; live function lives at `self_upgrade::detect_missing_tool` (REQ wording said `evolution::` — RESEARCH §5 resolved, no re-export added) (Plan 16-06)*
- [ ] **EVAL-06**: Every eval module prints scored table to stdout in the existing `memory_recall_real_embedding` format (label / top1 / top3 / rr / top3-ids / wanted) — *grep stdout for ┌── delimiter on each eval invocation*
- [ ] **EVAL-07**: `verify:eval` gate added to `verify:all` chain (count moves from 27 → 28+) — *npm run verify:all exits 0 with eval gate present in output*
- [ ] **EVAL-08**: `tests/evals/DEFERRED.md` lists LLM-API-dependent evals (extract_conversation_facts precision, weekly_memory_consolidation correctness, evolution suggestion quality) as v1.3 candidates with rationale + budget estimate — *file present, ≥3 entries with structured rationale*

---

## Doctor Module (DOCTOR) — Phase 17

- [ ] **DOCTOR-01**: `doctor.rs` module with three Tauri commands: `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal` — *registered in lib.rs generate_handler!, callable from frontend*
- [ ] **DOCTOR-02**: Eval-score-history signal source — reads Phase 16 eval output history from `tests/evals/` artifact storage and surfaces score trend per eval module — *doctor_get_signal "eval_history" returns ≥1 series*
- [ ] **DOCTOR-03**: Capability-gap log aggregation — counts + recency per capability via `evolution_log_capability_gap` consumer — *doctor_get_signal "capability_gaps" returns aggregated table*
- [ ] **DOCTOR-04**: Tentacle health signal source — surfaces which observers are alive / stale / failing — *doctor_get_signal "tentacles" returns per-tentacle state row*
- [ ] **DOCTOR-05**: Config drift detection — ledger consistency + scan-profile age signals — *doctor_get_signal "drift" surfaces ≥1 drift indicator (or "none" green)*
- [ ] **DOCTOR-06**: `doctor_event` Tauri event emitted on regression detected (eval score drop ≥10%, tentacle dead ≥1h, gap-log spike) — *event_logger.rs registers emit, payload schema documented*
- [ ] **DOCTOR-07**: Diagnostics admin tab extended with Doctor pane (Diagnostics surface already exists) — *route reachable, NavRail link or Diagnostics sub-tab*
- [ ] **DOCTOR-08**: Severity-tiered visual hierarchy (green / amber / red) per signal class — *DOM elements carry severity classes; verify:contrast green per tier*
- [ ] **DOCTOR-09**: Per-signal drill-down — click row → drawer with raw data + last-changed timestamp + suggested fix copy — *click handler opens drawer; drawer renders signal payload*
- [ ] **DOCTOR-10**: Auto-update presence check folded in — Doctor surfaces "no auto-update channel" as amber if `tauri-plugin-updater` not wired in `tauri.conf.json` — *doctor_get_signal "auto_update" returns wired/unwired*

---

## JARVIS Push-to-Talk → Cross-App Action (JARVIS) — Phase 18

- [ ] **JARVIS-01**: Push-to-talk global hotkey registered (configurable; default `Ctrl+Alt+Space` on Win / `Cmd+Opt+Space` on Mac) — *register_global_shortcut succeeds, releases on app exit*
- [ ] **JARVIS-02**: PTT flow captures audio → Whisper STT (existing `voice.rs` or `whisper_local` if feature flag set) → text — *transcript returned to dispatcher*
- [ ] **JARVIS-03**: Command intent classification routes transcript to either chat or tool-dispatch path — *intent_router::classify returns IntentClass enum*
- [ ] **JARVIS-04**: Cross-app dispatch reuses existing observer tentacle credentials (Slack / GitHub / Calendar / Linear) for outbound writes — *write path uses same credentials store as observer probes*
- [ ] **JARVIS-05**: Per-action explicit consent dialog before any external write (post / reply / deploy / modify); decision persisted per (intent_class, target_service) tuple — *first invocation prompts; subsequent same-tuple actions skip prompt; opt-out clears persisted consent*
- [ ] **JARVIS-06**: Ego post-processor — regex pattern matcher detects "I can't" / "I don't have access" / "I'm not able to" / "I cannot directly" / "I lack the" — *ego::intercept_assistant_output classifies; ≥5 patterns covered*
- [ ] **JARVIS-07**: On capability_gap verdict, ego invokes `evolution_log_capability_gap` + attempts `auto_install` if catalog match, then re-prompts assistant — *integration test fakes a refusal, observes gap log + retry*
- [ ] **JARVIS-08**: Ego retry cap holds at 1 retry per turn (no infinite loops) — *integration test simulates persistent refusal; second retry never fires*
- [ ] **JARVIS-09**: Browser-harness Q1 decision absorbed into Phase 18 plan (`research/questions.md` Q1 closed with verdict) — *research/questions.md Q1 has decision + rationale*
- [ ] **JARVIS-10**: Every JARVIS action emits to ActivityStrip (M-07 contract) with intent / target / outcome — *ActivityStrip subscriber observes ≥1 entry per JARVIS turn*
- [ ] **JARVIS-11**: Inline JARVIS pill in chat when ego intercepts (e.g. *"BLADE detected a capability gap (browser); attempting to resolve..."*) — *MessageList renders pill on intercept event*
- [ ] **JARVIS-12**: Cold-install end-to-end demo: PTT activated → user speaks command → BLADE prompts consent → executes real cross-app action (e.g. posts to Slack channel, replies to GitHub PR) → action visible in target service — *operator UAT screenshot in `docs/testing ss/` (literal space); narrative captioned*

---

## Operator UAT Close (UAT) — Phase 19

Carry-overs from v1.1 close (per `STATE.md ## Deferred Items` and `milestones/v1.1-MILESTONE-AUDIT.md`). Operator-driven; runtime evidence belongs in `docs/testing ss/`.

- [ ] **UAT-01**: ActivityStrip persists across route navigation — *evidence: 3 routes navigated, screenshots show same strip content*
- [ ] **UAT-02**: ActivityDrawer focus-restore on close — *evidence: open drawer from button A, close, focus returns to button A*
- [ ] **UAT-03**: localStorage rehydrate on app restart — *evidence: ≥3 entries seeded, app restart, entries still present in strip*
- [ ] **UAT-04**: Cold-install Dashboard screenshot captured (Phase 14 deferral) — *evidence: PNG in `docs/testing ss/cold-install-dashboard.png` with one-line caption*
- [ ] **UAT-05**: Cold-install RightNowHero screenshot captured (Phase 15 deferral) — *evidence: PNG in `docs/testing ss/cold-install-righthnow.png`*
- [ ] **UAT-06**: SCAN-13 cold-install baseline — ≥10 repos / ≥5 accounts / ≥3 daily-rhythm / ≥3 IDE+AI signals — *evidence: scan output JSON with counts*
- [ ] **UAT-07**: Keyboard tab-traversal across full main window (A11Y2-01) — *evidence: tab-order screenshot grid or video clip*
- [ ] **UAT-08**: 5-wallpaper contrast UAT (A11Y2-02 + DENSITY-03) — *evidence: 5 PNGs, one per wallpaper, eyeball contrast check ≥ AA*
- [ ] **UAT-09**: Top-bar hierarchy at 1280×720 — *evidence: PNG, no overlap, all 4 tiers visible*
- [ ] **UAT-10**: 50-route empty-state ⌘K sweep (DENSITY-05/06) — *evidence: route × empty-state matrix; every route has either content or actionable CTA*
- [ ] **UAT-11**: Spacing-ladder spot-check across ≥5 routes — *evidence: token-name verify gate already covers this; spot screenshots confirm visually*
- [ ] **UAT-12**: `HANDOFF-TO-MAC.md` deletion intent reconciled — *either restored from git history OR formal "deleted intentionally" note in CHANGELOG.md*

---

## Polish + Verify (POLISH) — Phase 20

- [ ] **POLISH-01**: `npm run verify:all` exits 0 with all consolidated gates (existing 27 + Phase 16 eval + any new gates from 17–19) — *CI green; counts logged*
- [ ] **POLISH-02**: `cargo check --no-default-features` clean (or CI-green falsifier if WSL libspa-sys env limit persists per v1.1 STATE.md note) — *exit 0 in CI Linux runner*
- [ ] **POLISH-03**: `npx tsc --noEmit` clean — *exit 0*
- [ ] **POLISH-04**: v1.2 CHANGELOG.md entry mirrors v1.1's structure (Added / Changed / Fixed / Deferred sections) — *entry present, dated, scope-summarized*
- [ ] **POLISH-05**: `milestones/v1.2-MILESTONE-AUDIT.md` mirrors v1.1 audit pattern (3-source coverage + tech-debt log) — *file present, requirement coverage table populated*
- [ ] **POLISH-06**: Phase dirs 16–20 archived to `milestones/v1.2-phases/` on milestone close — *dirs moved; original `.planning/phases/16-*` through `20-*` removed or symlinked*

---

## Future Requirements (deferred to v1.3+)

These were named in the dump or in PROJECT.md but explicitly out of v1.2 scope:

- **ACT-XX** (full per-tentacle outbound surface beyond JARVIS-mediated subset) — Slack / Email / GitHub / Calendar / Linear as standalone first-class flows. Phase 18 ships JARVIS-mediated subset; standalone surfaces → v1.3.
- **SKILL-XX** (Skills MVP — ELIZA / Obsidian / GSD as user-installable runtime skills) — speculative; user-customization theme has more room in v1.3.
- **REPLACER-XX** (tool-replacer — Hermes / OpenClaw / Cowork copy-or-control) — gated on Phase 16 evals being live.
- **WIRE3-XX** (97 deferred backend modules from v1.1) — backlog work isn't milestone-shaped; pick individual items as acting-tentacle dependencies arise.
- **ANDROID-XX** (Android control, partial + full) — separate platform investigation.
- **CAMERA-XX** (camera access) — separate input modality.
- **OS-CUST-XX** (Windows / OS customization, Windhawk-style) — v2+, not milestone-shaped.
- **PERSONA-XX** (persona maturity / user-clone / humor) — v1.3 separate pass.

---

## Out of Scope

Explicit exclusions, not just "deferred":

- "How to make BLADE think" / "turn LLM into AI" — v3+ destination, not milestone-shaped at any version.
- "Make ourselves better than Codex in everything" — aspirational not actionable; absorbed as a continuous research habit.
- Perplexity-personal-computer-better — too vague to scope.
- Multi-instance / business SDK — v2+ per PROJECT.md Out of Scope.
- Hyprland compositor integration — v2+ per PROJECT.md Out of Scope.
- Heads + Big Agent — v2+ per PROJECT.md Out of Scope.

---

## Traceability

Filled by the roadmapper after `/gsd-new-milestone` completes. Maps every REQ-ID above to a phase in `ROADMAP.md`.

| REQ-ID range | Phase | Phase Name |
|---|---|---|
| EVAL-01..08 | 16 | Eval Scaffolding Expansion |
| DOCTOR-01..10 | 17 | Doctor Module |
| JARVIS-01..12 | 18 | JARVIS Push-to-Talk → Cross-App Action |
| UAT-01..12 | 19 | Operator UAT Close |
| POLISH-01..06 | 20 | Polish + Verify Pass |

100% coverage: 48 requirements, 5 phases, every requirement mapped to exactly one phase.
