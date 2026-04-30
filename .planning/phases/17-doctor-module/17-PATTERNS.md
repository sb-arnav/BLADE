# Phase 17: Doctor Module — Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 12 (5 CREATE + 7 MODIFY)
**Analogs found:** 12 / 12 (every file has a real BLADE analog — zero greenfield)

## File Classification

| New / Modified File | Action | Role | Data Flow | Closest Analog | Match |
|---------------------|--------|------|-----------|----------------|-------|
| `src-tauri/src/doctor.rs` | CREATE | new module | aggregator + event-emitter | `src-tauri/src/supervisor.rs` | exact (struct + Vec<T> command + event emitter) |
| `src/features/admin/DoctorPane.tsx` | CREATE | UI surface (lazy admin tab body) | request-response + event subscription | `src/features/admin/IntegrationStatus.tsx` + `src/features/activity-log/ActivityDrawer.tsx` | role-match (compose) |
| `src/features/admin/admin-rich-c.css` | CREATE | styles partial (admin extension) | static | `src/features/admin/admin-rich-b.css` | exact (partial extension contract) |
| `src/lib/events/payloads.ts` | MODIFY | event payload registry | TS interface | own file (extend) | exact |
| `tests/evals/.gitkeep` | CREATE | directory marker | static | (no analog needed — empty file) | n/a |
| `src-tauri/src/lib.rs` | MODIFY | module + handler registration | static | own file (3-step registration) | exact |
| `src-tauri/src/evals/harness.rs` | MODIFY | extend with `record_eval_run` + tests | file I/O | self (extends existing harness pattern) | exact |
| `src-tauri/src/evals/{hybrid_search,real_embedding,kg_integrity,typed_memory,capability_gap}_eval.rs` | MODIFY | one-line append per file | tap | self (single-line insertion after `print_eval_table`) | exact |
| `src/features/admin/Diagnostics.tsx` | MODIFY | extend tab tuple + DiagTab + readInitialTab + render branch | request-response | own file (existing 6-tab pattern) | exact |
| `src/lib/events/index.ts` | MODIFY | append constant to BLADE_EVENTS frozen registry | static | own file (Phase 14 ACTIVITY_LOG entry pattern) | exact |
| `src/lib/tauri/admin.ts` | MODIFY | 3 new wrapper exports | request-response | self lines 1485–1503 (`supervisorGetHealth` block) | exact |
| `package.json` | (no change confirmed) | — | — | — | n/a |

---

## Pattern Assignments

### `src-tauri/src/doctor.rs` (CREATE)

**Role:** new module — `DoctorSignal` struct + `SignalClass` / `Severity` enums + 3 Tauri commands + event emitter + suggested-fix table
**Closest analog:** `src-tauri/src/supervisor.rs` (`ServiceHealth` struct → tauri command returning `Vec<T>`); `src-tauri/src/ecosystem.rs:46-58` (event emission)

**Excerpt — struct + static map + Tauri command** (`supervisor.rs:32-46, 224-230`):
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealth {
    pub name: String,
    pub status: String,
    pub crash_count: u32,
    pub last_crash: Option<i64>,
    pub last_heartbeat: i64,
    pub uptime_secs: i64,
    pub started_at: i64,
}

static HEALTH_MAP: OnceLock<Mutex<HashMap<String, ServiceHealth>>> = OnceLock::new();

#[tauri::command]
pub fn supervisor_get_health() -> Vec<ServiceHealth> {
    health_map()
        .lock()
        .map(|map| map.values().cloned().collect())
        .unwrap_or_default()
}
```

**Excerpt — event emission with `app.emit_to("main", ...)`** (`ecosystem.rs:50-58`):
```rust
fn emit_activity_with_id(app: &AppHandle, module: &str, action: &str, summary: &str, payload_id: Option<String>) {
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        module,
        "action":        action,
        "human_summary": crate::safe_slice(summary, 200),
        "payload_id":    payload_id,
        "timestamp":     now_secs(),
    }));
}
```

**Copy:** the `#[derive(Debug, Clone, Serialize, Deserialize)]` derive on the struct; the `OnceLock<Mutex<...>>` static + lazy-init pattern; the `#[tauri::command] pub fn ... -> Vec<T>` signature for `doctor_run_full_check` / `doctor_get_recent`; `app.emit_to("main", "blade_activity_log", json!({...}))` verbatim for the M-07 ActivityStrip emission (D-21); `crate::safe_slice(summary, 200)` for the `human_summary` field.

**Adapt:**
- Struct fields per CONTEXT D-02: `class: SignalClass, severity: Severity, payload: serde_json::Value, last_changed_at: i64, suggested_fix: String`
- Static state holds `Mutex<HashMap<SignalClass, Severity>>` for prior-severity diff (D-20) AND `Mutex<Vec<DoctorSignal>>` for last-cached-run (D-19 `doctor_get_recent`)
- The `SignalClass` and `Severity` enums need `#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]` (Hash + Eq required for HashMap key) and `#[serde(rename_all = "snake_case")]` on `Severity` so the wire form matches the UI-SPEC `data-severity="green|amber|red"` attr exactly
- For `doctor_event` (NOT activity_log) emit: use `app.emit("doctor_event", payload)` per RESEARCH F2 — this is the broadcast variant, single-window allowed since Doctor lives only in `main`
- Suggested-fix table is a `match (class, severity) -> &'static str` per UI-SPEC § 15 verbatim (15 strings, do NOT paraphrase — D-18 is a lock)
- Run sources via `tokio::join!(eval_signal(), capgap_signal(), tentacle_signal(), drift_signal(), autoupdate_signal())` per CONTEXT "Claude's Discretion" recommendation

**Watch out (BLADE landmines from CLAUDE.md):**
- **Flat `#[tauri::command]` namespace** — confirmed zero `doctor_*` symbols exist in the tree (RESEARCH § A3); pick non-clashing private helper names too (avoid `health_map`, `record_crash`, `now_secs`, `register_service` — those exist in supervisor / ecosystem)
- **Module registration 3-step** — `mod doctor;` in lib.rs + 3 entries in `generate_handler!`. The 6-place config rule does NOT fire (zero new config fields)
- **`use tauri::Manager;`** — NOT needed unless the module calls `app.state()`; emitter pattern uses `use tauri::Emitter;` (verified live in `ecosystem.rs:1-15` and `supervisor.rs:27`)
- **`safe_slice` on activity_log summary** — every `human_summary` field MUST go through `crate::safe_slice(s, 200)` per CLAUDE.md "non-ASCII string slicing" rule (canonical_refs `feedback_uat_evidence.md` ghost-emoji bug). Never `&summary[..200]`
- **No `cat << 'EOF'` heredoc** — Phase 17 plans must use the Write/Edit tools, not bash heredocs (matches BLADE policy on file authoring)
- **"Missed once = silent regression" pattern** — every `doctor_run_full_check` call site MUST also call `emit_doctor_event(...)` and `emit_activity_for_doctor(...)` on a transition-and-not-green-to-green branch. The ghost-emission risk mirrors v1.1's `blade_message_start` lesson — one missed branch and the strip stays empty even though a regression fired

---

### `src/features/admin/DoctorPane.tsx` (CREATE)

**Role:** UI surface — lazy-loaded Diagnostics sub-tab body; renders 5 severity-striped rows + drill-down dialog
**Closest analog (rows + tab body):** `src/features/admin/IntegrationStatus.tsx:202-260` (list-with-rows pattern, refresh button, error EmptyState)
**Closest analog (drawer modal):** `src/features/activity-log/ActivityDrawer.tsx:39-99` (centered `<dialog>` modal via `Dialog` primitive, internal `<header>` / list / `Close` button layout)
**Closest analog (event subscription):** `src/features/activity-log/index.tsx:84-92` (`useTauriEvent` with handler-in-ref, ring-buffer state update)

**Excerpt — section + refresh button + admin-row-list + EmptyState** (`IntegrationStatus.tsx:218-249`):
```tsx
<section className="diagnostics-section">
  <h4 className="diagnostics-section-title">Services</h4>
  <div className="admin-row-list">
    {rows.map((row) => (
      <div key={row.service} className="integration-service-card" data-service={row.service}>
        <div className="integration-service-card-main">
          <span className="integration-service-card-name">{row.label}</span>
          <span className="integration-service-card-meta">{row.signal} {row.signalLabel}</span>
        </div>
        <div className="integration-service-card-actions">
          <Pill tone={isEnabled ? 'free' : 'default'}>{isEnabled ? 'enabled' : 'disabled'}</Pill>
        </div>
      </div>
    ))}
  </div>
</section>
```

**Excerpt — Dialog primitive consumption** (`ActivityDrawer.tsx:39-72`):
```tsx
<Dialog open={open} onClose={onClose} ariaLabel="Activity log">
  <div className="activity-drawer-header">
    <h2 className="activity-drawer-title">Activity Log</h2>
    <div className="activity-drawer-controls">
      <button className="activity-drawer-filter" onClick={onClose} aria-label="Close activity log">
        Close
      </button>
    </div>
  </div>
  {filtered.length === 0 ? (
    <div className="activity-drawer-empty">No activity recorded yet</div>
  ) : (
    <ul className="activity-drawer-list">{/* ... */}</ul>
  )}
</Dialog>
```

**Excerpt — `useTauriEvent` push subscriber pattern** (`activity-log/index.tsx:84-92`):
```tsx
const logRef = useRef(log);
logRef.current = log;

const handleEvent = useCallback((e: Event<ActivityLogEntry>) => {
  const entry = e.payload;
  const next = [entry, ...logRef.current].slice(0, MAX_ENTRIES);
  logRef.current = next;
  setLog(next);
}, []);

useTauriEvent<ActivityLogEntry>(BLADE_EVENTS.ACTIVITY_LOG, handleEvent);
```

**Excerpt — row container + severity stripe + Badge** (compose from `admin.css:39-57` + `primitives.css:172-183`):
```tsx
<button
  type="button"
  className="doctor-row"
  data-severity={signal.severity}
  data-expanded={expanded === signal.class}
  aria-label={`${displayName(signal.class)}. Severity ${signal.severity}. Last changed ${formatTimestamp(signal.last_changed_at)}.`}
  onClick={() => setExpanded(signal.class)}
>
  <span className="doctor-row-name">{displayName(signal.class)}</span>
  <Badge tone={badgeTone(signal.severity)}>{signal.severity.toUpperCase()}</Badge>
  <span className="doctor-row-meta">{formatTimestamp(signal.last_changed_at)}</span>
  <span className="doctor-row-chevron">›</span>
</button>
```

**Copy:**
- `<GlassPanel tier={1} className="admin-surface">` shell from `Diagnostics.tsx:106-107` — Doctor pane lives INSIDE Diagnostics, so the Doctor sub-tab body uses `<section className="diagnostics-section">` (no nested GlassPanel) — pattern matches `IntegrationStatus.tsx:218`
- `formatTimestamp` helper from `IntegrationStatus.tsx:79-86` (then extend with relative-vs-absolute branching per UI-SPEC § 5.6)
- `useCallback` async refresh + try/catch + `setError(typeof e === 'string' ? e : String(e))` from `Diagnostics.tsx:83-94`
- `useTauriEvent<DoctorEventPayload>(BLADE_EVENTS.DOCTOR_EVENT, handler)` — reuse the only-permitted listen surface (D-13)
- `Dialog` primitive verbatim with `triggerRef={rowRef}` per UI-SPEC § 6.6 (the `triggerRef` prop already exists in `Dialog.tsx:42-47`)

**Adapt:**
- Class names: `doctor-row`, `doctor-row-name`, `doctor-row-meta`, `doctor-row-chevron`, `doctor-row--summary`, `doctor-drawer`, `doctor-drawer-header`, `doctor-drawer-title`, `doctor-drawer-meta`, `doctor-drawer-close`, `doctor-drawer-body`, `doctor-drawer-section-label`, `doctor-drawer-fix-copy`, `doctor-drawer-payload-pre`, `doctor-drawer-footer` (UI-SPEC closing paragraph)
- Empty/all-green sparse summary row per UI-SPEC § 7.1 — single `.doctor-row.doctor-row--summary` with `cursor: default; pointer-events: none`
- ListSkeleton on initial mount: `<ListSkeleton rows={5} rowHeight={56} />` (UI-SPEC § 7.2)
- Page-level error: `<EmptyState label="Doctor unavailable" description={...} actionLabel="Retry" onAction={refresh} />` (UI-SPEC § 7.4)
- Manual button label flips `Re-run all checks` ↔ `Re-checking…` (UI-SPEC § 14.2)
- Lazy-loaded via `lazy(() => import('./DoctorPane').then(m => ({ default: m.DoctorPane })))` from Diagnostics.tsx (RESEARCH § G1 step 5)

**Watch out:**
- **Ghost-token trap (v1.1 retraction trigger)** — UI-SPEC § 8 + § 16 lock the token list; planner MUST use ONLY `--status-success / --a-warm / --status-error / --status-idle / --t-4 / --a-ok / --a-warn / --a-hot / --t-1..--t-4 / --line / --g-fill-weak / --g-fill / --g-fill-strong / --g-edge-mid / --s-1..--s-4, --s-8, --s-12 / --r-md / --r-sm / --r-pill / --dur-fast, --dur-base / --ease-out / --font-body, --font-mono`. Inventing `--severity-*` or any other token is the v1.1 ghost-token regression in disguise.
- **Listener leak (P-06)** — `useTauriEvent` is the ONLY permitted listen surface. Do NOT import `listen` from `@tauri-apps/api/event` directly in DoctorPane (banned by ESLint per `events/index.ts:5`)
- **Focus restoration** — pass the row's `<button>` ref via `Dialog`'s `triggerRef` prop or focus falls to the tab pill on close (UI-SPEC § 6.6 mandate)
- **`role="status"` on badge** — color-blind accessibility (UI-SPEC § 12.5); aria-label MUST repeat severity in text BEFORE timestamp
- **`/blade-uat` mandatory** — Phase 17 has UI surface; STATIC GATES ≠ DONE per CLAUDE.md Verification Protocol. Both viewports (1280×800 + 1100×700), drawer-open screenshots, contrast script PASS
- **`docs/testing ss/` literal space** — when saving screenshots, the dir is `docs/testing\ ss/` (memory: `reference_testing_ss_dir.md`)

---

### `src/features/admin/admin-rich-c.css` (CREATE)

**Role:** scoped partial CSS file extending the admin substrate (NEW partial; sibling to `admin-rich-a.css` + `admin-rich-b.css`)
**Closest analog:** `src/features/admin/admin-rich-b.css` (entire file — same partial-extension role, same `@layer features` wrapper, same token usage)

**Excerpt — admin-rich-b.css opening + token style** (`admin-rich-b.css:1-15` + `87-105` + `145-173`):
```css
@layer features {
  /* Section card pattern */
  .diagnostics-section {
    padding: var(--s-3);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }

  .diagnostics-section-title {
    font-weight: 600; font-size: 13px; color: var(--t-1); margin: 0;
  }

  /* Row pattern (.integration-service-card analog) */
  .integration-service-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-2);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    margin-bottom: var(--s-1);
    gap: var(--s-2);
  }

  .integration-service-card-name { font-weight: 600; font-size: 13px; color: var(--t-1); }
  .integration-service-card-meta { color: var(--t-3); font-size: 11px; font-family: var(--font-mono); }
}
```

**Excerpt — severity stripe pattern (canonical)** (`admin.css:49-53`):
```css
.admin-card[data-status="running"]  { border-left: 3px solid var(--status-running); }
.admin-card[data-status="complete"] { border-left: 3px solid var(--status-success); }
.admin-card[data-status="failed"]   { border-left: 3px solid var(--status-error); }
.admin-card[data-status="idle"],
.admin-card:not([data-status])      { border-left: 3px solid var(--status-idle); }
```

**Copy:**
- `@layer features { ... }` wrapper verbatim — every BLADE feature CSS lives in this layer
- The `.diagnostics-section` block + `.diagnostics-section-title` typography rules — Doctor pane is a section inside Diagnostics
- The `.integration-service-card-name` (13px / 600 / `--t-1`) and `.integration-service-card-meta` (11px / mono / `--t-3`) typography for `.doctor-row-name` and `.doctor-row-meta`
- `border-left: Npx solid var(--status-...)` severity stripe pattern from `admin.css:49-53` — Doctor uses 4px (UI-SPEC § 5.3) instead of 3px
- `.diagnostics-config-pre` block (`admin-rich-b.css:107-119`) verbatim for `.doctor-drawer-payload-pre`

**Adapt:**
- New classnames `.doctor-row`, `.doctor-row[data-severity="green|amber|red|unknown|error"]`, `.doctor-row[data-expanded="true"]`, `.doctor-row--summary`, `.doctor-drawer.dialog`, `.doctor-drawer-*` — UI-SPEC § 5.3 + § 6.5 are the verbatim source
- The dialog override `.doctor-drawer.dialog { min-width: min(640px, calc(100vw - var(--s-12))); ... }` extends `dialog.glass` (`primitives.css:185-191`)
- All severity stripe widths are 4px not 3px (UI-SPEC § 5.3 prominence rationale)

**Watch out:**
- **Header comment** — match `admin.css:5` extension rule wording: "Plans 07-05 and 07-06 EXTEND this file via scoped partial CSS files (admin-rich-a.css, admin-rich-b.css); never replace." → Phase 17 partial header should declare itself as "Phase 17 Plan 17-XX EXTENDS admin.css; never replace"
- **`@import` in Diagnostics.tsx or DoctorPane.tsx**, NOT global — match `Diagnostics.tsx:43-44` pattern (`import './admin.css'; import './admin-rich-b.css';`); add `import './admin-rich-c.css';` next to them
- **Token literals are deliberate** — `rgba(255, 255, 255, 0.04)` literal (matches `--g-fill-weak`) is used by `.admin-card`/`.integration-service-card` (per UI-SPEC § 8 final paragraph). Maintain literal-vs-var consistency with surrounding partials
- **Reduced-motion** — already handled globally via `motion.css:40-49`; NO override needed (UI-SPEC § 11.3)

---

### `src/lib/events/payloads.ts` (MODIFY — append)

**Role:** TypeScript payload interface for `DOCTOR_EVENT`
**Closest analog (in same file):** `RoutingCapabilityMissingPayload` lines 58-74 + `BladeMessageStartPayload` lines 109-114 (Phase-specific docblock + interface)

**Excerpt** (`payloads.ts:56-74`):
```typescript
/** Phase 11 Plan 11-04 (D-55) — router emits when a task requires a
 *  capability (vision / audio / long_context / tools) but none of the
 *  user's configured providers support it. ... */
export interface RoutingCapabilityMissingPayload {
  capability: 'vision' | 'audio' | 'long_context' | 'tools';
  task_type: string;
  primary_provider: string;
  primary_model: string;
  message: string;
}
```

**Copy:** the docblock pattern (Phase / Plan / DOCTOR-NN reference + emit context); the `export interface XPayload { ... }` shape; field types use TS literal unions for enum-like fields.

**Adapt:**
- New interface name: `DoctorEventPayload`
- Fields per CONTEXT D-20: `class: 'eval_scores' | 'capability_gaps' | 'tentacle_health' | 'config_drift' | 'auto_update'` (snake_case to match `#[serde(rename_all = "snake_case")]` derive); `severity: 'green' | 'amber' | 'red'`; `prior_severity: 'green' | 'amber' | 'red'`; `last_changed_at: number` (unix milliseconds per CONTEXT § specifics); `payload: unknown` (raw signal payload — typed as unknown because shape varies per class)
- Docblock cites DOCTOR-06 + RESEARCH § F1 + emit site `src-tauri/src/doctor.rs::emit_doctor_event`

**Watch out:**
- **Wire-form snake_case** — Rust serializes enum variants per `#[serde(rename_all = "snake_case")]`; the TS literal union MUST match exactly (`eval_scores` not `EvalScores` not `evalScores`). One mismatch = silent runtime payload mis-classification
- **`unknown` not `any`** — TS `any` is banned in strict mode; use `unknown` and let consumers narrow

---

### `tests/evals/.gitkeep` (CREATE)

**Role:** directory marker — empty file ensures `tests/evals/` is tracked even though `history.jsonl` is gitignored
**Closest analog:** any other `.gitkeep` in the tree (search `find . -name .gitkeep`); it's an empty 0-byte file by convention

**Excerpt:** (none — file is empty)

**Copy:** Just `git add tests/evals/.gitkeep` after creating an empty file. No content.

**Adapt:** Verify `.gitignore` already has `tests/evals/history.jsonl` line (CONTEXT D-14: "the file itself is gitignored — only the directory is committed via `tests/evals/.gitkeep`"); planner: confirm during plan stage. If absent, add `tests/evals/history.jsonl` to `.gitignore`.

**Watch out:** `.gitkeep` is a community convention, not a git feature. The mechanism is simply "empty tracked file in directory you want to keep." Do NOT confuse with `.keep` or any other variant — BLADE's existing convention should be one of these; planner picks whichever the repo already uses.

---

### `src-tauri/src/lib.rs` (MODIFY — 2 surgical edits)

**Role:** module + handler registration (the BLADE 3-step rule)
**Closest analog:** self — `mod supervisor;` at line 80 + `supervisor::supervisor_get_health, supervisor::supervisor_get_service` at lines 1340-1341

**Excerpt — module declaration block** (`lib.rs:75-85`):
```rust
mod show_engine;
mod skeleton;
mod sysadmin;
mod social_cognition;
mod symbolic;
mod supervisor;
mod urinary;
mod embeddings;
#[cfg(test)]
mod evals;
```

**Excerpt — handler registration site** (`lib.rs:1340-1341`):
```rust
            supervisor::supervisor_get_health,
            supervisor::supervisor_get_service,
```

**Copy:** the alphabetical/topical mod block ordering and the `module::command` pattern in `generate_handler!`.

**Adapt:**
- Add `mod doctor;` near other diagnostic modules (after `mod supervisor;` at line 80 is the natural site)
- Add 3 handler entries in `generate_handler![]` adjacent to `supervisor::supervisor_get_health` (lines 1340-1341):
  ```rust
  doctor::doctor_run_full_check,
  doctor::doctor_get_recent,
  doctor::doctor_get_signal,
  ```

**Watch out:**
- **Step 3 of the registration rule (config 6-place) does NOT apply** — Doctor adds zero config fields, so the `DiskConfig` / `BladeConfig` / `load_config` / `save_config` cascade is untouched (CONTEXT § code_context "the 6-place config rule doesn't fire")
- **Flat `#[tauri::command]` namespace** — confirmed via `grep -rn "doctor_" src-tauri/src/` returns zero results (RESEARCH § A3); however watch helper functions like `health_map`, `now_secs`, `register_service` already exist in supervisor / ecosystem — Doctor's privates must NOT collide
- **`use tauri::Manager;` not needed** — Doctor doesn't call `app.state()`; the emitter use is `use tauri::Emitter;`

---

### `src-tauri/src/evals/harness.rs` (MODIFY — append `record_eval_run` + tests)

**Role:** extend with append-only JSONL writer + tests verifying the behavior
**Closest analog:** self — existing module exports (`EvalSummary`, `summarize`, `print_eval_table`, `temp_blade_env`) define the conventions

**Excerpt — existing public function shape** (`harness.rs:90-120`):
```rust
/// Compute "all" + "asserted" (i.e. non-relaxed-only) summaries from a row slice.
pub fn summarize(rows: &[EvalRow]) -> EvalSummary {
    let total = rows.len();
    let top1_count = rows.iter().filter(|r| r.top1).count();
    // ...
    EvalSummary { total, top1_count, /* ... */ }
}
```

**Excerpt — research-supplied target signature** (RESEARCH § B2):
```rust
/// Append a single JSONL line to `tests/evals/history.jsonl` recording one eval run.
/// Phase 17 / DOCTOR-02 source. The file is git-ignored (only `.gitkeep` is committed).
/// On a fresh install the file may not exist; doctor.rs treats "missing" as Green (D-16).
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
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", line);
    }
}
```

**Copy:** the existing `pub fn` style (no `Result` return — silent best-effort matches `print_eval_table`'s println side-effect convention); inline `serde_json::json!({...})` block; `env!("CARGO_MANIFEST_DIR").parent()` repo-root resolution.

**Adapt:**
- The function takes `(module: &str, summary: &EvalSummary, floor_passed: bool)` per CONTEXT D-14
- Recommend RESEARCH § B2 "Option a" (record BEFORE asserts) so failures still get a JSONL entry; if the planner picks this, the eval modules' new line goes BEFORE the existing `assert!` block
- Add a `#[cfg(test)] mod tests { ... }` block at the bottom of `harness.rs` (none exists today — confirmed by tail-read). Test name: `record_eval_run_appends_jsonl`. Use `tempfile::TempDir` and override `CARGO_MANIFEST_DIR` is NOT possible (it's a compile-time `env!`); instead, the test should target a temp path indirectly OR the function should accept an optional path override for testability. Planner: choose between (a) pass `Path` parameter (production callers pass the real path) vs (b) make path resolution a `pub(crate) fn history_jsonl_path() -> PathBuf` so tests can stub via env override at runtime via `std::env::var("BLADE_EVAL_HISTORY_PATH").unwrap_or_else(|| default)`

**Watch out:**
- **`env!()` is compile-time** — cannot be stubbed at test runtime. The test surface needs a path-injection seam
- **`Serialize` derive on `EvalSummary`** — the struct is currently `#[derive(Debug, Clone, Copy)]`. Do NOT add `Serialize` (would force a derive change cascade); construct the JSON inline as RESEARCH § B2 shows
- **`writeln!` truncation** — `serde_json::Value::to_string()` is single-line by default (no embedded newlines unless content contains them); fine for JSONL
- **Append mode vs concurrent runs** — `OpenOptions::new().append(true)` is atomic per write on POSIX for writes < PIPE_BUF; eval modules run sequentially (`--test-threads=1` per harness comment lines 16-17), so no race

---

### `src-tauri/src/evals/{hybrid_search,real_embedding,kg_integrity,typed_memory,capability_gap}_eval.rs` (MODIFY — 1 line each, 5 files)

**Role:** call `harness::record_eval_run(...)` after each eval's `print_eval_table(...)`, before the `assert!` block
**Closest analog:** self — each file already has the insertion site (RESEARCH § B3 lists exact line numbers per file)

**Excerpt — current pattern in `hybrid_search_eval.rs:315-322`**:
```rust
print_eval_table("Hybrid search regression eval (synthetic 4-dim)", &rows);

// Floor enforcement — preserved from `embeddings.rs:698-707`...
let s = summarize(&rows);
let asserted_total = s.asserted_total as f32;
assert!(
    (s.asserted_top3_count as f32 / asserted_total) >= 0.80,
```

**Excerpt — target insertion (RESEARCH § B3 verbatim)**:
```rust
print_eval_table("Hybrid search regression eval (synthetic 4-dim)", &rows);

let s = summarize(&rows);
let floor_passed = (s.asserted_top3_count as f32 / s.asserted_total as f32) >= 0.80
    && s.asserted_mrr >= 0.6;
super::harness::record_eval_run("hybrid_search_eval", &s, floor_passed);
// ... existing asserts continue ...
```

**Copy:** the exact 3-line snippet above (compute `floor_passed`, call `record_eval_run`, then the existing `assert!`) — note that 3 of the 5 modules already compute `let s = summarize(&rows);` for their assert block, so the planner reuses `s` (don't shadow).

**Adapt:**
- Module-name string per file (matches the file basename minus `_eval`):
  - `hybrid_search_eval.rs:315` → `"hybrid_search_eval"`
  - `real_embedding_eval.rs:222` → `"real_embedding_eval"`
  - `kg_integrity_eval.rs:259` → `"kg_integrity_eval"`
  - `typed_memory_eval.rs:191` → `"typed_memory_eval"`
  - `capability_gap_eval.rs:190` → `"capability_gap_eval"`
- The `floor_passed` formula varies per eval — for hybrid_search it's the top-3 ≥ 80% AND MRR ≥ 0.6 form above. The other 4 modules already have their own threshold conditions in their existing assert; reuse those expressions verbatim to compute `floor_passed`

**Watch out:**
- **Floor-passed semantics (RESEARCH § B2 "ASSUMED")** — the recommendation is record BEFORE asserts so a failure still produces a JSONL row. If the planner instead records AFTER asserts (only successes log), Doctor's history will only ever see successes and the Red severity tier (D-05 "breached the asserted floor") will never trigger from history alone. Recommend "before asserts" — confirm with user
- **No new imports** needed — `super::harness::record_eval_run` is already in scope via the `mod harness` sibling pattern (`evals/mod.rs` declares both)
- **Don't shadow `s`** — three modules already have `let s = summarize(&rows);` — reuse, don't redeclare

---

### `src/features/admin/Diagnostics.tsx` (MODIFY — 5 surgical edits)

**Role:** extend tab tuple + DiagTab type literal + readInitialTab guard + render branch + lazy import
**Closest analog:** self — RESEARCH § G1 enumerates all 5 edit sites with exact line numbers

**Excerpt — current type literal + readInitialTab + tabs tuple + render branch** (`Diagnostics.tsx:46-65, 144-177`):
```typescript
type DiagTab = 'health' | 'traces' | 'authority' | 'deep' | 'sysadmin' | 'config';

function readInitialTab(raw: string | number | boolean | undefined): DiagTab {
  if (typeof raw === 'string' && raw.startsWith(TAB_PREF_PREFIX)) {
    const t = raw.slice(TAB_PREF_PREFIX.length) as DiagTab;
    if (
      t === 'health' || t === 'traces' || t === 'authority' ||
      t === 'deep' || t === 'sysadmin' || t === 'config'
    ) {
      return t;
    }
  }
  return DEFAULT_TAB;
}

// ...

<div className="admin-tabs" role="tablist" aria-label="Diagnostics sections">
  {(
    [
      ['health', 'Health'],
      ['traces', 'Traces'],
      ['authority', 'Authority'],
      ['deep', 'Deep scan'],
      ['sysadmin', 'Sysadmin'],
      ['config', 'Config'],
    ] as const
  ).map(([id, label]) => (
    <button /* ... */>{label}</button>
  ))}
</div>

{tab === 'health' && <HealthTab /* ... */ />}
{tab === 'traces' && <TracesTab />}
{tab === 'authority' && <AuthorityTab />}
{tab === 'deep' && <DeepScanTab />}
{tab === 'sysadmin' && <DiagnosticsSysadminTab />}
{tab === 'config' && <ConfigTab />}
```

**Copy:** all 5 patterns as-is — the 7th tab follows the existing 6 verbatim.

**Adapt:**
1. **Type literal** (line 46): add `| 'doctor'`
2. **readInitialTab guard** (line 51-65): add `|| t === 'doctor'`
3. **Tabs tuple** (lines 144-152): append `['doctor', 'Doctor'],` as 7th entry
4. **Render branch** (after line 177): add `{tab === 'doctor' && (<Suspense fallback={<ListSkeleton rows={5} rowHeight={56} />}><DoctorPane /></Suspense>)}`
5. **Lazy import + Suspense import** (top of file, near line 15): change `import { useCallback, useEffect, useMemo, useState }` to also include `lazy, Suspense`; add `const DoctorPane = lazy(() => import('./DoctorPane').then(m => ({ default: m.DoctorPane })));` after the existing imports
6. **Stylesheet import** (after line 44): add `import './admin-rich-c.css';`

**Watch out:**
- **`as const` on the tuple** — preserves the readonly literal types; do NOT remove
- **`role="tab"` aria-selected stays auto** — copying the existing `<button role="tab" aria-selected={tab === id}>` shape; nothing custom for the new tab
- **Doctor sub-tab is text-only** — no icon (UI-SPEC § 14.1); matches surrounding tabs
- **Persistence is automatic** — `prefs['admin.activeTab']` keyed `diag:doctor` works with the existing `usePrefs` mechanism (CONTEXT § code_context "already wired")
- **`Suspense` fallback** — match BLADE convention of `ListSkeleton rows={5} rowHeight={56}` per UI-SPEC § 7.2

---

### `src/lib/events/index.ts` (MODIFY — append 1 entry to BLADE_EVENTS)

**Role:** add `DOCTOR_EVENT: 'doctor_event'` to the frozen registry
**Closest analog:** self — `ACTIVITY_LOG: 'blade_activity_log'` at line 204 (Phase 14 entry, single-window emission, single-event Phase pattern)

**Excerpt** (`index.ts:201-205`):
```typescript
  // ───── Phase 14 — Activity Log (Plan 14-01, LOG-01..05) ──────────────────
  // Emitted by ecosystem.rs emit_activity_with_id() on every observer tick.
  // Payload: ActivityLogEntry (see src/features/activity-log/index.tsx).
  ACTIVITY_LOG: 'blade_activity_log',
} as const;
```

**Copy:** the 5-line block pattern: section banner comment + 1-line emit-site reference + 1-line payload pointer + 1-line entry.

**Adapt:**
- Insertion site: AFTER line 204 (`ACTIVITY_LOG: 'blade_activity_log',`), BEFORE the closing `} as const;`
- New block:
  ```typescript
    // ───── Phase 17 — Doctor Module (DOCTOR-06) ──────────────────────────────
    // Emitted by doctor.rs::emit_doctor_event() on severity transitions
    // (NOT same-severity transitions; NOT green→green; emit only when new severity ∈ {amber, red}).
    // Payload: DoctorEventPayload (see ./payloads.ts).
    DOCTOR_EVENT: 'doctor_event',
  ```

**Watch out:**
- **`as const` is load-bearing** — `BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS]` (line 208) depends on the frozen-literal types; do not remove
- **String value MUST match Rust emit string** — `'doctor_event'` mirrors `app.emit("doctor_event", ...)` in `doctor.rs::emit_doctor_event` (one mismatch = silent no-op subscription)
- **NOT in cross-window allowlist** — single-window emit (broadcast to main only), so the verify-emit-policy.mjs allowlist does not need to be updated (RESEARCH § F2)

---

### `src/lib/tauri/admin.ts` (MODIFY — append 3 wrapper exports)

**Role:** typed `invokeTyped` wrappers for the 3 new Tauri commands
**Closest analog:** self lines 1485-1503 (`supervisorGetHealth` + `supervisorGetService` blocks — same module pattern, same args shape)

**Excerpt** (`admin.ts:1485-1503`):
```typescript
// ═══════════════════════════════════════════════════════════════════════════
// supervisor.rs — background task health (2 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/supervisor.rs:225 supervisor_get_health
 * Rust signature: `supervisor_get_health() -> Vec<ServiceHealth>`.
 */
export function supervisorGetHealth(): Promise<SupervisorService[]> {
  return invokeTyped<SupervisorService[]>('supervisor_get_health');
}

/**
 * @see src-tauri/src/supervisor.rs:233 supervisor_get_service
 * Rust signature: `supervisor_get_service(name: String) -> Option<ServiceHealth>`.
 */
export function supervisorGetService(name: string): Promise<SupervisorService | null> {
  return invokeTyped<SupervisorService | null, { name: string }>('supervisor_get_service', {
    name,
  });
}
```

**Copy:** the section banner format (`════` block with module name + count); the `@see` docblock format with file:line + Rust signature; the `invokeTyped<TReturn, TArgs?>('command_name', argsObject)` shape.

**Adapt:**
- New section banner: `// doctor.rs — diagnostic aggregator (3 commands)`
- Three exports:
  ```typescript
  export function doctorRunFullCheck(): Promise<DoctorSignal[]> {
    return invokeTyped<DoctorSignal[]>('doctor_run_full_check');
  }

  export function doctorGetRecent(opts?: { class?: SignalClass }): Promise<DoctorSignal[]> {
    return invokeTyped<DoctorSignal[], { class?: SignalClass }>('doctor_get_recent', opts ?? {});
  }

  export function doctorGetSignal(klass: SignalClass): Promise<DoctorSignal> {
    return invokeTyped<DoctorSignal, { class: SignalClass }>('doctor_get_signal', { class: klass });
  }
  ```
- Add `DoctorSignal` and `SignalClass` types to `src/features/admin/types.ts` (planner: confirm or pick a sibling location)

**Watch out:**
- **camelCase arg keys** — `invokeTyped`'s `toCamelArgs` converts `{ class: ... }` → `{ class: ... }` (no change since `class` has no underscore). Tauri 2 deserializer uses camelCase keys; `class` is a JS reserved word but works as a param name (the wrapper passes it via param object, not destructuring). NOTE: Rust receives `class` via `#[tauri::command] pub fn doctor_get_signal(class: SignalClass)` — this works in Tauri 2 because `class` is a valid Rust identifier even though reserved in some contexts (verified pattern: many Tauri 2 commands use `type:` etc. via raw idents). Planner: if Rust complains, rename Rust param to `signal_class` and update the JS arg key to `signalClass` accordingly
- **`SignalClass` type literal MUST match `#[serde(rename_all = "snake_case")]`** — same wire-form contract as the event payload
- **`invokeTyped` is the ONLY permitted invoke surface** — banned to import `invoke` from `@tauri-apps/api/core` directly (D-13 + ESLint rule `no-raw-tauri.js`)

---

### `package.json` (no change confirmed)

**Role:** verify-script chain (currently 30 scripts per RESEARCH § J1)
**Decision:** Phase 17 adds ZERO new entries to `package.json verify:all`. Rationale per RESEARCH § J1:
- DOCTOR-02 source artifact comes from existing eval test runs; no new bash gate needed
- DOCTOR-04 source is a Rust-internal API (no shell equivalent)
- Doctor itself is a UI surface — gated by `/blade-uat` runtime UAT, NOT a static-script gate
- Existing scripts (`verify:contrast`, `verify:emit-policy`, `verify:tokens-consistency`, `verify:migration-ledger`) cover Phase 17's static surface

**Watch out:** if the planner discovers a static gate need during plan stage, the new script MUST be added to BOTH the script entry AND the `verify:all` aggregate (per Phase 16 PATTERNS.md exit-code 0/1/2/3 convention). Default for Phase 17: no change.

---

## Shared Patterns

### Authentication / Authorization
**Not applicable** — Doctor is a local-only diagnostic surface. No auth surface; no permission checks beyond the standard Tauri allowlist (already covers Doctor's commands via `tauri::generate_handler!` registration).

### Error Handling
**Source:** `src/features/admin/Diagnostics.tsx:83-94` (catch + setError + finally + setLoading false)
**Apply to:** DoctorPane refresh handler
```typescript
const refresh = useCallback(async () => {
  setLoading(true);
  try {
    const list = await doctorRunFullCheck();
    setSignals(list);
    setError(null);
  } catch (e) {
    setError(typeof e === 'string' ? e : String(e));
  } finally {
    setLoading(false);
  }
}, []);
```

### Tauri Event Subscription
**Source:** `src/features/activity-log/index.tsx:84-92` (handler-in-ref + `useTauriEvent`)
**Apply to:** DoctorPane live `doctor_event` subscription — keep latest signals in a ref to avoid stale closures + ESLint listener-leak rule (P-06).

### `safe_slice` for activity_log summary
**Source:** `CLAUDE.md` "non-ASCII string slicing" rule + `src-tauri/src/ecosystem.rs:54` (`crate::safe_slice(summary, 200)`)
**Apply to:** every Rust `app.emit_to("main", "blade_activity_log", ...)` call site in `doctor.rs`. The `human_summary` field MUST go through `safe_slice`. Never `&summary[..200]`.

### Severity stripe pattern
**Source:** `src/features/admin/admin.css:49-53` (`.admin-card[data-status="..."] { border-left: 3px solid var(--status-...); }`)
**Apply to:** `.doctor-row[data-severity="..."]` rules in `admin-rich-c.css`. UI-SPEC § 5.3 chose 4px (not 3px) for prominence; tokens are `--status-success | --a-warm | --status-error | --status-idle | --t-4` (5 values total, last two for `unknown` and `error` non-chromatic tiers).

### Module-extension partial CSS
**Source:** `src/features/admin/admin.css:5` ("Plans 07-05 and 07-06 EXTEND this file via scoped partial CSS files (admin-rich-a.css, admin-rich-b.css); never replace.")
**Apply to:** `admin-rich-c.css` is the Phase 17 partial. Header comment MUST declare itself as an extension; class names live inside `@layer features { ... }`.

### Frozen registry append
**Source:** `src/lib/events/index.ts:201-205` (Phase 14 ACTIVITY_LOG entry — section banner comment + emit-site reference + payload pointer + 1-line entry)
**Apply to:** the DOCTOR_EVENT addition in `events/index.ts`. Match the 5-line block format verbatim; `as const` is preserved.

---

## No Analog Found

**None.** Every Phase 17 file has a real BLADE analog. This phase is a pure CONSUMER of existing substrate (admin tabs, dialog primitive, supervisor pattern, ecosystem emission, harness module, events registry, tauri wrapper conventions). UI-SPEC § 16 explicitly notes: "every visual decision composes existing BLADE substrate."

---

## Cross-Cutting BLADE Landmines (apply to all plan stages)

| Landmine | Source | Where it bites in Phase 17 |
|----------|--------|----------------------------|
| Flat `#[tauri::command]` namespace | CLAUDE.md "common mistakes" | `doctor_*` is verified clean; private helpers in `doctor.rs` must avoid `health_map`, `now_secs`, `register_service` |
| Module registration 3-step | CLAUDE.md "Module registration (EVERY TIME)" | `mod doctor;` + 3 `generate_handler![]` entries; 6-place config rule does NOT fire |
| `safe_slice` on user content | CLAUDE.md "Don't use `&text[..n]`" + memory `feedback_uat_evidence.md` | Every `app.emit_to("main", "blade_activity_log", ...)` `human_summary` field |
| Ghost CSS tokens | memory `project_ghost_css_tokens.md` (v1.1 retraction trigger — 210 refs across 9 files) | UI-SPEC § 8 + § 16 lock the token list; NEVER invent `--severity-*` or `--doctor-*` tokens |
| Listener leak (P-06) | `src/lib/events/index.ts:5` ESLint rule | DoctorPane MUST use `useTauriEvent`; raw `listen` import = lint failure |
| `/blade-uat` runtime evidence | CLAUDE.md "Verification Protocol" + memory `feedback_uat_evidence.md` | Phase 17 has UI surface — static gates ≠ done; both viewports + 4 screenshots + Read-back required |
| `docs/testing ss/` literal space | memory `reference_testing_ss_dir.md` | Quote bash paths: `"docs/testing ss/17-doctor-1280.png"` |
| Chat streaming "missed once = silent regression" pattern (general principle) | memory `project_chat_streaming_contract.md` | `doctor_event` emission has the same shape: every transition branch must emit; one missed branch = silent regression on the strip |
| Authority files override scratch ideation | memory `feedback_read_authority_files_first.md` | CONTEXT.md D-01..D-21 + UI-SPEC § 1..§ 17 are LOCKED; planner does NOT re-decide |

---

## Metadata

**Analog search scope:** `src-tauri/src/` (Rust modules), `src/features/admin/` (UI siblings), `src/features/activity-log/` (drawer + emission consumer), `src/design-system/primitives/` (Dialog + Badge + EmptyState + ListSkeleton), `src/lib/events/` (registry + payloads), `src/lib/tauri/` (invoke wrappers), `src/styles/` (tokens + motion + typography)
**Files scanned:** 18 (read or grep-confirmed live; every file:line reference verified against the live tree on 2026-04-30)
**Pattern extraction date:** 2026-04-30
**Source authorities (re-read before planning):**
- `.planning/phases/17-doctor-module/17-CONTEXT.md` (D-01..D-21 LOCKED)
- `.planning/phases/17-doctor-module/17-RESEARCH.md` (file:line citations for every primitive)
- `.planning/phases/17-doctor-module/17-UI-SPEC.md` (visual contract — § 8 token list + § 15 fix-copy verbatim)
- `CLAUDE.md` (BLADE 3-step module rule + flat namespace + safe_slice + Verification Protocol)

## PATTERN MAPPING COMPLETE
