#!/usr/bin/env bash
# scripts/verify-eval.sh — Phase 16 / EVAL-06 + EVAL-07 invariant.
#
# Runs the Phase 16 eval harness and confirms every module printed its
# scored table. Floor enforcement (top-3 ≥ 80%, MRR ≥ 0.6) lives in the
# `assert!`s of each eval module — this wrapper checks (a) cargo exit
# code and (b) that ≥5 `┌──` table headers appear in stdout (EVAL-06).
#
# Exit 0 = cargo green + ≥5 scored tables emitted
# Exit 1 = cargo failed (assertion regression in some eval module)
# Exit 2 = `┌──` delimiter not found enough times — table-presence regression
# Exit 3 = cargo not on PATH OR build error before tests ran
#
# @see .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md §6
# @see src-tauri/src/evals/harness.rs — print_eval_table format spec
# @see src-tauri/src/evals/mod.rs — 5 eval module declarations

set -uo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-eval] ERROR: cargo not on PATH" >&2
  exit 3
fi

# `--test-threads=1` is MANDATORY — `BLADE_CONFIG_DIR` env-var races on parallelism.
# `--nocapture` is required so println! reaches stdout (the EVAL-06 grep target).
# `--quiet` reduces cargo build chatter; per-test stdout is preserved.
STDOUT=$(cd src-tauri && cargo test --lib evals --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-eval] FAIL: cargo test --lib evals exited $RC"
  exit 1
fi

# EVAL-06 grep target: U+250C U+2500 U+2500 — every eval module emits this prefix.
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c '┌──' || true)
EXPECTED=5  # hybrid_search + real_embedding + kg_integrity + typed_memory + capability_gap

if [ "$TABLE_COUNT" -lt "$EXPECTED" ]; then
  echo "$STDOUT"
  echo "[verify-eval] FAIL: only $TABLE_COUNT scored tables emitted, expected $EXPECTED (EVAL-06)"
  echo "  An eval module forgot to call harness::print_eval_table, or --nocapture was stripped."
  exit 2
fi

# Echo just the table lines for CI log readability.
echo "$STDOUT" | grep -E '^(┌──|│|├|└)' || true
echo "[verify-eval] OK — $TABLE_COUNT/$EXPECTED scored tables emitted, all floors green"
exit 0
