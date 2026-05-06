# Roadmap — BLADE

**Current Milestone:** v1.5 — Intelligence Layer
**Created:** 2026-05-03 | **Source:** Requirements + PROJECT.md + research citations (arxiv 2604.14228, Aider repo map, OpenHands condenser, Goose capability registry, mini-SWE-agent) + `/gsd-new-milestone`
**Phases:** 32–38 (continues global numbering per M-05/M-12; v1.4 ended at Phase 31)

---

## Milestones

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ Shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ Shipped (tech_debt) | 10–15 | 2026-04-27 |
| v1.2 | Acting Layer with Brain Foundation | ✅ Shipped (tech_debt) | 16–20 | 2026-04-30 |
| v1.3 | Self-extending Agent Substrate | ✅ Shipped | 21–24 | 2026-05-02 |
| v1.4 | Cognitive Architecture | ✅ Shipped | 25–31 | 2026-05-03 |
| **v1.5** | **Intelligence Layer** | 🔄 Active | **32–38** | — |

---

<details>
<summary>✅ v1.4 Cognitive Architecture (Phases 25–31) — SHIPPED 2026-05-03</summary>

## v1.4 Phases

| # | Phase | Goal | Requirements | Status |
|---|---|---|---|---|
| 25 ✅ | **Metacognitive Controller** | Confidence-delta detection, verifier routing, gap surfacing, gap log → evolution.rs, DoctorPane signal | META-01..05 | Shipped |
| 26 ✅ | **Safety Bundle** | Danger-triple HITL, mortality-salience cap, calm-vector bias, attachment guardrails, eval-gate vitality drain | SAFE-01..07 | Shipped |
| 27 ✅ | **Hormone Physiology** | 7 hormones with decay/gain, emotion classifier, behavioral modulation effects | HORM-01..09 | Shipped |
| 28 ✅ | **Active Inference Loop** | Tentacle predictions, prediction-error → hormone bus, closed demo loop, hippocampal replay | AINF-01..06 | Shipped |
| 29 ✅ | **Vitality Engine** | Scalar 0.0–1.0, 5 behavioral bands, SDT replenishment, dormancy/reincarnation | VITA-01..06 | Shipped |
| 30 ✅ | **Organism Eval** | Vitality dynamics, hormone-behavior, persona-stability, safety bundle evals; verify:organism gate | OEVAL-01..05 | Shipped |
| 31 ✅ | **Close** | README cites research, CHANGELOG, milestone audit, phase archive | CLOSE-01..04 | Shipped |

**Archive:** `milestones/v1.4-phases/`

</details>

---

## v1.5 Phases

### Summary Checklist

- [ ] **Phase 32: Context Management** — Gate all brain.rs context by query relevance; condenser compaction; tool output caps; context budget dashboard
- [ ] **Phase 33: Agentic Loop** — Mid-loop verification; structured error feedback; plan adaptation; token escalation; ego intercept; configurable iteration limit
- [ ] **Phase 34: Resilience + Session Persistence** — Stuck detection; circuit breaker; token cost tracking; cost guard; provider fallback; append-only JSONL log; session resume and list
- [ ] **Phase 35: Auto-Decomposition** — Brain planner → swarm auto-trigger; isolated sub-agent contexts; summary-only parent returns; conversation forking
- [ ] **Phase 36: Context Intelligence** — Tree-sitter + PageRank repo map; canonical_models.json capability registry; @context-anchor chat syntax
- [ ] **Phase 37: Intelligence Eval** — Multi-step task benchmarks; context efficiency; stuck-detection accuracy; compaction fidelity; verify:intelligence gate
- [ ] **Phase 38: Close** — README cites open-source agents; CHANGELOG; v1.5 milestone audit; phase archive

### Sequencing

```
   Phase 32 (Context Management)             FIRST — everything else depends on clean context pipeline
       │
       ├──────────────────┐
       ▼                  ▼
   Phase 33              Phase 36            Phase 33 (Loop) depends on CTX
   (Agentic Loop)        (Context            Phase 36 (Intel) depends on CTX
       │                  Intelligence)      Both can proceed after Phase 32
       │
       ├──────────────────┐
       ▼                  ▼
   Phase 34              Phase 34            Phase 34 (Resilience+Session) depends on LOOP
   (Resilience +         runs in order       SESS is orthogonal but SESS-04 forking
    Session)                                 feeds DECOMP-04; ship them together
       │
       ▼
   Phase 35 (Auto-Decomposition)             depends on LOOP + SESS for session storage + improved loop
       │
       ▼
   Phase 37 (Intelligence Eval)             validates everything; runs last before close
       │
       ▼
   Phase 38 (Close)                          gates on all prior phases
```

**Hard sequencing:** Phase 32 (CTX) is the strict dependency root — no other phase starts until context management is stable. Phase 33 (LOOP) and Phase 36 (INTEL) both depend on Phase 32 and can proceed in either order. Phase 34 (Resilience + Session) depends on Phase 33. Phase 35 (DECOMP) depends on Phase 33 and Phase 34. Phase 37 (Eval) gates on Phases 32–36. Phase 38 (Close) gates on Phase 37.

---

## Phase Details

### Phase 32: Context Management

**Goal**: Brain.rs injects only what each query actually needs — a "what time is it?" never gets OCR + hormones + character bible. The condenser fires proactively at 80% capacity, the middle conversation is LLM-summarized, individual tool outputs are capped, and a context budget is visible in DoctorPane.
**Depends on**: Nothing (first phase of v1.5)
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, CTX-07
**Success Criteria** (what must be TRUE):
  1. A simple query ("what time is it?") receives only calendar-relevant context; a code query receives repo context; an unrelated query receives neither — verified by token-count inspection in DoctorPane
  2. At ~80% of the context budget, compaction fires automatically: the condensed conversation contains the original task + recent work + an LLM-generated summary of the middle — not a raw truncation
  3. A bash command that returns 50k characters produces a tool output capped at ~4k tokens before entering the conversation, with a summary appended
  4. DoctorPane (or a debug view) shows a per-section token breakdown: identity, memory, screen, file, recent, etc.
  5. If selective injection or compaction throws any error, chat continues on the existing naive path — no conversation-ending crashes
**Plans:** 7 plans across 4 waves (Wave 1: 32-01, 32-02; Wave 2: 32-03, 32-04, 32-05; Wave 3: 32-06; Wave 4: 32-07) — **all 7 code-complete; runtime UAT operator-deferred per Arnav 2026-05-05**
- [x] 32-01-PLAN.md — ContextConfig (six-place rule) + ContextBreakdown wire type [Wave 1] ✓ commit b7b6ece + 0b6e16f
- [x] 32-02-PLAN.md — Test harness: CTX_SCORE_OVERRIDE seam + build_test_conversation fixture + integration target [Wave 1] ✓ commit 87355a5 + fdf3418
- [x] 32-03-PLAN.md — Selective injection: gate sections 0-8, extend score_context_relevance with identity/vision/hearing, LAST_BREAKDOWN accumulator (CTX-01, CTX-02) [Wave 2] ✓ commit 806fc08 + 0bbc6d4
- [x] 32-04-PLAN.md — Proactive compaction: per-model trigger, OpenHands v7610 prompt, token-aware keep_recent, blade_status emit (CTX-03, CTX-04) [Wave 2] ✓ commit e2f220e + 319128e
- [x] 32-05-PLAN.md — cap_tool_output helper + wiring at tool-conversation insertion + raise MAX_TOOL_RESULT_CHARS (CTX-05) [Wave 2] ✓ commit 719b497 + 20f842f
- [x] 32-06-PLAN.md — DoctorPane breakdown panel: get_context_breakdown Tauri command + ContextBudgetSection on chat_done event (CTX-06) [Wave 3] ✓ commit 5ffe812 + fe2fb9d (DoctorPane TLS bug from review fixed in 82d9a2c)
- [x] 32-07-PLAN.md — Fallback guarantee: catch_unwind wrappers + panic-injection regression test + phase-wide UAT checkpoint (CTX-07) [Wave 4] ✓ commit bb5d6ce (Task 1) + 82d9a2c (review fixes); Task 2 = checkpoint:human-verify, runtime UAT pending Arnav

### Phase 33: Agentic Loop

**Goal**: The main tool loop is no longer a naive 12-iteration for-loop. It verifies progress every 3 tool calls, adapts the plan when a step fails instead of retrying blindly, escalates token budget on truncation, fixes the ego-blind gap in the fast-streaming path, and runs up to 25 iterations with a cost guard.
**Depends on**: Phase 32
**Requirements**: LOOP-01, LOOP-02, LOOP-03, LOOP-04, LOOP-05, LOOP-06
**Success Criteria** (what must be TRUE):
  1. Every 3 tool calls, a progress check fires internally; if the check concludes the original goal is not being served, the loop re-plans before continuing — visible in ActivityStrip
  2. A tool that fails returns a structured object with what was tried, why it failed, and at least one suggested alternative — not a bare error string
  3. When a plan step fails, the loop produces a new plan from current state rather than retrying the same step; two consecutive plan adaptations are observable in a multi-step task
  4. A response that is truncated mid-sentence auto-retries with a higher max-output-token value; the retry resolves the truncation
  5. The fast-streaming path runs the ego intercept (LOOP-05), preventing the ego-blind gap from silently dropping accumulated identity context
  6. The iteration limit is configurable via settings (default 25) and a cost guard prevents runaway beyond the configured spend ceiling
**Plans:** 9 plans across 4 waves (Wave 1: 33-01, 33-02; Wave 2: 33-03; Wave 3: 33-04, 33-05, 33-06, 33-07; Wave 4: 33-08, 33-09) — **all 9 code-complete; runtime UAT operator-deferred per Arnav 2026-05-05**
- [x] 33-01-PLAN.md — LoopConfig sub-struct + 6-place wire-up (LOOP-06 substrate) [Wave 1] ✓ commits c4b0af5 + 3a6bcf8
- [x] 33-02-PLAN.md — loop_engine.rs scaffold + LoopState/LoopHaltReason/ToolError + wrap_legacy_error shim (LOOP-02 substrate) [Wave 1] ✓ commits d69aa81 + b4f8d9d
- [x] 33-03-PLAN.md — Lift commands.rs:1626 for-loop body into loop_engine::run_loop (LOOP-06 refactor) [Wave 2] ✓ commits 0d68b91 + 9754ee7 + c5598a8
- [x] 33-04-PLAN.md — Mid-loop verification probe via cheap_model_for_provider (LOOP-01) [Wave 3] ✓ commits 146a911 + 3bc2f08 + 049b2cb
- [x] 33-05-PLAN.md — ToolError boundary wiring + 3-same-tool replan trigger (LOOP-02, LOOP-03) [Wave 3] ✓ commits ccb0ac2 + abdb9e0
- [x] 33-06-PLAN.md — Truncation detection + max_tokens escalation with cost-guard interlock (LOOP-04) [Wave 3] ✓ commits ffbf73e + f9430de + 5150b17 + b85789d
- [x] 33-07-PLAN.md — build_fast_path_supplement closes Phase 18 KNOWN GAP (LOOP-05) [Wave 3] ✓ commits 23bf13f + 1e589fc + e36aed0
- [x] 33-08-PLAN.md — Cost guard runtime + ActivityStrip BLADE_LOOP_EVENT wiring + smart-off regression (LOOP-06 close-out) [Wave 4] ✓ commits b63e108 + b6707e5 + 3273aaa + e0874ab
- [x] 33-09-PLAN.md — Panic-injection regression test + checkpoint:human-verify UAT (phase closure) [Wave 4] ✓ commits da493b2 + 0edbd7a (Task 1); Task 2 = checkpoint:human-verify, runtime UAT pending Arnav

### Phase 34: Resilience + Session Persistence

**Goal**: The loop detects its own failure modes (stuck, runaway, thrashing) and surfaces them to the user before they waste tokens. Every conversation is persisted to an append-only JSONL log so sessions survive restarts and can be browsed and resumed.
**Depends on**: Phase 33
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05, SESS-01, SESS-02, SESS-03, SESS-04
**Success Criteria** (what must be TRUE):
  1. A synthetic stuck scenario (repeated action/observation pair 3+ times) triggers stuck detection and the user receives a summary of what was tried before the loop continues or halts
  2. After N consecutive same-type failures (configurable, default 3), the circuit breaker fires and surfaces a human-readable summary to the user — the loop does not continue silently
  3. A running token counter is visible in the chat UI; at 80% of the configured spend cap the user sees a warning; at 100% the loop halts gracefully with a message
  4. When a provider errors, the loop retries with backoff, then silently falls over to the next provider in the fallback chain — the user only sees a message if the full chain is exhausted
  5. After closing and reopening the app, the user can select their last session and pick up from the last compaction boundary — conversation history is reconstructed correctly
  6. The session list UI shows past conversations with timestamp, first message, and approximate token count; any session can be resumed or branched
**Plans:** 11 plans across 5 waves (Wave 1: 34-01, 34-02, 34-03; Wave 2: 34-04, 34-05; Wave 3: 34-06, 34-07; Wave 4: 34-08, 34-09; Wave 5: 34-10, 34-11) — **all 11 code-complete; runtime UAT operator-deferred per Arnav 2026-05-06**
- [x] 34-01-PLAN.md — ResilienceConfig + SessionConfig sub-structs (6-place rule × 2) [Wave 1] ✓ commit 45c0dfe + SUMMARY 04fa671
- [x] 34-02-PLAN.md — LoopState extensions (8 RES-01..04 fields) + LoopHaltReason::{Stuck, CircuitOpen} + sha2/ulid/fs2 deps [Wave 1] ✓ commits 917b8ca + 45c0dfe + bb41e63 + 65406aa
- [x] 34-03-PLAN.md — resilience/ + session/ module scaffold + SessionEvent enum + 4 Tauri command stubs [Wave 1] ✓ commits c7428b7 + 9541a7d + 5d120f0
- [x] 34-04-PLAN.md — RES-01 5-pattern stuck detection + run_loop iteration-top wire [Wave 2] ✓ commits 47e5c1d + 643e299 + 6bccd54
- [x] 34-05-PLAN.md — RES-02 circuit breaker (widen ERROR_HISTORY + CircuitOpen halt + reset-on-success) [Wave 2] ✓ commits 886652a + 89054c8 + 7dafd98
- [x] 34-06-PLAN.md — RES-03 + RES-04 per-conversation cost tracking + two-tier guard [Wave 3] ✓ commits 5a3d893 + 063171f + 6a0c2e9
- [x] 34-07-PLAN.md — RES-05 provider fallback chain + exponential backoff with jitter [Wave 3] ✓ commits 98037a5 + e514d59 + 866773f + 00ef194
- [x] 34-08-PLAN.md — SESS-01 SessionWriter (flock + catch_unwind + rotation) wired into 5 message-flow boundaries [Wave 4] ✓ commits 81aec33 + 76a4b3b + 9a25610
- [x] 34-09-PLAN.md — SESS-02 load_session replay from most-recent compaction boundary [Wave 4] ✓ commits f516297 + 24cdc88
- [x] 34-10-PLAN.md — SESS-03 list_sessions + SESS-04 fork_session + Tauri command registration [Wave 5] ✓ commits e06c690 + eab4d83 + 7f885f7 + 8ee46f0
- [x] 34-11-PLAN.md — Frontend integration (payloads, sessions.ts, ActivityStrip, SessionsView, cost-meter, route) + checkpoint:human-verify UAT [Wave 5] ✓ commits 126cdb9 + 0fd1544 + d228151 + f0e4dfd + 6fc8123 + d98f4db + 82f38a1 + d5588af; Task 6 = checkpoint:human-verify, runtime UAT pending Arnav

### Phase 35: Auto-Decomposition

**Goal**: When the brain planner detects a task with 5+ independent steps, it automatically fans out to parallel sub-agents. Each sub-agent runs in isolation — its own context window, its own compaction cycle. Only a summary returns to the parent. The user watches sub-agent progress stream in the chat.
**Depends on**: Phase 33, Phase 34
**Requirements**: DECOMP-01, DECOMP-02, DECOMP-03, DECOMP-04, DECOMP-05
**Success Criteria** (what must be TRUE):
  1. Given a task with 6 clearly independent steps, the loop automatically spawns sub-agents without requiring user input — the parent conversation shows "spawning N sub-agents for parallel execution"
  2. Each sub-agent's context window is isolated: one sub-agent accumulating 50k tokens does not affect the parent or sibling sub-agent contexts
  3. When a sub-agent completes, only its summary (not its full conversation) is returned to the parent — the parent conversation does not inflate by the sub-agent's token count
  4. A user can branch a conversation ("let me explore this tangent") and later merge the branch summary back — both the fork and the merge are explicit user actions with visible checkpoints
  5. Sub-agent progress streams into the chat as it happens — the user sees intermediate status, not a silent wait followed by a wall of text
**Plans**: TBD

### Phase 36: Context Intelligence

**Goal**: BLADE understands the shape of a codebase before injecting context. Tree-sitter parses symbols into a dependency graph, PageRank scores which symbols matter for this query, and a repo map is injected within token budget. Provider/model capabilities are formalized in a registry so routing decisions are transparent. @context-anchor syntax gives users explicit control over what BLADE sees.
**Depends on**: Phase 32
**Requirements**: INTEL-01, INTEL-02, INTEL-03, INTEL-04, INTEL-05, INTEL-06
**Success Criteria** (what must be TRUE):
  1. For a code-related query, BLADE injects a compact repo map (<= ~1k tokens) showing the most relevant symbols and their dependencies — derived from tree-sitter parsing and PageRank scoring, not a raw file list
  2. The repo map updates dynamically: a query about `commands.rs` produces a different map than a query about `brain.rs` — personalized by query context, not static
  3. `canonical_models.json` exists and is testable: a given provider+model combination has a documented context length, vision support flag, tool_use support flag, and cost-per-token; router.rs reads from it
  4. When a query requires vision and the active model has `vision: false` in the registry, router.rs transparently selects a vision-capable model without user intervention
  5. Typing `@screen` in the chat injects the current screen OCR context; `@file:path` injects the file content within budget; `@memory:topic` injects matching memory entries — each anchor is visually indicated in the message
**Plans**: TBD
**UI hint**: yes

### Phase 37: Intelligence Eval

**Goal**: The intelligence improvements are measured, not asserted. Ten representative tasks run before-and-after on the same binary; context efficiency, stuck-detection accuracy, and compaction fidelity are each quantified. A verify:intelligence gate joins the existing 37-gate chain.
**Depends on**: Phase 32, Phase 33, Phase 34, Phase 35, Phase 36
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05
**Success Criteria** (what must be TRUE):
  1. A before/after benchmark on 10 representative tasks shows measurable improvement in multi-step completion rate — results are logged to a fixture file, not just printed to terminal
  2. Context efficiency metric (tokens per task complexity unit) is lower after v1.5 than the pre-v1.5 baseline — compaction and selective injection produce a measurable reduction
  3. Stuck-detection accuracy on 5 synthetic stuck scenarios is >= 80% (detects stuck, does not false-positive on healthy loops)
  4. After N compaction cycles on a known conversation, the critical context elements (task goal, user constraints, key decisions) are still present and accurate in the compacted form
  5. `verify:intelligence` gate is green and the verify chain grows from 37 to 38 gates; all 37 existing gates remain green
**Plans**: TBD

### Phase 38: Close

**Goal**: v1.5 milestone closed with research-grounded README update, CHANGELOG entry, audit document, and phase archive — matching the v1.1/v1.2/v1.3/v1.4 closure shape.
**Depends on**: Phase 37
**Requirements**: (Close tasks — no standalone requirements; this phase delivers documentation and archival)
**Success Criteria** (what must be TRUE):
  1. README architecture section cites Claude Code (arxiv 2604.14228), Aider repo map, OpenHands condenser, Goose capability registry, and mini-SWE-agent with accurate characterizations of what BLADE ported from each
  2. CHANGELOG v1.5 entry lists all delivered features and the verify gate count change (37 → 38)
  3. `milestones/v1.5-MILESTONE-AUDIT.md` is written with phase coverage, requirements 3-source cross-reference, static gates, and executive verdict
  4. Phase 32–38 directories archived to `milestones/v1.5-phases/`; cargo check + tsc --noEmit + verify:all all exit 0
**Plans**: TBD

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 21. Skills v2 | v1.3 | — | Complete | 2026-05-01 |
| 22. Voyager loop closure | v1.3 | — | Complete | 2026-05-01 |
| 23. Verifiable reward + OOD eval | v1.3 | — | Complete | 2026-05-01 |
| 24. Skill consolidation in dream_mode | v1.3 | — | Complete | 2026-05-02 |
| 25. Metacognitive Controller | v1.4 | 3/3 | Complete | 2026-05-02 |
| 26. Safety Bundle | v1.4 | 4/4 | Complete | 2026-05-02 |
| 27. Hormone Physiology | v1.4 | 5/5 | Complete | 2026-05-02 |
| 28. Active Inference Loop | v1.4 | 4/4 | Complete | 2026-05-03 |
| 29. Vitality Engine | v1.4 | 6/6 | Complete | 2026-05-03 |
| 30. Organism Eval | v1.4 | 2/2 | Complete | 2026-05-03 |
| 31. Close | v1.4 | 4/4 | Complete | 2026-05-03 |
| 32. Context Management | v1.5 | 6/7 | In progress | — |
| 33. Agentic Loop | v1.5 | 0/TBD | Not started | — |
| 34. Resilience + Session Persistence | v1.5 | 0/TBD | Not started | — |
| 35. Auto-Decomposition | v1.5 | 0/TBD | Not started | — |
| 36. Context Intelligence | v1.5 | 0/TBD | Not started | — |
| 37. Intelligence Eval | v1.5 | 0/TBD | Not started | — |
| 38. Close | v1.5 | 0/TBD | Not started | — |

---

## Risk Register (v1.5)

| Risk | Phase impacted | Mitigation |
|---|---|---|
| Selective context injection creates regression in existing chat (wrong sections suppressed) | 32 | CTX-07 fallback guarantee: any injection failure degrades to naive path; carry forward full regression suite |
| Condenser LLM-summarize adds latency to every compaction cycle | 32 | Fire compaction async; user sees "compacting..." indicator; never blocks the reply path |
| Mid-loop verification (LOOP-01) adds a full LLM call every 3 tool calls — cost 3× on long tasks | 33 | Use a fast/cheap model for the progress check (configurable); gate on task complexity before enabling |
| Tree-sitter parsing may be slow on large repos (>10k files) | 36 | Incremental parsing on file-change events only; cache the symbol graph; PageRank runs on cached graph |
| Sub-agent isolation requires spawning multiple Tauri async tasks with separate context states | 35 | Extend swarm.rs with per-agent context isolation (already has DAG planner); sub-agent state is stack-allocated, not shared |
| Stuck detection false-positives on legitimate repetitive tasks (e.g., bulk file renames) | 34 | Pattern-match on semantic novelty, not syntactic repetition; operator-configurable sensitivity; always escalate-not-halt |
| Session JSONL can grow without bound for long-running power users | 34 | Per-session log file + compaction checkpoints; oldest logs rotate after configurable retention window |

---

## Notes

- **Phase numbering continues globally** per M-05/M-12. v1.5 starts at Phase 32; v1.6 starts at Phase 39 (or later if close phase shifts).
- **Activity log remains load-bearing.** All intelligence-layer events (context selection, compaction trigger, stuck detection, sub-agent spawn, repo-map injection) must emit to ActivityStrip.
- **Performance budgets carry forward.** Dashboard first paint ≤200ms, Voice Orb 60fps, max 3 backdrop-filter per viewport, blur caps 20/12/8px.
- **Verify gates extend, not replace.** v1.5 adds `verify:intelligence` (37 → 38). All 37 existing gates must remain green throughout.
- **Static gates ≠ done** per CLAUDE.md Verification Protocol. Chat regression testing is mandatory after any loop change — the v1.1 lesson applies.
- **Loop changes must not break existing chat.** CTX-07 and LOOP fallback guarantees are hard requirements, not optional polish.
- **Port, don't reinvent.** Aider repo map → adapt `tree-sitter` + `tree-sitter-*` Rust crates. OpenHands condenser → adapt keep-edges-summarize-middle. Goose capability registry → adapt `canonical_models.json` shape. MIT/Apache only.
- **Phase 36 (Context Intelligence) can proceed in parallel with Phase 33 (Loop)** once Phase 32 (CTX) lands. They have no inter-dependency; sequencing them for planning purposes only.

---

*Last updated: 2026-05-03 — v1.5 roadmap created. 7 phases (32–38), 38 requirements mapped, 100% coverage. Ready for planning.*
