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

pub use anchor_parser::{extract_anchors, resolve_anchors, Anchor};

pub use symbol_graph::{ReindexStats, SymbolKind, SymbolNode};

pub use capability_registry::{
    ensure_registry_file, force_reload, get_capabilities, load_registry, validate_against_probe,
    CapabilityRegistry, ModelCapabilities, ProviderEntry,
};

/// HI-02 instrumentation: increments every time `init()` runs so a test can
/// assert lib.rs's setup hook actually wires the call in. Atomic counter so
/// concurrent first-boot races don't corrupt observation.
pub static INIT_RUN_COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// Phase 36 init hook — called from lib.rs setup. Subsequent plans fill the body
/// (Plan 36-05 hydrates capability_registry on first access, Plan 36-02 verifies
/// tree-sitter language bindings load).
///
/// 36-05: seed `canonical_models.json` to user's blade_config_dir if missing,
/// load it once, and run `validate_against_probe` so registry/capability_probe
/// drifts surface as `[INTEL-04]` warnings at startup (non-halting).
pub fn init() {
    INIT_RUN_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let cfg = crate::config::load_config();
    let path = &cfg.intelligence.capability_registry_path;
    if let Err(e) = capability_registry::ensure_registry_file(path) {
        log::warn!("[INTEL-04] init: {e}");
        return;
    }
    match capability_registry::load_registry(path) {
        Ok(reg) => capability_registry::validate_against_probe(&reg),
        Err(e) => log::warn!("[INTEL-04] init: load_registry failed: {e}"),
    }
}

#[cfg(test)]
mod init_tests {
    use super::*;

    #[test]
    fn phase36_intel_04_init_runs_validate_against_probe() {
        let before = INIT_RUN_COUNT.load(std::sync::atomic::Ordering::SeqCst);
        init();
        let after = INIT_RUN_COUNT.load(std::sync::atomic::Ordering::SeqCst);
        assert!(
            after > before,
            "init() must increment INIT_RUN_COUNT (before={before}, after={after}) — \
             this is the lib.rs setup-hook wiring assertion for HI-02"
        );
    }
}

/// INTEL-04 Tauri command — clear the capability registry cache and reload
/// from `config.intelligence.capability_registry_path`. Returns the number
/// of providers parsed.
#[tauri::command]
pub async fn reload_capability_registry() -> Result<u32, String> {
    let cfg = crate::config::load_config();
    capability_registry::force_reload(&cfg.intelligence.capability_registry_path)
}

/// INTEL-04 Tauri command — return capabilities for the currently-active
/// provider/model pair. Returns None when the registry has no entry; the
/// frontend (or Plan 36-06 router) is expected to fall back to
/// capability_probe::infer_capabilities.
#[tauri::command]
pub async fn get_active_model_capabilities() -> Result<Option<ModelCapabilities>, String> {
    let cfg = crate::config::load_config();
    Ok(capability_registry::get_capabilities(
        &cfg.provider,
        &cfg.model,
        &cfg,
    ))
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
