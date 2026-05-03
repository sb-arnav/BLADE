---
phase: 27-hormone-physiology
verified: 2026-05-02T19:00:00Z
status: gaps_found
score: 8/9 must-haves verified
overrides_applied: 0
gaps:
  - truth: "DoctorPane.tsx renders the Hormones signal row without TypeScript errors"
    status: failed
    reason: "rowRefs useMemo in DoctorPane.tsx (line 132) initializes a Record<SignalClass, RefObject<HTMLButtonElement>> that is missing the 'hormones' key. npx tsc --noEmit exits non-zero with TS2741."
    artifacts:
      - path: "src/features/admin/DoctorPane.tsx"
        issue: "rowRefs object literal at line 132 is missing hormones entry — Record<SignalClass, ...> typed but only 7 of 8 SignalClass members present"
    missing:
      - "Add `hormones: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,` inside the rowRefs useMemo map at line 139 (after the metacognitive entry)"
human_verification:
  - test: "DoctorPane shows Hormones signal row"
    expected: "After fixing the rowRefs TypeScript error and running `npm run tauri dev`, the DoctorPane shows a row labeled 'Hormones' with a Green severity badge at baseline hormone levels. Clicking the row shows all 7 hormone values (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience) near their defaults."
    why_human: "DoctorPane rendering is a runtime UI surface. tsc/cargo check cannot verify the row is visible, the badge color is correct, or the payload values display properly."
  - test: "ActivityStrip shows hormone threshold events after exchanges"
    expected: "After sending 2-3 chat messages, the ActivityStrip shows hormone threshold crossing events (e.g., 'cortisol ^ 0.XX -- elevated stress') when cortisol or norepinephrine exceeds 0.6. Events appear as blade_activity_log entries with module=homeostasis.physiology."
    why_human: "ActivityStrip emission requires a live Tauri event bus. Cannot verify frontend event rendering programmatically."
  - test: "Cortisol rises after failure-language responses and makes replies terser"
    expected: "After 3+ responses containing threat-lexicon words (error, failed, blocked), cortisol should rise above 0.3 baseline and subsequent responses should inject the terse/action-focused directive visible in the system prompt. Observable by prompting BLADE to describe a series of failures then checking response conciseness."
    why_human: "ROADMAP SC-1 requires an end-to-end behavioral test: real LLM response → classifier → hormone update → brain.rs injection → LLM behavioral change. Cannot verify this chain without running the app."
  - test: "Hormone state persists across process restart"
    expected: "Run app, send messages to elevate cortisol, quit. Relaunch. homeostasis_get_physiology() should return cortisol value close to the elevated level (modulo decay during downtime), not the 0.3 default."
    why_human: "SQLite round-trip persistence requires process lifecycle testing. Eval fixtures prove the code path exists but do not exercise a real restart."
---

# Phase 27: Hormone Physiology Verification Report

**Phase Goal:** BLADE has 7 hormone scalars with real decay constants, an emotion classifier that updates them from response text, and behavioral modulation effects wired to cortisol/dopamine/norepinephrine/acetylcholine — so internal state actually changes what BLADE does.
**Verified:** 2026-05-02T19:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PhysiologicalState struct exists with 7 f32 scalars + last_updated | VERIFIED | homeostasis.rs line 135 — struct with cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience, last_updated |
| 2 | get_physiology() returns a cloned PhysiologicalState from the OnceLock global | VERIFIED | homeostasis.rs line 208 — physiology_store().lock().map(p.clone()).unwrap_or_default() |
| 3 | apply_physiology_decay() decays all 7 scalars using exponential half-life formula with 0.01 floor | VERIFIED | homeostasis.rs line 408 — decay fn with 0.5f32.powf(elapsed/half_life), clamped to 0.01 floor |
| 4 | Physiological state loads from SQLite settings key 'physiology' on init and persists after decay | VERIFIED | homeostasis.rs lines 1027-1048 — load_physiology_from_db and persist_physiology_to_db using settings WHERE key='physiology' |
| 5 | Pituitary functions blend physiological scalars at 0.7/0.3 weight | VERIFIED | homeostasis.rs lines 1086-1138 — all 5 functions (growth_hormone, thyroid_stimulating, acth, oxytocin, adh) call get_physiology() and apply operational * 0.7 + p.scalar * 0.3 |
| 6 | hypothalamus_tick() calls apply_physiology_decay and persist_physiology_to_db | VERIFIED | homeostasis.rs lines 721-724 — apply_physiology_decay and persist_physiology_to_db called inside tick, with mortality_salience pass-through at line 724 |
| 7 | start_hypothalamus() emits threshold crossing events to ActivityStrip | VERIFIED | homeostasis.rs lines 746-753 — cortisol/NE/mortality_salience > 0.6 trigger emit_hormone_threshold, which emits blade_activity_log to ActivityStrip |
| 8 | classify_response_emotion() maps text to valence/arousal/EmotionCluster via static lexicon | VERIFIED | homeostasis.rs line 315 — 5 static &[&str] lexicons (THREAT/SUCCESS/EXPLORATION/CONNECTION/FATIGUE), density scoring, 50-char guard at line 317, None return for short text |
| 9 | update_physiology_from_classifier() applies alpha=0.05 EMA to 7 hormone scalars, mortality_salience capped at 0.8 | VERIFIED | homeostasis.rs line 377 — ALPHA=0.05 at line 378, mortality_salience clamped at 0.8 at line 400 |
| 10 | commands.rs calls classifier on full response text (assistant_text) in post-stream bookkeeping | VERIFIED | commands.rs line 1784 — classify_response_emotion called with &assistant_text (bound at line 1781), synchronous before tokio::spawn blocks |
| 11 | When cortisol > 0.6, brain.rs injects terse/action-focused directive | VERIFIED | brain.rs line 548 — physio.cortisol > 0.6 block injects terse directive; line 550 — cortisol < 0.2 injects exploratory |
| 12 | When oxytocin > 0.6, brain.rs injects warm/personal tone directive | VERIFIED | brain.rs line 553 — physio.oxytocin > 0.6 injects warm/personal tone string |
| 13 | When dopamine < 0.2, evolution.rs skips speculative discovery | VERIFIED | evolution.rs line 640 — physio.dopamine < 0.2 returns early from run_evolution_cycle |
| 14 | When norepinephrine > 0.6, evolution.rs forces exploration run | VERIFIED | evolution.rs line 636 — physio.norepinephrine > 0.6 falls through (bypasses conservative gates) |
| 15 | When acetylcholine > 0.6, metacognition.rs lowers confidence threshold from 0.3 to 0.4 | VERIFIED | metacognition.rs lines 166-169 — ach > 0.6 produces verify_threshold=0.4_f32, else 0.3_f32; confidence < verify_threshold |
| 16 | SignalClass::Hormones exists in doctor.rs with compute function and 3 severity arms | VERIFIED | doctor.rs line 42 — Hormones variant; line 989 — compute_hormones_signal(); lines 152-158 — 3 suggested_fix arms; lines 1040,1054 — tokio::join and signals Vec wired |
| 17 | admin.ts SignalClass union includes 'hormones'; DoctorPane.tsx DISPLAY_NAME and ROW_ORDER include 'hormones' | VERIFIED | admin.ts line 1836; DoctorPane.tsx lines 48,62 — entries present and correct |
| 18 | DoctorPane.tsx compiles without TypeScript errors | FAILED | rowRefs useMemo at line 132 initializes Record<SignalClass, RefObject<HTMLButtonElement>> with only 7 of 8 members — missing 'hormones'. npx tsc --noEmit exits 1 with TS2741 |
| 19 | hormone_eval.rs contains 9 deterministic fixtures covering HORM-01..09 | VERIFIED | hormone_eval.rs — 9 fixtures in fixtures() at lines 457-465, test entry point evaluates_hormone_physiology() at line 474 |
| 20 | verify:hormone gate exists and is wired into verify:all chain | VERIFIED | package.json line 44 — verify:hormone script; line 45 — appended to verify:all; scripts/verify-hormone.sh exists and executable |

**Score:** 19/20 truths verified (1 failed — TypeScript compilation error)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `src-tauri/src/homeostasis.rs` | PhysiologicalState, global, decay, persistence, pituitary blend, classifier, update fn | VERIFIED | All declarations present at expected lines; substantive implementation confirmed |
| `src-tauri/src/commands.rs` | Classifier call site after assistant_text binding | VERIFIED | Lines 1784-1785, synchronous, before tokio::spawn |
| `src-tauri/src/brain.rs` | Cortisol + oxytocin modulation block | VERIFIED | Lines 545-556, after SAFETY MODULATION block as specified |
| `src-tauri/src/evolution.rs` | Dopamine + NE gate in run_evolution_cycle | VERIFIED | Lines 633-642, after insulin gate |
| `src-tauri/src/metacognition.rs` | ACh gate on verifier threshold | VERIFIED | Lines 166-169, replaces hardcoded 0.3 |
| `src-tauri/src/doctor.rs` | SignalClass::Hormones, compute fn, suggested_fix arms, join/Vec wiring, test update | VERIFIED | All 6 Rust edits confirmed at specific lines |
| `src/lib/tauri/admin.ts` | 'hormones' in SignalClass union | VERIFIED | Line 1836 |
| `src/features/admin/DoctorPane.tsx` | hormones in DISPLAY_NAME, ROW_ORDER; rowRefs complete | STUB | DISPLAY_NAME and ROW_ORDER correct; rowRefs at line 132 missing hormones entry — TS2741 error |
| `src-tauri/src/evals/hormone_eval.rs` | 9 deterministic HORM fixtures | VERIFIED | 21,005 bytes, 9 fixtures confirmed |
| `scripts/verify-hormone.sh` | Executable gate script | VERIFIED | -rwxr-xr-x, contains cargo test --lib evals::hormone_eval |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| homeostasis.rs | SQLite settings table | load_physiology_from_db / persist_physiology_to_db | WIRED | Key 'physiology' confirmed in both functions |
| homeostasis.rs | ActivityStrip | emit_hormone_threshold in start_hypothalamus loop | WIRED | blade_activity_log event with module=homeostasis.physiology |
| commands.rs | homeostasis.rs | classify_response_emotion + update_physiology_from_classifier | WIRED | Lines 1784-1785, after assistant_text binding |
| brain.rs | homeostasis.rs | crate::homeostasis::get_physiology().cortisol / .oxytocin | WIRED | Line 547 |
| evolution.rs | homeostasis.rs | crate::homeostasis::get_physiology().dopamine / .norepinephrine | WIRED | Line 634 |
| metacognition.rs | homeostasis.rs | crate::homeostasis::get_physiology().acetylcholine | WIRED | Line 167 |
| doctor.rs | homeostasis.rs | crate::homeostasis::get_physiology() in compute_hormones_signal | WIRED | Line 990 |
| DoctorPane.tsx | admin.ts | SignalClass type import | WIRED (partial) | SignalClass union updated in admin.ts; however DoctorPane.tsx rowRefs does not exhaustively implement Record<SignalClass,...> |
| scripts/verify-hormone.sh | evals/hormone_eval.rs | cargo test --lib evals::hormone_eval | WIRED | Line 21 of verify-hormone.sh |
| package.json | verify-hormone.sh | verify:hormone npm script | WIRED | Line 44 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| cargo check passes | `cd src-tauri && cargo check` | exit 0, 1 pre-existing warning in reward.rs (unrelated) | PASS |
| tsc --noEmit passes | `npx tsc --noEmit` | exit 1, TS2741 in DoctorPane.tsx line 132 | FAIL |
| hormone_eval.rs has 9 fixtures | grep count | 10 HormoneFixture struct instances (9 fixtures + 1 struct def) | PASS |
| verify-hormone.sh is executable | ls -la | -rwxr-xr-x confirmed | PASS |
| verify:hormone in verify:all | grep package.json | Confirmed at end of verify:all chain | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HORM-01 | 27-01, 27-05 | 7 hormone scalars with individual decay constants | SATISFIED | PhysiologicalState struct verified, apply_physiology_decay with 7 per-hormone half-lives, eval fixture HORM-01 passes |
| HORM-02 | 27-02, 27-05 | Emotion classifier ≥50 tokens, α=0.05 smoothing | SATISFIED | classify_response_emotion with 50-char guard, update_physiology_from_classifier with ALPHA=0.05, wired in commands.rs |
| HORM-03 | 27-03, 27-05 | Cortisol modulates response style | SATISFIED | brain.rs cortisol > 0.6 / < 0.2 gates confirmed; eval fixture HORM-03 structural check passes |
| HORM-04 | 27-03, 27-05 | Dopamine modulates exploration rate | SATISFIED | evolution.rs dopamine < 0.2 early return confirmed; eval fixture HORM-04 passes |
| HORM-05 | 27-03, 27-05 | Norepinephrine modulates novelty response | SATISFIED | evolution.rs NE > 0.6 fall-through confirmed; eval fixture HORM-05 passes |
| HORM-06 | 27-03, 27-05 | Acetylcholine modulates verifier frequency | SATISFIED | metacognition.rs verify_threshold computation confirmed; eval fixture HORM-06 passes |
| HORM-07 | 27-03, 27-05 | Oxytocin modulates personalization depth | SATISFIED | brain.rs oxytocin > 0.6 warm-tone injection confirmed; eval fixture HORM-07 passes |
| HORM-08 | 27-01, 27-04, 27-05 | Hormone state persisted and visible in UI | PARTIAL | Persistence confirmed (SQLite key='physiology'). Rust doctor.rs compute_hormones_signal wired. Frontend DoctorPane has TypeScript compile error in rowRefs — tsc fails |
| HORM-09 | 27-01, 27-02, 27-04, 27-05 | Hormone bus emits to ActivityStrip per M-07 contract | SATISFIED | emit_hormone_threshold emits blade_activity_log with correct keys; DoctorPane payload contains all 7 hormone values |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/features/admin/DoctorPane.tsx | 132-141 | Record<SignalClass, RefObject<HTMLButtonElement>> initialized with 7 of 8 required keys — 'hormones' missing | Blocker | TypeScript compile failure (TS2741); `npx tsc --noEmit` exits 1; production builds will fail |

### Human Verification Required

#### 1. DoctorPane Renders Hormones Signal Row

**Test:** After fixing the rowRefs TypeScript error (gap above), run `npm run tauri dev`. Open the Doctor page (Cmd+K → Doctor). Verify a row labeled "Hormones" appears with a Green severity badge at baseline. Click the row and confirm the expanded payload shows all 7 hormone values (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality_salience).
**Expected:** Green badge at launch; 7 numeric values near their defaults (cortisol≈0.3, serotonin≈0.5, mortality_salience≈0.0).
**Why human:** DoctorPane rendering is a runtime Tauri + React surface. Static analysis cannot verify row visibility, badge color, or payload display.

#### 2. ActivityStrip Shows Hormone Threshold Events

**Test:** With the app running, send chat messages containing failure language (e.g., "The deployment failed", "Error: permission denied", "I cannot complete this task"). After 2-3 exchanges, observe the ActivityStrip.
**Expected:** ActivityStrip shows threshold crossing events with human_summary text like "cortisol ^ 0.XX -- elevated stress" or "norepinephrine ^ 0.XX -- high alertness" once values exceed 0.6. Events have module = "homeostasis.physiology" and action = "threshold_crossing".
**Why human:** ActivityStrip renders Tauri events in real-time UI. The event emission code is verified statically (emit_hormone_threshold at homeostasis.rs line 1052), but event reception and UI rendering require a live runtime.

#### 3. Cortisol-Driven Response Terseness (ROADMAP SC-1)

**Test:** Establish a baseline by sending BLADE a neutral question. Then send 3+ messages that contain failure framing ("that failed", "error", "unable to complete"). After the 4th exchange, compare the length and directness of BLADE's response to the baseline.
**Expected:** ROADMAP SC-1 — responses after elevated cortisol are noticeably terser and more action-focused. The brain.rs injection "High cortisol: be terse, action-focused, skip preamble. Respond in 2 sentences or fewer unless technical depth is required." should be visible in its behavioral effect.
**Why human:** End-to-end behavioral verification requires live LLM responses. The classifier → hormone bus → brain.rs injection chain is structurally verified but its observable effect on response style requires a human judge.

#### 4. Hormone Persistence Across Process Restart

**Test:** Run app, observe initial hormone values via DoctorPane (should be defaults). Send messages to elevate some hormones. Quit the app cleanly. Relaunch. Open DoctorPane.
**Expected:** Hormone values on relaunch are close to the pre-quit values (modulo natural decay during downtime) — not reset to defaults (0.3 baseline). cortisol especially should show residual elevation if it was elevated before quit.
**Why human:** SQLite persistence requires a real process lifecycle. The load_physiology_from_db / persist_physiology_to_db functions are verified statically, but their effective round-trip requires actually restarting the process.

### Gaps Summary

One gap is blocking the phase: **DoctorPane.tsx fails TypeScript compilation** (TS2741). The `rowRefs` `useMemo` at line 132 creates a `Record<SignalClass, RefObject<HTMLButtonElement>>` object literal with only 7 entries (the original 7 signal classes). When `'hormones'` was added to the `SignalClass` union in `admin.ts`, the `DISPLAY_NAME` and `ROW_ORDER` in DoctorPane.tsx were updated, but this `rowRefs` initialization was missed. 

The fix is a 1-line addition inside the useMemo map at line 139 (after the metacognitive entry):

```typescript
hormones: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
```

This is a **mechanical completeness gap** — the HORM-08 requirement for hormone state to be "visible in UI" is partially blocked because the DoctorPane component has a type error that will cause production build failure. The Rust side (SignalClass::Hormones, compute_hormones_signal, doctor.rs integration) is fully functional. The fix is a single line.

---

_Verified: 2026-05-02T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
