# Phase 17: Doctor Module — Context

**Gathered:** 2026-04-30
**Status:** Ready for research + planning
**Source:** Direct decisions by orchestrator after user delegated ("best logical answer") on all 4 gray areas. No interactive Q&A round.

<domain>
## Phase Boundary

Phase 17 ships a **central diagnostic pane** in the existing `src/features/admin/Diagnostics.tsx` admin route that aggregates 5+ signal classes into a unified Doctor surface:

1. Eval-score history (consumes Phase 16 eval modules — DOCTOR-02)
2. Capability-gap log aggregation (consumes `evolution::evolution_log_capability_gap` — DOCTOR-03)
3. Tentacle health (alive/stale/failing per observer — DOCTOR-04)
4. Config drift (ledger consistency + scan-profile age — DOCTOR-05)
5. Auto-update presence (tauri-plugin-updater wired check — DOCTOR-10)

Plus the supporting infrastructure: 3 Tauri commands (`doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`), 1 Tauri event (`doctor_event` on regression), severity-tiered visual hierarchy (green/amber/red per signal class), per-signal drill-down drawer.

**Out of scope:** the Doctor pane is a CONSUMER of signals — not a producer. Phase 17 does NOT add new signal sources beyond what's already in BLADE; it only aggregates.

</domain>

<decisions>
## Implementation Decisions

### Signal aggregation strategy
- **D-01:** **Hybrid pull + push.** Each signal source exposes a "current state" Rust function the Doctor pulls when `doctor_run_full_check` is invoked OR when the Diagnostics tab opens. Sources can also independently emit `doctor_event` (Tauri event) when they detect a regression locally — Doctor's frontend subscribes for live updates.
- **D-02:** **Sources self-classify.** Each signal source returns a `DoctorSignal` struct: `{class: SignalClass, severity: Severity, payload: serde_json::Value, last_changed_at: i64, suggested_fix: String}`. Doctor aggregates the structs; severity classification logic lives at the source (not centralized in `doctor.rs`). Why: each signal has different domain semantics (eval scores vs tentacle uptime vs config drift); a single global threshold doesn't fit.
- **D-03:** **`SignalClass` enum:** `EvalScores | CapabilityGaps | TentacleHealth | ConfigDrift | AutoUpdate` (initial set; future signals add variants).
- **D-04:** **`Severity` enum:** `Green | Amber | Red` — exactly 3 tiers per DOCTOR-08 wording.

### Severity tier thresholds (concrete rules per signal class)
- **D-05:** **Eval scores (DOCTOR-02):**
  - **Red** if any module's last run breached the asserted floor (`top-3 < 80%` OR `MRR < 0.6`).
  - **Amber** if any module's score dropped ≥10% absolute from its prior recorded run.
  - **Green** otherwise.
- **D-06:** **Capability gaps (DOCTOR-03):**
  - **Red** if the same gap (same `capability` key) appears ≥3 times unresolved in the last 7 days.
  - **Amber** if ≥1 unresolved gap exists in the last 24h.
  - **Green** otherwise.
- **D-07:** **Tentacle health (DOCTOR-04):**
  - **Red** if any observer is dead (no heartbeat) ≥24h.
  - **Amber** if any observer is stale (heartbeat older than expected interval) ≥1h.
  - **Green** otherwise.
- **D-08:** **Config drift (DOCTOR-05):**
  - **Red** if both ledger mismatch AND scan-profile age >30 days.
  - **Amber** if either alone.
  - **Green** otherwise.
- **D-09:** **Auto-update presence (DOCTOR-10):**
  - **Green** if `tauri-plugin-updater` listed in Cargo.toml AND initialized via `tauri_plugin_updater::Builder::new().build()` in `lib.rs`.
  - **Amber** if either is missing.
  - **Out-of-the-box state:** Green. (`Cargo.toml:25` has the dep; `lib.rs:555` calls `.plugin(tauri_plugin_updater::Builder::new().build())`. Doctor reports green on a fresh install — but the check must run live, not be hardcoded green, to catch future regressions.)

### Doctor pane layout in Diagnostics
- **D-10:** **New "Doctor" sub-tab** added to the existing `src/features/admin/Diagnostics.tsx` route. Does NOT replace existing sub-views (ModelComparison, IntegrationStatus, McpSettings, KeyVault, SecurityDashboard, Reports, DecisionLog, Temporal). Adds a new lens.
- **D-11:** **List of collapsible rows** — one row per signal class, severity-color left-border stripe (green/amber/red token from BLADE's existing palette — see canonical_refs § ghost_css_tokens for the canonical token names). Click row → opens drill-down drawer (per D-15). NOT a card grid (cards force uniform width; signal classes have variable detail density).
- **D-12:** **Refresh affordances:** (a) auto-pull on tab mount; (b) manual "Re-run all checks" button at top of the pane (calls `doctor_run_full_check`); (c) live updates via `doctor_event` subscription (frontend listens via `listen("doctor_event", ...)` per BLADE's existing pattern in `App.tsx`).
- **D-13:** **Empty / all-green state:** sparse summary row "All signals green — last checked HH:MM:SS." No celebration UI. Diagnostics is a debugging surface, not a dashboard — restraint over decoration.

### Eval signal source for DOCTOR-02 (artifact format)
- **D-14:** **Append-only history file: `tests/evals/history.jsonl`.** Each line is one eval run record:
  ```json
  {"timestamp": "2026-04-30T12:34:56Z", "module": "hybrid_search_eval", "top1": 8, "top3": 8, "mrr": 1.000, "floor_passed": true, "asserted_count": 8, "relaxed_count": 4}
  ```
  - Phase 17 modifies `src-tauri/src/evals/harness.rs` to add `pub fn record_eval_run(module: &str, summary: &EvalSummary, floor_passed: bool)` that appends a JSON line.
  - Each of the 5 Phase 16 eval modules gets a one-line call to `harness::record_eval_run(...)` after `print_eval_table(...)`.
  - File location is tracked in git (the file itself is gitignored — only the directory is committed via `tests/evals/.gitkeep`).
  - Retention: file is append-only forever during normal use. Phase 17 does NOT add truncation logic (cheap to read 10000 lines; revisit only if perf becomes an issue).
- **D-15:** **Doctor reads the last N=200 lines** (cheap line-tail) on `doctor_run_full_check` to compute current state + 10%-drop detection.
- **D-16:** **Phase 16 backwards-compat:** The `harness::record_eval_run` call is added in Phase 17 Wave 0; existing eval modules still function exactly the same. The file simply doesn't exist yet on systems that haven't run an eval since Phase 17 ships — Doctor handles "file missing" as Green (no eval data yet, no regression possible).

### Drill-down UX (DOCTOR-09)
- **D-17:** **Right-side drawer.** Matches BLADE's existing drawer pattern (e.g., ActivityDrawer from v1.1). Drawer renders: signal class header + severity badge + raw payload (formatted JSON) + last-changed timestamp + suggested fix copy.
- **D-18:** **Suggested fix copy is handwritten** (one string per signal class × per severity = ~15 short strings total), NOT AI-generated. Stored as a `match (class, severity)` table in `doctor.rs`. This avoids per-render LLM cost and gives BLADE a deterministic "here's what to do next" experience.

### Tauri command surface (DOCTOR-01 — locked by REQ wording, captured here for downstream agents)
- **D-19:** Three commands, registered in `lib.rs::generate_handler!`:
  - `doctor_run_full_check() -> Vec<DoctorSignal>` — runs all signal sources synchronously, returns the aggregated list, caches the result.
  - `doctor_get_recent(class: Option<SignalClass>) -> Vec<DoctorSignal>` — returns last cached run; if `class` is `Some(_)`, filters to that class's history (last 50 records).
  - `doctor_get_signal(class: SignalClass) -> DoctorSignal` — returns the most recent record for a single class (used by drill-down drawer).

### `doctor_event` emission (DOCTOR-06)
- **D-20:** Emit `doctor_event` Tauri event with payload `{class, severity, prior_severity, last_changed_at, payload}` whenever a `doctor_run_full_check` run produces a class-level severity change versus the previous run AND the new severity is Amber or Red. Green→Green and Red→Red transitions do NOT emit (would be noise).
- **D-21:** **ActivityStrip emission (M-07 contract):** every `doctor_event` regression also emits an ActivityStrip entry per the v1.1 M-07 contract. Strip line format: `[Doctor] {class} → {severity}: {one-line summary}`.

### Claude's Discretion
- Drawer width / open/close animation timing (use BLADE's existing `motion-tokens` script targets for consistency)
- Exact Tailwind class names for severity stripes (use existing BLADE color tokens — see `ghost_css_tokens` memory)
- Doctor sub-tab icon (pick from existing icon set; no new asset)
- Order of signal class rows in the list (recommend: Eval Scores → Capability Gaps → Tentacle Health → Config Drift → Auto-Update — most-volatile-first)
- Precise wording of suggested-fix strings (write them; user can revise)
- Whether `doctor_run_full_check` runs all sources in parallel via `tokio::join!` (recommend: yes — sources are independent IO)

### Folded Todos
None — no relevant pending todos.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 17 authority
- `.planning/ROADMAP.md` § Phase 17 — Doctor Module (lines 86-100) — goal, REQs, success criteria, dependencies
- `.planning/REQUIREMENTS.md` § DOCTOR-01..10 (lines 26-37) — every REQ, traced; severity-tier wording at DOCTOR-08; drawer wording at DOCTOR-09; auto-update wording at DOCTOR-10
- `.planning/notes/v1-2-milestone-shape.md` — locked v1.2 input; clarifies that "Doctor consumes eval signals" was THE design intent

### Phase 16 outputs Doctor consumes
- `.planning/phases/16-eval-scaffolding-expansion/16-RESEARCH.md` § 4 — scored-table format (the same `┌──` rows feed `harness::record_eval_run`)
- `.planning/phases/16-eval-scaffolding-expansion/16-VERIFICATION.md` — confirms 5 modules @ MRR 1.000 baselines; these baselines become DOCTOR-02 floor reference points
- `src-tauri/src/evals/harness.rs` — Phase 17 Wave 0 modifies this to add `record_eval_run`; readback understanding of `EvalSummary` struct
- `src-tauri/src/evals/{hybrid_search_eval, real_embedding_eval, kg_integrity_eval, typed_memory_eval, capability_gap_eval}.rs` — each gets one new line calling `harness::record_eval_run`

### Existing signal sources (read to understand current API)
- `src-tauri/src/evolution.rs:1115` — `evolution_log_capability_gap` (DOCTOR-03 source); read 1000–1200 to understand the struct + storage shape
- `src-tauri/src/pulse.rs` — pulse module emits signals Doctor surfaces (DOCTOR-04 / DOCTOR-05 candidates); read first 200 lines for module API
- `src-tauri/src/temporal_intel.rs` — temporal-intel signals (relevant to DOCTOR-04 tentacle health); read first 200 lines
- `src-tauri/src/integration_bridge.rs` — persistent MCP polling (Gmail/Calendar/Slack/GitHub tentacles); DOCTOR-04 reads heartbeat freshness from this

### UI surface
- `src/features/admin/Diagnostics.tsx` — existing Diagnostics route (DOCTOR-07 host); Phase 17 adds a "Doctor" sub-tab here, does NOT replace
- `src/features/admin/IntegrationStatus.tsx` — closest analog for the "list of rows + drill-down drawer" pattern (read for component conventions)
- `src/App.tsx` — route registration pattern (Diagnostics is already routed; new sub-tab is an internal Diagnostics state, no new top-level route)
- `src/components/ActivityStrip.tsx` (or equivalent — locate via grep) — M-07 contract emission target for `doctor_event` regressions

### Project rules (apply throughout)
- `CLAUDE.md` — module registration 3-step (mod / generate_handler! / 6-place config); flat `#[tauri::command]` namespace (don't clash `doctor_*` with anything existing); `safe_slice` for non-ASCII; **Verification Protocol — Phase 17 has UI surface, runtime UAT MANDATORY**
- `.planning/PROJECT.md` — D-01..D-45 stack rules (no shadcn/Radix, no Framer Motion, no Zustand, no React Router); Tailwind v4 only
- `.planning/STATE.md` § v1.1 Locked Decisions — M-07 ActivityStrip contract; observe-only guardrail (still Phase 18's concern, not 17's)
- `.planning/phases/16-eval-scaffolding-expansion/16-PATTERNS.md` — verify-eval.sh exit-code convention (0/1/2/3); Doctor's "Run all checks" button can shell to it for the eval-source path if `record_eval_run` artifact is missing

### Auto-updater check live state
- `src-tauri/Cargo.toml:25` — `tauri-plugin-updater = "2"` already wired
- `src-tauri/src/lib.rs:555` — `.plugin(tauri_plugin_updater::Builder::new().build())` already initialized
- DOCTOR-10 reports **Green** out of the box — the implementation must run live, not hardcode

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src-tauri/src/evals/harness.rs`** — extend with `pub fn record_eval_run(module: &str, summary: &EvalSummary, floor_passed: bool)`. Existing exports (RR/MRR helpers, `EvalSummary` struct) inform the signal-source pattern.
- **`src/features/admin/Diagnostics.tsx`** — host for the Doctor sub-tab; existing tab-switching pattern is the analog
- **`src/features/admin/IntegrationStatus.tsx`** — closest analog for the list-with-drill-down pattern Doctor uses
- **`evolution_log_capability_gap` (`evolution.rs:1115`)** — directly readable for DOCTOR-03 aggregation
- **ActivityStrip subscriber** — wherever it lives in `src/`; `doctor_event` regressions emit through it per M-07
- **`tauri-plugin-updater` initialization** — already live in `lib.rs:555`; DOCTOR-10 just inspects, doesn't modify

### Established Patterns
- **Tauri command + event:** existing pattern is `#[tauri::command] pub async fn ... -> Result<T, String>` registered in `generate_handler!`; events emitted via `app.emit("event_name", payload)`. Doctor follows verbatim.
- **Module registration 3-step:** `mod doctor;` in lib.rs + 3 entries in `generate_handler!` + (NOT applicable here — Doctor doesn't add config fields, so the 6-place config rule doesn't fire)
- **Frontend event listening:** `listen("event_name", e => ...)` in useEffect with cleanup (`unlisten.then(fn => fn())`). Doctor's frontend subscribes to `doctor_event`.
- **Lazy-loaded admin routes:** existing Diagnostics already lazy-loads. Doctor sub-tab content lazy-loads via React `lazy()` per BLADE convention.

### Integration Points
- **`lib.rs::generate_handler!`** — register 3 new commands (`doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`)
- **`Diagnostics.tsx`** — add "Doctor" sub-tab + content view
- **`tests/evals/.gitkeep`** — ensure directory exists; the `history.jsonl` file is `.gitignore`d
- **ActivityStrip subscriber** — `doctor_event` consumer (M-07 contract)
- **`evals/harness.rs`** — Wave 0 modification adds `record_eval_run`
- **5 Phase 16 eval modules** — Wave 0 modification adds 1 line each calling `record_eval_run`
- **`scripts/verify-eval.sh`** — read but NOT modified (Doctor's eval source is the JSONL artifact, not this script's stdout)

</code_context>

<specifics>
## Specific Ideas

- **Severity-stripe rendering:** left border 4px solid {green-token | amber-token | red-token}. Use the canonical token names from BLADE's CSS contract (memory: `project_ghost_css_tokens` — do NOT invent ghost tokens; this was the v1.1 retraction trigger).
- **`doctor_event` payload schema:** `{class: string, severity: "green"|"amber"|"red", prior_severity: "green"|"amber"|"red", last_changed_at: number (unix ms), payload: object}`. Document in `event_logger.rs` per DOCTOR-06 wording.
- **Suggested fix copy examples** (15 strings to handwrite, one per (class × severity) pair; planner will draft, user can revise):
  - EvalScores × Red: "An eval module breached its asserted floor. Run `bash scripts/verify-eval.sh` to see which one. Likely cause: a recent change to the module's underlying API."
  - CapabilityGaps × Red: "The same capability has been requested 3+ times without resolution. Run `evolution_log_capability_gap` review or check the catalog at `self_upgrade.rs::capability_catalog`."
  - TentacleHealth × Amber: "An observer's heartbeat is stale. Check `integration_bridge.rs` logs for the affected service."
  - ConfigDrift × Amber: "Either the migration ledger is out of sync OR the scan profile is older than 30 days. Run `npm run verify:migration-ledger` to identify."
  - AutoUpdate × Amber: "tauri-plugin-updater is not wired. Add it to Cargo.toml AND initialize via `tauri_plugin_updater::Builder::new().build()` in lib.rs."
  - …Green-tier strings can be a single shared "All checks green for {class} as of {timestamp}."
- **Most-volatile-first row order:** Eval Scores (high churn — re-runs on every commit) → Capability Gaps (medium churn — gap log accumulates per session) → Tentacle Health (medium churn — heartbeat polled) → Config Drift (low churn — config rarely changes) → Auto-Update (lowest churn — wiring state flips once per release). Recommended; planner can adjust.

</specifics>

<deferred>
## Deferred Ideas

- **Doctor history visualization (sparkline / line chart per signal class)** — DOCTOR-02 surfaces score trend, but Phase 17 ships text + last-N-numbers, not graphs. Visualization → v1.3 polish if user requests.
- **Doctor scheduled auto-runs (cron)** — Phase 17 is on-demand + event-driven. Auto-running every N minutes via `cron.rs` is a v1.3 enhancement.
- **Cross-source correlation (e.g., "eval failure + capability gap = same root cause")** — out of scope; Phase 17 surfaces signals independently.
- **Notification surface (system-level toast on red transition)** — Phase 17 emits `doctor_event` + ActivityStrip line; system-tray notifications are v1.3+.
- **Eval-result truncation in `history.jsonl`** — file grows unbounded; revisit if performance becomes an issue. Cheap to defer.
- **Doctor data export (CSV / JSON dump)** — operator may want this for support tickets; v1.3 candidate.
- **Tentacle health auto-restart on dead detection** — purely diagnostic in Phase 17. Self-healing is a separate workstream.

</deferred>

---

*Phase: 17-doctor-module*
*Context gathered: 2026-04-30 — all 4 gray areas decided by orchestrator after user delegated ("best logical answer"). DISCUSSION-LOG.md skipped (no Q&A turns to record). Downstream agents: read this CONTEXT.md + the canonical refs before research/planning.*
