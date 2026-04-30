---
phase: 16-eval-scaffolding-expansion
plan: 05
type: execute
wave: 2
depends_on: [16-01]
files_modified:
  - src-tauri/src/evals/typed_memory_eval.rs
autonomous: true
requirements: [EVAL-04]
must_haves:
  truths:
    - "`cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0"
    - "stdout contains the `┌──` delimiter (EVAL-06 contract)"
    - "All 7 `MemoryCategory` variants (Fact, Preference, Decision, Relationship, Skill, Goal, Routine) round-trip via `store_typed_memory` → `recall_by_category`"
    - "Cross-category isolation holds: `recall_by_category(Fact, 10)` does NOT return Preference content"
  artifacts:
    - path: "src-tauri/src/evals/typed_memory_eval.rs"
      provides: "7-category typed-memory recall eval + cross-category isolation check"
      min_lines: 180
      contains: "fn evaluates_typed_memory_recall"
  key_links:
    - from: "src-tauri/src/evals/typed_memory_eval.rs"
      to: "src-tauri/src/typed_memory.rs"
      via: "use crate::typed_memory::{store_typed_memory, recall_by_category, MemoryCategory}"
      pattern: "use crate::typed_memory"
    - from: "src-tauri/src/evals/typed_memory_eval.rs"
      to: "src-tauri/src/evals/harness.rs"
      via: "use super::harness::{print_eval_table, temp_blade_env, EvalRow}"
      pattern: "use super::harness"
---

<objective>
Replace the Wave 1 stub at `src-tauri/src/evals/typed_memory_eval.rs` with a NEW typed-memory eval covering all 7 `MemoryCategory` variants. There is no source to relocate — `typed_memory.rs` ships zero inline tests. Pattern borrowed from `typed_memory.rs:450-475` (the existing categories-loop in `generate_user_knowledge_summary`).

Purpose: Prove that `store_typed_memory(cat, content, source, confidence)` → `recall_by_category(cat, limit)` round-trips correctly for every category, AND that cross-category isolation holds (a `Fact` is not returned when querying `Preference`). This catches the bug where a future SQL edit drops the `WHERE category = ?1` clause.

Output: A single `.rs` file with `#[test] fn evaluates_typed_memory_recall` that inserts 1 fixture per category (7 total), recalls each category, asserts content matches, and prints the EVAL-06 scored table.
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
@src-tauri/src/typed_memory.rs

<interfaces>
<!-- From `harness.rs` (Plan 01): -->
```rust
pub fn print_eval_table(title: &str, rows: &[EvalRow]);
pub fn temp_blade_env() -> tempfile::TempDir;
pub struct EvalRow { pub label, pub top1, pub top3, pub rr, pub top3_ids, pub expected, pub relaxed }
```

<!-- From `typed_memory.rs` (production, public): -->
```rust
pub enum MemoryCategory {
    Fact,
    Preference,
    Decision,
    Relationship,
    Skill,
    Goal,
    Routine,
}

pub fn store_typed_memory(
    category: MemoryCategory,
    content: &str,
    source: &str,
    confidence: Option<f64>,
) -> Result<String, String>;       // returns id; line 133-138

pub fn recall_by_category(
    category: MemoryCategory,
    limit: usize,
) -> Vec<TypedMemory>;             // line 267

pub struct TypedMemory {
    pub id: String,
    pub category: MemoryCategory,
    pub content: String,
    pub source: String,
    pub confidence: f64,
    pub created_at: i64,
    // ... other fields exist; only the above are used by the eval
}
```

<!-- Pattern analog: `typed_memory.rs:450-463` -->
```rust
let categories = [
    MemoryCategory::Fact,
    MemoryCategory::Preference,
    MemoryCategory::Decision,
    MemoryCategory::Relationship,
    MemoryCategory::Skill,
    MemoryCategory::Goal,
    MemoryCategory::Routine,
];

for cat in &categories {
    let entries = recall_by_category(cat.clone(), 5);
    if entries.is_empty() { continue; }
    // ...
}
```
</interfaces>

<gotchas>
1. **Verify `store_typed_memory` signature first** — RESEARCH §7 notes the signature must be confirmed at plan time (Assumption A1). Run `grep -nA 6 "pub fn store_typed_memory" src-tauri/src/typed_memory.rs`. If the actual signature differs from `(MemoryCategory, &str, &str, Option<f64>) -> Result<String, String>`, adapt the eval's calls.
2. **Duplicate-content merge** (`typed_memory.rs:166-177`) — exact-content duplicates of the SAME category MERGE (boost confidence, return existing id). The eval uses unique content per category to avoid this collision.
3. **`MemoryCategory` may need `Clone` + `Debug` + `PartialEq`** — typed_memory.rs:35-44 should derive these (verify via `grep -B 1 "^pub enum MemoryCategory" src-tauri/src/typed_memory.rs`). The eval's category iteration calls `cat.clone()`.
4. **`temp_blade_env()` mandatory** — `store_typed_memory` writes to SQLite. Without temp env, tests pollute production db.
5. **`--test-threads=1` mandatory** — `BLADE_CONFIG_DIR` is process-global.
6. **Cross-category isolation check** is the regression gate for the SQL `WHERE category = ?1` clause. This is the most important assert in the eval.
7. **For each category, `recall_by_category(cat, 10).len() == 1`** — strict count assertion (not "at least 1") — catches a bug where the SQL forgets the WHERE clause and returns all rows for any category.
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify typed_memory signatures and write the eval</name>
  <files>src-tauri/src/evals/typed_memory_eval.rs (REPLACE Wave 1 stub)</files>

  <read_first>
    - src-tauri/src/typed_memory.rs (lines 1-100, 130-180, 250-330, 450-475) — `MemoryCategory` enum, `store_typed_memory` signature, `recall_by_category` signature, the existing categories-loop pattern, dup-merge logic at 166-177
    - src-tauri/src/evals/harness.rs (Plan 01 output) — imports
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/typed_memory_eval.rs", lines 346-411) — full pattern assignment
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§7 EVAL-04 — fixture corpus + asserts)
  </read_first>

  <action>
**Step 1: Verify the production API surface.** Run:
```bash
grep -nA 6 "pub fn store_typed_memory" src-tauri/src/typed_memory.rs
grep -nA 2 "pub fn recall_by_category" src-tauri/src/typed_memory.rs
grep -nB 1 "^pub enum MemoryCategory" src-tauri/src/typed_memory.rs
```
Expected per RESEARCH §7:
- `store_typed_memory(category: MemoryCategory, content: &str, source: &str, confidence: Option<f64>) -> Result<String, String>`
- `recall_by_category(category: MemoryCategory, limit: usize) -> Vec<TypedMemory>`
- `#[derive(...Clone, Debug...)]` on `MemoryCategory`

**If signatures differ**, adapt the calls. If `MemoryCategory` does not derive `Clone`, the iteration needs to construct fresh values per call instead of `cat.clone()`.

**Step 2: REPLACE the Wave 1 stub at `src-tauri/src/evals/typed_memory_eval.rs`** with the full eval:

```rust
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
//! ## Run
//! `cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, temp_blade_env, EvalRow};
use crate::typed_memory::{recall_by_category, store_typed_memory, MemoryCategory};

// ────────────────────────────────────────────────────────────
// Fixture corpus — one unique entry per category (RESEARCH §7 EVAL-04)
// ────────────────────────────────────────────────────────────

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
    let _temp = temp_blade_env();

    let fxs = fixtures();
    // Insert 1 fixture per category.
    for fx in &fxs {
        store_typed_memory(fx.category.clone(), fx.content, "test_typed_memory_fixture", Some(0.9))
            .expect("store_typed_memory ok");
    }

    let mut rows: Vec<EvalRow> = Vec::new();

    // ── Per-category round-trip + count + content match ──────────────
    for fx in &fxs {
        let recalled = recall_by_category(fx.category.clone(), 10);
        let count_ok = recalled.len() == 1;
        let content_ok = recalled.first().map(|m| m.content.contains(fx.expected_substring)).unwrap_or(false);
        let pass = count_ok && content_ok;
        rows.push(bool_row(fx.label, pass, fx.expected_substring));
    }

    // ── Cross-category isolation: Fact recall must NOT contain the Preference content ─
    let fact_recall = recall_by_category(MemoryCategory::Fact, 10);
    let preference_content = fxs.iter()
        .find(|f| matches!(f.category, MemoryCategory::Preference))
        .map(|f| f.content)
        .unwrap();
    let isolation_pass = !fact_recall.iter().any(|m| m.content == preference_content);
    rows.push(bool_row("cross_category_isolation", isolation_pass, "fact_recall_excludes_preference"));

    print_eval_table("Typed memory category recall eval", &rows);

    // ── Floor: every category recalled exactly its fixture, isolation holds ─
    for (i, fx) in fxs.iter().enumerate() {
        let row = &rows[i];
        assert!(row.top1, "{} failed: count or content mismatch", fx.label);
    }
    assert!(isolation_pass, "cross-category isolation: Fact recall returned Preference content");
}
```

**Step 3: Compile + run:**
```bash
cd src-tauri && cargo test --lib evals::typed_memory_eval --no-run --test-threads=1 2>&1 | tail -10
cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1 2>&1 | tail -25
```
Expected: scored table opens with `┌── Typed memory category recall eval ──`, 8 rows (7 categories + 1 isolation), all top1=✓ rr=1.00, summary `top-1: 8/8 (100%)  top-3: 8/8 (100%)  MRR: 1.000`, exit 0.

If `MemoryCategory` doesn't derive `Clone`, change `fx.category.clone()` to constructing a fresh value (e.g. swap the iteration to use a `match` that yields a fresh enum variant per case).

If `recall_by_category(Fact, 10).len()` is 0 instead of 1, check whether `store_typed_memory` actually committed (some fns return `Ok` but no row inserted in error paths). Add `.expect()` to surface failures.
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/typed_memory_eval.rs` exits 0
- File is no longer the Wave 1 stub: `wc -l src-tauri/src/evals/typed_memory_eval.rs` ≥ 180
- `grep -q "use super::harness" src-tauri/src/evals/typed_memory_eval.rs` exits 0
- `grep -q "use crate::typed_memory" src-tauri/src/evals/typed_memory_eval.rs` exits 0
- `grep -q "fn evaluates_typed_memory_recall" src-tauri/src/evals/typed_memory_eval.rs` exits 0
- All 7 categories named — `for cat in Fact Preference Decision Relationship Skill Goal Routine; do grep -q "MemoryCategory::$cat" src-tauri/src/evals/typed_memory_eval.rs || echo MISSING $cat; done` returns no MISSING lines
- `grep -q "cross_category_isolation" src-tauri/src/evals/typed_memory_eval.rs` exits 0 (the isolation regression assert)
- File contains zero `todo!()` markers — `! grep -q "todo!" src-tauri/src/evals/typed_memory_eval.rs`
- `cd src-tauri && cargo test --lib evals::typed_memory_eval --no-run --test-threads=1` exits 0
- `cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0
- Stdout contains `┌── Typed memory category recall eval ──`
- Stdout shows 8 rows pass — `... | grep -E "MRR: 1\.000"`
  </acceptance_criteria>

  <verify>
    <automated>cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1 2>&1 | tee /tmp/16-05-out.log | tail -20 && grep -q '┌── Typed memory category recall eval' /tmp/16-05-out.log && grep -q "MRR: 1\.000" /tmp/16-05-out.log && ! grep -q "todo!" src-tauri/src/evals/typed_memory_eval.rs</automated>
  </verify>

  <done>`evals/typed_memory_eval.rs` is fully populated; cargo exits 0; stdout carries the `┌──` table with 8 rows (7 categories + 1 isolation); all 7 categories round-trip; cross-category isolation holds (MRR 1.000).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none) | Test-only — synthetic fixtures + temp SQLite. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-05-01 | I (Information disclosure) | Fixture content (e.g. "Sarah leads the API team") | accept | Synthetic fixtures with fictional names. No real-personal-data exposure. |
| T-16-05-02 | T (Tampering) | A future edit drops `WHERE category = ?1` from `recall_by_category` SQL — silent data leak across categories | mitigate | The `cross_category_isolation` row IS the regression gate that catches this exact bug. |

**Severity rollup:** all LOW. The eval is a defensive regression gate.
</threat_model>

<verification>
After the 1 task completes:

```bash
cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1 2>&1 | tail -25
# Expected:
# ┌── Typed memory category recall eval ──
# │ fact_birthday                     top1=✓ top3=✓ rr=1.00 → top3=["March 15"] (want=March 15)
# │ preference_dark_mode              top1=✓ top3=✓ rr=1.00 → ...
# │ decision_react_dashboard          top1=✓ top3=✓ rr=1.00 → ...
# │ relationship_sarah_oncall         top1=✓ top3=✓ rr=1.00 → ...
# │ skill_rust_async                  top1=✓ top3=✓ rr=1.00 → ...
# │ goal_blade_v12                    top1=✓ top3=✓ rr=1.00 → ...
# │ routine_morning_standup           top1=✓ top3=✓ rr=1.00 → ...
# │ cross_category_isolation          top1=✓ top3=✓ rr=1.00 → ...
# ├──...
# │ top-1: 8/8 (100%)  top-3: 8/8 (100%)  MRR: 1.000
# └──...
# test result: ok. 1 passed; 0 failed
```
</verification>

<success_criteria>
1. `evals/typed_memory_eval.rs` is fully populated (no stub, no `todo!()`)
2. `cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0
3. Stdout carries `┌──` opening (EVAL-06 contract)
4. All 7 `MemoryCategory` variants exercised with successful round-trip
5. Cross-category isolation row (the `WHERE category` regression gate) passes
6. EVAL-04 requirement satisfied
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-05-SUMMARY.md` documenting:
- File created (was a Wave 1 stub)
- 7 categories tested
- Cross-category isolation result
- Cargo command + exit code
</output>
