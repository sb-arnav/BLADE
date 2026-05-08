---
phase: 35
slug: auto-decomposition
date: 2026-05-06
status: ready-for-planning
researcher: gsd-phase-researcher (inline)
confidence: HIGH
sources:
  primary:
    - autogen_multi_agent: https://microsoft.github.io/autogen/docs/Use-Cases/agent_chat (parallel multi-agent chat patterns; group-chat manager isolates per-agent context — directly mirrors DECOMP-02 isolation)
    - openhands_swarm: https://docs.openhands.dev/usage/agents (controller agent + worker agents; the summary-only-return pattern is what DECOMP-03 ports verbatim)
    - claude_code_arxiv: https://arxiv.org/abs/2604.14228 (sub-agent isolation as a primitive of the Claude Code agent loop; structured halt + summary surfaced to parent)
    - mini_swe_agent_parallel: https://github.com/SWE-agent/mini-swe-agent (each sub-agent IS a mini-SWE-agent loop with its own context — Phase 35's locked posture per CONTEXT)
    - swe_agent_subagents: https://swe-agent.com/latest/usage/subagent/ (delegated commands; halt-then-summarize semantics — the "report back to controller" path)
    - kahn_topological_sort: https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm (existing swarm::validate_dag implements this — Phase 35 reuses unchanged)
    - tokio_jointset: https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html (parallel-with-cancellation primitive; alternative to existing swarm coordinator polling — Phase 35 reuses swarm coord)
  code:
    - src-tauri/src/swarm.rs (637 lines — Phase 35 reuses unchanged): Swarm struct, SwarmTask, SwarmStatus enum (Planning/Running/Paused/Completed/Failed), validate_dag (Kahn topological sort), resolve_ready_tasks (5-concurrent cap at the dispatch site), get_swarm_progress (snapshot), build_task_context (scratchpad enrichment), ScratchpadEntry. Phase 35 wraps spawn_task_agent (NOT swarm.rs itself) with the fork_session + fresh LoopState plumbing.
    - src-tauri/src/swarm_commands.rs (620 lines): spawn_task_agent at L23, select_provider_for_task at L131, emit_progress (~L450). DECOMP-02 inserts an isolated-subagent variant of spawn_task_agent in decomposition/executor.rs that wraps the same path with fork_session + fresh LoopState; the original swarm command path is untouched.
    - src-tauri/src/swarm_planner.rs (339 lines — DECOMP-01 does NOT call): the explicit /swarm command's LLM-based planner. Per CONTEXT lock §Brain Planner Step Counter, Phase 35 keeps this bound to /swarm only — auto-decompose path is heuristic-only to avoid the LLM round-trip.
    - src-tauri/src/agents/mod.rs (244 lines): 8 AgentRoles + system_prompt_snippet + preferred_tool_patterns. DECOMP-01 outputs an AgentRole per StepGroup; DECOMP-02 passes the same role through the existing executor for tool filtering.
    - src-tauri/src/agents/executor.rs (516 lines): step execution with tool fallback + provider fallback. DECOMP-02 invokes via the existing swarm spawn path; no extension needed.
    - src-tauri/src/loop_engine.rs (4751 lines — Phase 35 inserts ONE pre-iteration trigger): LoopState struct (Phase 33 + 34 surface — Phase 35 adds `is_subagent: bool` to gate recursion), LoopHaltReason at L360 (Phase 35 adds `DecompositionComplete` variant), run_loop driver. The DECOMP-01 trigger lands at the top of run_loop, BEFORE iteration 0, AFTER Phase 34 stuck-detect.
    - src-tauri/src/commands.rs:671 (count_task_steps heuristic seed — Phase 35's count_independent_steps EXTENDS, does NOT rename): existing connector + verb tally returning usize. Phase 35 wraps + extends with file-noun + tool-family axes; existing call site at commands.rs:1475 stays unchanged.
    - src-tauri/src/commands.rs:266 region: `[Earlier conversation summary]` Phase 32-04 marker — DECOMP-03 mirrors this format at sub-agent → parent boundary (synthetic AssistantTurn-shaped ConversationMessage, NOT a special enum variant).
    - src-tauri/src/session/list.rs:241 (fork_session — Phase 34 SESS-04): Two-pass copy with parent attribution + grandchild rejection + clamp + catch_unwind. DECOMP-04 ADDS the `merge_fork_back` Tauri command alongside; fork_session itself is untouched.
    - src-tauri/src/session/list.rs:454 (validate_session_id helper — Phase 34 SESS-04 hardening): Crockford-base32-only regex. DECOMP-04 reuses verbatim before opening the fork JSONL.
    - src-tauri/src/session/log.rs (641 lines — SessionWriter + 7 SessionEvent variants): DECOMP-02 instantiates one SessionWriter per sub-agent via fork_session (which already returns a new ULID) + a fresh SessionWriter pointing at that ULID's JSONL.
    - src-tauri/src/session/resume.rs (load_session — Phase 34 SESS-02): DECOMP-03's distill_subagent_summary reads the sub-agent's JSONL via this exact API.
    - src-tauri/src/providers/mod.rs:362 (default_model_for — Phase 34 RES-05 helper): used implicitly by select_provider_for_task. DECOMP-02 reuses unchanged.
    - src-tauri/src/config.rs:1565 (cheap_model_for_provider — Phase 32-04 helper): DECOMP-03's distill_subagent_summary uses this to pick a cheap-model summarizer; same path Phase 32 compaction uses.
    - src-tauri/src/lib.rs (1803 lines): mod cluster — Phase 35 adds `mod decomposition;` near alphabetical neighbors (between `db_commands` and `discord` or similar). generate_handler! at L610 — Phase 35 adds 1 (or 2 with discretion) commands.
    - src/lib/events/payloads.ts L880 (BladeLoopEventPayload union — Phase 34 added 4 variants at L914-924): Phase 35 adds 3 (`subagent_started`, `subagent_progress`, `subagent_complete`) at the same insertion point.
    - src/lib/tauri/sessions.ts (Phase 34 SESS-04): Phase 35 ADDS `mergeForkBack` typed wrapper + `MergeResult` interface. Existing `forkSession` stays.
    - src/features/sessions/SessionsView.tsx (356 lines — Phase 34 surface): Phase 35 extends with "Merge back" action button visible only for forked rows; confirm modal; auto-route to parent on success.
    - src/features/activity-log/ (chip surface): Phase 35 extends switch for subagent_* kinds + early-return throttling for high-frequency `subagent_progress`.
    - src/features/chat/ChatComposer.tsx OR new SubagentProgressBubble.tsx (Claude's discretion lock recommends YES): inline in-flight sub-agent indicator subscribing to subagent_progress + removing on subagent_complete.
inputs:
  - .planning/phases/35-auto-decomposition/35-CONTEXT.md (LOCKED — 7 implementation decisions across DECOMP-01..05 + Module Boundaries + Testing & Verification + Backward Compatibility)
  - .planning/REQUIREMENTS.md (DECOMP-01..05 verbatim L39-43)
  - .planning/ROADMAP.md (lines 156-167 — Phase 35 row + 5 success criteria)
  - .planning/phases/34-resilience-session/34-CONTEXT.md (Phase 34 predecessor — gold-standard CONTEXT structure; LoopHaltReason with CostScope; ResilienceConfig + SessionConfig sub-struct + 6-place wire-up exemplar; SessionWriter substrate; fork_session API; RES_FORCE_STUCK seam pattern → DECOMP_FORCE_* seam pattern)
  - .planning/phases/34-resilience-session/34-11-SUMMARY.md (Phase 34 final state: 4 Tauri commands, 4 BladeLoopEventPayload variants, SessionsView, cost-meter chip — Phase 35 builds on)
  - .planning/phases/34-resilience-session/34-RESEARCH.md (Phase 34 research structure to mirror)
  - .planning/phases/33-agentic-loop/33-CONTEXT.md (Phase 33 predecessor — LoopState, LoopHaltReason, run_loop, ToolError surface; LOOP_OVERRIDE seam pattern → DECOMP_FORCE_* seam pattern)
  - .planning/phases/32-context-management/32-07-PLAN.md (CTX-07 fallback discipline — catch_unwind wrappers + panic-injection regression tests)
  - CLAUDE.md (six-place rule, safe_slice, Tauri command namespace flatness, verification protocol, what-not-to-do list)
---

# Phase 35: Auto-Decomposition — Research

**Audience:** the planner. The 35-CONTEXT.md document locks 7 implementation decisions across 5 requirements (DECOMP-01..05); this doc supplies HOW (concrete code anchors, citation-backed patterns, validation surfaces, landmines) — not WHAT.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DECOMP-01 | Brain planner detects 5+ independent steps and auto-triggers swarm decomposition | §Findings/DECOMP-01 — new `decomposition::planner::count_independent_steps_grouped` extends commands.rs:671's `count_task_steps`; three independence axes (verb groups, file/project nouns, tool families) with `max(...)`; AgentRole heuristic per group; `DECOMP_FORCE_STEP_COUNT` seam mirrors RES_FORCE_STUCK; pre-iteration trigger at top of run_loop with `state.is_subagent` recursion gate |
| DECOMP-02 | Sub-agents spawn with isolated context windows (own conversation, own compaction) | §Findings/DECOMP-02 — new `decomposition::executor::execute_decomposed_task` orchestrates per-step fork_session (Phase 34 SESS-04) + fresh LoopState::default + own SessionWriter; reuses swarm.rs DAG + resolve_ready_tasks (5-concurrent cap stays); per-sub-agent provider via existing select_provider_for_task; cost rolls up to parent's conversation_cumulative_cost_usd; per-sub-agent compaction via Phase 32-04 unchanged |
| DECOMP-03 | Only summary text returns to parent conversation — no history inflation | §Findings/DECOMP-03 — new `decomposition::summary::distill_subagent_summary` reads sub-agent JSONL via session::resume::load_session (Phase 34 SESS-02), runs cheap-model pass (cheap_model_for_provider — Phase 32-04 helper), caps at subagent_summary_max_tokens=800; serial distillation post-halt (deterministic order); heuristic 200-char fallback on cheap-model failure; format mirrors `[Earlier conversation summary]` synthetic AssistantTurn pattern |
| DECOMP-04 | Conversation forking — user can branch and merge back | §Findings/DECOMP-04 — new `merge_fork_back(fork_id) -> Result<MergeResult, String>` Tauri command in session/list.rs; reuses validate_session_id (Phase 34 SESS-04) + load_session (Phase 34 SESS-02) + distill_subagent_summary (DECOMP-03); appends synthetic UserMessage `[Branch merged from fork {id[..8]}…] {summary}` to parent JSONL; explicit user action only (no auto-merge); fork's own JSONL not deleted |
| DECOMP-05 | Sub-agent progress visible in chat (streaming status, not silent background) | §Findings/DECOMP-05 — 3 new `BladeLoopEventPayload` discriminants (subagent_started / subagent_progress / subagent_complete) extend the union at payloads.ts:880; emit sites at fork_session success / iteration boundaries / per-summary distillation; ActivityStrip chips for started+complete, throttled progress (≤1 chip per 3s for `running` and `tool_call`, render for `compacting` + `verifying`); optional inline SubagentProgressBubble; chat-stream synthetic AssistantTurn from DECOMP-03 renders via existing message infrastructure |

---

## Project Constraints (from CLAUDE.md)

These are LOAD-BEARING. The planner MUST verify task plans honor each:

1. **Six-place config rule** — every new `BladeConfig` field needs ALL 6 sites updated. Phase 35 adds ONE new sub-struct (`DecompositionConfig` with 5 fields) — total 5 fields × 6 places = 30 wire-up touch points. **Copy the diff Phase 34-01 used for `ResilienceConfig` + `SessionConfig` and adapt every line for `decomposition: DecompositionConfig`.** Don't try to remember the six places from memory.
2. **`safe_slice` mandatory** — never `&text[..n]` on user/conversation/tool/sub-agent content. Risk sites: `goal_excerpt` (subagent_started emit, ≤120 chars), `summary_excerpt` (subagent_complete emit, ≤120 chars), `summary_text` (SubagentSummary, ≤max_tokens × 4 chars), merge-back synthetic UserMessage content (≤max_tokens × 4 chars), StepGroup.goal (≤500 chars). Five distinct safe_slice call sites are NEW in Phase 35.
3. **Don't run `cargo check` after every edit** — batch first, check at end (1-2 min per check). Phase 35 has wider diff surface than Phase 34: 1 new module + 3 submodules + 1 new Tauri command + 4 frontend files + LoopState + LoopHaltReason + run_loop trigger + decomposition::executor wrapping the swarm spawn path. Plan the cargo-check rollups across waves, not per-task.
4. **Tauri command name uniqueness** — Phase 35 adds 1 confirmed command + 1 discretion command: `merge_fork_back` (LOCKED) and `get_subagent_summary` (Claude's discretion, recommended YES). **Verify ZERO collisions before adding to `generate_handler!`.** Run `grep -rn "fn merge_fork_back\b\|fn get_subagent_summary\b" /home/arnav/blade/src-tauri/src/` — must return 0 hits before this phase begins. Tauri's macro namespace is FLAT.
5. **`use tauri::Manager;`** required when calling `app.state()` or `app.emit()` — easy to miss in new modules. New `decomposition/executor.rs` needs it (for the subagent_started / subagent_progress / subagent_complete emits via emit_stream_event).
6. **No Co-Authored-By in commits.**
7. **Verification Protocol (v1.1 lesson)** — Phase 35 adds runtime UI work (SessionsView "Merge back" action + confirm modal + ActivityStrip subagent chips + optional SubagentProgressBubble + chat-stream synthetic AssistantTurns from sub-agent summaries). Final plan MUST end on `checkpoint:human-verify` with the 15-step UAT script per CONTEXT lock §Testing & Verification. Screenshots at 1280×800 + 1100×700 saved under `docs/testing ss/` (literal space).
8. **Streaming contract** — every Rust streaming branch must emit `blade_message_start` before `chat_token`. **DECOMP-03's chat-stream sub-agent summaries must respect this**: when the parent's `run_loop` resumes after `execute_decomposed_task` returns and pushes the synthetic AssistantTurns into `conversation`, the parent's NEXT live turn (which renders those summaries via the regular send_message_stream_inline path) already honors the contract. Phase 35 must NOT bypass it. **MEMORY.md note: missed once = silent drop.**
9. **Don't recurse** — A sub-agent triggering its own decomposition is explicitly out-of-scope (CONTEXT lock §What This Phase Does NOT Touch). The DECOMP-01 trigger inside sub-agent run_loops MUST be gated by a new `state.is_subagent: bool` flag on LoopState (locked: skip DECOMP-01 when `state.is_subagent = true`). **Failure mode if missed:** infinite fan-out — every sub-agent spawns N children, every child spawns N grandchildren, swarm.rs's 5-concurrent cap at the dispatch site is NOT a recursion barrier (it's per-swarm).
10. **The pre-existing 188 staged deletions in `.planning/phases/00-*` etc.** — every commit in this phase pipeline MUST `git add` only the file it just wrote, never `git add -A` or `git add .`. The orchestrator will sweep the deletions in a separate operation.
11. **Don't rename `count_task_steps`** — DECOMP-01's `count_independent_steps` is a NEW function that wraps + extends, not a rename. The existing call site at commands.rs:1475 stays unchanged. Phase 35 may CALL count_task_steps from inside count_independent_steps, OR re-implement the connector + verb axis with citations to the original.

---

## Executive Summary

1. **Phase 33+34 substrate is 90% of what Phase 35 needs.** LoopState already carries the entire per-loop surface (cumulative_cost_usd, replans_this_run, recent_actions, consecutive_no_tool_turns, compactions_this_run, conversation_cumulative_cost_usd). LoopHaltReason already carries CostExceeded {scope}, Stuck, CircuitOpen — Phase 35 ADDS one variant `DecompositionComplete`. SessionWriter + SessionEvent + fork_session + load_session — all Phase 34 substrate, all reused VERBATIM by Phase 35 sub-agent isolation. The Phase 33-09 / Phase 34-04 catch_unwind discipline is the model for the four new safety wrappers (count_independent_steps, execute_decomposed_task, distill_subagent_summary, merge_fork_back). The RES_FORCE_STUCK / RES_FORCE_PROVIDER_ERROR seams are the model for the three new test seams (DECOMP_FORCE_STEP_COUNT, DECOMP_FORCE_SUBAGENT_RESULT, DECOMP_FORCE_DISTILL_PANIC). Phase 35 is structurally an additive extension of Phase 33+34, NOT a parallel system.

2. **Existing swarm.rs DAG infrastructure is the dispatch mechanism — Phase 35 wraps spawn_task_agent.** swarm.rs (637 lines) gives us: SwarmTask + SwarmStatus types, validate_dag (Kahn's topological sort), resolve_ready_tasks (5-concurrent cap), build_task_context (scratchpad enrichment), get_swarm_progress (snapshot). swarm_commands.rs:23 spawn_task_agent is the per-task dispatch. Phase 35's `decomposition::executor::spawn_isolated_subagent` is a NEW helper that wraps spawn_task_agent with two additional substrates: (a) `fork_session(parent_id, parent_msg_count)` to produce a new ULID JSONL, and (b) a fresh `LoopState::default()` with `is_subagent = true`. The spawn path otherwise reuses the swarm's planner.plan_full + tool filtering + agent-loop tokio::spawn unchanged. The original /swarm command path is NOT modified; spawn_task_agent stays the same.

3. **The step-counter heuristic has three independence axes; the trigger fires once per user turn.** DECOMP-01's `count_independent_steps_grouped(query, &config) -> Option<Vec<StepGroup>>` returns `Some(groups)` when `max(verb_groups, file_groups, tool_families) >= min_steps_to_decompose` (default 5), else `None`. (a) Verb groups: extend commands.rs:671's connector + verb tally. (b) File/project nouns: regex `\b[\w./-]+\.\w+\b` for paths, `\bthe-\w+\b` or capitalized multi-word for repos, URL regex for URLs. (c) Tool families: keyword map (bash/shell/run → bash; read/cat/show → read_file; search/grep/find → search; web/fetch/curl → web_fetch; write/save/create → write_file). The trigger fires at the TOP of run_loop, BEFORE iteration 0, AFTER Phase 34 stuck-detect (which today fires at iteration top — Phase 35's pre-iteration check is one phase earlier). The check happens once per user turn, NOT once per iteration; the existing iteration body is untouched. The 80% cost-budget interlock per CONTEXT lock §Backward Compatibility prevents fan-out when the parent is near the cap.

4. **DECOMP-02 isolation = 4 separate substrates per sub-agent.** Each sub-agent gets: (1) a fresh `LoopState::default()` with `is_subagent = true` and its own iteration count + cumulative_cost_usd + replans_this_run + ring buffer; (2) a forked SessionWriter via `session::list::fork_session(parent_session_id, parent_msg_count)` returning a new ULID; (3) its own compaction cycle via Phase 32-04 unchanged; (4) per-sub-agent provider selection via the existing swarm_commands.rs:131::select_provider_for_task helper (Researcher → cheap, Coder → quality). The parent's LoopState stays untouched; only the sub-agent's final per-loop cumulative_cost_usd is *added* to parent_state.conversation_cumulative_cost_usd at sub-agent completion. The Phase 34 RES-04 100% halt latch checks the parent's running total after each sub-agent completion — over cap means no further sub-agents spawn. Already-running siblings finish their iteration; future siblings are skipped.

5. **DECOMP-03 summary distillation runs serially after each sub-agent halts, not in parallel.** Sub-agent halts asynchronously (whichever finishes first), but the cheap-model summary call runs in step-index order to keep the parent's conversation Vec deterministic. The cheap-model selection reuses Phase 32-04's `cheap_model_for_provider(provider, model)` (config.rs:1565). The summary format is `[Sub-agent summary — step N, role, session ULID[..8]…]\n{summary_text}\n\n(success={bool}, tokens={n}, cost=${f:.4f}; full conversation in session {ULID})` — a synthetic AssistantTurn-shaped ConversationMessage. This mirrors Phase 32-04's `[Earlier conversation summary]\n{summary}` pattern. **Quantitative claim (DECOMP-03 success criterion):** parent conversation grows by ≤ subagent_summary_max_tokens × N sub-agents (≤2.4k tokens for 3 sub-agents at 800 each), vs. ~50k+ if each sub-agent's full conversation rolled in. The heuristic 200-char fallback on cheap-model panic uses `safe_slice(last_assistant_turn_content, 200)` from the sub-agent's JSONL. catch_unwind wraps the entire path.

6. **DECOMP-04's `merge_fork_back` is a thin Tauri command on top of three Phase 34 helpers.** It validates fork_id (Phase 34 SESS-04 helper), reads the fork's JSONL via load_session (Phase 34 SESS-02), runs distill_subagent_summary with `AgentRole::Analyst` (the merge-back distillation summarizes a *user's branch exploration*, structurally analytical), then appends two events to the parent's JSONL: (a) a `LoopEvent { kind: "fork_merged", payload }` for forensics, (b) a synthetic `UserMessage { content: "[Branch merged from fork {id[..8]}…] {summary_text}", ... }` so the parent's next turn sees the merged content as conversation history. **The merge-back is EXPLICIT user action**: the SessionsView "Merge back" button (visible only for forked rows per CONTEXT lock) opens a confirm modal, then calls `mergeForkBack(fork_id)`. The fork's JSONL is NOT deleted; users can fork-then-merge multiple times. v1.6+ may add archive-on-merge.

7. **DECOMP-05 progress visibility = 3 new BladeLoopEventPayload variants + ActivityStrip chip extension + optional SubagentProgressBubble.** The 3 variants extend payloads.ts:880's existing union (the 4 Phase 34 variants are at L914-924). ActivityStrip chip mappings: subagent_started → "sub-agent {N}: {role} — started", subagent_complete → "sub-agent {N}: ✓/✗ {summary_excerpt}", subagent_progress → throttled (≤1 chip per 3s for `running` and `tool_call`; render for `compacting` and `verifying`). The chat-stream surface gets the synthetic AssistantTurns from DECOMP-03 inline — no new component required for that path; reuses existing chat rendering. Claude's discretion locks recommend YES for the inline `<SubagentProgressBubble>` component (subscribes to subagent_progress, renders in-flight indicator, removes on subagent_complete) and YES for a `get_subagent_summary` Tauri command for SessionsView drill-in (data is in the JSONL anyway). Both lower-priority than the core chip wiring.

8. **The single new kill switch `auto_decompose_enabled = false` collapses the entire DECOMP path silently.** Like Phase 32's smart_injection_enabled, Phase 33's smart_loop_enabled, Phase 34's smart_resilience_enabled / jsonl_log_enabled — the v1.1 lesson, sixth application. When false: no count_independent_steps call, no execute_decomposed_task, no fork_session per sub-agent, no swarm dispatch, no summary distillation, no subagent_* events. The merge_fork_back Tauri command still works (frontend can fork + merge manually via SessionsView), but no auto-decomposition fires from chat. The existing /swarm command path remains fully functional — DECOMP's toggle does not affect explicit /swarm invocations. Auto-degrade rule (Claude's discretion lock) per CONTEXT lock §Backward Compatibility: when `parent.conversation_cumulative_cost_usd > 0.8 × resilience.cost_guard_per_conversation_dollars`, log `[DECOMP-01] declined: budget at {pct}%` and fall through to sequential.

9. **The six-place rule applies once for `DecompositionConfig`.** Phase 34-01 added two sub-structs (resilience + session) in 6 places each = 12 wire-up sites total. Phase 35-01 adds ONE sub-struct (decomposition) with 5 fields in the SAME six places = 6 wire-up touch points (5 fields × 1 struct, but each struct counts as 6 places — so 30 field-place pairs). The plan must explicitly enumerate every grep marker in its acceptance criteria — `grep -c "decomposition: DecompositionConfig" config.rs ≥ 4`, `grep -c "decomposition: disk.decomposition" config.rs == 1`, etc. — exactly the way Plan 34-01 did.

10. **The plan-pipeline output is 8-10 plans across 5 waves.** Wave 1 (substrate, 1-2 plans): DecompositionConfig 6-place wire-up + LoopState extension (`is_subagent`) + LoopHaltReason `DecompositionComplete` + decomposition/ module scaffold. Wave 2 (DECOMP-01, 1-2 plans): step counter heuristic + brain_planner extension + auto_decompose toggle gate + cost-budget interlock + run_loop pre-iteration trigger. Wave 3 (DECOMP-02 + DECOMP-03, 2-3 plans): swarm executor wrap (spawn_isolated_subagent) + fork_session per sub-agent + cost rollup + summary distillation + cheap-model fallback. Wave 4 (DECOMP-04 + DECOMP-05, 2-3 plans): merge_fork_back Tauri command + payload extensions + ActivityStrip chips + SessionsView Merge-back UI + optional SubagentProgressBubble. Wave 5 (close, 1 plan): panic-injection regression + checkpoint:human-verify UAT with the 15-step script.

---

## Existing Code (anchors the planner cites by file:line)

### `src-tauri/src/loop_engine.rs` — what gets extended

**LoopState (current Phase 33+34 shape — Phase 35 adds 1 field):**
- L65-L120 approx `pub struct LoopState`
- L320-L326 approx `clone_loop_state` helper (Phase 34 added — verify whether Phase 35's new `is_subagent` needs to ride along)
- **NEW for DECOMP-02 (recursion gate):**
  - `pub is_subagent: bool` — when true, the DECOMP-01 trigger inside this loop's run_loop is SKIPPED. Default false (parent loops). Set to true at sub-agent spawn time by `decomposition::executor::spawn_isolated_subagent`.

**LoopHaltReason (current Phase 33+34 shape at L360 — Phase 35 adds 1 variant):**
- L360 `pub enum LoopHaltReason`
- Existing variants: `CostExceeded {scope}`, `IterationCap`, `Cancelled`, `ProviderFatal`, `Stuck`, `CircuitOpen`
- **NEW:**
  - `DecompositionComplete` — returned when execute_decomposed_task fans out + collects all summaries; the parent loop returns this halt reason to commands.rs which stops iterating (the synthetic AssistantTurns are already in `conversation`).

**run_loop pre-iteration trigger insert site:**
- After Phase 34's stuck-detect block (loop_engine.rs around the `detect_stuck` call site at iteration top, but Phase 35's check fires BEFORE the iteration body even begins — i.e. once per user turn, NOT once per iteration).
- Recommend: insert as the FIRST gated check in `run_loop` body, AFTER state initialization, BEFORE the iteration loop. Pattern (per CONTEXT lock §Module Boundaries):
  ```rust
  if !state.is_subagent && config.decomposition.auto_decompose_enabled {
      let pct = state.conversation_cumulative_cost_usd
          / config.resilience.cost_guard_per_conversation_dollars.max(0.01);
      if pct < 0.8 {
          let groups_opt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
              decomposition::planner::count_independent_steps_grouped(last_user_text, &config)
          })).unwrap_or_else(|_| {
              eprintln!("[DECOMP-01] step counter panicked; fallback to sequential");
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

### `src-tauri/src/commands.rs` — count_task_steps seed + compaction marker

**count_task_steps (line 671 — DECOMP-01 EXTENDS, does NOT rename):**
- L671 `fn count_task_steps(query: &str) -> usize`
- Today: connector tally + action_verb tally + comparison heuristic, returns `score: usize`
- L1475 existing call site (`let plan_score = count_task_steps(&last_user_text);`) — STAYS unchanged
- **DECOMP-01's `count_independent_steps_grouped`** is a NEW function in `decomposition/planner.rs` that returns `Option<Vec<StepGroup>>`. It MAY call `commands::count_task_steps` for the verb-axis or re-implement that logic with citations; the file/project-noun and tool-family axes are NEW work.

**compress_conversation_smart (line 269 region — `[Earlier conversation summary]` marker at line 348):**
- The Phase 32-04 marker format `[Earlier conversation summary]\n{summary}` is the prior-art DECOMP-03 mirrors at the sub-agent → parent boundary. The synthetic AssistantTurn from `decomposition::summary::distill_subagent_summary` uses an analogous bracketed prefix: `[Sub-agent summary — step N, role, session ULID[..8]…]\n{summary_text}`.

**send_message_stream_inline:**
- Phase 34 already constructs SessionWriter at this entry; Phase 35 reuses unchanged. The DECOMP-01 trigger fires INSIDE run_loop (called from this function), so commands.rs is NOT modified for the trigger — only loop_engine.rs.

### `src-tauri/src/swarm.rs` — DAG infrastructure (Phase 35 reuses unchanged)

- **SwarmTask + SwarmStatus enum + Swarm struct** — Phase 35 builds a Swarm with goal = parent's last_user_text, status = Planning, ULID id. For each StepGroup, builds a SwarmTask with id = `format!("step_{}", step_index)`, goal, role, depends_on (by step_index).
- **validate_dag** — Phase 35 calls this BEFORE spawning to reject cycles. Existing Kahn's algorithm implementation is sufficient.
- **resolve_ready_tasks** — 5-concurrent cap at the dispatch site. Phase 35's runtime concurrency = `min(decomposition.max_parallel_subagents, 5)` — the lower of the user's config and the swarm cap.
- **build_task_context** — scratchpad enrichment per task. Reused unchanged.
- **get_swarm_progress** — snapshot used for ActivityStrip emit throttling decisions.

### `src-tauri/src/swarm_commands.rs` — spawn_task_agent (DECOMP-02 wraps)

- **L23 `async fn spawn_task_agent(task, swarm, queue, mcp, app)`** — the existing per-task dispatch. Phase 35's `decomposition::executor::spawn_isolated_subagent` wraps this: BEFORE calling spawn_task_agent, it (a) calls `session::list::fork_session(parent_session_id, parent_msg_count)` to produce a new ULID JSONL, (b) constructs a fresh `LoopState::default()` with `is_subagent = true`, (c) constructs a SessionWriter pointing at the forked JSONL. The wrap then calls into spawn_task_agent (or a refactored variant that accepts these substrates as parameters).
- **L131 `fn select_provider_for_task(task, config)`** — Phase 35 reuses this verbatim for per-sub-agent provider selection (Researcher → cheap, Coder → quality).
- **emit_progress** (~L450) — the existing per-task progress emit; Phase 35 may reuse or emit subagent_progress directly via emit_stream_event in the spawn helper.

### `src-tauri/src/agents/mod.rs` — AgentRole (Phase 35 reuses unchanged)

- L18 `pub enum AgentRole` with 8 variants (Researcher, Coder, Analyst, Writer, Reviewer, SecurityRecon, SecurityAnalyst, SecurityAuditor)
- **DECOMP-01's role-selection heuristic outputs an AgentRole per StepGroup.** Pure text match against goal:
  - Code-shaped (writes/edits a file, mentions a function, fixes a bug) → `Coder`
  - Research-shaped (fetches/reads/finds/searches/looks up) → `Researcher`
  - Analysis-shaped (compares/computes/summarizes/decides) → `Analyst`
  - Documentation-shaped (writes a doc/email/report) → `Writer`
  - Verification-shaped (tests/reviews/audits) → `Reviewer`
  - Default fallback → `Researcher` (broadest tool footprint, cheap model)
  - Security-* roles NOT used by auto-decompose v1 (explicit /swarm only).
- L66-L100 `system_prompt_snippet` — DECOMP-02 prepends the role's snippet to each sub-agent's enriched goal (already done by spawn_task_agent at swarm_commands.rs:48).
- `preferred_tool_patterns` — DECOMP-02 reuses for tool filtering at swarm_commands.rs:55-75.

### `src-tauri/src/agents/executor.rs` — step execution (Phase 35 reuses unchanged)

- 516 lines. Phase 35 does NOT extend this. The existing executor is invoked through the swarm spawn path; DECOMP-02 only wraps the *outer* spawn boundary, not the inner step execution.

### `src-tauri/src/session/list.rs` — fork_session (Phase 35 ADDS merge_fork_back here)

- **L241 `async fn fork_session(parent_id, fork_at_message_index)`** — Phase 34 SESS-04 substrate. Two-pass copy + grandchild rejection + clamp + catch_unwind. **Phase 35 does NOT modify this.** DECOMP-04 ADDS `merge_fork_back` as a sibling Tauri command in this same file.
- **L454 `pub(crate) fn validate_session_id(id)`** — Phase 34 SESS-04 hardening. Crockford-base32-only regex. **Phase 35's `merge_fork_back` reuses this verbatim** before opening the fork JSONL.
- **L48 `async fn list_sessions`**, **L198 `async fn resume_session`**, **L398 `async fn get_conversation_cost`** — Phase 34 commands. Phase 35 does NOT modify; it ADDS `merge_fork_back`.

### `src-tauri/src/session/log.rs` — SessionWriter + 7 SessionEvent variants (Phase 35 reuses unchanged)

- **SessionWriter** — Phase 35 instantiates ONE per sub-agent, pointing at the fork_session-generated JSONL.
- **SessionEvent enum** with 7 variants: SessionMeta, UserMessage, AssistantTurn, ToolCall, CompactionBoundary, HaltReason, LoopEvent. Phase 35 does NOT extend the enum.
- **LoopEvent variant** — Phase 35 emits `kind: "subagent_started" | "subagent_progress" | "subagent_complete"` and `kind: "fork_merged"` (DECOMP-04) through this existing variant. No new enum variants.

### `src-tauri/src/session/resume.rs` — load_session (Phase 35 reuses unchanged)

- **`pub fn load_session(path, session_id) -> Result<ResumedConversation, String>`** — Phase 34 SESS-02 substrate. **DECOMP-03's `distill_subagent_summary` reads the sub-agent's JSONL via this exact API**, gets the ResumedConversation, then runs a cheap-model summary pass over the assistant turns.

### `src-tauri/src/providers/mod.rs` — fallback substrate (Phase 35 reuses unchanged)

- **L362 `pub fn default_model_for(provider) -> &'static str`** — Phase 34 RES-05 helper. Used implicitly by select_provider_for_task; Phase 35 does NOT call directly.
- **price_per_million** — used by per-sub-agent cost rollup.

### `src-tauri/src/config.rs` — six-place wire-up exemplar

- **`fn cheap_model_for_provider(provider, user_model) -> String`** at L1565 — Phase 32-04 helper. **DECOMP-03's distill_subagent_summary uses this** to pick a cheap-model summarizer; same path Phase 32 compaction uses.
- **ContextConfig + LoopConfig + ResilienceConfig + SessionConfig blocks** are the structural template for `DecompositionConfig`. Mirror the Phase 34-01 diff verbatim.
- **blade_config_dir** at L852 — Phase 35 reuses for SessionWriter paths (already wired by Phase 34 into SessionConfig.jsonl_log_dir).

### `src-tauri/src/lib.rs` — module + command registration

- **mod cluster** — Phase 35 adds `mod decomposition;` near alphabetical neighbors. Verify placement: between `db_commands` (L62-ish) and `discovery` or wherever lexical ordering holds.
- **`generate_handler!` macro at L610** — Phase 35 appends 1-2 commands: `merge_fork_back` (LOCKED) + optional `get_subagent_summary` (Claude's discretion, recommended YES).
- **Verify zero collisions:** `grep -rn "fn merge_fork_back\b\|fn get_subagent_summary\b" /home/arnav/blade/src-tauri/src/` — must return 0 hits.

### Frontend anchors

- **`src/lib/events/payloads.ts:880`** BladeLoopEventPayload union — Phase 34 added 4 variants at L914-924. Phase 35 appends 3 new variants at the same insertion point: `subagent_started`, `subagent_progress`, `subagent_complete`.
- **`src/lib/events/index.ts`** BLADE_EVENTS registry — `BLADE_LOOP_EVENT` already registered. **No new event names** — Phase 35 discriminates via `kind` within the same event.
- **`src/features/activity-log/`** — chip rendering surface; extend the `kind`-switch for subagent_* with the throttling rules per CONTEXT lock §DECOMP-05.
- **`src/features/sessions/SessionsView.tsx`** (356 lines, Phase 34) — Phase 35 extends with "Merge back" action button visible ONLY for forked rows + confirm modal + auto-route to parent on success.
- **`src/lib/tauri/sessions.ts`** (141 lines, Phase 34) — Phase 35 ADDS `mergeForkBack(forkId)` typed wrapper + `MergeResult` interface.
- **`src/features/chat/`** — Phase 35 may add `SubagentProgressBubble.tsx` (NEW, optional per Claude's discretion lock — recommend YES). Subscribes to subagent_progress, renders inline above the next assistant message, removes on subagent_complete.

---

## External Research

### AutoGen multi-agent chat (Microsoft)

AutoGen's `GroupChat` (https://microsoft.github.io/autogen/docs/Use-Cases/agent_chat) coordinates multiple `ConversableAgent` instances in either round-robin or task-decomposition mode. Each agent has its own message history; the manager filters which messages each agent sees. The **per-agent message isolation is exactly DECOMP-02**: AutoGen's manager prevents agents from seeing each other's full histories, only filtered/summarized state.

**Decision relevance:** AutoGen's `summary_method = "reflection_with_llm"` produces a 1-paragraph LLM-generated reflection of the sub-conversation — exactly DECOMP-03's distillation pattern. AutoGen uses a fixed prompt template; we use the same approach (CONTEXT lock §DECOMP-03 specifies the prompt verbatim).

### OpenHands swarm controller

OpenHands (https://docs.openhands.dev/usage/agents) has a **CodeActAgent** (controller) that delegates to **DelegateAgent** workers. The delegate runs in its own context; the controller receives only the delegate's final response — the delegate's full thought chain stays in the delegate's history.

**Decision relevance:** This is the canonical "controller + workers" architecture our DECOMP-02 implements. OpenHands has 1-level delegation only — same as our locked v1 scope. OpenHands handles delegate failures via structured halt + error message return to the controller; we mirror this with `SubagentSummary { success: false, summary_text: panic_excerpt }`.

### Claude Code's task tool (arxiv 2604.14228)

The Claude Code paper (https://arxiv.org/abs/2604.14228) describes the agent loop's `task` primitive: spawn a sub-agent with a fresh context, give it a goal, receive a structured response (success/failure + summary). Critically: **the sub-agent's intermediate tool calls are NOT visible to the parent** — only the final return.

**Decision relevance:** This is the load-bearing pattern for DECOMP-03's "summary text returns to parent" success criterion. Claude Code achieves this by returning a structured object; we return a synthetic AssistantTurn-shaped ConversationMessage with the `[Sub-agent summary — step N…]` prefix. Same effect (parent sees only summary), different surface.

### mini-SWE-agent parallel mode (CONTEXT lock §What This Phase Does NOT Touch)

mini-SWE-agent (https://github.com/SWE-agent/mini-swe-agent) supports parallel sub-agents via `swarm` extensions; each runs as an independent mini-loop with its own LiteLLM session. The CONTEXT lock pins us to "each sub-agent IS a mini-SWE-agent loop with its own context". No changes to this posture.

**Decision relevance:** Confirms that "fresh LoopState + own SessionWriter per sub-agent" (DECOMP-02 lock) is the field-tested approach. No exotic shared-state pattern.

### SWE-agent subagent / delegated commands

SWE-agent (https://swe-agent.com/latest/usage/subagent/) implements delegated commands where the sub-agent runs to completion before returning a summary. The summary format is structured (action + observation + outcome).

**Decision relevance:** Validates the **halt-then-summarize** semantics — sub-agent halts FIRST, then summarization runs (we run cheap-model post-halt; SWE-agent's structured-summary post-halt is a precedent). DECOMP-03 lock matches.

### Kahn's topological sort (Wikipedia)

The existing `swarm::validate_dag` implements Kahn's algorithm (https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm) for cycle detection. **DECOMP-02 reuses verbatim** — no new sort logic needed. The StepGroup.depends_on field surfaces inter-step dependencies; validate_dag rejects cycles before spawning.

### Tokio JoinSet (parallel-with-cancellation primitive)

`tokio::task::JoinSet` (https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html) is the modern primitive for spawning N tasks and collecting results as they complete, with cancellation support. **The existing swarm coordinator uses 2-second polling instead of JoinSet** (per swarm_commands.rs:1-9 documentation). Phase 35 reuses the existing coordinator unchanged — no JoinSet refactor. v1.6+ may revisit if poll latency proves a UX issue.

### Cost-rollup arithmetic correctness

When N sub-agents run in parallel, each accumulates its own per-loop `cumulative_cost_usd`. At sub-agent halt, we *add* (not replace) into the parent's `conversation_cumulative_cost_usd`. **Race condition risk:** if two sub-agents complete simultaneously, two concurrent `+=` operations could lose a value.

**Decision:** the parent's `conversation_cumulative_cost_usd` lives on `parent_state: &mut LoopState` which is MUTABLY borrowed by `execute_decomposed_task`. Sub-agent completion serializes through the swarm coordinator's poll loop (existing 2s polling means at most one sub-agent's results land per poll tick — there is no concurrent rollup race). If the coordinator is ever rewritten with JoinSet (v1.6+), wrap the rollup in `Arc<Mutex<f32>>` or `AtomicU32` (lossy but bounded). For Phase 35: rely on existing coordinator's serialization.

### Sub-agent provider selection edge cases

The existing `select_provider_for_task` returns `(provider, api_key, model)` from `BladeConfig` with role-based override. **Edge cases:**
- Parent uses Anthropic; Researcher sub-agent picks OpenRouter free-tier — but user has no OpenRouter key. select_provider_for_task today falls through to parent provider. Phase 35 should do the same — verify by reading swarm_commands.rs:131 implementation.
- Parent uses Ollama; sub-agent role asks for "quality" model — Ollama doesn't have a tier system. select_provider_for_task today returns Ollama with default model. Acceptable.
- Parent has `api_key.is_empty() && provider != "ollama"` — spawn_task_agent already returns `Err("No API key configured")` at swarm_commands.rs:31. Phase 35's spawn_isolated_subagent inherits this guard.

---

## Implementation Sketches

### DecompositionConfig (Plan 35-01 substrate)

```rust
// src-tauri/src/config.rs — adjacent to ResilienceConfig + SessionConfig

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct DecompositionConfig {
    /// CTX-07-style escape hatch. true = auto-decompose triggers when a query
    /// implies 5+ independent steps. false = legacy sequential loop only.
    /// Phase 32 / 33 / 34 / 35 all carry this same v1.1-lesson kill switch.
    #[serde(default = "default_auto_decompose_enabled")]
    pub auto_decompose_enabled: bool,
    /// DECOMP-01 trigger threshold (max of 3 independence axes). Default 5.
    #[serde(default = "default_min_steps_to_decompose")]
    pub min_steps_to_decompose: u32,
    /// DECOMP-02 — concurrent sub-agent rate limiter. Runtime check uses
    /// min(this, 5) to respect swarm.rs's 5-concurrent cap. Default 3.
    #[serde(default = "default_max_parallel_subagents")]
    pub max_parallel_subagents: u32,
    /// DECOMP-02 — when false, sub-agents share parent's LoopState +
    /// SessionWriter. DEBUG ONLY — cost rollup breaks. Default true.
    #[serde(default = "default_subagent_isolation")]
    pub subagent_isolation: bool,
    /// DECOMP-03 — cap on sub-agent summary text returned to parent. Default 800.
    #[serde(default = "default_subagent_summary_max_tokens")]
    pub subagent_summary_max_tokens: u32,
}

fn default_auto_decompose_enabled() -> bool { true }
fn default_min_steps_to_decompose() -> u32 { 5 }
fn default_max_parallel_subagents() -> u32 { 3 }
fn default_subagent_isolation() -> bool { true }
fn default_subagent_summary_max_tokens() -> u32 { 800 }

impl Default for DecompositionConfig {
    fn default() -> Self {
        Self {
            auto_decompose_enabled: default_auto_decompose_enabled(),
            min_steps_to_decompose: default_min_steps_to_decompose(),
            max_parallel_subagents: default_max_parallel_subagents(),
            subagent_isolation: default_subagent_isolation(),
            subagent_summary_max_tokens: default_subagent_summary_max_tokens(),
        }
    }
}

// Six-place wire-up — same diff Phase 34-01 used for `resilience: ResilienceConfig`,
// substituting `decomposition: DecompositionConfig`.
```

### LoopState extension + LoopHaltReason variant (Plan 35-01)

```rust
// src-tauri/src/loop_engine.rs — append ONE field to LoopState

pub struct LoopState {
    // ... existing Phase 33+34 fields ...
    pub is_subagent: bool,                                     // NEW (DECOMP-02)
}
```

```rust
// src-tauri/src/loop_engine.rs — append ONE variant to LoopHaltReason

pub enum LoopHaltReason {
    CostExceeded { spent_usd: f32, cap_usd: f32, scope: CostScope },  // existing
    IterationCap,
    Cancelled,
    ProviderFatal { error: String },
    Stuck { pattern: String },
    CircuitOpen { error_kind: String, attempts_summary: Vec<AttemptRecord> },
    DecompositionComplete,                                                 // NEW (Phase 35)
}
```

### decomposition module scaffold (Plan 35-02)

```
src-tauri/src/decomposition/
  mod.rs         // module root, re-exports DecompositionConfig accessor + StepGroup + SubagentSummary + MergeResult
  planner.rs     // count_independent_steps_grouped + StepGroup + role-selection heuristic + DECOMP_FORCE_STEP_COUNT seam
  executor.rs    // execute_decomposed_task + spawn_isolated_subagent + cost rollup + DECOMP_FORCE_SUBAGENT_RESULT seam
  summary.rs     // distill_subagent_summary + SubagentSummary + DECOMP_FORCE_DISTILL_PANIC seam
```

### count_independent_steps_grouped (Plan 35-03)

```rust
// src-tauri/src/decomposition/planner.rs

use serde::{Deserialize, Serialize};
use crate::agents::AgentRole;
use crate::config::BladeConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepGroup {
    pub step_index: u32,
    pub goal: String,                  // safe_slice'd to 500 chars
    pub role: AgentRole,
    pub depends_on: Vec<u32>,
    pub estimated_duration: String,    // "fast" | "medium" | "slow"
}

#[cfg(test)]
thread_local! {
    pub(crate) static DECOMP_FORCE_STEP_COUNT: std::cell::Cell<Option<u32>> =
        std::cell::Cell::new(None);
}

pub fn count_independent_steps_grouped(
    query: &str,
    config: &BladeConfig,
) -> Option<Vec<StepGroup>> {
    #[cfg(test)]
    if let Some(forced) = DECOMP_FORCE_STEP_COUNT.with(|c| c.get()) {
        return Some(build_synthetic_groups(query, forced));
    }
    if !config.decomposition.auto_decompose_enabled { return None; }

    let q = query.to_lowercase();
    let verb_groups = count_verb_groups(&q);
    let file_groups = count_file_groups(query);  // case-sensitive paths
    let tool_families = count_tool_families(&q);
    let n = verb_groups.max(file_groups).max(tool_families);
    if n < config.decomposition.min_steps_to_decompose {
        return None;
    }
    Some(build_step_groups(query, n))
}

fn count_verb_groups(q: &str) -> u32 {
    // Reuse commands::count_task_steps logic OR re-implement with citations.
    // Connectors + verbs + comparison heuristic.
    let connectors = [" and then ", " then ", " after that ", " also ",
                       " plus ", " followed by ", " before ", " finally "];
    let connector_count = connectors.iter().filter(|c| q.contains(*c)).count();
    let action_verbs = ["compare", "fetch", "get", "read", "check", "show",
                         "calculate", "find", "search", "run", "open", "send",
                         "create", "write", "analyze", "summarize", "list",
                         "download", "upload", "format", "convert", "export"];
    let verb_count = action_verbs.iter().filter(|v| q.contains(*v)).count();
    let mut score = connector_count;
    if verb_count >= 2 { score += verb_count.saturating_sub(1); }
    score as u32
}

fn count_file_groups(q: &str) -> u32 {
    let path_re = regex::Regex::new(r"\b[\w./-]+\.\w{1,5}\b").unwrap();
    let url_re = regex::Regex::new(r"https?://\S+").unwrap();
    let repo_re = regex::Regex::new(r"\bthe-[\w-]+\b").unwrap();
    let unique: std::collections::HashSet<&str> = path_re.find_iter(q)
        .chain(url_re.find_iter(q))
        .chain(repo_re.find_iter(q))
        .map(|m| m.as_str())
        .collect();
    unique.len() as u32
}

fn count_tool_families(q: &str) -> u32 {
    let families: &[(&str, &[&str])] = &[
        ("bash", &["bash", "shell", "run", "execute"]),
        ("read_file", &["read", "cat", "show", "open"]),
        ("search", &["search", "grep", "find"]),
        ("web_fetch", &["web", "fetch", "curl", "http"]),
        ("write_file", &["write", "save", "create"]),
    ];
    families.iter()
        .filter(|(_, kws)| kws.iter().any(|k| q.contains(k)))
        .count() as u32
}

fn select_role_for_goal(goal_lower: &str) -> AgentRole {
    if matches_any(goal_lower, &["write code", "fix bug", "refactor", "function", "implement"]) {
        AgentRole::Coder
    } else if matches_any(goal_lower, &["compare", "analyze", "summarize", "compute", "decide"]) {
        AgentRole::Analyst
    } else if matches_any(goal_lower, &["doc", "email", "report", "blog", "post"]) {
        AgentRole::Writer
    } else if matches_any(goal_lower, &["test", "review", "audit", "verify"]) {
        AgentRole::Reviewer
    } else if matches_any(goal_lower, &["fetch", "find", "search", "look up", "read"]) {
        AgentRole::Researcher
    } else {
        AgentRole::Researcher  // default fallback
    }
}

fn matches_any(text: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|p| text.contains(p))
}

fn build_step_groups(query: &str, n: u32) -> Vec<StepGroup> {
    // Split query at connector boundaries; produce N groups with roles.
    // Conservative split — each group captures one verb cluster.
    let parts: Vec<&str> = split_at_connectors(query);
    (0..n).map(|i| {
        let goal = parts.get(i as usize).copied().unwrap_or(query);
        StepGroup {
            step_index: i,
            goal: crate::safe_slice(goal, 500).to_string(),
            role: select_role_for_goal(&goal.to_lowercase()),
            depends_on: vec![],  // independent by default; downstream may add
            estimated_duration: "medium".to_string(),
        }
    }).collect()
}
```

### execute_decomposed_task + spawn_isolated_subagent (Plan 35-05)

```rust
// src-tauri/src/decomposition/executor.rs

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::agents::AgentRole;
use crate::config::BladeConfig;
use crate::decomposition::planner::StepGroup;
use crate::decomposition::summary::{distill_subagent_summary, SubagentSummary};
use crate::loop_engine::LoopState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DecompositionError {
    DagInvalid(String),
    SwarmExhausted(String),
    ParentBudgetExceeded,
}

#[cfg(test)]
thread_local! {
    pub(crate) static DECOMP_FORCE_SUBAGENT_RESULT: std::cell::Cell<Option<SubagentSummary>> =
        std::cell::Cell::new(None);
}

pub async fn execute_decomposed_task(
    parent_session_id: &str,
    parent_state: &mut LoopState,
    groups: Vec<StepGroup>,
    app: &AppHandle,
    config: &BladeConfig,
) -> Result<Vec<SubagentSummary>, DecompositionError> {
    // (1) Build swarm from StepGroups.
    let swarm = build_swarm_from_groups(&groups, parent_session_id);
    crate::swarm::validate_dag(&swarm.tasks)
        .map_err(|e| DecompositionError::DagInvalid(e))?;

    // (2) Hoist MCP tool snapshot once per decomposition (Claude's discretion lock).
    let mcp = crate::commands::shared_mcp_manager().clone();

    // (3) Get parent's current message count for fork point.
    let parent_msg_count = read_parent_msg_count(parent_session_id)?;

    // (4) Walk groups via existing swarm coordinator polling.
    //     Each ready task → spawn_isolated_subagent.
    let max_concurrent = config.decomposition.max_parallel_subagents.min(5) as usize;
    let mut summaries: Vec<SubagentSummary> = Vec::with_capacity(groups.len());

    for group in &groups {
        // Cost interlock — parent over cap means halt remaining sub-agents.
        if parent_state.conversation_cumulative_cost_usd
            >= config.resilience.cost_guard_per_conversation_dollars {
            return Err(DecompositionError::ParentBudgetExceeded);
        }

        let summary = spawn_isolated_subagent(
            group, parent_session_id, parent_msg_count, &mcp, app, config
        ).await;
        // Cost rollup
        parent_state.conversation_cumulative_cost_usd += summary.cost_usd;
        summaries.push(summary);

        // Emit subagent_complete chip — handled INSIDE spawn_isolated_subagent
        // before returning summary.
    }

    Ok(summaries)
}

async fn spawn_isolated_subagent(
    group: &StepGroup,
    parent_session_id: &str,
    parent_msg_count: u32,
    mcp: &crate::commands::SharedMcpManager,
    app: &AppHandle,
    config: &BladeConfig,
) -> SubagentSummary {
    #[cfg(test)]
    if let Some(forced) = DECOMP_FORCE_SUBAGENT_RESULT.with(|c| c.take()) {
        return forced;
    }

    // (a) Fork session — Phase 34 SESS-04 substrate.
    let new_id = match crate::session::list::fork_session(
        parent_session_id.to_string(),
        parent_msg_count,
    ).await {
        Ok(id) => id,
        Err(e) => {
            return SubagentSummary {
                step_index: group.step_index,
                subagent_session_id: String::new(),
                role: group.role.as_str().to_string(),
                success: false,
                summary_text: format!("[fork failed: {}]", e),
                tokens_used: 0,
                cost_usd: 0.0,
            };
        }
    };

    // (b) Emit subagent_started.
    crate::commands::emit_stream_event(app, "blade_loop_event", serde_json::json!({
        "kind": "subagent_started",
        "step_index": group.step_index,
        "role": group.role.as_str(),
        "goal_excerpt": crate::safe_slice(&group.goal, 120),
    }));

    // (c) Build SwarmTask + spawn via existing swarm helpers (catch_unwind).
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // ... actual spawn through swarm_commands::spawn_task_agent or
        //     refactored variant accepting fork_id + LoopState::default() with
        //     is_subagent=true. Wait for halt via swarm coordinator polling.
    }));

    // (d) Distill summary post-halt (DECOMP-03).
    let summary = match distill_subagent_summary(&new_id, group.role.clone(), config).await {
        Ok(s) => s,
        Err(_) => SubagentSummary {
            step_index: group.step_index,
            subagent_session_id: new_id.clone(),
            role: group.role.as_str().to_string(),
            success: false,
            summary_text: "[summary distillation failed]".to_string(),
            tokens_used: 0,
            cost_usd: 0.0,
        },
    };

    // (e) Emit subagent_complete chip.
    crate::commands::emit_stream_event(app, "blade_loop_event", serde_json::json!({
        "kind": "subagent_complete",
        "step_index": group.step_index,
        "success": summary.success,
        "summary_excerpt": crate::safe_slice(&summary.summary_text, 120),
        "subagent_session_id": new_id,
    }));

    summary
}
```

### distill_subagent_summary (Plan 35-06)

```rust
// src-tauri/src/decomposition/summary.rs

use serde::{Deserialize, Serialize};
use crate::agents::AgentRole;
use crate::config::BladeConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentSummary {
    pub step_index: u32,
    pub subagent_session_id: String,
    pub role: String,
    pub success: bool,
    pub summary_text: String,
    pub tokens_used: u32,
    pub cost_usd: f32,
}

#[cfg(test)]
thread_local! {
    pub(crate) static DECOMP_FORCE_DISTILL_PANIC: std::cell::Cell<bool> =
        std::cell::Cell::new(false);
}

pub async fn distill_subagent_summary(
    subagent_session_id: &str,
    role: AgentRole,
    config: &BladeConfig,
) -> Result<SubagentSummary, String> {
    #[cfg(test)]
    if DECOMP_FORCE_DISTILL_PANIC.with(|c| c.get()) {
        panic!("test-only induced panic in distill_subagent_summary");
    }

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| async {
        let path = config.session.jsonl_log_dir
            .join(format!("{}.jsonl", subagent_session_id));
        let resumed = crate::session::resume::load_session(&path, subagent_session_id)
            .map_err(|e| format!("load_session: {}", e))?;

        // Build cheap-model prompt per CONTEXT lock §DECOMP-03.
        let prompt = format!(
            "You are summarizing a sub-agent's work. The agent's role was {}. \
             Below is the agent's full conversation. Produce ONE paragraph (≤ {} tokens) \
             that captures: (1) the outcome — did the agent succeed or fail; \
             (2) key facts found / files touched / decisions made; \
             (3) any next-step recommendations for the parent agent. \
             Do NOT include filler or preamble.\n\n{}",
            role.as_str(),
            config.decomposition.subagent_summary_max_tokens,
            crate::safe_slice(&serialize_messages(&resumed.messages),
                config.decomposition.subagent_summary_max_tokens as usize * 8),
        );

        let cheap_model = crate::config::cheap_model_for_provider(
            &config.provider, &config.model);

        let response = crate::providers::complete_simple(
            &config.provider, &config.api_key, &cheap_model, &prompt
        ).await.map_err(|e| format!("cheap-model summarize: {}", e))?;

        Ok::<SubagentSummary, String>(SubagentSummary {
            step_index: 0, // caller fills
            subagent_session_id: subagent_session_id.to_string(),
            role: role.as_str().to_string(),
            success: !resumed_indicates_failure(&resumed),
            summary_text: crate::safe_slice(&response,
                config.decomposition.subagent_summary_max_tokens as usize * 4).to_string(),
            tokens_used: estimate_tokens(&resumed),
            cost_usd: estimate_cost(&resumed, &config.provider, &config.model),
        })
    }));

    match result {
        Ok(fut) => fut.await,
        Err(_) => {
            // catch_unwind fallback — heuristic 200-char summary from last AssistantTurn.
            let path = config.session.jsonl_log_dir
                .join(format!("{}.jsonl", subagent_session_id));
            let fallback = crate::session::resume::load_session(&path, subagent_session_id)
                .ok()
                .and_then(|r| r.messages.iter().rev()
                    .find_map(|m| if let crate::providers::ConversationMessage::Assistant(t) = m {
                        Some(crate::safe_slice(t, 200).to_string())
                    } else { None }))
                .unwrap_or_else(|| "[sub-agent halted before any assistant output]".to_string());
            Ok(SubagentSummary {
                step_index: 0,
                subagent_session_id: subagent_session_id.to_string(),
                role: role.as_str().to_string(),
                success: false,
                summary_text: fallback,
                tokens_used: 0,
                cost_usd: 0.0,
            })
        }
    }
}
```

### merge_fork_back Tauri command (Plan 35-08)

```rust
// src-tauri/src/session/list.rs — added alongside fork_session

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub fork_id: String,
    pub parent_id: String,
    pub summary_text: String,
}

#[tauri::command]
pub async fn merge_fork_back(fork_id: String) -> Result<MergeResult, String> {
    validate_session_id(&fork_id)?;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| async {
        let cfg = crate::config::load_config();
        let dir = cfg.session.jsonl_log_dir.clone();
        let fork_path = dir.join(format!("{}.jsonl", &fork_id));
        if !fork_path.exists() {
            return Err(format!("fork session not found: {}", fork_id));
        }

        // (1) Read fork — extract parent.
        let resumed = crate::session::resume::load_session(&fork_path, &fork_id)
            .map_err(|e| format!("load fork: {}", e))?;
        let parent_id = read_parent_from_meta(&fork_path)?
            .ok_or("session is not a fork — cannot merge back")?;

        // (2) Distill summary (DECOMP-03).
        let summary = crate::decomposition::summary::distill_subagent_summary(
            &fork_id, crate::agents::AgentRole::Analyst, &cfg
        ).await.map_err(|e| format!("distill: {}", e))?;

        // (3) Append synthetic events to parent JSONL.
        let parent_path = dir.join(format!("{}.jsonl", &parent_id));
        let now = crate::session::log::now_ms();
        let merge_event = crate::session::log::SessionEvent::LoopEvent {
            kind: "fork_merged".to_string(),
            payload: serde_json::json!({
                "fork_id": fork_id,
                "summary_text": summary.summary_text,
            }),
            timestamp_ms: now,
        };
        let synthetic_user = crate::session::log::SessionEvent::UserMessage {
            id: ulid::Ulid::new().to_string(),
            content: format!(
                "[Branch merged from fork {}…] {}",
                &fork_id[..8],
                crate::safe_slice(&summary.summary_text,
                    cfg.decomposition.subagent_summary_max_tokens as usize * 4),
            ),
            timestamp_ms: now,
        };
        // Open parent JSONL and append both events (atomic, flock'd).
        append_events_to_jsonl(&parent_path, &[merge_event, synthetic_user])?;

        Ok(MergeResult {
            fork_id: fork_id.clone(),
            parent_id,
            summary_text: summary.summary_text,
        })
    }));

    match result {
        Ok(fut) => fut.await,
        Err(_) => {
            eprintln!("[DECOMP-04] merge_fork_back panicked for fork {}; surfacing Err", fork_id);
            Err("merge_fork_back internal error (panic caught)".to_string())
        }
    }
}
```

### BladeLoopEventPayload extension (Plan 35-09)

```typescript
// src/lib/events/payloads.ts — extend the union at L880

export type BladeLoopEventPayload =
  // ... existing Phase 33 + 34 variants ...
  | { kind: 'subagent_started'; step_index: number; role: string; goal_excerpt: string }
  | { kind: 'subagent_progress'; step_index: number; status: 'running' | 'tool_call' | 'compacting' | 'verifying'; detail?: string }
  | { kind: 'subagent_complete'; step_index: number; success: boolean; summary_excerpt: string; subagent_session_id: string };
```

### mergeForkBack typed wrapper (Plan 35-09)

```typescript
// src/lib/tauri/sessions.ts — added alongside forkSession

export interface MergeResult {
  fork_id: string;
  parent_id: string;
  summary_text: string;
}

export function mergeForkBack(forkId: string): Promise<MergeResult> {
  return invoke<MergeResult>('merge_fork_back', { forkId });
}
```

---

## Landmines

**The 12 specific risks Phase 35 plans must guard against:**

1. **Recursive sub-agent triggering.** A sub-agent's run_loop calls count_independent_steps_grouped → fires DECOMP-01 → spawns N grandchildren → each grandchild spawns N great-grandchildren → fan-out explodes. **Guard:** new `LoopState.is_subagent: bool` field; the DECOMP-01 trigger checks `!state.is_subagent` before firing. Set to true at sub-agent spawn time. Failure mode if missed: infinite fan-out, swarm.rs's 5-concurrent cap is per-swarm not global. **Test:** Plan 35-04's `phase35_decomp_01_subagent_does_not_recurse` — set is_subagent=true, force step count to 10, assert count_independent_steps_grouped returns None (or the trigger's caller skips).

2. **Cost-rollup race when sub-agents complete simultaneously.** Two `parent_state.conversation_cumulative_cost_usd += s.cost_usd` operations could lose a value if concurrently dispatched. **Guard:** parent_state is `&mut` — mutable borrow forces serial access; the swarm coordinator's 2s polling means at most one sub-agent's results land per tick. If the coordinator is rewritten with JoinSet (v1.6+), the rollup needs `Arc<Mutex<f32>>`. **Phase 35 disposition:** rely on existing serialization; document the assumption in executor.rs comments.

3. **Cost-rollup arithmetic correctness on partial completion.** When a parent halts mid-fan-out (RES-04 100% cap during sub-agent execution), some sub-agents have completed and rolled up; some are mid-flight; some haven't started. **Locked behavior (CONTEXT §DECOMP-02):** in-flight sub-agents finish their current iteration and return summaries; future sub-agents are SKIPPED with `Err(DecompositionError::ParentBudgetExceeded)`. **Test:** Plan 35-11 UAT step 11 — set cost cap to $0.10, send 6-step query, assert mid-fan-out halt with partial summaries injected.

4. **Sub-agent provider selection edge cases.** select_provider_for_task may fall through to parent provider when the role-preferred provider has no API key. **Guard:** verify swarm_commands.rs:131's existing fallthrough behavior; document in spawn_isolated_subagent that the role hint is best-effort. Failure mode if missed: sub-agent 4 spawns with a provider that has no key, returns Err immediately, parent sees a {success: false} summary with "no api key configured" — UX-noisy but correct.

5. **Summary distillation cheap-model failure modes.** cheap_model_for_provider may return a model the user has no key for (e.g. config says provider=anthropic but cheap_model_for_provider returns "groq:llama-..."). **Guard:** distill_subagent_summary wraps in catch_unwind + falls back to heuristic 200-char summary from last AssistantTurn. **Test:** `phase35_decomp_03_failed_distillation_falls_back_to_heuristic` (the DECOMP_FORCE_DISTILL_PANIC seam). Failure mode if missed: a single bad cheap-model call halts the entire decomposition — chat shows nothing.

6. **Merge-back race when parent receives a new user message during fork execution.** User starts fork on parent X; mid-fork, sends a new message to parent X (which appends to parent's JSONL); user clicks "Merge back" on the fork; the synthetic UserMessage from merge-back is appended to parent's JSONL AFTER the user's new message + the model's reply. Result: chronological ordering is preserved (good), but the merge-back content lands AFTER the live conversation continued. **Disposition (CONTEXT lock):** explicit user action only — the user is responsible for ordering. Plan 35-08 documents this in the merge_fork_back doc-comment.

7. **Swarm-trigger false-positive on simple tasks.** "read the file at /tmp/foo and tell me what it says" has 1 tool family (read_file), 1 file noun (/tmp/foo), 1 verb group (read+tell), max=1. count_independent_steps_grouped returns None — correct. But "fetch the URLs at https://a.com, https://b.com, https://c.com, https://d.com, https://e.com" has 1 tool family but 5 file nouns (URLs) → trips at threshold 5 → spawns 5 sub-agents for what's logically 1 batched task. **Disposition (CONTEXT §Brain Planner Step Counter):** acceptable false positive in v1; the role-selection heuristic + Researcher's broad tool footprint means each sub-agent will succeed. v1.6+ may add a "batched-tool" detection axis. Plan 35-04 includes a unit test asserting this behavior.

8. **Swarm-trigger false-positive on conversational queries.** "let me think — first I need to compare this to last month, then summarize the trends, then write a quick blog post about it" has connectors + verbs → trips at threshold 5 → spawns sub-agents for what the user wanted as a single answer. **Disposition:** the cost-budget interlock at 80% (CONTEXT §Backward Compatibility) is the safety net. v1.6+ may add a "conversational marker" suppressor (questions ending with `?`, hedge words like "maybe", "I'm thinking", etc.). Plan 35-11's UAT step 6 (max_parallel_subagents=1, 5-step query) verifies serial fallback.

9. **Sub-agent JSONL writer race during compaction.** Each sub-agent has its own SessionWriter pointing at its own ULID JSONL. No shared writers. **No race.** Confirmed by Phase 34 SESS-01's flock + atomic-append discipline. Plan 35-05 includes a test that runs 3 sub-agents concurrently and verifies each JSONL is well-formed (no interleaved lines).

10. **Cancellation mid-fan-out.** User cancels chat (CHAT_CANCEL atomic flips). In-flight sub-agents must check the cancel flag at iteration boundaries (Phase 33 LoopState already does this). **Guard:** sub-agent's run_loop honors CHAT_CANCEL natively; spawn_isolated_subagent also checks before scheduling each new sub-agent. **Test:** Plan 35-11's UAT step 5 — trigger DECOMP, mid-fan-out cancel, assert in-flight sub-agents finish their iteration and their summaries inject; assert no zombie tokio tasks.

11. **Fork-then-merge synthetic-message hydration on resume.** A user merges fork back into parent X → parent X's JSONL has a synthetic UserMessage. User closes BLADE → reopens → resumes parent X. Phase 34 SESS-02's load_session replays from most-recent CompactionBoundary. The synthetic UserMessage is replayed correctly (it's a regular UserMessage event in JSONL). **No special handling needed.** Plan 35-08 includes a test that round-trips a merge + resume.

12. **Tauri command name collision for `merge_fork_back` and `get_subagent_summary`.** Tauri's macro namespace is FLAT. **Guard:** before adding to generate_handler!, run `grep -rn "fn merge_fork_back\b\|fn get_subagent_summary\b" /home/arnav/blade/src-tauri/src/` — must return 0 hits. Plan 35-08 acceptance criteria includes this grep.

13. **Frontend `subagent_progress` chip flooding.** A 6-step decomposition with 10 iterations each = 60 chips at minimum. ActivityStrip's existing chip pipeline can render but not gracefully fade 60 simultaneous chips. **Guard:** CONTEXT lock §DECOMP-05 — `subagent_progress` with status=`running` or `tool_call` is throttled to ≤1 chip per 3 seconds per step_index via existing toast-fade timing; chips render only for `compacting` and `verifying`. Plan 35-09 includes a TypeScript test asserting throttle behavior (`phase35_decomp_05_progress_throttle_running_status`).

14. **`get_subagent_summary` Tauri command (Claude's discretion lock — recommend YES).** If the planner picks "yes", verify name uniqueness AND add the corresponding typed wrapper in sessions.ts. If "no", document the deferral in 35-DEFERRED.md (or in the relevant SUMMARY.md).

---

## Validation Architecture

**Test pyramid Phase 35 builds:**

```
                     UAT (1 plan: 35-11)
                    /                   \
    Integration tests (5)         Frontend tests (1-2)
    /     |     |     |     \           |
DECOMP-01 -02  -03  -04  -05    React-testing-library: subagent chip throttle, merge-back modal
                                       |
                Unit tests (10+)
        ┌──────┬──────┬──────┬──────┬──────┐
       -01    -02    -03    -04    -05    seam tests
   step counter spawn distill merge events DECOMP_FORCE_*
   role heuristic isolation panic fallback throttle
```

**Test seams (3, all #[cfg(test)]-gated):**
- `DECOMP_FORCE_STEP_COUNT: thread_local! Cell<Option<u32>>` — inject step count without crafting real complex queries.
- `DECOMP_FORCE_SUBAGENT_RESULT: thread_local! Cell<Option<SubagentSummary>>` — inject sub-agent summary without spawning real tokio tasks. Lets pass-through tests run in milliseconds.
- `DECOMP_FORCE_DISTILL_PANIC: thread_local! Cell<bool>` — verify catch_unwind fallback produces heuristic summary on summary distillation panic.

**Required unit tests (mirrors CONTEXT §Testing & Verification):**
- `phase35_decomp_01_step_counter_thresholds` — threshold = 5; counts < 5 return None; >= 5 return Some(groups)
- `phase35_decomp_01_role_selection_heuristic` — code-shaped → Coder; research-shaped → Researcher; etc.
- `phase35_decomp_01_subagent_does_not_recurse` — `is_subagent = true` skips the trigger
- `phase35_decomp_01_disabled_returns_none` — `auto_decompose_enabled = false` returns None unconditionally
- `phase35_decomp_02_subagent_isolation_separate_loop_state` — parent_state.iteration unchanged after sub-agent run
- `phase35_decomp_02_cost_rollup_to_parent` — sub-agent cost adds to parent.conversation_cumulative_cost_usd
- `phase35_decomp_02_max_parallel_clamped_to_swarm_cap` — config 50 → runtime min(50, 5) = 5
- `phase35_decomp_03_summary_distillation_caps_at_max_tokens` — output ≤ subagent_summary_max_tokens × 4 chars
- `phase35_decomp_03_failed_distillation_falls_back_to_heuristic` — DECOMP_FORCE_DISTILL_PANIC=true → 200-char fallback
- `phase35_decomp_04_merge_fork_back_appends_synthetic_message` — parent JSONL gains UserMessage event with bracketed prefix
- `phase35_decomp_04_merge_rejects_non_fork` — session without parent attribution returns Err
- `phase35_decomp_05_subagent_started_event_shape` — payload has step_index + role + goal_excerpt
- `phase35_decomp_05_progress_throttle_running_status` — running emits ≤1 chip per 3s

**Required integration tests (5):**
- `phase35_decomposition_default_config_matches_wave1_contract` — DecompositionConfig::default() matches the 5 locked default values
- `phase35_decomposition_auto_off_round_trips_without_collateral_mutation` — auto_decompose_enabled=false: no fork_session calls, no subagent_* events, no parent-cost rollup beyond the single loop's spend
- `phase35_decomp_01_count_independent_steps_via_force_seam` — DECOMP_FORCE_STEP_COUNT=Some(7) → trigger fires
- `phase35_decomp_02_swarm_dispatch_triggers_on_threshold` — 5+ StepGroups dispatched via swarm DAG with mocked provider responses
- `phase35_decomp_04_merge_fork_back_persists_synthetic_message` — fork → merge → resume parent → verify synthetic UserMessage in replayed conversation

**Frontend tests:**
- `phase35_decomp_05_progress_throttle_render` — render ActivityStrip with 10 subagent_progress events at 100ms intervals; assert ≤4 chips rendered (3s/0.7s decay)
- `phase35_decomp_04_merge_back_button_visibility` — render SessionsView with mock data: forked rows show Merge-back; non-forked rows do NOT

**Runtime UAT (15 steps per CONTEXT §Testing & Verification — runs in Plan 35-11):**
1. Open dev binary
2. Send a 6-step query "Find all Rust files modified in the last 7 days, summarize each one's purpose, identify the top 3 by complexity, write a report to /tmp/blade-rust-modules.md, run cargo check, and post the output to a Slack channel" — assert 6 subagent_started chips, 6 subagent_complete chips, 6 synthetic [Sub-agent summary — step N…] messages in parent chat
3. Verify each sub-agent JSONL exists in `~/.config/blade/sessions/` with `parent` matching parent's session_id
4. Open SessionsView; 6 new rows with parent populated; parent's message_count reflects only synthetic AssistantTurns added
5. Send query that triggers DECOMP, mid-fan-out cancel — in-flight sub-agents finish, summaries inject, no zombie tasks
6. Set max_parallel_subagents=1 — send 5-step query — sub-agents run serially, all complete in order
7. Set auto_decompose_enabled=false — send same 6-step query — loop runs sequentially, NO subagent_* chips, NO new sub-agent JSONLs
8. From SessionsView, click "Branch" on regular session, message index 3, confirm new fork session appears
9. Click "Merge back" on the fork session, confirm modal with parent's first_message_excerpt, confirm — success toast, fork remains in list, parent's chat shows new synthetic UserMessage `[Branch merged from fork {id[..8]}…] {summary_text}`
10. Send follow-up message in parent — model's reply references the merged summary content
11. Set auto_decompose_enabled=true, cost_guard_per_conversation_dollars=0.10, send 6-step query — RES-04 80% chip fires mid-fan-out, decomposition halts gracefully with `LoopHaltReason::CostExceeded { scope: PerConversation }`, in-flight sub-agents return partial summaries
12. Screenshot SessionsView with merge-back UI at 1280×800 + 1100×700, save under `docs/testing ss/`
13. Screenshot ActivityStrip with subagent_* chips at 1280×800 + 1100×700
14. Screenshot chat surface with 6 synthetic sub-agent summaries inline at 1280×800 + 1100×700
15. Read back all screenshots via Read tool, cite a one-line observation per breakpoint

---

## Test Strategy

**Per-wave coverage (one plan per wave includes its requirement's tests):**

| Wave | Plan(s) | Coverage |
|------|---------|----------|
| 1 | 35-01 + 35-02 | Config + LoopState + LoopHaltReason variant + decomposition module scaffold — 6 round-trip + default-value tests + scaffold compile-clean |
| 2 | 35-03 + 35-04 | DECOMP-01 step counter + role heuristic + run_loop trigger + recursion gate — 5+ unit + 1 integration |
| 3 | 35-05 + 35-06 + 35-07 | DECOMP-02 spawn isolation + cost rollup + DECOMP-03 distillation + cheap-model fallback — 6 unit + 1 integration + 1 panic-injection |
| 4 | 35-08 + 35-09 + 35-10 | DECOMP-04 merge_fork_back command + frontend payloads + ActivityStrip + SessionsView merge UI — 4 unit + 2 frontend tests |
| 5 | 35-11 | Phase-wide panic-injection regression + checkpoint:human-verify UAT |

**Cargo-check rollup cadence:**
- After Wave 1 (35-02 close): first cargo check
- After Wave 2 (35-04 close): second cargo check + cargo test for resilience::stuck-style detector tests
- After Wave 3 (35-07 close): third cargo check + cargo test for decomposition::*
- After Wave 4 (35-10 close): fourth cargo check + tsc --noEmit + cargo test integration
- Wave 5 (35-11): final cargo check + tsc --noEmit + UAT screenshots

**Anti-pattern guards (must appear in plan acceptance criteria):**
- No `git add -A` or `git add .` — only `git add <specific file>` per the 188-staged-deletion landmine.
- No Co-Authored-By lines in commits.
- No `&text[..n]` on user content — `safe_slice` mandatory at 5 NEW call sites.
- No `cargo check` after every edit — batch per wave.
- No Tauri command name collisions — grep before adding to generate_handler!.
- No recursion — `state.is_subagent` flag must gate the DECOMP-01 trigger.

---

## Anti-Patterns (from existing CLAUDE.md, CONTEXT lock §Specifics, MEMORY.md)

- **Don't run `cargo check` after every edit** — batch first, check at end (1-2 min per check).
- **Don't add Co-Authored-By lines to commits.**
- **Don't use `&text[..n]` on user content** — use `safe_slice` from `lib.rs`. 5 NEW Phase 35 call sites: goal_excerpt, summary_excerpt, summary_text, merge synthetic UserMessage content, StepGroup.goal.
- **Don't create a Tauri command name that already exists** — Tauri's macro namespace is FLAT. Verify `merge_fork_back` and `get_subagent_summary` (if Claude's discretion lands) are unique before adding to `generate_handler!`.
- **Don't migrate `count_task_steps`** (commands.rs:671) — DECOMP-01's `count_independent_steps_grouped` is a NEW function that wraps + extends, not a rename. Existing call sites stay unchanged.
- **Don't claim the phase is "done" because static gates pass** — runtime UAT per CLAUDE.md is mandatory; v1.1 retracted on this exact failure.
- **Don't use the existing `swarm_planner.rs` LLM-based decomposition for the auto-trigger path.** The heuristic is sub-second; an LLM round-trip per chat turn doubles latency. swarm_planner stays bound to the explicit /swarm command.
- **Don't recurse** — sub-agent triggering its own decomposition is explicitly out-of-scope. Gate the DECOMP-01 trigger inside sub-agent run_loops by `state.is_subagent: bool`.
- **Don't bypass the streaming contract** — every Rust streaming branch emits `blade_message_start` before `chat_token`. The synthetic AssistantTurns from DECOMP-03 enter the conversation Vec; the parent's next live turn that renders them goes through the regular streaming path which honors the contract.
- **Don't sweep the 188 pre-existing staged deletions into Phase 35 commits** — every commit `git add` only the file just written.

---

## Plan-Pipeline Suggested Shape

**8-10 plans across 5 waves (Claude's discretion to refine in plan-phase):**

- **Wave 1 — Substrate (1-2 plans):**
  - **35-01:** DecompositionConfig 6-place wire-up (5 fields × 6 places = 30 touch points; mirrors Plan 34-01 exactly) + 4 round-trip + default-value tests
  - **35-02:** LoopState `is_subagent: bool` field + LoopHaltReason `DecompositionComplete` variant + decomposition/ module scaffold (planner.rs + executor.rs + summary.rs stubs with seams declared)

- **Wave 2 — DECOMP-01 (2 plans):**
  - **35-03:** count_independent_steps_grouped + StepGroup struct + role-selection heuristic + DECOMP_FORCE_STEP_COUNT seam + 6 unit tests
  - **35-04:** run_loop pre-iteration trigger insert + cost-budget interlock at 80% + recursion gate + auto-disabled regression test + panic-injection regression

- **Wave 3 — DECOMP-02 + DECOMP-03 (3 plans):**
  - **35-05:** execute_decomposed_task + spawn_isolated_subagent (wraps swarm spawn with fork_session + fresh LoopState{is_subagent=true} + own SessionWriter) + cost rollup arithmetic + DECOMP_FORCE_SUBAGENT_RESULT seam + 4 unit + 1 integration test
  - **35-06:** distill_subagent_summary + SubagentSummary struct + cheap-model dispatch + heuristic fallback + DECOMP_FORCE_DISTILL_PANIC seam + 3 unit tests
  - **35-07:** Synthetic AssistantTurn injection into parent conversation + LoopHaltReason::DecompositionComplete return path + parent's RES-04 100% halt latch interaction + 2 integration tests

- **Wave 4 — DECOMP-04 + DECOMP-05 (3 plans):**
  - **35-08:** merge_fork_back Tauri command + MergeResult struct + reuses validate_session_id + load_session + distill_subagent_summary + appends LoopEvent + synthetic UserMessage to parent JSONL + 3 unit tests + grep collision check
  - **35-09:** BladeLoopEventPayload extension (3 new variants) + mergeForkBack typed wrapper + sessions.ts MergeResult interface + 1 frontend test
  - **35-10:** ActivityStrip chip switch extension (subagent_started/progress/complete with throttle) + SessionsView Merge-back action button + confirm modal + auto-route + (optional) SubagentProgressBubble + (optional) get_subagent_summary Tauri command + 2 frontend tests

- **Wave 5 — Close (1 plan):**
  - **35-11:** Panic-injection regression for execute_decomposed_task (force panic in one sub-agent's run_loop, assert sibling continues + summary has success: false) + 5 integration tests + checkpoint:human-verify with 15-step UAT script + screenshots at 1280×800 + 1100×700 saved under `docs/testing ss/`

---

## Quick Reference for Plan Writer

**Six-place rule sites to enumerate in Plan 35-01 acceptance criteria:**
- DiskConfig field: `decomposition: DecompositionConfig`
- DiskConfig::default body: `decomposition: DecompositionConfig::default()`
- BladeConfig field: `pub decomposition: DecompositionConfig`
- BladeConfig::default body: `decomposition: DecompositionConfig::default()`
- load_config copy: `decomposition: disk.decomposition`
- save_config copy: `decomposition: config.decomposition.clone()`

**Greps to verify (Plan 35-01 acceptance):**
- `grep -c "pub struct DecompositionConfig" config.rs` returns 1
- `grep -c "decomposition: DecompositionConfig" config.rs` ≥ 4
- `grep -c "decomposition: disk.decomposition" config.rs` returns 1
- `grep -c "decomposition: config.decomposition.clone()" config.rs` returns 1
- `grep -c "fn default_auto_decompose_enabled" config.rs` returns 1
- `grep -c "fn default_min_steps_to_decompose" config.rs` returns 1

**Greps to verify (Plan 35-02 acceptance):**
- `grep -c "pub is_subagent: bool" loop_engine.rs` returns 1
- `grep -c "DecompositionComplete" loop_engine.rs` ≥ 1
- `ls src-tauri/src/decomposition/` lists `mod.rs planner.rs executor.rs summary.rs`

**Greps to verify (Plan 35-04 acceptance):**
- `grep -c "count_independent_steps_grouped" loop_engine.rs` ≥ 1
- `grep -c "is_subagent" loop_engine.rs` ≥ 2 (struct field + check at trigger)
- `grep -c "auto_decompose_enabled" loop_engine.rs` ≥ 1

**Greps to verify (Plan 35-08 acceptance):**
- `grep -c "fn merge_fork_back" session/list.rs` returns 1
- `grep -c "merge_fork_back" lib.rs` ≥ 1 (in generate_handler!)
- `grep -rn "fn merge_fork_back\b" src-tauri/src/` returns exactly 1 hit (no collisions)

**Greps to verify (Plan 35-11 acceptance):**
- `grep -c "checkpoint:human-verify" 35-11-PLAN.md` returns 1
- 14+ UAT steps documented in 35-11-PLAN.md
- Screenshot paths reference `docs/testing ss/` (literal space)

---

*Phase: 35-auto-decomposition*
*Research compiled: 2026-05-06 via direct synthesis from 35-CONTEXT.md (locked decisions) + Phase 34 research/plans (gold-standard structure mirror) + Phase 33+34 codebase grounding (loop_engine.rs at 4751 lines, swarm.rs at 637 lines, session/list.rs with fork_session at L241 + validate_session_id at L454, agents/mod.rs with 8 AgentRoles, providers/mod.rs:362 default_model_for, config.rs:1565 cheap_model_for_provider) + external citations (AutoGen multi-agent, OpenHands swarm controller, Claude Code arxiv 2604.14228, mini-SWE-agent parallel mode, SWE-agent subagent, Kahn topological sort).*
