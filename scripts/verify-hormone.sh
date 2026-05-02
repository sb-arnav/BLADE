#!/usr/bin/env bash
# scripts/verify-hormone.sh -- Phase 27 / HORM-01..09 invariant.
# Gate 35: all hormone physiology eval scenarios must pass (MODULE_FLOOR = 0.95).
#
# Exit 0 = cargo green + scored table emitted
# Exit 1 = cargo failed (assertion regression in hormone eval)
# Exit 2 = scored table delimiter not found -- table-presence regression
# Exit 3 = cargo not on PATH
#
# @see src-tauri/src/evals/hormone_eval.rs -- 9 deterministic fixtures
# @see src-tauri/src/evals/harness.rs -- print_eval_table format spec

set -uo pipefail

if ! command -v cargo >/dev/null 2>&1; then
  echo "[verify-hormone] ERROR: cargo not on PATH" >&2
  exit 3
fi

# --test-threads=1 is MANDATORY (eval fixtures share global PHYSIOLOGY state)
STDOUT=$(cd src-tauri && cargo test --lib evals::hormone_eval --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  echo "$STDOUT"
  echo "[verify-hormone] FAIL: hormone eval exited $RC"
  exit 1
fi

# EVAL-06 contract: look for box-drawing table delimiter (U+250C)
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)

if [ "$TABLE_COUNT" -lt 1 ]; then
  echo "$STDOUT"
  echo "[verify-hormone] FAIL: no scored table emitted"
  exit 2
fi

echo "$STDOUT" | grep -E '^\xe2\x94' || true
echo "[verify-hormone] OK -- all hormone physiology scenarios passed"
exit 0
