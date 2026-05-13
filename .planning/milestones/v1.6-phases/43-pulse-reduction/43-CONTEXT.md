# Phase 43 — Pulse Reduction

**Milestone:** v1.6 — Narrowing Pass
**Status:** Pending
**Requirements:** REDUCE-06
**Goal:** Pulse keeps its cron primitive (the scheduler). The daily-summary engine and morning-briefing UX retires. Proactive interjection routes through `decision_gate` so it only fires when something matters per the core command.

## Background (from V2-AUTONOMOUS-HANDOFF.md §0)

> *"Pulse / Morning Briefings → cron primitive stays, daily-summary engine cuts. Proactive interjection routes through decision_gate so it only fires when something matters per the core command."*

Per VISION.md "Significantly reduced" cut wording: *"Underlying cron primitive stays. The daily-summary engine cuts; proactive interjection routes through the decision gate so it only fires when something genuinely matters per the core command."*

## Approach

### Cut

- Daily-summary generation in `pulse.rs` (~1,094 LOC total module; ~600 LOC reduction target after this phase)
- Morning-briefing assembly: anything that pre-computes a "here's your day" digest at a fixed time
- Morning-briefing UI surface (if any survives) — Dashboard tile, scheduled notification
- Any `pulse.rs → chat::send_message` path that fires unconditionally on schedule
- Routes / chat-line emit calls tied to the daily-summary cadence

### Keep

- Cron scheduler primitive — the abstraction that lets BLADE run a task at a time. Skills, future v2.0 features, and the `decision_gate`-routed proactive paths all rely on it.
- Any `pulse.rs` infrastructure that's a substrate (job scheduling, persistence of fired-job log, retry-on-fail handler) rather than the daily-summary specifically.

### Re-route

- Find any place pulse fires a chat injection unconditionally. Wrap the injection in a call to `decision_gate::should_act(intent, context)`. If the gate says NO (low priority for the user's core command), the injection drops. If YES, it goes through to chat as today.
- This aligns with the `decision_gate.rs` purpose (act/ask/queue/ignore classifier with learning thresholds) shipped earlier.

## Risks

1. **Pulse is wired into other v1.4/v1.5 features.** Active inference loop (Phase 28) prediction updates may emit on a pulse cadence. Vitality engine (Phase 29) may use pulse for time-of-day decay. → grep for cron-job names, preserve every callsite that isn't daily-summary-specific.
2. **Decision gate may not have the API shape pulse needs.** If `decision_gate::should_act` is conversation-context-shaped and pulse callsites are timer-context-shaped, may need a thin adapter. Build minimal adapter; don't expand the gate's surface.
3. **The morning-briefing feature has been visible to operator dogfood.** Arnav may have come to rely on it. → Document the cut in CHANGELOG v1.6 prominently; the proactive path through decision_gate should produce a similar feel for tasks that genuinely matter.

## Success criteria

- [ ] Daily-summary generation code in `pulse.rs` removed (~600 LOC reduction)
- [ ] Cron scheduler primitive retained — verify any v2.0+ cron-job consumer (none today, but the primitive stays)
- [ ] Any `pulse.rs` → chat path that fires unconditionally re-routes through `decision_gate::should_act`
- [ ] Morning-briefing UI surface (if present) removed from Dashboard / routes
- [ ] `verify:all` ≥36/38
- [ ] cargo check clean; tsc --noEmit clean
- [ ] Chat smoke test passes
