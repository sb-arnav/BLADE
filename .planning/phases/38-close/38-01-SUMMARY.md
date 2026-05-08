---
phase: 38-close
plan: 1
subsystem: docs
tags: [docs, readme, milestone-close, v1.5]
dependency_graph:
  requires:
    - "Phase 32-37 SUMMARY chains (CTX/LOOP/RES/SESS/DECOMP/INTEL/EVAL artifacts already shipped)"
  provides:
    - "README.md §Intelligence Layer (v1.5) — public surface for v1.5 narrative"
    - "README.md §Research Foundations (v1.5) — 5 citations supporting 'ported, not reinvented' claim"
    - "README.md §Roadmap §Done in v1.5 + §v1.6 — TBD — public-facing milestone marker"
  affects:
    - "Plan 38-02 (CHANGELOG entry shares per-phase narrative shape)"
    - "Plan 38-03 (MILESTONE-AUDIT cross-references README's Research Foundations citations)"
tech_stack:
  added: []
  patterns:
    - "Section-bracketed-by-separator pattern preserved (every top-level H2 surrounded by `---` lines)"
    - "H3 sub-grouping convention for version-tagged research citations (matches v1.4-style)"
key_files:
  created: []
  modified:
    - path: README.md
      change: "+36 lines: new §Intelligence Layer (v1.5) section (6 bullets) + §Research Foundations §v1.5 — Intelligence Layer subgroup (5 citations) + §Roadmap §Done in v1.5 (6 items) + §Roadmap §v1.6 — TBD (5 items)"
decisions:
  - "Inserted §Intelligence Layer (v1.5) between §Cognitive Architecture and §Core Features (line 89), preserving the existing `---` separator bracketing. Rationale: matches the README's section-bracketed-by-separator pattern and lands the v1.5 narrative immediately after the cognitive-architecture story per CONTEXT lock."
  - "Used `### v1.5 — Intelligence Layer` H3 subgroup inside §Research Foundations rather than appending flat bullets. Rationale: groups v1.5 citations distinctly from v1.0–v1.4 citations without breaking the existing flat list above; matches v1.4-style sub-grouping convention per plan Task 2."
  - "Roadmap update added BOTH `### Done in v1.5` and `### v1.6 — TBD` H3 subsections before `### What's next`, with v1.5 (the shipped entry) preceding v1.6 (the placeholder) preceding the open backlog. Rationale: planner's judgement call #1 in plan Task 3 — the current Roadmap had no 'v1.5 — Intelligence Layer (active)' line to replace, so the update reduced to APPEND."
  - "No marketing-tone changes to v1.0–v1.4 prior content. Voice extends but does not rewrite, per CONTEXT §README Update Scope."
  - "No top-of-README 'What's New in v1.5' callout added — CHANGELOG is the version-specific surface, README is evergreen."
metrics:
  duration_seconds: 480
  completed_at: "2026-05-08T14:25:50Z"
  tasks_completed: 5
  files_modified: 1
---

# Phase 38 Plan 01: README v1.5 Intelligence Layer Updates — Summary

**One-liner:** Three README inserts — `## Intelligence Layer (v1.5)` H2 section with 6 bullets covering Phase 32-37 surfaces, `### v1.5 — Intelligence Layer` H3 subgroup under §Research Foundations citing Claude Code arxiv 2604.14228 + Aider + OpenHands PR #7610 + Goose + mini-SWE-agent, and `### Done in v1.5` + `### v1.6 — TBD` Roadmap subsections — landing the v1.5 milestone narrative on BLADE's public-facing README at the section-bracketed-by-separator pattern the existing doc uses, voice declarative + technical to match Cognitive Architecture.

## What Shipped

### 1. §Intelligence Layer (v1.5) — new H2 section (lines 89–100)

6 bullets, each with bold leading term and technical body, mirroring the §Cognitive Architecture voice:
- **Selective Context Injection** (Phase 32 / CTX-01..07)
- **Verified Agentic Loop** (Phase 33 / LOOP-01..06)
- **Stuck Detection + Session Persistence** (Phase 34 / RES-01..05 + SESS-01..04)
- **Auto-Decomposition** (Phase 35 / DECOMP-01..05)
- **Context Intelligence** (Phase 36 / INTEL-01..06)
- **Intelligence Eval** (Phase 37 / EVAL-01..05)

Inserted between existing `---` separator (line 87) and existing `## Core Features` (now line 102), with its own trailing `---` separator at line 100. Bracketed-by-separator pattern preserved. Verbatim per CONTEXT §"Specifics" → "Concrete Plan 38-01 README diff shape".

### 2. §Research Foundations §v1.5 — Intelligence Layer — new H3 subgroup (lines 412–418)

5 citations appended after existing line 410 (Ngo et al MEDLEY-BENCH) and before existing `---` separator at line 420. Format identical to existing v1.0–v1.4 bullets:
- Anthropic. (2025). *Claude Code: A Production Coding Agent*. arxiv:2604.14228 — selective context injection, agentic loop, tree-sitter context awareness.
- Gauthier, P. (2023). *Aider's Repository Map*. https://aider.chat/2023/10/22/repomap.html — symbol graph + personalized PageRank pattern.
- All-Hands AI. (2025). *OpenHands Condenser Pattern*. PR #7610 (csmith49) — keep-edges-summarize-middle compaction prompt.
- Block, Inc. (2025). *Goose Capability Registry*. — per-model capability descriptors as the v1.5 canonical_models.json schema basis.
- Yang, K., Liu, X., Chen, Y., et al. (2025). *Mini-SWE-Agent: Repurposing SWE-Bench for Agent Loop Verification*. — minimal scaffold pattern for the agentic-loop verification probe.

### 3. §Roadmap — two new H3 subsections (lines 375–388)

`### Done in v1.5 (Intelligence Layer — shipped 2026-05-08; tech_debt — operator UAT pending)` with 6 checked items mirroring the §Intelligence Layer (v1.5) bullet shape but at one-liner depth, and `### v1.6 — TBD` with 5 forward-looking items (operator UAT carry-forward, OEVAL-01c v1.4 drift repair, deferred Phase 36/37 items, voice resurrection, milestone-init signal). Both subsections land between the existing `### Done in v0.6.0` block (ending line 373) and the existing `### What's next` block (now starting line 390). The existing `### Done in v0.7.4` and `### Done in v0.6.0` blocks are unchanged — they describe substrate-era work whose status hasn't changed.

## Verification (Task 4)

Three Read-tool checks against the rendered README:

- **§Intelligence Layer (v1.5)** at lines 85–109 — heading clean at 89, intro paragraph at 91, 6 bullets at 93–98 all rendering with bold leading term + double-dash + technical body, trailing `---` at 100, `## Core Features` follows at 102. No truncation. No broken bullets. **PASS**.
- **§Roadmap §Done in v1.5 + §v1.6 — TBD** at lines 355–397 — H3 at 375, 6 `[x]` items at 376–381, blank line at 382, H3 `### v1.6 — TBD` at 383, 5 forward items at 384–388, blank at 389, `### What's next` at 390. Ordering correct: `Done in v0.7.4` → `Done in v0.6.0` → `Done in v1.5` → `v1.6 — TBD` → `What's next`. **PASS**.
- **§Research Foundations §v1.5** at lines 410–420 — last v1.0–v1.4 bullet at 410, blank at 411, H3 at 412, blank at 413, 5 citations at 414–418, blank at 419, existing `---` at 420, `## Contributing` at 422. **PASS**.

No screenshot needed — Phase 38 is documentary per CONTEXT §"Backward Compatibility (None — Docs Only)".

## Judgement Calls

1. **Roadmap APPEND vs REPLACE** — Plan Task 3 anticipated this. The existing Roadmap had no "v1.5 — Intelligence Layer (active)" line to replace; the update reduced to APPEND of `### Done in v1.5` + `### v1.6 — TBD` immediately before `### What's next`. Both new H3 subsections land in chronological order after the v0.6.0 block.
2. **`### v1.5 — Intelligence Layer` H3 inside §Research Foundations** — chose H3 sub-grouping over flat-append per plan Task 2 explicit guidance ("groups v1.5 citations distinctly from v1.0–v1.4 citations without breaking the existing flat bullet list above").

## Deviations from Plan

None. Plan executed exactly as written. The README's actual `---` separator location (between Cognitive Architecture and Core Features) matched the plan's anchor expectation; the Edit tool's anchor block uniquely matched the existing structure.

## Anti-patterns Avoided

- ✅ Did NOT use `git add -A` or `git add .` — staged `git add README.md` ONLY; the 188 pre-existing `.planning/phases/00-31-*/` deletions remain unstaged
- ✅ Did NOT add Co-Authored-By line in commit message body
- ✅ Did NOT touch v1.0–v1.4 prior README bullets — extension only, no rewrite
- ✅ Did NOT add a "What's New in v1.5" callout at the top of README — CHANGELOG handles version-specific surface
- ✅ Did NOT bump version strings in package.json / Cargo.toml / tauri.conf.json — operator-controlled per CHANGELOG D-227
- ✅ Did NOT touch any production code (`src-tauri/`, `src/`)

## Commits

| Plan | Commit  | Files                | Lines              |
| ---- | ------- | -------------------- | ------------------ |
| 38-01 | 90a73f1 | README.md            | +36, -0           |

## Self-Check: PASSED

- README.md modification: FOUND (lines 89-100, 375-388, 412-418 all render clean per Task 4 reads)
- Commit 90a73f1: FOUND in `git log --oneline -1`
- No Co-Authored-By line: VERIFIED via `git log -1 --format="%H %s%n%n%b"`
- Staged set was README-only: VERIFIED via `git diff --cached --stat` showing `README.md | 36 ++++++++++` only
- No production code touched: VERIFIED — `git diff --stat HEAD~1 HEAD` shows README.md as the only modified file
