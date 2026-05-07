//! Phase 36 — Context Intelligence module root.
//!
//! Submodules:
//!   - tree_sitter_parser: INTEL-01 per-language symbol extraction
//!   - symbol_graph: INTEL-01 SQLite extension on knowledge_graph.rs
//!   - pagerank: INTEL-02 personalized PageRank with petgraph
//!   - repo_map: INTEL-03 budget-bounded map builder + brain.rs injection
//!   - capability_registry: INTEL-04 + INTEL-05 canonical_models.json loader
//!   - anchor_parser: INTEL-06 @screen/@file:/@memory: regex extractor
//!
//! Re-exports: public types only; helpers stay submodule-private until needed.
//!
//! Plan 36-01 ships the substrate ONLY (this file + 6 stubs). Plans 36-02
//! through 36-07 fill the bodies with real logic.

pub mod anchor_parser;
pub mod capability_registry;
pub mod pagerank;
pub mod repo_map;
pub mod symbol_graph;
pub mod tree_sitter_parser;

pub use symbol_graph::{ReindexStats, SymbolKind, SymbolNode};

/// Phase 36 init hook — called from lib.rs setup. Subsequent plans fill the body
/// (Plan 36-05 hydrates capability_registry on first access, Plan 36-02 verifies
/// tree-sitter language bindings load). For 36-01 substrate ship: no-op.
#[allow(dead_code)]
pub fn init() {
    // Plan 36-01 stub. Plans 36-02..36-07 wire concrete init steps as needed.
}

/// INTEL-01 Tauri command — re-index the symbol graph for `project_root`.
///
/// Walks the tree, parses every supported source file with tree-sitter, and
/// rewrites the `kg_nodes`/`kg_edges` rows belonging to this project root.
/// Idempotent: running twice on the same tree produces identical row counts.
///
/// Skips when `config.intelligence.tree_sitter_enabled = false` (CTX-07
/// fallback to existing indexer.rs path).
#[tauri::command]
pub async fn reindex_symbol_graph(
    project_root: String,
) -> Result<symbol_graph::ReindexStats, String> {
    let cfg = crate::config::load_config();
    if !cfg.intelligence.tree_sitter_enabled {
        return Err("intelligence.tree_sitter_enabled=false (CTX-07 fallback)".to_string());
    }
    let path = std::path::PathBuf::from(&project_root);
    if !path.exists() {
        return Err(format!("project_root does not exist: {project_root}"));
    }
    // tree-sitter + SQLite IO are CPU/blocking — isolate from the Tauri main
    // thread. knowledge_graph.rs exposes its connection through a global
    // `open_conn()` (db_path() -> blade.db); we mirror that idiom here so the
    // SymbolNode rows land in the same SQLite file as every other KG node.
    tokio::task::spawn_blocking(move || {
        crate::knowledge_graph::ensure_tables();
        let conn = rusqlite::Connection::open(
            crate::config::blade_config_dir().join("blade.db"),
        )
        .map_err(|e| format!("open kg connection: {e}"))?;
        symbol_graph::reindex_project(&path, &conn)
    })
    .await
    .map_err(|e| format!("spawn_blocking join: {e}"))?
}
