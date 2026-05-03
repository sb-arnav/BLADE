---
phase: 25-metacognitive-controller
verified: 2026-05-02T12:15:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "Send a complex reasoning query that BLADE is unlikely to handle confidently (e.g. 'explain the relationship between non-abelian gauge theory and quantum chromodynamics confinement') and verify the initiative phrasing appears"
    expected: "Response should contain 'I'm not confident about' and 'want me to observe first?' instead of a hallucinated answer"
    why_human: "Requires a running dev server with LLM API key to exercise the full reason_through pipeline and secondary verifier"
  - test: "Open DoctorPane and verify the Metacognitive signal row is visible at the bottom of the signal list"
    expected: "Row labeled 'Metacognitive' with severity indicator, confidence value, uncertainty count, and gap count in the payload"
    why_human: "Visual UI verification requires running app"
  - test: "After triggering a low-confidence response, check that a row appears in the metacognitive_gap_log SQLite table"
    expected: "Row with topic, user_request, confidence < 0.5, fed_to_evolution = 1"
    why_human: "Requires running dev server to exercise the full pipeline end-to-end"
---

# Phase 25: Metacognitive Controller Verification Report

**Phase Goal:** BLADE can detect its own uncertainty, route low-confidence responses to a secondary check, and surface capability gaps as initiative rather than hallucination.
**Verified:** 2026-05-02T12:15:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A response with a reasoning step that drops confidence by >0.3 causes a secondary verifier call before the reply surfaces to the user | VERIFIED | `reasoning_engine.rs` line 736: `if delta > CONFIDENCE_DELTA_THRESHOLD` triggers `any_uncertainty_flag = true` and calls `crate::metacognition::record_uncertainty_marker`. Line 762: `if any_uncertainty_flag \|\| synth_confidence < 0.5` gates `secondary_verifier_call`. The verifier uses `cheap_model_for_provider` (line 610) via `providers::complete_turn` (line 622). |
| 2 | When BLADE cannot answer confidently, it says "I'm not confident about X -- want me to observe first?" instead of hallucinating or silently refusing | VERIFIED | `reasoning_engine.rs` line 657-661: `build_initiative_response` produces `"I'm not confident about {} -- want me to observe first?"` with unicode em-dash. Line 768-782: when `!verified \|\| synth_confidence < 0.5`, initiative replaces the synthesized answer. Line 771: `crate::metacognition::log_gap` is called before the initiative response is constructed. |
| 3 | Identified gaps appear in SQLite and are retrievable by evolution.rs for Voyager-loop skill generation | VERIFIED | `metacognition.rs` line 62-78: `ensure_gap_log_table` creates `metacognitive_gap_log` table with correct schema. Line 97-129: `log_gap` inserts parameterized row and calls `crate::evolution::evolution_log_capability_gap` (line 117-119). `evolution.rs` line 1115 confirms `evolution_log_capability_gap` exists with matching signature. Tool-loop path also calls `metacognition::log_gap` at `commands.rs` line 1848 for low-confidence responses. |
| 4 | DoctorPane shows a metacognitive signal row with current confidence, uncertainty count, and gap count | VERIFIED | `doctor.rs` line 41: `Metacognitive` variant in `SignalClass` enum. Line 951-974: `compute_metacognitive_signal` calls `crate::metacognition::get_state()` (line 952), constructs payload with confidence/uncertainty_count/gap_count/last_updated (lines 966-970). Line 993-1000: `tokio::join!` includes `compute_metacognitive_signal` as 7th source. `admin.ts` line 1834: `\| 'metacognitive'` in SignalClass union. `DoctorPane.tsx` line 47: `metacognitive: 'Metacognitive'` in DISPLAY_NAME, line 60: `'metacognitive'` in ROW_ORDER, line 137: `metacognitive` in rowRefs. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src-tauri/src/metacognition.rs` | MetacognitiveState, gap log table, record/log/get functions, Tauri command, test stubs | VERIFIED | 550 lines. MetacognitiveState struct (line 21), OnceLock persistence (lines 28-60), gap log table (lines 62-78), record_uncertainty_marker (line 82), log_gap (line 97), get_state (line 34), metacognition_get_state command (line 490), 5 unit tests (lines 494-549). |
| `src-tauri/src/reasoning_engine.rs` | Confidence-delta detection, secondary_verifier_call, build_initiative_response | VERIFIED | CONFIDENCE_DELTA_THRESHOLD (line 58), secondary_verifier_call (line 601), build_initiative_response (line 657), extract_topic (line 665), step-loop integration (lines 712-744), verifier gate (lines 762-788). |
| `src-tauri/src/commands.rs` | Tool-loop metacognitive fallback | VERIFIED | meta_pre_check (line 1154), meta_low_confidence (line 1155), gap logging at line 1846-1853 with correct comment explaining it does NOT substitute response. |
| `src-tauri/src/doctor.rs` | SignalClass::Metacognitive, compute function, match arms, join, tests | VERIFIED | Enum variant (line 41), suggested_fix 3 arms (lines 143-149), compute_metacognitive_signal (line 951), emit_activity match (line 926), tokio::join 7-way (line 993), signals vec 7 entries (lines 1006-1014), exhaustive test updated (line 1115), signal count test updated to 7 (line 1769), test_metacognitive_signal exercised (line 1421). |
| `src/lib/tauri/admin.ts` | SignalClass union with 'metacognitive' | VERIFIED | `\| 'metacognitive'` at line 1834. |
| `src/features/admin/DoctorPane.tsx` | DISPLAY_NAME, ROW_ORDER, rowRefs for metacognitive | VERIFIED | DISPLAY_NAME entry at line 47, ROW_ORDER entry at line 60, rowRefs entry at line 137. |
| `src-tauri/src/lib.rs` | Command registration for metacognition_get_state | VERIFIED | `metacognition::metacognition_get_state,` at line 1377 in generate_handler. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| reasoning_engine.rs | metacognition.rs | record_uncertainty_marker + log_gap calls | WIRED | line 743: `crate::metacognition::record_uncertainty_marker`, line 771: `crate::metacognition::log_gap` |
| reasoning_engine.rs | providers/mod.rs | complete_turn for secondary verifier | WIRED | line 622: `crate::providers::complete_turn` with cheap_model_for_provider |
| commands.rs | metacognition.rs | log_gap in tool-loop fallback | WIRED | line 1848: `crate::metacognition::log_gap` gated by `meta_low_confidence` |
| metacognition.rs | evolution.rs | evolution_log_capability_gap | WIRED | line 117: `crate::evolution::evolution_log_capability_gap`. evolution.rs line 1115 confirms function exists. |
| metacognition.rs | SQLite settings table | persist_meta_state / load_meta_state | WIRED | lines 38-60: load/persist using key `metacognitive_state` with parameterized queries |
| doctor.rs | metacognition.rs | get_state() in compute_metacognitive_signal | WIRED | line 952: `crate::metacognition::get_state()` |
| DoctorPane.tsx | admin.ts | import SignalClass | WIRED | DoctorPane imports SignalClass from admin.ts, DISPLAY_NAME/ROW_ORDER/rowRefs all typed as Record<SignalClass, ...> |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| doctor.rs compute_metacognitive_signal | MetacognitiveState | metacognition::get_state() -> OnceLock<Mutex<MetacognitiveState>> loaded from SQLite | Yes -- reads from SQLite settings table, updated by record_uncertainty_marker and log_gap | FLOWING |
| DoctorPane.tsx | signals (from doctor_run_full_check) | Rust IPC -> doctor_run_full_check -> compute_metacognitive_signal | Yes -- 7th signal in vec includes payload with confidence/uncertainty_count/gap_count | FLOWING |
| commands.rs tool-loop fallback | meta_pre_check | metacognition::assess_cognitive_state | Yes -- heuristic function runs knowledge/capability/complexity assessment on user text | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Metacognition unit tests pass | `cargo test --lib metacogniti` | 6 passed, 0 failed | PASS |
| Doctor signal count test passes | `cargo test --lib doctor::tests::doctor_run_full_check` | 1 passed (asserts 7 signals, 7th is Metacognitive) | PASS |
| Suggested fix exhaustive test passes | `cargo test --lib doctor::tests::suggested_fix_table` | 1 passed (21 = 7x3 arms) | PASS |
| TypeScript compiles | `npx tsc --noEmit` | Clean exit, no errors | PASS |
| Initiative phrasing end-to-end | N/A | Requires running dev server with LLM API key | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| META-01 | 25-01, 25-02 | Confidence-delta tracking, flags drops >0.3 | SATISFIED | CONFIDENCE_DELTA_THRESHOLD constant (0.3), delta check in step loop (reasoning_engine.rs:732-744), record_uncertainty_marker call |
| META-02 | 25-02 | Low-confidence responses route to secondary verifier | SATISFIED | secondary_verifier_call function (reasoning_engine.rs:601-651) using cheap_model_for_provider, gated by any_uncertainty_flag or synth_confidence < 0.5 |
| META-03 | 25-02 | Initiative phrasing instead of hallucination | SATISFIED | build_initiative_response produces exact format (reasoning_engine.rs:657-661), replaces answer when verifier returns false or confidence < 0.5 |
| META-04 | 25-01, 25-02 | Gap log persists to SQLite, feeds evolution.rs | SATISFIED | metacognitive_gap_log table (metacognition.rs:62-78), log_gap writes row + calls evolution_log_capability_gap (metacognition.rs:97-129), tool-loop fallback in commands.rs also calls log_gap |
| META-05 | 25-03 | Metacognitive state visible in DoctorPane | SATISFIED | SignalClass::Metacognitive in doctor.rs, compute_metacognitive_signal with payload, DoctorPane.tsx DISPLAY_NAME/ROW_ORDER/rowRefs, admin.ts type union |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | -- | No TODO/FIXME/placeholder/stub patterns found | -- | -- |

No anti-patterns detected. All modified files are clean of TODO, FIXME, PLACEHOLDER, empty implementations, and console.log-only handlers.

### Human Verification Required

### 1. Initiative Phrasing End-to-End

**Test:** Send a complex reasoning query that BLADE is unlikely to handle confidently (e.g. "explain the relationship between non-abelian gauge theory and quantum chromodynamics confinement") via the chat interface.
**Expected:** If reasoning steps produce a confidence delta >0.3 or total confidence < 0.5, the response should contain "I'm not confident about [topic] -- want me to observe first?" instead of a hallucinated answer. The secondary verifier LLM call should fire (visible in logs as a cheap-model API call).
**Why human:** Requires a running dev server with a configured LLM API key. The full pipeline traverses reason_through -> secondary_verifier_call -> build_initiative_response, which cannot be tested without live LLM responses.

### 2. DoctorPane Visual Verification

**Test:** Open the DoctorPane (Admin route) and verify the Metacognitive signal row is visible.
**Expected:** A row labeled "Metacognitive" appears at the bottom of the signal list with a severity indicator (Green/Amber/Red), and clicking it opens a drawer showing confidence, uncertainty_count, and gap_count in the payload.
**Why human:** Visual UI verification in a running Tauri app. Cannot verify rendering or layout programmatically.

### 3. Gap Log Persistence Round-Trip

**Test:** After triggering a low-confidence response (see test 1), inspect `blade.db` with `sqlite3 ~/.config/blade/blade.db "SELECT * FROM metacognitive_gap_log"`.
**Expected:** At least one row with non-empty topic, user_request, confidence < 0.5, initiative_shown = 1, fed_to_evolution = 1.
**Why human:** Requires the full pipeline to run against a live LLM to produce an actual gap entry.

### Gaps Summary

No code-level gaps found. All 4 success criteria from the ROADMAP are satisfied at the code level:

1. Confidence-delta detection and secondary verifier are fully implemented in reasoning_engine.rs with correct gating logic.
2. Initiative phrasing is implemented with the exact specified format.
3. Gap log table exists, log_gap writes to it and feeds evolution.rs.
4. DoctorPane Metacognitive signal is fully wired from Rust through TypeScript.

The 3 human verification items above are needed to confirm the full pipeline works end-to-end in a running app, which cannot be verified with static analysis or unit tests alone.

---

_Verified: 2026-05-02T12:15:00Z_
_Verifier: Claude (gsd-verifier)_
