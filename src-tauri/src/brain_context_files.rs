// Phase 83 (v2.5 CACHE-PARITY) / D-08 — context-tier file discovery.
//
// Reads cwd-local context files in fixed order (AGENTS.md -> .cursorrules ->
// .blade.md -> CLAUDE.md) and returns concatenated contents with section
// dividers. Missing or unreadable files are silently skipped. Order is
// fixed (not alphabetical) per planner discretion in CONTEXT.md "Claude's
// Discretion" — operator convention is to put AGENTS.md first.

use std::path::Path;

const CONTEXT_FILE_ORDER: &[&str] = &[
    "AGENTS.md",
    ".cursorrules",
    ".blade.md",
    "CLAUDE.md",
];

/// Read context files from `cwd` in fixed order, return concatenated
/// contents with section dividers. Returns empty string when no files exist.
/// Panic-free: any std::fs error (missing file, permission denied, IO error)
/// is silently treated as "file not present".
pub fn discover_context_files(cwd: &Path) -> String {
    let mut parts: Vec<String> = Vec::new();
    for filename in CONTEXT_FILE_ORDER {
        let path = cwd.join(filename);
        if let Ok(content) = std::fs::read_to_string(&path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                parts.push(format!("## From {}\n\n{}", filename, trimmed));
            }
        }
    }
    parts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn discover_returns_empty_when_no_files() {
        let tmp = std::env::temp_dir().join(format!("blade_p83_t1_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        assert_eq!(discover_context_files(&tmp), "");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn discover_reads_agents_md_with_section_marker() {
        let tmp = std::env::temp_dir().join(format!("blade_p83_t2_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("AGENTS.md"), "agent rules go here").unwrap();
        let out = discover_context_files(&tmp);
        assert!(out.contains("## From AGENTS.md"));
        assert!(out.contains("agent rules go here"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn discover_concatenates_multiple_files_in_fixed_order() {
        let tmp = std::env::temp_dir().join(format!("blade_p83_t3_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("CLAUDE.md"), "claude content").unwrap();
        fs::write(tmp.join("AGENTS.md"), "agent content").unwrap();
        let out = discover_context_files(&tmp);
        let agents_idx = out.find("## From AGENTS.md").unwrap();
        let claude_idx = out.find("## From CLAUDE.md").unwrap();
        assert!(agents_idx < claude_idx, "AGENTS.md must come before CLAUDE.md in fixed order");
        let _ = fs::remove_dir_all(&tmp);
    }
}
