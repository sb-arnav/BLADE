---
phase: 32-context-management
plan: 2
subsystem: infra
tags: [tests, harness, fixtures, ctx-07, integration-target, brain, commands, rust, tauri]

# Dependency graph
requires:
  - phase: 32-01
    provides: "ContextConfig + ContextBreakdown wire types — Plan 32-02 mounts a test harness on top of these without re-declaring contracts"
  - phase: 11-smart-provider-setup
    provides: "TEST_KEYRING_OVERRIDES thread_local pattern at config.rs:89-105 — CTX_SCORE_OVERRIDE mirrors this verbatim"
provides:
  - "CTX_SCORE_OVERRIDE thread_local seam in brain.rs (test-only — `#[cfg(test)]`-gated at three sites: thread_local declaration, in-fn consult block, all callers)"
  - "build_test_conversation(n) + build_test_conversation_with_token_target(t) fixtures in commands.rs `mod tests` — used by Plans 32-03/04/05"
  - "src-tauri/tests/context_management_integration.rs — registered cargo integration target (currently placeholder; Plans 32-03..07 fill in)"
  - "5 new Phase 32 tests green (3 brain::tests::phase32_score_override_*, 2 commands::tests::phase32_build_*) on top of 5 from Plan 32-01"
  - "Confirmation that release builds compile cleanly with the override seam excluded (cargo check --release exit 0)"
affects: [32-03-selective-injection, 32-04-compaction-trigger, 32-05-tool-output-cap, 32-07-fallback-fixture]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — pure test harness on existing serde / tokio / tauri stack
  patterns:
    - "Test override seam pattern (#[cfg(test)] thread_local consulted at top of public fn) — reusable for any subsequent BLADE module that needs deterministic test injection"
    - "Integration test target uses lib name `blade_lib` (not package name `blade`) — `use blade_lib::config::ContextConfig;` is the canonical import shape"
    - "Smoke-only fallback for integration tests when internal modules are not pub on the crate root — exercise public-surface types (ContextConfig from `pub mod config`) instead of leaking `pub use brain::*` into lib.rs"

key-files:
  created:
    - "src-tauri/tests/context_management_integration.rs (new integration target — placeholder phase32_integration_placeholder test exercises ContextConfig defaults)"
  modified:
    - "src-tauri/src/brain.rs (CTX_SCORE_OVERRIDE thread_local + override consult in score_context_relevance + 3 tests appended to existing mod tests)"
    - "src-tauri/src/commands.rs (new #[cfg(test)] pub(crate) mod tests block at end-of-file with 2 fixture helpers + 2 tests)"

key-decisions:
  - "CTX_SCORE_OVERRIDE placed BEFORE `score_context_relevance` (not inside the existing mod tests) — must be visible to the function body when `#[cfg(test)]` is active. Pattern mirrors TEST_KEYRING_OVERRIDES at config.rs:89-105 verbatim."
  - "In-function consult block uses `#[cfg(test)] { ... if let Some(v) = overridden { return v; } }` — early-return preserves byte-for-byte production behavior when the override is None (the common case in tests too, only set in CTX-07-style fixtures)."
  - "Each override-using test resets to `None` BEFORE its assertion — defensive insurance against parallel-test bleed even though Rust's test runner is thread-per-test."
  - "Integration test target imports from `blade_lib::config::ContextConfig` (not `blade::...`). Cargo.toml declares `[lib].name = \"blade_lib\"` even though `[package].name = \"blade\"`; integration tests must use the lib name. Documented in the file's preamble for plans 32-03..07 to copy."
  - "Integration test stub falls back to ContextConfig-only smoke (not ContextBreakdown) because `brain` is currently `mod brain;` (private) in lib.rs. Phase 32 does not justify making it public on the lib root — the override-driven tests live as inline `#[cfg(test)] mod tests` in brain.rs (Plan 32-07's domain). Integration target stays for end-to-end Tauri-command-level cases (Plan 32-06's domain)."
  - "build_test_conversation alternation: index 0 = System, index 1 (i=0, even) = User, index 2 (i=1, odd) = Assistant — verified explicitly in phase32_build_test_conversation_shape so downstream plans can rely on the pattern."
  - "Token-aware fixture tolerance is ±50% (intentionally wide). Compaction triggers in Plan 32-04 operate on `chars/4` estimates which can under-count by 37% for non-English / emoji-heavy text (per RESEARCH.md). Tight fixture tolerance would create false test failures without catching real bugs."

patterns-established:
  - "Pattern: test-only override seam. `#[cfg(test)] thread_local!` of `RefCell<Option<Box<dyn Fn(...) -> T>>>` consulted at top of the public function. Caller pattern: `OVERRIDE.with(|cell| { *cell.borrow_mut() = Some(Box::new(|...| value)); })` — call code — `*cell.borrow_mut() = None;` reset. Used twice now (config TEST_KEYRING_OVERRIDES, brain CTX_SCORE_OVERRIDE)."
  - "Pattern: integration test scaffold — Wave 1 plans land an empty `tests/<surface>_integration.rs` so subsequent waves only ADD test fns, never edit the cargo target registration. Smoke-only placeholder is a free-standing `assert!(...)` on a public-surface type."

requirements-completed: [CTX-07]

# Metrics
duration: 44 min
completed: 2026-05-03
---

# Phase 32 Plan 32-02: Context Management Test Harness Summary

**Wave 1 substrate gets its companion test harness — `CTX_SCORE_OVERRIDE` lets later plans force `score_context_relevance` to panic or return a fixed value, and `build_test_conversation(n)` lets compaction / trigger / tool-cap tests fabricate deterministic conversations without scaffolding their own.**

## Performance

- **Duration:** ~44 min wall-clock (cargo recompile dominates: 54s check, 4m12s test cold compile, 7m28s release check, 9m10s integration target compile)
- **Started:** 2026-05-03T20:22:15Z
- **Completed:** 2026-05-03T21:06:13Z
- **Tasks:** 2/2 complete (both type="auto" tdd="true")
- **Files modified:** 2 (`src-tauri/src/brain.rs`, `src-tauri/src/commands.rs`)
- **Files created:** 1 (`src-tauri/tests/context_management_integration.rs`)
- **Tests added:** 5 unit/integration tests, all green (3 brain override seam, 2 commands fixture)
- **LOC delta:** +94 (brain.rs) + 87 (commands.rs) + 55 (integration test) = +236 across 3 files

## Accomplishments

- **CTX_SCORE_OVERRIDE seam landed.** `#[cfg(test)] thread_local! { pub static CTX_SCORE_OVERRIDE: ... }` declared above `score_context_relevance` (brain.rs:251). Inside the function body, a `#[cfg(test)] { ... }` block consults the override and short-circuits if Some. Production builds compile both blocks out entirely — verified by `cargo check --release` exiting 0.
- **Three brain-side override tests green.** `phase32_score_override_default_passthrough`, `phase32_score_override_returns_fixed_value`, `phase32_score_override_can_panic_safely`. The third locks in the contract Plan 32-07 needs: a panic in the smart path is catchable via `std::panic::catch_unwind` so the chat fallback can swallow it.
- **build_test_conversation fixtures added.** Two helpers in `src-tauri/src/commands.rs` `mod tests`: `build_test_conversation(n)` returns 1 system + n alternating user/assistant turns (~210 chars/turn), and `build_test_conversation_with_token_target(t)` sizes n so total tokens land within ±50% of t. Both pub(crate) so Plans 32-03/04/05's `mod tests` blocks can `use crate::commands::tests::build_test_conversation;`.
- **Integration test scaffold registered.** `src-tauri/tests/context_management_integration.rs` exists with one placeholder test that smoke-checks ContextConfig defaults via the public `blade_lib::config::ContextConfig` surface. Plans 32-03..07 add real cases by appending test fns; the file preamble documents the import pattern + the `brain mod` privacy caveat.
- **No regressions.** `cargo test --lib phase32` shows 10 tests green (5 from Plan 32-01 + 5 new from 32-02). 464 other lib tests filtered out — unchanged.
- **`cargo check` clean (3 pre-existing warnings unchanged); `cargo check --release` clean; `npx tsc --noEmit` exit 0.**

## ConversationMessage variant signatures (for Plans 32-03/04/05)

Verified at `src-tauri/src/providers/mod.rs:141`:

```rust
pub enum ConversationMessage {
    System(String),
    User(String),
    UserWithImage {
        text: String,
        image_base64: String,   // NB: NOT image_url as the plan brief stated
    },
    Assistant {
        content: String,
        tool_calls: Vec<ToolCall>,
    },
    Tool {
        tool_call_id: String,
        tool_name: String,
        content: String,
        is_error: bool,
    },
}
```

`ToolCall` (providers/mod.rs:134):
```rust
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}
```

The fixture uses `tool_calls: vec![]` for `Assistant`. `UserWithImage` and `Tool` are not constructed by the fixture today; downstream plans add helpers if needed.

## Crate name observed in Cargo.toml (for Plans 32-03..07)

```toml
[package]
name = "blade"             # binary name
[lib]
name = "blade_lib"         # library name — what integration tests import
```

Integration tests use `use blade_lib::...` (NOT `use blade::...`). The package name `blade` only appears as the executable target. Documented in `src-tauri/tests/context_management_integration.rs` preamble.

## Test Counts

**Before Plan 32-02:**
```
cargo test --lib phase32 → 5 passed (3 config + 2 brain breakdown)
cargo test --lib (full)  → 469 passed total
cargo test --tests       → 0 integration targets
```

**After Plan 32-02:**
```
cargo test --lib phase32                    → 10 passed (5 from 32-01 + 5 new)
  brain::tests::phase32_context_breakdown_default               ok
  brain::tests::phase32_context_breakdown_serializes            ok
  brain::tests::phase32_score_override_default_passthrough      ok  (NEW)
  brain::tests::phase32_score_override_returns_fixed_value      ok  (NEW)
  brain::tests::phase32_score_override_can_panic_safely         ok  (NEW)
  commands::tests::phase32_build_test_conversation_shape        ok  (NEW)
  commands::tests::phase32_build_test_conversation_token_aware  ok  (NEW)
  config::tests::phase32_context_config_default_values          ok
  config::tests::phase32_context_config_round_trip              ok
  config::tests::phase32_context_config_missing_in_disk_uses_defaults ok

cargo test --test context_management_integration → 1 passed
  phase32_integration_placeholder ... ok

cargo test --lib (full)  → 474 passed total (5 added, 0 lost)
```

## Release-build evidence (CTX_SCORE_OVERRIDE seam excluded from production)

```
$ cd /home/arnav/blade/src-tauri && cargo check --release 2>&1 | tail -5
warning: function `enable_dormancy_stub` is never used
   --> src/vitality_engine.rs:169:8
warning: `blade` (lib) generated 3 warnings
    Finished `release` profile [optimized] target(s) in 7m 28s
```

0 errors. 3 pre-existing warnings unchanged. The override block is `#[cfg(test)]`-gated at every site (thread_local declaration, in-function consult block, all three test fns), so release builds compile to byte-for-byte the same `score_context_relevance` body that shipped in Phase 32-01.

## Six-place / acceptance grep verification

```
$ grep -c "static CTX_SCORE_OVERRIDE" src-tauri/src/brain.rs                 → 1
$ grep -c "#\[cfg(test)\]" src-tauri/src/brain.rs                            → 5
$ grep -c "fn build_test_conversation" src-tauri/src/commands.rs             → 2
$ grep -c "fn build_test_conversation_with_token_target" src-tauri/src/commands.rs → 1
$ test -f src-tauri/tests/context_management_integration.rs && echo OK       → OK
$ grep -c "phase32_integration_placeholder" src-tauri/tests/context_management_integration.rs → 1
```

All seven acceptance gates met.

## Task Commits

Each task committed atomically with conventional-commit messaging.

1. **Task 1: CTX_SCORE_OVERRIDE seam + 3 tests** — `87355a5` (feat)
2. **Task 2: build_test_conversation fixture + integration scaffold** — `fdf3418` (feat)

(STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction.)

## Decisions Made

- Followed plan as specified — no behavioral deviations from the planner's spec.
- One observation: the plan brief said `ConversationMessage::UserWithImage { text, image_url }` but the actual struct uses `image_base64`. The fixture didn't construct `UserWithImage` so this had no impact, but the SUMMARY documents the actual signature for plans 32-03..05 to consume.
- Integration test fell back to ContextConfig-only smoke (planner authorized this in the caveat block) because `brain` is `mod brain;` (private) in lib.rs and exposing `pub mod brain` is out of scope for a Wave-1 substrate plan. Override-using tests live as inline brain.rs `mod tests` (where `super::*` works); the integration target is reserved for Tauri-command-level cases (Plan 32-06's surface).
- Test naming: `phase32_score_override_*` and `phase32_build_test_conversation_*` — the `phase32_` prefix lets `cargo test --lib phase32` continue to be the canonical Phase 32 test-run filter (5 tests from 32-01 → 10 after 32-02).

## Deviations from Plan

**None.** Plan executed verbatim. The integration test fallback (smoke-only on ContextConfig) was explicitly sanctioned by the planner in the `<action>` caveat: "If the imports cannot be made to work because internal types aren't `pub` from the crate root, downgrade the test to a smoke-only assertion that doesn't import internals." This is a planned branch, not a deviation.

## Issues Encountered

- **Cold-cache cargo recompile latency.** First `cargo check` 54s; first `cargo test --lib` 4m12s; first `cargo check --release` 7m28s; first `cargo test --test context_management_integration` 9m10s. CLAUDE.md's "batch first, check at end" guidance was honored — only one cargo invocation per gate.
- **`brain` mod privacy in lib.rs.** Integration tests cannot import `blade_lib::brain::...` because `mod brain;` is not `pub mod brain;`. Verified — config IS pub, brain is not. Plan caveat covered this exactly; no scope creep needed. Plans 32-06 / 32-07 will need to either (a) make brain pub on the lib root, or (b) keep the override-using tests inline. Recommendation deferred to those plans.

## User Setup Required

None — no external service configuration, no env vars, no keychain entries. Test harness is pure Rust additions; the seam is gated to test mode and excluded from release builds.

## Next Phase Readiness

**Wave 2 plans can now mount on this harness:**

- **Plan 32-03 (selective injection)** — `mod tests` block in brain.rs already exists; can add `phase32_section_gating_*` tests using the existing `super::*` import. CTX_SCORE_OVERRIDE not needed for 32-03 itself (plan 32-03 tests the gate; plan 32-07 tests the panic-safety contract).
- **Plan 32-04 (compaction trigger)** — `commands::tests::build_test_conversation_with_token_target(t)` is the canonical fixture for "build a conversation that hits the trigger". `(model_context_window * 0.80)` calculation can be tested against the fixture's predictable token estimate.
- **Plan 32-05 (tool-output cap)** — `commands::tests::build_test_conversation(n)` returns Vec<ConversationMessage> ready to inject `Tool { content: "x".repeat(N), ... }` entries into; the cap helper's input shape matches.
- **Plan 32-06 (DoctorPane dashboard)** — `tests/context_management_integration.rs` is the natural home for the Tauri-command-level tests once `get_context_breakdown` lands. Today the file has one stub; 32-06 adds the real cases.
- **Plan 32-07 (fallback fixture)** — directly consumes `CTX_SCORE_OVERRIDE`. Set the override to a closure that panics, exercise `build_system_prompt_inner` (or wrapper), assert chat-reply path returns Ok via `catch_unwind`. The harness contract is locked in `phase32_score_override_can_panic_safely`.

**No blockers.** STATE.md / ROADMAP.md updates are the orchestrator's responsibility.

## Self-Check: PASSED

Verified post-summary:

- File `src-tauri/src/brain.rs` exists and contains `static CTX_SCORE_OVERRIDE` (FOUND, grep count = 1)
- File `src-tauri/src/commands.rs` exists and contains `fn build_test_conversation` + `fn build_test_conversation_with_token_target` (FOUND, counts = 2 + 1)
- File `src-tauri/tests/context_management_integration.rs` exists and contains `phase32_integration_placeholder` (FOUND, count = 1)
- Commit `87355a5` exists in `git log` (FOUND, "feat(32-02): add CTX_SCORE_OVERRIDE seam + 3 score-override tests (CTX-07)")
- Commit `fdf3418` exists in `git log` (FOUND, "feat(32-02): add build_test_conversation fixture + integration test scaffold")
- `cargo test --lib phase32` shows 10 passed, 0 failed (5 from 32-01 + 5 new)
- `cargo test --test context_management_integration` shows 1 passed, 0 failed
- `cargo check` exits 0 (3 pre-existing warnings unchanged)
- `cargo check --release` exits 0 (override seam excluded — production unaffected)
- `npx tsc --noEmit` exits 0
- No files deleted in either task commit

---
*Phase: 32-context-management*
*Completed: 2026-05-03*
