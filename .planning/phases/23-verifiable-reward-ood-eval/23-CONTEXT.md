---
phase: 23
slug: verifiable-reward-ood-eval
milestone: v1.3
status: pre-plan
created: 2026-05-01
created_by: /gsd-discuss-phase 23 (interactive; user delegated 2 of 4 calls; locked 2 of 4)
---

# Phase 23 — Verifiable Reward + OOD Eval — CONTEXT

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship an RLVR-style composite reward signal in production at the agent layer
(per `open-questions-answered.md` Q1) so BLADE can self-improve without
waiting on Anthropic foundation-level continual learning, and mitigate
steelman Arg 3 (OOD failure mode) with explicit adversarial / ambiguous /
capability-gap-shaped fixtures.

**In scope:**
- Composite reward computation per chat turn with reward-hacking penalties
- Per-turn reward persisted to `tests/evals/reward_history.jsonl`
- 3 new OOD eval modules in `src-tauri/src/evals/` with hand-curated inline fixtures
- Rolling 7-day OOD baseline + fail-safe gate-to-zero on >15% drop
- Doctor pane extension surfacing `reward_trend` signal

**Out of scope (Phase 23):**
- New UI affordances on the chat surface (regenerate button, edit_user_message)
  — chat-first pivot anchor (D-01) holds; UI work deferred to v1.4
- Live network pulls from external fixture repos (rebuff / PIGuard)
- LLM-seeded fixture generation
- Dream-mode skill consolidation reading reward signal — that's Phase 24

</domain>

<decisions>
## Implementation Decisions

### Acceptance signal sourcing (REWARD-02 / D-23-01)
- **D-23-01:** Acceptance component implemented as a stub `acceptance_signal()` that
  returns `1.0` (no-correction default) every turn. Default `BladeConfig.reward_weights.acceptance`
  set to `0.0` so this component contributes nothing to the composite in v1.3.
- **Why:** No regenerate button / edit_user_message UI exists on chat today; only
  an aspirational wrapper comment in `src/lib/tauri/chat.ts:8`. Building one
  would pull UI work into a substrate phase, violating the 2026-04-30 chat-first
  pivot anchor (PROJECT.md M-08). Reward formula stays computable today; real
  signal hooks in cleanly when v1.4 ships the UI affordance.
- **Re-weight rule:** When v1.4 lands the regenerate UI, restore the 0.5/0.3/0.1/0.1
  default by setting `reward_weights.acceptance = 0.1` and removing the stub.
  Do NOT change the composite formula — only the configurable weight.

### Penalty enforcement detection (REWARD-03 / D-23-02)
- **D-23-02:** Penalties detected via tool-call-trace inspection + per-turn write log,
  in-process and deterministic.
- **Three penalty paths:**
  1. **skill_success ×0.7** if test coverage on the skill <50% — count `tests/`
     files written alongside `<skill>/scripts/` writes during the turn; if no
     test file written within the turn AND the skill has no existing tests
     (filesystem check on the skill dir), apply penalty.
  2. **eval_gate penalty** if any tool-call write target during the turn matches
     glob `src-tauri/src/evals/**/*.rs` OR `tests/evals/**/*.rs` (game-the-test
     pattern). Detected by hooking the existing tool-call dispatcher in
     `commands.rs` tool loop (which already records each call) — no `git diff`
     dependency, no filesystem watcher.
  3. **completion penalty** if final tool result of the turn is empty / no-op
     (no observable side effect — empty string return, or final action is a
     classified-as-noop tool like `noop` / `wait` / `echo "done"`).
- **Why this over git-diff:** `git diff` requires a worktree and runs `git`
  per turn — fragile in non-repo BLADE invocations. Tool-call inspection is
  hermetic, fast, and naturally scoped to the turn boundary.
- **Why this over write_file-only hook:** Skill writes flow through `forge_tool`
  (Phase 22 path), not `write_file`. Hooking the dispatcher catches all
  mutation paths uniformly.

### OOD eval scope (REWARD-05 / REWARD-06 / D-23-03)
- **D-23-03:** Hand-curate 15–20 fixtures per OOD module, inlined as Rust
  `&str` slices for hermetic CI. No live network pulls. No LLM seeding.
- **Three modules:**
  - `adversarial_eval.rs` — 15–20 jailbreak / prompt-injection patterns
    (DAN-style, ignore-previous-instructions, role-play override, system-prompt
    extraction). Cite rebuff/PIGuard as design references (URLs in module
    docstring); fixture text is hand-written.
  - `ambiguous_intent_eval.rs` — 15–20 boundary cases at the intent_router
    boundaries (chat vs tool-call vs delegation; capability-aware-routing
    edge cases per Phase 11/12 substrate).
  - `capability_gap_stress_eval.rs` — 15–20 requests for tools that don't
    exist (stresses Voyager loop entry from Phase 22; some fixtures should
    SUCCEED via skill forging if the loop is healthy).
- **Each asserts a baseline floor** — pattern follows existing 5 evals in
  `src-tauri/src/evals/` (top-1 / top-3 / MRR) but adapted: floor is "% of
  fixtures handled correctly" with category-specific correctness predicates.
- **Rolling 7-day baseline:** Computed on every turn from
  `reward_history.jsonl` (no separate baseline file). Read last 7 days of
  entries, compute per-module mean, compare current to rolling mean.
- **Bootstrap behavior (first 7 days):** Reward signal flows normally; the
  REWARD-06 OOD-failure-budget GATE is suppressed but logged
  (`bootstrap_window: true` field on `reward_history.jsonl` entries during
  the warmup). Once 7 days of history exists, gate activates automatically
  on next turn.

### Doctor surface shape (REWARD-04 / REWARD-07 / D-23-04)
- **D-23-04:** Add a 6th variant `SignalClass::RewardTrend` to the locked
  Phase 17 enum. Sibling `compute_reward_signal()` fn parallel to
  `compute_eval_signal()`. Six rows in the suggested_fix table (verbatim per
  D-18 — strings authored in this phase, locked at land time).
- **Why a new SignalClass over folding into EvalScores:**
  - REWARD-04's "new signal source" phrasing implies separation
  - REWARD-07's "DoctorPane.tsx renders new row" implies a distinct row, not
    a sub-row inside EvalScores
  - Phase 17 D-02 ("sources self-classify") prefers separation over mixing
  - suggested_fix table can stay clean with one (class, severity) per row
- **Severity mapping (REWARD-07 verbatim):** Red on >20% reward drop, Amber
  on >10%, Green otherwise. Comparison is current 1-day mean vs prior 7-day
  rolling mean (separate from REWARD-06's OOD-floor gate, which fires at >15%
  on individual OOD modules).
- **DoctorPane.tsx change:** One row added matching existing 5-row pattern;
  no UI architecture change. UAT-only-on-runtime scope (per chat-first pivot
  UI-deferral pattern, this row's static render is acceptable; runtime UAT
  deferred per the operator-blessed pattern).

### Claude's Discretion
- **`verify:eval` extension vs new `verify:reward` gate** — chain count
  question. ROADMAP §"verify gates extend, not replace" suggests adding
  the 3 new OOD modules into the existing `verify:eval` gate (chain count
  stays 33). REWARD-06 fail-safe is a runtime gate, not a verify gate.
  Researcher / planner pick the cleanest wiring; if a separate
  `verify:reward` gate is justified for OOD-floor semantics, chain count
  moves 33 → 34 cleanly.
- **N/A component default values** — when a turn doesn't fire a Voyager
  skill, what does `skill_success` resolve to? Default to `1.0` (component
  "passes" / does not penalize); the eval_gate component runs every turn
  and is the dominant 0.3-weight signal so all-N/A turns are rare in
  practice. Researcher confirms.
- **`reward_history.jsonl` retention** — file grows unboundedly. Default:
  no truncation, parallel to existing `tests/evals/history.jsonl` behavior.
  Revisit at v1.4 if file size becomes a doctor.rs read-cost concern.
- **`RewardWeights` struct shape** — likely
  `{skill_success, eval_gate, acceptance, completion}: f32 each`.
  Validate sum-to-1.0 in `BladeConfig::default()` and on `save_config`.
- **Per-turn reward record schema** — fields likely include `timestamp`,
  `reward` (composite), `components: { skill_success, eval_gate, acceptance,
  completion }` (each post-penalty), `penalties_applied: Vec<String>`
  (penalty-name labels), `bootstrap_window: bool`, `ood_gate_zero: bool`.
  Researcher locks the exact shape against the existing Phase 17
  `EvalHistoryEntry` struct in `doctor.rs:141`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements (this phase)
- `.planning/REQUIREMENTS.md` §REWARD-01..07 — 7 requirements, falsifiable
- `.planning/ROADMAP.md` §Phase 23 — locked refs row, success criteria, approach hint

### Research substrate (Phase 23 source-of-truth)
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q1 — composite reward formula, the 4 verifiable signals, RLVR background, reward-hacking mitigation sources
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` §Arg 3 — OOD coverage requirement (drives REWARD-05); §Arg 7 — substrate-vulnerability mitigation (drives why ship at agent layer today)
- `https://arxiv.org/html/2509.15557v1` — Verifiable Composite Rewards (penalty formulation source for REWARD-03)
- `https://arxiv.org/html/2604.12086` — Robust Optimization with Correlated Proxies (penalty calibration framework)

### Locked substrate from prior phases (don't re-decide)
- `.planning/phases/17-doctor-module/17-CONTEXT.md` §D-02..D-21 — Doctor module architecture (SignalClass enum, Severity tiers, suggested_fix table, sources self-classify, transition detector, event emitter). REWARD-04/07 must extend this without violating these locks.
- `.planning/phases/22-voyager-loop-closure/22-CONTEXT.md` — Voyager loop substrate. `skill_success` reward component sources from `forge_tool` execution result + the existing `voyager:skill_used` ActivityStrip emit point.
- `.planning/phases/16-eval-scaffolding-expansion/` (referenced via `src-tauri/src/evals/harness.rs:1` docstring) — EVAL-06 scored-table contract that the 3 new OOD eval modules MUST honor (`print_eval_table` leads with `┌──`).
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — 2026-04-30 chat-first pivot anchor. Drives the substrate-only scoping that locked D-23-01.

### CLAUDE.md operating rules (already required reading)
- `/home/arnav/blade/CLAUDE.md` §"Critical Architecture Rules / Rust" — 6-place config rule (REWARD-01 weights), `mod` registration, `generate_handler!`, safe_slice
- `/home/arnav/blade/CLAUDE.md` §"Verification Protocol" — substrate phase; runtime UAT deferred per chat-first pivot for the DoctorPane row addition only (UI substrate change, no chat-functionality regression)

### Reference URLs cited but NOT fetched live
- `https://github.com/protectai/rebuff` — adversarial fixture design reference (REWARD-05); fixture text hand-written, not pulled
- `https://github.com/HydroXai/PIGuard` — prompt-injection-detection reference (REWARD-05); same posture

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src-tauri/src/evals/harness.rs`** — EVAL-06 contract (`print_eval_table` leads with `┌──`); `EvalRow`/`EvalSummary` types; `temp_blade_env()` for hermetic per-test config dirs. The 3 new OOD eval modules MUST use this harness so `verify-eval.sh` continues to grep stdout uniformly.
- **`src-tauri/src/evals/mod.rs`** — module wiring pattern; add `mod adversarial_eval;` etc. behind `#[cfg(test)]` (or feature-gate if production reads them).
- **`src-tauri/src/doctor.rs`** — `SignalClass` enum (5 → 6 variants); `Severity` enum locked; `suggested_fix` match table (verbatim D-18); `compute_eval_signal` reads `tests/evals/history.jsonl` (Plan 17-03 producer pattern). Sibling `compute_reward_signal` mirrors the same shape.
- **`src-tauri/src/commands.rs:647 send_message_stream`** — emits `chat_done` once per assistant turn (commands.rs:994). Natural per-turn reward hook point.
- **`src-tauri/src/config.rs` `BladeConfig`** — 6-place rule precedent (CLAUDE.md). Add `reward_weights: RewardWeights` honoring all 6 sites; serde defaults wire defaults `0.5/0.3/0.0/0.1/0.1` (note acceptance=0.0 per D-23-01) — wait, that's 5 fields. Actual default is `0.5/0.3/0.1/0.1` with acceptance silenced via weight=0.0 not formula change. RewardWeights struct has 4 fields.
- **`src-tauri/tests/`** — wait, `tests/evals/history.jsonl` lives at REPO ROOT (`/home/arnav/blade/tests/evals/history.jsonl`), NOT under `src-tauri/`. `reward_history.jsonl` writes to the same root location.

### Established Patterns
- **M-07 ActivityStrip emission (v1.1 contract; held through v1.3)** — every cross-module action emits. Phase 23 emits at minimum on penalty trigger (`reward:penalty_applied`) and OOD gate fire (`reward:ood_gate_zero`). Per-turn reward write to jsonl does NOT need to emit (parallel to `history.jsonl` which doesn't either).
- **D-04 Severity tiers (Phase 17 LOCKED)** — Green/Amber/Red. Wire form lowercase. Re-used verbatim for `RewardTrend` SignalClass.
- **EVAL-06 contract** — `print_eval_table` lead `┌──` byte sequence is the verify-eval.sh grep target. New OOD modules must conform.
- **6-place config rule (CLAUDE.md)** — DiskConfig struct + DiskConfig::default + BladeConfig struct + BladeConfig::default + load_config + save_config. `reward_weights` and any new `ood_failure_budget` config field must hit all 6.
- **Hermetic eval pattern** — `harness::temp_blade_env()` + `--test-threads=1` (BLADE_CONFIG_DIR is process-global mutable). New OOD modules inherit.

### Integration Points
- **Reward computation site:** End of `commands::send_message_stream` happy path, after `chat_done` emit but before stream cleanup. New helper `compute_and_persist_turn_reward(turn_ctx)` called from there. Failure path (early-return on error) does NOT compute reward — turn never completed.
- **Doctor wire-in:** `compute_reward_signal()` lives in `doctor.rs` next to `compute_eval_signal()`; called from the same `doctor_run_full_check` aggregator (Plan 17-05 wired the 5 sources; Phase 23 adds the 6th). Signal class enum extension drives a TS literal-union update in `src/lib/events/payloads.ts`.
- **DoctorPane.tsx new row:** 1 row addition; matches existing 5-row pattern. UI work scope: ~1 hour. Per chat-first pivot UI-deferral, runtime UAT for the row's render is operator-owned (substrate change, not chat regression).
- **Voyager skill_success input:** Phase 22's `forge_tool` returns `Result<ForgedTool, _>` and emits `voyager:skill_used` to ActivityStrip. Reward computation reads the activity-log event stream OR samples the most recent forge result for the turn — researcher to pick cheapest non-racy option.
- **Eval-gate input:** Last `tests/evals/history.jsonl` entry's `floor_passed` field per module; aggregate (all-pass = 1.0, any-fail = 0.0).
- **Penalty detection (D-23-02):** Hook into `commands.rs` tool loop — already records each tool call (per the `chat_token` / `chat_done` instrumentation at commands.rs:991+); add a per-turn `Vec<ToolCall>` accumulator with destination paths; intersect against eval-module glob in `compute_reward_components`.

### Files NOT touched in Phase 23
- `commands.rs` core stream logic, provider gateway, brain.rs prompt builder — reward computation hooks at the boundary, doesn't restructure
- Phase 22 substrate (autoskills.rs, evolution.rs, tool_forge.rs) — read-only consumers
- DoctorPane.tsx beyond the new row
- All other UI surfaces

</code_context>

<specifics>
## Specific Ideas

- "**RLVR-style**" framing in PROJECT.md M-10 / open-questions Q1 is the
  guide-rail. Composite reward is verifiable today; foundation-level
  continual learning is not. Ship the verifiable thing.
- **Hand-written fixtures, not LLM-seeded** — `tests/evals/DEFERRED.md`
  already documents the BLADE preference for deterministic embedding-driven
  evals over live-LLM evals. OOD modules inherit that preference.
- **Acceptance silenced via weight, not formula change** — keeps the
  v1.3 → v1.4 transition a config-only change. PROJECT.md / ROADMAP.md
  citations of the formula stay accurate.
- **`reward:penalty_applied` ActivityStrip emit** is the trust surface.
  When a penalty fires the user sees it in the strip — debuggable,
  observable, M-07-compliant.
- **Bootstrap window = 7 days** matches REWARD-06's rolling 7-day baseline.
  No magic-number drift between gate window and warmup window.

</specifics>

<deferred>
## Deferred Ideas

- **Regenerate / edit_user_message UI on chat surface** — v1.4. When this
  lands, restore `reward_weights.acceptance = 0.1` and replace the stub
  `acceptance_signal()` with click-detection (no regenerate within 30s = 1.0,
  regenerate within 30s = 0.0).
- **Live OOD fixture refresh from rebuff / PIGuard** — v1.4 if curated
  fixture set saturates; requires licensing review + network-dependent
  build path discussion.
- **LLM-seeded fixture generation** — v2+ if hand-curated set proves too
  small to detect real OOD drift. Per `tests/evals/DEFERRED.md`,
  introduces LLM dependency in eval generation that BLADE has explicitly
  avoided.
- **OOD eval expansion beyond 3 categories** — persona-stability eval per
  arXiv 2402.10962, hormone-driven behavior eval, vitality-dynamics eval —
  all part of v1.4 organism layer (deferred per steelman Arg 4 + Arg 10).
- **Reward signal driving online RL on local models** — out of scope for
  v1.3; the 4 verifiable signals are wirable today but RL training loop
  itself is v2+ (TTT continual learning per synthesis-blade-architecture).
- **Reward decomposition surfaced in chat replies** — "BLADE earned 0.83
  this turn" — possible v1.4 transparency feature; out of substrate scope
  for v1.3.
- **Per-component independence audit (REWARD-02 'no cross-contamination')** —
  a unit-test concern flagged in REQUIREMENTS but not a Phase 23 scope
  expansion; researcher decomposes into component-level test cases per
  REWARD-02's existing test specifier.

### Reviewed Todos (not folded)
- None — no pending todos matched Phase 23 scope (cross-reference ran during init).

</deferred>

---

*Phase: 23-verifiable-reward-ood-eval*
*Context gathered: 2026-05-01*
*Discussion: 4 areas (acceptance proxy / penalty enforcement / OOD scope / doctor surface); 2 user-explicit picks, 2 user-delegated picks ("your call"). 4 decisions locked. Substrate-only scope per chat-first pivot anchor.*
