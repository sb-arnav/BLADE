---
title: "v1.2 milestone shape — Acting Layer with Brain Foundation"
date: 2026-04-29
context: >
  Drafted by Claude on 2026-04-29 from four authoritative inputs read
  end-to-end: `.planning/PROJECT.md` (v1.2 anchor candidates set at v1.1
  close), `.planning/STATE.md` (locked decisions, especially M-01 "v1.2
  acting work obeys the same anchor"), `v1-2-ideation-arnav.md` (raw dump),
  `v1-2-self-improvement-maturity.md` (concrete audit answering the dump),
  plus the new 2026-04-28 memory recall eval baseline (7/7 top-1, MRR 1.000).

  Reconciles two earlier framings — the "natural sequel" framing in
  PROJECT.md (JARVIS / ACT / BROWSER / OPERATOR-UAT / WIRE3) and the
  "brain audit" framing this file's earlier draft (Eval / Doctor / Ego /
  Skills) — into a single merged scope that honors PROJECT.md's authority
  while preserving the audit's "eval before flashy" insight.

  Earlier draft of this file (status: locked, brain-audit framing) is
  superseded by this rewrite. The earlier lock was based on a draft that
  hadn't read PROJECT.md or STATE.md; on rereading those files the
  divergence with M-01 was caught and the scope revised. Memory entry
  `feedback_read_authority_files_first.md` records the lesson.

  This note is the planning input for /gsd-new-milestone. The milestone
  workflow should consume it and produce REQUIREMENTS.md + ROADMAP.md
  consistent with the shape below; deviations need explicit justification,
  not silent revision.
status: locked
locked_by: arnav
locked_date: 2026-04-29
audience: /gsd-new-milestone, /gsd-plan-phase, downstream phases
---

# BLADE v1.2 — Acting Layer with Brain Foundation

## Anchor

> **v1.2 = "BLADE can act, and we can measure whether it acts well."**

v1.0 shipped the substrate. v1.1 wired it into something a first-time user can actually use (paste-anything provider setup, smart deep scan, observer-class tentacles, activity-log strip). v1.2 ships the **JARVIS demo moment** the v1.1 wiring was built for — push-to-talk → natural-language command → cross-app action — but lands it on top of an **eval foundation + doctor surface** so the acting layer is honest, not theatrical. Closes the operator UAT debt v1.1 carried forward.

## Why this framing (and how it reconciles two earlier framings)

Two prior framings existed in tension:

**Framing A — the natural-sequel** (PROJECT.md `## Active (v1.2 — TBD)`, set at v1.1 close 2026-04-27):
JARVIS push-to-talk + ACT (acting tentacles) + BROWSER (browser-harness Q1) + OPERATOR-UAT carry-overs + WIRE3 backend burn-down. Anchored on M-01: "v1.2 acting work obeys the same anchor."

**Framing B — the brain audit** (this file's earlier draft 2026-04-29, drawn from `v1-2-self-improvement-maturity.md`):
Eval scaffolding + Doctor module + Ego layer + Skills MVP. Pushed acting work to v1.3 because "replacing tools without eval is dumb."

Both have merit. The reconciliation: **A is the milestone's destination, B is its foundation.** The audit's insight ("eval before flashy") doesn't mean *defer the flashy* — it means *land eval first, then ship the flashy on top.* So:

- **Eval scaffolding ships** (Framing B) — gives us an honest measurement layer for the acting work.
- **Doctor module ships** (Framing B) — central diagnostic that consumes eval signals + existing capability-gap log + tentacle health.
- **JARVIS ships** (Framing A) — the demo moment. The ego refusal-elimination layer (was a standalone phase in B) **folds into JARVIS** as a post-processor — too small for its own phase, perfect fit where refusals matter most.
- **Operator UAT closes** (Framing A) — 11 carry-overs from v1.1, tech debt that blocks formal v1.0/v1.1 archive.
- **ACT (per-tentacle outbound), Skills MVP, Tool-replacer, BROWSER full architecture decision, WIRE3 backlog burn** all defer to v1.3 — explicitly listed in "Out of scope" below.

**New evidence that informs the shape (2026-04-28):** the memory recall pipeline was tested end-to-end with the real fastembed model — 7/7 top-1, MRR 1.000. The audit's "biggest hidden risk" turns out to be a non-risk. That confirms the eval pattern is the right framework and removes the case for postponing acting work.

## The 5 phases

Phase numbering continues globally per locked decision M-05. v1.0 ended at Phase 9, v1.1 ran Phases 10–15. **v1.2 starts at Phase 16.**

### Phase 16 — Eval Scaffolding Expansion

**Goal:** Extend the `memory_recall_real_embedding` pattern (shipped 2026-04-28, commit `9c5674a`) into a real `tests/evals/` harness with floors enforced by `verify:all`.

**Ships:**
- **Knowledge-graph integrity eval** — fixture corpus, assert nodes/edges round-trip without orphans after `consolidate_kg`.
- **BM25 / hybrid-search regression gate** — keep the current 8/8-asserted floor, add 2-3 adversarial fixtures (long content, unicode, near-duplicates) to harden against silent drift.
- **typed_memory category recall** — 7-category fixture, `recall_by_category` returns expected sets per category.
- **Evolution capability-gap detection** — feed synthetic stderr blobs to `detect_missing_tool`, assert correct catalog entry returned.
- **Eval reporting** — every eval module prints a scored table; failures surface as `verify:all` floor breaches.

**Deferred (need LLM API budget):** `extract_conversation_facts` precision, `weekly_memory_consolidation` correctness, evolution suggestion quality. Listed in `tests/evals/DEFERRED.md` as v1.3 candidates.

**Falsifiable success:** `cargo test --lib evals` runs ≥4 eval modules. `verify:all` extends to include the eval gate (count moves from 27 → 28+). Each eval prints a scored table identical to the existing `memory_recall_real_embedding` format.

---

### Phase 17 — Doctor Module

**Goal:** Central diagnostic surface. Today, signals from `evolution.rs::evolution_log_capability_gap`, `pulse.rs`, `temporal_intel.rs`, `health_guardian.rs`, and the new evals from Phase 16 are scattered. Doctor aggregates them.

**Ships (Rust):**
- **`doctor.rs`** new module. Commands: `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`.
- **Signal sources:** eval score history, capability-gap log (count + recency per capability), tentacle health, config drift, pulse aggregations.
- **`doctor_event` Tauri event** — emitted on regression detected (eval score drops, tentacle dead, gap-log spike).

**Ships (UI):**
- **Diagnostics tab** in admin already exists — extend with a Doctor pane.
- **Severity-tiered surface** (green / amber / red per signal class).
- **Per-signal drill-down** — click row → drawer with raw data + last-changed timestamp + suggested fix.

**Falsifiable success:** Doctor pane renders ≥5 distinct signal classes on a fresh install. An artificially failing eval lights up the doctor surface red end-to-end. `doctor_run_full_check` returns a structured report.

---

### Phase 18 — JARVIS Push-to-Talk → Cross-App Action

**Goal:** Ship the demo moment v1.1 wired everything for. Push-to-talk → natural-language command → BLADE executes a cross-app action (e.g. *"post something about myself from my Arc account"*, *"summarize today's standup and post to #eng-updates"*).

**Ships (Rust):**
- **PTT trigger pipeline** — global hotkey → audio capture → Whisper STT → command intent classification → tool-call dispatch.
- **Cross-app dispatch** — uses existing observer tentacle credentials (read-only became read-write *for the specific consented intent*, never silently — explicit per-action consent prompt the first time, remembered after).
- **Ego layer (folded in)** — post-processor on assistant output. Detects "I can't" / "I don't have access" patterns. Routes to `evolution_log_capability_gap` + `auto_install` if catalog match, then re-prompts with the new capability available. Hard cap: 1 retry. (Was originally a standalone phase in the brain-audit draft; folded here because refusal handling matters most where actions are attempted.)
- **BROWSER Q1 decision absorbed** — the `browser-use/browser-harness` vs current `browser_native.rs` decision (open question in `research/questions.md`) lands as a Phase 18 plan input. If browser actions are needed for JARVIS, the decision happens here, not as a separate research phase.

**Ships (UI):**
- **Activity-strip integration** — every JARVIS action emits to the activity log per M-07 contract.
- **Consent dialog** — per-action explicit approval before BLADE writes to an external service (post, reply, deploy, modify).
- **JARVIS in chat** — small inline pill when ego intercepts: *"BLADE detected a capability gap (browser); attempting to resolve..."* — honest about what happened.

**Falsifiable success:** Cold install + 1 user consent → push-to-talk → BLADE executes a real cross-app action (e.g. posts to a Slack channel, replies to a GitHub PR comment). Synthetic refusal in chat triggers ego intercept and either successful capability install or a hard_refuse with recorded reason. Action logged to ActivityStrip.

---

### Phase 19 — Operator UAT Close

**Goal:** Close the 11 operator-owned UAT items carried from v1.1 close (per `STATE.md ## Deferred Items` and `milestones/v1.1-MILESTONE-AUDIT.md`).

**Items:**

| Category | Phase | Item |
|---|---|---|
| uat_gaps | 14 | activity-strip cross-route persistence |
| uat_gaps | 14 | drawer focus-restore |
| uat_gaps | 14 | localStorage rehydrate-on-restart |
| uat_gaps | 14 | cold-install Dashboard screenshot |
| uat_gaps | 14 | keyboard tab-traversal |
| uat_gaps | 14 + 15 | 5-wallpaper contrast |
| uat_gaps | 15 | cold-install RightNowHero screenshot |
| uat_gaps | 15 | top-bar hierarchy 1280×720 |
| uat_gaps | 15 | 50-route empty-state ⌘K sweep |
| uat_gaps | 15 | spacing-ladder spot-check |
| uat_gaps | 12 | SCAN-13 cold-install baseline |

Plus reconcile `HANDOFF-TO-MAC.md` — currently shows as deleted in working tree (operator may have deleted intentionally on Windows; Phase 19 confirms intent and either restores from git history or formalizes deletion).

**Ships:**
- Operator UAT runbook (probably extends `/blade-uat` slash command with the 11 specific checks).
- Per-item evidence in `docs/testing ss/` (note literal space) — screenshot + one-line observation.
- 5-wallpaper contrast script — automate the visual sanity check that's currently manual.

**Falsifiable success:** All 11 carry-over UAT items have either a green check + evidence file in `docs/testing ss/`, or a *re-deferred* status with explicit rationale (preserves the v1.0 Mac-smoke convention's honesty principle). v1.1 milestone audit can be re-run and emerge with status `complete` (currently `tech_debt`).

---

### Phase 20 — Polish + Verify Pass

**Goal:** Mop-up. Whatever the v1.2 phases revealed that doesn't fit cleanly elsewhere.

**Ships:**
- Verify-gate consolidation (count should be 27 + Phase 16's eval gate + any new gates from 17/18/19).
- Cargo / TS clean checkpoint.
- v1.2 changelog entry.
- v1.2 milestone audit (mirrors the v1.1 close audit pattern).

**Falsifiable success:** `verify:all` green. `cargo check --no-default-features` clean (the WSL libspa-sys/libclang env limit from v1.1 may persist — CI green is the falsifier). v1.2 entry in CHANGELOG.md. Milestone audit doc parallels `v1.1-MILESTONE-AUDIT.md`.

---

## Sequencing

```
   Phase 16 (eval scaffolding)
       │
       ▼
   Phase 17 (doctor)         ← consumes Phase 16's eval signals
       │
       ▼
   Phase 18 (JARVIS + ego)   ← independent of doctor for shipping; benefits from it
       │
       ▼
   Phase 19 (operator UAT)   ← can run parallel to 18 if operator is available
       │
       ▼
   Phase 20 (polish + verify)
```

**Total target: 10–12 days.** Phase 16: 2d. Phase 17: 2d. Phase 18: 4d (the heaviest — STT + intent + dispatch + ego + browser-Q1). Phase 19: 2d (operator-driven, depends on availability). Phase 20: 1d.

## Out of scope (deferred to v1.3+)

Explicit list of things from the dump and from PROJECT.md that **are NOT in v1.2**:

- **ACT (outbound acting per observer tentacle, full surface)** — Slack reply / Email reply / GitHub PR review comments / Calendar accept-decline / Linear ticket creation as standalone first-class flows. Phase 18 ships a JARVIS-mediated subset; the standalone per-tentacle UI surface is v1.3.
- **Skills MVP (ELIZA / Obsidian / GSD as user-installable runtime skills)** — defer; user-customization theme has more room in v1.3.
- **Tool-replacer (Hermes / OpenClaw / Cowork copy-or-control)** — v1.3, gated on Phase 16 evals being live so we can measure "did the replacement actually replace?"
- **WIRE3 — burn down 97 deferred backend modules** — backlog work isn't milestone-shaped. Pick individual items as they become acting-tentacle dependencies; otherwise defer.
- **Android control / camera access / OS customization (Windhawk-style)** — separate platform investigations, v1.3+.
- **Persona / user-clone / humor** — v1.3, separate persona maturity pass against `persona_engine.rs` + `personality_mirror.rs`.
- **"How to make BLADE think" / "turn LLM into AI" / Perplexity-personal-computer-better** — v3+ destination, not milestone-shaped.
- **More hormones / "how close to human body"** — v1.3+ after a hormone audit.
- **CLI-Anything integration** — v1.3 research first.
- **Compound engineering / growth loops / Codex parity sweep** — meta-habits, not phases.
- **Auto-update presence check** — quick grep through Tauri config / `config.rs` happens early in Phase 17 (Doctor surfaces "no auto-update channel" as an amber signal). If wired, no further scope. If not, fold into Phase 17.

## Open items entering /gsd-new-milestone

- **API budget** affects Phase 16's deferred LLM-dependent evals. Listed in `tests/evals/DEFERRED.md` as v1.3 stubs.
- **Browser-harness Q1** — decision absorbed into Phase 18 plan, no separate research phase.
- **HANDOFF-TO-MAC.md deletion** — currently deleted in working tree; Phase 19 confirms operator intent.
- **Mac smoke (M-41..M-46)** — pending operator handoff per `HANDOFF-TO-MAC.md` (when restored). Doesn't gate v1.2 start.
- **Pentest commands relocation** (already happened, commit `0065185`). Just a record.

## Authority

This shape supersedes the earlier brain-audit-only draft (locked-then-revised on 2026-04-29 after PROJECT.md / STATE.md were read end-to-end). It is **locked**.

`/gsd-new-milestone` may flesh out requirements, success criteria, and dependencies — but should not silently change the phase list, sequencing, or scope. Any deviation needs explicit user sign-off.

## Cross-references

- Authority: `.planning/PROJECT.md` (Active section, Locked Decisions M-01..M-07)
- Authority: `.planning/STATE.md` (Locked decisions, anchor candidates)
- Inputs: `.planning/notes/v1-2-ideation-arnav.md` (raw dump), `v1-2-self-improvement-maturity.md` (audit)
- Evidence: commit `9c5674a` (memory recall eval baseline 7/7), commit `dc114b8` (notes index)
- Lesson: `~/.claude/projects/-home-arnav-blade/memory/feedback_read_authority_files_first.md`
