# Phase 41 — Persona Auto-Extraction Removal

**Milestone:** v1.6 — Narrowing Pass
**Status:** Pending
**Requirements:** REDUCE-01
**Goal:** Rip silent personality inference from filenames + shell history in `persona_engine.rs` (~1,317 LOC) and `personality_mirror.rs` (~821 LOC). Voice comes from user-stated core command (filled by v2.0 hunt) + actual chat history only. Significant LOC reduction, NOT module deletion — both modules stay as ingestion targets for v2.0 hunt output (`~/.blade/who-you-are.md`).

## Background (from V2-AUTONOMOUS-HANDOFF.md §0)

> *"Persona Engine / Personality Mirror auto-extraction → core-command-driven only. Rip the silent personality inference from filenames + shell history. Voice comes from user-stated core command + actual chat history."*

Per `.planning/decisions.md` 2026-05-13 v2.0 onboarding mechanism: the hunt synthesizes a `~/.blade/who-you-are.md` file. Persona/PersonalityMirror modules read FROM that file going forward, not FROM filenames + shell_history.

## Approach

### Identify silent-inference code paths

In `persona_engine.rs` and `personality_mirror.rs`, find functions that:
- Read filenames from the user's filesystem (Documents, Downloads, code projects, etc.) to infer interests/personality
- Read shell history (~/.bash_history, ~/.zsh_history) to infer communication style or work patterns
- Scan IDE workspaces / project structures to infer "what they care about"

Likely function names to look for: `extract_from_filenames`, `extract_from_shell_history`, `infer_personality_from_*`, `scan_workspace_for_traits`, etc.

### Keep

- **Chat-history-based extraction** — analyzing the user's actual conversational style with BLADE is the legitimate signal. Per VISION + decisions.md, this stays.
- **Module structure** — both files retain their public API for v2.0 hunt-output ingestion. Don't delete struct definitions or trait impls that consumers depend on.
- **Reader/loader for `~/.blade/who-you-are.md`** — if it exists already (v1.5 may have stubbed it), preserve. If not, do NOT add it in this phase — that's v2.0 work.

### Remove

- `extract_from_filenames` and equivalents
- `extract_from_shell_history` and equivalents
- Any `start_persona_scan_loop` background scanners
- Calls to the above in `lib.rs` startup and `commands.rs` chat pipeline

### Target reduction

VISION cut wording says "significant LOC reduction, not deletion." Aim for ~1,000 net LOC removed across the two files combined. If removal exceeds half of each module, audit whether the module should consolidate down rather than leaving a tiny shell.

## Risks

1. **Brain.rs system-prompt assembly may inject persona traits from these modules at every turn.** Need to grep `brain.rs` for persona usage; if the silent-inference output was being injected, the chat may shift in tone without it — but that's the intended behavior (v2.0 hunt fills it back in).
2. **The chat-history extractor may be tangled with filename-extractor in shared private functions.** Refactor to keep chat path; delete the rest.
3. **Tests covering silent inference will break.** Delete them — they're testing the cut behavior, not a regression target.

## Success criteria

- [ ] No filesystem walks for personality inference remain in `persona_engine.rs` or `personality_mirror.rs`
- [ ] No shell-history reads for personality inference remain
- [ ] Chat-history-based extraction path preserved and still callable from brain.rs
- [ ] Modules still compile + export public API for future v2.0 hunt-output ingestion
- [ ] Net LOC reduction ≥1,000 across the two files
- [ ] `verify:all` ≥36/38
- [ ] cargo check clean; tsc --noEmit clean
- [ ] Chat smoke test passes
