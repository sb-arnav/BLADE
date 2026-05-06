---
phase: 34-resilience-session
plan: 5
subsystem: resilience-circuit-breaker
tags: [resilience, RES-02, circuit-breaker, error-history, attempts-summary, smart-off-regression, clear-on-success]
dependency_graph:
  requires:
    - "Phase 34 Plan 34-01 (ResilienceConfig.smart_resilience_enabled + circuit_breaker_threshold = 3)"
    - "Phase 34 Plan 34-02 (LoopHaltReason::CircuitOpen { error_kind, attempts_summary } variant + AttemptRecord struct with provider/model/error_message/timestamp_ms)"
    - "Phase 4 (existing pub(crate) record_error / is_circuit_broken / backoff_secs triad in commands.rs ─ 5-minute sliding-window count)"
    - "Phase 33 (existing classify_api_error taxonomy: TruncateAndRetry / SwitchModelAndRetry / RateLimitRetry / OverloadedRetry / Fatal — error_kind drawn from this taxonomy, no new kinds invented)"
    - "Phase 34 Plan 34-04 (smart_resilience_enabled gate pattern at run_loop iteration top — Plan 34-05 mirrors the same gate at the error-recovery branches)"
  provides:
    - "ERROR_HISTORY widened from Vec<(String, Instant)> to Vec<(String, String, String, String, Instant)> = (kind, provider, model, msg, instant)"
    - "record_error_full(kind, provider, model, msg) — full-fidelity recorder for the circuit-breaker site at run_loop"
    - "record_error(kind) — preserved as a thin wrapper calling record_error_full(kind, '', '', '') so all existing call sites continue to compile unchanged"
    - "circuit_attempts_summary(kind: &str) -> Vec<AttemptRecord> — returns the failures matching `kind` within the 5-minute window, with wall-clock-approximated timestamp_ms"
    - "clear_error_history() — resets the entire ring buffer (called by run_loop on every successful complete_turn under smart_resilience_enabled)"
    - "is_circuit_broken / backoff_secs read the new tuple shape; behavior unchanged (≥3 same-kind in 5 min)"
    - "run_loop's RateLimitRetry + OverloadedRetry branches upgraded — call record_error_full with provider/model/&e, then check is_circuit_broken AND smart_resilience_enabled before halting with LoopHaltReason::CircuitOpen { error_kind, attempts_summary } and emitting blade_loop_event { kind: 'circuit_open', error_kind, attempts: N }"
    - "post-success site at loop_engine.rs:1308 area now calls clear_error_history() inside the existing smart_resilience_enabled gate — successful turn closes the circuit"
    - "commands.rs LoopHaltReason::CircuitOpen match arm upgraded — renders structured 'what was tried' chat surface (most-recent 3 attempts, provider/model/error_message), falls back to '(unknown provider/model)' for legacy record_error wrapper entries, emits blade_loop_event halted/circuit_breaker"
  affects:
    - "src-tauri/src/commands.rs (+155 / -16 — ERROR_HISTORY widening + 3 new fns + record_error wrapper + 4 tests + LoopHaltReason::CircuitOpen arm upgrade)"
    - "src-tauri/src/loop_engine.rs (+185 / -8 — 2 error-recovery branches upgraded + clear_error_history at post-success + 3 regression tests)"
tech_stack:
  added: []
  patterns:
    - "Backward-compatible API widening — ERROR_HISTORY tuple grows from 2 fields to 5; record_error(kind) becomes a thin wrapper so existing call sites keep working with empty defaults. circuit_attempts_summary returns AttemptRecords with empty provider/model/msg for legacy entries; chat surface displays '(unknown ...)' fallback."
    - "Reset-on-success discipline — Phase 4's circuit breaker accumulated errors monotonically (50-entry cap drained oldest 10). Plan 34-05 adds clear_error_history() at the post-success site so a stale window of rate_limits doesn't block the system from escaping after recovery. Threat T-34-20 mitigation. Reset is gated on smart_resilience_enabled so smart-off path preserves Phase 33's monotonic-history behavior."
    - "smart-off escape hatch on the halt — when smart_resilience_enabled=false, record_error_full + is_circuit_broken still run (count + backoff continue to work) but the new LoopHaltReason::CircuitOpen path is skipped; the legacy ProviderFatal trip stays in place. Threat T-34-22 mitigation. Mirrors Plan 34-04's smart-off pattern at the iteration-top stuck-detector site."
    - "Approximate wall-clock timestamp — std::time::Instant has no direct epoch mapping. circuit_attempts_summary computes timestamp_ms via SystemTime::now().duration_since(UNIX_EPOCH).as_millis() - now.duration_since(*t).as_millis(). Good enough for forensic display in the chat surface; T-34-23 accepts the wall-clock disclosure (wall-clock is already visible elsewhere)."
    - "emit_stream_event at the trip site (NOT inside record_error_full) — the recorder stays a pure data-plane function so it can be called from anywhere without app handle plumbing. The blade_loop_event emit lives at the run_loop branch where AppHandle is in scope."
key_files:
  created: []
  modified:
    - "src-tauri/src/commands.rs (+155 / -16 — Phase 4 circuit-breaker block widened; LoopHaltReason::CircuitOpen arm upgraded with structured 'what was tried' rendering; 4 phase34_res_02 tests added)"
    - "src-tauri/src/loop_engine.rs (+185 / -8 — RateLimitRetry + OverloadedRetry branches upgraded with smart-on/smart-off split; clear_error_history at post-success site inside existing smart_resilience_enabled gate; 3 phase34_res_02 regression tests)"
decisions:
  - "Kept record_error(kind) as a thin wrapper instead of migrating all 7+ call sites at once. The plan acceptance criterion 'fn record_error\\b returns 1' makes this a hard requirement — and the wrapper preserves backward compat for existing call sites that don't have provider/model/msg in scope (e.g. future tests, future call paths). Empty-string defaults flow through to AttemptRecords with empty fields; the chat-surface arm renders '(unknown provider)' / '(unknown model)' / '(no error message captured)' for those."
  - "Recorded failures via record_error_full at run_loop INSIDE both the rate_limit and overloaded branches, not outside. Each branch already has &config.provider, &config.model, and &e (the provider error string) in scope — capturing them at the branch is cheaper than threading them through a helper. Per Plan 34-05 §interfaces this is the 'new circuit-breaker site' that uses the full-fidelity recorder."
  - "Surfaced structured 'what was tried' in the LoopHaltReason::CircuitOpen match arm at commands.rs:1779 by reverse-iterating attempts_summary and taking 3. Chat UIs typically read failures top-down (most recent first); the reverse-take-3 keeps the message tight while showing the freshest failures. truncated each error_message to 200 chars via crate::safe_slice (handles non-ASCII per CLAUDE.md rule)."
  - "Added a SECOND blade_loop_event at the commands.rs match arm: { kind: 'halted', reason: 'circuit_breaker', error_kind, attempts: N } in addition to the run_loop's { kind: 'circuit_open', ... } emit. Same dual-emit pattern Plan 34-04 used for Stuck halts — the chat UI's existing halted-handler renders consistently across cost-exceeded / stuck / circuit-breaker."
  - "Did NOT migrate is_circuit_broken / backoff_secs to read attempts_summary directly — they still iterate the raw tuple inside error_history(). Reasoning: those two functions are hot-path predicates (called on every error), and circuit_attempts_summary allocates a Vec<AttemptRecord> with timestamp arithmetic per entry. Keeping them as raw-tuple readers preserves the 1-microsecond predicate cost; circuit_attempts_summary is only called once at the halt site."
  - "Gated clear_error_history() on smart_resilience_enabled at the post-success site. When smart-off, ERROR_HISTORY accumulates monotonically as before — preserves Phase 33's posture so a smart-off user doesn't accidentally get the new reset behavior. Mirrors Plan 34-04's gate-everything-on-smart-off discipline."
metrics:
  duration: "~15 minutes"
  completed: "2026-05-06"
  task_count: 2
  file_count: 2
---

# Phase 34 Plan 34-05: RES-02 Circuit Breaker — Widening + Halt + Reset Summary

Plan 34-05 wires the circuit-breaker halt that turns Phase 4's "count errors in
a 5-minute window" predicate into a structured `LoopHaltReason::CircuitOpen`
return at `run_loop`'s error-recovery branches. The widening preserves the
existing 1-arg `record_error(kind)` API as a thin wrapper while introducing
`record_error_full(kind, provider, model, msg)` for the new circuit-breaker
site that wants to capture full attempt context for the chat surface. A
`clear_error_history()` call at the post-success site closes the breaker on
recovery so stale errors from a healed window do not block escape. Smart-off
preserves Phase 33's `ProviderFatal` posture; smart-on returns the new
`CircuitOpen { error_kind, attempts_summary }` variant and emits
`blade_loop_event { kind: "circuit_open", error_kind, attempts: N }` for the
ActivityStrip (Plan 34-11) to subscribe to.

## ERROR_HISTORY Type Signature: Before / After

Before (Phase 4):
```rust
static ERROR_HISTORY: std::sync::OnceLock<std::sync::Mutex<Vec<(String, std::time::Instant)>>>;
//                                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                                              (kind, instant) — 2 fields
```

After (Plan 34-05):
```rust
static ERROR_HISTORY: std::sync::OnceLock<
    std::sync::Mutex<Vec<(String, String, String, String, std::time::Instant)>>,
//                       ^^^^^^^ ^^^^^^^ ^^^^^^^ ^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^
//                       kind    provider model   msg     instant
//                       (5 fields — provider/model/msg added, capture full context)
>;
```

## New / Updated Function Signatures

```rust
// src-tauri/src/commands.rs

// NEW (Plan 34-05) — full-fidelity recorder
pub(crate) fn record_error_full(kind: &str, provider: &str, model: &str, msg: &str);

// PRESERVED (Phase 4) — thin wrapper, all existing call sites continue to work
pub(crate) fn record_error(kind: &str);          // calls record_error_full(kind, "", "", "")

// UNCHANGED behavior — reads new tuple shape
pub(crate) fn is_circuit_broken(kind: &str) -> bool;
pub(crate) fn backoff_secs(base: u64, kind: &str) -> u64;

// NEW (Plan 34-05) — emit attempts_summary for LoopHaltReason::CircuitOpen
pub(crate) fn circuit_attempts_summary(kind: &str) -> Vec<crate::loop_engine::AttemptRecord>;

// NEW (Plan 34-05) — reset on success
pub(crate) fn clear_error_history();
```

## run_loop Call Sites Upgraded

```text
$ grep -n "record_error_full\|circuit_attempts_summary\|clear_error_history" src-tauri/src/loop_engine.rs

  877:                        crate::commands::record_error_full(   ← RateLimitRetry branch
  878:                            "rate_limit",
  879:                            &config.provider,
  880:                            &config.model,
  881:                            &e,
  883:                        );
  884:                        if is_circuit_broken("rate_limit") {
  892:                                let attempts =
  893:                                    crate::commands::circuit_attempts_summary("rate_limit");
  912:                                return Err(LoopHaltReason::CircuitOpen { ... });

  ...                       (OverloadedRetry branch — same shape, error_kind="overloaded")

 1308:            crate::commands::clear_error_history();   ← post-success site,
                                                              inside existing
                                                              smart_resilience_enabled gate
```

Two error-recovery branches upgraded (`rate_limit`, `overloaded`); the existing
`record_error(kind)` calls were replaced with `record_error_full(kind, &config.provider, &config.model, &e)`. The new `is_circuit_broken` check is split: when `smart_resilience_enabled` it returns the new `LoopHaltReason::CircuitOpen` variant; when smart-off it returns the legacy `ProviderFatal` (Phase 33 posture).

## Test Results

```text
$ cargo test --lib phase34_res_02
running 7 tests
test commands::tests::phase34_res_02_circuit_attempts_summary_filters_by_kind ... ok
test commands::tests::phase34_res_02_clear_error_history_resets ... ok
test commands::tests::phase34_res_02_record_error_full_widens_tuple ... ok
test commands::tests::phase34_res_02_record_error_legacy_wrapper_works ... ok
test loop_engine::tests::phase34_res_02_clear_on_success_resets_breaker ... ok
test loop_engine::tests::phase34_res_02_halt_carries_error_kind_and_attempts_summary ... ok
test loop_engine::tests::phase34_res_02_smart_off_does_not_halt_on_circuit ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 632 filtered out
```

| # | Module | Test | What It Locks |
|---|--------|------|---------------|
| 1 | commands | record_error_full_widens_tuple | All 4 widened fields preserved through the recorder + circuit_attempts_summary read-back |
| 2 | commands | record_error_legacy_wrapper_works | The thin `record_error(kind)` wrapper still trips `is_circuit_broken` after 3 calls |
| 3 | commands | circuit_attempts_summary_filters_by_kind | Different `kind`s do NOT combine — 2 rate_limit + 1 server returns 2 / 1 / 0 respectively |
| 4 | commands | clear_error_history_resets | After 3 errors → `is_circuit_broken=true`; after `clear_error_history()` → false; circuit_attempts_summary empty |
| 5 | loop_engine | smart_off_does_not_halt_on_circuit | When `smart_resilience_enabled=false`, the new CircuitOpen halt path is skipped (T-34-22 mitigation) |
| 6 | loop_engine | halt_carries_error_kind_and_attempts_summary | `LoopHaltReason::CircuitOpen { error_kind, attempts_summary }` variant carries 3 AttemptRecords with provider/model/error_message preserved |
| 7 | loop_engine | clear_on_success_resets_breaker | The post-success site contract — clear_error_history() flips is_circuit_broken from true to false (T-34-20 mitigation) |

## Smart-Off Regression Confirmation

Test `phase34_res_02_smart_off_does_not_halt_on_circuit` records 3 same-kind
errors, asserts `is_circuit_broken` returns true, then asserts the call-site
predicate `cfg.smart_resilience_enabled && broken` evaluates to false because
smart-off. This is the same pattern Plan 34-04 used at the iteration-top stuck
site. The CONTEXT lock §Backward Compatibility claim that smart_resilience_enabled=false
preserves Phase 33's posture continues to hold for circuit-breaker halts: when
smart-off, the legacy `ProviderFatal` branch stays in place; only when smart-on
does the new structured `CircuitOpen` halt fire.

## What the Chat Surface Now Renders

When the breaker trips with smart-on, the user sees:

```
Loop halted: circuit breaker tripped on 'rate_limit' after 3 attempts. Most recent failures:
  - anthropic/claude-sonnet-4-20250514 → 429 Too Many Requests (limit reached)
  - anthropic/claude-sonnet-4-20250514 → 429 Too Many Requests (limit reached)
  - anthropic/claude-sonnet-4-20250514 → 429 Too Many Requests (limit reached)
```

Replaces the v1 `"Loop halted: circuit breaker open (rate_limit after 3 attempts). Try again in a moment."` placeholder. Provider / model / error_message
are captured at the run_loop branch via `record_error_full` and rendered with
`safe_slice(..., 200)` per BLADE's non-ASCII rule.

## Forensics Note for Plan 34-08 SESS-01

When SessionWriter lands in Plan 34-08, the `LoopHaltReason::CircuitOpen` halt
should additionally write a `LoopEvent { kind: "circuit_open", payload: {error_kind, attempts: N, attempts_summary: <full Vec>} }` JSONL entry so the
forensic trail captures the provider/model/error_message tuple at trip time.
The blade_loop_event emit path covers the live-UI side; SessionWriter covers
the post-hoc-debugging side.

## Next-Wave Plan Links

- **Plan 34-06 (RES-03 + RES-04 cost meter)** — extends LoopState with `cost_attempts: Vec<AttemptRecord>` mirroring this plan's pattern; the per-conversation cost cap (CostScope::PerConversation) writes to the SessionWriter's session-state field.
- **Plan 34-07 (RES-05 fallback chain)** — wires `try_free_model_fallback` (already used in the rate_limit branch) into a configurable fallback ladder; the circuit breaker still wins on consecutive failures of the same fallback target.
- **Plan 34-08 (SESS-01 SessionWriter)** — adds the LoopEvent { kind: "circuit_open", payload } JSONL writer mentioned above; binds session_id to the circuit-breaker forensics so users can post-hoc inspect why a session halted.
- **Plan 34-11 (Wave 5 ActivityStrip)** — subscribes to blade_loop_event { kind: "circuit_open" } and renders an ActivityStrip chip; the chip's tooltip shows attempts_summary (provider/model/error preview).

## Self-Check: PASSED

Files exist:
- `/home/arnav/blade/src-tauri/src/commands.rs` — FOUND (modified +155 / -16)
- `/home/arnav/blade/src-tauri/src/loop_engine.rs` — FOUND (modified +185 / -8)

Commits exist:
- `886652a` feat(34-05): widen ERROR_HISTORY tuple + add record_error_full / circuit_attempts_summary / clear_error_history (RES-02) — FOUND
- `89054c8` feat(34-05): wire CircuitOpen halt at run_loop error-recovery + clear-on-success + structured chat surface (RES-02) — FOUND

Test results:
- 7/7 phase34_res_02 tests green (4 commands + 3 loop_engine)
- cargo check clean (only pre-existing warnings, unrelated to this plan)

Acceptance criteria (Task 1):
- grep `fn record_error_full` → 1 (PASS)
- grep `fn circuit_attempts_summary` → 1 (PASS)
- grep `fn clear_error_history` → 1 (PASS)
- grep `fn record_error\b` → 1 (PASS, wrapper preserved)
- grep `Vec<(String, String, String, String, std::time::Instant)>` → 2 (PASS, ≥1)
- 4 phase34_res_02 tests green (PASS)

Acceptance criteria (Task 2):
- grep `LoopHaltReason::CircuitOpen` in loop_engine.rs → 11 (PASS, ≥2)
- grep `circuit_attempts_summary` in loop_engine.rs → 4 (PASS, ≥1)
- grep `record_error_full` in loop_engine.rs → 11 (PASS, ≥2)
- grep `clear_error_history` in loop_engine.rs → 9 (PASS, ≥1)
- grep `"kind": "circuit_open"` in loop_engine.rs → 2 (PASS, ≥1)
- 3 new phase34_res_02 loop_engine tests green; 4 commands tests green (PASS)
- cargo check clean (PASS)
