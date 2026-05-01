//! Type model for SKILL.md (Phase 21).
//!
//! Spec: agentskills.io specification (canonical 6-frontmatter-fields form).
//!
//! Fields:
//! - `name` — 1-64 chars, lowercase + hyphens, must match folder name
//! - `description` — single sentence, ≤1024 chars
//! - `license` — optional
//! - `compatibility` — optional, environment requirements
//! - `metadata` — optional, free-form object (kept as `serde_yaml::Value`)
//! - `allowed-tools` — optional, experimental (string or list of strings)

use serde::Deserialize;
use std::path::PathBuf;

/// Where this skill came from. Resolution order is workspace > user > bundled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceTier {
    /// `<cwd>/skills/` — local clone / dev workspace
    Workspace,
    /// `blade_config_dir()/skills/` — user-installed (Voyager output lands here)
    User,
    /// Shipped with the binary
    Bundled,
}

impl SourceTier {
    pub fn priority(&self) -> u8 {
        match self {
            SourceTier::Workspace => 0,
            SourceTier::User => 1,
            SourceTier::Bundled => 2,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            SourceTier::Workspace => "workspace",
            SourceTier::User => "user",
            SourceTier::Bundled => "bundled",
        }
    }
}

/// Parsed YAML frontmatter from a SKILL.md.
#[derive(Debug, Clone, Deserialize)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,

    #[serde(default)]
    pub license: Option<String>,

    #[serde(default)]
    pub compatibility: Option<String>,

    /// Free-form metadata object. Kept as `serde_yaml::Value` so authors can
    /// include arbitrary nested data without forcing a schema.
    #[serde(default)]
    pub metadata: serde_yaml::Value,

    /// Experimental field per agentskills.io. Accept either a single string
    /// (`Bash(git:*)`) or a YAML list of strings.
    #[serde(default, rename = "allowed-tools")]
    pub allowed_tools: Option<AllowedTools>,
}

/// Polymorphic accessor for the `allowed-tools` frontmatter field.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum AllowedTools {
    Single(String),
    Many(Vec<String>),
}

impl AllowedTools {
    pub fn as_slice(&self) -> Vec<&str> {
        match self {
            AllowedTools::Single(s) => vec![s.as_str()],
            AllowedTools::Many(v) => v.iter().map(String::as_str).collect(),
        }
    }
}

/// Markdown body of a SKILL.md, plus discovered references to `scripts/`,
/// `references/`, and `assets/` paths the body cites.
///
/// `references` paths are relative to the skill directory.
#[derive(Debug, Clone)]
pub struct SkillBody {
    pub markdown: String,
    pub references: Vec<String>,
}

/// A skill loaded eagerly with its frontmatter; the body is loaded on demand
/// (progressive disclosure — see `loader.rs::Activate::load_body`).
///
/// `dir` points to the skill's containing directory; `<dir>/SKILL.md` is the
/// body file path. References under `<dir>/scripts/`, `<dir>/references/`,
/// `<dir>/assets/` are loaded only when activation requests them.
#[derive(Debug, Clone)]
pub struct SkillStub {
    pub frontmatter: SkillFrontmatter,
    pub dir: PathBuf,
    pub source: SourceTier,
}

/// A fully-loaded skill (frontmatter + body). Constructed via
/// `loader.rs::Activate::load_body` from a `SkillStub`.
#[derive(Debug, Clone)]
pub struct Skill {
    pub frontmatter: SkillFrontmatter,
    pub body: SkillBody,
    pub dir: PathBuf,
    pub source: SourceTier,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_tier_priority_order_is_workspace_user_bundled() {
        assert!(SourceTier::Workspace.priority() < SourceTier::User.priority());
        assert!(SourceTier::User.priority() < SourceTier::Bundled.priority());
    }

    #[test]
    fn allowed_tools_single_returns_one_element() {
        let single = AllowedTools::Single("Bash(git:*)".to_string());
        assert_eq!(single.as_slice(), vec!["Bash(git:*)"]);
    }

    #[test]
    fn allowed_tools_many_returns_all_elements() {
        let many = AllowedTools::Many(vec!["Read".into(), "Grep".into()]);
        assert_eq!(many.as_slice(), vec!["Read", "Grep"]);
    }
}
