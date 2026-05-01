#!/usr/bin/env bash
# verify:voyager-loop — Phase 22 Plan 22-07 (v1.3) gate.
#
# Drives the canonical Voyager loop end-to-end deterministically (no LLM
# call, no network) by running:
#
#   1. tool_forge::tests::voyager_end_to_end_youtube_transcript_fixture
#      — closes the loop: gap → forge → SKILL.md → DB row → catalog
#        resolution; asserts the 6-step Voyager invariant
#
#   2. tool_forge::tests::voyager_two_installs_diverge
#      — two isolated BLADE_CONFIG_DIR runs / different gap streams /
#        different manifests (VOYAGER-09 property)
#
# Both tests run from the same compiled artifact, share the module-level
# ENV_LOCK, and complete in <3s combined on a warm cargo cache.
#
# Wired into npm run verify:all chain at the tail (after verify:skill-format).
#
# Manual invocation:
#   bash scripts/verify-voyager-loop.sh

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root/src-tauri"

echo "[verify:voyager-loop] running deterministic Voyager fixture tests..."

# --quiet keeps the output to test result lines + diagnostics; -- --nocapture
# would dump per-test stderr but we don't need it for a gate run.
# cargo test takes only one testname pattern. Use the shared `voyager_`
# substring — matches both end_to_end_youtube_transcript_fixture and
# two_installs_diverge. --test-threads=1 ensures the module-level ENV_LOCK
# isn't redundant with cargo's parallelism.
if ! cargo test --quiet --lib tool_forge::tests::voyager_ \
    -- --test-threads=1 2>&1; then
    echo "[verify:voyager-loop] FAIL: Voyager loop tests failed" >&2
    exit 1
fi

echo "[verify:voyager-loop] OK: Voyager loop closes end-to-end (2/2 tests green)"
exit 0
