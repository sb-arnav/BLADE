//! Phase 16 / EVAL-03 (real fastembed).
//!
//! End-to-end recall eval using the real `AllMiniLML6V2` model. The
//! synthetic-4-dim eval (`evals::hybrid_search_eval`) verifies the RRF
//! ranking math; this eval verifies the embedding model produces useful
//! semantics for BLADE's real domain (mom_name, exercise routine, food
//! preferences, oncall arrangement, birthday, etc.).
//!
//! ## Cost
//! First invocation downloads ~80MB of model weights and compiles the
//! model graph (~20-30s). Subsequent runs in the same process reuse the
//! global EMBEDDER static (sub-second). Total embed cost for 8 corpus +
//! 7 queries ≈ 1-2s on CPU after first load.
//!
//! ## Run
//! `cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1`
//!
//! Source: this file is the relocated `mod memory_recall_real_embedding`
//! from `embeddings.rs:730-946` (commit 9c5674a 2026-04-28 baseline:
//! 7/7 top-1, MRR 1.000). Helpers are now centralised in `super::harness`.
//! The original block in `embeddings.rs` is intentionally left in place —
//! Plan 16-07 deletes it after all Wave 2 evals are proven green.
//!
//! Maturity audit (2026-04-27, .planning/notes/v1-2-self-improvement-maturity.md)
//! flagged the memory cluster as "1,883 LoC, zero quality measurement"
//! — this eval is the first real signal on that question.

use super::harness::{
    print_eval_table, reciprocal_rank, summarize, temp_blade_env, top1_hit, topk_hit, EvalRow,
};
use crate::embeddings::{embed_texts, SearchResult, VectorStore};

/// Local cosine similarity for the smoke test only. The production
/// `cosine_similarity` lives in `embeddings.rs` but is module-private;
/// duplicating the 6-line dot-product/norm calc here avoids widening
/// that public surface just for an eval. Identical behavior to
/// `embeddings::cosine_similarity` (verbatim formula).
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na * nb)
    }
}

// ────────────────────────────────────────────────────────────
// Fact corpus — 8 BLADE-shaped facts (REAL prose, not 4-dim hand-picks).
// VERBATIM from embeddings.rs:760-795
// ────────────────────────────────────────────────────────────

struct Fact {
    source_id: &'static str,
    content: &'static str,
}

/// Realistic BLADE-shaped facts about a hypothetical user. Each is the
/// kind of single-sentence memory that `auto_embed_exchange` would
/// store after a chat turn, minus the conversation framing.
fn fact_corpus() -> Vec<Fact> {
    vec![
        Fact {
            source_id: "mem_owner_name",
            content: "User's name is Arnav. He is an engineer building BLADE, a desktop AI agent.",
        },
        Fact {
            source_id: "mem_family_mom",
            content: "User's mother's name is Priya. She lives in Mumbai and works as a teacher.",
        },
        Fact {
            source_id: "mem_lang_pref",
            content: "User strongly prefers Rust over Python for systems programming work.",
        },
        Fact {
            source_id: "mem_exercise",
            content: "User runs 5K every Tuesday morning at the riverside park.",
        },
        Fact {
            source_id: "mem_meeting",
            content: "Daily engineering standup is at 9:30 AM Pacific Time, hosted on Zoom.",
        },
        Fact {
            source_id: "mem_food",
            content: "User dislikes deep-dish pizza and prefers Neapolitan style with thin crust.",
        },
        Fact {
            source_id: "mem_oncall",
            content: "User is on the payments service on-call rotation this week.",
        },
        Fact {
            source_id: "mem_birthday",
            content: "User's birthday is March 15. Plans a quiet dinner each year.",
        },
    ]
}

// ────────────────────────────────────────────────────────────
// Fixture builder — real `embed_texts` call.
// VERBATIM from embeddings.rs:798-818, with env-setup swapped to
// `harness::temp_blade_env()`.
// ────────────────────────────────────────────────────────────

/// Build an isolated VectorStore with the real-embedded corpus.
fn build_real_store() -> (tempfile::TempDir, VectorStore) {
    let temp = temp_blade_env();

    let facts = fact_corpus();
    let texts: Vec<String> = facts.iter().map(|f| f.content.to_string()).collect();
    let embeddings = embed_texts(&texts).expect("real embedding call");
    assert_eq!(embeddings.len(), facts.len());

    let mut store = VectorStore::new();
    for (fact, emb) in facts.iter().zip(embeddings.iter()) {
        store.add(
            fact.content.to_string(),
            emb.clone(),
            "test_real_fixture".to_string(),
            fact.source_id.to_string(),
        );
    }
    (temp, store)
}

// ────────────────────────────────────────────────────────────
// 7 natural-language queries — VERBATIM from embeddings.rs:840-854
// ────────────────────────────────────────────────────────────

struct RealScenario {
    query: &'static str,
    expected: &'static str,
    label: &'static str,
}

/// Natural-language queries paired with the expected source_id.
/// These are the kind of recall queries a user would actually ask
/// — "what's my mom's name", not "mom name lookup token".
fn real_scenarios() -> Vec<RealScenario> {
    vec![
        // Direct possessive — "what's my X" pattern
        RealScenario {
            query: "what is my mother's name",
            expected: "mem_family_mom",
            label: "direct_mom_name",
        },
        RealScenario {
            query: "when is my birthday",
            expected: "mem_birthday",
            label: "direct_birthday",
        },
        // Paraphrase — surface form differs from stored content
        RealScenario {
            query: "when do I exercise",
            expected: "mem_exercise",
            label: "paraphrase_exercise",
        },
        RealScenario {
            query: "what time is the daily meeting",
            expected: "mem_meeting",
            label: "paraphrase_standup",
        },
        RealScenario {
            query: "which programming language do I like",
            expected: "mem_lang_pref",
            label: "paraphrase_lang",
        },
        // Semantic association — query word doesn't appear literally
        RealScenario {
            query: "favorite italian food",
            expected: "mem_food",
            label: "semantic_pizza",
        },
        // Lexical-light query — should still find by short token
        RealScenario {
            query: "on call this week",
            expected: "mem_oncall",
            label: "direct_oncall",
        },
    ]
}

// ────────────────────────────────────────────────────────────
// Real-embedding recall eval
//
// First-time model download can take 20-30s. Subsequent runs are
// fast (~1-2s for the embed pass + sub-second search). Marked as
// a regular test (not `#[ignore]`) — we want this in `verify:all`.
// If CI ever needs to skip it (air-gapped, etc.), gate behind a
// cargo feature.
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_real_embedding_recall() {
    let (_tmp, store) = build_real_store();
    let mut rows: Vec<EvalRow> = Vec::new();

    for sc in real_scenarios() {
        // Embed the query through the same path production uses.
        let query_emb = embed_texts(&[sc.query.to_string()])
            .expect("query embed")
            .into_iter()
            .next()
            .expect("non-empty");
        let results: Vec<SearchResult> = store.hybrid_search(&query_emb, sc.query, 5);
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
            relaxed: false,
        });
    }

    print_eval_table("Memory recall eval (real fastembed AllMiniLML6V2)", &rows);

    // Floor enforcement — preserved verbatim from embeddings.rs:900-915,
    // generalised to use harness::summarize. Quality floor matches the
    // synthetic eval's gate. Real embeddings should match or exceed this
    // on a curated corpus of clean facts. If this fails, the signal is
    // real: either the model is wrong for our domain or the recall
    // pipeline has a regression.
    let s = summarize(&rows);
    let total = s.total as f32;
    assert!(
        (s.top3_count as f32 / total) >= 0.80,
        "real-embedding top-3 recall {}/{} below 80% floor",
        s.top3_count,
        s.total,
    );
    assert!(
        s.mrr >= 0.6,
        "real-embedding MRR {:.3} below 0.6 floor",
        s.mrr,
    );
}

// ────────────────────────────────────────────────────────────
// Smoke test — VERBATIM from embeddings.rs:921-945
//
// Confirms the real embedder loads and produces non-zero, normalized
// vectors of the expected dimension. Cheap signal that fastembed
// wiring isn't broken.
// ────────────────────────────────────────────────────────────

#[test]
fn embedder_produces_sane_vectors() {
    let texts = vec![
        "hello world".to_string(),
        "rust async tokio".to_string(),
    ];
    let embeddings = embed_texts(&texts).expect("embed");
    assert_eq!(embeddings.len(), 2);
    // AllMiniLML6V2 emits 384-dim vectors. Don't hard-code the
    // dim (model could change) — just assert it's plausible.
    let dim = embeddings[0].len();
    assert!(
        dim >= 128 && dim <= 4096,
        "embedding dim {} outside plausible range",
        dim
    );
    // Both vectors must be the same dimension.
    assert_eq!(embeddings[0].len(), embeddings[1].len());
    // Vectors must contain non-zero magnitude (model didn't return zeros).
    let mag: f32 = embeddings[0].iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!(mag > 0.1, "embedding magnitude {} suspiciously low", mag);
    // Different inputs must produce different vectors (no constant output bug).
    let cs = cosine_similarity(&embeddings[0], &embeddings[1]);
    assert!(cs < 0.999, "different inputs produced near-identical vectors");
}
