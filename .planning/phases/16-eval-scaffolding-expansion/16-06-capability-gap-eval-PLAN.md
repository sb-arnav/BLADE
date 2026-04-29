---
phase: 16-eval-scaffolding-expansion
plan: 06
type: execute
wave: 2
depends_on: [16-01]
files_modified:
  - src-tauri/src/evals/capability_gap_eval.rs
autonomous: true
requirements: [EVAL-05]
must_haves:
  truths:
    - "`cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1` exits 0"
    - "stdout contains the `┌──` delimiter (EVAL-06 contract)"
    - "Every catalog-matching stderr+command pair returns `Some(CapabilityGap)` with the right suggestion"
    - "The false-positive case (`cargo build` stderr mentioning `fd-build.log`) returns `None`"
    - "Negative cases (unknown tool, no not-found phrase) return `None`"
  artifacts:
    - path: "src-tauri/src/evals/capability_gap_eval.rs"
      provides: "Capability-gap classifier eval — 7 stderr/command cases including false-positive regression"
      min_lines: 180
      contains: "fn evaluates_capability_gap_detection"
  key_links:
    - from: "src-tauri/src/evals/capability_gap_eval.rs"
      to: "src-tauri/src/self_upgrade.rs"
      via: "use crate::self_upgrade::{detect_missing_tool, CapabilityGap, capability_catalog}"
      pattern: "use crate::self_upgrade"
    - from: "src-tauri/src/evals/capability_gap_eval.rs"
      to: "src-tauri/src/evals/harness.rs"
      via: "use super::harness::{print_eval_table, EvalRow}"
      pattern: "use super::harness"
---

<objective>
Replace the Wave 1 stub at `src-tauri/src/evals/capability_gap_eval.rs` with a NEW capability-gap classifier eval. There is no source to relocate. Pattern borrowed from `action_tags.rs:215-242` (input-string → parsed-struct table-driven test).

Purpose: Prove `self_upgrade::detect_missing_tool(stderr, command)` correctly classifies (a) 4 positive cases across Linux/Windows/macOS shell-not-found phrasings, (b) 1 false-positive regression case (the strict-matcher fix at `self_upgrade.rs:272-285`), (c) 2 negative cases (unknown tool not in catalog + stderr without any not-found phrase).

**REQ-vs-real path resolution:** REQUIREMENTS.md EVAL-05 names `evolution::detect_missing_tool` — this is descriptive-but-wrong. The live function is `self_upgrade::detect_missing_tool` (verified at `self_upgrade.rs:260`). RESEARCH §5 resolved this: the eval imports the real path; NO re-export added. Document the resolution in the file header.

Output: A single `.rs` file with `#[test] fn evaluates_capability_gap_detection` exercising 7 cases and printing the EVAL-06 scored table.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md
@.planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md
@.planning/phases/16-eval-scaffolding-expansion/16-VALIDATION.md
@.planning/phases/16-eval-scaffolding-expansion/16-01-harness-PLAN.md
@CLAUDE.md
@src-tauri/src/self_upgrade.rs
@src-tauri/src/action_tags.rs

<interfaces>
<!-- From `harness.rs` (Plan 01): -->
```rust
pub fn print_eval_table(title: &str, rows: &[EvalRow]);
pub struct EvalRow { pub label, pub top1, pub top3, pub rr, pub top3_ids, pub expected, pub relaxed }
```

<!-- From `self_upgrade.rs` (production, public): -->
```rust
pub struct CapabilityGap {
    pub description: String,
    pub category: String,    // "missing_tool", "missing_runtime", "missing_permission"
    pub suggestion: String,  // human-readable: e.g. "Install jq" / "Install ripgrep" / "Install Node.js"
    pub install_cmd: String, // platform-specific install line; empty = skip
}

pub fn detect_missing_tool(stderr: &str, command: &str) -> Option<CapabilityGap>;  // line 260
pub fn capability_catalog() -> HashMap<&'static str, CapabilityGap>;                 // line 110

// Catalog keys (per RESEARCH §7): node, python3, rust, docker, git, ffmpeg,
// claude, aider, jq, ripgrep, fd, bat, go, htop, tmux. (CLAUDE.md says 10;
// live count is 16 — document the discrepancy in plan SUMMARY.)
```

<!-- Detector behaviour (`self_upgrade.rs:260-286`): -->
<!-- Returns Some(gap) iff:
     (a) stderr contains one of: "command not found" / "is not recognized" / ": not found" / "No such file or directory"
     (b) the FIRST whitespace-separated word of `command` is a catalog key.
     Returns None for all other stderr / non-matching commands. -->

<!-- Pattern analog: `action_tags.rs:215-242` -->
```rust
#[test]
fn test_extract_single_remember() {
    let input = "Here is your answer. [ACTION:REMEMBER:Arnav prefers dark mode]";
    let (clean, actions) = extract_actions(input);
    assert_eq!(clean, "Here is your answer.");
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].tag, "REMEMBER");
}

#[test]
fn test_no_actions() {
    let input = "Nothing special here.";
    let (clean, actions) = extract_actions(input);
    assert_eq!(clean, "Nothing special here.");
}
```
</interfaces>

<gotchas>
1. **REQ-vs-real path mismatch — RESOLVED.** REQUIREMENTS.md EVAL-05 says `evolution::detect_missing_tool`; the live path is `self_upgrade::detect_missing_tool`. Per RESEARCH §5: the eval imports `self_upgrade`, NO re-export added. The file header doc-comment MUST document this verbatim from RESEARCH §5 lines 290-298.
2. **`detect_missing_tool` is a strict matcher** — both stderr-pattern AND command-first-token-in-catalog must hold. The false-positive case (`stderr` mentions `fd-build.log` but `command` is `cargo build`) MUST return `None` — this is the regression test for the fix at `self_upgrade.rs:272-285`.
3. **Catalog key list verification** — run `grep -nE '"(node|python3|rust|docker|git|ffmpeg|claude|aider|jq|ripgrep|fd|bat|go|htop|tmux)"' src-tauri/src/self_upgrade.rs` to confirm catalog keys exist. If any key the eval uses isn't in the catalog, the eval will fail unexpectedly (the detector returns None). Pick eval cases from confirmed-present catalog keys only.
4. **Suggestion-string matching is case-insensitive** — `gap.suggestion.to_lowercase().contains(expected.to_lowercase())`. Catalog suggestions may say "Install jq" or "JQ - JSON processor" — case-folding in the assert handles both.
5. **No SQLite involvement** — `detect_missing_tool` is pure: `(stderr, command) → Option<CapabilityGap>`. NO `temp_blade_env()` call needed. The eval is the only one in Phase 16 that doesn't require temp env.
6. **`--test-threads=1` still mandatory** — the bash wrapper pins it, so the eval works either way; the verify command should still include the flag for consistency with other evals.
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify catalog keys + write the eval</name>
  <files>src-tauri/src/evals/capability_gap_eval.rs (REPLACE Wave 1 stub)</files>

  <read_first>
    - src-tauri/src/self_upgrade.rs (lines 1-50, 100-260, 260-300) — `CapabilityGap` struct, `capability_catalog` keys + suggestions, `detect_missing_tool` body + the strict-matcher fix at 272-285
    - src-tauri/src/action_tags.rs (lines 215-242) — table-driven classifier-test analog
    - src-tauri/src/evals/harness.rs (Plan 01 output) — imports
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/evals/capability_gap_eval.rs", lines 414-484)
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§5 — REQ resolution; §7 EVAL-05 — fixture cases verbatim)
  </read_first>

  <action>
**Step 1: Verify catalog keys exist.** Run:
```bash
grep -n '"jq"\|"ripgrep"\|"node"\|"ffmpeg"\|"fd"' src-tauri/src/self_upgrade.rs | head -10
```
Confirm `jq`, `ripgrep`, `node`, `ffmpeg`, `fd` all appear as catalog keys. Per RESEARCH §7 the catalog has 16 keys; the eval uses 4-5 of them.

**Step 2: Read `self_upgrade.rs:260-300`** to confirm:
- The 4 not-found stderr patterns: `"command not found"`, `"is not recognized"`, `": not found"`, `"No such file or directory"` (or whatever the live source has — verify and use the EXACT phrasings).
- The strict-matcher fix at 272-285: stderr-text-mentions-tool is NOT enough; `command`'s first whitespace-token must match a catalog key.

**Step 3: REPLACE the Wave 1 stub at `src-tauri/src/evals/capability_gap_eval.rs`** with the full eval:

```rust
//! Phase 16 / EVAL-05.
//!
//! REQUIREMENTS.md names `evolution::detect_missing_tool` but the live
//! function is `self_upgrade::detect_missing_tool` (verified at
//! `self_upgrade.rs:260`). `evolution.rs` only exposes the related
//! `evolution_log_capability_gap` (line 1115). The eval imports the
//! real path; no re-export added — see Phase 16 RESEARCH §5.
//!
//! ## Coverage
//! - 4 positive cases: Linux apt (jq), Linux bash (ripgrep), Windows cmd (node),
//!   macOS zsh (ffmpeg). Each pairs a real shell error with a real catalog
//!   command and asserts `detect_missing_tool` returns Some(gap) with the
//!   right suggestion text.
//! - 1 false-positive regression case: stderr mentions "fd" inside an
//!   unrelated `cargo build` error — must return None. This is the
//!   regression test for the strict-matcher fix at `self_upgrade.rs:272-285`.
//! - 2 negative cases: unknown tool (`foobarbaz-cli`, not in catalog) and
//!   stderr without any not-found phrase. Both must return None.
//!
//! ## Run
//! `cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1`

use super::harness::{print_eval_table, EvalRow};
use crate::self_upgrade::{capability_catalog, detect_missing_tool, CapabilityGap};

// ────────────────────────────────────────────────────────────
// Test cases (RESEARCH §7 EVAL-05)
// ────────────────────────────────────────────────────────────

struct GapCase {
    label: &'static str,
    stderr: &'static str,
    command: &'static str,
    /// Some(needle) → expect Some(gap) with suggestion containing `needle` (case-insensitive).
    /// None        → expect None (negative or false-positive case).
    expected_suggestion_contains: Option<&'static str>,
}

fn cases() -> Vec<GapCase> {
    vec![
        GapCase {
            label: "linux_apt_jq",
            stderr: "/bin/sh: 1: jq: not found",
            command: "jq '.foo' data.json",
            expected_suggestion_contains: Some("jq"),
        },
        GapCase {
            label: "linux_bash_ripgrep",
            stderr: "bash: rg: command not found",
            command: "rg 'pattern' src/",
            expected_suggestion_contains: Some("ripgrep"),
        },
        GapCase {
            label: "windows_cmd_node",
            stderr: "'node' is not recognized as an internal or external command,\noperable program or batch file.",
            command: "node script.js",
            expected_suggestion_contains: Some("node"),
        },
        GapCase {
            label: "macos_zsh_ffmpeg",
            stderr: "zsh: command not found: ffmpeg",
            command: "ffmpeg -i input.mp4 out.webm",
            expected_suggestion_contains: Some("ffmpeg"),
        },
        GapCase {
            label: "false_positive_cargo_mentions_fd",
            // Stderr mentions "fd" inside an unrelated cargo error — strict matcher must NOT trigger.
            stderr: "error: failed to read file `/tmp/fd-build.log`: No such file or directory",
            command: "cargo build",
            expected_suggestion_contains: None,
        },
        GapCase {
            label: "negative_unknown_tool",
            stderr: "/bin/sh: foobarbaz-cli: not found",
            command: "foobarbaz-cli arg",
            expected_suggestion_contains: None, // not in catalog
        },
        GapCase {
            label: "negative_no_not_found",
            stderr: "Error: invalid argument",
            command: "jq '.foo' data.json",
            expected_suggestion_contains: None, // stderr lacks any not-found phrase
        },
    ]
}

fn case_passes(case: &GapCase, result: &Option<CapabilityGap>) -> (bool, Vec<String>) {
    match (case.expected_suggestion_contains, result) {
        (Some(needle), Some(gap)) => {
            let contains = gap.suggestion.to_lowercase().contains(&needle.to_lowercase());
            (contains, vec![gap.suggestion.clone()])
        }
        (Some(_), None) => (false, vec!["<None>".to_string()]),
        (None, Some(gap)) => (false, vec![format!("UNEXPECTED Some({:?})", gap.suggestion)]),
        (None, None) => (true, vec!["<None>".to_string()]),
    }
}

// ────────────────────────────────────────────────────────────
// Test
// ────────────────────────────────────────────────────────────

#[test]
fn evaluates_capability_gap_detection() {
    // Sanity: catalog must be non-empty.
    let catalog = capability_catalog();
    assert!(!catalog.is_empty(), "capability_catalog returned empty map");

    let cases = cases();
    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    let mut all_pass = true;

    for case in &cases {
        let result = detect_missing_tool(case.stderr, case.command);
        let (pass, observed_top3) = case_passes(case, &result);
        if !pass {
            all_pass = false;
        }
        let expected_label = match case.expected_suggestion_contains {
            Some(s) => format!("Some(suggestion~={})", s),
            None    => "None".to_string(),
        };
        rows.push(EvalRow {
            label: case.label.to_string(),
            top1: pass,
            top3: pass,
            rr: if pass { 1.0 } else { 0.0 },
            top3_ids: observed_top3,
            expected: expected_label,
            relaxed: false,
        });
    }

    print_eval_table("Capability gap detection eval", &rows);

    // Floor: all 7 cases must pass — no slop tolerated for a classifier.
    for (i, case) in cases.iter().enumerate() {
        assert!(
            rows[i].top1,
            "{} failed (stderr={:?} command={:?} expected_suggestion_contains={:?} → got top3_ids={:?})",
            case.label, case.stderr, case.command, case.expected_suggestion_contains, rows[i].top3_ids,
        );
    }
    assert!(all_pass, "capability gap eval: at least one case failed");
}
```

**Step 4: Compile + run:**
```bash
cd src-tauri && cargo test --lib evals::capability_gap_eval --no-run --test-threads=1 2>&1 | tail -10
cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1 2>&1 | tail -25
```
Expected: scored table opens with `┌── Capability gap detection eval ──`, 7 rows (4 positive + 1 false-positive regression + 2 negative), all top1=✓ rr=1.00, summary `top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000`, exit 0.

**If `linux_bash_ripgrep` fails:** the catalog key may be `"rg"` not `"ripgrep"` — check the catalog and adjust the `command:` field (use `rg` as the first word) AND the `expected_suggestion_contains:` (try `"ripgrep"` first, fall back to `"rg"` based on the live suggestion text).

**If `windows_cmd_node` fails:** Windows stderr in the catalog matcher may need exact `"is not recognized as an internal or external command"` (no truncation). Adjust the stderr to the live regex/contains pattern.

**If false-positive `cargo build` case INCORRECTLY returns `Some`:** that means the strict-matcher fix at `self_upgrade.rs:272-285` has regressed — the eval has caught a real bug. Surface in the SUMMARY; do NOT weaken the eval to make it pass.
  </action>

  <acceptance_criteria>
- `test -f src-tauri/src/evals/capability_gap_eval.rs` exits 0
- File is no longer the Wave 1 stub: `wc -l src-tauri/src/evals/capability_gap_eval.rs` ≥ 180
- `grep -q "use super::harness" src-tauri/src/evals/capability_gap_eval.rs` exits 0
- `grep -q "use crate::self_upgrade" src-tauri/src/evals/capability_gap_eval.rs` exits 0
- `grep -q "fn evaluates_capability_gap_detection" src-tauri/src/evals/capability_gap_eval.rs` exits 0
- File header documents the REQ-vs-real path mismatch — `grep -q "evolution::detect_missing_tool" src-tauri/src/evals/capability_gap_eval.rs` AND `grep -q "self_upgrade::detect_missing_tool" src-tauri/src/evals/capability_gap_eval.rs`
- `grep -q "false_positive_cargo_mentions_fd" src-tauri/src/evals/capability_gap_eval.rs` exits 0 (the regression case)
- All 7 case labels present — `for label in linux_apt_jq linux_bash_ripgrep windows_cmd_node macos_zsh_ffmpeg false_positive_cargo_mentions_fd negative_unknown_tool negative_no_not_found; do grep -q "$label" src-tauri/src/evals/capability_gap_eval.rs || echo MISSING $label; done` returns no MISSING lines
- File contains zero `todo!()` markers — `! grep -q "todo!" src-tauri/src/evals/capability_gap_eval.rs`
- `cd src-tauri && cargo test --lib evals::capability_gap_eval --no-run --test-threads=1` exits 0
- `cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1` exits 0
- Stdout contains `┌── Capability gap detection eval ──`
- Stdout shows 7 rows pass — `... | grep -E "MRR: 1\.000"`
  </acceptance_criteria>

  <verify>
    <automated>cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1 2>&1 | tee /tmp/16-06-out.log | tail -20 && grep -q '┌── Capability gap detection eval' /tmp/16-06-out.log && grep -q "MRR: 1\.000" /tmp/16-06-out.log && ! grep -q "todo!" src-tauri/src/evals/capability_gap_eval.rs</automated>
  </verify>

  <done>`evals/capability_gap_eval.rs` is fully populated; cargo exits 0; stdout carries the `┌──` table with 7 rows; all 4 positive + 1 false-positive + 2 negative cases pass; the file header documents the REQ-vs-real `evolution::` → `self_upgrade::` resolution.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none in this plan) | Eval calls a pure function `(stderr, command) → Option<gap>`. No I/O. No SQLite. No network. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-06-01 | T (Tampering) | A future loosening of `detect_missing_tool` (e.g. dropping the catalog-key check) would re-enable the spurious-install bug fixed at `self_upgrade.rs:272-285` | mitigate | The `false_positive_cargo_mentions_fd` row IS the regression gate that catches this. Do NOT weaken the eval. |
| T-16-06-02 | E (Elevation of privilege) | If `auto_install` were ever wired into this eval and a synthetic gap triggered `apt install`, that would be a privilege-escalation path | accept (out of scope) | This eval does NOT call `auto_install`. The detector is pure. RESEARCH §"Out of Scope" explicitly defers `auto_install` quality eval. |

**Severity rollup:** all LOW. Pure-function classification with no state mutation.
</threat_model>

<verification>
After the 1 task completes:

```bash
cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1 2>&1 | tail -25
# Expected:
# ┌── Capability gap detection eval ──
# │ linux_apt_jq                      top1=✓ top3=✓ rr=1.00 → top3=["Install jq"] (want=Some(suggestion~=jq))
# │ linux_bash_ripgrep                top1=✓ top3=✓ rr=1.00 → top3=["Install ripgrep"] (want=Some(suggestion~=ripgrep))
# │ windows_cmd_node                  top1=✓ top3=✓ rr=1.00 → top3=["Install Node.js"] (want=Some(suggestion~=node))
# │ macos_zsh_ffmpeg                  top1=✓ top3=✓ rr=1.00 → top3=["Install FFmpeg"] (want=Some(suggestion~=ffmpeg))
# │ false_positive_cargo_mentions_fd  top1=✓ top3=✓ rr=1.00 → top3=["<None>"] (want=None)
# │ negative_unknown_tool             top1=✓ top3=✓ rr=1.00 → top3=["<None>"] (want=None)
# │ negative_no_not_found             top1=✓ top3=✓ rr=1.00 → top3=["<None>"] (want=None)
# ├──...
# │ top-1: 7/7 (100%)  top-3: 7/7 (100%)  MRR: 1.000
# └──...
# test result: ok. 1 passed; 0 failed
```
</verification>

<success_criteria>
1. `evals/capability_gap_eval.rs` is fully populated (no stub, no `todo!()`)
2. `cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1` exits 0
3. Stdout carries `┌──` opening (EVAL-06 contract)
4. 4 positive cases (Linux apt jq, Linux bash ripgrep, Windows cmd node, macOS zsh ffmpeg) all return `Some(gap)` with right suggestion
5. False-positive regression case (`cargo build` mentioning `fd-build.log`) returns `None` — proves strict-matcher fix holds
6. 2 negative cases (unknown tool, no not-found phrase) return `None`
7. File header documents the `evolution::` → `self_upgrade::` REQ-vs-real resolution per RESEARCH §5
8. EVAL-05 requirement satisfied
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-06-SUMMARY.md` documenting:
- File created (was a Wave 1 stub)
- 7 cases tested + their pass/fail status
- Catalog key count observed (per RESEARCH §7: live count is 16; CLAUDE.md says 10 — note the discrepancy)
- The REQ-vs-real path resolution (file header)
- Cargo command + exit code
</output>
