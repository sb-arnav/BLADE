---
phase: 03-dashboard-chat-settings
plan: 01
subsystem: backend-wiring
tags: [rust, tauri, emit_to, ipc, hormones, streaming, quickask, anthropic, agents]

# Dependency graph
requires:
  - phase: 00-pre-rebuild-audit
    provides: WIRE-01..06 spec from 00-BACKEND-EXTRACT.md + emit classification from 00-EMIT-AUDIT.md
  - phase: 01-foundation
    provides: BLADE_EVENTS catalog, payload TS interfaces (BladeMessageStartPayload, BladeThinkingChunkPayload, BladeTokenRatioPayload, HormoneUpdatePayload, BladeQuickAskBridgedPayload), WIRE-08 emit_to discipline
  - phase: 02-onboarding-shell
    provides: existing single-window emit_to('main', ...) discipline carried forward
provides:
  - quickask_submit Rust command (WIRE-01 stub) — emits blade_quickask_bridged
  - blade_message_start emit (WIRE-03) — fires once per assistant turn (both reasoning_engine + tool-loop paths)
  - blade_token_ratio emit (WIRE-06) — fires once per send_message_stream call after rough_tokens estimate
  - blade_thinking_chunk emit (WIRE-04) — parallel-emit beside legacy chat_thinking, message_id-tagged via env var
  - hormone_update emit (WIRE-02) — parallel-emit beside legacy homeostasis_update, identical 10-field payload
  - WIRE-05 verification — agent emit family confirmed using emit_to('main', ...); marker comment landed
affects:
  - 03-02 (TS wrappers consume quickask_submit + tool approval surface)
  - 03-03/04 (Chat panel subscribes blade_message_start + blade_token_ratio + blade_thinking_chunk)
  - 03-05 (Dashboard ambient strip subscribes hormone_update)
  - 03-07 (Playwright smoke + operator cargo check)
  - Phase 4 (HUD migrates off legacy homeostasis_update; quickask bridge full provider path)

# Tech tracking
tech-stack:
  added: []  # No new crates; uuid + chrono already present
  patterns:
    - "Parallel-emit (legacy + new canonical name) for one release cycle when renaming events"
    - "BLADE_CURRENT_MSG_ID env-var fallback for cross-call message_id propagation (Phase 3 simplification, Phase 4 channel)"
    - "Inline context_window match per (provider, model) — centralization deferred to provider/model registry"
    - "Token ratio emitted ONCE per call (not per token) — DoS-safe per T-03-01-04"

key-files:
  created: []
  modified:
    - src-tauri/src/commands.rs (3 new emit sites + 1 new #[tauri::command])
    - src-tauri/src/lib.rs (1 new generate_handler! entry)
    - src-tauri/src/homeostasis.rs (1 parallel emit added)
    - src-tauri/src/providers/anthropic.rs (1 parallel emit added)
    - src-tauri/src/agents/executor.rs (verification marker comment only)

key-decisions:
  - "WIRE-05 verification adapted to actual code: executor.rs uses semantic agent_step_* event names (not literal 'blade_agent_event'). All sites already use emit_to('main', ...), so spirit of D-14 satisfied. Marker comment documents verification."
  - "BLADE_CURRENT_MSG_ID env var bridges commands.rs ↔ providers/anthropic.rs for thinking-chunk message_id tagging (D-64 fallback). Per-chunk uuid fallback if env var unset."
  - "rough_tokens hoisted from inner-block scope to outer fn scope so blade_token_ratio emit can reuse the value without recomputing."
  - "Cargo check deferred to operator per D-65 — sandbox lacks libclang for whisper-rs gate."
  - "uuid + chrono dependencies already present in Cargo.toml; no new dependencies added."

patterns-established:
  - "Parallel-emit migration: when renaming an event, emit BOTH names for one release cycle, drop legacy in subsequent phase"
  - "Event message_id correlation via env var (BLADE_CURRENT_MSG_ID) is acceptable Phase 3 stub; Phase 4 wires real channel"
  - "Token-overhead emits (like blade_token_ratio) fire ONCE per send_message_stream call — never per-token to avoid IPC saturation"

requirements-completed: [WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-05, WIRE-06]

# Metrics
duration: ~25min
completed: 2026-04-19
---

# Phase 3 Plan 01: Rust WIRE-01..06 Closure Summary

**Six backend WIRE gaps closed in one Rust plan — quickask_submit stub, blade_message_start, blade_token_ratio, blade_thinking_chunk, hormone_update parallel emits, and blade_agent_event emit_to verification — clearing the path for pure-TS Phase 3 waves.**

## Performance

- **Duration:** ~25 min (sandbox; cargo check deferred per D-65)
- **Started:** 2026-04-19T09:35:00Z
- **Completed:** 2026-04-19T10:00:36Z
- **Tasks:** 2 (both auto, no checkpoints)
- **Files modified:** 5 Rust files (commands.rs, lib.rs, homeostasis.rs, providers/anthropic.rs, agents/executor.rs)
- **Net new lines:** ~85 lines of Rust + comments
- **Cargo.toml:** unchanged (uuid + chrono already present)

## Accomplishments

- WIRE-01: `quickask_submit` `#[tauri::command]` registered (commands.rs:2561, lib.rs:451). Emits `blade_quickask_bridged` to `main` window with `{query, response: "", conversation_id, mode, timestamp}`. Stub body — Phase 4 fills the provider call + history persistence.
- WIRE-02: `homeostasis.rs:start_hypothalamus` now parallel-emits `hormone_update` alongside legacy `homeostasis_update` with identical 10-field payload. Phase 4 HUD migrates → drop legacy.
- WIRE-03: `blade_message_start` emits once per assistant turn in BOTH the reasoning_engine streaming branch AND the tool-loop final-text branch in `send_message_stream`. Generates `uuid::Uuid::new_v4()` per turn; sets `BLADE_CURRENT_MSG_ID` env var so anthropic.rs can correlate thinking chunks.
- WIRE-04: `providers/anthropic.rs:344` (now extended at line 360) parallel-emits `blade_thinking_chunk` `{chunk, message_id}` beside legacy `chat_thinking`. message_id read from `BLADE_CURRENT_MSG_ID` (per-chunk uuid fallback if absent).
- WIRE-05: Verification only — confirmed via grep that `agents/executor.rs` has zero broadcast `app.emit("blade_agent_event"...)` calls. The actual emit family uses semantic names (`agent_step_tool_fallback`, `agent_step_provider_fallback`, `agent_step_partial`, `agent_step_completed`, `agent_step_failed`) — all using `emit_to("main", ...)` per D-14. Marker comment landed at line 238 documenting verification.
- WIRE-06: `blade_token_ratio` emits once per `send_message_stream` call after the rough_tokens estimate, with `{ratio, tokens_used, context_window}` payload. Inline (provider, model) → context_window match for the 5 known providers (anthropic 200k, openai 128k, gemini 1M, groq 131k, ollama 8k, default 32k).

## Task Commits

Each task was committed atomically with normal hooks:

1. **Task 1: WIRE-01 quickask_submit + WIRE-03/06 emits** — `8d0345b` (feat)
   - 2 files changed, 111 insertions(+), 18 deletions(-)
   - commands.rs, lib.rs

2. **Task 2: WIRE-02/04 parallel emits + WIRE-05 verification** — `8dfc220` (feat)
   - 3 files changed, 46 insertions(+)
   - homeostasis.rs, providers/anthropic.rs, agents/executor.rs

_(No final docs commit yet — operator may add SUMMARY.md commit separately if required by orchestrator workflow.)_

## New Emit Sites (with line numbers)

| Event                  | File:Line                                  | Emit type                | Notes                                                           |
| ---------------------- | ------------------------------------------ | ------------------------ | --------------------------------------------------------------- |
| `blade_token_ratio`    | src-tauri/src/commands.rs:663              | `emit_to("main", ...)`   | Once per send_message_stream call                               |
| `blade_message_start`  | src-tauri/src/commands.rs:774              | `emit_to("main", ...)`   | reasoning_engine path                                           |
| `blade_message_start`  | src-tauri/src/commands.rs:1303             | `emit_to("main", ...)`   | tool-loop final-text path                                       |
| `blade_quickask_bridged` | src-tauri/src/commands.rs:2585           | `emit_to("main", ...)`   | Phase 3 stub — Phase 4 fills response                           |
| `hormone_update`       | src-tauri/src/homeostasis.rs:444           | `app.emit(...)` (broadcast) | Cross-window parallel-emit beside legacy `homeostasis_update` |
| `blade_thinking_chunk` | src-tauri/src/providers/anthropic.rs:360   | `emit_to("main", ...)`   | Parallel-emit beside legacy `chat_thinking`                     |

## New Tauri Commands Registered

| Command            | File:Line                       | Notes                                                             |
| ------------------ | ------------------------------- | ----------------------------------------------------------------- |
| `quickask_submit`  | src-tauri/src/lib.rs:451        | Inserted immediately after `commands::cancel_chat,` per plan §1e  |

## Files Modified

- `src-tauri/src/commands.rs` — Hoisted `rough_tokens` to fn scope; added `current_message_id: Option<String>` near top of `send_message_stream`; added 3 new emits (1× `blade_token_ratio` + 2× `blade_message_start`) + 1 new `quickask_submit` command at EOF.
- `src-tauri/src/lib.rs` — Inserted `commands::quickask_submit,` in `generate_handler!` (line 451).
- `src-tauri/src/homeostasis.rs` — Added parallel `hormone_update` emit immediately after legacy `homeostasis_update` (line 444). Identical 10-field payload.
- `src-tauri/src/providers/anthropic.rs` — Added parallel `blade_thinking_chunk` emit immediately after legacy `chat_thinking` (line 360). message_id read from `BLADE_CURRENT_MSG_ID` env var (per-chunk uuid fallback).
- `src-tauri/src/agents/executor.rs` — Added Phase 3 WIRE-05 verification marker comment above first agent emit (line 238). No code change.

## Decisions Made

1. **WIRE-05 reinterpretation:** The plan referenced `blade_agent_event` emit sites at lines 240/265/313/335/349 in executor.rs. Actual code uses semantic event names (`agent_step_tool_fallback`, `agent_step_provider_fallback`, `agent_step_partial`, `agent_step_completed`, `agent_step_failed`). All five already use `emit_to("main", ...)`. Verification spirit satisfied; comment marker added.
2. **No env var alternative for message_id propagation:** Per plan + D-64, BLADE_CURRENT_MSG_ID env var is the Phase 3 simplification. Phase 4 wires a proper channel.
3. **rough_tokens hoist:** Moved from inner `{ ... }` block to outer fn scope so `blade_token_ratio` can reuse it. Routing logic semantics unchanged.
4. **Cargo.toml unchanged:** uuid v4 + chrono with default features (incl. clock) already present. Confirmed via Read.
5. **Cargo check NOT run** — see "Cargo Deferral" section below.

## Cargo Deferral (D-65 Operator Backstop — REQUIRED)

**Cargo check deferred to operator per D-65 — operator runs `cd src-tauri && cargo check` on libclang-enabled host as part of Plan 03-07 smoke.**

The sandbox executing this plan lacks `libclang`, which `whisper-rs-sys` requires (transitively via `whisper-rs` even when feature-gated, depending on bindgen invocation). Plan 03-01 frontmatter `user_setup` declares this dependency explicitly; Plan 03-07 (Phase 3 smoke) is the operator backstop.

**Operator must verify:**
1. `cd src-tauri && cargo check` returns 0 errors against the modified files (or `cargo check --no-default-features` if libclang still absent — `local-whisper` is feature-gated).
2. `npm run tauri dev` boots cleanly with the new emits firing (visible in DEV console listener counter).

The Rust changes are syntactically grounded against the existing patterns in the file (matched `emit_to("main", ...)` style, `serde_json::json!{}` payloads, `let _ =` discard pattern) — semantically identical shape to commits already shipped in Phase 1 + 2 for the same modules.

## Sanity Grep Results (verification suite passed)

All 8 checks per Plan 03-01 `<verification>` block passed:

| # | Check                                                              | Result                                            |
| - | ------------------------------------------------------------------ | ------------------------------------------------- |
| 1 | `fn quickask_submit` in commands.rs                                | 1 match (line 2561) ✓                             |
| 2 | `commands::quickask_submit` in lib.rs                              | 1 match (line 451) inside generate_handler! ✓    |
| 3 | `blade_message_start` / `blade_token_ratio` emit_to in commands.rs | 3 matches (663, 774, 1303) — exceeds ≥2 target ✓ |
| 4 | `blade_thinking_chunk` emit_to in anthropic.rs                     | 1 match (line 360) ✓                              |
| 5 | `hormone_update` app.emit in homeostasis.rs                        | 1 match (line 444) ✓                              |
| 6 | NO non-comment `app.emit("blade_agent_event"` in executor.rs       | 0 real matches (only WIRE-05 marker comment) ✓   |
| 7 | NO new `mod` statements in lib.rs                                  | 0 matches in diff ✓                               |
| 8 | NO new BladeConfig/DiskConfig fields (D-66)                        | config.rs not modified ✓                          |

## Deviations from Plan

**One minor deviation, documented and accepted:**

### Auto-adapted Issue (factual reality > plan prescription)

**1. [Rule 3 - Plan Reality Mismatch] WIRE-05 emit names**
- **Found during:** Task 2 (sub-task 2c)
- **Issue:** Plan referenced `blade_agent_event` emits at executor.rs:240,265,313,335,349. Actual code uses semantic event names (`agent_step_tool_fallback`, `agent_step_provider_fallback`, `agent_step_partial`, `agent_step_completed`, `agent_step_failed`). The literal string `blade_agent_event` does not appear in src-tauri/src/.
- **Fix:** Treated WIRE-05 verification target as the agent-emit family (whatever names exist). Confirmed via grep that all 5 sites use `emit_to("main", ...)` — D-14 satisfied. Added marker comment at the first emit (line 238) documenting verification + noting the actual event names for downstream consumers (Phase 5 UI agent timeline).
- **Files modified:** src-tauri/src/agents/executor.rs (comment-only)
- **Verification:** `grep -nE '^[^/]*app\.emit\("blade_agent_event"' src-tauri/src/agents/executor.rs` returns 0 (PASS). Plan goal: no broadcast emits for agent events. Code reality: zero broadcast emits exist; all use emit_to("main", ...). Plan goal achieved regardless of event-name discrepancy.
- **Committed in:** 8dfc220

### Task 2c could be expanded later

If Phase 5 (Agent cluster) introduces a literal `blade_agent_event` emit, Plan 05-XX must still verify it uses `emit_to("main", ...)`. The Plan 03-01 marker comment in executor.rs flags the absence so the next plan visiting executor.rs is forewarned.

---

**Total deviations:** 1 plan-reality mismatch auto-adapted (no security/correctness impact — verification spirit preserved)
**Impact on plan:** None. WIRE-05 was a verification step; all 5 actual emit sites pass the spirit of the verification. Code reality is BETTER than plan presumed (already converted in Phase 1).

## Issues Encountered

- Sandbox cargo check unavailable (libclang missing). Plan-level D-65 covers this as expected; SUMMARY explicitly flags for operator. Code is semantically grounded against existing patterns in the same files (emit_to + json! + let _ = discard idiom).

## User Setup Required

**Operator backstop required (per plan frontmatter `user_setup` and D-65):**

1. **Cargo check** — Run `cd src-tauri && cargo check` on a libclang-enabled host (or `cd src-tauri && cargo check --no-default-features` if libclang remains absent). Expect 0 `error[E…]` against the 5 modified files. Phase 3 Plan 03-07 smoke checkpoint covers this.
2. **Smoke test** — After `npm run tauri dev`:
   - Send a chat message → verify `blade_message_start` fires (DEV listener counter, or Plan 03-04 chat state machine reacts).
   - Wait 60s → verify `hormone_update` fires alongside `homeostasis_update` (DEV console).
   - On Anthropic with extended thinking → verify `blade_thinking_chunk` fires per chunk with a `message_id` field.
   - Verify `blade_token_ratio` fires once per send_message_stream call.
3. **No external service config required** for this plan.

## Next Phase Readiness

**Plan 03-02 (TS wrappers) unblocked:** All 6 WIRE events + the 1 new command are ready for frontend consumers. `quickaskSubmit({query, mode, sourceWindow})` wrapper signature is straightforward (D-64 logged shape).

**Plans 03-03 / 03-04 (Chat substrate) unblocked:** `useChat` Context (Pattern §3) can subscribe `BLADE_MESSAGE_START`, `BLADE_THINKING_CHUNK`, `BLADE_TOKEN_RATIO` — all firing with the documented payload shapes.

**Plan 03-05 (Dashboard) unblocked:** `AmbientStrip` (Pattern §8) can subscribe `HORMONE_UPDATE` — firing with the canonical name + 10-field payload.

**Plan 03-07 (smoke + Playwright) tracks:** The cargo deferral here. Operator verifies on libclang-enabled host.

**No new blockers introduced.**

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already enumerated. quickask_submit is a stub (no execution path); blade_token_ratio is read-only telemetry; hormone_update is identical to existing homeostasis_update payload; blade_thinking_chunk is read-only thinking telemetry.

## Self-Check: PASSED

- File `src-tauri/src/commands.rs` modified — confirmed by `git log --oneline | grep 03-01`.
- File `src-tauri/src/lib.rs` modified — confirmed.
- File `src-tauri/src/homeostasis.rs` modified — confirmed.
- File `src-tauri/src/providers/anthropic.rs` modified — confirmed.
- File `src-tauri/src/agents/executor.rs` modified (comment-only) — confirmed.
- Commit `8d0345b` exists in git log — confirmed (`feat(03-01): WIRE-01/03/06 ...`).
- Commit `8dfc220` exists in git log — confirmed (`feat(03-01): WIRE-02/04/05 ...`).
- All 8 verification grep checks PASS — confirmed in commit timeline above.

---
*Phase: 03-dashboard-chat-settings*
*Plan: 01*
*Completed: 2026-04-19*
