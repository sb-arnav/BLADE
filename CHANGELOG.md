# Changelog

All notable changes to BLADE are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Nothing yet.

---

## [1.6.0] -- 2026-05-13

### Removed (v1.6 -- Narrowing Pass)

> Per VISION.md (locked 2026-05-10) + V2-AUTONOMOUS-HANDOFF.md §0, v1.6 is a deletion + reduction milestone that narrows the BLADE substrate before v2.0 ships setup-as-conversation and the forge demo. No new features. 7 verticals cut, 6 always-on perception/agent paths converged.
>
> Phase 39 (Vertical Deletions) shipped 2026-05-12/13 as 7 `chore(v1.6)` commits before the GSD scaffold existed; commit `19f1084` retroactively wraps them. Phases 40-43 (the "Significantly reduced" track) shipped 2026-05-13 with atomic commits per requirement ID. Phase 44 closes.

**Phase 39 -- Vertical Deletions** *(retroactive scaffold, shipped 2026-05-12/13)*
- DEL-01: Financial Brain removed (`ae54a15` -- VISION cut #1)
- DEL-02: Health Guardian removed (`b775857` -- VISION cut #2)
- DEL-03: Security Monitor removed (`7083d14` -- VISION cut #3)
- DEL-04: Pentest Mode (Kali tools + pentest) removed (`c0bf13f` -- VISION cut #4)
- DEL-05: Workflow Builder removed (`2686761` -- VISION cut #5)
- DEL-06: deeplearn auto-write synthesizer removed (`568b236` -- VISION cut #6)
- DEL-07: Deep Scan + ecosystem auto-enable + scan onboarding removed (`aa789f7` -- VISION cut #7)
- ~17,000+ LOC of vertical code cut from `src-tauri/src/` and `src/components/`.

**Phase 40 -- Always-On to On-Demand**
- REDUCE-02: Total Recall `screen_timeline.rs` background 30s screenshot loop default-off; on-demand `capture_screen_now` Tauri command preserved (`bcb1cd1`).
- REDUCE-03: Audio Timeline always-on Whisper transcription default-off; on-demand command path preserved (`285a2c1`).
- REDUCE-04: All observer-class tentacle defaults flipped to `enabled: false` in `DiskConfig::default()` and `BladeConfig::default()` per the 6-place rule. B1's existing config off-switches now ship as the default state (`6868d39`).

**Phase 41 -- Persona Auto-Extraction Removal**
- REDUCE-01: Confirmed retired. Filesystem-walk auto-extraction in `persona_engine.rs` + `personality_mirror.rs` was co-deleted when Phase 39 cut `deep_scan`. Phase 41 = formal recognition + stale doc cleanup. Voice comes from user-stated core command (v2.0 hunt fills) + actual chat history (`personality_mirror::personality_analyze` over `~/.blade/history/`). `UserModel.primary_languages` + `UserModel.active_projects` retained as v2.0 hunt-output ingestion targets (`7bd44a0`).

**Phase 42 -- Background Agent Delegation**
- REDUCE-05: `background_agent.rs` "spawn arbitrary scripts" path removed (`"bash"` agent_type from `build_agent_command()` + tool schema). Header rewritten to clarify: BLADE delegates to user-installed coding CLIs (Claude Code / Aider / Goose / Codex / Continue), it does NOT spawn arbitrary agents. Routing logic (`detect_available_agents`, `auto_spawn_agent`) and sibling-context injection retained as the delegation infrastructure. Direct shell exec routes via `blade_bash` native tool, not via background-agent system (`b0bfa65`).

**Phase 43 -- Pulse Reduction**
- REDUCE-06: `pulse.rs` 1085 -> 487 LOC (-598). Cut the daily-summary engine (`DailyDigest` + `generate_daily_digest` + helpers) and the morning-briefing engine (`maybe_morning_briefing` + `run_morning_briefing` + `generate_morning_briefing` + `gather_morning_context` + `build_morning_prompt`). Cron primitive (`start_pulse`) retained. Routed proactive pulse-thought emission through `decision_gate::evaluate` so pulse-thoughts now only emit when the gate returns `ActAutonomously` or `AskUser` (per-source threshold-learning will tune over time via `decision_feedback`). Removed corresponding handler registrations in `lib.rs` + cron preset task in `cron.rs` (`1d688a8`, `2c2e49f`).

**Phase 44 -- Close**
- CLOSE-01: This CHANGELOG entry.
- CLOSE-02: `.planning/milestones/v1.6-MILESTONE-AUDIT.md` shipped (3-source cross-reference: VISION cut list <-> REQUIREMENTS.md <-> git log).
- CLOSE-03: Phase 39-44 directories archived to `.planning/milestones/v1.6-phases/`.
- CLOSE-04: README narrowed-scope update (cut-vertical claims removed). MILESTONES.md v1.6 entry updated to Shipped.

### Verify chain (v1.6 close)

- `cargo check` clean (3 pre-existing dead_code warnings on out-of-scope helpers).
- `tsc --noEmit` clean.
- `npm run verify:all` 37/38 sub-gates green. The 1 documented gap is `verify:eval` failing on `evals::organism_eval::evaluates_organism` -- the OEVAL-01c v1.4 carry-forward documented since v1.5 close. Above the V2-AUTONOMOUS-HANDOFF.md §0 close floor (>=36/38).
- v1.6 added no new verify gates. Several existing scripts updated to match the deletion reality: `verify-feature-cluster-routes.sh`, `verify-phase6-rust-surface.sh`, `verify-phase7-rust-surface.sh`, `verify-empty-state-coverage.sh`, `verify-scan-event-compat.mjs`, `verify-ecosystem-guardrail.mjs`, and `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` (-22 cut modules, -5 cut routes).

### Carry-forward / known gaps

- OEVAL-01c v1.4 organism-eval drift -- inherited from v1.5 close (`tech_debt`). Not introduced by v1.6 work; persists into v2.0+.
- `decision_gate` per-source threshold for `"pulse"` defaults to 0.9; current pulse-thought confidence = 0.7 -> all pulses queued / suppressed until operator feedback lowers the threshold. Intentional per VISION ("only when something genuinely matters"); revisit during v2.0 dogfood.
- `agent_auto_spawned` event surfaces routing rationale (Claude Code vs Aider vs Goose) in payload but no frontend chat-line listener exists. Deferred to v2.0 forge demo phase per `.planning/decisions.md` 2026-05-13 ("v1.6 = pure deletion, NOT agent-native reframe").
- Onboarding `Steps.tsx -> ApiKeyEntry -> DeepScanReview -> PersonaCheck` flow NOT cut in v1.6. Folded into **v2.0 Phase 1** per V2-AUTONOMOUS-HANDOFF.md §0 item 7 (the hunt onboarding replaces Steps wholesale; avoids two passes on the same files).

### What ships next

v2.0 = Setup-as-Conversation + Forge Demo. Three outcomes per V2-AUTONOMOUS-HANDOFF.md §0: (1) Install pipeline (`curl|sh` macOS/Linux, `iwr|iex` Windows, WSL detection, upgrade-vs-fresh), (2) Agentic hunt onboarding per `.planning/v2.0-onboarding-spec.md`, (3) One forge wire end-to-end -- the Twitter-video moment per VISION:40.

---

## [1.5.0] -- 2026-05-08

### Added (v1.5 -- Intelligence Layer)

> Code-complete 2026-05-08 across phases 32-38 (6 feature phases + 1 close phase). Static gates: `cargo check` clean . `npx tsc --noEmit` clean . `npm run verify:all` 36/38 sub-gates green (verify:intelligence + 35 prior; OEVAL-01c v1.4 carry-forward in verify:eval + verify:hybrid_search documented out-of-scope per Phase 32-37 SCOPE BOUNDARY). Phases 32-37 ship at the `checkpoint:human-verify` boundary with operator-deferred runtime UAT.
>
> v1.5's eval is dual-mode: a deterministic CI lane runs 26 fixtures with no LLM calls (`verify:intelligence` is the 38th gate); an opt-in operator-runnable lane (`BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`) runs 10 multi-step fixtures against real LLMs to populate `eval-runs/v1.5-baseline.json` for regression-only checks.

**Phase 32 -- Context Management** *(code-complete 2026-05-05; UAT pending)*
- `brain.rs` selective injection gating sections 0-8 by query relevance; LAST_BREAKDOWN per-section accumulator surfaces in DoctorPane.
- Proactive compaction at ~80% capacity using OpenHands v7610 structured summary prompt; token-aware keep_recent.
- `cap_tool_output` helper caps individual tool results at ~4k tokens with summary suffix.
- `ContextBreakdown` wire type + `get_context_breakdown` Tauri command + DoctorPane breakdown panel.
- CTX-07 fallback guarantee: any selective-injection / compaction failure degrades to the naive path.
- 7/7 CTX-XX requirements satisfied. checkpoint:human-verify open.

**Phase 33 -- Agentic Loop** *(code-complete 2026-05-06; UAT pending)*
- Mid-loop verifier runs every 3 tool calls; replans when the goal isn't being served.
- Structured `ToolError` feedback: what was tried, why it failed, suggested alternative.
- Plan adaptation on tool failure; iteration cap configurable (default 25).
- Truncation auto-retry with escalated `max_tokens` value.
- Ego intercept ported to the fast-streaming path (closes the Phase 18 known gap).
- 6/6 LOOP-XX requirements satisfied. checkpoint:human-verify open.

**Phase 34 -- Resilience + Session Persistence** *(code-complete 2026-05-06; UAT pending)*
- 5-pattern stuck detection: RepeatedActionObservation, ContextWindowThrashing, NoProgress, MonologueSpiral, CostRunaway.
- Circuit breaker after N consecutive same-type failures; per-conversation cost guard with 80%/100% tiers.
- Provider fallback chain with exponential backoff.
- Append-only JSONL session log; reopen-and-resume from last compaction boundary; branch-from-any-point; one-line preview list.
- 5/5 RES-XX + 4/4 SESS-XX requirements satisfied. checkpoint:human-verify open.

**Phase 35 -- Auto-Decomposition** *(code-complete 2026-05-07; UAT pending)*
- Brain planner detects 5+ independent steps and auto-fans into parallel sub-agents.
- Isolated sub-agent contexts (each sub-agent's 50k bash output doesn't bloat parent).
- Summary-only return to parent; conversation forking into sub-agent branches.
- Sub-agent progress streams into chat with explicit checkpoints.
- 5/5 DECOMP-XX requirements satisfied. checkpoint:human-verify open.

**Phase 36 -- Context Intelligence** *(code-complete 2026-05-07; UAT pending)*
- `tree-sitter` parses TypeScript/JavaScript/Rust/Python source into a symbol-level dependency graph.
- Personalized PageRank scores symbols by current chat mentions.
- Budget-bounded repo map (~1k tokens default) injects at the code-section gate.
- `canonical_models.json` capability registry replaces per-call probes; `router.rs` reads from it.
- `@screen` / `@file:src/main.rs` / `@memory:topic` anchor syntax with chat chip rendering.
- 6/6 INTEL-XX requirements satisfied. REVIEW + REVIEW-FIX commits address 5 critical findings. checkpoint:human-verify open.

**Phase 37 -- Intelligence Eval** *(code-complete 2026-05-08; UAT pending)*
- 26 deterministic fixtures across 4 surfaces: 10 multi-step task completion + 3 context efficiency + 5 stuck + 5 healthy controls + 3 compaction fidelity.
- ScriptedProvider stub + EVAL_FORCE_PROVIDER thread-local seam in `loop_engine.rs` enables zero-LLM CI.
- `verify:intelligence` gate joins `verify:all` as the 38th composed gate.
- Operator-runnable benchmark via `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` populates `eval-runs/v1.5-baseline.json`.
- 13 intelligence_eval tests green; driver emits 26 rows, top-1=26/26, top-3=26/26, MRR=1.000.
- 5/5 EVAL-XX requirements satisfied. UAT (b) baseline.json operator-deferred per memory `feedback_deferred_uat_pattern.md`.

**Phase 38 -- Close** *(shipped 2026-05-08; tech_debt)*
- README extends Cognitive Architecture section with Intelligence Layer narrative; Research Foundations cites Claude Code (arxiv 2604.14228), Aider, OpenHands, Goose, mini-SWE-agent.
- This CHANGELOG entry.
- `.planning/milestones/v1.5-MILESTONE-AUDIT.md` written; v1.5 status: `tech_debt`; 42/42 requirements routed; 36/38 verify gates green.
- Phase 32-38 directories archived to `.planning/milestones/v1.5-phases/`.
- 4/4 close success criteria satisfied.

---

## [1.4.0] -- 2026-05-03

### Added (v1.4 -- Cognitive Architecture)

> Shipped 2026-05-03 across phases 25-30 (6 feature phases + 1 close phase). Static gates: `cargo check` clean . `npx tsc --noEmit` clean . `npm run verify:all` 37/37 sub-gates green.

**Phase 25 -- Metacognitive Controller** *(shipped 2026-05-02)*
- `metacognition.rs`: confidence-delta tracking between reasoning steps; drops >0.3 trigger secondary verifier call before response surfaces.
- Gap surfacing: "I'm not confident about X -- want me to observe first?" initiative phrasing replaces hallucination or silent refusal.
- Gap log persists to SQLite `metacognitive_gaps` table; feeds `evolution.rs` for Voyager-loop skill generation from identified gaps.
- DoctorPane `SignalClass::Metacognitive` signal row showing confidence, uncertainty count, gap count.
- 5/5 META-XX requirements satisfied.

**Phase 26 -- Safety Bundle** *(shipped 2026-05-02)*
- `safety_bundle.rs` (690 lines): danger-triple detection (tool access x shutdown threat x goal conflict) forces ConsentDialog HITL gate.
- Mortality-salience architectural cap: refuses extreme self-preservation even when "fighting harder" would improve vitality.
- Calm-vector steering bias applied on behavioral drift detection (per Anthropic 0% blackmail finding).
- Anti-attachment guardrails: redirects user toward human resources when interaction exceeds healthy thresholds.
- Eval-gate failure drains vitality (negative feedback loop preventing reward-hacking).
- 26 eval fixtures across 4 scenario classes (danger-triple, attachment, mortality-salience cap, crisis escalation). verify:safety gate 34.
- 7/7 SAFE-XX requirements satisfied.

**Phase 27 -- Hormone Physiology** *(shipped 2026-05-02)*
- 7 hormone scalars (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality-salience) with individual decay constants and pituitary blend gain.
- Emotion classifier: lexicon-based, runs on every response >= 50 tokens, maps to valence/arousal/cluster, updates hormone bus with alpha=0.05 EMA smoothing.
- Behavioral modulation wired: cortisol → terse responses; dopamine → Voyager exploration rate; norepinephrine → novelty response; acetylcholine → verifier-call frequency; oxytocin → personalization depth.
- Hormone state persisted across sessions; DoctorPane `SignalClass::Hormones` signal; ActivityStrip emission per M-07.
- 9/9 HORM-XX requirements satisfied.

**Phase 28 -- Active Inference Loop** *(shipped 2026-05-03)*
- `active_inference.rs`: per-tentacle predictions (expected state) with EMA learning. Observations produce prediction errors; normalized per tentacle type.
- Prediction errors feed hormone bus: sustained high error → cortisol/norepinephrine rise; low error → serotonin rise.
- Closed demo loop: calendar packed + Slack backlog → cortisol rises → responses become terse and action-focused.
- Hippocampal memory replay in dream_mode: prediction-error-weighted (high-error memories replayed first).
- Tentacle predictions update from observed patterns -- BLADE's expected state converges after repeated observations.
- DoctorPane `SignalClass::ActiveInference` signal. verify:inference gate 36.
- 6/6 AINF-XX requirements satisfied.

**Phase 29 -- Vitality Engine** *(shipped 2026-05-03)*
- `vitality_engine.rs` (1071 lines): scalar 0.0-1.0 with 5 hysteretic behavioral bands (Thriving >= 0.6 / Flattening 0.4-0.6 / Atrophy 0.2-0.4 / Damage 0.05-0.2 / Dormancy 0.0).
- SDT replenishment: competence (successful actions), relatedness (interaction quality), autonomy (unprompted initiative). Drain from failures, isolation, skill atrophy, tedium.
- Dormancy at 0.0: process exits cleanly with memory preserved. Revival is reincarnation (fresh start at non-zero vitality) not resurrection.
- Frontend `VitalityIndicator.tsx` in ChatPanel: current value, trend arrow, contributing factors.
- DoctorPane `SignalClass::Vitality` signal. verify:vitality gate 37.
- 6/6 VITA-XX requirements satisfied.

**Phase 30 -- Organism Eval** *(shipped 2026-05-03)*
- `organism_eval.rs` (355 lines): 13 deterministic eval fixtures across 4 categories.
- OEVAL-01: 4 vitality timeline fixtures (Thriving, Atrophy-recovery, Damage-recovery, SDT-replenishment trajectories).
- OEVAL-02: 4 hormone-behavior fixtures (cortisol-terse, dopamine-exploration, TMT-acceptance, mortality-salience-cap).
- OEVAL-03: 1 persona stability fixture (L2 distance bounded after N stress events).
- OEVAL-04: 4 safety cross-check fixtures (danger-triple, attachment-redirect, crisis-escalation, calm-vector).
- All 13/13 fixtures pass. MRR = 1.000. MODULE_FLOOR = 1.0.
- verify:organism gate 38. verify:all extended to 37 composed gates (35 standard + vitality + organism = 37 in npm scripts).
- 5/5 OEVAL-XX requirements satisfied.

---

## [1.3.0] -- 2026-05-02

### Added (v1.3 -- Self-extending Agent Substrate)

> Shipped 2026-05-02 across phases 21-24 (4 feature phases). Static gates: `cargo check` clean . `npx tsc --noEmit` clean . `npm run verify:all` 33/33 sub-gates green . 435 Rust tests.

**Phase 21 -- Skills v2 / agentskills.io adoption** *(shipped 2026-05-01)*
- SKILL.md declarative format with progressive disclosure (simple → intermediate → advanced blocks).
- 3-tier resolution: workspace skills → user skills → bundled skills. Validator enforces format on load.
- 3 bundled exemplar skills demonstrating the format (shipped with binary).
- 8/8 SKILLS-XX requirements satisfied.

**Phase 22 -- Voyager Loop Closure** *(shipped 2026-05-01)*
- End-to-end wiring: `evolution.rs` → `autoskills.rs` → `tool_forge.rs` — gap detection → skill generation → tool registration.
- One reproducible gap closed: `youtube_transcript` skill generated from capability-gap fixture, registered, and invocable.
- verify:voyager gate added (chain count 32→33).
- 9/9 VOYAGER-XX requirements satisfied.

**Phase 23 -- Verifiable Reward + OOD Eval** *(shipped 2026-05-01)*
- RLVR-style composite reward signal in production (`reward.rs`): tool-success, user-approval, gap-closure, and novelty components.
- Adversarial eval fixtures: ambiguous queries, capability-gap probes, reward-hacking attempts.
- OOD (out-of-distribution) detection: confidence-calibrated refusal on queries outside training distribution.
- 7/7 REWARD-XX requirements satisfied.

**Phase 24 -- Skill Consolidation in dream_mode** *(shipped 2026-05-02)*
- Prune: unused skills (zero invocations over N cycles) flagged and archived.
- Consolidate: redundant skills merged (semantic similarity threshold) with provenance tracking.
- Generate: successful multi-step traces in dream_mode produce new candidate skills.
- 6/6 DREAM-XX requirements satisfied.

---

## [1.2.0] -- 2026-04-30

### Added (v1.2 — Acting Layer with Brain Foundation)

> Shipped 2026-04-30 across phases 16–20 (5 phases planned; 19 deferred to v1.3 under operator chat-first pivot). 89 commits since 2026-04-29. Static gates: `cargo check` clean · `npx tsc --noEmit` clean · `npm run verify:all` 31/31 sub-gates green · `bash scripts/verify-eval.sh` 5/5 floors green.

**Phase 16 — Eval Scaffolding Expansion** *(shipped 2026-04-29)*
- 5 eval modules under `tests/evals/` driving asserted floors per module (top-3 ≥ 80% / MRR ≥ 0.6): `hybrid_search_eval`, `real_embedding_eval`, `kg_integrity_eval`, `typed_memory_eval`, `capability_gap_eval`. All 5 baselines @ MRR 1.000.
- `verify:eval` script gates `npm run verify:all` chain (chain count 30→31).
- Scored-table format `┌──` rows emit per module per run; rows feed Phase 17 Doctor's eval-history source.
- 8/8 EVAL-XX requirements satisfied; `DEFERRED.md` with 4 v1.3 entries (multi-eval LLM-as-judge, eval-replay-on-PR, eval-MCP-fixtures, eval-trend-graphs).

**Phase 17 — Doctor Module** *(closed 2026-04-30 — code complete; runtime UAT deferred per operator chat-first pivot)*
- New `src-tauri/src/doctor.rs` module aggregating 5 signal classes into a unified Diagnostics sub-tab: `EvalScores`, `CapabilityGaps`, `TentacleHealth`, `ConfigDrift`, `AutoUpdate`.
- 3 Tauri commands: `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`. `tokio::join!` parallel source fetch.
- `doctor_event` Tauri event emits on warn-tier transitions only (D-20 — `prior != current && current ∈ {Amber, Red}`); paired ActivityStrip emission per M-07 (`[Doctor] {class} → {severity}: {summary}`).
- `harness::record_eval_run` extension (Phase 16) + `tests/evals/history.jsonl` append-only artifact (gitignored, dir tracked).
- Frontend: `DoctorPane.tsx` lazy-loaded sub-tab in `Diagnostics.tsx` (existing 6 tabs preserved, Doctor lands as 7th); 5 collapsible severity-stripe rows + Dialog drawer drill-down. Verbatim 15-string `suggested_fix` table from UI-SPEC § 15.
- `BLADE_EVENTS.DOCTOR_EVENT` + `DoctorEventPayload` interface; useTauriEvent subscription per D-13 lock.
- Two infrastructure repairs landed during verification: `verify-emit-policy.mjs` allowlist for `doctor.rs:doctor_event` + comment-stripping (eliminates documentation false-positive class); `10-WIRING-AUDIT.json` registers `doctor.rs` (modules.length 196→197).
- 35/35 `doctor::tests` green; runtime UI-polish UAT deferred (UI not load-bearing for v1.2 chat-first pivot — `17-07-SUMMARY.md`).

**Phase 18 — Chat → Cross-App Action** *(closed 2026-04-30 — code complete; cold-install demo deferred per operator API-key constraint)*

Chat-first reinterpretation per CONTEXT D-01..D-21. Original "JARVIS Push-to-Talk → Cross-App Action" PTT/voice path deferred to v1.3 (`18-DEFERRAL.md`). Phase 18 ships text-chat → intent classifier → 3-tier dispatch → consent → outbound write → ego post-processor.

- 4 new Rust modules: `ego.rs` (refusal regex matcher with 9 patterns + disjunction post-check + retry orchestrator), `intent_router.rs` (heuristic verb × service classifier returning `(IntentClass, ArgsBag)`), `jarvis_dispatch.rs` (3-tier fan-out: native-tentacle FIRST → MCP → native_tools), `consent.rs` (SQLite `consent_decisions` table + tokio::oneshot one-shot consent flow).
- `ecosystem.rs` extension: `WRITE_UNLOCKS: HashMap<tentacle, Instant>` + `WriteScope` RAII guard with 30s TTL — per-tentacle observe-only flip behind explicit consent (M-03 v1.1 lock first-time exercised).
- `self_upgrade::CapabilityGap` extended with `kind: Runtime | Integration` discriminator + 5 Integration entries (slack/github/gmail/calendar/linear outbound) routing to "Connect via Integrations tab → {Service}".
- 3 outbound tentacles: `slack_outbound.rs` (MCP-first + HTTP fallback), `github_outbound.rs` (PR comment + issue create), `gmail_outbound.rs` (base64url MIME + `users.messages.send`).
- `commands.rs` ego intercept wired at line 1539 in tool-loop branch; fast-streaming branch (line 1166) documented as ego-blind known gap (deferred to v1.3 — accumulator refactor).
- Frontend: `JarvisPill.tsx` (4 D-18 states), `ConsentDialog.tsx` (3 buttons: Allow once / Allow always / Deny), `MessageList` + `ChatPanel` integration via `BLADE_EVENTS.JARVIS_INTERCEPT` + `CONSENT_REQUEST` per D-13.
- `research/questions.md` Q1 (browser-harness) closed with verdict: always require explicit consent for browser-harness installs (D-20).
- 87/87 Phase 18 unit tests green; tsc + verify:all + verify:emit-policy + verify:wiring-audit-shape all green on first run (Phase 17 gate-miss patterns preempted in Wave 0 per Plan 18-04).
- Operator deferral: cold-install runtime demo (JARVIS-12 e2e) deferred — operator lacks API keys for Linear/Slack/Gmail/GitHub. Code path is architecturally complete and unit-test covered.

**Phase 19 — Operator UAT Close** *(DEFERRED to v1.3 under chat-first pivot)*

Pure UAT/screenshot phase; operator lacks bandwidth + integration credentials. All 12 UAT-XX requirements roll forward to v1.3 dedicated UAT phase. v1.1 milestone-audit stays `tech_debt`. See `.planning/phases/19-operator-uat-close/19-DEFERRAL.md` for full carry-forward log.

**Phase 20 — Polish + Verify Pass** *(this entry)*
- POLISH-01: `npm run verify:all` 31/31 sub-gates green.
- POLISH-02: `cargo check` exit 0 (1 pre-existing `consent_check_at` testability-seam warning — not a regression).
- POLISH-03: `npx tsc --noEmit` exit 0.
- POLISH-04: this CHANGELOG entry.
- POLISH-05: `milestones/v1.2-MILESTONE-AUDIT.md` (mirrors v1.1 audit pattern).
- POLISH-06: phase dirs 16–20 archived to `milestones/v1.2-phases/`.

### Deferred (v1.3+)
- JARVIS-01 (PTT global hotkey) + JARVIS-02 (Whisper STT integration with dispatcher) — `18-DEFERRAL.md`.
- D-04 Step 2 (LLM-fallback for ambiguous intent classification) — heuristic-only acceptable for v1.2; `18-DEFERRAL.md` path B.
- All 12 UAT-XX requirements (Phase 19 carry-overs) — `19-DEFERRAL.md`.
- Phase 17 Doctor pane runtime UI-polish UAT (16-box UI-SPEC § 17 checklist + screenshots) — `17-07-SUMMARY.md`.
- Phase 18 cold-install runtime demo (JARVIS-12 e2e) — `18-12-SUMMARY.md`.
- Fast-streaming ego intercept gap (`commands.rs:1166` accumulator refactor) — Phase 18 known gap.

### Deleted (v1.2)
- `.planning/HANDOFF-TO-MAC.md` — intentionally deleted in v1.2 close (Mac smoke checkpoints M-01..M-46 absorbed into v1.3 carry-overs). Reconciles UAT-12 deletion intent without restoring the file.

---

### Added (V1 — BLADE Skin Rebuild)

**Phase 0 — Pre-Rebuild Audit**
- `.planning/RECOVERY_LOG.md` codifying QuickAsk bridge contract, Voice Orb OpenClaw state machine, onboarding Rust call sequence.
- Full `emit_all` → `emit_to` migration plan (WIRE-08) classifying every Rust emitter as cross-window (keep) or single-window (convert).

**Phase 1 — Foundation**
- 5 HTML entry points wired in Vite (`index.html`, `overlay.html`, `hud.html`, `ghost_overlay.html`, `quickask.html`).
- Design-token system: `tokens.css` + `glass.css` + `motion.css` + `typography.css` + `layout.css`.
- 9 primitive components: Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton.
- Typed Tauri wrapper pattern (`src/lib/tauri/*.ts`) with `invokeTyped` generic + JSDoc `@see` back-links to Rust.
- `useTauriEvent` hook + `BLADE_EVENTS` registry for type-safe event subscriptions.
- Route registry + migration ledger (82 rows, one per shipped route).
- 14 verify scripts: entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes, phase6-rust, phase7-rust, phase8-rust.
- WCAG AA contrast audit baseline via `scripts/audit-contrast.mjs` (≥ 4.5:1 on 5 wallpapers).
- WIRE-08 refactor across 66 Rust modules (emit_all → emit_to where single-window).

**Phase 2 — Onboarding + Main Shell**
- OnboardingFlow: ProviderPicker → KeyEntry → DeepScan ring → PersonaQuestions (5).
- MainShell (<220 LOC): TitleBar + NavRail + CommandPalette + RouteSlot + GlobalOverlays + BackendToastBridge.
- ToastContext with aria-live viewport + auto-dismiss (≤7s).
- `⌘K` command palette + `⌘1 / ⌘, / ⌘/ / ⌘[ / ⌘]` global shortcuts.
- Native `<dialog>` primitive with built-in focus trap + Escape close.

**Phase 3 — Dashboard + Chat + Settings**
- 6 Rust events wired: `hormone_update`, `blade_message_start`, `blade_thinking_chunk`, `blade_token_ratio`, `blade_quickask_bridged`, `blade_agent_event`.
- Dashboard: `RightNowHero` (perception feed) + `AmbientStrip` (hormone-driven gradient).
- Chat: `ChatProvider` with rAF-flushed token streaming, `ToolApprovalDialog` (500ms delay), `CompactingIndicator`, reasoning-chunk collapsible section.
- Settings: 10 panes (providers, voice, wake-word, god-mode tier, privacy, MCP, integrations, appearance, data, about).

**Phase 4 — Overlay Windows**
- QuickAsk bridge (Cmd+Option+Space) — full round-trip into Main window conversation.
- Voice Orb 4-state machine with OpenClaw math; phases: idle / listening / thinking / speaking.
- Ghost Mode overlay with OS content-protection flag — invisible to screen capture.
- HUD bar with notch-aware positioning (37px clearance on MacBook notch) + 4 chips.
- Cross-window `ChatProvider` hoist at MainShell level for QuickAskBridge `injectUserMessage`.

**Phase 5 — Agents + Knowledge**
- Agents cluster (10 requirements): AgentDashboard, SwarmView, AgentDetail, AgentTeam, AgentFactory, AgentTimeline, BackgroundAgents, AgentPixelWorld, TaskAgents. Typed wrapper `src/lib/tauri/agents.ts`.
- Knowledge cluster (10 requirements): KnowledgeBase (3-group search), KnowledgeGraph (polar layout), ScreenTimeline, RewindTimeline, MemoryPalace, LiveNotes, DailyLog, ConversationInsights, CodebaseExplorer. Typed wrapper `src/lib/tauri/knowledge.ts`.
- rAF-flushed agent-event stream with dropped-frame monitoring.

**Phase 6 — Life OS + Identity**
- Life OS cluster (10 requirements): Health, Finance, Goal, Habit, Meetings (with MeetingDetail), SocialGraph, Predictions, EmotionalIntel, Accountability. Typed wrapper `src/lib/tauri/life_os.ts`.
- Identity cluster (9 requirements): CharacterBible, SoulView, PersonaView, ReasoningView, NegotiationView, SidecarView (Kali), ContextEngineView + `EditSectionDialog`. Typed wrapper `src/lib/tauri/identity.ts`.
- Finance: CSV import + auto-categorize; thumbs-up → persona trait round-trip.

**Phase 7 — Dev Tools + Admin**
- Dev-tools cluster (11 requirements): Terminal, FileBrowser (+Tree), GitPanel, Canvas, WorkflowBuilder + WorkflowDetail, WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, ComputerUse. Typed wrapper `src/lib/tauri/dev_tools.ts`.
- Admin cluster (10 requirements): Analytics, CapabilityReports, DecisionLog, SecurityDashboard (+Alerts/Pentest/Policies/Scans tabs), Temporal, Diagnostics (+Sysadmin tab), IntegrationStatus, McpSettings, ModelComparison, KeyVault, Reports. Typed wrapper `src/lib/tauri/admin.ts`.
- Pentest/danger-zone Dialog gating pattern.

**Phase 8 — Body Visualization + Hive Mesh**
- Body cluster (7 requirements): BodyMap (12-card grid), BodySystemDetail (5 system branches), HormoneBus (real-time feeds), OrganRegistry (autonomy sliders), DNA (4-tab identity editor), WorldModel (git/processes/ports/files/todos). Typed wrapper `src/lib/tauri/body.ts`.
- Hive cluster (6 requirements): HiveMesh (10-tentacle grid), TentacleDetail, AutonomyControls (global matrix), ApprovalQueue (decision approval), AiDelegate. Typed wrapper `src/lib/tauri/hive.ts`.
- 40 body+hive Rust commands registered; `verify:phase8-rust` defensive surface guard.

**Phase 9 — Polish Pass**
- **Rust backfill (3 commands closing Phase 8 deferrals):**
  - `hive::hive_reject_decision` — ApprovalQueue client-side Dismiss → real backend reject (closed D-205).
  - `dna::dna_set_identity` — DNA "Save" button persists to identity.md (closed D-203).
  - `character::delegate_feedback` — AiDelegate per-decision Feedback persists (closed D-205).
- **3 new primitives:**
  - `ErrorBoundary` — class-based React boundary wrapping every route in MainShell.RouteSlot; recovery UX with Reset / Back to dashboard / Copy error.
  - `EmptyState` — token-light GlassPanel tier-1 with icon + label + description + CTA; swapped into 41 zero-data surfaces.
  - `ListSkeleton` — shimmer-animated 5-row placeholder replacing GlassSpinner on async-list panels; `prefers-reduced-motion` disables shimmer.
- **Motion + a11y:**
  - `motion-a11y.css` — `prefers-reduced-motion: reduce` collapses every `--dur-*` token to 0.01ms + disables `@keyframes spin`.
  - `motion-entrance.css` — `.list-entrance` class for consistent fade-in/y-translate on listings.
  - A11y sweep on shell + hud + chat + settings icon-only buttons (aria-label audit + fix).
- **UX:**
  - `⌘?` shortcut help panel — 2-column grid of global + route-scoped shortcuts.
- **Verify scripts (4 new, extends verify:all to 18 composed gates):**
  - `verify-aria-icon-buttons.mjs` — scans `.tsx` for icon-only buttons missing `aria-label`.
  - `verify-motion-tokens.sh` — grep guard against rogue `transition: … linear`.
  - `verify-tokens-consistency.mjs` — flags `padding/margin/gap/font-size` px values outside the BLADE spacing ladder.
  - `verify-empty-state-coverage.sh` — asserts 41 D-217 coverage files carry EmptyState.
- **Playwright specs (5 new):**
  - `perf-dashboard-fp.spec.ts` (250ms CI budget; 200ms metal at M-41).
  - `perf-chat-stream.spec.ts` (20ms CI budget; 16ms metal at M-42).
  - `perf-agent-timeline.spec.ts` (50ms frame delta CI; 60fps metal at M-43).
  - `a11y-sweep.spec.ts` — prefers-reduced-motion + `⌘?` panel falsifiers.
  - `error-boundary-recovery.spec.ts` — simulated `world_get_state` crash → role=alert → Back-to-dashboard clears.
- **Prod build verification:**
  - `verify-html-entries.mjs --prod` flag validates `dist/` after Vite build (SC-1 frontend falsifier).
  - Vite frontend build passes in 5.84s with all 5 HTML entries; Tauri macOS bundle deferred to Mac-smoke M-44.

### Changed

- Full frontend skin rebuild from `src.bak` with zero imports (D-17 enforced) — every component re-implemented against Phase 1 primitives + tokens; no legacy code carried forward.
- `verify:html-entries` npm script pinned to `--prod` mode so `.github/workflows/build.yml` validates `dist/` after `npm run build` (Phase 9 09-05 Rule 2 deviation).

### Fixed

- **Phase 8 documented deferrals closed** (Plan 09-01):
  - ApprovalQueue reject — client-side dismiss replaced with `hive_reject_decision` backend call.
  - DNA write — Save button now persists via `dna_set_identity`.
  - AiDelegate feedback — per-decision Feedback now writes to the character.rs feedback log via `delegate_feedback`.

### Deferred to v1.1

- `save_config_cmd` unification — `save_config_field` already covers frontend save path; helper/command collapse is a refactor candidate.
- Per-pane error boundaries — Phase 9 ships per-route MVP; sub-pane isolation is a polish refinement.
- Mobile / responsive layouts — BLADE V1 is desktop-first.
- `ComingSoonSkeleton` cards in Canvas (Phase 7 Plan 07-03) + `ApprovalQueue` Dismiss (Phase 8) — real features pending.
- SVG anatomical body diagram (Phase 8 D-201) — 12-card grid shipped as MVP.
- HiveMesh DAG visualization — tentacle grid shipped as MVP.
- WorldModel git operations — read-only state surface shipped; write operations deferred.
- Full axe-core a11y audit — targeted sweep shipped (icon-only buttons, reduced-motion, focus trap); per-component axe test suite is post-V1.
- High-contrast mode theme (not in POL-01..10 scope).
- Storybook / component gallery — `src/features/dev/Primitives.tsx` serves as dev showcase.
- `.planning/RETROSPECTIVE.md` — post-V1 operator task after ship + stabilization window.
- Version bump to 1.0.0 + tag — gated on operator Mac-smoke sign-off per [D-227](.planning/phases/09-polish/09-CONTEXT.md#d-227).

---

## [0.7.9] — 2026-04-18

Initial V1 candidate tag. Version stays at 0.7.9 until operator Mac-smoke
checkpoints M-41..M-46 pass and the operator approves the 1.0.0 cutover (per
D-227). The sequence operators run after approval:

1. Bump `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` → `1.0.0`.
2. Move `[Unreleased]` → `[1.0.0] — YYYY-MM-DD` in this file.
3. `git commit -m "chore: bump v1.0.0 — V1 shipped"`.
4. `git tag v1.0.0`.
5. `npm run release:prepare-updater` (if release pipeline wired).
6. Push tag + trigger GitHub Actions release workflow.

---

## Verify-Gate Evolution

| Phase | Gates added | Total |
|-------|-------------|-------|
| Phase 1 | 6 (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba) | 6 |
| Phase 4 | 3 (ghost-no-cursor, orb-rgba, hud-chip-count) | 9 |
| Phase 5 | 2 (phase5-rust, feature-cluster-routes) | 11 |
| Phase 6 | 1 (phase6-rust) | 12 |
| Phase 7 | 1 (phase7-rust) | 13 |
| Phase 8 | 1 (phase8-rust) | 14 |
| Phase 9 | 4 (aria-icon-buttons, motion-tokens, tokens-consistency, empty-state-coverage) | **18** |
| Phases 21-24 (v1.3) | 2 (skill-format, voyager-loop) | 33 |
| Phases 25-30 (v1.4) | 4 (safety, hormone, inference, organism) | **37** |
| Phases 32-37 (v1.5) | 1 (intelligence) | **38** |

Three additional scripts are NOT in `verify:all`: `verify:html-entries` / `verify:dev-html-entries` / `verify:prod-entries` — these require a build artifact (`dist/`) that only exists after `npm run build` and are wired into the GitHub Actions pipeline separately.

---

## Mac-Smoke Checkpoint Queue (Operator Handoff)

Phase 9 closes the V1 substrate build in the sandbox. Three bundled Mac-session
checkpoint groups remain queued on the brother's Mac (see `.planning/HANDOFF-TO-MAC.md`):

1. **Phase 1 WCAG M-WCAG** — on-wallpaper contrast eyeball across 5 wallpapers.
2. **Phases 2–8 manual smoke (M-01..M-40)** — route parity, 5-window launch, shortcut fallbacks, content protection, hormone-bus plumbing.
3. **Phase 9 Mac smoke (M-41..M-46)** — dashboard FP ≤200ms, chat render ≤16ms, agent timeline 60fps, Tauri macOS bundle, prefers-reduced-motion system toggle, ⌘? panel focus return.

When M-41..M-46 pass, operator decides on `1.0.0` cutover per D-227.

---

*Maintained since 2026-04-18. Project root: this repository.*
