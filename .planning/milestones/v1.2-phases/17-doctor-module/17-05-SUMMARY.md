---
phase: 17-doctor-module
plan: 05
subsystem: diagnostics
tags: [doctor, orchestrator, tokio-join, transition-gate, doctor-event, blade-activity-log, phase-17, wave-3]

# Dependency graph
requires:
  - phase: 17-doctor-module
    provides: "Plan 17-02 (DoctorSignal struct + SignalClass/Severity enums + PRIOR_SEVERITY OnceLock + LAST_RUN OnceLock + last_run_cache helper); Plan 17-03 (compute_eval_signal + compute_capgap_signal + compute_autoupdate_signal); Plan 17-04 (compute_tentacle_signal + compute_drift_signal)"
provides:
  - "doctor_run_full_check orchestrator body: tokio::join! over all 5 sync signal sources wrapped in async blocks; locked most-volatile-first Vec order (EvalScores → CapabilityGaps → TentacleHealth → ConfigDrift → AutoUpdate); transition-detect against PRIOR_SEVERITY; emit doctor_event + blade_activity_log on warn-tier transitions; cache full Vec to LAST_RUN"
  - "emit_doctor_event(app, signal, prior): single-window broadcast via app.emit('doctor_event', json!({class, severity, prior_severity, last_changed_at, payload})). Wire-form matches frontend literal unions verbatim."
  - "emit_activity_for_doctor(app, signal): targeted emit via app.emit_to('main', 'blade_activity_log', ...) using ecosystem.rs:50-58 pattern verbatim. human_summary built as '{class} → {severity}: {one-liner}' with crate::safe_slice 200-cap; module='Doctor' so ActivityStrip prefixes '[Doctor]' per D-21."
  - "Transition gate predicate: `if transitioned && new_is_warn { emit_doctor_event(); emit_activity_for_doctor(); }` — both emits live in the SAME if-block per Pitfall 3 / P-06 (v1.1 'missed once = silent regression' mitigation)."
  - "BLADE_EVENTS.DOCTOR_EVENT = 'doctor_event' constant in src/lib/events/index.ts (frozen registry, flows through BladeEventName literal union automatically)."
  - "DoctorEventPayload TS interface in src/lib/events/payloads.ts with locked literal unions: class ∈ {eval_scores | capability_gaps | tentacle_health | config_drift | auto_update}; severity / prior_severity ∈ {green | amber | red}; payload: unknown; last_changed_at: number (unix ms)."
  - "6 transition-gate unit tests covering the D-20 corners: Green→Red emits, Green→Green silent, Red→Red silent, Amber→Green silent (recovery), Amber→Red emits, plus D-21 line format string-equality."
  - "doctor::tests count: 35 (29 prior + 6 new)."
affects: ["17-06 (DoctorPane.tsx subscribes via useTauriEvent(BLADE_EVENTS.DOCTOR_EVENT, ...) for live regression updates; ActivityStrip already consumes ACTIVITY_LOG so it picks up Doctor lines without changes)", "17-07 (verify-eval-doctor gate + Phase 17 verification gate consumes the runtime event flow)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tokio::join! over async blocks wrapping sync signal-source helpers — runtime can interleave file IO without spawning blocking pool tasks. All 5 sources run in parallel; total wall-time bounded by the slowest (drift signal's Node child-process probe)."
    - "Severity transition gate: `prior != current && matches!(current, Severity::Amber | Severity::Red)`. Same-severity (e.g. Red→Red) and recovery transitions (e.g. Amber→Green) silent per D-20 — recovery path is intentional design, not a bug; user already saw the regression and Doctor pane will reflect Green on next render."
    - "Both-emits-in-same-if-block invariant: emit_doctor_event AND emit_activity_for_doctor live inside the SAME `if transitioned && new_is_warn { ... }` block, with doctor_event FIRST per Pitfall 3 (so the doctor pane mounts updated state before the strip line renders). This is the v1.1 chat-streaming-retraction analog — if either emit lives on a separate branch, the strip stays empty even though the pane updates."
    - "ecosystem.rs:50-58 emit-to-main pattern reuse: identical key set ({module, action, human_summary, payload_id, timestamp}), identical safe_slice 200-cap on human_summary. ActivityStrip is already subscribed to 'blade_activity_log' (Phase 14 LOG-04) so Doctor lines flow without any frontend wiring change."
    - "Lock-acquisition graceful Err handling: `if let Ok(mut prior_lock) = prior_severity_map().lock()` rather than .unwrap() — Mutex poisoning is unlikely but the orchestrator should not panic on it. Worst case prior cache is stale for one tick; next run recovers."
    - "Cache-update-after-emit ordering: PRIOR_SEVERITY map is updated AFTER the emit branch fires, so the in-flight tick sees the OLD prior. Updating before would break the transition detection (every signal would compare against itself)."
    - "Plan 17-02 stub markers (`{stub: true, plan: '17-02'}`) fully removed from runtime path — confirmed by grep returning 0 matches."
    - "Frontend literal-union shape mirrors Rust serde rename_all: SignalClass `#[serde(rename_all = 'snake_case')]` → 'eval_scores' / 'capability_gaps' / 'tentacle_health' / 'config_drift' / 'auto_update'. Severity `#[serde(rename_all = 'lowercase')]` → 'green' / 'amber' / 'red'. Drift detection is human code-review (D-38-payload accepted risk)."

key-files:
  created: []
  modified:
    - "src-tauri/src/doctor.rs (+179/-51 net): emit_doctor_event helper, emit_activity_for_doctor helper, doctor_run_full_check body replaced (Plan 02 stub → real orchestrator), 8 #[allow(dead_code)] markers dropped from now-wired signal sources, 6 transition-gate unit tests, Emitter import unconditional"
    - "src/lib/events/index.ts (+5): DOCTOR_EVENT entry added after Phase 14 ACTIVITY_LOG, before closing `} as const;`. Phase 17 comment block matches surrounding section conventions."
    - "src/lib/events/payloads.ts (+25): DoctorEventPayload interface with the locked 5+3 literal unions, payload: unknown (not any), last_changed_at: number, full doc-comment with @see references to Rust emit site + CONTEXT D-20/D-21."

key-decisions:
  - "tokio::join! over async-block-wrapped sync helpers (NOT tokio::task::spawn_blocking). Reason: the deviation rules in PLAN allowed either; spawn_blocking adds JoinError handling overhead and the bounded I/O footprint of all 5 sources combined (~24KB tail-read + 1 SQL aggregate + 2 filesystem grep + 1 Node child-process + 1 filesystem read) does not warrant the blocking pool. async blocks let tokio interleave when each helper hits its first .await — for these sync helpers there are no .await points, so they run to completion serially-but-cooperatively inside the join! macro. Future enhancement (Phase 17 polish): spawn_blocking each one to truly parallelize."
  - "Both-emits-in-same-if-block invariant honored: `if transitioned && new_is_warn { emit_doctor_event(&app, sig, prior); emit_activity_for_doctor(&app, sig); }`. PATTERNS.md flagged the v1.1 chat-streaming retraction as the cautionary tale — every Rust streaming branch had to emit blade_message_start before chat_token, and one branch missed it. The compiler does not catch this; the only mitigation is structural — keep both emits on the same gate. Plan 09 verification gate will runtime-UAT this end-to-end."
  - "doctor_run_full_check signature changed from `(_app: AppHandle)` to `(app: AppHandle)` — the underscore prefix is dropped because the AppHandle is now used. This is wire-compatible (Tauri auto-injects AppHandle regardless of arg name); no frontend invoke change needed."
  - "Emit ORDER doctor_event FIRST then blade_activity_log: per RESEARCH § Pitfall 3, the doctor pane subscriber should mount updated state before the strip line renders. Reversing the order would briefly show a strip line referring to a signal class the doctor pane has not yet refreshed."
  - "Cache PRIOR_SEVERITY update happens AFTER the emit branch and AFTER the gate check, inside the same for-loop iteration. If the update happened before, every signal would compare against its own current severity (always equal) and transitions would never fire. Confirmed by transition-gate tests covering Green→Red and Amber→Red — both green prior to test execution because the cache is fresh."
  - "doctor_get_recent and doctor_get_signal bodies were already correct in Plan 17-02 (cache-read + filter — they match D-19 spec). Plan 17-05 leaves them untouched. The 'history of 50 records' note in D-19 documents Phase 17 ships only last-run cache; full per-class history vec is a v1.3 enhancement (deferred per scope clarification in PLAN's D-19 callout)."
  - "Frontend BLADE_EVENTS placement: DOCTOR_EVENT entry added immediately AFTER the Phase 14 ACTIVITY_LOG row (the most semantically related entry — both flow into the activity surface) and BEFORE the closing `} as const;`. The frozen registry pattern (`as const`) flows DOCTOR_EVENT through `BladeEventName` literal union automatically — no separate type maintenance."
  - "DoctorEventPayload uses `payload: unknown` (NOT `any`). Per CLAUDE.md / TS strict mode, `any` is banned. The runtime cast to a class-specific shape happens at the consumer site (DoctorPane.tsx in Plan 17-06) which will type-narrow on `payload.class`."
  - "No raw `import { listen } from '@tauri-apps/api/event'` added anywhere outside src/lib/events/. The single permitted listen surface is `useTauriEvent` (D-13 / D-34). Plan 17-06 will subscribe via `useTauriEvent(BLADE_EVENTS.DOCTOR_EVENT, handler)`."
  - "Plan 17-02 stub markers fully eradicated: grep `'plan': '17-02'` returns 0 matches in doctor.rs. The orchestrator returns real signal data, not placeholder Green stubs."

patterns-established:
  - "Wave-3 single-author convention: only Plan 17-05 writes doctor.rs in this wave. depends_on: [03, 04] enforces sequential after Wave 2. The orchestrator + emit helpers are additive to Plan 02-04's content; no Plan 02-04 function bodies were modified, only the orchestrator stub from Plan 02 was replaced."
  - "Frontend event-registry growth pattern: new BLADE_EVENTS constant + new payload interface + zero raw listen imports. The two files are co-edited; tsc clean is the contract. Future Phase 17 plans (17-06 / 17-07) consume these surfaces, never adding their own raw listen calls."
  - "Transition-gate test convention: 6 corners cover the truth table of `(transitioned, new_is_warn)` plus the D-21 format string-equality. Future severity-state-machine work in v1.3 (e.g. per-class history) can extend this without breaking the existing 6 baseline tests."

requirements-completed: [DOCTOR-01, DOCTOR-06]

# Metrics
duration: ~25min execution + ~5min compile cycles (1 cargo check + 1 cargo test + 1 tsc pass)
completed: 2026-04-30
---

# Phase 17 Plan 05: doctor_run_full_check orchestrator + transition gate + frontend event surface Summary

## One-liner

doctor.rs orchestrator wired: tokio::join! over 5 signal sources, D-20 transition gate emits doctor_event + blade_activity_log on warn-tier transitions only, frontend BLADE_EVENTS.DOCTOR_EVENT + DoctorEventPayload typed. 35/35 doctor tests + tsc clean.

## What Shipped

### Backend orchestrator (src-tauri/src/doctor.rs)

The Plan 02 stub `doctor_run_full_check` body (which returned 5 placeholder Green signals tagged `{stub: true, plan: "17-02"}`) is replaced with the real orchestrator:

1. **Parallel signal collection** — `tokio::join!` over all 5 sync signal sources wrapped in async blocks:
   ```rust
   let (eval, capgap, tentacle, drift, autoupdate) = tokio::join!(
       async { compute_eval_signal() },
       async { compute_capgap_signal() },
       async { compute_tentacle_signal() },
       async { compute_drift_signal() },
       async { compute_autoupdate_signal() },
   );
   ```
   Order in the returned `Vec<DoctorSignal>` is locked most-volatile-first per UI-SPEC § 7.5: EvalScores → CapabilityGaps → TentacleHealth → ConfigDrift → AutoUpdate.

2. **Transition detection** — diff each signal against `PRIOR_SEVERITY` map, compute `transitioned = prior != current` and `new_is_warn = matches!(current, Severity::Amber | Severity::Red)`.

3. **Both-emits-in-same-if-block** invariant honored:
   ```rust
   if transitioned && new_is_warn {
       // Per Pitfall 3: emit doctor_event FIRST, then activity_log.
       // BOTH emits live in the same gate to prevent the v1.1 "missed
       // once" silent-regression pattern (P-06).
       emit_doctor_event(&app, sig, prior);
       emit_activity_for_doctor(&app, sig);
   }
   ```

4. **Cache update** — `PRIOR_SEVERITY` map updated AFTER the emit branch (so the current tick compares against the OLD prior). `LAST_RUN` cache (used by `doctor_get_recent` / `doctor_get_signal`) updated with the full `Vec<DoctorSignal>`.

### Emit helpers (src-tauri/src/doctor.rs)

- **`emit_doctor_event(app, signal, prior)`** — single-window broadcast via `app.emit("doctor_event", json!({class, severity, prior_severity, last_changed_at, payload}))`. NOT `emit_to("main", ...)` because doctor pane lives only in main window (T-17-04 documented).

- **`emit_activity_for_doctor(app, signal)`** — targeted emit via `app.emit_to("main", "blade_activity_log", ...)` using ecosystem.rs:50-58 pattern verbatim. `human_summary = "{class} → {severity}: {one-liner}"` with `crate::safe_slice(&summary, 200)`. `module: "Doctor"` so ActivityStrip prefixes `[Doctor]` per D-21.

### Frontend surfaces

- **`src/lib/events/index.ts`** — `DOCTOR_EVENT: 'doctor_event'` added after Phase 14 ACTIVITY_LOG entry, inside the frozen `BLADE_EVENTS` registry. The literal union `BladeEventName` flows it through automatically.

- **`src/lib/events/payloads.ts`** — `DoctorEventPayload` interface with locked literal unions:
  ```typescript
  export interface DoctorEventPayload {
    class: 'eval_scores' | 'capability_gaps' | 'tentacle_health' | 'config_drift' | 'auto_update';
    severity: 'green' | 'amber' | 'red';
    prior_severity: 'green' | 'amber' | 'red';
    last_changed_at: number;  // unix milliseconds
    payload: unknown;
  }
  ```
  These literal strings exactly mirror Rust's `#[serde(rename_all = "snake_case")]` for `SignalClass` and `#[serde(rename_all = "lowercase")]` for `Severity`. Plan 17-06 imports the type by name.

## Transition-Gate Predicate (verbatim — for Plan 17-06 / 17-09 reference)

```rust
let transitioned = prior != sig.severity;
let new_is_warn = matches!(sig.severity, Severity::Amber | Severity::Red);

if transitioned && new_is_warn {
    emit_doctor_event(&app, sig, prior);
    emit_activity_for_doctor(&app, sig);
}
```

## D-20 Truth Table (covered by 6 unit tests)

| prior  | current | transitioned | new_is_warn | emit? | test                                       |
| ------ | ------- | ------------ | ----------- | ----- | ------------------------------------------ |
| Green  | Red     | true         | true        | YES   | `transition_gate_emits_on_green_to_red`    |
| Green  | Green   | false        | false       | NO    | `transition_gate_no_emit_on_green_to_green`|
| Red    | Red     | false        | true        | NO    | `transition_gate_no_emit_on_red_to_red`    |
| Amber  | Green   | true         | false       | NO    | `transition_gate_no_emit_on_amber_to_green`|
| Amber  | Red     | true         | true        | YES   | `transition_gate_emits_on_amber_to_red`    |

Plus `activity_summary_format_matches_d21` asserting the D-21 line format `"{class} → {severity}: {one-liner}"` (the `[Doctor]` prefix is added by the strip from the `module` field).

## TS Literal Unions (for Plan 17-06 import-by-name)

```typescript
import type { DoctorEventPayload } from '@/lib/events/payloads';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';

// In DoctorPane.tsx:
useTauriEvent<DoctorEventPayload>(BLADE_EVENTS.DOCTOR_EVENT, (e) => {
  // e.payload is DoctorEventPayload — class is the snake_case literal,
  // severity/prior_severity are lowercase literals, payload is unknown
  // and must be type-narrowed by class.
});
```

## Confirmation: Zero Raw Listen Imports

`grep -rn "from '@tauri-apps/api/event'" src/features/admin/ | grep -v "lib/events" | wc -l` returns 0. The single permitted listen surface remains `useTauriEvent` (D-13 / D-34). Plan 17-06 will subscribe via the hook.

## Verification

- `cd /home/arnav/blade/src-tauri && cargo check` — clean (0 warnings, 0 errors)
- `cd /home/arnav/blade/src-tauri && cargo test --lib doctor::tests -- --test-threads=1` — **35/35 passed** (29 prior + 6 new transition tests)
- `cd /home/arnav/blade && npx tsc --noEmit` — **0 errors**
- `grep -F '"plan": "17-02"' src/doctor.rs` — 0 matches (Plan 02 stub markers eradicated)
- `awk` order check: `emit_doctor_event(` at line 808, `emit_activity_for_doctor(` at line 809 — emit ordering correct (doctor_event FIRST per Pitfall 3)
- `grep -F "DOCTOR_EVENT: 'doctor_event'" src/lib/events/index.ts` — 1 match
- `grep -F "export interface DoctorEventPayload" src/lib/events/payloads.ts` — 1 match
- `grep -Fc "payload: any" src/lib/events/payloads.ts` — 0 matches (TS strict honored)

## Deviations from Plan

None — plan executed exactly as written. The orchestrator uses `tokio::join!` over async-block-wrapped sync helpers (per the PLAN's "Claude's Discretion" note allowing either `tokio::join!` or `tokio::spawn_blocking`); chose async blocks because none of the helpers have internal `.await` points and `spawn_blocking` would add JoinError handling overhead with no parallelism gain for the bounded I/O footprint.

## Self-Check: PASSED

- src-tauri/src/doctor.rs — FOUND
- src/lib/events/index.ts — FOUND
- src/lib/events/payloads.ts — FOUND
- Commit 6efa580 (feat(17-05): doctor_run_full_check body + transition gate + emits) — FOUND
- Commit 3c3bf53 (feat(17-05): frontend BLADE_EVENTS.DOCTOR_EVENT + DoctorEventPayload) — FOUND
