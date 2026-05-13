# BLADE — Agent-Native Architecture Audit

**Date:** 2026-05-12
**Methodology:** Compound-engineering `agent-native-audit` skill, 8 parallel subagents (one per principle), dispatched via general-purpose subagent type (Explore subagent rejected prompts over ~100 words). Each subagent enumerated, classified, scored, and recommended within its principle.

---

## Methodology note

This audit was run twice in one session:
- **Run 1 (superseded):** manual estimate by orchestrator after subagent dispatch hit a prompt-length limit. Confidence flagged "low–medium" on multiple principles. Scores were systematically too optimistic.
- **Run 2 (canonical, this document):** real parallel-subagent enumeration with actual file-level evidence.

Run 1 → Run 2 deltas: Capability Discovery 29% → 0%, CRUD 50% → 10%, Action Parity 60% → 44%, Tools as Primitives 70% → 92%, Prompt-Native 20% → 18%, Shared Workspace 85% → 20%, Context Injection 86% → 56% (dynamic-per-turn). The orchestrator-without-evidence is systematically too kind.

---

## Overall Score Summary

| # | Principle | Score | % | Status |
|---|-----------|-------|---|--------|
| 1 | Action Parity | 11/25 strict (44%); 13.5/25 with partials (54%) | 44% | ❌ |
| 2 | Tools as Primitives | 70/76 | 92% | ✅ |
| 3 | Context Injection | 10/18 dynamic-per-turn; 14/18 partial | 56% | ⚠️ |
| 4 | Shared Workspace | 7/35 full + 11/35 partial = 18/35 | 51% (partial-shared), 20% (fully) | ❌ |
| 5 | CRUD Completeness | 2/20 full CRUD; 0/20 strict | 10% | ❌ |
| 6 | UI Integration | 9/15 | 60% | ⚠️ |
| 7 | Capability Discovery | 0/7 at "present" quality | 0% | ❌ |
| 8 | Prompt-Native Features | 4/22 (with mixed as half: 7/22) | 18% (32% with mixed) | ❌ |

**Weighted overall: ~37%.** BLADE has unusually strong primitives (92%) and chat-streaming UI integration, but everything else — capability discovery, prompt-native features, entity CRUD, life-OS shared workspace — scores at or below 50%. The Run-1 estimate of 60% was systematically too kind across exactly the dimensions hardest to estimate without subagent evidence.

---

## Headlines by principle

### 1. Action Parity — 44%
Agent can drive the OS (bash, files, browser, UI automation, system control, screen capture). Agent **cannot** do anything in the life-OS pillars the README pitches: log a habit, add a transaction, create a goal, log a meal. 14 frontend domain wrappers (`knowledge.ts`, `life_os.ts`, `identity.ts`, `voice.ts`, `sessions.ts`, `window.ts`, `intelligence.ts`) have **zero** corresponding tools in the LLM-exposed registry. Top single fix: build-time codegen from the `invoke()` registry to tool-definitions so the gap can't widen by accident.

### 2. Tools as Primitives — 92%
The strongest dimension. 70/76 native tools are correctly atomic. The 6 workflow violations cluster around autonomous loops (`blade_computer_use`, `blade_browser_agent_loop`) and routing policy (`blade_spawn_coding_agent` encodes "if refactor → Claude Code; if TDD → Aider" in tool body). These should become prompt fragments + the existing primitives.

### 3. Context Injection — 56% dynamic per turn
The system prompt assembles from 25+ modules — hormones, vitality, character bible, OCR, audio, persona, KG, integrations. Real strength: brain.rs line 891 dynamically injects "High cortisol: be terse, action-focused…" — internal state is real, not theater. **Missing**: active frontend route (model never knows if user is on Dashboard vs Settings), session-history summary (only raw messages, no compression), last-N tool calls (the model can't see what it just did, leading to repeat-asks), focused file path, full config surface. Top single fix: inject active route + last 5 UI events as a 50-token block — costs nothing, biggest "model knows what's happening" win.

### 4. Shared Workspace — 51% partial, 20% fully shared
**Inverted anti-pattern.** BLADE doesn't have a sandboxed-agent problem (no shadow DB). It has the opposite: 17/35 stores are **user-UI-only with no agent tooling** (Health, Goals, Habits, Finance, Accountability, Negotiation, Predictions, Reasoning, Self-Critique, all written by the agent internally but never exposed back). Reasoning traces / metacognition / self-critique are agent-private dark data — agent writes them, neither side can introspect. Fix: `blade_db_query` + `blade_db_upsert` over an allowlist of safe tables closes 7 isolated stores in one move.

### 5. CRUD Completeness — 10%
**2/20 entities have full agent CRUD; 0/20 strict.** Typed memories, KG nodes, KG edges, people graph, goals, habits, meetings, skills, integrations — **the agent has zero ability to Create or Update them** despite being the substrate for BLADE's entire memory + relationship layer. Reminders + Cron have Create + Read but no Update + Delete (creating uncancellable reminders is a footgun). The Rust API is CRUD-complete; the gap is purely missing `ToolDefinition` registrations. Top single fix: `crud_tools!` macro over DB-backed structs auto-generates tools, prevents future drift.

### 6. UI Integration — 60%
Chat streaming + agent step lifecycle + hive/world + hormone/vitality + voice + ghost + deep-scan all wire correctly. **Silent actions found**: memory writes (`memory.rs`, `typed_memory.rs`, `people_graph.rs` emit nothing → MemoryPalace shows stale data), KG mutations (`brain_grew` event exists but **no React subscriber**), `tool_result` constant exists with **no Rust emit site + no UI listener**, `timeline_tick` / `audio_timeline_tick` events emitted but unsubscribed (ScreenTimeline polls every 30s instead — wasted channel). Top single fix: lint-gate orphan events — every `BLADE_EVENTS.X` constant needs ≥1 Rust emit + ≥1 useTauriEvent consumer.

### 7. Capability Discovery — 0%
**Worst dimension. Zero of 7 mechanisms reach "present" quality.** No `/help`, no `/tools`, no `/capabilities` slash command (explicitly deferred at QuickAskText.tsx:14 to "Phase 9" and never landed). Chat empty state is a blank `<div>` — no suggested prompts. Onboarding (Steps.tsx + ApiKeyEntry + DeepScanStep + PersonaQuestions) teaches *configuration*, not capabilities. The Rust command `forge_list_tools` exists at `admin.ts:1795` but has **no UI consumer**. A user finishes onboarding knowing their API key works, not that BLADE can watch their screen, drive browsers, or spawn agent swarms. Highest-ROI v1.6 work: chat empty-state with 6 suggested-prompt chips + slash-command handler in InputBar that calls existing `forge_list_tools`.

### 8. Prompt-Native Features — 18%
~11,400 LOC of code-defined verticals could become ~500 LOC of prompts + tools. Worst offenders (LOC-weighted):
1. `security_monitor.rs` (1,718) — pattern-match heuristics that bash + curl + prompt would replicate in 50 lines
2. `financial_brain.rs` (1,315) — category math + bank-format parsing; LLM + read_csv + prompt collapses ~1,200 LOC
3. `persona_engine.rs` (1,317) — 5 hardcoded trait dimensions; should be one synthesis prompt
4. `evolution.rs` (1,153) — static MCP catalog; should be a tool
5. `pulse.rs` (1,094) — trigger gymnastics for `cron → prompt → emit`
6. `proactive_engine.rs` (1,080) — 6 hardcoded detectors; collapses to "given perception state, should I nudge?" prompt
7. `dream_mode.rs` (1,066) — orchestration the agent could schedule itself
8. `goal_engine.rs` (987) — decomposition loop = Plan-Execute-Reflect prompt
9. `kali.rs` (1,337) — prompt-native but trapped as `&'static str` (can't edit without recompile)
10. `health_guardian.rs` (316) — pure rules engine pretending to be intelligence

**Critical:** the v1.6 cut list in VISION.md matches this list almost perfectly. The cut list IS the agent-native correction. Confirmed.

---

## Top 10 Recommendations (ordered by impact)

| # | Action | Principle | Effort |
|---|--------|-----------|--------|
| 1 | Replace top 6 code-defined verticals (security_monitor, financial_brain, persona_engine, evolution, pulse, proactive_engine) with primitives + prompts | 8, 2 | L (1-2 wk) |
| 2 | Chat empty-state with 6 suggested-prompt chips via existing `EmptyState` primitive | 7 | S (hours) |
| 3 | Slash command handler in `InputBar.tsx` wiring `/help`, `/tools`, `/capabilities` (data already exists via `forge_list_tools`) | 7 | S (hours) |
| 4 | `crud_tools!` macro over DB-backed structs → auto-CRUD for 15+ entities | 5 | M (1-2 days) |
| 5 | Build-time codegen from invoke() registry → tool definitions; prevents action-parity drift | 1 | M (1 day) |
| 6 | Inject active route + last 5 UI events + last-N tool calls as `## Recent Context` block | 3 | S (hours) |
| 7 | Wire `MemoryPalace` + `KnowledgeGraph` to `brain_grew` + new `memory_written` event; kill silent-action anti-pattern | 6 | S (hours) |
| 8 | `blade_db_query` + `blade_db_upsert` over allowlisted tables; closes 7 isolated life-OS stores | 4 | M (1 day) |
| 9 | Move `kali.rs` security prompt + `DEFAULT_BLADE_MD` to `prompts/*.md` loaded at runtime; enables prompt edits without recompile | 8 | S (hours) |
| 10 | 5th onboarding step "What BLADE can do" — 6 capability cards with deep-link "try it" CTAs | 7 | S (hours) |

---

## What this changes about v1.6

**The v1.6 cut list is correct; the framing was wrong.** VISION.md framed it as a narrowing pass. The agent-native audit reframes it as the architectural correction. Same code action, different consequences:

- v1.6 isn't "delete 14,000 LOC because the verticals don't fit the consumer-AI thesis." It's **"shift 11,400 LOC from code to prompts + tools so the agent can actually be agent-native."**
- Recommendations 1-10 are the v1.6 phase shape. Rec #1 = phase 1 (verticals → prompts). Recs #2, #3, #10 = phase 2 (capability discovery — the 0% gap, biggest unforced loss). Rec #4 = phase 3 (CRUD macro). Rec #5 = phase 4 (codegen — prevents drift). Recs #6-9 = phase 5 (context injection + silent-action fixes + prompts/dir migration).
- This shape is **5 phases**, not the original 5-phase narrowing-pass shape — different ordering, same count. Each phase has a measurable score delta (re-run this audit at v1.6 close).

---

## Addendum — Orphan emit audit (2026-05-12)

Follow-up to the UI Integration finding ("248 emits, 40 subscribers"). Properly resolved against the `BLADE_EVENTS` constants table:

- 202 unique event names emitted from `src-tauri/src/` (via `app.emit / emit_to / emit_all / app_handle.emit / window.emit`)
- 106 events defined in `src/lib/events/index.ts` constants (React-side subscription mechanism)
- **120 emits have NO entry in BLADE_EVENTS AND no direct `useTauriEvent` / `listen` consumer**

That's 59% of emits with no documented consumer. Caveat: ~20-40 of these likely have indirect consumers (activity-log ring buffer wrapping, per-window subscribers in `quickask.html` / `voice_orb.html` / `ghost_overlay.html`, hook scripts). True orphan count: 80-100 events. Headline finding holds.

Top dead-emit clusters by prefix:
- `blade_*` (14) — various status events without consumers
- `agent_*` (13) — agent lifecycle events; some may be intentional fire-and-forget for logging
- `auto_fix_*` (7) — CI auto-fix pipeline events; likely backend-only for hooks
- `swarm_*` / `proactive_*` / `dream_*` / `clipboard_*` / `autoskill_*` / `audio_*` — 4 each
- `task_*`, `computer_*`, `whisper_*`, `sudo_*`, `runtime_*`, `meeting_*` — 2-3 each

This becomes v1.6 phase work: lint-gate that every Rust emit either (a) has a corresponding `BLADE_EVENTS` constant + ≥1 useTauriEvent consumer, OR (b) is explicitly tagged as backend-only via a code comment. Catches the next 100 from accumulating.

Files: `/tmp/blade_emits.txt`, `/tmp/blade_orphan_emits_v3.txt` (regenerable via the audit grep in surprises.md).

---

## Revision history

- **2026-05-12 v1** — Manual estimate (60% overall). Superseded by v2.
- **2026-05-12 v2** — Parallel-subagent audit (~37% overall). Canonical.
- **2026-05-12 v2 addendum** — Orphan emit audit. 120 likely orphans / 202 emits (59%). Lint-gate proposal added to v1.6 phase work.
- **Next:** re-run at v1.6 close. Targets per principle: Discovery 0% → 60%, Prompt-Native 18% → 60%, CRUD 10% → 70%, Action Parity 44% → 75%, Shared Workspace 20% → 60%. Orphan emits 120 → <20.

---

*Audit run by 8 parallel general-purpose subagents on 2026-05-12 in response to Arnav calling out repeated "stop at the boundary of the named unit of work" failure. The full subagent transcripts are recoverable from the session log.*
