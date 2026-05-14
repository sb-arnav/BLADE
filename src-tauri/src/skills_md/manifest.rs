//! `SkillManifest` — the parsed schema for a phase-57 SKILL.md.
//!
//! ## Schema (YAML frontmatter)
//!
//! ```yaml
//! ---
//! name: summarize-page
//! description: Summarize the page currently focused in the browser into 5 bullets.
//! triggers:
//!   - "summarize this page"
//!   - "tl;dr this"
//!   - "what is this page about"
//! tools:
//!   - browser_get_current_url
//!   - browser_get_page_text
//! model_hint: claude-3-5-sonnet-20241022
//! ---
//!
//! # Body
//!
//! You are operating as the *summarize-page* skill. ...
//! ```
//!
//! Fields:
//! - `name` (required) — 1-64 chars, lowercase + hyphens. Must match the
//!   containing folder name (`{name}/SKILL.md`).
//! - `description` (required) — one-line summary, ≤512 chars.
//! - `triggers` (required, non-empty) — list of literal trigger phrases.
//!   Matched case-insensitively with word-boundary checks (see `dispatch`).
//! - `tools` (optional, default `[]`) — list of tool names the skill is
//!   allowed to call. Empty list = no tool restriction.
//! - `model_hint` (optional) — preferred provider/model identifier. Router
//!   may honor it if available; never a hard requirement.

use serde::{Deserialize, Serialize};

/// Parsed YAML frontmatter for a phase-57 SKILL.md.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillManifest {
    /// Skill identifier. Must match folder name `{name}/SKILL.md`.
    pub name: String,

    /// One-line user-facing description.
    pub description: String,

    /// Trigger phrases (literal substrings; matched case-insensitively).
    pub triggers: Vec<String>,

    /// Tool whitelist. Empty = no restriction.
    #[serde(default)]
    pub tools: Vec<String>,

    /// Preferred model identifier (e.g. `claude-3-5-sonnet-20241022`). Soft hint.
    #[serde(default)]
    pub model_hint: Option<String>,

    /// The markdown body (system prompt). Populated by the parser; not part of
    /// the YAML frontmatter itself.
    #[serde(skip)]
    pub body: String,
}

impl SkillManifest {
    /// Validate the manifest's invariants. Returns an error string suitable
    /// for `log::warn!` + skipping the offending skill.
    pub fn validate(&self) -> Result<(), String> {
        if self.name.is_empty() {
            return Err("manifest.name is empty".into());
        }
        if self.name.len() > 64 {
            return Err(format!("manifest.name '{}' > 64 chars", self.name));
        }
        if !self
            .name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err(format!(
                "manifest.name '{}' must be lowercase alphanumeric + hyphens only",
                self.name
            ));
        }
        if self.description.trim().is_empty() {
            return Err("manifest.description is empty".into());
        }
        if self.description.len() > 512 {
            return Err(format!(
                "manifest.description {} chars > 512 cap",
                self.description.len()
            ));
        }
        if self.triggers.is_empty() {
            return Err("manifest.triggers must be non-empty".into());
        }
        for t in &self.triggers {
            if t.trim().is_empty() {
                return Err("manifest.triggers contains an empty/whitespace entry".into());
            }
        }
        Ok(())
    }

    /// Parse a full SKILL.md (frontmatter + body). Returns the manifest with
    /// `body` populated.
    pub fn parse_skill_md(text: &str) -> Result<Self, String> {
        // Tolerate UTF-8 BOM.
        let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);

        // Locate the first `---\n` (or trailing CR) at the very start of the file.
        let after_open = text
            .strip_prefix("---\n")
            .or_else(|| text.strip_prefix("---\r\n"))
            .ok_or_else(|| {
                "[skills_md::manifest] no opening --- delimiter (file must start with `---`)"
                    .to_string()
            })?;

        // Find the closing `---` on its own line.
        // We accept `\n---\n`, `\n---\r\n`, or `\n---` at EOF as terminators.
        let mut yaml_end: Option<usize> = None;
        let mut body_start: Option<usize> = None;

        let bytes = after_open.as_bytes();
        let mut i = 0usize;
        while i < bytes.len() {
            // Look for newline-anchored `---`.
            if i == 0
                || (bytes[i - 1] == b'\n'
                    && bytes.get(i) == Some(&b'-')
                    && bytes.get(i + 1) == Some(&b'-')
                    && bytes.get(i + 2) == Some(&b'-'))
            {
                // Allow the very first line of frontmatter to also start with `---`?
                // Not legal — we already stripped the opening. So only check the
                // newline-anchored case below.
            }
            if bytes[i] == b'\n'
                && bytes.get(i + 1) == Some(&b'-')
                && bytes.get(i + 2) == Some(&b'-')
                && bytes.get(i + 3) == Some(&b'-')
            {
                // Confirm `---` is followed by `\n`, `\r\n`, or EOF.
                let after_dashes = i + 4;
                let next = bytes.get(after_dashes).copied();
                if next == Some(b'\n') {
                    yaml_end = Some(i);
                    body_start = Some(after_dashes + 1);
                    break;
                } else if next == Some(b'\r') && bytes.get(after_dashes + 1) == Some(&b'\n') {
                    yaml_end = Some(i);
                    body_start = Some(after_dashes + 2);
                    break;
                } else if next.is_none() {
                    yaml_end = Some(i);
                    body_start = Some(after_dashes);
                    break;
                }
            }
            i += 1;
        }

        let yaml_end = yaml_end.ok_or_else(|| {
            "[skills_md::manifest] no closing --- delimiter (frontmatter unterminated)".to_string()
        })?;
        let body_start = body_start.expect("body_start paired with yaml_end");

        let yaml_text = &after_open[..yaml_end];
        let body_text = after_open.get(body_start..).unwrap_or("");

        let mut manifest: SkillManifest = serde_yaml::from_str(yaml_text)
            .map_err(|e| format!("[skills_md::manifest] yaml: {e}"))?;
        manifest.body = body_text.to_string();
        manifest.validate()?;
        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_valid_skill() {
        let text = r#"---
name: summarize-page
description: Summarize current page.
triggers:
  - "summarize this page"
---
# body
You are summarize-page.
"#;
        let m = SkillManifest::parse_skill_md(text).expect("should parse");
        assert_eq!(m.name, "summarize-page");
        assert_eq!(m.triggers, vec!["summarize this page"]);
        assert!(m.tools.is_empty());
        assert!(m.body.starts_with("# body"));
    }

    #[test]
    fn rejects_malformed_yaml() {
        let text = "---\nname: [unterminated\n---\nbody\n";
        let err = SkillManifest::parse_skill_md(text).err().unwrap();
        assert!(err.contains("yaml"), "expected yaml error, got {err}");
    }

    #[test]
    fn rejects_missing_open_delim() {
        let text = "name: x\ndescription: y\ntriggers: []\n";
        let err = SkillManifest::parse_skill_md(text).err().unwrap();
        assert!(err.contains("opening"));
    }

    #[test]
    fn rejects_missing_close_delim() {
        let text = "---\nname: x\ndescription: y\ntriggers:\n  - t\n# no close\n";
        let err = SkillManifest::parse_skill_md(text).err().unwrap();
        assert!(err.contains("closing"));
    }

    #[test]
    fn validate_rejects_empty_triggers() {
        let m = SkillManifest {
            name: "x".into(),
            description: "y".into(),
            triggers: vec![],
            tools: vec![],
            model_hint: None,
            body: String::new(),
        };
        assert!(m.validate().is_err());
    }

    #[test]
    fn validate_rejects_uppercase_name() {
        let m = SkillManifest {
            name: "Foo".into(),
            description: "y".into(),
            triggers: vec!["t".into()],
            tools: vec![],
            model_hint: None,
            body: String::new(),
        };
        assert!(m.validate().is_err());
    }
}
