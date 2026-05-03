---
phase: 29-vitality-engine
plan: 04
subsystem: ui
tags: [vitality, events, chat, react, typescript, reincarnation, indicator]

requires:
  - phase: 29-01
    provides: "Rust vitality_engine.rs emitting blade_vitality_update, blade_dormancy, blade_reincarnation events"
  - phase: 29-03
    provides: "DoctorPane Vitality signal class for full diagnostic detail"
provides:
  - "BladeVitalityUpdatePayload, BladeDormancyPayload, BladeReincarnationPayload typed interfaces"
  - "BLADE_VITALITY_UPDATE, BLADE_DORMANCY, BLADE_REINCARNATION in BLADE_EVENTS registry"
  - "VitalityIndicator component in chat header (band-colored dot + percentage + trend arrow)"
  - "Reincarnation system message injection in useChat.tsx per D-23"
affects: [29-05]

tech-stack:
  added: []
  patterns: ["useTauriEvent<T> with useCallback handler for non-streaming event subscriptions", "null-render pattern for conditional indicators (return null until first event)"]

key-files:
  created:
    - src/features/chat/VitalityIndicator.tsx
  modified:
    - src/features/chat/ChatPanel.tsx
    - src/features/chat/useChat.tsx
    - src/lib/events/payloads.ts
    - src/lib/events/index.ts

key-decisions:
  - "VitalityIndicator handler receives Event<T> wrapper (e.payload) matching useTauriEvent contract, not raw payload"
  - "Reincarnation handler ignores payload content and uses hardcoded D-23 message text for consistency"

patterns-established:
  - "Vitality event payload typing: band is a 5-value union type matching Rust VitalityBand enum serde output"
  - "Null-render indicator: component returns null before first event, avoiding layout shift on fresh installs"

requirements-completed: [VITA-05, VITA-04]

duration: 4min
completed: 2026-05-03
---

# Phase 29 Plan 04: Frontend Vitality Indicator Summary

**Chat-header vitality indicator with band-colored dot, event payload types, and D-23 reincarnation system message injection**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-03T09:38:33Z
- **Completed:** 2026-05-03T09:42:45Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added 3 typed payload interfaces (BladeVitalityUpdatePayload, BladeDormancyPayload, BladeReincarnationPayload) with JSDoc linking to Rust emit sites and context decisions
- Extended BLADE_EVENTS registry with BLADE_VITALITY_UPDATE, BLADE_DORMANCY, BLADE_REINCARNATION -- string values match Rust emit strings exactly
- Created VitalityIndicator.tsx: band-colored dot (green/yellow/orange/red/grey) + scalar percentage + trend arrow, subscribed to blade_vitality_update via useTauriEvent, null-render until first event
- Mounted VitalityIndicator in ChatPanel.tsx chat-header after routing Pill (D-22)
- Wired reincarnation system message in useChat.tsx: on blade_reincarnation event, injects "BLADE has reincarnated. Memories intact. Rebuilding vitality." into chat history (D-23)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add event payloads, BLADE_EVENTS entries, and reincarnation chat handler** - `0ca07ef` (feat)
2. **Task 2: Create VitalityIndicator.tsx and mount in ChatPanel.tsx chat header** - `33c6ec5` (feat)

## Files Created/Modified
- `src/features/chat/VitalityIndicator.tsx` - New component: band-colored dot + scalar percentage + trend arrow, subscribes to blade_vitality_update, null-render before first event (80 lines)
- `src/features/chat/ChatPanel.tsx` - Import and mount VitalityIndicator inside chat-header after routing Pill
- `src/features/chat/useChat.tsx` - Import BladeReincarnationPayload, add useTauriEvent handler for BLADE_REINCARNATION injecting D-23 system message
- `src/lib/events/payloads.ts` - 3 new interfaces: BladeVitalityUpdatePayload (scalar/band/trend/top_factor), BladeDormancyPayload, BladeReincarnationPayload
- `src/lib/events/index.ts` - 3 new event constants in BLADE_EVENTS: BLADE_VITALITY_UPDATE, BLADE_DORMANCY, BLADE_REINCARNATION

## Decisions Made
- **Event handler shape:** VitalityIndicator's handleUpdate callback receives the `Event<T>` wrapper and accesses `e.payload`, matching the useTauriEvent contract (EventCallback<T> receives Event<T>, not raw T). This is consistent with DoctorPane's handler pattern.
- **Reincarnation payload unused:** The BLADE_REINCARNATION handler ignores the event payload content (reincarnation_count, vitality_start, memories_intact) and uses the hardcoded D-23 message string. The payload data is available for future UI enrichment but the spec requires a fixed message.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 04 complete: vitality is visible in the chat header and reincarnation is narratively surfaced
- Plan 05 (eval suite) can verify frontend event wiring via the typed payload interfaces
- All 5 files compile clean under tsc --noEmit

## Self-Check: PASSED

All 6 files verified present. Both commit hashes (0ca07ef, 33c6ec5) found in git log.

---
*Phase: 29-vitality-engine*
*Completed: 2026-05-03*
