---
phase: 36-context-intelligence
plan: 4
subsystem: intelligence/repo-map-injection
tags: [intelligence, repo-map, prompt-injection, catch-unwind, code-section-gate, tree-sitter, pagerank]
status: complete
dependency_graph:
  requires:
    - "Phase 36-01 IntelligenceConfig (tree_sitter_enabled toggle, repo_map_token_budget, pagerank_damping)"
    - "Phase 36-01 intelligence/ module scaffold (mod.rs + repo_map.rs stub)"
    - "Phase 36-02 SymbolNode + SymbolKind (rendered into the map output)"
    - "Phase 36-02 kg_nodes/kg_edges schema (degree-centrality fallback queries)"
    - "Phase 32-03 code-section gate in build_system_prompt_inner (score_or_default(query, 'code', 1.0) > gate)"
    - "Phase 32-06 LAST_BREAKDOWN + record_section helper (DoctorPane integration)"
  provides:
    - "intelligence::repo_map::build_repo_map(query, mentions, token_budget, config, conn) -> Option<String>"
    - "intelligence::repo_map::harvest_mentioned_symbols(query, recent_messages) -> Vec<String>"
    - "intelligence::repo_map::render_map(rows, token_budget) -> String"
    - "intelligence::repo_map::INTEL_FORCE_PAGERANK_RESULT thread_local seam"
    - "brain.rs repo-map injection branch at the code-section gate (handled_by_repo_map flag suppresses FTS when map ships)"
    - "LAST_BREAKDOWN 'repo_map' label (always recorded, 0 when gate closed or fallback fired)"
  affects:
    - "src-tauri/src/intelligence/repo_map.rs (substrate stub -> 528 LOC implementation)"
    - "src-tauri/src/brain.rs (build_system_prompt_inner gains repo-map branch + record_section('repo_map'))"
tech_stack:
  used:
    - "regex 1 (RUST_IDENT_RE + PASCAL_RE compiled once via once_cell::Lazy)"
    - "rusqlite 0.39 (kg_nodes/kg_edges degree-centrality SELECT with LEFT JOIN)"
    - "serde_json 1 (SymbolNode payload deserialization from kg_nodes.description)"
    - "std::panic::catch_unwind(AssertUnwindSafe(...)) at brain.rs call site"
  patterns:
    - "thread_local Cell<Option<Vec<...>>> test seam (mirrors INTEL_FORCE_PARSE_ERROR + DECOMP_FORCE_STEP_COUNT)"
    - "chars/4 token approximation (Phase 32 precedent)"
    - "Token budget bounded at consumer site to <= 0.10 * model_context_length (CONTEXT.md lock §IntelligenceConfig)"
    - "Truncation marker '[N more symbols omitted]' with reserved 40-char tail in render_map"
    - "Common-stopword filter for harvest false positives (the/and/you/etc.)"
    - "Dispatcher fn rank_symbols_or_fallback hides Plan 36-03's pagerank symbol presence/absence behind a one-line swap"
key_files:
  modified:
    - "src-tauri/src/intelligence/repo_map.rs (+526 LOC)"
    - "src-tauri/src/brain.rs (+196 LOC: 65 implementation + 131 tests)"
decisions:
  - "Decoupled from Plan 36-03's pagerank::rank_symbols via a private dispatcher (rank_symbols_or_fallback). At ship time the dispatcher's production path falls through to a SQL-based degree-centrality fallback (LEFT JOIN on kg_edges); once 36-03 lands `super::pagerank::rank_symbols`, the swap is a one-line change. This kept Plan 36-04 atomically ship-able even though pagerank.rs was still in flight in the working tree."
  - "INTEL_FORCE_PAGERANK_RESULT seam declared in repo_map.rs (gated #[cfg(test)]) — repo_map owns the test contract for build_repo_map's behavior, so the seam belongs there. When 36-03 ships its own seam in pagerank.rs, repo_map's seam continues to drive build_repo_map regardless of which pagerank backend the dispatcher routes to."
  - "harvest_mentioned_symbols emits query mentions twice into the ordered output (HashSet dedups uniqueness, but the personalization vector signal sees the 2x weight via duplicate appearances). Test asserts query_count == 2, recent_count == 1."
  - "Stopword list filters Rust-ident matches only when the token has no '::' separator. Path syntax like `crate::utils` survives unconditionally because `::`-bearing matches are unlikely to be common-English false positives."
  - "render_map reserves 40 chars for the truncation marker so the marker can always append cleanly when rows are dropped. Marker omitted when no rows are dropped."
  - "brain.rs token-budget bound uses literal 200_000 ceiling because providers::context_length_for(provider, model) does not exist at 36-04 ship time. Plan 36-05 (canonical_models.json + capability_registry) is the natural home for that helper; once it lands, swap the literal for the real helper call."
  - "build_repo_map opens its own SQLite connection via blade_config_dir().join('blade.db') — same pattern as memory_l0 in build_system_prompt_inner higher up. brain.rs is a pure function with no Tauri State access, so lifting a conn through every caller would be heavily invasive for a one-call use."
  - "recent_messages stays empty in 36-04 because build_system_prompt_inner has no conversation-history accessor in its signature. harvest runs on the current query alone — still yields meaningful mentions for the personalization vector. A future plan can lift recent_messages through if the empirical signal is too weak (Plan 36-04 doesn't pre-judge)."
  - "FTS code section suppression is one-directional: handled_by_repo_map=true skips the FTS block. The reverse (FTS injects when repo map fails) is automatic via the same flag (default false → FTS runs unchanged on None/panic/disabled-toggle)."
  - "record_section('repo_map', N) runs AFTER both branches unconditionally. When the gate closes or repo_map_chars=0, the label still appears in LAST_BREAKDOWN with 0 chars, so DoctorPane can render the row deterministically per call."
metrics:
  duration_minutes: 22
  tasks_completed: 2
  files_modified: 2
  commits: 2
  tests_added: 10
  tests_pass: "10/10"
  cargo_check_errors: 0
completed_date: "2026-05-07"
requirements_addressed: [INTEL-03]
---

# Phase 36 Plan 36-04: repo map injection at the code-section gate (INTEL-03) Summary

**One-liner:** Lands INTEL-03 — `intelligence::repo_map::build_repo_map` produces a budget-bounded `REPO MAP` prompt section, and `brain.rs::build_system_prompt_inner` injects it at the existing Phase 32 code-section gate (catch_unwind-wrapped), suppressing the FTS code section to avoid double-injection. Decoupled from Plan 36-03's PageRank via a one-line dispatcher swap so Plan 36-04 ships atomically.

## Tests Added (all 10 green)

```
running 7 tests (intelligence::repo_map)
test phase36_intel_03_repo_map_includes_top_symbols          ... ok
test phase36_intel_03_repo_map_respects_token_budget          ... ok
test phase36_intel_03_force_seam_drives_build_repo_map        ... ok
test phase36_intel_03_repo_map_truncation_marker              ... ok
test phase36_intel_03_repo_map_returns_none_when_disabled     ... ok
test phase36_intel_03_harvest_dedups_and_weights_query_2x     ... ok
test phase36_intel_03_repo_map_returns_none_on_empty_graph    ... ok
test result: ok. 7 passed; 0 failed; 0 ignored

running 3 tests (brain::tests)
test phase36_intel_03_brain_injects_repo_map_at_code_gate     ... ok
test phase36_intel_03_brain_records_repo_map_label            ... ok
test phase36_intel_03_brain_skips_when_smart_off              ... ok
test result: ok. 3 passed; 0 failed; 0 ignored
```

Plan asked for 6 + 2 = 8 tests; shipped 7 + 3 = 10 (added `phase36_intel_03_brain_records_repo_map_label` for the always-emit-the-row contract that DoctorPane depends on, plus `phase36_intel_03_force_seam_drives_build_repo_map` as an end-to-end seam round-trip in repo_map.rs itself rather than only via brain.rs).

Phase 32 regression check (24/24 pass):

```
running 24 tests
test brain::tests::phase32_section_gate_simple_query             ... ok
test brain::tests::phase32_breakdown_records_per_section          ... ok
test brain::tests::phase32_breakdown_clears_each_call              ... ok
test brain::tests::phase32_breakdown_simple_query_omits_vision     ... ok
test brain::tests::phase32_section_gate_always_keep_core_present  ... ok
... (19 more, all ok)
test result: ok. 24 passed; 0 failed
```

No FTS code-section regression: `phase32_section_gate_always_keep_core_present` and `phase32_section_gate_simple_query` still hold.

## brain.rs signature (recorded — no new param needed)

```rust
fn build_system_prompt_inner(
    tools: &[McpTool],
    user_query: &str,
    vector_store: Option<&crate::embeddings::SharedVectorStore>,
    tier: &ModelTier,
    provider: &str,
    model: &str,
    message_count: usize,
) -> String;
```

The plan-level `<interfaces>` block flagged a possible new `kg_conn` param. Not needed: `build_system_prompt_inner` already opens its own SQLite connection (`crate::config::blade_config_dir().join("blade.db")`) for the L0-facts memory load, so the repo-map branch follows that idiom verbatim:

```rust
let kg_db = crate::config::blade_config_dir().join("blade.db");
let map_opt = match rusqlite::Connection::open(&kg_db) {
    Ok(conn) => std::panic::catch_unwind(AssertUnwindSafe(|| {
        crate::intelligence::repo_map::build_repo_map(
            user_query, &mentions, bounded_budget, &config, &conn)
    })).unwrap_or_else(|_| {
        log::warn!("[INTEL-03] repo map builder panicked; falling through to FTS");
        None
    }),
    Err(e) => {
        log::debug!("[INTEL-03] kg conn open failed ({e}); skipping repo map");
        None
    }
};
```

Zero invasive caller-lift; same pattern as the existing memory_l0 branch.

## providers::context_length_for status (recorded)

`providers::context_length_for(provider, model)` does **not** exist at Plan 36-04 ship time. `grep -rn "context_length_for\|ContextLength\|context_window" src/providers/ src/router.rs` returns only one match (a `context_window: 128_000` literal in `router.rs`). The repo-map branch uses a literal `200_000` as a conservative ceiling for the 10% bound:

```rust
let model_ctx: u32 = 200_000;
let bounded_budget = config.intelligence.repo_map_token_budget
    .min(((model_ctx as f32) * 0.10) as u32);
```

For the default `repo_map_token_budget = 1000`, `min(1000, 20_000) = 1000` — the literal cap is never the binding constraint at default settings, so the loose ceiling has zero observable effect today. Plan 36-05 (canonical_models.json + capability_registry) is the natural home for the real `context_length_for` helper; once it lands, swap the literal at `src-tauri/src/brain.rs:1389` for the real call.

## Code-section gate location

Stable at line 1369 of `brain.rs` (`if !smart || (!user_query.is_empty() && score_or_default(user_query, "code", 1.0) > gate)`). No location quirks across recent commits. The repo-map branch wraps this site by precomputing `code_gate_open` once and threading it through both branches — the existing FTS block is functionally unchanged, just behind the `!handled_by_repo_map` flag.

## INTEL_FORCE_PAGERANK_RESULT seam

```rust
#[cfg(test)]
thread_local! {
    pub static INTEL_FORCE_PAGERANK_RESULT: std::cell::Cell<Option<Vec<(SymbolNode, f32)>>>
        = const { std::cell::Cell::new(None) };
}
```

Lives in `repo_map.rs` (NOT `pagerank.rs`) because:
1. Plan 36-03 was still in flight in the working tree at 36-04 commit time — touching pagerank.rs would have collided.
2. Repo_map owns the contract for `build_repo_map`'s behavior; whether the symbols come from real PageRank or the cold-start fallback is a dispatcher concern, but the seam should drive `build_repo_map` end-to-end regardless.

When 36-03's own pagerank seam lands, this one stays — it's a higher-level test contract.

## Decoupling from Plan 36-03

The plan-locked production call site is `super::pagerank::rank_symbols(query, mentions, damping, conn)`. At Plan 36-04 ship time, that symbol may or may not exist in tree (Plan 36-03 runs in parallel). The dispatcher resolves this:

```rust
fn rank_symbols_or_fallback(
    _query: &str,
    mentioned_symbols: &[String],
    _damping: f32,
    conn: &Connection,
) -> Vec<(SymbolNode, f32)> {
    #[cfg(test)] {
        let forced = INTEL_FORCE_PAGERANK_RESULT.with(|c| c.take());
        if let Some(rows) = forced { /* re-set + return */ return rows; }
    }
    // Once Plan 36-03 ships, replace this branch with:
    //     return super::pagerank::rank_symbols(query, mentioned_symbols, damping, conn);
    rank_by_degree_centrality(mentioned_symbols, conn)
}
```

The fallback (`rank_by_degree_centrality`) is a SQL-only path: LEFT JOIN on `kg_edges` to count inbound edges per symbol, +2.0 boost when the symbol's name appears in the mentions list, normalized so the top score sits in roughly the same `0..1` band as PageRank output. Returns `Vec::new()` on any SQL error (preserves the "no graph data → None" contract at `build_repo_map`).

This means Plan 36-04 ships a real, working repo map even with Plan 36-03 absent — the production path uses degree centrality until 36-03 swaps the dispatcher's body.

## Suppression / no-double-injection contract

```rust
let mut handled_by_repo_map = false;
if code_gate_open && config.intelligence.tree_sitter_enabled { ... handled = true; }
if !handled_by_repo_map && code_gate_open {
    // EXISTING Phase 32 FTS code section — UNCHANGED
}
record_section("repo_map", repo_map_chars);
```

Three concrete behaviors verified by tests:

| Scenario | Repo map | FTS code section | LAST_BREAKDOWN.repo_map |
|----------|----------|------------------|-------------------------|
| Code query + tree_sitter_enabled=true + map renders | Inject | **Suppressed** | > 0 |
| Code query + tree_sitter_enabled=true + map = None  | Skip   | Inject (Phase 32 baseline) | 0 |
| Code query + tree_sitter_enabled=false              | Skip   | Inject (Phase 32 baseline) | 0 |
| Non-code query (gate closed)                        | Skip   | Skip (gate closed)          | 0 |

`phase36_intel_03_brain_skips_when_smart_off` exercises row 4; `phase36_intel_03_brain_injects_repo_map_at_code_gate` exercises row 1; rows 2 and 3 are tested transitively by `phase36_intel_03_repo_map_returns_none_*` in repo_map.rs (the contract chain: build_repo_map returns None → handled_by_repo_map stays false → FTS runs).

## Render format (locked)

```text
REPO MAP (top symbols by relevance, ~1000 tokens budget):
src-tauri/src/commands.rs::send_message_stream_inline (function, score=0.142)
src-tauri/src/brain.rs::build_system_prompt_inner (function, score=0.118)
[N more symbols omitted]
```

- 3-decimal score precision (`{:.3}`)
- `kind` ∈ `function | type | module | constant`
- Truncation marker emitted only when rows are dropped; reserves 40 chars of budget so it always fits cleanly
- Header counts toward the budget (so a tiny budget can return `""` and `build_repo_map` returns None)

## STRIDE threats addressed

| Threat ID | Mitigation Implementation |
|-----------|---------------------------|
| T-36-21 (DoS via 200 entries × 80 chars) | `render_map` tracks `out.len() + line.len() + marker_reserve` against `char_budget` and breaks early. Bound test: `phase36_intel_03_repo_map_respects_token_budget` (50-token budget output ≤ 200 chars). |
| T-36-23 (DoS via 100k message history)  | `harvest_mentioned_symbols` clamps to `recent_messages.iter().take(10)`. |
| T-36-24 (DoS via render panic)          | brain.rs wraps the call in `std::panic::catch_unwind(AssertUnwindSafe(...))`; on panic, `unwrap_or_else(|_| { log::warn!(...); None })` falls through to FTS. |
| T-36-26 (Tampering via double injection)| `handled_by_repo_map` flag suppresses the FTS block when the map ships. Locked: `if !handled_by_repo_map && code_gate_open { ... FTS ... }`. |

## Commits

| Hash | Message |
|------|---------|
| `0d3cc86` | feat(36-04): fill repo_map.rs with build_repo_map + harvester + renderer (INTEL-03) |
| `fa416a2` | feat(36-04): inject repo map at code-section gate in brain.rs (INTEL-03) |

2 atomic commits, one per task, each `git add <specific path>` only — the 188 pre-existing staged-deletion entries in `.planning/phases/...` were NOT swept in.

## Deviations from Plan

**1. [Rule 2 — Decoupled call site]** Plan locked `super::pagerank::rank_symbols(...)` at the call site. Plan 36-03 was uncommitted in the working tree at 36-04 commit time; the dispatcher (`rank_symbols_or_fallback` with cold-start degree-centrality fallback) keeps the implementation correct in both states. The swap to real PageRank is a one-line change once 36-03 lands.

**2. [Rule 2 — Always-emit `repo_map` label]** Plan acceptance criteria asked for `record_section("repo_map", N)` only on the inject path. Shipped as always-emit with N=0 when gate is closed or fallback fired so DoctorPane can render the row deterministically. Added a third brain test (`phase36_intel_03_brain_records_repo_map_label`) to lock this behavior.

**3. [Rule 3 — `recent_messages` accessor absent]** Plan called for "last 10 messages from existing accessor". `build_system_prompt_inner` does not take or expose conversation history. Shipped with `recent_text: Vec<&str> = Vec::new()` (harvest from current query alone). Acceptable v1 behavior — the personalization vector still gets a 2x-weighted query signal. Future plan can lift recent_messages through.

**4. [Rule 3 — `providers::context_length_for` absent]** Plan referenced this helper. It doesn't exist; shipped with literal `200_000` ceiling. At default 1000-token budget the literal is non-binding. Plan 36-05 should land the real helper.

## Pre-existing failure note (not caused by this plan)

`intelligence::pagerank::tests::phase36_intel_02_pagerank_cache_invalidates_after_5_min` panicked when running `cargo test --lib intelligence::`. Root cause is in `pagerank.rs:550` — owned by Plan 36-03, which was uncommitted in the working tree at 36-04 commit time. Plan 36-04's test surface is fully green (10/10).

## Self-Check: PASSED

- File `src-tauri/src/intelligence/repo_map.rs` exists (526 LOC).
- File `src-tauri/src/brain.rs` modified at the code-section gate (verified by `grep -n "build_repo_map\|repo_map_chars\|handled_by_repo_map" src/brain.rs` → 9 hits).
- Commit `0d3cc86` present in `git log --oneline`.
- Commit `fa416a2` present in `git log --oneline`.
- All 10 phase36_intel_03_* tests green (7 in repo_map + 3 in brain).
- Phase 32 regression: 24/24 brain tests green.

## Links to next plans

- **Plan 36-03** (INTEL-02 personalized PageRank with petgraph) — running in parallel; once it lands `super::pagerank::rank_symbols`, swap the body of `repo_map::rank_symbols_or_fallback`'s fallthrough branch from `rank_by_degree_centrality(...)` to `super::pagerank::rank_symbols(query, mentions, damping, conn)` — one-line change.
- **Plan 36-05** (INTEL-04 + INTEL-05 canonical_models.json + capability_registry loader) — natural home for `providers::context_length_for(provider, model)` helper; swap the literal `200_000` at `src-tauri/src/brain.rs` once the helper exists.
- **Plan 36-06** (router.rs consumption) — first downstream consumer of the capability_registry loaded by 36-05.
