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

pub mod loader;
pub mod manifest;

pub use loader::{install_registry, registry, scan_directory, user_skills_dir, SkillsRegistry};
pub use manifest::SkillManifest;
