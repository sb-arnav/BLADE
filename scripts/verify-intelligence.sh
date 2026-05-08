#!/usr/bin/env bash
# scripts/verify-intelligence.sh -- Phase 37 / EVAL-01..05 invariant.
# Gate 38: all intelligence eval scenarios must pass (MODULE_FLOOR = 1.0).
#
# Exit 0 = cargo green + scored table emitted (or BLADE_INTELLIGENCE_EVAL=false)
# Exit 1 = cargo failed (assertion regression in intelligence eval)
# Exit 2 = scored table delimiter not found -- table-presence regression
# Exit 3 = cargo not on PATH
#
# @see src-tauri/src/evals/intelligence_eval.rs -- 26 deterministic fixtures
# @see src-tauri/src/evals/harness.rs -- print_eval_table format spec

set -uo pipefail

# CTX-07-style escape hatch (8th application of v1.1 lesson) -- eval surface
# must not block release if it's broken. BLADE_INTELLIGENCE_EVAL=false
# short-circuits to exit 0 with a skip message; default treats unset as "true".
if [ "${BLADE_INTELLIGENCE_EVAL:-true}" = "false" ]; then
    echo "[verify-intelligence] SKIP -- disabled via BLADE_INTELLIGENCE_EVAL=false"
    exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
    echo "[verify-intelligence] ERROR: cargo not on PATH" >&2
    exit 3
fi

# --test-threads=1 is MANDATORY (shares EVAL_FORCE_PROVIDER thread_local +
# LAST_BREAKDOWN process-global + BLADE_CONFIG_DIR env-var state)
STDOUT=$(cd src-tauri && cargo test --lib evals::intelligence_eval --quiet -- --nocapture --test-threads=1 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
    echo "$STDOUT"
    echo "[verify-intelligence] FAIL: intelligence eval exited $RC"
    exit 1
fi

# EVAL-06 contract: look for box-drawing table delimiter (U+250C)
TABLE_COUNT=$(printf '%s' "$STDOUT" | grep -c $'\xe2\x94\x8c' || true)

if [ "$TABLE_COUNT" -lt 1 ]; then
    echo "$STDOUT"
    echo "[verify-intelligence] FAIL: no scored table emitted"
    exit 2
fi

echo "$STDOUT" | grep -E '^\xe2\x94' || true
echo "[verify-intelligence] OK -- all intelligence eval scenarios passed"
exit 0
