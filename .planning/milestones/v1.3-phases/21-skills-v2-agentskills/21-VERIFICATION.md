---
phase: 21
type: verification
status: PASS
verified: 2026-05-01
---

# Phase 21 — VERIFICATION

Cross-references each REQ-ID against shipped evidence. Every SKILLS-XX
requirement maps to a specific commit + test set.

## Requirements coverage

| REQ-ID | Requirement | Plan | Evidence |
|---|---|---|---|
| **SKILLS-01** | `SKILL.md` parser reads YAML frontmatter + Markdown body | 21-01 (`b663e93`) | `parse_skill` / `split_frontmatter`; 8 parser tests including BOM tolerance, missing-delim errors, optional-fields round-trip, allowed-tools polymorphic, yaml error propagation |
| **SKILLS-02** | Skill directory layout enforced (SKILL.md required; scripts/ references/ assets/ optional) | 21-01 (parser-side) + 21-04 (validator-side) | `validator::validate_skill_dir` + `validate_layout`; tests `unexpected_top_level_file_errors`, `allowed_top_level_subdirs_ok`, `dotfile_at_top_level_tolerated` |
| **SKILLS-03** | Progressive disclosure: metadata at startup; body on activation; references on traversal | 21-03 (`b579eed`) | `BODY_BYTES_LOADED` + `REFERENCE_BYTES_LOADED` atomics; tests `body_bytes_zero_after_scan_only`, `activate_records_body_bytes`, `references_do_not_auto_load_with_body` |
| **SKILLS-04** | Skill resolution order: workspace → user → bundled; workspace wins on collision | 21-02 (`ebf5aab`) | `Catalog::build` priority loop; tests `workspace_wins_over_user_on_name_collision`, `user_wins_over_bundled_on_name_collision`, `workspace_wins_over_bundled_on_three_way_collision`, `all_preserves_workspace_user_bundled_order` |
| **SKILLS-05** | `blade skill validate <path>` CLI returns structured verdict | 21-04 (`2aaef13`) | `src-tauri/src/bin/skill_validator.rs` shim over `validator::validate_skill_dir`; supports `--json` / `--recursive` / `--help`; exit codes 0/1/2; runtime smoke confirmed (valid skill OK, JSON correct, bad skill flags 3 errors) |
| **SKILLS-06** | 3 bundled exemplar skills at `<repo>/skills/` covering tool-wrapper / references/ / scripts/ shapes | 21-05 (`2ec9996`) | `skills/bundled/git-status-summary/SKILL.md` (tool-wrapper); `skills/bundled/troubleshoot-cargo-build/SKILL.md` + `references/known-errors.md` (references/); `skills/bundled/format-clipboard-as-markdown/SKILL.md` + `scripts/format.py` (scripts/); all 3 pass `skill_validator --recursive`; format.py executes cleanly on stdin (HTML strip + entity unescape + blank-line collapse + fence preservation) |
| **SKILLS-07** | First-run `scripts/*` execution requires explicit user consent (extends v1.2 consent infrastructure) | 21-06 (`c3d51bb`) | `skills::consent` module with `target_service` / `check_persisted` / `set_persisted` over v1.2 `consent_decisions` SQLite table (`intent_class="skill_script"`); 7 unit tests; "allow_once" rejected per T-18-CARRY-15 |
| **SKILLS-08** | `verify:skill-format` gate landed in `verify:all` chain (count 31 → 32) | 21-07 (this commit) | `scripts/verify-skill-format.sh` + `package.json` `verify:skill-format` script + chained at tail of `verify:all`; runs validator across bundled + workspace tiers; exits 0 with all 3 exemplars OK |

**Coverage: 8/8.** Every SKILLS-XX REQ has a commit + a test (or
runtime-smoke equivalent for binaries / scripts).

## Static gates

| Gate | Status |
|---|---|
| `cargo check` (src-tauri) | ✅ exit 0 (only pre-existing `consent_check_at` testability-seam warning carried since Plan 18-14) |
| `cargo check --bins` | ✅ exit 0 (same single warning) |
| `cargo test --lib skills::` | ✅ 65/65 green; full lib total 343/343 |
| `npx tsc --noEmit` | ✅ exit 0 (no frontend changes in Phase 21) |
| `bash scripts/verify-skill-format.sh` standalone | ✅ exit 0; 3 skills validated |
| `npm run verify:skill-format` | ✅ exit 0 (alias for above) |
| `npm run verify:all` chain count | ✅ 31 → 32 (verify:skill-format added at tail) |

## Runtime smoke evidence

| Surface | Test | Result |
|---|---|---|
| `skill_validator` (valid skill) | Synthetic `name: foo / description: A working test skill.` | `OK  /tmp/.../foo (foo)`; exit 0 |
| `skill_validator --json` | Same valid skill | `{"path":"...","name":"foo","valid":true,"body_token_estimate":15,"findings":[]}`; exit 0 |
| `skill_validator` (bad skill) | `name: BadName / description: ""` | 3 distinct errors flagged: uppercase, folder mismatch, empty description; exit 1 |
| `skill_validator --recursive skills/bundled` | All 3 bundled exemplars | All 3 OK; exit 0 |
| `format.py` (clipboard formatter) | `<p>Hello &amp; <b>world</b></p>` + multiple blank lines + trailing whitespace | `Hello & world\n\ntrailing\n`; "stripped 4 HTML tags"; "collapsed extra blank lines"; exit 0 |

## Carry-forward into Phase 22

Phase 22 (Voyager loop closure) will:

1. Wire `evolution.rs` real capability-gap firing to call
   `autoskills.rs::write_skill()` (new function) which uses `crate::skills`
   to construct a SKILL.md write path: `~/.config/blade/skills/<name>/SKILL.md`
   + optional `scripts/<lang>` body.
2. Wire `tool_forge.rs` to register the new SKILL.md skill into the runtime
   tool surface — Phase 22 plan-time decision whether to migrate or coexist.
3. Add a new `verify:voyager-loop` gate (count 32 → 33) that drives the
   canonical `youtube_transcript` fixture deterministically.
4. Plumb production `bundled_root()` through `tauri::path::resource_dir()`
   in `lib.rs::run` startup if the bundled tier is exercised at runtime
   (currently the bundled exemplars are reachable through the dev path
   only; v1.3 production binary may not need them on first cut).

## Sign-off

**Phase 21 status: shipped.** No deferrals. No tech debt logged. Phase
22 unblocked.
