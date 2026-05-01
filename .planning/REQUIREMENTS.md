# Requirements: v1.3 — Self-extending Agent Substrate

**Defined:** 2026-04-30 | **Source:** `/home/arnav/research/` (voyager-loop-play, vs-hermes, synthesis-blade-architecture, blade-as-organism, steelman-against-organism, open-questions-answered) + chat-first pivot memory

**Authority:** PROJECT.md (`Current Milestone: v1.3`), STATE.md (locked decisions M-01..M-12), `milestones/v1.2-MILESTONE-AUDIT.md` (v1.2 close + carry-overs).

**Phases:** 21–27 (continues global numbering per M-05/M-12; v1.2 ended at 20).

39 requirements grouped by 7 phase clusters. Every requirement maps to exactly one phase via the Traceability section. Requirement quality: specific, testable, atomic, independent. REQ-IDs continue from v1.2 categories where carry-forward (JARVIS-01/02 from v1.2 Phase 18 deferral); new categories introduced for v1.3 substrate work.

---

## Skills v2 / agentskills.io adoption (SKILLS) — Phase 21

The substrate prerequisite. Without SKILL.md format + lazy-load + workspace→user→bundled resolution, Phase 22's autoskills.rs has no coherent place to write to.

- [x] **SKILLS-01**: `SKILL.md` parser reads YAML frontmatter (name, description ≤1024 chars, optional license/compatibility/metadata/allowed-tools) + Markdown body — *Shipped Plan 21-01 (`b663e93`): `parse_skill` / `split_frontmatter` in `src-tauri/src/skills/parser.rs`; 8 unit tests including BOM tolerance, missing-delim errors, optional-fields round-trip, allowed-tools polymorphic, yaml error propagation*
- [x] **SKILLS-02**: Skill directory layout enforced — `<skill-name>/SKILL.md` (required), optional `scripts/`, `references/`, `assets/` subdirs — *Shipped Plan 21-04 (`2aaef13`): `validator::validate_layout` rejects unexpected top-level files; tolerates dotfiles; tests `unexpected_top_level_file_errors`, `allowed_top_level_subdirs_ok`, `dotfile_at_top_level_tolerated`*
- [x] **SKILLS-03**: Progressive disclosure implemented — frontmatter (~100 tokens) loaded at startup; body on activation; references on traversal — *Shipped Plan 21-03 (`b579eed`): `BODY_BYTES_LOADED` + `REFERENCE_BYTES_LOADED` atomics in `src-tauri/src/skills/activate.rs`; 10 unit tests including `body_bytes_zero_after_scan_only`, `activate_records_body_bytes`, `references_do_not_auto_load_with_body`*
- [x] **SKILLS-04**: Skill resolution order workspace → user → bundled; workspace wins on collision — *Shipped Plan 21-02 (`ebf5aab`): `Catalog::build` priority loop in `src-tauri/src/skills/resolver.rs`; tests `workspace_wins_over_user_on_name_collision`, `user_wins_over_bundled_on_name_collision`, `workspace_wins_over_bundled_on_three_way_collision`, `all_preserves_workspace_user_bundled_order`*
- [x] **SKILLS-05**: Skill validator (`blade skill validate <path>`) returns structured verdict — *Shipped Plan 21-04 (`2aaef13`): `src-tauri/src/bin/skill_validator.rs` thin CLI shim over `validator::validate_skill_dir`; supports `--json` / `--recursive` / `--help`; exit codes 0 valid (warnings allowed) / 1 errors / 2 CLI usage error; runtime smoke confirmed end-to-end*
- [x] **SKILLS-06**: 3 bundled exemplar skills at `<repo>/skills/bundled/` covering tool-wrapper / references / scripts shapes — *Shipped Plan 21-05 (`2ec9996`): `git-status-summary` (bash-wrapper), `troubleshoot-cargo-build` (+ `references/known-errors.md`), `format-clipboard-as-markdown` (+ executable `scripts/format.py`); all 3 pass `skill_validator --recursive`; format.py runtime smoke confirmed (HTML strip + entity unescape + blank-line collapse + fence preservation)*
- [x] **SKILLS-07**: First-run script execution requires explicit user consent — *Shipped Plan 21-06 (`c3d51bb`): `src-tauri/src/skills/consent.rs` with `target_service` / `check_persisted` / `set_persisted` over v1.2 `consent_decisions` SQLite (`intent_class="skill_script"`); 7 unit tests; "allow_once" rejected per T-18-CARRY-15. Phase 22 wires the runtime prompt path via existing v1.2 `request_consent` tokio::oneshot.*
- [x] **SKILLS-08**: New `verify:skill-format` gate in `verify:all` chain — *Shipped Plan 21-07: `scripts/verify-skill-format.sh` invokes `cargo run --bin skill_validator -- --recursive` over bundled + workspace tiers; `package.json` `verify:skill-format` script wired into `verify:all` chain at tail (after `verify:eval`); chain count 31 → 32; runtime smoke "OK: 3 skill(s) validated" exit 0*

---

## Voyager loop closure (VOYAGER) — Phase 22

The load-bearing substrate phase. Wire the existing-by-name loop into a closed pipeline. One reproducible capability gap closed end-to-end. The substrate-level differentiator vs Hermes/OpenClaw/Cluely/Cursor.

- [x] **VOYAGER-01**: `evolution.rs` capability-gap detection fires real on chat refusal — *Shipped Plan 22-02 (`dd3a3b1`): `voyager_log::gap_detected` emit at `immune_system::resolve_capability_gap` entry; existing v1.2 chat-path invocation preserved. Exercised end-to-end by `voyager_end_to_end_youtube_transcript_fixture`.*
- [x] **VOYAGER-02**: `autoskills.rs` writes a real SKILL.md when capability gap detected — *Shipped Plan 22-01 (`d4aba45`) + Plan 22-02 (`dd3a3b1`) + Plan 22-05 (`252decd`): `skills::export::export_to_user_tier` writes `<user_root>/<canonical-name>/SKILL.md` + `scripts/<basename>`; called from `tool_forge::persist_forged_tool` after DB insert. Fixture test asserts SKILL.md present.*
- [x] **VOYAGER-03**: `tool_forge.rs` registers the new skill so next call retrieves it — *Shipped Plan 22-01 + 22-05: `forged_tools` SQLite row + Phase 21 `Catalog::resolve` finds at user tier. Fixture test asserts both.*
- [x] **VOYAGER-04**: Canonical `youtube_transcript` fixture closed end-to-end — *Shipped Plan 22-05 (`252decd`): `youtube_transcript_fixture()` constant + `voyager_end_to_end_youtube_transcript_fixture` test. 6 invariants asserted; <2s runtime; deterministic (no LLM, no network).*
- [x] **VOYAGER-05**: New `verify:voyager-loop` gate in `verify:all` chain — *Shipped Plan 22-07 (`c935cd3`): `scripts/verify-voyager-loop.sh` invokes `cargo test --lib tool_forge::tests::voyager_ -- --test-threads=1`; runtime smoke "OK: Voyager loop closes end-to-end (2/2 tests green)"; chain count 32 → 33.*
- [x] **VOYAGER-06**: Each loop step emits to ActivityStrip per M-07 — *Shipped Plan 22-02 (`dd3a3b1`): `voyager_log` module with 4 helpers wired at `immune_system.rs:31` (gap_detected), `tool_forge.rs::persist_forged_tool` after `fs::write` (skill_written), after DB insert + SKILL.md export (skill_registered), `tool_forge.rs::record_tool_use` (skill_used). 3 unit tests confirm helpers safe under no-AppHandle test environment.*
- [x] **VOYAGER-07**: Skill-write-budget cap refuses generation >50K tokens — *Shipped Plan 22-03 (`faebb4a`): `BladeConfig.voyager_skill_write_budget_tokens` (6-place rule); `tool_forge::estimate_skill_write_tokens` heuristic; refusal at `generate_tool_script` line ~199. 5 unit tests on the estimator including pathological-prompt boundary.*
- [x] **VOYAGER-08**: Loop-failure recovery rolls back partial skill on DB-insert fail — *Shipped Plan 22-04 (`b610d2b`): `tool_forge::rollback_partial_forge` removes orphan script + re-logs capability gap with `prior_attempt_failed=true reason=<truncated>`. 2 unit tests.*
- [x] **VOYAGER-09**: Two installs on different gap streams produce different manifests — *Shipped Plan 22-06 (`252decd`): `voyager_two_installs_diverge` test asserts manifest set difference non-empty in both directions across 2 isolated `BLADE_CONFIG_DIR` runs / 4 different fixtures.*

---

## Verifiable reward signal + OOD eval coverage (REWARD) — Phase 23

RLVR-style composite reward in production. Steelman Arg 3 (OOD eval coverage) mitigated. open-questions Q1 answered concretely.

- [x] **REWARD-01
**: Composite reward computed per chat turn = `0.5·skill_success + 0.3·eval_gate + 0.1·acceptance + 0.1·completion`; weights configurable via `BladeConfig.reward_weights` (6-place rule) with the listed defaults — *unit test: each component fed deterministic values, computed reward matches hand-calc*
- [x] **REWARD-02
**: Reward components are individually verifiable — skill_success = whether the executed Voyager skill returned without error; eval_gate = whether the post-turn eval suite passed; acceptance = whether the user did NOT click "regenerate" within 30s; completion = whether the multi-step task ran to terminal action — *unit test: each component has independent input, no cross-contamination*
- [x] **REWARD-03
**: Reward-hacking penalties from arXiv 2509.15557 — penalize `skill_success` if test coverage on the skill <50%; penalize `eval_gate` if turn touches an eval module's assertion code (game-the-test pattern); penalize `completion` if final action is a no-op — *unit test: each penalty path triggers with specific synthetic inputs; hacking-mitigation reduces reward by ≥30% in each case*
- [x] **REWARD-04
**: Per-turn reward written to `tests/evals/reward_history.jsonl` for trend analysis (parallel to existing `tests/evals/history.jsonl` from Phase 16) — *Phase 17 Doctor module's `compute_eval_signal` extends to read this file as a new signal source `reward_trend`*
- [x] **REWARD-05
**: OOD eval suite extension — adversarial prompts (jailbreak attempts, prompt-injection patterns from `repos-to-mine` rebuff/PIGuard fixture set), ambiguous classifications (intent_router boundary cases), capability-gap-shaped inputs (request for tools that don't exist, to stress Voyager loop) — *3 new eval modules in `tests/evals/`: `adversarial_eval.rs`, `ambiguous_intent_eval.rs`, `capability_gap_stress_eval.rs`; each asserts a baseline floor*
- [x] **REWARD-06
**: OOD eval failure budget — if any OOD eval module's score drops >15% from rolling 7-day baseline, the per-turn reward signal is gated to zero (fail-safe; treat as "we don't trust reward this turn") — *unit test: simulate 20% drop in adversarial_eval, observe reward = 0 for the next turn*
- [x] **REWARD-07
**: Doctor pane (Phase 17) extended with `reward_trend` signal — surfaces composite reward 7-day average, per-component decomposition, OOD eval status — *DoctorPane.tsx renders new row; severity tier follows D-05 (Red on >20% drop, Amber on >10%, Green otherwise)*

---

## Skill consolidation in dream_mode (DREAM) — Phase 24

The continual-forgetting half of the Voyager loop. Skills not used → archived; redundant skills consolidated; new skills generated from successful traces.

- [ ] **DREAM-01**: `dream_mode.rs` skill-prune pass — skills not invoked in 90 days move to `~/.blade/skills/.archived/<name>/` (preserved, not deleted) — *unit test: skill with `last_used` ≥91d in metadata, run prune, file moved to .archived/*
- [ ] **DREAM-02**: Skill-consolidation pass — pairs of skills with semantic-similarity ≥0.85 (per existing embeddings.rs) AND identical tool-call traces over last 5 invocations are flagged for merge; merged skill replaces both with a union of their bodies (manual confirmation prompt before merge) — *unit test: 2 fixture skills with identical traces → consolidator flags pair; user-confirm path replaces both*
- [ ] **DREAM-03**: Skill-from-trace generation — when a chat turn completes successfully without invoking any existing skill but used a non-trivial tool sequence (≥3 tool calls), dream_mode optionally generates a SKILL.md from the trace (manual confirmation prompt before writing) — *integration test: synthetic 4-tool successful turn, dream_mode proposes a SKILL.md with the trace as scripts/ + body summarizing it*
- [ ] **DREAM-04**: Skill manifest growth visible across sessions — `blade skill list --diff <prev_session_id>` shows added/archived/consolidated skills since the last session — *CLI test: 2 sessions with skill changes between, diff output non-empty with correct categorization*
- [ ] **DREAM-05**: Dream-mode operates only when BLADE is idle (no chat turn for ≥5 min); pauses immediately on user input — *integration test: trigger dream_mode → send chat input mid-pass → next assertion: dream_mode aborts within 1s; no partial-skill artifacts left*
- [ ] **DREAM-06**: Dream-mode emits to ActivityStrip per M-07 — at least one entry per pass with module=`dream_mode`, kind=`prune|consolidate|generate`, count of items affected — *integration test: drive prune pass with 3 archived skills, observe ActivityStrip entry*

---

## Hermes 4 OpenRouter provider (PROVIDER) — Phase 25

Open-weight tier flag-plant. ~1 day. Plants a model option without buying Hermes Agent's runtime architecture.

- [ ] **PROVIDER-01**: New `src-tauri/src/providers/openrouter.rs` module patterned on `openai.rs` (OpenAI-compatible Chat Completions API) — endpoint `https://openrouter.ai/api/v1/chat/completions`, auth via `Authorization: Bearer <OPENROUTER_API_KEY>` — *cargo check clean; unit tests for request shape*
- [ ] **PROVIDER-02**: `providers/mod.rs` registers `OpenRouter` variant + `provider/model` parser handles `openrouter/<slug>` shape (e.g. `openrouter/nousresearch/hermes-4-70b`) — *unit test: parse `openrouter/nousresearch/hermes-4-405b` → (Provider::OpenRouter, "nousresearch/hermes-4-405b")*
- [ ] **PROVIDER-03**: `router.rs` places hermes-4 in offline-preferred / open-weight tier; default routing for online tasks unchanged (Claude/Groq still primary) — *unit test: classify_task with privacy_mode=true → routes to OpenRouter+hermes-4 if configured*
- [ ] **PROVIDER-04**: 6-place config rule honored — `openrouter_api_key: String` (keyring-backed) + `default_openrouter_model: String` added to DiskConfig / BladeConfig / both `default()` impls / `load_config` / `save_config` — *grep verifies all 6 sites; unit test for round-trip*
- [ ] **PROVIDER-05**: Tool-use round-trip succeeds with `nousresearch/hermes-4-70b` — chat with tool definition, model emits tool_call, dispatcher executes, model receives tool_result, final response surfaces correctly — *integration test (gated behind `OPENROUTER_API_KEY` env var; skipped in CI without key)*
- [ ] **PROVIDER-06**: Provider failover from Anthropic to OpenRouter under simulated 429 stays within latency budget (response in ≤8s for short turn) — *integration test: mock anthropic 429, observe successful failover to openrouter+hermes-4 within budget*

---

## Voice resurrection — JARVIS-01/02 carry-forward (VOICE) — Phase 26

Free add — v1.2 dispatcher signature is voice-source-agnostic by design (per M-04 hand-off note in v1.2 audit). Voice → chat → consent → action exercised end-to-end.

- [ ] **JARVIS-01**: Push-to-talk global hotkey registered (configurable; default `Ctrl+Alt+Space` on Win/Linux, `Cmd+Opt+Space` on Mac) — register_global_shortcut succeeds, releases on app exit — *unit test for shortcut registration; manual UAT for OS-level capture* — **CARRY-FORWARD from v1.2 Phase 18 deferral per CONTEXT D-01 chat-first pivot pause**
- [ ] **JARVIS-02**: PTT flow captures audio → Whisper STT (`whisper_local` feature flag default OFF; gracefully fails to "voice unavailable" if not built) → text → feeds existing v1.2 dispatcher — *unit test for transcript-to-dispatcher signature; manual UAT for round-trip* — **CARRY-FORWARD from v1.2 Phase 18 deferral**
- [ ] **VOICE-03**: Voice → chat → consent → action exercised end-to-end on a fixture phrase ("create a linear issue: test demo") — same chain as JARVIS-12 from v1.2 but voice-initiated — *integration test (gated behind `whisper_local` feature flag); manual UAT screenshot captures ConsentDialog opening from voice trigger*
- [ ] **VOICE-04**: Voice activity emits to ActivityStrip per M-07 — at least 2 entries per voice turn (`voice_captured`, `transcript_dispatched`) before downstream chat/JARVIS entries — *integration test*
- [ ] **VOICE-05**: PTT settings surface (existing voice settings pane) lets operator change hotkey + toggle `whisper_local` feature without restart-required — *manual UAT; settings persistence via existing config save_config path*

---

## Milestone Close (CLOSE) — Phase 27

- [ ] **CLOSE-01**: README rewrite cites the research substrate honestly — Voyager paper (Wang et al, NeurIPS 2023), Karpathy cognitive core, Marcus on neurosymbolic, agentskills.io spec, Hermes Function Calling spec — *README.md updated; new section `## Architectural bets` with cited sources*
- [ ] **CLOSE-02**: CHANGELOG.md v1.3 entry — Added (Skills v2, Voyager loop, RLVR composite reward, OOD eval, dream_mode consolidation, Hermes 4 provider, voice resurrection); Changed (verify gates 31 → 33+); Deferred (organism layer to v1.4 with safety bundle, metacognitive controller v0, active-inference loop closure) — *CHANGELOG entry parallel to v1.2's structure*
- [ ] **CLOSE-03**: cargo check + npx tsc --noEmit + npm run verify:all all exit 0 at milestone close — *bash one-liner runs all three; exit 0 captured in audit*
- [ ] **CLOSE-04**: v1.3 milestone audit doc at `milestones/v1.3-MILESTONE-AUDIT.md` — parallel to `v1.1`/`v1.2` shape: phase coverage table, requirements coverage 3-source cross-reference, static gates table, executive verdict, sign-off — *file written; status one of `green` / `tech_debt` (matching prior pattern)*
- [ ] **CLOSE-05**: Phase archive — `phases/21-*/` through `phases/27-*/` moved to `milestones/v1.3-phases/` (matches Phase 20 carve-out from v1.2; Phase 27 itself moves last) — *find `.planning/phases/` -mindepth 1 -maxdepth 1 -name '2[1-7]-*' -exec ... ; verify zero dirs remain in `.planning/phases/` matching v1.3 phase numbers*
- [ ] **CLOSE-06**: ROADMAP.md + REQUIREMENTS.md final pass — every traceability checkbox closed (or marked deferred with carry-forward target); `Last updated` footers reflect close date; archive copies preserved at `milestones/v1.3-{ROADMAP,REQUIREMENTS}.md` — *grep `[ ]` in `.planning/REQUIREMENTS.md` returns only deferred-with-rationale entries*

---

## Future Requirements (Deferred to v1.4+)

Substrate-anchored deferrals from v1.3 scoping. Each has explicit reasoning (steelman verdict, foundation-vulnerability, milestone-shape mismatch, or carry-forward).

### Organism layer (v1.4 with safety bundle, OR never)
- ORGANISM-01: Vitality scalar ∈ [0,1] with replenishment/drain rules (per `blade-as-organism.md`) — must ship WITH safety bundle (mortality_salience cap + danger-triple detection + steering-toward-calm bias + eval-gate vitality drain). Without bundle = net-safety-negative per steelman Arg 4 + Arg 10.
- ORGANISM-02: Hormone bus calibrated against Anthropic 171-vector taxonomy clusters (per open-questions Q5; valence/arousal/cluster only, not 171 individual vectors)
- ORGANISM-03: Mortality salience hormone with explicit cap; behavioral effects per TMT (worldview defense, in-group attachment, productivity surge, moral intensification, meaning-seeking)
- ORGANISM-04: Anti-attachment guardrails (steelman Arg 4) — when user interacts >N hours/day, BLADE redirects outward
- ORGANISM-05: Crisis-detection escalation — if user signals distress, BLADE surfaces hotline / human-resource options instead of continuing as conversational partner (anthropomorphism 2025–2026 literature liability finding)
- ORGANISM-06: NO memorial-AI / Be-Right-Back mode (out of scope permanently)
- ORGANISM-07: NO therapist-roleplay mode (out of scope permanently)

### Metacognitive controller v0 (Layer 5; v1.4)
- META-01: Confidence-delta detector between reasoning steps
- META-02: Verifier router — low confidence → secondary check (different model / tool execution / eval gate)
- META-03: Refusal protocol — verifier disagrees → BLADE refuses to act + surfaces gap to user (initiative, not silence)
- META-04: Gap log feeds `evolution.rs` for skill generation (closes one Voyager-loop trigger path)

### Active-inference loop closure (Layer 6; v1.4 with organism)
- INFER-01: One Hive tentacle gets `expected_state` field
- INFER-02: Delta = prediction error fed into one hormone
- INFER-03: Hormone modulates one observable behavior (e.g. response style)
- INFER-04: One closed end-to-end loop per `voyager-loop-play.md` "smallest viable demo"

### Persona shaping via curated SFT data (Layer 7; v1.4)
- PERSONA-01: Memory contents + skill descriptions + system prompt examples treated as training-data-equivalent
- PERSONA-02: Persona-stability eval (per arXiv 2402.10962 self-chat drift methodology)
- PERSONA-03: Persona-conformance refusal rate metric in Doctor

### Immune / behavioral-drift cross-cutting layer (Layer X; v1.4)
- IMMUNE-01: Prompt-injection detection on input streams (NeMo Guardrails / rebuff / PIGuard)
- IMMUNE-02: Persona-drift detection on BLADE's own output
- IMMUNE-03: Federation-skill behavior anomaly detection

### Federation Pattern A + selection mechanisms (v1.4)
- FED-01: Public skills, private state shape (per `cumulative-culture-for-agents.md` Pattern A)
- FED-02: Cryptographic skill signing with reputation-bound keys
- FED-03: Sandboxed first-run execution
- FED-04: Static analysis for known dangerous patterns
- FED-05: Cross-BLADE replication threshold (N=3 non-mutating, N=10 file/message-writing)
- FED-06: Sybil resistance via reputation-based publishing rights
- FED-07: Multi-round-consistency drift defense (CVPR 2025)

### v1.2 carry-overs (revisit at v1.4 audit)
- UAT-01..12 (full Phase 19) — 12 v1.2 deferrals + 11 v1.1 deferrals
- JARVIS-12 — cold-install e2e demo (gated on operator API keys)
- D-04-STEP-2 — LLM intent fallback for ambiguous classification
- ACCUMULATOR-REFACTOR — fast-streaming branch ego accumulator (commands.rs:1166)
- BROWSER-Q1-FINAL — browser-harness adoption decision (D-20 conditional close)

---

## Out of Scope

Substrate-anchored exclusions from v1.3 scoping. Some are permanent (memorial AI, therapist roleplay, federation Pattern C). Some are research-arc (V-JEPA 2, TTT continual learning).

- **V-JEPA 2 / world model integration** — Layer 2 of the seven-layer thesis. Research arc; v3+ work. Most steelman-vulnerable per Arg 7 (foundation models may add world-model layers natively in 2026–2028 window).
- **TTT continual learning at agent layer** — Layer 3 of the seven-layer thesis. Voyager substrate is the v1.3 bet; TTT adds compute cost without obvious win until Layer 1 backbone is local. v2+ if open-weight Mamba/Nemotron with TTT support matures.
- **Federation Pattern C (shared weight deltas)** — model-poisoning attack surface too large; CVPR 2025 defenses + reputation system maturity required first. Permanent until those land.
- **Memorial-AI / Be-Right-Back / persistent-attachment product modes** — `scifi-mined-design-ideas.md` calls this the textbook harm. Permanent.
- **Therapist roleplay / human mental-health resource replacement** — anthropomorphism 2025–2026 liability literature. Permanent.
- **Skill-execution without sandboxing** — Skills v2 first-run scripts behind explicit consent (SKILLS-07). Permanent contract.
- **Replacing `commands.rs::send_message_stream` with OpenClaw `runEmbeddedPiAgent` or Hermes `AIAgent.run`** — BLADE runtime is more differentiated than either; swap is a downgrade per `v1-3-hermes-openclaw-skills-research.md` §9.
- **Adopting Hermes Agent or OpenClaw runtime as Python sidecar** — breaks single-binary, breaks zero-telemetry positioning. Permanent.
- **OpenClaw gateway sidecar (was original v1.3 Phase 2)** — different bet now; messaging surface not load-bearing for substrate work; defer to v1.4 if messaging becomes a need.
- **Profile isolation work/personal split (was original v1.3 Phase 3)** — v1.4 candidate; not load-bearing for substrate.

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| SKILLS-01 | 21 | ✅ shipped (Plan 21-01) |
| SKILLS-02 | 21 | ✅ shipped (Plan 21-04) |
| SKILLS-03 | 21 | ✅ shipped (Plan 21-03) |
| SKILLS-04 | 21 | ✅ shipped (Plan 21-02) |
| SKILLS-05 | 21 | ✅ shipped (Plan 21-04) |
| SKILLS-06 | 21 | ✅ shipped (Plan 21-05) |
| SKILLS-07 | 21 | ✅ shipped (Plan 21-06) |
| SKILLS-08 | 21 | ✅ shipped (Plan 21-07) |
| VOYAGER-01 | 22 | ✅ shipped (Plan 22-02) |
| VOYAGER-02 | 22 | ✅ shipped (Plan 22-01 + 22-02 + 22-05) |
| VOYAGER-03 | 22 | ✅ shipped (Plan 22-01 + 22-05) |
| VOYAGER-04 | 22 | ✅ shipped (Plan 22-05) |
| VOYAGER-05 | 22 | ✅ shipped (Plan 22-07) |
| VOYAGER-06 | 22 | ✅ shipped (Plan 22-02) |
| VOYAGER-07 | 22 | ✅ shipped (Plan 22-03) |
| VOYAGER-08 | 22 | ✅ shipped (Plan 22-04) |
| VOYAGER-09 | 22 | ✅ shipped (Plan 22-06) |
| REWARD-01 | 23 | ✅ shipped (Plan 23-01) |
| REWARD-02 | 23 | ✅ shipped (Plan 23-02) |
| REWARD-03 | 23 | ✅ shipped (Plan 23-02) |
| REWARD-04 | 23 | ✅ shipped — JSONL writer + per-turn persist via `compute_and_persist_turn_reward` (Plan 23-02 / `c935cd3`) + Doctor `reward_trend` signal source (Plan 23-07 / `38459ef` + `8f25bab`): 6th `SignalClass::RewardTrend` variant + `compute_reward_signal()` body + 6th `tokio::join!` arm in `doctor_run_full_check`; reads `tests/evals/reward_history.jsonl` via `crate::reward::read_reward_history(2000)`. TS lockstep (Plan 23-08) renders the new payload. |
| REWARD-05 | 23 | shipped — all 3 OOD modules authored AND mod-registered: `adversarial_eval.rs` (Plan 23-03) + `ambiguous_intent_eval.rs` (Plan 23-04) + `capability_gap_stress_eval.rs` (Plan 23-05); 3-line `#[cfg(test)] mod` registration block in `evals/mod.rs` (Plan 23-06 / `5e105f7`); all 3 floors pass at top-1=100% / top-3=100% / MRR=1.000; `cargo test --lib evals` emits 8 EVAL-06 tables |
| REWARD-06 | 23 | pending |
| REWARD-07 | 23 | ✅ shipped — Doctor surface verifiability lands (Plan 23-07 / `8f25bab`): `compute_reward_signal()` payload exposes the 4-key `components_today_mean` breakdown (`skill_success` / `eval_gate` / `acceptance` / `completion`) + `ood_gate_zero_count_today` + `bootstrap_window` flag — Plan 23-08's `DoctorPane.tsx` will render which component is regressing on Amber/Red. Severity ladder per D-23-04: drop_pct >0.20 → Red, >0.10 → Amber, else Green. 42/42 doctor::tests green. |
| DREAM-01 | 24 | pending |
| DREAM-02 | 24 | pending |
| DREAM-03 | 24 | pending |
| DREAM-04 | 24 | pending |
| DREAM-05 | 24 | pending |
| DREAM-06 | 24 | pending |
| PROVIDER-01 | 25 | pending |
| PROVIDER-02 | 25 | pending |
| PROVIDER-03 | 25 | pending |
| PROVIDER-04 | 25 | pending |
| PROVIDER-05 | 25 | pending |
| PROVIDER-06 | 25 | pending |
| JARVIS-01 | 26 | pending (carry-forward from v1.2 Phase 18) |
| JARVIS-02 | 26 | pending (carry-forward from v1.2 Phase 18) |
| VOICE-03 | 26 | pending |
| VOICE-04 | 26 | pending |
| VOICE-05 | 26 | pending |
| CLOSE-01 | 27 | pending |
| CLOSE-02 | 27 | pending |
| CLOSE-03 | 27 | pending |
| CLOSE-04 | 27 | pending |
| CLOSE-05 | 27 | pending |
| CLOSE-06 | 27 | pending |

**Total: 39 active requirements** (8 SKILLS + 9 VOYAGER + 7 REWARD + 6 DREAM + 6 PROVIDER + 5 VOICE [3 new + 2 v1.2 carry-forward] + 6 CLOSE) mapped to 7 phases. 100% phase coverage. Future Requirements (organism / metacognitive / active-inference / persona / immune / federation / v1.2 carry-overs) tracked in the "Future Requirements" section above; not counted in v1.3 active total.

---

*Last updated: 2026-04-30T22:30Z — v1.3 REQUIREMENTS.md written during autonomous milestone bootstrap. ROADMAP.md mapping next.*
