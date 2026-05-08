---
phase: 36-context-intelligence
plan: 3
subsystem: intelligence/pagerank
tags: [intelligence, pagerank, petgraph, personalization, cache, force-seam, panic-safe, determinism]
status: complete
dependency_graph:
  requires:
    - "Phase 36-01 IntelligenceConfig.pagerank_damping (default 0.85)"
    - "Phase 36-01 intelligence/pagerank.rs scaffold stub"
    - "Phase 36-01 petgraph 0.6 dep"
    - "Phase 36-02 SymbolNode/SymbolKind types + kg_nodes(node_type='symbol') + kg_edges(relation IN ('calls','uses_type'))"
    - "sha2 0.10 + once_cell 1 + serde_json 1 (already in Cargo.toml)"
  provides:
    - "intelligence::pagerank::rank_symbols(query, mentioned_symbols, damping, &Connection) -> Vec<(SymbolNode, f32)>"
    - "intelligence::pagerank::cache_key(&[String]) -> String (sha256[..16] hex)"
    - "intelligence::pagerank::clear_cache() escape hatch (Plan 36-05 reload hook)"
    - "intelligence::pagerank::INTEL_FORCE_PAGERANK_RESULT thread_local fault-injection seam"
    - "intelligence::pagerank::RANK_CACHE Lazy<Mutex<HashMap<String, (Instant, Vec<(SymbolNode, f32)>)>>>"
  affects:
    - "No external surface change. Module-internal: 654 LOC added in src-tauri/src/intelligence/pagerank.rs"
tech_stack:
  used:
    - "petgraph 0.6 (DiGraph, NodeIndex, edges_directed, EdgeRef::target)"
    - "once_cell 1 (Lazy<Mutex<HashMap<...>>> for RANK_CACHE singleton)"
    - "sha2 0.10 (Sha256 hash of canonical-JSON sorted mentions; manual hex8 helper)"
    - "serde_json 1 (canonical JSON for cache key + SymbolNode payload deserialization)"
    - "rusqlite 0.39 (read kg_nodes + kg_edges; ORDER BY for deterministic load order)"
    - "std::panic::catch_unwind + AssertUnwindSafe (panic-safety guard around PageRank computation)"
  patterns:
    - "thread_local Cell<Option<T>> test seam, peek-style (mirrors LOOP_OVERRIDE / RES_FORCE_STUCK / INTEL_FORCE_PARSE_ERROR)"
    - "Hand-rolled iterative power method instead of petgraph::algo::page_rank (locks out HashMap-ordering drift)"
    - "Sink-correction: dangling-node mass redistributed via personalization vector p (Brin-Page §2.7)"
    - "Tiebreak on id ascending after partial_cmp on score for byte-stable top-N"
    - "5-min TTL LRU cache via Mutex<HashMap>; key = sha256(canonical_json(sorted(lowercase(mentions))))[..8] -> 16 hex"
    - "Damping clamp [0.0, 1.0-1e-3] for numerical stability under adversarial config (T-36-16)"
    - "Manual hex encoding (avoids adding `hex` crate to Cargo.toml; sha2 GenericArray + format! per byte)"
key_files:
  created: []
  modified:
    - "src-tauri/src/intelligence/pagerank.rs (+654/-1; was 2-line stub)"
decisions:
  - "Hand-rolled PageRank vs petgraph::algo::page_rank: HELD as locked. Determinism guarantee (10 runs byte-identical) requires we own the iteration order; petgraph's internal HashMap ordering is implementation-defined."
  - "Cache key uses lowercase + sorted + dedup before sha256 — case-insensitive matching on mentions is consistent end-to-end (cache key + personalization vector both lowercase)."
  - "tree_sitter_enabled=false handling: function does NOT take config — when smart is off, kg_nodes has no symbol rows, load_graph returns empty Vec, rank_symbols returns Vec::new() naturally. Test phase36_intel_02_smart_off_returns_empty asserts this path."
  - "Cache TTL invalidation tested via manual Instant rewind (Instant::now().checked_sub(360s)) — sleep-based test would add 5min to test wall time."
  - "petgraph 0.6.5 EdgeReference::target() requires `use petgraph::visit::EdgeRef` trait import (caught at first cargo test; 1-line fix)."
  - "Damping clamp upper bound is 1.0 - 1e-3, not 1.0 — at exactly 1.0 the teleport term is zero and PageRank doesn't converge for graphs with sinks."
  - "Top-N truncate at 200 happens AFTER the full-vector sort, so all symbols compete fairly for the top-200 slots."
metrics:
  tasks_completed: 1
  files_modified: 1
  lines_added: 654
  tests_added: 10
  tests_passing: 10
  cache_ttl_seconds: 300
  pagerank_max_iter: 50
  pagerank_convergence_l1: 1e-6
  pagerank_top_n: 200
  damping_default: 0.85
  cache_key_hex_chars: 16
  duration_minutes: 9
  completed_date: 2026-05-07
---

# Phase 36 Plan 3: Personalized PageRank + 5-Min Cache + FORCE Seam (INTEL-02) Summary

INTEL-02 ships a personalized-PageRank ranker over the symbol graph, with a 5-minute LRU cache keyed on canonical-JSON-of-sorted-mentions sha256 truncation, and a thread-local fault-injection seam. The function `rank_symbols(query, mentioned_symbols, damping, &Connection) -> Vec<(SymbolNode, f32)>` loads `kg_nodes(node_type='symbol')` rows + `kg_edges(relation IN ('calls','uses_type'))` from SQLite, builds a `petgraph::DiGraph<SymbolNode, f32>`, runs an in-house iterative power method (not `petgraph::algo::page_rank` — see decisions), and returns the top-200 nodes sorted descending by score with id-ascending tiebreak.

## What Shipped

### `rank_symbols` (entry point)

| Step | Behavior |
|------|----------|
| 1 | INTEL_FORCE_PAGERANK_RESULT short-circuit (test seam) |
| 2 | Damping clamped to `[0.0, 1.0 - 1e-3]` (T-36-16 numerical safety) |
| 3 | Cache lookup: key = `sha256(canonical_json(sorted(lowercase(mentions))))[..8]` -> 16 hex; hit if `elapsed < 300s` |
| 4 | Cache miss: `catch_unwind(AssertUnwindSafe(...))` wraps load + iterate |
| 5 | `load_graph(conn)` SQL: `SELECT description FROM kg_nodes WHERE node_type='symbol' ORDER BY id ASC` + edges `WHERE relation IN ('calls','uses_type') ORDER BY from_id, to_id ASC` |
| 6 | Personalization vector p: case-insensitive name match -> 1.0; sum-normalize; if p_sum=0 -> uniform 1/N |
| 7 | Iterate up to `MAX_ITER=50` or `L1 < CONVERGENCE_L1=1e-6`. Sink correction redistributes dangling-node mass via p. |
| 8 | Sort desc by score with `.then_with(\|\| a.0.id.cmp(&b.0.id))` tiebreak; truncate to 200 |
| 9 | Insert into RANK_CACHE with `Instant::now()` stamp |

### Cache invariants

- TTL: 5 min (300 s)
- Mentions-diff invalidation is implicit in the cache key (different mentions = different sha256 = miss)
- Test `phase36_intel_02_pagerank_cache_invalidates_after_5_min` rewinds an entry to `now - 360s` and asserts the next call recomputes (fresh stamp written)
- Test `phase36_intel_02_pagerank_cache_hit_within_5_min` confirms second call returns identical result + cache entry persists with TTL-valid timestamp
- Test `phase36_intel_02_personalized_vector_seeds_correctly` confirms different mentions produce different top-3 rankings (cache key differs)
- `clear_cache()` exposed for Plan 36-05 reload hook + tests

### INTEL_FORCE_PAGERANK_RESULT seam

Mirrors Phase 33's `LOOP_OVERRIDE` and Phase 34's `RES_FORCE_STUCK`. Peek-style:
```rust
fn check_force() -> Option<Vec<(SymbolNode, f32)>> {
    INTEL_FORCE_PAGERANK_RESULT.with(|c| {
        let v = c.take();
        if let Some(ref inner) = v { c.set(Some(inner.clone())); }
        v
    })
}
```
Multiple calls within a test see the same forced value; `set(None)` clears.

### Panic safety

`catch_unwind(AssertUnwindSafe(...))` around `load_graph` + `personalized_pagerank`. On panic: log `[INTEL-02] PageRank panic — returning empty` and return `Vec::new()`. Test `phase36_intel_02_panic_safe_returns_empty` exercises the missing-tables Err path (load_graph returns Err -> empty); the catch_unwind guard is the belt-and-suspenders for any future iteration math drift.

## petgraph 0.6 API Patterns Used

- `DiGraph<SymbolNode, f32>` with `add_node` / `add_edge` (weights = 1.0 in v1)
- `graph.node_indices()` for stable iteration
- `graph.edges_directed(idx, Direction::Outgoing)` returns `EdgeReference`
- `e.target()` requires `use petgraph::visit::EdgeRef` trait — **1-line fix caught at first cargo test**
- Did **NOT** use `petgraph::algo::page_rank` (locked-in decision per plan; HashMap-ordering determinism control)

## Determinism Outcome (10 runs byte-identical)

Test `phase36_intel_02_pagerank_deterministic` runs `rank_symbols` 10 times with `clear_cache()` between calls + identical input. Asserts:
1. Top-200 id list identical across all 10 runs
2. All scores match within `1e-4` (catches subtle f32 drift)

**PASS.** SQL `ORDER BY` + nodes_in_order iteration in SQL-stable order + id-ascending tiebreak = byte-identical output across 10 runs. No HashMap ordering leaks into the result.

## Tests (10 green)

| Test | Asserts |
|------|---------|
| `phase36_intel_02_pagerank_deterministic` | 10 runs byte-identical (id list + scores within 1e-4) |
| `phase36_intel_02_pagerank_personalization` | D mentioned -> D outranks F + D mentioned >= D uniform |
| `phase36_intel_02_personalized_vector_seeds_correctly` | Different mentions produce different top-3 rankings |
| `phase36_intel_02_pagerank_cache_hit_within_5_min` | Second call returns identical result + RANK_CACHE entry within TTL |
| `phase36_intel_02_pagerank_cache_invalidates_after_5_min` | Manually rewound entry to now-360s -> next call writes fresh stamp |
| `phase36_intel_02_force_pagerank_result_seam` | Setting INTEL_FORCE_PAGERANK_RESULT short-circuits to injected vec |
| `phase36_intel_02_panic_safe_returns_empty` | Missing-tables Err path returns Vec::new (no panic propagation) |
| `phase36_intel_02_smart_off_returns_empty` | Empty kg_nodes (tree_sitter_enabled=false simulated) -> empty rank |
| `phase36_intel_02_empty_mentions_uses_uniform_personalization` | Empty mentions -> non-empty result + scores sum to ~1.0 (PageRank invariant) |
| `phase36_intel_02_damping_clamped_to_safe_range` | Damping=1.0 + Damping=-1.0 both produce finite scores (clamp works) |

```
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 751 filtered out; finished in 0.03s
```

(751 filtered = full lib-test count; only the 10 INTEL-02 tests targeted via `--lib intelligence::pagerank::tests`.)

## In-House Personalized PageRank vs `petgraph::algo::page_rank` — Choice Held

Plan-locked: **in-house implementation**. Confirmed.

petgraph 0.6's `algo::page_rank(graph, damping, nb_iter)` does NOT support a personalization vector — uniform teleport only. Personalized PageRank is the entire point of INTEL-02 (Aider's locked default behavior is "rank symbols by chat-mention proximity"). The hand-rolled iteration is ~30 LOC, gives us:
- Personalization vector control (case-insensitive name match)
- Convergence-on-L1 early stop (petgraph runs `nb_iter` always)
- Sink correction via personalization vector (proper handling of dangling nodes)
- Determinism guarantee (we own iteration order via SQL `ORDER BY` + `nodes_in_order`)

## Plan 36-02 Schema Interaction

`load_graph` reads `kg_nodes.description` as JSON-serialized `SymbolNode`. Plan 36-02's writer uses `serde_json::to_string(&node)` to encode; deserialization in `load_graph` mirrors that contract (`serde_json::from_str::<SymbolNode>(&desc)`). Rows that fail to deserialize are silently skipped (forward-compat against Plan 36-08+ schema additions).

The `concept` column is unique-indexed in production but unused by INTEL-02; only `id`, `node_type`, `description` are read. Row insertion in tests uses the same 8-column production layout (concept = id, sources = '[]', importance = 0.5, last_updated = 0) so the fixture passes the UNIQUE constraint without contortion.

## Threat Model Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-36-15 DoS (PageRank explodes on 1M-node graph) | `MAX_ITER=50` + `CONVERGENCE_L1=1e-6` early stop; Plan 36-02 walk filter caps file count upstream |
| T-36-16 Tampering (damping out of [0,1]) | `damping.clamp(0.0, 1.0 - 1e-3)` at function entry; test `phase36_intel_02_damping_clamped_to_safe_range` exercises 1.0 + -1.0 |
| T-36-17 Tampering (zero personalization vector) | Uniform fallback when `p_sum == 0`; test `phase36_intel_02_empty_mentions_uses_uniform_personalization` covers |
| T-36-18 DoS (RANK_CACHE unbounded growth) | Accept; cache key space bounded by distinct mention sets per session; `clear_cache()` escape hatch + Plan 36-05 reload command |
| T-36-19 Information disclosure | Accept; local-first |
| T-36-20 Tampering (non-deterministic ordering) | SQL `ORDER BY` + id-ascending tiebreak after `partial_cmp` on score; test `phase36_intel_02_pagerank_deterministic` asserts 10 runs byte-identical |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Missing `EdgeRef` trait import**
- **Found during:** First cargo test run after Write
- **Issue:** `e.target()` on `petgraph::graph::EdgeReference` errored E0599 — method requires `petgraph::visit::EdgeRef` trait in scope
- **Fix:** Added `use petgraph::visit::EdgeRef;` between the existing `use petgraph::graph::{DiGraph, NodeIndex};` and `use petgraph::Direction;`
- **Files modified:** src-tauri/src/intelligence/pagerank.rs
- **Commit:** `efe0b19` (single commit; fix folded into the only Plan 36-03 commit)

### Test Count Expansion

The plan file specified 4 unit tests + 1 bonus (5 total). The orchestrator's prompt listed 7 named tests. Both sets were satisfied + 3 additional tests added (deterministic-with-score-tolerance + cache-hit + damping-clamp) for **10 tests total**, all green. No conflict — superset of both contracts.

### `hex` crate avoided

Plan interfaces sketch uses `hex::encode(...)`. Cargo.toml has no `hex` dep, only `sha2`. Rather than add a new crate, implemented an inline `fn hex8(bytes: &[u8]) -> String` using `format!("{:02x}", b)` per byte. Same output, zero deps added.

## What's Next

**Plan 36-04 already shipped** (commits `0d3cc86` + `fa416a2`) — `repo_map.rs` builds the budget-bounded map and brain.rs injects it at the code-section gate. Plan 36-04 currently consumes raw `SymbolNode` ordering; v1.6+ wave will wire `rank_symbols` output into repo_map's harvester so the map is rank-ordered rather than file-walk-ordered.

**Plan 36-05** (capability registry) is independent.

**Plan 36-06+** can layer mtime-watermark cache invalidation on top of the 5-min TTL when needed.

## Self-Check: PASSED

- [x] `src-tauri/src/intelligence/pagerank.rs` exists (654 lines)
- [x] Commit `efe0b19` present in `git log --oneline`
- [x] No staged deletions swept in (`git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty)
- [x] All 10 phase36_intel_02_* tests passing (cargo test --lib intelligence::pagerank::tests)
- [x] No Co-Authored-By line in commit
- [x] Only `pagerank.rs` modified; STATE.md / ROADMAP.md untouched per instruction
- [x] Did NOT touch `intelligence/repo_map.rs` or `brain.rs` (Plan 36-04 territory)
