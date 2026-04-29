# BLADE — Documentation Index

Every human-readable doc in the repo, mapped. If you can't find what you need from here, it isn't written down.

> **Auto-generated structure, hand-maintained content.** When you add a doc, add a one-line entry in the right section below. Keep entries under ~120 chars.

---

## Start here (read in order)

| # | File | What it gives you |
|---|---|---|
| 1 | [`README.md`](README.md) | Project pitch — what BLADE is, install, screenshots |
| 2 | [`CLAUDE.md`](CLAUDE.md) | Operating file for AI agents — build commands, module map, verification protocol, what NOT to do |
| 3 | [`HANDOFF.md`](HANDOFF.md) | Frontend onboarding — Tauri ↔ React contract, page backlog, common gotchas |
| 4 | [`BLADE_CONTEXT.md`](BLADE_CONTEXT.md) | Full technical context — give to any AI to bootstrap them on the codebase |
| 5 | [`CHANGELOG.md`](CHANGELOG.md) | Versioned ship log (Keep-a-Changelog format) |
| 6 | [`.planning/notes/INDEX.md`](.planning/notes/INDEX.md) | **Arnav's ideation index** — every dump, captured note, phase Q&A log, and where to find raw session transcripts |

---

## Operating files (repo root)

| File | Purpose |
|---|---|
| [`README.md`](README.md) | Public-facing pitch + install |
| [`CLAUDE.md`](CLAUDE.md) | AI-agent operating rules — build, module map, verification protocol, anti-patterns |
| [`HANDOFF.md`](HANDOFF.md) | Frontend handoff — 30-min onboarding for new contributors |
| [`BRIDGE.md`](BRIDGE.md) | Coordination notes between Claude (backend) and Artemis (UI) — split ownership rules |
| [`BLADE_CONTEXT.md`](BLADE_CONTEXT.md) | Comprehensive technical context document |
| [`CHANGELOG.md`](CHANGELOG.md) | Ship log |
| [`DOCS.md`](DOCS.md) | This file — master index |

---

## Architecture & design (`docs/`)

### Apple-grade design system — [`docs/apple-research/`](docs/apple-research/)

| File | Purpose |
|---|---|
| [`README.md`](docs/apple-research/README.md) | The 10 design rules — non-negotiable visual constraints |
| [`DESIGN_TOKENS.md`](docs/apple-research/DESIGN_TOKENS.md) | Ship-ready CSS + TS tokens — single source of truth |
| [`hig/brief.md`](docs/apple-research/hig/brief.md) | Apple HIG × Liquid Glass design brief for Tauri always-on agent |
| [`pro-apps/brief.md`](docs/apple-research/pro-apps/brief.md) | Pro-app translation — Logic / Final Cut / Xcode patterns for Tauri+React |

### Architecture — [`docs/architecture/`](docs/architecture/)

| File | Purpose |
|---|---|
| [`connection-map.md`](docs/architecture/connection-map.md) | Full Rust↔frontend command + event registry — verified against source |
| [`body-mapping.md`](docs/architecture/body-mapping.md) | Biology-to-machine mapping — every organ to a software structure |
| [`2026-04-16-blade-body-architecture-design.md`](docs/architecture/2026-04-16-blade-body-architecture-design.md) | Body architecture design doc |
| [`2026-04-17-blade-frontend-architecture.md`](docs/architecture/2026-04-17-blade-frontend-architecture.md) | Frontend architecture design doc |

### Long-form vision

| File | Purpose |
|---|---|
| [`docs/AGI-V3-VISION.md`](docs/AGI-V3-VISION.md) | Long-form AGI blueprint — atomic substrate to global super-organism |
| [`docs/HIVE_PLAN.md`](docs/HIVE_PLAN.md) | BLADE Hive master plan (2026-04-15) |

---

## Prior-art research (`docs/research/`)

Competitive deep-reads done before/during the V1 rebuild. Read when designing a feature that overlaps another product.

| File | Subject |
|---|---|
| [`ambient-intelligence-synthesis.md`](docs/research/ambient-intelligence-synthesis.md) | Synthesized ambient-intel patterns for BLADE |
| [`cluely-real-notes.md`](docs/research/cluely-real-notes.md) | Cluely (real product) — public research notes |
| [`cluely-real-technical.md`](docs/research/cluely-real-technical.md) | Cluely — full technical breakdown from leaks + reverse engineering |
| [`cheap-cluely-deep-read.md`](docs/research/cheap-cluely-deep-read.md) | `cheap-cluely` open-source clone — deep read |
| [`omi-deep-read.md`](docs/research/omi-deep-read.md) | Omi (BasedHardware) — deep read |
| [`openclaw-deep-read.md`](docs/research/openclaw-deep-read.md) | OpenClaw — deep read |
| [`openclaw-gateway-deep-read.md`](docs/research/openclaw-gateway-deep-read.md) | OpenClaw gateway + agent loop — focused deep read |
| [`pluely-deep-read.md`](docs/research/pluely-deep-read.md) | Pluely (Tauri+Rust Cluely clone) — deep read |

---

## Plan + spec archive (`docs/superpowers/`)

Pre-GSD-era spec/plan documents. Reference only — current planning lives in `.planning/`.

| File | Purpose |
|---|---|
| [`specs/2026-04-10-blade-ai-os-v3-design.md`](docs/superpowers/specs/2026-04-10-blade-ai-os-v3-design.md) | Blade AI OS v3 — design spec |
| [`specs/2026-04-15-dashboard-first-layout-design.md`](docs/superpowers/specs/2026-04-15-dashboard-first-layout-design.md) | Dashboard-first layout — design spec |
| [`specs/2026-04-16-blade-body-architecture-design.md`](docs/superpowers/specs/2026-04-16-blade-body-architecture-design.md) | Body architecture — design spec |
| [`plans/2026-04-15-dashboard-first-layout.md`](docs/superpowers/plans/2026-04-15-dashboard-first-layout.md) | Dashboard-first layout — implementation plan |
| [`plans/2026-04-16-hive-chat-bridge.md`](docs/superpowers/plans/2026-04-16-hive-chat-bridge.md) | Hive ↔ Chat bridge — implementation plan |

---

## Planning system (`.planning/` — GSD workflow)

The active planning surface. Per-phase folders, codebase audits, research, milestones.

### Top-level meta

| File | Purpose |
|---|---|
| [`PROJECT.md`](.planning/PROJECT.md) | Project north-star — what BLADE is and why |
| [`ROADMAP.md`](.planning/ROADMAP.md) | Live roadmap across milestones |
| [`MILESTONES.md`](.planning/MILESTONES.md) | Historical record of shipped versions |
| [`STATE.md`](.planning/STATE.md) | Current GSD execution state |
| [`RECOVERY_LOG.md`](.planning/RECOVERY_LOG.md) | Pre-rebuild audit — QuickAsk / Voice Orb / onboarding contracts captured before nuke |
| [`HANDOFF-TO-MAC.md`](.planning/HANDOFF-TO-MAC.md) | Mac-smoke checkpoint queue (operator UAT for Mac platform) |
| [`migration-ledger.md`](.planning/migration-ledger.md) | 82-row ledger — every shipped route, src.bak → src migration trace |

### Codebase audit ([`codebase/`](.planning/codebase/))

Snapshot 2026-04-17 — refresh by re-running `/gsd-map-codebase`.

| File | Purpose |
|---|---|
| [`ARCHITECTURE.md`](.planning/codebase/ARCHITECTURE.md) | Architecture overview |
| [`STACK.md`](.planning/codebase/STACK.md) | Technology stack |
| [`STRUCTURE.md`](.planning/codebase/STRUCTURE.md) | Directory + module structure |
| [`CONVENTIONS.md`](.planning/codebase/CONVENTIONS.md) | Coding conventions |
| [`CONCERNS.md`](.planning/codebase/CONCERNS.md) | Known concerns / tech debt |
| [`INTEGRATIONS.md`](.planning/codebase/INTEGRATIONS.md) | External integrations |
| [`TESTING.md`](.planning/codebase/TESTING.md) | Testing patterns |

### Research ([`research/`](.planning/research/))

Phase-0 research bundle that fed the V1 skin rebuild.

| File | Purpose |
|---|---|
| [`SUMMARY.md`](.planning/research/SUMMARY.md) | Skin-rebuild research summary |
| [`ARCHITECTURE.md`](.planning/research/ARCHITECTURE.md) | Multi-window Tauri architecture research |
| [`STACK.md`](.planning/research/STACK.md) | Stack research — macOS Liquid Glass desktop AI |
| [`FEATURES.md`](.planning/research/FEATURES.md) | Feature landscape — ambient/memory/autonomy/voice |
| [`PRIOR_ART.md`](.planning/research/PRIOR_ART.md) | User-gathered prior art — distilled actionable claims |
| [`PITFALLS.md`](.planning/research/PITFALLS.md) | Pitfalls research — multi-window + glass + wiring traps |
| [`questions.md`](.planning/research/questions.md) | Open research questions surfaced during exploration |

### Notes ([`notes/`](.planning/notes/))

Free-form ideation captured between phases.

| File | Purpose |
|---|---|
| [`v1-1-milestone-shape.md`](.planning/notes/v1-1-milestone-shape.md) | v1.1 milestone shape — locked during /gsd-explore |
| [`v1-2-ideation-arnav.md`](.planning/notes/v1-2-ideation-arnav.md) | v1.2 raw ideation dump |
| [`v1-2-self-improvement-maturity.md`](.planning/notes/v1-2-self-improvement-maturity.md) | v1.2 self-improvement / memory / body maturity audit |
| [`v2-vision-tentacles.md`](.planning/notes/v2-vision-tentacles.md) | v2+ vision — tentacles, heads, big agent |

### Milestone archive ([`milestones/`](.planning/milestones/))

Closed-milestone bundles — frozen at ship time, never edited.

| File | Purpose |
|---|---|
| [`v1.1-REQUIREMENTS.md`](.planning/milestones/v1.1-REQUIREMENTS.md) | v1.1 requirements (functionality, wiring, accessibility) |
| [`v1.1-ROADMAP.md`](.planning/milestones/v1.1-ROADMAP.md) | v1.1 roadmap (shipped 2026-04-24, closed 2026-04-27) |
| [`v1.1-MILESTONE-AUDIT.md`](.planning/milestones/v1.1-MILESTONE-AUDIT.md) | v1.1 close audit |

### Phase archive ([`phases/`](.planning/phases/))

Each phase has the same layout: `NN-CONTEXT.md`, `NN-PATTERNS.md`, `NN-DISCUSSION-LOG.md`, then per-plan pairs `NN-MM-PLAN.md` + `NN-MM-SUMMARY.md`. ~16 files per phase. Look here when you need the *why* behind a specific decision.

| Phase | Theme | Folder |
|---|---|---|
| 00 | Pre-Rebuild Audit | [`00-pre-rebuild-audit/`](.planning/phases/00-pre-rebuild-audit/) |
| 01 | Foundation (entries, tokens, primitives, verify gates) | [`01-foundation/`](.planning/phases/01-foundation/) |
| 02 | Onboarding + Main Shell | [`02-onboarding-shell/`](.planning/phases/02-onboarding-shell/) |
| 03 | Dashboard + Chat + Settings | [`03-dashboard-chat-settings/`](.planning/phases/03-dashboard-chat-settings/) |
| 04 | Overlay Windows (QuickAsk, Voice Orb, Ghost, HUD) | [`04-overlay-windows/`](.planning/phases/04-overlay-windows/) |
| 05 | Agents + Knowledge | [`05-agents-knowledge/`](.planning/phases/05-agents-knowledge/) |
| 06 | Life OS + Identity | [`06-life-os-identity/`](.planning/phases/06-life-os-identity/) |
| 07 | Dev Tools + Admin | [`07-dev-tools-admin/`](.planning/phases/07-dev-tools-admin/) |
| 08 | Body Visualization + Hive Mesh | [`08-body-hive/`](.planning/phases/08-body-hive/) |
| 09 | Polish Pass | [`09-polish/`](.planning/phases/09-polish/) |

---

## Other (one-offs)

| File | Purpose |
|---|---|
| [`.claude/commands/blade-uat.md`](.claude/commands/blade-uat.md) | `/blade-uat` slash command — runtime smoke checklist |
| [`src/assets/fonts/SOURCES.md`](src/assets/fonts/SOURCES.md) | Self-hosted WOFF2 attribution (D-24) |
| [`docs/testing ss/`](docs/testing%20ss/) | UAT screenshot evidence dir (literal space in path — quote it in shell) |

---

## Conventions

- **Operating files** (root) — durable rules read at session start. Keep lean.
- **`docs/`** — design rules, architecture, prior-art research. Long-lived.
- **`.planning/`** — GSD workflow output. Phase folders are write-mostly during a phase, read-only after close.
- **Closed-milestone files in `.planning/milestones/`** — never edit after archive.
- **No top-level docs outside this index.** New doc → add an entry here.
