//! Phase 24 (v1.3) — skill lifecycle pure logic.
//!
//! Provides the deterministic substrate for `dream_mode`'s 3 new tasks
//! (prune, consolidate, generate) plus the apply-path that runs when an
//! operator confirms a chat-injected proposal (`commands.rs`).
//!
//! Per D-24-E LOCK: merges are mechanically constructed (no LLM).
//! Per D-24-G SCOPE: all logic operates on `forged_tools` rows only.
//!   SKILL.md skills (bundled + user-authored) are out of scope.
//!
//! Side-effecting helpers (`archive_skill`) live in this module too so
//! Task 2 (Plan 24-05) can wire them into the dream task chain without
//! adding more cross-module surface.

#![allow(dead_code)] // Wave 2 lands substrate; Wave 3 plans wire consumers.

use rusqlite::params;
use std::collections::HashSet;
use std::path::PathBuf;

use crate::tool_forge::{ForgedTool, ToolParameter};

// ── Pure logic ──────────────────────────────────────────────────────────────

/// D-24-E LOCK — deterministic merge body.
///
/// `is_taken` is a predicate that answers "is this name already in
/// forged_tools?" — typically wraps a SELECT. Tests pass a closure with
/// no side effects.
pub fn deterministic_merge_body<F>(a: &ForgedTool, b: &ForgedTool, is_taken: &F) -> ForgedTool
where
    F: Fn(&str) -> bool,
{
    // Lexicographic pick — smaller name + _merged suffix is the base.
    let (smaller, _larger) = if a.name <= b.name { (a, b) } else { (b, a) };
    let base_name = format!("{}_merged", smaller.name);
    let merged_name = ensure_unique_name(&base_name, is_taken);

    let now = chrono::Utc::now().timestamp();

    ForgedTool {
        id: uuid::Uuid::new_v4().to_string(),
        name: merged_name,
        description: format!("{} | {}", a.description, b.description),
        language: smaller.language.clone(),
        script_path: smaller.script_path.clone(),
        usage: dedup_lines(&format!("{}\n{}", a.usage, b.usage)),
        parameters: union_dedup_by_name(&a.parameters, &b.parameters),
        test_output: format!("{}\n--- merged ---\n{}", a.test_output, b.test_output),
        created_at: now,
        last_used: Some(now), // D-24-A
        use_count: 0,
        forged_from: format!("merge:{}+{}", a.name, b.name),
    }
}

/// Discretion item 3 LOCK — name dedup ladder.
///
/// `<base>` → on collision append `_v2`, `_v3`, ..., `_v999`; ultra-last-resort
/// `<base>_<uuid_v4>` (paranoid completeness).
pub fn ensure_unique_name<F>(base: &str, is_taken: &F) -> String
where
    F: Fn(&str) -> bool,
{
    if !is_taken(base) {
        return base.to_string();
    }
    for n in 2..1000 {
        let cand = format!("{}_v{}", base, n);
        if !is_taken(&cand) {
            return cand;
        }
    }
    format!("{}_{}", base, uuid::Uuid::new_v4())
}

/// Phase 24 D-24-E — line-wise dedup preserving first-seen order.
pub fn dedup_lines(s: &str) -> String {
    let mut seen = HashSet::new();
    let mut out: Vec<&str> = Vec::new();
    for line in s.lines() {
        if seen.insert(line.to_string()) {
            out.push(line);
        }
    }
    out.join("\n")
}

/// Phase 24 D-24-E — parameter union by name; first occurrence wins.
pub fn union_dedup_by_name(a: &[ToolParameter], b: &[ToolParameter]) -> Vec<ToolParameter> {
    let mut seen = HashSet::new();
    let mut out: Vec<ToolParameter> = Vec::new();
    for p in a.iter().chain(b.iter()) {
        if seen.insert(p.name.clone()) {
            out.push(p.clone());
        }
    }
    out
}

/// Cosine similarity over equal-length f32 slices. Returns 0.0 on mismatch
/// or empty input. Mirrored from `embeddings::cosine_similarity` (private)
/// rather than re-exporting to keep embeddings.rs's public surface untouched.
pub fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

/// Phase 24 D-24-A — proposed name from a tool-call trace. Deterministic.
/// Takes first 2-3 tool names, snake_case, joins with '_', prefixes "auto_",
/// truncates via safe_slice to 50 bytes.
pub fn proposed_name_from_trace(tool_names: &[String]) -> String {
    let truncated: String = tool_names
        .iter()
        .take(3)
        .map(|n| n.split('_').take(2).collect::<Vec<_>>().join("_"))
        .collect::<Vec<_>>()
        .join("_");
    format!("auto_{}", crate::safe_slice(&truncated, 50))
}

// ── Side-effecting helpers (DB queries) ─────────────────────────────────────

/// Phase 24 DREAM-01 — return forged_tools rows whose `last_used` is at or
/// before `now - 91 * 86400` seconds. Stale-first ordering for deterministic
/// per-row processing.
///
/// `now_ts` is snapshotted by the caller to avoid mid-loop drift.
pub fn prune_candidate_selection(now_ts: i64) -> Vec<(i64, String, String, i64)> {
    let conn = match crate::tool_forge::open_db_for_lifecycle() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT rowid, name, script_path, last_used \
         FROM forged_tools \
         WHERE last_used IS NOT NULL AND ?1 - last_used >= 91 * 86400 \
         ORDER BY last_used ASC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![now_ts], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    });
    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Phase 24 DREAM-02 — read last-5 trace_hashes per tool, newest first.
pub fn last_5_trace_hashes(tool_name: &str) -> Vec<String> {
    let conn = match crate::tool_forge::open_db_for_lifecycle() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT trace_hash FROM forged_tools_invocations \
         WHERE tool_name = ?1 ORDER BY id DESC LIMIT 5",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![tool_name], |row| row.get::<_, String>(0));
    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

/// Phase 24 DREAM-03 — turn_traces from the last 24h with no forged-tool
/// match and ≥3 tool calls. Returns each turn's tool_names as a parsed
/// `Vec<String>`.
pub fn recent_unmatched_traces(now_ts: i64) -> Vec<Vec<String>> {
    let cutoff = now_ts - 86400;
    let conn = match crate::db::open_db_for_lifecycle() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT tool_names FROM turn_traces \
         WHERE turn_ts >= ?1 AND forged_tool_used IS NULL AND success = 1 \
           AND json_array_length(tool_names) >= 3 \
         ORDER BY turn_ts DESC",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![cutoff], |row| row.get::<_, String>(0));
    let mut out: Vec<Vec<String>> = Vec::new();
    if let Ok(iter) = rows {
        for r in iter.filter_map(|r| r.ok()) {
            if let Ok(parsed) = serde_json::from_str::<Vec<String>>(&r) {
                out.push(parsed);
            }
        }
    }
    out
}

/// Helper used by `deterministic_merge_body` callers — wraps a SELECT
/// against `forged_tools.name`. Returns false on DB-open failure (treats
/// as "name available" — Pitfall 4 mitigation: fail-open during error).
pub fn forged_name_exists(name: &str) -> bool {
    let conn = match crate::tool_forge::open_db_for_lifecycle() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM forged_tools WHERE name = ?1",
            params![name],
            |r| r.get(0),
        )
        .unwrap_or(0);
    count > 0
}

// ── Side-effecting fs helpers ───────────────────────────────────────────────

/// Phase 24 DREAM-01 — archive a forged-tool's filesystem dir from
/// `<user_root>/<sanitized_name>/` to `<user_root>/.archived/<sanitized_name>/`,
/// then DELETE the forged_tools DB row. On filesystem-move failure, the DB
/// row is left intact (will be retried next cycle). On collision in the
/// archive destination, suffix with `_dup<unix_ts>` to preserve both copies.
///
/// Per Pitfall 8 LOCK: only `forged_tools` DB row + `<user_root>/<name>/`
/// directory are touched. `<user_root>/.archived/`'s parent (`brain_skills`,
/// `~/.blade/tools/<name>.<ext>`) are NOT touched.
pub fn archive_skill(name: &str) -> Result<PathBuf, String> {
    let sanitized = crate::skills::export::sanitize_name(name)
        .ok_or_else(|| format!("non-compliant name: {}", name))?;

    let user_root = crate::skills::loader::user_root();
    let src = user_root.join(&sanitized);
    let archived_root = user_root.join(".archived");
    let _ = std::fs::create_dir_all(&archived_root);

    let mut dest = archived_root.join(&sanitized);
    if dest.exists() {
        // Re-archival edge case — suffix with _dup<unix_ts>.
        let ts = chrono::Utc::now().timestamp();
        dest = archived_root.join(format!("{}_dup{}", sanitized, ts));
    }

    if src.exists() {
        std::fs::rename(&src, &dest)
            .map_err(|e| format!("rename {} -> {}: {e}", src.display(), dest.display()))?;
    }
    // DB DELETE — best-effort. If the FS move succeeded but the DB delete
    // fails, the row will be retried next cycle (already in .archived/ so
    // FS path is idempotent via _dup suffix).
    let conn = crate::tool_forge::open_db_for_lifecycle()
        .map_err(|e| format!("open db: {e}"))?;
    conn.execute(
        "DELETE FROM forged_tools WHERE name = ?1",
        params![name],
    )
    .map_err(|e| format!("delete forged_tools row: {e}"))?;

    Ok(dest)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str, desc: &str, script: &str) -> ForgedTool {
        ForgedTool {
            id: format!("id-{}", name),
            name: name.to_string(),
            description: desc.to_string(),
            language: "bash".to_string(),
            script_path: script.to_string(),
            usage: format!("usage of {}", name),
            parameters: vec![ToolParameter {
                name: format!("p_{}", name),
                param_type: "string".to_string(),
                description: "p".to_string(),
                required: true,
            }],
            test_output: format!("test of {}", name),
            created_at: 100,
            last_used: Some(100),
            use_count: 0,
            forged_from: "cap".to_string(),
        }
    }

    #[test]
    fn merge_body_deterministic() {
        let a = fixture("zeta_tool", "alpha desc", "/tmp/a.sh");
        let b = fixture("alpha_tool", "beta desc", "/tmp/b.sh");
        let m = deterministic_merge_body(&a, &b, &|_| false);
        assert!(m.name.starts_with("alpha_tool_merged"), "got {}", m.name);
        // description format is "<a.desc> | <b.desc>" verbatim — order matches arg position.
        assert_eq!(m.description, "alpha desc | beta desc");
        // smaller name's script_path is kept.
        assert_eq!(m.script_path, "/tmp/b.sh");
        assert!(m.test_output.contains("--- merged ---"));
        assert_eq!(m.last_used, Some(m.created_at)); // D-24-A
        assert_eq!(m.use_count, 0);
        assert_eq!(m.forged_from, "merge:zeta_tool+alpha_tool");
    }

    #[test]
    fn merge_body_two_calls_match() {
        let a = fixture("zzz", "d_a", "/a.sh");
        let b = fixture("aaa", "d_b", "/b.sh");
        let m1 = deterministic_merge_body(&a, &b, &|_| false);
        let m2 = deterministic_merge_body(&a, &b, &|_| false);
        // id and timestamps will differ (uuid + Utc::now); content fields must match.
        assert_eq!(m1.name, m2.name);
        assert_eq!(m1.description, m2.description);
        assert_eq!(m1.script_path, m2.script_path);
        assert_eq!(m1.usage, m2.usage);
        assert_eq!(m1.parameters.len(), m2.parameters.len());
        assert_eq!(m1.test_output, m2.test_output);
        assert_eq!(m1.forged_from, m2.forged_from);
    }

    #[test]
    fn merge_name_collision_suffixed_v2() {
        let taken = |n: &str| n == "alpha_tool_merged";
        let result = ensure_unique_name("alpha_tool_merged", &taken);
        assert_eq!(result, "alpha_tool_merged_v2");
    }

    #[test]
    fn merge_name_falls_back_to_uuid_when_999_taken() {
        let taken = |n: &str| {
            if n == "x_merged" { return true; }
            for k in 2..1000 {
                if n == format!("x_merged_v{}", k) { return true; }
            }
            false
        };
        let result = ensure_unique_name("x_merged", &taken);
        assert!(result.starts_with("x_merged_"), "got {}", result);
        assert!(result.len() > "x_merged_".len() + 8, "expected uuid tail; got {}", result);
    }

    #[test]
    fn proposed_name_deterministic() {
        let a = proposed_name_from_trace(&["foo_bar".into(), "baz_qux".into(), "extra_ignored".into()]);
        let b = proposed_name_from_trace(&["foo_bar".into(), "baz_qux".into(), "extra_ignored".into()]);
        assert_eq!(a, b);
        assert!(a.starts_with("auto_"));
        let c = proposed_name_from_trace(&["different".into(), "tool".into(), "names".into()]);
        assert_ne!(a, c);
    }

    #[test]
    fn dedup_lines_preserves_order_unique() {
        let out = dedup_lines("a\nb\na\nc\nb");
        assert_eq!(out, "a\nb\nc");
        // Empty stays empty.
        assert_eq!(dedup_lines(""), "");
    }

    #[test]
    fn union_dedup_by_name_first_wins() {
        let a = vec![
            ToolParameter { name: "x".into(), param_type: "string".into(), description: "first".into(), required: true },
            ToolParameter { name: "y".into(), param_type: "int".into(), description: "y".into(), required: false },
        ];
        let b = vec![
            ToolParameter { name: "x".into(), param_type: "bool".into(), description: "second".into(), required: false },
            ToolParameter { name: "z".into(), param_type: "string".into(), description: "z".into(), required: true },
        ];
        let merged = union_dedup_by_name(&a, &b);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].name, "x");
        assert_eq!(merged[0].description, "first", "first occurrence of x should win");
        assert_eq!(merged[1].name, "y");
        assert_eq!(merged[2].name, "z");
    }

    #[test]
    fn cosine_sim_basic() {
        assert!((cosine_sim(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!((cosine_sim(&[1.0, 0.0], &[0.0, 1.0]) - 0.0).abs() < 1e-6);
        assert_eq!(cosine_sim(&[], &[]), 0.0);
        assert_eq!(cosine_sim(&[1.0], &[1.0, 2.0]), 0.0); // mismatched lengths → 0
    }
}
