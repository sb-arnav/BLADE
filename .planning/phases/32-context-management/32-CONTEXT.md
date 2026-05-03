# Phase 32: Context Management — Context

**Gathered:** 2026-05-03
**Status:** Ready for planning
**Source:** Synthesised directly from ROADMAP.md, REQUIREMENTS.md, STATE.md, and codebase grounding (autonomous decisions per Arnav's instruction; no interactive discuss-phase)

<domain>
## Phase Boundary

**What this phase delivers:**
Brain.rs injects only what each query actually needs. The condenser fires proactively at ~80% capacity, the middle conversation is LLM-summarised, individual tool outputs are capped, and a context budget breakdown is visible in DoctorPane. All of it falls back to the current naive path if anything throws.

**What this phase does NOT touch:**
- The agentic tool loop itself (Phase 33 — LOOP-01..06)
- Stuck detection, circuit breakers, cost guards, session persistence (Phase 34)
- Auto-decomposition / sub-agents (Phase 35)
- Tree-sitter repo map, capability registry, @context-anchor (Phase 36)
- Any UI work beyond a DoctorPane token-breakdown panel (chat-first pivot — UI debt is paused)

**Why this is the strict dependency root for v1.5:**
Every other phase (LOOP, RES, DECOMP, INTEL) sits on top of a clean context pipeline. If selective injection or compaction is unstable, every downstream phase inherits the instability. Phase 32 is the first phase of v1.5 by hard ordering — Phase 33 and 36 cannot start until Phase 32 lands.

</domain>

<decisions>
## Implementation Decisions

### Selective Context Injection (CTX-01, CTX-02)

- **Locked: Extend `score_context_relevance` gating to ALL brain.rs sections, including identity (0), vision (1), hearing (2), memory (3..8).** Today the gate is only applied to sections 9+ (schedule, code, security, health, system, financial, etc.). A "what time is it?" query currently still gets full identity / character bible / OCR / hormones — that is the regression CTX-01 closes.
- **Locked: Keep the existing `score_context_relevance(query, context_type)` API.** It already returns a 0..1 float and is callable per section. Don't replace it; extend the gate threshold and the per-section call sites in `build_system_prompt_inner`.
- **Locked: A small core remains unconditional.** Identity tone (1–2 sentences), the system invariants (date/time, persona name), and the active tool list are always injected — the gating applies to the heavy sections (full character bible, full OCR, full hormones, full memory dumps, full vision/hearing transcripts). Without this, the assistant loses minimum coherence on simple queries.
- **Locked: Gate threshold is configurable.** Reuse the existing `gate` variable pattern in `build_system_prompt_inner` (currently 0.2 / 0.5 thresholds per section). Single config knob: `BladeConfig.context.relevance_gate` (default 0.2). Don't fragment per section.
- **Claude's discretion:** Concrete keyword/embedding mix inside `score_context_relevance`. The current implementation is keyword-based; if the planner finds a low-cost embedding similarity bolt-on improves accuracy without latency cost, that's fine. Keep it cheap — this fires on every turn.

### Proactive Compaction (CTX-03, CTX-04)

- **Locked: Keep the existing `compress_conversation_smart` skeleton — keep first ~8k (system + original task) + last ~8k (recent work), LLM-summarise the middle.** The function already implements that shape (`commands.rs:179`). The defect is the trigger threshold and timing.
- **Locked: Trigger at ~80% of the model's actual context capacity, not at the hardcoded 140k.** Use the model's true context length from the providers/router metadata (anthropic = 200k, etc.). 80% of that is the trigger. The existing 140k literal at `commands.rs:1488` is wrong for any non-200k model.
- **Locked: Compaction emits a `blade_status: "compacting"` indicator.** Acceptable implementations (Phase 32 — pick one and document in plan):
  - **Option A (preferred ideal):** truly async via `tokio::spawn` — does not block the next reply; if a reply lands before compaction returns, use the uncompacted conversation, compaction takes effect next iteration.
  - **Option B (acceptable per RESEARCH.md §CTX-04):** synchronous `compress_conversation_smart().await` with the indicator emitted *before* the await. Blocks the next reply but UX surfaces the wait. Defer Option A migration to Phase 33 (LOOP) where loop-level async restructuring lands.
  - Either option satisfies the lock as long as the indicator fires and the v1.1 fallback (CTX-07) wraps the call.
- **Locked: Use the cheapest model on the active provider for the summary call.** `cheap_model_for_provider` already exists and is used by `compress_conversation_smart` — keep it.
- **Locked: Compaction summary is preserved in conversation as a `[Earlier conversation summary]` user message** (matches existing pattern at `commands.rs:255`). Do not invent a new message variant.
- **Claude's discretion:** Whether to keep "first 8k" as token-counted or message-counted, and the exact summary prompt wording. Current keep-recent = 8 messages — token-aware is better but not blocking.

### Tool Output Caps (CTX-05)

- **Locked: Cap individual tool outputs at a configurable budget (default ~4k tokens) before they enter the conversation.** Today, large bash outputs / file reads can drop 50k tokens into a single tool result message and blow the budget on one call.
- **Locked: When capped, append a structured summary to the truncated content.** Format: original first ~3k tokens + last ~500 tokens + a summary like `[truncated from N tokens; M tokens omitted in middle; original available via storage_id <id>]`. The "head + tail + summary" shape mirrors the conversation condenser.
- **Locked: Capping happens at the boundary where tool results are added to the conversation, not inside individual tools.** The boundary is in commands.rs (the tool-loop branch) and in the streaming path. Centralise the cap function so all entry points hit it.
- **Locked: Cap budget is per-tool-output, not aggregate.** Aggregate is handled by compaction.
- **Claude's discretion:** Exactly where to persist the original full output (DB, in-memory ring buffer, on-disk JSON). Persisting is nice-to-have for debugging — phase 32 must at least preserve enough that the assistant can pull a follow-up section if needed. Recommend a simple `tool_output_archive` table or in-memory map keyed by storage_id; the reach-back tool is a phase-33+ concern.

### Context Budget Dashboard (CTX-06)

- **Locked: DoctorPane.tsx gets a per-section token breakdown panel.** DoctorPane already exists (`src/features/admin/DoctorPane.tsx`). Add a new section that shows tokens used per brain.rs section: identity, character, hearing, vision, memory, schedule, code, security, health, system, financial, recent, tools.
- **Locked: Backend command emits the breakdown.** Add a Tauri command (e.g. `get_context_breakdown`) that returns the most recent injection's per-section token counts. Brain.rs must record this per-call (a thread-local or per-call accumulator).
- **Locked: This is debug surface, not production polish.** No bespoke design system work. Reuse existing DoctorPane patterns (collapsible sections, monospace tables) — the chat-first pivot means we don't invest UI design effort here.
- **Locked: The breakdown updates per turn.** Each `send_message_stream` invocation overwrites the last breakdown; the panel shows "last query: N tokens / model context: M tokens / X% used".
- **Claude's discretion:** Whether to keep a small history (last 10 turns) for trend detection. Optional polish if it falls out cheap.

### Fallback Guarantee (CTX-07)

- **Locked: Every selective-injection and compaction code path is wrapped to fall back to the current naive path on any error.** Errors include: panics in `score_context_relevance`, failed cheap-model summary calls, tool-output cap failures, breakdown command failures. None of them may crash the chat or stall a reply.
- **Locked: Fallback is silent to the user.** Log a structured trace to disk (existing `trace::log_trace` pattern), do not surface a banner. The user only sees a banner if the *naive* path also fails — that's already covered by `chat_error` events.
- **Locked: A regression test fixture exists for the v1.1 lesson.** A failing `score_context_relevance` (e.g. it returns NaN) must not break the chat — write a fixture that injects a panic and asserts the chat still returns a reply.
- **Locked: The "smart path" must be feature-flag-toggleable** at runtime via `BladeConfig.context.smart_injection_enabled` (default true). If a user reports a regression, they can flip back to naive without a rebuild. This is the v1.1 lesson incarnate: smart path must never be the only path.
- **Claude's discretion:** Whether to add a chaos test (randomly fail compaction every Nth call) — useful but not blocking.

### Module Boundaries

- **Locked: All changes land in existing modules.** No new top-level Rust modules unless absolutely necessary.
  - Selective injection & breakdown: `brain.rs` (extend existing)
  - Compaction trigger: `commands.rs` (rewire existing call site)
  - Tool output cap: `commands.rs` (new helper) or a small `tool_output_cap.rs` if it gets large
  - Config fields: `config.rs` (six-place rule, see CLAUDE.md)
  - Frontend panel: `DoctorPane.tsx` (extend existing)
- **Locked: Six-place config rule applies** to every new BladeConfig field (see CLAUDE.md). Don't skip it.
- **Locked: `safe_slice` is mandatory** for any new string-slice on user/conversation/tool content.

### Testing & Verification

- **Locked: A new verify gate is NOT added in this phase.** verify:intelligence is Phase 37's responsibility (EVAL-05). Phase 32 only adds unit tests + the regression fixture.
- **Locked: Runtime UAT is required per CLAUDE.md Verification Protocol.** Static gates are insufficient. The UAT script must:
  1. Open dev binary
  2. Send "what time is it?" → assert reply renders, assert breakdown shows < N tokens for the heavy sections (identity-only would be ~1k, full-injection would be ~30k)
  3. Send a code query → assert breakdown shows code section populated
  4. Send a long bash command → assert tool output shows cap message
  5. Trigger compaction → confirm UI shows indicator, conversation continues
  6. Forcibly fail selective injection (test toggle) → assert reply still renders (CTX-07)
  7. Screenshot DoctorPane breakdown panel at 1280×800 + 1100×700, save under `docs/testing ss/`
- **Locked: tsc --noEmit + cargo check must remain clean.** No regressions in existing 37 verify gates.

### Claude's Discretion (catch-all)

- File-level layout inside `brain.rs` and `commands.rs` (split or keep monolithic — current files are 1900 / 3300 lines respectively; if a logical split helps, do it, but don't bikeshed module shape)
- Exact threshold values inside relevance scoring (current 0.2 / 0.5 are heuristic; tune based on observed token reduction)
- Whether the breakdown panel uses the existing toast/notification system or its own collapsible drawer in DoctorPane
- Whether tool output caps include or exclude images/binary content (recommend: exclude binaries from token count, treat as a single "[image]" placeholder)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 32 row + success criteria + sequencing
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — CTX-01..07 verbatim
- `/home/arnav/blade/.planning/STATE.md` — v1.5 milestone state, key decisions table
- `/home/arnav/blade/.planning/PROJECT.md` — Project core value (read for tone)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (six-place config, safe_slice, verification protocol, what-not-to-do list)
- `/home/arnav/CLAUDE.md` — workspace defaults (Tauri 2 + React + Tailwind v4)

### Code Anchors (must read to plan accurately)
- `src-tauri/src/brain.rs` — `build_system_prompt_inner` (line 456), `score_context_relevance` (line 218), section gating call sites (lines 929–1152). Sections 9+ already gated; phase 32 extends to 0–8 and adds breakdown recording.
- `src-tauri/src/commands.rs` — `compress_conversation_smart` (line 179), tool loop (line 1497), 140k threshold call site (line 1488), `classify_api_error` + `TruncateAndRetry` (line 274). The 12-iteration loop here is **NOT** modified by Phase 32 (that is Phase 33's scope).
- `src-tauri/src/config.rs` — `BladeConfig` / `DiskConfig` six-place pattern. New `context` sub-struct lives here.
- `src-tauri/src/providers/mod.rs` — model context-length metadata (used to compute 80% threshold)
- `src/features/admin/DoctorPane.tsx` — existing debug surface; phase 32 extends it.

### Research Citations (locked in v1.5 milestone)
- arxiv 2604.14228 — Claude Code architecture (selective injection, agent loop)
- Aider repo map — used in Phase 36, NOT this phase
- OpenHands condenser — keep-first / keep-last / summarise-middle pattern (this phase ports the shape)
- Goose capability registry — used in Phase 36, NOT this phase
- mini-SWE-agent — used in Phase 33, NOT this phase

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — BLADE memory index (chat-first pivot, UAT rule, ghost CSS tokens, streaming contract)
- `docs/testing ss/` (path has a literal space) — UAT screenshot storage

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete code patterns to reuse (not invent):**
- Section gating in brain.rs already uses the pattern `if !user_query.is_empty() && score_context_relevance(user_query, "X") > gate { ... }` — repeat this for sections 0–8.
- Compaction already uses `to_compress: Vec<String>` + cheap-model summary call + `[Earlier conversation summary]` user message replacement. Phase 32 changes the trigger, not the body.
- Tauri command pattern from CLAUDE.md: `#[tauri::command] pub async fn get_context_breakdown(app: tauri::AppHandle) -> Result<ContextBreakdown, String>`. New command needs `mod brain;` already exists in lib.rs; just add to `generate_handler![]`.
- Frontend invoke pattern: `await invoke<ContextBreakdown>("get_context_breakdown")` inside DoctorPane on a 2s polling interval (or on `chat_done` event listener — preferred, no polling needed).

**Concrete config additions (six-place rule applies to each):**
```rust
pub struct ContextConfig {
    pub smart_injection_enabled: bool,   // default true; CTX-07 escape hatch
    pub relevance_gate: f32,             // default 0.2
    pub compaction_trigger_pct: f32,     // default 0.80
    pub tool_output_cap_tokens: usize,   // default 4000
}
```
Add `context: ContextConfig` field to `BladeConfig` and `DiskConfig`. Default impl, load_config, save_config — six places per CLAUDE.md.

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't run `cargo check` after every edit — batch first, check at end.
- Don't add Co-Authored-By lines.
- Don't use `&text[..n]` on user content — use `safe_slice`.
- Don't claim the phase is "done" because static gates pass — runtime UAT per CLAUDE.md.

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 32 scope:

- **Embeddings-based relevance scoring** — current `score_context_relevance` is keyword-based. An embeddings bolt-on would improve accuracy but adds inference latency. Park for v1.6 unless cheap.
- **Persistent tool-output archive with reach-back tool** — Phase 32 truncates with summary, but a "fetch full output for storage_id X" tool is more naturally a Phase 33 (LOOP) feature.
- **Repo map injection (tree-sitter / PageRank)** — Phase 36 (INTEL-01..03), not this phase.
- **Token cost tracking + cost guard** — Phase 34 (RES-03, RES-04), not this phase.
- **Stuck detection / circuit breaker** — Phase 34 (RES-01, RES-02).
- **Mid-loop verification ("are we progressing?")** — Phase 33 (LOOP-01).
- **DoctorPane visual polish** — chat-first pivot defers UI design work; this phase ships a functional debug panel only.
- **Chaos testing of fallback path** — useful but not blocking; recommend if cheap.

</deferred>

---

*Phase: 32-context-management*
*Context gathered: 2026-05-03 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / STATE.md / CLAUDE.md / live codebase grounding.*
