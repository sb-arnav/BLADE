---
phase: 31-close
plan: 01
subsystem: documentation
tags: [readme, cognitive-architecture, research-citations, competitive-table]
dependency_graph:
  requires: []
  provides: [readme-v14-narrative, research-citations, competitive-table-v14]
  affects: [README.md]
tech_stack:
  added: []
  patterns: [additive-readme-edit, academic-citation-format]
key_files:
  created: []
  modified:
    - README.md
decisions:
  - "Used Butlin 2025 publication year (not 2023 preprint) per RESEARCH.md pitfall 4"
  - "Used Ngo 2026 with arXiv:2604.16009 (not 2024) per RESEARCH.md pitfall 5"
  - "Kept '60+ native tools' unchanged in intro per A4 (tools != commands)"
metrics:
  duration: "1m 57s"
  completed: "2026-05-03T17:09:50Z"
  tasks: 2
  files_modified: 1
---

# Phase 31 Plan 01: README v1.4 Cognitive Architecture Narrative Summary

README updated with v1.4 cognitive architecture narrative, 4 competitive table rows, research citations with corrected publication years, and module count update from 140+ to 204+.

## What Was Done

### Task 1: Competitive table rows and module count update
- Added 4 new rows to competitive table: Metacognitive uncertainty routing, Hormone-modulated personality, Active inference (prediction error -> behavior change), Vitality with real stakes (dormancy) -- all competitors marked with X, BLADE with checkmark
- Updated Rust backend module count from `140+ modules` to `204+ modules` in the architecture tree
- All existing table rows and sections preserved unchanged (additive only per D-06)

### Task 2: Cognitive Architecture and Research Foundations sections
- Added `## Cognitive Architecture` section after competitive table separator, before `## Core Features` (line 77)
- Thesis paragraph establishing BLADE's closed-loop physiological system as the differentiator
- 5 capability bullets: Metacognition, Safety Bundle, Hormone Physiology, Active Inference, Vitality
- Added `## Research Foundations` section before `## Contributing` (line 373)
- 6 academic citations in compact `Author(s) (Year). Title. Venue.` format:
  - Friston (2010) -- free-energy principle
  - Wang et al (2023) -- Voyager NeurIPS
  - Butlin et al (2025) -- consciousness indicators (corrected from 2023 preprint year)
  - Ryan & Deci (2000) -- Self-Determination Theory
  - Greenberg et al (1986) -- Terror Management Theory
  - Ngo et al (2026) -- MEDLEY-BENCH arXiv:2604.16009 (corrected from 2024)

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `21ec563` | feat(31-01): add v1.4 competitive table rows and update module count |
| 2 | `a2c2826` | docs(31-01): add Cognitive Architecture and Research Foundations sections |

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all content is final prose, no placeholder text or TODO markers.

## Self-Check: PASSED

- README.md: FOUND
- 31-01-SUMMARY.md: FOUND
- Commit 21ec563: FOUND
- Commit a2c2826: FOUND
