//! Phase 16 / EVAL-03 (synthetic).
//!
//! Hand-picked 4-dim embeddings + scripted scenarios verify the RRF fusion
//! math without invoking the real fastembed model. Floor: top-3 ≥ 80% +
//! MRR ≥ 0.6 across the 8 asserted scenarios. The 4 relaxed fixtures
//! (1 stop-words noise + 3 adversarial: long content, unicode CJK+emoji,
//! near-duplicate Tuesday/Wednesday pair) are surfaced `relaxed: true`
//! per RESEARCH §7 EVAL-03 — they appear in the table but are excluded
//! from floor math in this iteration.
//!
//! Run with: `cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1`
//!
//! Source: this file is the relocated `mod memory_recall_eval` from
//! `embeddings.rs:496-728` (commit 9c5674a 2026-04-28 baseline). Helpers
//! are now centralized in `super::harness`. The original block in
//! `embeddings.rs` is intentionally left in place — Plan 16-07 deletes it
//! after all Wave 2 evals are proven green.

use super::harness::{
    print_eval_table, reciprocal_rank, summarize, temp_blade_env, top1_hit, topk_hit, EvalRow,
};
use crate::embeddings::{SearchResult, VectorStore};

// ────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────

/// Fixture entry — a fake "memory" with a hand-crafted embedding.
/// Embeddings are tiny (4-dim) so each axis represents a domain:
/// [code, personal, work, food].
struct Fixture {
    source_id: &'static str,
    content: &'static str,
    embedding: [f32; 4],
}

/// Baseline 8-fixture corpus — verbatim from `embeddings.rs:523-565`.
/// 4 axes × 2 entries each: code (rust), personal, work, food.
fn corpus() -> Vec<Fixture> {
    vec![
        Fixture {
            source_id: "mem_rust_async",
            content: "User asked how to write a tokio async loop with cancellation",
            embedding: [0.95, 0.05, 0.20, 0.0],
        },
        Fixture {
            source_id: "mem_rust_macro",
            content: "User explained the difference between proc macros and decl macros",
            embedding: [0.90, 0.10, 0.15, 0.0],
        },
        Fixture {
            source_id: "mem_personal_birthday",
            content: "User's birthday is March 15, mentioned planning a quiet dinner",
            embedding: [0.0, 0.95, 0.05, 0.30],
        },
        Fixture {
            source_id: "mem_personal_runs",
            content: "User runs 5K every Tuesday morning at the riverside park",
            embedding: [0.0, 0.85, 0.10, 0.0],
        },
        Fixture {
            source_id: "mem_work_standup",
            content: "Daily engineering standup is 9:30 AM PT, hosted on Zoom",
            embedding: [0.10, 0.05, 0.95, 0.0],
        },
        Fixture {
            source_id: "mem_work_oncall",
            content: "User is on-call rotation for the payments service this week",
            embedding: [0.05, 0.10, 0.90, 0.0],
        },
        Fixture {
            source_id: "mem_food_pizza",
            content: "User prefers Neapolitan pizza, dislikes deep dish",
            embedding: [0.0, 0.20, 0.0, 0.95],
        },
        Fixture {
            source_id: "mem_food_coffee",
            content: "User drinks black coffee, no sugar, two cups before noon",
            embedding: [0.0, 0.30, 0.10, 0.85],
        },
    ]
}

/// 3 NEW adversarial fixtures (RESEARCH §7 EVAL-03). All `relaxed` in this
/// iteration — they surface in the table but do NOT contribute to floor math.
///
/// 1. `mem_long_capability_gap` — ≥4KB realistic BLADE-shaped log to stress
///    BM25 length normalization on long documents.
/// 2. `mem_unicode_food` — CJK + emoji to stress Unicode tokenization in BM25
///    + safe printing in the table.
/// 3. `mem_runs_wednesday` — intentionally near-identical to `mem_personal_runs`
///    (single token swap Tuesday→Wednesday) to expose ranking ties.
fn adversarial_corpus() -> Vec<Fixture> {
    vec![
        Fixture {
            source_id: "mem_long_capability_gap",
            content: "Capability gap detected on 2026-04-29T14:32:11Z while attempting to fulfill \
                      user request 'export Linear ticket LIN-1247 to Markdown and post to #eng-updates': \
                      missing tool `linear-cli` from capability catalog. Stderr blob: '/bin/sh: linear-cli: \
                      command not found'. Routed to evolution_log_capability_gap. Catalog miss; falling \
                      back to search_npm_for_mcp(\"linear\") which returned 4 candidates: \
                      mcp-server-linear (npm v0.3.1, 1.2k weekly downloads, last published 2026-03-14, \
                      repo: github.com/example/mcp-server-linear, license: MIT), linear-mcp-bridge \
                      (npm v0.0.7, 23 weekly downloads, last published 2025-11-02, repo: \
                      github.com/example/linear-mcp-bridge, license: Apache-2.0), wrap-linear-cli \
                      (npm v1.0.0, 4 weekly downloads, last published 2025-08-21, repo: \
                      github.com/example/wrap-linear-cli, license: MIT), linear-tools-experimental \
                      (npm v0.0.0-alpha.4, 1 weekly download, last published 2025-12-30, repo: \
                      github.com/example/linear-tools-experimental, license: GPL-3.0). \
                      Recommendation: install mcp-server-linear via auto_install path; fallback \
                      to manual install if cooldown gate triggers. Cross-references: \
                      ROUTING_CAPABILITY_MISSING advisory pending UI consumer (Phase 11 deferral); \
                      evolution_log_capability_gap entry id evt_2026_04_29_14_32_11_lin1247; \
                      activity_strip emit pending — observe-only guardrail still set on linear tentacle \
                      because trust tier is below T2 for outbound write surface. End of \
                      capability_gap_detected event payload — 1 of 1 occurrences this session.",
            embedding: [0.10, 0.20, 0.85, 0.05], // work-axis dominant
        },
        Fixture {
            source_id: "mem_unicode_food",
            content: "ユーザーはラーメン (Tonkotsu, シェフAkira at 谷中の店) を週2回食べる 🍜",
            embedding: [0.0, 0.30, 0.0, 0.85], // food-axis primary
        },
        Fixture {
            source_id: "mem_runs_wednesday",
            content: "User runs 5K every Wednesday morning at the riverside park",
            embedding: [0.0, 0.85, 0.10, 0.0], // INTENTIONALLY identical to baseline mem_personal_runs
        },
    ]
}

// ────────────────────────────────────────────────────────────
// Fixture builder
// ────────────────────────────────────────────────────────────

/// Set up an isolated VectorStore in a temp dir with the fixture corpus.
fn build_test_store() -> (tempfile::TempDir, VectorStore) {
    let temp = temp_blade_env();
    let mut store = VectorStore::new();
    for f in corpus() {
        store.add(
            f.content.to_string(),
            f.embedding.to_vec(),
            "test_fixture".to_string(),
            f.source_id.to_string(),
        );
    }
    for f in adversarial_corpus() {
        store.add(
            f.content.to_string(),
            f.embedding.to_vec(),
            "test_fixture_adversarial".to_string(),
            f.source_id.to_string(),
        );
    }
    (temp, store)
}

// ────────────────────────────────────────────────────────────
// Scenarios — (query_embedding, query_text, expected_source_id, label, relaxed)
// ────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Scenario {
    embedding: [f32; 4],
    query: &'static str,
    expected: &'static str,
    label: &'static str,
    relaxed: bool,
}

/// Baseline 9 scenarios (verbatim from `embeddings.rs:604-641`) + 3 adversarial.
/// 8 asserted (Tier 1-4) + 1 relaxed stop-words noise + 3 relaxed adversarial.
fn scenarios() -> Vec<Scenario> {
    vec![
        // ── Tier 1: clean axis wins (vector signal is unambiguous) ──────
        Scenario {
            embedding: [0.92, 0.0, 0.10, 0.0],
            query: "rust async tokio",
            expected: "mem_rust_async",
            label: "rust_async_intent",
            relaxed: false,
        },
        Scenario {
            embedding: [0.0, 0.0, 0.92, 0.0],
            query: "engineering standup zoom",
            expected: "mem_work_standup",
            label: "work_standup_intent",
            relaxed: false,
        },
        Scenario {
            embedding: [0.0, 0.92, 0.0, 0.0],
            query: "exercise routine running",
            expected: "mem_personal_runs",
            label: "personal_runs_intent",
            relaxed: false,
        },
        Scenario {
            embedding: [0.0, 0.0, 0.0, 0.92],
            query: "favorite italian food",
            expected: "mem_food_pizza",
            label: "food_pizza_intent",
            relaxed: false,
        },
        // ── Tier 2: keyword should help disambiguate ────────────────────
        // Vector signal is weak/spread; query text contains literal content tokens.
        Scenario {
            embedding: [0.30, 0.0, 0.30, 0.0],
            query: "Neapolitan pizza preference",
            expected: "mem_food_pizza",
            label: "keyword_boost_pizza",
            relaxed: false,
        },
        Scenario {
            embedding: [0.20, 0.20, 0.20, 0.20],
            query: "tokio cancellation",
            expected: "mem_rust_async",
            label: "keyword_boost_async",
            relaxed: false,
        },
        // ── Tier 3: adversarial — cross-domain confusion ────────────────
        // "morning" appears in mem_personal_runs (5K every Tuesday morning)
        // AND mem_food_coffee (two cups before noon). Vector axis points
        // at personal/food split; query text "tuesday riverside" is the
        // tie-breaker only if BM25 picks up the unique tokens.
        Scenario {
            embedding: [0.0, 0.50, 0.0, 0.50],
            query: "tuesday riverside park morning",
            expected: "mem_personal_runs",
            label: "adversarial_morning_disambig",
            relaxed: false,
        },
        // ── Tier 4: keyword overrides misleading vector ────────────────
        // Vector slightly favors "code" axis but the unique token "Neapolitan"
        // appears only in mem_food_pizza. Tests that BM25 can break a tie
        // when the embedding sends a wrong-domain signal.
        Scenario {
            embedding: [0.40, 0.0, 0.20, 0.20],
            query: "Neapolitan",
            expected: "mem_food_pizza",
            label: "adversarial_keyword_overrides_vector",
            relaxed: false,
        },
        // ── Tier 5: noise-only query (relaxed) ──────────────────────────
        // Stop-words only; no vector signal. Should NOT crash; allowed to
        // return any top-k order — measured by MRR not top-1. Expected
        // memory is the closest-to-zero embedding; floor allows MRR=0.0
        // for this scenario specifically (handled by accepting any rank).
        // We pick mem_food_coffee as the "least surprising" answer — its
        // embedding has the lowest L2 norm (0.0+0.30+0.10+0.85 → 0.91).
        // This scenario is gate-relaxed: not asserted in the floor, but
        // surfaced in the table for inspection.
        Scenario {
            embedding: [0.0, 0.0, 0.0, 0.0],
            query: "the and from",
            expected: "mem_food_coffee",
            label: "adversarial_stopwords_only",
            relaxed: true,
        },
        // ── Tier 6: NEW adversarial fixtures (RESEARCH §7 EVAL-03) ─────
        // All 3 relaxed in this iteration — surface in table, excluded
        // from floor math. Promoted to asserted in a future iteration
        // once baseline behavior is observed across multiple runs.
        Scenario {
            embedding: [0.10, 0.20, 0.85, 0.05],
            query: "operational log linear capability gap",
            expected: "mem_long_capability_gap",
            label: "adversarial_long_content",
            relaxed: true,
        },
        Scenario {
            embedding: [0.0, 0.30, 0.0, 0.85],
            query: "ラーメン preference Tonkotsu",
            expected: "mem_unicode_food",
            label: "adversarial_unicode",
            relaxed: true,
        },
        Scenario {
            embedding: [0.0, 0.85, 0.10, 0.0],
            query: "wednesday morning run",
            expected: "mem_runs_wednesday",
            label: "adversarial_near_duplicate",
            relaxed: true,
        },
    ]
}

// ────────────────────────────────────────────────────────────
// Test
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_synthetic_hybrid_recall() {
    let (_temp, store) = build_test_store();
    let mut rows: Vec<EvalRow> = Vec::new();

    for sc in scenarios() {
        let results: Vec<SearchResult> = store.hybrid_search(&sc.embedding, sc.query, 5);
        let top3_ids: Vec<String> = results
            .iter()
            .take(3)
            .map(|r| r.source_id.clone())
            .collect();
        rows.push(EvalRow {
            label: sc.label.to_string(),
            top1: top1_hit(&results, sc.expected),
            top3: topk_hit(&results, sc.expected, 3),
            rr: reciprocal_rank(&results, sc.expected),
            top3_ids,
            expected: sc.expected.to_string(),
            relaxed: sc.relaxed,
        });
    }

    print_eval_table("Hybrid search regression eval (synthetic 4-dim)", &rows);

    // Floor enforcement — preserved from `embeddings.rs:698-707`, generalised
    // to use harness::summarize. Asserted denominator is the 8 non-relaxed
    // scenarios; the 4 relaxed rows (1 stop-words noise + 3 adversarial)
    // surface in the table but do NOT contribute to floor math.
    let s = summarize(&rows);
    let asserted_total = s.asserted_total as f32;

    // Phase 17 / DOCTOR-02: record this run to history.jsonl BEFORE asserts so
    // a failing eval still produces a JSONL row Doctor's D-05 Red tier needs.
    let floor_passed = s.asserted_total > 0
        && (s.asserted_top3_count as f32 / asserted_total) >= 0.80
        && s.asserted_mrr >= 0.6;
    super::harness::record_eval_run("hybrid_search_eval", &s, floor_passed);

    assert!(
        (s.asserted_top3_count as f32 / asserted_total) >= 0.80,
        "asserted top-3 recall {}/{} below 80% floor",
        s.asserted_top3_count,
        s.asserted_total,
    );
    assert!(
        s.asserted_mrr >= 0.6,
        "asserted MRR {:.3} below 0.6 floor",
        s.asserted_mrr,
    );
}

// ────────────────────────────────────────────────────────────
// Smoke tests — preserved verbatim from embeddings.rs:711-727
// ────────────────────────────────────────────────────────────

#[test]
fn empty_query_returns_empty() {
    let (_tmp, store) = build_test_store();
    let results = store.hybrid_search(&[0.0, 0.0, 0.0, 0.0], "", 5);
    // Pure zero query may still rank entries by cosine=0 — main check is
    // that the function doesn't panic with empty text and returns ≤ top_k.
    assert!(results.len() <= 5);
}

#[test]
fn empty_store_returns_empty() {
    let _temp = temp_blade_env();
    let store = VectorStore::new();
    let results = store.hybrid_search(&[1.0, 0.0, 0.0, 0.0], "rust async", 5);
    assert!(results.is_empty(), "empty store must return no results");
}
