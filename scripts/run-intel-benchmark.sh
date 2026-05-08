#!/usr/bin/env bash
# scripts/run-intel-benchmark.sh -- Phase 37 / EVAL-01 operator-runnable benchmark wrapper.
# CONTEXT lock §Operator-Runnable Benchmark.
#
# OPT-IN ONLY. Calls REAL LLM providers; estimated cost ~$5 (10 fixtures x $0.50 cap).
# NOT in verify:all. NOT in CI.
#
# Usage:
#   BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh
#
# Outputs eval-runs/v1.5-baseline.json (operator commits this file).

set -uo pipefail

if [ "${BLADE_RUN_BENCHMARK:-false}" != "true" ]; then
    echo "[run-intel-benchmark] SKIP -- set BLADE_RUN_BENCHMARK=true to run"
    echo ""
    echo "This benchmark calls REAL LLM providers using your configured BLADE"
    echo "provider + model (per ~/.config/blade/config.json). Cost ceiling:"
    echo "~\$5 across 10 fixtures (\$0.50 hard cap each)."
    echo ""
    echo "Usage:"
    echo "  BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh"
    echo ""
    exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
    echo "[run-intel-benchmark] ERROR: cargo not on PATH" >&2
    exit 3
fi

cd "$(dirname "$0")/../src-tauri" || exit 4

echo "[run-intel-benchmark] starting; results will write to eval-runs/v1.5-baseline.json"
BLADE_RUN_BENCHMARK=true cargo run --bin intelligence-benchmark --release "$@"
RC=$?

if [ $RC -ne 0 ]; then
    echo "[run-intel-benchmark] FAIL: exit $RC"
    exit $RC
fi

echo "[run-intel-benchmark] OK -- baseline written; commit eval-runs/v1.5-baseline.json"
exit 0
