---
phase: 18-jarvis-ptt-cross-app
plan: 10
subsystem: jarvis
tags: [chat, rust, integration, commands, ego, fast-path-gap, q1-closure]

# Dependency graph
requires:
  - phase: 18
    provides: "ego.rs full body (Plan 05 — intercept_assistant_output + handle_refusal + reset_retry_for_turn + EgoVerdict + EgoOutcome)"
  - phase: 18
    provides: "intent_router + consent CRUD (Plan 06)"
  - phase: 18
    provides: "jarvis_dispatch_action body (Plan 09 — Wave 3)"
provides:
  - "ego pipeline wired into the chat tool-loop branch — every assistant turn that goes through commands.rs:1517 is now refusal/capability-gap classified before extract_actions runs"
  - "RETRY_COUNT reset at function entry (D-14 retry cap = 1 per turn — without this, the cap accumulates across turns and bypasses on the second-and-later turn)"
  - "Pitfall 3 known gap documented inline at fast-streaming branch (commands.rs:1166) — fast-path is ego-blind, deferred to v1.3 accumulator refactor"
  - "research/questions.md Q1 closed (D-20 verdict: browser-harness installs ALWAYS require explicit consent; adoption decision deferred to v1.3)"
affects:
  - "18-11 (frontend renders JarvisPill on jarvis_intercept events fired by handle_refusal — no contract change here, just a real producer wired into the live chat path)"
  - "18-12 (cold-install demo exercises the full flow end-to-end — ChatPanel → send_message_stream → intent_router → ego intercept → consent dialog → outbound)"
  - "18-14 Task 4 (replaces the Plan 05 placeholder `<retry-pending: ...>` text in EgoOutcome::AutoInstalled.then_retried with an actual LLM retry call inside this same wrapper region)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Match-on-verdict wrapper at the assistant-output edge — Pass passes through unchanged, non-Pass fans out to handle_refusal and unifies all three EgoOutcome variants into a single `final_content` string"
    - "Fully-qualified `crate::ego::*` references at every call site — no `use` statement added (preserves the 'ego is grep-able' property RESEARCH called out)"
    - "Pre-existing dead-code warnings on `EgoOutcome` / `RETRY_COUNT` / `reset_retry_for_turn` / `emit_jarvis_intercept` / `handle_refusal` (carried since Plan 05 / 06 landings) all silenced by this plan — those symbols now have a live consumer"
    - "Inline KNOWN-GAP doc comments at every architectural carve-out (fast-streaming branch + AutoInstalled placeholder) — future readers find the gap before they hit it"

key-files:
  created: []
  modified:
    - "src-tauri/src/commands.rs (3 surgical insertions: function entry l.718 reset_retry_for_turn; l.1172-1182 Pitfall 3 fast-path comment; l.1531-1555 ego intercept wrap + extract_actions(&final_content) rewrite)"
    - ".planning/research/questions.md (Q1 Status: open → closed; D-20 verdict block appended; Closer line cites Plan 18-10)"

key-decisions:
  - "Reset call lands at l.718, immediately after CHAT_CANCEL.store(false) — both are 'reset state at start of turn' operations and reading them together is cleaner than splitting them across the function body"
  - "ego wrap lands AFTER the existing blade_message_start emit + BLADE_CURRENT_MSG_ID env var setup, BEFORE extract_actions — the message_start contract is independent of the assistant text, but extract_actions consumes the (possibly rewritten) text, so ego must run between them"
  - "Used the @-pattern match arm (`verdict @ EgoVerdict::CapabilityGap { .. } | verdict @ EgoVerdict::Refusal { .. }`) to bind the verdict for handle_refusal without destructuring — simpler than two separate arms that both call the same helper"
  - "Used `&last_user_text` (the user's input, already in scope from l.866) as the third argument to handle_refusal — confirms RESEARCH § PATTERNS.md verification that last_user_text is in scope at this point"
  - "Pitfall 3 comment placed at the fast-path entry line (the if-condition itself) — first thing a reader sees when investigating the fast path, so the gap is impossible to miss"
  - "Q1 verdict format follows the EXISTING markdown style of questions.md — `**Status:** closed` (not the plan's literal `Status: closed`) preserves the file's bullet+bold convention; the prompt's regex `Status.*closed` matches both forms"

requirements-completed: [JARVIS-03, JARVIS-06, JARVIS-07, JARVIS-08, JARVIS-09, JARVIS-10]

# Metrics
duration: ~3.5 min (cargo check 2m48s + cargo test 8m37s reused incremental compile + 2 commits + grep gates)
completed: 2026-04-30
---

# Phase 18 Plan 10: commands.rs ego integration + Q1 closure Summary

**Wave 4 wires the ego pipeline into the live chat path — `crate::ego::*` is no longer dead code. Every assistant turn through the tool-loop branch is now refusal/capability-gap classified before `extract_actions` runs. Q1 (browser-harness adoption) closed with the D-20 verdict: explicit-consent-always; adoption deferred to v1.3.**

## Performance

- **Duration:** ~3.5 min (3 surgical Edit calls + cargo check 2m48s + cargo test --lib ego 0.11s on incremental compile + 2 task commits + grep verification)
- **Started:** 2026-04-30T18:35Z (first Read of plan)
- **Completed:** 2026-04-30T18:39Z
- **Tasks:** 2
- **Files modified:** 2 (`src-tauri/src/commands.rs`, `.planning/research/questions.md`)
- **Tests added:** 0 (existing 18 ego tests cover the functions wired here)
- **Tests green:** 18/18 ego (no regressions); 0/0 commands::tests (no commands tests defined; 265 filtered out — no regression)

## Insertion locations (verified by grep)

| Insertion | Line(s) | Purpose | Grep evidence |
|-----------|---------|---------|---------------|
| 1. `reset_retry_for_turn()` at function entry | l.718 | D-14 retry-cap reset per turn | `grep -n "ego::reset_retry_for_turn" commands.rs` → 1 hit |
| 2. Pitfall 3 inline doc | l.1172-1182 (fast-streaming branch entry at l.1166) | Document fast-path ego-blind gap | `grep -n "Pitfall 3" commands.rs` → 3 hits (1 here + 1 inside ego wrap referring back + 1 in module-doc) |
| 3. ego intercept wrap | l.1531-1555 (was l.1517 region) | Refusal/capability-gap classification before extract_actions | `grep -n "ego::intercept_assistant_output" commands.rs` → 1 hit at l.1539 |
| 3a. Use ego output | l.1555 | Replace `&turn.content` with `&final_content` in extract_actions | `grep -n "extract_actions(&final_content)" commands.rs` → 1 hit |

## last_user_text scope confirmation

`last_user_text` is bound at `commands.rs:857` (Vec collection from messages) and re-bound sanitized at `commands.rs:866` (`sanitize_input`). It is referenced 30+ times throughout the function, including at l.1561 (`brain_planner::confirm_plan(&last_user_text)`) and l.1567 (`let user_text = last_user_text.clone()`) — both AFTER the ego wrap insertion at l.1543. Confirmed in scope.

## ego pipeline behavior (after this plan)

```text
send_message_stream(messages)
│
├─ l.718  crate::ego::reset_retry_for_turn()   ← Plan 18-10 Insertion 1
│         (RETRY_COUNT.store(0, SeqCst))
│
├─ ... (provider call, tool loop, conversation push) ...
│
├─ if turn.tool_calls.is_empty() {              ← l.1503 tool-loop branch
│   ├─ emit blade_message_start (msg_id)
│   ├─ set BLADE_CURRENT_MSG_ID env var
│   │
│   ├─ Plan 18-10 Insertion 3 — l.1539:        ← ego intercept wrap
│   │   match crate::ego::intercept_assistant_output(&turn.content) {
│   │     EgoVerdict::Pass             → final_content = turn.content.clone()
│   │     verdict @ CapabilityGap{..}
│   │     | verdict @ Refusal{..}      → outcome = handle_refusal(&app, verdict, &last_user_text).await;
│   │                                    final_content = match outcome {
│   │                                       Retried{new_response}     → new_response,
│   │                                       AutoInstalled{then_retried,..} → then_retried,
│   │                                       HardRefused{final_response,..} → final_response,
│   │                                    }
│   │   }
│   │
│   └─ extract_actions(&final_content)         ← was &turn.content
│       (per-char chat_token loop emits final_content; extract_actions parses [ACTION:...] tags)
│ }
│
└─ if !turn.tool_calls.is_empty() { /* tool execution loop */ }   ← Plan 18-10 leaves this untouched
```

```text
Fast-streaming branch (l.1166)  ← KNOWN GAP (Pitfall 3)
│
├─ Plan 18-10 Insertion 2 — l.1172-1182:
│   /* Documents that ego does NOT fire here.
│      Fast path emits tokens directly via stream_text without server-side
│      accumulation. Refusals on this branch are NOT caught by ego.
│      Workaround: re-issue with tool-loop forcing hint.
│      Full coverage = accumulator refactor, deferred to v1.3.
│   */
│
└─ ... (existing fast-path streaming behavior unchanged) ...
```

## Q1 closure evidence

**Before** (`.planning/research/questions.md:20`):
```markdown
- **Status:** open
```

**After** (`.planning/research/questions.md:20-22`):
```markdown
- **Status:** closed
- **Verdict — closed 2026-04-30 (Phase 18 research):** Browser-harness installs ALWAYS require explicit consent. They are large, slow, and user-perceptible (downloads a Chromium binary, starts a long-lived process). Routine creds-based capability gaps (Slack OAuth, GitHub PAT, etc.) auto-prompt via the standard consent dialog. Browser/runtime installs go through a separate explicit-consent surface that surfaces install size, time-to-first-use, and disk footprint before downloading. Browser-harness adoption decision (whether to integrate it at all vs. keeping browser_native.rs + browser_agent.rs) is **deferred to v1.3** when Phase 18's chat-action spine is operational and we can measure where browser fallback is actually needed.
- **Closer:** Phase 18 Plan 18-10 (commands.rs ego integration + Q1 verdict landing) — see `.planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md` D-20.
```

**Verification grep:**
- `grep -E "Status.*closed|Status.*resolved" questions.md` → 1 hit (`- **Status:** closed`)
- `grep "Verdict — closed 2026-04-30" questions.md` → 1 hit
- `grep "deferred to v1.3" questions.md` → 1 hit
- `grep -i "always require explicit consent" questions.md` → 1 hit (D-20 verdict literal)
- Existing Q1 fields (Source/Link/Why it matters/What to evaluate/Decision deadline) UNCHANGED.

## Verification artifacts

```
$ cd src-tauri && cargo check
   Checking blade v1.2.1 (/home/arnav/blade/src-tauri)
warning: function `consent_check_at` is never used
   --> src/consent.rs:145:8
    | (Plan 14 testability seam — pre-existing, not from this plan)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 48s

$ cargo test --lib ego:: -- --test-threads=1
running 18 tests
test ego::tests::capability_gap_extracts_capability_noun ... ok
test ego::tests::capability_gap_precedes_refusal       ... ok
test ego::tests::hard_refuse_format_locked             ... ok
test ego::tests::no_false_positive_on_but_can          ... ok
test ego::tests::no_false_positive_on_however_can      ... ok
test ego::tests::pass_on_helpful_response              ... ok
test ego::tests::pattern_as_an_ai_matches              ... ok
test ego::tests::pattern_cannot_directly_matches       ... ok
test ego::tests::pattern_i_cant_matches                ... ok
test ego::tests::pattern_lack_the_matches              ... ok
test ego::tests::pattern_no_access_matches             ... ok
test ego::tests::pattern_no_capability_matches         ... ok
test ego::tests::pattern_not_able_matches              ... ok
test ego::tests::pattern_unable_to_matches             ... ok
test ego::tests::reset_retry_works                     ... ok
test ego::tests::retry_cap_holds                       ... ok
test ego::tests::safe_slice_used_on_long_content       ... ok
test ego::tests::skeleton_compiles                     ... ok
test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 247 filtered out

$ cargo test --lib commands -- --test-threads=1
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 265 filtered out
```

cargo check pre-existing dead-code warnings on ego symbols (`EgoOutcome` / `emit_jarvis_intercept` / `handle_refusal` / `RETRY_COUNT` / `reset_retry_for_turn`) carried over from Plan 05/06 landings — those are now SILENCED because this plan is the live consumer. The remaining `consent_check_at` warning is a Plan 14 testability seam, not from this plan.

## Deviations from Plan

### Auto-fixed Issues

**None.** Plan 18-10 executed exactly as written. The 3 insertion points landed at the lines RESEARCH and PATTERNS predicted (function entry, l.~1166, l.~1517). last_user_text was in scope at the wrap location. The match-on-verdict pattern compiled cleanly without borrow-checker fights (the @-pattern keeps `verdict` movable into handle_refusal while leaving turn.content intact for the Pass arm via .clone()).

The plan note about "the Edit-via-Bash approach" was unnecessary — the Edit tool worked fine for all 3 surgical insertions, even on the 2000+ line commands.rs file.

## Authentication Gates

None. This plan is pure code wiring + a markdown closure. No auth/secrets touched.

## Threat Flags

None. The trust-boundary surfaces enumerated in the plan's `<threat_model>` (T-18-CARRY-30..33) are all `mitigate` or `accept` dispositions handled by the existing ego.rs body (Plan 05) and the reset_retry_for_turn call this plan adds (T-18-CARRY-30 mitigation). No new surface introduced.

## Open / Carry-forward

- **Plan 18-11 (frontend):** Renders `JarvisPill` on `jarvis_intercept` events. Those events are now FIRED for real by `handle_refusal` whenever this plan's wrapper hits a non-Pass verdict — but no listener exists yet. End-to-end visible only after Plan 18-11 lands.
- **Plan 18-12 (cold-install demo):** Exercises the full flow ChatPanel → ego → consent → outbound end-to-end. The path lights up after 18-11.
- **Plan 18-14 Task 4 (LLM retry):** Replaces the Plan 05 placeholder `<retry-pending: {capability} installed via {tool}>` text in `EgoOutcome::AutoInstalled.then_retried` with an actual LLM retry call inside this same wrapper. Insertion point is identified inline in the new wrap code (`AutoInstalled { then_retried, .. } => then_retried,` line — Plan 14 will replace `then_retried` with an awaited fresh-LLM-call result).
- **Pitfall 3 (fast-streaming branch ego-blind):** Documented inline at l.1172-1182. Resolution requires accumulator refactor to providers::stream_text, deferred to v1.3 per RESEARCH § Anti-Patterns.
- **Q1 v1.3 follow-up:** The browser-harness adoption decision itself is deferred to v1.3 — the verdict closes the OPEN question, not the IMPLEMENTATION question. v1.3 phase planning will measure where browser fallback is actually needed and decide adoption then.

## Self-Check: PASSED

- `src-tauri/src/commands.rs` modifications:
  - `grep -c "ego::reset_retry_for_turn" commands.rs` → 1 ✓
  - `grep -c "ego::intercept_assistant_output(&turn.content)" commands.rs` → 1 ✓
  - `grep -c "ego::handle_refusal" commands.rs` → 1 ✓
  - `grep -c "EgoVerdict::Pass" commands.rs` → 1 ✓
  - `grep -c "EgoOutcome::HardRefused" commands.rs` → 1 ✓
  - `grep -c "Pitfall 3" commands.rs` → 3 ✓
  - `grep -c "extract_actions(&final_content)" commands.rs` → 1 ✓
- `.planning/research/questions.md`:
  - `grep -E "Status.*closed" questions.md` → 1 ✓
  - `grep -E "Status.*open" questions.md` → 0 ✓
  - `grep "Verdict — closed 2026-04-30" questions.md` → 1 ✓
  - `grep "deferred to v1.3" questions.md` → 1 ✓
- Commits exist:
  - `git log --oneline -3` shows: `a1ff743` (docs Q1 closure) + `4d29b5a` (feat ego wiring) ✓
- cargo check exits 0 ✓
- cargo test --lib ego:: → 18/18 green ✓
