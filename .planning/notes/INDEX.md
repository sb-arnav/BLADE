# Arnav's Ideation Index

The entry point to **everything you've dumped into Claude about BLADE**. Four layers, ordered by how processed they are.

> Maintain this index whenever a new note lands in `.planning/notes/`. Plugins (`gsd-note`, `gsd-explore`, `gsd-plant-seed`) write here; humans read here.

---

## Layer 1 — Captured & curated (`.planning/notes/`)

The dumps you (or Claude) made the deliberate decision to save as standalone notes. Read these first when picking up after a break — they're the most distilled.

| File | Date | Status | One-liner |
|---|---|---|---|
| [`v1-1-milestone-shape.md`](v1-1-milestone-shape.md) | 2026-04-20 | locked | v1.1 reframed from "JARVIS demo moment" to "make BLADE actually function as the thing it already is" — wiring + accessibility focus |
| [`v2-vision-tentacles.md`](v2-vision-tentacles.md) | 2026-04-20 | vision | v2+ destination — tentacles, heads, big agent. Communications/dev/ops/business/personal domains across v2→v5+ |
| [`v1-2-ideation-arnav.md`](v1-2-ideation-arnav.md) | 2026-04-27 | ideation | Raw v1.2 brain dump — tool replacement (Hermes/OpenClaw), persona, self-upgrade, ego, growth loops |
| [`v1-2-self-improvement-maturity.md`](v1-2-self-improvement-maturity.md) | 2026-04-27 | audit | Concrete maturity audit answering the v1.2 ideation questions — self_upgrade/evolution/memory/doctor/hormones |
| [`v1-2-milestone-shape.md`](v1-2-milestone-shape.md) | 2026-04-29 | locked | v1.2 = "Acting Layer with Brain Foundation" — Eval + Doctor + JARVIS (with ego folded in) + Operator UAT close + Polish. 5 phases (16–20), 10–12 day target. Reconciles PROJECT.md authority with the maturity audit's "eval before flashy" insight |

**Convention.** New captures land here as `{slug}.md` (semantic) or `{YYYY-MM-DD}-{slug}.md` (date-prefixed, per `gsd-note` spec). Either is fine — index over filename.

---

## Layer 2 — Phase Q&A (`.planning/phases/*/NN-DISCUSSION-LOG.md`)

`/gsd-discuss-phase` captures: question-by-question Q&A locked into each phase folder. **Your voice answering specific questions** during the planning of every phase. ~2,300 lines total across 12 logs.

| Phase | Log | Lines |
|---|---|---|
| 00 — Pre-Rebuild Audit | [`00-DISCUSSION-LOG.md`](../phases/00-pre-rebuild-audit/00-DISCUSSION-LOG.md) | 66 |
| 01 — Foundation | [`01-DISCUSSION-LOG.md`](../phases/01-foundation/01-DISCUSSION-LOG.md) | 248 |
| 02 — Onboarding + Shell | [`02-DISCUSSION-LOG.md`](../phases/02-onboarding-shell/02-DISCUSSION-LOG.md) | 225 |
| 03 — Dashboard + Chat + Settings | [`03-DISCUSSION-LOG.md`](../phases/03-dashboard-chat-settings/03-DISCUSSION-LOG.md) | 276 |
| 04 — Overlay Windows | [`04-DISCUSSION-LOG.md`](../phases/04-overlay-windows/04-DISCUSSION-LOG.md) | 290 |
| 05 — Agents + Knowledge | [`05-DISCUSSION-LOG.md`](../phases/05-agents-knowledge/05-DISCUSSION-LOG.md) | 185 |
| 06 — Life OS + Identity | [`06-DISCUSSION-LOG.md`](../phases/06-life-os-identity/06-DISCUSSION-LOG.md) | 214 |
| 07 — Dev Tools + Admin | [`07-DISCUSSION-LOG.md`](../phases/07-dev-tools-admin/07-DISCUSSION-LOG.md) | 230 |
| 08 — Body + Hive | [`08-DISCUSSION-LOG.md`](../phases/08-body-hive/08-DISCUSSION-LOG.md) | 190 |
| 09 — Polish | [`09-DISCUSSION-LOG.md`](../phases/09-polish/09-DISCUSSION-LOG.md) | 181 |

**Archived (v1.1 milestone, closed 2026-04-27):**

- [`10-inventory-wiring-audit/10-DISCUSSION-LOG.md`](../milestones/v1.1-phases/10-inventory-wiring-audit/10-DISCUSSION-LOG.md) — 96 lines
- [`12-smart-deep-scan/12-DISCUSSION-LOG.md`](../milestones/v1.1-phases/12-smart-deep-scan/12-DISCUSSION-LOG.md) — 144 lines

---

## Layer 3 — Long-form vision (`docs/`)

Larger-than-a-note thinking that lives outside `.planning/`.

| File | Purpose |
|---|---|
| [`docs/AGI-V3-VISION.md`](../../docs/AGI-V3-VISION.md) | Long-form AGI blueprint — atomic substrate to global super-organism |
| [`docs/HIVE_PLAN.md`](../../docs/HIVE_PLAN.md) | BLADE Hive master plan (2026-04-15) |

---

## Layer 4 — Raw session transcripts (`~/.claude/projects/-home-arnav-blade/`)

**178 Claude Code session transcripts** (.jsonl), 2026-04-07 → 2026-04-29, ~108MB total. These are **not in git** — they're managed by Claude Code locally. Every conversation you've had with any Claude instance about BLADE.

Use when you remember saying something but can't find where it landed:

```bash
# Search all sessions for a phrase (case-insensitive, list matching files)
grep -li "hermes\|tool replacer" /home/arnav/.claude/projects/-home-arnav-blade/*.jsonl

# Pull the actual lines around a match (transcripts are JSONL — one event per line)
grep -i "hermes" /home/arnav/.claude/projects/-home-arnav-blade/*.jsonl | head -5

# Most recent 5 sessions by mtime
ls -t /home/arnav/.claude/projects/-home-arnav-blade/*.jsonl | head -5
```

When something here matters, **promote it** to a Layer 1 note via `/gsd-note "..."` so it survives the next context reset.

---

## Where new captures should land (decision tree)

| If you're saying... | Use | Lands at |
|---|---|---|
| Quick idea, no project context yet | `/gsd-note "..."` | `.planning/notes/{date}-{slug}.md` |
| Thinking through requirements / shape of a feature | `/gsd-explore` | `.planning/notes/{slug}.md` (curated) |
| Forward idea that triggers later (e.g. "do this at v1.3") | `/gsd-plant-seed` | `.planning/notes/seeds/...` |
| Mid-phase Q&A | `/gsd-discuss-phase` | `.planning/phases/NN/NN-DISCUSSION-LOG.md` |
| Architecture / design with reusable conclusions | hand-write to `docs/architecture/` | `docs/architecture/{date}-{topic}.md` |
| Daily todos / quick parking | `/gsd-add-todo` | (todos.md inside .planning) |

**Don't write loose markdown at repo root or scattered in `docs/` without a sub-folder.** That's how dumps get lost. Loose root-level markdown should only be operating files (CLAUDE, README, CHANGELOG, BRIDGE, HANDOFF, BLADE_CONTEXT, DOCS).

---

## How plugins find this

The GSD plugin's skills (`gsd-note`, `gsd-explore`, `gsd-plant-seed`, `gsd-thread`) all write to `.planning/notes/` or sibling subdirs. The compound-engineering plugin and other readers can grep the same path. **Keep this index updated and the file naming consistent and plugins keep working without per-plugin config.**

If a plugin starts dumping somewhere new, add it to the decision tree above.
