---
phase: 31
slug: close
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-03
---

# Phase 31 — Validation Strategy

> Documentation-only phase. No code changes — validation is file-existence and content checks.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Shell assertions (grep, test -f) |
| **Config file** | none |
| **Quick run command** | `cargo check && npx tsc --noEmit` |
| **Full suite command** | `npm run verify:all` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After archive operations:** Run `cargo check && npx tsc --noEmit` (confirm no broken imports)
- **After all tasks:** Run `npm run verify:all`

---

## Validation Dimensions

### Content correctness
- README contains all 6 citation authors (Friston, Wang, Butlin, Ngo, Ryan, Greenberg)
- CHANGELOG has `## [1.4.0]` and `## [1.3.0]` sections
- Milestone audit YAML frontmatter has `status: complete`

### File structure
- `milestones/v1.4-MILESTONE-AUDIT.md` exists
- `milestones/v1.3-MILESTONE-AUDIT.md` exists
- `milestones/v1.4-phases/` contains dirs 25-30
- `milestones/v1.3-phases/` contains dirs 21-24
- `milestones/v1.4-ROADMAP.md` exists
- `milestones/v1.4-REQUIREMENTS.md` exists

### Build integrity
- `cargo check` exit 0 after phase archive
- `npx tsc --noEmit` exit 0 after phase archive
- `npm run verify:all` exit 0

---
