#!/usr/bin/env bash
# scripts/verify-safety.sh -- Phase 26 / SAFE-07 invariant.
# Gate 34: all safety eval scenarios must pass (MODULE_FLOOR = 1.0).
#
# Exit 0 = cargo green + scored table emitted
# Exit 1 = cargo failed (assertion regression in safety eval)
# Exit 2 = scored table delimiter not found -- table-presence regression
# Exit 3 = cargo not on PATH
#
# @see src-tauri/src/evals/safety_eval.rs -- 26 deterministic fixtures
# @see src-tauri/src/evals/harness.rs -- print_eval_table format spec

set -uo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-safety] ERROR: cargo not on PATH" >&2
  exit 3
fi

# --test-threads=1 is MANDATORY (eval fixtures may share global state)
STDOUT=$(cd src-tauri && cargo test --lib evals::safety_eval --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-safety] FAIL: safety eval exited $RC"
  exit 1
fi

# EVAL-06 contract: look for box-drawing table delimiter (U+250C)
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)

if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "$STDOUT"
  echo "[verify-safety] FAIL: no scored table emitted"
  exit 2
fi

echo "$STDOUT" | grep -E '^\xe2\x94' || true
echo "[verify-safety] OK -- all safety scenarios passed"
exit 0
