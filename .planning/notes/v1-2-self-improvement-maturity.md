---
title: "v1.2 prep — self-improvement / memory / body maturity audit"
date: 2026-04-27
status: audit
audience: v1.2 milestone shape input
related:
  - v1-2-ideation-arnav.md (the questions)
  - v2-vision-tentacles.md (long-arc destination)
question_answered: >
  "The self upgrade and doctor, how grown are they?"
  "How good is memory management?"
  "How many hormones and other things actually exist? How close are we to human body?"
---

# Self-improvement / memory / body maturity — quick audit

Concrete answers to the questions Arnav dumped during the v1.1.0 release wait. Read-only audit; no code changes proposed yet — this is input for the v1.2 anchor decision.

## TL;DR

| Module | LoC | Cmds | Inline tests | UI surface | Maturity |
|--------|-----|------|--------------|------------|----------|
| `self_upgrade.rs` | 730 | 17 (incl. 5 pentest) | **0** | admin.ts wrapper; no dedicated pane | **skeleton — narrow + untested** |
| `evolution.rs` | 1134 | 12 | **0** | CapabilityReports.tsx | **most ambitious — loop runs, no eval** |
| `memory.rs + typed_memory.rs + embeddings.rs` | 1883 | ~12 | **0** | MemoryPalace, KnowledgeBase, ConversationInsights | **substantial surface, zero quality measurement** |
| `health_guardian.rs` (the closest thing to "doctor") | 316 | 2 | 0 | (screen-time only) | **not actually a doctor** — wrong scope |
| `doctor.rs` | — | — | — | — | **does not exist** |

**Headline:** The self-improvement substrate is more ambitious than Arnav remembered (evolution.rs has a real 15-min hormone-gated loop) but zero of these modules have inline tests, zero have eval scaffolding, and there's no central diagnostic ("doctor") module — health_guardian.rs only tracks screen-time. The body has anatomy but no calibration.

---

## self_upgrade.rs (730 LoC, 17 commands)

**What it does:**
- Hard-coded `capability_catalog()` with **10 entries** (gh, jq, ffmpeg, docker, python, etc.)
- Detects missing tools from stderr/command strings (`detect_missing_tool`)
- `auto_install(gap)` runs the right pkg-manager command per OS
- `search_npm_for_mcp(capability)` — npm registry search for MCP servers matching a capability
- `auto_resolve_unknown_gap(capability)` — fallback when capability isn't in catalog
- 5 commands wrap **pentest authorization** (`pentest_authorize`, `pentest_check_auth`, `pentest_revoke`, `pentest_list_auth`, `pentest_check_model_safety`) — narrow domain, but currently lives in `self_upgrade.rs` rather than a dedicated `security_*.rs`. Smells out of place.
- 3 commands expose to UI: `self_upgrade_install`, `self_upgrade_catalog`, `self_upgrade_audit`

**UI:** Wrapped in `src/lib/tauri/admin.ts`. **No dedicated pane** in Settings; reachable through admin features only. The "self-upgrade" feature is largely invisible to users.

**Maturity verdict:** Functional skeleton. The 10-entry catalog is too narrow to actually replace what's missing; the pentest commands shouldn't live here; zero tests means the install paths have never been verified except by hand on Arnav's machine.

---

## evolution.rs (1134 LoC, 12 commands) — the most grown of the three

**What it does:**
- `start_evolution_loop` — 15-min cycle, kicks off 3 minutes after boot
- Gated by `background_ai_enabled` config + **hormone gates**: only runs if `growth_hormone() ≥ 0.3` and `leptin ≤ 0.8` (don't grow when conserving or satiated). Real biological metaphor at work.
- Each cycle: `run_evolution_cycle` detects apps, matches catalog, suggests/installs capabilities, emits events
- Spawns adjacent loops: `research::run_research_cycle` (30-min throttled ambient research) + weekly soul snapshot
- 5 user-facing commands: `evolution_get_level`, `evolution_get_suggestions`, `evolution_dismiss_suggestion`, `evolution_install_suggestion`, `evolution_run_now`
- `evolution_log_capability_gap` — lets other modules report "I needed X but didn't have it"

**UI:** `CapabilityReports.tsx` in admin features (so it's reachable but not in the main Settings flow).

**Maturity verdict:** **Most grown of the three.** Has a real autonomous loop with hormonal gating, ambient research, and capability-gap logging from other modules. The frame is mature; what's missing is **eval** — there's no metric for "is evolution actually getting better at suggesting useful upgrades?" It's a one-way ratchet of suggestions with zero feedback loop on suggestion quality.

---

## Memory cluster (1883 LoC across 3 core files + adjacents)

**memory.rs (807):** Letta-style virtual context blocks (human/conversation), `extract_conversation_facts` (LLM-driven fact extraction), `update_human_block` / `update_conversation_block`, `weekly_memory_consolidation`, `learn_from_conversation`.

**typed_memory.rs (582):** SQLite-backed typed memories across **7 categories** (Fact / Preference / Decision / Skill / Goal / Routine / Relationship). `recall_by_category`, `get_relevant_memories_for_context`, `generate_user_knowledge_summary`.

**embeddings.rs (494):** `embed_texts` (vector embedding), `auto_embed_exchange`, `recall_relevant` (top-k similarity), `smart_context_recall` (BM25 + vector hybrid), `semantic_search`.

**Adjacent (not counted in 1883):** `knowledge_graph.rs`, `people_graph.rs`, `persona_engine.rs`, `personality_mirror.rs`. Substantial parallel cluster.

**UI:** `MemoryPalace.tsx`, `KnowledgeBase.tsx`, `ConversationInsights.tsx` — three real surfaces.

**Maturity verdict:** **Substantial functional surface, zero quality measurement.** Three classes of bugs are completely uncaught:
1. **Recall quality** — does smart_context_recall return relevant memories or noise? No eval set.
2. **Fact extraction precision** — does extract_conversation_facts pull real facts or hallucinate? No eval set.
3. **Consolidation correctness** — does weekly_memory_consolidation merge duplicates without losing nuance? No eval set.

Every memory pipeline runs on faith. This is the single biggest hidden risk in the codebase.

---

## "Doctor" — does not exist

**`doctor.rs` is not in the codebase.** The closest module is `health_guardian.rs` (316 LoC, 2 cmds: `health_guardian_stats`, `health_take_break`) — but it's screen-time/break monitoring for the *user*, not system diagnostics.

What would a doctor module do?
- Diagnose tentacle health (which observers are failing, which are stale)
- Surface drift (config divergence, ledger drift, scan-profile staleness)
- Alert on quality regressions (memory recall scores dropping, evolution suggestions getting worse)
- Aggregate signals from `pulse.rs`, `temporal_intel.rs`, `evolution.rs::evolution_log_capability_gap`

Currently those signals are scattered. **No central diagnostic surface.** This is a clean addition for v1.2 if the anchor goes that direction.

---

## "How close to human body?" — by the numbers

Anatomy is rich; calibration is non-existent.

**22 body systems** mapped in `body_registry.rs` (149 modules total):
- Biological: cardiovascular, digestive, endocrine, immune, lifestyle, memory, muscular, nervous, reproductive, respiratory, skeleton, skin, urinary, vision
- Functional: agents, audio, communication, hive, identity, infrastructure, proactive, supervisor

**11 hormones** in `HormoneState`:
- Foundational: arousal, energy_mode, exploration, trust, urgency
- Need-state: hunger, thirst
- Resource: insulin, adrenaline, leptin, poll_rate

**5 standalone hormone fns** outside the struct: `growth_hormone()`, `thyroid_stimulating()`, `acth()`, `oxytocin()`, `adh()`. So **16 named hormones total** if you count the discrete fns.

**Sleep / consolidation:** `dream_mode.rs` (536 LoC) with `run_dream_session`, `is_dreaming`, `start_dream_monitor`. Real circadian-style consolidation pass.

**12 tentacles** under `tentacles/`: calendar, cloud_costs, discord_deep, email_deep, filesystem_watch, github_deep, heads (special), linear_jira, log_monitor, slack_deep, terminal_watch.

**The honest comparison:** structurally rich enough to map onto a human-body metaphor, but the metaphor is mostly **descriptive** — there's no closed-loop control where, say, low cortisol actually changes BLADE's poll rate adaptively, or where dream_mode's consolidation output measurably improves next-day recall. It's anatomy without physiology.

---

## Eval scaffolding — none

- **0 inline `#[test]` blocks** across self_upgrade.rs, evolution.rs, memory.rs, typed_memory.rs, embeddings.rs, knowledge_graph.rs.
- No `tests/evals/`, no benchmark harness, no quality gates in `verify:all` for AI output quality (the 27 gates are all structural — token consistency, ARIA, spacing, no-raw-tauri, etc.).
- `tauri-plugin-updater` smoke tests exist but are integration-level.

This is the single easiest, highest-leverage v1.2 add — any direction (tool-replacer, JARVIS, doctor) benefits from eval scaffolding.

---

## "Ego" / refusal-elimination — not present as a module

Arnav's note: *"the thing which prevents BLADE from saying he can't do it and makes himself able to do whatever BLADE can't do"*

There is no system-level layer that intercepts "I can't" responses and routes them to capability-gap-detection or self-upgrade. The pieces exist:

- `evolution_log_capability_gap` (capability gap logging from any module)
- `self_upgrade_install` (install missing tools)
- `commands.rs` blade_routing_capability_missing event (Phase 11 wiring — fires when router can't fulfill a capability requirement)

But there's **no LLM output post-processor** that reads the assistant message, detects refusal patterns ("I can't do that", "I don't have access to..."), and routes them to the gap-resolution path. That post-processor would be the "ego" layer.

This is a clean v1.2 candidate — small, legible, high-impact. It would meaningfully change BLADE's apparent capability ceiling.

---

## What this audit means for v1.2 anchor selection

Three of the seven candidate anchors from the ideation note land differently after this pass:

| Anchor candidate | Pre-audit appeal | Post-audit recommendation |
|------------------|------------------|---------------------------|
| **Self-upgrade audit + doctor** | "boring but compounding" | **Bigger than expected** — eval scaffolding alone would close the single biggest hidden risk; doctor is a clean additive module. **Strong.** |
| **Tool-replacer (Hermes/OpenClaw/Cowork)** | "strongest signal in dump" | Still strong, but **risky without eval** — replacing real tools without quality measurement repeats the memory-cluster mistake at higher stakes. |
| **Skills marketplace (ELIZA/Obsidian/GSD)** | medium | **Stronger** — natural use case for evolution.rs's capability-gap pipeline; user-created skills give the "upgrade according to user" thread real ground. |
| Persona / clone / humor | medium | Unchanged — needs persona_engine + personality_mirror review separately |
| Reach (Android/camera/OS) | low-medium | Unchanged — greenfield |
| Make-LLM-think | v3+ | Unchanged |
| **Ego / refusal-elimination** | small but high-impact | **Add as a side-quest** to whichever anchor wins — it's a thin layer that any anchor benefits from |

**Sharper recommendation than last turn:** anchor v1.2 on **eval scaffolding + doctor + ego** as a *quality-and-self-knowledge milestone*. Tool-replacer becomes v1.3 once v1.2 has measurement to evaluate "did the replacement actually replace?" This sequencing inverts what felt obvious during the dump but matches the maturity gaps surfaced here.

Tradeoff: less flashy than tool-replacer for a public release; more compounding for everything that comes after.

---

*Audit pass: 2026-04-27, ~30 min, read-only. No code changes. Ready to feed into `/gsd-new-milestone`.*
