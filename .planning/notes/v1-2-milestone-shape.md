---
title: "v1.2 milestone shape — drafted from ideation + maturity audit"
date: 2026-04-29
context: >
  Drafted by Claude on 2026-04-29 from `v1-2-ideation-arnav.md` (Arnav's
  raw dump, captured 2026-04-27) and `v1-2-self-improvement-maturity.md`
  (the audit answering Arnav's questions about what's actually built).
  Frames v1.2 as "the brain audit milestone" — eval, doctor, ego, skills.
  Pushes the flashy stuff (tool-replacer, Android, camera, "make BLADE
  think") to v1.3 or later because they need eval scaffolding to be honest.

  This note is the planning input for /gsd-new-milestone. The milestone
  workflow should consume it and produce REQUIREMENTS.md + ROADMAP.md
  consistent with the shape below; deviations need explicit justification,
  not silent revision.
status: draft
audience: /gsd-new-milestone, /gsd-plan-phase, downstream phases
---

# BLADE v1.2 — Brain Audit (Eval, Doctor, Ego, Skills)

## Anchor

> **v1.2 = "BLADE knows what it knows."**

v1.1 made the substrate functional and reachable. v1.2 makes BLADE *honest about itself* — measurable quality on the AI surfaces that already run blind, a central diagnostic that aggregates drift signals, a refusal-elimination layer that turns "I can't" into capability-gap routing, and a real skills surface so user-installable behavior (ELIZA / Obsidian / GSD) rides the existing evolution.rs gap pipeline.

## Why this framing (not the tool-replacer framing the dump leaned toward)

The 2026-04-27 ideation dump leaned heavily on **tool replacement** (Hermes / OpenClaw / Cowork, Android, camera, "make ourselves better than Codex in everything"). The maturity audit on the same day pushed back on that framing:

> *"Replacing tools without quality measurement repeats the memory-cluster mistake at higher stakes."*

The audit found:
- **Memory cluster** (1,883 LoC) — substantial functional surface, **zero quality measurement**. Was flagged as the single biggest hidden risk.
- **evolution.rs** (1,134 LoC) — most ambitious self-improvement loop, hormone-gated, ambient research. Real frame, **no feedback signal on suggestion quality**.
- **self_upgrade.rs** (730 LoC) — 10-entry catalog, narrow, **zero inline tests**. Pentest commands lived here for unclear reasons.
- **doctor.rs** — does not exist. health_guardian.rs is screen-time only, wrong scope.
- **Ego layer** — no LLM output post-processor that intercepts refusals. Pieces (`evolution_log_capability_gap`, `self_upgrade_install`, `blade_routing_capability_missing` event) exist but aren't connected.

**New evidence since the audit (2026-04-28):** the memory recall pipeline was tested end-to-end with the real fastembed model — 7/7 top-1, MRR 1.000. **The brain works.** That confirms the eval pattern is the right framework and removes the "memory might be silently broken" anxiety. v1.2 leans into that pattern and extends it.

## The 4 phases

### Phase 0 — Eval Scaffolding Expansion

**Goal:** Extend the `memory_recall_real_embedding` pattern (shipped 2026-04-28, commit `9c5674a`) into a real eval harness that lives in `tests/evals/` and runs as part of `verify:all`.

**Ships:**
- **Knowledge-graph integrity eval** — fixture corpus, assert nodes/edges round-trip without orphans after `consolidate_kg`.
- **BM25 / hybrid-search regression gate** — keep the current 8/8-asserted floor, add 2-3 adversarial fixtures (long content, unicode, near-duplicates) to harden against silent drift.
- **typed_memory category recall** — 7-category fixture, `recall_by_category` returns expected sets.
- **Evolution capability-gap detection** — feed synthetic stderr blobs to `detect_missing_tool`, assert correct catalog entry returned.
- **Eval reporting** — every eval module prints a scored table; failures surface as `verify:all` floor breaches.

**Deferred from this phase (need LLM API budget):** `extract_conversation_facts` precision, `weekly_memory_consolidation` correctness, evolution suggestion quality. Listed in `tests/evals/DEFERRED.md` so they can ship in v1.3 when API budget allows.

**Falsifiable success:** `cargo test --lib evals` runs ≥4 eval modules. `verify:all` extends to include the eval gate. Each eval prints a scored table identical to the existing `memory_recall_real_embedding` format.

---

### Phase 1 — Doctor Module

**Goal:** Central diagnostic surface. Today, signals from `evolution.rs::evolution_log_capability_gap`, `pulse.rs`, `temporal_intel.rs`, `health_guardian.rs`, and the new evals from Phase 0 are scattered. Doctor aggregates them.

**Ships (Rust):**
- **`doctor.rs`** new module. Exposes commands: `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`.
- **Signal sources:**
  - Eval score history (Phase 0 outputs)
  - Capability-gap log (count + recency, per capability)
  - Tentacle health (which observers stale, which failing)
  - Config drift (ledger consistency, scan-profile age)
  - Pulse aggregations (existing module, surface its data)
- **`doctor_event` Tauri event** — emitted on regression detected (eval score drops, tentacle dead, gap-log spike).

**Ships (UI):**
- **Diagnostics tab** in admin already exists — extend with a "Doctor" pane.
- **Severity-tiered surface** — green/amber/red per signal class.
- **Per-signal drill-down** — click row → drawer with raw data + last-changed timestamp + suggested fix.

**Falsifiable success:** Doctor pane renders ≥5 distinct signal classes on a fresh install. At least one eval regression test (artificially failing eval) lights up the doctor surface red end-to-end. `doctor_run_full_check` returns a structured report.

---

### Phase 2 — Ego Layer (refusal-elimination)

**Goal:** Post-processor on assistant output. When BLADE says "I can't do that" or "I don't have access," intercept, route to capability-gap detection, attempt resolution, and re-try.

**Ships (Rust):**
- **`ego.rs`** new module. `intercept_assistant_output(&str) -> EgoVerdict { passthrough | capability_gap(Capability) | hard_refuse(Reason) }`.
- **Refusal pattern matcher** — regex + LLM-classifier fallback against a curated set: "I can't / I don't have access to / I don't have the ability / I'm not able to / I lack the / I cannot directly".
- **Wire into `commands.rs`** chat tool loop — assistant output passes through ego before reaching the user.
- **On capability_gap** — call `evolution_log_capability_gap`, attempt `auto_install` if catalog match, then re-prompt with the new capability available. Cap re-tries at 1 to avoid loops.
- **On hard_refuse** — pass through to user (some refusals are safety-correct).

**Ships (UI):**
- **Ego trace** in chat — when ego intercepts, surface a small inline pill: *"BLADE detected a capability gap (browser); attempting to resolve..."*. Honest about what happened.
- **Settings → Ego** — toggle to disable, slider to set re-try aggressiveness.

**Falsifiable success:** Synthetic chat run where the assistant output contains "I can't browse the web" intercepts and triggers either a successful capability install or a hard_refuse with a recorded reason. Cap on re-tries holds (no infinite loop).

---

### Phase 3 — Skills Surface MVP

**Goal:** User-installable runtime skills. Three first-class skills (ELIZA, Obsidian, GSD) ship as built-ins; the surface supports user-added skills.

**Ships (Rust):**
- **`skills/` registry** — each skill is a manifest + a small Rust shim or external command wrapper:
  - **ELIZA skill** — pattern-matched conversational reflector (legacy paper). Cheap, useful as a "thinking out loud" mode.
  - **Obsidian skill** — wraps Obsidian vault read/write via filesystem. Search / append / link.
  - **GSD skill** — wraps `/gsd-*` commands as BLADE-callable tools (creates phases, runs plans, reads roadmap).
- **Skill manifest format** — JSON: `{name, description, tools_added: [], triggers: [], requires_capabilities: []}`.
- **Capability-gap pipeline integration** — installing a skill that needs a missing capability → routes through `self_upgrade_install` (already exists).

**Ships (UI):**
- **Settings → Skills** page. Browse / install / disable / configure per skill. Each row: name, what tools it adds, what triggers it, current state.
- **Skill manifest validator** — paste a JSON manifest, BLADE validates and offers to install.

**Falsifiable success:** ELIZA / Obsidian / GSD all installable from the Skills page. Each surfaces ≥1 callable tool in the chat tool list. Disabling a skill removes its tools cleanly without restart. Installing a skill that requires a missing capability prompts the gap-resolution flow from Phase 2.

---

## Sequencing

```
   Phase 0 (eval scaffolding)
       │
       ├──────────────┐
       ▼              ▼
   Phase 1         Phase 2          ← parallel after 0
   (doctor)        (ego)
       │              │
       └──────┬───────┘
              ▼
          Phase 3
       (skills MVP)        ← consumes ego's gap-resolution flow
```

Phase 0 is foundational because Phase 1 (doctor) consumes eval signals as a primary input. Phase 2 (ego) only soft-depends on 0 (the capability-gap path is independent). Phase 3 (skills) wants Phase 2's gap-resolution flow live so installing a skill with a missing capability has a real path.

**Total target: 7 days.** Phase 0: 2d. Phase 1: 2d. Phase 2: 1d. Phase 3: 2d.

## Out of scope (deferred to v1.3+)

Everything else from `v1-2-ideation-arnav.md` that isn't above:

- **Tool-replacer** (Hermes / OpenClaw / Cowork copy-or-control) → v1.3, gated on Phase 0 evals being live so we can measure "did the replacement actually replace?"
- **Android control** (partial + full) → v1.3+, separate platform investigation
- **Camera access** → v1.3+, separate input modality
- **Sync** (Hermes-style) → v1.3+, gates on tool-replacer architecture
- **OS customization / Windhawk** → v2+, not a milestone-shaped scope
- **User-created custom agents** (full version) — Phase 3 ships the manifest surface, full agent-builder UI deferred
- **Persona / user-clone / humor** → v1.3, separate persona maturity pass against `persona_engine.rs` + `personality_mirror.rs`
- **"Make BLADE think" / "turn LLM into AI"** → v3+ destination, not a milestone
- **More hormones / "how close to human body"** → v1.3+, after a hormone audit
- **Perplexity-personal-computer-better** → too vague to scope; revisit when concrete
- **CLI-Anything integration** → v1.3+ research first, then decide
- **Compound engineering / growth loops** → meta-habits, not phases
- **Auto-update** → needs a quick "does the current design have it?" check before scoping (open item below)
- **Codex parity sweep** → continuous research habit, not a phase

## Open items entering /gsd-new-milestone

- **API budget** affects Phase 0's deferred LLM-dependent evals. Decide: ship `tests/evals/DEFERRED.md` with stubs, or burn budget once on a fixture run to seed snapshots that future tests can mock against.
- **Auto-update presence check** — quick grep through current Tauri config / config.rs to confirm `tauri-plugin-updater` is wired. If yes, no scope. If no, add as small Phase 4 or fold into Phase 1 (Doctor surfaces "no auto-update channel" as an amber signal).
- **Mac smoke (M-41..M-46)** — still pending operator handoff; doesn't gate v1.2 start, runs in parallel.
- **Pentest commands** — currently in `self_upgrade.rs` per the audit; refactoring to `pentest.rs` already happened (commit `0065185`). Not v1.2 scope, just a record.

## Authority

This shape is **draft**. Lock it (status: locked) once Arnav signs off on the four phases + scope decisions. After lock, `/gsd-new-milestone` may flesh out requirements, success criteria, and dependencies — but should not silently change the phase list, sequencing, or scope. Any deviation needs explicit user sign-off.
