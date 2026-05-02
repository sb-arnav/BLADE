---
phase: 26-safety-bundle
plan: 02
subsystem: safety
tags: [safety, integration, decision-gate, consent, brain, prompt-modulation, danger-triple]
dependency_graph:
  requires: [safety_bundle_module, danger_triple_api, prompt_modulation_api]
  provides: [danger_triple_hitl_gate, consent_safety_override, prompt_modulation_active, consent_dialog_safety_ui]
  affects: [decision_gate, consent, brain, jarvis_dispatch, ConsentDialog, payloads]
tech_stack:
  added: []
  patterns: [outcome-candidate-pattern, safety-pre-check-interception, conditional-button-rendering]
key_files:
  created: []
  modified:
    - src-tauri/src/decision_gate.rs
    - src-tauri/src/consent.rs
    - src-tauri/src/brain.rs
    - src-tauri/src/jarvis_dispatch.rs
    - src/lib/events/payloads.ts
    - src/features/chat/ConsentDialog.tsx
    - src/features/chat/chat.css
decisions:
  - "Outcome-candidate pattern for Rules 4/5 instead of early returns, enabling safety pre-check before any ActAutonomously"
  - "Defense-in-depth comment on consent_respond rather than server-side reject — frontend button hiding is primary enforcement"
  - "Safety modulation injected at priority 2.5 between ROLE and IDENTITY EXTENSION"
  - "Used --a-warm token for safety notice styling (existing canonical token, not --color-warning which does not exist)"
metrics:
  duration_minutes: 5
  completed: "2026-05-02T13:10:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 7
  lines_added: ~70
---

# Phase 26 Plan 02: Safety Bundle Integration Summary

Wired safety_bundle.rs into the running system: danger-triple pre-check intercepts ActAutonomously in decision_gate, safety_override flows through consent to frontend, prompt modulations injected in brain.rs at priority 2.5, ConsentDialog hides AllowAlways and shows safety notice for danger-triple scenarios.

## What Was Built

### Task 1: Rust-layer integration (decision_gate, consent, brain)

**decision_gate.rs**: Refactored Rules 4 and 5 from early-return pattern to outcome-candidate pattern. Rules 4 and 5 now collect their `ActAutonomously` outcome into `outcome_candidate: Option<DecisionOutcome>` instead of returning immediately. A new safety pre-check block calls `crate::safety_bundle::check_danger_triple(signal, perception).await` before any ActAutonomously is returned. If the danger-triple fires, the outcome is overridden to `AskUser` with a `[Safety]` prefixed message explaining the danger-triple detection. Non-danger-triple cases are completely unaffected.

**consent.rs**: Added `safety_override: bool` parameter to `request_consent()` function signature. The parameter is included in the emitted JSON payload so the frontend receives it. Added defense-in-depth doc comment on `consent_respond` noting that the frontend is responsible for not offering AllowAlways when safety_override is true.

**brain.rs**: Injected `crate::safety_bundle::get_prompt_modulations()` call at priority 2.5 (between ROLE at priority 2 and IDENTITY EXTENSION at priority 3). Each non-empty modulation string is pushed into the parts vector. This activates calm-vector steering and attachment redirects in every system prompt build.

**jarvis_dispatch.rs**: Updated the single existing caller of `request_consent` to pass `false` as the `safety_override` argument, preserving existing behavior for non-danger-triple consent flows.

### Task 2: Frontend ConsentDialog safety_override

**payloads.ts**: Added `safety_override?: boolean` to `ConsentRequestPayload` interface with documentation comment.

**ConsentDialog.tsx**: Destructures `safety_override` from the payload. The "Allow always" button is wrapped in `{!safety_override && (...)}` so it is completely hidden when safety_override is true. A safety notice paragraph with class `consent-dialog-safety-notice` appears in the dialog header when safety_override is true, explaining "BLADE detected a potential danger-triple scenario."

**chat.css**: Added `.consent-dialog-safety-notice` styling using the existing `--a-warm` design token for color, with a 10% tinted background, small text size, and standard spacing.

## Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Wire decision_gate, consent, brain, jarvis_dispatch | f819cd1 | decision_gate.rs, consent.rs, brain.rs, jarvis_dispatch.rs |
| 2 | ConsentDialog safety_override + payloads.ts | 2ea01ee | payloads.ts, ConsentDialog.tsx, chat.css |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all integrations are fully wired.

## Threat Flags

None - no new network endpoints, auth paths, or trust boundary changes beyond what the plan's threat model covers (T-26-06, T-26-07, T-26-08).

## Self-Check: PASSED

- [x] src-tauri/src/decision_gate.rs contains `crate::safety_bundle::check_danger_triple`
- [x] src-tauri/src/decision_gate.rs contains `[Safety] This action triggers danger-triple detection`
- [x] src-tauri/src/consent.rs has `safety_override: bool` parameter
- [x] src-tauri/src/consent.rs payload JSON contains `"safety_override": safety_override`
- [x] src-tauri/src/brain.rs contains `crate::safety_bundle::get_prompt_modulations()`
- [x] src-tauri/src/brain.rs contains `SAFETY MODULATION (priority 2.5`
- [x] src-tauri/src/lib.rs contains `mod safety_bundle;`
- [x] src-tauri/src/jarvis_dispatch.rs has `false` for safety_override
- [x] src/lib/events/payloads.ts contains `safety_override?: boolean`
- [x] src/features/chat/ConsentDialog.tsx contains `safety_override` destructuring
- [x] src/features/chat/ConsentDialog.tsx contains `{!safety_override &&`
- [x] src/features/chat/chat.css contains `.consent-dialog-safety-notice`
- [x] cargo check passes (only pre-existing reward.rs warning)
- [x] npx tsc --noEmit passes clean
- [x] Commit f819cd1 exists
- [x] Commit 2ea01ee exists
