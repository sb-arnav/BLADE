---
phase: 21
slug: skills-v2-agentskills
milestone: v1.3
status: pre-plan
created: 2026-04-30T22:35Z
created_by: autonomous-handoff (operator asleep)
---

# Phase 21 — Skills v2 / agentskills.io adoption — CONTEXT

## Purpose of this doc

Pre-plan context for Phase 21. Written during autonomous milestone bootstrap before operator returns. Captures phase shape + plan list + sequencing + references so `/gsd-plan-phase 21` (when invoked, or by hand-write) has clean inputs.

This is **NOT** the formal phase plan. The formal plan is one PLAN.md per plan in this phase, frontmattered with `must_haves` truths/artifacts/key_links per the Phase 16/17/18 convention. That plan-writing belongs to gsd-planner (not installed in this project; agents_installed: false per init JSON) or to manual write per project convention.

## Phase goal

Establish the substrate format Phase 22's Voyager loop writes into. Switch BLADE's skill thinking from any prior JSON-shape (per superseded `notes/v1-3-hermes-openclaw-skills-research.md` Phase 0 reference) to **agentskills.io `SKILL.md`** (YAML frontmatter + Markdown body). Lazy-load progressive disclosure (metadata always loaded at startup; body on activation; references on traversal). Workspace → user → bundled resolution order. Validator + 3 bundled exemplars.

## Why this phase blocks Phase 22

Phase 22 (Voyager loop closure) writes new skills via `autoskills.rs`. Without a coherent SKILL.md format + write target + resolution order, autoskills has nowhere to put its output. Phase 21 is the prerequisite.

## Requirements (8 total)

From REQUIREMENTS.md `## Skills v2 / agentskills.io adoption (SKILLS) — Phase 21`:

- SKILLS-01 — `SKILL.md` parser reads YAML frontmatter + Markdown body
- SKILLS-02 — Skill directory layout enforced (SKILL.md required; scripts/ references/ assets/ optional)
- SKILLS-03 — Progressive disclosure (metadata at startup; body on activation; references on traversal)
- SKILLS-04 — Skill resolution order workspace → user → bundled; workspace wins on collision
- SKILLS-05 — `blade skill validate <path>` CLI returns structured verdict
- SKILLS-06 — 3 bundled exemplar skills at `<repo>/skills/`
- SKILLS-07 — First-run `scripts/*` execution requires explicit user consent (extends v1.2 consent infrastructure)
- SKILLS-08 — `verify:skill-format` gate landed in `verify:all` chain (count 31 → 32)

## Plan list (recommended decomposition)

**8 plans across 3 waves.** Decomposition optimizes for: small atomic commits (CLAUDE.md anchor), independent unit tests per plan, and clean parallelization opportunities in Wave 2.

### Wave 1 (sequential — substrate)

| # | Plan slug | Scope | REQ-IDs | Depends on |
|---|---|---|---|---|
| **21-01** | `parser-and-types` | New `src-tauri/src/skills/mod.rs` + `skills/parser.rs` + `skills/types.rs`. Parser reads YAML frontmatter (serde_yaml or yaml-rust2) + Markdown body. Types: `SkillFrontmatter`, `SkillBody`, `Skill`. lib.rs registration. Pure-data; zero filesystem ops. | SKILLS-01 (full), SKILLS-02 (parser-side validation) | — |
| **21-02** | `loader-and-resolver` | New `skills/loader.rs` + `skills/resolver.rs`. Walks the 3 skill dirs (`<repo>/skills/`, `~/.blade/skills/`, bundled), loads frontmatter at startup, builds in-memory catalog. Resolver per-name lookup with workspace > user > bundled precedence. | SKILLS-04 (full) | 21-01 |
| **21-03** | `lazy-load-disclosure` | Extend loader to defer body bytes until `Skill::activate()`. References (`scripts/*`, `references/*`, `assets/*`) loaded only when SKILL body cites a path. Fs read counters in test harness for assertion. | SKILLS-03 (full) | 21-02 |

### Wave 2 (parallelizable after Wave 1)

| # | Plan slug | Scope | REQ-IDs | Depends on |
|---|---|---|---|---|
| **21-04** | `validator-cli` | New `blade skill validate <path>` CLI subcommand. Wraps parser + layout enforcement + 5000-token body warning. Structured stdout JSON + stderr human-readable + exit code. | SKILLS-05 (full), SKILLS-02 (CLI surface) | 21-01 |
| **21-05** | `bundled-exemplars` | 3 SKILL.md files at `<repo>/skills/`: (a) `git-status-summary` wrapping native `bash` tool; (b) `troubleshoot-cargo-build` using `references/` for deeper docs; (c) `format-clipboard-as-markdown` using `scripts/format.py` calling back into runtime. All 3 pass validator. | SKILLS-06 (full) | 21-04 |
| **21-06** | `consent-extension` | Extend v1.2 consent infrastructure (consent.rs `consent_decisions` SQLite table + ConsentDialog frontend) to handle (skill_name, script_path) tuples. First invocation of `scripts/*` prompts; allow_always persists; subsequent invocations skip. | SKILLS-07 (full) | 21-05 (needs an exemplar with scripts to test) |

### Wave 3 (gate-closer)

| # | Plan slug | Scope | REQ-IDs | Depends on |
|---|---|---|---|---|
| **21-07** | `verify-skill-format-gate` | New `scripts/verify-skill-format.sh` runs validator across all bundled skills + asserts directory layout + asserts no body >5000 tokens (warn ≥4000). Wired into `package.json` `verify:all` chain. | SKILLS-08 (full) | 21-06 (needs all exemplars green) |
| **21-08** | `phase-summary-and-close` | 21-PHASE-SUMMARY.md aggregating all 7 plan SUMMARYs. VERIFICATION.md checks all SKILLS-01..08 closed. Update REQUIREMENTS.md traceability checkboxes. | (closes phase) | 21-01..07 |

## Sequencing diagram

```
Wave 1 (substrate, sequential):
  21-01 parser-and-types
       │
       ▼
  21-02 loader-and-resolver
       │
       ▼
  21-03 lazy-load-disclosure

Wave 2 (parallelizable after Wave 1):
  21-04 validator-cli ─────┐
  21-05 bundled-exemplars ─┼─── all three can run in parallel after 21-03 lands
  21-06 consent-extension ─┘    (21-06 has soft dep on 21-05's scripts/ exemplar
                                 for E2E test; can stub during dev)

Wave 3 (gate-closer):
  21-07 verify-skill-format-gate
       │
       ▼
  21-08 phase-summary-and-close
```

**Soft sequencing:** 21-04 / 21-05 / 21-06 can technically all run in parallel; recommended order shown for predictable phase tracking. 21-04 lands first so the validator is available to 21-05 (writes exemplars and validates them) and 21-06 (E2E test stubs).

## Reference inputs (for the planner / executor)

**Specifications:**
- [agentskills.io specification](https://agentskills.io/specification) — canonical SKILL.md schema
- [agentskills GitHub repo](https://github.com/agentskills/agentskills) — reference library + `skills-ref validate` tool
- [OpenClaw skill-creator SKILL.md](https://github.com/openclaw/openclaw/blob/main/skills/skill-creator/SKILL.md) — authoritative example

**Project research:**
- `.planning/notes/v1-3-hermes-openclaw-skills-research.md` §3 + §4 — extensive format details from the prior research note
- `/home/arnav/research/blade/voyager-loop-play.md` §4 — Voyager-loop demo target, references skill format

**BLADE substrate (existing files the parser/loader/validator will hook into):**
- `src-tauri/src/lib.rs` — module registration (mod skills, generate_handler!)
- `src-tauri/src/config.rs` — for `BLADE_HOME` resolution (optional; defaults to `~/.blade/`)
- `src-tauri/src/consent.rs` — Phase 18-14 SQLite consent_decisions table; SKILLS-07 extends it
- `src-tauri/src/native_tools.rs` — for the `git-status-summary` exemplar (wraps bash tool)
- `Cargo.toml` — needs serde_yaml (or yaml-rust2) added
- `package.json` `verify:all` chain — 21-07 inserts new gate at chain tail

**Convention references:**
- `CLAUDE.md` `## Critical Architecture Rules` — module registration (every time), 6-place config rule, `use tauri::Manager` import requirement
- `CLAUDE.md` `## Verification Protocol` — static gates ≠ done; runtime UAT applies to chat-functionality regressions
- `CLAUDE.md` `## Frontend (src/)` — typed tauri wrapper + useTauriEvent hook (D-13 lock)

## Risks specific to Phase 21

| Risk | Mitigation |
|---|---|
| YAML frontmatter parser disagrees on edge cases (multi-line strings, anchors, etc.) — agentskills.io spec doesn't pin a YAML version | Pin to YAML 1.2 explicitly in parser doc; reject ambiguous constructs with typed errors |
| Progressive disclosure assertion hard to test cleanly — fs read counters can be flaky | Use a custom `Read` trait wrapper in test mode; production path uses std::fs directly. Pattern verbatim from `gsd-doc-verifier` mock pattern. |
| Consent extension creates schema-migration risk on consent_decisions table | Additive only — new column or new tuple class. v1.2's table already supports composite keys. Migration not needed if SKILLS-07 uses (skill_name, script_path) as a new (intent_class, target_service)-shaped tuple. |
| Exemplar skills (21-05) hit edge cases the parser didn't anticipate | TDD: write 21-05 against in-progress 21-01 to surface edge cases early; iterate. |

## Phase verification

**Static gates (post-phase, pre-Phase-22):**
- `cargo check` exits 0 (new modules: skills/mod.rs, skills/parser.rs, skills/types.rs, skills/loader.rs, skills/resolver.rs)
- `npx tsc --noEmit` exits 0 (no frontend changes expected unless 21-06 surfaces UI need; consent dialog already exists from v1.2)
- `npm run verify:all` exits 0 with new `verify:skill-format` gate at chain tail (count 31 → 32)
- `bash scripts/verify-skill-format.sh` exits 0 standalone

**Runtime checks (manual, light per chat-first pivot — substrate work, not UI):**
- Boot BLADE; chat one turn invoking the `git-status-summary` exemplar; observe response
- Validate progressive-disclosure token budget via debug log assertion (loader logs body-bytes-loaded delta on activation)
- One operator UAT: paste a SKILL.md from `github.com/openclaw/clawhub` (any small one); validator + activation should work

**Phase artifacts:**
- 7 PLAN.md (21-01 through 21-07) + 7 SUMMARY.md
- 21-PHASE-SUMMARY.md (aggregator written in 21-08)
- 21-VERIFICATION.md (all SKILLS REQs closed)
- 3 bundled SKILL.md files at `<repo>/skills/`
- 1 new src module tree at `src-tauri/src/skills/`
- 1 new verify gate `scripts/verify-skill-format.sh`
- Updated `package.json` (verify:all chain)
- Updated `Cargo.toml` (serde_yaml dep)
- Updated `lib.rs` (mod skills + 0 new generate_handler! entries — skills are not Tauri commands; they're registered via the loader)

**Phase ROADMAP closure:**
- All 8 SKILLS-XX checkboxes in REQUIREMENTS.md flip from `[ ]` to `[x]` with closure markers per v1.2 convention (`— *evidence: ...; Plan 21-NN*`)
- ROADMAP.md Phase 21 row gets `✅` status

## Notes for the operator on wake-up

This CONTEXT is enough for `/gsd-plan-phase 21` to expand into formal PLAN.md files (if/when gsd-planner is installed in this project) or for hand-write per the v1.2 PLAN.md template (`16-01-harness-PLAN.md` is a clean example).

If you want to skip the formal plan-writing and execute directly:
- The 8 plans above are well-scoped enough to run as `/gsd-quick` or hand-implementation
- Each plan's scope + REQ-IDs + dependencies are sufficient for an executor
- Wave 1 must be sequential; Wave 2 can run in parallel; Wave 3 gates the close

If you want to discuss-phase first:
- `/gsd-discuss-phase 21` would gather more open questions before formal plan-write
- Default config has `discuss_mode: discuss` so this is the workflow's expected next step

The next concrete artifact this phase needs is **21-RESEARCH.md** (research the YAML parser choice — serde_yaml vs yaml-rust2 vs custom; the agentskills.io strict-spec edge cases; how consent.rs's existing schema accommodates SKILLS-07 without migration). That research is straightforward but worth doing before plan write so artifacts ground in real API surface.

---

*Written 2026-04-30T22:35Z during autonomous milestone bootstrap. Operator asleep; running through `/gsd-new-milestone` workflow + Phase 21 prep before stopping.*
