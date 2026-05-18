// Phase 75 (v2.4) — RTK tool-result compression.
//
// Pattern-lift from decolua/9router `open-sse/rtk/filters/` (MIT). Per-tool-type
// post-processors that shrink common tool-result payloads (git diff, grep, ls,
// tree, smart-truncate fallback) before they re-enter the model context.
//
// COMPLEMENTARY to BLADE's v1.5 OpenHands-style conversation condenser
// (loop_engine.rs keep-edges-summarize-middle). That layer compresses
// conversation history; this layer compresses individual tool_result bodies.
//
// Pure functions. Caller routes via `compress_auto(label, raw)` or directly via
// the per-format helpers. Compression is lossy and tool-specific.

/// Caps mirror 9router constants.js — tunable per release.
pub const GIT_DIFF_HUNK_MAX_LINES: usize = 100;
pub const GIT_DIFF_MAX_LINES: usize = 500;
pub const GREP_PER_FILE_MAX: usize = 10;
pub const TREE_MAX_LINES: usize = 200;
pub const SMART_TRUNCATE_HEAD: usize = 120;
pub const SMART_TRUNCATE_TAIL: usize = 60;
pub const SMART_TRUNCATE_MIN_LINES: usize = 250;

pub const LS_NOISE_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "__pycache__",
    ".next", "dist", "build", ".venv", "venv",
    ".cache", ".idea", ".vscode", ".DS_Store",
];

/// Best-effort tool-output classifier. Maps a tool name / hint to the right
/// compression filter. Returns None when no filter applies — caller passes the
/// raw string through unchanged.
pub fn detect_filter(label: &str) -> Option<&'static str> {
    let l = label.to_ascii_lowercase();
    if l.contains("git") && l.contains("diff") { return Some("git-diff"); }
    if l.contains("grep") || l.contains("ripgrep") || l.contains("rg") { return Some("grep"); }
    if l.contains("tree") { return Some("tree"); }
    if l.contains("ls") || l.contains("dir") || l.contains("list") { return Some("ls"); }
    None
}

/// Auto-route: pick a filter by label, fall back to smart_truncate on long output.
pub fn compress_auto(label: &str, raw: &str) -> String {
    let filtered = match detect_filter(label) {
        Some("git-diff") => git_diff(raw, GIT_DIFF_MAX_LINES),
        Some("grep") => grep(raw),
        Some("tree") => tree(raw),
        Some("ls") => ls(raw),
        _ => raw.to_string(),
    };
    smart_truncate(&filtered)
}

/// gitDiff — compact unified diff. Caps per-hunk lines + total lines.
pub fn git_diff(diff: &str, max_lines: usize) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut current_file = String::new();
    let mut added = 0usize;
    let mut removed = 0usize;
    let mut in_hunk = false;
    let mut hunk_shown = 0usize;
    let mut hunk_skipped = 0usize;
    let mut was_truncated = false;
    let max_hunk = GIT_DIFF_HUNK_MAX_LINES;

    'outer: for line in diff.split('\n') {
        if line.starts_with("diff --git") {
            if hunk_skipped > 0 {
                out.push(format!("  ... ({} lines truncated)", hunk_skipped));
                was_truncated = true;
                hunk_skipped = 0;
            }
            if !current_file.is_empty() && (added > 0 || removed > 0) {
                out.push(format!("  +{} -{}", added, removed));
            }
            current_file = match line.split(" b/").nth(1) {
                Some(s) => s.to_string(),
                None => "unknown".to_string(),
            };
            out.push(format!("\n{}", current_file));
            added = 0; removed = 0; in_hunk = false; hunk_shown = 0;
        } else if line.starts_with("@@") {
            if hunk_skipped > 0 {
                out.push(format!("  ... ({} lines truncated)", hunk_skipped));
                was_truncated = true;
                hunk_skipped = 0;
            }
            in_hunk = true;
            hunk_shown = 0;
            out.push(format!("  {}", line));
        } else if in_hunk {
            if line.starts_with('+') && !line.starts_with("+++") {
                added += 1;
                if hunk_shown < max_hunk { out.push(format!("  {}", line)); hunk_shown += 1; }
                else { hunk_skipped += 1; }
            } else if line.starts_with('-') && !line.starts_with("---") {
                removed += 1;
                if hunk_shown < max_hunk { out.push(format!("  {}", line)); hunk_shown += 1; }
                else { hunk_skipped += 1; }
            } else if hunk_shown < max_hunk && !line.starts_with('\\') {
                if hunk_shown > 0 { out.push(format!("  {}", line)); hunk_shown += 1; }
            }
        }
        if out.len() >= max_lines {
            out.push("\n... (more changes truncated)".to_string());
            was_truncated = true;
            break 'outer;
        }
    }

    if hunk_skipped > 0 {
        out.push(format!("  ... ({} lines truncated)", hunk_skipped));
        was_truncated = true;
    }
    if !current_file.is_empty() && (added > 0 || removed > 0) {
        out.push(format!("  +{} -{}", added, removed));
    }
    if was_truncated {
        out.push("[full diff: rtk git diff --no-compact]".to_string());
    }
    out.join("\n")
}

/// grep — input format "file:lineno:content". Groups by file, caps per file.
pub fn grep(input: &str) -> String {
    use std::collections::BTreeMap;
    let mut by_file: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    let mut total = 0usize;

    for line in input.split('\n') {
        let first = match line.find(':') { Some(i) => i, None => continue };
        let rest = &line[first + 1..];
        let second_rel = match rest.find(':') { Some(i) => i, None => continue };
        let second = first + 1 + second_rel;
        let file = &line[..first];
        let line_num = &line[first + 1..second];
        let content = &line[second + 1..];
        if line_num.parse::<usize>().is_err() { continue; }
        total += 1;
        by_file.entry(file.to_string()).or_default().push((line_num.to_string(), content.to_string()));
    }

    if total == 0 { return input.to_string(); }

    let files: Vec<&String> = by_file.keys().collect();
    let mut out = format!("{} matches in {}F:\n\n", total, files.len());
    for file in files {
        let matches = by_file.get(file).unwrap();
        out.push_str(&format!("[file] {} ({}):\n", file, matches.len()));
        for (ln, content) in matches.iter().take(GREP_PER_FILE_MAX) {
            out.push_str(&format!("  {:>4}: {}\n", ln, content.trim()));
        }
        if matches.len() > GREP_PER_FILE_MAX {
            out.push_str(&format!("  +{}\n", matches.len() - GREP_PER_FILE_MAX));
        }
        out.push('\n');
    }
    out
}

/// tree — drop summary line + trailing blanks, cap at TREE_MAX_LINES.
pub fn tree(input: &str) -> String {
    let lines: Vec<&str> = input.split('\n').collect();
    if lines.is_empty() { return input.to_string(); }
    let mut filtered: Vec<&str> = Vec::with_capacity(lines.len());
    for line in &lines {
        if line.contains("director") && line.contains("file") { continue; }
        if line.trim().is_empty() && filtered.is_empty() { continue; }
        filtered.push(line);
    }
    while filtered.last().is_some_and(|l| l.trim().is_empty()) {
        filtered.pop();
    }
    if filtered.len() > TREE_MAX_LINES {
        let cut = filtered.len() - TREE_MAX_LINES;
        let mut s = filtered[..TREE_MAX_LINES].join("\n");
        s.push_str(&format!("\n... +{} more lines", cut));
        return s;
    }
    filtered.join("\n")
}

/// ls — compact `ls -la` output: drop noise dirs, summarize by extension.
pub fn ls(input: &str) -> String {
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<(String, String)> = Vec::new();
    let mut by_ext: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for line in input.split('\n') {
        if line.starts_with("total ") || line.is_empty() { continue; }
        let parsed = match parse_ls_line(line) { Some(p) => p, None => continue };
        if parsed.name == "." || parsed.name == ".." { continue; }
        if LS_NOISE_DIRS.contains(&parsed.name.as_str()) { continue; }

        if parsed.file_type == 'd' {
            dirs.push(parsed.name);
        } else if parsed.file_type == '-' || parsed.file_type == 'l' {
            let ext = parsed.name.rfind('.')
                .filter(|&i| i > 0)
                .map(|i| parsed.name[i..].to_string())
                .unwrap_or_else(|| "no ext".to_string());
            *by_ext.entry(ext).or_insert(0) += 1;
            files.push((parsed.name, human_size(parsed.size)));
        }
    }

    if dirs.is_empty() && files.is_empty() { return input.to_string(); }

    let mut out = String::new();
    for d in &dirs { out.push_str(d); out.push_str("/\n"); }
    for (name, size) in &files { out.push_str(&format!("{}  {}\n", name, size)); }
    out.push_str(&format!("\nSummary: {} files, {} dirs", files.len(), dirs.len()));
    if !by_ext.is_empty() {
        let mut ext_vec: Vec<(String, usize)> = by_ext.into_iter().collect();
        ext_vec.sort_by(|a, b| b.1.cmp(&a.1));
        let parts: Vec<String> = ext_vec.iter().take(5).map(|(e, c)| format!("{} {}", c, e)).collect();
        out.push_str(&format!(" ({}", parts.join(", ")));
        if ext_vec.len() > 5 {
            out.push_str(&format!(", +{} more", ext_vec.len() - 5));
        }
        out.push(')');
    }
    out
}

struct ParsedLs { file_type: char, size: u64, name: String }

fn parse_ls_line(line: &str) -> Option<ParsedLs> {
    // Simplified: rely on `ls -la` having 9 whitespace-separated fields with
    // permissions first, size as a numeric field, name as the trailing
    // (possibly multi-word) tail. Avoid the regex by using positional split.
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 { return None; }
    let perms = parts[0];
    let file_type = perms.chars().next()?;
    if !"-dlbcps".contains(file_type) { return None; }
    // Size is typically parts[4]; name is parts[8..] joined with space.
    let size: u64 = parts[4].parse().ok()?;
    let name = parts[8..].join(" ");
    Some(ParsedLs { file_type, size, name })
}

fn human_size(bytes: u64) -> String {
    if bytes >= 1_048_576 { format!("{:.1}M", bytes as f64 / 1_048_576.0) }
    else if bytes >= 1024 { format!("{:.1}K", bytes as f64 / 1024.0) }
    else { format!("{}B", bytes) }
}

/// smart_truncate — keep HEAD + TAIL lines, replace middle with "... +N lines".
pub fn smart_truncate(input: &str) -> String {
    let lines: Vec<&str> = input.split('\n').collect();
    if lines.len() < SMART_TRUNCATE_MIN_LINES { return input.to_string(); }
    let head = &lines[..SMART_TRUNCATE_HEAD];
    let tail = &lines[lines.len() - SMART_TRUNCATE_TAIL..];
    let cut = lines.len() - head.len() - tail.len();
    let mut s = head.join("\n");
    s.push_str(&format!("\n... +{} lines truncated\n", cut));
    s.push_str(&tail.join("\n"));
    s
}

// ── Phase 75 falsification — runnable tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_filter_routes_known_labels() {
        assert_eq!(detect_filter("git_diff"), Some("git-diff"));
        assert_eq!(detect_filter("Git Diff"), Some("git-diff"));
        assert_eq!(detect_filter("grep"), Some("grep"));
        assert_eq!(detect_filter("ripgrep"), Some("grep"));
        assert_eq!(detect_filter("tree_command"), Some("tree"));
        assert_eq!(detect_filter("ls_listing"), Some("ls"));
        assert_eq!(detect_filter("random_label"), None);
    }

    #[test]
    fn git_diff_round_trip_compresses_known_fixture() {
        // Known small diff fixture: 1 file, 1 hunk, 3 added + 2 removed.
        let raw = "diff --git a/foo.rs b/foo.rs
index 1234..5678 100644
--- a/foo.rs
+++ b/foo.rs
@@ -1,4 +1,5 @@
 use std::fs;
-fn old() {}
+fn new() {}
+fn another() {}
+fn third() {}
 mod tests;";
        let out = git_diff(raw, 500);
        // Compressed bytes < raw bytes (RTK does compress small diffs by stripping header lines).
        assert!(out.len() < raw.len(), "compression reduced bytes ({} → {})", raw.len(), out.len());
        // Structure preserved: file name + per-file additions/deletions counter present.
        assert!(out.contains("foo.rs"), "filename in output");
        assert!(out.contains("+3 -1"), "per-file delta counter present (got: {})", out);
    }

    #[test]
    fn git_diff_truncates_oversize_hunks() {
        // Generate a hunk with > GIT_DIFF_HUNK_MAX_LINES additions.
        let mut raw = String::from("diff --git a/big.rs b/big.rs\n@@ -1,1 +1,200 @@\n");
        for i in 0..200 { raw.push_str(&format!("+line {}\n", i)); }
        let out = git_diff(&raw, 500);
        assert!(out.contains("truncated"), "truncation marker present");
        // Counter still accurate: added = 200.
        assert!(out.contains("+200"), "additions counter accurate");
    }

    #[test]
    fn grep_groups_by_file_and_caps_per_file() {
        let mut raw = String::new();
        for i in 0..20 { raw.push_str(&format!("src/a.rs:{}:match {}\n", i + 1, i)); }
        for i in 0..3 { raw.push_str(&format!("src/b.rs:{}:hit {}\n", i + 1, i)); }
        let out = grep(&raw);
        assert!(out.contains("23 matches in 2F"), "header totals correct (got: {})", out);
        assert!(out.contains("[file] src/a.rs (20)"), "per-file count present");
        assert!(out.contains("+10"), "cap-overflow marker (20 > GREP_PER_FILE_MAX=10)");
    }

    #[test]
    fn tree_drops_summary_line_and_caps() {
        let raw = "\n.\n├── src\n│   └── lib.rs\n└── README.md\n\n5 directories, 23 files\n";
        let out = tree(raw);
        assert!(!out.contains("directories,"), "summary line dropped");
        assert!(out.contains("src"), "structure preserved");
    }

    #[test]
    fn ls_drops_noise_and_summarizes() {
        let raw = "total 4
drwxr-xr-x 5 user user 4096 May 18 19:00 .git
drwxr-xr-x 8 user user 4096 May 18 19:00 src
drwxr-xr-x 2 user user 4096 May 18 19:00 node_modules
-rw-r--r-- 1 user user 1234 May 18 19:00 README.md
-rw-r--r-- 1 user user 5678 May 18 19:00 lib.rs";
        let out = ls(raw);
        assert!(!out.contains(".git"), "noise dir .git dropped");
        assert!(!out.contains("node_modules"), "noise dir node_modules dropped");
        assert!(out.contains("src/"), "real dir present");
        assert!(out.contains("README.md"), "file present");
        assert!(out.contains("Summary:"), "summary line present");
    }

    #[test]
    fn smart_truncate_below_threshold_is_passthrough() {
        let raw = (0..100).map(|i| i.to_string()).collect::<Vec<_>>().join("\n");
        assert_eq!(smart_truncate(&raw), raw, "under MIN_LINES => no change");
    }

    #[test]
    fn smart_truncate_above_threshold_keeps_head_and_tail() {
        let raw = (0..300).map(|i| format!("line{}", i)).collect::<Vec<_>>().join("\n");
        let out = smart_truncate(&raw);
        assert!(out.starts_with("line0\n"), "head preserved");
        assert!(out.contains("truncated"), "truncation marker present");
        assert!(out.contains("line299"), "tail preserved");
        assert!(out.len() < raw.len(), "bytes shrunk");
    }

    #[test]
    fn compress_auto_falls_back_to_smart_truncate_when_unknown() {
        // 400 long lines, no known label → falls through to smart_truncate.
        let raw = (0..400).map(|i| format!("line{}", i)).collect::<Vec<_>>().join("\n");
        let out = compress_auto("unknown_tool", &raw);
        assert!(out.contains("truncated"), "smart_truncate kicked in");
        assert!(out.len() < raw.len());
    }
}
