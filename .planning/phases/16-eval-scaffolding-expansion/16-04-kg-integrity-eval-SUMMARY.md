---
phase: 16-eval-scaffolding-expansion
plan: 04
subsystem: evals
tags: [eval, knowledge-graph, integrity, regression-gate, EVAL-02]
dependency_graph:
  requires:
    - "16-01-harness (super::harness — print_eval_table, EvalRow, temp_blade_env)"
    - "knowledge_graph.rs (add_node / add_edge / get_node / get_edges / ensure_tables / KnowledgeNode)"
  provides:
    - "src-tauri/src/evals/kg_integrity_eval.rs — third Wave 2 harness consumer"
    - "EVAL-02 regression gate (5 integrity dimensions)"
  affects:
    - "Phase 16 Wave 2 progress (3/5 plans)"
    - ".planning/REQUIREMENTS.md (EVAL-02 checkbox flipped)"
    - ".planning/ROADMAP.md (16-04 line marked shipped)"
    - ".planning/STATE.md (Wave 2 progress + status)"
tech-stack:
  added: []
  patterns:
    - "table-driven boolean assertions surfaced via EvalRow (rr=1.0/0.0)"
    - "harness-isolated SQLite via temp_blade_env() + explicit ensure_tables()"
    - "REQ-vs-real path resolution documented in file header (no re-export)"
key-files:
  created: []
  modified:
    - "src-tauri/src/evals/kg_integrity_eval.rs (Wave 1 stub → 284 LOC)"
    - ".planning/REQUIREMENTS.md (EVAL-02 box checked)"
    - ".planning/ROADMAP.md (16-04 line marked shipped)"
    - ".planning/STATE.md (frontmatter + status + session continuity)"
decisions:
  - "Resolve missing consolidate_kg by exercising add_node's idempotent-merge path; do NOT add a re-export. Documented in file-header doc-comment so future readers see the path resolution."
  - "Boolean integrity asserts use rr=1.0 on pass / 0.0 on fail. The harness format is uniform — top1=✓ rr=1.00 still produces a parseable scored table for EVAL-06's grep gate."
  - "Use empty KnowledgeNode.id ('' string) so add_node assigns a fresh UUID — keeps fixture concise and matches the production callsite convention."
metrics:
  duration: "~3m 02s (cargo build + 0.46s test runtime)"
  completed_date: "2026-04-29"
  tasks: 1
  commits: 1
---

# Phase 16 Plan 04: KG Integrity Eval Summary

Knowledge-graph round-trip + integrity eval added to the Wave 2 harness fleet — third consumer after `hybrid_search_eval` (synthetic 4-dim) and `real_embedding_eval` (real fastembed). 5 fixture nodes + 5 edges exercise add_node / add_edge / get_node / get_edges round-trip; 5 integrity dimensions asserted (round-trip / edge-endpoints-resolve / orphan-zero / idempotent-merge / edge-upsert-no-dup). All pass. EVAL-02 satisfied; the missing-`consolidate_kg` REQ wording resolved via add_node's idempotent-merge path with the resolution documented in the file-header doc-comment.

---

## What was built

**File replaced:** `src-tauri/src/evals/kg_integrity_eval.rs` (Wave 1 stub → 284 LOC).

**Eval shape:**
- 5 NodeSeed fixtures: `blade` (project), `tauri` (technology), `rust` (technology), `arnav` (person), `jarvis demo` (event). All concepts lowercase to match `knowledge_graph.rs:205` normalization.
- 5 EdgeSeed fixtures: `blade→tauri:depends_on:0.9`, `blade→rust:depends_on:0.95`, `tauri→rust:depends_on:0.7`, `arnav→blade:related_to:1.0`, `jarvis demo→blade:part_of:0.85`. Connectivity guarantees zero orphans (every node touches ≥1 edge).
- 5 integrity dimensions (each emitted as one EvalRow, asserted at the floor):
  1. **round_trip_5_nodes** — every inserted id resolves via `get_node` and concept survives intact
  2. **edge_endpoints_resolve** — both endpoints of every edge are present nodes
  3. **orphan_zero** — every node has ≥1 edge in `get_edges`
  4. **idempotent_merge_returns_same_id** — re-adding `"blade"` returns the same UUID (this is the consolidate_kg substitute)
  5. **edge_upsert_no_dup** — re-adding `(blade, tauri, depends_on)` with strength 0.55 leaves exactly one edge with the new strength (matches `INSERT … ON CONFLICT DO UPDATE` at `knowledge_graph.rs:346`)
- `bool_row()` helper maps pass/fail to EvalRow: `top1=✓ top3=✓ rr=1.00` on pass, all-✗ on fail. Keeps the EVAL-06 box-drawing format uniform across boolean and ranked metric evals.

**Helpers consumed from harness:**
- `temp_blade_env()` — TempDir + `BLADE_CONFIG_DIR` + `db::init_db()` (process-global env var; mandatory `--test-threads=1`)
- `print_eval_table(title, &rows)` — leads with `┌──` (EVAL-06 grep gate) + summary roll-up
- `EvalRow` struct — uniform metric carrier

**Helpers consumed from knowledge_graph:** `add_node`, `add_edge`, `get_node`, `get_edges`, `ensure_tables`, `KnowledgeNode`.

---

## Decisions Made

### 1. consolidate_kg REQ-vs-real resolution

REQUIREMENTS.md EVAL-02 names `consolidate_kg`. **Verified via `grep -rn consolidate_kg src-tauri/src/`: zero hits.** The function does not exist in the codebase.

**Resolution:** `add_node` has built-in idempotent-merge semantics at `knowledge_graph.rs:221-248`:
- Concept normalized to lowercase (line 205)
- If a node with the same concept exists → merge sources, take max(importance), update description if non-empty, return the **existing** id
- Otherwise → assign a fresh UUID (or use the supplied id) and INSERT

This IS the consolidation surface the REQ describes. The eval exercises it directly via the `idempotent_merge_returns_same_id` dimension (re-add `"blade"` with extra source → assert returned id == original id).

**Rationale for not adding a re-export:** matches the precedent set by Plan 16-06 / EVAL-05 (`detect_missing_tool` lives in `self_upgrade::` not `evolution::` — RESEARCH §5 ruled "no re-export, document in file header"). Same shape applies here. The file-header doc-comment carries the resolution verbatim so future readers do not retrace the grep.

### 2. Boolean asserts wrapped in EvalRow format

Integrity asserts are pass/fail, not ranked retrieval. They could have been bare `assert!`s with `eprintln!` of a custom format. Instead they are wrapped via `bool_row()` into the same EvalRow shape the other evals use — `rr=1.0/0.0`, degenerate `top3_ids/expected`. Trade-off:

- **Pro:** EVAL-06 grep gate (`┌──`) fires uniformly. `verify-eval.sh` doesn't need a special case for the KG eval. The MRR roll-up reads as "5/5 dimensions pass = 1.000" which is meaningful here.
- **Con:** the table column labels (`top1` / `top3` / `rr`) are slight misnomers for boolean dimensions. Mitigated by descriptive row labels (`round_trip_5_nodes`, `orphan_zero`, etc.).

### 3. Empty-id fixture pattern

`KnowledgeNode { id: String::new(), … }` — let `add_node` assign the UUID at line 252. Avoids the eval pre-generating UUIDs that have to be threaded around. The merge test relies on this: the second `add_node("blade", …)` call with `id: ""` MUST return the original UUID (set on the first call), not a fresh one.

---

## Verification Evidence

**Test command:**
```bash
cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1
```

**Output (verbatim, captured to `/tmp/16-04-out.log`):**
```
┌── Knowledge graph integrity eval ──
│ round_trip_5_nodes               top1=✓ top3=✓ rr=1.00 → top3=["all_nodes_resolvable"] (want=all_nodes_resolvable)
│ edge_endpoints_resolve           top1=✓ top3=✓ rr=1.00 → top3=["no_dangling_endpoints"] (want=no_dangling_endpoints)
│ orphan_zero                      top1=✓ top3=✓ rr=1.00 → top3=["every_node_has_edge"] (want=every_node_has_edge)
│ idempotent_merge_returns_same_id top1=✓ top3=✓ rr=1.00 → top3=["e1fba1b7-d792-436b-9a34-1c9f3ffde26e"] (want=e1fba1b7-d792-436b-9a34-1c9f3ffde26e)
│ edge_upsert_no_dup               top1=✓ top3=✓ rr=1.00 → top3=["single_edge_strength_0.55"] (want=single_edge_strength_0.55)
├─────────────────────────────────────────────────────────
│ top-1: 5/5 (100%)  top-3: 5/5 (100%)  MRR: 1.000
└─────────────────────────────────────────────────────────

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 151 filtered out; finished in 0.46s
```

**Acceptance gate audit:**

| Gate | Result |
|---|---|
| `test -f src-tauri/src/evals/kg_integrity_eval.rs` | ✓ exists |
| `wc -l ≥ 200` | ✓ 284 LOC |
| `grep -q "use super::harness"` | ✓ |
| `grep -q "use crate::knowledge_graph"` | ✓ |
| `grep -q "fn evaluates_kg_integrity"` | ✓ |
| `grep -q "consolidate_kg"` (header documents it) | ✓ |
| `! grep -q "todo!"` | ✓ |
| `cargo test --lib evals::kg_integrity_eval --no-run` | ✓ exit 0 |
| `cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` | ✓ exit 0 |
| Stdout contains `┌── Knowledge graph integrity eval ──` | ✓ |
| Stdout contains `MRR: 1\.000` | ✓ |
| 5 row labels emitted | ✓ |

**CLAUDE.md UAT carve-out:** This is a Rust-only test scaffolding plan. No runtime / UI surface. Per CLAUDE.md "Verification Protocol" + Phase 16 RESEARCH "Project Constraints" line 63, the build evidence is `cargo test green`, NOT a screenshot. The Stop-hook keyword trigger on "done" is a known false positive in this phase.

---

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's `<action>` block included a contingency ("If `add_node` panics on the `id: String::new()` pattern…") — that contingency did not fire. `knowledge_graph.rs:251-255` handles empty id by generating a UUID, exactly as documented. No fallback to `uuid::Uuid::new_v4()` was needed.

The plan's Step 1 verification (`grep` for the 7 public items) was implicitly satisfied by the Read tool surveying `knowledge_graph.rs:1-100, 180-380` — all 7 items confirmed `pub`. `ensure_tables` is `pub fn`, so the explicit call after `temp_blade_env()` works without escalation.

**Auth gates / authentication errors:** none.

---

## Threat Model Coverage

Plan threat-register dispositions (all LOW):
- **T-16-04-01 (I — fixture concept tokens):** accept. Fixture concepts (`blade`, `tauri`, `rust`, `arnav`, `jarvis demo`) are public-knowledge tokens — project name + visible-in-repo identifiers. No PII.
- **T-16-04-02 (T — KG schema drift):** mitigate. **This eval IS the regression test** — the idempotent-merge dimension fires immediately if `knowledge_graph.rs:221-248` merge contract is broken (e.g. someone accidentally removes the merge branch and makes second-add return a fresh UUID). Schema drift on `kg_edges` ON CONFLICT clause caught by `edge_upsert_no_dup`.
- **T-16-04-03 (E — privilege):** n/a. No auth surface.

No new threat surface introduced beyond the SQLite-init + temp-file write that already exists in `embeddings.rs` evals.

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, file-access patterns, or schema changes outside the test-only `BLADE_CONFIG_DIR` temp directory.

---

## Self-Check: PASSED

- [x] `src-tauri/src/evals/kg_integrity_eval.rs` exists (284 LOC, contains `fn evaluates_kg_integrity`, imports `super::harness` + `crate::knowledge_graph`, file header documents the consolidate_kg resolution)
- [x] Commit `1a764d3` exists in `git log --oneline` for the per-task commit
- [x] `.planning/REQUIREMENTS.md` EVAL-02 box checked
- [x] `.planning/ROADMAP.md` 16-04 line marked shipped with commit hash
- [x] `.planning/STATE.md` frontmatter + status + session-continuity updated; new session-update line appended
- [x] `cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` exits 0; stdout contains `┌──` and `MRR: 1.000`

Wave 2 progress: 3/5 plans (16-02 + 16-03 + 16-04 done; 16-05 + 16-06 remain — both still parallel-ready, both consume `super::harness::*` from Wave 1).
