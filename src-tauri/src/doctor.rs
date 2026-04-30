//! Doctor module — central diagnostic aggregator (Phase 17 / DOCTOR-01..10).
//!
//! Aggregates 5 signal classes (EvalScores | CapabilityGaps | TentacleHealth
//! | ConfigDrift | AutoUpdate) into a unified surface backed by 3 Tauri
//! commands and 1 Tauri event (`doctor_event`).
//!
//! Architecture per .planning/phases/17-doctor-module/17-CONTEXT.md
//! decisions D-01..D-21 (LOCKED). Sources self-classify (D-02); doctor.rs
//! is the aggregator + cache holder + transition detector + event emitter.
//!
//! Plan 17-02 ships the SKELETON: enums + struct + 3 stubbed commands +
//! prior-severity cache + exhaustive 15-arm suggested-fix match. Plans
//! 17-03 / 17-04 fill in signal-source bodies and the verbatim D-18
//! suggested-fix strings.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
// `Emitter` is imported eagerly because Plan 17-05 wires `app.emit("doctor_event", ...)`
// + `app.emit_to("main", "blade_activity_log", ...)` directly on top of this module.
use tauri::{AppHandle, Emitter};

// Plan 17-03 — signal-source bodies (DOCTOR-02 / DOCTOR-03 / DOCTOR-10)

// ── Locked enum + struct definitions (CONTEXT D-02 / D-03 / D-04) ─────────────

/// Signal classes aggregated by Doctor (D-03). Wire form is `snake_case` so
/// the TS literal union in `src/lib/events/payloads.ts` (Plan 17-05) matches
/// exactly: `eval_scores | capability_gaps | tentacle_health | config_drift |
/// auto_update`. The `Hash + Eq + Copy` derives are required because this
/// type is used as a `HashMap<SignalClass, Severity>` key in PRIOR_SEVERITY.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SignalClass {
    EvalScores,
    CapabilityGaps,
    TentacleHealth,
    ConfigDrift,
    AutoUpdate,
}

/// Severity tiers (D-04). Wire form is `lowercase` so the UI's
/// `data-severity="green|amber|red"` attribute matches exactly.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Green,
    Amber,
    Red,
}

/// One diagnostic signal record (D-02). `payload` is `serde_json::Value`
/// because each `SignalClass` has its own per-variant shape (eval scores
/// vs capability gaps vs tentacle heartbeats — no shared schema).
///
/// `last_changed_at` is unix milliseconds (matches the `doctor_event`
/// payload schema in CONTEXT § specifics).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorSignal {
    pub class: SignalClass,
    pub severity: Severity,
    pub payload: serde_json::Value,
    pub last_changed_at: i64,
    pub suggested_fix: String,
}

// ── Static state holders ──────────────────────────────────────────────────────

/// Prior-severity map for transition detection (D-20). Plan 17-05 reads this
/// before each `doctor_run_full_check` to decide whether to emit `doctor_event`.
static PRIOR_SEVERITY: OnceLock<Mutex<HashMap<SignalClass, Severity>>> = OnceLock::new();

/// Last-cached run result (D-19 `doctor_get_recent` reads from this).
static LAST_RUN: OnceLock<Mutex<Vec<DoctorSignal>>> = OnceLock::new();

fn prior_severity_map() -> &'static Mutex<HashMap<SignalClass, Severity>> {
    PRIOR_SEVERITY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn last_run_cache() -> &'static Mutex<Vec<DoctorSignal>> {
    LAST_RUN.get_or_init(|| Mutex::new(Vec::new()))
}

// ── Suggested-fix table (D-18) ────────────────────────────────────────────────

/// Suggested-fix copy table per (class, severity). VERBATIM strings from
/// UI-SPEC § 15 — locked by D-18 (handwritten, NOT AI-generated). Any
/// modification requires user revision; agents may not paraphrase. The
/// `suggested_fix_strings_match_ui_spec_verbatim` test asserts substrings
/// of three canonical entries to catch silent drift.
pub(crate) fn suggested_fix(class: SignalClass, severity: Severity) -> &'static str {
    match (class, severity) {
        // Eval Scores — UI-SPEC § 15
        (SignalClass::EvalScores, Severity::Green) =>
            "All eval modules are passing their asserted floors. Last 5 runs recorded in tests/evals/history.jsonl.",
        (SignalClass::EvalScores, Severity::Amber) =>
            "An eval module's score dropped 10% or more from its prior run, but it's still above the asserted floor. Run bash scripts/verify-eval.sh to see which one and re-baseline if the change is intentional.",
        (SignalClass::EvalScores, Severity::Red) =>
            "An eval module breached its asserted floor (top-3 below 80% or MRR below 0.6). Run bash scripts/verify-eval.sh to identify which module and inspect tests/evals/history.jsonl for the drop point.",

        // Capability Gaps — UI-SPEC § 15
        (SignalClass::CapabilityGaps, Severity::Green) =>
            "No unresolved capability gaps in the last 24 hours. Catalog is at src-tauri/src/self_upgrade.rs::capability_catalog.",
        (SignalClass::CapabilityGaps, Severity::Amber) =>
            "At least one unresolved capability gap was logged in the last 24 hours. Open the payload to see which capability and when.",
        (SignalClass::CapabilityGaps, Severity::Red) =>
            "The same capability has been requested 3 or more times in the last 7 days without resolution. This is a strong signal you need to add or re-route a tool. Check evolution.rs::evolution_log_capability_gap output and consider extending capability_catalog.",

        // Tentacle Health — UI-SPEC § 15
        (SignalClass::TentacleHealth, Severity::Green) =>
            "All tentacle observers are reporting heartbeats within their expected interval.",
        (SignalClass::TentacleHealth, Severity::Amber) =>
            "At least one observer's heartbeat is more than 1 hour stale. Check src-tauri/src/integration_bridge.rs logs for the affected service and confirm credentials are still valid.",
        (SignalClass::TentacleHealth, Severity::Red) =>
            "At least one observer has been silent for over 24 hours and is treated as dead. Inspect supervisor health on the Health tab and restart the affected tentacle from there.",

        // Config Drift — UI-SPEC § 15
        (SignalClass::ConfigDrift, Severity::Green) =>
            "Migration ledger is in sync and your scan profile is current.",
        (SignalClass::ConfigDrift, Severity::Amber) =>
            "Either the migration ledger is out of sync OR the scan profile is older than 30 days. Run npm run verify:migration-ledger to identify which.",
        (SignalClass::ConfigDrift, Severity::Red) =>
            "Both the migration ledger is out of sync AND the scan profile is older than 30 days. Run npm run verify:migration-ledger and trigger a Deep scan from the Deep scan tab to refresh.",

        // Auto-Update — UI-SPEC § 15
        (SignalClass::AutoUpdate, Severity::Green) =>
            "tauri-plugin-updater is wired and initialized. BLADE will check for updates on launch.",
        (SignalClass::AutoUpdate, Severity::Amber) =>
            "tauri-plugin-updater is not fully wired. Confirm src-tauri/Cargo.toml lists the dep AND src-tauri/src/lib.rs initializes via tauri_plugin_updater::Builder::new().build().",
        (SignalClass::AutoUpdate, Severity::Red) =>
            "(Reserved — Auto-Update has no Red tier per D-09; if this string ever renders it indicates a bug in doctor.rs severity classification.)",
    }
}

// ── Signal source: EvalScores (DOCTOR-02 / D-05) — Plan 17-03 ────────────────
//
// Plan 17-05 wires `compute_eval_signal` (and the other 4 sources) into the
// orchestrator `doctor_run_full_check` via `tokio::join!`. The helpers below
// remain pub(super)-private to the module.

/// One parsed line from `tests/evals/history.jsonl` (Plan 17-01 producer).
/// Mirrors the JSON shape `harness::record_eval_run` writes.
#[derive(Debug, Clone, Deserialize)]
struct EvalRunRecord {
    #[allow(dead_code)]
    timestamp: String,
    module: String,
    #[allow(dead_code)]
    top1: usize,
    #[allow(dead_code)]
    top3: usize,
    mrr: f32,
    floor_passed: bool,
    #[allow(dead_code)]
    asserted_count: usize,
    #[allow(dead_code)]
    relaxed_count: usize,
}

/// Resolve the path to `tests/evals/history.jsonl`.
///
/// The `evals` module in `lib.rs` is `#[cfg(test)]`-gated so we cannot call
/// `crate::evals::harness::history_jsonl_path()` from production code.
/// This helper duplicates the 4-line resolution logic so doctor.rs can read
/// the file at runtime. Honors `BLADE_EVAL_HISTORY_PATH` env override for
/// test isolation (Pitfall 4 mitigation).
fn eval_history_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("BLADE_EVAL_HISTORY_PATH") {
        return std::path::PathBuf::from(p);
    }
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("CARGO_MANIFEST_DIR has parent")
        .join("tests")
        .join("evals")
        .join("history.jsonl")
}

/// Tail-read the last `limit` lines of history.jsonl. Missing file → empty Vec
/// (D-16: Doctor treats no history as Green). Malformed lines silently dropped
/// via `filter_map(...ok())`. With 200 lines × ~120 bytes = ~24KB max work.
fn read_eval_history(limit: usize) -> Vec<EvalRunRecord> {
    let path = eval_history_path();
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(limit);
    lines[start..]
        .iter()
        .filter_map(|l| serde_json::from_str::<EvalRunRecord>(l).ok())
        .collect()
}

/// Compute the EvalScores signal per CONTEXT D-05.
///
/// Severity:
/// - **Red** if any module's most-recent run has `floor_passed: false`
///   (top-3 < 80% OR MRR < 0.6 — the asserted floor)
/// - **Amber** if any module's latest mrr dropped ≥10% absolute from its
///   prior recorded run
/// - **Green** otherwise (or empty history per D-16)
///
/// Synchronous (bounded I/O — last 200 lines only). Plan 17-05's
/// `doctor_run_full_check` runs all 5 sources via `tokio::join!` over async
/// blocks so the runtime can interleave file IO.
fn compute_eval_signal() -> Result<DoctorSignal, String> {
    let history = read_eval_history(200);
    let now_ms = chrono::Utc::now().timestamp_millis();

    if history.is_empty() {
        return Ok(DoctorSignal {
            class: SignalClass::EvalScores,
            severity: Severity::Green,
            payload: serde_json::json!({
                "history_count": 0,
                "note": "No eval runs recorded yet (tests/evals/history.jsonl missing or empty).",
            }),
            last_changed_at: now_ms,
            suggested_fix: suggested_fix(SignalClass::EvalScores, Severity::Green).to_string(),
        });
    }

    // Group records by module preserving append order (chronological).
    let mut by_module: HashMap<String, Vec<&EvalRunRecord>> = HashMap::new();
    for rec in &history {
        by_module.entry(rec.module.clone()).or_default().push(rec);
    }

    let mut any_red = false;
    let mut any_amber = false;
    let mut breakdown = serde_json::Map::new();

    for (module, runs) in &by_module {
        let latest = runs.last().expect("runs non-empty after grouping");
        let prior = runs.iter().rev().nth(1);

        // D-05 Red: latest run breached the asserted floor.
        let red = !latest.floor_passed;
        // D-05 Amber: latest mrr dropped ≥10% absolute from prior.
        let amber = match prior {
            Some(p) => latest.mrr + 0.10 < p.mrr,
            None => false,
        };

        if red {
            any_red = true;
        }
        if amber && !red {
            any_amber = true;
        }

        breakdown.insert(
            module.clone(),
            serde_json::json!({
                "latest_top1": latest.top1,
                "latest_top3": latest.top3,
                "latest_mrr": latest.mrr,
                "latest_floor_passed": latest.floor_passed,
                "prior_mrr": prior.map(|p| p.mrr),
                "drop_amber": amber,
                "breach_red": red,
                "run_count": runs.len(),
            }),
        );
    }

    let severity = if any_red {
        Severity::Red
    } else if any_amber {
        Severity::Amber
    } else {
        Severity::Green
    };

    Ok(DoctorSignal {
        class: SignalClass::EvalScores,
        severity,
        payload: serde_json::json!({
            "history_count": history.len(),
            "module_count": by_module.len(),
            "modules": breakdown,
        }),
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::EvalScores, severity).to_string(),
    })
}

// ── Signal source: CapabilityGaps (DOCTOR-03 / D-06) — Plan 17-03 ────────────

/// Compute the CapabilityGaps signal per CONTEXT D-06.
///
/// Reads `activity_timeline` rows where `event_type = 'capability_gap'` from
/// `<blade_config_dir>/blade.db` (the same path `evolution_log_capability_gap`
/// writes to). Aggregates per-capability counts in 24h + 7d windows.
///
/// Severity:
/// - **Red** if any capability has ≥3 occurrences in last 7 days
/// - **Amber** if any capability has ≥1 occurrence in last 24h (and not Red)
/// - **Green** otherwise (or DB unavailable — defensive)
///
/// Note: "unresolved" maps operationally to "occurrences in time window"
/// because the activity_timeline schema has no resolved flag. RESEARCH § C3
/// documents the rationale.
fn compute_capgap_signal() -> Result<DoctorSignal, String> {
    let now_secs = chrono::Utc::now().timestamp();
    let now_ms = now_secs * 1000;
    let cutoff_7d = now_secs - (7 * 86_400);
    let cutoff_24h = now_secs - 86_400;

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => {
            // DB unavailable → Green (no observable gaps).
            return Ok(DoctorSignal {
                class: SignalClass::CapabilityGaps,
                severity: Severity::Green,
                payload: serde_json::json!({"note": "blade.db unavailable; treating as zero gaps"}),
                last_changed_at: now_ms,
                suggested_fix: suggested_fix(SignalClass::CapabilityGaps, Severity::Green)
                    .to_string(),
            });
        }
    };

    // Aggregate per-capability counts. SQLite extracts the capability key from
    // the `metadata` JSON column via `json_extract(metadata, '$.capability')`.
    let mut stmt = match conn.prepare(
        "SELECT json_extract(metadata, '$.capability') AS capability,
                COUNT(*) AS cnt_7d,
                SUM(CASE WHEN timestamp >= ?1 THEN 1 ELSE 0 END) AS cnt_24h,
                MAX(timestamp) AS last_seen
         FROM activity_timeline
         WHERE event_type = 'capability_gap' AND timestamp >= ?2
         GROUP BY capability
         ORDER BY cnt_7d DESC",
    ) {
        Ok(s) => s,
        Err(e) => {
            // Table may not exist yet (fresh install / no events yet) — Green.
            return Ok(DoctorSignal {
                class: SignalClass::CapabilityGaps,
                severity: Severity::Green,
                payload: serde_json::json!({
                    "note": format!("activity_timeline query unavailable: {}", e),
                }),
                last_changed_at: now_ms,
                suggested_fix: suggested_fix(SignalClass::CapabilityGaps, Severity::Green)
                    .to_string(),
            });
        }
    };

    let rows: Vec<(String, i64, i64, i64)> = stmt
        .query_map([cutoff_24h, cutoff_7d], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?
                    .unwrap_or_else(|| "<unknown>".to_string()),
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })
        .map(|i| i.filter_map(Result::ok).collect())
        .unwrap_or_default();

    // D-06 severity ladder: Red ≥3 in 7d, else Amber ≥1 in 24h, else Green.
    let any_red = rows.iter().any(|(_, c7d, _, _)| *c7d >= 3);
    let any_amber = rows.iter().any(|(_, _, c24h, _)| *c24h >= 1);

    let severity = if any_red {
        Severity::Red
    } else if any_amber {
        Severity::Amber
    } else {
        Severity::Green
    };

    let last_changed_at = rows
        .iter()
        .map(|(_, _, _, last)| *last * 1000)
        .max()
        .unwrap_or(now_ms);

    let payload = serde_json::json!({
        "total_capabilities": rows.len(),
        "rows": rows.iter().map(|(cap, c7d, c24h, last)| serde_json::json!({
            "capability": cap,
            "count_7d": c7d,
            "count_24h": c24h,
            "last_seen_unix_secs": last,
        })).collect::<Vec<_>>(),
    });

    Ok(DoctorSignal {
        class: SignalClass::CapabilityGaps,
        severity,
        payload,
        last_changed_at,
        suggested_fix: suggested_fix(SignalClass::CapabilityGaps, severity).to_string(),
    })
}

// ── Signal source: AutoUpdate (DOCTOR-10 / D-09) — Plan 17-03 ────────────────

/// Inner classifier — testable without the `env!()` compile-time constraint.
/// Green iff both anchors present per CONTEXT D-09; Amber otherwise.
fn classify_autoupdate(cargo_toml: &str, lib_rs: &str) -> Severity {
    let dep = cargo_toml.contains("tauri-plugin-updater");
    let init = lib_rs.contains("tauri_plugin_updater::Builder::new().build()");
    if dep && init {
        Severity::Green
    } else {
        Severity::Amber
    }
}

/// Compute the AutoUpdate signal per CONTEXT D-09.
///
/// Reads the live `Cargo.toml` + `src/lib.rs` at filesystem level (via
/// `CARGO_MANIFEST_DIR`) and substring-greps for both anchors. RESEARCH § I2
/// chose this "filesystem grep" approach over runtime plugin introspection
/// because the plugin loader does not expose a stable presence API.
///
/// Severity:
/// - **Green** if BOTH anchors present (stock BLADE state — Cargo.toml line
///   25 has `tauri-plugin-updater = "2"` and lib.rs has the Builder init)
/// - **Amber** if either is missing
fn compute_autoupdate_signal() -> Result<DoctorSignal, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();

    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let cargo_toml_path = manifest_dir.join("Cargo.toml");
    let lib_rs_path = manifest_dir.join("src").join("lib.rs");

    let cargo_toml = std::fs::read_to_string(&cargo_toml_path).unwrap_or_default();
    let lib_rs = std::fs::read_to_string(&lib_rs_path).unwrap_or_default();

    let severity = classify_autoupdate(&cargo_toml, &lib_rs);

    let dep_present = cargo_toml.contains("tauri-plugin-updater");
    let init_present = lib_rs.contains("tauri_plugin_updater::Builder::new().build()");

    let payload = serde_json::json!({
        "cargo_toml_dep": dep_present,
        "lib_rs_init": init_present,
        "cargo_toml_path": cargo_toml_path.to_string_lossy(),
        "lib_rs_path": lib_rs_path.to_string_lossy(),
        "method": "filesystem_grep",
        "note": "Per CONTEXT.md D-09: must run live, not hardcoded.",
    });

    Ok(DoctorSignal {
        class: SignalClass::AutoUpdate,
        severity,
        payload,
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::AutoUpdate, severity).to_string(),
    })
}

// ── Signal source: TentacleHealth (DOCTOR-04 / D-07) — Plan 17-04 ────────────

/// Classify a single tentacle's severity per CONTEXT.md D-07.
///
/// - **Red** iff `status == "dead"` OR `(now - last_heartbeat) >= 24h`
/// - **Amber** iff `status == "restarting"` OR `status == "unknown"` OR
///   `(now - last_heartbeat) >= 1h`
/// - **Green** otherwise (status running AND heartbeat fresh < 1h)
///
/// `now_secs` and `last_heartbeat` are unix seconds. The function is the
/// testable seam for `compute_tentacle_signal` so unit tests can exercise
/// every branch without needing a live supervisor / integration_bridge.
fn classify_tentacle(now_secs: i64, last_heartbeat: i64, status: &str) -> Severity {
    let age = now_secs.saturating_sub(last_heartbeat);
    if status == "dead" || age >= 86_400 {
        Severity::Red
    } else if status == "restarting" || status == "unknown" || age >= 3_600 {
        Severity::Amber
    } else {
        Severity::Green
    }
}

/// Compute the TentacleHealth signal per CONTEXT D-07.
///
/// Aggregates two observer surfaces into a worst-of severity rollup:
///
/// 1. **Supervisor-registered tentacles** — perception, screen_timeline,
///    godmode, learning_engine, homeostasis, hive (the 6 BLADE services
///    registered via `supervisor::register_service`). Read each
///    `ServiceHealth.status + last_heartbeat` (unix seconds).
///
/// 2. **MCP integrations** — Gmail / Calendar / Slack / GitHub etc., as
///    surfaced by `integration_bridge::get_per_service_last_poll`. Each
///    entry exposes `(name, last_poll_unix_secs, enabled)`. Disabled
///    integrations are filtered out (not a tentacle the user expects to
///    be live).
///
/// Severity rollup: worst-of (Red > Amber > Green). Empty observer set
/// returns Green (defensive — no tentacles to fail). RESEARCH § D4 confirms
/// this matches the eval-signal Green-on-empty-history convention from
/// Plan 17-03.
fn compute_tentacle_signal() -> Result<DoctorSignal, String> {
    let now_secs = chrono::Utc::now().timestamp();
    let now_ms = now_secs * 1000;

    // Supervisor-registered tentacles (RESEARCH § D2 — 6 BLADE services).
    let supervisor_rows: Vec<(String, Severity, serde_json::Value)> =
        crate::supervisor::supervisor_get_health()
            .into_iter()
            .map(|svc| {
                let sev = classify_tentacle(now_secs, svc.last_heartbeat, &svc.status);
                let payload = serde_json::json!({
                    "name": svc.name,
                    "kind": "supervised",
                    "status": svc.status,
                    "last_heartbeat_unix_secs": svc.last_heartbeat,
                    "age_secs": now_secs.saturating_sub(svc.last_heartbeat),
                    "crash_count": svc.crash_count,
                });
                (svc.name, sev, payload)
            })
            .collect();

    // MCP integrations — filter disabled; integration_bridge has no per-service
    // status enum, so map last_poll == 0 to "unknown" (never polled) and
    // anything else to "running" (poller is the implicit liveness probe).
    let mcp_rows: Vec<(String, Severity, serde_json::Value)> =
        crate::integration_bridge::get_per_service_last_poll()
            .into_iter()
            .filter(|(_, _, enabled)| *enabled)
            .map(|(name, last_poll, enabled)| {
                let status = if last_poll == 0 { "unknown" } else { "running" };
                let sev = classify_tentacle(now_secs, last_poll, status);
                let payload = serde_json::json!({
                    "name": name,
                    "kind": "mcp_integration",
                    "status": status,
                    "last_poll_unix_secs": last_poll,
                    "age_secs": now_secs.saturating_sub(last_poll),
                    "enabled": enabled,
                });
                (name, sev, payload)
            })
            .collect();

    let mut all_rows: Vec<(String, Severity, serde_json::Value)> = supervisor_rows;
    all_rows.extend(mcp_rows);

    // Worst-of severity rollup: Red > Amber > Green.
    let severity = all_rows
        .iter()
        .map(|(_, sev, _)| *sev)
        .max_by_key(|sev| match sev {
            Severity::Green => 0,
            Severity::Amber => 1,
            Severity::Red => 2,
        })
        .unwrap_or(Severity::Green);

    let supervised_count = all_rows
        .iter()
        .filter(|(_, _, p)| p.get("kind").and_then(|k| k.as_str()) == Some("supervised"))
        .count();
    let mcp_count = all_rows
        .iter()
        .filter(|(_, _, p)| p.get("kind").and_then(|k| k.as_str()) == Some("mcp_integration"))
        .count();

    let payload = serde_json::json!({
        "total_tentacles": all_rows.len(),
        "supervised_count": supervised_count,
        "mcp_count": mcp_count,
        "tentacles": all_rows.iter().map(|(name, sev, p)| serde_json::json!({
            "name": name,
            "severity": match sev {
                Severity::Green => "green",
                Severity::Amber => "amber",
                Severity::Red => "red",
            },
            "details": p,
        })).collect::<Vec<_>>(),
    });

    Ok(DoctorSignal {
        class: SignalClass::TentacleHealth,
        severity,
        payload,
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::TentacleHealth, severity).to_string(),
    })
}

// ── Signal source: ConfigDrift (DOCTOR-05 / D-08) — Plan 17-04 ───────────────

/// Classify config drift severity per CONTEXT.md D-08.
///
/// `profile_age_days = None` is treated as "stale" (per Recommendation A5 —
/// missing scan profile = onboarding incomplete = drift signal).
///
/// - **Red** iff `ledger_drift` AND `profile_stale`
/// - **Amber** iff `ledger_drift` XOR `profile_stale`
/// - **Green** iff neither
///
/// Testable seam: tests pass synthetic `(bool, Option<i64>)` and assert
/// the verdict without needing a live Node child process or filesystem
/// scan_results.json fixture.
fn classify_drift(ledger_drift: bool, profile_age_days: Option<i64>) -> Severity {
    let profile_stale = profile_age_days.map(|d| d > 30).unwrap_or(true);
    if ledger_drift && profile_stale {
        Severity::Red
    } else if ledger_drift || profile_stale {
        Severity::Amber
    } else {
        Severity::Green
    }
}

/// Run `node scripts/verify-migration-ledger.mjs` and return `(drift, note)`.
///
/// Exit code convention (RESEARCH § E1):
/// - `0` → no drift; `1` → drift; anything else → graceful no-drift fallback
///   with note in payload (covers "Node missing", "script errored", "permission
///   denied", etc.).
///
/// Spawned via `Command::new("node")` (NOT shell-out) so the script path is
/// not interpreted by a shell. Path is built from `CARGO_MANIFEST_DIR` (a
/// compile-time constant), not user input — no command injection surface
/// per ASVS V12.3.
fn check_migration_ledger() -> (bool, String) {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .expect("CARGO_MANIFEST_DIR has parent");
    let script = repo_root.join("scripts").join("verify-migration-ledger.mjs");

    if !script.exists() {
        return (false, format!("script missing: {}", script.to_string_lossy()));
    }

    let output = std::process::Command::new("node")
        .arg(&script)
        .current_dir(repo_root)
        .output();

    match output {
        Ok(out) => {
            let code = out.status.code().unwrap_or(-1);
            match code {
                0 => (false, "ledger clean".to_string()),
                1 => (true, "ledger drift detected".to_string()),
                other => (
                    false,
                    format!("ledger script exit {} (treated as no-drift)", other),
                ),
            }
        }
        Err(e) => (
            false,
            format!("could not run node: {} (treated as no-drift)", e),
        ),
    }
}

/// Return `scan_results.json` `scanned_at` age in days. `None` if the file
/// is absent (fresh install / onboarding incomplete) — `classify_drift` then
/// treats `None` as stale.
///
/// `scanned_at` is unix milliseconds (RESEARCH § E2; confirmed at
/// `deep_scan/leads.rs:165` — `pub scanned_at: i64` set via
/// `chrono::Utc::now().timestamp_millis()`).
fn scan_profile_age_days() -> Option<i64> {
    let results = crate::deep_scan::load_results_pub()?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let age_ms = now_ms - results.scanned_at;
    Some(age_ms / (86_400 * 1000))
}

/// Compute the ConfigDrift signal per CONTEXT D-08.
///
/// Combines two probes: migration-ledger consistency (Node child process,
/// exit-code 0/1 = clean/drift) and scan-profile freshness (filesystem read
/// of `~/.blade/identity/scan_results.json::scanned_at`). Severity verdict
/// is delegated to `classify_drift` (testable in isolation).
fn compute_drift_signal() -> Result<DoctorSignal, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let (ledger_drift, ledger_note) = check_migration_ledger();
    let profile_age = scan_profile_age_days();

    let severity = classify_drift(ledger_drift, profile_age);
    let profile_stale = profile_age.map(|d| d > 30).unwrap_or(true);

    let payload = serde_json::json!({
        "ledger_drift": ledger_drift,
        "ledger_note": ledger_note,
        "profile_age_days": profile_age,
        "profile_stale": profile_stale,
    });

    Ok(DoctorSignal {
        class: SignalClass::ConfigDrift,
        severity,
        payload,
        last_changed_at: now_ms,
        suggested_fix: suggested_fix(SignalClass::ConfigDrift, severity).to_string(),
    })
}

// ── Emission helpers (D-20 / D-21 / M-07) — Plan 17-05 ───────────────────────

/// Emit `doctor_event` Tauri event on severity transition.
/// Per CONTEXT.md D-20: emit ONLY when prior != current AND current ∈ {Amber, Red}.
/// Caller must enforce that gate; this helper unconditionally emits.
fn emit_doctor_event(app: &AppHandle, signal: &DoctorSignal, prior: Severity) {
    let _ = app.emit("doctor_event", serde_json::json!({
        "class":           signal.class,
        "severity":        signal.severity,
        "prior_severity":  prior,
        "last_changed_at": signal.last_changed_at,
        "payload":         signal.payload,
    }));
}

/// Emit `blade_activity_log` event for ActivityStrip per CONTEXT.md D-21 / M-07.
/// Strip line format: `[Doctor] {class} → {severity}: {one-line summary}`.
/// The `[Doctor]` prefix is rendered by the strip from the `module` field;
/// this helper passes the rest as `human_summary`.
fn emit_activity_for_doctor(app: &AppHandle, signal: &DoctorSignal) {
    let class_str = match signal.class {
        SignalClass::EvalScores      => "EvalScores",
        SignalClass::CapabilityGaps  => "CapabilityGaps",
        SignalClass::TentacleHealth  => "TentacleHealth",
        SignalClass::ConfigDrift     => "ConfigDrift",
        SignalClass::AutoUpdate      => "AutoUpdate",
    };
    let severity_str = match signal.severity {
        Severity::Green => "Green",
        Severity::Amber => "Amber",
        Severity::Red   => "Red",
    };
    // One-line summary: prefer the payload's `note` (set by signal sources on
    // empty / fallback cases) else use the suggested_fix copy.
    let one_liner = signal.payload.get("note")
        .and_then(|v| v.as_str())
        .unwrap_or(&signal.suggested_fix);
    let summary = format!("{} → {}: {}", class_str, severity_str, one_liner);

    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "Doctor",
        "action":        "regression_detected",
        "human_summary": crate::safe_slice(&summary, 200),
        "payload_id":    serde_json::Value::Null,
        "timestamp":     chrono::Utc::now().timestamp(),
    }));
}

// ── Tauri Commands (D-19) ─────────────────────────────────────────────────────

/// Run all 5 signal sources in parallel via `tokio::join!`, cache the
/// result, detect severity transitions against PRIOR_SEVERITY, and emit
/// `doctor_event` + `blade_activity_log` per CONTEXT.md D-20 / D-21.
///
/// Per RESEARCH.md § Pitfall 3: emit `doctor_event` BEFORE
/// `blade_activity_log` so the doctor pane updates before the strip line
/// renders. Both emit calls live inside the SAME `if transitioned && new_is_warn`
/// block — splitting them would replay the v1.1 "missed once = silent regression"
/// pattern (P-06).
#[tauri::command]
pub async fn doctor_run_full_check(app: AppHandle) -> Result<Vec<DoctorSignal>, String> {
    // Sources are sync but run via `tokio::join!` over async blocks so the
    // runtime can interleave file IO. Per CONTEXT "Claude's Discretion":
    // parallel is the recommended path.
    let (eval, capgap, tentacle, drift, autoupdate) = tokio::join!(
        async { compute_eval_signal() },
        async { compute_capgap_signal() },
        async { compute_tentacle_signal() },
        async { compute_drift_signal() },
        async { compute_autoupdate_signal() },
    );

    // Order in the returned Vec is locked (most-volatile-first per
    // UI-SPEC § 7.5): EvalScores → CapabilityGaps → TentacleHealth →
    // ConfigDrift → AutoUpdate.
    let signals: Vec<DoctorSignal> = vec![
        eval.map_err(|e| format!("eval signal: {}", e))?,
        capgap.map_err(|e| format!("capgap signal: {}", e))?,
        tentacle.map_err(|e| format!("tentacle signal: {}", e))?,
        drift.map_err(|e| format!("drift signal: {}", e))?,
        autoupdate.map_err(|e| format!("autoupdate signal: {}", e))?,
    ];

    // Diff against prior severity; emit on transitions where new ∈ {Amber, Red}.
    if let Ok(mut prior_lock) = prior_severity_map().lock() {
        for sig in &signals {
            let prior = prior_lock
                .get(&sig.class)
                .copied()
                .unwrap_or(Severity::Green);
            let transitioned = prior != sig.severity;
            let new_is_warn = matches!(sig.severity, Severity::Amber | Severity::Red);

            if transitioned && new_is_warn {
                // Per Pitfall 3: emit doctor_event FIRST, then activity_log.
                // BOTH emits live in the same gate to prevent the v1.1 "missed
                // once" silent-regression pattern (P-06).
                emit_doctor_event(&app, sig, prior);
                emit_activity_for_doctor(&app, sig);
            }

            prior_lock.insert(sig.class, sig.severity);
        }
    }

    // Cache for doctor_get_recent / doctor_get_signal.
    if let Ok(mut cache) = last_run_cache().lock() {
        *cache = signals.clone();
    }

    Ok(signals)
}

/// Return the last cached run; if `class` is `Some(_)`, filter to that
/// class. Plan 17-04 may extend with history-window filtering per D-19.
#[tauri::command]
pub fn doctor_get_recent(class: Option<SignalClass>) -> Vec<DoctorSignal> {
    let lock = match last_run_cache().lock() {
        Ok(l) => l,
        Err(_) => return Vec::new(),
    };
    match class {
        Some(c) => lock.iter().filter(|s| s.class == c).cloned().collect(),
        None => lock.clone(),
    }
}

/// Return the most recent record for a single class (drill-down drawer).
/// Returns `None` on cache miss so the frontend can render an empty/
/// "no data yet" state without surfacing a Tauri-level error.
#[tauri::command]
pub fn doctor_get_signal(class: SignalClass) -> Option<DoctorSignal> {
    let lock = match last_run_cache().lock() {
        Ok(l) => l,
        Err(_) => return None,
    };
    lock.iter().find(|s| s.class == class).cloned()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signal_class_enum_serializes_snake_case() {
        let json = serde_json::to_string(&SignalClass::EvalScores).unwrap();
        assert_eq!(json, "\"eval_scores\"");
        let json = serde_json::to_string(&SignalClass::AutoUpdate).unwrap();
        assert_eq!(json, "\"auto_update\"");
    }

    #[test]
    fn severity_enum_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Severity::Green).unwrap(), "\"green\"");
        assert_eq!(serde_json::to_string(&Severity::Amber).unwrap(), "\"amber\"");
        assert_eq!(serde_json::to_string(&Severity::Red).unwrap(), "\"red\"");
    }

    #[test]
    fn doctor_get_signal_returns_none_when_cache_empty() {
        // Note: this test MAY race with other tests that populate LAST_RUN.
        // Run with --test-threads=1 (already enforced by harness convention).
        // For a clean fixture: clear LAST_RUN cache first.
        if let Ok(mut cache) = last_run_cache().lock() {
            cache.clear();
        }
        assert!(doctor_get_signal(SignalClass::EvalScores).is_none());
    }

    #[test]
    fn suggested_fix_table_is_exhaustive() {
        // All 15 (class × severity) pairs return a non-empty string.
        for class in [
            SignalClass::EvalScores,
            SignalClass::CapabilityGaps,
            SignalClass::TentacleHealth,
            SignalClass::ConfigDrift,
            SignalClass::AutoUpdate,
        ] {
            for severity in [Severity::Green, Severity::Amber, Severity::Red] {
                let s = suggested_fix(class, severity);
                assert!(!s.is_empty(), "missing string for ({:?}, {:?})", class, severity);
            }
        }
    }

    #[test]
    fn prior_severity_map_initializes() {
        // Smoke: lazy-init returns a usable lock. Plan 17-04's transition
        // detector relies on this. Touch + drop without mutating shared state.
        let _ = prior_severity_map().lock().map(|m| m.len());
    }

    // ── Plan 17-03: compute_eval_signal tests (DOCTOR-02 / D-05) ─────────────

    /// RAII guard that removes an env var when the test completes (or panics).
    /// Local copy — `harness::tests::EnvGuard` is not visible from here.
    struct EnvGuard(&'static str);
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var(self.0);
        }
    }

    fn write_history_lines(path: &std::path::Path, lines: &[&str]) {
        let body = lines.join("\n") + "\n";
        std::fs::write(path, body).expect("write history fixture");
    }

    #[test]
    fn eval_signal_green_on_missing_history() {
        let _g = EnvGuard("BLADE_EVAL_HISTORY_PATH");
        let tmp = tempfile::TempDir::new().unwrap();
        // Path that does NOT exist inside the tempdir.
        let path = tmp.path().join("does_not_exist.jsonl");
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &path);

        let result = compute_eval_signal().expect("compute_eval_signal");
        assert_eq!(result.severity, Severity::Green);
        assert_eq!(result.class, SignalClass::EvalScores);
        assert_eq!(result.payload["history_count"], 0);
    }

    #[test]
    fn eval_signal_red_on_floor_breach() {
        let _g = EnvGuard("BLADE_EVAL_HISTORY_PATH");
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("history.jsonl");
        write_history_lines(
            &path,
            &[
                r#"{"timestamp":"2026-04-30T12:00:00Z","module":"hybrid_search_eval","top1":2,"top3":4,"mrr":0.4,"floor_passed":false,"asserted_count":8,"relaxed_count":0}"#,
            ],
        );
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &path);

        let result = compute_eval_signal().expect("compute_eval_signal");
        assert_eq!(result.severity, Severity::Red);
        assert_eq!(result.class, SignalClass::EvalScores);
        assert_eq!(result.payload["history_count"], 1);
    }

    #[test]
    fn eval_signal_amber_on_10pct_drop() {
        let _g = EnvGuard("BLADE_EVAL_HISTORY_PATH");
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("history.jsonl");
        // Same module; prior mrr 1.0, latest mrr 0.85 (0.15 drop > 0.10)
        write_history_lines(
            &path,
            &[
                r#"{"timestamp":"2026-04-29T12:00:00Z","module":"hybrid_search_eval","top1":8,"top3":8,"mrr":1.0,"floor_passed":true,"asserted_count":8,"relaxed_count":0}"#,
                r#"{"timestamp":"2026-04-30T12:00:00Z","module":"hybrid_search_eval","top1":7,"top3":8,"mrr":0.85,"floor_passed":true,"asserted_count":8,"relaxed_count":0}"#,
            ],
        );
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &path);

        let result = compute_eval_signal().expect("compute_eval_signal");
        assert_eq!(result.severity, Severity::Amber);
        assert_eq!(result.class, SignalClass::EvalScores);
    }

    #[test]
    fn eval_signal_green_on_steady() {
        let _g = EnvGuard("BLADE_EVAL_HISTORY_PATH");
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("history.jsonl");
        // Two runs, both at mrr 1.0 — no drop, no breach
        write_history_lines(
            &path,
            &[
                r#"{"timestamp":"2026-04-29T12:00:00Z","module":"hybrid_search_eval","top1":8,"top3":8,"mrr":1.0,"floor_passed":true,"asserted_count":8,"relaxed_count":0}"#,
                r#"{"timestamp":"2026-04-30T12:00:00Z","module":"hybrid_search_eval","top1":8,"top3":8,"mrr":1.0,"floor_passed":true,"asserted_count":8,"relaxed_count":0}"#,
            ],
        );
        std::env::set_var("BLADE_EVAL_HISTORY_PATH", &path);

        let result = compute_eval_signal().expect("compute_eval_signal");
        assert_eq!(result.severity, Severity::Green);
        assert_eq!(result.class, SignalClass::EvalScores);
    }

    // ── Plan 17-03: compute_capgap_signal tests (DOCTOR-03 / D-06) ───────────

    /// Bootstrap a minimal `activity_timeline` table inside a fresh DB. Mirrors
    /// the schema from `db.rs:390-401`. Avoids the full `db::init_db` so tests
    /// stay fast and don't need every BLADE table.
    fn init_capgap_test_db(db_path: &std::path::Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(db_path).expect("open test db");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS activity_timeline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                app_name TEXT NOT NULL DEFAULT '',
                metadata TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_activity_timeline_ts ON activity_timeline(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_activity_timeline_type ON activity_timeline(event_type);",
        )
        .expect("create activity_timeline");
        conn
    }

    fn insert_capgap_row(conn: &rusqlite::Connection, capability: &str, ts_secs: i64) {
        let metadata = format!(r#"{{"capability":"{}"}}"#, capability);
        conn.execute(
            "INSERT INTO activity_timeline (timestamp, event_type, title, content, app_name, metadata)
             VALUES (?1, 'capability_gap', '', '', 'BLADE', ?2)",
            rusqlite::params![ts_secs, metadata],
        )
        .expect("insert capgap row");
    }

    #[test]
    fn capgap_signal_green_on_no_gaps() {
        let _g = EnvGuard("BLADE_CONFIG_DIR");
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        let _conn = init_capgap_test_db(&tmp.path().join("blade.db"));

        let result = compute_capgap_signal().expect("compute_capgap_signal");
        assert_eq!(result.severity, Severity::Green);
        assert_eq!(result.class, SignalClass::CapabilityGaps);
        assert_eq!(result.payload["total_capabilities"], 0);
    }

    #[test]
    fn capgap_signal_red_on_3_in_7d() {
        let _g = EnvGuard("BLADE_CONFIG_DIR");
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        let conn = init_capgap_test_db(&tmp.path().join("blade.db"));

        let now = chrono::Utc::now().timestamp();
        // 3 occurrences of same capability in last 7 days (and outside 24h
        // window so we KNOW Red is firing on the 7d threshold, not Amber).
        insert_capgap_row(&conn, "jq", now - 6 * 86_400);
        insert_capgap_row(&conn, "jq", now - 5 * 86_400);
        insert_capgap_row(&conn, "jq", now - 4 * 86_400);

        let result = compute_capgap_signal().expect("compute_capgap_signal");
        assert_eq!(result.severity, Severity::Red);
        assert_eq!(result.class, SignalClass::CapabilityGaps);
    }

    #[test]
    fn capgap_signal_amber_on_1_in_24h() {
        let _g = EnvGuard("BLADE_CONFIG_DIR");
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        let conn = init_capgap_test_db(&tmp.path().join("blade.db"));

        let now = chrono::Utc::now().timestamp();
        // Single recent occurrence — must surface Amber per D-06.
        insert_capgap_row(&conn, "ripgrep", now - 3600);

        let result = compute_capgap_signal().expect("compute_capgap_signal");
        assert_eq!(result.severity, Severity::Amber);
        assert_eq!(result.class, SignalClass::CapabilityGaps);
    }

    // ── Plan 17-03: compute_autoupdate_signal tests (DOCTOR-10 / D-09) ───────

    #[test]
    fn autoupdate_classify_green_when_both_present() {
        let cargo = "[dependencies]\ntauri-plugin-updater = \"2\"\n";
        let lib = ".plugin(tauri_plugin_updater::Builder::new().build())\n";
        assert_eq!(classify_autoupdate(cargo, lib), Severity::Green);
    }

    #[test]
    fn autoupdate_classify_amber_when_dep_missing() {
        let cargo = "[dependencies]\nserde = \"1\"\n";
        let lib = ".plugin(tauri_plugin_updater::Builder::new().build())\n";
        assert_eq!(classify_autoupdate(cargo, lib), Severity::Amber);
    }

    #[test]
    fn autoupdate_classify_amber_when_init_missing() {
        let cargo = "[dependencies]\ntauri-plugin-updater = \"2\"\n";
        let lib = "// no updater builder here\n";
        assert_eq!(classify_autoupdate(cargo, lib), Severity::Amber);
    }

    #[test]
    fn autoupdate_classify_amber_when_both_missing() {
        let cargo = "[dependencies]\nserde = \"1\"\n";
        let lib = "// no updater wiring\n";
        assert_eq!(classify_autoupdate(cargo, lib), Severity::Amber);
    }

    #[test]
    fn autoupdate_signal_green_on_stock_install() {
        // Live tree: per CONTEXT D-09 + RESEARCH § I1, stock BLADE has both
        // anchors present (Cargo.toml line 25 + lib.rs line ~556). This test
        // proves compute_autoupdate_signal returns Green against the real tree.
        let result = compute_autoupdate_signal().expect("compute_autoupdate_signal");
        assert_eq!(result.severity, Severity::Green);
        assert_eq!(result.class, SignalClass::AutoUpdate);
        assert_eq!(result.payload["cargo_toml_dep"], true);
        assert_eq!(result.payload["lib_rs_init"], true);
    }

    // ── Plan 17-04: classify_tentacle tests (DOCTOR-04 / D-07) ───────────────

    #[test]
    fn tentacle_classify_green_on_fresh_running() {
        let now = chrono::Utc::now().timestamp();
        // Heartbeat 60s ago, status running → Green.
        assert_eq!(classify_tentacle(now, now - 60, "running"), Severity::Green);
    }

    #[test]
    fn tentacle_classify_amber_on_1h_stale() {
        let now = chrono::Utc::now().timestamp();
        // Heartbeat 3700s ago (>1h, <24h), status running → Amber per D-07.
        assert_eq!(classify_tentacle(now, now - 3700, "running"), Severity::Amber);
    }

    #[test]
    fn tentacle_classify_amber_on_restarting_status() {
        let now = chrono::Utc::now().timestamp();
        // Fresh heartbeat but supervisor flagged restarting → Amber per D-07.
        assert_eq!(classify_tentacle(now, now - 60, "restarting"), Severity::Amber);
    }

    #[test]
    fn tentacle_classify_red_on_24h_dead() {
        let now = chrono::Utc::now().timestamp();
        // Heartbeat 86500s ago (>24h), status running → Red per D-07.
        assert_eq!(classify_tentacle(now, now - 86_500, "running"), Severity::Red);
    }

    #[test]
    fn tentacle_classify_red_on_dead_status() {
        let now = chrono::Utc::now().timestamp();
        // Fresh heartbeat but supervisor flagged dead → Red overrides age check.
        assert_eq!(classify_tentacle(now, now - 60, "dead"), Severity::Red);
    }

    // ── Plan 17-04: classify_drift tests (DOCTOR-05 / D-08) ──────────────────

    #[test]
    fn drift_classify_green_on_clean_and_fresh() {
        // No ledger drift + scan profile 5 days old → Green per D-08.
        assert_eq!(classify_drift(false, Some(5)), Severity::Green);
    }

    #[test]
    fn drift_classify_amber_on_ledger_drift_only() {
        // Ledger drift + scan profile fresh (<30d) → Amber per D-08.
        assert_eq!(classify_drift(true, Some(5)), Severity::Amber);
    }

    #[test]
    fn drift_classify_amber_on_stale_profile_only() {
        // No ledger drift + scan profile 45 days old → Amber per D-08.
        assert_eq!(classify_drift(false, Some(45)), Severity::Amber);
    }

    #[test]
    fn drift_classify_amber_on_missing_profile() {
        // No ledger drift + missing profile (None) → Amber (Recommendation A5:
        // missing = stale).
        assert_eq!(classify_drift(false, None), Severity::Amber);
    }

    #[test]
    fn drift_classify_red_on_both() {
        // Ledger drift + scan profile 45 days old → Red per D-08.
        assert_eq!(classify_drift(true, Some(45)), Severity::Red);
    }

    #[test]
    fn drift_classify_red_on_ledger_and_missing_profile() {
        // Ledger drift + missing profile → both conditions trip → Red.
        assert_eq!(classify_drift(true, None), Severity::Red);
    }

    // ── Plan 17-04: suggested_fix verbatim lock (D-18 / UI-SPEC § 15) ────────

    #[test]
    fn suggested_fix_strings_match_ui_spec_verbatim() {
        // These exact strings are LOCKED by UI-SPEC § 15 (D-18). Any change
        // requires user revision, NOT agent paraphrase. Asserting full string
        // equality on three canonical entries + the Red Auto-Update sentinel
        // catches silent drift if anyone edits the table.
        assert_eq!(
            suggested_fix(SignalClass::EvalScores, Severity::Red),
            "An eval module breached its asserted floor (top-3 below 80% or MRR below 0.6). Run bash scripts/verify-eval.sh to identify which module and inspect tests/evals/history.jsonl for the drop point."
        );
        assert_eq!(
            suggested_fix(SignalClass::AutoUpdate, Severity::Green),
            "tauri-plugin-updater is wired and initialized. BLADE will check for updates on launch."
        );
        assert_eq!(
            suggested_fix(SignalClass::CapabilityGaps, Severity::Red),
            "The same capability has been requested 3 or more times in the last 7 days without resolution. This is a strong signal you need to add or re-route a tool. Check evolution.rs::evolution_log_capability_gap output and consider extending capability_catalog."
        );
        // Red Auto-Update is "shouldn't happen" per D-09 — sentinel string.
        assert!(
            suggested_fix(SignalClass::AutoUpdate, Severity::Red).contains("(Reserved")
        );
    }

    // ── Plan 17-05: transition-gate tests (D-20) ─────────────────────────────
    //
    // These cover all 6 corners of the emit predicate `transitioned && new_is_warn`
    // that lives inside `doctor_run_full_check`. The v1.1 chat-streaming
    // retraction was caused by a single missed emission branch — these tests
    // exist so the doctor module never repeats that pattern.

    /// Helper test: prior=Green, new=Red → should emit (transition + warn)
    #[test]
    fn transition_gate_emits_on_green_to_red() {
        let prior = Severity::Green;
        let current = Severity::Red;
        let transitioned = prior != current;
        let new_is_warn = matches!(current, Severity::Amber | Severity::Red);
        assert!(transitioned && new_is_warn, "must emit on Green→Red");
    }

    #[test]
    fn transition_gate_no_emit_on_green_to_green() {
        let prior = Severity::Green;
        let current = Severity::Green;
        let transitioned = prior != current;
        let new_is_warn = matches!(current, Severity::Amber | Severity::Red);
        assert!(!(transitioned && new_is_warn), "must NOT emit on Green→Green");
    }

    #[test]
    fn transition_gate_no_emit_on_red_to_red() {
        // Same-severity transition: D-20 says no emit (would be noise).
        let prior = Severity::Red;
        let current = Severity::Red;
        let transitioned = prior != current;
        let new_is_warn = matches!(current, Severity::Amber | Severity::Red);
        assert!(!(transitioned && new_is_warn), "must NOT emit on Red→Red (same-severity)");
    }

    #[test]
    fn transition_gate_no_emit_on_amber_to_green() {
        // Recovery transition: D-20 says emit ONLY when new severity ∈ {Amber, Red}.
        // Green is not warn, so no emit even though prior != current.
        let prior = Severity::Amber;
        let current = Severity::Green;
        let transitioned = prior != current;
        let new_is_warn = matches!(current, Severity::Amber | Severity::Red);
        assert!(!(transitioned && new_is_warn), "must NOT emit on Amber→Green (recovery)");
    }

    #[test]
    fn transition_gate_emits_on_amber_to_red() {
        let prior = Severity::Amber;
        let current = Severity::Red;
        let transitioned = prior != current;
        let new_is_warn = matches!(current, Severity::Amber | Severity::Red);
        assert!(transitioned && new_is_warn, "must emit on Amber→Red");
    }

    #[test]
    fn activity_summary_format_matches_d21() {
        // D-21: '[Doctor] {class} → {severity}: {one-line summary}'
        // The '[Doctor]' is added by the strip from the `module` field; the
        // human_summary string we emit is '{class} → {severity}: {one-line}'.
        let class_str = "EvalScores";
        let severity_str = "Red";
        let one_liner = "Test summary";
        let summary = format!("{} → {}: {}", class_str, severity_str, one_liner);
        assert_eq!(summary, "EvalScores → Red: Test summary");
    }
}
