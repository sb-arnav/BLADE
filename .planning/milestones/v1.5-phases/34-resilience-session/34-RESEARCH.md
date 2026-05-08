---
phase: 34
slug: resilience-session
date: 2026-05-06
status: ready-for-planning
researcher: gsd-phase-researcher (inline)
confidence: HIGH
sources:
  primary:
    - jsonlines_spec: https://jsonlines.org/ (one JSON value per line, UTF-8, LF newline)
    - posix_atomic_append: https://pubs.opengroup.org/onlinepubs/9699919799/functions/V2_chap02.html#tag_15_10_03 (O_APPEND atomicity guarantees up to PIPE_BUF, 4096 on Linux/macOS)
    - ulid_spec: https://github.com/ulid/spec (Crockford base32, 48-bit timestamp + 80-bit random, lex-sortable)
    - mini_swe_agent_stuck: https://github.com/SWE-agent/mini-swe-agent (5-pattern stuck taxonomy reference; RepeatedActionObservation + MonologueSpiral are direct ports)
    - claude_code_arxiv: https://arxiv.org/abs/2604.14228 (circuit-breaker semantics — N consecutive same-type failures, structured halt object surfaced to user)
    - aider_repo_session_log: https://aider.chat/docs/usage/conventions.html (background reference — Aider persists chat history as Markdown; we use JSONL because it's machine-parseable and append-friendly)
    - openhands_session_resume: https://docs.openhands.dev/persistence (resume-from-snapshot semantics — closely mirrors our resume-from-compaction-boundary lock)
  code:
    - src-tauri/src/loop_engine.rs (3427 lines — Phase 33 surface; LoopState at L49, LoopHaltReason at L102, run_loop at L456; recent_actions ring buffer is `last_3_actions` today, capacity 3 hardcoded at L80; render_actions_json at L331 with FORCE_VERIFY_PANIC seam at L324; consecutive_same_tool_failures HashMap at L68; replans_this_run + token_escalations counters at L59-61; cumulative_cost_usd at L55; price_per_million already wired at L939 + L985 + L1102)
    - src-tauri/src/commands.rs (3218 lines — message-flow surface; record_error at L103, is_circuit_broken at L114, backoff_secs at L124 ALL ALREADY pub(crate); send_message_stream_inline at L871; compress_conversation_smart at L269 with `[Earlier conversation summary]\n{summary}` marker at L348; classify_api_error at L366; try_free_model_fallback at L440; emit_stream_event at L71)
    - src-tauri/src/providers/mod.rs (1231 lines — complete_simple at L444, complete_turn, max_output_tokens_for at L368, price_per_million at L409, AssistantTurn at L161 with stop_reason at L175 and tokens_in/tokens_out fields; try_free_model_fallback is in commands.rs not providers — generalisation lifts it into resilience/fallback.rs)
    - src-tauri/src/config.rs (1843 lines — ContextConfig declaration + 6-place wire-up exemplar; LoopConfig at adjacent block; blade_config_dir at L852; BLADE_CONFIG_DIR env override for test isolation)
    - src-tauri/src/lib.rs (1787 lines — `mod` cluster; Phase 34 adds `mod resilience;` + `mod session;`; 4 new Tauri commands added to generate_handler!)
    - src/lib/events/payloads.ts (875 lines; BladeLoopEventPayload union at L865 — Phase 34 extends with stuck_detected/circuit_open/cost_warning/cost_update variants)
    - src/lib/events/index.ts (BLADE_EVENTS frozen registry — Phase 34 adds no new event names; reuses BLADE_LOOP_EVENT for stuck/circuit/cost discriminants)
    - src/features/activity-log/ + src/features/chat/ (existing chip surfaces; SessionsView is new under src/features/sessions/)
    - Cargo.toml — futures 0.3 present, uuid 1 present, NO ulid crate yet (Phase 34 adds it)
inputs:
  - .planning/phases/34-resilience-session/34-CONTEXT.md (LOCKED — 12 implementation decisions across RES-01..05 + SESS-01..04 + ActivityStrip + Backward-Compat + Module Boundaries + Testing & Verification)
  - .planning/REQUIREMENTS.md (RES-01..05 verbatim L31-35; SESS-01..04 verbatim L56-59)
  - .planning/ROADMAP.md (lines 122-134 — Phase 34 row + 6 success criteria)
  - .planning/phases/33-agentic-loop/33-CONTEXT.md (Phase 33 predecessor — gold-standard CONTEXT structure)
  - .planning/phases/33-agentic-loop/33-RESEARCH.md (Phase 33 RESEARCH structure to mirror)
  - .planning/phases/33-agentic-loop/33-09-PLAN.md (CTX-07 fallback discipline pattern — port to detect_stuck + SessionWriter::append)
  - .planning/phases/32-context-management/32-CONTEXT.md (`[Earlier conversation summary]` boundary marker for SESS-02 resume logic)
  - CLAUDE.md (six-place rule, safe_slice, Tauri command namespace flatness, verification protocol)
---

# Phase 34: Resilience + Session Persistence — Research

**Audience:** the planner. The 34-CONTEXT.md document locks 12 implementation decisions across 9 requirements (RES-01..05, SESS-01..04); this doc supplies HOW (concrete code anchors, citation-backed patterns, validation surfaces, landmines) — not WHAT.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RES-01 | Stuck detection — 5 semantic patterns | §Findings/RES-01 — new module `resilience/stuck.rs`; expand LoopState.last_3_actions (capacity 3) → recent_actions (capacity 6); 5 deterministic detector fns; aggregator `detect_stuck` with priority ordering; RES_FORCE_STUCK seam mirrors FORCE_VERIFY_PANIC |
| RES-02 | Circuit breaker — N consecutive same-type failures | §Findings/RES-02 — `commands::record_error` + `is_circuit_broken` already `pub(crate)` (commands.rs:103,114); reuse + extend with `attempts_summary` capture; `LoopHaltReason::CircuitOpen { error_kind, attempts_summary }` extends existing enum |
| RES-03 | Per-conversation cumulative cost tracking | §Findings/RES-03 — `LoopState.conversation_cumulative_cost_usd` (NEW field, distinct from per-loop `cumulative_cost_usd`); persisted via SessionWriter; `get_conversation_cost` Tauri command for chat-input meter |
| RES-04 | Cost guard — warn at 80%, halt at 100% | §Findings/RES-04 — `cost_warning_80_emitted: bool` latch in LoopState; `LoopHaltReason::CostExceeded` gains `scope: CostScope` enum field (PerLoop/PerConversation); reuses RES-03 cumulative |
| RES-05 | Provider fallback chain with backoff | §Findings/RES-05 — `resilience/fallback.rs::try_with_fallback`; generalises `commands::try_free_model_fallback` (commands.rs:440); exponential backoff `min(base × 2^attempt, max) + jitter`; default chain `["primary","openrouter","groq","ollama"]` |
| SESS-01 | Append-only JSONL conversation log | §Findings/SESS-01 — `session/log.rs::SessionWriter`; `OpenOptions::append` atomic up to PIPE_BUF=4096; ULID session IDs (lex-sortable); 7 SessionEvent variants with `#[serde(tag="kind", content="data")]`; rotation at keep_n_sessions=100 → archive/ |
| SESS-02 | Session resume from compaction boundary | §Findings/SESS-02 — `session/resume.rs::load_session`; replays `Vec<ConversationMessage>` halting at most-recent CompactionBoundary event; reuses Phase 32-04's `[Earlier conversation summary]` marker format verbatim |
| SESS-03 | Session list UI + Tauri command | §Findings/SESS-03 — `session/list.rs::list_sessions`; new route `sessions` in App.tsx (3-place registration); SessionsView at `src/features/sessions/SessionsView.tsx`; metadata-only (no full-text search) |
| SESS-04 | Session forking at message index | §Findings/SESS-04 — `fork_session(parent_id, fork_at_message_index)`; verbatim byte copy + prepend SessionMeta; one-level deep (no DAG); ordinal counts UserMessage + AssistantTurn only |

---

## Project Constraints (from CLAUDE.md)

These are LOAD-BEARING. The planner MUST verify task plans honor each:

1. **Six-place config rule** — every new `BladeConfig` field needs ALL 6 sites updated. Phase 34 adds TWO new sub-structs (`ResilienceConfig` with 12 fields, `SessionConfig` with 4 fields) — total 16 fields × 6 places. Don't try to remember from memory; **copy the diff Phase 33-01 used for `LoopConfig` and adapt every line for `resilience: ResilienceConfig` AND `session: SessionConfig`**.
2. **`safe_slice` mandatory** — never `&text[..n]` on user/conversation/tool content. Risk sites: `first_message_excerpt` (SessionMeta), `summary_first_chars` (CompactionBoundary), NoProgress detector text comparison (`safe_slice(turn_text, 500)` per CONTEXT lock §RES-01).
3. **Don't run `cargo check` after every edit** — batch first, check at end (1-2 min per check). Phase 34 has wider diff surface than Phase 33 (2 new modules, 5 submodules total).
4. **Tauri command name uniqueness** — Phase 34 adds 4 commands: `list_sessions`, `resume_session`, `fork_session`, `get_conversation_cost`. Verify ZERO collisions before adding to `generate_handler!`. Run `grep -rn "fn list_sessions\b\|fn resume_session\b\|fn fork_session\b\|fn get_conversation_cost\b" /home/arnav/blade/src-tauri/src/` — must return 0 hits before this phase begins.
5. **`use tauri::Manager;`** required when calling `app.state()` or `app.emit()` — easy to miss in new modules. New `session/list.rs` and `resilience/fallback.rs` need it (the latter for `try_with_fallback`'s status emits).
6. **No Co-Authored-By in commits.**
7. **Verification Protocol (v1.1 lesson)** — Phase 34 adds runtime UI work (SessionsView + ActivityStrip chips + cost meter + chat resume). Final plan MUST end on `checkpoint:human-verify` with 14-step UAT script per CONTEXT lock §Testing & Verification. Screenshots at 1280×800 + 1100×700 saved under `docs/testing ss/` (literal space).
8. **Streaming contract** — every Rust streaming branch must emit `blade_message_start` before `chat_token`. **SESS-02 resume must respect this**: every replayed AssistantTurn that streams to the UI emits `blade_message_start` first. Resume rebuilds in-memory `Vec<ConversationMessage>`; the FIRST live turn after resume goes through the regular send_message_stream_inline path, which already honors the contract — but if SESS-02 ever emits replay tokens to the UI, the contract applies. Default: resume hydrates conversation state silently; UI re-renders the rebuilt message list without streaming.
9. **Don't migrate all 37+ native tools to `Result<T, ToolError>`** — same shim-only posture from Phase 33 (CONTEXT lock §Phase Boundary).
10. **The pre-existing 188 staged deletions in `.planning/phases/00-pre-rebuild-audit/` etc.** — every commit in this phase pipeline MUST `git add` only the file it just wrote, never `git add -A` or `git add .`. The orchestrator will sweep the deletions in a separate operation.

---

## Executive Summary

1. **The Phase 33 substrate is 80% of what Phase 34 needs.** LoopState already carries `cumulative_cost_usd`, `replans_this_run`, `token_escalations`, `last_3_actions` (rename+resize), `consecutive_same_tool_failures`. LoopHaltReason already carries `CostExceeded`, `IterationCap`, `Cancelled`, `ProviderFatal` — Phase 34 EXTENDS the enum (adds `Stuck`, `CircuitOpen`; mutates `CostExceeded` with `scope: CostScope`). The render_actions_json + FORCE_VERIFY_PANIC seam is the model for RES_FORCE_STUCK. The catch_unwind discipline at run_loop's verify-firing block (loop_engine.rs:573) is the template for the stuck-detection wrapper. The `commands::record_error / is_circuit_broken / backoff_secs` triad is ALREADY `pub(crate)` (commands.rs:103,114,124) — Plan 34-NN does not add the helpers, it WIRES them into run_loop's iteration boundary.

2. **The 5 stuck patterns each have different state requirements.** `RepeatedActionObservation` needs `recent_actions` capacity ≥ 6 (current `last_3_actions` capacity 3 is insufficient — same triple seen 3 times needs at least 3 slots free of intervening different actions). `MonologueSpiral` needs a fresh `consecutive_no_tool_turns: u32` counter on LoopState. `ContextWindowThrashing` needs `compactions_this_run: u32`, threaded from `commands.rs::compress_conversation_smart` via a thin `loop_engine::record_compaction` helper. `NoProgress` needs `last_progress_iteration: u32` updated every iteration that meets the "new tool name OR new content" predicate. `CostRunaway` reads `cumulative_cost_usd / iteration` (a derived rate, no new field). The detector module is 5 free functions + a `detect_stuck` aggregator that walks them in priority order (CONTEXT lock §Claude's Discretion: `CostRunaway > CircuitOpen > RepeatedActionObservation > ContextWindowThrashing > MonologueSpiral > NoProgress`).

3. **JSONL atomic-append is the safest persistence story.** `OpenOptions::new().create(true).append(true).open(path)?` on POSIX guarantees atomicity for writes ≤ PIPE_BUF (4096 bytes on Linux/macOS, often 1024 on older systems). Our largest event is `AssistantTurn` with `content` up to ~64k chars worst-case (extended-output), so single-line writes can exceed the atomic guarantee. **Mitigation:** wrap each `write_all(line.as_bytes())` in advisory `flock` (LOCK_EX) on Unix; Windows append is atomic for any size when O_APPEND is set (NTFS file pointer is shared by handle). The CONTEXT lock §SESS-01 hints at this: "fall back to advisory `flock` on Linux/macOS if a single event ever exceeds [PIPE_BUF]". Recommend: **always flock** (cheap; correct), don't conditionally skip for small lines.

4. **ULID is the right session ID choice.** Crockford base32 (26 chars), 48-bit ms timestamp prefix → directory listing is naturally chronological. Lex-sortable means `list_sessions` reads filenames in directory order without parsing. UUIDv7 has the same time-prefix property but isn't standardised across crates; the `ulid` crate (https://crates.io/crates/ulid) is small, MIT-licensed, and depends only on `rand`. Add to Cargo.toml. Alternative: hand-roll using `chrono::Utc::now().timestamp_millis()` + `rand::random::<u128>()`, but this loses the standard format. **Decision:** add `ulid = "1"` (currently latest stable).

5. **SessionWriter is owned where conversation lifetime begins — `send_message_stream_inline`.** CONTEXT lock §SESS-01: "SessionWriter is owned by `LoopState` (or a parallel struct passed alongside it through `run_loop`)". Recommend: thread `Option<SessionWriter>` as a parallel arg to `run_loop` (do not embed in LoopState — LoopState already serializes for tests; SessionWriter holds a file handle, which is not Clone-friendly). Construct in `send_message_stream_inline` once per conversation; pass through to run_loop alongside `&mut conversation`. The five emit sites (UserMessage, AssistantTurn, ToolCall, CompactionBoundary, HaltReason, LoopEvent — six actually) all live in `commands.rs` per CONTEXT lock; run_loop returns its halt reason and commands.rs writes the HaltReason event after the match.

6. **Resume bypasses the streaming contract by default.** SESS-02's `resume_session` returns `ResumedConversation { messages: Vec<ConversationMessage>, session_id: String, last_compaction_boundary_at: Option<usize> }` to the frontend. The frontend re-renders the message list directly (no streaming). The next user turn goes through send_message_stream_inline normally — `blade_message_start` fires for that live turn. **No special streaming-contract logic needed for resume.** The MEMORY.md note about streaming-contract holds for live streaming branches; resume is a cold rehydration, not a stream.

7. **Cost-guard tier escalation is a 4-line additive change to the existing run_loop check.** Today: `if smart_loop_enabled && cumulative_cost_usd > cost_guard_dollars { halt CostExceeded }` (loop_engine.rs:503). Phase 34 changes this to TWO checks against `conversation_cumulative_cost_usd` against `cost_guard_per_conversation_dollars`: (a) at 80% emit `cost_warning` once (latch via `cost_warning_80_emitted`), (b) at 100% halt with `CostExceeded { scope: PerConversation }`. The per-loop cap from Phase 33 stays as PerLoop scope. Both can fire — PerConversation halts before PerLoop in priority order (the longer scope wins).

8. **Provider fallback generalises commands::try_free_model_fallback.** Today (commands.rs:440): hardcoded 3-element list `[("openrouter","llama-3.3-70b-instruct:free"), ("groq","llama-3.3-70b-versatile"), ("ollama","llama3")]`. Phase 34's `resilience/fallback.rs::try_with_fallback(chain: &[String], ...)` reads `ResilienceConfig.provider_fallback_chain: Vec<String>`, resolves each to `(provider, default_model_for(provider))`, and applies exponential backoff with jitter. The literal `"primary"` resolves to `BladeConfig.provider`. Plan 34-NN should NOT delete `try_free_model_fallback` from commands.rs — keep as deprecated alias that delegates to `try_with_fallback` to avoid touching the dozen commands.rs call sites. Mark `#[deprecated(note="Plan 34-NN — use resilience::fallback::try_with_fallback")]`.

9. **The two kill switches are independent.** `resilience.smart_resilience_enabled = false` disables stuck/circuit/cost-warn/fallback (CONTEXT lock §Backward Compatibility). `session.jsonl_log_enabled = false` disables JSONL writes. They're orthogonal: a user can disable session log without disabling stuck detection. Mirror Phase 32 / Phase 33 toggle discipline.

10. **The six-place rule applies twice.** Phase 33-01 added `r#loop: LoopConfig` (one struct, 4 fields, 6 places). Phase 34-NN adds `resilience: ResilienceConfig` (12 fields) AND `session: SessionConfig` (4 fields) in the SAME six places. That's 16 fields × 6 places = 96 wire-up touch points. The plan must explicitly enumerate every grep marker in its acceptance criteria — `grep -c "resilience: ResilienceConfig" config.rs ≥ 4`, etc. — exactly the way Plan 33-01 did.

---

## Existing Code (anchors the planner cites by file:line)

### `src-tauri/src/loop_engine.rs` — what gets extended

**LoopState (current shape — Phase 34 extends):**
- L49 `pub struct LoopState`
- L51 `pub iteration: u32`
- L55 `pub cumulative_cost_usd: f32` (per-loop — STAYS unchanged; Phase 34 ADDS `pub conversation_cumulative_cost_usd: f32`)
- L59 `pub replans_this_run: u32`
- L61 `pub token_escalations: u32`
- L64 `pub last_3_actions: VecDeque<ActionRecord>` (RENAME → `recent_actions`, capacity 3 → 6)
- L68 `pub consecutive_same_tool_failures: HashMap<String, u32>`
- L73 `pub last_nudge_iteration: Option<u32>`
- **NEW for RES-01:**
  - `pub consecutive_no_tool_turns: u32` (MonologueSpiral)
  - `pub compactions_this_run: u32` (ContextWindowThrashing)
  - `pub last_progress_iteration: u32` (NoProgress)
  - `pub last_progress_text_hash: Option<[u8;16]>` (NoProgress dedup; sha256 truncated)
  - `pub last_iter_cost: f32` (CostRunaway delta)
- **NEW for RES-04:**
  - `pub cost_warning_80_emitted: bool`
- **NEW for RES-03:**
  - `pub conversation_cumulative_cost_usd: f32`

**LoopHaltReason (current — Phase 34 extends):**
- L102 `pub enum LoopHaltReason`
- `CostExceeded { spent_usd: f32, cap_usd: f32 }` (MUTATE — add `scope: CostScope`)
- `IterationCap`
- `Cancelled`
- `ProviderFatal { error: String }`
- **NEW:**
  - `Stuck { pattern: String }` (discriminant string from StuckPattern enum)
  - `CircuitOpen { error_kind: String, attempts_summary: Vec<AttemptRecord> }`
- **NEW enum:**
  - `pub enum CostScope { PerLoop, PerConversation }`
- **NEW struct (consumed by CircuitOpen variant):**
  - `pub struct AttemptRecord { provider: String, model: String, error_message: String, timestamp_ms: u64 }`

**run_loop iteration top (current — Phase 34 inserts stuck-detect call):**
- L491-L520 cost-guard halt block (today: per-loop only; Phase 34 splits into per-conversation 80%-warn + 100%-halt + per-loop 100%-halt)
- L520-L525 verification probe firing block (Phase 33-04, hardened by Plan 33-09 with catch_unwind)
- **INSERT POINT** for stuck-detect: between cost-guard and verification probe, OR at the very top of iteration body before cost-guard (recommend top — CostRunaway pattern reads cost state which by definition doesn't change between iteration top and verification firing).

**render_actions_json + FORCE_VERIFY_PANIC seam:**
- L324-L342 `pub(crate) static FORCE_VERIFY_PANIC` thread_local + `render_actions_json` panic check
- **MIRROR for RES-01:** `pub(crate) static RES_FORCE_STUCK: thread_local::Cell<Option<StuckPattern>>` + `detect_stuck` checks at entry (returns the forced verdict before walking real detectors).
- **MIRROR for RES-05:** `pub(crate) static RES_FORCE_PROVIDER_ERROR: thread_local::Cell<Option<String>>` for fallback testing.

**catch_unwind wrapper site (Phase 33-09 pattern — Phase 34 mirrors for stuck-detect):**
- L573 `let probe = std::panic::AssertUnwindSafe(verify_progress(...)).catch_unwind().await;`
- For stuck-detect (synchronous): `std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| detect_stuck(state, config)))`. No futures::FutureExt needed — detect_stuck is fully synchronous (no await).

**price_per_million site (existing — Phase 34 reuses unchanged):**
- L939 (escalation cost projection)
- L985 (post-truncation-retry refund/charge)
- L1102 (per-turn accumulation)

### `src-tauri/src/commands.rs` — message-flow boundaries

**Circuit-breaker substrate (already pub(crate) — Phase 34 wires into LoopState halt):**
- L103 `pub(crate) fn record_error(kind: &str)`
- L114 `pub(crate) fn is_circuit_broken(kind: &str) -> bool` (3-strikes-in-5-minutes window)
- L124 `pub(crate) fn backoff_secs(base: u64, kind: &str) -> u64`
- L98 `static ERROR_HISTORY: OnceLock<Mutex<Vec<(String, Instant)>>>`

**Phase 34 extension to is_circuit_broken:**
The existing `is_circuit_broken(kind) -> bool` is a binary check. Phase 34 needs the **list of attempts** for `LoopHaltReason::CircuitOpen { attempts_summary: Vec<AttemptRecord> }`. ADD a sibling `pub(crate) fn circuit_attempts_summary(kind: &str) -> Vec<AttemptRecord>` that walks ERROR_HISTORY and returns the matching window's entries — but ERROR_HISTORY today only stores `(kind, Instant)`, not provider/model/message. **EXTENSION:** widen the tuple to `(String /* kind */, String /* provider */, String /* model */, String /* msg */, Instant)`. All call sites currently only pass `kind`; the additional fields default to empty string at the legacy call sites; the new circuit-breaker plan threads provider/model/msg through. This is a `pub(crate)` widening; no Tauri command surface change.

**Message-flow emit sites (where SessionWriter hooks in):**
- `send_message_stream_inline` entry: construct SessionWriter from `BladeConfig.session.jsonl_log_dir`, generate ULID, write `SessionMeta` event as the first JSONL line.
- After `last_user_text` is computed (around L1370): write `UserMessage` event.
- After each `complete_turn` returns Ok (inside loop_engine — but CONTEXT lock §SESS-01 says "writes happen at the message-flow boundaries in commands.rs" — meaning the DECISION lock is to NOT write from loop_engine; instead, the caller pulls the AssistantTurn after `run_loop` returns and writes the AssistantTurn event for each turn. The simplest model: pass `Option<SessionWriter>` into run_loop, run_loop calls `.write_assistant_turn()` and `.write_tool_call()` AS PART OF the iteration body. This contradicts the CONTEXT lock literal text but is the only practical wiring — the CONTEXT lock probably means "the writer is owned by commands.rs, and run_loop borrows it" rather than "all writes happen lexically inside commands.rs"). **Resolution:** SessionWriter is constructed in commands.rs, threaded as `&mut SessionWriter` (or `Option<&mut SessionWriter>`) through run_loop, and writes happen at each turn boundary within run_loop. The HaltReason event writes from commands.rs after run_loop returns.
- `compress_conversation_smart` (L269) call site at L1679: after compression completes, write `CompactionBoundary` event. Threading: have the caller write the boundary event after the function returns Ok, reading the `summary` from the post-compression conversation; `loop_state.record_compaction()` increments the counter alongside.
- After run_loop returns: write `HaltReason` event with `payload = serde_json::to_value(&halt_reason)` (LoopHaltReason serialises naturally).

**Streaming contract sites (preserve verbatim):**
- L1086-L1096 `blade_message_start` → `chat_token` → `chat_done` ordering (fast-path).
- L1214-L1230 same ordering on the brain-planner emit path.

### `src-tauri/src/providers/mod.rs` — fallback substrate

- L161 `pub struct AssistantTurn` — `content`, `tool_calls`, `stop_reason`, `tokens_in`, `tokens_out`. Phase 34 reuses without modification.
- L368 `pub fn max_output_tokens_for(provider, model) -> u32`. Phase 34 reuses for cost projection.
- L409 `pub fn price_per_million(provider, model) -> (f32, f32)`. Phase 34 reuses for `conversation_cumulative_cost_usd`.
- L444 `pub async fn complete_simple(provider, api_key, model, prompt) -> Result<String, String>`. Phase 34's verifier path reuses (existing).
- L233 `pub async fn complete_turn(provider, api_key, model, conversation, tools, base_url) -> Result<AssistantTurn, String>`. **`try_with_fallback` wraps this call** with retry-then-next-provider semantics.
- **Recommend: add `pub fn default_model_for(provider: &str) -> &'static str`** that returns the project's preferred default model per provider (anthropic → "claude-sonnet-4-20250514", openai → "gpt-4o", groq → "llama-3.3-70b-versatile", openrouter → "meta-llama/llama-3.3-70b-instruct:free", ollama → "llama3", gemini → "gemini-2.0-flash-exp"). This is the `try_with_fallback` helper's resolution strategy when a chain element is just a provider name.

### `src-tauri/src/config.rs` — six-place wire-up + blade_config_dir

- L840-L850 BladeConfig::default block (closing) — Phase 34 adds `resilience: ResilienceConfig::default(), session: SessionConfig::default()` here.
- L852 `pub fn blade_config_dir() -> PathBuf` — Phase 34's default `jsonl_log_dir = blade_config_dir().join("sessions")`. The `BLADE_CONFIG_DIR` env override at L857 means tests automatically isolate JSONL writes to a temp dir. Reuse without modification.
- ContextConfig + LoopConfig blocks are the structural template for ResilienceConfig + SessionConfig.

### `src-tauri/src/lib.rs` — module + command registration

- `mod` cluster — add `mod resilience;` and `mod session;` near alphabetical neighbors.
- `generate_handler!` macro — append 4 new commands: `list_sessions`, `resume_session`, `fork_session`, `get_conversation_cost`. **VERIFY collision-free first** via `grep -rn "fn list_sessions\|fn resume_session\|fn fork_session\|fn get_conversation_cost" /home/arnav/blade/src-tauri/src/`.

### Frontend anchors

- `src/lib/events/payloads.ts:865` BladeLoopEventPayload union — Phase 34 extends with 4 new variants (`stuck_detected`, `circuit_open`, `cost_warning`, `cost_update`).
- `src/lib/events/index.ts` BLADE_EVENTS registry — `BLADE_LOOP_EVENT` already registered; no new event names needed (the new variants discriminate via `kind` within the same event).
- `src/features/activity-log/` — chip rendering surface; extend the `kind`-switch.
- `src/features/sessions/SessionsView.tsx` (NEW) — list + actions; existing list-card patterns from `src/features/dashboard/` to mirror.
- `src/lib/tauri/sessions.ts` (NEW) — typed wrappers for the 4 new commands. Mirror `src/lib/tauri/intelligence.ts` shape.
- `src/App.tsx` — 3-place route registration: `Route` type union, lazy import + `fullPageRoutes` map, command palette entry.
- `src/features/chat/ChatComposer.tsx` (or wherever the input lives) — the cost-meter chip subscribes to `cost_update` events.

---

## External Research

### JSONL atomic-append semantics

POSIX `O_APPEND` guarantees that each `write(2)` is atomic with respect to other concurrent appends to the same file, AT MOST UP TO `PIPE_BUF` bytes (4096 on Linux/macOS as of kernel 4.x, often 1024 on older systems). For lines exceeding `PIPE_BUF`, two concurrent writes can interleave at the byte level.

Our `AssistantTurn` event with full content (up to 64k chars on extended-output Anthropic) WILL exceed PIPE_BUF. **Mitigation:** advisory `flock(LOCK_EX)` on Unix before each write; release after. On Windows, NTFS append with O_APPEND is atomic for any size (the file pointer is shared at the kernel handle level). Recommend: always flock on Unix; rely on Windows NTFS atomicity on Windows.

The `fs2` crate provides cross-platform `FileExt::lock_exclusive`. Add to Cargo.toml. Alternative: hand-roll using `std::os::unix::fs::FileExt` on Unix only and skip on Windows. **Decision:** add `fs2 = "0.4"` (cross-platform, MIT-licensed, no deps beyond libc).

### ULID vs UUIDv7

ULID (https://github.com/ulid/spec):
- 128 bits = 48-bit Unix-time-ms + 80-bit random
- Crockford base32 → 26 chars `01ARZ3NDEKTSV4RRFFQ69G5FAV`
- Lex-sortable by time prefix → directory listings naturally chronological
- The `ulid` crate (https://crates.io/crates/ulid) is 1.x stable, MIT-licensed

UUIDv7 (https://datatracker.ietf.org/doc/rfc9562/):
- 128 bits = 48-bit Unix-time-ms + 4-bit version + 12-bit random + 2-bit variant + 62-bit random
- Standard UUID hex format `0190e0e6-1234-7abc-9def-0123456789ab` (36 chars with hyphens)
- Lex-sortable by time prefix
- The `uuid` crate already in Cargo.toml (currently `features = ["v4"]`); v7 needs `features = ["v7"]` flag added

**Decision: ULID.** The `ulid` crate is smaller (no `getrandom` cargo feature gymnastics), the Crockford base32 is shorter (26 vs 36 chars) and avoids hyphens (filesystem-friendlier), and the spec is purpose-built for sortable IDs — UUIDv7 added time-prefix sorting as a recent retrofit. Crockford base32 also avoids ambiguous chars (no I/L/O/U) so session IDs are easier to read aloud.

### Session log format prior art

- **Aider** (`aider.chat`) — persists chat history as Markdown in `.aider.chat.history.md`. Append-only, human-readable. We chose JSONL because it's machine-parseable (resume needs structured replay) and append-friendly (Markdown's blank-line block delimiters complicate concurrent appends).
- **OpenHands** — uses opaque binary snapshots in SQLite. Heavier substrate than we need; SQLite has the ACID guarantees but adds a binary file the user can't grep. JSONL is grep-friendly + append-atomic.
- **Continue.dev** — JSON files per session (one big object, rewritten on every save). This is the "naive" version of what we're doing; rewrite-on-save defeats append-only durability (a crash mid-rewrite truncates the file).

**Decision:** JSONL with append-only writes. One file per session_id. Schema versioned via the SessionMeta event's first-line presence (a future v2 schema can add a `version: 2` field to SessionMeta and dispatch reads on it).

### Stuck-pattern thresholds — calibration

The 5 patterns CONTEXT-locked thresholds:
- `RepeatedActionObservation` — 3+ same `(tool, args_hash, result_hash)` in `recent_actions` (ring buffer size 6). At capacity 3 (current `last_3_actions`), the buffer can hold the full triple but cannot retain history before/after, defeating "spotted in last N actions". Capacity 6 lets the detector see "was repeated 3 times in the last 6 actions" — natural threshold.
- `MonologueSpiral` — 5+ consecutive assistant turns with no tool call. New `consecutive_no_tool_turns: u32`; reset on tool fire.
- `ContextWindowThrashing` — 3+ compactions in current run_loop invocation. New `compactions_this_run: u32`.
- `NoProgress` — 5+ iterations with no new tool name AND no new content. The "new content" heuristic uses `safe_slice(turn_text, 500)` + sha256-truncated-to-16-bytes comparison against `last_progress_text_hash`. The 500-char prefix avoids "wrote a 5000-line response, only first paragraph differs from last turn" being mis-flagged.
- `CostRunaway` — `current_iter_cost > 2.0 × cumulative_cost_usd / iteration` AND `iteration >= 3`. The cold-start guard avoids flagging iteration 2 as a runaway just because iteration 1 was anomalously cheap.

The thresholds are configurable per CONTEXT lock §RES-01 — the planner must NOT hardcode any of them; they live in `ResilienceConfig`.

### Circuit-breaker algorithm

Phase 33's `commands::is_circuit_broken(kind) -> bool` is a sliding-window count: ≥3 occurrences of `kind` in last 5 minutes → broken. Phase 34's RES-02 needs:
- `attempts_summary: Vec<AttemptRecord>` — list of failures within window
- `error_kind` discriminant from `classify_api_error` taxonomy (`timeout`, `rate_limit`, `auth`, `server`, `truncate_and_retry`, `other`)
- Reset on success — currently NOT done by `record_error`. Phase 34 ADDS `pub(crate) fn clear_error_history()` called on every successful provider response. (Today the history grows monotonically until the size cap of 50; the count-in-window check just counts recent — a long history with many old `rate_limit` followed by a recent `timeout` won't trip the timeout circuit.)
- `circuit_breaker_threshold` — configurable; CONTEXT default 3 matches Phase 33's existing literal.

### Provider fallback patterns (Anthropic / Aider)

Aider's provider fallback (https://aider.chat/docs/llms.html): user configures a primary; on rate_limit / 5xx, retry once on primary, then try OpenAI / Anthropic / DeepSeek per priority order. Backoff between retries: exponential 5s, 10s, 20s.

Anthropic SDK retry policy (https://docs.anthropic.com/en/api/errors): default 2 retries with exponential backoff (1s, 2s) on 429/529. We mirror this: `max_retries_per_provider: u32 = 2`, `backoff_base_ms: u64 = 500`, `backoff_max_ms: u64 = 30_000`.

**Jitter pattern** (AWS exponential backoff with jitter): `delay = random(0, min(cap, base × 2^attempt))`. We use a simpler additive jitter: `delay = min(base × 2^attempt, max) + random(0..=200ms)` per CONTEXT lock §RES-05 — slightly different math but the same goal (avoid thundering herd).

### Tauri filesystem security for sessions list

Tauri's `Manager::path().resolve()` API is the safe way to construct paths within the app's sandbox. For SessionsView: backend Tauri commands take `session_id: String` (not a path) and resolve via `blade_config_dir().join("sessions").join(format!("{}.jsonl", session_id))`. **Validate**: reject session IDs containing `/`, `\`, `..`, or null bytes — use `regex::Regex::new(r"^[0-9A-HJKMNP-TV-Z]{26}$")` (Crockford base32 charset). Without validation, a malicious frontend (or a future `@context-anchor` plugin) could path-traverse to read arbitrary files.

The CONTEXT lock §SESS-03 doesn't mention this explicitly, but it's table-stakes Tauri security. Add an explicit `fn validate_session_id(id: &str) -> Result<(), String>` helper in `session/list.rs`.

---

## Implementation Sketches

### ResilienceConfig + SessionConfig (Plan 34-01 substrate)

```rust
// src-tauri/src/config.rs — adjacent to LoopConfig (around L300)

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ResilienceConfig {
    /// CTX-07-style escape hatch. true = stuck detection + circuit breaker +
    /// cost-warn + provider fallback all enabled. false = legacy behavior
    /// (per-conversation cap still enforced at 100% for data integrity).
    #[serde(default = "default_smart_resilience_enabled")]
    pub smart_resilience_enabled: bool,
    /// RES-01 — master toggle for the 5-pattern stuck detector.
    #[serde(default = "default_stuck_detection_enabled")]
    pub stuck_detection_enabled: bool,
    /// RES-01 — capacity of LoopState.recent_actions ring buffer. Default 6.
    #[serde(default = "default_recent_actions_window")]
    pub recent_actions_window: u32,
    /// RES-01 MonologueSpiral threshold. Default 5.
    #[serde(default = "default_monologue_threshold")]
    pub monologue_threshold: u32,
    /// RES-01 ContextWindowThrashing threshold. Default 3.
    #[serde(default = "default_compaction_thrash_threshold")]
    pub compaction_thrash_threshold: u32,
    /// RES-01 NoProgress threshold. Default 5.
    #[serde(default = "default_no_progress_threshold")]
    pub no_progress_threshold: u32,
    /// RES-02 — circuit-breaker N-consecutive-failures threshold. Default 3.
    #[serde(default = "default_circuit_breaker_threshold")]
    pub circuit_breaker_threshold: u32,
    /// RES-04 — per-conversation spend cap in USD. Default 25.0.
    #[serde(default = "default_cost_guard_per_conversation_dollars")]
    pub cost_guard_per_conversation_dollars: f32,
    /// RES-05 — provider fallback chain. Each element is a provider id;
    /// `"primary"` resolves to BladeConfig.provider. Default
    /// vec!["primary","openrouter","groq","ollama"].
    #[serde(default = "default_provider_fallback_chain")]
    pub provider_fallback_chain: Vec<String>,
    /// RES-05 — retries per chain element before falling over. Default 2.
    #[serde(default = "default_max_retries_per_provider")]
    pub max_retries_per_provider: u32,
    /// RES-05 — exponential backoff base in ms. Default 500.
    #[serde(default = "default_backoff_base_ms")]
    pub backoff_base_ms: u64,
    /// RES-05 — exponential backoff cap in ms. Default 30000.
    #[serde(default = "default_backoff_max_ms")]
    pub backoff_max_ms: u64,
}

fn default_smart_resilience_enabled() -> bool { true }
fn default_stuck_detection_enabled() -> bool { true }
fn default_recent_actions_window() -> u32 { 6 }
fn default_monologue_threshold() -> u32 { 5 }
fn default_compaction_thrash_threshold() -> u32 { 3 }
fn default_no_progress_threshold() -> u32 { 5 }
fn default_circuit_breaker_threshold() -> u32 { 3 }
fn default_cost_guard_per_conversation_dollars() -> f32 { 25.0 }
fn default_provider_fallback_chain() -> Vec<String> {
    vec!["primary".to_string(), "openrouter".to_string(), "groq".to_string(), "ollama".to_string()]
}
fn default_max_retries_per_provider() -> u32 { 2 }
fn default_backoff_base_ms() -> u64 { 500 }
fn default_backoff_max_ms() -> u64 { 30_000 }

impl Default for ResilienceConfig {
    fn default() -> Self {
        Self {
            smart_resilience_enabled: default_smart_resilience_enabled(),
            stuck_detection_enabled: default_stuck_detection_enabled(),
            recent_actions_window: default_recent_actions_window(),
            monologue_threshold: default_monologue_threshold(),
            compaction_thrash_threshold: default_compaction_thrash_threshold(),
            no_progress_threshold: default_no_progress_threshold(),
            circuit_breaker_threshold: default_circuit_breaker_threshold(),
            cost_guard_per_conversation_dollars: default_cost_guard_per_conversation_dollars(),
            provider_fallback_chain: default_provider_fallback_chain(),
            max_retries_per_provider: default_max_retries_per_provider(),
            backoff_base_ms: default_backoff_base_ms(),
            backoff_max_ms: default_backoff_max_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct SessionConfig {
    /// SESS-01 — master toggle. false = SessionWriter is a silent no-op.
    #[serde(default = "default_jsonl_log_enabled")]
    pub jsonl_log_enabled: bool,
    /// SESS-01 — directory containing one JSONL per session.
    #[serde(default = "default_jsonl_log_dir")]
    pub jsonl_log_dir: PathBuf,
    /// SESS-02 — auto-resume last session on app boot. Default false (explicit user action).
    #[serde(default = "default_auto_resume_last")]
    pub auto_resume_last: bool,
    /// SESS-01 rotation — keep N most-recent sessions in jsonl_log_dir.
    /// Older sessions move to {jsonl_log_dir}/archive/. Default 100.
    #[serde(default = "default_keep_n_sessions")]
    pub keep_n_sessions: u32,
}

fn default_jsonl_log_enabled() -> bool { true }
fn default_jsonl_log_dir() -> PathBuf { blade_config_dir().join("sessions") }
fn default_auto_resume_last() -> bool { false }
fn default_keep_n_sessions() -> u32 { 100 }

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            jsonl_log_enabled: default_jsonl_log_enabled(),
            jsonl_log_dir: default_jsonl_log_dir(),
            auto_resume_last: default_auto_resume_last(),
            keep_n_sessions: default_keep_n_sessions(),
        }
    }
}

// Six-place wire-up — same diff Phase 33-01 used for `r#loop: LoopConfig`,
// substituting `resilience: ResilienceConfig` and `session: SessionConfig`.
```

### LoopState extension (Plan 34-02)

```rust
// src-tauri/src/loop_engine.rs — extend the existing LoopState

#[derive(Debug, Clone, Default)]
pub struct LoopState {
    pub iteration: u32,
    pub cumulative_cost_usd: f32,                              // existing
    pub conversation_cumulative_cost_usd: f32,                 // NEW (RES-03)
    pub last_iter_cost: f32,                                   // NEW (RES-01 CostRunaway delta)
    pub replans_this_run: u32,
    pub token_escalations: u32,
    pub recent_actions: VecDeque<ActionRecord>,                // RENAMED from last_3_actions; capacity 6
    pub consecutive_same_tool_failures: HashMap<String, u32>,  // existing
    pub last_nudge_iteration: Option<u32>,                     // existing
    pub consecutive_no_tool_turns: u32,                        // NEW (RES-01 MonologueSpiral)
    pub compactions_this_run: u32,                             // NEW (RES-01 ContextWindowThrashing)
    pub last_progress_iteration: u32,                          // NEW (RES-01 NoProgress)
    pub last_progress_text_hash: Option<[u8; 16]>,             // NEW (RES-01 NoProgress dedup)
    pub cost_warning_80_emitted: bool,                         // NEW (RES-04 latch)
}

pub const RECENT_ACTIONS_CAPACITY: usize = 6;

impl LoopState {
    pub fn record_action(&mut self, record: ActionRecord) {
        self.recent_actions.push_back(record);
        while self.recent_actions.len() > RECENT_ACTIONS_CAPACITY {
            self.recent_actions.pop_front();
        }
    }
    /// Plan 34-NN — call from commands::compress_conversation_smart on success.
    pub fn record_compaction(&mut self) {
        self.compactions_this_run = self.compactions_this_run.saturating_add(1);
    }
}
```

### LoopHaltReason extension (Plan 34-02)

```rust
#[derive(Debug, Clone)]
pub enum LoopHaltReason {
    CostExceeded { spent_usd: f32, cap_usd: f32, scope: CostScope },  // MUTATED (added scope)
    IterationCap,
    Cancelled,
    ProviderFatal { error: String },
    Stuck { pattern: String },                                          // NEW
    CircuitOpen { error_kind: String, attempts_summary: Vec<AttemptRecord> },  // NEW
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CostScope { PerLoop, PerConversation }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AttemptRecord {
    pub provider: String,
    pub model: String,
    pub error_message: String,
    pub timestamp_ms: u64,
}
```

### Stuck detector module (Plan 34-NN — RES-01)

```rust
// src-tauri/src/resilience/stuck.rs

use std::collections::VecDeque;
use sha2::{Sha256, Digest};
use crate::loop_engine::{LoopState, ActionRecord};
use crate::config::ResilienceConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum StuckPattern {
    CostRunaway,
    RepeatedActionObservation,
    ContextWindowThrashing,
    MonologueSpiral,
    NoProgress,
}

impl StuckPattern {
    pub fn discriminant(&self) -> &'static str {
        match self {
            Self::CostRunaway => "CostRunaway",
            Self::RepeatedActionObservation => "RepeatedActionObservation",
            Self::ContextWindowThrashing => "ContextWindowThrashing",
            Self::MonologueSpiral => "MonologueSpiral",
            Self::NoProgress => "NoProgress",
        }
    }
}

#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_STUCK: std::cell::Cell<Option<StuckPattern>> = std::cell::Cell::new(None);
}

/// Aggregator — walks detectors in priority order. First match wins.
pub fn detect_stuck(state: &LoopState, config: &ResilienceConfig) -> Option<StuckPattern> {
    #[cfg(test)]
    if let Some(p) = RES_FORCE_STUCK.with(|c| c.get()) {
        return Some(p);
    }
    if !config.smart_resilience_enabled || !config.stuck_detection_enabled {
        return None;
    }
    if detect_cost_runaway(state, config) { return Some(StuckPattern::CostRunaway); }
    if detect_repeated_action_observation(state, config) { return Some(StuckPattern::RepeatedActionObservation); }
    if detect_context_window_thrashing(state, config) { return Some(StuckPattern::ContextWindowThrashing); }
    if detect_monologue_spiral(state, config) { return Some(StuckPattern::MonologueSpiral); }
    if detect_no_progress(state, config) { return Some(StuckPattern::NoProgress); }
    None
}

fn detect_repeated_action_observation(state: &LoopState, _config: &ResilienceConfig) -> bool {
    if state.recent_actions.len() < 3 { return false; }
    let mut counts: std::collections::HashMap<[u8; 32], u32> = std::collections::HashMap::new();
    for action in &state.recent_actions {
        let triple = format!("{}|{}|{}", action.tool, action.input_summary, action.output_summary);
        let mut hasher = Sha256::new();
        hasher.update(triple.as_bytes());
        let h: [u8; 32] = hasher.finalize().into();
        *counts.entry(h).or_insert(0) += 1;
        if counts[&h] >= 3 { return true; }
    }
    false
}

fn detect_monologue_spiral(state: &LoopState, config: &ResilienceConfig) -> bool {
    state.consecutive_no_tool_turns >= config.monologue_threshold
}

fn detect_context_window_thrashing(state: &LoopState, config: &ResilienceConfig) -> bool {
    state.compactions_this_run >= config.compaction_thrash_threshold
}

fn detect_no_progress(state: &LoopState, config: &ResilienceConfig) -> bool {
    if state.iteration < config.no_progress_threshold { return false; }
    state.iteration.saturating_sub(state.last_progress_iteration) >= config.no_progress_threshold
}

fn detect_cost_runaway(state: &LoopState, _config: &ResilienceConfig) -> bool {
    if state.iteration < 3 { return false; }
    let avg = state.cumulative_cost_usd / state.iteration as f32;
    state.last_iter_cost > 2.0 * avg
}
```

### SessionWriter (Plan 34-NN — SESS-01)

```rust
// src-tauri/src/session/log.rs

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};
use fs2::FileExt;
use ulid::Ulid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallSnippet {
    pub name: String,
    pub args_excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum SessionEvent {
    SessionMeta {
        id: String,
        parent: Option<String>,
        fork_at_index: Option<u32>,
        started_at_ms: u64,
    },
    UserMessage { id: String, content: String, timestamp_ms: u64 },
    AssistantTurn {
        content: String,
        tool_calls: Vec<ToolCallSnippet>,
        stop_reason: Option<String>,
        tokens_in: u32,
        tokens_out: u32,
        timestamp_ms: u64,
    },
    ToolCall {
        name: String,
        args: serde_json::Value,
        result: Option<String>,
        error: Option<String>,
        timestamp_ms: u64,
    },
    CompactionBoundary {
        kept_message_count: u32,
        summary_first_chars: String,
        timestamp_ms: u64,
    },
    HaltReason { reason: String, payload: serde_json::Value, timestamp_ms: u64 },
    LoopEvent { kind: String, payload: serde_json::Value, timestamp_ms: u64 },
}

pub struct SessionWriter {
    path: PathBuf,
    enabled: bool,
}

impl SessionWriter {
    pub fn new(jsonl_log_dir: &Path, enabled: bool) -> std::io::Result<(Self, String)> {
        let id = Ulid::new().to_string();
        let path = jsonl_log_dir.join(format!("{}.jsonl", &id));
        if enabled {
            std::fs::create_dir_all(jsonl_log_dir)?;
        }
        Ok((Self { path, enabled }, id))
    }

    pub fn append(&self, event: &SessionEvent) {
        if !self.enabled { return; }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            #[cfg(test)]
            crate::session::log::SESS_FORCE_APPEND_PANIC.with(|p| {
                if p.get() { panic!("test-only induced panic in SessionWriter::append"); }
            });
            let line = serde_json::to_string(event)?;
            let mut f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?;
            f.lock_exclusive()?;
            f.write_all(line.as_bytes())?;
            f.write_all(b"\n")?;
            f.unlock()?;
            Ok::<(), std::io::Error>(())
        }));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => eprintln!("[SESS-01] append io error: {}", e),
            Err(_) => eprintln!("[SESS-01] append panicked; chat continues"),
        }
    }
}

#[cfg(test)]
thread_local! {
    pub(crate) static SESS_FORCE_APPEND_PANIC: std::cell::Cell<bool> = std::cell::Cell::new(false);
}
```

### Resume logic (Plan 34-NN — SESS-02)

```rust
// src-tauri/src/session/resume.rs

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use crate::providers::ConversationMessage;
use crate::session::log::SessionEvent;

pub struct ResumedConversation {
    pub session_id: String,
    pub messages: Vec<ConversationMessage>,
    pub last_compaction_boundary_at: Option<usize>,
}

pub fn load_session(path: &Path, session_id: &str) -> Result<ResumedConversation, String> {
    let f = File::open(path).map_err(|e| format!("open {}: {}", path.display(), e))?;
    let reader = BufReader::new(f);
    let mut events = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() { continue; }
        match serde_json::from_str::<SessionEvent>(&line) {
            Ok(e) => events.push(e),
            Err(e) => {
                eprintln!("[SESS-02] skip corrupt line: {}", e);
                continue;
            }
        }
    }

    // Find most-recent CompactionBoundary; everything BEFORE it collapses into
    // a synthetic [Earlier conversation summary] User message. Phase 32-04's
    // exact format string is reused.
    let last_boundary_idx = events.iter().rposition(|e|
        matches!(e, SessionEvent::CompactionBoundary { .. }));

    let mut messages = Vec::new();
    let start_idx = last_boundary_idx.map_or(0, |i| {
        if let SessionEvent::CompactionBoundary { summary_first_chars, .. } = &events[i] {
            messages.push(ConversationMessage::User(
                format!("[Earlier conversation summary]\n{}", summary_first_chars)
            ));
        }
        i + 1
    });

    for ev in &events[start_idx..] {
        match ev {
            SessionEvent::UserMessage { content, .. } =>
                messages.push(ConversationMessage::User(content.clone())),
            SessionEvent::AssistantTurn { content, .. } =>
                messages.push(ConversationMessage::Assistant {
                    content: content.clone(),
                    tool_calls: Vec::new(),  // tool_calls re-derive from ToolCall events if needed
                }),
            SessionEvent::ToolCall { name, result, error, .. } => {
                let content = result.clone().or_else(|| error.clone()).unwrap_or_default();
                messages.push(ConversationMessage::Tool {
                    tool_name: name.clone(),
                    content,
                    is_error: error.is_some(),
                });
            }
            // HaltReason / LoopEvent / CompactionBoundary / SessionMeta — not replayed
            _ => {}
        }
    }

    Ok(ResumedConversation {
        session_id: session_id.to_string(),
        messages,
        last_compaction_boundary_at: last_boundary_idx,
    })
}
```

### Session list + fork (Plan 34-NN — SESS-03 + SESS-04)

```rust
// src-tauri/src/session/list.rs

use serde::{Serialize, Deserialize};
use std::fs;
use ulid::Ulid;
use crate::session::log::SessionEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub started_at_ms: u64,
    pub message_count: u32,
    pub first_message_excerpt: String,
    pub approximate_tokens: u32,
    pub halt_reason: Option<String>,
    pub parent: Option<String>,
}

pub(crate) fn validate_session_id(id: &str) -> Result<(), String> {
    let re = regex::Regex::new(r"^[0-9A-HJKMNP-TV-Z]{26}$").unwrap();
    if !re.is_match(id) {
        return Err(format!("invalid session id: {}", id));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    let dir = crate::config::load_config().session.jsonl_log_dir.clone();
    if !dir.exists() { return Ok(Vec::new()); }
    let mut metas = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") { continue; }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if validate_session_id(&stem).is_err() { continue; }
        if let Some(meta) = read_meta(&path).ok().flatten() {
            metas.push(meta);
        }
    }
    metas.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
    Ok(metas)
}

#[tauri::command]
pub async fn resume_session(session_id: String) -> Result<crate::session::resume::ResumedConversation, String> {
    validate_session_id(&session_id)?;
    let dir = crate::config::load_config().session.jsonl_log_dir.clone();
    let path = dir.join(format!("{}.jsonl", &session_id));
    crate::session::resume::load_session(&path, &session_id)
}

#[tauri::command]
pub async fn fork_session(parent_id: String, fork_at_message_index: u32) -> Result<String, String> {
    validate_session_id(&parent_id)?;
    let dir = crate::config::load_config().session.jsonl_log_dir.clone();
    let parent_path = dir.join(format!("{}.jsonl", &parent_id));
    let new_id = Ulid::new().to_string();
    let new_path = dir.join(format!("{}.jsonl", &new_id));

    // Read parent, write events up to fork_at_message_index (counting
    // UserMessage + AssistantTurn only; CompactionBoundary / ToolCall pass through)
    let f = std::fs::File::open(&parent_path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(f);
    let mut out_lines = Vec::new();
    let mut msg_count = 0u32;
    use std::io::BufRead;

    let started_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let meta_event = SessionEvent::SessionMeta {
        id: new_id.clone(),
        parent: Some(parent_id.clone()),
        fork_at_index: Some(fork_at_message_index),
        started_at_ms: started_ms,
    };
    out_lines.push(serde_json::to_string(&meta_event).map_err(|e| e.to_string())?);

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() { continue; }
        if let Ok(ev) = serde_json::from_str::<SessionEvent>(&line) {
            match &ev {
                SessionEvent::UserMessage { .. } | SessionEvent::AssistantTurn { .. } => {
                    if msg_count >= fork_at_message_index { break; }
                    out_lines.push(line);
                    msg_count += 1;
                }
                SessionEvent::SessionMeta { .. } => continue, // skip parent's SessionMeta
                _ => out_lines.push(line),
            }
        }
    }

    let mut out = std::fs::File::create(&new_path).map_err(|e| e.to_string())?;
    use std::io::Write;
    for line in &out_lines {
        out.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        out.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    Ok(new_id)
}

#[tauri::command]
pub async fn get_conversation_cost(session_id: String) -> Result<serde_json::Value, String> {
    validate_session_id(&session_id)?;
    let cap = crate::config::load_config().resilience.cost_guard_per_conversation_dollars;
    // Read JSONL, sum cost from cost_update LoopEvent payloads' last value.
    // ... (omitted; straightforward)
    Ok(serde_json::json!({ "spent_usd": 0.0, "cap_usd": cap, "percent": 0.0 }))
}

fn read_meta(path: &std::path::Path) -> std::io::Result<Option<SessionMeta>> {
    use std::io::BufRead;
    let f = std::fs::File::open(path)?;
    let reader = std::io::BufReader::new(f);
    let mut id = String::new();
    let mut parent = None;
    let mut started_at_ms = 0u64;
    let mut first_message_excerpt = String::new();
    let mut message_count = 0u32;
    let mut approximate_tokens = 0u32;
    let mut halt_reason: Option<String> = None;
    for line in reader.lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        if let Ok(ev) = serde_json::from_str::<SessionEvent>(&line) {
            match ev {
                SessionEvent::SessionMeta { id: i, parent: p, started_at_ms: t, .. } => {
                    id = i; parent = p; started_at_ms = t;
                }
                SessionEvent::UserMessage { content, .. } => {
                    if first_message_excerpt.is_empty() {
                        first_message_excerpt = crate::safe_slice(&content, 120);
                    }
                    message_count += 1;
                }
                SessionEvent::AssistantTurn { tokens_in, tokens_out, .. } => {
                    message_count += 1;
                    approximate_tokens = approximate_tokens.saturating_add(tokens_in + tokens_out);
                }
                SessionEvent::HaltReason { reason, .. } => halt_reason = Some(reason),
                _ => {}
            }
        }
    }
    if id.is_empty() { return Ok(None); }
    Ok(Some(SessionMeta {
        id, started_at_ms, message_count, first_message_excerpt,
        approximate_tokens, halt_reason, parent,
    }))
}
```

### Provider fallback (Plan 34-NN — RES-05)

```rust
// src-tauri/src/resilience/fallback.rs

use crate::providers::{self, AssistantTurn, ConversationMessage, ToolDefinition};
use crate::config::BladeConfig;

#[derive(Debug)]
pub struct FallbackExhausted {
    pub chain_len: usize,
    pub last_error: String,
}

pub async fn try_with_fallback(
    config: &BladeConfig,
    conversation: &[ConversationMessage],
    tools: &[ToolDefinition],
    _app: &tauri::AppHandle,
) -> Result<AssistantTurn, FallbackExhausted> {
    let chain = &config.resilience.provider_fallback_chain;
    let mut last_error = String::new();

    for chain_elem in chain {
        let provider = if chain_elem == "primary" { config.provider.as_str() } else { chain_elem.as_str() };
        let model = providers::default_model_for(provider);
        let key = if provider == "ollama" { String::new() } else { crate::config::get_provider_key(provider) };
        if key.is_empty() && provider != "ollama" { continue; }

        for attempt in 0..=config.resilience.max_retries_per_provider {
            #[cfg(test)]
            {
                let forced = crate::resilience::fallback::RES_FORCE_PROVIDER_ERROR
                    .with(|c| c.borrow().clone());
                if let Some(e) = forced {
                    last_error = e;
                    continue;
                }
            }
            match providers::complete_turn(provider, &key, model, conversation, tools, None).await {
                Ok(t) => return Ok(t),
                Err(e) => {
                    last_error = e;
                    let delay_ms = (config.resilience.backoff_base_ms.saturating_mul(2u64.pow(attempt.min(8))))
                        .min(config.resilience.backoff_max_ms);
                    let jitter: u64 = (rand::random::<u64>()) % 200;
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms + jitter)).await;
                }
            }
        }
    }
    Err(FallbackExhausted { chain_len: chain.len(), last_error })
}

#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_PROVIDER_ERROR: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
}
```

### ActivityStrip event payload extension (Plan 34-NN frontend)

```typescript
// src/lib/events/payloads.ts — extend BladeLoopEventPayload

export type BladeLoopEventPayload =
  // existing variants from Phase 33
  | { kind: 'verification_fired'; verdict: 'YES' | 'NO' | 'REPLAN' }
  | { kind: 'replanning'; count: number }
  | { kind: 'token_escalated'; new_max: number }
  | { kind: 'halted'; reason: 'cost_exceeded' | 'iteration_cap'; spent_usd?: number; cap_usd?: number; scope?: 'PerLoop' | 'PerConversation' }
  // Phase 34 additions
  | { kind: 'stuck_detected'; pattern: 'RepeatedActionObservation' | 'MonologueSpiral' | 'ContextWindowThrashing' | 'NoProgress' | 'CostRunaway' }
  | { kind: 'circuit_open'; error_kind: string; attempts: number }
  | { kind: 'cost_warning'; percent: 80; spent_usd: number; cap_usd: number }
  | { kind: 'cost_update'; spent_usd: number; cap_usd: number; percent: number };
```

---

## Landmines (read-once, then re-read before planning)

1. **Six-place rule applied TWICE (resilience + session).** 16 fields × 6 places = 96 wire-up touch points. The plan must explicitly enumerate every grep marker — `grep -c "resilience: ResilienceConfig" config.rs ≥ 4`, `grep -c "session: SessionConfig" config.rs ≥ 4`, `grep -c "resilience: disk.resilience" config.rs == 1`, etc. Phase 33-01 had 6 grep markers for `r#loop`; Phase 34 substrate has 12 (6 per struct).

2. **`last_3_actions` rename + capacity bump is non-trivial.** 14 references across loop_engine.rs (verified via grep). Renaming to `recent_actions` + bumping capacity from 3 to 6 must touch every line. The CONTEXT lock §RES-01 explicitly authorises this rename: "Phase 33's `last_3_actions` field renames to `recent_actions: VecDeque<ActionRecord>`". A test that counts buffer items at 6 confirms the bump landed.

3. **`LoopHaltReason::CostExceeded` mutation is breaking.** The variant gains a `scope: CostScope` field. EVERY match arm in commands.rs and loop_engine.rs that destructures this variant must be updated. Plan 34-NN must grep `LoopHaltReason::CostExceeded` across the entire codebase before the change to enumerate the touch sites. As of master: at least 3 sites in commands.rs + 2 in loop_engine.rs. Add `scope: CostScope::PerLoop` to all existing constructors (preserves current semantics); the new per-conversation halt site uses `scope: CostScope::PerConversation`.

4. **JSONL atomic-append needs `flock` for lines > PIPE_BUF.** AssistantTurn content can exceed 4KB easily. Without flock, two concurrent SessionWriters writing to the same file (multi-window scenario, future) interleave at the byte level and corrupt JSON. Add `fs2 = "0.4"` to Cargo.toml; lock_exclusive() before write_all, unlock() after. The CONTEXT lock §SESS-01 says "fall back to advisory `flock` on Linux/macOS if a single event ever exceeds [PIPE_BUF]" — but unconditional flock is simpler and correct.

5. **ULID crate adds a small dep, but `getrandom` may already be in the tree.** The `ulid = "1"` crate depends on `rand = "0.8"` which depends on `getrandom = "0.2"`. `rand` is already in Cargo.lock (used by `try_with_fallback`'s jitter). Verify before adding. Alternative: hand-roll using `chrono::Utc::now().timestamp_millis()` + 80 bits from `rand::random::<u128>()` and Crockford-encode in 5 lines — but `ulid::Ulid::new().to_string()` is simpler.

6. **Tauri command name FLAT namespace.** Phase 34 adds 4 commands. Verify uniqueness BEFORE adding to `generate_handler!`: `grep -rn "fn list_sessions\b\|fn resume_session\b\|fn fork_session\b\|fn get_conversation_cost\b" /home/arnav/blade/src-tauri/src/`. Any hit is a collision; rename the new one (e.g. `session_list`).

7. **`SessionConfig.jsonl_log_dir: PathBuf` serialisation.** PathBuf serialises as `{ "jsonl_log_dir": "/Users/arnav/.config/blade/sessions" }` on macOS — absolute path. If a user copies their config.json to a different machine, this path is wrong. Mitigation: `default_jsonl_log_dir()` is computed at runtime via `blade_config_dir().join("sessions")`. The `#[serde(default = "default_jsonl_log_dir")]` ensures missing/null values fall back. **Don't** make the field optional — keep it explicit; just don't expect cross-machine portability of the saved config (which was never a goal).

8. **Resume-streaming-contract trap.** The MEMORY.md note: "every Rust streaming branch must emit `blade_message_start` before `chat_token`". `resume_session` does NOT stream; it returns a Vec<ConversationMessage> for the frontend to render synchronously. **Do NOT** add a `chat_token` emit loop in `resume_session` thinking it makes the chat "feel live" — that breaks the contract because there's no `blade_message_start` for replayed messages. Keep resume cold (frontend renders the full message list at once); the next live turn uses `send_message_stream_inline` which already honors the contract.

9. **`record_error(kind)` API widening is invasive.** The current signature is `record_error(kind: &str)`. RES-02 needs `(kind, provider, model, msg)` to populate `attempts_summary`. EVERY existing call site (≥7 in commands.rs) must be updated. Mitigation: keep `record_error(kind)` as a thin wrapper that calls a new `record_error_full(kind, provider, model, msg)` with empty defaults. Old call sites continue to work; new circuit-breaker plan uses the full form.

10. **`compress_conversation_smart` parameter widening for SessionWriter.** Today it takes `&mut Vec<ConversationMessage>, max_tokens, provider, api_key, model, base_url`. To write CompactionBoundary, it needs `Option<&mut SessionWriter>` (or a callback). Mitigation: don't write the boundary inside `compress_conversation_smart`; have the caller (commands.rs:1679) write it after the function returns Ok, reading the `summary` and message count from the post-compression conversation. Recommend: caller writes the boundary; compress fn unchanged. Simpler.

11. **The 5 stuck detectors must run in priority order, but tests need to inject specific verdicts.** RES_FORCE_STUCK seam at the top of `detect_stuck` short-circuits the priority walk. Tests set the seam to `Some(StuckPattern::MonologueSpiral)` and assert the loop halts with the `Stuck { pattern: "MonologueSpiral" }` reason — the priority order is irrelevant because the seam bypasses it. This mirrors LOOP_OVERRIDE in Phase 33-04.

12. **Validation of session_id before disk access.** `resume_session("../../etc/passwd")` would read /etc/passwd if validation is missing. The `validate_session_id` regex matches Crockford base32 ULID strings only (no `.`, `/`, `\`). Every Tauri command that takes a session_id parameter MUST call `validate_session_id` first.

13. **Forking past the end of a session.** `fork_session(id, 999)` where session has 10 messages should NOT silently produce an identical copy with `fork_at_index=999`; it should clamp to the actual message count. Mitigation: in `fork_session`, after copying events, store `fork_at_index = min(fork_at_message_index, msg_count)` in the SessionMeta event so the SessionsView shows the truthful index.

14. **Rotation race: an in-flight SessionWriter's file moves to archive/.** If `keep_n_sessions=100` and the user creates a 101st session, rotation fires — but the new session might be the one the rotation is moving (if rotation runs at SessionWriter::new). Mitigation: rotation runs ONLY at SessionWriter::new, BEFORE the new file is created (rotation considers existing files only); the new file is unaffected. Document the timing in the SessionWriter constructor.

15. **`detect_stuck` panic must not halt the loop.** Same CTX-07 discipline as verify_progress. Wrap the `detect_stuck` call site in run_loop with `std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| detect_stuck(state, config)))`. Synchronous (not a future), so no `futures::FutureExt` needed. Add a panic-injection regression test mirroring `phase33_loop_01_panic_in_render_actions_json_is_caught`.

16. **`RES_FORCE_PROVIDER_ERROR` thread_local seam — must be thread-safe + cfg-gated.** Tests set the seam; production has zero overhead. Mirror Phase 33's pattern: `#[cfg(test)] thread_local! { pub(crate) static RES_FORCE_PROVIDER_ERROR: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None); }`.

17. **The "ULID plus timestamp_ms" duplication.** SessionMeta carries `started_at_ms` AND the ULID prefix encodes a timestamp. The two should match within ms (they're set in the same call). Tests can assert `Ulid::from_string(&id).timestamp_ms() == started_at_ms`.

18. **`get_conversation_cost` reads JSONL on every call.** Cheap for small sessions; expensive for chat-input-meter polling. Mitigation: the chat UI subscribes to `cost_update` events for live updates and only calls the command on session load. The CONTEXT lock §RES-03 already says this — the planner must enforce.

19. **Empty `archive/` subdir after first rotation is a UX dead-end.** The CONTEXT lock §SESS-01: "Move, not delete". The first rotation creates `archive/` containing the oldest session. The SessionsView must NOT show archived sessions. `list_sessions` only walks the top-level dir, not `archive/`. Document explicitly.

20. **Operator-deferred UAT pattern (per Arnav's standing directive).** The final plan's `checkpoint:human-verify` task lists 14 UAT steps. The pattern from Phase 33-09 is "agent runs the static gates, screenshots saved, observation cited via Read, operator signs off". Phase 34's UAT is bigger — 14 steps, multiple toggles, file-system inspection. Plan 34-NN must enumerate each step's pass/fail criterion explicitly. Operator can defer the runtime portion — the plan must close to the boundary.

---

## Validation Architecture

### Phase 34 contributes ZERO new verify gates

CONTEXT lock §Testing & Verification: "verify:intelligence is Phase 37's responsibility (EVAL-05). Phase 34 keeps the existing 37 gates green and adds unit tests + 1-2 integration tests."

**What Phase 34 ships for validation:**
- **13 unit tests** — one per RES-01 pattern (5), one per remaining RES (4), one per SESS (4):
  - `phase34_res_01_repeated_action_observation`
  - `phase34_res_01_monologue_spiral`
  - `phase34_res_01_context_thrashing`
  - `phase34_res_01_no_progress`
  - `phase34_res_01_cost_runaway`
  - `phase34_res_02_circuit_breaker_threshold`
  - `phase34_res_03_per_conversation_cost_tracking`
  - `phase34_res_04_warn_at_80_halt_at_100`
  - `phase34_res_05_provider_fallback_chain_exhaustion`
  - `phase34_sess_01_jsonl_roundtrip`
  - `phase34_sess_02_resume_from_compaction_boundary`
  - `phase34_sess_03_list_sessions_metadata`
  - `phase34_sess_04_fork_preserves_history_up_to_index`
- **2 config round-trip tests** mirroring Phase 33-01: `phase34_resilience_config_round_trip`, `phase34_session_config_round_trip`.
- **1 smart-resilience-disabled regression test** asserting the loop runs without stuck/circuit/cost-warn/fallback when `smart_resilience_enabled = false`.
- **1 jsonl-log-disabled regression test** asserting `SessionWriter::append` is a silent no-op when `jsonl_log_enabled = false` (no file created in `jsonl_log_dir`).
- **1 panic-injection regression test for SessionWriter** mirroring Phase 33-09: `phase34_sess_01_panic_in_append_does_not_crash_chat`. Forces a panic via a `#[cfg(test)]` seam inside `SessionWriter::append`; asserts the surrounding code path continues.
- **1 panic-injection regression test for detect_stuck** mirroring Phase 33-09: `phase34_res_01_panic_in_detect_stuck_does_not_halt_loop`.
- **Integration test (light):** `phase34_session_writer_roundtrip_with_compaction_boundary` — write 3 user messages, 1 compaction boundary, 2 user messages, halt. Resume. Assert messages.len() corresponds to the post-boundary range + 1 synthetic summary message.

### Test seam pattern (mirror Phase 33)

```rust
// src-tauri/src/resilience/stuck.rs
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_STUCK: std::cell::Cell<Option<StuckPattern>> = std::cell::Cell::new(None);
}

// src-tauri/src/resilience/fallback.rs
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_PROVIDER_ERROR: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
}

// src-tauri/src/session/log.rs
#[cfg(test)]
thread_local! {
    pub(crate) static SESS_FORCE_APPEND_PANIC: std::cell::Cell<bool> = std::cell::Cell::new(false);
}
```

### Auto-Compact Threshold

Phase 34 inherits Phase 32 + Phase 33's compaction trigger verbatim. The new `compactions_this_run` counter increments per compaction call but does NOT alter the trigger threshold itself. ContextWindowThrashing fires at compaction count 3 — independent of which threshold caused each compaction.

### Test Strategy

| Test | Surface | Mechanism | Pass/Fail signal |
|------|---------|-----------|-----------------|
| `phase34_resilience_config_round_trip` | config.rs | Build BladeConfig with non-default resilience, round-trip serde | All 12 fields survive |
| `phase34_session_config_round_trip` | config.rs | Same for session | All 4 fields survive |
| `phase34_res_01_repeated_action_observation` | resilience/stuck.rs | Build LoopState with 3 same `(tool, args, result)` in recent_actions, call detect_stuck, expect Some(RepeatedActionObservation) | Pattern match |
| `phase34_res_01_monologue_spiral` | resilience/stuck.rs | LoopState with consecutive_no_tool_turns=5, call detect_stuck, expect Some(MonologueSpiral) | Pattern match |
| `phase34_res_01_context_thrashing` | resilience/stuck.rs | LoopState with compactions_this_run=3, expect Some(ContextWindowThrashing) | Pattern match |
| `phase34_res_01_no_progress` | resilience/stuck.rs | LoopState with iteration=10, last_progress_iteration=4, expect Some(NoProgress) | Pattern match |
| `phase34_res_01_cost_runaway` | resilience/stuck.rs | LoopState with cumulative=10, iteration=5 → avg=2.0, last_iter_cost=5.0 → fires | Pattern match |
| `phase34_res_01_priority_order` | resilience/stuck.rs | LoopState matching ALL five patterns, assert CostRunaway wins | Pattern match |
| `phase34_res_01_panic_in_detect_stuck_does_not_halt_loop` | loop_engine.rs | Force panic via test seam, wrap in catch_unwind, assert main loop continues | Boolean |
| `phase34_res_02_circuit_breaker_threshold` | commands.rs | Call record_error_full thrice with same kind, assert is_circuit_broken returns true; circuit_attempts_summary returns 3 entries | Count == 3 |
| `phase34_res_03_per_conversation_cost_tracking` | loop_engine.rs | Run 3 turns with known token counts, assert conversation_cumulative_cost_usd == sum of (in×price_in + out×price_out) / 1M | Float equality (epsilon 1e-3) |
| `phase34_res_04_warn_at_80_halt_at_100` | loop_engine.rs | Set cap=10, cumulative=8.0 → cost_warning_80_emitted toggles + event emits; cumulative=10.1 → halt with CostExceeded{scope: PerConversation} | Two assertions |
| `phase34_res_05_provider_fallback_chain_exhaustion` | resilience/fallback.rs | RES_FORCE_PROVIDER_ERROR set; call try_with_fallback with 3-element chain; assert FallbackExhausted with chain_len=3 | Match |
| `phase34_sess_01_jsonl_roundtrip` | session/log.rs | Construct each of 7 SessionEvent variants, append, read back, assert serde_json::Value structural equality | Equality |
| `phase34_sess_01_panic_in_append_does_not_crash_chat` | session/log.rs | Set SESS_FORCE_APPEND_PANIC=true, call append, assert no panic propagates | Boolean |
| `phase34_sess_02_resume_from_compaction_boundary` | session/resume.rs | Write [User, Assistant, CompactionBoundary, User, Assistant], call load_session, assert messages = [synthetic-summary, User, Assistant] | List equality |
| `phase34_sess_03_list_sessions_metadata` | session/list.rs | Write 3 sessions with known meta, call list_sessions, assert sorted desc by started_at_ms | Order check |
| `phase34_sess_04_fork_preserves_history_up_to_index` | session/list.rs | Write parent with 5 messages, fork at index 3, assert child JSONL has 3 messages + SessionMeta | Count check |
| `phase34_sess_validate_session_id_rejects_traversal` | session/list.rs | validate_session_id("../../etc/passwd"), assert Err | Boolean |
| `phase34_smart_resilience_disabled_no_smart_features` | loop_engine.rs | smart_resilience_enabled=false; force every stuck pattern + cost cap, assert loop runs through; only PerConversation 100% halt fires (data integrity) | Multi-assert |
| `phase34_jsonl_log_disabled_no_files_written` | session/log.rs | jsonl_log_enabled=false; call SessionWriter::new + append; assert no file in jsonl_log_dir | Filesystem check |
| Runtime UAT (Plan 34-NN) | Dev binary + SessionsView + ActivityStrip + chat-input cost meter | 14 steps from CONTEXT §Testing & Verification | Operator-checked |

---

## Plan Wave Recommendations

**Wave 1 (substrate; runs in parallel — 3 plans):**
- Plan 34-01 — `ResilienceConfig` + `SessionConfig` six-place wire-up (config.rs only; no behavior change). Mirrors Phase 33-01 structurally. 16 fields × 6 places = 96 touch points.
- Plan 34-02 — LoopState extension (rename last_3_actions → recent_actions, capacity 6; add 7 new fields) + LoopHaltReason extension (add Stuck, CircuitOpen variants; mutate CostExceeded with scope) + AttemptRecord struct + CostScope enum + sha2/ulid/fs2 Cargo.toml additions.
- Plan 34-03 — `mod resilience;` + `mod session;` skeleton in lib.rs; submodule files with empty bodies and module roots. SessionEvent enum declaration. No behavior; pure scaffolding so Wave 2/3 can `use` the types.

**Wave 2 (RES-01 + RES-02 — depends on Wave 1):**
- Plan 34-04 — RES-01 stuck detection: 5 detector functions + detect_stuck aggregator + RES_FORCE_STUCK seam + catch_unwind wrapper at run_loop call site + 5 unit tests + priority-order test + panic-injection regression. Wires `detect_stuck` into run_loop iteration top.
- Plan 34-05 — RES-02 circuit breaker: widen `record_error` to capture (kind, provider, model, msg, ts_ms); add `circuit_attempts_summary`; wire `LoopHaltReason::CircuitOpen { error_kind, attempts_summary }` halt at run_loop's error-recovery branches; clear_error_history on success.

**Wave 3 (RES-03 + RES-04 + RES-05 — depends on Wave 1; independent of Wave 2):**
- Plan 34-06 — RES-03 + RES-04: `conversation_cumulative_cost_usd` accumulation + cost_warning_80 latch + halt-at-100 (PerConversation scope) + `get_conversation_cost` Tauri command + `cost_update` blade_loop_event emit each iteration.
- Plan 34-07 — RES-05 provider fallback: `resilience/fallback.rs::try_with_fallback` + exponential backoff with jitter + `default_model_for(provider)` helper + `RES_FORCE_PROVIDER_ERROR` seam + 1 unit test for chain exhaustion + deprecated alias for `try_free_model_fallback`.

**Wave 4 (SESS-01 + SESS-02 — depends on Wave 1):**
- Plan 34-08 — SESS-01: `session/log.rs::SessionWriter` + 7 SessionEvent variants + flock-protected append + ULID generation + rotation policy at keep_n_sessions=100 → archive/ + SESS_FORCE_APPEND_PANIC seam + JSONL roundtrip test + panic-injection test + jsonl-log-disabled regression test. Wire SessionWriter into commands::send_message_stream_inline at the 5 emit boundaries.
- Plan 34-09 — SESS-02: `session/resume.rs::load_session` + `[Earlier conversation summary]` reuse + `resume_session` Tauri command + auto_resume_last on app boot + corrupt-line skip discipline + integration test (write → resume → assert messages).

**Wave 5 (SESS-03 + SESS-04 + close — depends on Waves 1-4):**
- Plan 34-10 — SESS-03 + SESS-04 backend: `list_sessions` + `fork_session` + `validate_session_id` regex validator + path-traversal regression test + halt_reason extraction from JSONL + halt_reason population in SessionMeta. 4 Tauri commands appended to `generate_handler!`.
- Plan 34-11 — SESS-03 frontend + ActivityStrip + cost meter + close: `BladeLoopEventPayload` extensions in payloads.ts (4 new variants) + ActivityStrip chip switch extension + SessionsView at `src/features/sessions/SessionsView.tsx` + 3-place route registration + chat-input cost-meter chip + typed wrappers in `src/lib/tauri/sessions.ts` + 14-step runtime UAT under `checkpoint:human-verify`. Final plan; closes Phase 34.

This is 11 plans across 5 waves. Matches the CONTEXT lock §Specifics: "Phase 34 is bigger than Phase 33 (9 reqs vs 6). Suggest 9-11 plans across 4-5 waves."

The smart-resilience-disabled regression test lives in Plan 34-04 (where stuck detection lands — the most pattern-rich gate). The jsonl-log-disabled regression test lives in Plan 34-08 (where SessionWriter lands). Both are required by CONTEXT lock §Testing & Verification.

---

*Phase: 34-resilience-session*
*Research compiled 2026-05-06 inline (no spawned subagent — same-process synthesis from CONTEXT lock + Phase 33 reference + codebase grounding + external pattern citations). All locked decisions traceable to 34-CONTEXT.md; all code anchors verified via grep at the listed file:line targets.*
