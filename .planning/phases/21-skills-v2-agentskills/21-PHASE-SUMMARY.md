---
phase: 21
slug: skills-v2-agentskills
milestone: v1.3
status: shipped
shipped: 2026-05-01
plans_total: 7
plans_shipped: 7
unit_tests_added: 65
verify_gates_added: 1
---

# Phase 21 — Self-extending Agent Substrate / Skills v2 — PHASE SUMMARY

agentskills.io SKILL.md format adoption. Substrate prerequisite for Phase 22's
Voyager loop closure. New `mod skills` lives parallel to existing
`skill_engine` / `autoskills` / `tool_forge` per 21-RESEARCH §Q5 — no
migration of those 3 in v1.3; their interaction with Voyager is a Phase 22
plan-time decision.

## Plans landed

| Plan | Slug | Files | Commit | Tests added |
|---|---|---|---|---|
| 21-01 | parser-and-types | `skills/{mod,types,parser}.rs` + `Cargo.toml` (+`serde_yaml`) + `lib.rs` | `b663e93` | 18 |
| 21-02 | loader-and-resolver | `skills/{loader,resolver}.rs` | `ebf5aab` | 16 |
| 21-03 | lazy-load-disclosure | `skills/activate.rs` | `b579eed` | 10 |
| 21-04 | validator-cli | `skills/validator.rs` + `bin/skill_validator.rs` (+`pub mod skills` in `lib.rs`) | `2aaef13` | 14 |
| 21-05 | bundled-exemplars | `skills/bundled/{git-status-summary,troubleshoot-cargo-build,format-clipboard-as-markdown}/` | `2ec9996` | 0 (validated via 21-04) |
| 21-06 | consent-extension | `skills/consent.rs` | `c3d51bb` | 7 |
| 21-07 | verify-skill-format-gate | `scripts/verify-skill-format.sh` + `package.json` chain | (this commit) | 0 |
| 21-08 | phase-summary-and-close | `21-PHASE-SUMMARY.md` + `21-VERIFICATION.md` + `REQUIREMENTS.md`/`ROADMAP.md` traceability | (this commit) | 0 |

**Total:** 65 unit tests across 7 production source files + 1 binary;
3 bundled exemplar SKILL.md (one tool-wrapper, one with `references/`, one
with executable `scripts/`); 1 new verify gate (`verify:skill-format`).

## Module shape

```
src-tauri/src/skills/
├── mod.rs        pub re-exports + module-level docs
├── types.rs      SkillFrontmatter / SkillBody / Skill / SkillStub /
│                 SourceTier (Workspace=0 > User=1 > Bundled=2) +
│                 AllowedTools poly accessor
├── parser.rs     parse_skill / split_frontmatter / find_references;
│                 BOM-tolerant; typed errors prefixed [skills::parser]
├── loader.rs     scan_tier(root, source) + path-resolution helpers
│                 (workspace_root / user_root / bundled_root); skips
│                 dotfiles, parses-to-skip on malformed, rejects
│                 folder-name vs frontmatter-name mismatch
├── resolver.rs   Catalog::build / build_default / resolve / all /
│                 resolved_count; workspace > user > bundled precedence
│                 on name collision; lower-priority entries kept in all()
│                 for diagnostics
├── activate.rs   activate(stub) / load_reference / resolve_reference_path;
│                 BODY_BYTES_LOADED + REFERENCE_BYTES_LOADED atomics for
│                 the progressive-disclosure assertion; refuses
│                 non-canonical reference prefixes + parent-dir escapes
├── validator.rs  validate_skill_dir(path) → ValidationReport with
│                 structured Finding[] (severity + field + message);
│                 enforces 6 rules per agentskills.io + project conventions
└── consent.rs    target_service / check_persisted / set_persisted; reuses
                  v1.2 consent_decisions schema with intent_class=skill_script
```

```
src-tauri/src/bin/
└── skill_validator.rs   Thin CLI shim — flags --json / --recursive /
                         --help; exit 0 valid (warnings allowed) / 1 errors
                         found / 2 CLI usage error
```

```
skills/bundled/
├── git-status-summary/SKILL.md                          tool-wrapper exemplar
├── troubleshoot-cargo-build/SKILL.md                    references/ exemplar
│   └── references/known-errors.md
└── format-clipboard-as-markdown/SKILL.md                scripts/ exemplar
    └── scripts/format.py (+x; reads stdin, emits clean Markdown)
```

```
scripts/
└── verify-skill-format.sh    Wraps cargo run --bin skill_validator
                              --recursive across bundled + workspace tiers;
                              wired into package.json verify:all chain at
                              tail (after verify:eval)
```

## Decisions made / closed

| ID | Decision | Source |
|---|---|---|
| Q1 | YAML parser = `serde_yaml = "0.9"` (vs yaml-rust2 / hand-rolled) | 21-RESEARCH |
| Q2 | agentskills.io edge cases: name format, body token caps, multiline YAML, BOM tolerance, missing-delim errors, empty body allowed, references via `(scripts/...)` etc | 21-RESEARCH |
| Q3 | Consent extension reuses `consent_decisions` schema with `intent_class="skill_script"` + `target_service="<skill>:<basename>"` — no migration | 21-RESEARCH |
| Q4 | 3-tier path resolution: `<cwd>/skills/` (workspace) > `blade_config_dir()/skills/` (user) > `<cargo_workspace>/skills/bundled/` (bundled, dev fallback; production uses `tauri::path::resource_dir()` plumbed via AppHandle in Phase 22+) | 21-RESEARCH |
| Q5 | Module placement: new `mod skills` (plural) at top level, parallel to existing `skill_engine` / `autoskills` / `tool_forge`. No migration of those 3 in v1.3 | 21-RESEARCH |
| Q6 | Verify gate = bash `verify-skill-format.sh` matching `verify-eval.sh` pattern; wired into `verify:all` tail | 21-RESEARCH |
| Q7 | Phase 21 boundaries: NOT Voyager wire (Phase 22), NOT migration of tool_forge JSON manifests (Phase 22 plan-time), NOT skill_engine pattern migration (v1.4), NOT federation (v1.4), NOT MCP-skill bridge (v1.4) | 21-RESEARCH |

## Hardening included in this phase

- **Path traversal:** `load_reference` / `resolve_reference_path` reject
  non-canonical prefixes + paths with `..` components; defense in depth on
  top of the agentskills.io spec's canonical subdirs invariant
- **Folder-name vs frontmatter-name mismatch:** loader skips with logged
  warn (silent skip would hide bugs); validator surfaces typed error
- **Allow-once smuggle:** `consent::set_persisted` rejects "allow_once" in
  defense of T-18-CARRY-15 (v1.2 invariant: only "allow_always"/"denied"
  persist; "allow_once" is in-memory only)
- **Body token budget:** validator emits warning ≥4000 / ≥5000 (recommended)
  and hard error >8000 to keep the metadata-token-budget assertion meaningful
- **Layout enforcement:** validator rejects unexpected top-level files
  (only `SKILL.md`, `scripts/`, `references/`, `assets/` allowed; dotfiles
  tolerated)
- **Missing references:** validator errors when a body link points at
  a non-existent file under the skill dir
- **Disclosure counters race:** `BODY_BYTES_LOADED` / `REFERENCE_BYTES_LOADED`
  atomics guarded by `COUNTER_LOCK` Mutex in tests so global state isn't
  a flake surface

## What this phase did NOT do (forward-pointers)

- **Phase 22:** Voyager loop wire — `evolution.rs` capability-gap fire →
  `autoskills.rs` writes a SKILL.md (with `scripts/`) → `tool_forge.rs`
  registers → next call retrieves and runs. Phase 21's `mod skills` is the
  substrate it writes into.
- **Phase 22 plan-time:** decide whether Voyager loop subsumes
  `tool_forge.rs`'s existing JSON-manifest format (migrate) or runs
  alongside it (parallel). Phase 21 explicitly leaves both options open.
- **v1.4:** organism layer (vitality / hormones / mortality salience) with
  the safety bundle; metacognitive controller v0; active-inference loop
  closure; persona shaping; immune cross-cutting layer; federation
  Pattern A + selection mechanisms.
- **Phase 22+ runtime production AppHandle plumbing:** `bundled_root`
  currently uses `concat!(env!("CARGO_MANIFEST_DIR"), "/../skills/bundled")`
  for cargo-workspace tests + dev. Production binary should use
  `tauri::path::resource_dir()`; that requires `&AppHandle` not available
  at module-level helpers. Resolve in `lib.rs::run` setup when the loader
  is invoked at startup.

## Static gate impact

Before Phase 21:
- `npm run verify:all` chain: 31 gates green
- `cargo test --lib` total: 278 tests across the workspace

After Phase 21:
- `npm run verify:all` chain: 32 gates green (added `verify:skill-format`)
- `cargo test --lib skills::` adds 65 tests (full lib total: 343)

## Inputs consumed (research grounding)

- `/home/arnav/research/blade/voyager-loop-play.md` — substrate-level
  differentiator framing; Voyager loop demo target
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md`
  Layer 4 (memory + skills) deepening
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` design
  implications: Arg 6 incremental layers (no organism in v1.3); Arg 9
  selection mechanisms for federation (deferred to v1.4)
- `.planning/notes/v1-3-hermes-openclaw-skills-research.md` §3 + §4 —
  agentskills.io spec details; superseded as v1.3 lead but format guidance
  carries forward
- `agentskills.io/specification` — canonical SKILL.md schema
- `github.com/openclaw/openclaw/blob/main/skills/skill-creator/SKILL.md`
  — authoritative example

## Phase verdict

**Status: shipped.** All 8 SKILLS-XX requirements satisfied at the
substrate level. Static gates green. 65 unit tests added; runtime
end-to-end smoke confirmed (validator OK on 3 exemplars, format.py
runs, verify-skill-format gate green). Phase 22 (Voyager loop closure)
unblocked.
