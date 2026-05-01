//! Skills v2 — agentskills.io SKILL.md format adoption (Phase 21, v1.3).
//!
//! See `.planning/phases/21-skills-v2-agentskills/21-RESEARCH.md` for design.
//!
//! ## Why this module
//!
//! Existing BLADE skill-layer modules (`skill_engine.rs`, `autoskills.rs`,
//! `tool_forge.rs`) each store skills in incompatible formats:
//! - `skill_engine` writes synthesized prompt-injection patterns to a SQLite
//!   `brain_skills` table.
//! - `autoskills` doesn't store skills — it installs MCP servers from a catalog.
//! - `tool_forge` writes per-tool JSON manifests + scripts to
//!   `~/.config/blade/tools/<name>.{ext,json}`.
//!
//! None of these match agentskills.io's open standard (YAML frontmatter +
//! Markdown body + canonical `<skill>/SKILL.md` directory structure), which
//! Claude Code, OpenAI Codex, OpenClaw, and clawhub all comply with.
//!
//! Phase 21 adds this module as a parallel substrate. Phase 22's Voyager loop
//! writes its output here. Migration of `tool_forge`'s JSON-manifest format to
//! SKILL.md is a Phase 22 plan-time decision, not a Phase 21 concern.
//!
//! ## Public surface
//!
//! - [`SkillFrontmatter`], [`SkillBody`], [`Skill`], [`SkillStub`], [`SourceTier`]
//!   — the type model for a parsed skill.
//! - [`parse_skill`] — split frontmatter from body and parse both.
//! - [`Catalog`] — workspace → user → bundled resolver (later plans).
//! - [`validate_skill_dir`] — entrypoint for the `skill validate` CLI (later
//!   plans).
//! - [`body_bytes_loaded`] / [`reset_body_bytes_loaded`] — progressive-disclosure
//!   assertion counter (later plans).

#![allow(dead_code, unused_imports)] // Wave 1 lands substrate; Wave 2/3 wires consumers.

pub mod activate;
pub mod consent;
pub mod export;
pub mod loader;
pub mod parser;
pub mod resolver;
pub mod types;
pub mod validator;

pub use activate::{
    activate, body_bytes_loaded, load_reference, reference_bytes_loaded,
    reset_disclosure_counters, resolve_reference_path,
};
pub use loader::{bundled_root, scan_tier, user_root, workspace_root};
pub use parser::parse_skill;
pub use resolver::Catalog;
pub use types::{Skill, SkillBody, SkillFrontmatter, SkillStub, SourceTier};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_exports_compile() {
        // Smoke test: the public surface re-exports cleanly.
        // Verified by `cargo test --lib skills::tests::module_exports_compile`.
        let _ = std::any::type_name::<SkillFrontmatter>();
        let _ = std::any::type_name::<SkillBody>();
        let _ = std::any::type_name::<Skill>();
        let _ = std::any::type_name::<SourceTier>();
    }
}
