//! Phase 57 (v2.2) — Skills as Markdown Directory (SKILLS-MD).
//!
//! OpenClaw-style skill-as-markdown pattern: each skill is a plain `SKILL.md`
//! file with YAML frontmatter (`name`, `description`, `triggers`, `tools`,
//! `model_hint`) plus a system-prompt body. AI-installable, crowdsourceable,
//! zero-SDK. Foundation for the eventual marketplace.
//!
//! ## Location
//!
//! Skills live at `blade_config_dir()/skills_md/{name}/SKILL.md`. The
//! `skills_md/` directory is intentionally distinct from the v1.3
//! `skills/` directory (Phase 21, `crate::skills`) because the two
//! schemas are NOT compatible at the YAML level:
//!   - v1.3 `skills/` uses agentskills.io: `license`, `metadata`,
//!     `allowed-tools`, with progressive disclosure of references/.
//!   - v2.2 `skills_md/` uses OpenClaw: `triggers`, `tools`, `model_hint`,
//!     no references, body is a single system prompt.
//!
//! Treat the two namespaces as additive. Phase 57 does NOT migrate v1.3
//! skills.
//!
//! ## Public surface
//!
//! REQ 1 (SKILLS-DIR-LAYOUT) lands the [`SkillManifest`] schema. Subsequent
//! REQs (loader, dispatch, install, seed) layer on top.

#![allow(dead_code)] // Wave 1 lands substrate; tests + dispatch use it conditionally.

pub mod dispatch;
pub mod install;
pub mod loader;
pub mod manifest;
pub mod seed;

pub use dispatch::match_trigger;
pub use install::{install_from_text, install_from_url};
pub use loader::{install_registry, registry, scan_directory, user_skills_dir, SkillsRegistry};
pub use manifest::SkillManifest;
pub use seed::{seed_corpus, seed_skills_into_user_dir};

/// Phase 57 (SKILLS-INSTALL-CMD) — Tauri command. Downloads a SKILL.md from
/// an HTTPS URL, validates the schema, writes to `~/.config/blade/skills_md/`,
/// and refreshes the in-memory registry. Returns the installed skill's name.
#[tauri::command]
pub async fn blade_install_skill(url: String) -> Result<String, String> {
    install_from_url(&url).await
}

/// Phase 57 (SKILLS-SEED) — Tauri command. Copies the bundled seed skills
/// into the user's `skills_md/` directory. Idempotent: never overwrites a
/// user-customized skill. Returns the count of skills newly written.
#[tauri::command]
pub fn blade_seed_skills() -> Result<usize, String> {
    Ok(seed::seed_skills_into_user_dir())
}
