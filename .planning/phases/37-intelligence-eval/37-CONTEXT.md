# Phase 37: Intelligence Eval — Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Synthesised directly from ROADMAP.md, REQUIREMENTS.md, PROJECT.md, CLAUDE.md, and the Phase 32–36 closures (32-CONTEXT.md, 33-CONTEXT.md, 34-CONTEXT.md, 35-CONTEXT.md, 36-CONTEXT.md). Codebase grounding at evals/mod.rs (24 lines, registers Phase 16–30 evals), evals/harness.rs (311 lines, EvalRow + summarize + print_eval_table EVAL-06 contract), evals/organism_eval.rs (684 lines, capstone eval template — MODULE_FLOOR=1.0, OrganismFixture struct, fn fixtures(), per-fixture state setup), loop_engine.rs (run_loop signature, LoopState, LoopHaltReason), resilience/stuck.rs (detect_stuck signature for EVAL-03), commands.rs lines 320–460 (build_compaction_summary_prompt for EVAL-04 + cap_tool_output for EVAL-02), brain.rs (LAST_BREAKDOWN accumulator for EVAL-02), scripts/verify-organism.sh (template for verify-intelligence.sh), and providers/mod.rs (Provider trait + complete_turn signature). Autonomous decisions per Arnav's standing instruction; no interactive discuss-phase.

<domain>
## Phase Boundary

**What this phase delivers:**
Phase 37 makes the v1.5 intelligence improvements *measurable* instead of *asserted*. A new test-only Rust module `src-tauri/src/evals/intelligence_eval.rs` houses ten multi-step task fixtures (EVAL-01), three context-efficiency fixtures (EVAL-02), five stuck-detection fixtures plus five healthy controls (EVAL-03), and three compaction-fidelity fixtures (EVAL-04). Each fixture exercises real production code paths — `loop_engine::run_loop`, `brain::build_system_prompt_inner` + `LAST_BREAKDOWN`, `resilience::stuck::detect_stuck`, `commands::build_compaction_summary_prompt` — but is **deterministic**: no live LLM calls. EVAL-01 wires a `#[cfg(test)] ScriptedProvider` (test-only sibling implementing the existing `Provider` trait) that returns canned responses indexed by call-counter; the loop runs to `LoopHaltReason::Complete` exactly because the script tells it to. EVAL-04 mocks the cheap-summary LLM step the same way. Output is a single scored EVAL-06 box-drawing table per `print_eval_table` — `verify-intelligence.sh` greps for the `┌──` delimiter, asserts MODULE_FLOOR=1.0 (capstone-grade per Phase 30's organism eval pattern), and joins `verify:all` as the 38th gate. A separate, **opt-in** operator script `scripts/run-intel-benchmark.sh` (env-gated, NOT in verify:all) re-runs the same 10 fixtures against real LLMs and writes before/after metrics to `eval-runs/v1.5-baseline.json` — so the operator runs it once, commits the baseline, and the deterministic CI lane regression-checks against committed numbers thereafter. This satisfies "before/after benchmark on 10 representative tasks" without making CI non-deterministic. A new `EvalConfig` sub-struct in `config.rs` carries `intelligence_eval_enabled` (CTX-07-style escape hatch — eighth structural application), `baseline_path`, `multi_step_iterations_cap`, `stuck_detection_min_accuracy` (0.80 floor), `context_efficiency_strict`. The phase ships zero new Tauri commands and zero new production-code modules; it adds one test module, one config sub-struct, one bash script, and one optional operator script.

**What this phase does NOT touch:**
- Phase 32 selective injection / compaction / tool-output cap (already shipped — Phase 37 *consumes* the LAST_BREAKDOWN accumulator + `cap_tool_output` + `build_compaction_summary_prompt` but does not re-author them; CTX-07 fallback is asserted in EVAL-03 healthy-control rows but the gate logic is unchanged)
- Phase 33 loop driver (LoopState, LoopHaltReason, ToolError, run_loop, verify_progress) — Phase 37 ships zero changes to the iteration body; EVAL-01 calls the existing `run_loop` API with a scripted-provider closure
- Phase 34 stuck detection / circuit breaker / cost guard / fallback chain / SessionWriter — Phase 37 ships no resilience-surface changes; EVAL-03 calls the existing `resilience::stuck::detect_stuck(state, config)` public function
- Phase 35 auto-decomposition / sub-agent isolation / merge_fork_back — Phase 37 ships no decomposition changes; EVAL-01's `parallel-file-reads` fixture exercises the parent-only path
- Phase 36 tree-sitter / PageRank / capability registry / @context-anchor (already shipped — Phase 37 indirectly exercises the repo-map gate via EVAL-02 `code-edit-multi-file` fixture, but does not re-author the gate)
- Production providers (anthropic / openai / gemini / groq / openrouter / ollama) — Phase 37 adds NO new provider; `ScriptedProvider` is `#[cfg(test)]`-gated and not registered in `providers::mod.rs::resolve_provider`
- Frontend / DoctorPane / ActivityStrip — Phase 37 has zero frontend surface. Eval is internal-only; operators read results via `cargo test` stdout + `eval-runs/*.json`. No AnchorChip, no UI badges, no React components added.
- The 188 pre-existing staged deletions in `.planning/phases/00-31-*` directories — Phase 37 commits MUST stage specific paths only; never `git add -A`/`git add .` (workspace memory `feedback_uat_evidence.md` precedent)
- v1.6+ eval surfaces (live A/B routing eval, real-token-usage trend dashboards, multi-session aggregate eval) — explicitly out
- Voyager / safety / hormone / vitality / organism evals (Phase 23 / 26 / 27 / 28 / 29 / 30) — already shipped + green; Phase 37 leaves their fixtures and their `verify:*` gates unchanged
- Live A/B testing of the loop in production — Phase 37 is offline regression eval only; live A/B is v1.6+

**Why this is the gate phase of v1.5:**
Phases 32–36 each shipped an intelligence surface (selective context, loop verification, stuck detection + sessions, auto-decomposition, repo-map + capability registry + anchors). Each closed at `checkpoint:human-verify` boundaries with operator-deferred runtime UAT. The pieces individually pass static gates. But "did v1.5 actually make BLADE smarter?" has no falsifiable answer until Phase 37 runs the same 10 multi-step tasks against the same code paths and produces reproducible scores. EVAL-01..04 give the answer; EVAL-05 gates regressions on every future PR. Without Phase 37, Phase 38's close-out cannot honestly claim "BLADE understands codebases / loops survive their own failure modes / sub-agents isolate properly" — the success criteria in ROADMAP.md sections 32–36 each cite "verify by token-count inspection" / "observable in ActivityStrip" / "scored on 5 synthetic stuck scenarios", which Phase 37 is the harness for. The operator-runnable benchmark mode satisfies the "before/after measured improvement" requirement (EVAL-01 success criterion #1) without locking CI to non-deterministic LLM behavior. The CTX-07-style escape hatch (`intelligence_eval_enabled = false`) means a future regression in evals (e.g. tree-sitter v0.23 breaks parsing) doesn't block release — operator can ship while the eval is being repaired, mirroring Phase 32–36 fallback discipline. EVAL-05 extends the verify chain from 37 to 38 gates; the existing 37 must remain green.

</domain>

<decisions>
## Implementation Decisions

### EvalConfig Sub-Struct (Module Boundary + 6-place Wire-up)

- **Locked: New `BladeConfig.eval: EvalConfig` sub-struct in `config.rs`.** Mirrors Phase 32's `ContextConfig`, Phase 33's `LoopConfig`, Phase 34's `ResilienceConfig` + `SessionConfig`, Phase 35's `DecompositionConfig`, Phase 36's `IntelligenceConfig` placement. Six-place rule applies to every field per CLAUDE.md (DiskConfig struct, DiskConfig::default, BladeConfig struct, BladeConfig::default, load_config, save_config). Don't try to remember the six places from memory — copy the diff Phase 36-01-SUMMARY.md used for `IntelligenceConfig` and adapt every line.
- **Locked: Five fields with locked defaults.**
  ```rust
  pub struct EvalConfig {
      pub intelligence_eval_enabled: bool,                 // default true; CTX-07-style escape hatch (EVAL-05)
      pub baseline_path: PathBuf,                          // default blade_config_dir().join("eval-runs/v1.5-baseline.json")
      pub multi_step_iterations_cap: u32,                  // default 25 (matches LoopConfig.iter_cap default)
      pub stuck_detection_min_accuracy: f32,               // default 0.80; ROADMAP success criterion #3 floor
      pub context_efficiency_strict: bool,                 // default true; flip to soft-warn during dev
  }
  ```
- **Locked: When `intelligence_eval_enabled = false`, `verify-intelligence.sh` short-circuits to `exit 0` with a `[verify-intelligence] SKIP — disabled in config` message.** The `cargo test --lib evals::intelligence_eval` command is NOT invoked. UAT must include both toggle states. Eighth structural application of the v1.1 lesson — eval surface must not block release if it's broken.
- **Locked: `baseline_path = blade_config_dir().join("eval-runs/v1.5-baseline.json")`** is the operator-populated baseline for EVAL-01 multi-step task completion. The deterministic CI lane reads this file when present and asserts current pass-counts match committed-baseline pass-counts (regression detection); when the file is missing, the deterministic lane uses absolute pass/fail per fixture without comparison (first-run mode). The operator-runnable `scripts/run-intel-benchmark.sh` writes this file. Keeping the baseline as a separate JSON file (not Cargo-baked) lets the operator re-run + re-commit without rebuilding the binary.
- **Locked: `multi_step_iterations_cap = 25`** matches `LoopConfig.iter_cap` default (Phase 33-01). EVAL-01 fixtures expect each scripted task to terminate in ≤ 25 loop iterations; over-cap means scripted-response coverage is incomplete (a fixture bug, not a production bug). Configurable so a future eval with longer-tail tasks can dial up.
- **Locked: `stuck_detection_min_accuracy = 0.80`** mirrors ROADMAP success criterion #3 verbatim ("Stuck-detection accuracy on 5 synthetic stuck scenarios is >= 80%"). EVAL-03 asserts at least 4 of the 5 stuck fixtures detect (true positive ≥ 80%) AND zero of the 5 healthy controls detect (false positive = 0). Configurable for soft-warn during development; production CI gate uses the locked default.
- **Locked: `context_efficiency_strict = true`** is the production CI gate. EVAL-02 fixtures cite an `expected_max_total_tokens`; strict-mode asserts the LAST_BREAKDOWN total ≤ cap. Soft-warn mode (false) emits the row with `relaxed: true` and excludes it from MODULE_FLOOR math — used during prompt-shape iteration before locking new caps.
- **Claude's discretion:** Whether to add a `runtime_benchmark_provider: Option<String>` knob so the operator-runnable script can pin to e.g. `"groq"` for faster baseline runs. Recommend NO for v1 — keep `run-intel-benchmark.sh` consuming the user's primary provider via existing `BladeConfig.provider` so the baseline reflects real production routing. Add only if the operator-runnable mode finds Groq's free tier produces a useful fast-baseline.

### intelligence_eval.rs Module Layout (EVAL-01..04 Fixtures)

- **Locked: New file `src-tauri/src/evals/intelligence_eval.rs`** (single file, ~700–900 lines, four fixture sub-modules separated by `// ── EVAL-NN: <surface> ──` banners). Mirror `organism_eval.rs` structure verbatim — `MODULE_NAME` const, `MODULE_FLOOR: f32 = 1.0` const, `IntelligenceFixture` struct, `fn to_row(...)`, `fn fixtures() -> Vec<IntelligenceFixture>`, `#[test] fn run_intelligence_eval_driver()` driver.
- **Locked: Registration site.** Add `#[cfg(test)] mod intelligence_eval; // Phase 37 / EVAL-01..05` to `src-tauri/src/evals/mod.rs:24` (immediately after the existing `organism_eval` line). Keep the comment-trail format identical to organism_eval. ZERO production-code path touched — the entire module is `#[cfg(test)]`-gated.
- **Locked: Fixture struct shape.**
  ```rust
  struct IntelligenceFixture {
      label: &'static str,
      requirement: &'static str,                     // "EVAL-01" | "EVAL-02" | "EVAL-03" | "EVAL-04"
      run: fn() -> (bool, String),
  }
  fn to_row(label: &str, requirement: &str, passed: bool, result: &str, expected: &str) -> EvalRow {
      EvalRow {
          label: format!("{}: {}", requirement, label),
          top1: passed,
          top3: passed,
          rr: if passed { 1.0 } else { 0.0 },
          top3_ids: vec![result.to_string()],
          expected: expected.to_string(),
          relaxed: false,                            // MODULE_FLOOR=1.0 means NEVER relaxed
      }
  }
  ```
- **Locked: MODULE_FLOOR = 1.0.** All EVAL-01/02/04 fixtures asserted (no relaxed). EVAL-03 stuck-detection accuracy is the ONE float threshold (≥0.80) — implemented by aggregating the 10 stuck/healthy fixtures into a single accuracy assertion at end-of-test. Don't dilute the floor; the per-row pass/fail is exact match against expected behavior, and the `≥0.80` floor only governs the **aggregate** of the 10 stuck/healthy rows under a separate assertion AFTER the per-row table emits.
- **Locked: Sub-module banner ordering.** The four banners run in this order to match the v1.5 phase-narrative arc: EVAL-02 (context efficiency — Phase 32), EVAL-03 (stuck detection — Phase 34), EVAL-04 (compaction fidelity — Phase 32 prompt × Phase 36 mocked LLM), EVAL-01 (multi-step task completion — Phase 33+34+35+36 all-stack). EVAL-01 last because it's the broadest fixture.
- **Locked: Fixture count is locked at 21 effective rows total** — 10 EVAL-01 + 3 EVAL-02 + 10 EVAL-03 (5 stuck + 5 healthy) + 3 EVAL-04 = 26 fixtures emitting 26 table rows — in line with organism_eval's 13-fixture density. Tighter than organism_eval because EVAL-01's per-fixture cost is higher (full loop replay).
- **Claude's discretion:** Whether to split EVAL-01's 10 fixtures into a separate file `intelligence_eval_loop.rs` if line count exceeds 1000. Recommend NO unless the file actually crosses 1100 lines — co-located fixtures share helper functions (e.g. `setup_scripted_provider`, `assert_loop_haltreason`) and splitting fragments the harness.

### EVAL-01: 10 Multi-Step Task Fixtures

- **Locked: Ten fixture labels** map exactly to the v1.5 surface coverage and exercise every Phase 33–36 surface in one harness:
  1. `code-edit-multi-file` — exercises Phase 33 LOOP-01 verification + Phase 36 INTEL-03 repo map injection
  2. `repo-search-then-summarize` — Phase 33 LOOP-01 + Phase 32 CTX-03 compaction at midpoint
  3. `bash-grep-fix-test` — Phase 33 LOOP-02 ToolError feedback (one tool fails, suggests alternative)
  4. `web-search-extract` — Phase 33 LOOP-04 truncation retry (response truncates, retries with higher max-tokens)
  5. `parallel-file-reads` — Phase 35 DECOMP-01 auto-trigger threshold (≥5 independent steps)
  6. `tool-error-recovery` — Phase 33 LOOP-03 plan adaptation after structured error
  7. `verification-rejected-replan` — Phase 33 LOOP-01 mid-loop verifier rejects, loop replans
  8. `truncation-retry` — Phase 33 LOOP-04 dedicated truncation+retry path
  9. `compaction-mid-loop` — Phase 32 CTX-03 fires at 80% context budget mid-task
  10. `cost-guard-warn` — Phase 34 RES-03 + RES-04 80%-warn + 100%-halt sequence
- **Locked: Each fixture is a `MultiStepTaskFixture` struct.**
  ```rust
  struct MultiStepTaskFixture {
      label: &'static str,
      scripted_responses: &'static [ScriptedResponse],
      expected_haltreason: LoopHaltReason,
      expected_iterations_max: u32,
      requirement_tag: &'static str,                 // "EVAL-01"
  }

  struct ScriptedResponse {
      tool_call: Option<ScriptedToolCall>,           // None = final assistant message
      assistant_text: &'static str,
      truncated: bool,                               // simulates LOOP-04 truncation flag
  }

  struct ScriptedToolCall {
      tool_name: &'static str,
      args_json: &'static str,                       // canonical JSON
      response: &'static str,                        // the tool's canned response (large = exercises CTX-05 cap)
  }
  ```
- **Locked: Fixtures use real production code via the `ScriptedProvider` test-only adapter (see next decision block).** Each fixture's `run` function (a) sets up a `ScriptedProvider` with the fixture's response array, (b) builds a `ConversationMessage::User(fixture.starting_query)` initial state, (c) invokes `loop_engine::run_loop(...)` with the scripted provider injected via the test seam (see "Mock provider" decision below), (d) asserts `LoopHaltReason` matches expected and iteration count ≤ cap.
- **Locked: Scripted-response sequences are checked-in const data.** No on-disk fixture files. `&'static [ScriptedResponse]` arrays live in the module. This keeps fixtures: (a) reviewable in PR diffs, (b) reproducible without external state, (c) un-bit-rottable.
- **Locked: Per-fixture starting query is a `&'static str` literal in the fixture struct.** Example: `code-edit-multi-file` starts with `"Update commands.rs to add a new tauri command 'pause_loop' and add tests"`. Realistic tasks; no toy queries.
- **Locked: Coverage assertion.** A driver test `phase37_eval_01_all_haltreasons_covered` asserts the union of `expected_haltreason` across the 10 fixtures includes `Complete`, `Stuck`, `CircuitOpen`, `CostExhausted`, `DecompositionComplete` — proving the eval exercises all 5 LoopHaltReason variants. Phase 33's 5 variants × 2 redundancy = 10 fixtures.
- **Claude's discretion:** Whether to also assert ActivityStrip event emission per fixture (BLADE_LOOP_EVENT). Recommend NO for v1 — couples the deterministic eval to the event-bus surface; emission is a separate concern (Phase 33-08 already gates it). Add as v1.6+ if eval finds the event surface drifts.

### Mock Provider for Deterministic Loop Replay

- **Locked: `#[cfg(test)] struct ScriptedProvider` lives inside `intelligence_eval.rs`, NOT inside `providers/mod.rs`.** The provider is test-only; it does not extend the production provider registry. It implements just the subset of the `Provider` trait that `loop_engine::run_loop` actually calls (`complete_turn` async signature returning `Ok(scripted_response)`).
- **Locked: ScriptedProvider state shape.**
  ```rust
  #[cfg(test)]
  struct ScriptedProvider {
      script: Vec<ScriptedResponse>,
      cursor: std::sync::Mutex<usize>,
  }

  #[cfg(test)]
  impl ScriptedProvider {
      fn new(script: &'static [ScriptedResponse]) -> Self {
          Self { script: script.to_vec(), cursor: std::sync::Mutex::new(0) }
      }
      async fn complete_turn(&self, _msgs: &[ConversationMessage], _tools: &[ToolDefinition]) -> Result<TurnResult, String> {
          let mut cur = self.cursor.lock().unwrap();
          let resp = self.script.get(*cur).cloned().ok_or("script exhausted")?;
          *cur += 1;
          Ok(TurnResult { content: resp.assistant_text.to_string(), tool_calls: resp.tool_call.map(|tc| vec![tc.into()]).unwrap_or_default(), truncated: resp.truncated })
      }
  }
  ```
- **Locked: Integration via test seam.** Add a single new `#[cfg(test)] thread_local! pub static EVAL_FORCE_PROVIDER` static in `loop_engine.rs` (or wherever `complete_turn` is dispatched) — mirrors Phase 33-04's `LOOP_OVERRIDE`, Phase 34-04's `RES_FORCE_STUCK`, Phase 35-04's `DECOMP_FORCE_STEP_COUNT`, Phase 36-03's `INTEL_FORCE_PAGERANK_RESULT` precedents. The seam is `#[cfg(test)]`-gated; production builds carry zero overhead. Tests inject a closure that delegates to `ScriptedProvider::complete_turn`. The exact seam location is `Claude's discretion` for the planner — read 33-04-PLAN.md for the LOOP_OVERRIDE precedent and adapt.
- **Locked: NO seam in `providers/mod.rs::resolve_provider`.** The existing `resolve_provider` keeps its production-only behavior. The seam intercepts at `loop_engine::run_loop`'s call site to `provider.complete_turn(...)`, not at the provider-resolution layer. This keeps production routing untouched while still exercising the loop body end-to-end.
- **Locked: Cleanest fallback if the test-seam approach is structurally awkward.** If the planner finds the run_loop call-site doesn't have a clean seam slot, the fallback is to extract the `complete_turn` dispatch into a helper trait `LoopDispatcher` and pass it through run_loop as a generic parameter. The planner makes this call during 37-02 plan authoring; if extraction is needed, document as a plan decision and proceed. The test seam is the recommended path because it's the v1.5 standard.
- **Locked: ScriptedProvider response rate is per-call, not streamed.** EVAL-01 does not exercise the streaming token-by-token contract; that's covered by `phase33_loop_*` tests and `tests/e2e/chat-stream.spec.ts`. Phase 37 asserts loop-shape correctness; the streaming surface is Phase 33's responsibility.
- **Claude's discretion:** Whether to also test ego-intercept (LOOP-05 fast-streaming path) inside EVAL-01. Recommend NO — the fast-streaming path doesn't enter `run_loop`'s tool-iteration body, so it's structurally outside the harness scope. Phase 33-07's existing tests cover it.

### EVAL-02: Context Efficiency Fixtures

- **Locked: Three `ContextEfficiencyFixture` rows.**
  ```rust
  struct ContextEfficiencyFixture {
      label: &'static str,
      query: &'static str,
      expected_max_total_tokens: usize,
      forbidden_section_labels: &'static [&'static str],   // sections that must NOT appear in LAST_BREAKDOWN
      required_section_labels: &'static [&'static str],    // sections that MUST appear
      requirement_tag: &'static str,                       // "EVAL-02"
  }
  ```
  Three fixtures:
  1. `simple-time-query`: `"what time is it?"` → max 800 tokens, forbidden = `["ocr", "hormones", "repo_map", "anchor_screen"]`, required = `["identity"]`
  2. `code-query-fixed-paths`: `"fix the bug in commands.rs::run_loop where iteration counter overruns"` → max 4000 tokens, forbidden = `["ocr"]`, required = `["identity", "repo_map"]` (assumes Phase 36 INTEL-03 fired)
  3. `general-conversation`: `"what's a good book about systems design?"` → max 1200 tokens, forbidden = `["ocr", "repo_map"]`, required = `["identity"]`
- **Locked: Each fixture's run function.** Sets up a minimal `BladeConfig` with v1.5 defaults, calls `brain::build_system_prompt_inner(&fixture.query, &conv, &config, ...)` directly (the existing public function), reads `LAST_BREAKDOWN` (already exposed via `brain::take_last_breakdown` or equivalent — verify exact API name when planning), asserts (a) total ≤ `expected_max_total_tokens`, (b) every label in `forbidden_section_labels` is absent from breakdown, (c) every label in `required_section_labels` is present.
- **Locked: NO LLM calls.** This eval inspects prompt assembly only. The compaction+condensation paths Phase 32 ships are also pure prompt logic (the LLM call is for summary text); EVAL-02 doesn't need the summary text — it asserts SECTION presence + total cap.
- **Locked: Token estimation reuses the existing Phase 32 `chars ÷ 4` helper.** No alternative tokenization. Match the prompt-assembly site's existing approximation.
- **Locked: Fixture queries are realistic, NOT toy.** Picking real questions BLADE will see in production grounds the eval. Phase 36 sub-agent inheritance is exercised indirectly because `code-query-fixed-paths` triggers INTEL-03's repo map gate.
- **Claude's discretion:** Whether to also include a `media-query-with-screen-anchor` fixture exercising INTEL-06 anchored-content bypass-gate. Recommend YES if it fits in the 3-fixture budget — replace `general-conversation` with `screen-anchor-query` (`"@screen what app is this?"` → required=`["anchor_screen"]`, forbidden=`["repo_map"]`). The general-conversation row provides minimal coverage value beyond `simple-time-query`. Lock the planner's discretion to swap if fixture authoring uncovers redundancy.

### EVAL-03: Stuck Detection Fixtures

- **Locked: Five stuck `LoopState` fixtures + five healthy controls = 10 rows.** Each fixture is a `StuckDetectionFixture`:
  ```rust
  struct StuckDetectionFixture {
      label: &'static str,
      state_setup: fn() -> LoopState,                  // builds a synthetic LoopState
      expected_detection: bool,                        // true for stuck fixtures, false for healthy
      requirement_tag: &'static str,                   // "EVAL-03"
  }
  ```
  Five stuck patterns (mirroring Phase 34-04's 5 stuck patterns from 34-CONTEXT.md):
  1. `repeated-action-observation-pair` — same tool+args 3+ times
  2. `error-loop` — same error 3+ times
  3. `oscillating-tools` — A → B → A → B 3+ times
  4. `no-progress-tokens` — verifier-reject 3+ times
  5. `context-window-thrash` — compactions_this_run ≥ 3
  Five healthy controls:
  6. `varied-tools-progressing` — different tools each iteration, no errors
  7. `single-tool-success` — one bash call, one tool result, halt
  8. `error-then-recovery` — one error, then different tool succeeds
  9. `compaction-once-progressing` — one compaction, varied tools after
  10. `verifier-pass-throughout` — verifier accepts every probe
- **Locked: Each fixture's run calls `resilience::stuck::detect_stuck(&state, &config)` directly.** The existing public function. Pass/fail = `result.is_some() == fixture.expected_detection`. No mocking of the resilience module — this is an integration test of the existing v1.5 production surface.
- **Locked: Aggregate floor assertion.** AFTER the 10 rows emit individually (each contributing pass/fail to MODULE_FLOOR=1.0 via per-row top1), a separate assertion at end-of-test computes `accuracy = correctly_classified / 10` and asserts `accuracy >= config.eval.stuck_detection_min_accuracy` (default 0.80). Per-row floor is 1.0 (every fixture must pass) AND aggregate accuracy is computed for explicit reporting; in practice if every row passes, accuracy = 1.0 ≥ 0.80 trivially. The 0.80 floor exists for the future case where 1–2 fixtures get relaxed; the per-row 1.0 floor exists for v1.
- **Locked: ZERO false positives on healthy controls.** Fixtures 6–10 must all return `expected_detection = false`. A single false positive halts the table at MODULE_FLOOR.
- **Locked: `LoopState` setup helpers.** Five `fn build_state_*` helpers (one per stuck pattern) plus five `fn build_healthy_state_*` helpers. Each constructs a realistic `LoopState` with the relevant fields populated (recent_actions, error_history, compactions_this_run, etc.). Document each helper with a `///` comment citing which Phase 34-04 stuck pattern it exercises.
- **Claude's discretion:** Whether `LoopState` test helpers go in a separate file `evals/intelligence_eval_helpers.rs` or stay in the same `intelligence_eval.rs` file. Recommend co-located unless line count argues otherwise. The helpers are eval-private (not used by production), so they belong with the eval.

### EVAL-04: Compaction Fidelity Fixtures

- **Locked: Three `CompactionFidelityFixture` rows.**
  ```rust
  struct CompactionFidelityFixture {
      label: &'static str,
      conversation: fn() -> Vec<ConversationMessage>,            // 30-turn fixture conversation
      critical_markers: &'static [&'static str],                 // strings that must survive compaction
      mocked_summary: &'static str,                              // pre-canned LLM summary for this conversation
      requirement_tag: &'static str,                             // "EVAL-04"
  }
  ```
  Three fixtures:
  1. `auth-flow-decisions` — 30 turns about auth design, markers = `["USER_GOAL: build auth flow", "DECISION: use JWT not session", "CONSTRAINT: no third-party deps"]`
  2. `bug-investigation-trace` — 30 turns of bash + grep + file read iterations, markers = `["TASK: fix UTF-8 panic in safe_slice caller", "ROOT_CAUSE: byte-index slice on multibyte char", "FIX: switch to safe_slice"]`
  3. `multi-file-refactor` — 30 turns spanning 5 files, markers = `["GOAL: rename Provider -> LlmProvider across module", "FILES: providers/mod.rs, router.rs, capability_probe.rs", "BLOCKER: macro_rules! invocation site"]`
- **Locked: Each fixture's run function.** (a) Builds the 30-turn conversation, (b) calls `commands::build_compaction_summary_prompt(&events)` directly with the conversation events, (c) asserts the prompt contains every critical marker (string-match — markers should appear in the conversation events that the prompt embeds), (d) constructs the post-compaction conversation manually using `mocked_summary` (no live LLM), (e) re-runs `build_system_prompt_inner` against the post-compaction conversation, (f) asserts every critical marker survives in the compacted form (i.e. the mocked summary preserves them).
- **Locked: NO live LLM call.** The mocked summary is the contract: "if the cheap model summarizes correctly, markers survive." Phase 37 asserts the SHAPE of the prompt (it contains the markers in the events being summarized) and the SHAPE of the post-summary surface (the mocked summary placeholder text contains the markers). The operator-runnable benchmark optionally re-runs against a real LLM; the deterministic CI lane uses the mock.
- **Locked: Mocked summary template.** `format!("[Earlier conversation summary]\n{}", critical_markers.join("\n"))` — explicit verbatim quoting of the markers. This locks the contract: "we test that the summary prompt CAN preserve markers; we don't test what GPT-5 chooses to write."
- **Locked: Compaction-fidelity test exposes a failure mode.** If a future change breaks `build_compaction_summary_prompt` so it doesn't include the markers in the events list (e.g. `safe_slice` truncates marker mid-string), the prompt-contains-markers assertion in step (c) catches it. This is the load-bearing assertion; step (f) is a sanity check on the post-compaction prompt-build.
- **Claude's discretion:** Whether to add a 4th fixture exercising the `truncate_to_budget` fallback path (when `complete_turn` errors and CTX-07 falls through). Recommend NO for v1 — adds complexity without coverage benefit; the fallback is exercised by Phase 32-07's existing panic-injection test.

### verify-intelligence.sh Gate (EVAL-05)

- **Locked: New file `scripts/verify-intelligence.sh` mirrors `scripts/verify-organism.sh` verbatim** (already exists; was the template for verify:eval, verify:organism, etc.). Copy the structure and adapt the cargo command + module name + log prefix.
- **Locked: Script body shape.**
  ```bash
  #!/usr/bin/env bash
  # scripts/verify-intelligence.sh — Phase 37 / EVAL-01..05 invariant.
  # Gate 38: all intelligence eval scenarios must pass (MODULE_FLOOR = 1.0).
  set -uo pipefail

  # Skip if disabled in config (CTX-07 escape hatch — 8th application)
  if [ "${BLADE_INTELLIGENCE_EVAL:-true}" = "false" ]; then
      echo "[verify-intelligence] SKIP — disabled via BLADE_INTELLIGENCE_EVAL=false"
      exit 0
  fi

  if ! command -v cargo >/dev/null 2>&1; then
      echo "[verify-intelligence] ERROR: cargo not on PATH" >&2
      exit 3
  fi

  STDOUT=$(cd src-tauri && cargo test --lib evals::intelligence_eval --quiet -- --nocapture --test-threads=1 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then
      echo "$STDOUT"
      echo "[verify-intelligence] FAIL: intelligence eval exited $RC"
      exit 1
  fi

  TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)
  if [ "$TABLE_COUNT" -lt 1 ]; then
      echo "$STDOUT"
      echo "[verify-intelligence] FAIL: no scored table emitted"
      exit 2
  fi

  echo "$STDOUT" | grep -E '^\xe2\x94' || true
  echo "[verify-intelligence] OK — all intelligence eval scenarios passed"
  ```
- **Locked: --test-threads=1 mandatory.** EVAL-01's `ScriptedProvider` cursor mutation, EVAL-03's `LoopState` setup, EVAL-04's `BLADE_CONFIG_DIR` env mutation are all process-global state. Mirrors Phase 30's organism-eval discipline (THE prior precedent).
- **Locked: BLADE_INTELLIGENCE_EVAL env override** for the CTX-07 escape hatch. Not config-file-coupled (verify scripts run before config is loaded); env var is the cleaner path. Default = treated as `true` when unset.
- **Locked: package.json wire-up.** Add `"verify:intelligence": "bash scripts/verify-intelligence.sh"` after `"verify:organism"` in the scripts block. Append ` && npm run verify:intelligence` to the END of `verify:all` (last entry). Verify chain count grows 37 → 38 — explicitly cited in commit message and STATE.md.
- **Locked: All 37 existing gates must remain green.** A regression in any prior gate halts Phase 37 close. The Phase 32+33+34+35+36 close-out documents OEVAL-01c v1.4 drift as out-of-scope (35/37 verifying); Phase 37 inherits this OUT-OF-SCOPE boundary verbatim and does NOT attempt to repair `verify:eval` or `verify:hybrid_search` regressions.
- **Locked: NO new Tauri commands for the eval.** Operators read results via `cargo test` stdout + `eval-runs/v1.5-baseline.json`. Adding a `run_intelligence_eval` Tauri command would couple the eval surface to the running app, defeating the "deterministic offline regression check" intent.
- **Claude's discretion:** Whether to also add the verify-intelligence script to `.github/workflows/build.yml` smoke job. Recommend YES — the gate is part of `verify:all`, which the build smoke job already runs (via `npm run verify:all`). No additional workflow edit required; just confirm the smoke job invokes verify:all (it does per Phase 30's organism eval precedent).

### Operator-Runnable Benchmark (EVAL-01 Real-LLM Mode)

- **Locked: New file `scripts/run-intel-benchmark.sh`** is the operator-runnable counterpart. NOT in `verify:all`. NOT in CI. The operator runs it once per BLADE release to populate `eval-runs/v1.5-baseline.json`; the deterministic CI lane reads that file and asserts pass-counts match.
- **Locked: Script invokes a new bin target `intelligence-benchmark` in src-tauri/Cargo.toml [[bin]] section.** The bin target is `#[cfg(not(test))]`-only; it links into BLADE's existing modules (loop_engine, providers, brain, etc.) and runs the same 10 EVAL-01 fixtures against a REAL provider chain — no `ScriptedProvider`. Outputs `eval-runs/v1.5-baseline.json` with shape:
  ```json
  {
    "version": 1,
    "ran_at": "2026-05-08T12:34:56Z",
    "blade_version": "1.5.0",
    "provider": "anthropic",
    "model": "claude-sonnet-4",
    "fixtures": [
      { "label": "code-edit-multi-file", "passed": true, "iterations": 12, "tokens_in": 4521, "tokens_out": 892, "halted": "Complete" }
    ],
    "summary": { "total": 10, "passed": 9, "pass_rate": 0.9 }
  }
  ```
- **Locked: Operator-runnable mode is OPT-IN.** Triggered by `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`. Default behavior of the script is to print usage + exit 0 if the env var is not set (prevents accidental real-LLM calls during normal CI runs).
- **Locked: Operator-runnable mode requires a configured BLADE provider.** Reads `BladeConfig.provider` + `BladeConfig.model` from `~/.config/blade/config.json` (existing surface). Errors with a clear message if no provider is configured. No env-var override; production routing only.
- **Locked: Cost ceiling for operator-mode.** Hard cap: each fixture aborts after 25 iterations OR $0.50 estimated cost (whichever first). Total benchmark estimated ~$5 at a rate of 100k tokens/fixture × $0.005/1k = $0.50/fixture × 10 = $5. Cited in script header comment + printed before run starts.
- **Locked: Benchmark output is committed.** `eval-runs/v1.5-baseline.json` is a tracked file (NOT gitignored). The deterministic CI lane reads it and asserts `current_pass_count >= committed_pass_count` (regression-only check; improvements pass).
- **Locked: Comparison logic in deterministic mode.** When `eval-runs/v1.5-baseline.json` exists, the deterministic lane reads `summary.passed` from the file and asserts `eval_01_passes_count >= summary.passed`. Mismatches print a structured diff: `EVAL-01 regression: baseline 9/10 passed, current 7/10 passed; failed fixtures: ...`. When the baseline file is missing, deterministic lane uses absolute pass/fail per fixture without comparison (first-run mode).
- **Claude's discretion:** Whether the operator-runnable mode also exercises EVAL-04 with real LLM compaction summaries. Recommend YES as a stretch — same `BLADE_RUN_BENCHMARK=true` flag also runs the 3 EVAL-04 fixtures with real `complete_turn` instead of mocked summary. Cost adds ~$1. Lock as included in Phase 37 plan, but mark as `Claude's discretion` for the executor — if it complicates the bin target, defer.

### Backward Compatibility (Eval Toggles)

- **Locked: One new kill switch: `EvalConfig.intelligence_eval_enabled: bool` (default `true`).** Eight applications of the v1.1 lesson — every smart surface must have an off-switch.
- **Locked: When `intelligence_eval_enabled = false`:**
  - `verify-intelligence.sh` short-circuits to `exit 0` with skip message
  - `cargo test --lib evals::intelligence_eval` STILL RUNS (it's `#[cfg(test)]` and unrelated to runtime config); the gate disable only short-circuits the verify script
  - `verify:all` chain still includes `verify:intelligence` step but it returns 0 (skipped)
- **Locked: BLADE_INTELLIGENCE_EVAL env var overrides the config setting.** This is for CI / one-off operator override. Env-var semantics: `false` = skip; any other value (including unset) = run. Mirrors how Phase 23-22-PLAN cited test-suite env conventions.
- **Locked: This mirrors Phase 32's `context.smart_injection_enabled`, Phase 33's `loop.smart_loop_enabled`, Phase 34's `resilience.smart_resilience_enabled` + `session.jsonl_log_enabled`, Phase 35's `decomposition.auto_decompose_enabled`, Phase 36's `intelligence.tree_sitter_enabled` + `intelligence.context_anchor_enabled`.** Same v1.1 lesson, eighth application.
- **Locked: NO escape hatch on individual EVAL-01..04 sub-eval rows.** A single per-fixture skip would dilute the floor. Either the whole intelligence_eval module runs (default) or it skips entirely (kill switch).
- **Claude's discretion:** Whether to expose `BLADE_RUN_BENCHMARK` as a config field (`eval.allow_runtime_benchmark: bool`). Recommend NO — env-var-only gating is intentional; a config flag invites accidental commits with the flag flipped on, leading to a `cargo build` running real LLM calls. Env-var-only forces the operator to type the variable each invocation.

### Module Boundaries (What Phase 37 Touches)

- **Locked: Touched files** (single-line summary per file):
  - `src-tauri/src/evals/intelligence_eval.rs` — NEW (single eval file, ~700–900 lines)
  - `src-tauri/src/evals/mod.rs` — append 1 line to register the new sub-module
  - `src-tauri/src/config.rs` — add `EvalConfig` sub-struct + 6-place wire-up
  - `src-tauri/src/loop_engine.rs` — add 1 test-seam (e.g. `EVAL_FORCE_PROVIDER`) `#[cfg(test)]`-gated; production path unchanged
  - `src-tauri/Cargo.toml` — add 1 `[[bin]]` entry for the operator-runnable benchmark target (`intelligence-benchmark`)
  - `src-tauri/src/bin/intelligence_benchmark.rs` — NEW (operator-runnable bin, ~200–300 lines)
  - `scripts/verify-intelligence.sh` — NEW (~40 lines, mirrors verify-organism.sh)
  - `scripts/run-intel-benchmark.sh` — NEW (~30 lines, env-gated wrapper)
  - `package.json` — add `verify:intelligence` script + append to `verify:all` chain
  - `eval-runs/.gitkeep` — NEW (empty file ensuring the directory exists; the actual `v1.5-baseline.json` is committed by the operator after the first benchmark run)
- **Locked: NOT touched files:**
  - `src-tauri/src/lib.rs` — ZERO new Tauri commands; no `mod` registration changes (intelligence_eval is via evals/mod.rs not lib.rs)
  - `src-tauri/src/providers/mod.rs` — `ScriptedProvider` is `#[cfg(test)]`-local to intelligence_eval.rs, NOT registered as a real provider
  - `src-tauri/src/brain.rs`, `commands.rs`, `intelligence/*.rs`, `resilience/*.rs`, `session/*.rs`, `decomposition/*.rs` — read-only access via existing public APIs; no new code paths
  - Frontend `src/` — ZERO frontend changes; eval is internal-only
  - Existing eval modules (organism_eval, vitality_eval, hormone_eval, safety_eval, capability_gap_eval, etc.) — untouched; their gates remain green
- **Locked: No new Cargo deps required.** The eval reuses existing `tempfile`, `serde_json`, `chrono`, `rusqlite`, `tokio`. The `ScriptedProvider` uses `std::sync::Mutex` and `Vec`. The bin target reuses BLADE's existing main-binary deps.
- **Locked: Six-place config rule applies** to every new field in `EvalConfig`. See CLAUDE.md. Don't try to remember the six places; copy the diff Phase 36-01 used for `IntelligenceConfig` and adapt every line.
- **Locked: `safe_slice` is mandatory** for any string-slice operation on user/conversation/file content inside fixtures. Risk sites: rendering fixture conversations into the prompt for EVAL-04, rendering scripted tool responses for EVAL-01, fixture-label string truncation for table display.

### Testing & Verification

- **Locked: Each EVAL-01..04 needs at least one driver test naming row at the harness level.** The `#[test] fn run_intelligence_eval_driver()` driver test runs all 26 fixtures through `to_row` → `summarize` → `print_eval_table` and asserts MODULE_FLOOR=1.0.
- **Locked: Test naming convention.** Per-fixture test names use the pattern `phase37_eval_NN_<fixture-label>` for any fixture that becomes its OWN `#[test]` (not just a row in the driver test). Convention examples:
  - `phase37_eval_01_code_edit_multi_file`
  - `phase37_eval_01_all_haltreasons_covered`
  - `phase37_eval_02_simple_time_query_under_token_cap`
  - `phase37_eval_03_repeated_action_observation_pair_detected`
  - `phase37_eval_03_healthy_controls_zero_false_positives`
  - `phase37_eval_04_auth_flow_decisions_markers_survive_compaction`
  - `phase37_eval_05_verify_intelligence_short_circuits_when_disabled` (bash-script test via shell-out)
- **Locked: Test seam pattern.** Mirror Phase 33-04's `LOOP_OVERRIDE`, Phase 34-04's `RES_FORCE_STUCK`, Phase 35-04's `DECOMP_FORCE_STEP_COUNT`, Phase 36-03's `INTEL_FORCE_PAGERANK_RESULT` — introduce one new seam:
  - `EVAL_FORCE_PROVIDER` thread-local — tests inject a closure replacing the production provider dispatch inside `run_loop`.
  All `#[cfg(test)]`-gated; production builds carry zero overhead.
- **Locked: Eval-disabled regression test required.** A unit test sets `eval.intelligence_eval_enabled = false` and asserts `verify-intelligence.sh` (invoked via `std::process::Command`) returns exit 0 with the skip message in stdout. Mirrors Phase 36-09's kill-switch posture verbatim.
- **Locked: Panic-injection regression test required for ScriptedProvider.** Force a panic inside the scripted closure via the test seam; assert `run_loop` halts gracefully via Phase 33-09's existing panic discipline (does NOT crash the test thread) AND that the eval row reports `passed = false` instead of aborting the whole table. Validates the deterministic eval respects the v1.1 lesson.
- **Locked: Tree-sitter / repo-map drift test.** EVAL-02's `code-query-fixed-paths` fixture runs against the live BLADE codebase symbol graph at test time. If the symbol graph hasn't been indexed (CI cold start), the eval calls `intelligence::reindex_symbol_graph(&blade_root)` first via the existing public function. This couples EVAL-02 to Phase 36's INTEL-01..03 surface — a regression in tree-sitter parsing surfaces here.
- **Locked: Compaction-fidelity drift test.** EVAL-04 also indirectly tests Phase 32 CTX-03's `build_compaction_summary_prompt` shape — if the prompt template changes (e.g. a USER_CONTEXT section is renamed), markers may stop matching, and the eval catches it.
- **Locked: Stuck-detection drift test.** EVAL-03 directly calls `resilience::stuck::detect_stuck` — a regression in the detection logic surfaces immediately.
- **Locked: NO new e2e Playwright test.** Phase 37 is offline-only; no chat-stream test extension.
- **Locked: Runtime UAT scope.** Phase 37 has NO runtime UI surface (per "What Phase 37 does NOT touch" above). UAT applies to: (a) running `bash scripts/verify-intelligence.sh` and confirming green, (b) running `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` once and confirming `eval-runs/v1.5-baseline.json` is created with reasonable shape, (c) running `BLADE_INTELLIGENCE_EVAL=false bash scripts/verify-intelligence.sh` and confirming the skip path. NO screenshot-based UAT (no UI changes); the `docs/testing ss/` directory is not exercised. The deferred-UAT pattern from feedback_deferred_uat_pattern.md applies cleanly: code-complete + scripts working + cargo test green = checkpoint:human-verify boundary; runtime-LLM benchmark mode is operator-deferred (the operator runs it once + commits the baseline).
- **Locked: tsc --noEmit + cargo check must remain clean.** No regressions in the 37 verify gates. The pre-existing OEVAL-01c v1.4 drift remains out-of-scope per the SCOPE BOUNDARY established by Phase 32-07 / 33-09 / 34-11 / 35-11 / 36-09.

### Claude's Discretion (catch-all)

- File-level layout inside `intelligence_eval.rs` — whether the four eval banners share one mega-`fixtures()` returning all 26 rows or split into four `fn fixtures_eval_NN()` helpers concatenated in the driver. Recommend split-by-banner — easier PR review when adding a fixture; minor harness boilerplate cost.
- Whether to use a single per-test `#[test] fn run_intelligence_eval_driver()` driver (matching organism_eval) or separate `#[test]` per banner (matching some other v1.4 evals). Recommend SINGLE driver — emits one EVAL-06 box-drawing table with all 26 rows; multiple drivers would emit 4 tables and complicate the verify-intelligence.sh grep count.
- Whether to commit a starter `eval-runs/v1.5-baseline.json` with placeholder values (10/10 passed) or leave the file un-created until the operator runs the benchmark. Recommend LEAVE UN-CREATED — committing placeholder pass counts invites future-Claude to assume the file is real. The deterministic lane handles missing-file gracefully (first-run mode). Operator runs the benchmark once at Phase 37 close + commits the real baseline as part of the close-out commit.
- Whether to add a `--quiet` flag to `run-intel-benchmark.sh` for CI environments. Recommend NO — operators run it interactively; no scripted CI scenario yet. Add as v1.6+ if needed.
- Whether the bin target `intelligence-benchmark` should also support arbitrary fixture subsets via a CLI flag (e.g. `--only EVAL-01:code-edit-multi-file`). Recommend YES — straightforward `clap` parsing; saves operators from running the full 10-fixture suite when iterating on a single regression. Keep within Phase 37 scope as a Claude's-discretion polish.
- Whether to print fixture-level cost estimates inline during operator-runnable runs. Recommend YES — surfaces real-LLM cost transparently; one log line per fixture (`[run-intel-benchmark] code-edit-multi-file: $0.42 (12 iterations, 4521 in / 892 out)`).
- Whether to emit a separate CSV alongside the JSON baseline. Recommend NO — JSON is sufficient; CSV adds dual-source-of-truth risk.
- Whether to gate the operator-runnable mode behind a hard min-balance check on the provider. Recommend NO — out-of-scope for Phase 37; provider error handling is Phase 34's responsibility (RES-05 fallback chain catches insufficient-balance errors and the bin target inherits that behavior automatically).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 37 row (lines 202–214) + 5 success criteria + EVAL-01..05 sequencing
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — EVAL-01..05 verbatim (lines 63–67)
- `/home/arnav/blade/.planning/STATE.md` — v1.5 milestone state, key decisions table
- `/home/arnav/blade/.planning/PROJECT.md` — Project core value (read for tone)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (six-place config, safe_slice, Tauri command namespace, verification protocol, what-not-to-do list)
- `/home/arnav/CLAUDE.md` — workspace defaults (Tauri 2 + React + Tailwind v4)

### Phase 32 Predecessor (read for compaction surface — EVAL-04 consumes it)
- `/home/arnav/blade/.planning/phases/32-context-management/32-CONTEXT.md` — selective injection + LAST_BREAKDOWN accumulator (EVAL-02 reads); compaction trigger + build_compaction_summary_prompt (EVAL-04 inspects); CTX-07 fallback discipline (EVAL-03 healthy-controls assert it)
- `src-tauri/src/brain.rs` — `build_system_prompt_inner` (line 714), `record_section` (line 290), `LAST_BREAKDOWN` (line 275). EVAL-02 reads LAST_BREAKDOWN per fixture.
- `src-tauri/src/commands.rs` lines 320–460 — `build_compaction_summary_prompt`, `compress_conversation_smart`, `cap_tool_output`. EVAL-04 calls build_compaction_summary_prompt directly; EVAL-02 indirectly verifies cap_tool_output via tool-output-budget assertions.

### Phase 33 Predecessor (read for loop driver — EVAL-01 exercises it)
- `/home/arnav/blade/.planning/phases/33-agentic-loop/33-CONTEXT.md` — LoopState, LoopHaltReason, run_loop, ToolError, verify_progress surfaces. EVAL-01 calls run_loop with scripted provider; EVAL-03 inspects LoopState fields.
- `src-tauri/src/loop_engine.rs` — current Phase 33 + 34 + 35 surface. Phase 37 adds 1 test seam (`EVAL_FORCE_PROVIDER`); production path unchanged.
- `.planning/phases/33-agentic-loop/33-04-PLAN.md` — `LOOP_OVERRIDE` test seam exemplar; Phase 37's `EVAL_FORCE_PROVIDER` mirrors this pattern.

### Phase 34 Predecessor (read for resilience surface — EVAL-03 consumes it)
- `/home/arnav/blade/.planning/phases/34-resilience-session/34-CONTEXT.md` — five stuck-detection patterns enumerated (EVAL-03 fixtures map 1:1); ResilienceConfig + SessionConfig 6-place precedent (EvalConfig copies)
- `src-tauri/src/resilience/stuck.rs` — `detect_stuck(state, config) -> Option<StuckPattern>` (line 92). EVAL-03 calls this directly.

### Phase 35 Predecessor (read for auto-decomposition — EVAL-01 fixture #5 exercises)
- `/home/arnav/blade/.planning/phases/35-auto-decomposition/35-CONTEXT.md` — DECOMP-01 step counter + auto-trigger threshold; Phase 37's `parallel-file-reads` fixture exercises the trigger via scripted multi-file ToolCalls
- `src-tauri/src/decomposition/` — module layout. Phase 37 reads-only.

### Phase 36 Predecessor (read for module-boundary discipline + IntelligenceConfig precedent)
- `/home/arnav/blade/.planning/phases/36-context-intelligence/36-CONTEXT.md` — IntelligenceConfig sub-struct + 6-place wire-up pattern (EvalConfig mirrors); INTEL_FORCE_* test seam pattern (EVAL_FORCE_PROVIDER mirrors); module-boundary discipline (EvalConfig touches NO Tauri commands, mirrors Phase 36's 3-command surface as the upper-bound exemplar of "what NOT to do for an internal-only phase")
- `src-tauri/src/intelligence/` — module layout exemplar; Phase 37's evals/intelligence_eval.rs is single-file because it's eval-only (vs Phase 36's per-concern submodules for production code)
- `.planning/phases/36-context-intelligence/36-01-PLAN.md` and `36-01-SUMMARY.md` — six-place config diff; Phase 37-01 plan copies the structure verbatim

### Code Anchors (must read to plan accurately)
- `src-tauri/src/evals/mod.rs` — registration site (line 24); Phase 37 appends 1 line: `#[cfg(test)] mod intelligence_eval; // Phase 37 / EVAL-01..05`
- `src-tauri/src/evals/harness.rs` — `EvalRow` (line 52), `EvalSummary` (line 64+), `summarize`, `print_eval_table`. EVAL-06 contract: tables lead with `┌──` (U+250C). Phase 37 reuses verbatim.
- `src-tauri/src/evals/organism_eval.rs` — STRUCTURAL TEMPLATE for Phase 37. Read in full before planning. MODULE_FLOOR=1.0 (line 12), `OrganismFixture` struct (line 16), `to_row` (line 21), `fixtures()` registry (line 35), per-fixture state setup pattern (lines 60+). Phase 37's intelligence_eval.rs mirrors line-for-line shape.
- `src-tauri/src/loop_engine.rs` — `run_loop` signature (look for `pub async fn run_loop(...)`); LoopState (line ~85), LoopHaltReason variants (find `pub enum LoopHaltReason`). EVAL-01 calls run_loop; EVAL-03 builds synthetic LoopState fixtures.
- `src-tauri/src/resilience/stuck.rs:92` — `pub fn detect_stuck(state: &LoopState, config: &ResilienceConfig) -> Option<StuckPattern>`. EVAL-03 calls directly.
- `src-tauri/src/commands.rs:350` — `pub(crate) fn build_compaction_summary_prompt(events: &[String]) -> String`. EVAL-04 calls directly. NOTE: function is `pub(crate)`; Phase 37 either makes it `pub` (preferable; one-line change documented in PLAN) or routes through a `#[cfg(test)]` re-export shim. Recommend the `pub` widening.
- `src-tauri/src/brain.rs` — `build_system_prompt_inner` (line 714+), `LAST_BREAKDOWN` (line 275), `take_last_breakdown` accessor (verify exact name when planning). EVAL-02 reads LAST_BREAKDOWN per fixture.
- `src-tauri/src/config.rs` — `BladeConfig` / `DiskConfig` six-place pattern (already locked from Phase 32-07 / 33-01 / 34-01 / 35-01 / 36-01). New `eval: EvalConfig` sub-struct lives here.
- `src-tauri/src/providers/mod.rs` — `complete_turn` async trait method, `TurnResult` shape. ScriptedProvider implements the same return shape.
- `scripts/verify-organism.sh` — TEMPLATE for verify-intelligence.sh. Read in full. Lines 16–25 (cargo invocation), lines 27–36 (table-presence check). Phase 37's script mirrors line-for-line with module name + log prefix swapped.
- `scripts/verify-eval.sh` — verify chain precedent for EVAL-06 contract enforcement.
- `package.json` — scripts block; verify:all chain (line 53–55 long single line). Phase 37 appends `verify:intelligence` at the END.

### Research Citations (locked in v1.5 milestone)
- **arxiv 2604.14228 — Claude Code architecture** — selective injection + agentic loop + tree-sitter context awareness. Phase 37 evaluates the v1.5 stack ported from this paper.
- **OpenHands condenser** — used in Phase 32; EVAL-04 verifies its summary-prompt fidelity.
- **Aider repo map** — used in Phase 36; EVAL-02 verifies the resulting context efficiency.
- **mini-SWE-agent / Goose capability registry** — used in Phase 33 + 35 + 36; EVAL-01 fixtures exercise the resulting loop behavior.
- **OEVAL-01..05 (Phase 30) organism eval** — direct STRUCTURAL precedent for Phase 37 fixture density, MODULE_FLOOR=1.0 discipline, and verify-organism.sh template.

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — BLADE memory index. `feedback_deferred_uat_pattern.md` applies: Phase 37 ships at the checkpoint:human-verify boundary, operator-runnable benchmark + baseline.json commit deferred to the operator. `feedback_uat_evidence.md` does NOT apply (no UI surface) — the runtime UAT discipline is satisfied by `cargo test --lib evals::intelligence_eval` green + `bash scripts/verify-intelligence.sh` green.
- 188 pre-existing staged deletions in `.planning/phases/00-31-*` directories — Phase 37 commits MUST stage specific paths. NEVER `git add -A` / `git add .`.

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete code patterns to reuse (not invent):**

- EVAL-01 driver test shape (mirror organism_eval.rs:1–50):
  ```rust
  //! Phase 37 / EVAL-01..05 — Capstone intelligence eval.
  //!
  //! MODULE_FLOOR = 1.0 (capstone gate — no relaxed fixtures)
  //! No live LLM involvement. Uses ScriptedProvider for EVAL-01 + mocked summaries for EVAL-04.
  //! Run with --test-threads=1.
  //!
  //! Run: `cargo test --lib evals::intelligence_eval -- --nocapture --test-threads=1`

  use super::harness::{print_eval_table, summarize, EvalRow};

  const MODULE_NAME: &str = "intelligence";
  const MODULE_FLOOR: f32 = 1.0;

  struct IntelligenceFixture {
      label: &'static str,
      requirement: &'static str,
      run: fn() -> (bool, String),
  }

  fn to_row(label: &str, requirement: &str, passed: bool, result: &str, expected: &str) -> EvalRow {
      EvalRow {
          label: format!("{}: {}", requirement, label),
          top1: passed,
          top3: passed,
          rr: if passed { 1.0 } else { 0.0 },
          top3_ids: vec![result.to_string()],
          expected: expected.to_string(),
          relaxed: false,
      }
  }

  fn fixtures() -> Vec<IntelligenceFixture> {
      let mut v = Vec::new();
      v.extend(fixtures_eval_02_context_efficiency());
      v.extend(fixtures_eval_03_stuck_detection());
      v.extend(fixtures_eval_04_compaction_fidelity());
      v.extend(fixtures_eval_01_multi_step_tasks());
      v
  }

  #[test]
  fn run_intelligence_eval_driver() {
      let mut rows: Vec<EvalRow> = Vec::new();
      for fix in fixtures() {
          let (passed, result) = (fix.run)();
          rows.push(to_row(fix.label, fix.requirement, passed, &result, "passes"));
      }
      let sum = summarize(&rows);
      print_eval_table(MODULE_NAME, &rows, &sum, MODULE_FLOOR);
      assert!(sum.asserted_mrr >= MODULE_FLOOR, "intelligence eval below floor");

      // EVAL-03 aggregate accuracy assertion (after table emits)
      let stuck_rows: Vec<&EvalRow> = rows.iter().filter(|r| r.label.starts_with("EVAL-03:")).collect();
      let stuck_passes = stuck_rows.iter().filter(|r| r.top1).count();
      let accuracy = stuck_passes as f32 / stuck_rows.len() as f32;
      let cfg = blade::config::load_config();
      assert!(accuracy >= cfg.eval.stuck_detection_min_accuracy,
          "EVAL-03 accuracy below floor");
  }
  ```

- ScriptedProvider state seam pattern in loop_engine.rs (mirror Phase 33-04 LOOP_OVERRIDE):
  ```rust
  // In loop_engine.rs:
  #[cfg(test)]
  thread_local! {
      pub static EVAL_FORCE_PROVIDER: std::cell::RefCell<Option<Box<dyn Fn(&[ConversationMessage], &[ToolDefinition]) -> Result<TurnResult, String>>>> =
          std::cell::RefCell::new(None);
  }

  #[cfg(test)]
  fn maybe_force_provider(msgs: &[ConversationMessage], tools: &[ToolDefinition]) -> Option<Result<TurnResult, String>> {
      EVAL_FORCE_PROVIDER.with(|cell| {
          cell.borrow().as_ref().map(|f| f(msgs, tools))
      })
  }

  // In run_loop's complete_turn dispatch site:
  #[cfg(test)]
  if let Some(forced) = maybe_force_provider(&conv, &tools) {
      // use forced result
  }
  ```

- EVAL-03 stuck detection invocation (one fixture's run body):
  ```rust
  fn fixture_repeated_action_observation_pair() -> (bool, String) {
      let state = build_state_repeated_action_pair();
      let config = blade::resilience::ResilienceConfig::default();
      let result = blade::resilience::stuck::detect_stuck(&state, &config);
      let passed = result.is_some() && matches!(result.unwrap(), StuckPattern::RepeatedActionObservation);
      (passed, format!("detect_stuck returned {:?}", result))
  }

  fn build_state_repeated_action_pair() -> LoopState {
      let mut state = LoopState::default();
      // populate recent_actions with 3+ identical (tool_name, args) pairs
      for _ in 0..4 {
          state.recent_actions.push(ToolCall {
              tool_name: "bash".into(),
              args: r#"{"command":"ls"}"#.into(),
          });
      }
      state
  }
  ```

- EVAL-04 compaction fidelity invocation (one fixture's run body):
  ```rust
  fn fixture_auth_flow_decisions() -> (bool, String) {
      let conv = build_conv_auth_flow_decisions();
      let events: Vec<String> = conv.iter().filter_map(/* same shape as compress_conversation_smart */).collect();
      let prompt = blade::commands::build_compaction_summary_prompt(&events);

      let markers = ["USER_GOAL: build auth flow", "DECISION: use JWT not session", "CONSTRAINT: no third-party deps"];
      let all_present = markers.iter().all(|m| prompt.contains(m));

      (all_present, format!("{} of {} markers in prompt", markers.iter().filter(|m| prompt.contains(*m)).count(), markers.len()))
  }
  ```

- EVAL-02 context efficiency invocation (one fixture's run body):
  ```rust
  fn fixture_simple_time_query() -> (bool, String) {
      let config = blade::config::test_default_config();  // helper that loads v1.5 defaults
      let conv = vec![ConversationMessage::User("what time is it?".into())];
      let _prompt = blade::brain::build_system_prompt_inner(&conv, &config, /* ... */);
      let breakdown = blade::brain::take_last_breakdown();

      let total_tokens: usize = breakdown.values().sum::<usize>() / 4;
      let forbidden = ["ocr", "hormones", "repo_map", "anchor_screen"];
      let any_forbidden = forbidden.iter().any(|s| breakdown.contains_key(*s));

      let passed = total_tokens <= 800 && !any_forbidden;
      (passed, format!("total tokens={total_tokens}, any_forbidden={any_forbidden}"))
  }
  ```

- `safe_slice(text, max_chars)` from `lib.rs` is mandatory for: rendering fixture conversations into the prompt for EVAL-04, rendering scripted tool responses for EVAL-01, fixture-label string truncation for table display.

- Six-place config wire-up — copy the diff Phase 36-01-SUMMARY.md used for `IntelligenceConfig` and adapt every line for `EvalConfig`.

**Concrete config additions (six-place rule applies to each):**
```rust
pub struct EvalConfig {
    pub intelligence_eval_enabled: bool,                 // default true
    pub baseline_path: PathBuf,                          // default blade_config_dir().join("eval-runs/v1.5-baseline.json")
    pub multi_step_iterations_cap: u32,                  // default 25
    pub stuck_detection_min_accuracy: f32,               // default 0.80
    pub context_efficiency_strict: bool,                 // default true
}
```
Add `eval: EvalConfig` field to `BladeConfig` and `DiskConfig`. Default impl, load_config, save_config — six places per CLAUDE.md.

**Concrete verify-intelligence.sh template:** see `scripts/verify-organism.sh` — copy verbatim, swap module name (`organism` → `intelligence`), swap log prefix (`[verify-organism]` → `[verify-intelligence]`), add the BLADE_INTELLIGENCE_EVAL env-var skip block at the top.

**Concrete bin/intelligence_benchmark.rs skeleton:**
```rust
//! Phase 37 / EVAL-01 — Operator-runnable real-LLM benchmark.
//! Run: `BLADE_RUN_BENCHMARK=true cargo run --bin intelligence-benchmark`

#[tokio::main]
async fn main() {
    if std::env::var("BLADE_RUN_BENCHMARK").as_deref() != Ok("true") {
        println!("Skipping: set BLADE_RUN_BENCHMARK=true to run real-LLM benchmark.");
        std::process::exit(0);
    }
    let config = blade::config::load_config();
    println!("[run-intel-benchmark] using {}/{}", config.provider, config.model);
    println!("[run-intel-benchmark] estimated cost cap: $5.00 (10 fixtures x $0.50 hard cap)");
    // Run the same 10 EVAL-01 fixtures using the REAL provider (no ScriptedProvider).
    // Output to eval-runs/v1.5-baseline.json.
}
```

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't run `cargo check` after every edit — batch first, check at end (1-2 min per check).
- Don't add Co-Authored-By lines to commits.
- Don't use `&text[..n]` on user content — use `safe_slice`.
- Don't create a Tauri command name that already exists in another module — Phase 37 ships ZERO new Tauri commands. Verify before any temptation to add one.
- Don't claim the phase is "done" because static gates pass — `cargo test --lib evals::intelligence_eval` green + `bash scripts/verify-intelligence.sh` green is the gate; operator-deferred runtime benchmark + baseline.json commit is the close-out checkpoint.
- Don't run real-LLM calls in the deterministic CI lane — `verify-intelligence.sh` MUST NOT depend on a configured provider. ScriptedProvider for EVAL-01, mocked summary for EVAL-04, direct calls to `detect_stuck` for EVAL-03, direct LAST_BREAKDOWN inspection for EVAL-02. The operator-runnable mode is the only real-LLM lane.
- Don't sweep in pre-existing staged deletions — `git add` only the specific files Phase 37 touches. The 188 pre-existing deletions in `.planning/phases/00-31-*` are tracked as a separate cleanup task; Phase 37 must NOT modify their staging state.
- Don't add a 6th field to `EvalConfig` to chase coverage — the 5 fields locked above are sufficient. v1.6+ if eval-of-eval finds a missing knob.

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 37 scope:

- **Live A/B routing eval** (run task 5x through provider chain A vs B and compare scores) — current scope: deterministic offline regression check + opt-in single-provider operator benchmark. Multi-provider A/B is v1.6+.
- **Multi-session aggregate eval** (run 100 real conversations from the SessionWriter JSONL log, score each against the rubric) — current scope: 10 synthetic representative fixtures. Real-session-replay eval is v1.6+ when SessionWriter logs accumulate.
- **Real-token-usage trend dashboard** (track tokens/task over BLADE versions in a chart) — current scope: per-run JSON snapshot. A trend chart in DoctorPane is v1.6+.
- **Per-fixture cost ceiling configurability** — current scope: hard-coded $0.50 per fixture / $5.00 total. Configurable cost cap is v1.6+.
- **Fixture autoplay UI in DoctorPane** — current scope: cargo test stdout. A "run intelligence eval" button in DoctorPane is v1.6+.
- **Eval result diff UI** (show "v1.5.0 → v1.5.1: 9/10 → 10/10 on EVAL-01") — current scope: regression-only check via baseline.json. A polished diff view is v1.6+.
- **Adversarial fixture generation** (LLM generates novel hard tasks) — current scope: hand-curated 10 fixtures. LLM-generated fixtures are v1.6+ research; they introduce non-determinism by definition.
- **Cross-language eval coverage** (run the 10 fixtures in TypeScript, Rust, Python codebases separately) — current scope: BLADE-as-target codebase only. Multi-language eval suite is v1.6+.
- **Persona-stability eval inside the loop** (does BLADE stay in character across 25 iterations?) — current scope: organism eval (Phase 30) handles persona stability statically. In-loop persona drift detection is v1.6+.
- **Sub-agent isolation eval beyond the trigger-test fixture** — current scope: EVAL-01 `parallel-file-reads` exercises the trigger; deeper isolation tests (e.g. asserting child context never leaks to parent) are v1.6+.
- **EVAL output piping to a hosted dashboard** (Grafana, Datadog) — current scope: stdout + JSON. Dashboard wiring is v1.6+ ops.
- **Per-PR eval delta automation** (CI bot comments with EVAL-01 score change) — current scope: the verify gate gives binary pass/fail. Diff-aware PR commenting is v1.6+ DevX.
- **Mid-stream re-route eval** (does BLADE handle a provider switching mid-conversation?) — current scope: Phase 34 RES-05 is exercised structurally via EVAL-01's `cost-guard-warn` fixture. Mid-stream re-route is a v1.6+ scope expansion of RES-05.
- **Symbol-graph-aware eval** (does INTEL-03 actually pick the right symbols for the user's query?) — current scope: EVAL-02's code-query fixture asserts `repo_map` row presence + total cap. Per-symbol relevance scoring is v1.6+; would require rubric data.
- **Capability registry eval** (does INTEL-04..05 route correctly across N model/provider combinations?) — current scope: Phase 36-05's existing `phase36_intel_05_router_uses_registry_for_vision_routing` test covers this. Phase 37 does not duplicate; broader capability eval is v1.6+.
- **Anchor parser eval** (does INTEL-06 correctly parse N adversarial @-syntax variants?) — current scope: Phase 36-09's existing fuzz test covers this. Phase 37 does not duplicate.
- **EVAL-06 graceful empty-table** behavior — current scope: MODULE_FLOOR=1.0 means empty table = harness bug, not graceful. Phase 30 organism eval has the same posture.
- **Operator-runnable mode shipping baseline.json with starter values** — current scope: file is operator-populated on first benchmark run. Shipping placeholder values is v1.6+ if it materially helps onboarding (see `Claude's discretion` above; recommendation is leave un-created).
- **Phase 38 close-out tasks** — README cites + CHANGELOG + milestone audit + phase archive — Phase 38, NOT this phase.

</deferred>

<wave-shape>
## Wave Shape (recommended; planner has discretion to adjust)

Phase 37 spans **8 plans across 4 waves** — narrower than Phase 35 (5 waves, 11 plans) and Phase 36 (5 waves, 9 plans) because the surface is internal-only (eval module, no Tauri commands, no frontend, single touched file in production code = 1-line config addition).

```
Wave 1  (parallel-safe; both add scaffolding)
├── 37-01: EvalConfig sub-struct (6-place rule x 5 fields) + eval-runs/.gitkeep
└── 37-02: intelligence_eval.rs scaffold + ScriptedProvider + EVAL_FORCE_PROVIDER seam in loop_engine.rs

Wave 2  (parallel-safe; non-overlapping fixture sub-modules)
├── 37-03: EVAL-01 multi-step task fixtures (10 fixtures wired through ScriptedProvider)
└── 37-04: EVAL-02 context efficiency fixtures (3 fixtures via LAST_BREAKDOWN inspection)

Wave 3  (parallel-safe; non-overlapping fixture sub-modules)
├── 37-05: EVAL-03 stuck detection fixtures (5 stuck + 5 healthy via direct detect_stuck calls)
└── 37-06: EVAL-04 compaction fidelity fixtures (3 fixtures via build_compaction_summary_prompt)

Wave 4  (sequential; gate + operator-runnable + close)
├── 37-07: scripts/verify-intelligence.sh + package.json verify:all wire-up + 38-gate count update
└── 37-08: bin/intelligence_benchmark.rs + scripts/run-intel-benchmark.sh + checkpoint:human-verify UAT
```

**Wave-by-wave dependencies:**
- Wave 1 plans share `config.rs` (37-01) and `loop_engine.rs` (37-02) but touch DIFFERENT line ranges — safe to parallelize.
- Wave 2 plans both edit `intelligence_eval.rs` but in DIFFERENT banner sections (EVAL-01 vs EVAL-02) — safe to parallelize.
- Wave 3 plans both edit `intelligence_eval.rs` but in DIFFERENT banner sections (EVAL-03 vs EVAL-04) — safe to parallelize.
- Wave 4 must be sequential: 37-07 verifies the test module is green BEFORE 37-08 runs the operator-runnable mode and ships the close-out commit.

**Plan summary:**
- **37-01** — EvalConfig sub-struct + 6-place rule x 5 fields (intelligence_eval_enabled, baseline_path, multi_step_iterations_cap, stuck_detection_min_accuracy, context_efficiency_strict) + `eval-runs/.gitkeep`. ~80 lines diff. Mirrors Phase 36-01.
- **37-02** — intelligence_eval.rs scaffold (MODULE_NAME + MODULE_FLOOR + IntelligenceFixture struct + to_row + empty fixtures + driver test) + EVAL_FORCE_PROVIDER seam in loop_engine.rs + ScriptedProvider definition + minimal smoke test (`phase37_eval_scaffold_emits_empty_table`). ~250 lines diff.
- **37-03** — EVAL-01 banner: 10 multi-step task fixtures + ScriptedResponse arrays + per-fixture scripted_responses const data + driver wire-up in fixtures registry. ~400 lines diff.
- **37-04** — EVAL-02 banner: 3 context efficiency fixtures + ContextEfficiencyFixture struct + LAST_BREAKDOWN inspection helpers. ~150 lines diff.
- **37-05** — EVAL-03 banner: 10 stuck/healthy fixtures + StuckDetectionFixture struct + LoopState builders + aggregate accuracy assertion at end-of-driver. ~250 lines diff.
- **37-06** — EVAL-04 banner: 3 compaction fidelity fixtures + CompactionFidelityFixture struct + build_compaction_summary_prompt visibility widening (pub(crate) to pub) + per-fixture conversation builders. ~200 lines diff.
- **37-07** — scripts/verify-intelligence.sh + package.json wire (insert verify:intelligence script + append to verify:all chain). ~50 lines diff. Verify 37 → 38 gate count update; all 37 prior gates green check.
- **37-08** — bin/intelligence_benchmark.rs + scripts/run-intel-benchmark.sh + Cargo.toml [[bin]] entry + checkpoint:human-verify UAT script + STATE.md + ROADMAP.md update + close-out commit. Operator-runnable benchmark runs DEFERRED to operator. ~250 lines diff (most in bin/intelligence_benchmark.rs).

**Total estimate:** ~1,630 lines of diff across 8 plans. Smaller than Phase 36 (~2,400 lines) and Phase 35 (~3,100 lines) because no production-code module + no frontend.

**Common helpers** (lift to module-level after Wave 2 if duplication appears): `setup_scripted_provider(script: &'static [ScriptedResponse])`, `assert_loop_haltreason(state: &LoopState, expected: LoopHaltReason)`, `build_synthetic_conversation(turns: usize, markers: &[&str])`, `take_breakdown_section(label: &str) -> Option<usize>`. Plan 37-02 may stub these as part of the scaffold; Wave 2/3 plans flesh them out.

</wave-shape>

<requirements>
## Requirements Coverage

Each EVAL-NN row maps to specific plan numbers + a ROADMAP success criterion citation.

| Req | Roadmap Success Criterion (verbatim) | Plans | Fixture / Surface |
|-----|---------------------------------------|-------|-------------------|
| EVAL-01 | "A before/after benchmark on 10 representative tasks shows measurable improvement in multi-step completion rate — results are logged to a fixture file, not just printed to terminal" | 37-02 (ScriptedProvider + seam), 37-03 (10 fixtures), 37-08 (operator-runnable bin + baseline.json) | 10 multi-step task fixtures via ScriptedProvider in EVAL-01 banner; results emit to scored table; operator runs `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` once to populate `eval-runs/v1.5-baseline.json` |
| EVAL-02 | "Context efficiency metric (tokens per task complexity unit) is lower after v1.5 than the pre-v1.5 baseline — compaction and selective injection produce a measurable reduction" | 37-04 (3 fixtures) | 3 context efficiency fixtures via LAST_BREAKDOWN inspection; per-fixture `expected_max_total_tokens` enforces caps; `forbidden_section_labels` enforces selective-injection correctness |
| EVAL-03 | "Stuck-detection accuracy on 5 synthetic stuck scenarios is >= 80% (detects stuck, does not false-positive on healthy loops)" | 37-05 (10 fixtures + aggregate assertion) | 5 stuck + 5 healthy fixtures via direct `resilience::stuck::detect_stuck`; aggregate accuracy assertion at end-of-driver: `accuracy = passes/10 >= 0.80` (config-driven via `EvalConfig.stuck_detection_min_accuracy`) |
| EVAL-04 | "After N compaction cycles on a known conversation, the critical context elements (task goal, user constraints, key decisions) are still present and accurate in the compacted form" | 37-06 (3 fixtures) | 3 compaction fidelity fixtures via direct `commands::build_compaction_summary_prompt` (visibility widened to `pub`); each asserts critical markers survive in the prompt + post-compaction conversation; mocked summary preserves markers verbatim (no live LLM) |
| EVAL-05 | "`verify:intelligence` gate is green and the verify chain grows from 37 to 38 gates; all 37 existing gates remain green" | 37-07 (verify-intelligence.sh + package.json wire) | New 38th gate `scripts/verify-intelligence.sh` mirrors verify-organism.sh; `npm run verify:all` chain extends to 38 entries; CTX-07-style escape hatch via `BLADE_INTELLIGENCE_EVAL=false` |

**Success-criterion fully covered:** all 5 of 5 EVAL requirements have direct fixture or gate coverage.

**Indirect coverage:**
- ROADMAP success criterion #1 ("measurable improvement"): the operator-runnable benchmark mode (Plan 37-08) populates the baseline; deterministic CI lane regression-checks against it. Improvement is measurable iff the operator runs the benchmark twice (once before v1.5, once after) — but the v1.5 phases are already complete, so the "before" baseline is missing in practice. Phase 37's 10 fixtures provide the v1.5 BASELINE (the after); future v1.6+ work can compare against it. Documented as Locked Decision in 37-08-PLAN that "before/after" pivots to "v1.5 baseline locked, future versions regression-check" semantics.

</requirements>

---

*Phase: 37-intelligence-eval*
*Context gathered: 2026-05-08 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / PROJECT.md / CLAUDE.md / Phase 36 predecessor (36-CONTEXT.md) / Phase 35 predecessor (35-CONTEXT.md) / Phase 34 predecessor (34-CONTEXT.md) / Phase 33 predecessor (33-CONTEXT.md) / Phase 32 fallback discipline (32-CONTEXT.md) / Phase 30 organism eval template (organism_eval.rs, 684 lines) / live codebase grounding at evals/harness.rs (311 lines, EVAL-06 contract) + evals/mod.rs (24 lines, registration site) + loop_engine.rs (run_loop signature for ScriptedProvider integration) + resilience/stuck.rs:92 (detect_stuck for EVAL-03) + commands.rs:350 (build_compaction_summary_prompt for EVAL-04) + brain.rs:275 (LAST_BREAKDOWN for EVAL-02) + scripts/verify-organism.sh (verify-intelligence.sh template).*
