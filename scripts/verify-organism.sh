#!/usr/bin/env bash
# scripts/verify-organism.sh -- Phase 30 / OEVAL-01..05 invariant.
# Gate 38: all organism eval scenarios must pass (MODULE_FLOOR = 1.0).
#
# Exit 0 = cargo green + scored table emitted
# Exit 1 = cargo failed (assertion regression in organism eval)
# Exit 2 = scored table delimiter not found -- table-presence regression
# Exit 3 = cargo not on PATH
#
# @see src-tauri/src/evals/organism_eval.rs -- 13 deterministic fixtures
# @see src-tauri/src/evals/harness.rs -- print_eval_table format spec

set -uo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-organism] ERROR: cargo not on PATH" >&2
  exit 3
fi

# --test-threads=1 is MANDATORY (shares global VITALITY + PHYSIOLOGY state)
STDOUT=$(cd src-tauri && cargo test --lib evals::organism_eval --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-organism] FAIL: organism eval exited $RC"
  exit 1
fi

# EVAL-06 contract: look for box-drawing table delimiter (U+250C)
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)

if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "$STDOUT"
  echo "[verify-organism] FAIL: no scored table emitted"
  exit 2
fi

echo "$STDOUT" | grep -E '^\xe2\x94' || true
echo "[verify-organism] OK -- all organism eval scenarios passed"
exit 0
