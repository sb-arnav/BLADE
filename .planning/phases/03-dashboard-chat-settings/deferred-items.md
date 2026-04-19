
## Discovered during Plan 03-02 execution

### Pre-existing verify:emit-policy violations (introduced by Plan 03-01, NOT this plan)

1. **homeostasis.rs:444 emits `hormone_update` as broadcast** — Plan 03-01 added the parallel emit (WIRE-02). The new event name is intentionally cross-window per D-64 ("HUD bar in Phase 4 will reuse this identical subscription"). The CROSS_WINDOW_ALLOWLIST in `scripts/verify-emit-policy.mjs` already lists `homeostasis.rs:homeostasis_update` (the legacy name) but not `homeostasis.rs:hormone_update` (the new canonical). Fix: add `'homeostasis.rs:hormone_update'` to CROSS_WINDOW_ALLOWLIST. Out of scope for Plan 03-02 (TS-only).

2. **agents/executor.rs:243 emits `blade_agent_event` as broadcast** — Pre-existing (not touched by 03-01 either; 03-01 SUMMARY notes WIRE-05 was a verification step and the actual file uses `agent_step_*` semantic names — but a literal `app.emit("blade_agent_event"...)` exists at line 243). Either the Plan 03-01 verification missed it OR a separate path exists. Out of scope for Plan 03-02. Recommend Plan 03-07 (smoke + Playwright) operator backstop confirms.

Both violations are Rust-side; Plan 03-02 ships pure TS wrappers and cannot resolve them.
