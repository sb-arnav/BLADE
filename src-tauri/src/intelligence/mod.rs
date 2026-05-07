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

/// Phase 36 init hook — called from lib.rs setup. Subsequent plans fill the body
/// (Plan 36-05 hydrates capability_registry on first access, Plan 36-02 verifies
/// tree-sitter language bindings load). For 36-01 substrate ship: no-op.
#[allow(dead_code)]
pub fn init() {
    // Plan 36-01 stub. Plans 36-02..36-07 wire concrete init steps as needed.
}
