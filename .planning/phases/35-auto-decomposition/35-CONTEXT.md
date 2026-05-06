# Phase 35: Auto-Decomposition — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** Synthesised directly from ROADMAP.md, REQUIREMENTS.md, PROJECT.md, CLAUDE.md, the Phase 34 closure (34-11-SUMMARY.md), Phase 33 closure (33-CONTEXT.md), Phase 32 patterns, and codebase grounding (autonomous decisions per Arnav's instruction; no interactive discuss-phase)

<domain>
## Phase Boundary

**What this phase delivers:**
The Phase 33 `loop_engine::run_loop` driver and Phase 34 `SessionWriter` / `fork_session` substrate gain an *outer* fan-out layer: when the brain planner detects a query implies 5+ independent steps, the loop dispatches them as parallel sub-agents instead of running them sequentially. Each sub-agent runs in full isolation — its own `LoopState`, its own `SessionWriter` (forked from the parent at the decomposition point so the JSONL parentage is preserved), its own per-conversation cost rollup that bubbles up to the parent's `conversation_cumulative_cost_usd`, its own compaction cycle. When a sub-agent halts, a single 1-paragraph (≤ 800 token) summary is distilled and injected into the parent's conversation as one synthetic AssistantTurn — the sub-agent's full conversation lives only in its own JSONL, browsable via SessionsView. The user watches sub-agent progress stream into chat via three new `blade_loop_event` discriminants (`subagent_started`, `subagent_progress`, `subagent_complete`), routed through ActivityStrip's existing chip pipeline. SessionsView's "Branch" action gains a paired "Merge back" semantic so a tangent fork can fold its summary into the parent timeline. The whole DECOMP path falls back silently when `auto_decompose_enabled = false`.

**What this phase does NOT touch:**
- Phase 32 selective injection / compaction / tool-output cap (already shipped — Phase 35 *consumes* compaction inside each sub-agent loop but does not re-author it)
- Phase 33 loop driver structure (LoopState, LoopHaltReason, ToolError, run_loop) — Phase 35 *creates one LoopState per sub-agent* via the existing `LoopState::default()` ctor; the iteration body itself is untouched
- Phase 34 stuck detection / circuit breaker / cost guard / fallback chain — each sub-agent's loop carries the full Phase 33+34 surface; Phase 35 is the orchestrator above run_loop, not inside it
- Phase 34 SessionWriter / SessionEvent / fork_session — Phase 35 *uses* fork_session as the persistence substrate for sub-agent JSONLs; the SessionEvent enum and emit paths are not extended
- Existing `swarm.rs` DAG infrastructure (637 lines) — Phase 35 *reuses* SwarmTask / SwarmStatus / resolve_ready_tasks / get_swarm_progress as the dispatch mechanism; the swarm DB layout, scratchpad, and 5-concurrent cap stay
- `agents/mod.rs` 8 AgentRoles (Researcher, Coder, Analyst, Writer, Reviewer, SecurityRecon, SecurityAnalyst, SecurityAuditor) and `agents/executor.rs` step execution — Phase 35 *selects* a role per StepGroup heuristically and *invokes* the existing executor; no new role added
- Recursive decomposition (sub-agent triggering its own decomposition) — current scope: 1-level deep
- Cross-sub-agent shared state / handoff — current scope: parallel + independent (each sub-agent reads its parent's pre-decomposition history; siblings do not share live state)
- Sub-agent failure recovery / re-run — current scope: a failed sub-agent halts the whole DAG with structured reason; partial-completion replay is v1.6+
- Smart agent-role selection ML — current scope: heuristic from step text (verbs + file extensions + project nouns); ML scoring is v1.6+
- Distributed sub-agent execution across machines — current scope: local single-process tokio tasks
- Auto-merge of fork timeline edits back into parent JSONL — fork_session's parent attribution stays one-way; the "merge-back" action injects the SUMMARY only, not the fork's per-message events
- `verify:intelligence` gate (EVAL-05) — Phase 37
- INTEL-01..06 / repo map / capability registry / @context-anchor — Phase 36

**Why this is the parallelism layer of v1.5:**
Phase 32 made the prompt sane. Phase 33 made the loop sane. Phase 34 made the loop survivable. Phase 35 makes the loop *parallel* — without it, every multi-step task serialises through one LoopState and exhausts one context window. The existing swarm infrastructure proves the dispatch mechanics work (DAG validation, scratchpad merging, 5-concurrent execution); Phase 35 wires it to the natural agentic-loop trigger so users do not have to *explicitly* invoke /swarm. Phase 37's eval gate (EVAL-01 multi-step task completion benchmark) cannot score parallel decomposition until DECOMP-01..05 ship. Phase 38's close-out cannot claim "BLADE auto-decomposes" until the brain planner detects the threshold and the parent conversation receives only summaries. The 5 DECOMP requirements close the v1.5 cognition story.

</domain>

<decisions>
## Implementation Decisions

### DecompositionConfig Sub-Struct (Module Boundary + 6-place Wire-up)

- **Locked: New `BladeConfig.decomposition: DecompositionConfig` sub-struct in `config.rs`.** Mirrors Phase 32's `ContextConfig`, Phase 33's `LoopConfig`, Phase 34's `ResilienceConfig` + `SessionConfig` placement. Six-place rule applies to every field per CLAUDE.md (DiskConfig struct, DiskConfig::default, BladeConfig struct, BladeConfig::default, load_config, save_config). Don't try to remember the six places from memory — copy the diff Phase 34-01 used for `ResilienceConfig` and adapt every line.
- **Locked: Five fields with locked defaults.**
  ```rust
  pub struct DecompositionConfig {
      pub auto_decompose_enabled: bool,            // default true; CTX-07-style escape hatch
      pub min_steps_to_decompose: u32,             // default 5; DECOMP-01 threshold
      pub max_parallel_subagents: u32,             // default 3; rate limiter — don't spawn 50
      pub subagent_isolation: bool,                // default true; DECOMP-02
      pub subagent_summary_max_tokens: u32,        // default 800; DECOMP-03 cap on summary returned to parent
  }
  ```
- **Locked: `max_parallel_subagents` default = 3, NOT 5.** The existing swarm.rs::resolve_ready_tasks caps concurrency at 5; DECOMP defaults *lower* than the swarm cap so brain-planner-triggered decomposition leaves headroom for explicit /swarm invocations and for sibling concurrency that is unintentional. The runtime check uses `min(decomposition.max_parallel_subagents, 5)` so a misconfigured 50 cannot exceed the swarm cap.
- **Locked: When `auto_decompose_enabled = false`, every DECOMP code path is bypassed.** No step counter, no fork_session per sub-agent, no swarm dispatch, no summary distillation. Tasks run sequentially in `run_loop` exactly as Phase 33 + 34 ship them. Mirrors Phase 32 / 33 / 34 escape-hatch pattern (CTX-07 → smart_loop_enabled → smart_resilience_enabled → jsonl_log_enabled → auto_decompose_enabled, the fifth application of the v1.1 lesson).
- **Claude's discretion:** Whether to add a `subagent_default_provider: Option<String>` knob for v1 (override the parent's provider per sub-agent). Recommend NO — the role-based selection (Researcher → cheap, Coder → quality) is more useful and is encoded in `select_provider_for_task` already (swarm_commands.rs:39); a per-config override fragments routing. Defer to v1.6.

### Brain Planner Step Counter (DECOMP-01)

- **Locked: New `pub fn count_independent_steps(query: &str) -> u32` in `decomposition/planner.rs`.** Extends the existing heuristic in `commands.rs:671::count_task_steps` (which today returns `usize` based on connector + verb counts). DECOMP-01's variant returns a u32 and goes further: it groups verb mentions into *independent* clusters using three independence heuristics:
  1. **Distinct verb groups** — the existing connector + verb tally; e.g. "find X and summarize Y" = 2 verb groups.
  2. **Distinct file/project nouns** — count unique file paths (regex `\b[\w./-]+\.\w+\b`), unique repo names (heuristic: `\bthe-\w+\b` or capitalized multi-word noun phrases), unique URLs.
  3. **Distinct tool families needed** — keyword-map: bash/shell/run → `bash`; read/cat/show → `read_file`; search/grep/find → `search`; web/fetch/curl → `web_fetch`; write/save/create → `write_file`. A query that touches ≥3 distinct tool families counts each family as a step.
- **Locked: The function returns `max(verb_groups, file_groups, tool_families)`.** A 5-step task by ANY of the three independence axes triggers decomposition. Avoids both undercount (one verb covering many files) and overcount (many verbs on one target).
- **Locked: When `count_independent_steps(query) >= config.decomposition.min_steps_to_decompose`, the planner returns `Some(StepGroups)`.** Below the threshold, it returns `None` and the loop runs sequentially. The threshold is configurable; 5 is the locked default per ROADMAP/REQUIREMENTS DECOMP-01 verbatim.
- **Locked: `StepGroup` struct shape.**
  ```rust
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct StepGroup {
      pub step_index: u32,
      pub goal: String,                  // safe_slice'd to 500 chars
      pub role: AgentRole,               // heuristic-selected (see below)
      pub depends_on: Vec<u32>,          // by step_index — empty for independent
      pub estimated_duration: String,    // "fast" | "medium" | "slow"
  }
  ```
- **Locked: Role selection heuristic** — pure text match against the step's goal. Code-shaped (writes/edits a file, mentions a function, fixes a bug) → Coder. Research-shaped (fetches/reads/finds/searches/looks up) → Researcher. Analysis-shaped (compares/computes/summarizes/decides) → Analyst. Documentation-shaped (writes a doc/email/report) → Writer. Verification-shaped (tests/reviews/audits) → Reviewer. Default fallback → Researcher (broadest tool footprint, cheap model). The existing `agents/mod.rs::AgentRole::preferred_tool_patterns()` covers downstream tool filtering — DECOMP-01 only needs the role enum.
- **Locked: When `auto_decompose_enabled = false` OR `count_independent_steps < min_steps_to_decompose`, return `None` and fall through to the legacy sequential loop.** No partial decomposition (e.g., decompose just steps 1-3 if 4-5 are dependent). Either fully decomposed or fully sequential — keeps the runtime branch simple. Phase 36 may revisit if INTEL findings argue for partial fan-out.
- **Locked: Step-counter call site is the top of `run_loop` BEFORE iteration 0.** Per Phase 33's CONTEXT lock (verify_progress fires at iteration top), DECOMP-01 fires at iteration -1 (pre-loop). The check happens once per user turn, NOT once per iteration. If the user follows up mid-conversation with a complex multi-step query, that turn's `last_user_text` is re-evaluated.
- **Locked: `count_independent_steps` is wrapped in `AssertUnwindSafe(...).catch_unwind()`** per Phase 32-07 + 33-09 + 34-04 fallback discipline. A panic logs `[DECOMP-01]` and the loop falls back to sequential. This is the v1.1 lesson, sixth application: smart path must not crash chat.
- **Locked: `DECOMP_FORCE_STEP_COUNT: thread_local! Cell<Option<u32>>` test seam** mirrors Phase 33's `LOOP_OVERRIDE` and Phase 34's `RES_FORCE_STUCK` / `RES_FORCE_PROVIDER_ERROR`. Tests inject a step count without setting up real complex queries. Production builds carry zero overhead via `#[cfg(test)]`.
- **Claude's discretion:** Whether to also call into the existing `brain_planner::plan_task` (which makes a real LLM call to produce a structured plan) before decomposing. Recommend NO for v1 — the heuristic is sub-second; an LLM planning pass adds 1-3 seconds of latency to every chat turn. The model already plans inside the loop; DECOMP-01's job is *just to detect the threshold*, not to produce the plan. v1.6 may augment with a cheap-model planner if heuristic accuracy proves limiting.

### Sub-Agent Spawn + Swarm Trigger (DECOMP-02)

- **Locked: New module `src-tauri/src/decomposition/` with submodules `planner.rs`, `executor.rs`, `summary.rs`, plus `mod.rs` root.** `mod decomposition;` in `lib.rs`. Submodule layout:
  ```
  src-tauri/src/decomposition/
    mod.rs         // module root, re-exports DecompositionConfig accessor + StepGroup
    planner.rs     // count_independent_steps + StepGroup + role-selection heuristic
    executor.rs    // execute_decomposed_task — orchestrates fork_session per step + invokes existing swarm
    summary.rs     // distill_subagent_summary — sub-agent → parent 1-paragraph summary
  ```
- **Locked: New `pub async fn execute_decomposed_task(parent_session_id: &str, parent_state: &mut LoopState, groups: Vec<StepGroup>, app: &AppHandle, config: &BladeConfig) -> Result<Vec<SubagentSummary>, DecompositionError>`** in `decomposition/executor.rs`. This is the orchestrator that runs in place of the iteration body when DECOMP-01 fires. Returns a vec of summaries (one per StepGroup), which the caller injects into the parent conversation.
- **Locked: Per-sub-agent isolation is achieved via 4 separate substrates.** Each sub-agent gets:
  1. A **fresh `LoopState::default()`** — its own iteration count, its own `cumulative_cost_usd` (per-loop), its own `replans_this_run`, its own ring buffer. This is the Phase 33 + 34 LoopState surface verbatim, just instantiated per sub-agent. The parent's LoopState stays untouched.
  2. A **forked SessionWriter via `session::list::fork_session(parent_session_id, fork_at = parent_msg_count)`** — Phase 34 SESS-04 already exists and produces a new ULID JSONL with parent attribution. DECOMP-02 reuses it directly. The sub-agent writes ALL its events (UserMessage, AssistantTurn, ToolCall, CompactionBoundary, HaltReason, LoopEvent) to its own JSONL.
  3. An **own compaction cycle** — Phase 32's `compress_conversation_smart` is called from each sub-agent's `run_loop` invocation when its conversation hits the trigger (already wired via Phase 32-04's per-model trigger). Sub-agent compaction summary stays in sub-agent JSONL only.
  4. A **per-sub-agent provider selection** — defaults to parent's `BladeConfig.provider`, but role-based override applies via the existing `swarm_commands.rs:39::select_provider_for_task` helper (Researcher → fast/cheap provider for breadth; Coder → quality provider for precision). DECOMP-02 reuses this function unchanged.
- **Locked: Per-sub-agent cost rolls up to parent's `conversation_cumulative_cost_usd`.** When a sub-agent's `run_loop` returns, its final `cumulative_cost_usd` (per-loop = whole sub-agent run, since each sub-agent runs one user-turn equivalent) is *added* to `parent_state.conversation_cumulative_cost_usd`. The Phase 34 RES-04 100% halt latch checks the parent's running total at the end of each sub-agent completion — if the sub-agent put us over cap, *no further sub-agents spawn*, and the parent halts with `LoopHaltReason::CostExceeded { scope: PerConversation }`. Already-running siblings finish their iteration and return their summaries; future siblings are skipped.
- **Locked: Swarm dispatch via existing `swarm.rs` infrastructure.** DECOMP-02 transforms the `Vec<StepGroup>` into a swarm:
  - Build a `Swarm` with goal = parent's `last_user_text`, status = Planning, ULID id.
  - For each StepGroup, build a `SwarmTask { id: format!("step_{}", step_index), goal, role, depends_on, ... }`.
  - Validate via `swarm::validate_dag` — reject cycles before spawning.
  - Call into existing `swarm_commands::spawn_task_agent` for each ready task (resolve_ready_tasks already caps concurrency).
  - **Override the agent-spawn path so each agent gets its own forked SessionWriter + LoopState.** This is the Phase 35-specific extension to swarm: a new helper `decomposition::executor::spawn_isolated_subagent(task, swarm, parent_session_id, parent_msg_count, mcp, app)` wraps the existing spawn_task_agent and inserts the fork_session + fresh LoopState plumbing.
- **Locked: When `subagent_isolation = false`, sub-agents share the parent's LoopState and SessionWriter.** Debug-only flag — locked because RES-04 cost cap and SESS-01 attribution become inseparable from the parent. Documented in CONFIG comment as "DEBUG ONLY — disable only for tracing decomposition; sub-agent costs no longer roll up correctly when shared, and the parent JSONL inflates with per-sub-agent events." Phase 35 ships the flag for diagnostic flexibility but every UAT exercises `subagent_isolation = true`.
- **Locked: A panic in any sub-agent's `run_loop` is caught by `AssertUnwindSafe(...).catch_unwind()` at the spawn boundary.** The sub-agent's task is marked Failed in the swarm DB; siblings continue. Parent receives a SubagentSummary with `success: false` and the panic message safe_slice'd to 500 chars. Mirrors the Phase 33-09 / 34-04 panic discipline.
- **Claude's discretion:** Whether to share the parent's MCP tool snapshot via `Arc<...>` or take a fresh snapshot per sub-agent. Recommend Arc — MCP tool registry rarely changes mid-turn; a shared snapshot saves N×500ms of MCP enumeration. The existing `swarm_commands.rs:43-46` takes a fresh snapshot per task — keep that behavior unchanged for swarm, but DECOMP-02's spawn helper hoists the snapshot once per decomposition cycle.

### Summary Distillation (DECOMP-03)

- **Locked: New `pub async fn distill_subagent_summary(subagent_session_id: &str, role: AgentRole, config: &BladeConfig) -> Result<SubagentSummary, String>` in `decomposition/summary.rs`.** Reads the sub-agent's JSONL via `session::resume::load_session` (Phase 34 SESS-02), then runs a final cheap-model pass with a fixed prompt:
  > "You are summarizing a sub-agent's work. The agent's role was {role}. Below is the agent's full conversation. Produce ONE paragraph (≤ {max_tokens} tokens) that captures: (1) the outcome — did the agent succeed or fail; (2) key facts found / files touched / decisions made; (3) any next-step recommendations for the parent agent. Do NOT include filler or preamble."
  Token cap from `config.decomposition.subagent_summary_max_tokens` (default 800).
- **Locked: Cheap-model selection via existing `cheap_model_for_provider(provider, model)`** (Phase 32-04 helper). Reuses the same path Phase 32's compaction summary uses — same function, same posture.
- **Locked: `SubagentSummary` shape**:
  ```rust
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct SubagentSummary {
      pub step_index: u32,
      pub subagent_session_id: String,        // ULID — drillable via SessionsView
      pub role: String,                       // AgentRole.as_str()
      pub success: bool,
      pub summary_text: String,               // safe_slice'd to subagent_summary_max_tokens × 4 chars (rough token→char approximation)
      pub tokens_used: u32,                   // sum of tokens_in + tokens_out for this sub-agent
      pub cost_usd: f32,                      // sub-agent's per-loop cumulative cost
  }
  ```
- **Locked: Summary returns to parent as ONE synthetic AssistantTurn-shaped ConversationMessage.** Format:
  ```
  [Sub-agent summary — step {step_index}, {role}, session {subagent_session_id[..8]}…]
  {summary_text}

  (success={success}, tokens={tokens_used}, cost=${cost_usd:.4f}; full conversation in session {subagent_session_id})
  ```
  This format mirrors Phase 32-04's `[Earlier conversation summary]` pattern — a synthetic message in the conversation Vec, not a special enum variant. Reuses the existing message infrastructure.
- **Locked: Parent's conversation token count INCREASES by only the summary length** (≤ subagent_summary_max_tokens × N sub-agents). For 3 sub-agents at 800 tokens each, that's ≤2.4k tokens of inflation — vs. ~50k+ if each sub-agent's full conversation rolled in. This is the DECOMP-03 success criterion's quantitative claim.
- **Locked: Summary distillation runs SERIALLY after each sub-agent halts**, not in parallel. The cheap-model pass is sub-second; running them sequentially keeps the parent conversation order deterministic (step 1 summary appears before step 2 summary, regardless of which sub-agent finished first).
- **Locked: When summary distillation fails (cheap model unavailable, parse error, panic), fall back to a heuristic 200-char summary** = `safe_slice(last_assistant_turn_content, 200)` from the sub-agent's JSONL. Wrapped in `catch_unwind`. This is the v1.1 fallback discipline — never crash chat.
- **Claude's discretion:** Whether to also include the sub-agent's halt reason in the summary header (e.g. "halted: cost cap"). Recommend yes when `success = false` — gives the parent agent + user immediate diagnostic context. Skip when `success = true` (clutter).

### Conversation Forking + Merge-Back (DECOMP-04)

- **Locked: Phase 34 SESS-04's `fork_session(parent_id, fork_at_message_index)` is the substrate.** It already creates a new JSONL with parent attribution, copies events up to the cut, and prepends a fresh SessionMeta. DECOMP-04 does NOT modify fork_session — it adds the *merge-back* semantic on top.
- **Locked: New Tauri command `merge_fork_back(fork_id: String) -> Result<MergeResult, String>` in `session/list.rs`.** When invoked:
  1. Validate `fork_id` via existing `validate_session_id` (Phase 34 SESS-04 hardening).
  2. Read the fork's JSONL; extract its `parent` from SessionMeta event.
  3. If `parent.is_none()`, return `Err("session is not a fork — cannot merge back")`.
  4. Run `decomposition::summary::distill_subagent_summary(fork_id, AgentRole::Analyst, config)` to produce a SubagentSummary. The role is `Analyst` (vs. step-execution Coder/Researcher/etc.) — the merge-back distillation summarizes a *user's branch exploration*, which is structurally analytical.
  5. Open the parent's JSONL, append a `LoopEvent { kind: "fork_merged", payload: {fork_id, summary_text}, timestamp_ms: now() }` AND a synthetic `UserMessage { id, content: "[Branch merged from fork {fork_id[..8]}…] {summary_text}", timestamp_ms: now() }`. The UserMessage shape lets the parent's next turn see the merged content as conversation history.
  6. Return `MergeResult { fork_id, parent_id, summary_text }`.
- **Locked: Merge-back is EXPLICIT user action.** No auto-merge on fork halt. The user clicks "Merge back" in SessionsView; the Tauri command fires; the parent JSONL gains the synthetic message. Phase 34's "explicit user action is the safer default" discipline (Phase 34 SESS-02 auto_resume_last default = false) extends here.
- **Locked: Fork's own JSONL is NOT deleted on merge.** The fork remains browsable in SessionsView with `parent` attribution; merge-back is additive only. Users can fork-then-merge multiple times; each merge appends a new synthetic UserMessage to the parent. v1.6+ may add an "archive on merge" option.
- **Locked: Frontend SessionsView.tsx (Phase 34) gains a "Merge back" action button per row.** The button is *visible only when the row's session has a `parent` attribute* (i.e., the row is a fork). Clicking opens a confirm modal: "Merge this fork's summary back into [parent's first_message_excerpt]? This appends a synthetic message to the parent." On confirm, calls `mergeForkBack(fork_id)` (new typed wrapper in `src/lib/tauri/sessions.ts`); on success, refresh the list and show a toast "Merged into parent — open parent to see the merged summary."
- **Locked: NO frontend visualization of the fork→merge graph in this phase.** SessionsView shows the linear list with parent attribution only. A DAG visualization is a v1.6 polish per Phase 34's deferred ideas.
- **Claude's discretion:** Whether the Merge-back action also auto-routes the user to the parent session in chat after merging (so they immediately see the merged summary). Recommend YES — it's the natural workflow; the toast suggests it but auto-routing reduces clicks.

### Progress Visibility (DECOMP-05)

- **Locked: Three new `BladeLoopEventPayload` discriminants extend the existing union at `src/lib/events/payloads.ts`:**
  ```typescript
  | { kind: 'subagent_started'; step_index: number; role: string; goal_excerpt: string }
  | { kind: 'subagent_progress'; step_index: number; status: 'running' | 'tool_call' | 'compacting' | 'verifying'; detail?: string }
  | { kind: 'subagent_complete'; step_index: number; success: boolean; summary_excerpt: string; subagent_session_id: string }
  ```
- **Locked: Rust emit sites.**
  - `subagent_started` fires from `decomposition::executor::spawn_isolated_subagent` immediately after the fork_session call succeeds and BEFORE the sub-agent's `run_loop` is invoked.
  - `subagent_progress` fires from inside the sub-agent's `run_loop` at iteration boundaries (status="running" with iteration count in detail), at tool-call dispatch (status="tool_call" with tool name in detail), at compaction boundary (status="compacting"), and at verification probe (status="verifying"). To avoid emit-flooding, status="running" emits at most every 3 iterations (matches the LOOP-01 verify cadence).
  - `subagent_complete` fires from `decomposition::executor::execute_decomposed_task` after each sub-agent's summary is distilled, just before the summary is appended to the parent's conversation. `summary_excerpt` is `safe_slice(summary_text, 120)`.
- **Locked: ActivityStrip chip mappings (short labels):**
  - `subagent_started` → `"sub-agent {step_index}: {role} — started"` (e.g. `"sub-agent 1: coder — started"`)
  - `subagent_progress` → `"sub-agent {step_index}: {status}"` (e.g. `"sub-agent 1: tool_call"`) — high-frequency, applies the same early-return-vs-chip discipline as Phase 34 `cost_update`. Recommend chip rendering ONLY for `compacting` and `verifying` statuses; `running` and `tool_call` statuses are throttled to ≤1 chip per 3 seconds per step_index via existing toast-fade timing.
  - `subagent_complete` → `"sub-agent {step_index}: ✓ {summary_excerpt}"` if success, `"sub-agent {step_index}: ✗ failed"` if not. (No bespoke icon system; reuse existing chip styling.)
- **Locked: ChatComposer / message stream surfaces sub-agent summaries inline.** When a `subagent_complete` event fires, the synthetic AssistantTurn from Step DECOMP-03 has already been injected into the conversation by the time the parent loop emits its next `chat_token`. The user sees the summary text rendered as a normal assistant message, prefixed with the `[Sub-agent summary — step N…]` marker. Reuses existing chat rendering — no new component.
- **Locked: Frontend typed wrappers added to `src/lib/tauri/sessions.ts`** (existing file from Phase 34): `mergeForkBack(forkId: string): Promise<MergeResult>`. Three event-payload types added to `BladeLoopEventPayload` union.
- **Claude's discretion:** Whether to render an inline "Sub-agent N working…" placeholder bubble in the chat surface (vs. only ActivityStrip chips) for in-flight sub-agents. Recommend yes for v1 — chat-first pivot makes the chat surface the canonical visibility plane; ActivityStrip alone could miss a glance. Implementation: a new lightweight `<SubagentProgressBubble step={N} status={status} />` component that subscribes to `subagent_progress` events, renders inline above the next assistant message, and removes itself on `subagent_complete`. Reuse existing chat bubble styling.

### Backward Compatibility (Auto-Decompose Toggle)

- **Locked: One new kill switch: `DecompositionConfig.auto_decompose_enabled: bool` (default `true`).** When false:
  - `count_independent_steps` is never called (skipped at the top of run_loop).
  - `execute_decomposed_task` is never invoked.
  - `merge_fork_back` Tauri command still works (frontend can fork + merge manually via SessionsView), but no auto-decomposition fires from chat.
  - All subagent_* events are never emitted.
  - The existing `swarm.rs` /swarm command path remains fully functional — DECOMP's toggle does not affect explicit /swarm invocations.
- **Locked: Stuck detection (Phase 34 RES-01) and cost guard (Phase 34 RES-04) still apply WHEN DECOMP IS ON.** Each sub-agent's loop has its own RES-01..05 surface. The parent's RES-04 100% halt latch fires on the rolled-up `conversation_cumulative_cost_usd` after each sub-agent completion (DECOMP-02 lock). When DECOMP IS OFF, RES-01..05 apply to the single sequential loop as Phase 34 ships them — no change.
- **Locked: This mirrors Phase 32's `context.smart_injection_enabled`, Phase 33's `loop.smart_loop_enabled`, Phase 34's `resilience.smart_resilience_enabled` + `session.jsonl_log_enabled` escape hatches.** Same v1.1 lesson, sixth application.
- **Claude's discretion:** Whether to auto-disable DECOMP if the parent's `conversation_cumulative_cost_usd > 0.8 × cost_guard_per_conversation_dollars` at the trigger point (avoid spawning a 5-sub-agent fan-out when the budget is nearly exhausted). Recommend YES — it's a defensible auto-degrade. Implementation: at the top of `count_independent_steps` consumer in run_loop, check the parent's cost first; if > 80%, log `[DECOMP-01] declined: budget at {percent}%` and fall through to sequential. Documented as a sub-rule of `auto_decompose_enabled`.

### Module Boundaries

- **Locked: New top-level Rust module `src-tauri/src/decomposition/`.** Declared via `mod decomposition;` in `lib.rs`. Submodule layout (already locked above):
  ```
  src-tauri/src/decomposition/
    mod.rs         // module root, re-exports
    planner.rs     // count_independent_steps + StepGroup + role-selection heuristic
    executor.rs    // execute_decomposed_task + spawn_isolated_subagent
    summary.rs     // distill_subagent_summary + SubagentSummary
  ```
- **Locked: New Tauri command** (added to `generate_handler![]` in `lib.rs`):
  - `merge_fork_back`
- **Locked: `swarm.rs` extension is ADDITIVE — no existing function signature changes.** The DECOMP-02 spawn path adds `decomposition::executor::spawn_isolated_subagent` which calls into existing swarm types and DB helpers. The 5-concurrent cap in `resolve_ready_tasks` stays. Swarm /swarm command path is untouched.
- **Locked: `loop_engine.rs` extension is the DECOMP-01 trigger only.** A single check at the top of `run_loop` (post-Phase 34 stuck-detect, pre-iteration-body):
  ```rust
  if config.decomposition.auto_decompose_enabled {
      if let Some(groups) = decomposition::planner::count_independent_steps_grouped(last_user_text, &config) {
          if groups.len() >= config.decomposition.min_steps_to_decompose as usize {
              // Hand off to decomposition executor; bypass legacy iteration body.
              let summaries = decomposition::executor::execute_decomposed_task(...).await?;
              for s in summaries { conversation.push(synthetic_assistant_turn(s)); }
              return Ok(LoopHaltReason::DecompositionComplete);
          }
      }
  }
  ```
  This is a pre-iteration branch; the existing iteration body is NOT lifted again. `LoopHaltReason::DecompositionComplete` is a new variant added to the existing enum.
- **Locked: `session/list.rs` gains `merge_fork_back` Tauri command + `MergeResult` IPC struct.** No changes to existing fork_session / list_sessions / resume_session / get_conversation_cost.
- **Locked: Frontend additions** are scoped to four files:
  - `src/features/sessions/SessionsView.tsx` — extend with "Merge back" action button (visible only for forked rows) + confirm modal
  - `src/features/activity-log/index.tsx` — extend chip switch for `subagent_*` kinds + early-return throttling for high-frequency `subagent_progress`
  - `src/lib/events/payloads.ts` — extend BladeLoopEventPayload union with 3 new variants
  - `src/lib/tauri/sessions.ts` — add `mergeForkBack` typed wrapper + `MergeResult` interface
  - (Optional) `src/features/chat/SubagentProgressBubble.tsx` (NEW) — inline in-flight sub-agent indicator if Claude's discretion above lands
- **Locked: Six-place config rule applies** to every new field in `DecompositionConfig`. See CLAUDE.md. Don't try to remember the six places from memory; copy the diff Phase 34-01 used for `ResilienceConfig` and adapt every line.
- **Locked: `safe_slice` is mandatory** for any new string-slice operation on user/conversation/tool content. Risk sites: `goal_excerpt` (subagent_started emit), `summary_excerpt` (subagent_complete emit), `summary_text` (SubagentSummary), `merge synthetic UserMessage content`.

### Testing & Verification

- **Locked: Each DECOMP-01..05 needs at least one unit test + 1 integration test.** Naming pattern follows Phase 34: `phase35_decomp_01_step_counter_thresholds`, `phase35_decomp_01_role_selection_heuristic`, `phase35_decomp_02_subagent_isolation_separate_loop_state`, `phase35_decomp_02_cost_rollup_to_parent`, `phase35_decomp_03_summary_distillation_caps_at_max_tokens`, `phase35_decomp_03_failed_distillation_falls_back_to_heuristic`, `phase35_decomp_04_merge_fork_back_appends_synthetic_message`, `phase35_decomp_04_merge_rejects_non_fork`, `phase35_decomp_05_subagent_started_event_shape`, `phase35_decomp_05_progress_throttle_running_status`. Plus ≥1 integration test per requirement at the public IPC boundary (mirrors Phase 34-11's 5-test ResilienceConfig + SessionConfig pattern):
  - `phase35_decomposition_default_config_matches_wave1_contract`
  - `phase35_decomposition_auto_off_round_trips_without_collateral_mutation`
  - `phase35_decomp_01_count_independent_steps_via_force_seam`
  - `phase35_decomp_02_swarm_dispatch_triggers_on_threshold`
  - `phase35_decomp_04_merge_fork_back_persists_synthetic_message`
- **Locked: Test seam pattern.** Mirror Phase 33-04's `LOOP_OVERRIDE` and Phase 34-04's `RES_FORCE_STUCK` — introduce three seams:
  - `DECOMP_FORCE_STEP_COUNT: thread_local! Cell<Option<u32>>` — tests inject a step count without crafting real complex queries.
  - `DECOMP_FORCE_SUBAGENT_RESULT: thread_local! Cell<Option<SubagentSummary>>` — tests inject a sub-agent summary without spawning real tokio tasks. Lets the executor pass-through tests run in milliseconds.
  - `DECOMP_FORCE_DISTILL_PANIC: thread_local! Cell<bool>` — tests verify the catch_unwind fallback produces a heuristic summary when summary distillation panics.
  All three `#[cfg(test)]`-gated; production builds carry zero overhead.
- **Locked: Auto-decompose-disabled regression test required.** A unit test sets `decomposition.auto_decompose_enabled = false` and asserts the loop runs sequentially with no decomposition side effects (no fork_session calls, no subagent_* events, no parent-cost rollup beyond the single loop's spend). Mirrors Phase 32-07 / 33-09 / 34-11 kill-switch posture.
- **Locked: Panic-injection regression test required for `execute_decomposed_task`** (mirrors Phase 33-09's `phase33_loop_01_panic_in_render_actions_json_is_caught` and Phase 34-04's `FORCE_STUCK_PANIC`). Force a panic inside one sub-agent's `run_loop` via the test seam; assert the parent receives a SubagentSummary with `success: false` and a panic-message excerpt; assert siblings continue normally; assert the parent's chat does not crash.
- **Locked: Swarm-dispatch integration test required.** A test that wires DECOMP-01's StepGroups → swarm DAG with mocked provider responses (via existing test mocks in `swarm_planner.rs::tests` + Phase 34's RES_FORCE_PROVIDER_ERROR seam). Asserts each task is marked Completed, summaries are distilled, and the parent's conversation Vec grows by exactly N synthetic messages.
- **Locked: SessionWriter persistence test required for sub-agent JSONLs.** A test that runs a 3-StepGroup decomposition, then reads each sub-agent's JSONL via `session::resume::load_session`, asserts each contains the expected SessionMeta with `parent` populated, ≥1 UserMessage, ≥1 AssistantTurn, and a final HaltReason. Locks the SESS-01 contract for sub-agent persistence.
- **Locked: NO new verify gate.** verify:intelligence is Phase 37's responsibility (EVAL-05). Phase 35 keeps the existing 37 gates green and adds unit tests + integration tests + the merge_fork_back wiring-audit-shape entry (1 module + 1 config field + 0 new routes — SessionsView already registered Phase 34).
- **Locked: Runtime UAT REQUIRED per CLAUDE.md Verification Protocol.** This phase has runtime UI work (SessionsView Merge-back flow + ActivityStrip subagent chips + optional SubagentProgressBubble + chat-stream sub-agent summaries). The final task in the phase-closure plan must be `checkpoint:human-verify`. UAT script:
  1. Open dev binary (`npm run tauri dev`)
  2. Send a 6-step query: "Find all Rust files modified in the last 7 days, summarize each one's purpose, identify the top 3 by complexity, write a report to /tmp/blade-rust-modules.md, run cargo check, and post the output to a Slack channel" — assert ActivityStrip shows `subagent_started: 1: researcher`, `2: researcher`, `3: analyst`, `4: writer`, `5: coder`, `6: writer` chips; assert each `subagent_complete` chip fires; assert parent chat shows 6 synthetic `[Sub-agent summary — step N…]` messages
  3. Verify each sub-agent's JSONL exists in `~/.config/blade/sessions/` with a `parent` attribute matching the parent's session_id
  4. Open SessionsView; confirm 6 new rows appear with `parent` populated; confirm the parent's row's `message_count` reflects only the synthetic AssistantTurns added (not the sub-agent inflation)
  5. Send a query that triggers DECOMP, then mid-fan-out cancel — assert in-flight sub-agents finish their iteration and their summaries inject; assert no zombie tokio tasks
  6. Set `decomposition.max_parallel_subagents = 1` — send a 5-step query — assert sub-agents run *serially* (one at a time), all complete, all summaries inject in order
  7. Set `decomposition.auto_decompose_enabled = false` — send the same 6-step query — assert the loop runs sequentially with NO subagent_* chips and NO new sub-agent JSONLs created
  8. From SessionsView, click "Branch" on a regular session → pick message index 3 → confirm new fork session appears
  9. Click "Merge back" on the fork session → confirm modal appears with parent's first_message_excerpt → confirm — assert success toast, fork remains in list (not deleted), parent's chat shows a new synthetic UserMessage `[Branch merged from fork {fork_id[..8]}…] {summary_text}`
  10. Send a follow-up message in the parent — assert the model's reply references the merged summary content (proves the synthetic UserMessage entered the conversation correctly)
  11. Set `decomposition.auto_decompose_enabled = true`, set `cost_guard_per_conversation_dollars = 0.10`, send a 6-step query — assert RES-04 80% chip fires somewhere mid-fan-out, assert decomposition halts gracefully with `LoopHaltReason::CostExceeded { scope: PerConversation }`, assert in-flight sub-agents return their partial summaries
  12. Screenshot SessionsView with merge-back UI at 1280×800 + 1100×700, save under `docs/testing ss/`
  13. Screenshot ActivityStrip with subagent_* chips at 1280×800 + 1100×700
  14. Screenshot chat surface with 6 synthetic sub-agent summaries inline at 1280×800 + 1100×700
  15. Read back all screenshots via the Read tool and cite a one-line observation per breakpoint
- **Locked: tsc --noEmit + cargo check must remain clean.** No regressions in the 37 verify gates. The pre-existing OEVAL-01c v1.4 drift (verify:eval) remains out-of-scope per the SCOPE BOUNDARY established by Phase 32-07 / 33-09 / 34-11.

### Claude's Discretion (catch-all)

- File-level layout inside `decomposition/executor.rs` — whether `execute_decomposed_task` is one async function or split into `dispatch_step_groups` + `await_completion` + `roll_up_summaries`. Recommend split-by-phase (one function per concern) for testability — each can be unit-tested with the FORCE seams independently.
- Priority order when multiple StepGroups have overlapping `depends_on`. Recommend straightforward Kahn's-algorithm topological sort via the existing `swarm::validate_dag` — no new logic needed.
- Whether sub-agents inherit the parent's persona / character / hormones. Recommend NO for v1 — sub-agents are tool-execution focused; persona is the parent's user-facing surface. Each sub-agent's system prompt is the role's snippet (`AgentRole::system_prompt_snippet`) plus the StepGroup goal, no character bible. Reduces token footprint per sub-agent significantly.
- Whether to expose `SubagentSummary` to a frontend Tauri command (`get_subagent_summary(step_index, parent_session_id)`) for SessionsView drill-in. Recommend YES — adds observability for free; the data is in the sub-agent's JSONL anyway. Add as `get_subagent_summary` Tauri command in `decomposition/mod.rs`.
- Whether the merge-back synthetic UserMessage should also include the fork's halt reason when the fork halted on cost cap. Recommend yes when `success = false` — gives the user immediate context for why the branch ended.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 35 row (lines 156-167) + 5 success criteria + DECOMP-01..05 sequencing
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — DECOMP-01..05 verbatim (lines 39-43)
- `/home/arnav/blade/.planning/STATE.md` — v1.5 milestone state, key decisions table
- `/home/arnav/blade/.planning/PROJECT.md` — Project core value (read for tone)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (six-place config, safe_slice, Tauri command namespace, verification protocol, what-not-to-do list)
- `/home/arnav/CLAUDE.md` — workspace defaults (Tauri 2 + React + Tailwind v4)

### Phase 34 Predecessor (read for inherited patterns — Phase 35 BUILDS ON THIS)
- `/home/arnav/blade/.planning/phases/34-resilience-session/34-CONTEXT.md` — gold-standard CONTEXT structure; ResilienceConfig + SessionConfig sub-struct + 6-place wire-up pattern; `RES_FORCE_STUCK` test seam → DECOMP_FORCE_STEP_COUNT seam pattern; SessionWriter / SessionEvent enum (DECOMP-02 reuses verbatim per sub-agent); fork_session API (DECOMP-04 builds on)
- `/home/arnav/blade/.planning/phases/34-resilience-session/34-11-SUMMARY.md` — Phase 34 final state: 4 Tauri commands (list_sessions, resume_session, fork_session, get_conversation_cost), BladeLoopEventPayload union with 4 Phase 34 variants, SessionsView with Resume/Branch/Archive UI, InputBar cost-meter chip. Phase 35 extends with merge_fork_back command + 3 subagent_* events + Merge-back UI.
- `src-tauri/src/session/list.rs` — fork_session at line 241; existing 4 Tauri commands; SessionMeta IPC shape (frontend-facing). Phase 35 adds merge_fork_back here (same module per Phase 34 boundary).
- `src-tauri/src/session/log.rs` — SessionWriter + SessionEvent enum + atomic append. Phase 35 reuses for sub-agent JSONLs (one writer per sub-agent, instantiated by the spawn helper).
- `src-tauri/src/session/resume.rs` — load_session (Phase 34 SESS-02) is the read path for distill_subagent_summary input.

### Phase 33 Predecessor (read for loop driver structure)
- `/home/arnav/blade/.planning/phases/33-agentic-loop/33-CONTEXT.md` — LoopState, LoopHaltReason, run_loop, ToolError surfaces. Phase 35 instantiates one LoopState per sub-agent (each runs through run_loop unmodified) and adds `LoopHaltReason::DecompositionComplete` variant.
- `src-tauri/src/loop_engine.rs` — current Phase 33 + 34 surface; LoopState fields (line 65); LoopHaltReason variants (line 102+ approx); run_loop driver. Phase 35 adds the DECOMP-01 pre-iteration trigger and the `DecompositionComplete` halt variant.

### Phase 32 Predecessor (read for compaction + fallback discipline)
- `/home/arnav/blade/.planning/phases/32-context-management/32-07-PLAN.md` — fallback discipline pattern (`catch_unwind` wrappers, panic-injection regression tests). Phase 35 inherits this discipline for `count_independent_steps`, `execute_decomposed_task`, `distill_subagent_summary`, `merge_fork_back`.
- `src-tauri/src/commands.rs::compress_conversation_smart` (Phase 32-04) — runs inside each sub-agent's loop unmodified; Phase 35 does NOT extend the compaction logic.
- `src-tauri/src/commands.rs::count_task_steps` (line 671) — existing heuristic that DECOMP-01's `count_independent_steps` extends. Don't duplicate the connector + verb tally; reuse the existing function as a building block.

### Code Anchors (must read to plan accurately)
- `src-tauri/src/swarm.rs` — Swarm + SwarmTask types, validate_dag, resolve_ready_tasks (5-concurrent cap at line 447), get_swarm_progress, ScratchpadEntry, build_task_context. DECOMP-02 reuses every one of these unchanged.
- `src-tauri/src/swarm_commands.rs` — spawn_task_agent (line 23) + select_provider_for_task (line 39) + emit_progress (line 450). DECOMP-02 wraps spawn_task_agent with the fork_session + fresh LoopState plumbing.
- `src-tauri/src/swarm_planner.rs` — DAG decomposition LLM prompt + parser. Phase 35 does NOT call swarm_planner — the heuristic step counter avoids the LLM round-trip. swarm_planner remains the explicit /swarm command's planner.
- `src-tauri/src/agents/mod.rs` — 8 AgentRoles + system_prompt_snippet + preferred_tool_patterns. DECOMP-01's role-selection heuristic outputs an AgentRole; DECOMP-02 passes it to the existing executor for tool filtering.
- `src-tauri/src/agents/executor.rs` — step execution with tool fallback + provider fallback. DECOMP-02 invokes this through the existing swarm spawn path; no extension required.
- `src-tauri/src/brain_planner.rs` — `plan_task` (line 25) + `reject_plan` (line 284). Phase 35 does NOT call plan_task in the auto-trigger path (heuristic-only); reject_plan stays scoped to Phase 33 LOOP-03's third-same-tool failure.
- `src-tauri/src/lib.rs` — `mod` registrations + `generate_handler!`. Phase 35 adds `mod decomposition;` + 1 new command (`merge_fork_back`).
- `src/features/sessions/SessionsView.tsx` — existing Phase 34 surface (Resume / Branch / Archive). Phase 35 extends with Merge-back action button (visible only for forked rows).
- `src/features/activity-log/index.tsx` — existing chip surface; phase 35 extends the switch for subagent_* kinds + early-return throttling for high-frequency `subagent_progress`.
- `src/lib/events/payloads.ts` — `BladeLoopEventPayload` discriminated union (line 880); phase 35 adds three new variants.
- `src/lib/tauri/sessions.ts` — typed Tauri wrappers (Phase 34); phase 35 adds `mergeForkBack` + `MergeResult` interface.
- `src/features/chat/InputBar.tsx` — existing Phase 34 cost-meter chip; phase 35 does NOT modify (per-sub-agent costs roll up to parent's RES-03 surface unchanged).

### Research Citations (locked in v1.5 milestone)
- mini-SWE-agent — used in Phase 33; Phase 35 stays consistent with its agent-loop architecture (each sub-agent IS a mini-SWE-agent loop with its own context).
- Claude Code architecture (arxiv 2604.14228) — agent loop primitives + sub-agent isolation patterns. Phase 35 ports the structured halt + summary-only-return pattern.
- OpenHands condenser — Phase 32 territory; sub-agent compaction reuses Phase 32's per-sub-agent. NOT a Phase 35 extension.
- Aider repo map — Phase 36, NOT this phase.
- Goose capability registry — Phase 36, NOT this phase.

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — BLADE memory index (chat-first pivot, UAT rule, ghost CSS tokens, streaming contract, deferred-UAT pattern). DECOMP-05's chat-stream sub-agent summaries must respect the streaming contract: every synthetic AssistantTurn renders via the same emit_message_start → chat_token sequence existing turns use.
- `docs/testing ss/` (path has a literal space) — UAT screenshot storage

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete code patterns to reuse (not invent):**

- DECOMP-01 trigger at the top of `run_loop` (post-stuck-detect, pre-iteration-body):
  ```rust
  // ─── DECOMP-01: pre-iteration auto-decompose check ─────────────────────
  if config.decomposition.auto_decompose_enabled {
      // Cost guard interlock — don't fan out when budget is nearly exhausted.
      let pct = state.conversation_cumulative_cost_usd
          / config.resilience.cost_guard_per_conversation_dollars;
      if pct < 0.8 {
          let groups_opt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
              decomposition::planner::count_independent_steps_grouped(last_user_text, &config)
          })).unwrap_or_else(|_| {
              log::warn!("[DECOMP-01] step counter panicked; falling back to sequential");
              None
          });
          if let Some(groups) = groups_opt {
              if groups.len() >= config.decomposition.min_steps_to_decompose as usize {
                  let summaries = decomposition::executor::execute_decomposed_task(
                      session_writer.session_id(),
                      &mut state,
                      groups,
                      &app,
                      &config,
                  ).await?;
                  for s in summaries {
                      conversation.push(synthetic_assistant_turn_from_summary(s));
                  }
                  return Ok(LoopHaltReason::DecompositionComplete);
              }
          }
      } else {
          log::info!("[DECOMP-01] declined: budget at {}%", (pct * 100.0) as u32);
      }
  }
  ```

- LoopHaltReason extension:
  ```rust
  pub enum LoopHaltReason {
      CostExceeded { spent_usd: f32, cap_usd: f32, scope: CostScope },
      IterationCap,
      Cancelled,
      ProviderFatal { error: String },
      Stuck { pattern: String },
      CircuitOpen { error_kind: String, attempts_summary: Vec<AttemptRecord> },
      DecompositionComplete,                                                // NEW (Phase 35)
  }
  ```

- `safe_slice(text, max_chars)` from `lib.rs` is mandatory for `goal_excerpt` (subagent_started), `summary_excerpt` (subagent_complete), `summary_text` truncation, merge-back synthetic UserMessage content.

- `emit_stream_event(&app, "blade_loop_event", json!({...}))` follows the same pattern as Phase 33's chip emits + Phase 34's stuck/circuit/cost emits.

- Six-place config wire-up — copy the diff Phase 34-01 used for `ResilienceConfig` and adapt every line for `DecompositionConfig`. Don't try to remember the six places from memory.

**Concrete config additions (six-place rule applies to each):**
```rust
pub struct DecompositionConfig {
    pub auto_decompose_enabled: bool,            // default true; CTX-07-style escape hatch
    pub min_steps_to_decompose: u32,             // default 5; DECOMP-01 threshold
    pub max_parallel_subagents: u32,             // default 3; rate limiter
    pub subagent_isolation: bool,                // default true; DECOMP-02
    pub subagent_summary_max_tokens: u32,        // default 800; DECOMP-03 cap
}
```
Add `decomposition: DecompositionConfig` field to `BladeConfig` and `DiskConfig`. Default impl, load_config, save_config — six places per CLAUDE.md.

**Concrete StepGroup + SubagentSummary shapes:**
```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StepGroup {
    pub step_index: u32,
    pub goal: String,
    pub role: AgentRole,
    pub depends_on: Vec<u32>,
    pub estimated_duration: String,  // "fast" | "medium" | "slow"
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubagentSummary {
    pub step_index: u32,
    pub subagent_session_id: String,
    pub role: String,
    pub success: bool,
    pub summary_text: String,
    pub tokens_used: u32,
    pub cost_usd: f32,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MergeResult {
    pub fork_id: String,
    pub parent_id: String,
    pub summary_text: String,
}
```

**Concrete BladeLoopEventPayload extensions (TS):**
```typescript
| { kind: 'subagent_started'; step_index: number; role: string; goal_excerpt: string }
| { kind: 'subagent_progress'; step_index: number; status: 'running' | 'tool_call' | 'compacting' | 'verifying'; detail?: string }
| { kind: 'subagent_complete'; step_index: number; success: boolean; summary_excerpt: string; subagent_session_id: string }
```

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't run `cargo check` after every edit — batch first, check at end (1-2 min per check).
- Don't add Co-Authored-By lines to commits.
- Don't use `&text[..n]` on user content — use `safe_slice`.
- Don't create a Tauri command name that already exists in another module — Tauri's macro namespace is FLAT. Verify `merge_fork_back` and `get_subagent_summary` (if Claude's discretion lands) are unique before adding to `generate_handler!`.
- Don't migrate `count_task_steps` (commands.rs:671) — DECOMP-01's `count_independent_steps` is a NEW function that wraps + extends, not a rename. Existing call sites that consume `count_task_steps`'s return value stay unchanged.
- Don't claim the phase is "done" because static gates pass — runtime UAT per CLAUDE.md is mandatory; v1.1 retracted on this exact failure.
- Don't use the existing `swarm_planner.rs` LLM-based decomposition for the auto-trigger path. The heuristic is sub-second; an LLM round-trip per chat turn doubles latency. swarm_planner stays bound to the explicit /swarm command.
- Don't recurse — a sub-agent triggering its own decomposition is explicitly out-of-scope. The DECOMP-01 trigger inside sub-agent run_loops MUST be gated by the parent's `decomposition.auto_decompose_enabled` AND a new `state.is_subagent: bool` flag (locked: skip DECOMP-01 when `state.is_subagent = true`).

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 35 scope:

- **Recursive decomposition** — sub-agent triggering its own decomposition. Current scope: 1-level deep (gated by `state.is_subagent` flag). v1.6+ may relax if multi-level fan-out proves valuable.
- **Cross-sub-agent shared state / handoff** — siblings sharing live state during execution (e.g. sub-agent 1's intermediate output feeding sub-agent 2 mid-run). Current scope: depends_on edges + scratchpad summaries via the existing swarm.rs::build_task_context pattern; no live cross-sibling channels. v1.6+ if SWE-bench-style multi-agent coordination demands it.
- **Sub-agent failure recovery / re-run** — re-running a failed sub-agent without restarting siblings. Current scope: a failed sub-agent halts the whole DAG; partial-completion replay is v1.6+. The existing swarm DB persists task status, so v1.6 can implement "resume from last failed task" naturally.
- **Smart agent-role selection ML** — current scope: heuristic from step text (verbs + file extensions + project nouns). An ML scorer (or a cheap-LLM role classifier) is v1.6+. EVAL-03 stuck-detection accuracy benchmarks (Phase 37) may surface whether the heuristic is good enough.
- **Distributed sub-agent execution across machines** — current scope: local single-process tokio tasks. Cross-machine fan-out requires a network protocol + auth; v1.6+ if BLADE ever adopts cloud sync.
- **Auto-merge of fork timeline edits back into parent JSONL** — fork_session's parent attribution stays one-way. Merge-back injects the SUMMARY only, not the fork's per-message events. A "rebase fork into parent" workflow is v1.6+.
- **Visual DAG of fork→merge graph in SessionsView** — current scope: linear list with parent attribution. Tree visualization is v1.6 polish.
- **Sub-agent provider override per role in config** — current scope: role-based provider via existing `select_provider_for_task` (Researcher → fast, Coder → quality). Per-config `subagent_default_provider: HashMap<AgentRole, String>` is v1.6+.
- **SubagentProgressBubble component** — locked as Claude's discretion (recommend YES); if planner defers it, the chat surface degrades to ActivityStrip-only sub-agent visibility, which is acceptable for v1 but suboptimal.
- **`get_subagent_summary` Tauri command for SessionsView drill-in** — locked as Claude's discretion (recommend YES); deferral is acceptable since the data is in the sub-agent's JSONL, but adds observability for free.
- **EVAL-01 multi-step task completion benchmark** — Phase 37, NOT this phase. Phase 35 ships the decomposition; Phase 37 scores it on the 10 representative tasks.
- **`verify:intelligence` gate (EVAL-05)** — Phase 37's responsibility.
- **INTEL-01..06 / repo map / capability registry / @context-anchor** — Phase 36.
- **Decomposition cost-budget pre-flight** — current scope: cost guard interlock at 80% (Claude's discretion above) prevents fan-out when the budget is nearly exhausted. A more sophisticated "estimate per-sub-agent cost before spawning, cancel if total > remaining budget" pre-flight is v1.6+.
- **Sub-agent persona inheritance** — current scope: sub-agents use role snippet only, no character bible. Persona-aware sub-agents are v1.6+ if the chat-first pivot ever softens.

</deferred>

---

*Phase: 35-auto-decomposition*
*Context gathered: 2026-05-06 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / PROJECT.md / CLAUDE.md / Phase 34 predecessor (34-CONTEXT.md + 34-11-SUMMARY.md) / Phase 33 predecessor (33-CONTEXT.md) / Phase 32 fallback discipline (32-07-PLAN.md) / live codebase grounding at swarm.rs (637 lines, DAG infrastructure) + swarm_commands.rs (spawn_task_agent + select_provider_for_task) + agents/mod.rs (8 AgentRoles) + session/list.rs (fork_session) + loop_engine.rs (LoopState + run_loop) + commands.rs:671 (count_task_steps heuristic seed).*
