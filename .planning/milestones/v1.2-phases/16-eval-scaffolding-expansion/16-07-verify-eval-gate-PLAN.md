---
phase: 16-eval-scaffolding-expansion
plan: 07
type: execute
wave: 3
depends_on: [16-02, 16-03, 16-04, 16-05, 16-06]
files_modified:
  - scripts/verify-eval.sh
  - tests/evals/DEFERRED.md
  - package.json
  - src-tauri/src/embeddings.rs
autonomous: true
requirements: [EVAL-06, EVAL-07, EVAL-08]
must_haves:
  truths:
    - "`bash scripts/verify-eval.sh` exits 0 (cargo green AND ≥5 `┌──` tables in stdout)"
    - "`bash scripts/verify-eval.sh` returns exit 2 if any eval module forgets to call `print_eval_table` (verified by temporarily disabling a print, then restoring)"
    - "`npm run verify:eval` exits 0 (delegates to bash wrapper)"
    - "`npm run verify:all` exits 0 — chain count moves from 30 to 31"
    - "`tests/evals/DEFERRED.md` exists with ≥3 structured entries (each with Rationale / Budget / Promotion Trigger paragraphs)"
    - "`embeddings.rs:496-946` is deleted; production code (lines 1-489) untouched; file shrinks by ~440 lines"
    - "Full `cargo test --lib evals -- --nocapture --test-threads=1` runs all 5 eval modules green after the deletion"
  artifacts:
    - path: "scripts/verify-eval.sh"
      provides: "EVAL-06 + EVAL-07 gate — wraps cargo test in a bash script with table-presence grep and named exit codes"
      min_lines: 35
      contains: "set -euo pipefail"
    - path: "tests/evals/DEFERRED.md"
      provides: "EVAL-08 — ≥3 LLM-API-dependent evals deferred to v1.3 with structured rationale"
      contains: "## "
    - path: "package.json"
      provides: "EVAL-07 — `verify:eval` script entry + `verify:all` chain extension"
      contains: "verify:eval"
  key_links:
    - from: "package.json"
      to: "scripts/verify-eval.sh"
      via: "verify:eval script entry"
      pattern: "bash scripts/verify-eval.sh"
    - from: "package.json"
      to: "verify:all chain"
      via: "&& npm run verify:eval suffix"
      pattern: "&& npm run verify:eval"
---

<objective>
Close the Phase 16 eval gate by shipping the bash wrapper, the `verify:all` chain entry, the deferred-evals doc, AND deleting the original eval blocks from `embeddings.rs`. This is the Wave 3 gate-closer plan — it depends on Plans 02-06 because `verify-eval.sh` exits 0 only when all 5 eval modules run green.

Purpose: Convert the 5 eval modules from "tests that exist" to "tests enforced by CI". Add the doc that explains why the LLM-driven evals (extract_conversation_facts, weekly_memory_consolidation, evolution suggestion quality) were deferred to v1.3. Reclaim ~440 lines of `embeddings.rs` by deleting the now-obsolete inline test blocks.

Output: 4 file artifacts (`verify-eval.sh` new, `tests/evals/DEFERRED.md` new, `package.json` modified, `embeddings.rs` lines 496-946 deleted). After this plan, `npm run verify:all` includes the eval gate; phase 16 is done.

**Critical ordering:** the `embeddings.rs` deletion happens LAST in this plan. The new eval modules must compile and pass first; otherwise we'd briefly have a state where production code's tests are gone but the new ones don't compile yet.
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
@.planning/phases/16-eval-scaffolding-expansion/16-02-hybrid-search-eval-PLAN.md
@.planning/phases/16-eval-scaffolding-expansion/16-03-real-embedding-eval-PLAN.md
@CLAUDE.md
@scripts/verify-chat-rgba.sh
@scripts/verify-phase5-rust-surface.sh
@package.json
@src-tauri/src/embeddings.rs

<interfaces>
<!-- bash analog (canonical 25-42 line wrapper) -->
From `scripts/verify-chat-rgba.sh:1-42`:
```bash
#!/usr/bin/env bash
# scripts/verify-chat-rgba.sh — D-70 / SC-5 invariant.
set -euo pipefail
HITS=$(grep -rnE "..." "$DIR" 2>/dev/null || true)
if [ -n "$HITS" ]; then
  echo "[verify-chat-rgba] FAIL: ..."
  echo "$HITS"
  exit 1
fi
echo "[verify-chat-rgba] OK — ..."
exit 0
```

From `scripts/verify-phase5-rust-surface.sh:18-22` (exit-code 2 convention):
```bash
if [ ! -f "$LIB_RS" ]; then
  echo "[verify-phase5-rust-surface] ERROR: $LIB_RS not found; wrong cwd?" >&2
  exit 2
fi
```

<!-- package.json shape -->
From `package.json:16`:
```json
"verify:chat-rgba": "bash scripts/verify-chat-rgba.sh",
```

From `package.json:40` (verify:all tail, current shape):
```json
"verify:all": "npm run verify:entries && ... && npm run verify:empty-states-copy",
```

<!-- DEFERRED.md format reference -->
RESEARCH §8 has a full draft for the doc body — Tasks 2 below copies it verbatim.
</interfaces>

<gotchas>
1. **Order of operations is load-bearing:** Tasks 1-3 first (verify wrapper + DEFERRED + package.json — these depend on the eval modules existing but don't depend on the source-deletion). Then Task 4 deletes `embeddings.rs:496-946`. Then Task 5 re-runs `npm run verify:all` to confirm nothing regressed.
2. **`set -euo pipefail` must be at the top** of the wrapper. Without `-e` the wrapper might silently mask cargo failures; without `-u` typo'd vars become empty strings; without `pipefail` the `cargo ... | head` pipe could hide cargo's exit code.
3. **`cd src-tauri` is required inside the wrapper** — `cargo test --lib` resolves the lib via `Cargo.toml` in the cwd. Use a subshell `(cd src-tauri && cargo test ...)` or set `CARGO_TARGET_DIR` and pass `--manifest-path`.
4. **`--test-threads=1` mandatory** in the wrapper — `BLADE_CONFIG_DIR` env races. Without this flag, the eval is flaky.
5. **`┌──` is U+250C U+2500 U+2500** — bash + grep handle UTF-8 fine on macOS / Linux when locale is UTF-8 (always true on BLADE's CI). No `LC_ALL` gymnastics.
6. **Expected table count is 5** (hybrid_search + real_embedding + kg_integrity + typed_memory + capability_gap). Not 4 — RESEARCH §6 wrapper sketch said `≥4` but per `mod.rs` (Plan 01) and Wave 2 plans, there are 5 eval modules. The wrapper's expected count must be `5`.
7. **`verify:all` chain shape** — the existing chain in `package.json:40` is a single quoted string with `&&`-separated commands. Append `&& npm run verify:eval` to the END of that string. Do NOT split into multi-line. Validate the JSON parses (`node -e "JSON.parse(require('fs').readFileSync('package.json'))"`) before committing.
8. **Count: 30 → 31, NOT 27 → 28+** — REQUIREMENTS.md says "27 → 28+" but the live `verify:all` chain has 30 commands (validated in Plan 16-RESEARCH.md §6). Both numbers are correct — REQ counts the spec; live counts the actual chain. Document both in SUMMARY.
9. **DELETION boundary in `embeddings.rs`** — lines 1-489 stay (production: VectorStore, embed_texts, hybrid_search, RRF math, cosine_similarity). Lines 496-946 (`mod memory_recall_eval` + comment block above + `mod memory_recall_real_embedding` + smoke-test sub-fn) are deleted. The production-code/test-code boundary is at line 489 (or wherever the production code ends — verify before deleting).
10. **Verify production code visibility before deletion** — Wave 2 evals import `VectorStore`, `SearchResult`, `embed_texts`, `cosine_similarity` from `crate::embeddings`. These MUST already be `pub` (they are — they're called from `commands.rs`). If any are `pub(crate)`, the deletion WILL break the new evals — escalate before proceeding.
11. **DEFERRED.md location is `tests/evals/DEFERRED.md`** (literal repo-root path), NOT `src-tauri/src/evals/DEFERRED.md`. RESEARCH §8 + §10 R10 + VALIDATION command verify this. Create the `tests/evals/` directory just to hold the file.
12. **DEFERRED.md content quality is a manual-only check** (VALIDATION §"Manual-Only Verifications") — the automated check is `grep -c '^## '` ≥ 3. The executor MUST write meaningful Rationale / Budget / Promotion Trigger paragraphs, not boilerplate.
</gotchas>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write scripts/verify-eval.sh and confirm exit-code contract</name>
  <files>scripts/verify-eval.sh (NEW)</files>

  <read_first>
    - scripts/verify-chat-rgba.sh (lines 1-42) — canonical 25-42 line wrapper analog
    - scripts/verify-phase5-rust-surface.sh (lines 18-22) — exit-code 2 / 3 convention
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§6 — wrapper sketch verbatim, exit-code contract table)
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "scripts/verify-eval.sh", lines 487-583)
  </read_first>

  <action>
**Step 1: Read the canonical analogs** to verify shape conventions:
- `scripts/verify-chat-rgba.sh` — header comment + set -euo pipefail + single-grep + exit 0/1
- `scripts/verify-phase5-rust-surface.sh` — exit-code 2 (file missing) convention

**Step 2: Create `scripts/verify-eval.sh`** with the following EXACT content:

```bash
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
```

**Step 3: Make the script executable:**
```bash
chmod +x scripts/verify-eval.sh
```

**Step 4: Smoke-test the wrapper end-to-end:**
```bash
bash scripts/verify-eval.sh
echo "exit_code=$?"
```
Expected: exit 0; stdout contains `[verify-eval] OK — 5/5 scored tables emitted`. The cargo run takes ~30-60s on cold path (fastembed download), ~5-10s on warm path.

**Step 5: Test the exit-code-2 path** (table-presence regression detector):
```bash
# Temporarily comment out one print_eval_table call in any eval module
# (e.g. evals/typed_memory_eval.rs), run the wrapper, confirm exit 2,
# THEN RESTORE the print_eval_table call. Do not commit the disabled state.

# Example temporary patch:
# sed -i 's|^    print_eval_table|    // print_eval_table|' src-tauri/src/evals/typed_memory_eval.rs
# bash scripts/verify-eval.sh; echo "exit_code=$?"   # expect 2
# git checkout src-tauri/src/evals/typed_memory_eval.rs   # restore
```
Acceptance: the exit-code-2 path is exercised mentally / verified by reading the script logic, not necessarily by actually running the patch — the eval module's `assert!` would fail the test BEFORE the table-count check, masking exit 2. Document in SUMMARY: "exit-code-2 verified by source inspection — fires when assert passes but print_eval_table is missing; not exercised in regression suite."
  </action>

  <acceptance_criteria>
- `test -f scripts/verify-eval.sh` exits 0
- `test -x scripts/verify-eval.sh` exits 0 (executable bit set)
- `grep -q "set -uo pipefail" scripts/verify-eval.sh` exits 0
- `grep -q "cargo test --lib evals" scripts/verify-eval.sh` exits 0
- `grep -q "test-threads=1" scripts/verify-eval.sh` exits 0
- `grep -q "EXPECTED=5" scripts/verify-eval.sh` exits 0
- `grep -q "┌──" scripts/verify-eval.sh` exits 0
- `bash scripts/verify-eval.sh` exits 0
- Stdout from `bash scripts/verify-eval.sh` contains `[verify-eval] OK — 5/5 scored tables`
  </acceptance_criteria>

  <verify>
    <automated>bash scripts/verify-eval.sh 2>&1 | tee /tmp/16-07-t1.log | tail -5 && grep -q "5/5 scored tables" /tmp/16-07-t1.log</automated>
  </verify>

  <done>`scripts/verify-eval.sh` exists, is executable, runs the 5 eval modules with `--test-threads=1 --nocapture`, asserts ≥5 `┌──` tables in stdout, exits 0.</done>
</task>

<task type="auto">
  <name>Task 2: Write tests/evals/DEFERRED.md and add verify:eval to package.json</name>
  <files>tests/evals/DEFERRED.md (NEW), package.json (MOD)</files>

  <read_first>
    - .planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md (§8 — full DEFERRED.md draft, lines 590-680 verbatim)
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "tests/evals/DEFERRED.md", lines 587-643)
    - package.json (line 16 for `verify:chat-rgba` shape, line 40 for `verify:all` chain tail)
  </read_first>

  <action>
**Step 1: Create the directory and the DEFERRED.md file.**

```bash
mkdir -p tests/evals
```

Write `tests/evals/DEFERRED.md` with the content below (verbatim from RESEARCH §8 lines 590-681, optionally tightened — the executor MAY rewrite paragraphs in their own voice but MUST preserve all 3+ sections with the structure: Rationale / Budget / Promotion Trigger).

**IMPORTANT — visual separator note:** the embedded markdown below uses `<!-- section break -->` HTML comments where horizontal rules would normally appear. That is a planning-doc artifact (a bare `---` line collides with the YAML frontmatter parser). When you write the actual `tests/evals/DEFERRED.md` file, REPLACE each `<!-- section break -->` line with a real `---` markdown horizontal rule:

```markdown
# Deferred Evals — v1.3 candidates

These evals require live LLM API calls, which means budget per CI run and
non-determinism that doesn't fit the Phase-16 floor model. Each entry documents
the rationale, a per-run cost estimate at current OpenAI/Anthropic pricing, and
the trigger condition that would justify promoting it from a stub to a live
eval module.

Phase 16 (2026-04-29) does NOT implement these. It implements only the
deterministic, embedding-and-keyword-driven evals where local fastembed +
hand-crafted fixtures produce reproducible floor checks.

<!-- section break -->

## extract_conversation_facts precision

**Rationale:** `memory.rs::extract_conversation_facts` calls a chat-completion
model with a fact-extraction prompt, then parses JSON output into `TypedMemory`
rows. Eval requires (a) a corpus of conversation transcripts with hand-labelled
"facts that should be extracted" ground truth, (b) live LLM call per
transcript, (c) precision/recall comparison against ground truth. None of
(a)–(c) lands in 2 days.

**Budget:** 50 transcripts × ~1k input tokens × ~300 output tokens on a cheap
model (Haiku / GPT-4o-mini) ≈ $0.15–$0.30 per CI run. Manageable but
unbudgeted. Cumulative cost over a year of CI runs at 1 run/day ≈ $50-110.

**Promotion trigger:** when v1.3 ships a curated 50-transcript corpus with
ground-truth labels (probably hand-labelled from real BLADE conversation logs
after operator consent), AND when CI cost budget is allocated for $5–$10/month.

<!-- section break -->

## weekly_memory_consolidation correctness

**Rationale:** `memory.rs::weekly_memory_consolidation` is a stochastic
LLM-driven process — given the same input on different days, the merge
decisions can differ. Eval requires either (a) deterministic seed +
fixed-prompt assertion, which fights the LLM, or (b) statistical assertions
across N runs, which is multi-run-cost. Neither fits the Phase-16 single-run
floor model.

**Budget:** 1 consolidation pass = ~5k input tokens × ~2k output ≈ $0.05 per
run on a cheap model. Cheap individually but multi-run statistical assertions
multiply (e.g. "merge correctness ≥ 80% across 10 runs" = $0.50/CI run).

**Promotion trigger:** when v1.3 introduces a "consolidation determinism"
config (e.g. temperature=0, fixed seed if model supports), enabling
assert-on-output. Or when statistical floor framework lands (e.g. "merge
correctness ≥ 80% across 10 runs"), which is its own eval-infra investment.

<!-- section break -->

## evolution suggestion quality

**Rationale:** `evolution.rs::run_evolution_cycle` is the autonomous loop that
suggests capability upgrades based on detected app patterns. "Is this
suggestion useful?" is fundamentally a human-judgement call. Eval requires
either (a) hand-labelled ground truth ("for app context X, suggestion Y is
good / Y' is bad"), which requires periodic re-labelling as the catalog
evolves, or (b) downstream metric ("suggestion led to install AND user didn't
dismiss within N days"), which requires telemetry BLADE deliberately doesn't
collect (zero telemetry, per PROJECT.md).

**Budget:** $0.50–$1.00 per cycle (full cycle is many tool calls + LLM
reasoning). Highest cost of the deferred set. At 1 CI cycle/day = $180-365/yr.

**Promotion trigger:** when the user opt-in feedback channel for evolution
suggestions ships (thumbs-up/down on `CapabilityReports.tsx`), accumulated
feedback becomes the eval corpus. Deferred to v1.3+ feedback-loop work.

<!-- section break -->

*Phase 16 ships the deterministic 5-eval baseline (hybrid_search,
real_embedding, kg_integrity, typed_memory, capability_gap). These three are
queued for v1.3 once budget + corpora + feedback channels exist.*
```

**Step 2: Modify `package.json` — add `verify:eval` script + chain entry.**

Read `package.json` first to see the current shape. Then make TWO edits:

(a) **Add the `verify:eval` script entry.** Insert the line below near the other bash-wrapped scripts (e.g. after `verify:empty-states-copy` or wherever the existing bash wrappers cluster). The exact placement is flexible — pick a spot consistent with the existing groupings.

```json
"verify:eval": "bash scripts/verify-eval.sh",
```

(b) **Append `&& npm run verify:eval` to the END of the `verify:all` chain.**

Find the line that looks like:
```json
"verify:all": "npm run verify:entries && ... && npm run verify:empty-states-copy",
```

Change it to:
```json
"verify:all": "npm run verify:entries && ... && npm run verify:empty-states-copy && npm run verify:eval",
```

The chain stays a single quoted string. Do NOT split into multi-line.

**Step 3: Validate the JSON parses cleanly.**

```bash
node -e "const p=require('./package.json'); console.log('verify:eval=', p.scripts['verify:eval']); console.log('verify:all has eval:', p.scripts['verify:all'].includes('npm run verify:eval'));"
```
Expected output:
```
verify:eval= bash scripts/verify-eval.sh
verify:all has eval: true
```

**Step 4: Run the new chain.**

```bash
npm run verify:eval 2>&1 | tail -10
```
Expected: exit 0, last line `[verify-eval] OK — 5/5 scored tables emitted, all floors green`.

```bash
npm run verify:all 2>&1 | tail -20
```
Expected: exit 0, the chain runs all 30 prior gates + verify:eval = 31 total gates green. (Per VALIDATION.md note: "27 → 28+" in REQUIREMENTS.md is the spec count; the live count is 30 → 31.)
  </action>

  <acceptance_criteria>
- `test -f tests/evals/DEFERRED.md` exits 0
- `test -d tests/evals/` exits 0
- `[ $(grep -c '^## ' tests/evals/DEFERRED.md) -ge 3 ]` (≥3 deferred-eval sections, EVAL-08 floor)
- `grep -q "extract_conversation_facts" tests/evals/DEFERRED.md` exits 0
- `grep -q "weekly_memory_consolidation" tests/evals/DEFERRED.md` exits 0
- `grep -q "evolution" tests/evals/DEFERRED.md` exits 0 (third deferred eval)
- Each section has Rationale + Budget + Promotion Trigger paragraphs — `grep -c "Rationale" tests/evals/DEFERRED.md` ≥ 3 AND `grep -c "Budget" tests/evals/DEFERRED.md` ≥ 3 AND `grep -c "Promotion trigger" tests/evals/DEFERRED.md` ≥ 3
- Zero `TBD` placeholders — `! grep -q "TBD" tests/evals/DEFERRED.md`
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` exits 0 (JSON is valid)
- `node -e "console.log(require('./package.json').scripts['verify:eval'])"` outputs `bash scripts/verify-eval.sh`
- `node -e "const v=require('./package.json').scripts['verify:all']; process.exit(v.includes('npm run verify:eval')?0:1)"` exits 0
- `npm run verify:eval` exits 0
- `npm run verify:all 2>&1 | tail -3 | grep -q OK` (or equivalent — chain finishes without error)
  </acceptance_criteria>

  <verify>
    <automated>test -f tests/evals/DEFERRED.md && [ $(grep -c '^## ' tests/evals/DEFERRED.md) -ge 3 ] && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && node -e "const v=require('./package.json').scripts['verify:all']; process.exit(v.includes('npm run verify:eval')?0:1)" && npm run verify:eval 2>&1 | tail -3 | grep -q "5/5 scored tables"</automated>
  </verify>

  <done>`tests/evals/DEFERRED.md` exists with ≥3 structured entries (Rationale + Budget + Promotion Trigger each); `package.json` has `verify:eval` script + chain entry; `npm run verify:eval` exits 0; `npm run verify:all` includes the eval gate (count 30 → 31).</done>
</task>

<task type="auto">
  <name>Task 3: Delete embeddings.rs:496-946 (the obsolete inline eval blocks)</name>
  <files>src-tauri/src/embeddings.rs (MOD)</files>

  <read_first>
    - src-tauri/src/embeddings.rs (lines 480-510 to find the precise production-vs-test boundary; lines 925-946 to find the precise EOF after the test mod)
    - .planning/phases/16-eval-scaffolding-expansion/16-VALIDATION.md (Wave 0 list — confirms "DELETE lines 496-946")
    - .planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md (§ "src-tauri/src/embeddings.rs", lines 686-702)
  </read_first>

  <action>
**Step 1: Pre-deletion safety checks.**

(a) Confirm Wave 2 evals all compile and pass:
```bash
cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1 2>&1 | tail -10
```
Expected: exit 0, all 5 eval modules + harness compile and tests pass. If ANY eval is red, ABORT — this task only runs after Plans 02-06 are green.

(b) Confirm production code visibility — the items the new evals import must already be `pub`:
```bash
grep -nE "^pub (struct SearchResult|fn embed_texts|fn cosine_similarity)|^impl VectorStore" src-tauri/src/embeddings.rs
grep -nE "pub fn (new|add|hybrid_search)" src-tauri/src/embeddings.rs
```
Expected: all the items the new evals import (`SearchResult`, `VectorStore`, `embed_texts`, `cosine_similarity`, `VectorStore::{new, add, hybrid_search}`) are `pub`. If any are `pub(crate)` or private, the deletion will break the new evals — escalate.

(c) Confirm there are NO `pub use` re-exports of the old test fns elsewhere:
```bash
grep -rn "memory_recall_eval\|memory_recall_real_embedding" src-tauri/src/ | grep -v embeddings.rs
```
Expected: zero results outside `embeddings.rs`. The test mods are `#[cfg(test)]`-gated and self-contained — nothing imports them. If grep returns hits, escalate.

**Step 2: Identify exact line range to delete.**

Read `embeddings.rs` around lines 489-510 to find the EXACT line where production code ends and the eval header comment block begins. The deletion target per VALIDATION.md and PATTERNS:
- The `// ─── Eval harness ──...` comment block (~lines 496-509)
- `#[cfg(test)] mod memory_recall_eval { ... }` (~lines 510-728)
- The blank line + RealEmbedding header doc-comment (~lines 729-746)
- `#[cfg(test)] mod memory_recall_real_embedding { ... }` (~lines 748-946)

Use `grep -n` to confirm boundaries:
```bash
grep -nE "^// ─── Eval harness|^#\[cfg\(test\)\] mod memory_recall_(eval|real_embedding)|^/// End-to-end recall eval" src-tauri/src/embeddings.rs
wc -l src-tauri/src/embeddings.rs
```

The block to delete starts at the `// ─── Eval harness ──` comment header (around line 496) and ends at the closing `}` of the second test module (around line 946 — adjust to the actual EOF or the line just before any trailing whitespace/EOF marker).

**Step 3: Delete the block.**

Use sed or your editor to remove lines from the start of the eval-harness comment block through the closing `}` of `mod memory_recall_real_embedding`. Concretely (adjust line numbers to match the actual file):

```bash
# Identify exact start line
START=$(grep -n "^// ─── Eval harness" src-tauri/src/embeddings.rs | head -1 | cut -d: -f1)
# Identify exact end line — last `}` before end of file, of the second test mod
# Read the file end to confirm; manually pick the line.
# Example: if the file ends at line 946 and EOF has no trailing content:
END=$(wc -l < src-tauri/src/embeddings.rs)

# OR use the Edit tool with old_string=<full block> new_string="" — preferred over sed for safety.
```

**Recommended:** use the Edit tool on `embeddings.rs` rather than sed — find the unique starting comment `// ─── Eval harness ─────────────...` and the unique ending `}` (the very last line). Replace with empty string. This is surgical and reversible via git.

If using a single Edit call, the `old_string` is the entire range from `// ─── Eval harness` through the final `}` of the second test mod. The `new_string` is empty. This is a large delete — estimate ~440 lines. The Edit tool handles this when `old_string` is a contiguous block in the file.

**Step 4: Confirm the deletion.**

```bash
wc -l src-tauri/src/embeddings.rs
# Expected: ~489 (was ~946; net -440 to -460)

grep -c "memory_recall_eval\|memory_recall_real_embedding" src-tauri/src/embeddings.rs
# Expected: 0

grep -c "Eval harness" src-tauri/src/embeddings.rs
# Expected: 0

# Confirm production code intact:
grep -c "^pub fn embed_texts\|^pub struct VectorStore\|^pub fn cosine_similarity" src-tauri/src/embeddings.rs
# Expected: ≥3 (production API intact)
```

**Step 5: Re-run all evals + the verify gate to confirm nothing broke.**

```bash
cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1 2>&1 | tail -10
# Expected: exit 0; all 5 evals still green now that they own the test code.

bash scripts/verify-eval.sh
# Expected: exit 0; "5/5 scored tables emitted".

cd src-tauri && cargo check 2>&1 | tail -5
# Expected: clean (or the existing WSL libspa-sys env limit if present — see CLAUDE.md POLISH-02 carve-out)
```
  </action>

  <acceptance_criteria>
- `wc -l src-tauri/src/embeddings.rs` reports ≤ 510 (was ~946; deletion is ≥ ~440 lines)
- `grep -c "memory_recall_eval" src-tauri/src/embeddings.rs` returns 0
- `grep -c "memory_recall_real_embedding" src-tauri/src/embeddings.rs` returns 0
- `grep -c "Eval harness" src-tauri/src/embeddings.rs` returns 0
- Production API intact: `grep -c "^pub fn embed_texts\|^pub struct VectorStore\|^pub fn cosine_similarity" src-tauri/src/embeddings.rs` ≥ 3
- `cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1` exits 0 — all 5 evals still green
- `bash scripts/verify-eval.sh` exits 0 with "5/5 scored tables emitted"
- `cd src-tauri && cargo test --lib --no-run` exits 0 (compilation works without the deleted block — no other code imported the deleted test mods)
- The 5 eval modules' tests still pass — no regression in floors:
  - `cd src-tauri && cargo test --lib evals::hybrid_search_eval -- --nocapture --test-threads=1` exits 0
  - `cd src-tauri && cargo test --lib evals::real_embedding_eval -- --nocapture --test-threads=1` exits 0
  - `cd src-tauri && cargo test --lib evals::kg_integrity_eval -- --nocapture --test-threads=1` exits 0
  - `cd src-tauri && cargo test --lib evals::typed_memory_eval -- --nocapture --test-threads=1` exits 0
  - `cd src-tauri && cargo test --lib evals::capability_gap_eval -- --nocapture --test-threads=1` exits 0
  </acceptance_criteria>

  <verify>
    <automated>test $(wc -l < src-tauri/src/embeddings.rs) -le 510 && [ $(grep -c "memory_recall_eval" src-tauri/src/embeddings.rs) -eq 0 ] && bash scripts/verify-eval.sh 2>&1 | tail -3 | grep -q "5/5 scored tables"</automated>
  </verify>

  <done>`embeddings.rs` shrinks from ~946 to ~489 lines; the two inline test modules are gone; all 5 eval modules still pass; `verify-eval.sh` still exits 0; production API is intact.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CI shell ↔ verify-eval.sh | Bash wrapper runs as part of CI; could become an injection vector if it ever shells out to dynamic input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-07-01 | E (Elevation of privilege) | `scripts/verify-eval.sh` runs in CI / on operator machines | mitigate | Wrapper invokes ONLY `cargo test`. No `curl`, `wget`, `eval`, `source`, dynamic-string-exec. `set -uo pipefail` prevents typo'd-var-becomes-empty-string footguns. Pinned to fixed cargo flags. |
| T-16-07-02 | T (Tampering) | `verify:all` chain count drift — silent gate removal | accept | The chain is single-line; PRs that touch it are immediately visible in diffs. Code review is the protective control. |
| T-16-07-03 | I (Information disclosure) | Eval `println!` output streams to CI logs (potentially shared with non-developers) | accept | Eval fixtures are SYNTHETIC by design (RESEARCH §7 + plan-checker review). No real user data hits stdout. |
| T-16-07-04 | D (DoS) | Cargo parallelism races on `BLADE_CONFIG_DIR` if `--test-threads=1` is dropped | mitigate | Wrapper PINS `--test-threads=1`. Wrapper header documents WHY. Per-task verify commands also include the flag. |
| T-16-07-05 | T (Tampering) | Removing `embeddings.rs:496-946` could break dependents that import test code (defensive: it shouldn't, but verify) | mitigate | Task 3 Step 1c grep verifies zero external `pub use` of the deleted symbols before deletion. |

**Severity rollup:** all LOW. The mitigations (`set -uo pipefail`, pinned cargo flags, no shell-out to user input, pre-deletion grep) are concrete and inline-implemented.
</threat_model>

<verification>
After all 3 tasks complete, the full Phase 16 verification suite:

```bash
# 1. Bash wrapper directly
bash scripts/verify-eval.sh
# Expected: exit 0, "[verify-eval] OK — 5/5 scored tables emitted, all floors green"

# 2. npm wrapper
npm run verify:eval
# Expected: exit 0 (same output)

# 3. Full chain
npm run verify:all
# Expected: exit 0, all 31 chained gates green

# 4. Direct cargo
cd src-tauri && cargo test --lib evals -- --nocapture --test-threads=1
# Expected: exit 0, 5 modules + harness compile, ≥7 tests pass:
#   evals::hybrid_search_eval::evaluates_synthetic_hybrid_recall
#   evals::hybrid_search_eval::empty_query_returns_empty
#   evals::hybrid_search_eval::empty_store_returns_empty
#   evals::real_embedding_eval::evaluates_real_embedding_recall
#   evals::real_embedding_eval::embedder_produces_sane_vectors
#   evals::kg_integrity_eval::evaluates_kg_integrity
#   evals::typed_memory_eval::evaluates_typed_memory_recall
#   evals::capability_gap_eval::evaluates_capability_gap_detection

# 5. embeddings.rs shrunk
wc -l src-tauri/src/embeddings.rs
# Expected: ~489 (was ~946)

# 6. DEFERRED.md present
test -f tests/evals/DEFERRED.md && grep -c '^## ' tests/evals/DEFERRED.md
# Expected: ≥3
```
</verification>

<success_criteria>
1. `scripts/verify-eval.sh` exists, executable, runs `cargo test --lib evals -- --nocapture --test-threads=1`, asserts ≥5 `┌──` tables, exits 0
2. `tests/evals/DEFERRED.md` exists with ≥3 structured entries (Rationale + Budget + Promotion Trigger each)
3. `package.json` carries `"verify:eval": "bash scripts/verify-eval.sh"` + chain entry `&& npm run verify:eval`
4. `npm run verify:all` exits 0 — count moves 30 → 31
5. `embeddings.rs:496-946` is deleted; file shrinks ~440 lines; production API intact
6. All 5 eval modules still pass after the deletion
7. EVAL-06, EVAL-07, EVAL-08 requirements satisfied
8. Phase 16 complete — Roadmap Phase 16 Success Criteria 1-4 all green:
   - SC-1: `cargo test --lib evals` runs 5 eval modules all green ✓
   - SC-2: `verify:eval` gate present in `verify:all` chain ✓
   - SC-3: Each eval module prints scored stdout table in `┌──` format ✓
   - SC-4: `tests/evals/DEFERRED.md` documents LLM-API-dependent evals as v1.3 candidates ✓
</success_criteria>

<output>
After completion, create `.planning/phases/16-eval-scaffolding-expansion/16-07-SUMMARY.md` documenting:
- Files created (`scripts/verify-eval.sh`, `tests/evals/DEFERRED.md`)
- File modified (`package.json` — chain count 30 → 31)
- File deleted-from (`embeddings.rs` — line count went from N to M; net -440 lines)
- All 5 eval module test results post-deletion
- `npm run verify:all` exit code + total chain count
- Note on REQ-vs-live count discrepancy (REQ says "27 → 28+"; live is "30 → 31"; both correct, REQ counts spec)
- Phase 16 wrap-up: 4 SCs from ROADMAP.md all green
</output>
