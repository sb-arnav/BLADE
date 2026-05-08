# Phase 34: Resilience + Session Persistence — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** Synthesised directly from ROADMAP.md, REQUIREMENTS.md, PROJECT.md, CLAUDE.md, the Phase 33 closure (33-09-SUMMARY.md), and codebase grounding (autonomous decisions per Arnav's instruction; no interactive discuss-phase)

<domain>
## Phase Boundary

**What this phase delivers:**
The Phase 33 `loop_engine::run_loop` driver gains *self-awareness*: it watches its own `LoopState` for five semantic stuck patterns at every iteration boundary, opens a circuit breaker after N consecutive same-type failures, surfaces a per-conversation cost meter to the user with a soft-warn at 80%, and falls over to a configurable provider fallback chain with exponential backoff before ever surfacing a hard error. Underneath the loop, every user message, assistant turn, tool call, compaction boundary, and halt reason streams to an append-only JSONL log per conversation. Sessions become first-class objects: a list view shows past conversations with metadata, "resume" rebuilds the conversation from the last compaction-boundary marker (Phase 32-04 already writes those), and "branch" forks the JSONL at a chosen message index for sub-agent isolation downstream. ActivityStrip extends with new chip kinds for stuck-pattern, circuit-open, cost-warning events. The whole smart surface falls back silently when the kill switch is off.

**What this phase does NOT touch:**
- Phase 32 selective injection / compaction / tool-output cap (already shipped — Phase 34 *consumes* the `[Earlier conversation summary]` marker but does not re-author it)
- Phase 33 loop driver structure (LoopState, LoopHaltReason, ToolError, run_loop, verify_progress) — Phase 34 *extends* the surface; the iteration body itself is not lifted again
- Per-tool migration to `Result<T, ToolError>` — same shim from Phase 33; full tool-by-tool migration remains v1.6+ work
- Auto-decomposition / sub-agents (DECOMP-01..05) — Phase 35. SESS-04 (forking) lands the JSONL substrate that DECOMP-04 will consume; the sub-agent isolation logic itself is Phase 35's concern.
- Repo map / capability registry / @context-anchor (INTEL-01..03) — Phase 36
- Per-tool cost tracking — current scope is per-loop (Phase 33) + per-conversation rollup; per-tool attribution is v1.6+
- Cloud session sync, multi-window session sync, full-text session search — current scope is local JSONL only; session list is metadata-only
- Diff-mode session branching UI — current scope is "fork at message index N"; the visual diff between parent/child is v1.6+
- Cost-guard tier escalation by user trust level — current scope is a single per-conversation cap

**Why this is the safety layer of v1.5:**
Phase 32 made the prompt sane. Phase 33 made the loop sane. Phase 34 makes the loop *survivable*. Until RES-01..05 + SESS-01..04 land, every long-running conversation is one provider outage or one stuck-pattern away from silently burning the cost cap and losing all in-flight context. Phase 35's sub-agent decomposition cannot isolate a child loop's cost or persist its branch without the resilience + session substrate this phase builds. Phase 37's eval gate (EVAL-03 stuck detection accuracy) has no detector to score against until RES-01 ships. The 5+9 requirements here are the structural foundation for everything that follows in v1.5.

</domain>

<decisions>
## Implementation Decisions

### Stuck Detection (RES-01)

- **Locked: New top-level Rust module `src-tauri/src/resilience/` with submodule `stuck.rs`.** Mirrors Phase 33's `loop_engine.rs` placement: `mod resilience;` in `lib.rs`, with `pub mod stuck;` re-exported from `resilience/mod.rs`. No new Tauri commands needed for RES-01 — the detector emits via the existing `blade_loop_event` channel.
- **Locked: `pub fn detect_stuck(state: &LoopState, config: &ResilienceConfig) -> Option<StuckPattern>` runs at the top of every `run_loop` iteration**, gated by `config.resilience.stuck_detection_enabled` (default `true`). When `Some(pattern)` is returned, halt with `LoopHaltReason::Stuck { pattern: <discriminant> }` and emit `blade_loop_event { kind: "stuck_detected", pattern: "<discriminant>" }`. No nudge-and-continue branch in this phase — stuck → halt is the locked behavior; "soft nudge instead of halt" is a v1.6 polish idea.
- **Locked: Five `StuckPattern` enum variants, each with a deterministic check.**
  1. **`RepeatedActionObservation`** — same `(tool_name, args_hash, result_hash)` triple in `LoopState.last_3_actions` 3+ times. Hash via `sha256(name || canonical_json(args))[..16]` and same for the output summary. Reuses the `last_3_actions: VecDeque<ActionRecord>` ring buffer Phase 33 already maintains, but expand the buffer capacity to `last_n_actions` with `n = 6` (configurable via `recent_actions_window: u32 = 6`) to give the detector enough history to spot repeats. Phase 33's `last_3_actions` field renames to `recent_actions: VecDeque<ActionRecord>` with a `pub const RECENT_ACTIONS_CAPACITY: usize = 6` — a non-breaking field rename + capacity bump.
  2. **`MonologueSpiral`** — 5+ consecutive assistant turns with no tool call. Track via new `LoopState.consecutive_no_tool_turns: u32`, incremented when an assistant turn has zero `tool_calls`, reset to `0` whenever a tool fires. Threshold `monologue_threshold: u32 = 5` configurable.
  3. **`ContextWindowThrashing`** — 3+ compaction events fired within the current `run_loop` invocation. Phase 32-04 already calls `compress_conversation_smart` from `commands.rs`; the count must be threaded through. **Locked: new `LoopState.compactions_this_run: u32` field**, incremented from `commands.rs` via a thin helper (`loop_engine::record_compaction(&mut loop_state)`) called immediately after each compaction completes. Threshold `compaction_thrash_threshold: u32 = 3` configurable.
  4. **`NoProgress`** — 5+ iterations with no new tool name (the set of distinct tool names in `recent_actions` did not grow) AND no new assistant content (text deduped against the previous turn via `safe_slice(turn_text, 500)` + sha256). Track via `LoopState.last_progress_iteration: u32` updated every iteration that meets the "new tool name OR new content" predicate. Threshold `no_progress_threshold: u32 = 5` configurable.
  5. **`CostRunaway`** — projected cost growth exceeds 2× the rolling rate. Compute `iteration_avg_cost = cumulative_cost_usd / iteration` and `last_iteration_cost = current_iter_cost`; trip when `last_iteration_cost > 2.0 * iteration_avg_cost` AND `iteration >= 3` (avoids cold-start false positives). Distinct from Phase 33's absolute-cap `LoopHaltReason::CostExceeded` — RES-01 fires on *rate of spend*, not absolute spend.
- **Locked: All five thresholds are configurable via `ResilienceConfig`** (see Module Boundaries lock). No magic numbers in the detector.
- **Locked: `detect_stuck` is wrapped at the call site in `AssertUnwindSafe(...).catch_unwind()`** per Phase 32-07 + Phase 33-09 fallback discipline. A panic inside the detector logs `[RES-01]` and the loop continues. This is the v1.1 lesson: smart path must not crash chat.
- **Locked: `RES_FORCE_STUCK` thread_local seam (`#[cfg(test)] pub(crate) std::cell::Cell<Option<StuckPattern>>`)** mirrors `FORCE_VERIFY_PANIC` from Phase 33-09 — tests inject a stuck verdict without setting up a real long-running loop. Production builds carry zero overhead.
- **Claude's discretion:** Whether `args_hash` for `RepeatedActionObservation` uses sha256 (collision-safe, but slow) or a `DefaultHasher` (fast, but theoretical collisions). Recommend sha256 truncated to 16 hex chars — the call rate is per-iteration, not per-token, and correctness matters more than nanoseconds.

### Circuit Breaker (RES-02)

- **Locked: After `circuit_breaker_threshold: u32 = 3` consecutive same-`error_kind` failures across provider calls, halt with `LoopHaltReason::CircuitOpen { error_kind, attempts_summary }`** and emit `blade_loop_event { kind: "circuit_open", error_kind, attempts: N }`. The attempts_summary is a structured `Vec<{provider, model, error_message, timestamp_ms}>` for the chat surface to render.
- **Locked: Reuse the `commands::record_error` + `commands::is_circuit_broken` pair already prepped in Phase 33.** If those helpers do not yet exist as `pub(crate)` (verify against current master), Plan 34-NN adds them as part of the circuit-breaker plan; the API surface is `record_error(error_kind: &str, provider: &str, model: &str, msg: &str)` and `is_circuit_broken(error_kind: &str, threshold: u32) -> Option<Vec<AttemptRecord>>`.
- **Locked: `error_kind` is a stable string discriminant** drawn from the existing `classify_api_error` taxonomy at `commands.rs:274` (`"timeout"`, `"rate_limit"`, `"auth"`, `"server"`, `"truncate_and_retry"`, `"other"`). Do not invent a new taxonomy. The circuit counts per-discriminant — three different `"server"` errors trip the breaker; one `"server"` + two `"timeout"` does not.
- **Locked: Circuit reset on success.** Any successful provider call clears the running counter for *all* error kinds. Half-open / probabilistic-reset is v1.6+; current scope is binary closed/open.
- **Locked: Circuit breaker is independent of the cost cap.** A breaker open does not subtract from `cumulative_cost_usd`; an open breaker simply halts the loop with a structured reason. The two halt reasons (`CostExceeded`, `CircuitOpen`) coexist as siblings in `LoopHaltReason`.
- **Claude's discretion:** Whether to expose the circuit state to the frontend as a settings-page debug widget. Recommend NO — chat-first pivot defers UI debt; ActivityStrip chip is the user-visible surface.

### Cost Tracking + Per-Conversation Cap (RES-03 + RES-04)

- **Locked: Two distinct cost ceilings.** Phase 33's `LoopConfig.cost_guard_dollars` (default `5.0`) is the *per-loop* cap (one chat turn). Phase 34 adds `ResilienceConfig.cost_guard_per_conversation_dollars` (default `25.0`) as the *per-conversation* cap (lifetime of the SessionWriter's session_id).
- **Locked: Per-conversation cumulative cost lives on `LoopState`** as a new `pub conversation_cumulative_cost_usd: f32` field, persisted across turns via the SessionWriter (so reopening a session restores the running total). The existing `cumulative_cost_usd` field stays per-loop-invocation.
- **Locked: Tier escalation has two thresholds.**
  - **80% (`0.8 × cost_guard_per_conversation_dollars`)** — emit `blade_loop_event { kind: "cost_warning", percent: 80, spent_usd, cap_usd }`. Fires once per conversation (latch in `LoopState.cost_warning_80_emitted: bool`); does NOT halt.
  - **100% (`1.0 ×`)** — halt with `LoopHaltReason::CostExceeded { spent_usd, cap_usd, scope: ConversationScope }`. Reuse the existing variant by adding a `scope` enum field that distinguishes per-loop vs per-conversation. Phase 33's existing per-loop emit logic remains unchanged.
- **Locked: User-visible running counter.** A new Tauri command `get_conversation_cost(session_id: String) -> Result<ConversationCost, String>` returns `{spent_usd, cap_usd, percent}`. The chat UI subscribes to `blade_loop_event { kind: "cost_update" }` for live updates (emitted at the end of each iteration when smart-loop is on) AND polls the command on session load. The chat surface renders this as a small `$X.XX / $25.00` chip near the input box. (NO bespoke design — reuse the existing chip styling from ActivityStrip.)
- **Locked: Single `cost_guard_per_conversation_dollars` value.** No per-trust-tier escalation in this phase (deferred). One number, two thresholds (80% warn, 100% halt).
- **Claude's discretion:** Whether to also track input-tokens-only vs output-tokens-only sub-totals. Recommend keeping it as a single dollar number for v1; sub-totals add UI complexity for marginal value.

### Provider Fallback with Backoff (RES-05)

- **Locked: New module `src-tauri/src/resilience/fallback.rs`** with `pub async fn try_with_fallback(chain: &[String], req: ProviderRequest, config: &ResilienceConfig) -> Result<ProviderResponse, FallbackExhausted>`. Generalises Phase 32's `try_free_model_fallback` (also referenced as the partial implementation in Plan 33-03). Don't re-implement the per-call retry from scratch — wrap the existing `providers::complete_turn` and `providers::stream_text` paths.
- **Locked: Chain elements are provider IDs (strings), not provider+model pairs.** Each chain element resolves to its configured default model via the existing `providers::default_model_for(provider) -> &str`. Default chain: `vec!["primary", "openrouter", "groq", "ollama"]`. The literal `"primary"` resolves to `BladeConfig.provider`. The chain is configurable via `ResilienceConfig.provider_fallback_chain: Vec<String>`.
- **Locked: Exponential backoff with jitter.** `delay_ms = min(backoff_base_ms × 2^attempt, backoff_max_ms) + jitter(0..=200)`. Defaults `backoff_base_ms: u64 = 500`, `backoff_max_ms: u64 = 30_000`. Each chain element gets `max_retries_per_provider: u32 = 2` retries with backoff before falling over to the next element. Three-element chain × 2 retries = up to 6 provider calls before exhaustion.
- **Locked: Silent fallover within the chain.** No `chat_error` event fires for intermediate failures; only the per-attempt structured trace via existing `trace::log_trace`. The user only sees a `chat_error` when the chain exhausts — at which point the message is "All providers in fallback chain exhausted ({chain_len} providers tried, last error: {error_kind})". Mirror the Phase 32-07 silent-fallback discipline exactly.
- **Locked: Fallback is independent of the circuit breaker.** Fallback fires inside a single user turn (retry-then-fall-over); circuit breaker spans turns (3 same-kind failures across the whole conversation). They compose: a successful fallback that retried 4 times still resets the circuit on success.
- **Locked: When `resilience.smart_resilience_enabled = false`, fallback collapses to a single attempt on `BladeConfig.provider`** — the legacy path. Mirrors Phase 33's `smart_loop_enabled = false` discipline.
- **Claude's discretion:** Whether retries on a single provider use a fresh streaming connection or attempt to resume from the last token. Recommend fresh connection (simpler, matches existing Phase 33 truncation-retry behavior); resume-from-token is a v1.6 optimisation.

### Append-Only JSONL Session Log (SESS-01)

- **Locked: New top-level Rust module `src-tauri/src/session/` with submodules `log.rs`, `resume.rs`, `list.rs`.** `mod session;` in `lib.rs`. The `session::log::SessionWriter` is the single authoritative writer; all other code paths route through it.
- **Locked: One JSONL file per conversation, atomic append-only.** Path: `{jsonl_log_dir}/{session_id}.jsonl`. Default `jsonl_log_dir = blade_config_dir().join("sessions")`. `session_id = ULID` (timestamp-prefix + random) so directory listing is naturally chronological. Append via `OpenOptions::new().create(true).append(true).open(path)?` — atomic at the byte level for lines under the OS pipe-buffer (4096 bytes is safe for our event shapes; fall back to advisory `flock` on Linux/macOS if a single event ever exceeds that).
- **Locked: `SessionEvent` enum with seven variants.** All variants serialize with `#[serde(tag = "kind", content = "data")]` so the JSONL line is `{"kind": "user_message", "data": {...}}`.
  - `UserMessage { id: String, content: String, timestamp_ms: u64 }`
  - `AssistantTurn { content: String, tool_calls: Vec<ToolCallSnippet>, stop_reason: Option<String>, tokens_in: u32, tokens_out: u32, timestamp_ms: u64 }`
  - `ToolCall { name: String, args: serde_json::Value, result: Option<String>, error: Option<String>, timestamp_ms: u64 }`
  - `CompactionBoundary { kept_message_count: u32, summary_first_chars: String, timestamp_ms: u64 }` — `summary_first_chars` is `safe_slice(summary, 200)`. Phase 32-04 emits the `[Earlier conversation summary]` marker; SESS-01 records the boundary.
  - `HaltReason { reason: String, payload: serde_json::Value, timestamp_ms: u64 }` — every `LoopHaltReason` writes one of these on halt.
  - `LoopEvent { kind: String, payload: serde_json::Value, timestamp_ms: u64 }` — mirrors the `blade_loop_event` channel for full-fidelity replay of stuck/circuit/cost events.
  - `SessionMeta { id: String, parent: Option<String>, fork_at_index: Option<u32>, started_at_ms: u64 }` — first event in every JSONL file. `parent`/`fork_at_index` populate only for forked sessions (SESS-04).
- **Locked: SessionWriter is owned by `LoopState`** (or a parallel struct passed alongside it through `run_loop`) so every event-emitting site has direct access. Don't re-resolve a writer per event.
- **Locked: Writes happen at the message-flow boundaries in `commands.rs`** (one event per user message, one per assistant turn, one per tool call, one per compaction, one per halt). The writer is *not* invoked from inside `loop_engine::run_loop` — `run_loop` returns its `LoopHaltReason` to `commands.rs`, which then writes the `HaltReason` event. Keeps the loop_engine module pure of I/O.
- **Locked: Rotation policy.** When the count of `*.jsonl` files in `jsonl_log_dir` exceeds `keep_n_sessions: u32 = 100`, the oldest (by ULID prefix) move to `{jsonl_log_dir}/archive/`. Move, not delete — user can browse the archive manually if needed. Archive directory is *not* indexed by `list_sessions`; the live list shows only the current 100.
- **Locked: When `session.jsonl_log_enabled = false`, SessionWriter is a no-op.** Writes silently dropped, no file created. Mirrors the CTX-07 + Phase 33 kill-switch pattern.
- **Locked: Every write goes through `catch_unwind(AssertUnwindSafe(...))`.** A panic in serialization or I/O logs `[SESS-01]` and the chat continues. Storage failure must not crash a reply.
- **Claude's discretion:** Whether to compress archived JSONL files (gzip) to reduce disk usage. Recommend NO for v1 — readable archive is more useful than a compressed one; compression is v1.6 if disk pressure surfaces.

### Session Resume (SESS-02)

- **Locked: `pub fn load_session(id: SessionId) -> Result<ResumedConversation, SessionError>` in `session/resume.rs`.** Reads the JSONL file line by line, deserialises each `SessionEvent`, and replays into a `Vec<ConversationMessage>` (the same type Phase 33's `run_loop` consumes).
- **Locked: Replay stops at the most-recent `CompactionBoundary` event.** Everything before that boundary collapses into the `summary_first_chars` user message stub (Phase 32-04 already writes `[Earlier conversation summary] {summary}` as a synthetic user message — reuse that exact format). Everything from the boundary forward replays as live history.
- **Locked: Tool call results that were CAPPED by Phase 32 CTX-05 stay capped on resume.** The JSONL stores the truncated form; we do not re-fetch the full output (that's the deferred "reach-back tool" idea from Phase 32). Resume fidelity = compaction + cap fidelity.
- **Locked: Resume does NOT replay halt reasons or loop events.** Those are recorded for forensics, not for re-injection. The resumed conversation starts fresh on the next user turn.
- **Locked: Session ID is provided by the frontend.** A new Tauri command `resume_session(session_id: String) -> Result<ResumedConversation, String>` is the entry point. The frontend calls it from the SessionsView UI (see SESS-03 lock).
- **Locked: Auto-resume on app boot is configurable.** `SessionConfig.auto_resume_last: bool = false` (default off — explicit user action is the safer default; v1.1 lesson). When `true`, app boot calls `list_sessions().first()` and dispatches `resume_session` automatically.
- **Locked: Resume failure is graceful.** Corrupt JSONL line → log structured trace, skip that line, continue replay. JSONL file missing → return `SessionError::NotFound` to frontend; the SessionsView shows an error toast and the user lands in a fresh conversation. No panic, no crash.
- **Claude's discretion:** Whether to verify hash-chain integrity across the JSONL (each event references the prior event's hash). Recommend NO for v1 — JSONL is local-only with no tamper threat model; hash-chain is v1.6+ if cloud sync ever lands.

### Session List (SESS-03)

- **Locked: New Tauri command `list_sessions() -> Result<Vec<SessionMeta>, String>` in `session/list.rs`.** Reads file metadata for every `*.jsonl` in `jsonl_log_dir`, plus the first 5 events of each (enough to extract the first user message and a token estimate). Returns sorted descending by `started_at_ms`.
- **Locked: `SessionMeta` shape (frontend-facing, distinct from the SessionEvent variant of the same name):**
  ```rust
  pub struct SessionMeta {
      pub id: String,
      pub started_at_ms: u64,
      pub message_count: u32,            // count of UserMessage + AssistantTurn events
      pub first_message_excerpt: String, // safe_slice(first_user_message, 120)
      pub approximate_tokens: u32,       // sum of tokens_in + tokens_out across AssistantTurn events
      pub halt_reason: Option<String>,   // most-recent HaltReason event, if any
      pub parent: Option<String>,        // populated for forked sessions
  }
  ```
  Frontend sees a flat structure; backend computes it on demand.
- **Locked: New route `sessions` in `App.tsx`.** Three-place registration per CLAUDE.md (route type union, lazy import, `fullPageRoutes` mapping, command palette entry). Component lives at `src/features/sessions/SessionsView.tsx`. Reuses existing list-card patterns from `dashboard` and `activity-log` — no bespoke design system work.
- **Locked: List view shows three actions per row:** *Resume* (dispatches `resume_session(id)` and routes to `chat`), *Branch* (opens a small fork-at-index picker), *Archive* (move file to `archive/` subdir; same as auto-rotation).
- **Locked: NO full-text search of session contents in this phase.** List is metadata-only; search is deferred. v1 users can grep their JSONL directory directly.
- **Claude's discretion:** Whether to virtualise the list with windowing if `keep_n_sessions = 100` proves slow to render. Recommend NO for v1 (100 rows is well under the React render budget); revisit if `keep_n_sessions` ever scales up.

### Session Forking (SESS-04)

- **Locked: New Tauri command `fork_session(parent_id: String, fork_at_message_index: u32) -> Result<String, String>` in `session/list.rs`** (returns the new session's ID). Reads parent JSONL, copies events `[0..fork_at_message_index]` to a new JSONL file with a fresh ULID, prepends a `SessionMeta { id, parent: Some(parent_id), fork_at_index: Some(fork_at_message_index), started_at_ms: now() }` event.
- **Locked: Fork is shallow — no DAG, no merging.** A child session has one parent; a child cannot itself be forked (one-level deep). v1.6+ may relax this; current scope is the substrate Phase 35's DECOMP-04 needs (sub-agent isolation), which only requires single-parent attribution.
- **Locked: Fork-at-message-index is by `message_count` ordinal**, not by JSONL line number (compaction boundaries and loop events do not count toward the index). The frontend SessionsView's branch picker shows a list of `{index, role, excerpt}` for the parent and the user picks one.
- **Locked: Forking does NOT auto-resume the new session.** The user must explicitly choose Resume on the forked entry from the SessionsView. This is the "explicit user action" discipline the v1.1 lesson encoded.
- **Claude's discretion:** Whether the fork operation copies the parent JSONL bytes verbatim (faster, but path stays in two places) or replays + re-serialises (cleaner, but slower). Recommend verbatim copy + a `SessionMeta` prepended via a fresh `OpenOptions` write — the compatibility surface is the JSONL line shape, not the byte sequence.

### ActivityStrip Integration (UI Surface)

- **Locked: Three new `BladeLoopEventPayload` discriminants extend the existing union at `src/lib/events/payloads.ts`:**
  - `{ kind: "stuck_detected", pattern: "RepeatedActionObservation" | "MonologueSpiral" | "ContextWindowThrashing" | "NoProgress" | "CostRunaway" }`
  - `{ kind: "circuit_open", error_kind: string, attempts: number }`
  - `{ kind: "cost_warning", percent: 80, spent_usd: number, cap_usd: number }`
  - `{ kind: "cost_update", spent_usd: number, cap_usd: number, percent: number }` (live tick — does NOT render a chip; consumed by the cost meter widget only)
- **Locked: `ActivityStrip.tsx` chip mappings (short labels):**
  - `stuck_detected` → `"stuck: <pattern>"` (lowercase pattern, e.g. `"stuck: monologue"`)
  - `circuit_open` → `"circuit open: <error_kind>"`
  - `cost_warning` → `"cost 80% ($X / $Y)"`
- **Locked: Chip persistence is identical to Phase 33** — fade after ~3 seconds, reuse existing toast-fade timing. NO bespoke timing system.
- **Locked: Cost-meter chip lives at the chat input area, not in ActivityStrip.** The two surfaces are distinct: ActivityStrip = transient events (verifying, replanning, stuck, circuit, halted); chat-input cost meter = persistent counter that always shows current spend. Reuse `useState` + `listen("blade_loop_event", ...)` for `cost_update` events; render via the chip pattern from `chat/ChatComposer.tsx` (or wherever the input lives).
- **Locked: Typed wrappers in `src/lib/tauri/sessions.ts` (NEW)** — `listSessions()`, `resumeSession(id)`, `forkSession(parent, idx)`, `getConversationCost(sessionId)`. All wrap `invoke<T>` with structured types and `try/catch` per CLAUDE.md.
- **Claude's discretion:** Whether the cost-meter chip color-shifts at 50% / 80% (green → yellow → red). Recommend yes — the cost is the user's money, color signal is high-value; reuse existing color tokens from CSS.

### Backward Compatibility (Smart-Resilience Toggle)

- **Locked: Two new kill switches.** `ResilienceConfig.smart_resilience_enabled: bool = true` and `SessionConfig.jsonl_log_enabled: bool = true`. They are independent — a user can disable session log without disabling stuck detection, and vice versa.
- **Locked: When `smart_resilience_enabled = false`:**
  - Stuck detection skipped (no `detect_stuck` call)
  - Circuit breaker skipped (record_error becomes no-op; is_circuit_broken returns None)
  - Cost-warning emit at 80% skipped (per-conversation cost still tracked, but no warning)
  - Provider fallback collapses to single-attempt on `BladeConfig.provider`
  - Per-conversation cost cap still enforced at 100% (data integrity > smart features)
- **Locked: When `jsonl_log_enabled = false`:**
  - SessionWriter::append is a silent no-op
  - `list_sessions` reads the directory if it exists (for legacy sessions); returns empty list otherwise
  - `resume_session` works on existing files but writes nothing for the new resumed conversation
  - `fork_session` works (the parent's existing JSONL is read), but the forked session writes nothing forward
- **Locked: This mirrors Phase 32's `context.smart_injection_enabled` and Phase 33's `loop.smart_loop_enabled` escape hatches.** Same v1.1 lesson, third application.
- **Claude's discretion:** Whether to combine the two toggles into a single `resilience.enabled` master switch. Recommend NO — they target different failure modes (smart-resilience = behavioral; session-log = persistence) and a user might reasonably want one without the other.

### Module Boundaries

- **Locked: New top-level modules `src-tauri/src/resilience/` and `src-tauri/src/session/`.** Declared via `mod resilience;` and `mod session;` in `lib.rs`. Submodule layout:
  ```
  src-tauri/src/resilience/
    mod.rs          // module root, re-exports
    stuck.rs        // detect_stuck + StuckPattern enum + 5 detector functions
    fallback.rs     // try_with_fallback + exponential backoff
  src-tauri/src/session/
    mod.rs          // module root, re-exports
    log.rs          // SessionWriter + SessionEvent enum + atomic JSONL append
    resume.rs       // load_session + replay logic
    list.rs         // list_sessions + fork_session + SessionMeta (frontend shape)
  ```
- **Locked: New Tauri commands** (added to `generate_handler![]` in `lib.rs`):
  - `list_sessions`
  - `resume_session`
  - `fork_session`
  - `get_conversation_cost`
- **Locked: `loop_engine.rs` extensions:**
  - `LoopState` gains `recent_actions` (renamed from `last_3_actions`, capacity 6), `consecutive_no_tool_turns`, `compactions_this_run`, `last_progress_iteration`, `cost_warning_80_emitted`, `conversation_cumulative_cost_usd`, plus an optional `session_writer: Option<SessionWriter>` handle (or pass it as a parameter — Plan 34-NN's call).
  - `LoopHaltReason` gains `Stuck { pattern: String }`, `CircuitOpen { error_kind: String, attempts_summary: Vec<AttemptRecord> }`, and the existing `CostExceeded` gains an optional `scope: CostScope` field.
- **Locked: `commands.rs` extensions:**
  - SessionWriter constructed at `send_message_stream_inline` entry (one writer per conversation; persists across turns)
  - Five emit sites wired (UserMessage, AssistantTurn, ToolCall, CompactionBoundary, HaltReason, LoopEvent)
  - `record_error` + `is_circuit_broken` helpers added (or promoted to `pub(crate)` if already drafted in Phase 33 prep)
- **Locked: Frontend additions** are scoped to four files:
  - `src/features/sessions/SessionsView.tsx` (NEW) — list + actions
  - `src/features/activity-strip/ActivityStrip.tsx` — extend chip switch
  - `src/lib/events/payloads.ts` — extend BladeLoopEventPayload union
  - `src/lib/tauri/sessions.ts` (NEW) — typed wrappers
- **Locked: Six-place config rule applies** to every new field in `ResilienceConfig` and `SessionConfig`. See CLAUDE.md. Don't try to remember the six places from memory; copy the diff Phase 33-01 used for `LoopConfig` and adapt every line.
- **Locked: `safe_slice` is mandatory** for any new string-slice operation on user/conversation/tool content. Risk sites: `first_message_excerpt`, `summary_first_chars`, `safe_slice(turn_text, 500)` for the NoProgress detector.

### Testing & Verification

- **Locked: Each RES-01..05 + SESS-01..04 needs at least one unit test.** Naming pattern follows Phase 33: `phase34_res_01_repeated_action_observation`, `phase34_res_01_monologue_spiral`, `phase34_res_01_context_thrashing`, `phase34_res_01_no_progress`, `phase34_res_01_cost_runaway`, `phase34_res_02_circuit_breaker_threshold`, `phase34_res_03_per_conversation_cost_tracking`, `phase34_res_04_warn_at_80_halt_at_100`, `phase34_res_05_provider_fallback_chain_exhaustion`, `phase34_sess_01_jsonl_roundtrip`, `phase34_sess_02_resume_from_compaction_boundary`, `phase34_sess_03_list_sessions_metadata`, `phase34_sess_04_fork_preserves_history_up_to_index`.
- **Locked: Test seam pattern.** Mirror Phase 33's `LOOP_OVERRIDE` and `FORCE_VERIFY_PANIC` — introduce two seams:
  - `RES_FORCE_STUCK: thread_local! Cell<Option<StuckPattern>>` — tests inject a stuck verdict.
  - `RES_FORCE_PROVIDER_ERROR: thread_local! Cell<Option<String>>` — tests inject a provider error_kind for fallback / circuit testing without real network calls.
  Both `#[cfg(test)]`-gated; production builds carry zero overhead.
- **Locked: Smart-resilience-disabled regression test required.** A unit test sets `resilience.smart_resilience_enabled = false` and asserts the loop runs without stuck detection, circuit breaker, cost warnings, or fallback — same posture as Phase 33's `loop.smart_loop_enabled = false` test.
- **Locked: JSONL roundtrip test (SESS-01).** Write all 7 SessionEvent variants, read back, assert structural equality via `serde_json::Value` comparison. Catches any breaking schema change at PR time.
- **Locked: Panic-injection regression test for SessionWriter** (mirrors Phase 33-09's `phase33_loop_01_panic_in_render_actions_json_is_caught`). Force a panic inside `SessionWriter::append` via a `#[cfg(test)]` seam; assert the chat still completes.
- **Locked: NO new verify gate.** verify:intelligence is Phase 37's responsibility (EVAL-05). Phase 34 keeps the existing 37 gates green and adds unit tests + 1-2 integration tests.
- **Locked: Runtime UAT REQUIRED per CLAUDE.md Verification Protocol.** This phase has runtime UI work (SessionsView + ActivityStrip chips + cost meter + chat resume). The final task in plan 34-NN must be `checkpoint:human-verify`. UAT script:
  1. Open dev binary (`npm run tauri dev`)
  2. Send a synthetic stuck query (e.g. ask the model to repeatedly run `read_file` on the same path) — assert "stuck: repeated" chip fires and chat surfaces a halt summary
  3. Toggle off network on a non-default provider in settings, send a query that triggers fallback — assert chain progresses silently and a successful response appears
  4. Disconnect network entirely, send a query — assert "All providers exhausted" chat_error
  5. Set `cost_guard_per_conversation_dollars = 0.05`, send several short queries — assert "cost 80%" chip at warning threshold and graceful halt at 100%
  6. Open BLADE → close BLADE → reopen BLADE → navigate to `/sessions` — assert the previous conversation appears in the list with correct first-message excerpt, message count, and approximate token count
  7. Click Resume on a session — assert chat opens with the prior history reconstructed correctly (compaction summary visible if applicable)
  8. Click Branch on a session, pick message index 3 — assert a new session appears in the list with `parent` populated; resume the branch and confirm history is `[0..3]` only
  9. Toggle `smart_resilience_enabled = false` — assert no stuck/circuit/cost-warning chips appear; chat still works
  10. Toggle `jsonl_log_enabled = false` — assert no new JSONL files written for the next conversation; existing list_sessions still shows prior files
  11. Screenshot SessionsView at 1280×800 + 1100×700, save under `docs/testing ss/` (literal space)
  12. Screenshot ActivityStrip with stuck chip at 1280×800 + 1100×700
  13. Screenshot chat composer with cost meter at 1280×800 + 1100×700
  14. Read back all screenshots via the Read tool and cite a one-line observation per breakpoint
- **Locked: tsc --noEmit + cargo check must remain clean.** No regressions in the 37 verify gates.

### Claude's Discretion (catch-all)

- File-level layout inside `resilience/stuck.rs` — whether the five detectors are five free functions or a single function with a `match StuckPattern` switch. Recommend free functions per pattern (testable in isolation) with a `detect_stuck` aggregator that walks them in priority order.
- Priority order across the five stuck patterns when multiple fire on the same iteration. Recommend: `CostRunaway > CircuitOpen > RepeatedActionObservation > ContextWindowThrashing > MonologueSpiral > NoProgress`. Cost first because it's the financial spend; pattern detection ordering inside the cost-spends-okay regime is best-effort.
- Whether `SessionWriter` uses a buffered writer (4KB BufWriter) or unbuffered append. Recommend unbuffered for crash-safety — the JSONL log's value is precisely that a crash mid-conversation leaves a partial-but-valid trail.
- Whether the SessionsView shows total cost spent per session (data is in JSONL via cost_update events). Recommend yes — it's a high-value piece of metadata for the user; sum the `cost_update` payloads' last value during list_sessions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 34 row (lines 131-143) + 6 success criteria + RES-01..05 + SESS-01..04 sequencing
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — RES-01..05 verbatim (lines 31-35) + SESS-01..04 verbatim (lines 56-59)
- `/home/arnav/blade/.planning/STATE.md` — v1.5 milestone state, key decisions table
- `/home/arnav/blade/.planning/PROJECT.md` — Project core value (read for tone)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (six-place config, safe_slice, Tauri command namespace, verification protocol, what-not-to-do list)
- `/home/arnav/CLAUDE.md` — workspace defaults (Tauri 2 + React + Tailwind v4)

### Phase 33 Predecessor (read for inherited patterns — Phase 34 BUILDS ON THIS)
- `/home/arnav/blade/.planning/phases/33-agentic-loop/33-CONTEXT.md` — gold-standard CONTEXT structure; `RES_FORCE_STUCK` test seam mirrors `FORCE_VERIFY_PANIC`; ResilienceConfig + SessionConfig sub-structs mirror LoopConfig pattern
- `/home/arnav/blade/.planning/phases/33-agentic-loop/33-09-SUMMARY.md` — Phase 33 final state: LoopState, LoopHaltReason, run_loop, verify_progress, catch_unwind discipline locked. Phase 34 extends LoopState + LoopHaltReason; preserves run_loop's iteration body.
- `/home/arnav/blade/.planning/phases/32-context-management/32-07-PLAN.md` — fallback discipline pattern (`catch_unwind` wrappers, panic-injection regression tests). Phase 34 inherits this discipline for `detect_stuck` AND `SessionWriter::append`.
- `src-tauri/src/loop_engine.rs` — current Phase 33 surface; LoopState fields (`cumulative_cost_usd`, `replans_this_run`, `token_escalations`, `last_3_actions`, `consecutive_same_tool_failures`); `LoopHaltReason` variants. Phase 34 extends both.
- `src-tauri/src/config.rs` — `ContextConfig` and `LoopConfig` six-place wire-up exemplar; copy that shape for `ResilienceConfig` + `SessionConfig`.

### Code Anchors (must read to plan accurately)
- `src-tauri/src/commands.rs` — `send_message_stream_inline` (the Phase 33 outer orchestration), `compress_conversation_smart` (Phase 32-04 — the compaction site that needs to thread `compactions_this_run` into LoopState), `classify_api_error` + `TruncateAndRetry` (line 274 — error taxonomy that RES-02 reuses), the message-flow boundaries that SESS-01 hooks into.
- `src-tauri/src/loop_engine.rs` — extension surface: LoopState (line 49), LoopHaltReason (line 102), run_loop (line 456), verify_progress + render_actions_json (Phase 33-04), catch_unwind wrapper at verify-firing site (Phase 33-09).
- `src-tauri/src/providers/mod.rs` — `complete_turn`, `stream_text`, `try_free_model_fallback` (the partial fallback implementation Phase 34's `try_with_fallback` generalises), `default_model_for(provider)`, provider price tables (used by per-conversation cost tracking).
- `src-tauri/src/lib.rs` — `mod` registrations + `generate_handler!`. Phase 34 adds `mod resilience;` + `mod session;` + 4 new commands.
- `src/features/activity-strip/ActivityStrip.tsx` — existing chip surface; phase 34 extends the switch for stuck/circuit/cost_warning kinds.
- `src/lib/events/payloads.ts` — `BladeLoopEventPayload` discriminated union (line 865); phase 34 adds three new variants.
- `src/lib/tauri/events.ts` — typed event wrappers; phase 34 adds the new event-payload types.

### Research Citations (locked in v1.5 milestone)
- mini-SWE-agent — used in Phase 33; stuck-detection pattern catalogue draws from its agent loop architecture (especially `RepeatedActionObservation` and `MonologueSpiral`).
- Claude Code architecture (arxiv 2604.14228) — agent loop primitives; structured halt reasons + circuit breaker mirror the pattern.
- OpenHands condenser — Phase 32 territory, NOT this phase.
- Aider repo map — Phase 36, NOT this phase.
- Goose capability registry — Phase 36, NOT this phase.

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — BLADE memory index (chat-first pivot, UAT rule, ghost CSS tokens, streaming contract). SESS-02 resume must respect the streaming contract: every replayed AssistantTurn that streams to the UI emits `blade_message_start` before any `chat_token`.
- `docs/testing ss/` (path has a literal space) — UAT screenshot storage

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete code patterns to reuse (not invent):**
- LoopState extension at `loop_engine.rs:49`:
  ```rust
  // BEFORE (Phase 33)
  pub last_3_actions: VecDeque<ActionRecord>,
  pub consecutive_same_tool_failures: HashMap<String, u32>,
  // AFTER (Phase 34)
  pub recent_actions: VecDeque<ActionRecord>,            // capacity 6
  pub consecutive_same_tool_failures: HashMap<String, u32>,
  pub consecutive_no_tool_turns: u32,                    // RES-01 monologue
  pub compactions_this_run: u32,                         // RES-01 thrashing
  pub last_progress_iteration: u32,                      // RES-01 no-progress
  pub cost_warning_80_emitted: bool,                     // RES-04 latch
  pub conversation_cumulative_cost_usd: f32,             // RES-03 + RES-04
  ```
- LoopHaltReason extension at `loop_engine.rs:102`:
  ```rust
  pub enum LoopHaltReason {
      CostExceeded { spent_usd: f32, cap_usd: f32, scope: CostScope },  // scope added
      IterationCap,
      Cancelled,
      ProviderFatal { error: String },
      Stuck { pattern: String },                                          // NEW
      CircuitOpen { error_kind: String, attempts_summary: Vec<AttemptRecord> },  // NEW
  }
  pub enum CostScope { PerLoop, PerConversation }
  ```
- `safe_slice(text, max_chars)` from `lib.rs` is mandatory for `first_message_excerpt`, `summary_first_chars`, NoProgress detector text comparison.
- `emit_stream_event(&app, "blade_loop_event", json!({...}))` follows the same pattern as Phase 33's chip emits.
- Six-place config wire-up — copy the diff Phase 33-01 used for `LoopConfig` and adapt every line for `ResilienceConfig` + `SessionConfig`. Don't try to remember the six places from memory.

**Concrete config additions (six-place rule applies to each):**
```rust
pub struct ResilienceConfig {
    pub smart_resilience_enabled: bool,                  // default true; CTX-07 escape hatch
    pub stuck_detection_enabled: bool,                   // default true
    pub recent_actions_window: u32,                      // default 6
    pub monologue_threshold: u32,                        // default 5
    pub compaction_thrash_threshold: u32,                // default 3
    pub no_progress_threshold: u32,                      // default 5
    pub circuit_breaker_threshold: u32,                  // default 3
    pub cost_guard_per_conversation_dollars: f32,        // default 25.0
    pub provider_fallback_chain: Vec<String>,            // default vec!["primary","openrouter","groq","ollama"]
    pub max_retries_per_provider: u32,                   // default 2
    pub backoff_base_ms: u64,                            // default 500
    pub backoff_max_ms: u64,                             // default 30_000
}

pub struct SessionConfig {
    pub jsonl_log_enabled: bool,                         // default true; CTX-07 escape hatch
    pub jsonl_log_dir: PathBuf,                          // default blade_config_dir().join("sessions")
    pub auto_resume_last: bool,                          // default false
    pub keep_n_sessions: u32,                            // default 100
}
```
Add `resilience: ResilienceConfig` and `session: SessionConfig` fields to `BladeConfig` and `DiskConfig`. Default impl, load_config, save_config — six places per CLAUDE.md.

**Concrete SessionEvent shape:**
```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum SessionEvent {
    SessionMeta { id: String, parent: Option<String>, fork_at_index: Option<u32>, started_at_ms: u64 },
    UserMessage { id: String, content: String, timestamp_ms: u64 },
    AssistantTurn { content: String, tool_calls: Vec<ToolCallSnippet>, stop_reason: Option<String>, tokens_in: u32, tokens_out: u32, timestamp_ms: u64 },
    ToolCall { name: String, args: serde_json::Value, result: Option<String>, error: Option<String>, timestamp_ms: u64 },
    CompactionBoundary { kept_message_count: u32, summary_first_chars: String, timestamp_ms: u64 },
    HaltReason { reason: String, payload: serde_json::Value, timestamp_ms: u64 },
    LoopEvent { kind: String, payload: serde_json::Value, timestamp_ms: u64 },
}
```

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't run `cargo check` after every edit — batch first, check at end (1-2 min per check).
- Don't add Co-Authored-By lines to commits.
- Don't use `&text[..n]` on user content — use `safe_slice`.
- Don't create a Tauri command name that already exists in another module — Tauri's macro namespace is FLAT. Verify `list_sessions`, `resume_session`, `fork_session`, `get_conversation_cost` are unique before adding to `generate_handler!`.
- Don't migrate ResilienceConfig + SessionConfig fields one-at-a-time across the 6 wire-up sites — do all fields per-struct in a single pass per site (atomic per site).
- Don't claim the phase is "done" because static gates pass — runtime UAT per CLAUDE.md is mandatory; v1.1 retracted on this exact failure.
- Don't surface intermediate provider failures to the user during fallback — silent fallback is the locked behavior; only chain exhaustion surfaces.

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 34 scope:

- **Per-tool cost tracking** — current scope: per-loop (Phase 33) + per-conversation (Phase 34) rollups. Per-tool attribution is a v1.6+ chore.
- **Multi-window session sync** — current scope: single-window writer per session_id. If two BLADE windows open the same session simultaneously, last-write-wins on the JSONL; v1.6 if multi-window proves a real workflow.
- **Cloud session sync** — current scope: local JSONL only. v1.6+ if user-sync ever ships.
- **Session search by content (full-text)** — current scope: list by metadata only (id, started_at, message_count, first_message_excerpt, approximate_tokens, halt_reason). v1.6+ feature.
- **Diff-mode session branching UI** — current scope: branch from message index, no UI for diff visualization. v1.6 polish.
- **Cost guard hard ceiling above `cost_guard_per_conversation_dollars`** — current scope: single threshold (warn at 80%, halt at 100%). A second hard cap (e.g. "halt at $100 even if config says $25") is v1.6+.
- **Half-open / probabilistic-reset circuit breaker** — current scope: binary closed/open with reset-on-success. v1.6+.
- **Session compaction inside the JSONL** — current scope: JSONL grows linearly with conversation; compaction lives in the in-memory conversation only. A "compact the JSONL by replacing pre-boundary events with a summary line" feature is v1.6+.
- **Hash-chain integrity over JSONL events** — current scope: trust the local file. Hash-chain matters only if cloud sync or tamper-resistance ships.
- **Resume from a non-most-recent compaction boundary** — current scope: replay halts at the *latest* CompactionBoundary; "resume from boundary 3 instead of boundary 5" is a v1.6+ debugging affordance.
- **Soft-nudge alternative to halt on stuck detection** — current scope: stuck → halt. A "stuck → inject nudge → continue" branch is a v1.6 polish; the user-facing "what was tried" summary in the chat is the locked behavior.
- **Session export as Markdown** — current scope: JSONL is the durable form, no human-readable export. v1.6+ if user feedback demands it.
- **Provider-specific backoff overrides** — current scope: one backoff curve for all providers. Per-provider tuning (e.g. OpenAI rate limits use longer backoff than Groq) is v1.6+.
- **Stuck-detection accuracy benchmarks (EVAL-03)** — Phase 37's responsibility. Phase 34 ships the detector; Phase 37 scores it.
- **Auto-decomposition of 5+ independent steps (DECOMP-01..05)** — Phase 35.
- **Repo map / capability registry / @context-anchor (INTEL-01..06)** — Phase 36.
- **verify:intelligence gate (EVAL-05)** — Phase 37.

</deferred>

---

*Phase: 34-resilience-session*
*Context gathered: 2026-05-06 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / PROJECT.md / CLAUDE.md / Phase 33 predecessor (33-CONTEXT.md + 33-09-SUMMARY.md) / Phase 32 predecessor (32-07-PLAN.md fallback discipline) / live codebase grounding at loop_engine.rs:49-145 (LoopState + LoopHaltReason) + commands.rs (send_message_stream_inline + compress_conversation_smart) + providers/mod.rs (try_free_model_fallback) + payloads.ts:865 (BladeLoopEventPayload).*
