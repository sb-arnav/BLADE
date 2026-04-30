//! Phase 16 / EVAL-02.
//!
//! Knowledge-graph round-trip + integrity eval. There is no source to
//! relocate — `knowledge_graph.rs` ships zero inline tests as of v1.1.
//! Pattern borrowed from `capability_probe.rs:305-336` (table-driven mod tests).
//!
//! ## REQ-vs-real path resolution
//! REQUIREMENTS.md EVAL-02 names `consolidate_kg` — this function DOES NOT
//! exist (verified via grep across `src-tauri/src/`). The REQ wording is
//! satisfied by `add_node`'s built-in idempotent-merge path
//! (`knowledge_graph.rs:221-248`): inserting the same lowercased concept
//! twice returns the SAME id and merges sources. See RESEARCH §7 EVAL-02
//! for the resolution rationale. No re-export added — the eval exercises
//! the real merge surface that ships in production today.
//!
//! ## Run
//! `cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1`
//!
//! ## Floor
//! All 5 integrity dimensions must pass (round-trip / endpoints-resolve /
//! orphan-zero / idempotent-merge / edge-upsert). Any failure = regression
//! in the KG storage contract.

use super::harness::{print_eval_table, summarize, temp_blade_env, EvalRow};
use crate::knowledge_graph::{
    add_edge, add_node, ensure_tables, get_edges, get_node, KnowledgeNode,
};

// ────────────────────────────────────────────────────────────
// Fixture corpus — 5 nodes + 5 edges (per RESEARCH §7 EVAL-02)
// ────────────────────────────────────────────────────────────

struct NodeSeed {
    concept: &'static str,
    node_type: &'static str,
    importance: f32,
    description: &'static str,
}

struct EdgeSeed {
    from_concept: &'static str,
    to_concept: &'static str,
    relation: &'static str,
    strength: f32,
}

fn node_seeds() -> Vec<NodeSeed> {
    vec![
        NodeSeed {
            concept: "blade",
            node_type: "project",
            importance: 0.95,
            description: "BLADE — desktop AI agent",
        },
        NodeSeed {
            concept: "tauri",
            node_type: "technology",
            importance: 0.80,
            description: "Cross-platform app framework",
        },
        NodeSeed {
            concept: "rust",
            node_type: "technology",
            importance: 0.85,
            description: "Systems language used in BLADE backend",
        },
        NodeSeed {
            concept: "arnav",
            node_type: "person",
            importance: 0.90,
            description: "Project owner",
        },
        NodeSeed {
            concept: "jarvis demo",
            node_type: "event",
            importance: 0.70,
            description: "v1.2 milestone demo target",
        },
    ]
}

fn edge_seeds() -> Vec<EdgeSeed> {
    vec![
        EdgeSeed {
            from_concept: "blade",
            to_concept: "tauri",
            relation: "depends_on",
            strength: 0.9,
        },
        EdgeSeed {
            from_concept: "blade",
            to_concept: "rust",
            relation: "depends_on",
            strength: 0.95,
        },
        EdgeSeed {
            from_concept: "tauri",
            to_concept: "rust",
            relation: "depends_on",
            strength: 0.7,
        },
        EdgeSeed {
            from_concept: "arnav",
            to_concept: "blade",
            relation: "related_to",
            strength: 1.0,
        },
        EdgeSeed {
            from_concept: "jarvis demo",
            to_concept: "blade",
            relation: "part_of",
            strength: 0.85,
        },
    ]
}

fn make_node(seed: &NodeSeed) -> KnowledgeNode {
    let now = chrono::Utc::now().timestamp();
    KnowledgeNode {
        id: String::new(), // empty → add_node assigns UUID
        concept: seed.concept.to_string(),
        node_type: seed.node_type.to_string(),
        description: seed.description.to_string(),
        sources: vec!["test_kg_fixture".to_string()],
        importance: seed.importance,
        created_at: now,
        last_updated: now,
    }
}

/// Boolean → `EvalRow` helper. `rr=1.0` on pass, `0.0` on fail; degenerate
/// `top3_ids` / `expected` keep the harness format uniform for boolean
/// integrity asserts (the same scored-table opens with `┌──` for the
/// EVAL-06 grep gate regardless of metric type).
fn bool_row(label: &str, pass: bool, expected: &str) -> EvalRow {
    EvalRow {
        label: label.to_string(),
        top1: pass,
        top3: pass,
        rr: if pass { 1.0 } else { 0.0 },
        top3_ids: if pass {
            vec![expected.to_string()]
        } else {
            vec![]
        },
        expected: expected.to_string(),
        relaxed: false,
    }
}

// ────────────────────────────────────────────────────────────
// Test
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_kg_integrity() {
    let _temp = temp_blade_env();
    ensure_tables(); // explicit — `db::init_db` may not include KG schema setup

    let mut rows: Vec<EvalRow> = Vec::new();

    // ── Insert 5 nodes; collect concept → id map ─────────────────────
    let mut id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let seeds = node_seeds();
    for seed in &seeds {
        let id = add_node(make_node(seed)).expect("add_node ok");
        id_map.insert(seed.concept.to_string(), id);
    }

    // ── Round-trip dimension: get_node returns Some for every inserted id ─
    let all_round_trip = seeds.iter().all(|seed| {
        let id = id_map.get(seed.concept).expect("id present");
        match get_node(id) {
            Some(n) => n.concept == seed.concept, // concept preserved (already lowercase)
            None => false,
        }
    });
    rows.push(bool_row(
        "round_trip_5_nodes",
        all_round_trip,
        "all_nodes_resolvable",
    ));

    // ── Insert 5 edges using resolved ids ────────────────────────────
    for e in edge_seeds() {
        let from_id = id_map.get(e.from_concept).expect("from id");
        let to_id = id_map.get(e.to_concept).expect("to id");
        add_edge(from_id, to_id, e.relation, e.strength).expect("add_edge ok");
    }

    // ── Edge endpoints all resolve via get_node ──────────────────────
    let all_endpoints_resolve = edge_seeds().iter().all(|e| {
        let from_id = id_map.get(e.from_concept).unwrap();
        let to_id = id_map.get(e.to_concept).unwrap();
        get_node(from_id).is_some() && get_node(to_id).is_some()
    });
    rows.push(bool_row(
        "edge_endpoints_resolve",
        all_endpoints_resolve,
        "no_dangling_endpoints",
    ));

    // ── Orphan-zero: every node has ≥1 edge ─────────────────────────
    let no_orphans = seeds.iter().all(|seed| {
        let id = id_map.get(seed.concept).unwrap();
        !get_edges(id).is_empty()
    });
    rows.push(bool_row("orphan_zero", no_orphans, "every_node_has_edge"));

    // ── Idempotent merge: re-add "blade" with extra source; expect same id ─
    let re_add = KnowledgeNode {
        id: String::new(),
        concept: "blade".to_string(),
        node_type: "project".to_string(),
        description: "BLADE — desktop AI agent (re-add)".to_string(),
        sources: vec!["test_kg_fixture_v2".to_string()],
        importance: 0.96,
        created_at: chrono::Utc::now().timestamp(),
        last_updated: chrono::Utc::now().timestamp(),
    };
    let original_id = id_map.get("blade").unwrap().clone();
    let merged_id = add_node(re_add).expect("re-add merge ok");
    let merge_idempotent = merged_id == original_id;
    rows.push(bool_row(
        "idempotent_merge_returns_same_id",
        merge_idempotent,
        &original_id,
    ));

    // ── Edge upsert: re-add same (from, to, relation) with new strength;
    //    row count unchanged, strength updated to new value ──────────
    let blade_id = id_map.get("blade").unwrap();
    let tauri_id = id_map.get("tauri").unwrap();
    let edges_before = get_edges(blade_id);
    let depends_on_count_before = edges_before
        .iter()
        .filter(|e| e.from_id == *blade_id && e.to_id == *tauri_id && e.relation == "depends_on")
        .count();
    add_edge(blade_id, tauri_id, "depends_on", 0.55).expect("upsert ok");
    let edges_after = get_edges(blade_id);
    let depends_on_count_after = edges_after
        .iter()
        .filter(|e| e.from_id == *blade_id && e.to_id == *tauri_id && e.relation == "depends_on")
        .count();
    let new_strength = edges_after
        .iter()
        .find(|e| e.from_id == *blade_id && e.to_id == *tauri_id && e.relation == "depends_on")
        .map(|e| e.strength)
        .unwrap_or(-1.0);
    let edge_upsert_pass = depends_on_count_before == 1
        && depends_on_count_after == 1
        && (new_strength - 0.55).abs() < 0.0001;
    rows.push(bool_row(
        "edge_upsert_no_dup",
        edge_upsert_pass,
        "single_edge_strength_0.55",
    ));

    print_eval_table("Knowledge graph integrity eval", &rows);

    // Phase 17 / DOCTOR-02: record this run to history.jsonl BEFORE asserts.
    // KG eval is "all 5 dimensions must pass" — the bool_row helper sets
    // top1=top3=true on pass, so asserted_top1_count == asserted_total iff
    // every dimension passed (matches the union of the 5 asserts below).
    let s = summarize(&rows);
    let floor_passed = s.asserted_total > 0 && s.asserted_top1_count == s.asserted_total;
    super::harness::record_eval_run("kg_integrity_eval", &s, floor_passed);

    // ── Floor: all 5 dimensions must pass ────────────────────────────
    assert!(
        all_round_trip,
        "round-trip failed: not every node resolves via get_node"
    );
    assert!(
        all_endpoints_resolve,
        "edge endpoints failed to resolve via get_node"
    );
    assert!(
        no_orphans,
        "orphan detection: at least one node has zero edges"
    );
    assert!(
        merge_idempotent,
        "idempotent merge: re-adding 'blade' produced a different id ({} vs {})",
        merged_id, original_id
    );
    assert!(
        edge_upsert_pass,
        "edge upsert: count_before={} count_after={} new_strength={}",
        depends_on_count_before, depends_on_count_after, new_strength,
    );
}
