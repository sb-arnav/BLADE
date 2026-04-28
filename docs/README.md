# `docs/` — BLADE Documentation

Long-form documentation. For the master index across the whole repo (operating files, planning, etc.), see [`../DOCS.md`](../DOCS.md).

## Folders

| Folder | What's in it |
|---|---|
| [`apple-research/`](apple-research/) | Apple-grade design system — the 10 design rules, design tokens, HIG and Pro-App briefs |
| [`architecture/`](architecture/) | Cross-cutting architecture — connection map, body mapping, dated design docs |
| [`research/`](research/) | Prior-art deep-reads — Cluely, Omi, OpenClaw, Pluely, ambient-intelligence synthesis |
| [`superpowers/`](superpowers/) | Pre-GSD-era spec + plan archive (reference only — current planning lives in `../.planning/`) |
| [`testing ss/`](./testing%20ss/) | UAT screenshot evidence directory (literal space in path — quote it in shell) |

## Top-level files

| File | Purpose |
|---|---|
| [`AGI-V3-VISION.md`](AGI-V3-VISION.md) | Long-form AGI blueprint — atomic substrate to global super-organism |
| [`HIVE_PLAN.md`](HIVE_PLAN.md) | BLADE Hive master plan (2026-04-15) |

## When to add a new doc here

- **Design / architecture rule** that should outlive any single phase → `architecture/` or `apple-research/`
- **Research write-up** about a competitor or external system → `research/`
- **Phase-scoped planning** → use `/gsd-plan-phase` and let it land in `../.planning/phases/NN-*/`
- **Operator runbook / slash command** → `../.claude/commands/`

After adding, register it in [`../DOCS.md`](../DOCS.md). Floating docs not in the index get lost.
