//! Phase 58 / MEMORY-SIMPLIFY (v2.2 — 2026-05-14) — integration tests for the
//! BM25 + KG retrieval path that replaced the vector layer.
//!
//! Three scenarios assert the new path's behavior:
//!
//! 1. **bm25_kg_fusion_returns_correct_top_k** — store a small corpus of
//!    distinct facts in `VectorStore` + `kg_nodes`, query for one of them,
//!    confirm the expected fact appears in the top-k results.
//! 2. **typed_category_filtering_narrows_results** — write entries to two
//!    different typed_memory categories, recall by one category, confirm
//!    only that category's entries surface.
//! 3. **cross_session_recall_without_vectors** — simulate a write in one
//!    "session" (one VectorStore instance) and a read in another, confirming
//!    BM25 finds the persisted text without any embedding pipeline.
//!
//! Each test pins `BLADE_CONFIG_DIR` to a `tempfile::TempDir` so the on-disk
//! SQLite state is isolated.
//!
//! Run with: `cargo test --test memory_simplified_integration -- --test-threads=1`
//!
//! The `--test-threads=1` is mandatory because `BLADE_CONFIG_DIR` is a
//! process-global env var.

use blade_lib::embeddings::{
    auto_embed_exchange, recall_relevant, smart_context_recall, SearchResult, SharedVectorStore,
    VectorStore,
};
use blade_lib::knowledge_graph::{add_node, ensure_tables as kg_ensure_tables, KnowledgeNode};
use blade_lib::typed_memory::{
    ensure_table as tm_ensure_table, get_all_typed_memories, get_relevant_memories_for_context,
    recall_by_category, store_typed_memory, MemoryCategory,
};
use std::sync::{Arc, Mutex};

// ─── Test isolation harness ──────────────────────────────────────────────────

/// Pin BLADE_CONFIG_DIR to a fresh tempdir for the duration of the test.
/// Returns the TempDir so the caller can hold ownership and let drop clean up.
fn temp_blade_env() -> tempfile::TempDir {
    let temp = tempfile::tempdir().expect("tempdir");
    std::env::set_var("BLADE_CONFIG_DIR", temp.path());
    // Open the DB so the `vector_entries` table exists. The standard init
    // path runs through blade_lib::db::init_db; we replicate the minimal
    // schema setup the new VectorStore + KG + typed_memory paths need.
    let db_path = temp.path().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).expect("open db");
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS vector_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            embedding BLOB NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'conversation',
            source_id TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS brain_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .expect("base schema");
    // Knowledge graph + typed_memory create their own tables via the public
    // ensure_* helpers — call them so subsequent inserts succeed.
    kg_ensure_tables();
    tm_ensure_table(&conn);
    temp
}

// ─── Test 1 — BM25 + KG fusion returns correct top-K ─────────────────────────

#[test]
fn bm25_kg_fusion_returns_correct_top_k() {
    let _temp = temp_blade_env();

    // Build a fresh VectorStore + seed three distinct facts.
    let store: SharedVectorStore = Arc::new(Mutex::new(VectorStore::new()));
    {
        let mut s = store.lock().unwrap();
        s.add(
            "User runs a 5K every Tuesday morning at the riverside park".to_string(),
            Vec::new(),
            "fact".to_string(),
            "fact_run".to_string(),
        );
        s.add(
            "User strongly prefers Rust over Python for systems programming work".to_string(),
            Vec::new(),
            "fact".to_string(),
            "fact_rust".to_string(),
        );
        s.add(
            "User dislikes deep-dish pizza and prefers Neapolitan style".to_string(),
            Vec::new(),
            "fact".to_string(),
            "fact_pizza".to_string(),
        );
    }

    // Also seed a high-importance KG node so smart_context_recall can find it.
    let _ = add_node(KnowledgeNode {
        id: String::new(),
        concept: "morning_run".to_string(),
        node_type: "routine".to_string(),
        description: "User runs at the riverside park every Tuesday morning".to_string(),
        sources: vec!["test".to_string()],
        importance: 0.9,
        created_at: 0,
        last_updated: 0,
    });

    // Query for the running fact via BM25 — "riverside" is a unique token.
    let results: Vec<SearchResult> = {
        let s = store.lock().unwrap();
        s.hybrid_search(&[], "riverside running", 5)
    };
    assert!(
        !results.is_empty(),
        "BM25 should find a match for 'riverside running' in the seeded corpus"
    );
    assert_eq!(
        results[0].source_id, "fact_run",
        "top-1 BM25 hit should be the running fact, got source_id={}",
        results[0].source_id
    );

    // Query for the Rust fact via a partial token.
    let results: Vec<SearchResult> = {
        let s = store.lock().unwrap();
        s.hybrid_search(&[], "Rust systems programming", 3)
    };
    assert!(
        results.iter().any(|r| r.source_id == "fact_rust"),
        "expected fact_rust in top-3 for 'Rust systems programming'; got {:?}",
        results.iter().map(|r| r.source_id.clone()).collect::<Vec<_>>()
    );

    // recall_relevant — wrapper around hybrid_search — must produce
    // non-empty formatted output for a known-good query.
    let formatted = recall_relevant(&store, "Neapolitan pizza", 3);
    assert!(
        formatted.contains("Neapolitan"),
        "recall_relevant should surface the pizza fact text; got: {}",
        formatted
    );

    // smart_context_recall — KG path — must find the KG node when
    // queried with its description tokens.
    let recall = smart_context_recall("riverside morning run");
    assert!(
        recall.contains("[fact]") || recall.contains("riverside"),
        "smart_context_recall should include a KG fact section; got: {}",
        recall
    );
}

// ─── Test 2 — typed-category filtering narrows results ───────────────────────

#[test]
fn typed_category_filtering_narrows_results() {
    let _temp = temp_blade_env();

    // Store entries across two categories. The `source` field doubles as a
    // context tag that get_relevant_memories_for_context will match against
    // via SQL LIKE.
    let _ = store_typed_memory(
        MemoryCategory::Preference,
        "User prefers dark mode in editor",
        "conversation:editor_ui",
        Some(0.9),
    );
    let _ = store_typed_memory(
        MemoryCategory::Preference,
        "User prefers vim keybindings in editor",
        "conversation:editor_keys",
        Some(0.85),
    );
    let _ = store_typed_memory(
        MemoryCategory::Skill,
        "User can write Rust async code",
        "conversation:rust_async",
        Some(0.95),
    );

    // Recall by category — Preference should return 2 entries, not the Skill one.
    let prefs = recall_by_category(MemoryCategory::Preference, 10);
    assert_eq!(prefs.len(), 2, "expected 2 preference entries, got {}", prefs.len());
    for p in &prefs {
        assert_eq!(p.category.as_str(), "preference");
    }

    // Skill category should return only the rust skill.
    let skills = recall_by_category(MemoryCategory::Skill, 10);
    assert_eq!(skills.len(), 1);
    assert!(skills[0].content.contains("Rust async"));

    // Context-filtered recall: the source field "conversation:editor_*"
    // contains the token "editor" — should hit both preference entries.
    let editor_hits = get_relevant_memories_for_context(&["editor".to_string()], 10);
    assert!(
        editor_hits.iter().any(|m| m.content.contains("dark mode")),
        "editor context should find dark-mode preference"
    );
    assert!(
        editor_hits.iter().any(|m| m.content.contains("vim")),
        "editor context should find vim preference"
    );

    // Sanity check: total count across categories matches what was inserted.
    let all = get_all_typed_memories();
    assert!(all.len() >= 3, "expected at least 3 typed memories total");
}

// ─── Test 3 — cross-session recall without vectors ───────────────────────────

#[test]
fn cross_session_recall_without_vectors() {
    let _temp = temp_blade_env();

    // Session 1: write a conversation exchange via auto_embed_exchange.
    {
        let store: SharedVectorStore = Arc::new(Mutex::new(VectorStore::new()));
        auto_embed_exchange(
            &store,
            "What's the deployment plan for the payments service?",
            "We're shipping the canary on Tuesday at 9am Pacific.",
            "session_1",
        );
        // Confirm it landed locally.
        assert_eq!(store.lock().unwrap().len(), 1);
    }

    // Session 2: open a brand-new VectorStore — it must read from disk.
    let store2: SharedVectorStore = Arc::new(Mutex::new(VectorStore::new()));
    let len = store2.lock().unwrap().len();
    assert!(
        len >= 1,
        "cross-session: new VectorStore should load the persisted exchange; len={}",
        len
    );

    // BM25 query for a unique token from the assistant turn.
    let formatted = recall_relevant(&store2, "canary deployment payments", 3);
    assert!(
        formatted.contains("canary") || formatted.contains("payments"),
        "cross-session BM25 should find the persisted exchange; got: {}",
        formatted
    );

    // And the query path through hybrid_search returns the right source_id.
    let hits: Vec<SearchResult> = {
        let s = store2.lock().unwrap();
        s.hybrid_search(&[], "canary payments Tuesday", 5)
    };
    assert!(
        !hits.is_empty(),
        "BM25 should find at least one hit for cross-session payments query"
    );
    assert_eq!(
        hits[0].source_id, "session_1",
        "top-1 hit should be the session_1 exchange"
    );
}
