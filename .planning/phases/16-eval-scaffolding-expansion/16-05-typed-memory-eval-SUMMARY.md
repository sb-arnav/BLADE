---
phase: 16-eval-scaffolding-expansion
plan: 05
subsystem: evals
tags: [eval, typed-memory, category-recall, cross-category-isolation, regression-gate, EVAL-04]
dependency_graph:
  requires:
    - "16-01-harness (super::harness — print_eval_table, EvalRow, temp_blade_env)"
    - "typed_memory.rs (store_typed_memory / recall_by_category / MemoryCategory / TypedMemory)"
  provides:
    - "src-tauri/src/evals/typed_memory_eval.rs — fourth Wave 2 harness consumer"
    - "EVAL-04 regression gate (7-category round-trip + cross-category isolation)"
  affects:
    - "Phase 16 Wave 2 progress (4/5 plans — only 16-06 capability-gap remains)"
    - ".planning/REQUIREMENTS.md (EVAL-04 checkbox flipped)"
    - ".planning/ROADMAP.md (16-05 line marked shipped)"
    - ".planning/STATE.md (Wave 2 progress + status)"
tech-stack:
  added: []
  patterns:
    - "table-driven boolean assertions surfaced via EvalRow (rr=1.0/0.0)"
    - "harness-isolated SQLite via temp_blade_env() — process-global BLADE_CONFIG_DIR; --test-threads=1 mandatory"
    - "strict len() == 1 per-category assertion (catches WHERE-clause-dropped regression)"
    - "belt-and-braces: per-row category-tag check in addition to content-substring check"
key-files:
  created: []
  modified:
    - "src-tauri/src/evals/typed_memory_eval.rs (Wave 1 stub 1 LOC → 206 LOC)"
    - ".planning/REQUIREMENTS.md (EVAL-04 box checked)"
    - ".planning/ROADMAP.md (16-05 line marked shipped)"
    - ".planning/STATE.md (frontmatter + status + session continuity)"
decisions:
  - "Strict `len() == 1` per-category recall (not `>= 1`). A future SQL edit dropping `WHERE category = ?1` would return all 7 rows for every category — strict count catches it before content-substring even matters."
  - "Belt-and-braces: also assert `recalled[0].category == fx.category.as_str()`. Catches a serialisation bug where the row exists but the `category` column was misencoded — content-substring alone wouldn't surface that."
  - "Cross-category isolation row tightens beyond the plan's spec: not only `recall(Fact)` excludes Preference content, but ALSO every row in the Fact recall must tag as `\"fact\"`. Catches the WHERE-dropped regression even if the Preference content happens not to surface in the top-N."
  - "Boolean integrity asserts use rr=1.0 on pass / 0.0 on fail. Keeps the EVAL-06 box-drawing format uniform across boolean and ranked-metric evals (matches the kg_integrity_eval convention)."
metrics:
  duration: "~8m (cargo build 7m 46s + 0.50s test runtime — fresh debug rebuild after sibling KG eval)"
  completed_date: "2026-04-29"
  tasks: 1
  commits: 1
---

# Phase 16 Plan 05: Typed-Memory Recall Eval Summary

7-category typed-memory recall eval added to the Wave 2 harness fleet — fourth consumer after `hybrid_search_eval` (synthetic 4-dim), `real_embedding_eval` (real fastembed), and `kg_integrity_eval` (5 integrity dimensions). One unique fixture per `MemoryCategory` variant exercises `store_typed_memory` → `recall_by_category` round-trip; cross-category isolation row asserts the `WHERE category = ?1` clause holds (the regression gate for a class of silent data-leak bugs). All 8 rows pass; MRR 1.000. EVAL-04 satisfied.

---

## What was built

**File replaced:** `src-tauri/src/evals/typed_memory_eval.rs` (Wave 1 stub 1 LOC → 206 LOC).

**Eval shape:**
- 7 `CategoryFixture` rows — one per `MemoryCategory` variant:
  - `fact_birthday` → `MemoryCategory::Fact` ("User's birthday is March 15")
  - `preference_dark_mode` → `MemoryCategory::Preference` ("User prefers dark mode and dislikes verbose AI replies")
  - `decision_react_dashboard` → `MemoryCategory::Decision` ("Chose React over Vue for the BLADE Settings dashboard")
  - `relationship_sarah_oncall` → `MemoryCategory::Relationship` ("Sarah leads the API team and is the on-call escalation contact")
  - `skill_rust_async` → `MemoryCategory::Skill` ("Expert in Rust async/tokio; intermediate in Go; novice in Elixir")
  - `goal_blade_v12` → `MemoryCategory::Goal` ("Ship BLADE v1.2 (Acting Layer) by end of May 2026")
  - `routine_morning_standup` → `MemoryCategory::Routine` ("Morning standup is 9:30 AM PT on Zoom; 5K run every Tuesday")
- All content unique across categories — avoids the exact-content duplicate-merge path at `typed_memory.rs:166-177` (which is intra-category only, but cross-category uniqueness keeps the isolation assert unambiguous).
- 8 EvalRow assertions emitted to the EVAL-06 scored table:
  1. **fact_birthday** — `recall_by_category(Fact, 10).len() == 1` AND content contains "March 15" AND category tag == "fact"
  2. **preference_dark_mode** — same shape for Preference
  3. **decision_react_dashboard** — same shape for Decision
  4. **relationship_sarah_oncall** — same shape for Relationship
  5. **skill_rust_async** — same shape for Skill
  6. **goal_blade_v12** — same shape for Goal
  7. **routine_morning_standup** — same shape for Routine
  8. **cross_category_isolation** — `recall_by_category(Fact, 10)` does NOT contain Preference content AND every row tags as `"fact"` (the `WHERE category` regression catcher)
- `bool_row()` helper maps pass/fail to EvalRow: `top1=✓ top3=✓ rr=1.00` on pass, all-✗ rr=0.0 on fail. Matches the kg_integrity_eval boolean convention.

**Helpers consumed from harness:**
- `temp_blade_env()` — TempDir + `BLADE_CONFIG_DIR` + `db::init_db()` (process-global env var; mandatory `--test-threads=1`)
- `print_eval_table(title, &rows)` — leads with `┌──` (EVAL-06 grep gate) + summary roll-up
- `EvalRow` struct — uniform metric carrier

**Helpers consumed from typed_memory:** `store_typed_memory` (returns id; merges duplicates; runs preference-conflict detection), `recall_by_category` (the SUT), `MemoryCategory` (the 7-variant enum that derives `Clone, Debug, PartialEq`).

---

## Run + Output

```bash
$ cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1
    Finished `test` profile [unoptimized + debuginfo] target(s) in 7m 46s
     Running unittests src/lib.rs (target/debug/deps/blade_lib-...)

running 1 test
test evals::typed_memory_eval::evaluates_typed_memory_recall ...
┌── Typed memory category recall eval ──
│ fact_birthday                    top1=✓ top3=✓ rr=1.00 → top3=["March 15"] (want=March 15)
│ preference_dark_mode             top1=✓ top3=✓ rr=1.00 → top3=["dark mode"] (want=dark mode)
│ decision_react_dashboard         top1=✓ top3=✓ rr=1.00 → top3=["React over Vue"] (want=React over Vue)
│ relationship_sarah_oncall        top1=✓ top3=✓ rr=1.00 → top3=["on-call escalation"] (want=on-call escalation)
│ skill_rust_async                 top1=✓ top3=✓ rr=1.00 → top3=["Rust async"] (want=Rust async)
│ goal_blade_v12                   top1=✓ top3=✓ rr=1.00 → top3=["BLADE v1.2"] (want=BLADE v1.2)
│ routine_morning_standup          top1=✓ top3=✓ rr=1.00 → top3=["9:30 AM PT"] (want=9:30 AM PT)
│ cross_category_isolation         top1=✓ top3=✓ rr=1.00 → top3=["fact_recall_excludes_preference"] (want=fact_recall_excludes_preference)
├─────────────────────────────────────────────────────────
│ top-1: 8/8 (100%)  top-3: 8/8 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────

ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 152 filtered out; finished in 0.50s
```

**Exit code:** 0
**EVAL-06 contract markers in stdout:** `┌── Typed memory category recall eval ──` ✓, `MRR: 1.000` ✓

---

## Decisions Made

### 1. Strict `len() == 1` per-category (not `>= 1`)

**Why:** A future edit dropping the `WHERE category = ?1` clause from `recall_by_category` (production at `typed_memory.rs:282`) would silently return ALL rows for every recall. A loose `>= 1` assert would still pass — every category recall would return 7 rows including the fixture. Strict count catches the regression before content even matters. The cross-category isolation row is a second guard on the same regression class.

### 2. Belt-and-braces category-tag check

In addition to content-substring matching, every per-category row asserts `recalled[0].category == fx.category.as_str()`. This catches a separate failure mode — the row exists with the right content but the `category` column was misencoded (e.g. a future edit to `MemoryCategory::as_str()` or the SQL serialisation path). Cheap addition, distinct regression surface.

### 3. Cross-category isolation row tightens beyond plan spec

Plan acceptance criterion was: `recall_by_category(Fact, 10)` does NOT contain Preference content. We added: AND every row in the Fact recall must tag as `"fact"`. The plan's check would pass even if the WHERE clause is dropped but Preference content happens to fall outside top-N — this stronger check catches WHERE-dropped regardless of which other-category content surfaces.

### 4. Boolean integrity asserts surfaced via rr=1.0/0.0 on EvalRow

Matches kg_integrity_eval convention. Keeps the EVAL-06 box-drawing format uniform across boolean integrity asserts (this eval, kg_integrity_eval) and ranked-metric evals (hybrid_search, real_embedding). The `verify:eval` gate's `┌──` grep doesn't care about asserter type — uniform format means uniform tooling.

---

## Deviations from Plan

**None substantive — plan executed as written with two strengthening additions baked into Task 1:**

1. Added per-row `category` tag check (decision 2 above) on top of count + content-substring. Same regression gate, deeper coverage.
2. Added `fact_recall.iter().all(|m| m.category == "fact")` to the cross-category isolation row (decision 3 above). Strengthens the plan's "exclude Preference content" check to also catch WHERE-dropped when Preference content isn't in top-N.

Both are belt-and-braces additions covering the same regression classes the plan flagged — they don't change the eval's pass/fail surface in the green path, only its sensitivity to the targeted regressions.

---

## Auth gates

None.

---

## Verification

### Plan acceptance criteria

| Criterion | Status |
|-----------|--------|
| `test -f src-tauri/src/evals/typed_memory_eval.rs` exits 0 | ✓ |
| `wc -l src-tauri/src/evals/typed_memory_eval.rs` ≥ 180 | ✓ (206) |
| `grep -q "use super::harness" src-tauri/src/evals/typed_memory_eval.rs` exits 0 | ✓ |
| `grep -q "use crate::typed_memory" src-tauri/src/evals/typed_memory_eval.rs` exits 0 | ✓ |
| `grep -q "fn evaluates_typed_memory_recall" src-tauri/src/evals/typed_memory_eval.rs` exits 0 | ✓ |
| All 7 `MemoryCategory::*` variants named | ✓ (Fact, Preference, Decision, Relationship, Skill, Goal, Routine) |
| `grep -q "cross_category_isolation"` exits 0 | ✓ |
| Zero `todo!()` markers | ✓ |
| `cargo test --lib evals::typed_memory_eval --no-run --test-threads=1` exits 0 | ✓ |
| `cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0 | ✓ |
| Stdout contains `┌── Typed memory category recall eval ──` | ✓ |
| Stdout shows `MRR: 1.000` | ✓ |
| 8 rows pass (7 categories + 1 isolation) | ✓ |

### Plan success criteria

1. ✓ `evals/typed_memory_eval.rs` fully populated (no stub, no `todo!()`)
2. ✓ `cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0
3. ✓ Stdout carries `┌──` opening (EVAL-06 contract)
4. ✓ All 7 `MemoryCategory` variants exercised with successful round-trip
5. ✓ Cross-category isolation row passes (the `WHERE category` regression gate)
6. ✓ EVAL-04 requirement satisfied (REQUIREMENTS.md box flipped)

---

## Files modified

| File | Change | LOC |
|------|--------|-----|
| `src-tauri/src/evals/typed_memory_eval.rs` | Wave 1 stub → full eval | 1 → 206 |
| `.planning/REQUIREMENTS.md` | EVAL-04 box flipped to `[x]` + plan-tag annotation | +0/-0 (in-line edit) |
| `.planning/ROADMAP.md` | 16-05 plan line flipped to `[x]` + ship annotation | +0/-0 (in-line edit) |
| `.planning/STATE.md` | Frontmatter + status + session continuity | +0/-0 (in-line edit) |

**No backend production code touched.** This plan is test-only — synthetic fixtures + temp SQLite. `typed_memory.rs` is consumed read-only via the public API.

---

## Threat model — observed disposition

| Threat ID | Disposition | Outcome |
|-----------|-------------|---------|
| T-16-05-01 (Information disclosure via fixture content) | accept | Confirmed — fixtures use synthetic / fictional names ("Sarah", BLADE-internal references). No real-personal-data exposure. |
| T-16-05-02 (Tampering: silent drop of `WHERE category = ?1`) | mitigate | Two assertions catch this: (a) strict `len() == 1` per-category recall — would surface as 7 rows on every recall if WHERE dropped; (b) `cross_category_isolation` row checks both Preference-content-absent AND every-row-tags-fact in the Fact recall. |

No threat-flag-worthy new surface introduced — eval is read-only against the public API.

---

## Self-Check: PASSED

- ✓ `src-tauri/src/evals/typed_memory_eval.rs` exists (206 LOC)
- ✓ `┌── Typed memory category recall eval ──` confirmed in `/tmp/16-05-out.log`
- ✓ `MRR: 1.000` confirmed in stdout
- ✓ EVAL-04 box flipped in `.planning/REQUIREMENTS.md:21`
- ✓ 16-05 plan line flipped in `.planning/ROADMAP.md:71`
- ✓ Per-task commit hash recorded below in final commit

(Final metadata commit and per-task commit hashes appended after commit step.)
