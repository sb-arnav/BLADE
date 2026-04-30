# Phase 17: Doctor Module — Research

**Researched:** 2026-04-30
**Domain:** BLADE diagnostic surface — Rust `doctor.rs` + React Doctor sub-tab inside existing Diagnostics route
**Confidence:** HIGH (grep-verified live against the BLADE repo; CONTEXT.md + UI-SPEC already settled the design)

---

<user_constraints>
## User Constraints (from 17-CONTEXT.md)

### Locked Decisions
All architectural decisions D-01..D-21 in CONTEXT.md are LOCKED. The planner MUST honor them verbatim. The plan-checker rejects any plan that proposes alternatives.

- **D-01** Hybrid pull + push aggregation strategy
- **D-02** Sources self-classify; each returns `DoctorSignal { class, severity, payload, last_changed_at, suggested_fix }`
- **D-03** `SignalClass` enum: `EvalScores | CapabilityGaps | TentacleHealth | ConfigDrift | AutoUpdate`
- **D-04** `Severity` enum: `Green | Amber | Red` (exactly 3 tiers)
- **D-05** Eval scores severity rules (Red breach floor / Amber 10% drop / Green otherwise)
- **D-06** Capability gaps severity (Red ≥3 same gap in 7d / Amber ≥1 in 24h / Green)
- **D-07** Tentacle health severity (Red ≥24h dead / Amber ≥1h stale / Green)
- **D-08** Config drift severity (Red both / Amber either / Green)
- **D-09** Auto-update severity (Green if dep + init wired / Amber if either missing; out-of-box state Green; check must run live)
- **D-10** New "Doctor" sub-tab inside Diagnostics.tsx (does not replace existing tabs)
- **D-11** List of collapsible rows, severity-color left-border stripe, NOT a card grid
- **D-12** Refresh = auto-pull on mount + manual button + live `doctor_event` subscription
- **D-13** All-green state: sparse summary "All signals green — last checked HH:MM:SS"; restraint over decoration
- **D-14** History artifact: `tests/evals/history.jsonl` (append-only JSONL); add `pub fn record_eval_run(module: &str, summary: &EvalSummary, floor_passed: bool)` to `harness.rs`; each Phase 16 eval module gets ONE LINE call
- **D-15** Doctor reads last N=200 lines of history.jsonl on `doctor_run_full_check`
- **D-16** Backwards-compat: file may not exist on fresh install — Doctor handles "missing" as Green
- **D-17** Drill-down via centered `<dialog>` modal (UI-SPEC § 6 confirmed Dialog.tsx primitive — NOT a side-sheet)
- **D-18** Suggested-fix copy is HANDWRITTEN (UI-SPEC § 15 has the 15 strings verbatim); stored as `match (class, severity)` table in `doctor.rs`
- **D-19** Three Tauri commands: `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`
- **D-20** `doctor_event` payload: `{class, severity, prior_severity, last_changed_at, payload}`; emit only on transitions where new severity is Amber or Red
- **D-21** Every `doctor_event` regression also emits an ActivityStrip entry per M-07 contract — line format: `[Doctor] {class} → {severity}: {one-line summary}`

### Claude's Discretion (CONTEXT.md "Claude's Discretion")
- Drawer width / motion (UI-SPEC § 6.2 + § 11 already locked these — 640–720px width, no slide-in animation, severity stripe crossfade `var(--dur-base)` 200ms)
- Tailwind class names for severity stripes (UI-SPEC § 5.3 already locked: `border-left: 4px solid var(--status-success | --a-warm | --status-error | --status-idle | --t-4)`)
- Doctor sub-tab icon (UI-SPEC declined to add an icon; tab is text-only "Doctor" pill — matches surrounding tabs which are also text-only)
- Order of signal class rows: most-volatile-first — EvalScores → CapabilityGaps → TentacleHealth → ConfigDrift → AutoUpdate (CONTEXT.md "Specifics" recommendation — UI-SPEC § 7.5 locks this as fixed order, not severity-sorted)
- Suggested-fix string wording: UI-SPEC § 15 wrote them; planner uses verbatim
- Whether `doctor_run_full_check` runs sources in parallel: recommendation YES via `tokio::join!` (sources are independent IO — file read + DB read + supervisor lock + Cargo.toml grep + path stat). Confirmed below in code research.

### Deferred Ideas (OUT OF SCOPE)
- Doctor history sparkline / line chart visualization
- Doctor scheduled auto-runs (cron)
- Cross-source correlation
- System-tray notification on red transition
- Eval-result truncation in `history.jsonl`
- Doctor data export (CSV / JSON dump)
- Tentacle health auto-restart on dead detection
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DOCTOR-01 | `doctor.rs` module with 3 Tauri commands | § A1 (module registration), § A2 (lib.rs `generate_handler!` insertion site verified — line 596+, no doctor_* clash) |
| DOCTOR-02 | Eval-score-history signal source | § B1 (history.jsonl format + harness modification surface), § B2 (5 eval modules each have a `print_eval_table()` call site for inserting `record_eval_run`) |
| DOCTOR-03 | Capability-gap log aggregation | § C1 (`evolution_log_capability_gap` writes to `activity_timeline` SQLite table with `event_type='capability_gap'`; `metadata` is JSON `{capability}`; `timestamp` is unix seconds) |
| DOCTOR-04 | Tentacle health signal source | § D1 (`supervisor_get_health() -> Vec<ServiceHealth>` is the canonical entry; integrates with `last_heartbeat` field; integration_bridge `last_poll` is a SECONDARY surface for MCP-tentacle staleness) |
| DOCTOR-05 | Config drift signal source | § E1 (migration ledger script at `scripts/verify-migration-ledger.mjs`, exit code 0=clean / 1=drift; scan profile timestamp at `~/.blade/identity/scan_results.json` `scanned_at` field, milliseconds) |
| DOCTOR-06 | `doctor_event` Tauri event on regression | § F1 (BLADE_EVENTS frozen registry must add `DOCTOR_EVENT: 'doctor_event'`; emission is `app.emit("doctor_event", payload)` — single-window so NOT in cross-window allowlist) |
| DOCTOR-07 | Diagnostics admin tab Doctor pane | § G1 (Diagnostics.tsx tab tuple at lines 144-152 is a static const array; add 7th entry; `DiagTab` literal type at line 46 needs extension; `readInitialTab` switch at lines 51-65 needs extension; `prefs['admin.activeTab']` keyed `diag:` already supports any string suffix) |
| DOCTOR-08 | Severity-tiered visual hierarchy | § H1 (UI-SPEC § 5.3 + § 8 already grep-verified canonical tokens `--status-success / --a-warm / --status-error`; `verify:contrast` script will gate at PR time) |
| DOCTOR-09 | Per-signal drill-down | § H2 (Dialog primitive at `src/design-system/primitives/Dialog.tsx` already provides `triggerRef` focus restoration — Phase 17 reuses verbatim) |
| DOCTOR-10 | Auto-update presence check | § I1 (Cargo.toml line 25 `tauri-plugin-updater = "2"` confirmed; lib.rs line 555 `.plugin(tauri_plugin_updater::Builder::new().build())` confirmed; D-09 says "must run live" — implementation reads Cargo.toml + lib.rs at filesystem level OR introspects loaded plugins at runtime) |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Aggregate signals + classify severity | API/Backend (Rust `doctor.rs`) | — | Per D-02, sources self-classify; doctor.rs is the aggregator + cache holder |
| Persist last-known severity per class for change detection | API/Backend (in-memory `OnceLock<Mutex<HashMap>>`) | — | No DB schema change — process-lifetime state suffices for the regression-detection use case (D-20 only needs prior-vs-current within a session) |
| Emit `doctor_event` Tauri event | API/Backend (Rust → frontend) | Frontend `useTauriEvent` subscriber | Standard Tauri push pattern (D-12c) |
| Emit `blade_activity_log` for regressions | API/Backend (Rust `app.emit_to("main", ...)`) | Frontend ActivityLogProvider context | M-07 contract (D-21) — same emission API used by `ecosystem.rs:emit_activity_with_id` |
| Read eval history JSONL | API/Backend | — | File at workspace `tests/evals/history.jsonl` — relative to repo root; resolved via std::env::current_dir + relative path or `env!("CARGO_MANIFEST_DIR")` parent |
| Read capability gaps | API/Backend | — | SQLite `activity_timeline` table at `blade_config_dir().join("blade.db")` — same path used by `evolution.rs::evolution_log_capability_gap` |
| Read tentacle health | API/Backend | — | `supervisor::supervisor_get_health()` is a pure-memory read of `HEALTH_MAP` — no IO |
| Read config drift | API/Backend | — | Two probes: `scripts/verify-migration-ledger.mjs` (shell out — but expensive; alternative: re-implement the same parse in Rust) + `scan_results.json` mtime / `scanned_at` field |
| Read auto-updater wiring | API/Backend | — | Best approach: reflect on whether the `tauri-plugin-updater` plugin is loaded — `app.config()` exposes plugin list. Fallback: filesystem grep of `Cargo.toml` + `lib.rs`. UI-SPEC lock is "must run live"; ground truth is whatever proves the plugin is initialized at runtime, not a hardcoded constant |
| Render Doctor pane UI | Frontend | — | New `DoctorPane.tsx` component lazy-loaded by `Diagnostics.tsx`; mounts inside `.diagnostics-section` |
| Render drill-down drawer | Frontend | — | Reuses `Dialog` primitive verbatim — UI-SPEC § 6 |
| Persist active tab | Frontend (localStorage via `usePrefs`) | — | Already wired — `prefs['admin.activeTab']` with `diag:` prefix supports any tab name |

---

## Standard Stack

### Core (in-repo, no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tauri 2 | 2.x [VERIFIED: src-tauri/Cargo.toml:16] | Command + event surface | Only IPC framework BLADE uses |
| serde / serde_json | already in tree [VERIFIED: lib.rs imports] | `DoctorSignal` derive(Serialize) + JSONL write | Standard Rust serialization |
| tokio | already in tree | `tokio::join!` parallel signal-source fetch | Already used throughout BLADE for async |
| rusqlite | already in tree | Read `activity_timeline` for capability gap aggregation | Same crate `evolution_log_capability_gap` already uses |
| chrono | already in tree | Timestamp arithmetic (24h / 7d / 30d windows) | Standard across BLADE |
| `tauri-plugin-updater` | "2" [VERIFIED: Cargo.toml:25] | DOCTOR-10 inspection target — Phase 17 does NOT modify, only reads its presence | Already wired |
| React | 19 (existing) | DoctorPane component | UI-SPEC compositional |
| `@/design-system/primitives` | in-tree | `Button`, `Dialog`, `EmptyState`, `ListSkeleton`, `GlassPanel`, `Pill`, `Badge` | UI-SPEC § 3 verified all 7 primitives are exported |

### Supporting (in-repo)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `BLADE_EVENTS` registry [VERIFIED: src/lib/events/index.ts] | in-tree | Type-safe event subscription | Phase 17 MUST add `DOCTOR_EVENT: 'doctor_event'` to this enum (D-38-evt) |
| `useTauriEvent` hook [VERIFIED: src/lib/events/index.ts] | in-tree | The ONLY permitted listen() surface (D-13) | DoctorPane subscribes to `doctor_event` via this hook |
| `invokeTyped` helper [VERIFIED: src/lib/tauri/_base.ts] | in-tree | Type-safe Tauri command invocation | Phase 17 adds 3 wrappers to `src/lib/tauri/admin.ts` |
| `usePrefs` hook [VERIFIED: src/hooks/usePrefs] | in-tree | Tab persistence | Already wired through Diagnostics.tsx |

### Alternatives Considered
| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| In-memory severity cache | SQLite-backed history table | Persists across restarts | NO — D-20 only needs prior-vs-current in current session; process-lifetime state is correct |
| `tokio::join!` parallel fetch | Sequential awaits | Simpler | NO — UI mount blocks on this command; sources are IO-bound and independent; parallel is the right call |
| Drawer = right-side sheet | Centered `<dialog>` | "Drawer" wording in CONTEXT.md | UI-SPEC § 6.1 RESOLVED — BLADE has no side-sheet primitive; ActivityDrawer renders centered. CONTEXT.md "drawer" wording is loose; UI-SPEC locks centered modal. Planner uses centered modal. |

**Installation:** None required. All dependencies already in tree.

**Version verification:** No new dependencies — verification is grep-based, performed inline above. [VERIFIED: Cargo.toml + package.json + tree inspection on 2026-04-30]

---

## Architecture Patterns

### System Architecture Diagram

```
                  ┌──────────────────────────────────────────┐
                  │  Diagnostics.tsx (admin route, 7 tabs)   │
                  │  ┌──────────────────────────────────────┐│
                  │  │ NEW: Doctor sub-tab (DoctorPane.tsx) ││
                  │  └──────────────────────────────────────┘│
                  └─────────────┬────────────────────────────┘
                                │
                  ┌─────────────┴─────────────┐
                  │ frontend events           │
                  ▼                           ▼
       (auto-pull on mount)         (live push subscription)
       invoke('doctor_run_full_check')   useTauriEvent('doctor_event')
                  │                           │
                  └────────────┬──────────────┘
                               ▼
                  ┌──────────────────────────────────────────┐
                  │  doctor.rs                               │
                  │  3 commands + 1 event emitter            │
                  │  ─────────────────────────────────       │
                  │  state: PRIOR_SEVERITY: HashMap<Class,Sv>│
                  │         LAST_SIGNALS:   Vec<DoctorSignal>│
                  │  on full_check:                          │
                  │    tokio::join!(                         │
                  │      eval_signal(),                      │
                  │      capgap_signal(),                    │
                  │      tentacle_signal(),                  │
                  │      drift_signal(),                     │
                  │      autoupdate_signal(),                │
                  │    )                                     │
                  │  ↓                                       │
                  │  for each signal:                        │
                  │    if severity changed AND new ∈ {A,R}:  │
                  │      app.emit("doctor_event", payload)   │
                  │      app.emit_to("main",                 │
                  │        "blade_activity_log", payload)    │
                  └──┬───────┬─────────┬────────┬─────────┬──┘
                     │       │         │        │         │
                     ▼       ▼         ▼        ▼         ▼
               ┌────────┐┌────────┐┌─────────┐┌──────┐┌─────────┐
               │tests/  ││SQLite: ││supervisor││scan  ││Cargo.toml│
               │evals/  ││activity││::supervi-││_resul││+ lib.rs  │
               │history.││_timelin││sor_get_h-││ts.   ││(parse to │
               │jsonl   ││e WHERE ││ealth()   ││json  ││confirm   │
               │last 200││event=  ││Vec<Servi-││+     ││updater   │
               │lines   ││capabil-││ceHealth> ││ledger││plugin    │
               │        ││ity_gap ││          ││(node ││initialized│
               │        ││        ││          ││shellout│           │
               │        ││        ││          ││OR Rust││          │
               │        ││        ││          ││re-impl)││          │
               └────────┘└────────┘└─────────┘└──────┘└─────────┘
                  │
              (also: integration_bridge.rs::get_integration_state()
               last_poll for MCP tentacle staleness — secondary surface)
```

### Recommended Project Structure

```
src-tauri/src/
├── doctor.rs                 # NEW — module + 3 Tauri commands + event emitter
├── evals/
│   └── harness.rs            # MODIFY — add `pub fn record_eval_run`
├── evals/{hybrid_search,real_embedding,kg_integrity,typed_memory,capability_gap}_eval.rs
│                             # MODIFY (5 files) — add 1 line each: harness::record_eval_run(...)
├── lib.rs                    # MODIFY — add `mod doctor;` + 3 entries in `generate_handler!`
└── (no other Rust changes)

src/
├── features/admin/
│   ├── Diagnostics.tsx       # MODIFY — extend tab tuple + DiagTab type + readInitialTab
│   ├── DoctorPane.tsx        # NEW — lazy-loaded; renders rows + drawer
│   ├── DoctorPane.css        # OR — extend admin-rich-c.css (UI-SPEC § 16 lock)
│   └── admin-rich-c.css      # NEW — partial CSS file per admin.css extension rule
├── lib/tauri/admin.ts        # MODIFY — add `doctorRunFullCheck`, `doctorGetRecent`, `doctorGetSignal` wrappers
└── lib/events/index.ts       # MODIFY — add `DOCTOR_EVENT: 'doctor_event'` to BLADE_EVENTS

tests/evals/
└── .gitkeep                  # NEW — keeps directory tracked; history.jsonl itself stays gitignored

(no changes to package.json verify:* chain — Phase 17 does NOT add a new verify-doctor.sh; § J)
```

---

### A. Module Registration Pattern (Rust)

#### A1. Mandatory 3-step registration (CLAUDE.md)
1. `mod doctor;` added to `src-tauri/src/lib.rs` flat `mod` block at top (current top-of-file declarations span lines 1–~110)
2. Three entries added to `tauri::generate_handler![]` (lib.rs:596+):
   ```rust
   doctor::doctor_run_full_check,
   doctor::doctor_get_recent,
   doctor::doctor_get_signal,
   ```
3. The 6-place config rule does NOT apply (Doctor adds zero config fields)

#### A2. `generate_handler!` insertion site
[VERIFIED 2026-04-30] Insertion site:
- Line 596: `.invoke_handler(tauri::generate_handler![`
- Block ends ~line 1340+ (823 entries based on grep)
- Convention: group by module — Phase 17 entries should land near other diagnostic/admin commands (e.g. after `supervisor::supervisor_get_health` and `supervisor::supervisor_get_service` at lines 1340-1341, OR in a new dedicated comment block)

#### A3. Flat `#[tauri::command]` namespace check
[VERIFIED 2026-04-30 — `grep -rn "doctor_" src-tauri/src/`] Zero existing `doctor_*` symbols. The only `doctor` reference in the entire Rust source tree is the user-knowledge "doctor" string mention in literal text. No clash risk for `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`, or any private helpers in `doctor.rs`.

---

### B. Eval History Pattern (DOCTOR-02)

#### B1. `EvalSummary` struct (current shape)
[VERIFIED: src-tauri/src/evals/harness.rs:54-64]
```rust
#[derive(Debug, Clone, Copy)]
pub struct EvalSummary {
    pub total: usize,
    pub top1_count: usize,
    pub top3_count: usize,
    pub mrr: f32,
    pub asserted_total: usize,
    pub asserted_top1_count: usize,
    pub asserted_top3_count: usize,
    pub asserted_mrr: f32,
}
```

The struct is `#[derive(Debug, Clone, Copy)]`. Phase 17 should NOT add `Serialize` to `EvalSummary` (would force a derive change). Instead, `record_eval_run` should construct a serde_json::Value inline.

#### B2. `record_eval_run` function (NEW — Phase 17 Wave 0 surface)
Add to `harness.rs` after `print_eval_table`:

```rust
/// Append a single JSONL line to `tests/evals/history.jsonl` recording one eval run.
///
/// Phase 17 / DOCTOR-02 source. The file is git-ignored (only `.gitkeep` is committed).
/// On a fresh install the file may not exist; doctor.rs treats "missing" as Green (D-16).
///
/// Path resolution: relative to repo root (`tests/evals/history.jsonl`).
/// In test/eval mode, `CARGO_MANIFEST_DIR` is `src-tauri/`; the file lives one
/// level up. Use `Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("tests/evals/history.jsonl")`.
pub fn record_eval_run(module: &str, summary: &EvalSummary, floor_passed: bool) {
    use std::io::Write;
    let line = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "module": module,
        "top1": summary.asserted_top1_count,
        "top3": summary.asserted_top3_count,
        "mrr": summary.asserted_mrr,
        "floor_passed": floor_passed,
        "asserted_count": summary.asserted_total,
        "relaxed_count": summary.total - summary.asserted_total,
    });

    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .join("tests").join("evals").join("history.jsonl");

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", line);
    }
}
```

[ASSUMED] The `floor_passed: bool` value is computed by the caller — each eval module already does the assertion (see B3); the caller passes `true` if all asserts would pass; `false` if any fail. In practice the assert-style code panics before `record_eval_run` would be reached on failure. Planner should decide: (a) record_eval_run BEFORE the asserts (fires on every run including pre-fail) + pass `floor_passed = (top3 >= 0.8 && mrr >= 0.6)`, OR (b) record AFTER asserts (only fires on success). Recommendation: **option (a)** — Doctor needs to see failures, not just successes. Planner: confirm with user during plan stage.

#### B3. Per-eval-module insertion sites
[VERIFIED 2026-04-30] — exact lines `print_eval_table(...)` is called in each module:
- `hybrid_search_eval.rs:315` — `print_eval_table("Hybrid search regression eval (synthetic 4-dim)", &rows);`
- `real_embedding_eval.rs:222` — `print_eval_table("Memory recall eval (real fastembed AllMiniLML6V2)", &rows);`
- `kg_integrity_eval.rs:259` — `print_eval_table("Knowledge graph integrity eval", &rows);`
- `typed_memory_eval.rs:191` — `print_eval_table("Typed memory category recall eval", &rows);`
- `capability_gap_eval.rs:190` — `print_eval_table("Capability gap detection eval", &rows);`

Per-module insertion (one line after `print_eval_table` and before the `assert!` block):
```rust
let s = summarize(&rows);
let floor_passed = (s.asserted_top3_count as f32 / s.asserted_total as f32) >= 0.80
    && s.asserted_mrr >= 0.6;
super::harness::record_eval_run("hybrid_search_eval", &s, floor_passed);
// ... existing asserts continue ...
```

NOTE: 3 of the 5 modules already compute `let s = summarize(&rows);` for the assert block. Phase 17 reuses `s` and passes the module name as a stable string (matches the file name minus `_eval`).

#### B4. Reading the JSONL in `doctor.rs`
[VERIFIED] D-15 says read last 200 lines. Implementation:
```rust
fn read_eval_history(limit: usize) -> Vec<EvalRunRecord> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .join("tests").join("evals").join("history.jsonl");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();  // Missing file → Green per D-16
    };
    content.lines()
        .rev().take(limit).rev()  // last N
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}
```

For 200 lines × ~120 bytes = 24KB — trivial cost. No need for a tail-seek optimization in v1.

---

### C. Capability Gap Aggregation Pattern (DOCTOR-03)

#### C1. Storage shape
[VERIFIED: src-tauri/src/evolution.rs:1115-1134]
`evolution_log_capability_gap(capability, user_request)` writes to `activity_timeline` SQLite table via `db::timeline_record`.

[VERIFIED: src-tauri/src/db.rs:390-401] `activity_timeline` schema:
```sql
CREATE TABLE IF NOT EXISTS activity_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,        -- unix seconds (chrono::Utc::now().timestamp())
    event_type TEXT NOT NULL,           -- "capability_gap" for this category
    title TEXT NOT NULL DEFAULT '',     -- "Blocked on: <truncated capability name>"
    content TEXT NOT NULL DEFAULT '',   -- the user_request string
    app_name TEXT NOT NULL DEFAULT '',  -- "BLADE"
    metadata TEXT NOT NULL DEFAULT '{}' -- JSON: {"capability": "<full capability name>"}
);
CREATE INDEX IF NOT EXISTS idx_activity_timeline_ts ON activity_timeline(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_timeline_type ON activity_timeline(event_type);
```

#### C2. DOCTOR-03 query
The `capability` is in the JSON `metadata` column under key `"capability"`. SQLite can extract via `json_extract`.

```rust
fn read_capability_gaps_aggregated() -> Vec<(String, i64, i64)> {
    // Returns Vec<(capability, count_in_last_7d, last_seen_timestamp_secs)>
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let Ok(conn) = rusqlite::Connection::open(&db_path) else { return Vec::new(); };
    let cutoff_7d = chrono::Utc::now().timestamp() - (7 * 86_400);
    let mut stmt = match conn.prepare(
        "SELECT json_extract(metadata, '$.capability') AS cap,
                COUNT(*) AS cnt,
                MAX(timestamp) AS last
         FROM activity_timeline
         WHERE event_type = 'capability_gap' AND timestamp >= ?1
         GROUP BY cap
         ORDER BY cnt DESC"
    ) { Ok(s) => s, Err(_) => return Vec::new() };
    // ... query_map + collect — standard rusqlite pattern
}
```

#### C3. Severity computation (D-06)
- For each capability: `count_24h = COUNT(*) WHERE timestamp >= now - 86400`
- Red iff `EXISTS row WHERE count_7d >= 3 AND no resolved marker`
- Amber iff `EXISTS row WHERE count_24h >= 1`
- Green otherwise

[ASSUMED] There is no "resolved" marker schema in `activity_timeline`. The `capability_reports` table (db.rs:579) has a `status` column with values `open / investigating / resolved / wont_fix`, but `evolution_log_capability_gap` writes ONLY to `activity_timeline`, not to `capability_reports`. Planner: treat all capability_gap rows in activity_timeline as "unresolved" until a resolution mechanism exists. CONTEXT.md D-06 says "appears ≥3 times unresolved" — operational interpretation: count occurrences (no resolved-state filter applies).

---

### D. Tentacle Health Pattern (DOCTOR-04)

#### D1. Canonical entry: `supervisor::supervisor_get_health()`
[VERIFIED: src-tauri/src/supervisor.rs:32-41 + 225-230]

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub name: String,
    pub status: String,       // "running" | "restarting" | "dead" | "unknown"
    pub crash_count: u32,
    pub last_crash: Option<i64>,
    pub last_heartbeat: i64,  // unix seconds
    pub uptime_secs: i64,
    pub started_at: i64,
}

#[tauri::command]
pub fn supervisor_get_health() -> Vec<ServiceHealth>
```

This is a pure-memory read of `HEALTH_MAP: OnceLock<Mutex<HashMap<String, ServiceHealth>>>` — no IO, fast.

#### D2. Registered services (verified consumers)
[VERIFIED via `grep -rn "register_service\|supervisor::heartbeat"`]
- `perception_fusion.rs:77` — heartbeats `"perception"`
- `screen_timeline.rs:346` — heartbeats `"screen_timeline"`
- `godmode.rs:193` — heartbeats `"godmode"`
- `learning_engine.rs:1011` — heartbeats `"learning_engine"`
- `homeostasis.rs:419` — heartbeats `"homeostasis"`
- `hive.rs:2954` — heartbeats `"hive"`

These are the "tentacles" the supervisor knows about. Doctor reads them via `supervisor_get_health()`.

#### D3. Secondary tentacle surface: integration_bridge MCP polls
[VERIFIED: src-tauri/src/integration_bridge.rs:18-31, 384-386]
Each integration (gmail/calendar/slack/github) has a `last_poll: i64` (unix seconds) field in `IntegrationConfig`. `get_integration_state()` returns the aggregated state (with `last_updated` field) but NOT the per-service `last_poll` — the per-service config is private (only exposed via `get_configs()` internally).

For DOCTOR-04 to surface MCP tentacle staleness, `doctor.rs` needs read access to per-service `last_poll`. Two options:
1. **Add a public accessor** to `integration_bridge.rs`: `pub fn get_per_service_last_poll() -> Vec<(String, i64, bool /* enabled */)>`
2. **Use only `supervisor_get_health()`** and skip MCP-tentacle staleness in v1; document MCP tentacle coverage as v1.3 polish

[ASSUMED] Recommendation: **Option 1** — add a 6-line public accessor in `integration_bridge.rs`. The accessor is observe-only, returns a clone, and matches the existing `get_integration_state()` shape.

#### D4. Severity classification (D-07)
For each entry in `supervisor_get_health()` + each MCP service:
- Red iff `now - last_heartbeat >= 86_400` (≥24h dead) OR `status == "dead"`
- Amber iff `now - last_heartbeat >= 3_600` (≥1h stale) OR `status == "restarting"` OR `status == "unknown"`
- Green otherwise

[ASSUMED] "Expected interval" mentioned in D-07 isn't service-specific in the existing supervisor — every service uses the same 5-min staleness threshold (`supervisor.rs:209`). Phase 17 uses the simple 1h / 24h thresholds from D-07 directly.

---

### E. Config Drift Pattern (DOCTOR-05)

#### E1. Migration ledger consistency
[VERIFIED: scripts/verify-migration-ledger.mjs lines 1-80]

The script parses `.planning/migration-ledger.md` (markdown table) + greps `src/` for `openRoute('id')` and `routeId === 'id'` references; fails with non-zero exit if any src/ reference targets a route with no ledger row (or status `Deferred`).

**Implementation choices for `doctor.rs` to detect drift:**
1. **Shell out** — `std::process::Command::new("node").arg("scripts/verify-migration-ledger.mjs")` — exit code 0=clean / 1=drift. SIMPLE but slow (~500ms node startup + IO).
2. **Re-implement in Rust** — parse the same markdown ledger + walk src/ for references. CORRECT but doubles maintenance burden.

[ASSUMED] Recommendation: **Option 1** (shell out). Doctor runs on-demand, latency is acceptable, and it keeps the source of truth in one place. If Node is missing, treat as Amber + show "could not verify ledger" in the suggested-fix copy.

#### E2. Scan profile age
[VERIFIED: src-tauri/src/deep_scan/mod.rs:51-53, 376] — `scan_results_path()` returns `blade_config_dir().join("identity").join("scan_results.json")`. The `scanned_at` field is `i64` milliseconds (chrono::Utc::now().timestamp_millis()).

```rust
fn scan_profile_age_days() -> Option<i64> {
    let results = crate::deep_scan::load_results_pub()?;  // VERIFIED: pub fn at line 72
    let now_ms = chrono::Utc::now().timestamp_millis();
    let age_ms = now_ms - results.scanned_at;
    Some(age_ms / (86_400 * 1000))  // days
}
```

#### E3. Severity classification (D-08)
- ledger_drift: bool (exit code 1 from verify-migration-ledger.mjs)
- profile_age_days: Option<i64>
- profile_stale: bool — `profile_age_days.map(|d| d > 30).unwrap_or(false)`
- Red iff `ledger_drift && profile_stale`
- Amber iff `ledger_drift || profile_stale`
- Green otherwise

[ASSUMED] If `scan_results.json` doesn't exist at all (fresh install, never ran a scan): treat as Amber (deep scan never run is itself a config-drift signal — operator should run it).

---

### F. `doctor_event` Emission Pattern (DOCTOR-06)

#### F1. Frontend registry — MUST add to `BLADE_EVENTS`
[VERIFIED: src/lib/events/index.ts:34-205] — `BLADE_EVENTS` is the canonical flat frozen registry (D-38-evt). All consumers MUST go through it; raw `listen()` imports are ESLint-banned.

Phase 17 adds (recommended location: after the Phase 14 ACTIVITY_LOG entry at line 204):
```typescript
// ───── Phase 17 — Doctor Module (DOCTOR-06) ──────────────────────────────
// Single-window emit from doctor.rs::emit_doctor_event() on severity transitions
// (Green→Amber, Green→Red, Amber→Red, Amber→Green, Red→Amber, Red→Green).
// Same-severity transitions do NOT emit. Payload: DoctorEventPayload (see payloads.ts).
DOCTOR_EVENT: 'doctor_event',
```

A matching payload interface `DoctorEventPayload` should be added to `src/lib/events/payloads.ts`.

#### F2. Backend emission
[VERIFIED: existing pattern at src-tauri/src/ecosystem.rs:50-58]

```rust
fn emit_doctor_event(app: &tauri::AppHandle, signal: &DoctorSignal, prior: Severity) {
    use tauri::Emitter;
    let _ = app.emit("doctor_event", serde_json::json!({
        "class":            signal.class,           // serializes via Serialize derive
        "severity":         signal.severity,
        "prior_severity":   prior,
        "last_changed_at":  signal.last_changed_at,
        "payload":          signal.payload,
    }));
}
```

NOTE: This is `app.emit(...)`, not `app.emit_to("main", ...)`. Doctor pane lives in main window only; broadcast is fine. NOT in cross-window allowlist (verify-emit-policy.mjs allowlist) and does NOT need to be — single-window emits don't trigger that script.

#### F3. ActivityStrip emission (D-21 / M-07)
[VERIFIED: existing pattern at src-tauri/src/ecosystem.rs:50-58]

```rust
fn emit_activity_for_doctor(app: &tauri::AppHandle, signal: &DoctorSignal, summary: &str) {
    use tauri::Emitter;
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "Doctor",
        "action":        "regression_detected",
        "human_summary": crate::safe_slice(summary, 200),
        "payload_id":    serde_json::Value::Null,
        "timestamp":     chrono::Utc::now().timestamp(),
    }));
}
```

The `module` field is shown in ActivityStrip as `[Doctor]` (per `ActivityStrip.tsx:39` `[{latest.module}]`). The `human_summary` becomes the strip line. Per D-21 format `[Doctor] {class} → {severity}: {one-line summary}` — the `[Doctor]` is rendered by the strip itself; the summary string passed should be `"{class} → {severity}: {one-line summary}"`.

**`human_summary` must use `safe_slice` per CLAUDE.md** (max 200 chars; non-ASCII safe).

---

### G. Diagnostics Tab Extension Pattern (DOCTOR-07)

#### G1. Extension surface
[VERIFIED: src/features/admin/Diagnostics.tsx]

Three points to modify:

1. **Type literal at line 46:**
   ```typescript
   type DiagTab = 'health' | 'traces' | 'authority' | 'deep' | 'sysadmin' | 'config' | 'doctor';
   ```

2. **`readInitialTab` switch at lines 51-65 — add `t === 'doctor'`:**
   ```typescript
   if (t === 'health' || t === 'traces' || t === 'authority' || t === 'deep' || t === 'sysadmin' || t === 'config' || t === 'doctor') {
     return t;
   }
   ```

3. **Tab tuple at lines 144-152 — add 7th entry:**
   ```typescript
   ([
     ['health', 'Health'],
     ['traces', 'Traces'],
     ['authority', 'Authority'],
     ['deep', 'Deep scan'],
     ['sysadmin', 'Sysadmin'],
     ['config', 'Config'],
     ['doctor', 'Doctor'],   // ← Phase 17 / DOCTOR-07
   ] as const)
   ```

4. **Tab body — after lines 170-177, add:**
   ```typescript
   {tab === 'doctor' && <DoctorPane />}
   ```

5. **Lazy import at top of file:**
   ```typescript
   import { lazy, Suspense } from 'react';
   const DoctorPane = lazy(() => import('./DoctorPane').then(m => ({ default: m.DoctorPane })));
   ```
   Wrap `<DoctorPane />` in `<Suspense fallback={<ListSkeleton rows={5} rowHeight={56} />}>` per BLADE convention.

#### G2. The list-with-drill-down analog: `IntegrationStatus.tsx`
[VERIFIED: src/features/admin/IntegrationStatus.tsx:1-120]

The closest analog for "click row → modal opens with detail" pattern. IntegrationStatus uses Dialog primitive for `confirmTarget` toggle confirmations — NOT for a detail drawer. UI-SPEC § 6 layout for the drawer is novel composition; planner should write fresh CSS in `admin-rich-c.css`.

The `formatTimestamp` helper at IntegrationStatus.tsx:79-86 is reusable for the Doctor "last changed" relative timestamp formatting.

---

### H. UI Token Verification (DOCTOR-08, DOCTOR-09)

#### H1. Severity tokens — already grep-verified
[VERIFIED: src/styles/tokens.css:49, 60, 61]
- `--a-warm: #ffd2a6;` (Amber stripe)
- `--status-success: #a6ffd2;` (Green stripe)
- `--status-error: #ff6b6b;` (Red stripe)

[VERIFIED: src/design-system/primitives/primitives.css:181-183]
- `.badge-ok { color: var(--a-ok); }` (Green badge)
- `.badge-warn { color: var(--a-warn); }` (Amber badge)
- `.badge-hot { color: var(--a-hot); }` (Red badge)

[VERIFIED: existing pattern] `border-left: 3px solid var(--status-success | --status-error)` is used by `agents.css:59-60`, `SwarmDAG.css:72-73`, `agents-dag-pack.css:405-406, 621-622`, `hive.css:508-512`. UI-SPEC § 5.3 chose 4px (not 3px) for prominence; verified token usage matches existing severity-stripe contract.

#### H2. Dialog primitive
[VERIFIED: src/design-system/primitives/Dialog.tsx]
Dialog accepts: `open`, `onClose`, `children`, `ariaLabel`, `triggerRef?: React.RefObject<HTMLElement>`. Focus management: captures `prevFocusRef`, focuses first interactive child on open, restores to `triggerRef.current ?? prevFocusRef.current` on close. UI-SPEC § 6.6 lock: Phase 17 MUST pass triggerRef (the row's button ref) so focus returns to row.

---

### I. Auto-Update Presence Check (DOCTOR-10)

#### I1. Wired state — both anchors verified
[VERIFIED 2026-04-30]
- `src-tauri/Cargo.toml:25` — `tauri-plugin-updater = "2"` ✓
- `src-tauri/src/lib.rs:555` — `.plugin(tauri_plugin_updater::Builder::new().build())` ✓

#### I2. Live check options
D-09 says "must run live, not be hardcoded green." Three options ranked by quality:

1. **Runtime plugin introspection [BEST]** — Tauri 2 exposes `app.config().tauri.plugins` (or similar). If `tauri-plugin-updater` is in the plugin list at runtime, it's wired. NEEDS VERIFICATION — Tauri 2 API for plugin introspection is not stable across all versions. [ASSUMED]
2. **Filesystem grep [WORKABLE]** — Read `Cargo.toml` for `tauri-plugin-updater = ` line; read `lib.rs` (or compiled binary path resolution) for `tauri_plugin_updater::Builder::new().build()`. Works on dev installs; on a packaged release, the source files don't ship — this approach degrades to Amber.
3. **Compile-time const [REJECTED — D-09 forbids]** — `const AUTO_UPDATE_WIRED: bool = true;` would lie about future regressions.

[ASSUMED] Recommendation: **Option 1** if Tauri 2's API supports it. Planner: verify during plan stage with a quick Tauri 2 docs check or code reading. Fall back to Option 2 with a comment if Option 1 isn't tractable.

---

### J. verify:* Chain Decision

#### J1. Phase 17 does NOT add a new `verify-doctor.sh`
Rationale:
- DOCTOR-02's source artifact (`tests/evals/history.jsonl`) is generated by the existing eval test run; no new bash gate is needed.
- DOCTOR-04's source is a Rust-internal API call (no shell-script equivalent).
- Doctor itself is a UI surface — the gate for "Doctor renders correctly" is the `/blade-uat` runtime UAT (CLAUDE.md Verification Protocol), NOT a static-script gate.
- Adding `verify-doctor.sh` would be ceremony — it would only re-run `cargo check` plus `npx tsc --noEmit`, which are already in the Phase 17 task verification (CLAUDE.md Verification Protocol).

[ASSUMED] Decision: Phase 17 adds zero new entries to `package.json verify:all`. The chain stays at its current 30 scripts. Existing scripts that relate (`verify:contrast`, `verify:emit-policy`, `verify:tokens-consistency`, `verify:migration-ledger`) cover Phase 17's static surface.

### Anti-Patterns to Avoid

- **Hand-rolling a side-sheet drawer.** UI-SPEC § 6.1 already chose centered `<dialog>` modal. Building a new right-side primitive would re-introduce v1.1 ghost-token risk + need new focus-trap + new a11y review.
- **Inventing severity tokens.** Use only `--status-success / --a-warm / --status-error / --status-idle / --t-4` (UI-SPEC § 8 lock). Inventing `--severity-*` would be a ghost-token regression (the v1.1 retraction trigger).
- **Hardcoding Auto-Update as Green.** D-09 says "must run live."
- **Conflating `error` and `red`.** UI-SPEC § 7.3 reserves `data-severity="error"` for "diagnostic itself broke" — distinct from "system has a real problem".
- **Skipping `safe_slice` on activity_log summary.** CLAUDE.md mandates `crate::safe_slice` for any user-content slicing; existing emit_activity uses it.
- **Bypassing `BLADE_EVENTS`.** Frontend MUST consume `doctor_event` via `useTauriEvent(BLADE_EVENTS.DOCTOR_EVENT, ...)` — raw `listen()` is ESLint-banned (D-13).
- **Ordering rows by severity.** UI-SPEC § 7.5 says order is FIXED (most-volatile-first), not severity-sorted. Re-ordering creates visual instability across refreshes.
- **Adding config fields.** Doctor adds zero config fields — the 6-place config rule does NOT apply. Confirm no `BladeConfig` modifications in Wave plans.
- **Truncating history.jsonl.** D-deferred. File grows unbounded — leave it alone for v1.2.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drawer / modal | Custom right-side sheet primitive | `Dialog` from `@/design-system/primitives` | Already wires focus trap, ARIA, Esc handling, triggerRef restoration |
| Severity badge | Custom pill | `Badge` primitive with `tone="ok\|warn\|hot\|default"` | UI-SPEC § 5.4 — color tokens already mapped |
| Empty state | Custom | `EmptyState` primitive | Live precedent in Diagnostics.tsx:653-658 |
| Loading skeleton | Custom | `ListSkeleton` primitive | UI-SPEC § 7.2 — `<ListSkeleton rows={5} rowHeight={56} />` |
| Tauri command typing | Raw `invoke<T>` calls in feature code | `invokeTyped<T>` from `@/lib/tauri/_base` | D-34 boundary; `src/lib/tauri/admin.ts` is the canonical wrapper file |
| Event subscription | Raw `listen()` from `@tauri-apps/api/event` | `useTauriEvent` hook from `@/lib/events` | D-13 — only permitted listen surface; ESLint-banned everywhere else |
| Tab persistence | Custom localStorage | `usePrefs` with `prefs['admin.activeTab']` | Already shaping the 6 existing tabs; `diag:` prefix supports any name |
| Tentacle health enumeration | Walking each module's static state directly | `supervisor::supervisor_get_health()` | Already wraps every supervised service in BLADE; canonical entry |
| Capability gap aggregation | Re-implementing logging | Read `activity_timeline` SQLite table where `event_type='capability_gap'` | Source already writes here; aggregation is just a SELECT |
| Migration ledger drift detection | Re-implementing the ledger walk | Shell out to `scripts/verify-migration-ledger.mjs` | One source of truth; exit code 0/1 is the API |
| Activity log emission | Custom event channel | `app.emit_to("main", "blade_activity_log", { module, action, human_summary, payload_id, timestamp })` | Same shape `ecosystem.rs:emit_activity_with_id` uses; ActivityStrip already subscribes |

**Key insight:** Phase 17 is a CONSUMER of existing surfaces. Every signal source already exposes data; doctor.rs's job is aggregation + classification + emission. No new substrate.

---

## Runtime State Inventory

> Phase 17 is greenfield (new module + new sub-tab) — no rename / refactor. Skipping per execution_flow Step 2.5.

**Nothing in any category:** Verified by:
- No string rename (new module, new event name, new tab)
- No DB schema change (reads existing `activity_timeline` only)
- No config field addition (doctor adds zero fields per CLAUDE.md 6-place rule N/A)
- No package rename
- No CI service registration

---

## Common Pitfalls

### Pitfall 1: `EvalSummary` lacks `Serialize`
**What goes wrong:** `record_eval_run` tries to do `serde_json::to_value(summary)` and fails to compile.
**Why it happens:** The struct has `Debug, Clone, Copy` but not `Serialize` (verified at harness.rs:54-64).
**How to avoid:** Construct the JSON inline (see § B2). Don't add `Serialize` — it's a compile-time decision, doesn't matter at runtime.
**Warning signs:** Cargo error `the trait Serialize is not implemented for EvalSummary`.

### Pitfall 2: ActivityStrip module field hardcoding
**What goes wrong:** `[Doctor]` is rendered by the strip from the `module` field. If the emit code uses `"doctor"` (lowercase) or `"DOCTOR"`, the strip still renders it — UI-SPEC says `[Doctor]`. Inconsistent casing across the codebase.
**Why it happens:** No type enforcement on the `module` string.
**How to avoid:** Pass the literal `"Doctor"` — title case — verbatim per UI-SPEC § 14.3.
**Warning signs:** Screenshot diff during `/blade-uat` shows `[doctor]` instead of `[Doctor]`.

### Pitfall 3: D-21 emission ordering
**What goes wrong:** `doctor_event` and `blade_activity_log` are emitted in different orders across refreshes; ActivityStrip shows the regression line BEFORE the doctor row updates (or vice versa).
**Why it happens:** Two `app.emit()` calls; Tauri delivery order isn't strictly synchronous.
**How to avoid:** Emit `doctor_event` FIRST (it's the primary surface), then `blade_activity_log`. Both are fire-and-forget; UI consumers should not depend on cross-event ordering.
**Warning signs:** Race conditions in /blade-uat manual test "Trigger eval failure → see strip update first vs row update first."

### Pitfall 4: history.jsonl path resolution in tests
**What goes wrong:** `record_eval_run` writes to a path relative to `CARGO_MANIFEST_DIR`. In a test that uses `temp_blade_env()`, `BLADE_CONFIG_DIR` is overridden — but `CARGO_MANIFEST_DIR` is NOT. So tests would write to the REAL repo's `tests/evals/history.jsonl` and pollute it.
**Why it happens:** Phase 16 evals run with `BLADE_CONFIG_DIR` redirected to a tempdir, but `record_eval_run` uses a different path resolution.
**How to avoid:** TWO options:
1. **Recommended:** Have `record_eval_run` honor a `BLADE_EVAL_HISTORY_PATH` env var override; `temp_blade_env` sets this to `temp_dir.path().join("history.jsonl")`. Cleanest — keeps test isolation.
2. **Alternative:** Doctor / Phase 17 accepts that test runs DO append to the real history file. Phase 16 evals are run rarely (only via `verify-eval.sh`), and pollution is bounded. Treat as expected behavior.
**Warning signs:** Random eval runs leaking into the dev history file.
**Recommendation:** Planner picks option (1). 5 lines of code in `record_eval_run` + 2 lines in `temp_blade_env`.

### Pitfall 5: Drawer focus restoration with lazy-loaded component
**What goes wrong:** DoctorPane is `lazy()`-loaded. The first time a user clicks Doctor tab → first row → drawer, the row's `<button ref>` may not be the same object after re-render. Focus restoration fails.
**Why it happens:** React's reconciler may swap refs on re-mount. `Dialog.triggerRef` captures a snapshot.
**How to avoid:** Use `useRef<HTMLButtonElement>(null)` per ROW, not a shared ref. UI-SPEC § 6.6 says "pass the row's `<button>` ref via Dialog's `triggerRef` prop." Each row owns its ref; opening the drawer passes that specific row's ref.
**Warning signs:** Esc-closes-drawer → focus lands on the first interactive element on the page (usually the tab strip), not the row.

### Pitfall 6: Config field counter (CLAUDE.md 6-place rule)
**What goes wrong:** Phase 17 wants to expose a "doctor enabled" toggle in Settings → adds a config field → doesn't update all 6 places → config field silently doesn't persist.
**Why it happens:** CLAUDE.md mandates the 6-place pattern.
**How to avoid:** Phase 17 does NOT add config fields. Doctor is always-on (auto-pull on tab mount). If a future phase wants a toggle, it owns the 6-place pattern.
**Warning signs:** Plan mentions any `BladeConfig` field. Reject.

### Pitfall 7: `tauri::Manager` import for `app.state()`
**What goes wrong:** Doctor command uses `app.state::<SomeState>()` but doesn't import `Manager` → cryptic "no method named state" error.
**Why it happens:** CLAUDE.md "Critical Architecture Rules" — Manager trait must be in scope.
**How to avoid:** Phase 17 doesn't currently need any `app.state()` calls (no managed state, just static OnceLock for prior-severity). If a future revision adds managed state, `use tauri::Manager;` at the top of doctor.rs.
**Warning signs:** Compile error citing `state` method.

### Pitfall 8: `app.emit_to` window label mismatch
**What goes wrong:** `app.emit_to("main", ...)` fires but Doctor pane lives in a different window → strip update never arrives.
**Why it happens:** Tauri's `emit_to` is window-scoped.
**How to avoid:** Doctor pane is in the main window (Diagnostics route). `"main"` is correct. ActivityStrip mounts in `MainShell.tsx` (also main window). All emits go to `"main"`.
**Warning signs:** Test on /blade-uat — trigger regression, no strip update appears.

### Pitfall 9: Sources in parallel — process-global state contamination
**What goes wrong:** `tokio::join!(eval, capgap, tentacle, drift, autoupdate)` — but `temp_blade_env()` mutates a process-global env var. If Phase 17 reuses any helpers from `harness.rs` for tests, parallel signal sources race on `BLADE_CONFIG_DIR`.
**Why it happens:** Documented in harness.rs:14-17.
**How to avoid:** Doctor's signal sources do NOT use `temp_blade_env()` — they read REAL state, not test fixtures. Parallel is safe for the production Tauri command. Tests of doctor.rs that exercise multiple signals must pin `--test-threads=1` (already enforced for evals).
**Warning signs:** Flaky test failures in CI.

---

## Code Examples

### `DoctorSignal` struct (Rust, D-02)
```rust
// Source: synthesized from CONTEXT.md D-02 + verified pattern in supervisor.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Green,
    Amber,
    Red,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorSignal {
    pub class: SignalClass,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub last_changed_at: i64,        // unix ms
    pub suggested_fix: String,
}
```

### Tauri command shape (Rust, D-19)
```rust
// Source: verified pattern from supervisor.rs:225-238 + commands.rs
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

static PRIOR_SEVERITY: OnceLock<Mutex<HashMap<SignalClass, Severity>>> = OnceLock::new();
static LAST_RUN: OnceLock<Mutex<Vec<DoctorSignal>>> = OnceLock::new();

fn prior_severity_map() -> &'static Mutex<HashMap<SignalClass, Severity>> {
    PRIOR_SEVERITY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub async fn doctor_run_full_check(app: AppHandle) -> Result<Vec<DoctorSignal>, String> {
    let (eval, capgap, tentacle, drift, autoupdate) = tokio::join!(
        compute_eval_signal(),
        compute_capgap_signal(),
        compute_tentacle_signal(),
        compute_drift_signal(),
        compute_autoupdate_signal(),
    );
    let signals = vec![eval?, capgap?, tentacle?, drift?, autoupdate?];

    // Diff against prior severity, emit on transitions
    let mut prior_lock = prior_severity_map().lock().unwrap();
    for sig in &signals {
        let prior = prior_lock.get(&sig.class).copied().unwrap_or(Severity::Green);
        if prior != sig.severity && matches!(sig.severity, Severity::Amber | Severity::Red) {
            emit_doctor_event(&app, sig, prior);
            emit_activity_for_doctor(&app, sig);
        }
        prior_lock.insert(sig.class.clone(), sig.severity);
    }
    drop(prior_lock);

    *LAST_RUN.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap() = signals.clone();
    Ok(signals)
}

#[tauri::command]
pub fn doctor_get_recent(class: Option<SignalClass>) -> Vec<DoctorSignal> {
    let lock = LAST_RUN.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap();
    match class {
        Some(c) => lock.iter().filter(|s| s.class == c).cloned().collect(),
        None => lock.clone(),
    }
}

#[tauri::command]
pub fn doctor_get_signal(class: SignalClass) -> Option<DoctorSignal> {
    let lock = LAST_RUN.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap();
    lock.iter().find(|s| s.class == class).cloned()
}
```

### Frontend Tauri client wrapper (TypeScript, src/lib/tauri/admin.ts pattern)
```typescript
// Source: verified pattern at src/lib/tauri/admin.ts:1491-1503
/**
 * @see src-tauri/src/doctor.rs::doctor_run_full_check
 * Rust signature: `doctor_run_full_check(app: AppHandle) -> Result<Vec<DoctorSignal>, String>`.
 */
export function doctorRunFullCheck(): Promise<DoctorSignal[]> {
  return invokeTyped<DoctorSignal[]>('doctor_run_full_check');
}

export function doctorGetRecent(args: { class?: SignalClass | null } = {}): Promise<DoctorSignal[]> {
  return invokeTyped<DoctorSignal[], { class: SignalClass | null }>('doctor_get_recent', { class: args.class ?? null });
}

export function doctorGetSignal(args: { class: SignalClass }): Promise<DoctorSignal | null> {
  return invokeTyped<DoctorSignal | null, { class: SignalClass }>('doctor_get_signal', args);
}
```

### Frontend event subscription pattern
```typescript
// Source: verified pattern from src/features/activity-log/index.tsx:84-92
import { BLADE_EVENTS, useTauriEvent, type Event } from '@/lib/events';

function DoctorPane() {
  const [signals, setSignals] = useState<DoctorSignal[]>([]);

  useEffect(() => {
    void doctorRunFullCheck().then(setSignals).catch(/* show EmptyState */);
  }, []);

  useTauriEvent<DoctorEventPayload>(BLADE_EVENTS.DOCTOR_EVENT, (e) => {
    setSignals(prev => prev.map(sig =>
      sig.class === e.payload.class
        ? { ...sig, severity: e.payload.severity, last_changed_at: e.payload.last_changed_at, payload: e.payload.payload }
        : sig
    ));
  });
  // ...
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-feature ad-hoc diagnostic UI | Centralized Doctor pane aggregating signals | This phase (v1.2) | Single place to debug; signal classes are pluggable |
| Eval results = stdout only | Eval results = stdout + history.jsonl | This phase | Doctor can compute trends; CI gates remain unchanged |
| Tentacle health = scattered grep | `supervisor_get_health()` was the consolidation | Phase 7 (already shipped) | Phase 17 reuses this |

**Deprecated/outdated:** None — Phase 17 introduces new surface, doesn't replace existing.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `floor_passed` should be recorded on EVERY run (including failures), not just successes | § B2 / B3 | If wrong: Doctor can't see floor breaches. Mitigation: planner confirms with user during plan stage. Recommendation noted: option (a) record before assertions. |
| A2 | `evolution_log_capability_gap` rows in `activity_timeline` are treated as unresolved (no resolution flag in schema) | § C3 | If wrong: Red severity false-fires. Mitigation: scope says "≥3 unresolved" — operationally interpret as "≥3 occurrences in 7d" since no resolution mechanism exists. |
| A3 | `integration_bridge.rs` needs a new `pub fn get_per_service_last_poll()` accessor for full DOCTOR-04 coverage | § D3 | If wrong: MCP tentacles aren't surfaced; only supervisor-registered services are. Mitigation: 6-line addition or accept v1 limitation. |
| A4 | Migration ledger drift detection shells out to `scripts/verify-migration-ledger.mjs` rather than re-implementing in Rust | § E1 | If wrong: 500ms latency on each `doctor_run_full_check`. Mitigation: cache result for N seconds; user-acceptable on a debug surface. |
| A5 | Missing `scan_results.json` is Amber (deep scan never run) | § E3 | If wrong: false amber on fresh installs. Mitigation: planner can decide Green-on-missing if onboarding hasn't completed. |
| A6 | Auto-update check uses Tauri 2 runtime plugin introspection; falls back to filesystem grep if API unavailable | § I2 | If wrong: hardcoded Green sneaks in via fallback. Mitigation: planner verifies during plan stage with Tauri 2 docs. |
| A7 | Phase 17 adds zero entries to `package.json verify:all` | § J1 | If wrong: Doctor surface degrades silently. Mitigation: `/blade-uat` runtime UAT is the gate per CLAUDE.md Verification Protocol. |
| A8 | `record_eval_run` honors a `BLADE_EVAL_HISTORY_PATH` env var so tests don't pollute the real history file | § Pitfall 4 | If wrong: dev history file gets test-run pollution. Mitigation: small, isolated change. |
| A9 | Sources run in parallel via `tokio::join!` | CONTEXT.md "Claude's Discretion" | If wrong: serial execution adds ~600ms total latency. Mitigation: parallel is the recommended path; serial is a trivial fallback. |
| A10 | `EvalSummary` does NOT add `Serialize` derive — JSON is constructed inline | § B2, § Pitfall 1 | If wrong: build error. Mitigation: explicit pattern shown in B2. |

**If this table empties out (every assumption verified by user during plan stage):** all claims become decisions; planner proceeds with full confidence.

---

## Open Questions (RESOLVED)

1. **Does Tauri 2 expose a stable runtime API for plugin enumeration?**
   - What we know: lib.rs:540-560 lists all 14 plugins via `.plugin(...)`; Cargo.toml has all dep declarations.
   - What's unclear: Whether `app.config().tauri.plugins` (or similar) reliably returns the loaded plugin list at runtime in Tauri 2.x stable.
   - RESOLVED: Filesystem grep — Tauri 2 plugin enumeration API is unstable; Plan 03 uses Cargo.toml + lib.rs grep for DOCTOR-10.
   - Recommendation: Plan task 17-XX-doctor-autoupdate spends 15 minutes on Tauri 2 docs; if API exists → use it; if not → fallback to filesystem grep with a clear comment.

2. **Should `record_eval_run` fire on test failure or only on success?**
   - What we know: D-15 says Doctor reads last 200 lines and computes 10%-drop detection.
   - What's unclear: If failed runs aren't recorded, the 10%-drop calc misses the moment of regression.
   - RESOLVED: record_eval_run fires on every eval run (success and failure); Plan 03 places the call after print_eval_table regardless of pass/fail.
   - Recommendation: Record on every run (`floor_passed: bool` is the breadcrumb). Explicit user confirmation during plan stage.

3. **Do MCP integration tentacles count for DOCTOR-04?**
   - What we know: CONTEXT.md D-04 lists supervisor-registered observers; integration_bridge.rs has its own poll cadence with `last_poll` timestamps.
   - What's unclear: Whether v1.2 ships only the 6 supervisor-registered services or also the 4 MCP integrations.
   - RESOLVED: MCP integration tentacles included in v1.2 via the 6-line accessor in Plan 02 (integration_bridge.rs); v1.3 deferred items are listed in CONTEXT.md § Deferred Ideas.
   - Recommendation: Both. Add the 6-line accessor in integration_bridge.rs. Each surface contributes rows to the per-tentacle list inside the TentacleHealth payload.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain (cargo) | Phase 17 build + tests | ✓ | (existing) | — |
| Node.js | `verify:migration-ledger` shell-out (DOCTOR-05) | ✓ | (existing — used by all 30 verify:* scripts) | If missing: Doctor reports drift signal as Amber + "could not verify ledger" suggested fix |
| `tauri-plugin-updater = "2"` | DOCTOR-10 inspection target | ✓ | 2 [VERIFIED: Cargo.toml:25] | — |
| `rusqlite` | DOCTOR-03 capability gap query | ✓ | (existing) | — |
| `chrono` / `serde_json` | All signals | ✓ | (existing) | — |
| `tauri-plugin-store` | not used by Phase 17 | n/a | — | — |
| Existing `tests/evals/` directory | DOCTOR-02 history file location | ✓ | (path exists, currently has only `DEFERRED.md`) | Phase 17 adds `.gitkeep`; `history.jsonl` itself is generated on first eval run |
| `Dialog`, `Button`, `Badge`, `EmptyState`, `ListSkeleton`, `GlassPanel`, `Pill` primitives | Doctor UI | ✓ | All exported from `@/design-system/primitives` [VERIFIED] | — |
| `useTauriEvent`, `BLADE_EVENTS` registry | Frontend event subscription | ✓ | [VERIFIED: src/lib/events/index.ts] | — |
| `usePrefs` hook | Tab persistence | ✓ | [VERIFIED] | — |

**Missing dependencies with no fallback:** None. All Phase 17 dependencies are already in tree.

**Missing dependencies with fallback:** None.

---

## Validation Architecture

> Required because `workflow.nyquist_validation` is enabled (default — config did not set false). All Phase 17 plans MUST cite this section.

### Test Framework
| Property | Value |
|----------|-------|
| Rust unit tests | Cargo test (existing); pin `--test-threads=1` per harness convention |
| Rust test invocation | `cd src-tauri && cargo test --lib doctor -- --nocapture --test-threads=1` |
| Frontend type check | `npx tsc --noEmit` (existing) |
| Eval gate | `bash scripts/verify-eval.sh` (existing — fires Phase 16 evals; Phase 17 modifies the modules but the gate's pass/fail wording is unchanged) |
| Integration / UI test | `/blade-uat` slash command (CLAUDE.md Verification Protocol) — the v1.1 retraction lesson means Phase 17 cannot be marked done by static gates alone |
| Quick run command | `cd src-tauri && cargo test --lib doctor -- --nocapture --test-threads=1 && npx tsc --noEmit` |
| Full suite command | `npm run verify:all && bash scripts/verify-eval.sh && /blade-uat` |
| Phase gate | All static gates green AND `/blade-uat` checklist (UI-SPEC § 17) green AND screenshots saved + read back per CLAUDE.md Verification Protocol |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| DOCTOR-01 (3 commands callable) | Cargo compile + invoke from frontend | unit + smoke | `cargo check && cargo test --lib doctor -- --test-threads=1` | ❌ Wave 0 — needs `tests` module inside doctor.rs |
| DOCTOR-02 (eval history surfaces) | Compute SignalClass::EvalScores severity from a fixture history.jsonl | unit | `cargo test --lib doctor::tests::eval_signal_severity_red_on_floor_breach` | ❌ Wave 0 |
| DOCTOR-02 (record_eval_run writes JSONL line) | Verify the line appended on harness invocation | unit | `cargo test --lib evals::harness::tests::record_eval_run_appends_jsonl` | ❌ Wave 0 |
| DOCTOR-03 (capability gap aggregation) | Severity classification from a seeded `activity_timeline` SQLite | unit | `cargo test --lib doctor::tests::capgap_severity_red_on_3_in_7d` | ❌ Wave 0 |
| DOCTOR-04 (tentacle health) | Severity classification from a fake supervisor map (use `register_service` + manipulate `HEALTH_MAP`) | unit | `cargo test --lib doctor::tests::tentacle_severity_red_on_24h_dead` | ❌ Wave 0 |
| DOCTOR-05 (config drift) | Severity classification from a stub ledger-drift bool + scan_age days | unit | `cargo test --lib doctor::tests::drift_severity_red_on_both` | ❌ Wave 0 |
| DOCTOR-06 (doctor_event emission) | Confirm `app.emit("doctor_event", ...)` fires on transition | integration (Tauri test) | `cargo test --lib doctor::tests::emits_event_on_red_transition` (uses tauri::test::mock_app) | ❌ Wave 0 |
| DOCTOR-06 (no-emit on no-transition) | Confirm same-severity does NOT emit | unit | `cargo test --lib doctor::tests::no_emit_on_green_to_green` | ❌ Wave 0 |
| DOCTOR-07 (Doctor sub-tab reachable) | Click tab pill → DoctorPane mounts | runtime UAT | `/blade-uat` step "Doctor sub-tab is reachable from Diagnostics route" | ❌ runtime — manual |
| DOCTOR-07 (tab persistence) | Refresh page → Doctor tab still active | runtime UAT | `/blade-uat` step "Tab pref persists across reload" (extension of UI-SPEC § 17) | ❌ runtime — manual |
| DOCTOR-08 (severity stripe color) | DOM `[data-severity]` matches signal severity | runtime UAT + verify:contrast | `npm run verify:contrast && /blade-uat screenshot read-back` | ✅ verify:contrast exists |
| DOCTOR-09 (drill-down drawer) | Click row → Dialog opens; payload + suggested_fix render; Esc closes; focus restores | runtime UAT | `/blade-uat` step "Click each row → drawer opens centered" | ❌ runtime — manual |
| DOCTOR-10 (auto-update check) | Asserted `Severity::Green` on stock build (Cargo.toml has dep + lib.rs has init) | unit | `cargo test --lib doctor::tests::autoupdate_green_on_stock_install` | ❌ Wave 0 |
| D-21 ActivityStrip emission | Strip line `[Doctor] {class} → {severity}: ...` appears on regression | runtime UAT | `/blade-uat` step "ActivityStrip emission test" | ❌ runtime — manual |
| `/blade-uat` overall (UI-SPEC § 17) | All 16 boxes ticked, screenshots saved + read back | runtime UAT | `/blade-uat` | ❌ runtime — required before phase close |

### Sampling Rate
- **Per task commit:** `cd src-tauri && cargo test --lib doctor -- --nocapture --test-threads=1` (the per-module test suite — runs in <30s)
- **Per wave merge:** `npm run verify:all && cd src-tauri && cargo test --lib -- --test-threads=1` (full static gate)
- **Phase gate:** Full static suite green + `/blade-uat` checklist green + screenshots read back + cargo check on macOS (per CLAUDE.md "verify:all" + Verification Protocol)

### Wave 0 Gaps
Tests / fixtures that need to exist before Wave 1 implementation:

- [ ] `src-tauri/src/doctor.rs` — module file itself (Wave 1 creates; Wave 0 just needs the empty file or stubbed types)
- [ ] `src-tauri/src/doctor.rs` — `mod tests { ... }` block with the unit tests listed in the table above
- [ ] `tests/evals/.gitkeep` — keeps the directory tracked
- [ ] `src-tauri/src/evals/harness.rs::tests::record_eval_run_appends_jsonl` — unit test for the new public function (uses tempdir + env-var override per Pitfall 4)
- [ ] `src/lib/events/index.ts` — `DOCTOR_EVENT: 'doctor_event'` constant
- [ ] `src/lib/events/payloads.ts` — `DoctorEventPayload` interface
- [ ] `src/features/admin/admin-rich-c.css` — empty (or skeleton) CSS partial

No new bash verify-* script is added (per § J1 lock).

---

## Project Constraints (from CLAUDE.md)

These directives override any contrary research finding:

1. **Module registration 3-step** — `mod doctor;` in lib.rs + 3 entries in `generate_handler!` + (no config fields, so 6-place rule N/A).
2. **Flat `#[tauri::command]` namespace** — verified zero clash for `doctor_*` symbols. Don't add private helpers in other modules with `#[tauri::command]` doctor names.
3. **`use tauri::Manager;`** — required if Phase 17 ever adds `app.state::<...>()` (currently does not).
4. **`safe_slice` for non-ASCII** — REQUIRED on `human_summary` and any user-content slicing (UI-SPEC § 14.3 caps at 200 chars; matches existing `emit_activity_with_id`).
5. **No double quotes in `execute_batch!` SQL** — N/A (Phase 17 uses single SELECT/INSERT statements via `prepare`/`execute`).
6. **Verification Protocol — runtime UAT MANDATORY** — Phase 17 has UI surface; static gates alone CANNOT close the phase. UI-SPEC § 17 + CLAUDE.md "BLADE UAT evidence rule" + the v1.1 retraction lesson are load-bearing.
7. **Don't run `cargo check` after every small edit** — batch edits, run once at end of each wave.
8. **No Co-Authored-By in commits** — Arnav is the author.
9. **Don't remove existing features — upgrade in place** — Phase 17 ADDS Doctor sub-tab; does NOT remove or replace any of the 6 existing Diagnostics tabs.
10. **No grep/cat/find in bash — use Read/Grep/Glob tools** — applies to executor agents during plan execution.

## Project Constraints (from PROJECT.md D-rules — referenced)
- **D-01..D-45** — no shadcn/Radix, no Framer Motion, no Zustand, no React Router. UI-SPEC verified all 7 primitives are in-tree BLADE design-system. Phase 17 introduces zero new dependencies.
- **D-13** — only permitted `listen()` surface is `useTauriEvent` from `@/lib/events`. ESLint-banned everywhere else.
- **D-34** — `@tauri-apps/api/event` types re-exported from `@/lib/events`; consumers don't import the package directly.
- **D-38-evt** — every event constant declared in `BLADE_EVENTS` flat frozen registry.
- **D-45** — emits respect window scope; cross-window emits are allowlisted by `verify-emit-policy.mjs`. Phase 17's `doctor_event` is single-window — no allowlist entry needed. `blade_activity_log` (Phase 17 reuses) is already an established single-window event.

## Project Constraints (from STATE.md M-decisions)
- **M-01** — Wiring + smart defaults + a11y, NOT new features. Doctor is "wiring up existing signal sources" — fits the M-01 anchor.
- **M-03** — Observe-only guardrail. Phase 17 is purely observational (reads + reports); does not act. No guardrail flip required.
- **M-05** — Phase numbering is global; Phase 17 follows Phase 16 in v1.2.
- **M-07** — Activity log is load-bearing; D-21 enforces this for Phase 17 doctor regressions.

---

## Sources

### Primary (HIGH confidence — grep-verified live, 2026-04-30)
- `src-tauri/src/evals/harness.rs:54-64, 135-174` — `EvalSummary` struct + `print_eval_table` API
- `src-tauri/src/evals/{hybrid_search,real_embedding,kg_integrity,typed_memory,capability_gap}_eval.rs:`{315,222,259,191,190}` — 5 `print_eval_table` insertion sites
- `src-tauri/src/evals/mod.rs:10-15` — eval module declarations under `#[cfg(test)]`
- `src-tauri/src/evolution.rs:1115-1134` — `evolution_log_capability_gap` writes to `activity_timeline` via `db::timeline_record`
- `src-tauri/src/db.rs:390-401, 1793-1810` — `activity_timeline` schema + `timeline_record` API
- `src-tauri/src/supervisor.rs:32-41, 50-78, 199-238` — `ServiceHealth` struct, `register_service` / `heartbeat`, `supervisor_get_health` command
- `src-tauri/src/integration_bridge.rs:18-95, 320-476` — `IntegrationConfig` + `last_poll` field; `integration_get_state` command
- `src-tauri/src/deep_scan/mod.rs:51-72, 376` — `scan_results_path()` + `load_results_pub()` + `scanned_at` field at ms precision
- `src-tauri/src/lib.rs:540-560, 596+` — `tauri_plugin_updater::Builder::new().build()` initialization (line 555); `generate_handler!` block (line 596+)
- `src-tauri/src/config.rs:569-588` — `blade_config_dir()` + `BLADE_CONFIG_DIR` env override
- `src-tauri/Cargo.toml:25` — `tauri-plugin-updater = "2"`
- `src-tauri/src/ecosystem.rs:46-58` — canonical `app.emit_to("main", "blade_activity_log", ...)` pattern + payload shape
- `src/features/admin/Diagnostics.tsx:1-181` — current 6-tab structure + `DiagTab` literal + `readInitialTab` + tab tuple + tab pref persistence
- `src/features/admin/IntegrationStatus.tsx:1-120` — list-with-action analog
- `src/lib/events/index.ts:34-205` — `BLADE_EVENTS` frozen registry
- `src/lib/tauri/admin.ts:1485-1503` — `supervisorGetHealth` wrapper pattern
- `src/features/activity-log/{ActivityStrip,ActivityDrawer,index}.tsx` — emission consumer + ring-buffer + drawer
- `src/design-system/primitives/{Dialog,EmptyState,ListSkeleton,Badge}.tsx + primitives.css:172-217` — Phase 17 UI primitives
- `src/styles/tokens.css:38-81` — severity tokens
- `scripts/verify-migration-ledger.mjs:1-80` — DOCTOR-05 ledger drift API (exit 0/1)
- `scripts/verify-eval.sh:1-40` — eval gate exit-code convention
- `package.json:verify:all` — current 30-script chain
- `.planning/phases/17-doctor-module/17-CONTEXT.md` — locked decisions D-01..D-21
- `.planning/phases/17-doctor-module/17-UI-SPEC.md` — locked visual contract + UAT checklist
- `.planning/REQUIREMENTS.md:31-40` — DOCTOR-01..10 wording
- `.planning/ROADMAP.md:86-100` — Phase 17 success criteria
- `.planning/STATE.md` — M-01..M-07 v1.1 locked decisions
- `CLAUDE.md` — module registration + safe_slice + Verification Protocol

### Secondary (MEDIUM confidence — synthesized from official patterns)
- Tauri 2 plugin introspection API for DOCTOR-10 — pending plan-stage docs verification (see Open Question 1)
- `tokio::join!` parallel signal-source fetch — recommended; serial is the trivial fallback

### Tertiary (LOW confidence)
- None — all Phase 17 surfaces grep-verified or covered by CONTEXT.md / UI-SPEC locks.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency already in tree; verified by grep
- Architecture patterns: HIGH — every pattern has a verified live analog in BLADE
- Pitfalls: HIGH — 9 pitfalls identified with concrete code paths and CLAUDE.md anchors
- Validation Architecture: HIGH — Wave 0 gaps are concrete and bounded
- Auto-update introspection (DOCTOR-10): MEDIUM — runtime API existence is the only open question; fallback path documented

**Research date:** 2026-04-30
**Valid until:** 2026-05-15 (15 days — code references valid as long as no major refactor lands; the BLADE pre-v1.2 codebase is stable)
**Next consumer:** `gsd-planner` — produces wave-by-wave PLAN.md files using this research + CONTEXT.md + UI-SPEC.md
