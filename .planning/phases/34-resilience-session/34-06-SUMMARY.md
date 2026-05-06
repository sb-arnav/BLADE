---
phase: 34-resilience-session
plan: 6
subsystem: resilience-cost-guard
tags: [resilience, RES-03, RES-04, cost-guard, per-conversation, two-tier-cap, latch, cost-update-event, scope-aware-halt-message]
dependency_graph:
  requires:
    - "Phase 34 Plan 34-01 (ResilienceConfig.cost_guard_per_conversation_dollars default 25.0; ResilienceConfig.smart_resilience_enabled default true; SessionConfig.jsonl_log_dir = blade_config_dir().join('sessions'))"
    - "Phase 34 Plan 34-02 (LoopState.conversation_cumulative_cost_usd, last_iter_cost, cost_warning_80_emitted (latch); LoopHaltReason::CostExceeded { spent_usd, cap_usd, scope: CostScope } variant carrying CostScope::PerLoop or CostScope::PerConversation)"
    - "Phase 34 Plan 34-03 (session::log::SessionEvent::LoopEvent { kind, payload, timestamp_ms } variant + session::list::validate_session_id ULID-regex helper + session::list::get_conversation_cost stub returning zeros)"
    - "Phase 33 Plan 33-08 (per-loop cost-guard halt at run_loop iteration top using config.r#loop.cost_guard_dollars; price_per_million(provider, model) helper for tokens-to-USD arithmetic; cumulative_cost_usd post-turn accumulation site)"
    - "Phase 33 Plan 33-04..33-08 (run_loop iteration body skeleton; emit_stream_event helper; blade_loop_event channel; CTX-07 catch_unwind discipline at smart-loop sites)"
  provides:
    - "Per-conversation cost accumulation in run_loop — same arithmetic as Phase 33's per-loop accumulator (tokens × price_per_million / 1M); accumulates conversation_cumulative_cost_usd UNCONDITIONALLY at the post-turn site (not gated by smart_resilience_enabled — data integrity per CONTEXT lock §Backward Compatibility)"
    - "Two-tier cost guard at iteration top:"
    - "  100% halt — fires when conversation_cumulative_cost_usd > cost_guard_per_conversation_dollars; UNCONDITIONAL (data integrity even when smart-off); returns LoopHaltReason::CostExceeded { scope: CostScope::PerConversation }; emits blade_loop_event { kind: 'halted', reason: 'cost_exceeded', scope: 'PerConversation', spent_usd, cap_usd }"
    - "  80% warn — fires when conversation_cumulative_cost_usd > 0.8 × cost_guard_per_conversation_dollars AND smart_resilience_enabled AND !cost_warning_80_emitted; latches cost_warning_80_emitted=true; emits blade_loop_event { kind: 'cost_warning', percent: 80, spent_usd, cap_usd }"
    - "blade_loop_event { kind: 'cost_update', spent_usd, cap_usd, percent } emitted at iteration end UNCONDITIONALLY — chat-input cost-meter chip (Plan 34-11) subscribes for live ticks; SessionWriter (Plan 34-08) persists to JSONL for resume"
    - "session::list::get_conversation_cost real body — reads {jsonl_log_dir}/<id>.jsonl, finds LAST cost_update LoopEvent, returns {spent_usd, cap_usd, percent}; missing JSONL returns spent_usd=0; corrupt lines skipped via eprintln; validate_session_id rejects path-traversal IDs before any filesystem touch"
    - "Tauri command get_conversation_cost registered in lib.rs generate_handler! — invokable from frontend at Plan 34-11"
    - "commands.rs LoopHaltReason::CostExceeded match arm now scope-aware — per-loop message says 'Loop halted: per-turn cost cap reached … raise loop.cost_guard_dollars'; per-conversation message says 'Conversation halted: lifetime cost cap reached … raise resilience.cost_guard_per_conversation_dollars'"
    - "Per-loop cap (Phase 33-08) and per-conversation cap (Plan 34-06) coexist — both ceilings can trip in the same iteration; per-conversation is checked first (longer scope wins per CONTEXT §RES-04)"
    - "Lock-step accumulation discipline at LOOP-04 truncation block — when retry-fail / retry-panic path keeps the original truncated turn, conversation_cumulative_cost_usd accumulates inside the truncation block (line ~1185) in lock-step with cumulative_cost_usd; otherwise the post-block accumulator handles both fields together via the !original_cost_already_tracked guard"
  affects:
    - "src-tauri/src/loop_engine.rs (+223 — iteration-top per-conversation halt + 80% warn block; truncation-block per-conversation lock-step mirror; post-turn per-conversation accumulator; iteration-end cost_update emit; 5 phase34_res_03/04 tests)"
    - "src-tauri/src/session/list.rs (+108 / -7 — get_conversation_cost real body + validate_session_id call + JSONL last-cost_update reader; 3 phase34_get_conversation_cost tests; TEST_ENV_LOCK Mutex for serial BLADE_CONFIG_DIR-mutating tests)"
    - "src-tauri/src/commands.rs (+18 / -7 — LoopHaltReason::CostExceeded match arm now binds scope and renders distinct per-loop / per-conversation messages)"
    - "src-tauri/src/lib.rs (+8 — session::list::get_conversation_cost registered in generate_handler!)"
tech_stack:
  added: []
  patterns:
    - "Two-tier ceiling — 80% threshold = warn (advisory; latched); 100% threshold = halt (blocking; enforced). Same predicate variable (conversation_cumulative_cost_usd > X × cap), two thresholds, two emit kinds. 80% advisory does not block; 100% halt blocks."
    - "Latch-once-per-conversation discipline — cost_warning_80_emitted flips false → true on first crossing and stays true for the lifetime of the conversation. Plan 34-08 SessionWriter persists this so reopened sessions don't re-fire the chip every turn (Threat T-34-25 mitigation; T-34-25 disposition mitigated by SessionWriter persistence; until 34-08 lands, fresh conversations always get a fresh latch via LoopState::default())."
    - "Smart-off data-integrity carve-out — every other Phase 34 smart-feature (stuck detection, circuit breaker, 80% warn) is gated by smart_resilience_enabled. The 100% per-conversation halt is the ONE EXCEPTION: it MUST fire even smart-off so a runaway billing event cannot be silenced by the toggle. Threat T-34-24 regression discipline; phase34_res_04_smart_off_uses_per_loop_cap_only test fails loudly if a future edit adds the gate."
    - "Lock-step accumulation in retry-block — the LOOP-04 truncation-retry block accumulates the ORIGINAL turn's cost into BOTH cumulative_cost_usd (per-loop) and conversation_cumulative_cost_usd (per-conversation) at line ~1181-1188. The post-block accumulator at line ~1300 then mirrors the same flag-aware discipline (via !original_cost_already_tracked) so retry-success / retry-fail / retry-panic / no-truncation paths all keep the two totals in lock-step. This was crucial: a future edit that adds per-loop accumulation but forgets per-conversation accumulation would break the smart-off halt's data-integrity guarantee."
    - "JSONL last-wins read — get_conversation_cost iterates the file forward and overwrites last_spent on each cost_update LoopEvent; the FINAL value wins (not sum, not first). Each iteration's cost_update emit carries the running total — so the latest event holds the most-recent total. Forward read trades off T-34-27 acceptance (reverse iteration on JSONL is non-trivial in Rust BufReader; v1.6 follow-up to read file tail for ≥10 MB sessions)."
    - "TEST_ENV_LOCK Mutex pattern for env-var-mutating tests — cargo's default parallel-by-default test harness will interleave set_var/remove_var across threads when multiple tests touch BLADE_CONFIG_DIR. Without serialization one test sees another's tmp dir mid-test. The Mutex acquires at the top of every BLADE_CONFIG_DIR-touching test in session::list::tests; the canonical Rust pattern for env-var test isolation when serial_test crate is unavailable."
    - "Scope-aware halt message — the LoopHaltReason::CostExceeded match arm now reads the scope discriminant and emits two distinct chat_error strings. Tells the user precisely which knob to bump in Settings (loop.cost_guard_dollars vs resilience.cost_guard_per_conversation_dollars) without exposing the implementation detail."
key_files:
  created: []
  modified:
    - "src-tauri/src/loop_engine.rs (+223 — Phase 34-06 iteration-top per-conversation halt + 80% warn block; truncation-block per-conversation lock-step mirror; post-turn per-conversation accumulator; iteration-end cost_update emit; 5 phase34_res_03 / phase34_res_04 unit tests added at end of tests block)"
    - "src-tauri/src/session/list.rs (+108 / -7 — get_conversation_cost stub replaced with real body that reads JSONL line by line for last cost_update LoopEvent; 3 phase34_get_conversation_cost tests; TEST_ENV_LOCK Mutex)"
    - "src-tauri/src/commands.rs (+18 / -7 — LoopHaltReason::CostExceeded match arm now scope-aware)"
    - "src-tauri/src/lib.rs (+8 — get_conversation_cost registered in generate_handler!)"
decisions:
  - "Per-conversation accumulation is UNCONDITIONAL (not gated by smart_resilience_enabled). The plan body initially proposed gating it, then explicitly revised — CONTEXT lock §Backward Compatibility says: 'Per-conversation cost cap still enforced at 100% (data integrity > smart features).' If accumulation were gated, smart-off conversations would have conversation_cumulative_cost_usd stuck at 0.0 forever, and the 100% halt at iteration top would never fire — violating the data-integrity guarantee. The 80% warn EMIT remains gated; the underlying field accumulation does not."
  - "Cost_update event emit is UNCONDITIONAL — fires every iteration even when smart-off. Rationale: the frontend chip can choose to hide itself when smart_resilience_enabled=false, but the backend always provides the data. If a user toggles smart-on mid-conversation, the chip immediately has accurate data without backend changes. Cost: one tiny JSON emit per iteration; cheap."
  - "Scope-aware halt message instead of one generic message. The user's prompt explicitly called this out: 'Update commands.rs match arm for LoopHaltReason::CostExceeded { scope } to differentiate per-loop vs per-conversation messages.' Per-loop says raise loop.cost_guard_dollars; per-conversation says raise resilience.cost_guard_per_conversation_dollars. Tells the user precisely which knob to bump."
  - "Tauri command get_conversation_cost registered in lib.rs generate_handler! even though Plan 34-11 has not yet shipped the frontend chip. Reason: the user prompt's hard constraint says 'Wire into the chat-input cost meter chip (frontend lands in Plan 34-11)' — registering the command now means Plan 34-11 only has to add the chip wiring, not also re-find this plan to add the registration. The 'never used' lint warning on the bare stub is replaced by an active wire."
  - "Verified Tauri command name globally unique before adding via grep across src-tauri/src/. Only one fn get_conversation_cost — no collision. The CLAUDE.md operating-rule about flat Tauri command namespace is honored."
  - "Mirrored per-conversation accumulation INSIDE the LOOP-04 truncation block (at line ~1188), in lock-step with the per-loop accumulator. The alternative was to ignore the truncation path and only mirror at the post-block accumulator — but that would have left a 1-iteration window where the per-loop total exceeded the per-conversation total on retry-fail paths. Lock-step keeps the two totals strictly equal across all paths."
  - "TEST_ENV_LOCK Mutex over the serial_test crate. The crate is not in Cargo.toml; introducing a new test-only dep is an architectural decision (Rule 4 territory) given the operator's Co-Authored-By restriction. The bare std::sync::Mutex pattern handles the env-var serialization need with zero new deps. Lock-poison resilient via unwrap_or_else(|p| p.into_inner())."
  - "Did NOT modify the LoopHaltReason::CostExceeded variant signature. Plan 34-02 already added the scope field; Plan 34-06 only consumes it (at the halt site to populate, at the match arm to dispatch). The 33-08 per-loop halt site already carried scope: CostScope::PerLoop (Plan 34-02 wired it). No further variant surgery needed."
metrics:
  duration: "~25 minutes"
  completed: "2026-05-06"
  task_count: 2
  file_count: 4
---

# Phase 34 Plan 34-06: RES-03 Per-Conversation Cost + RES-04 Two-Tier Cost Guard Summary

Plan 34-06 wires per-conversation cost tracking on top of Phase 33's per-loop
cost-guard substrate. Two new behaviors land in `loop_engine::run_loop`:

1. **RES-03 — per-conversation accumulation**: after each successful
   `complete_turn`, `loop_state.conversation_cumulative_cost_usd` accumulates
   the turn's cost (same arithmetic as the Phase 33-08 per-loop accumulator,
   but a separate field so per-loop and per-conversation caps are
   independently observable). Accumulation is **unconditional** — even when
   `smart_resilience_enabled = false`, the field accumulates so that the
   data-integrity 100% halt can fire.

2. **RES-04 — two-tier cap at iteration top**:
   - **100% halt** fires when `conversation_cumulative_cost_usd >
     cost_guard_per_conversation_dollars`. Returns
     `LoopHaltReason::CostExceeded { scope: CostScope::PerConversation }`.
     Fires **regardless** of `smart_resilience_enabled` (data integrity).
   - **80% warn** fires when crossed AND `smart_resilience_enabled` AND
     `!cost_warning_80_emitted`. Latches `cost_warning_80_emitted=true` so it
     fires exactly once per conversation. Smart-off skips this emit.

Each iteration also emits `blade_loop_event { kind: "cost_update", spent_usd,
cap_usd, percent }` so the chat-input cost-meter chip (Plan 34-11) renders
live spend without polling. SessionWriter (Plan 34-08) will persist this event
to JSONL so reopened sessions restore the running total.

A new Tauri command `session::list::get_conversation_cost(session_id)` reads
the last `cost_update` `LoopEvent` from the session's JSONL and returns
`{spent_usd, cap_usd, percent}`. The chat-input chip polls this on session
load (one-shot) and subscribes to `blade_loop_event { kind: 'cost_update' }`
for live ticks. The command is registered in `lib.rs::generate_handler!` so
Plan 34-11 can `invoke()` it directly.

Finally, the `commands.rs` match arm for `LoopHaltReason::CostExceeded { scope
}` now differentiates per-loop vs per-conversation messages, telling the user
precisely which Settings knob to bump.

## Insertion line numbers

| Insertion | File | Approximate line |
|-----------|------|------------------|
| Per-conversation halt + 80% warn block at iteration top | `src-tauri/src/loop_engine.rs` | inserted immediately BEFORE Phase 33-08 per-loop cost-guard at L617-L648 (now L617-L685 after insertion) |
| Per-conversation accumulation inside LOOP-04 truncation block | `src-tauri/src/loop_engine.rs` | inside HI-02 fix block (line ~1185-1192) — `loop_state.conversation_cumulative_cost_usd += original_cost;` mirror |
| Per-conversation post-turn accumulator | `src-tauri/src/loop_engine.rs` | inserted immediately AFTER Phase 33-08 per-loop accumulator at L1300 (now L1305-L1330) |
| `cost_update` event emit at iteration end | `src-tauri/src/loop_engine.rs` | inserted after per-conversation accumulator (line ~L1335) |
| 5 phase34_res_03 / phase34_res_04 tests | `src-tauri/src/loop_engine.rs` | end of `mod tests {}` block (L3970+) |
| `get_conversation_cost` real body | `src-tauri/src/session/list.rs` | replaces stub at L57-L67 |
| 3 phase34_get_conversation_cost tests | `src-tauri/src/session/list.rs` | end of `mod tests {}` block (L120+) |
| `TEST_ENV_LOCK` Mutex | `src-tauri/src/session/list.rs` | top of `mod tests {}` block (L142) |
| Scope-aware halt-message match arm | `src-tauri/src/commands.rs` | L1812-L1827 (replaces existing arm with `scope: _` binding) |
| `get_conversation_cost` Tauri registration | `src-tauri/src/lib.rs` | inside `generate_handler!` after `session_handoff::session_handoff_get` (L911) |

## Smart-off behavior

| Behavior | Smart-on (default) | Smart-off |
|----------|--------------------|-----------| 
| Per-conversation accumulation | runs | **runs** (data integrity) |
| 80% warn emit | fires once (latched) | **skipped** |
| 100% halt | fires | **fires** (data integrity) |
| `cost_update` event emit | fires every iteration | fires every iteration |
| Per-loop halt (Phase 33-08) | fires (gated by `loop.smart_loop_enabled`) | fires (independent toggle) |

Regression test pasted from `cargo test`:

```
test loop_engine::tests::phase34_res_04_smart_off_uses_per_loop_cap_only ... ok
```

## Test results

```
test loop_engine::tests::phase34_res_03_cost_accumulates_across_iterations ... ok
test loop_engine::tests::phase34_res_04_warning_emit_at_80_percent ... ok
test loop_engine::tests::phase34_res_04_warning_emit_only_once_per_conversation ... ok
test loop_engine::tests::phase34_res_04_halt_at_100_percent_per_conversation ... ok
test loop_engine::tests::phase34_res_04_smart_off_uses_per_loop_cap_only ... ok
test session::list::tests::phase34_get_conversation_cost_reads_last_cost_update ... ok
test session::list::tests::phase34_get_conversation_cost_missing_session_returns_zero ... ok
test session::list::tests::phase34_get_conversation_cost_rejects_invalid_id ... ok

test result: ok. 8 passed; 0 failed
```

`cargo check` clean. The pre-existing "never used" warnings on `resume_session`
and `fork_session` (Plan 34-03 stubs awaiting Plan 34-10) are unchanged; the
`get_conversation_cost` "never used" warning is gone now that lib.rs registers
the command.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Test concurrency interference via shared BLADE_CONFIG_DIR env var**
- **Found during:** Task 2 verify
- **Issue:** `phase34_get_conversation_cost_missing_session_returns_zero` failed with `left: 3.5, right: 0.0`. Root cause: cargo runs `#[tokio::test]` tests in parallel by default; `BLADE_CONFIG_DIR` is process-global; the `_reads_last_cost_update` test's `set_var` won the race against the `_missing_session_returns_zero` test's `set_var`, so the missing-session test was reading the populated tmp dir from the other test.
- **Fix:** Added a `static TEST_ENV_LOCK: std::sync::Mutex<()>` at the top of `mod tests {}`; both BLADE_CONFIG_DIR-touching tests acquire it via `let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());`. Standard Rust pattern for env-var test isolation when the `serial_test` crate is unavailable.
- **Files modified:** `src-tauri/src/session/list.rs`
- **Commit:** `063171f`

### Scope additions beyond plan body

**1. Mirrored per-conversation accumulation inside LOOP-04 truncation block.**
The plan body specified only the post-turn accumulator. While reading the
existing 33-NN-FIX HI-02 fix at `loop_engine.rs:1175-1183`, I noticed that
the per-loop accumulator at that site adds `original_cost` to
`cumulative_cost_usd` to handle retry-fail paths. Without a parallel mirror
into `conversation_cumulative_cost_usd`, the two totals would drift on
retry-fail (per-loop higher than per-conversation). I added a one-line
mirror inside the same scope block. This is Rule 2 (auto-add missing
critical functionality — total consistency across the two ceilings is a
correctness requirement).

**2. Registered `get_conversation_cost` in `lib.rs::generate_handler!`.**
The plan body said "Wire into the chat-input cost meter chip (frontend lands
in Plan 34-11)". The frontend cannot `invoke()` an unregistered command.
The bare stub from Plan 34-03 was never registered (intentional; Plan 34-10
was supposed to handle that). But since this plan fills the body and the
chip wiring lands in 34-11, registering now means 34-11 doesn't have to
re-touch this plan's substrate. Verified globally unique via `grep -rn
"fn get_conversation_cost" /home/arnav/blade/src-tauri/src/` (only one
hit before, only one hit after).

**3. Scope-aware halt message in `commands.rs`.** The user prompt explicitly
called this out (`"Update commands.rs match arm for LoopHaltReason::CostExceeded
{ scope } to differentiate per-loop vs per-conversation messages."`). The
plan body itself did not include this in its `<tasks>` block, only in the
plan's success criteria implicitly. Implemented as part of Task 1's wave so
the per-conversation halt's user-facing message correctly tells the user
which Settings knob to bump.

## Notes for downstream plans

### Plan 34-08 (SESS-01 — SessionWriter)

The SessionWriter must record the `cost_update` `LoopEvent` to JSONL on
every iteration so that resumed conversations restore the running total
(via `get_conversation_cost`'s last-cost_update read) AND the latch state
(reconstructed from "did any prior `cost_warning` event fire?" during
resume — Threat T-34-25 mitigation). The latch persistence rule:

```rust
// During resume, after replaying JSONL:
loop_state.cost_warning_80_emitted = jsonl_events
    .iter()
    .any(|e| matches!(e, SessionEvent::LoopEvent { kind, .. } if kind == "cost_warning"));
loop_state.conversation_cumulative_cost_usd = last_cost_update_spent_usd;
```

### Plan 34-11 (frontend chat-input cost-meter chip)

Wiring contract:

```typescript
// On session load (one-shot):
const cost = await invoke<{ spent_usd: number; cap_usd: number; percent: number }>(
    "get_conversation_cost",
    { sessionId: currentSessionId }
);

// Live ticks:
const unlisten = listen("blade_loop_event", (e) => {
    if (e.payload.kind === "cost_update") {
        setSpent(e.payload.spent_usd);
        setPercent(e.payload.percent);
    } else if (e.payload.kind === "cost_warning") {
        // Render the 80% chip as warning state
        setWarning80(true);
    } else if (e.payload.kind === "halted" && e.payload.reason === "cost_exceeded") {
        // Halted UX — the chat_error already surfaces the message
    }
});
return () => { unlisten.then(fn => fn()); };
```

The chip should hide itself when `config.resilience.smart_resilience_enabled
= false` (the backend still emits `cost_update` so the chip can flip on
instantly when the user toggles smart back on).

### Phase 34 Wave 4 / 5 next plans

- Plan 34-07 (RES-05 — provider fallback chain on circuit-open) — extends
  Plan 34-05's circuit breaker with the auto-fallback path; cost guard
  semantics from this plan unchanged.
- Plan 34-08 (SESS-01 — SessionWriter JSONL writer) — see persistence
  contract above.
- Plan 34-09 (SESS-02 — resume_session real body) — replays JSONL into
  resumed `LoopState`; honors the latch-from-prior-events rule.
- Plan 34-10 (SESS-03 / SESS-04 — list_sessions + fork_session real
  bodies); also registers those two stubs in `lib.rs`.
- Plan 34-11 (frontend) — chat-input chip + provider fallback chip + stuck
  chip + circuit-breaker chip.

## Self-Check: PASSED

Verified files exist:
- FOUND: `src-tauri/src/loop_engine.rs` (committed 5a3d893)
- FOUND: `src-tauri/src/session/list.rs` (committed 063171f)
- FOUND: `src-tauri/src/commands.rs` (committed 063171f)
- FOUND: `src-tauri/src/lib.rs` (committed 063171f)

Verified commits:
- FOUND: 5a3d893 (Task 1 — loop_engine wiring + 5 tests)
- FOUND: 063171f (Task 2 — get_conversation_cost body + scope arm + lib registration + 3 tests)

Verified grep counts (acceptance criteria):
- `conversation_cumulative_cost_usd` in loop_engine.rs: 26 (≥6 required)
- `CostScope::PerConversation` in loop_engine.rs: 7 (≥2 required)
- `cost_warning_80_emitted` in loop_engine.rs: 11 (≥3 required)
- `"kind": "cost_warning"` in loop_engine.rs: 1 (≥1 required)
- `"kind": "cost_update"` in loop_engine.rs: 1 (≥1 required)
- `fn get_conversation_cost` in session/list.rs: 1 (=1 required)
- `validate_session_id` in session/list.rs: 11 (≥2 required)
- `cost_update` in session/list.rs: 12 (≥1 required)

All 8 plan tests green. cargo check exits 0.
