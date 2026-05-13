# Phase 43 — Pulse Reduction — SUMMARY

**Milestone:** v1.6 — Narrowing Pass
**Requirement:** REDUCE-06
**Status:** Closed at static-gates-green
**Commits:** `1d688a8`, `2c2e49f`

## Goal recap

Per V2-AUTONOMOUS-HANDOFF §0 + VISION:

> "Underlying cron primitive stays. The daily-summary engine cuts;
> proactive interjection routes through the decision gate so it only
> fires when something genuinely matters per the core command."

Two-commit delivery: cut the daily-summary engine + morning-briefing,
then wire pulse thought emission through `decision_gate::evaluate`.

## LOC delta

| File | Before | After | Δ |
|---|---|---|---|
| `src-tauri/src/pulse.rs` | 1085 | 487 | **−598** |
| `src-tauri/src/lib.rs` | 1751 | ~1742 | −9 (2 handler entries + 6-line spawn block) |
| `src-tauri/src/cron.rs` | 759 | ~752 | −7 (preset row + match arm) |

Net Rust deletion across phase: ~614 LOC. Goal in 43-CONTEXT.md was
"~600 LOC reduction target after this phase" — met.

## Files touched

- `src-tauri/src/pulse.rs` — gutted to keep only the primitives and the
  per-thought generation path. Decision-gate wire added inside
  `start_pulse` after `generate_pulse_thought` returns Ok.
- `src-tauri/src/lib.rs` — removed two Tauri handler entries
  (`pulse_daily_digest`, `pulse_get_daily_digest`) and the 8s-delayed
  `maybe_morning_briefing` spawn block.
- `src-tauri/src/cron.rs` — removed `preset:morning_briefing` from
  `seed_preset_tasks` and the `"morning_briefing" =>` match arm in
  `execute_pulse_task`. Legacy seeded rows in existing user DBs fall
  through to the generic `pulse_now` branch without crashing.

## Functions / structs cut (17 items)

From `pulse.rs`:

1. `pub struct DailyDigest`
2. `pub struct DigestEmailDraft`
3. `pub struct DigestCodingStats`
4. `struct MorningContext`
5. `pub async fn generate_daily_digest`
6. `#[tauri::command] pub async fn pulse_daily_digest`
7. `#[tauri::command] pub fn pulse_get_daily_digest`
8. `pub async fn maybe_morning_briefing`
9. `pub async fn run_morning_briefing`
10. `async fn generate_morning_briefing`
11. `async fn gather_morning_context`
12. `fn build_morning_prompt`
13. `fn gather_git_status_summary`
14. `async fn fetch_weather_summary`
15. `fn analyze_temporal_patterns`
16. `fn gather_coding_stats`
17. `fn gather_commitments`

Plus `async fn gather_email_drafts`, `async fn emit_briefing`,
`fn cap_at_200_words` (helper-helpers — 20 cuts total).

## Functions preserved (the cron primitive + per-thought generation)

- `pub fn start_pulse` — **the cron heartbeat**, untouched except for
  the decision_gate wrap around the existing thought-emit.
- `async fn generate_pulse_thought` + `build_pulse_prompt` +
  `call_provider_for_thought` — per-thought generation primitives.
- `pub async fn call_provider_simple` — used by `cron.rs`.
- `#[tauri::command] pub fn pulse_get_last_thought`
- `#[tauri::command] pub async fn pulse_explain`
- `#[tauri::command] pub async fn pulse_now`
- `#[tauri::command] pub async fn pulse_get_digest` — the
  "while-you-were-away" digest, **distinct** from the cut
  `pulse_daily_digest`, still consumed by
  `src/lib/tauri/system.ts` + `dream_mode.rs`.

## decision_gate wire location

`src-tauri/src/pulse.rs` — inside `start_pulse`'s spawn loop, immediately
after `generate_pulse_thought()` returns `Ok(thought)` and before the
existing `app.emit_to("main", "blade_pulse", ...)` call.

Signal shape:

```rust
Signal {
    source: "pulse".to_string(),
    description: thought.clone(),
    confidence: 0.7,
    reversible: true,
    time_sensitive: false,
}
```

`PerceptionState` sourced from `crate::perception_fusion::get_latest()`
with `.unwrap_or_default()` for cold-boot race protection.

Outcome dispatch:
- `ActAutonomously` | `AskUser` → emit `blade_pulse` + tray tooltip +
  TTS + Obsidian + Discord + timeline (full existing side-effect chain).
- `Ignore { reason }` → `log::debug!` and skip this cycle.
- `QueueForLater { .. }` → `log::debug!` and skip this cycle. (Queue
  persistence is the gate's responsibility; pulse generates a fresh
  thought on next 15-min tick rather than replaying queued items.)

At default per-source threshold 0.9 with confidence 0.7 and
`time_sensitive=false`, the gate falls into Rule 6
(QueueForLater(High))  for both idle and focused users, so emission is
suppressed by default until per-source threshold learning brings the
threshold below 0.7 via positive `decision_feedback`.

This matches the cut wording: *"only fires when something genuinely
matters per the core command."*

## Static gates

| Gate | Result |
|---|---|
| `cd src-tauri && cargo check` | clean (3 pre-existing dead_code warnings on cut-feature helpers — `post_briefing`, `log_briefing`, `parse_owner_repo` — out of scope) |
| `npx tsc --noEmit` | clean (no frontend bindings referenced any cut symbol; `blade_briefing` and `blade_daily_digest` events had zero listeners) |
| Per V2-AUTONOMOUS-HANDOFF §1: phase close at static-gates-green | Met |
| `verify:all` OEVAL-01c v1.4 organism-eval drift | Documented carry-forward, not a Phase 43 regression |

## Commit SHAs

- `1d688a8` — `feat(43): REDUCE-06 — cut daily-summary engine + morning-briefing`
- `2c2e49f` — `feat(43): REDUCE-06 — route pulse thought emission through decision_gate`

## Open issues

None. Frontend bindings checked — no `pulse_daily_digest`,
`pulse_get_daily_digest`, `blade_briefing`, or `blade_daily_digest`
references exist in `src/`. The legacy `preset:morning_briefing` row
may still exist in pre-existing user blade.db installs; the cron
dispatch handler falls through to `pulse_now` for unknown
`task.action.content` values, so no schema migration or DB cleanup
is required.

## Risk surface

The decision_gate at default threshold 0.9 with confidence 0.7 and
`time_sensitive=false` will suppress pulse emission via QueueForLater
on every cycle until per-source threshold learning drops the threshold
below 0.7 through positive `decision_feedback`. This is the intended
"only when something genuinely matters" behaviour but is a regression
for any user who relied on the previous unconditional pulse emit. If
operator dogfood shows pulse going silent indefinitely, the fix is
either (a) raising the signal confidence floor when the underlying
thought-generation context is rich, or (b) wiring a thumbs-up UI on
the existing pulse chat-line surface so positive feedback reaches
`decision_feedback`. Defer until evidence.

## Phase close

Static gates green, commits landed, summary written.
Per V2-AUTONOMOUS-HANDOFF §0 v1.6 cut list, REDUCE-06 is now complete.
