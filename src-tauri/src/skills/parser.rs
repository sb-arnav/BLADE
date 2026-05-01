//! SKILL.md parser — frontmatter splitter + YAML deserialize + reference scan.
//!
//! See `21-RESEARCH.md` Q2 for edge-case handling decisions.

use super::types::{SkillBody, SkillFrontmatter};

/// The frontmatter delimiter as required by agentskills.io specification.
const DELIM: &str = "---";

/// Parse a SKILL.md text into `(frontmatter, body)`.
///
/// Errors:
/// - `[skills::parser] no opening --- delimiter` if the file doesn't start with `---`
/// - `[skills::parser] no closing --- delimiter` if the second `---` line is missing
/// - `[skills::parser] yaml: ...` if `serde_yaml` fails to deserialize
///
/// On success, scans the markdown body for `(scripts/...)`, `(references/...)`,
/// `(assets/...)` markdown-link targets and records them in `SkillBody.references`.
pub fn parse_skill(text: &str) -> Result<(SkillFrontmatter, SkillBody), String> {
    let (yaml_text, body_text) = split_frontmatter(text)?;

    let frontmatter: SkillFrontmatter = serde_yaml::from_str(yaml_text)
        .map_err(|e| format!("[skills::parser] yaml: {e}"))?;

    let references = find_references(body_text);
    let body = SkillBody {
        markdown: body_text.to_string(),
        references,
    };

    Ok((frontmatter, body))
}

/// Split a SKILL.md text into `(yaml_frontmatter_text, body_text)`.
///
/// The first line must be `---`. The next `---` line on its own closes the
/// frontmatter block. Leading whitespace before the opening delimiter is rejected
/// to match the agentskills.io strict-parse convention; trailing whitespace
/// after the closing `---` line is preserved as part of the body.
pub fn split_frontmatter(text: &str) -> Result<(&str, &str), String> {
    // Be tolerant of files starting with a UTF-8 BOM (some editors prepend one).
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);

    let mut lines = text.split_inclusive('\n');
    let first = lines.next().ok_or_else(|| {
        "[skills::parser] empty file (no opening --- delimiter)".to_string()
    })?;

    if first.trim_end_matches(['\n', '\r']) != DELIM {
        return Err(
            "[skills::parser] no opening --- delimiter (file must start with `---`)"
                .to_string(),
        );
    }

    // Walk the remaining lines, accumulating yaml until we hit the closing `---`.
    let mut yaml_end_byte: Option<usize> = None;
    let mut body_start_byte: Option<usize> = None;

    let mut cursor = first.len();
    for line in lines {
        let line_len = line.len();
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed == DELIM {
            yaml_end_byte = Some(cursor);
            body_start_byte = Some(cursor + line_len);
            break;
        }
        cursor += line_len;
    }

    let yaml_end = yaml_end_byte.ok_or_else(|| {
        "[skills::parser] no closing --- delimiter (frontmatter is unterminated)"
            .to_string()
    })?;
    let body_start = body_start_byte.expect("body_start set when yaml_end set");

    let yaml_text = &text[first.len()..yaml_end];
    let body_text = &text[body_start..];

    Ok((yaml_text, body_text))
}

/// Scan the markdown body for inline links / images that reference one of the
/// canonical SKILL subdirs (`scripts/`, `references/`, `assets/`).
///
/// Returns a deduplicated, order-preserved list of relative paths.
///
/// Pattern matched: `(scripts/...)`, `(references/...)`, `(assets/...)` —
/// markdown-link / image-target syntax. We deliberately match only when the
/// path is wrapped in `()` to avoid picking up code-block / inline-code uses
/// of the same path. This is the conservative match; later phases can broaden.
pub fn find_references(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let prefixes = ["scripts/", "references/", "assets/"];

    for (idx, ch) in body.char_indices() {
        if ch != '(' {
            continue;
        }
        let after = &body[idx + ch.len_utf8()..];
        for prefix in &prefixes {
            if after.starts_with(prefix) {
                if let Some(close) = after.find(')') {
                    let path = &after[..close];
                    // Reject paths with whitespace (markdown lets you do
                    // `(scripts/a.py "title")` — title would whitespace-precede
                    // the close paren). Strip after first whitespace.
                    let path: &str = match path.find(|c: char| c.is_whitespace()) {
                        Some(ws) => &path[..ws],
                        None => path,
                    };
                    let owned = path.to_string();
                    if !out.contains(&owned) {
                        out.push(owned);
                    }
                }
                break;
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_BASIC: &str = "---\nname: example\ndescription: Demo skill.\n---\n# Body\n";

    #[test]
    fn split_frontmatter_basic() {
        let (yaml, body) = split_frontmatter(VALID_BASIC).unwrap();
        assert!(yaml.contains("name: example"));
        assert!(yaml.contains("description: Demo skill."));
        assert_eq!(body, "# Body\n");
    }

    #[test]
    fn split_frontmatter_strips_bom() {
        let with_bom = format!("\u{FEFF}{VALID_BASIC}");
        let (yaml, body) = split_frontmatter(&with_bom).unwrap();
        assert!(yaml.contains("name: example"));
        assert_eq!(body, "# Body\n");
    }

    #[test]
    fn split_frontmatter_rejects_missing_opening_delim() {
        let text = "name: bad\ndescription: x\n---\n# body\n";
        let err = split_frontmatter(text).unwrap_err();
        assert!(err.contains("no opening --- delimiter"));
    }

    #[test]
    fn split_frontmatter_rejects_missing_closing_delim() {
        let text = "---\nname: bad\ndescription: x\n# body\n";
        let err = split_frontmatter(text).unwrap_err();
        assert!(err.contains("no closing --- delimiter"));
    }

    #[test]
    fn split_frontmatter_rejects_empty_file() {
        let err = split_frontmatter("").unwrap_err();
        assert!(err.contains("empty file"));
    }

    #[test]
    fn parse_skill_returns_frontmatter_and_body() {
        let (fm, body) = parse_skill(VALID_BASIC).unwrap();
        assert_eq!(fm.name, "example");
        assert_eq!(fm.description, "Demo skill.");
        assert_eq!(body.markdown, "# Body\n");
        assert!(body.references.is_empty());
    }

    #[test]
    fn parse_skill_handles_optional_fields() {
        let text = "---\nname: full\ndescription: Skill with all optional fields.\nlicense: Apache-2.0\ncompatibility: linux\nmetadata:\n  author: arnav\n  tags:\n    - cli\n    - dev\nallowed-tools: Bash(git:*)\n---\nbody\n";
        let (fm, _) = parse_skill(text).unwrap();
        assert_eq!(fm.license.as_deref(), Some("Apache-2.0"));
        assert_eq!(fm.compatibility.as_deref(), Some("linux"));
        assert!(matches!(
            fm.allowed_tools,
            Some(super::super::types::AllowedTools::Single(_))
        ));
        // Verify metadata round-trips as serde_yaml::Value
        let mapping = fm.metadata.as_mapping().expect("metadata is a mapping");
        let author = mapping
            .get(&serde_yaml::Value::String("author".to_string()))
            .and_then(|v| v.as_str());
        assert_eq!(author, Some("arnav"));
    }

    #[test]
    fn parse_skill_handles_allowed_tools_as_list() {
        let text = "---\nname: lists\ndescription: Skill with list-form allowed-tools.\nallowed-tools:\n  - Read\n  - Grep\n  - Bash(git:*)\n---\nbody\n";
        let (fm, _) = parse_skill(text).unwrap();
        let tools = fm.allowed_tools.expect("allowed_tools present");
        let slice = tools.as_slice();
        assert_eq!(slice, vec!["Read", "Grep", "Bash(git:*)"]);
    }

    #[test]
    fn parse_skill_yaml_error_propagates() {
        let text = "---\nname: bad\ndescription: \"unterminated string\n---\nbody\n";
        let err = parse_skill(text).unwrap_err();
        assert!(err.contains("[skills::parser] yaml:"));
    }

    #[test]
    fn find_references_picks_up_canonical_subdirs() {
        let body = "Check [the script](scripts/fetch.py) and [the docs](references/guide.md) plus [an asset](assets/logo.png).";
        let refs = find_references(body);
        assert_eq!(refs, vec!["scripts/fetch.py", "references/guide.md", "assets/logo.png"]);
    }

    #[test]
    fn find_references_ignores_non_subdir_links() {
        let body = "External [link](https://example.com) and [other](../escape.md) and (scripts) without slash.";
        let refs = find_references(body);
        assert!(refs.is_empty());
    }

    #[test]
    fn find_references_dedups() {
        let body = "First [a](scripts/a.py). Then again [a-2](scripts/a.py).";
        let refs = find_references(body);
        assert_eq!(refs, vec!["scripts/a.py"]);
    }

    #[test]
    fn find_references_handles_title_after_path() {
        let body = "Image: ![alt](assets/img.png \"a title\")";
        let refs = find_references(body);
        assert_eq!(refs, vec!["assets/img.png"]);
    }

    #[test]
    fn parse_skill_records_references() {
        let text = "---\nname: refsy\ndescription: Skill that references files.\n---\nSee [hi](scripts/hi.py).\n";
        let (_, body) = parse_skill(text).unwrap();
        assert_eq!(body.references, vec!["scripts/hi.py"]);
    }
}
