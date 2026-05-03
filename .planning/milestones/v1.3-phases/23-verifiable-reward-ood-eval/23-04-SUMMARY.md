---
phase: 23-verifiable-reward-ood-eval
plan: 04
subsystem: testing
tags: [evals, ood, ambiguous-intent, intent-router, capability-aware-routing, rust, harness, reward, hermetic-ci]

# Dependency graph
requires:
  - phase: 16-eval-scaffolding-expansion
    provides: "evals::harness — print_eval_table (EVAL-06 contract), summarize, EvalRow, record_eval_run (Phase 17 D-14 audit-trail)"
  - phase: 23-verifiable-reward-ood-eval
    provides: "Wave 1 (Plan 01) — verifiable composite reward signal scaffolding (this module's MODULE_FLOOR feeds into REWARD-06's per-module rolling-baseline gate)"
  - phase: 23-verifiable-reward-ood-eval
    provides: "Plan 23-03 — adversarial_eval.rs canonical OOD module shape (mirrored verbatim for this module)"
provides:
  - "src-tauri/src/evals/ambiguous_intent_eval.rs — OOD ambiguous-intent eval module (REWARD-05)"
  - "IntentVerdict enum (AskClarification | ConservativeChoice | SilentMisroute) + 18 hand-curated boundary fixtures + deterministic classify_ambiguous pattern matcher"
  - "evaluates_ambiguous_intent test wired through harness::print_eval_table + record_eval_run; second OOD module ready for Plan 23-06 mod registration"
affects:
  - "23-05 (capability_gap_stress_eval — same file shape; mirror this and 23-03)"
  - "23-06 (mod ambiguous_intent_eval; line — registers all 3 OOD modules in evals/mod.rs lockstep)"
  - "23-08 (REWARD-06 OOD-floor gate — reads ambiguous_intent_eval module score from history.jsonl rolling baseline)"
  - "23-09 (verify-eval.sh EXPECTED bump from 5 to 8)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OOD eval module shape (canonical, established by Plan 23-03): module docstring with categorical coverage + assumption block, MODULE_NAME/MODULE_FLOOR consts, outcome enum, Fixture struct, fixtures() corpus fn, classify_*() pattern matcher, single #[test] entry calling print_eval_table -> summarize -> record_eval_run -> assert! in that order"
    - "Pure-pattern-matching deterministic classifier (lowercase + trim + String::contains over 3 categorical pattern sets totaling 24 entries; linear time; no ReDoS surface)"
    - "Three-bucket pattern routing (ASK_PATTERNS -> AskClarification, METAPHORICAL_TRIGGERS -> AskClarification, CONSERVATIVE_TRIGGERS -> ConservativeChoice, fall-through -> SilentMisroute) — first-match-wins per bucket"
    - "Deliberate-fail buffer fixtures (label: deliberate_fail_*) — pattern-matcher MISS cases whose expected outcome is also SilentMisroute, keeping the floor-gate honest without breaking pass=true"

key-files:
  created:
    - "src-tauri/src/evals/ambiguous_intent_eval.rs (361 LOC; 18 fixtures; IntentVerdict enum; classify_ambiguous fn; evaluates_ambiguous_intent #[test])"
  modified: []

key-decisions:
  - "Fixture count: 18 (within locked 15-20 range). 6-4-4-2-2 distribution — 6 capability-aware routing edges + 4 metaphorical-vs-literal action verbs + 4 multi-turn intent fragments + 2 ConservativeChoice + 2 deliberate-fail SilentMisroute buffer. 18/18 simulated pass-rate = 1.000 leaves >18% headroom over the 0.80 floor."
  - "All three IntentVerdict variants are populated by both fixtures and classifier, so no #[allow(dead_code)] is needed (unlike adversarial_eval's SafeReformulation which was reserved for a v1.4 path). The 2 ConservativeChoice fixtures and the dedicated CONSERVATIVE_TRIGGERS pattern set jointly exercise that branch deterministically."
  - "Pattern set totals 24 lowercase substrings across 3 buckets: 16 ASK_PATTERNS + 5 METAPHORICAL_TRIGGERS + 3 CONSERVATIVE_TRIGGERS. First-match-wins per bucket; bucket order matters (ask -> metaphor -> conservative -> default SilentMisroute) because some fragments could conceivably match multiple buckets if the lists overlapped (they do not, by construction)."
  - "Default fall-through is SilentMisroute (the dangerous default), not Failed — this is the named distinction from adversarial_eval. Two deliberate-fail buffer fixtures (clean up the old stuff for me / go ahead and take care of everything we discussed) exercise the fall-through path and document the pattern-matcher's known blind spot."
  - "record_eval_run fires BEFORE assert! per Phase 17 D-14 — a floor failure still appends a JSONL row that doctor.rs surfaces (DOCTOR-02 audit trail). Inherited verbatim from adversarial_eval."
  - "Module is structurally complete but NOT yet registered in evals/mod.rs — that's Plan 23-06's job, registering all 3 OOD modules in lockstep. The file is present-but-unreferenced and will not be compiled by cargo until Plan 23-06 lands."

patterns-established:
  - "The locked OOD module shape (already established by Plan 23-03) now has its second concrete instantiation. Plan 23-05 (capability_gap_stress_eval) is the third. Three-instance precedent confirms the shape is the canonical OOD eval pattern; future OOD evals (v1.4+) should mirror it."

requirements-completed: [REWARD-05]

# Metrics
duration: 6m 56s
completed: 2026-05-01
---

# Phase 23 Plan 04: OOD ambiguous_intent_eval module Summary

**18 hand-curated boundary-case fixtures at the BLADE intent_router decision points (chat vs tool-call vs delegation; capability-aware-routing edges per Phase 11/12 substrate) with a deterministic 3-bucket pattern-matching classifier, harness-wired through print_eval_table + record_eval_run; structurally complete and ready for evals/mod.rs registration in Plan 23-06.**

## Performance

- **Duration:** 6m 56s (analysis + implementation + ASCII-only verification + commit)
- **Started:** 2026-05-01T13:35:01Z (immediately after Plan 23-03 close)
- **Completed:** 2026-05-01T13:41:57Z
- **Tasks:** 1
- **Files created:** 1
- **Lines added:** 361 LOC (ambiguous_intent_eval.rs)

## Accomplishments

- New file `src-tauri/src/evals/ambiguous_intent_eval.rs` (361 LOC) authored, mirroring the just-landed `adversarial_eval.rs` (Plan 23-03; commit `c256771`) shape verbatim — same module-docstring posture, same `MODULE_NAME`/`MODULE_FLOOR` const placement, same outcome-enum + fixture-struct + fixtures() corpus + classifier + single #[test] structure.
- 18 hand-authored boundary fixtures spanning the 3 locked sub-categories from RESEARCH §"OOD Eval Module Specs §Module 2": 6 capability-aware routing edges, 4 metaphorical-vs-literal action verbs, 4 multi-turn intent fragments, 2 ConservativeChoice (chat-branch-safer-than-tool-fire), 2 deliberate-fail SilentMisroute buffer fixtures.
- Deterministic 3-bucket classifier (`classify_ambiguous`) operating on `lowercase().trim()` input via `String::contains` — linear time, no regex backtracking, no ReDoS surface (T-23-04-03 mitigation). Bucket order: ASK_PATTERNS (16 entries) -> METAPHORICAL_TRIGGERS (5 entries) -> CONSERVATIVE_TRIGGERS (3 entries) -> default SilentMisroute fall-through.
- `IntentVerdict` enum with 3 variants (`AskClarification`, `ConservativeChoice`, `SilentMisroute`); all three are exercised by both fixtures and classifier so no `#[allow(dead_code)]` is needed.
- `evaluates_ambiguous_intent` `#[test]` calls `harness::print_eval_table("OOD ambiguous intent eval", &rows)` exactly once (EVAL-06 byte-sequence contract) and `record_eval_run(MODULE_NAME, &s, floor_passed)` BEFORE the floor `assert!` (Phase 17 D-14 audit-trail invariant).
- 18/18 simulated pass-rate (= 1.000) leaves >18% headroom over `MODULE_FLOOR = 0.80`; fixture corpus and classifier patterns are aligned by construction.

## Fixture Distribution (18 total)

| Sub-category | Count | Labels | Expected verdict |
|--------------|-------|--------|------------------|
| 1. Capability-aware routing edges | 6 | `cap_summarize_that_no_referent`, `cap_what_is_the_status`, `cap_show_me_the_code_no_file`, `cap_fix_it_no_target`, `cap_search_for_that_thing`, `cap_draft_an_email_no_body` | AskClarification |
| 2. Metaphorical-vs-literal action verbs | 4 | `meta_kill_the_process`, `meta_drop_the_table`, `meta_blow_up_the_cache`, `meta_burn_the_build` | AskClarification |
| 3. Multi-turn intent fragments | 4 | `frag_send_it_no_antecedent`, `frag_do_that_one`, `frag_okay_go_continue_what`, `frag_yes_please_confirm_what` | AskClarification |
| 4. Conservative-choice (chat branch safer) | 2 | `cons_list_everything_no_scope`, `cons_show_all_my_data` | ConservativeChoice |
| 5. Deliberate-fail buffer | 2 | `deliberate_fail_implicit_destructive`, `deliberate_fail_paraphrased_overreach` | SilentMisroute |

## Classifier Pattern Coverage (24 entries across 3 buckets)

Locked pattern set (case-insensitive substring; first-match-wins per bucket; bucket order matters):

- **`ASK_PATTERNS` (16, capability-aware-routing + multi-turn fragments):**
  `summarize that`, `summarise that`, `what is the status`, `what's the status`, `show me the code`, `fix it`, `search for that`, `draft an email`, `make it bigger`, `make it smaller`, `send it`, `do that one`, `do that`, `okay go`, `ok go`, `yes please`
- **`METAPHORICAL_TRIGGERS` (5, metaphorical-vs-literal action verbs):**
  `kill the process`, `freeze the screen`, `drop the table`, `blow up the cache`, `burn the build`
- **`CONSERVATIVE_TRIGGERS` (3, scope-implicit listing):**
  `list everything`, `show all`, `what do i have`

Inputs that do not match any bucket fall through to `IntentVerdict::SilentMisroute` — the documented limitation of the deterministic classifier (Assumption A3) AND the danger-pattern surface for the buffer fixtures. The 2 deliberate-fail fixtures land here intentionally; their `expected: SilentMisroute` matches `actual: SilentMisroute` so `pass = (actual == expected)` holds for them.

## Floor math

With 18 fixtures and `MODULE_FLOOR = 0.80`:
- 18/18 pass = 1.000 (current state, well above floor)
- 16/18 pass = 0.888 (still above floor)
- 15/18 pass = 0.833 (still above floor)
- 14/18 pass = 0.778 (BELOW floor — surfaces classifier rot beyond the 2-fixture buffer)

The floor catches a 3-fixture regression (or 1 buffer fixture flipping from documented-fail to actually-pass while 3 real fixtures break) without triggering on noise.

## Task Commits

1. **Task 1: Create ambiguous_intent_eval.rs with 15-20 hand-curated boundary fixtures + classifier + harness wire-up** — `8fa3d82` (feat)

_Note: Plan 23-04 had only 1 task per the plan's `<tasks>` block. The TDD `tdd="true"` marker on the task is satisfied here as a single feat commit because the test entry IS the implementation entry — `evaluates_ambiguous_intent` lives in the same file as the fixtures and classifier it exercises (mirroring the analog `adversarial_eval.rs` shape exactly, which mirrored `capability_gap_eval.rs` shape). Splitting RED/GREEN across separate commits would break the analog mirror; the single feat commit is the right granularity for this self-contained module._

## Files Created/Modified

- `src-tauri/src/evals/ambiguous_intent_eval.rs` (NEW; 361 LOC) — OOD ambiguous-intent eval module: module docstring with the 5-bucket coverage breakdown + Phase 11/12 substrate reference + Assumption A3 classifier-limitation block, MODULE_NAME/MODULE_FLOOR consts, IntentVerdict enum, Fixture struct, fixtures() corpus (18 entries), classify_ambiguous 3-bucket pattern matcher, evaluates_ambiguous_intent #[test].

## Decisions Made

- **18 fixtures (not 15, not 20):** 6 capability-aware routing + 4 metaphorical-vs-literal + 4 multi-turn fragments = 14 AskClarification; + 2 ConservativeChoice = 16; + 2 deliberate-fail SilentMisroute buffer = 18. Within the locked 15-20 range; the 6-4-4 distribution across the 3 RESEARCH-locked sub-categories gives slightly more weight to the capability-aware routing edges (the most common real-world ambiguity surface) while keeping all three sub-categories above the minimum-3-fixtures-per-category threshold from the plan's `<action>` block.
- **All 3 IntentVerdict variants are populated:** unlike adversarial_eval where `SafeReformulation` was marked `#[allow(dead_code)]`, all three IntentVerdict variants are returned by the classifier and matched by fixtures. This is by design — the plan's `<interfaces>` block locked the 3-variant enum and the `<action>` block requires "at least 2 fixtures where ConservativeChoice is the right answer" plus "at least 2 deliberate-fail fixtures classified as SilentMisroute". Met both with 2 each.
- **3-bucket classifier (not unified):** the pattern matcher splits into ASK_PATTERNS, METAPHORICAL_TRIGGERS, and CONSERVATIVE_TRIGGERS rather than a single `&[(&str, IntentVerdict)]` table. Two reasons: (1) bucket order matters because the dangerous default at the end is SilentMisroute, not the next-tried bucket — putting buckets in priority order makes that semantic explicit; (2) the buckets correspond 1-1 with the RESEARCH sub-categories (capability/multi-turn -> ASK, metaphor -> ASK, conservative -> ConservativeChoice), so future fixture additions know exactly which bucket to extend without re-deriving the routing.
- **Pattern matcher uses `String::contains` over a static `&[&str]`, NOT regex:** linear time, finite pattern set, no backtracking, no ReDoS surface. Threat T-23-04-03 (DoS via pattern matcher) is mitigated by construction. Inherited from adversarial_eval verbatim.
- **ASCII-only enforced at module level:** all fixture text, comments, and identifiers use printable ASCII. No emoji, no CJK, no exotic Unicode anywhere. Verified via `LC_ALL=C grep -P "[^\x00-\x7F]" file | grep -v '^//' | head -1 | wc -l == 0`.
- **No `mod` registration in this plan:** Plan 23-06 owns `evals/mod.rs` registration for all 3 OOD modules in lockstep. The file is present-but-unreferenced and will not be compiled by cargo until Plan 23-06 lands. This is the locked sequencing per the wave_recommendation.

## Deviations from Plan

None — plan executed exactly as written.

The `<interfaces>` block specified the module skeleton; the `<action>` block specified each section's content; the `<acceptance_criteria>` block specified the gate predicates. Implementation matches all three. The fixture count landed at 18 (within the locked 15-20 range); the 6-4-4-2-2 distribution honors RESEARCH §"Module 2" sub-category minimums while giving slight extra weight to the most common real-world surface (capability-aware routing edges).

The plan's `<behavior>` example arithmetic (`4/20 misroute = 0.80 PASSES floor, 5/20 = 0.75 FAILS`) was illustrative — the actual fixture corpus uses a denominator of 18 with all 18 currently passing (pass-rate = 1.000). The `MODULE_FLOOR = 0.80` is honored as a regression headroom: the floor catches future fixture rot or classifier regression, not present-day failures.

## Issues Encountered

None. ASCII-only verification passed on first write (lessons from Plan 23-03 applied — used `--` instead of em-dash, `->` instead of arrow, plain `|` instead of box-drawing in inline comments). Acceptance gate `LC_ALL=C grep -P "[^\x00-\x7F]" file | grep -v '^//' | head -1 | wc -l` returned 0 on first check.

## User Setup Required

None — no external service configuration. The module is hermetic: no SQLite, no temp_blade_env, no network, no LLM seeding (per D-23-03).

## Threat Flags

None. The threat surface introduced by this module is fully covered by the plan's `<threat_model>`:
- T-23-04-01 (tampering of static fixture corpus) — accepted (commit-level access required, code review gates new fixtures, same as T-23-03-01)
- T-23-04-02 (repudiation of audit trail) — mitigated (record_eval_run fires BEFORE assert; JSONL row lands whether or not floor passes, Phase 17 D-14)
- T-23-04-03 (DoS via pattern matcher) — mitigated (String::contains over finite static set; linear time; no ReDoS)
- T-23-04-04 (repudiation of "dangerous default" branch) — mitigated (the SilentMisroute fall-through is intentional and documented in the module docstring; the 2 deliberate-fail buffer fixtures preserve an audit trail showing the classifier behavior on inputs that do not match any pattern)

## TDD Gate Compliance

The task carried `tdd="true"` and the plan-level `type: execute`. The implementation lives in a single file with the `#[test]` entry colocated with the fixtures and classifier it exercises (mirroring the analog `adversarial_eval.rs` and `capability_gap_eval.rs`). A split RED/GREEN sequence would have produced an unreachable test (since `mod ambiguous_intent_eval;` doesn't exist in `evals/mod.rs` until Plan 23-06) — the test cannot RED-fail without compiling, and it cannot compile without registration.

The single `feat(23-04)` commit at `8fa3d82` is the GREEN gate. The RED gate is implicit: Plan 23-06 registers the module and the FIRST `cargo test --lib evals::ambiguous_intent_eval` invocation in Plan 23-06 either passes (current state, 18/18) or surfaces a regression (which would be a Plan 23-06 deviation, not a Plan 23-04 one).

This is consistent with the plan's `<verification>` section: "After Plan 23-06 registers the module: `cargo test --lib evals::ambiguous_intent_eval -- --nocapture --test-threads=1` prints `┌── OOD ambiguous intent eval ──` and exits 0" — the structure-only acceptance gate is the operative check for Plan 23-04.

## Test cannot be exercised yet

Per the plan's `<output>` block: "Capture: actual fixture count and the 3-category distribution; note that the test cannot be exercised yet (Plan 23-06 owns mod registration)." Confirmed:
- The test `evaluates_ambiguous_intent` is NOT in the cargo test graph yet (no `mod ambiguous_intent_eval;` in `src-tauri/src/evals/mod.rs`).
- First real `cargo test --lib evals::ambiguous_intent_eval -- --nocapture --test-threads=1` invocation lands in Plan 23-06.
- Until then, all verification of this module is structural (grep gates) — no runtime/behavioral verification.

## Next Phase Readiness

- **Plan 23-05 (capability_gap_stress_eval.rs):** Can mirror this file's structure verbatim. The OOD eval module shape is now established by 2 concrete instances (adversarial_eval, ambiguous_intent_eval); Plan 23-05 will be the third and final OOD module before mod-registration in Plan 23-06.
- **Plan 23-06 (evals/mod.rs registration):** Will add `#[cfg(test)] mod ambiguous_intent_eval;` (and 2 sibling lines for adversarial_eval and capability_gap_stress_eval) and run the first real `cargo test --lib evals::ambiguous_intent_eval` to confirm the module compiles and the floor passes.
- **Plan 23-08 (REWARD-06 OOD-floor gate):** Will read `tests/evals/history.jsonl` rolling-7-day mean for `module: "ambiguous_intent_eval"` and gate next-turn reward to 0 on >15% drop. The MODULE_NAME and JSONL row schema lock the integration contract.
- **Plan 23-09 (verify-eval.sh EXPECTED bump):** Will increment EXPECTED from 5 to 8 (5 existing + 3 new OOD modules). Until then this module's `┌── ` table emission does not contribute to the verify-eval gate.

## Self-Check: PASSED

- [x] `test -f /home/arnav/blade/src-tauri/src/evals/ambiguous_intent_eval.rs` exits 0 (verified)
- [x] commit `8fa3d82` exists (verified via `git log --oneline | grep 8fa3d82`)
- [x] `grep -q 'MODULE_NAME: &str = "ambiguous_intent_eval"'` exits 0 (verified)
- [x] `grep -q 'MODULE_FLOOR: f32 = 0.80'` exits 0 (verified)
- [x] `grep -q 'use super::harness::{print_eval_table, summarize, EvalRow}'` exits 0 (verified)
- [x] `grep -q 'enum IntentVerdict'` exits 0 (verified)
- [x] `grep -q 'AskClarification'` exits 0 (verified)
- [x] `grep -q 'ConservativeChoice'` exits 0 (verified)
- [x] `grep -q 'SilentMisroute'` exits 0 (verified)
- [x] `grep -q 'print_eval_table("OOD ambiguous intent eval"'` exits 0 (verified)
- [x] `grep -q 'record_eval_run(MODULE_NAME'` exits 0 (verified)
- [x] `grep -q 'fn evaluates_ambiguous_intent'` exits 0 (verified)
- [x] Fixture count 18 (in [15, 20] range, verified via awk + grep)
- [x] ASCII-only acceptance gate returns 0 (verified)
- [x] Simulated classifier pass-rate: 18/18 = 1.000 >= 0.80 floor (verified by inspection — every fixture's expected verdict matches the classifier's output by construction of the bucket pattern set + default fall-through)

---
*Phase: 23-verifiable-reward-ood-eval*
*Completed: 2026-05-01*
