# Requirements: BLADE

**Defined:** 2026-05-03
**Core Value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.

## v1.5 Requirements

Requirements for the Intelligence Layer milestone. Each maps to roadmap phases.

### Context Management

- [ ] **CTX-01**: Brain.rs gates ALL context sections by query relevance — a "what time is it?" gets calendar context, not screen OCR + hormones + character bible
- [ ] **CTX-02**: Thalamus relevance scoring extends to sections 0-8 (identity, vision, hearing, memory), not just 9-16
- [ ] **CTX-03**: Condenser compaction: keep first ~8k tokens (system + original task) + last ~8k (recent work), LLM-summarize the middle
- [ ] **CTX-04**: Compaction fires proactively at ~80% context capacity, not reactively at 140k overflow
- [ ] **CTX-05**: Individual tool outputs capped at configurable budget (default ~4k tokens) before entering conversation — large file reads and bash outputs truncated with summary
- [ ] **CTX-06**: Context budget dashboard — tokens used per section visible in DoctorPane or debug view
- [ ] **CTX-07**: Fallback guarantee — if selective injection or compaction fails, gracefully degrade to current naive path (never crash the chat)

### Agentic Loop

- [ ] **LOOP-01**: Mid-loop verification every 3 tool calls — inject "are we progressing toward the original goal?" check
- [ ] **LOOP-02**: Structured error feedback — tool failures return reasons + what was attempted + suggested alternatives, not just error strings
- [ ] **LOOP-03**: Plan adaptation — if step N of the plan fails, re-plan from current state instead of blindly retrying
- [ ] **LOOP-04**: Max-output-token escalation — if response truncated, auto-retry with higher token budget
- [ ] **LOOP-05**: Fast-streaming path includes ego intercept (fix the ego-blind gap)
- [ ] **LOOP-06**: Iteration limit raised from 12 to configurable (default 25) with cost guard

### Resilience

- [ ] **RES-01**: Stuck detection — 5 semantic patterns checked every iteration: repeated action/observation pairs, monologue spirals, context-window thrashing, no-progress loops, cost runaway
- [ ] **RES-02**: Circuit breaker — after N consecutive same-type failures, escalate to user with summary of what was tried
- [ ] **RES-03**: Token cost tracking per conversation — running total visible to user
- [ ] **RES-04**: Cost guard — configurable per-conversation spend cap, warn at 80%, hard stop at limit
- [ ] **RES-05**: Graceful degradation on provider errors — retry with backoff, then fallback to next provider in chain, then surface to user

### Auto-Decomposition

- [ ] **DECOMP-01**: Brain planner detects 5+ independent steps and auto-triggers swarm decomposition
- [ ] **DECOMP-02**: Sub-agents spawn with isolated context windows (own conversation, own compaction)
- [ ] **DECOMP-03**: Only summary text returns to parent conversation — no history inflation
- [ ] **DECOMP-04**: Conversation forking — user can branch a conversation for a tangent, merge results back
- [ ] **DECOMP-05**: Sub-agent progress visible in chat (streaming status, not silent background)

### Context Intelligence

- [ ] **INTEL-01**: Tree-sitter parsing of code files into symbol dependency graph in knowledge_graph.rs
- [ ] **INTEL-02**: PageRank scoring over symbol graph, personalized by chat context (Aider pattern)
- [ ] **INTEL-03**: Repo map injected into code-related queries within token budget (default ~1k tokens)
- [ ] **INTEL-04**: canonical_models.json capability registry — each provider/model's known capabilities (context length, tool_use, vision, cost/token) formalized and testable
- [ ] **INTEL-05**: Router.rs consumes capability registry for transparent model selection
- [ ] **INTEL-06**: @context-anchor chat syntax — @screen, @file:path, @memory:topic as explicit context injection alongside ambient context

### Session Persistence

- [ ] **SESS-01**: Append-only JSONL conversation log — every message, tool call, and result persisted
- [ ] **SESS-02**: Session resume — reopen app, pick up where you left off, reconstructed from last compact boundary
- [ ] **SESS-03**: Session list — browse and resume past conversations
- [ ] **SESS-04**: Session forking — branch from any point in conversation history

### Eval + Close

- [ ] **EVAL-01**: Multi-step task completion benchmark — same 10 tasks run before and after v1.5, measure completion rate
- [ ] **EVAL-02**: Context efficiency metric — tokens consumed per task complexity unit
- [ ] **EVAL-03**: Stuck detection accuracy — synthetic stuck scenarios, measure detection rate
- [ ] **EVAL-04**: Compaction fidelity — verify critical context preserved after compression cycles
- [ ] **EVAL-05**: verify:intelligence gate extending existing 37-gate chain

## Future Requirements

Deferred to v1.6+. Tracked but not in current roadmap.

### Organism Surfacing
- **OSRF-01**: Hormones/vitality/metacognition visible and felt in chat responses
- **OSRF-02**: Active inference narration ("your calendar is packed — keeping responses short")
- **OSRF-03**: Dream mode visible — show overnight consolidation results

### Voice
- **VOICE-01**: JARVIS-01/02 push-to-talk resurrection
- **VOICE-02**: Conversational voice mode polish

### Distribution
- **DIST-01**: Persona shaping via curated SFT data
- **DIST-02**: Federation Pattern A + selection mechanisms
- **DIST-03**: Profile isolation (work/personal split)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| UI redesign / polish pass | v1.5 is intelligence-only; UI work deferred per chat-first pivot |
| New tentacle classes | No new organ/tentacle capabilities until v2+ (M-01 anchor) |
| Voice resurrection | UX feature, not intelligence; v1.6 |
| Organism UI surfacing | Backend works; making it visible is v1.6 |
| Phase 19 UAT close (23 items) | UI polish debt; deferred per chat-first pivot |
| Rewriting providers/ | Port, don't reinvent; adapt existing provider system |
| Building tree-sitter from scratch | Use existing tree-sitter Rust crates (tree-sitter, tree-sitter-*) |
| Custom LLM fine-tuning | Out of scope permanently; BLADE uses API providers |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CTX-01 | — | Pending |
| CTX-02 | — | Pending |
| CTX-03 | — | Pending |
| CTX-04 | — | Pending |
| CTX-05 | — | Pending |
| CTX-06 | — | Pending |
| CTX-07 | — | Pending |
| LOOP-01 | — | Pending |
| LOOP-02 | — | Pending |
| LOOP-03 | — | Pending |
| LOOP-04 | — | Pending |
| LOOP-05 | — | Pending |
| LOOP-06 | — | Pending |
| RES-01 | — | Pending |
| RES-02 | — | Pending |
| RES-03 | — | Pending |
| RES-04 | — | Pending |
| RES-05 | — | Pending |
| DECOMP-01 | — | Pending |
| DECOMP-02 | — | Pending |
| DECOMP-03 | — | Pending |
| DECOMP-04 | — | Pending |
| DECOMP-05 | — | Pending |
| INTEL-01 | — | Pending |
| INTEL-02 | — | Pending |
| INTEL-03 | — | Pending |
| INTEL-04 | — | Pending |
| INTEL-05 | — | Pending |
| INTEL-06 | — | Pending |
| SESS-01 | — | Pending |
| SESS-02 | — | Pending |
| SESS-03 | — | Pending |
| SESS-04 | — | Pending |
| EVAL-01 | — | Pending |
| EVAL-02 | — | Pending |
| EVAL-03 | — | Pending |
| EVAL-04 | — | Pending |
| EVAL-05 | — | Pending |

**Coverage:**
- v1.5 requirements: 38 total
- Mapped to phases: 0
- Unmapped: 38

---
*Requirements defined: 2026-05-03*
*Last updated: 2026-05-03 after initial definition*
