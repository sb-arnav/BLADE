---
phase: 32-context-management
plan: 6
subsystem: brain + admin-ui
tags: [brain, doctor-pane, context-breakdown, get-context-breakdown, tauri-command, ctx-06, ctx-07, rust, typescript, react]

# Dependency graph
requires:
  - phase: 32-01
    provides: "ContextBreakdown wire struct (query_hash, model_context_window, total_tokens, sections, percent_used, timestamp_ms) — Plan 32-06 instantiates and returns this from the Tauri command"
  - phase: 32-03
    provides: "LAST_BREAKDOWN thread_local accumulator + read_section_breakdown / clear_section_accumulator / record_section helpers — Plan 32-06 wraps read_section_breakdown in get_context_breakdown to surface the per-section token tally"
  - phase: 32-05
    provides: "phase32_* test substrate (36 tests already green; Plan 32-06 appends 3 new tests under brain::tests for get_context_breakdown)"
provides:
  - "pub fn build_breakdown_snapshot(provider, model) -> ContextBreakdown in brain.rs — pure (non-Tauri) breakdown computation, callable from mod tests, aggregates LAST_BREAKDOWN char counts per label, converts chars/4 to tokens, looks up model_context_window via capability_probe::infer_capabilities, computes percent_used clamped to [0.0, 100.0] (NaN/inf-safe via ctx_window == 0 branch + .min(100.0))"
  - "pub async fn get_context_breakdown() -> Result<ContextBreakdown, String> in brain.rs — Tauri command, one-line shim that loads BladeConfig and forwards to build_breakdown_snapshot"
  - "brain::get_context_breakdown registered in lib.rs generate_handler! alongside existing brain::* commands"
  - "export type ContextBreakdown + export function getContextBreakdown() in src/lib/tauri/admin.ts (invokeTyped wrapper, D-186 / no-raw-tauri convention)"
  - "ContextBudgetSection component inside DoctorPane.tsx — subscribes to BLADE_EVENTS.CHAT_DONE via useTauriEvent, refreshes per chat turn (no polling), renders monospace table with section / tokens / % of total sorted desc by tokens, shows total_tokens + model_context_window + percent_used header"
  - "CTX-07 fallback: try/catch around getContextBreakdown — on error renders null (silent fail; never crashes DoctorPane)"
  - "Three new phase32_* unit tests under brain::tests — phase32_get_context_breakdown_after_prompt_build / _empty_when_no_prompt_built / _percent_used_clamped. Total phase32 count now 39 (36 prior + 3 new)."
affects: [32-07-fallback-fixture]

# Tech tracking
tech-stack:
  added: []  # No new dependencies — reuses chrono (already in brain.rs imports), capability_probe, config::load_config, invokeTyped, useTauriEvent
  patterns:
    - "Pure-fn + Tauri-shim split: build_breakdown_snapshot is the testable computation; get_context_breakdown is a one-line wrapper that loads config and forwards. This keeps the Tauri command body trivial (no logic to test through #[tauri::command] indirection) while preserving #[tauri::command] uniqueness check at the entry point."
    - "Saturating arithmetic on chars: total_chars uses .saturating_add to prevent overflow on adversarial breakdowns. Token conversion (chars / 4) is checked-div implicit (denominator = 4 const)."
    - "NaN/inf-safe percent_used: branch on ctx_window == 0 returns 0.0; otherwise (total_tokens / ctx_window * 100).min(100.0). No division by zero, no fp(NaN) leakage to wire format."
    - "Wire format Default-derived: ContextBreakdown derives Default (Plan 32-01 substrate). Empty accumulator → all zero. DoctorPane treats this as 'no prompt built this session yet'."
    - "useTauriEvent over raw listen(): DoctorPane already uses BLADE_EVENTS + useTauriEvent (D-13/D-38-hook). ContextBudgetSection follows the same convention — never raw listen, never raw invoke string. The handler-in-ref pattern in useTauriEvent (P-06 prevention) means the inline arrow function in the subscribe call doesn't churn listeners."
    - "Wrapper pattern over raw invoke: getContextBreakdown is the typed wrapper in admin.ts (D-186); DoctorPane imports the wrapper, never invokes the raw command name. ESLint rule no-raw-tauri enforces this — see deviation note below."

key-files:
  created: []
  modified:
    - "src-tauri/src/brain.rs (+ build_breakdown_snapshot pure fn + get_context_breakdown Tauri command + 3 unit tests under brain::tests; ~95 LOC)"
    - "src-tauri/src/lib.rs (+ brain::get_context_breakdown line in generate_handler! after the existing brain::* group; +1 LOC)"
    - "src/lib/tauri/admin.ts (+ ContextBreakdown type + getContextBreakdown() invokeTyped wrapper at the end of the file, after consentRevokeAll; ~50 LOC)"
    - "src/features/admin/DoctorPane.tsx (+ ContextBudgetSection component above DoctorRow with chat_done subscription + monospace table; mounted as Fragment sibling to the existing main return + error-path return; +135 LOC, -9 LOC = +126 net)"

key-decisions:
  - "Pure-fn + Tauri-shim split. build_breakdown_snapshot(provider, model) is the testable computation; get_context_breakdown is a one-line wrapper that calls config::load_config() then forwards. This is the plan's Step A/B division — tests target the pure fn, the Tauri command is trivially correct (no logic to test through the macro indirection)."
  - "Aggregate then convert. The existing record_section accumulator pushes one entry per section call (multiple identical labels possible). build_breakdown_snapshot first sums per-label char counts via HashMap entry-or-insert, THEN divides by 4 to get tokens. This matches the chars/4 estimate in commands.rs::estimate_tokens for cross-pipeline consistency."
  - "percent_used branch on ctx_window == 0. capability_probe::infer_capabilities returns a u32 ctx_window; if the provider/model is unknown the matrix returns 8_192 (CapabilityDefaults::all_false(8_192)) — never 0 in production. But the branch is defensive: zero would NaN the division. Clamp via .min(100.0) handles the synthetic-overflow test case (1M tokens vs 200k window)."
  - "useTauriEvent over polling. The plan's Step B alternative was a 2s setInterval fallback; chose useTauriEvent(BLADE_EVENTS.CHAT_DONE) per the plan's preferred path AND the existing DoctorPane convention (raw listen() is forbidden by the D-13 ESLint rule). Subscribed once per mount; refreshes only when chat completes — no idle polling."
  - "Mount as Fragment sibling (not nested inside main section). The main Doctor section already has its own padding/border via .diagnostics-section. Nesting the budget table inside would create double-padding; sibling Fragment keeps both sections at the same DOM level. Both happy-path and error-path returns now render ContextBudgetSection — a Doctor-signals-load-failure does NOT hide the budget panel (orthogonal concerns)."
  - "Empty-accumulator zero state. Plan does not strictly require this UI, but with Default-derived ContextBreakdown returning all-zeros when no prompt has been built yet, displaying a literal 0-token table is misleading. Added a 'No prompt built this session yet — send a chat message to populate' meta line. CTX-07 spirit: never display misleading data; soft-fail to a user-comprehensible state."
  - "CTX-07 fallback as renders null. The plan's Step E spirit ('soft fail — render nothing rather than break the page') is implemented: setError(...) → if error → return null. The error is captured in state for debug parity with DoctorPane's existing error-path pattern but is not surfaced visually."
  - "TS wrapper at the end of admin.ts (post-consent block). admin.ts is organised by Rust source module (mcp / providers / db / reports / auth / temporal / consent / etc.). The brain.rs ContextBreakdown is its own micro-module (just the breakdown command); appending at the end with its own ═══ banner keeps the structure consistent."

patterns-established:
  - "Pattern 1: pure-fn + Tauri-shim. New Tauri commands SHOULD split logic from the macro: a pure pub fn that does the work + a one-line #[tauri::command] async wrapper. Pure fn is unit-testable from mod tests without the Tauri runtime; wrapper handles config/state plumbing only. Mirrors the read_section_breakdown / get_context_breakdown shape."
  - "Pattern 2: typed wrapper over raw invoke for DoctorPane / admin features. Every Tauri command surface in feature files MUST import its wrapper from src/lib/tauri/<cluster>.ts. Raw invoke('command_name') is forbidden by the no-raw-tauri ESLint rule (D-13/D-186). New commands MUST add a typed wrapper before any feature consumes them."
  - "Pattern 3: useTauriEvent over raw listen for component-level event subscription. Same D-13 rule. ContextBudgetSection mirrors the DoctorPane main panel's existing useTauriEvent(DOCTOR_EVENT) pattern."
  - "Pattern 4: Fragment-wrap for sibling section addition. When adding a new section as a sibling to an existing component's return JSX, wrap both the existing return AND the error-path return in Fragments. The new sibling renders in BOTH paths — orthogonal concerns are not coupled to each other's success."

requirements-completed: [CTX-06]

# Metrics
duration: ~14 min  # Edit time only; cargo recompile (~12m) and tsc (~30s) dominate wall-clock
completed: 2026-05-04
---

# Phase 32 Plan 32-06: Context Budget Dashboard Summary

**`get_context_breakdown` Tauri command + `getContextBreakdown` typed TS wrapper + `ContextBudgetSection` in DoctorPane: an operator can now SEE selective injection working — after every chat turn, the Diagnostics → Doctor pane refreshes a monospace per-section token table sorted desc by tokens, with total / model context window / percent used in the header.**

## Performance

- **Duration:** ~14 min wall-clock for the edits + grep + tsc verification. Cargo recompile dominated overall wall-clock (~12 min for the test rebuild — single invocation per CLAUDE.md "batch first" guidance).
- **Started:** 2026-05-04T01:57:07Z (per orchestrator START_TIME)
- **Completed:** 2026-05-04T14:16:01Z (final SUMMARY commit timestamp)
- **Tasks:** 2/2 complete (both type="auto" tdd="true")
- **Files modified:** 4 (`src-tauri/src/brain.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri/admin.ts`, `src/features/admin/DoctorPane.tsx`)
- **Tests added:** 3 new Rust unit tests (all green); no new TS tests (CONTEXT.md defers DoctorPane runtime UAT to Plan 32-07)
- **LOC delta:** Task 1 = +155 (Rust); Task 2 = +176 / -9 = +167 net (TS); +322 total across the plan

## Accomplishments

### Task 1 — `get_context_breakdown` Tauri command + register in lib.rs (commit `5ffe812`)

- **`pub fn build_breakdown_snapshot(provider: &str, model: &str) -> ContextBreakdown` landed in brain.rs.** Pure (non-Tauri) breakdown computation: aggregates LAST_BREAKDOWN char counts per label via HashMap entry-or-insert (handles repeated record_section calls for the same label), saturating-adds total_chars (overflow-safe), divides chars/4 to get tokens (matches commands.rs estimate_tokens heuristic for cross-pipeline consistency), looks up model_context_window via `capability_probe::infer_capabilities(provider, model, None)` (third arg is the optional API-derived ctx_window — passed None per existing call sites), computes percent_used with the `if ctx_window == 0 { 0.0 } else { ((total/ctx as f32) * 100.0).min(100.0) }` pattern (NaN/inf-safe).
- **`#[tauri::command] pub async fn get_context_breakdown() -> Result<ContextBreakdown, String>` landed.** Three lines: load BladeConfig, call build_breakdown_snapshot, wrap in Ok. No AppHandle needed (build_breakdown_snapshot reads thread-local LAST_BREAKDOWN; no Tauri-managed state required) — `use tauri::Manager;` NOT needed.
- **Registered in lib.rs `generate_handler![]`** at line 685, immediately after the existing `brain::set_context` line, with an inline `// Phase 32 / CTX-06` comment for grep-discoverability. Verified uniqueness: `grep -rn "fn get_context_breakdown" src-tauri/src/` returns exactly 1 hit (no name collision — landmine #5 of RESEARCH.md cleared).
- **Three new unit tests appended to `brain::tests`:**
  - `phase32_get_context_breakdown_after_prompt_build` — calls `build_system_prompt_inner` to populate LAST_BREAKDOWN, then `build_breakdown_snapshot("anthropic", "claude-sonnet-4")`, asserts sections is non-empty, total_tokens > 0, model_context_window ≥ 100k, percent_used in [0, 100], percent_used.is_finite(), timestamp_ms > 0.
  - `phase32_get_context_breakdown_empty_when_no_prompt_built` — clears the accumulator first, then asserts sections.is_empty(), total_tokens == 0, percent_used == 0.0, model_context_window > 0 (capability_probe runs unconditionally).
  - `phase32_get_context_breakdown_percent_used_clamped` — manually populates the accumulator with `record_section("synthetic_overflow", 4_000_000)` (= 1M tokens, vastly overflowing anthropic's 200k window), asserts percent_used ≤ 100.0, percent_used.is_finite(), percent_used ≥ 99.0 (near saturation), total_tokens == 1_000_000.

### Task 2 — TS wrapper + ContextBudgetSection in DoctorPane (commit `fe2fb9d`)

- **`export type ContextBreakdown + export function getContextBreakdown(): Promise<ContextBreakdown>` landed in src/lib/tauri/admin.ts.** Wire shape mirrors the Rust struct verbatim (snake_case preserved per D-38 — `query_hash`, `model_context_window`, `total_tokens`, `sections`, `percent_used`, `timestamp_ms`). Wrapper uses the existing `invokeTyped<ContextBreakdown>('get_context_breakdown')` pattern — same shape as `doctorRunFullCheck` and the rest of admin.ts.
- **`ContextBudgetSection` component landed inside DoctorPane.tsx** (above `DoctorRow`, mounted as a Fragment sibling to the main and error-path returns). Subscribes to `BLADE_EVENTS.CHAT_DONE` via `useTauriEvent` — refreshes per chat turn, no polling. Renders monospace table sorted desc by token count with header showing `total / model_context_window / percent_used.toFixed(1)%`. Loading state: `'Loading…'`. Empty-accumulator state: `'No prompt built this session yet — send a chat message to populate'`. Error state: returns `null` (silent fail per CTX-07 spirit).
- **Mounted in BOTH return paths.** The main happy-path return AND the early error-path return now wrap their existing `<section>` in a Fragment + render `<ContextBudgetSection />` after. A Doctor-signals-load-failure does NOT hide the budget panel (orthogonal concerns).
- **CONTEXT.md lock honored.** No bespoke design system work — reuses `diagnostics-section` and `doctor-row-meta` classes; inline styles only for table layout (chat-first pivot defers UI design effort here, per the locked decision in 32-CONTEXT.md §Context Budget Dashboard).

## Insertion Point Chosen for ContextBudgetSection

**File:** `src/features/admin/DoctorPane.tsx`
**Component definition:** above `DoctorRow` (around line 95–215 region after the Edit). Component is local to DoctorPane.tsx (not a separate file — keeps the surface compact, matches DoctorRow's local definition).
**Mount sites:**
1. **Error-path return** (around line 220): wrapped `<section>` in `<>...<ContextBudgetSection /></>` Fragment. Doctor signals fail to load → budget panel still renders.
2. **Main happy-path return** (around line 235): wrapped the entire JSX in `<>...</>` Fragment, with `<ContextBudgetSection />` as the closing sibling after the main `</section>`.

Both placements are at the SAME DOM level as the existing diagnostics-section, so spacing/padding inherit consistently from the section CSS class. No bespoke styling needed.

## BLADE_EVENTS.CHAT_DONE — Used (Not Raw listen)

**Used:** `useTauriEvent<unknown>(BLADE_EVENTS.CHAT_DONE, () => { void refresh(); })`.

The plan's Step B presented two options:
- (Preferred) `useTauriEvent(BLADE_EVENTS.CHAT_DONE)` — chosen.
- (Fallback) raw `listen('chat_done', ...)` with manual cleanup — NOT used.

`BLADE_EVENTS.CHAT_DONE = 'chat_done'` is in `src/lib/events/index.ts:37`. The DoctorPane main panel already uses `useTauriEvent(BLADE_EVENTS.DOCTOR_EVENT, ...)`; the new ContextBudgetSection mirrors that exact pattern. This satisfies BLADE's D-13/D-38-hook ESLint rule (no raw `listen`) AND avoids the analysis-paralysis trap of dynamic-import shenanigans for `@tauri-apps/api/event`.

## Acceptance Grep Verification

```
$ grep -c "fn build_breakdown_snapshot" src-tauri/src/brain.rs                 → 1
$ grep -c "pub async fn get_context_breakdown" src-tauri/src/brain.rs           → 1
$ grep -c "#\[tauri::command\]" src-tauri/src/brain.rs                          → 6  (5 prior + 1 new)
$ grep -c "brain::get_context_breakdown" src-tauri/src/lib.rs                   → 1
$ grep -rn "fn get_context_breakdown" src-tauri/src/ | wc -l                    → 1  (no name collision)
$ grep -c "export async function getContextBreakdown\|export function getContextBreakdown" src/lib/tauri/admin.ts → 1
$ grep -c "export type ContextBreakdown" src/lib/tauri/admin.ts                 → 1
$ grep -c "function ContextBudgetSection" src/features/admin/DoctorPane.tsx     → 1
$ grep -c "<ContextBudgetSection />" src/features/admin/DoctorPane.tsx          → 2  (main + error-path mount)
$ grep -c "CHAT_DONE\|chat_done" src/features/admin/DoctorPane.tsx              → 3  (import + useTauriEvent + comment)
$ grep -c "ContextBreakdown" src/features/admin/DoctorPane.tsx                  → 4  (import + state type + state setter type + render guard)
$ grep -c "get_context_breakdown" src/features/admin/DoctorPane.tsx             → 0  (uses typed wrapper, not raw command name — see deviation #1 below)
```

All criteria met except the literal `get_context_breakdown` raw-string check inside DoctorPane.tsx, which is intentionally satisfied via the `getContextBreakdown` wrapper instead — see deviation #1.

## Test Results

```
$ cd src-tauri && cargo test --lib brain::tests::phase32_get_context_breakdown
running 3 tests
test brain::tests::phase32_get_context_breakdown_empty_when_no_prompt_built ... ok
test brain::tests::phase32_get_context_breakdown_percent_used_clamped ... ok
test brain::tests::phase32_get_context_breakdown_after_prompt_build ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 500 filtered out

$ cd src-tauri && cargo test --lib phase32
running 39 tests
... (all 39 phase32_* tests green — 36 prior + 3 new)
test result: ok. 39 passed; 0 failed; 0 ignored; 0 measured; 464 filtered out

$ cd src-tauri && cargo check
... 3 pre-existing warnings unchanged (ToolCallTrace.timestamp_ms, process_reports_for_test, enable_dormancy_stub)
warning: `blade` (lib) generated 3 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 11.28s

$ npx tsc --noEmit
(exit 0, no errors)
```

## Task Commits

Each task committed atomically with conventional-commit messaging (single-repo, no Co-Authored-By per CLAUDE.md):

1. **Task 1: get_context_breakdown Tauri command + register in generate_handler!** — `5ffe812` (feat)
2. **Task 2: ContextBudgetSection in DoctorPane + getContextBreakdown TS wrapper** — `fe2fb9d` (feat)

(STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction. This summary lands as the final docs commit.)

## Files Created/Modified

- `src-tauri/src/brain.rs` — new `pub fn build_breakdown_snapshot` (HashMap aggregation + chars/4 token conversion + capability_probe ctx_window lookup + clamped percent_used), new `#[tauri::command] pub async fn get_context_breakdown` (one-line shim), 3 unit tests appended to `brain::tests`. ~95 LOC.
- `src-tauri/src/lib.rs` — `brain::get_context_breakdown` line added to `generate_handler!` after existing `brain::*` group with `// Phase 32 / CTX-06` comment. +1 LOC.
- `src/lib/tauri/admin.ts` — new `export type ContextBreakdown` and `export function getContextBreakdown(): Promise<ContextBreakdown>` at end-of-file with its own ═══ section banner. ~50 LOC.
- `src/features/admin/DoctorPane.tsx` — new `ContextBudgetSection` component definition above `DoctorRow`, two new imports (`getContextBreakdown` + `ContextBreakdown` from `@/lib/tauri/admin`), Fragment-wrapped both return paths to mount `<ContextBudgetSection />` as a sibling. +135 LOC, -9 LOC = +126 net.

## Decisions Made

(Documented in `key-decisions:` frontmatter above. Headlines:)

- Pure-fn + Tauri-shim split: testable computation in `build_breakdown_snapshot`, trivial wrapper in `get_context_breakdown`.
- HashMap aggregate before chars→tokens conversion: preserves accuracy when record_section is called multiple times per label (e.g. character_bible may push twice).
- `percent_used` branch on `ctx_window == 0` + `.min(100.0)` clamp: NaN/inf-safe regardless of provider/model unknowns.
- `useTauriEvent(BLADE_EVENTS.CHAT_DONE)` chosen over raw `listen('chat_done')` per BLADE D-13 ESLint rule and existing DoctorPane convention.
- Fragment-wrap both returns (main + error path): orthogonal concerns — Doctor-signals-load-failure does NOT hide the budget panel.
- Empty-accumulator zero state: explicit user-facing `'No prompt built this session yet — send a chat message to populate'` line; never displays misleading 0-token table.
- TS wrapper at end of admin.ts under its own `═══ brain.rs — Context Budget Breakdown ═══` banner: matches the file's existing per-Rust-module organisation.

## Deviations from Plan

**Two deviations — both alignments with project conventions, no behavioral departures from plan intent:**

**1. [Rule 3 - Blocking convention conflict] Acceptance criterion `grep -c "get_context_breakdown" src/features/admin/DoctorPane.tsx ≥ 1` is satisfied indirectly via the typed wrapper, not a raw string match**

- **Found during:** Task 2 grep verification (post-edit).
- **Issue:** The plan's Task 2 acceptance criteria includes `grep -c "get_context_breakdown" /home/arnav/blade/src/features/admin/DoctorPane.tsx returns at least 1 (invoke call)`. BLADE's project-wide D-13 / D-186 ESLint rule `no-raw-tauri` forbids raw `invoke('command_name')` calls in feature files — every Tauri command must be accessed via its typed wrapper in `src/lib/tauri/<cluster>.ts`. Adding a raw `get_context_breakdown` string to DoctorPane.tsx would either lint-error or violate the project convention (CLAUDE.md takes precedence over the plan's grep verbatim per the executor's `<project_context>` directive).
- **Fix:** DoctorPane.tsx imports `getContextBreakdown` (the wrapper) from `@/lib/tauri/admin` and calls `await getContextBreakdown()`. The raw command-name string `'get_context_breakdown'` lives in `src/lib/tauri/admin.ts:invokeTyped('get_context_breakdown')`, which is the only permitted invoke-string surface. Existing DoctorPane code follows the same pattern (uses `doctorRunFullCheck`, never raw `'doctor_run_full_check'`).
- **Verification:** `grep -c "doctor_run_full_check" src/features/admin/DoctorPane.tsx` returns 0; `grep -c "doctorRunFullCheck" src/features/admin/DoctorPane.tsx` returns 2. The same pattern is now true for the new command: `grep -c "get_context_breakdown" DoctorPane.tsx` returns 0; `grep -c "getContextBreakdown" DoctorPane.tsx` returns 2 (import + invoke).
- **Net effect:** plan's intent satisfied (DoctorPane wired to the new Tauri command), project convention preserved, no ESLint regression.
- **Files modified:** None additional from the plan — the wrapper itself (admin.ts) IS one of the plan's `<files_modified>` entries.
- **Committed in:** `fe2fb9d` (Task 2 commit).

**2. [Observation — not a deviation] Empty-accumulator zero state added to ContextBudgetSection**

- **Found during:** Task 2 design (mental dry-run before write).
- **Issue:** Plan does not strictly require a zero-state UI. With Default-derived `ContextBreakdown` returning all-zeros when `LAST_BREAKDOWN` is empty (e.g. user opens Diagnostics tab before sending any chat message), rendering a literal 0-token table is misleading.
- **Fix:** Added a third render branch — if `breakdown.total_tokens === 0 || sections is empty`, render a meta line saying `'No prompt built this session yet — send a chat message to populate'`. This is in the spirit of CTX-07 ('never display misleading data; soft-fail to a user-comprehensible state') and matches BLADE's existing zero-state UI patterns.
- **Net effect:** small UX improvement, no behavioral departure from plan intent.
- **Committed in:** `fe2fb9d` (Task 2 commit).

**Total deviations:** 1 convention alignment (Rule 3 — wrapper pattern over raw invoke string per CLAUDE.md / D-13). 1 observation (zero-state UI). Both committed atomically with Task 2.

**Impact on plan:** Zero scope creep. Production behavior exactly as planned. Plan's atomic-commit-per-task contract preserved.

## Issues Encountered

- **Cargo recompile latency.** Single `cargo test --lib brain::tests::phase32_get_context_breakdown` invocation took ~12 minutes for the full test rebuild after the new fn additions. CLAUDE.md's "batch first, check at end" guidance honored — only one cargo test invocation per gate (Task 1 verification + Task 2 phase32 suite confirmation reused the warm build). `npx tsc --noEmit` was sub-30s.
- **No regressions.** All 36 prior phase32_* tests still green; 3 new tests all green (39 total). Cargo check exits 0 (3 pre-existing warnings unchanged from prior plans).
- **No file deletions** in either task commit. `git diff --diff-filter=D --name-only HEAD~2 HEAD` returns empty.

## User Setup Required

None — pure code additions. The new Tauri command is wired in `generate_handler!`; on next dev binary launch, `getContextBreakdown()` from the frontend will dispatch correctly. Existing user `~/.blade/config.json` files migrate transparently — `ContextConfig` was already populated by Plan 32-01's serde defaults; this plan reads `cfg.provider` and `cfg.model` (long-standing top-level fields).

## Deferred Items (for Plan 32-07 / Phase 33)

- **Toggle UI to flip `smart_injection_enabled` at runtime.** Plan output spec called this out as "recommended but not blocking; shipped in 32-07 if cheap". Plan 32-06 does NOT add this toggle. It is the natural next surface for Plan 32-07 (the fallback fixture phase) — flipping the config field, asserting the Doctor breakdown panel reflects the change (sections re-populate as the gates open). Scope-deferred per the plan's own output spec.
- **Phase-wide UAT of the breakdown panel.** Plan 32-07 owns the runtime UAT including: (a) `npm run tauri dev` cleanly starts, (b) screenshot DoctorPane breakdown panel at 1280×800 + 1100×700 to `docs/testing ss/`, (c) round-trip — send "what time is it?" → confirm breakdown shows < N tokens for heavy sections, (d) send a code query → confirm code section populated, (e) toggle `smart_injection_enabled = false` → confirm breakdown reflects naive path. Per CONTEXT.md §Testing & Verification, "runtime UAT deferred to Plan 32-07's end-of-phase UAT — the toggle / fallback round-trip is THE verification surface for this entire wave". Plan 32-06 ships only the wiring; the runtime evidence is Plan 32-07's burden.
- **Trend history (last N turns).** CONTEXT.md §Context Budget Dashboard called this out as Claude's discretion: "Whether to keep a small history (last 10 turns) for trend detection. Optional polish if it falls out cheap." It did not fall out cheap (would require a ring buffer in brain.rs + a separate read_section_breakdown_history helper) — deferred. Plan 33+ may add it.
- **Capped-output frequency row in DoctorPane.** Plan 32-05's deferred items list mentioned this; Plan 32-06 does not surface cap-frequency in the Doctor budget panel (the breakdown is per-section prompt cost, not per-turn tool-output cap stats). The `[CTX-05] tool ... output capped` log line is the current signal. Could be added in a future plan if the user needs it visible.

## Next Phase Readiness

**Plan 32-07 (fallback fixture + runtime UAT) — final phase 32 plan, no other plans wait on this:**

- Will exercise `config.context.smart_injection_enabled = false` and assert pre-Phase-32 byte-for-byte behavior + assert the DoctorPane breakdown reflects the toggle (sections shift from gated to all-on).
- Will force `score_context_relevance` to panic via `CTX_SCORE_OVERRIDE` and assert `build_system_prompt_inner` survives via `catch_unwind` — the v1.1 regression invariant.
- Will run the runtime UAT round-trip on the dev binary: send chat messages, screenshot DoctorPane breakdown panel, verify the budget table updates per chat_done event in the actual UI.
- Will close phase 32 with the verify gate fixture (regression test that ensures CTX-01..06's effects survive any selective-injection failure).

**No blockers.** STATE.md / ROADMAP.md updates are the orchestrator's responsibility per the executor prompt's `<sequential_execution>` instruction.

## Threat Flags

None — no new network, auth, file-access, or schema surface introduced. The threat register entries (`T-32-15` DoS via panic in get_context_breakdown, `T-32-16` info-disclosure via section labels in screenshots, `T-32-17` chat_done event re-render storm) are addressed by:

- T-32-15: `cap_tool_output` does not panic by construction (HashMap + saturating arithmetic + branched div); `infer_capabilities` returns a default `8_192` ctx_window for unknown providers/models (never panics, never returns 0 in normal paths). Frontend wraps in try/catch and renders null on error (CTX-07 spirit).
- T-32-16: Section labels (identity_supplement, character_bible, vision, etc.) are documented in brain.rs:267 — already in source. Not sensitive. Disposition: accept.
- T-32-17: `useTauriEvent` handler-in-ref pattern (P-06 prevention) ensures only ONE listener is registered per mount; React batches state updates from rapid event bursts. Disposition: accept (would only become a problem at >10/sec chat_done rate, which is non-physical for a chat UI).

## Self-Check: PASSED

Verified post-summary:

- File `src-tauri/src/brain.rs` exists and contains:
  - `pub fn build_breakdown_snapshot` (FOUND, count = 1)
  - `pub async fn get_context_breakdown` (FOUND, count = 1)
  - `phase32_get_context_breakdown_after_prompt_build` test fn (FOUND, count = 1)
  - `phase32_get_context_breakdown_empty_when_no_prompt_built` test fn (FOUND, count = 1)
  - `phase32_get_context_breakdown_percent_used_clamped` test fn (FOUND, count = 1)
- File `src-tauri/src/lib.rs` contains:
  - `brain::get_context_breakdown,` line in `generate_handler!` (FOUND, count = 1)
- File `src/lib/tauri/admin.ts` exists and contains:
  - `export type ContextBreakdown` (FOUND, count = 1)
  - `export function getContextBreakdown` (FOUND, count = 1)
  - `invokeTyped<ContextBreakdown>('get_context_breakdown')` (FOUND, count = 1)
- File `src/features/admin/DoctorPane.tsx` exists and contains:
  - `function ContextBudgetSection` (FOUND, count = 1)
  - `<ContextBudgetSection />` mount (FOUND, count = 2 — main + error-path)
  - `BLADE_EVENTS.CHAT_DONE` (FOUND, count = 1)
  - `getContextBreakdown` (FOUND, count = 2 — import + invoke)
- Commit `5ffe812` exists in `git log` (FOUND, "feat(32-06): add get_context_breakdown Tauri command + register in generate_handler! (CTX-06)")
- Commit `fe2fb9d` exists in `git log` (FOUND, "feat(32-06): add ContextBudgetSection in DoctorPane + getContextBreakdown TS wrapper (CTX-06)")
- All 39 phase32_* tests green (`cargo test --lib phase32` → 39 passed, 0 failed)
- `cargo check` exits 0 (3 pre-existing warnings unchanged)
- `npx tsc --noEmit` exits 0 (clean)
- No file deletions in either task commit (`git diff --diff-filter=D HEAD~2 HEAD` returns empty)
- STATE.md and ROADMAP.md NOT modified by this executor (orchestrator's responsibility)

---
*Phase: 32-context-management*
*Completed: 2026-05-04*
