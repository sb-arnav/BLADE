//! Skill validator — pure function that returns a structured verdict on a
//! skill directory. The CLI shim at `src/bin/skill_validator.rs` formats and
//! exits; this module is testable in isolation.
//!
//! Validation rules (per agentskills.io specification + project conventions):
//!
//! 1. `<dir>/SKILL.md` must exist and parse cleanly.
//! 2. Frontmatter `name` (1-64 chars, lowercase + hyphens, must equal folder name).
//! 3. Frontmatter `description` ≤1024 chars; warning if ≥800.
//! 4. Body ≤5000 tokens recommended (heuristic: 4 chars/token); warning ≥4000;
//!    error >8000 to keep the metadata-token-budget assertion meaningful.
//! 5. Layout: only `SKILL.md`, `scripts/`, `references/`, `assets/` allowed at
//!    the skill dir top level. Other files trigger an error.
//! 6. Body references must resolve to existing files under the skill dir.

use std::fs;
use std::path::{Path, PathBuf};

use super::parser::parse_skill;

/// Severity of a validation finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

impl Severity {
    pub fn label(&self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }
    }
}

/// A single finding from validation.
#[derive(Debug, Clone)]
pub struct Finding {
    pub severity: Severity,
    pub field: String,
    pub message: String,
}

/// Result of validating a skill directory.
#[derive(Debug, Default)]
pub struct ValidationReport {
    pub findings: Vec<Finding>,
    pub skill_name: Option<String>,
    pub body_token_estimate: Option<u64>,
}

impl ValidationReport {
    pub fn is_valid(&self) -> bool {
        !self.findings.iter().any(|f| f.severity == Severity::Error)
    }

    pub fn errors(&self) -> impl Iterator<Item = &Finding> {
        self.findings.iter().filter(|f| f.severity == Severity::Error)
    }

    pub fn warnings(&self) -> impl Iterator<Item = &Finding> {
        self.findings.iter().filter(|f| f.severity == Severity::Warning)
    }
}

/// Hard limits / thresholds.
const NAME_MAX_CHARS: usize = 64;
const DESCRIPTION_MAX_CHARS: usize = 1024;
const DESCRIPTION_WARN_CHARS: usize = 800;
const BODY_WARN_TOKENS: u64 = 4_000;
const BODY_WARN_RECOMMENDED_TOKENS: u64 = 5_000;
const BODY_ERROR_TOKENS: u64 = 8_000;
const CHARS_PER_TOKEN: u64 = 4;

const ALLOWED_TOP_LEVEL: [&str; 4] = ["SKILL.md", "scripts", "references", "assets"];

/// Validate a single skill directory. The path should point to the directory
/// containing `SKILL.md` (e.g. `<repo>/skills/git-status-summary/`).
pub fn validate_skill_dir(dir: &Path) -> ValidationReport {
    let mut report = ValidationReport::default();

    if !dir.is_dir() {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "<dir>".into(),
            message: format!("not a directory: {}", dir.display()),
        });
        return report;
    }

    let skill_md = dir.join("SKILL.md");
    let text = match fs::read_to_string(&skill_md) {
        Ok(t) => t,
        Err(e) => {
            report.findings.push(Finding {
                severity: Severity::Error,
                field: "SKILL.md".into(),
                message: format!("read {}: {e}", skill_md.display()),
            });
            return report;
        }
    };

    // Token estimate uses byte length, not unicode chars — agentskills.io spec
    // is intentionally loose here, and the heuristic is "is this a wall of text
    // or a focused skill", not a precise count.
    report.body_token_estimate = Some(text.len() as u64 / CHARS_PER_TOKEN);

    let parsed = match parse_skill(&text) {
        Ok(p) => p,
        Err(e) => {
            report.findings.push(Finding {
                severity: Severity::Error,
                field: "SKILL.md".into(),
                message: e,
            });
            return report;
        }
    };
    let (frontmatter, body) = parsed;
    report.skill_name = Some(frontmatter.name.clone());

    // Rule: name format
    validate_name(&frontmatter.name, dir, &mut report);

    // Rule: description length
    validate_description(&frontmatter.description, &mut report);

    // Rule: body size
    let token_estimate = report.body_token_estimate.unwrap_or(0);
    validate_body_size(token_estimate, &mut report);

    // Rule: layout enforcement
    validate_layout(dir, &mut report);

    // Rule: references resolve
    for ref_path in &body.references {
        let abs = dir.join(ref_path);
        if !abs.exists() {
            report.findings.push(Finding {
                severity: Severity::Error,
                field: format!("body.references.{ref_path}"),
                message: format!("missing referenced file: {}", abs.display()),
            });
        }
    }

    report
}

fn validate_name(name: &str, dir: &Path, report: &mut ValidationReport) {
    if name.is_empty() {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "frontmatter.name".into(),
            message: "name is empty".into(),
        });
        return;
    }
    if name.len() > NAME_MAX_CHARS {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "frontmatter.name".into(),
            message: format!("name length {} exceeds {NAME_MAX_CHARS}", name.len()),
        });
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "frontmatter.name".into(),
            message: format!(
                "name {:?} must be lowercase ASCII letters, digits, and hyphens only",
                name
            ),
        });
    }
    if name.starts_with('-') || name.ends_with('-') {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "frontmatter.name".into(),
            message: format!("name {:?} must not start or end with `-`", name),
        });
    }

    if let Some(folder) = dir.file_name().and_then(|n| n.to_str()) {
        if folder != name {
            report.findings.push(Finding {
                severity: Severity::Error,
                field: "frontmatter.name".into(),
                message: format!("name {:?} does not match folder name {:?}", name, folder),
            });
        }
    }
}

fn validate_description(description: &str, report: &mut ValidationReport) {
    if description.trim().is_empty() {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "frontmatter.description".into(),
            message: "description is empty".into(),
        });
        return;
    }
    let len = description.chars().count();
    if len > DESCRIPTION_MAX_CHARS {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "frontmatter.description".into(),
            message: format!("description length {len} exceeds {DESCRIPTION_MAX_CHARS}"),
        });
    } else if len >= DESCRIPTION_WARN_CHARS {
        report.findings.push(Finding {
            severity: Severity::Warning,
            field: "frontmatter.description".into(),
            message: format!(
                "description length {len} approaches limit ({DESCRIPTION_MAX_CHARS}); consider shortening"
            ),
        });
    }
}

fn validate_body_size(token_estimate: u64, report: &mut ValidationReport) {
    if token_estimate > BODY_ERROR_TOKENS {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "body".into(),
            message: format!(
                "body token estimate {token_estimate} exceeds hard cap {BODY_ERROR_TOKENS} (split into references/)"
            ),
        });
    } else if token_estimate > BODY_WARN_RECOMMENDED_TOKENS {
        report.findings.push(Finding {
            severity: Severity::Warning,
            field: "body".into(),
            message: format!(
                "body token estimate {token_estimate} exceeds recommended {BODY_WARN_RECOMMENDED_TOKENS}"
            ),
        });
    } else if token_estimate > BODY_WARN_TOKENS {
        report.findings.push(Finding {
            severity: Severity::Warning,
            field: "body".into(),
            message: format!(
                "body token estimate {token_estimate} approaches recommended cap ({BODY_WARN_RECOMMENDED_TOKENS})"
            ),
        });
    }
}

fn validate_layout(dir: &Path, report: &mut ValidationReport) {
    let entries = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            report.findings.push(Finding {
                severity: Severity::Error,
                field: "<dir>".into(),
                message: format!("read_dir {}: {e}", dir.display()),
            });
            return;
        }
    };

    let mut unexpected: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        // Tolerate dotfile leftovers (e.g. .DS_Store, .git) — they're not part
        // of the skill but they aren't disallowed either.
        if name.starts_with('.') {
            continue;
        }
        if !ALLOWED_TOP_LEVEL.contains(&name) {
            unexpected.push(path);
        }
    }

    for path in unexpected {
        report.findings.push(Finding {
            severity: Severity::Error,
            field: "layout".into(),
            message: format!(
                "unexpected entry in skill dir: {} (allowed: SKILL.md, scripts/, references/, assets/)",
                path.display()
            ),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-validator-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_skill_dir(parent: &Path, name: &str, frontmatter: &str, body: &str) -> PathBuf {
        let dir = parent.join(name);
        fs::create_dir_all(&dir).unwrap();
        let text = format!("---\n{frontmatter}\n---\n{body}");
        fs::write(dir.join("SKILL.md"), text).unwrap();
        dir
    }

    #[test]
    fn valid_skill_passes() {
        let parent = temp_dir("valid");
        let dir = write_skill_dir(
            &parent,
            "valid-skill",
            "name: valid-skill\ndescription: A clean skill.",
            "# Body\nLorem ipsum.\n",
        );
        let report = validate_skill_dir(&dir);
        assert!(report.is_valid(), "findings: {:?}", report.findings);
        assert_eq!(report.skill_name.as_deref(), Some("valid-skill"));
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn missing_skill_md_errors() {
        let parent = temp_dir("missing");
        let dir = parent.join("emptydir");
        fs::create_dir_all(&dir).unwrap();
        let report = validate_skill_dir(&dir);
        assert!(!report.is_valid());
        assert!(report.findings[0].message.contains("read"));
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn folder_name_mismatch_errors() {
        let parent = temp_dir("mismatch");
        let dir = write_skill_dir(
            &parent,
            "alias",
            "name: real-name\ndescription: Mismatch.",
            "body",
        );
        let report = validate_skill_dir(&dir);
        assert!(!report.is_valid());
        let err = report.errors().next().unwrap();
        assert!(err.message.contains("does not match folder name"));
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn name_with_uppercase_errors() {
        let parent = temp_dir("uppercase");
        let dir = write_skill_dir(
            &parent,
            "BadName",
            "name: BadName\ndescription: Bad case.",
            "body",
        );
        let report = validate_skill_dir(&dir);
        let has = report
            .errors()
            .any(|f| f.message.contains("lowercase"));
        assert!(has);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn name_starting_with_hyphen_errors() {
        let parent = temp_dir("leadinghyphen");
        let dir = write_skill_dir(
            &parent,
            "-bad",
            "name: -bad\ndescription: Bad.",
            "body",
        );
        let report = validate_skill_dir(&dir);
        let has = report
            .errors()
            .any(|f| f.message.contains("must not start or end"));
        assert!(has);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn empty_description_errors() {
        let parent = temp_dir("emptydesc");
        // YAML empty string for description — set it to "" explicitly
        let dir = write_skill_dir(
            &parent,
            "x",
            "name: x\ndescription: \"\"",
            "body",
        );
        let report = validate_skill_dir(&dir);
        let has = report
            .errors()
            .any(|f| f.message.contains("description is empty"));
        assert!(has);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn long_description_warns() {
        let parent = temp_dir("longdesc");
        let mut desc = String::new();
        for _ in 0..820 {
            desc.push('a');
        }
        let dir = write_skill_dir(
            &parent,
            "longdesc",
            &format!("name: longdesc\ndescription: {desc}"),
            "body",
        );
        let report = validate_skill_dir(&dir);
        assert!(report.is_valid()); // warning, not error
        let warns: Vec<_> = report.warnings().collect();
        let has = warns.iter().any(|f| f.field == "frontmatter.description");
        assert!(has);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn over_max_description_errors() {
        let parent = temp_dir("toolongdesc");
        let mut desc = String::new();
        for _ in 0..1100 {
            desc.push('a');
        }
        let dir = write_skill_dir(
            &parent,
            "toolong",
            &format!("name: toolong\ndescription: {desc}"),
            "body",
        );
        let report = validate_skill_dir(&dir);
        assert!(!report.is_valid());
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn unexpected_top_level_file_errors() {
        let parent = temp_dir("rogue");
        let dir = write_skill_dir(
            &parent,
            "rogue",
            "name: rogue\ndescription: Has rogue file.",
            "body",
        );
        fs::write(dir.join("rogue.txt"), "not allowed").unwrap();
        let report = validate_skill_dir(&dir);
        assert!(!report.is_valid());
        let has = report
            .errors()
            .any(|f| f.message.contains("unexpected entry"));
        assert!(has);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn allowed_top_level_subdirs_ok() {
        let parent = temp_dir("allowed");
        let dir = write_skill_dir(
            &parent,
            "all-three",
            "name: all-three\ndescription: Has scripts/ refs/ assets/.",
            "body",
        );
        for sub in ["scripts", "references", "assets"] {
            fs::create_dir_all(dir.join(sub)).unwrap();
        }
        let report = validate_skill_dir(&dir);
        assert!(report.is_valid(), "findings: {:?}", report.findings);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn dotfile_at_top_level_tolerated() {
        let parent = temp_dir("dotfile");
        let dir = write_skill_dir(
            &parent,
            "dotok",
            "name: dotok\ndescription: ok.",
            "body",
        );
        fs::write(dir.join(".DS_Store"), "junk").unwrap();
        let report = validate_skill_dir(&dir);
        assert!(report.is_valid());
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn missing_reference_errors() {
        let parent = temp_dir("missingref");
        let dir = write_skill_dir(
            &parent,
            "broken-ref",
            "name: broken-ref\ndescription: References a missing file.",
            "Run [the script](scripts/missing.sh).",
        );
        let report = validate_skill_dir(&dir);
        assert!(!report.is_valid());
        let has = report
            .errors()
            .any(|f| f.message.contains("missing referenced file"));
        assert!(has);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn present_reference_passes() {
        let parent = temp_dir("goodref");
        let dir = write_skill_dir(
            &parent,
            "good-ref",
            "name: good-ref\ndescription: References an existing file.",
            "Run [the script](scripts/run.sh).",
        );
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::write(dir.join("scripts/run.sh"), "#!/bin/sh\n").unwrap();
        let report = validate_skill_dir(&dir);
        assert!(report.is_valid(), "findings: {:?}", report.findings);
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn body_token_estimate_recorded() {
        let parent = temp_dir("tokens");
        let dir = write_skill_dir(
            &parent,
            "tok",
            "name: tok\ndescription: Has body.",
            "body content here\n",
        );
        let report = validate_skill_dir(&dir);
        assert!(report.body_token_estimate.is_some());
        assert!(report.body_token_estimate.unwrap() > 0);
        let _ = fs::remove_dir_all(&parent);
    }
}
