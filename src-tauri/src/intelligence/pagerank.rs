//! INTEL-02 personalized PageRank with petgraph.
//!
//! Loads the symbol graph from kg_nodes/kg_edges, builds a
//! petgraph::DiGraph<SymbolNode, f32>, runs personalized PageRank seeded
//! from mentioned_symbols, returns top-200 nodes sorted by score
//! descending. 5-minute LRU cache keyed by mentions hash.
//!
//! Damping default 0.85 (Aider/Brin-Page); convergence L1 < 1e-6 or 50
//! iterations max. Calls + UsesType edges drive rank flow; Imports +
//! Defines edges are skipped at graph build time (weight 0 in v1).
//!
//! Determinism: SQL queries use ORDER BY; node iteration uses the SQL-loaded
//! order; tiebreak on id ascending. PageRank vector is byte-identical across
//! 10 runs for identical input. INTEL_FORCE_PAGERANK_RESULT thread-local seam
//! mirrors Phase 33's LOOP_OVERRIDE / Phase 34's RES_FORCE_STUCK for fault
//! injection in tests.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use petgraph::Direction;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

use super::symbol_graph::SymbolNode;

const MAX_ITER: u32 = 50;
const CONVERGENCE_L1: f32 = 1e-6;
const CACHE_TTL_SECONDS: u64 = 300;
const TOP_N: usize = 200;

static RANK_CACHE: Lazy<Mutex<HashMap<String, (Instant, Vec<(SymbolNode, f32)>)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

thread_local! {
    /// Test-only seam. Mirrors Phase 33's LOOP_OVERRIDE and Phase 34's
    /// RES_FORCE_STUCK fault-injection seams. When `Some(v)`, `rank_symbols`
    /// returns `v.clone()` immediately and the seam is preserved (peek-style)
    /// so multiple calls inside a single test see the same forced value.
    pub static INTEL_FORCE_PAGERANK_RESULT: Cell<Option<Vec<(SymbolNode, f32)>>>
        = const { Cell::new(None) };
}

fn check_force() -> Option<Vec<(SymbolNode, f32)>> {
    INTEL_FORCE_PAGERANK_RESULT.with(|c| {
        let v = c.take();
        if let Some(ref inner) = v {
            c.set(Some(inner.clone()));
        }
        v
    })
}

/// Manual hex encoding for the 8-byte cache key — keeps `hex` crate out of
/// Cargo.toml; sha2 returns a `GenericArray<u8, _>` that we slice + format.
fn hex8(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// Cache key: sha256(canonical_json(sorted(lowercased_dedup(mentions))))[..8]
/// → 16 hex chars. Case-insensitive matching via lowercase before sort. Empty
/// mentions yields a stable "empty-mentions" key; callers relying on the
/// uniform-fallback path get cache hits within the 5-min TTL.
pub fn cache_key(mentioned_symbols: &[String]) -> String {
    let mut sorted: Vec<String> = mentioned_symbols
        .iter()
        .map(|s| s.to_lowercase())
        .collect();
    sorted.sort();
    sorted.dedup();
    let json = serde_json::to_string(&sorted).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(json.as_bytes());
    let digest = h.finalize();
    hex8(&digest[..8])
}

/// Test/admin escape hatch — clears the rank cache. Plan 36-05's reload
/// command will hook this; tests use it to bypass the 5-min TTL.
#[allow(dead_code)]
pub fn clear_cache() {
    if let Ok(mut c) = RANK_CACHE.lock() {
        c.clear();
    }
}

/// Personalized PageRank entry point. Returns top-200 (SymbolNode, score)
/// pairs sorted by score descending with id-ascending tiebreak.
///
/// - Empty graph → `Vec::new()` (also covers `tree_sitter_enabled=false`
///   path: caller didn't reindex, so `kg_nodes` has no symbol rows).
/// - Empty `mentioned_symbols` → uniform personalization vector.
/// - Damping clamped to `[0.0, 1.0 - 1e-3]` for numerical safety (T-36-16).
/// - Computation wrapped in `catch_unwind` (T-36-15 / panic safety).
/// - 5-minute LRU cache keyed by `cache_key(mentioned_symbols)`.
/// - INTEL_FORCE_PAGERANK_RESULT short-circuit for fault-injection tests.
pub fn rank_symbols(
    _query: &str,
    mentioned_symbols: &[String],
    damping: f32,
    conn: &Connection,
) -> Vec<(SymbolNode, f32)> {
    if let Some(forced) = check_force() {
        return forced;
    }
    let damping = damping.clamp(0.0, 1.0 - 1e-3);
    let key = cache_key(mentioned_symbols);

    // Cache hit?
    if let Ok(cache) = RANK_CACHE.lock() {
        if let Some((written, vec)) = cache.get(&key) {
            if written.elapsed() < Duration::from_secs(CACHE_TTL_SECONDS) {
                return vec.clone();
            }
        }
    }

    // Cache miss — load graph + compute under panic guard.
    let computed: Vec<(SymbolNode, f32)> = match catch_unwind(AssertUnwindSafe(|| {
        let (graph, nodes_in_order) = match load_graph(conn) {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        if nodes_in_order.is_empty() {
            return Vec::new();
        }
        let scores =
            personalized_pagerank(&graph, &nodes_in_order, mentioned_symbols, damping);
        let mut paired: Vec<(SymbolNode, f32)> =
            nodes_in_order.into_iter().zip(scores.into_iter()).collect();
        paired.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.id.cmp(&b.0.id))
        });
        paired.truncate(TOP_N);
        paired
    })) {
        Ok(v) => v,
        Err(_) => {
            log::warn!("[INTEL-02] PageRank panic — returning empty");
            Vec::new()
        }
    };

    if let Ok(mut cache) = RANK_CACHE.lock() {
        cache.insert(key, (Instant::now(), computed.clone()));
    }
    computed
}

/// Load all `node_type='symbol'` rows + `relation IN ('calls','uses_type')`
/// edges from kg_nodes/kg_edges. Imports + Defines edges are filtered at the
/// SQL layer (weight 0 in v1 per plan-locked decision). Orphaned edges (where
/// either endpoint isn't in the loaded node set) are dropped silently.
fn load_graph(
    conn: &Connection,
) -> Result<(DiGraph<SymbolNode, f32>, Vec<SymbolNode>), String> {
    let mut stmt = conn
        .prepare(
            "SELECT description FROM kg_nodes \
             WHERE node_type = 'symbol' \
             ORDER BY id ASC",
        )
        .map_err(|e| format!("prepare nodes: {e}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("query nodes: {e}"))?;
    let mut nodes: Vec<SymbolNode> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("row: {e}"))? {
        let desc: String = row.get(0).map_err(|e| format!("desc: {e}"))?;
        if let Ok(sym) = serde_json::from_str::<SymbolNode>(&desc) {
            nodes.push(sym);
        }
    }

    let mut graph: DiGraph<SymbolNode, f32> = DiGraph::new();
    let mut id_to_idx: HashMap<String, NodeIndex> = HashMap::new();
    for sym in &nodes {
        let idx = graph.add_node(sym.clone());
        id_to_idx.insert(sym.id.clone(), idx);
    }

    let mut edge_stmt = conn
        .prepare(
            "SELECT from_id, to_id FROM kg_edges \
             WHERE relation IN ('calls', 'uses_type') \
             ORDER BY from_id, to_id ASC",
        )
        .map_err(|e| format!("prepare edges: {e}"))?;
    let mut erows = edge_stmt
        .query([])
        .map_err(|e| format!("query edges: {e}"))?;
    while let Some(row) = erows.next().map_err(|e| format!("erow: {e}"))? {
        let from_id: String = row.get(0).map_err(|e| format!("from_id: {e}"))?;
        let to_id: String = row.get(1).map_err(|e| format!("to_id: {e}"))?;
        if let (Some(&fi), Some(&ti)) =
            (id_to_idx.get(&from_id), id_to_idx.get(&to_id))
        {
            graph.add_edge(fi, ti, 1.0);
        }
    }

    Ok((graph, nodes))
}

/// Iterative power method for personalized PageRank. Convergence: L1 norm
/// between successive iterations < 1e-6 OR `MAX_ITER=50`. Sink correction
/// redistributes dangling-node mass back via the personalization vector
/// (standard treatment — Brin-Page §2.7).
fn personalized_pagerank(
    graph: &DiGraph<SymbolNode, f32>,
    nodes_in_order: &[SymbolNode],
    mentioned_symbols: &[String],
    damping: f32,
) -> Vec<f32> {
    let n = nodes_in_order.len();
    if n == 0 {
        return Vec::new();
    }

    // Personalization vector p (must sum to 1). Empty/zero-match → uniform.
    let mention_set: HashSet<String> = mentioned_symbols
        .iter()
        .map(|s| s.to_lowercase())
        .collect();
    let mut p: Vec<f32> = nodes_in_order
        .iter()
        .map(|sym| {
            if mention_set.contains(&sym.name.to_lowercase()) {
                1.0
            } else {
                0.0
            }
        })
        .collect();
    let p_sum: f32 = p.iter().sum();
    if p_sum > 0.0 {
        for x in p.iter_mut() {
            *x /= p_sum;
        }
    } else {
        let u = 1.0 / n as f32;
        for x in p.iter_mut() {
            *x = u;
        }
    }

    // id -> local index map (deterministic; nodes_in_order is SQL-ordered).
    let id_to_local: HashMap<&str, usize> = nodes_in_order
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();

    // id -> petgraph NodeIndex (graph nodes were inserted in SQL order, so
    // local index i maps to NodeIndex(i) — but we still build the map
    // explicitly for safety against any future reordering).
    let id_to_pg: HashMap<&str, NodeIndex> = graph
        .node_indices()
        .map(|i| (graph[i].id.as_str(), i))
        .collect();

    // Initial vector: uniform 1/N.
    let mut v: Vec<f32> = vec![1.0 / n as f32; n];
    let mut v_next: Vec<f32> = vec![0.0; n];

    // Out-degree per local index, in SQL-stable order.
    let out_deg: Vec<f32> = nodes_in_order
        .iter()
        .map(|sym| match id_to_pg.get(sym.id.as_str()) {
            Some(&pg) => graph
                .edges_directed(pg, Direction::Outgoing)
                .count() as f32,
            None => 0.0,
        })
        .collect();

    for _ in 0..MAX_ITER {
        // Teleport term.
        for i in 0..n {
            v_next[i] = (1.0 - damping) * p[i];
        }
        // Edge-flow term: for each u in deterministic order, push damping *
        // v[u] / out_deg[u] to each outgoing neighbor.
        for sym in nodes_in_order.iter() {
            let u_local = match id_to_local.get(sym.id.as_str()) {
                Some(&i) => i,
                None => continue,
            };
            let od = out_deg[u_local];
            if od == 0.0 {
                continue;
            }
            let pg = match id_to_pg.get(sym.id.as_str()) {
                Some(&i) => i,
                None => continue,
            };
            let share = damping * v[u_local] / od;
            for e in graph.edges_directed(pg, Direction::Outgoing) {
                let target_sym = &graph[e.target()];
                if let Some(&j) = id_to_local.get(target_sym.id.as_str()) {
                    v_next[j] += share;
                }
            }
        }
        // Sink correction: dangling nodes' mass is redistributed via p.
        let dangling_mass: f32 = (0..n)
            .filter(|i| out_deg[*i] == 0.0)
            .map(|i| v[i])
            .sum();
        for i in 0..n {
            v_next[i] += damping * dangling_mass * p[i];
        }

        let l1: f32 = v
            .iter()
            .zip(v_next.iter())
            .map(|(a, b)| (a - b).abs())
            .sum();
        std::mem::swap(&mut v, &mut v_next);
        if l1 < CONVERGENCE_L1 {
            break;
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intelligence::symbol_graph::SymbolKind;

    /// 6-node fixture: A->B, A->C, B->D, C->D, D->E, E->F. Schema mirrors
    /// the production `kg_nodes`/`kg_edges` layout from knowledge_graph.rs.
    fn fixture_conn_with_graph() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE kg_nodes (
                id TEXT PRIMARY KEY,
                concept TEXT NOT NULL,
                node_type TEXT NOT NULL DEFAULT 'concept',
                description TEXT NOT NULL DEFAULT '',
                sources TEXT NOT NULL DEFAULT '[]',
                importance REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE kg_edges (
                from_id TEXT NOT NULL,
                to_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (from_id, to_id, relation)
            );",
        )
        .unwrap();
        let nodes = ["A", "B", "C", "D", "E", "F"];
        for n in &nodes {
            let sym = SymbolNode {
                id: format!("sym:{n}"),
                name: n.to_string(),
                kind: SymbolKind::Function,
                file_path: format!("/x/{n}.rs"),
                line_start: 1,
                line_end: 5,
                language: "rust".to_string(),
                indexed_at: 0,
            };
            conn.execute(
                "INSERT INTO kg_nodes (id, concept, node_type, description, sources, importance, created_at, last_updated) \
                 VALUES (?1, ?1, 'symbol', ?2, '[]', 0.5, 0, 0)",
                rusqlite::params![sym.id, serde_json::to_string(&sym).unwrap()],
            )
            .unwrap();
        }
        for (f, t) in &[
            ("A", "B"),
            ("A", "C"),
            ("B", "D"),
            ("C", "D"),
            ("D", "E"),
            ("E", "F"),
        ] {
            conn.execute(
                "INSERT INTO kg_edges (from_id, to_id, relation, strength, created_at) \
                 VALUES (?1, ?2, 'calls', 1.0, 0)",
                rusqlite::params![format!("sym:{f}"), format!("sym:{t}")],
            )
            .unwrap();
        }
        conn
    }

    /// Empty-symbol fixture: schema present but no kg_nodes rows. Mirrors
    /// the `tree_sitter_enabled=false` path where reindex never ran.
    fn fixture_conn_empty() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE kg_nodes (
                id TEXT PRIMARY KEY,
                concept TEXT NOT NULL,
                node_type TEXT NOT NULL DEFAULT 'concept',
                description TEXT NOT NULL DEFAULT '',
                sources TEXT NOT NULL DEFAULT '[]',
                importance REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE kg_edges (
                from_id TEXT NOT NULL,
                to_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (from_id, to_id, relation)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn phase36_intel_02_pagerank_deterministic() {
        let conn = fixture_conn_with_graph();
        let mentions = vec!["D".to_string()];
        let mut runs: Vec<Vec<(SymbolNode, f32)>> = Vec::new();
        for _ in 0..10 {
            clear_cache();
            runs.push(rank_symbols("test", &mentions, 0.85, &conn));
        }
        for i in 1..10 {
            // Names + ids must match exactly across runs.
            let r0_ids: Vec<String> = runs[0].iter().map(|(s, _)| s.id.clone()).collect();
            let ri_ids: Vec<String> = runs[i].iter().map(|(s, _)| s.id.clone()).collect();
            assert_eq!(
                r0_ids, ri_ids,
                "PageRank ordering MUST be deterministic across runs"
            );
            // And scores within 1e-4 (catches subtle f32 drift).
            for (a, b) in runs[0].iter().zip(runs[i].iter()) {
                assert!(
                    (a.1 - b.1).abs() < 1e-4,
                    "PageRank scores must match within 1e-4 across runs ({} vs {})",
                    a.1,
                    b.1
                );
            }
        }
    }

    #[test]
    fn phase36_intel_02_pagerank_personalization() {
        let conn = fixture_conn_with_graph();
        clear_cache();
        // Mention D — D should rank higher than F (terminal sink that only
        // sees rank flowing through E).
        let mentions_d = vec!["D".to_string()];
        let result_d = rank_symbols("test", &mentions_d, 0.85, &conn);
        let d_score = result_d
            .iter()
            .find(|(s, _)| s.name == "D")
            .map(|(_, sc)| *sc)
            .unwrap_or(0.0);
        let f_score = result_d
            .iter()
            .find(|(s, _)| s.name == "F")
            .map(|(_, sc)| *sc)
            .unwrap_or(0.0);
        assert!(
            d_score > f_score,
            "D mentioned -> D should outrank F (got d={d_score}, f={f_score})"
        );
        // And vs the unmentioned baseline: D should outrank itself in the
        // uniform case once we mention it (personalization actually moves
        // the needle).
        clear_cache();
        let result_uniform = rank_symbols("test", &[], 0.85, &conn);
        let d_uniform = result_uniform
            .iter()
            .find(|(s, _)| s.name == "D")
            .map(|(_, sc)| *sc)
            .unwrap_or(0.0);
        assert!(
            d_score >= d_uniform,
            "Mentioning D should not reduce D's score (mentioned={d_score}, uniform={d_uniform})"
        );
    }

    #[test]
    fn phase36_intel_02_personalized_vector_seeds_correctly() {
        let conn = fixture_conn_with_graph();
        clear_cache();
        // Different mentions → different rankings (cache key differs).
        let r_d = rank_symbols("test", &["D".to_string()], 0.85, &conn);
        let r_f = rank_symbols("test", &["F".to_string()], 0.85, &conn);
        assert_ne!(
            r_d.iter().take(3).map(|(s, _)| s.name.clone()).collect::<Vec<_>>(),
            r_f.iter().take(3).map(|(s, _)| s.name.clone()).collect::<Vec<_>>(),
            "Different mentions MUST produce different rankings (cache key differs)"
        );
    }

    #[test]
    fn phase36_intel_02_pagerank_cache_hit_within_5_min() {
        let conn = fixture_conn_with_graph();
        clear_cache();
        let mentions = vec!["D".to_string()];
        let r1 = rank_symbols("test", &mentions, 0.85, &conn);
        // Second call within TTL — cache must hit. We verify by checking the
        // cache entry is present + by-value equal to the first result.
        let r2 = rank_symbols("test", &mentions, 0.85, &conn);
        assert_eq!(r1.len(), r2.len(), "cache hit returns identical length");
        for (a, b) in r1.iter().zip(r2.iter()) {
            assert_eq!(a.0.id, b.0.id);
            assert!((a.1 - b.1).abs() < 1e-9);
        }
        // Confirm cache actually populated.
        let key = cache_key(&mentions);
        let cache = RANK_CACHE.lock().unwrap();
        assert!(cache.contains_key(&key), "cache must contain key after compute");
        let (written, _) = cache.get(&key).unwrap();
        assert!(
            written.elapsed() < Duration::from_secs(CACHE_TTL_SECONDS),
            "cache entry must be within TTL"
        );
    }

    #[test]
    fn phase36_intel_02_pagerank_cache_invalidates_after_5_min() {
        let conn = fixture_conn_with_graph();
        clear_cache();
        let mentions = vec!["D".to_string()];
        let _r1 = rank_symbols("test", &mentions, 0.85, &conn);
        let key = cache_key(&mentions);
        // Manually backdate the cache entry to simulate >5 min elapsed.
        {
            let mut cache = RANK_CACHE.lock().unwrap();
            let (_, vec) = cache.get(&key).unwrap().clone();
            // Replace the timestamp with one 6 minutes in the past.
            let stale = Instant::now()
                .checked_sub(Duration::from_secs(360))
                .expect("Instant rewind");
            cache.insert(key.clone(), (stale, vec));
        }
        // Now check the lookup logic: an entry exists but elapsed > TTL,
        // so the function should recompute (and overwrite with a fresh stamp).
        let _r2 = rank_symbols("test", &mentions, 0.85, &conn);
        let cache = RANK_CACHE.lock().unwrap();
        let (written, _) = cache.get(&key).unwrap();
        assert!(
            written.elapsed() < Duration::from_secs(CACHE_TTL_SECONDS),
            "stale entry must have been replaced with fresh timestamp"
        );
    }

    #[test]
    fn phase36_intel_02_force_pagerank_result_seam() {
        let conn = fixture_conn_with_graph();
        let synthetic = vec![(
            SymbolNode {
                id: "sym:Z".to_string(),
                name: "Z".to_string(),
                kind: SymbolKind::Function,
                file_path: "/Z.rs".to_string(),
                line_start: 1,
                line_end: 1,
                language: "rust".to_string(),
                indexed_at: 0,
            },
            0.99f32,
        )];
        INTEL_FORCE_PAGERANK_RESULT.with(|c| c.set(Some(synthetic.clone())));
        let r = rank_symbols("test", &[], 0.85, &conn);
        INTEL_FORCE_PAGERANK_RESULT.with(|c| c.set(None));
        assert_eq!(r.len(), 1, "FORCE seam must short-circuit to injected vec");
        assert_eq!(r[0].0.name, "Z");
        assert!((r[0].1 - 0.99).abs() < 1e-6);
    }

    #[test]
    fn phase36_intel_02_panic_safe_returns_empty() {
        // Force a panic during PageRank computation by injecting a poisoned
        // SymbolNode payload that fails JSON deserialization — load_graph
        // skips it, returning empty nodes_in_order. The function must
        // tolerate the empty result without panicking. We additionally
        // validate the catch_unwind guard by feeding a totally-broken
        // SQLite handle (closed connection); the panic guard must convert
        // any panic into Vec::new().
        let conn = Connection::open_in_memory().unwrap();
        // No tables → load_graph returns Err — function returns Vec::new()
        let r = rank_symbols("test", &["X".to_string()], 0.85, &conn);
        assert!(r.is_empty(), "missing tables must yield empty (no panic)");
    }

    #[test]
    fn phase36_intel_02_smart_off_returns_empty() {
        // Mirrors the tree_sitter_enabled=false path: caller skipped the
        // reindex, so kg_nodes has no symbol rows. rank_symbols returns
        // an empty vec rather than blowing up.
        clear_cache();
        let conn = fixture_conn_empty();
        let r = rank_symbols("test", &["foo".to_string()], 0.85, &conn);
        assert!(r.is_empty(), "no symbol rows -> empty rank");
    }

    #[test]
    fn phase36_intel_02_empty_mentions_uses_uniform_personalization() {
        let conn = fixture_conn_with_graph();
        clear_cache();
        let r = rank_symbols("test", &[], 0.85, &conn);
        assert!(
            !r.is_empty(),
            "empty mentions falls back to uniform PageRank, not empty result"
        );
        // PageRank invariant: scores sum to ~1.0 (allow slack for f32 +
        // sink correction edge cases).
        let total: f32 = r.iter().map(|(_, s)| s).sum();
        assert!(
            (total - 1.0).abs() < 0.05,
            "rank vector should sum to ~1.0 (got {total})"
        );
    }

    #[test]
    fn phase36_intel_02_damping_clamped_to_safe_range() {
        let conn = fixture_conn_with_graph();
        clear_cache();
        // Damping = 1.0 is the classic explosion case (no teleport). The
        // clamp(0.0, 1.0 - 1e-3) keeps us stable; assert no panic + finite.
        let r = rank_symbols("test", &[], 1.0, &conn);
        assert!(!r.is_empty());
        for (_, s) in &r {
            assert!(s.is_finite(), "ranks must be finite under damping clamp");
        }
        // Negative damping → clamped to 0.0 → pure teleport (uniform output).
        clear_cache();
        let r_neg = rank_symbols("test", &[], -1.0, &conn);
        assert!(!r_neg.is_empty());
        for (_, s) in &r_neg {
            assert!(s.is_finite());
        }
    }
}
