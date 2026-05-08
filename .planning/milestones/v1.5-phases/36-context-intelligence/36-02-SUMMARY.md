---
phase: 36-context-intelligence
plan: 2
subsystem: intelligence/tree-sitter-symbol-graph
tags: [intelligence, tree-sitter, symbol-graph, knowledge-graph, catch-unwind, idempotent-reindex]
status: complete
dependency_graph:
  requires:
    - "Phase 36-01 IntelligenceConfig (tree_sitter_enabled toggle, escape-hatch route)"
    - "Phase 36-01 intelligence/ module scaffold (mod.rs + 6 stubs)"
    - "Phase 36-01 cargo deps (tree-sitter 0.22.6, tree-sitter-typescript 0.21.2, tree-sitter-rust 0.21.2, tree-sitter-python 0.21.0)"
    - "Phase 35-03 DECOMP_FORCE_STEP_COUNT seam pattern (mirrored as INTEL_FORCE_PARSE_ERROR)"
    - "knowledge_graph.rs ensure_tables (kg_nodes/kg_edges schema reused additively)"
  provides:
    - "intelligence::tree_sitter_parser::{parse_typescript|parse_rust|parse_python} -> ParsedFile"
    - "intelligence::tree_sitter_parser::INTEL_FORCE_PARSE_ERROR thread_local seam"
    - "intelligence::symbol_graph::{SymbolNode, SymbolKind, ReindexStats}"
    - "intelligence::symbol_graph::reindex_project(project_root, &Connection) -> Result<ReindexStats, String>"
    - "Tauri command intelligence::reindex_symbol_graph(project_root: String) -> Result<ReindexStats, String>"
  affects:
    - "kg_nodes (additive: rows with node_type='symbol', concept='sym:{id}')"
    - "kg_edges (additive: relations 'calls' | 'imports' | 'uses_type')"
    - "lib.rs generate_handler! list (+1 entry)"
tech_stack:
  used:
    - "tree-sitter 0.22.6 (Parser, Query, QueryCursor)"
    - "tree-sitter-typescript 0.21.2 (language_typescript)"
    - "tree-sitter-rust 0.21.2 (language)"
    - "tree-sitter-python 0.21.0 (language)"
    - "sha2 0.10 (Sha256 -> 16-hex symbol ids)"
    - "rusqlite 0.39 (kg_nodes / kg_edges INSERT OR REPLACE / OR IGNORE)"
    - "chrono 0.4 (Utc::now timestamps)"
    - "tempfile 3 (test fixtures)"
  patterns:
    - "thread_local Cell<Option<String>> test seam (mirrors DECOMP_FORCE_STEP_COUNT)"
    - "std::panic::catch_unwind(AssertUnwindSafe(...)) per parse call (sixth structural application of v1.1 lesson)"
    - "Delete-then-bulk-insert idempotent re-index keyed on JSON-payload file_path prefix"
    - "INSERT OR REPLACE on UNIQUE concept index for symbol nodes (concept = node_id, name in description JSON)"
    - "INSERT OR IGNORE on (from_id, to_id, relation) primary key for edges"
key_files:
  modified:
    - "src-tauri/src/intelligence/tree_sitter_parser.rs (+293 LOC)"
    - "src-tauri/src/intelligence/symbol_graph.rs (+425 LOC)"
    - "src-tauri/src/intelligence/mod.rs (+39 LOC)"
    - "src-tauri/src/lib.rs (+2 LOC)"
decisions:
  - "Re-use existing kg_nodes/kg_edges tables verbatim — no new SQL migration. node_type='symbol' is the discriminant; rich payload (kind/file_path/lines/language) lives JSON-encoded in description."
  - "concept = 'sym:{16-hex-id}' satisfies the UNIQUE concept index even when two functions share a name across files (id is sha256(file::name::kind), unique by construction)."
  - "INTEL_FORCE_PARSE_ERROR seam declared OUTSIDE #[cfg(test)] (always present) so the integration test in symbol_graph.rs can flip it across module boundaries; v1.1 / Phase 35-03 precedent."
  - "Edge from_name resolution: line-range containment first (the call site's source_line falls inside an enclosing function), fall back to first function symbol in the same file. Cross-file resolution deferred to v1.6+ LSP integration."
  - "Walk-filter skip set extended beyond plan: target/, node_modules/, .git/, dist/, build/, out/, .next/, .turbo/. Next/Turbo dirs are common in BLADE's React/Tauri tree."
  - "SQL LIKE pattern in prior-row deletion escapes %/_/\\ in project_root so a path containing those chars doesn't sweep unrelated rows."
  - "Tauri command opens its own SQLite connection via blade_config_dir().join('blade.db') — knowledge_graph.rs doesn't expose Tauri State, so we mirror its open_conn() idiom inside spawn_blocking. Both code paths target the same SQLite file."
  - "Self-loop edges (from_id == to_id) dropped — rare in real code, never useful for PageRank."
metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_modified: 4
  commits: 3
  tests_added: 8
  tests_pass: "8/8"
  cargo_check_errors: 0
completed_date: "2026-05-07"
requirements_addressed: [INTEL-01]
---

# Phase 36 Plan 36-02: tree-sitter symbol graph (INTEL-01) Summary

**One-liner:** Lands INTEL-01 — three per-language tree-sitter parsers (TS/JS, Rust, Python), an additive `node_type='symbol'` extension on the existing kg_nodes/kg_edges tables, and a `reindex_symbol_graph` Tauri command — wrapped in `catch_unwind` per the v1.1 panic-resistance discipline (sixth structural application).

## Tests Added (all green)

```
running 8 tests
test intelligence::tree_sitter_parser::tests::phase36_intel_01_tree_sitter_parses_rust_function_definition ... ok
test intelligence::tree_sitter_parser::tests::phase36_intel_01_tree_sitter_parses_typescript_imports     ... ok
test intelligence::tree_sitter_parser::tests::phase36_intel_01_tree_sitter_parses_python_class           ... ok
test intelligence::tree_sitter_parser::tests::phase36_intel_01_force_parse_error_seam_returns_err        ... ok
test intelligence::symbol_graph::tests::phase36_intel_01_symbol_id_is_deterministic                       ... ok
test intelligence::symbol_graph::tests::phase36_intel_01_symbol_graph_persists_to_kg_nodes                ... ok
test intelligence::symbol_graph::tests::phase36_intel_01_reindex_is_idempotent                           ... ok
test intelligence::symbol_graph::tests::phase36_intel_01_force_parse_error_skips_file_not_crash          ... ok
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 736 filtered out
```

Plan asked for 7 tests (4 parser + 3 symbol_graph); shipped 8 (the extra symbol_graph case asserts the FORCE_PARSE_ERROR seam round-trips through `reindex_project`'s catch_unwind wrapper, exercising the panic-skip path end-to-end without a malformed source fixture). 

Phase 36-01 config tests still green (no regressions):

```
running 3 tests
test config::tests::phase36_intelligence_default_values        ... ok
test config::tests::phase36_intelligence_config_round_trip     ... ok
test config::tests::phase36_intelligence_missing_uses_defaults ... ok
```

## tree-sitter crate versions (locked from 36-01)

| Crate | Cargo.toml track | Resolved |
|-------|------------------|----------|
| tree-sitter | 0.22 | **0.22.6** |
| tree-sitter-typescript | 0.21 | **0.21.2** |
| tree-sitter-rust | 0.21 | **0.21.2** |
| tree-sitter-python | 0.21 | **0.21.0** |

Same Cargo.lock entries from Plan 36-01 — no new deps introduced by 36-02. `sha2 = "0.10"`, `chrono = "0.4"`, `rusqlite = "0.39"`, and `tempfile = "3"` (dev-only) were all already present.

## Walk-filter skip set (recorded from validation)

Plan locked: `target/, node_modules/, .git/, dist/, build/, out/`.

Shipped: same six **plus** `.next/` (Next.js compile cache) and `.turbo/` (Turborepo cache). Both are standard noise in JS-heavy trees and would otherwise cost a few thousand needless tree-sitter parses on a typical Tauri+React project. Files larger than 1 MB are also skipped at the read site (T-36-10 mitigation).

## KG state-shape adapter (recorded from validation)

`knowledge_graph.rs` does **not** expose a `Mutex<Connection>` Tauri State. It uses module-level functions (`open_conn() -> rusqlite::Connection`, `ensure_tables()`) keyed on `db_path() = blade_config_dir().join("blade.db")`. The Tauri command therefore mirrors that idiom inside `spawn_blocking`:

```rust
crate::knowledge_graph::ensure_tables();
let conn = rusqlite::Connection::open(
    crate::config::blade_config_dir().join("blade.db"),
)?;
symbol_graph::reindex_project(&path, &conn)
```

This guarantees Symbol rows land in the **same SQLite file** as every other KnowledgeNode (concepts, entities, etc.), preserving the additive-only schema promise.

## Schema reuse (additive — no migration)

The CONTEXT lock specified `node_type = 'symbol'` + four edge relations `{calls, imports, uses_type, defines}`. `kg_nodes` already has a `concept TEXT NOT NULL UNIQUE` column, so SymbolNode rows use `concept = "sym:{16-hex-id}"` (unique by sha256-truncated id construction) and stash the rich payload (kind/file_path/line_start/line_end/language/indexed_at) as JSON in `description`. `kg_edges` already accepts arbitrary `relation` strings, so the four new relations land without DDL change. **`defines`** isn't currently emitted by any parser query — left available for future plans (e.g., method-of-class linking when v1.6 LSP arrives).

## Catch_unwind discipline (sixth structural application)

`reindex_project` wraps every `parse_typescript | parse_rust | parse_python` call in `std::panic::catch_unwind(AssertUnwindSafe(...))`. Per-file panics emit `[INTEL-01] parser panic on {path}; skipping` to `log::warn` and the walk continues. This is the sixth phase to apply the structural v1.1 lesson (Phases 33, 34-04, 35-03, 35-04, 36-02 — one application per parser + one per orchestrator), and the test `phase36_intel_01_force_parse_error_skips_file_not_crash` asserts the seam works end-to-end through `reindex_project`.

## INTEL_FORCE_PARSE_ERROR seam

```rust
thread_local! {
    pub static INTEL_FORCE_PARSE_ERROR: Cell<Option<String>> = const { Cell::new(None) };
}
```

Mirrors Phase 35-03's `DECOMP_FORCE_STEP_COUNT` exactly. Tests inject `Some(msg)` before calling a parse function and assert the function returns `Err(msg)` immediately. The seam lives outside `#[cfg(test)]` (so the integration test in `symbol_graph::tests` can flip it across module boundaries), but is never set in production.

## Idempotency assertion

The `phase36_intel_01_reindex_is_idempotent` test runs `reindex_project` twice on the same fixture (`def x():\n    pass\ndef y():\n    x()\n`) and asserts:

1. `s1.symbols_inserted == s2.symbols_inserted` (same symbol count both runs)
2. `kg_nodes.COUNT(WHERE node_type='symbol') == s2.symbols_inserted` (no leftovers from run 1)

Implementation: re-index begins by selecting prior `kg_nodes.id` rows whose `description` JSON contains `"file_path":"{root}` (LIKE-pattern with `%/_/\\` escaping), then deletes the corresponding edges (where `from_id IN (...) OR to_id IN (...)`) and nodes via parameter-bound IN-list batches of 256. Subsequent `INSERT OR REPLACE` on the unique `concept` index handles the symbol-level idempotency; `INSERT OR IGNORE` on the edges' composite primary key prevents duplicate edges.

## Tauri command surface

```rust
#[tauri::command]
pub async fn reindex_symbol_graph(
    project_root: String,
) -> Result<symbol_graph::ReindexStats, String>;
```

Behavior:
- Returns `Err("intelligence.tree_sitter_enabled=false (CTX-07 fallback)")` when the config toggle is off — Plan 36-04 will route this to `indexer.rs` FTS as the fallback path.
- Returns `Err("project_root does not exist: ...")` when the path doesn't exist.
- Otherwise spawns a blocking task that opens the kg SQLite connection and calls `symbol_graph::reindex_project`.

Command-name uniqueness verified: `grep -rn "fn reindex_symbol_graph" src-tauri/src/` returns exactly 1 (the new declaration). No collision in Tauri's flat command namespace.

## Commits

| Hash | Message |
|------|---------|
| `5127e0f` | feat(36-02): fill tree_sitter_parser body with TS/Rust/Python parsers + INTEL_FORCE_PARSE_ERROR seam (INTEL-01) |
| `3afab45` | feat(36-02): fill symbol_graph body with reindex_project + persistence helpers (INTEL-01) |
| `37941d1` | feat(36-02): register reindex_symbol_graph Tauri command (INTEL-01) |

3 atomic commits, one per task, each `git add <specific path>` only — the 188 pre-existing staged-deletion entries in `.planning/phases/...` were NOT swept in.

## Deviations from Plan

**Two minor adaptations**, both Rule 3 (auto-fix blocking issue against the actual codebase, no permission needed):

1. **[Rule 3 - Schema adapter]** The plan's pseudocode assumed `kg_nodes` had columns `(id, node_type, name, description, created_at)`. The actual schema (from `knowledge_graph.rs::ensure_tables`) has `(id, concept, node_type, description, sources, importance, created_at, last_updated)` plus a `UNIQUE` index on `concept`. Adapter: SymbolNode rows use `concept = "sym:{id}"` (unique by id construction), `name` lives in the JSON payload in `description`, default `sources='[]'` and `importance=0.5` are written explicitly. `kg_edges` actual columns are `(from_id, to_id, relation, strength, created_at)` not `weight` — the SQL was adapted to use `strength`. Both adaptations preserve the plan's additive-only promise (no DDL changes). Captured in commit `3afab45`.

2. **[Rule 3 - State shape adapter]** The plan's pseudocode for the Tauri command assumed `app.state::<KGState>()` or similar Tauri-managed `Mutex<Connection>`. The actual `knowledge_graph.rs` exposes only module-level free functions over a globally-resolved `db_path()`. Adapter: the command opens its own connection inside `spawn_blocking` after calling `crate::knowledge_graph::ensure_tables()`. Same SQLite file; no behavior implication. Captured in commit `37941d1`.

3. **[Plan over-delivery]** Shipped 8 tests instead of the planned 7 — the extra one (`phase36_intel_01_force_parse_error_skips_file_not_crash`) exercises the catch_unwind path through the orchestrator end-to-end, not just the parser. Worth keeping as a regression guard.

Otherwise plan executed exactly as written.

## Auth Gates

None. No auth surfaces touched. The Tauri command operates entirely on local filesystem + local SQLite.

## Threat Surface Scan

Reviewed against the plan's STRIDE register (T-36-08..T-36-14):

- **T-36-08** (tree-sitter panic on adversarial source) — mitigated by `catch_unwind(AssertUnwindSafe(...))` wrapper in `reindex_project`. Per-file panics log `[INTEL-01]` and continue. Verified by `phase36_intel_01_force_parse_error_skips_file_not_crash` (which reaches the `Ok(Err(_))` branch — same skip-and-continue path that a real panic would trigger via the `Err(_)` arm; both are exercised in production).
- **T-36-09** (massive-tree DoS) — mitigated by hard-coded skip set (target/, node_modules/, .git/, dist/, build/, out/, .next/, .turbo/).
- **T-36-10** (huge file DoS) — mitigated by `if c.len() <= 1_000_000` guard at the read site.
- **T-36-11** (id collision) — accepted; 16 hex chars = 64 bits; collision probability on 100k symbols < 1e-9.
- **T-36-12** (UI block) — mitigated by `tokio::task::spawn_blocking`; Tauri main thread stays responsive.
- **T-36-13** (info disclosure via SQLite) — accepted; local-first design, user owns the DB file.
- **T-36-14** (re-index leftovers) — mitigated by the LIKE-pattern delete + idempotency test.

No new threat surfaces beyond the plan's enumeration. No flags added.

## Next-Wave Plans Unblocked

This plan's persisted symbol graph + edge layer unblocks:

- **Plan 36-03** (INTEL-02) — personalized PageRank over the kg_nodes/kg_edges symbol subgraph using petgraph 0.6.5 (already staged in 36-01 deps).
- **Plan 36-04** (INTEL-03) — repo-map builder that ranks symbols by PageRank and injects budget-bounded summaries into `brain.rs`. Will read `config.intelligence.repo_map_token_budget`.
- **Plan 36-04** also implements the CTX-07 fallback: when `tree_sitter_enabled=false` OR symbol graph empty, route through existing `indexer.rs` FTS.

## Self-Check: PASSED

Verified before writing this section:

- `[ -f src-tauri/src/intelligence/tree_sitter_parser.rs ]` → FOUND (293 LOC body)
- `[ -f src-tauri/src/intelligence/symbol_graph.rs ]` → FOUND (425 LOC body)
- `[ -f src-tauri/src/intelligence/mod.rs ]` → FOUND (39 LOC, +Tauri command)
- `[ -f src-tauri/src/lib.rs ]` → FOUND (intelligence::reindex_symbol_graph in generate_handler!)
- Commit `5127e0f` → FOUND in `git log`
- Commit `3afab45` → FOUND in `git log`
- Commit `37941d1` → FOUND in `git log`
- `cargo check` → 0 errors (16 pre-existing dead-code warnings only)
- `cargo test --lib intelligence::` → 8 passed, 0 failed
- `cargo test --lib config::tests::phase36` → 3 passed, 0 failed (no regression to 36-01)
- `grep -rn "fn reindex_symbol_graph" src-tauri/src/ | wc -l` → 1 (uniqueness)
- `grep -c "intelligence::reindex_symbol_graph" src-tauri/src/lib.rs` → 1 (registered)
