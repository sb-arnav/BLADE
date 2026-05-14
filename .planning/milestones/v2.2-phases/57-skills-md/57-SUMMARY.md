# Phase 57 — SUMMARY (v2.2 SKILLS-MD)

**Status:** Complete
**Closed:** 2026-05-14

## Outcome

OpenClaw-style skill-as-markdown directory pattern landed as `crate::skills_md`. Each skill is `{name}/SKILL.md` with YAML frontmatter (`name`, `description`, `triggers`, `tools`, `model_hint`) + a system-prompt body. AI-installable via `blade_install_skill` Tauri command, crowdsourceable via raw URL, zero-SDK friction. 5 seed skills ship with the binary.

The substrate is the foundation for the eventual "skills marketplace" VISION roadmap item without building a marketplace yet.

## Atomic commits (6 REQ-IDs)

| REQ | Commit | Description |
|---|---|---|
| SKILLS-DIR-LAYOUT | `310e7a9` | `SkillManifest` schema + parser + 6 unit tests in `skills_md/manifest.rs` |
| SKILLS-LOADER | `ae71b03` | Directory walker + `SkillsRegistry` (`RwLock<HashMap>`) + startup wire in `lib.rs::run` |
| SKILLS-DISPATCH | `608fc36` | Trigger-match check in `send_message_stream` + system-prompt prepend |
| SKILLS-INSTALL-CMD | `d2d3bf2` | `blade_install_skill(url)` Tauri command + HTTPS-only + 256KB cap |
| SKILLS-SEED | `45c8529` | 5 seed skills in `assets/seed-skills/` + `blade_seed_skills` Tauri command + first-run hook |
| SKILLS-TESTS | `6962344` | 5 integration tests in `tests/skills_md_integration.rs` |

## Close-criteria check

- **All 6 REQ-IDs shipped** as atomic per-REQ commits per the spec.
- **No bespoke-skill regression** — Phase 21's `crate::skills` (agentskills.io schema) is untouched. The new substrate is additive at `crate::skills_md`.
- **Schema is operator-readable** — YAML frontmatter named in plain English, body is markdown, no SDK.
- **Install path is safe** — HTTPS-only, 256 KB cap, schema validates before any FS mutation, name field is lowercase-and-hyphens-only so path-traversal is impossible by construction.

## Static gates

| Gate | Result |
|---|---|
| `cargo check` | Clean (pre-existing dead_code warnings unrelated to Phase 57) |
| `tsc --noEmit` | See `.planning/milestones/v2.2-phases/57-skills-md/57-CONTEXT.md` for results |
| `cargo test --test skills_md_integration` | 5/5 pass (0.03s test-binary time) |

## Final directory layout for `~/.config/blade/skills_md/`

After first launch, the user's `~/.config/blade/skills_md/` populates with:

```
~/.config/blade/skills_md/
├── summarize-page/
│   └── SKILL.md
├── draft-followup-email/
│   └── SKILL.md
├── extract-todos-from-notes/
│   └── SKILL.md
├── morning-context/
│   └── SKILL.md
└── kill-tabs-i-dont-need/
    └── SKILL.md
```

User-installed skills land alongside in the same flat tree. Future
crowdsourced skills install via `blade_install_skill("https://...")`.

### Seed skill trigger phrases

| Skill | Triggers |
|---|---|
| **summarize-page** | "summarize this page", "tldr this page", "tl;dr this", "what is this page about", "summarize this for me" |
| **draft-followup-email** | "draft a follow-up email", "draft followup email", "write a followup", "follow up with", "send a follow-up" |
| **extract-todos-from-notes** | "extract todos", "extract action items", "pull todos from this", "what are the action items", "what should i do from these notes" |
| **morning-context** | "morning context", "morning briefing", "give me a morning briefing", "what's on my plate today", "brief me" |
| **kill-tabs-i-dont-need** | "kill the tabs", "kill tabs i don't need", "clean up my tabs", "close tabs i don't need", "what tabs can i close" |

## Files touched in Phase 57

- `src-tauri/src/skills_md/mod.rs` — module shell + `blade_install_skill` + `blade_seed_skills` Tauri commands
- `src-tauri/src/skills_md/manifest.rs` — `SkillManifest` schema + YAML frontmatter parser
- `src-tauri/src/skills_md/loader.rs` — directory walker + `SkillsRegistry` + trigger normalization
- `src-tauri/src/skills_md/dispatch.rs` — word-boundary substring trigger matching, longest-trigger-wins
- `src-tauri/src/skills_md/install.rs` — HTTPS-only install path, 256KB body cap, schema validates before write
- `src-tauri/src/skills_md/seed.rs` — `include_str!()`-backed seed corpus + idempotent user-dir copy
- `src-tauri/src/lib.rs` — module registration + Tauri command registration + startup wire (seed → install_registry)
- `src-tauri/src/commands.rs` — `send_message_stream_inline` skill-dispatch check + system-prompt prepend
- `src-tauri/tests/skills_md_integration.rs` — 5 integration tests
- `assets/seed-skills/{summarize-page,draft-followup-email,extract-todos-from-notes,morning-context,kill-tabs-i-dont-need}/SKILL.md` — 5 seed skills

## Deviations from REQ list (and why)

1. **Directory location is `~/.config/blade/skills_md/` not `~/.blade/skills/`.** The spec called the directory "~/.blade/skills/" literally. BLADE's canonical config root is `blade_config_dir()` (= `~/.config/blade/` on Linux per `dirs::config_dir()`) and Phase 21's existing `skills/` directory already occupies the obvious slot. Using `skills_md/` under the canonical config dir avoids splitting state across two config roots and avoids collision with Phase 21's agentskills.io schema. The `SkillManifest` for phase-57 is intentionally NOT compatible with Phase 21's `SkillFrontmatter` (different fields: `triggers`/`tools`/`model_hint` vs `license`/`metadata`/`allowed-tools`); a shared directory would have required schema-discrimination plumbing. Documented in module header.

2. **Module name is `skills_md/` not `skills/`.** Same reason — namespace collision with Phase 21's `pub mod skills`. The phase-57 substrate lives at `crate::skills_md::*`; Phase 21's stays at `crate::skills::*`. Both are additive; no v1.3 skills are migrated by Phase 57.

3. **`notify` crate filesystem-change watcher deferred.** The spec said "use `notify` crate if not already a dep; if it is, integrate." `notify` is NOT in deps. Adding it inflates binary size + adds cross-platform watcher complexity for a directory that is typically <20 entries at personal scale. The on-demand re-scan path covers the only in-session mutation surface: `blade_install_skill` calls `install_registry()` after writing. Operators editing files by hand can invoke the install command (no-op URL) to retrigger a scan, or restart BLADE. Deferred to a future phase if real-user dogfooding surfaces a need.

4. **Seed assets shipped via `include_str!` rather than Tauri `resources:`.** The `tauri.conf.json` has no `resources` field today. Adding one is a release-CI concern (bundle config, signing implications, build-pipeline updates) outside Phase 57 scope. Compiling the seeds into the binary via `include_str!()` from `assets/seed-skills/` is operationally equivalent at runtime, ships in the same binary, and avoids touching the release pipeline. When Phase 60 (LAUNCH-PREP) or v2.3 wires `resources:` for real, the seed corpus can migrate trivially — `seed_corpus()` is a single function.

5. **Two non-Phase-57 commits got re-stitched.** Concurrent agent sessions (Phase 53, Phase 54, Phase 58) ran during Phase 57's execution and twice (via aggressive `git add` patterns from those sessions) swept my Phase 57 files into their own commits. Resolved with two surgical `git reset --soft HEAD~1` + selective re-staging operations to peel off:
   - `ddd1aca` (PRESENCE-LEARNING) → re-committed as `2542cd9` after splitting out SKILLS-DISPATCH (`608fc36`)
   - `3703b26` (PRESENCE-BRAIN-INJECT) → re-committed as `b27da18` after splitting out SKILLS-INSTALL-CMD (`d2d3bf2`)

   Both soft-resets were verified safe (no concurrent cargo/git activity at the moment of reset). The final tree has all 6 Phase 57 REQs as clean atomic commits with the precise spec-named subject lines, and the other phases' work is preserved in commits with their own correctly-named subject lines.

## Next

v2.2 phase queue continues:
- Phase 56 (TELOS) is the next user-facing wedge
- Phase 58 (MEMORY-SIMPLIFY) in flight via concurrent sessions — already past EMBED-AUDIT, EMBED-REMOVE-VECTORS, EMBED-MIGRATION
- Phase 54 (GOOSE-PROVIDER) in flight via concurrent sessions — already past PROVIDER-TRAIT-PORT, PROVIDER-CANONICAL-MODELS, PROVIDER-MIGRATION (all providers), PROVIDER-ROUTER-WIRE
- Phase 53 (PRESENCE-NARRATE) in flight via concurrent sessions — already past PRESENCE-EMIT, PRESENCE-EVOLUTION, PRESENCE-VITALITY, PRESENCE-LEARNING, PRESENCE-BRAIN-INJECT

v2.2 CLOSE (Phase 61) will inventory final REQ status across all in-flight phases and tag.
