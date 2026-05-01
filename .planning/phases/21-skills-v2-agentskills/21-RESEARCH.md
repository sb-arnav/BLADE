---
phase: 21
type: research
status: complete
written: 2026-05-01T03:30Z
---

# Phase 21 — Research

Decisive answers to the 3 questions Phase 21 needs settled before code lands.

## Q1 — YAML parser choice

**Decision: add `serde_yaml = "0.9"` to `src-tauri/Cargo.toml`.**

Rationale:
- agentskills.io frontmatter has 1 free-form `metadata: {...}` field that requires a real YAML parser, not regex
- serde_yaml is the standard serde-ecosystem YAML parser; matches the project's existing serde + serde_json + serde-with-derive style
- Maintenance status (deprecated 2024) is not v1.3-blocking — we're parsing local files, not adversarial input; bug-fix urgency is low
- yaml-rust2 is the long-term alternative, but switching now adds a new pattern (manual deserialization vs serde derive) for zero v1.3 win

The frontmatter struct uses serde derive:

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub compatibility: Option<String>,
    #[serde(default)]
    pub metadata: serde_yaml::Value,  // free-form
    #[serde(default, rename = "allowed-tools")]
    pub allowed_tools: Option<String>,
}
```

`serde_yaml::Value` lets metadata stay free-form without forcing a schema.

## Q2 — agentskills.io spec edge cases

Read end-to-end from `notes/v1-3-hermes-openclaw-skills-research.md` §3 + agentskills.io specification.

| Edge case | Decision |
|---|---|
| `name` charset (1-64 chars, lowercase + hyphens, must match folder name) | Validate in parser; reject mismatched name vs folder with typed error |
| `description` length (≤1024 chars, single sentence) | Soft validate (warning ≥800; error >1024) |
| Body length (>5000 tokens recommended) | Validator emits warning; not parser error |
| Multi-line YAML strings (`>` block, `\|` literal) | serde_yaml handles natively |
| Missing trailing `---` | Parser returns typed error with line number |
| Empty body (frontmatter only) | Allowed; SkillBody.markdown is empty string |
| Body referencing `references/X.md` or `scripts/Y.py` | Detected post-parse via simple regex `\[.*\]\(scripts/.*\)|\[.*\]\(references/.*\)`; tracked in SkillBody.references[] for lazy load |

## Q3 — Consent extension shape (SKILLS-07)

**Decision: reuse `consent_decisions` SQLite table with an extended (intent_class, target_service) tuple, no schema migration.**

The v1.2 schema:

```sql
CREATE TABLE IF NOT EXISTS consent_decisions (
    intent_class    TEXT NOT NULL,
    target_service  TEXT NOT NULL,
    decision        TEXT NOT NULL,  -- "allow_always" | "denied"
    decided_at      INTEGER NOT NULL,
    PRIMARY KEY (intent_class, target_service)
);
```

For SKILLS-07:
- `intent_class = "skill_script"`
- `target_service = "<skill_name>:<script_basename>"` (e.g. `"youtube-transcript-fetch:fetch.py"`)

This is purely additive (new tuple class) — no migration, no new column, no new table. The `migration-ledger.md` doesn't need an entry because the schema is unchanged.

The frontend ConsentDialog (existing v1.2 component) handles the prompt; we add a new `action_kind` variant `"skill_script_run"` to the ConsentRequestPayload so the dialog can render appropriate copy (e.g. "Run `<script>` from skill `<name>`?").

## Q4 — Path resolution

**Decision (3-tier resolver, workspace > user > bundled):**

| Tier | Path | When populated |
|---|---|---|
| **Workspace** | `<cwd>/skills/` (only if dir exists at `<cwd>/skills/` AND a `SKILL.md` file is present in any subdir) | Dev / local-clone scenarios; same-name wins over user/bundled |
| **User** | `blade_config_dir()/skills/` (i.e. `~/.config/blade/skills/` on Linux, `~/Library/Application Support/blade/skills/` on macOS) | Voyager-loop output (Phase 22); user-installed skills |
| **Bundled** | Production: `tauri::path::resource_dir() + "/skills/bundled/"`; Dev fallback: `<cargo_workspace>/skills/bundled/` (resolved via `CARGO_MANIFEST_DIR` at compile time → `concat!(env!("CARGO_MANIFEST_DIR"), "/../skills/bundled")`) | Skills shipped with the binary (Phase 21's 3 exemplars land here) |

Resolver short-circuits: walks tiers in order; first hit wins. Catalog at startup loads ALL three tiers' frontmatter (for the metadata-token-budget assertion) but flags each entry with its source tier.

## Q5 — Module placement

**Decision: new `mod skills` (plural) at top level, parallel to existing `skill_engine`, `autoskills`, `tool_forge`.**

Rationale:
- The existing 3 modules each have different concepts of "skill" — replacing any would force consumer migrations across many files
- agentskills.io SKILL.md is a different format than any of the 3 — coexistence is the cheap path
- Phase 22's Voyager loop will write to `mod skills` (the new one); Phase 22 may or may not also rewire `tool_forge`'s JSON-manifest path to write SKILL.md instead — that's a Phase 22 plan-time decision based on how much the Voyager loop subsumes tool_forge

Module tree (Phase 21 ships):

```
src-tauri/src/skills/
├── mod.rs        — pub re-exports + module-level docs
├── types.rs      — SkillFrontmatter, SkillBody, Skill, SourceTier
├── parser.rs     — parse_skill(text) -> Result<(SkillFrontmatter, SkillBody)>
├── loader.rs     — Loader::scan(tier) returns Vec<SkillStub> (frontmatter only)
├── resolver.rs   — Catalog::resolve(name) -> Option<SkillStub> with tier precedence
├── activate.rs   — Activate::load_body(stub) reads body lazily; track byte counter
└── consent.rs    — Skill-script consent helper (calls into crate::consent::request_consent)
```

Public surface from `mod.rs`: `Skill`, `SkillFrontmatter`, `SkillBody`, `SourceTier`, `Catalog`, `parse_skill`, `validate_skill_dir`. CLI subcommand (SKILLS-05) goes through `crate::skills::validate_skill_dir`.

## Q6 — Verify gate shape (SKILLS-08)

**Decision: bash script `scripts/verify-skill-format.sh` matching the project's existing verify-eval.sh pattern.**

Script contents:
1. Find all `SKILL.md` files under `<repo>/skills/` (workspace + bundled)
2. For each: invoke `cargo run --bin skill_validator -- <path>` (a thin binary in `src-tauri/src/bin/skill_validator.rs` wrapping `crate::skills::validate_skill_dir`)
3. Aggregate exit codes; fail on any error
4. Body-token-budget check: if any body exceeds 5000 tokens (heuristic: 4 chars/token), warn; >8000 fails
5. Layout enforcement: `SKILL.md` required; `scripts/`, `references/`, `assets/` optional but no other top-level files

Wire into `package.json` `verify:all` chain at the tail (after `verify:eval`).

## Q7 — What's NOT in Phase 21 (boundary clarification)

- **Voyager loop wire** — that's Phase 22. Phase 21 ships the substrate (parser + loader + resolver + validator + bundled exemplars + consent + verify gate). Phase 22 makes `autoskills.rs` actually write SKILL.md output via `crate::skills::write_skill()`.
- **Migration of `tool_forge.rs` JSON manifests to SKILL.md** — Phase 22 plan-time decision, not Phase 21
- **Migration of `skill_engine.rs` synthesized patterns to SKILL.md** — v1.4 (or never; the prompt-injection use case is genuinely different from executable-code skills)
- **Federation / clawhub ingest** — v1.4
- **MCP-skill bridge** (treat skills as a kind of MCP tool surface) — v1.4

## Risk escalations from CONTEXT.md

- **Progressive-disclosure assertion test** — instead of fs read counters, instrument `Activate::load_body` with an `AtomicU64` byte counter; before/after activation diff is the assertion. Cleaner than fs-level wrapping.
- **Whisper STT feature flag in Phase 26** — not Phase 21 concern; flagging here only because `Cargo.toml` add for serde_yaml shouldn't accidentally regress whisper feature gates. Verify no feature-flag conflict at cargo check.

---

*Phase 21 RESEARCH complete. Phase 21 PATTERNS next, then Wave 1 code.*
