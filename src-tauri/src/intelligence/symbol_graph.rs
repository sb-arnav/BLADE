//! INTEL-01 SymbolNode + SymbolKind + edge persistence.
//! Extends knowledge_graph.rs additively via node_type="symbol" and four new
//! relation strings ("calls" | "imports" | "uses_type" | "defines").
//!
//! Schema reuse: writes into the existing `kg_nodes` and `kg_edges` tables
//! (declared in knowledge_graph.rs::ensure_tables). The plan locks the
//! discriminant `node_type = 'symbol'` for all rows produced here. Because
//! `kg_nodes.concept` carries a UNIQUE index, every SymbolNode uses
//! `concept = "sym:{id}"` (the sha256-truncated symbol id) as its concept;
//! the rich payload lives in `description` as JSON.
//!
//! Catch_unwind discipline: every parse_* call inside `reindex_project` is
//! wrapped in `std::panic::catch_unwind(AssertUnwindSafe(...))` per CTX-07
//! fallback discipline (sixth structural application of the v1.1 lesson).
//! Per-file panics log `[INTEL-01]` and skip the file; the walk continues.

use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::tree_sitter_parser::{
    parse_python, parse_rust, parse_typescript, ParsedEdgeKind, ParsedSymbolKind,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SymbolNode {
    pub id: String,
    pub name: String,
    pub kind: SymbolKind,
    pub file_path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub language: String,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Type,
    Module,
    Constant,
}

impl From<ParsedSymbolKind> for SymbolKind {
    fn from(p: ParsedSymbolKind) -> Self {
        match p {
            ParsedSymbolKind::Function => SymbolKind::Function,
            ParsedSymbolKind::Type => SymbolKind::Type,
            ParsedSymbolKind::Module => SymbolKind::Module,
            ParsedSymbolKind::Constant => SymbolKind::Constant,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReindexStats {
    pub files_walked: u32,
    pub files_parsed: u32,
    pub files_skipped: u32,
    pub symbols_inserted: u32,
    pub edges_inserted: u32,
    pub elapsed_ms: u64,
}

/// Compute the deterministic 16-hex-char SymbolNode id.
/// Plan-locked formula: sha256("{file_path}::{name}::{kind:?}")[..8] -> 16 hex.
pub fn symbol_id(file_path: &str, name: &str, kind: SymbolKind) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{file_path}::{name}::{kind:?}").as_bytes());
    let result = hasher.finalize();
    let mut out = String::with_capacity(16);
    for byte in &result[..8] {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

/// Walk `project_root`, parse every supported source file, persist symbols +
/// edges into kg_nodes/kg_edges. Idempotent: deletes prior rows for this
/// project before inserting.
pub fn reindex_project(
    project_root: &Path,
    conn: &Connection,
) -> Result<ReindexStats, String> {
    let start = Instant::now();
    let mut stats = ReindexStats {
        files_walked: 0,
        files_parsed: 0,
        files_skipped: 0,
        symbols_inserted: 0,
        edges_inserted: 0,
        elapsed_ms: 0,
    };

    // Step 1: clear prior symbol rows for this project. Match by JSON-payload
    // file_path prefix so we only delete rows belonging to this project_root.
    let root_str = project_root.to_string_lossy().to_string();
    let like_pat = format!("%\"file_path\":\"{}%", escape_like(&root_str));
    let prior_ids: Vec<String> = conn
        .prepare(
            // HI-03 fix: declare ESCAPE '\' so the backslashes produced by
            // escape_like() actually behave as escapes for `_` / `%` in
            // SQLite. Without this, project paths containing `_`
            // (`my_project`, `node_modules`, `src_tauri`) silently match
            // ZERO rows and orphan kg_nodes survive a reindex.
            "SELECT id FROM kg_nodes WHERE node_type = 'symbol' AND description LIKE ?1 ESCAPE '\\'",
        )
        .map_err(|e| format!("prepare prior-id select: {e}"))?
        .query_map(params![like_pat], |r| r.get::<_, String>(0))
        .map_err(|e| format!("query prior ids: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    if !prior_ids.is_empty() {
        // Delete edges first (foreign-key style integrity even though no FK),
        // then nodes. Use IN-list with parameterized binding.
        for chunk in prior_ids.chunks(256) {
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("?{}", i + 1)).collect();
            let in_list = placeholders.join(",");
            let edge_sql = format!(
                "DELETE FROM kg_edges WHERE from_id IN ({list}) OR to_id IN ({list})",
                list = in_list
            );
            let params_iter: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            conn.execute(&edge_sql, params_iter.as_slice())
                .map_err(|e| format!("delete prior symbol edges: {e}"))?;
            let node_sql = format!(
                "DELETE FROM kg_nodes WHERE id IN ({list})",
                list = in_list
            );
            let params_iter: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            conn.execute(&node_sql, params_iter.as_slice())
                .map_err(|e| format!("delete prior symbol nodes: {e}"))?;
        }
    }

    // Step 2: walk project root.
    let mut files: Vec<PathBuf> = Vec::new();
    walk_dir(project_root, &mut files);
    stats.files_walked = files.len() as u32;

    // Step 3-7: parse + insert.
    for file in files {
        let language = match detect_language(&file) {
            Some(l) => l,
            None => {
                stats.files_skipped += 1;
                continue;
            }
        };
        let content = match std::fs::read_to_string(&file) {
            Ok(c) if c.len() <= 1_000_000 => c,
            _ => {
                stats.files_skipped += 1;
                continue;
            }
        };
        let parse_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            match language {
                "typescript" => parse_typescript(&content),
                "rust" => parse_rust(&content),
                "python" => parse_python(&content),
                _ => Err("unsupported".to_string()),
            }
        }));
        let parsed = match parse_result {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => {
                log::warn!("[INTEL-01] parse error {}: {}", file.display(), e);
                stats.files_skipped += 1;
                continue;
            }
            Err(_) => {
                log::warn!(
                    "[INTEL-01] parser panic on {}; skipping",
                    file.display()
                );
                stats.files_skipped += 1;
                continue;
            }
        };
        stats.files_parsed += 1;

        // Insert SymbolNodes.
        let now = chrono::Utc::now().timestamp();
        let file_str = file.to_string_lossy().to_string();
        let mut file_symbols: Vec<SymbolNode> = Vec::with_capacity(parsed.symbols.len());
        for ps in &parsed.symbols {
            let kind: SymbolKind = ps.kind.into();
            let id = symbol_id(&file_str, &ps.name, kind);
            let node_id = format!("sym:{id}");
            let node = SymbolNode {
                id: node_id.clone(),
                name: ps.name.clone(),
                kind,
                file_path: file_str.clone(),
                line_start: ps.line_start,
                line_end: ps.line_end,
                language: language.to_string(),
                indexed_at: now,
            };
            let payload = serde_json::to_string(&node).unwrap_or_default();
            // Use INSERT OR REPLACE keyed on the unique `concept` (= node_id) —
            // this satisfies the kg_nodes_concept_idx UNIQUE index and yields
            // idempotent re-runs on identical input.
            let res = conn.execute(
                "INSERT OR REPLACE INTO kg_nodes (id, concept, node_type, description, sources, importance, created_at, last_updated) \
                 VALUES (?1, ?2, 'symbol', ?3, '[]', 0.5, ?4, ?4)",
                params![node.id, node.id, payload, now],
            );
            if let Err(e) = res {
                log::warn!("[INTEL-01] insert symbol {}: {}", node.id, e);
                continue;
            }
            stats.symbols_inserted += 1;
            file_symbols.push(node);
        }

        // Resolve + insert edges. v1 strategy:
        //  - from_name resolution: pick the SymbolNode whose [line_start, line_end]
        //    range encloses the edge's source_line. Falls back to "first function
        //    in file" if no enclosing match (good enough for ranking).
        //  - to_name resolution: prefer same-file matches; otherwise drop.
        for edge in parsed.edges {
            let from_node = file_symbols
                .iter()
                .find(|s| {
                    s.kind == SymbolKind::Function
                        && edge.source_line >= s.line_start
                        && edge.source_line <= s.line_end
                })
                .or_else(|| file_symbols.iter().find(|s| s.kind == SymbolKind::Function))
                .cloned();
            let to_node = file_symbols
                .iter()
                .find(|s| s.name == edge.to_name)
                .cloned();
            let (from_id, to_id) = match (&from_node, &to_node) {
                (Some(f), Some(t)) => (f.id.clone(), t.id.clone()),
                _ => continue, // unresolved cross-file or external — drop in v1
            };
            if from_id == to_id {
                // self-loops are rarely useful for PageRank — drop
                continue;
            }
            let relation = match edge.kind {
                ParsedEdgeKind::Calls => "calls",
                ParsedEdgeKind::Imports => "imports",
                ParsedEdgeKind::UsesType => "uses_type",
            };
            let res = conn.execute(
                "INSERT OR IGNORE INTO kg_edges (from_id, to_id, relation, strength, created_at) \
                 VALUES (?1, ?2, ?3, 1.0, ?4)",
                params![from_id, to_id, relation, now],
            );
            if let Ok(rows) = res {
                if rows > 0 {
                    stats.edges_inserted += 1;
                }
            }
        }
    }

    stats.elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(stats)
}

/// Walk a directory recursively, collecting file paths; skips noise dirs.
fn walk_dir(root: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for ent in entries.flatten() {
        let p = ent.path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if matches!(
            name,
            "target" | "node_modules" | ".git" | "dist" | "build" | "out" | ".next" | ".turbo"
        ) {
            continue;
        }
        if p.is_dir() {
            walk_dir(&p, out);
        } else if p.is_file() {
            out.push(p);
        }
    }
}

fn detect_language(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?;
    match ext {
        "ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs" => Some("typescript"),
        "rs" => Some("rust"),
        "py" => Some("python"),
        _ => None,
    }
}

/// Escape SQL LIKE wildcards in the project_root prefix so a project path
/// containing `_` or `%` doesn't match unrelated rows.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // Mirror knowledge_graph.rs::ensure_tables verbatim so the fixture and
        // production schemas stay in lock-step.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS kg_nodes (
                id TEXT PRIMARY KEY,
                concept TEXT NOT NULL,
                node_type TEXT NOT NULL DEFAULT 'concept',
                description TEXT NOT NULL DEFAULT '',
                sources TEXT NOT NULL DEFAULT '[]',
                importance REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                last_updated INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS kg_nodes_concept_idx ON kg_nodes (concept);
            CREATE TABLE IF NOT EXISTS kg_edges (
                from_id TEXT NOT NULL,
                to_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (from_id, to_id, relation)
            );
            CREATE INDEX IF NOT EXISTS kg_edges_from_idx ON kg_edges (from_id);
            CREATE INDEX IF NOT EXISTS kg_edges_to_idx ON kg_edges (to_id);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn phase36_intel_01_symbol_id_is_deterministic() {
        let a = symbol_id("/x/y.rs", "foo", SymbolKind::Function);
        let b = symbol_id("/x/y.rs", "foo", SymbolKind::Function);
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
        // Different kind -> different id
        let c = symbol_id("/x/y.rs", "foo", SymbolKind::Type);
        assert_ne!(a, c);
    }

    #[test]
    fn phase36_intel_01_symbol_graph_persists_to_kg_nodes() {
        let conn = fixture_conn();
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("hello.rs");
        std::fs::write(&f, "fn hello() {}\nfn world() { hello(); }\n").unwrap();
        let stats = reindex_project(dir.path(), &conn).expect("reindex");
        assert!(
            stats.symbols_inserted >= 2,
            "expected >=2 symbols, got {}",
            stats.symbols_inserted
        );
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kg_nodes WHERE node_type = 'symbol'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, stats.symbols_inserted as i64);
        // The world->hello call edge should be present.
        let edge_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kg_edges WHERE relation = 'calls'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(edge_count >= 1, "expected at least 1 calls edge");
    }

    #[test]
    fn phase36_intel_01_reindex_is_idempotent() {
        let conn = fixture_conn();
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.py");
        std::fs::write(&f, "def x():\n    pass\ndef y():\n    x()\n").unwrap();
        let s1 = reindex_project(dir.path(), &conn).unwrap();
        let s2 = reindex_project(dir.path(), &conn).unwrap();
        assert_eq!(
            s1.symbols_inserted, s2.symbols_inserted,
            "idempotent: symbol counts stable"
        );
        // Total rows in kg_nodes should equal s2.symbols_inserted (no leftovers).
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kg_nodes WHERE node_type = 'symbol'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, s2.symbols_inserted as i64);
    }

    #[test]
    fn phase36_intel_01_reindex_path_with_underscore_no_orphan_rows() {
        // HI-03 regression: project path containing `_` MUST round-trip
        // through escape_like + LIKE ESCAPE '\' so a subsequent reindex with
        // a removed file leaves zero stale kg_nodes rows for that file.
        let conn = fixture_conn();
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("my_project_dir");
        std::fs::create_dir_all(&project).unwrap();
        let f1 = project.join("a.rs");
        let f2 = project.join("b.rs");
        std::fs::write(&f1, "fn alpha() {}\nfn beta() { alpha(); }\n").unwrap();
        std::fs::write(&f2, "fn gamma() {}\n").unwrap();
        let s1 = reindex_project(&project, &conn).unwrap();
        assert!(s1.symbols_inserted >= 3, "first reindex should insert symbols");

        // Remove f2 and reindex — its row should be cleaned up by the LIKE ESCAPE clause.
        std::fs::remove_file(&f2).unwrap();
        let s2 = reindex_project(&project, &conn).unwrap();

        // Total rows must equal what reindex inserted (no orphans from f2).
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kg_nodes WHERE node_type = 'symbol'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, s2.symbols_inserted as i64,
            "reindex of project with `_` in path must leave no orphan rows; \
             got count={count}, inserted={}",
            s2.symbols_inserted
        );
    }

    #[test]
    fn phase36_intel_01_escape_like_escapes_underscore_and_percent() {
        // Sanity: escape_like injects `\` before `_`, `%`, `\`.
        assert_eq!(escape_like("my_project"), "my\\_project");
        assert_eq!(escape_like("100%done"), "100\\%done");
        assert_eq!(escape_like("a\\b"), "a\\\\b");
    }

    #[test]
    fn phase36_intel_01_force_parse_error_skips_file_not_crash() {
        use crate::intelligence::tree_sitter_parser::INTEL_FORCE_PARSE_ERROR;
        let conn = fixture_conn();
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.rs");
        std::fs::write(&f, "fn z() {}\n").unwrap();
        INTEL_FORCE_PARSE_ERROR.with(|c| c.set(Some("forced parse err".to_string())));
        let stats = reindex_project(dir.path(), &conn).expect("reindex returns ok despite err");
        INTEL_FORCE_PARSE_ERROR.with(|c| c.set(None));
        assert_eq!(
            stats.files_parsed, 0,
            "force-error should prevent any successful parse"
        );
        assert!(stats.files_skipped >= 1);
        assert_eq!(stats.symbols_inserted, 0);
    }
}
