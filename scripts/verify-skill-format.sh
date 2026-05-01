#!/usr/bin/env bash
# verify:skill-format — Phase 21 (v1.3) gate.
#
# Runs the skill_validator binary (built once) against:
#   - <repo>/skills/bundled/   (always; bundled tier)
#   - <repo>/skills/           (workspace tier; only if any direct subdir
#                               other than bundled/ has a SKILL.md)
#
# Exits 0 on full-green, 1 on any error. Warnings are tolerated and
# surfaced verbatim.
#
# Wired into npm run verify:all chain at the tail (after verify:eval).
#
# Manual invocation:
#   bash scripts/verify-skill-format.sh

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

echo "[verify:skill-format] building skill_validator..."
(cd src-tauri && cargo build --quiet --bin skill_validator) >/dev/null

bin="$repo_root/src-tauri/target/debug/skill_validator"
if [ ! -x "$bin" ]; then
    echo "[verify:skill-format] FAIL: validator binary not found at $bin" >&2
    exit 1
fi

bundled_root="$repo_root/skills/bundled"
workspace_root="$repo_root/skills"

errors=0
total=0

run_validator() {
    local label="$1"
    local root="$2"
    if [ ! -d "$root" ]; then
        echo "[verify:skill-format] $label: $root missing — skipping" >&2
        return 0
    fi
    # Use --recursive: validate every immediate subdir with a SKILL.md
    if ! "$bin" --recursive "$root" 2>&1; then
        errors=$((errors + 1))
    fi
    # Count skills surfaced
    while IFS= read -r line; do
        case "$line" in
            "OK  "* | "WARN  "* | "FAIL  "*) total=$((total + 1)) ;;
        esac
    done < <("$bin" --recursive "$root" 2>&1 || true)
}

echo "[verify:skill-format] validating bundled tier..."
run_validator "bundled" "$bundled_root"

# Validate the workspace tier too — but only if there are skills outside
# bundled/. The workspace tier's canonical root is <repo>/skills/ excluding
# bundled/. We check by listing direct-subdir SKILL.md files outside bundled.
workspace_has_skills=0
if [ -d "$workspace_root" ]; then
    while IFS= read -r dir; do
        # Skip the bundled subtree
        case "$dir" in
            "$bundled_root"|"$bundled_root"/*) continue ;;
        esac
        if [ -f "$dir/SKILL.md" ]; then
            workspace_has_skills=1
            break
        fi
    done < <(find "$workspace_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
fi

if [ "$workspace_has_skills" -eq 1 ]; then
    echo "[verify:skill-format] validating workspace tier..."
    # Workspace tier scan must skip the bundled subdir. Easiest: validate each
    # non-bundled subdir individually.
    while IFS= read -r dir; do
        case "$dir" in
            "$bundled_root"|"$bundled_root"/*) continue ;;
        esac
        if [ -f "$dir/SKILL.md" ]; then
            if ! "$bin" "$dir" 2>&1; then
                errors=$((errors + 1))
            fi
            total=$((total + 1))
        fi
    done < <(find "$workspace_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null)
fi

if [ "$errors" -gt 0 ]; then
    echo "[verify:skill-format] FAIL: $errors skill(s) failed validation (out of $total)" >&2
    exit 1
fi

if [ "$total" -eq 0 ]; then
    echo "[verify:skill-format] FAIL: no SKILL.md files found under $workspace_root" >&2
    exit 1
fi

echo "[verify:skill-format] OK: $total skill(s) validated"
exit 0
