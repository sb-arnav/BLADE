---
phase: 15-density-polish
plan: "01"
subsystem: ci-gates
tags: [spacing-tokens, css-ladder, empty-state, verify-gate, a11y-copy]

# Dependency graph
requires:
  - phase: 09-polish
    provides: EmptyState primitive + verify-empty-state-coverage shape reference
  - phase: 14-wiring-a11y
    provides: verify-a11y-pass-2.mjs script shape + verify:all chain insertion point
provides:
  - Canonical SPACING-LADDER.md documenting --s-1..--s-20 + whitelist policy
  - scripts/verify-spacing-ladder.mjs — fails on off-ladder layout padding / margin / gap
  - scripts/verify-empty-states-copy.mjs — fails on bare-negation EmptyState labels
  - package.json verify:all chain extended with both new gates
  - First-run violation backlog (135 spacing + 9 empty-state) for Plans 15-02..15-04
affects: [15-02, 15-03, 15-04, 15-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CI gate script shape: Node ESM + walkDir + violations array + Scanned-summary + exit 0/1"
    - "Whitelist-as-Set pattern: VALUE_WHITELIST + selector-scoped CHIP_WHITELIST gated by CHIP_SELECTOR_RE"
    - "Bare-negation copy policy with 3-path escape (CTA / description-timeline / label-timeline)"

key-files:
  created:
    - .planning/phases/15-density-polish/SPACING-LADDER.md
    - scripts/verify-spacing-ladder.mjs
    - scripts/verify-empty-states-copy.mjs
  modified:
    - package.json

key-decisions:
  - "Whitelist encodes the SPACING-LADDER.md chip/pill exception list literally — first-run failures intentionally expose ladder drift as Wave 1 backlog"
  - "Empty-state policy gates on 3 escape hatches; dynamic (non-literal) labels skipped since they cannot be statically evaluated"
  - "src/styles/tokens.css + src/styles/layout.css excluded from spacing-ladder scope — they DEFINE the scale"

patterns-established:
  - "Phase 15 gate shape: Node ESM .mjs matching verify-a11y-pass-2 (walkDir helper, violations array, Scanned summary line, exit 0/1 contract)"
  - "Spacing-ladder violations reported as '{file}:{line} — {selector} { {property}: {value}; } — not in spacing ladder or whitelist'"
  - "Empty-states-copy violations reported as '{file}:{line} — label=\"{label}\" — {reason}'"

requirements-completed: [DENSITY-01, DENSITY-06, DENSITY-05]

# Metrics
duration: 5m
completed: 2026-04-24
---

# Phase 15 Plan 01: Spacing Ladder + Empty-State Copy Gates Summary

**SPACING-LADDER.md documents the canonical --s-1..--s-20 scale + whitelist, and two new CI gates (verify:spacing-ladder, verify:empty-states-copy) ship wired into verify:all — both intentionally fail on first run (135 + 9 violations) to define the Wave 1 refactor backlog.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-24T08:37:43Z
- **Completed:** 2026-04-24T08:42:07Z
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- Canonical SPACING-LADDER.md with all 7 required sections, 11 tokens enumerated, whitelist patterns explicit so verify script can encode them mechanically
- verify-spacing-ladder.mjs walks src/features + src/design-system + src/styles (excluding tokens.css + layout.css) and flags off-ladder padding / margin / gap literals; honors always-allowed values + chip-scoped pill micro-padding + scrollbar/traffic-light blanket pass
- verify-empty-states-copy.mjs walks src/features TSX for bare-negation `<EmptyState>` labels and fails unless CTA, description-timeline, or label-timeline escape applies
- Both gates wired into verify:all after verify:a11y-pass-2
- Initial run captures exact backlog for Wave 1: 135 spacing violations across 39 CSS files, 9 bare-negation EmptyStates across 173 TSX files

## Task Commits

Each task was committed atomically:

1. **Task 1: Document the spacing ladder (SPACING-LADDER.md)** — `2450128` (docs)
2. **Task 2: Create verify scripts + wire into package.json** — `842db91` (feat)

## Files Created/Modified

- `.planning/phases/15-density-polish/SPACING-LADDER.md` (created) — 7 canonical sections: Canonical Scale, Allowed Uses, Whitelist, Violation Definition, Scope, Empty-State Copy Rules, Enforcement
- `scripts/verify-spacing-ladder.mjs` (created) — Node ESM gate; walks 3 directory roots; 135 first-run violations
- `scripts/verify-empty-states-copy.mjs` (created) — Node ESM gate; walks src/features TSX; 9 first-run violations
- `package.json` (modified) — added `verify:spacing-ladder` + `verify:empty-states-copy` script defs, appended both to `verify:all` chain after `verify:a11y-pass-2`

## First-Run Violation Counts (Wave 1 backlog)

Both gates FAIL on first run by design — the violation count defines the backlog Plans 15-02..15-04 close against.

| Gate | Exit | Scanned | Violations |
|------|------|---------|------------|
| `verify:spacing-ladder` | 1 | 39 CSS files | **135** |
| `verify:empty-states-copy` | 1 | 173 TSX files | **9** |

### Top spacing-ladder offenders (by file)

- `src/features/body/body.css` — many `gap: 4px`, `margin: 2px 0 0` patterns
- `src/features/admin/admin-rich-a.css` — many `gap: 4px`, report/status chip micro-padding that falls outside the chip whitelist selector regex
- `src/features/chat/chat.css` — `padding: 10px 14px`, `padding: 10px 12px`, `padding: 4px 10px`, etc.
- `src/features/agents/agents-dag-pack.css` — swarm sidebar `gap: 4px` / `gap: 6px`
- `src/features/agents/SwarmDAG.css` — `gap: 4px`, `padding: 1px 6px`

### Empty-state copy offenders (9 sites, all bare "No X" / "No X yet")

1. `src/features/admin/ModelComparison.tsx:129` — `"No comparisons yet"`
2. `src/features/agents/AgentDetail.tsx:305` — `"No events yet"`
3. `src/features/body/WorldModel.tsx:301` — `"No processes"`
4. `src/features/body/WorldModel.tsx:353` — `"No recent changes"`
5. `src/features/identity/CharacterBible.tsx:171` — `"No traits yet"`
6. `src/features/knowledge/KnowledgeBase.tsx:235` — `"No matches"`
7. `src/features/life-os/EmotionalIntelView.tsx:231` — `"No insights yet"`
8. `src/features/life-os/PredictionsView.tsx:176` — `"No predictions yet"`
9. `src/features/life-os/SocialGraphView.tsx:302` — `"No contacts yet"`

## Decisions Made

- **Whitelist encoded literally from SPACING-LADDER.md.** The verify script's `VALUE_WHITELIST` + `CHIP_WHITELIST_VALUES` Sets + `CHIP_SELECTOR_RE` mirror the doc exactly. Future additions to the whitelist edit both the doc AND the Set in the script — this is the contract.
- **CHIP_SELECTOR_RE uses `\.(chip|pill|badge|status|tlight|...)` (word-boundary `.`) rather than substring match.** This is per the plan's `<interfaces>` spec. Consequence: selectors like `.report-source-chip` with `chip` in the middle do NOT hit the chip whitelist — they'll register as violations in Wave 1 and be refactored to either use the ladder or rename to `.chip-report-source` to match the convention.
- **Dynamic `<EmptyState label={variable}>` labels skipped.** Static literal labels are the gate's jurisdiction; dynamic labels are product code's jurisdiction (they carry runtime data and are outside the bare-negation copy concern).
- **tokens.css + layout.css excluded from spacing-ladder scope by name.** They DEFINE the scale; scanning them would recursively flag the definition site.

## Deviations from Plan

None — plan executed exactly as written. First-run failures are expected per the plan's stated contract:

> The scripts are allowed to FAIL on first run — that failure defines the backlog for Plans 15-02 through 15-04.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 1 (Plans 15-02, 15-03, 15-04) is unblocked. The violation backlog is concrete:

- **Plan 15-02 / 15-03** (spacing ladder refactor) — 135 sites to migrate to `var(--s-*)` or to earn whitelist entries (for genuine chip/pill selectors) or selector renames
- **Plan 15-04** (empty-state copy rewrite) — 9 sites to rewrite with CTA, timeline description, or label timeline phrasing

The final gate check is `npm run verify:spacing-ladder && npm run verify:empty-states-copy` both exiting 0.

## Self-Check: PASSED

- `.planning/phases/15-density-polish/SPACING-LADDER.md` — FOUND
- `scripts/verify-spacing-ladder.mjs` — FOUND
- `scripts/verify-empty-states-copy.mjs` — FOUND
- `package.json` contains `verify:spacing-ladder` + `verify:empty-states-copy` (2 occurrences each) — FOUND
- `verify:all` chain tail contains `verify:spacing-ladder && npm run verify:empty-states-copy` — FOUND
- Commit `2450128` (Task 1) — FOUND
- Commit `842db91` (Task 2) — FOUND
- `npx tsc --noEmit` exit 0 — CLEAN
- `node scripts/verify-spacing-ladder.mjs` runs, emits `[verify:spacing-ladder] Scanned 39 files...` — CONFIRMED
- `node scripts/verify-empty-states-copy.mjs` runs, emits `[verify:empty-states-copy] Scanned 173 TSX files...` — CONFIRMED

---
*Phase: 15-density-polish*
*Completed: 2026-04-24*
