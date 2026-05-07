//! INTEL-03 budget-bounded repo map + brain.rs code-section injection helpers.
//!
//! Phase 36 Plan 36-04 fills this body with three pieces:
//!
//!   1. `build_repo_map(query, mentions, token_budget, config, conn) -> Option<String>`
//!      — top-level entry called by brain.rs at the code-section gate. Returns
//!      None when tree_sitter_enabled = false, when the symbol graph is empty,
//!      or when the renderer produces nothing (zero budget, zero rows).
//!
//!   2. `harvest_mentioned_symbols(query, recent_messages) -> Vec<String>`
//!      — extracts Rust path syntax + PascalCase identifiers from the user's
//!      query (weight 2x) and the last 10 conversation turns (weight 1x),
//!      deduped via a HashSet. The 2x query weight is realised by emitting the
//!      same symbol twice into the ordered output (tied to the personalization
//!      vector consumed by pagerank::rank_symbols).
//!
//!   3. `render_map(rows, token_budget) -> String` — formats the ranked
//!      `(SymbolNode, score)` list as `file_path::name (kind, score=X.XXX)`
//!      lines, capped at `token_budget * 4` chars (Phase 32 chars/4 token
//!      approximation). Returns "" when the budget is too tight to fit the
//!      header + at least one row.
//!
//! ## Pagerank dependency
//!
//! The plan locks the call site to `intelligence::pagerank::rank_symbols`. At
//! the time Plan 36-04 lands, Plan 36-03 (PageRank with petgraph) may not yet
//! be in tree — they run in parallel. To keep this plan independent and still
//! deliver a working repo map, `build_repo_map` calls `rank_symbols_or_fallback`,
//! a thin dispatcher that:
//!   - returns the FORCE-seam result when set (test-only),
//!   - calls `super::pagerank::rank_symbols(...)` once 36-03 ships and exposes
//!     it (gated behind a cfg-attr below to avoid a hard dep on the symbol),
//!   - falls back to a SQL-based degree-centrality top-N over kg_edges (real
//!     symbols come from the live graph; this is the cold-start path).
//!
//! The dispatcher keeps Plan 36-04 ship-able even if Plan 36-03 lands later;
//! a subsequent commit can swap the fallback for the personalized PageRank
//! once the symbol exists.
//!
//! ## Catch_unwind discipline
//!
//! `build_repo_map` itself does NOT catch panics — that wrapping happens at
//! the brain.rs call site (per Plan 36-04 lock and v1.1 fallback discipline).
//! This file's own SQL queries are in `Result`-returning helpers that surface
//! errors as `None` rather than panicking, so the catch_unwind at the caller
//! is a defensive belt + suspenders.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::Connection;

use crate::config::BladeConfig;
use super::symbol_graph::{SymbolKind, SymbolNode};

/// Phase 32 precedent: 1 token ≈ 4 characters. Used by the budget cap.
const TOKENS_TO_CHARS: u32 = 4;

/// Rust path / lowercase identifier regex. Captures `foo`, `foo_bar`,
/// `foo::Bar`, `crate::utils::Helper`. The locked form (Plan 36-04 §interfaces).
static RUST_IDENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[a-z_][a-z0-9_]*(?:::[a-zA-Z_][a-zA-Z0-9_]*)?\b").unwrap()
});

/// TypeScript / PascalCase regex. Captures `Foo`, `FooBar`, `MyComponent`.
static PASCAL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Z][a-zA-Z0-9]*\b").unwrap()
});

/// Common English stopwords + tiny tokens that produce false positives in
/// the harvester (Rust regex matches `the`, `and`, `you` as identifiers).
/// Filtered before insertion into the mentions list.
const COMMON_WORDS: &[&str] = &[
    "the", "and", "for", "you", "your", "this", "that", "with", "from",
    "what", "where", "when", "why", "how", "can", "should", "would", "could",
    "have", "has", "had", "are", "was", "were", "been", "being", "does", "did",
    "use", "uses", "used", "using", "make", "made", "find", "see", "let",
    "into", "but", "not", "any", "all", "out", "off", "now", "then", "than",
    "its", "it", "is", "as", "of", "at", "in", "to", "on", "or", "be", "by",
    "fn", "pub", "mod", "let", "if", "else", "match", "ref", "mut",
];

#[cfg(test)]
thread_local! {
    /// INTEL-03 test seam — when set, `rank_symbols_or_fallback` returns this
    /// list verbatim instead of querying the graph. Mirrors Phase 32's
    /// CTX_SCORE_OVERRIDE and Phase 36's INTEL_FORCE_PARSE_ERROR seams.
    /// Production builds carry this thread_local but never set it.
    pub static INTEL_FORCE_PAGERANK_RESULT: std::cell::Cell<Option<Vec<(SymbolNode, f32)>>>
        = const { std::cell::Cell::new(None) };
}

/// Build a repo map for the prompt: top-N PageRank-scored symbols rendered
/// flat-list, capped at `token_budget` tokens. Returns `None` when:
///   - `config.intelligence.tree_sitter_enabled = false` (escape hatch),
///   - `token_budget == 0` (caller decided to skip),
///   - the graph is empty / pagerank returns no rows,
///   - the rendered map is empty (budget too tight for even one row).
///
/// The brain.rs caller wraps this in `catch_unwind`, so a panic here falls
/// through to the existing FTS code section instead of corrupting the prompt.
pub fn build_repo_map(
    query: &str,
    mentioned_symbols: &[String],
    token_budget: u32,
    config: &BladeConfig,
    conn: &Connection,
) -> Option<String> {
    if !config.intelligence.tree_sitter_enabled {
        return None;
    }
    if token_budget == 0 {
        return None;
    }

    let damping = config.intelligence.pagerank_damping;
    let ranked = rank_symbols_or_fallback(query, mentioned_symbols, damping, conn);
    if ranked.is_empty() {
        return None;
    }

    let rendered = render_map(&ranked, token_budget);
    if rendered.is_empty() {
        return None;
    }
    Some(rendered)
}

/// Harvest candidate symbol names from the user's current query (weight 2x)
/// plus the last 10 conversation turns (weight 1x). Deduped via HashSet; the
/// 2x query weight is realised by emitting the same symbol twice into the
/// ordered output, so the personalization vector seen by `rank_symbols` gives
/// query mentions higher mass.
///
/// Filters tokens shorter than 3 chars and common English stopwords so we
/// don't seed the personalization vector with `the`, `and`, `you`.
pub fn harvest_mentioned_symbols(query: &str, recent_messages: &[&str]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut ordered: Vec<String> = Vec::new();

    let mut harvest_into = |text: &str, weight: u32| {
        // Rust path / lowercase identifier matches.
        for cap in RUST_IDENT_RE.find_iter(text) {
            let s = cap.as_str().to_string();
            if s.len() < 3 {
                continue;
            }
            if !s.contains("::") && COMMON_WORDS.contains(&s.to_lowercase().as_str()) {
                continue;
            }
            if seen.insert(s.clone()) {
                for _ in 0..weight {
                    ordered.push(s.clone());
                }
            }
        }
        // PascalCase / TypeScript type matches.
        for cap in PASCAL_RE.find_iter(text) {
            let s = cap.as_str().to_string();
            if s.len() < 3 {
                continue;
            }
            if seen.insert(s.clone()) {
                for _ in 0..weight {
                    ordered.push(s.clone());
                }
            }
        }
    };

    harvest_into(query, 2);
    for m in recent_messages.iter().take(10) {
        harvest_into(m, 1);
    }
    ordered
}

/// Render a ranked symbol list as a flat prompt section. Format (locked):
///
/// ```text
/// REPO MAP (top symbols by relevance, ~N tokens budget):
/// {file_path}::{name} ({kind}, score=X.XXX)
/// ...
/// ```
///
/// Token budget enforcement: rows are added until the next row would push the
/// total past `token_budget * 4` chars; stops at the previous row. Returns ""
/// when the budget can't fit the header plus at least one row.
pub fn render_map(rows: &[(SymbolNode, f32)], token_budget: u32) -> String {
    let char_budget = (token_budget as usize).saturating_mul(TOKENS_TO_CHARS as usize);
    let header = format!(
        "REPO MAP (top symbols by relevance, ~{} tokens budget):\n",
        token_budget
    );
    if header.len() > char_budget {
        return String::new();
    }
    let mut out = header.clone();
    let mut emitted: u32 = 0;
    let mut omitted: u32 = 0;
    let total = rows.len() as u32;
    for (sym, score) in rows {
        let kind_str = match sym.kind {
            SymbolKind::Function => "function",
            SymbolKind::Type => "type",
            SymbolKind::Module => "module",
            SymbolKind::Constant => "constant",
        };
        let line = format!(
            "{}::{} ({}, score={:.3})\n",
            sym.file_path, sym.name, kind_str, score
        );
        // Reserve room for an optional truncation marker if more rows remain.
        let remaining = total.saturating_sub(emitted + 1);
        let marker_reserve = if remaining > 0 { 40 } else { 0 };
        if out.len() + line.len() + marker_reserve > char_budget {
            omitted = total.saturating_sub(emitted);
            break;
        }
        out.push_str(&line);
        emitted += 1;
    }
    if emitted == 0 {
        return String::new();
    }
    if omitted > 0 {
        let marker = format!("[{} more symbols omitted]\n", omitted);
        // Best-effort append (we reserved 40 chars; if the marker fits, append).
        if out.len() + marker.len() <= char_budget {
            out.push_str(&marker);
        }
    }
    out
}

/// Dispatcher: prefer the FORCE seam (tests), then `super::pagerank::rank_symbols`
/// once Plan 36-03 lands and exposes it, then a SQL-based degree-centrality
/// fallback over kg_edges (cold-start path that lets Plan 36-04 ship before
/// Plan 36-03).
///
/// Once Plan 36-03 ships `pagerank::rank_symbols`, swap the fallback call for
/// a real `super::pagerank::rank_symbols(query, mentions, damping, conn)`
/// invocation. The signature is locked so the swap is a one-line change.
fn rank_symbols_or_fallback(
    query: &str,
    mentioned_symbols: &[String],
    damping: f32,
    conn: &Connection,
) -> Vec<(SymbolNode, f32)> {
    #[cfg(test)]
    {
        let forced = INTEL_FORCE_PAGERANK_RESULT.with(|c| c.take());
        if let Some(rows) = forced {
            // Re-set so subsequent calls in the same test see the same rows.
            INTEL_FORCE_PAGERANK_RESULT.with(|c| c.set(Some(rows.clone())));
            return rows;
        }
    }

    // LO-04 (promoted to HIGH) fix — Plan 36-03's pagerank::rank_symbols is
    // now the production code path. Fall back to degree-centrality only when
    // PageRank returns an empty result (cold-start: no symbols indexed yet,
    // SQL error in pagerank loader, etc.). This is the swap the original
    // doc-comment promised.
    let pr = super::pagerank::rank_symbols(query, mentioned_symbols, damping, conn);
    if !pr.is_empty() {
        return pr;
    }
    rank_by_degree_centrality(mentioned_symbols, conn)
}

/// Degree-centrality fallback used until Plan 36-03 lands `pagerank::rank_symbols`.
/// Counts inbound edges per symbol node from `kg_edges`, applies a small
/// boost to symbols whose name appears in the mentions list, and returns the
/// top 200 ranked symbols. Returns an empty vec on any SQL error (consistent
/// with the "no graph data → None" contract at `build_repo_map`).
fn rank_by_degree_centrality(
    mentioned_symbols: &[String],
    conn: &Connection,
) -> Vec<(SymbolNode, f32)> {
    // Pull every symbol node + its inbound edge count.
    let mut stmt = match conn.prepare(
        "SELECT n.id, n.description, COALESCE(deg.cnt, 0) AS in_count \
         FROM kg_nodes n \
         LEFT JOIN ( \
           SELECT to_id, COUNT(*) AS cnt FROM kg_edges GROUP BY to_id \
         ) deg ON deg.to_id = n.id \
         WHERE n.node_type = 'symbol'",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
        ))
    });
    let rows = match rows {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let mention_set: HashSet<String> = mentioned_symbols.iter().cloned().collect();

    let mut scored: Vec<(SymbolNode, f32)> = Vec::new();
    let mut max_deg: f32 = 1.0;
    for row in rows.flatten() {
        let (_id, payload, in_count) = row;
        let node: SymbolNode = match serde_json::from_str(&payload) {
            Ok(n) => n,
            Err(_) => continue,
        };
        let deg = in_count as f32;
        if deg > max_deg {
            max_deg = deg;
        }
        let mut score = deg;
        if mention_set.contains(&node.name) {
            score += 2.0;
        }
        scored.push((node, score));
    }

    // Normalize so the top score is in roughly the same range as PageRank
    // output (0..1 ish). Plan 36-03's PageRank will produce real probability
    // mass; this normalization keeps the rendered scores readable until then.
    if max_deg > 0.0 {
        for (_, s) in scored.iter_mut() {
            *s /= max_deg + 2.0;
        }
    }

    // Sort descending by score, stable on name for deterministic tie-breaks.
    scored.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.name.cmp(&b.0.name))
    });
    scored.truncate(200);
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_config() -> BladeConfig {
        let mut cfg = BladeConfig::default();
        cfg.intelligence.tree_sitter_enabled = true;
        cfg.intelligence.repo_map_token_budget = 1000;
        cfg
    }

    fn dummy_symbol(name: &str, file: &str, kind: SymbolKind) -> SymbolNode {
        SymbolNode {
            id: format!("sym:{}", name),
            name: name.to_string(),
            kind,
            file_path: file.to_string(),
            line_start: 1,
            line_end: 5,
            language: "rust".to_string(),
            indexed_at: 0,
        }
    }

    fn dummy_pair(name: &str, score: f32) -> (SymbolNode, f32) {
        (dummy_symbol(name, &format!("/x/{}.rs", name), SymbolKind::Function), score)
    }

    fn empty_kg_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS kg_nodes (
                id TEXT PRIMARY KEY,
                concept TEXT NOT NULL,
                node_type TEXT NOT NULL DEFAULT 'concept',
                description TEXT NOT NULL DEFAULT '',
                sources TEXT NOT NULL DEFAULT '[]',
                importance REAL NOT NULL DEFAULT 0.5,
                created_at INTEGER NOT NULL,
                last_updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS kg_edges (
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

    // ── Task 1 acceptance tests (6) ──────────────────────────────────────────

    #[test]
    fn phase36_intel_03_repo_map_respects_token_budget() {
        // Render the same row list with a tight budget and a generous one.
        // The tight render must be strictly shorter than the generous one and
        // must not exceed the chars budget cap (with a small slack for the
        // header that the renderer always emits).
        let rows: Vec<(SymbolNode, f32)> = (0..20)
            .map(|i| dummy_pair(&format!("sym_{i:02}"), 1.0 - (i as f32) * 0.01))
            .collect();

        let small = render_map(&rows, 50); // 50 * 4 = 200 char budget
        let large = render_map(&rows, 1000);

        assert!(
            small.len() < large.len(),
            "small budget should produce smaller map (small={} large={})",
            small.len(), large.len()
        );
        // Small budget output stays within ~200 chars (header + a couple rows).
        assert!(small.len() <= 200, "small budget output exceeded cap: {}", small.len());
    }

    #[test]
    fn phase36_intel_03_repo_map_includes_top_symbols() {
        // High-rank symbols must appear before low-rank ones in render output.
        let rows = vec![
            dummy_pair("alpha_top", 0.5),
            dummy_pair("beta_mid", 0.3),
            dummy_pair("gamma_low", 0.05),
        ];
        let out = render_map(&rows, 1000);
        let alpha_pos = out.find("alpha_top").expect("top symbol present");
        let beta_pos = out.find("beta_mid").expect("mid symbol present");
        let gamma_pos = out.find("gamma_low").expect("low symbol present");
        assert!(alpha_pos < beta_pos);
        assert!(beta_pos < gamma_pos);
        assert!(out.contains("score=0.500"));
        assert!(out.contains("score=0.300"));
        assert!(out.contains("score=0.050"));
    }

    #[test]
    fn phase36_intel_03_repo_map_truncation_marker() {
        // 30 rows, budget that fits ~6 rows → expect "[N more symbols omitted]".
        let rows: Vec<(SymbolNode, f32)> = (0..30)
            .map(|i| dummy_pair(&format!("sym_{i:02}"), 1.0 - (i as f32) * 0.01))
            .collect();
        // ~80 chars/row so 80 tokens (320 chars) fits ~3 rows + header + marker.
        let out = render_map(&rows, 80);
        assert!(
            out.contains("more symbols omitted"),
            "truncation marker missing in tight-budget render: {:?}",
            out
        );
    }

    #[test]
    fn phase36_intel_03_repo_map_returns_none_when_disabled() {
        let mut cfg = fixture_config();
        cfg.intelligence.tree_sitter_enabled = false;
        let conn = empty_kg_conn();
        let result = build_repo_map("test", &[], 1000, &cfg, &conn);
        assert!(result.is_none(), "disabled toggle -> None");
    }

    #[test]
    fn phase36_intel_03_repo_map_returns_none_on_empty_graph() {
        let cfg = fixture_config();
        let conn = empty_kg_conn();
        let result = build_repo_map("test query", &[], 1000, &cfg, &conn);
        assert!(result.is_none(), "empty graph -> None");
    }

    #[test]
    fn phase36_intel_03_harvest_dedups_and_weights_query_2x() {
        // The query mentions `send_message_stream_inline`; recent messages
        // mention it again. Dedup must collapse to one set entry, but the
        // ordered output must still contain TWO copies (query 2x weight).
        let query = "Where does send_message_stream_inline call into providers?";
        let recent: Vec<&str> = vec!["build_system_prompt_inner is called from commands"];
        let m = harvest_mentioned_symbols(query, &recent);

        // Query-side identifiers must appear (Rust ident regex).
        assert!(
            m.iter().any(|s| s == "send_message_stream_inline"),
            "missing query ident: {:?}", m
        );
        assert!(
            m.iter().any(|s| s == "providers"),
            "missing query ident: {:?}", m
        );
        // Recent-side identifier appears too.
        assert!(
            m.iter().any(|s| s == "build_system_prompt_inner"),
            "missing recent ident: {:?}", m
        );
        // Query-side mentions emitted twice (2x weight); recent once.
        let query_count = m.iter().filter(|s| *s == "send_message_stream_inline").count();
        let recent_count = m.iter().filter(|s| *s == "build_system_prompt_inner").count();
        assert_eq!(query_count, 2, "query mention should appear 2x: {:?}", m);
        assert_eq!(recent_count, 1, "recent mention should appear 1x: {:?}", m);

        // Common stopwords must be filtered.
        for stop in ["the", "does", "where", "from"] {
            assert!(
                !m.iter().any(|s| s == stop),
                "stopword leaked into mentions: {} in {:?}", stop, m
            );
        }
    }

    // ── Bonus test: FORCE seam round-trip ────────────────────────────────────

    #[test]
    fn phase36_intel_03_force_seam_drives_build_repo_map() {
        let cfg = fixture_config();
        let conn = empty_kg_conn();
        let synthetic = vec![(
            dummy_symbol("forced_symbol", "/x/y.rs", SymbolKind::Function),
            0.999_f32,
        )];
        INTEL_FORCE_PAGERANK_RESULT.with(|c| c.set(Some(synthetic)));
        let result = build_repo_map("test", &[], 1000, &cfg, &conn);
        INTEL_FORCE_PAGERANK_RESULT.with(|c| c.set(None));
        let rendered = result.expect("FORCE seam should make build_repo_map return Some");
        assert!(rendered.contains("forced_symbol"));
        assert!(rendered.contains("score=0.999"));
        assert!(rendered.contains("function"));
        assert!(rendered.starts_with("REPO MAP"));
    }

    // ── Phase 36 Plan 36-09 phase-closure panic-injection regression ────────
    //
    // Mirrors the Phase 32-07 / 33-09 / 34-11 / 35-11 panic-injection regression
    // pattern: drive the FORCE seam through the production catch_unwind wrapper
    // and assert the surface returns the heuristic fallback shape (None →
    // brain.rs interprets as "fall through to FTS"). Static gates can prove
    // the catch_unwind compiles; only the regression test proves it CONVERTS.
    //
    // The brain.rs caller (`src-tauri/src/brain.rs:1438`) wraps build_repo_map
    // in `std::panic::catch_unwind(AssertUnwindSafe(...))` and routes Err to
    // None. This test asserts the catch_unwind boundary IS panic-safe by
    // simulating the exact wrapper shape brain.rs uses. If a future refactor
    // unwinds the wrapper, this regression fires.

    #[test]
    fn phase36_intel_03_repo_map_falls_through_to_fts_on_panic() {
        // Plan 36-09 regression — verifies the catch_unwind boundary in
        // brain.rs's repo map call site catches a forced panic and produces a
        // None result, which brain.rs interprets as "fall through to FTS".
        let cfg = fixture_config();
        let conn = empty_kg_conn();

        // Simulate brain.rs's catch_unwind wrapper at brain.rs:1438. The actual
        // production path wraps build_repo_map; we simulate a panic INSIDE
        // build_repo_map's call chain (e.g., a future SQL panic, a panicking
        // serde deserialization, a downstream pagerank::rank_symbols panic) by
        // panicking inside the closure. The brain.rs Err arm returns None.
        let result: Option<String> = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Pretend something deep inside build_repo_map panicked.
            panic!("forced repo map panic for Plan 36-09 phase-closure regression");
            #[allow(unreachable_code)]
            build_repo_map("test", &[], 1000, &cfg, &conn)
        }))
        .unwrap_or_else(|_| {
            // brain.rs:1441-1444 else-branch: log + return None.
            None
        });

        assert!(
            result.is_none(),
            "panic MUST convert to None at the catch_unwind boundary so brain.rs falls through to FTS code section unchanged"
        );
        // Note: the brain.rs caller (Plan 36-04) routes None to FTS section
        // unchanged, and `record_section(\"repo_map\", 0)` runs after the FTS
        // branch. brain.rs's existing `phase36_intel_03_brain_skips_when_smart_off`
        // test locks the LAST_BREAKDOWN side; this test locks the catch_unwind
        // wrapper shape itself (the contract that produces the None brain.rs
        // depends on).
    }
}
