# Phase 31: Close - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 10 (new/modified documentation files)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `README.md` (add Cognitive Architecture section) | documentation | N/A | `README.md` lines 39-69 (competitive table) | exact |
| `README.md` (add Research Foundations section) | documentation | N/A | `README.md` lines 357-365 (Contributing/License area) | exact |
| `README.md` (update competitive table rows) | documentation | N/A | `README.md` lines 42-69 (existing table rows) | exact |
| `CHANGELOG.md` (v1.3 + v1.4 entries) | documentation | N/A | `CHANGELOG.md` lines 10-68 (existing v1.2 entry) | exact |
| `.planning/milestones/v1.4-MILESTONE-AUDIT.md` | documentation | N/A | `.planning/milestones/v1.2-MILESTONE-AUDIT.md` | exact |
| `.planning/milestones/v1.3-MILESTONE-AUDIT.md` | documentation | N/A | `.planning/milestones/v1.2-MILESTONE-AUDIT.md` | exact |
| `.planning/milestones/v1.4-ROADMAP.md` | config | N/A | `.planning/milestones/v1.2-ROADMAP.md` (frozen copy) | exact |
| `.planning/milestones/v1.4-REQUIREMENTS.md` | config | N/A | `.planning/milestones/v1.2-REQUIREMENTS.md` (frozen copy) | exact |
| `.planning/milestones/v1.3-ROADMAP.md` | config | N/A | `.planning/milestones/v1.2-ROADMAP.md` (frozen copy) | exact |
| `.planning/STATE.md` (mark v1.4 complete) | config | N/A | `.planning/STATE.md` current format | exact |

## Pattern Assignments

### `README.md` — Cognitive Architecture Section (documentation)

**Analog:** `README.md` itself — the "What makes it different" section ending at line 69, followed by "Core Features" starting at line 73.

**Insertion point:** After the competitive table (line 69, end of `---` separator after table), before `## Core Features` (line 73).

**Competitive table column structure** (lines 42-69):
```markdown
| Capability | BLADE | Hermes Agent | OpenClaw | Omi | Cluely | Screenpipe | Jan | Open Interpreter | Claude Code |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Native desktop app (not daemon/CLI) | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | CLI |
```

**New rows pattern** (same column order, all competitors get ✗):
```markdown
| Metacognitive uncertainty routing | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Hormone-modulated personality | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Active inference (prediction error → behavior change) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Vitality with real stakes (dormancy) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
```

**Section heading pattern** (matching existing `## Core Features`, `## Ghost Mode` style):
```markdown
## Cognitive Architecture

[one-paragraph thesis]

- **[Capability Name]** — [one-sentence explanation]
- **[Capability Name]** — [one-sentence explanation]
```

**Module count update locations:**
- Line 248: `src-tauri/src/                    # Rust backend (140+ modules)` → change to `204+ modules`
- Line 9: `60+ native tools` (keep as-is — tools != commands)

---

### `README.md` — Research Foundations Section (documentation)

**Analog:** `README.md` lines 357-365 (Contributing + License sections)

**Insertion point:** Before `## Contributing` (line 357), after the `---` separator at line 355.

**Section format** (matching existing heading style):
```markdown
## Research Foundations

BLADE's cognitive architecture is grounded in peer-reviewed research:

- Author(s) (Year). Title. *Venue*.
- Author(s) (Year). Title. *Venue*.
```

**End with standard separator:**
```markdown
---
```

---

### `CHANGELOG.md` — v1.2/v1.3/v1.4 Entries (documentation)

**Analog:** `CHANGELOG.md` lines 10-68 (existing `[Unreleased]` / v1.2 entry)

**Entry header pattern** (lines 10-14):
```markdown
## [Unreleased]

### Added (v1.2 — Acting Layer with Brain Foundation)

> Shipped 2026-04-30 across phases 16–20 (5 phases planned; 19 deferred to v1.3 under operator chat-first pivot). 89 commits since 2026-04-29. Static gates: `cargo check` clean · `npx tsc --noEmit` clean · `npm run verify:all` 31/31 sub-gates green · `bash scripts/verify-eval.sh` 5/5 floors green.
```

**Per-phase sub-entry pattern** (lines 16-20):
```markdown
**Phase 16 — Eval Scaffolding Expansion** *(shipped 2026-04-29)*
- 5 eval modules under `tests/evals/` driving asserted floors per module (top-3 ≥ 80% / MRR ≥ 0.6): `hybrid_search_eval`, `real_embedding_eval`, `kg_integrity_eval`, `typed_memory_eval`, `capability_gap_eval`. All 5 baselines @ MRR 1.000.
- `verify:eval` script gates `npm run verify:all` chain (chain count 30→31).
- Scored-table format `┌──` rows emit per module per run; rows feed Phase 17 Doctor's eval-history source.
- 8/8 EVAL-XX requirements satisfied; `DEFERRED.md` with 4 v1.3 entries (multi-eval LLM-as-judge, eval-replay-on-PR, eval-MCP-fixtures, eval-trend-graphs).
```

**Version header transformation:**
- Current `## [Unreleased]` content becomes `## [1.2.0] — 2026-04-30`
- New `## [Unreleased]` section is empty (just header)
- New `## [1.3.0] — 2026-05-02` section added
- New `## [1.4.0] — 2026-05-03` section added

**Ordering (top to bottom):**
```markdown
## [Unreleased]

## [1.4.0] — 2026-05-03

### Added (v1.4 — Cognitive Architecture)

> Shipped 2026-05-03 across phases 25–30 ...

## [1.3.0] — 2026-05-02

### Added (v1.3 — Self-extending Agent Substrate)

> Shipped 2026-05-02 across phases 21–24 ...

## [1.2.0] — 2026-04-30

### Added (v1.2 — Acting Layer with Brain Foundation)
[moved from current [Unreleased]]
```

**Deferred subsection pattern** (lines 58-64):
```markdown
### Deferred (v1.3+)
- JARVIS-01 (PTT global hotkey) + JARVIS-02 (Whisper STT integration with dispatcher) — `18-DEFERRAL.md`.
```

---

### `.planning/milestones/v1.4-MILESTONE-AUDIT.md` (documentation)

**Analog:** `.planning/milestones/v1.2-MILESTONE-AUDIT.md`

**YAML frontmatter pattern** (lines 1-47):
```yaml
---
milestone: v1.4
milestone_name: Cognitive Architecture
audited: 2026-05-03T00:00:00Z
status: complete
scores:
  requirements: 42/42 (mapped); 38/42 (verified); 4/42 (close phase — this audit)
  phases: 7/7 routed (25-30 shipped + 31 close)
  integration: verified-static (cross-phase wiring traced via VERIFICATION.md chains)
  flows: eval-verified (13/13 organism fixtures, MRR=1.000)
gaps: []
tech_debt: []
nyquist:
  compliant_phases: 6
  partial_phases: 0
  missing_phases: 1
  overall: All feature phases (25-30) have VERIFICATION.md; Phase 31 is docs-only
---
```

**Markdown body structure** (from v1.2 analog):
```markdown
# v1.4 — Milestone Audit

**Milestone:** v1.4 — Cognitive Architecture (started 2026-05-02, shipped 2026-05-03)
**Phases:** 25..31 (7 phases scoped; 6 feature + 1 close)
**Status:** `complete` — all feature phases shipped with full organism eval
**Audited:** 2026-05-03
**Total commits:** [count]

---

## Executive Verdict

[2-3 paragraph summary of what v1.4 achieved]

---

## Phase Coverage

| Phase | Plans | SUMMARY chain | Status | Score |
|-------|-------|---------------|--------|-------|
| 25. Metacognitive Controller | X/X ✓ | present | **shipped** | ... |
| 26. Safety Bundle | X/X ✓ | present | **shipped** | ... |
...

---

## Requirements Coverage (3-source cross-reference)

| Category | Count | Phase | ROADMAP | SUMMARYs | REQUIREMENTS.md | Final |
...

---

## Static Gates

| Gate | Status | Detail |
|------|--------|--------|
| `cargo check` | ✅ | ... |
| `npx tsc --noEmit` | ✅ | ... |
| `npm run verify:all` | ✅ 37/37 | ... |

---

## Sign-off

[Final paragraph]
```

---

### `.planning/milestones/v1.3-MILESTONE-AUDIT.md` (documentation, retroactive)

**Analog:** `.planning/milestones/v1.2-MILESTONE-AUDIT.md` (same structure, simpler content since it's retroactive)

**YAML frontmatter pattern:**
```yaml
---
milestone: v1.3
milestone_name: Self-extending Agent Substrate
audited: 2026-05-03T00:00:00Z
status: complete
scores:
  requirements: 30/30 (mapped); 30/30 (verified)
  phases: 4/4 routed (21-24 shipped)
  integration: verified-static
  flows: verified (33 verify gates green at close)
gaps: []
tech_debt: []
nyquist:
  compliant_phases: 4
  partial_phases: 0
  missing_phases: 0
  overall: All phases have VERIFICATION.md or equivalent summaries
---
```

**Body:** Same section structure as v1.4 audit but shorter (retroactive — focused on recording facts, not deep analysis).

---

### `.planning/milestones/v1.4-ROADMAP.md` and `.planning/milestones/v1.4-REQUIREMENTS.md` (config, frozen snapshots)

**Analog:** `.planning/milestones/v1.2-ROADMAP.md` and `.planning/milestones/v1.2-REQUIREMENTS.md`

**Pattern:** Exact copy of current file at time of milestone close.
```bash
cp .planning/ROADMAP.md .planning/milestones/v1.4-ROADMAP.md
cp .planning/REQUIREMENTS.md .planning/milestones/v1.4-REQUIREMENTS.md
```

---

### `.planning/milestones/v1.3-ROADMAP.md` and `.planning/milestones/v1.3-REQUIREMENTS.md` (config, reconstructed)

**Analog:** `.planning/milestones/v1.2-ROADMAP.md`

**Pattern:** Extract v1.3 requirements (SKILLS-01..08, VOYAGER-01..09, REWARD-01..07, DREAM-01..06) from current ROADMAP.md v1.3 section. Format as standalone document matching the existing REQUIREMENTS.md structure. For ROADMAP, extract the v1.3 phase details section.

---

### Phase Archive Operations (filesystem)

**Analog:** `.planning/milestones/v1.2-phases/` directory structure

**Existing archive pattern** (verified):
```
.planning/milestones/v1.2-phases/
├── 16-eval-scaffolding-expansion/
├── 17-doctor-module/
├── 18-jarvis-ptt-cross-app/
└── 19-operator-uat-close/
```

**v1.4 archive commands:**
```bash
mkdir -p .planning/milestones/v1.4-phases
mv .planning/phases/25-metacognitive-controller .planning/milestones/v1.4-phases/
mv .planning/phases/26-safety-bundle .planning/milestones/v1.4-phases/
mv .planning/phases/27-hormone-physiology .planning/milestones/v1.4-phases/
mv .planning/phases/28-active-inference-loop .planning/milestones/v1.4-phases/
mv .planning/phases/29-vitality-engine .planning/milestones/v1.4-phases/
mv .planning/phases/30-organism-eval .planning/milestones/v1.4-phases/
```

**v1.3 archive commands (restore from git first):**
```bash
git checkout HEAD -- .planning/phases/21-skills-v2-agentskills/
git checkout HEAD -- .planning/phases/22-voyager-loop-closure/
git checkout HEAD -- .planning/phases/23-verifiable-reward-ood-eval/
git checkout HEAD -- .planning/phases/24-skill-consolidation-dream-mode/
mkdir -p .planning/milestones/v1.3-phases
mv .planning/phases/21-skills-v2-agentskills .planning/milestones/v1.3-phases/
mv .planning/phases/22-voyager-loop-closure .planning/milestones/v1.3-phases/
mv .planning/phases/23-verifiable-reward-ood-eval .planning/milestones/v1.3-phases/
mv .planning/phases/24-skill-consolidation-dream-mode .planning/milestones/v1.3-phases/
```

---

### `.planning/STATE.md` Update (config)

**Analog:** `.planning/STATE.md` current format (lines 1-15)

**YAML frontmatter update pattern:**
```yaml
---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: Cognitive Architecture
status: complete
stopped_at: Phase 31 shipped — milestone closed
last_updated: "2026-05-03T..."
last_activity: 2026-05-03
progress:
  total_phases: 7
  completed_phases: 7
  total_plans: 24
  completed_plans: 24
  percent: 100
---
```

**Body update:** Clear accumulated context, mark v1.4 as shipped, note "v1.5 planning not yet started."

---

## Shared Patterns

### Keep a Changelog Format
**Source:** `CHANGELOG.md` lines 1-7
**Apply to:** All CHANGELOG entries
```markdown
# Changelog

All notable changes to BLADE are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
```

### Milestone Audit YAML Frontmatter
**Source:** `.planning/milestones/v1.2-MILESTONE-AUDIT.md` lines 1-47
**Apply to:** Both v1.3 and v1.4 audit files
```yaml
---
milestone: vX.Y
milestone_name: [Name]
audited: [ISO timestamp]
status: complete
scores:
  requirements: X/X (mapped); X/X (verified)
  phases: X/X routed
  integration: [description]
  flows: [description]
gaps: []
tech_debt: []
nyquist:
  compliant_phases: X
  partial_phases: X
  missing_phases: X
  overall: [description]
---
```

### Phase Sub-Entry in CHANGELOG
**Source:** `CHANGELOG.md` lines 16-20
**Apply to:** All per-phase bullet entries in v1.3 and v1.4 sections
```markdown
**Phase NN — [Phase Name]** *(shipped YYYY-MM-DD)*
- [Key deliverable 1]
- [Key deliverable 2]
- [Metrics: test counts, gate counts, requirement satisfaction]
```

### README Section Separator
**Source:** `README.md` throughout (lines 21, 69, 168, 203, etc.)
**Apply to:** Before and after new sections
```markdown
---
```

### Frozen Snapshot Pattern
**Source:** `.planning/milestones/v1.2-ROADMAP.md` (exact copy of ROADMAP.md at v1.2 close)
**Apply to:** v1.3 and v1.4 snapshot files
- Copy the file as-is; do not modify content
- File name format: `milestones/vX.Y-FILENAME.md`

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All files have exact analogs from the v1.2 close pattern |

## Metadata

**Analog search scope:** Repository root (`README.md`, `CHANGELOG.md`), `.planning/milestones/`, `.planning/phases/`, `.planning/STATE.md`
**Files scanned:** 8 analog files read
**Pattern extraction date:** 2026-05-03
