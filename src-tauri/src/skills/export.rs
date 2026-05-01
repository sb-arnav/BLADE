//! Skill export — convert tool_forge `ForgedTool` records into agentskills.io
//! SKILL.md format at `<blade_config_dir>/skills/<name>/SKILL.md`.
//!
//! Phase 22 Plan 22-01 (v1.3) — first integration point between Phase 21's
//! `mod skills` substrate and the existing tool_forge Voyager wiring.
//!
//! Coexistence is the design (per 22-RESEARCH § Integration with Phase 21):
//! tool_forge keeps writing its existing `<blade_config_dir>/tools/<name>.<ext>`
//! flat-layout script + `forged_tools` SQLite metadata. This module **adds**
//! a SKILL.md wrapper at the user tier so the Phase 21 `Catalog::resolve`
//! path can find the same skill, ecosystem tools (clawhub, agentskills.io
//! validators) can ingest it, and the M-07 trust-surface narrative ("BLADE
//! writes its own tools") has an artifact to point at.

use std::fs;
use std::path::{Path, PathBuf};

use crate::tool_forge::ForgedTool;

/// Result of an export attempt.
#[derive(Debug)]
pub enum ExportOutcome {
    /// SKILL.md (and scripts/<basename>) successfully written.
    Written {
        skill_md_path: PathBuf,
        script_copied_to: PathBuf,
    },
    /// The forged tool's name doesn't sanitize to an agentskills.io-compliant
    /// name. Caller should log a warning and continue — this is non-fatal
    /// for the Voyager loop (the tool still works through `tool_forge`'s
    /// existing path; just not via Catalog).
    NonCompliantName { reason: String },
}

/// Convert tool_forge's underscore-separated name into agentskills.io's
/// canonical hyphen-separated form. Returns `None` if the result can't
/// satisfy the spec (1-64 chars; lowercase ASCII letters, digits, hyphens
/// only; no leading/trailing hyphen).
pub fn sanitize_name(forged_name: &str) -> Option<String> {
    let candidate: String = forged_name
        .chars()
        .map(|c| if c == '_' { '-' } else { c })
        .collect();
    if candidate.is_empty() || candidate.len() > 64 {
        return None;
    }
    if !candidate
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return None;
    }
    if candidate.starts_with('-') || candidate.ends_with('-') {
        return None;
    }
    Some(candidate)
}

/// Export a `ForgedTool` to a SKILL.md at `<base>/<name>/SKILL.md`.
///
/// `base` is typically `crate::skills::user_root()` in production. Tests
/// pass an explicit temp dir.
///
/// Side effects on success:
///   - `<base>/<name>/SKILL.md` written
///   - `<base>/<name>/scripts/<basename>` copied from the forged tool's
///     existing script path (the file `tool_forge` already wrote)
///
/// On `NonCompliantName`, no files are written.
pub fn export_to_user_tier(forged: &ForgedTool, base: &Path) -> Result<ExportOutcome, String> {
    let canonical_name = match sanitize_name(&forged.name) {
        Some(n) => n,
        None => {
            return Ok(ExportOutcome::NonCompliantName {
                reason: format!(
                    "tool_forge name {:?} cannot be converted to agentskills.io-compliant form",
                    forged.name
                ),
            });
        }
    };

    let skill_dir = base.join(&canonical_name);
    let scripts_dir = skill_dir.join("scripts");
    fs::create_dir_all(&scripts_dir).map_err(|e| {
        format!("[skills::export] create_dir_all {}: {e}", scripts_dir.display())
    })?;

    // Copy the forged script into the SKILL's scripts/ subdir so consumers
    // that resolve via the Phase 21 Catalog can find it. We deliberately
    // **copy** rather than symlink for cross-platform portability (Windows
    // symlink quirks would otherwise force a per-OS branch).
    let src_script = Path::new(&forged.script_path);
    let script_basename = src_script
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            format!(
                "[skills::export] forged.script_path {:?} has no basename",
                forged.script_path
            )
        })?;
    let dest_script = scripts_dir.join(script_basename);

    if src_script.is_file() {
        fs::copy(src_script, &dest_script).map_err(|e| {
            format!(
                "[skills::export] copy {} → {}: {e}",
                src_script.display(),
                dest_script.display()
            )
        })?;
    } else {
        return Err(format!(
            "[skills::export] forged script not found at {}",
            src_script.display()
        ));
    }

    // Build the SKILL.md body. Frontmatter is the canonical 6-field form;
    // body recapitulates the forged tool's usage hint + a pointer to the
    // copied script.
    let skill_md = build_skill_md(&canonical_name, forged, script_basename);

    let skill_md_path = skill_dir.join("SKILL.md");
    fs::write(&skill_md_path, &skill_md).map_err(|e| {
        format!("[skills::export] write {}: {e}", skill_md_path.display())
    })?;

    Ok(ExportOutcome::Written {
        skill_md_path,
        script_copied_to: dest_script,
    })
}

fn build_skill_md(canonical_name: &str, forged: &ForgedTool, script_basename: &str) -> String {
    // Description must fit ≤1024 chars (validator hard cap). tool_forge's
    // description is one sentence by convention; safe_slice is belt+braces.
    let description = crate::safe_slice(&forged.description, 1024);
    // Escape any embedded `"` in description for YAML safety (single-line
    // quoted scalar would also work, but keeping it unquoted is fine if no
    // colon appears at the top level — the validator catches malformed YAML).
    // We use the simplest YAML form: bare-string after key. The agentskills.io
    // spec is tolerant here.
    let usage_one_liner = forged.usage.lines().next().unwrap_or("").trim();

    format!(
        "---\n\
name: {canonical_name}\n\
description: {description}\n\
license: Apache-2.0\n\
metadata:\n  \
  forged_from: {forged_from}\n  \
  language: {language}\n  \
  forged_tool_id: {tool_id}\n\
---\n\
\n\
# {canonical_name}\n\
\n\
A skill auto-generated by BLADE's tool_forge from the capability description:\n\
\n\
> {forged_from_quote}\n\
\n\
## When to use\n\
\n\
The originating capability description is the best signal. If the user's\n\
request semantically matches that, this skill is the right surface to invoke.\n\
\n\
## How to invoke\n\
\n\
The forged script is preserved verbatim under [scripts/{script_basename}](scripts/{script_basename}).\n\
\n\
Usage hint emitted by tool_forge at write time:\n\
\n\
```text\n\
{usage_one_liner}\n\
```\n\
\n\
## Provenance\n\
\n\
- **forged_tool id:** `{tool_id}`\n\
- **language:** `{language}`\n\
- **created_at (unix):** `{created_at}`\n\
- **smoke-test output (truncated):**\n\
\n\
```text\n\
{test_output}\n\
```\n\
\n\
## Constraints\n\
\n\
- Never assume the script's parameter shape — read its own usage line.\n\
- If the script fails, surface the error verbatim; don't retry without\n\
  user confirmation.\n",
        canonical_name = canonical_name,
        description = description,
        forged_from = forged.forged_from.replace('\n', " ").trim_end().to_string(),
        forged_from_quote = forged.forged_from.replace('\n', " ").trim_end().to_string(),
        language = forged.language,
        tool_id = forged.id,
        created_at = forged.created_at,
        usage_one_liner = usage_one_liner,
        script_basename = script_basename,
        test_output = crate::safe_slice(&forged.test_output, 800),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_forge::{ForgedTool, ToolParameter};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-skills-export-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_fake_script(dir: &Path, name: &str, ext: &str, body: &str) -> PathBuf {
        let path = dir.join(format!("{name}.{ext}"));
        fs::write(&path, body).unwrap();
        path
    }

    fn fake_tool(name: &str, script_path: PathBuf) -> ForgedTool {
        ForgedTool {
            id: "test-id-0001".to_string(),
            name: name.to_string(),
            description: "Fetches a YouTube transcript.".to_string(),
            language: "python".to_string(),
            script_path: script_path.to_string_lossy().to_string(),
            usage: "youtube_transcript_fetch.py <url>".to_string(),
            parameters: vec![ToolParameter {
                name: "url".to_string(),
                param_type: "string".to_string(),
                description: "YouTube URL".to_string(),
                required: true,
            }],
            test_output: "OK: transcript fetched".to_string(),
            created_at: 1714780800,
            last_used: None,
            use_count: 0,
            forged_from: "fetch a youtube transcript".to_string(),
        }
    }

    #[test]
    fn sanitize_name_converts_underscores_to_hyphens() {
        assert_eq!(
            sanitize_name("youtube_transcript_fetch").as_deref(),
            Some("youtube-transcript-fetch")
        );
    }

    #[test]
    fn sanitize_name_preserves_already_compliant() {
        assert_eq!(
            sanitize_name("simple-name").as_deref(),
            Some("simple-name")
        );
    }

    #[test]
    fn sanitize_name_rejects_uppercase() {
        assert!(sanitize_name("BadName").is_none());
    }

    #[test]
    fn sanitize_name_rejects_special_chars() {
        assert!(sanitize_name("name with spaces").is_none());
        assert!(sanitize_name("name.dot").is_none());
        assert!(sanitize_name("naïve").is_none());
    }

    #[test]
    fn sanitize_name_rejects_empty_or_too_long() {
        assert!(sanitize_name("").is_none());
        let long: String = "a".repeat(65);
        assert!(sanitize_name(&long).is_none());
    }

    #[test]
    fn sanitize_name_rejects_leading_or_trailing_hyphen() {
        assert!(sanitize_name("-leading").is_none());
        assert!(sanitize_name("trailing-").is_none());
        assert!(sanitize_name("_leading_underscore").is_none());
    }

    #[test]
    fn export_writes_skill_md_and_copies_script() {
        let scripts_src = temp_dir("export-src");
        let base = temp_dir("export-base");
        let script_path = write_fake_script(
            &scripts_src,
            "youtube_transcript_fetch",
            "py",
            "#!/usr/bin/env python3\nprint('ok')\n",
        );
        let forged = fake_tool("youtube_transcript_fetch", script_path);

        let outcome = export_to_user_tier(&forged, &base).unwrap();
        match outcome {
            ExportOutcome::Written {
                skill_md_path,
                script_copied_to,
            } => {
                assert!(skill_md_path.is_file());
                assert!(script_copied_to.is_file());
                let body = fs::read_to_string(&skill_md_path).unwrap();
                assert!(body.contains("name: youtube-transcript-fetch"));
                assert!(body.contains("description: Fetches a YouTube transcript."));
                assert!(body.contains("license: Apache-2.0"));
                assert!(body.contains("forged_tool_id: test-id-0001"));
                assert!(body.contains("scripts/youtube_transcript_fetch.py"));
            }
            ExportOutcome::NonCompliantName { reason } => {
                panic!("expected Written, got NonCompliantName: {reason}");
            }
        }

        let _ = fs::remove_dir_all(&scripts_src);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn export_returns_non_compliant_for_uppercase_name() {
        let scripts_src = temp_dir("export-bad-src");
        let base = temp_dir("export-bad-base");
        let script_path = write_fake_script(&scripts_src, "Bad_Name", "py", "noop");
        let forged = fake_tool("Bad_Name", script_path);

        let outcome = export_to_user_tier(&forged, &base).unwrap();
        match outcome {
            ExportOutcome::NonCompliantName { reason } => {
                assert!(reason.contains("agentskills.io-compliant"));
            }
            other => panic!("expected NonCompliantName, got {other:?}"),
        }
        // No files should have been written
        assert!(fs::read_dir(&base).unwrap().next().is_none());

        let _ = fs::remove_dir_all(&scripts_src);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn export_errors_when_forged_script_missing() {
        let base = temp_dir("export-missing-base");
        let forged = fake_tool(
            "ghost_tool",
            PathBuf::from("/nonexistent/path/ghost.py"),
        );

        let err = export_to_user_tier(&forged, &base).unwrap_err();
        assert!(err.contains("forged script not found"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn exported_skill_md_passes_validator() {
        let scripts_src = temp_dir("export-validate-src");
        let base = temp_dir("export-validate-base");
        let script_path = write_fake_script(
            &scripts_src,
            "format_clipboard",
            "py",
            "#!/usr/bin/env python3\n",
        );
        let forged = fake_tool("format_clipboard", script_path);

        let outcome = export_to_user_tier(&forged, &base).unwrap();
        let skill_dir = match outcome {
            ExportOutcome::Written { skill_md_path, .. } => skill_md_path
                .parent()
                .unwrap()
                .to_path_buf(),
            other => panic!("expected Written, got {other:?}"),
        };

        let report = crate::skills::validator::validate_skill_dir(&skill_dir);
        assert!(
            report.is_valid(),
            "validator findings: {:?}",
            report.findings
        );

        let _ = fs::remove_dir_all(&scripts_src);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn exported_skill_md_loads_via_catalog() {
        // Round-trip: export → scan_tier → resolve → frontmatter matches
        let scripts_src = temp_dir("export-catalog-src");
        let base = temp_dir("export-catalog-base");
        let script_path = write_fake_script(&scripts_src, "git_summary", "sh", "#!/bin/sh\n");
        let forged = fake_tool("git_summary", script_path);

        let _ = export_to_user_tier(&forged, &base).unwrap();

        let stubs = crate::skills::loader::scan_tier(&base, crate::skills::SourceTier::User);
        assert_eq!(stubs.len(), 1);
        assert_eq!(stubs[0].frontmatter.name, "git-summary");
        assert_eq!(
            stubs[0].frontmatter.description,
            "Fetches a YouTube transcript."
        );

        let _ = fs::remove_dir_all(&scripts_src);
        let _ = fs::remove_dir_all(&base);
    }
}
