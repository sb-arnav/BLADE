---
phase: 16-eval-scaffolding-expansion
plan: 04
type: execute
wave: 2
depends_on: [16-01]
files_modified:
  - src-tauri/src/evals/kg_integrity_eval.rs
autonomous: true
requirements: [EVAL-02]
must_haves:
  truths:
    - "`cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` exits 0"
    - "stdout contains the `┌──` delimiter (EVAL-06 contract)"
    - "Round-trip: 5 nodes inserted via `add_node`, 5 edges via `add_edge`, all retrievable via `get_node` / `get_edges`"
    - "Zero orphans: every node has ≥1 edge"
    - "Idempotent merge: calling `add_node` twice with the same concept returns the same id"
    - "Edge upsert: re-adding the same (from, to, relation) updates strength without duplicating the row"
  artifacts:
    - path: "src-tauri/src/evals/kg_integrity_eval.rs"
      provides: "Knowledge-graph round-trip + integrity eval (5 nodes / 5 edges / orphan-zero / merge / upsert)"
      min_lines: 200
      contains: "fn evaluates_kg_integrity"
  key_links:
    - from: "src-tauri/src/evals/kg_integrity_eval.rs"
      to: "src-tauri/src/knowledge_graph.rs"
      via: "use crate::knowledge_graph::{add_node, add_edge, get_node, get_edges, ensure_tables, KnowledgeNode, KnowledgeEdge}"
      pattern: "use crate::knowledge_graph"
    - from: "src-tauri/src/evals/kg_integrity_eval.rs"
      to: "src-tauri/src/evals/harness.rs"
      via: "use super::harness::{print_eval_table, temp_blade_env, EvalRow}"
      pattern: "use super::harness"
---

<objective>
Replace the Wave 1 stub at `src-tauri/src/evals/kg_integrity_eval.rs` with a NEW knowledge-graph integrity eval. There is no source to relocate — `knowledge_graph.rs` has zero existing inline tests. Pattern borrowed from `capability_probe.rs:305-336` (table-driven mod tests).

Purpose: Prove KG round-trip works end-to-end: nodes inserted via `add_node` come back via `get_node`; edges inserted via `add_edge` come back via `get_edges`; every node has at least one edge (zero orphans); calling `add_node` twice with the same lowercased concept returns the same id (the implicit "consolidate" semantics REQ-02 names — RESEARCH §7 EVAL-02 resolves the missing `consolidate_kg` function via this idempotent-merge path).

Output: A single `.rs` file with `#[test] fn evaluates_kg_integrity` that exercises 5 nodes + 5 edges + 4 integrity dimensions and prints the EVAL-06 scored table. Boolean-style asserts use `rr=1.0/0.0` to fit the harness format uniformly.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md
@.planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md
@.planning/phases/16-eval-scaffolding-expansion/16-VALIDATION.md
@.planning/phases/16-eval-scaffolding-expansion/16-01-harness-PLAN.md
@CLAUDE.md
@src-tauri/src/knowledge_graph.rs
@src-tauri/src/capability_probe.rs

<interfaces>
<!-- From `harness.rs` (Plan 01): -->
```rust
pub fn print_eval_table(title: &str, rows: &[EvalRow]);
pub fn temp_blade_env() -> tempfile::TempDir;
pub struct EvalRow { pub label, pub top1, pub top3, pub rr, pub top3_ids, pub expected, pub relaxed }
```

<!-- From `knowledge_graph.rs` (production, public): -->
```rust
pub struct KnowledgeNode {
    pub id: String,
    pub concept: String,      // normalized concept name (lowercased per knowledge_graph.rs:205)
    pub node_type: String,    // "concept", "person", "project", "technology", "place", "event"
    pub description: String,
    pub sources: Vec<String>,
    pub importance: f32,      // 0.0–1.0
    pub created_at: i64,
    pub last_updated: i64,
}
pub struct KnowledgeEdge {
    pub from_id: String,
    pub to_id: String,
    pub relation: String,     // "is_a", "part_of", "related_to", "depends_on", ...
    pub strength: f32,        // 0.0–1.0
    pub created_at: i64,
}

pub fn ensure_tables();                                         // line 86
pub fn add_node(n: KnowledgeNode) -> Result<String, String>;    // line 200 — returns id; merges on existing concept
pub fn get_node(id: &str) -> Option<KnowledgeNode>;             // line 270
pub fn add_edge(from_id: &str, to_id: &str,
                relation: &str, strength: f32) -> Result<(), String>;  // line 337 — ON CONFLICT DO UPDATE strength
pub fn get_edges(node_id: &str) -> Vec<KnowledgeEdge>;          // line 355 — edges where from_id == node_id OR to_id == node_id
```

<!-- Pattern analog: `capability_probe.rs:305-336` -->
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_record(...) -> ProviderCapabilityRecord {
        ProviderCapabilityRecord { ... }
    }

    #[test]
    fn matrix_anthropic_default() {
        let (v, a, t, lc, ctx) = infer_capabilities(...);
        assert_eq!((v, a, t, lc, ctx), (true, false, true, true, 200_000));
    }
}
```
</interfaces>

<gotchas>
1. **`consolidate_kg` does NOT exist** — verified by RESEARCH §7. REQ-02's "consolidate_kg invoked" wording is satisfied by `add_node`'s built-in idempotent merge (lines 221-248): same concept → same id. Document this resolution in the file header (verbatim from RESEARCH §7).
2. **Concept is normalized to lowercase** (`knowledge_graph.rs:205`) — fixture concepts MUST use lowercase to avoid surprises (e.g. `"blade"` not `"BLADE"`).
3. **`add_node` returns the merged id when concept already exists** — the merge-test must call it twice and assert returned strings are equal.
4. **`add_edge` is `INSERT ... ON CONFLICT DO UPDATE strength`** (line 346) — calling twice with different strengths leaves exactly ONE edge with the second strength. Test for this.
5. **`temp_blade_env()` is mandatory** — `add_node` writes to SQLite (`ensure_tables` at line 86, `db::init_db` at startup). Without temp env, tests pollute each other and the user's real db.
6. **`--test-threads=1` mandatory** — `BLADE_CONFIG_DIR` env var is process-global.
7. **Boolean asserts in EVAL-06 format** — for integrity dimensions (round-trip / orphan-zero / merge / upsert), use `top1=✓ if pass else ✗`, `rr=1.0 if pass else 0.0`, `top3_ids=[]`. The harness format works uniformly.
8. **`ensure_tables()` may need an explicit call** if `db::init_db()` doesn't run KG schema setup. Verify by reading `knowledge_graph.rs:86` and check whether `init_db` calls `ensure_tables`. If not, the eval calls `ensure_tables()` explicitly after `temp_blade_env()`.
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write evals/kg_integrity_eval.rs from scratch (no source to relocate)</name>
  <files>src-tauri/src/evals/kg_integrity_eval.rs (REPLACE Wave 1 stub)</files>

  <read_first>
    - src-tauri/src/knowledge_graph.rs (lines 1-370) — full struct shapes, fn signatures, merge logic at 200-249, edge upsert at 337-355, ensure_tables at 86
    - src-tauri/src/capability_probe.rs (lines 305-336) — table-driven `mod tests` analog (the closest pattern)
    - src-tauri/src/evals/harness.rs (Plan 01 output) — imports
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§5, §7 EVAL-02, §10 R6)
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/kg_integrity_eval.rs", lines 251-343)
  </read_first>

  <action>
**Step 1: Verify the production API surface.** Run:
```bash
grep -nE "pub (fn|struct) (add_node|add_edge|get_node|get_edges|ensure_tables|KnowledgeNode|KnowledgeEdge)" src-tauri/src/knowledge_graph.rs
```
Confirm all 7 items are public. If `ensure_tables` is private (`fn` not `pub fn`), check whether `db::init_db()` triggers it transitively. If not, escalate — the eval needs SQLite tables to exist.

**Step 2: Confirm `add_node` merge semantics by reading `knowledge_graph.rs:200-249`.** The relevant lines:
- Line 205 (or near): `let concept = n.concept.to_lowercase();` — concepts are normalized.
- Line 248 (or near): on conflict, returns the existing node's id and merges sources.

**Step 3: REPLACE the Wave 1 stub at `src-tauri/src/evals/kg_integrity_eval.rs`** with the full eval:

```rust
//! Phase 16 / EVAL-02.
//!
//! Knowledge-graph round-trip + integrity eval. There is no source to
//! relocate — `knowledge_graph.rs` ships zero inline tests as of v1.1.
//! Pattern borrowed from `capability_probe.rs:305-336` (table-driven mod tests).
//!
//! ## REQ-vs-real path resolution
//! REQUIREMENTS.md EVAL-02 names `consolidate_kg` — this function DOES NOT
//! exist (verified via grep). The REQ wording is satisfied by `add_node`'s
//! built-in idempotent-merge path (`knowledge_graph.rs:221-248`): inserting
//! the same lowercased concept twice returns the SAME id and merges sources.
//! See RESEARCH §7 EVAL-02 for the resolution rationale.
//!
//! ## Run
//! `cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, temp_blade_env, EvalRow};
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
        NodeSeed { concept: "blade",       node_type: "project",    importance: 0.95, description: "BLADE — desktop AI agent" },
        NodeSeed { concept: "tauri",       node_type: "technology", importance: 0.80, description: "Cross-platform app framework" },
        NodeSeed { concept: "rust",        node_type: "technology", importance: 0.85, description: "Systems language used in BLADE backend" },
        NodeSeed { concept: "arnav",       node_type: "person",     importance: 0.90, description: "Project owner" },
        NodeSeed { concept: "jarvis demo", node_type: "event",      importance: 0.70, description: "v1.2 milestone demo target" },
    ]
}

fn edge_seeds() -> Vec<EdgeSeed> {
    vec![
        EdgeSeed { from_concept: "blade",       to_concept: "tauri",       relation: "depends_on", strength: 0.9 },
        EdgeSeed { from_concept: "blade",       to_concept: "rust",        relation: "depends_on", strength: 0.95 },
        EdgeSeed { from_concept: "tauri",       to_concept: "rust",        relation: "depends_on", strength: 0.7 },
        EdgeSeed { from_concept: "arnav",       to_concept: "blade",       relation: "related_to", strength: 1.0 },
        EdgeSeed { from_concept: "jarvis demo", to_concept: "blade",       relation: "part_of",    strength: 0.85 },
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

// Boolean → EvalRow helper. rr=1.0 on pass, 0.0 on fail; degenerate top3_ids/expected
// keep the harness format uniform for boolean integrity asserts.
fn bool_row(label: &str, pass: bool, expected: &str) -> EvalRow {
    EvalRow {
        label: label.to_string(),
        top1: pass,
        top3: pass,
        rr: if pass { 1.0 } else { 0.0 },
        top3_ids: if pass { vec![expected.to_string()] } else { vec![] },
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
    ensure_tables(); // explicit — db::init_db may not call this

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
            Some(n) => n.concept == seed.concept, // concept preserved
            None => false,
        }
    });
    rows.push(bool_row("round_trip_5_nodes", all_round_trip, "all_nodes_resolvable"));

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
    rows.push(bool_row("edge_endpoints_resolve", all_endpoints_resolve, "no_dangling_endpoints"));

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
    rows.push(bool_row("idempotent_merge_returns_same_id", merge_idempotent, &original_id));

    // ── Edge upsert: re-add same (from, to, relation) with new strength; row count unchanged ─
    let blade_id = id_map.get("blade").unwrap();
    let tauri_id = id_map.get("tauri").unwrap();
    let edges_before = get_edges(blade_id);
    let depends_on_count_before = edges_before.iter().filter(|e| {
        e.from_id == *blade_id && e.to_id == *tauri_id && e.relation == "depends_on"
    }).count();
    add_edge(blade_id, tauri_id, "depends_on", 0.55).expect("upsert ok");
    let edges_after = get_edges(blade_id);
    let depends_on_count_after = edges_after.iter().filter(|e| {
        e.from_id == *blade_id && e.to_id == *tauri_id && e.relation == "depends_on"
    }).count();
    let new_strength = edges_after.iter().find(|e| {
        e.from_id == *blade_id && e.to_id == *tauri_id && e.relation == "depends_on"
    }).map(|e| e.strength).unwrap_or(-1.0);
    let edge_upsert_pass =
        depends_on_count_before == 1
        && depends_on_count_after == 1
        && (new_strength - 0.55).abs() < 0.0001;
    rows.push(bool_row("edge_upsert_no_dup", edge_upsert_pass, "single_edge_strength_0.55"));

    print_eval_table("Knowledge graph integrity eval", &rows);

    // ── Floor: all 5 dimensions must pass ────────────────────────────
    assert!(all_round_trip, "round-trip failed: not every node resolves via get_node");
    assert!(all_endpoints_resolve, "edge endpoints failed to resolve via get_node");
    assert!(no_orphans, "orphan detection: at least one node has zero edges");
    assert!(merge_idempotent, "idempotent merge: re-adding 'blade' produced a different id ({} vs {})", merged_id, original_id);
    assert!(
        edge_upsert_pass,
        "edge upsert: count_before={} count_after={} new_strength={}",
        depends_on_count_before, depends_on_count_after, new_strength,
    );
}
```

**Step 4: Verify `chrono` is available** — run `grep -q "chrono" src-tauri/Cargo.toml` to confirm the crate is in deps. If not, the eval can use `std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64` instead. (Per `knowledge_graph.rs`, chrono is used elsewhere — should be available.)

**Step 5: Compile + run:**
```bash
cd src-tauri && cargo test --lib evals::kg_integrity_eval --no-run --test-threads=1 2>&1 | tail -10
cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1 2>&1 | tail -25
```
Expected: scored table opens with `┌── Knowledge graph integrity eval ──`, 5 rows (round_trip_5_nodes, edge_endpoints_resolve, orphan_zero, idempotent_merge_returns_same_id, edge_upsert_no_dup), each row top1=✓ rr=1.00, summary `top-1: 5/5 (100%)  top-3: 5/5 (100%)  MRR: 1.000`, exit 0.

If `add_node` panics on the "id: String::new()" pattern (e.g. "id required"), check `knowledge_graph.rs:200-249` for whether the merge logic accepts empty id. If it requires a UUID upfront, generate one with `uuid::Uuid::new_v4().to_string()` before calling `add_node`.
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/kg_integrity_eval.rs` exits 0
- File is no longer the Wave 1 stub: `wc -l src-tauri/src/evals/kg_integrity_eval.rs` ≥ 200
- `grep -q "use super::harness" src-tauri/src/evals/kg_integrity_eval.rs` exits 0
- `grep -q "use crate::knowledge_graph" src-tauri/src/evals/kg_integrity_eval.rs` exits 0
- `grep -q "fn evaluates_kg_integrity" src-tauri/src/evals/kg_integrity_eval.rs` exits 0
- `grep -q "consolidate_kg" src-tauri/src/evals/kg_integrity_eval.rs` exits 0 (the doc-comment names it explicitly to document the REQ-vs-real resolution)
- File contains zero `todo!()` markers — `! grep -q "todo!" src-tauri/src/evals/kg_integrity_eval.rs`
- `cd src-tauri && cargo test --lib evals::kg_integrity_eval --no-run --test-threads=1` exits 0
- `cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` exits 0
- Stdout contains `┌── Knowledge graph integrity eval ──` — the EVAL-06 contract
- Stdout shows MRR: 1.000 (all integrity dimensions pass) — `... | grep -E "MRR: 1\.000"`
- Stdout includes 5 row labels: `round_trip_5_nodes`, `edge_endpoints_resolve`, `orphan_zero`, `idempotent_merge_returns_same_id`, `edge_upsert_no_dup`
  </acceptance_criteria>

  <verify>
    <automated>cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1 2>&1 | tee /tmp/16-04-out.log | tail -20 && grep -q '┌── Knowledge graph integrity eval' /tmp/16-04-out.log && grep -q "MRR: 1\.000" /tmp/16-04-out.log && ! grep -q "todo!" src-tauri/src/evals/kg_integrity_eval.rs</automated>
  </verify>

  <done>`evals/kg_integrity_eval.rs` is fully populated; cargo exits 0; stdout carries the `┌──` table with 5 integrity rows; all 5 dimensions pass (MRR 1.000); the doc header documents the REQ-vs-real resolution for `consolidate_kg`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none in this plan) | All test fixtures are synthetic; SQLite calls are scoped to a `tempfile::TempDir`. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-04-01 | I (Information disclosure) | Fixture node "arnav" / "blade" / "jarvis demo" | accept | Public-knowledge tokens (project name + visible-in-repo identifiers). No PII exposure. |
| T-16-04-02 | T (Tampering) | KG schema drift could break `add_node` merge semantics silently | mitigate | This eval IS the regression test that catches such drift. Idempotent-merge assert fires if the merge contract is broken. |
| T-16-04-03 | E (Elevation of privilege) | None — no auth surface in this eval | n/a | n/a |

**Severity rollup:** all LOW. The eval is a defensive regression gate; it does not introduce new exposure beyond temp-file write + SQLite-init which already exist in the embeddings evals.
</threat_model>

<verification>
After the 1 task completes:

```bash
cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1 2>&1 | tail -20
# Expected:
# ┌── Knowledge graph integrity eval ──
# │ round_trip_5_nodes                top1=✓ top3=✓ rr=1.00 → top3=["all_nodes_resolvable"] (want=all_nodes_resolvable)
# │ edge_endpoints_resolve            top1=✓ top3=✓ rr=1.00 → top3=["no_dangling_endpoints"] (want=no_dangling_endpoints)
# │ orphan_zero                       top1=✓ top3=✓ rr=1.00 → top3=["every_node_has_edge"] (want=every_node_has_edge)
# │ idempotent_merge_returns_same_id  top1=✓ top3=✓ rr=1.00 → top3=["<uuid>"] (want=<uuid>)
# │ edge_upsert_no_dup                top1=✓ top3=✓ rr=1.00 → top3=["single_edge_strength_0.55"] (want=...)
# ├─────────────────────────────────────────────────────────
# │ top-1: 5/5 (100%)  top-3: 5/5 (100%)  MRR: 1.000
# └─────────────────────────────────────────────────────────
# test result: ok. 1 passed; 0 failed
```
</verification>

<success_criteria>
1. `evals/kg_integrity_eval.rs` is fully populated (no stub, no `todo!()`)
2. `cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` exits 0
3. Stdout carries `┌──` opening (EVAL-06 contract)
4. All 5 integrity dimensions pass (round-trip, endpoints, orphan-zero, idempotent merge, edge upsert)
5. The doc-comment header documents the `consolidate_kg` REQ-vs-real resolution
6. EVAL-02 requirement satisfied
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-04-SUMMARY.md` documenting:
- File created (was a Wave 1 stub)
- The 5 integrity dimensions tested and their pass/fail status
- The `consolidate_kg` resolution (file header documents this)
- Cargo command + exit code
</output>
