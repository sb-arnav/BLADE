//! Phase 16 / EVAL-04.
//!
//! Typed-memory category-recall eval. Round-trips one fixture per
//! `MemoryCategory` variant through `store_typed_memory` →
//! `recall_by_category` and asserts cross-category isolation.
//!
//! Pattern source: the categories iteration at `typed_memory.rs:450-463`
//! (in `generate_user_knowledge_summary`) is the closest production
//! analog. There are no inline tests in `typed_memory.rs` as of v1.1.
//!
//! ## Why this eval exists
//! 1. **Round-trip floor** — every one of the 7 `MemoryCategory` variants
//!    must store + recall correctly. A future SQL edit that mishandles
//!    `category` serialisation breaks here first.
//! 2. **Cross-category isolation regression gate** — if a future edit
//!    drops the `WHERE category = ?1` clause from `recall_by_category`
//!    (production at `typed_memory.rs:282`), recalling `Fact` will start
//!    leaking `Preference` rows. The `cross_category_isolation` row IS
//!    that regression gate.
//!
//! ## Strict count assertion
//! Every category recall asserts `len() == 1` (not `>= 1`). This catches
//! a "WHERE clause dropped" bug where every category would return all 7
//! rows instead of 1.
//!
//! ## Run
//! `cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1`
//!
//! `--test-threads=1` is mandatory — `temp_blade_env()` mutates the
//! `BLADE_CONFIG_DIR` process-global env var.

use super::harness::{print_eval_table, temp_blade_env, EvalRow};
use crate::typed_memory::{recall_by_category, store_typed_memory, MemoryCategory};

// ────────────────────────────────────────────────────────────
// Fixture corpus — one unique entry per category (RESEARCH §7 EVAL-04)
// ────────────────────────────────────────────────────────────
//
// Content is chosen to:
// - be unique across categories (no exact-content merge collisions —
//   `typed_memory.rs:166-177` merges duplicates within the same category
//   and only the same category, but unique-across-categories keeps the
//   isolation assertion unambiguous)
// - avoid topic-keyword overlaps with each other where Preference/Fact
//   conflict detection runs (`typed_memory.rs:183-185`,`detect_and_resolve_conflicts`)

struct CategoryFixture {
    category: MemoryCategory,
    label: &'static str,
    content: &'static str,
    /// Unique substring that must appear in the recalled content.
    expected_substring: &'static str,
}

fn fixtures() -> Vec<CategoryFixture> {
    vec![
        CategoryFixture {
            category: MemoryCategory::Fact,
            label: "fact_birthday",
            content: "User's birthday is March 15",
            expected_substring: "March 15",
        },
        CategoryFixture {
            category: MemoryCategory::Preference,
            label: "preference_dark_mode",
            content: "User prefers dark mode and dislikes verbose AI replies",
            expected_substring: "dark mode",
        },
        CategoryFixture {
            category: MemoryCategory::Decision,
            label: "decision_react_dashboard",
            content: "Chose React over Vue for the BLADE Settings dashboard",
            expected_substring: "React over Vue",
        },
        CategoryFixture {
            category: MemoryCategory::Relationship,
            label: "relationship_sarah_oncall",
            content: "Sarah leads the API team and is the on-call escalation contact",
            expected_substring: "on-call escalation",
        },
        CategoryFixture {
            category: MemoryCategory::Skill,
            label: "skill_rust_async",
            content: "Expert in Rust async/tokio; intermediate in Go; novice in Elixir",
            expected_substring: "Rust async",
        },
        CategoryFixture {
            category: MemoryCategory::Goal,
            label: "goal_blade_v12",
            content: "Ship BLADE v1.2 (Acting Layer) by end of May 2026",
            expected_substring: "BLADE v1.2",
        },
        CategoryFixture {
            category: MemoryCategory::Routine,
            label: "routine_morning_standup",
            content: "Morning standup is 9:30 AM PT on Zoom; 5K run every Tuesday",
            expected_substring: "9:30 AM PT",
        },
    ]
}

/// Render a pass/fail signal as an `EvalRow`. Reuses the EVAL-06 box-drawing
/// printer's existing surface (top1/top3/rr) by treating the recall result
/// as a 1-row hit (`pass=true` → top1=top3=true, rr=1.0).
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
fn evaluates_typed_memory_recall() {
    // Isolated temp config dir + initialised SQLite — keeps test runs from
    // polluting the production blade.db. Returned guard must stay live for
    // the duration of the test (TempDir cleans up on Drop).
    let _temp = temp_blade_env();

    let fxs = fixtures();

    // ── Seed: insert 1 fixture per category (7 total) ───────────────────
    for fx in &fxs {
        let id = store_typed_memory(
            fx.category.clone(),
            fx.content,
            "test_typed_memory_fixture",
            Some(0.9),
        )
        .expect("store_typed_memory ok");
        // Guard against silent dup-merge / empty-id paths
        assert!(!id.is_empty(), "store_typed_memory returned empty id for {}", fx.label);
    }

    let mut rows: Vec<EvalRow> = Vec::new();

    // ── Per-category round-trip: count == 1, content matches ────────────
    //
    // Strict `len() == 1` (not `>= 1`) catches the "WHERE category = ?1
    // dropped" regression — without the WHERE, every recall would return
    // all 7 rows.
    for fx in &fxs {
        let recalled = recall_by_category(fx.category.clone(), 10);
        let count_ok = recalled.len() == 1;
        let content_ok = recalled
            .first()
            .map(|m| m.content.contains(fx.expected_substring))
            .unwrap_or(false);
        // Belt-and-braces: also confirm the recalled row is tagged with the
        // expected category string (catches a serialisation bug where the
        // row exists but `category` field was misencoded).
        let category_tag_ok = recalled
            .first()
            .map(|m| m.category == fx.category.as_str())
            .unwrap_or(false);
        let pass = count_ok && content_ok && category_tag_ok;
        rows.push(bool_row(fx.label, pass, fx.expected_substring));
    }

    // ── Cross-category isolation regression gate ────────────────────────
    //
    // Recall `Fact` and confirm Preference content is NOT in the result
    // set. This is the assert that catches a future SQL edit dropping the
    // `WHERE category = ?1` clause.
    let fact_recall = recall_by_category(MemoryCategory::Fact, 10);
    let preference_content = fxs
        .iter()
        .find(|f| matches!(f.category, MemoryCategory::Preference))
        .map(|f| f.content)
        .expect("preference fixture present");
    let isolation_pass = !fact_recall.iter().any(|m| m.content == preference_content)
        // Stronger: also confirm every row in the fact recall actually
        // tags as `fact`. If the WHERE clause is gone, this catches it
        // even if Preference content happens not to surface.
        && fact_recall.iter().all(|m| m.category == "fact");
    rows.push(bool_row(
        "cross_category_isolation",
        isolation_pass,
        "fact_recall_excludes_preference",
    ));

    // ── Print the EVAL-06 scored table (the `┌──` opener) ───────────────
    print_eval_table("Typed memory category recall eval", &rows);

    // ── Floor asserts (only after printing so the table always shows) ──
    for (i, fx) in fxs.iter().enumerate() {
        let row = &rows[i];
        assert!(
            row.top1,
            "{} failed: count != 1 OR content missing expected substring '{}' OR category tag mismatch",
            fx.label, fx.expected_substring
        );
    }
    assert!(
        isolation_pass,
        "cross-category isolation broken: recall_by_category(Fact) returned non-fact rows OR contained Preference content — check WHERE category clause in typed_memory.rs::recall_by_category"
    );
}
