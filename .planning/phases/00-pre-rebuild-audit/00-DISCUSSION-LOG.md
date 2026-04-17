# Phase 0: Pre-Rebuild Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `00-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 00-pre-rebuild-audit
**Areas discussed:** Execution mode (user-selected); scope pivot (user-directed during area selection)

---

## Gray Area Selection

User was presented four gray areas and selected one, but replaced the others with an explicit scope direction.

| Option | Description | Selected |
|--------|-------------|----------|
| Execution mode | Parallel subagents vs sequential vs hybrid | ✓ |
| RECOVERY_LOG structure | Monolithic vs split under `.planning/recovery/` | ✓ (surfaced as follow-up) |
| `emit_all` output format | Classification-only vs classification + `emit_to` suggestions | — (folded into D-18 Subagent B spec) |
| Audit breadth | Targeted 5 areas vs opportunistic | — (superseded by scope pivot below) |

**User's direction during selection (paraphrased from verbatim note):**
> The previous UI in `src/` was broken on the design part — no scalable components, no structure, just raw code floating around. We're building from scratch; we don't need to look back at broken code. The backend is clear; the prototype mock-ups are the design target; the research is already done. Figure out what UX is needed by incorporating those sources.

**Effect on scope:** Dropped `src.bak/` as an audit source; backend + prototypes + research become the authoritative inputs. Captured as D-17 in `00-CONTEXT.md`.

---

## Execution Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: 3 parallel + inline synth (Recommended) | 3 parallel subagents (backend contracts / emit_all classifier / prototype-to-flow) + Claude synthesis | ✓ |
| Fully parallel: 5 subagents | One per original audit area; risks missing cross-cutting patterns | |
| Sequential inline, no subagents | Claude reads + writes area by area; slowest but tightest coherence | |

**User's choice:** Hybrid: 3 parallel + inline synth (Recommended)
**Notes:** Captured as D-18. Three subagent workstreams defined: (A) Backend Contract Extractor reading `commands.rs`, voice modules, onboarding commands, hormone bus; (B) `emit_all` Classifier scanning 73 Rust sites with inline `emit_to` replacement suggestions; (C) Prototype-to-Flow Mapper reading 11 `docs/design/` HTML files. Claude synthesizes the three into one `RECOVERY_LOG.md`.

---

## Output Structure

| Option | Description | Selected |
|--------|-------------|----------|
| One monolithic `.planning/RECOVERY_LOG.md` (Recommended) | Single file, 5 sections + appendices; matches ROADMAP.md wording | ✓ |
| Split under `.planning/recovery/` with index | Per-area files with index; more maintainable | |

**User's choice:** One monolithic `.planning/RECOVERY_LOG.md` (Recommended)
**Notes:** Captured as D-19. Single file with 5 headed sections (QuickAsk bridge / Voice orb states / Onboarding wiring / Event catalog / `emit_all` classification) plus Appendix A (prototype-to-flow) and Appendix B (Liquid Glass token set).

---

## Claude's Discretion

- Exact subagent prompt wording (general-purpose agents, following D-18 extraction scopes).
- Internal formatting of `RECOVERY_LOG.md` sections (tables for catalogs, prose for contracts, code blocks for payloads).
- Whether to patch `ROADMAP.md` Phase 0 success criteria in this phase vs defer to Phase 1 (recommend in-phase patch for clean transition).
- Whether to fix the wrong `src.bak/src/quickask.tsx` path in `STATE.md` (recommend yes — one-line fix).

---

## Deferred Ideas

None. Discussion stayed within phase scope; the ROADMAP.md success-criteria reframe is an in-phase follow-on, not deferred.
