#![allow(dead_code)] // Tentacle module — feature-complete, wired via hive

/// BLADE Log Monitor Tentacle — Production log intelligence.
///
/// Tails log files and HTTP log endpoints in real-time, detects error patterns,
/// correlates multi-service failures, and groups errors Sentry-style by stack
/// trace fingerprint. All log entries are written to blade.db `log_entries`
/// with FTS for fast search.
///
/// Functions:
///   - start_log_tailing   — background task that tails files / HTTP sources
///   - detect_anomalies    — error rate spikes, new error types, repeating errors
///   - correlate_errors    — chain errors that happen together (401→500→blank)
///   - get_error_groups    — Sentry-style grouping by fingerprint

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri::AppHandle;

// ── Global stop flag ──────────────────────────────────────────────────────────

static TAILING_ACTIVE: AtomicBool = AtomicBool::new(false);

// ── DB helpers ────────────────────────────────────────────────────────────────

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&path).map_err(|e| format!("LogMonitor DB: {e}"))
}

/// Create the log_entries table with FTS if not present.
pub fn ensure_tables() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("log_monitor ensure_tables: {e}");
            return;
        }
    };

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS log_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            source      TEXT NOT NULL,
            level       TEXT NOT NULL DEFAULT 'info',
            message     TEXT NOT NULL,
            fingerprint TEXT,
            timestamp   INTEGER NOT NULL,
            raw_line    TEXT
        );
        CREATE INDEX IF NOT EXISTS log_entries_ts   ON log_entries(timestamp);
        CREATE INDEX IF NOT EXISTS log_entries_fp   ON log_entries(fingerprint);
        CREATE INDEX IF NOT EXISTS log_entries_lvl  ON log_entries(level);
        CREATE VIRTUAL TABLE IF NOT EXISTS log_entries_fts
            USING fts5(message, source, content='log_entries', content_rowid='id');
        CREATE TRIGGER IF NOT EXISTS log_entries_ai
            AFTER INSERT ON log_entries BEGIN
                INSERT INTO log_entries_fts(rowid, message, source)
                VALUES (new.id, new.message, new.source);
            END;",
    );
}

fn insert_log_entry(source: &str, level: &str, message: &str, fingerprint: &str, raw_line: &str) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let _ = conn.execute(
        "INSERT INTO log_entries (source, level, message, fingerprint, timestamp, raw_line)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![source, level, message, fingerprint, now, raw_line],
    );
}

// ── Log parsing ───────────────────────────────────────────────────────────────

/// Determine the log level from a raw log line.
fn detect_level(line: &str) -> &'static str {
    let lower = line.to_lowercase();
    if lower.contains("fatal") || lower.contains("critical") {
        "fatal"
    } else if lower.contains("error") || lower.contains("exception") || lower.contains("panic") {
        "error"
    } else if lower.contains("warn") {
        "warn"
    } else if lower.contains("debug") || lower.contains("trace") {
        "debug"
    } else {
        "info"
    }
}

/// Compute a stable fingerprint for a log line.
/// Stack trace lines and hex addresses are normalised so similar errors group together.
fn compute_fingerprint(line: &str) -> String {
    // Normalise: hex addresses, numbers, timestamps, UUIDs
    let normalised = line
        .split_whitespace()
        .map(|token| {
            if token.starts_with("0x") || token.len() == 32 || token.len() == 36 {
                "<id>"
            } else if token.chars().all(|c| c.is_ascii_digit() || c == '.') {
                "<n>"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    // Simple 64-bit FNV-1a hash → hex
    let mut hash: u64 = 14_695_981_039_346_656_037;
    for byte in normalised.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    format!("{hash:016x}")
}

/// Extract a human-readable message from a raw log line (strip timestamps/log level prefix).
fn extract_message(line: &str) -> String {
    // Common patterns: "[2026-04-15 09:00:00] ERROR: ..." or "ERROR 2026-04-15 ..."
    let after_level: &str = ["ERROR", "WARN", "INFO", "DEBUG", "FATAL", "CRITICAL"]
        .iter()
        .find_map(|lvl| {
            line.find(lvl).map(|idx| {
                let rest = &line[idx + lvl.len()..];
                rest.trim_start_matches(|c: char| c == ':' || c == ' ')
            })
        })
        .unwrap_or(line);

    crate::safe_slice(after_level.trim(), 500).to_string()
}

// ── Public output types ───────────────────────────────────────────────────────

/// A detected log anomaly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogAnomaly {
    pub anomaly_type: AnomalyKind,
    pub source: String,
    pub message: String,
    pub fingerprint: String,
    pub count: u32,
    /// Unix seconds of the first occurrence in the window.
    pub first_seen: i64,
    /// Unix seconds of the most recent occurrence.
    pub last_seen: i64,
    /// 0.0–1.0 severity score.
    pub severity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnomalyKind {
    ErrorRateSpike,
    NewErrorType,
    RepeatingError,
    StackTrace,
}

/// A causal chain of correlated errors across services.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorChain {
    /// Human-readable description of the chain, e.g. "Auth 401 → Gateway 500 → Frontend blank".
    pub description: String,
    /// The ordered anomaly fingerprints in the chain.
    pub fingerprints: Vec<String>,
    /// Window in which all errors occurred (seconds).
    pub window_secs: u64,
    /// Likely root cause hypothesis.
    pub root_cause: String,
}

/// Sentry-style error group.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorGroup {
    pub fingerprint: String,
    pub title: String,
    pub source: String,
    pub level: String,
    pub count: u32,
    pub first_seen: i64,
    pub last_seen: i64,
    /// Most recent representative log line.
    pub sample: String,
}

// ── 1. start_log_tailing ──────────────────────────────────────────────────────

/// Start tailing log files and/or HTTP log endpoints.
/// Each path is either:
///   - An absolute file path  → tail with file seek
///   - A URL (http/https)     → poll every 10 seconds
///
/// Emits `log-anomaly` Tauri events when anomalies are detected.
/// Idempotent: if already running, does nothing.
pub async fn start_log_tailing(app: AppHandle, paths: Vec<String>) {
    if TAILING_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }

    ensure_tables();

    tauri::async_runtime::spawn(async move {
        let mut file_positions: HashMap<String, u64> = HashMap::new();

        loop {
            let mut new_lines: Vec<(String, String)> = Vec::new(); // (source, line)

            for path in &paths {
                if path.starts_with("http://") || path.starts_with("https://") {
                    // HTTP polling
                    if let Ok(resp) = reqwest::get(path).await {
                        if let Ok(body) = resp.text().await {
                            for line in body.lines().rev().take(50) {
                                new_lines.push((path.clone(), line.to_string()));
                            }
                        }
                    }
                } else {
                    // File tail
                    use tokio::io::{AsyncReadExt, AsyncSeekExt};
                    if let Ok(mut file) = tokio::fs::File::open(path).await {
                        let pos = file_positions.get(path).copied().unwrap_or(0);
                        let metadata = file.metadata().await.ok();
                        let file_len = metadata.map(|m| m.len()).unwrap_or(0);

                        if file_len > pos {
                            let _ = file
                                .seek(std::io::SeekFrom::Start(pos))
                                .await;
                            let mut buf = Vec::new();
                            let _ = file.read_to_end(&mut buf).await;
                            let content = String::from_utf8_lossy(&buf).to_string();
                            file_positions.insert(path.clone(), file_len);

                            for line in content.lines() {
                                if !line.trim().is_empty() {
                                    new_lines.push((path.clone(), line.to_string()));
                                }
                            }
                        }
                    }
                }
            }

            // Persist new lines to DB
            for (source, line) in &new_lines {
                let level = detect_level(line);
                let message = extract_message(line);
                let fingerprint = compute_fingerprint(line);
                insert_log_entry(source, level, &message, &fingerprint, line);
            }

            // Run anomaly detection on the new batch
            let messages: Vec<String> = new_lines.iter().map(|(_, l)| l.clone()).collect();
            if !messages.is_empty() {
                let anomalies = detect_anomalies(&messages).await;
                for anomaly in anomalies {
                    let payload = serde_json::to_string(&anomaly).unwrap_or_default();
                    let _ = app.emit_to("main", "log-anomaly", payload);
                }
            }

            if !TAILING_ACTIVE.load(Ordering::SeqCst) {
                break;
            }

            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
}

/// Stop the log tailing background task.
pub fn stop_log_tailing() {
    TAILING_ACTIVE.store(false, Ordering::SeqCst);
}

// ── 2. detect_anomalies ───────────────────────────────────────────────────────

/// Analyse a batch of log lines for anomalies.
pub async fn detect_anomalies(logs: &[String]) -> Vec<LogAnomaly> {
    let mut anomalies = Vec::new();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Count by fingerprint in the current batch
    let mut fp_count: HashMap<String, (u32, String, &str)> = HashMap::new(); // fp → (count, message, level)
    for line in logs {
        let fp = compute_fingerprint(line);
        let level = detect_level(line);
        let msg = extract_message(line);
        let entry = fp_count.entry(fp).or_insert((0, msg, level));
        entry.0 += 1;
    }

    // Detect repeating errors (same fingerprint ≥ 3 times in this batch)
    for (fp, (count, msg, level)) in &fp_count {
        if *count >= 3 && (*level == "error" || *level == "fatal") {
            anomalies.push(LogAnomaly {
                anomaly_type: AnomalyKind::RepeatingError,
                source: "batch".to_string(),
                message: msg.clone(),
                fingerprint: fp.clone(),
                count: *count,
                first_seen: now,
                last_seen: now,
                severity: ((*count as f32) / 10.0).clamp(0.3, 1.0),
            });
        }
    }

    // Detect stack traces
    for line in logs {
        if line.contains("at ") && (line.contains(".rs:") || line.contains(".py:") || line.contains(".js:") || line.contains("Traceback")) {
            let fp = compute_fingerprint(line);
            anomalies.push(LogAnomaly {
                anomaly_type: AnomalyKind::StackTrace,
                source: "batch".to_string(),
                message: extract_message(line),
                fingerprint: fp,
                count: 1,
                first_seen: now,
                last_seen: now,
                severity: 0.8,
            });
        }
    }

    // Detect error rate spike: compare to recent DB baseline
    let error_count_batch = logs
        .iter()
        .filter(|l| detect_level(l) == "error" || detect_level(l) == "fatal")
        .count() as f32;

    if error_count_batch > 0.0 {
        if let Ok(conn) = open_db() {
            let window_start = now - 300; // last 5 min
            let recent_avg: f64 = conn
                .query_row(
                    "SELECT CAST(COUNT(*) AS REAL) / 5.0 FROM log_entries
                     WHERE level IN ('error','fatal') AND timestamp > ?1",
                    params![window_start],
                    |row| row.get::<_, f64>(0),
                )
                .unwrap_or(0.0);

            // Spike = batch rate > 2× recent average
            let batch_rate = error_count_batch / (logs.len() as f32).max(1.0);
            if recent_avg > 0.0 && (batch_rate as f64) > recent_avg * 2.0 {
                anomalies.push(LogAnomaly {
                    anomaly_type: AnomalyKind::ErrorRateSpike,
                    source: "aggregate".to_string(),
                    message: format!(
                        "Error rate spiked: {:.1}% of batch vs {:.1}% baseline",
                        batch_rate * 100.0,
                        recent_avg * 100.0
                    ),
                    fingerprint: "error-rate-spike".to_string(),
                    count: error_count_batch as u32,
                    first_seen: now,
                    last_seen: now,
                    severity: 0.9,
                });
            }
        }
    }

    // New error type detection: fingerprints not seen before in DB
    for (fp, (_, msg, level)) in &fp_count {
        if *level != "error" && *level != "fatal" {
            continue;
        }
        if let Ok(conn) = open_db() {
            let count_in_db: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM log_entries WHERE fingerprint = ?1",
                    params![fp],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if count_in_db == 0 {
                anomalies.push(LogAnomaly {
                    anomaly_type: AnomalyKind::NewErrorType,
                    source: "batch".to_string(),
                    message: msg.clone(),
                    fingerprint: fp.clone(),
                    count: 1,
                    first_seen: now,
                    last_seen: now,
                    severity: 0.75,
                });
            }
        }
    }

    anomalies.dedup_by(|a, b| a.fingerprint == b.fingerprint && a.anomaly_type.eq_type(&b.anomaly_type));
    anomalies
}

impl AnomalyKind {
    fn eq_type(&self, other: &AnomalyKind) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

// ── 3. correlate_errors ───────────────────────────────────────────────────────

/// Find groups of anomalies that occur within 60 seconds of each other,
/// suggesting a causal chain (e.g. Auth 401 → Gateway 500 → Frontend blank page).
pub async fn correlate_errors(anomalies: &[LogAnomaly]) -> Vec<ErrorChain> {
    if anomalies.len() < 2 {
        return vec![];
    }

    let mut sorted: Vec<&LogAnomaly> = anomalies.iter().collect();
    sorted.sort_by_key(|a| a.first_seen);

    let mut chains: Vec<Vec<&LogAnomaly>> = Vec::new();
    let mut current_chain: Vec<&LogAnomaly> = vec![sorted[0]];

    for i in 1..sorted.len() {
        let prev = sorted[i - 1];
        let curr = sorted[i];
        if (curr.first_seen - prev.first_seen).abs() <= 60 {
            current_chain.push(curr);
        } else {
            if current_chain.len() >= 2 {
                chains.push(current_chain.clone());
            }
            current_chain = vec![curr];
        }
    }
    if current_chain.len() >= 2 {
        chains.push(current_chain);
    }

    let mut error_chains = Vec::new();

    for chain in chains {
        let fingerprints: Vec<String> = chain.iter().map(|a| a.fingerprint.clone()).collect();
        let descriptions: Vec<String> = chain
            .iter()
            .map(|a| crate::safe_slice(&a.message, 60).to_string())
            .collect();
        let description = descriptions.join(" → ");

        let window_secs = (chain.last().unwrap().last_seen - chain.first().unwrap().first_seen)
            .unsigned_abs() as u64;

        // Ask LLM for root cause hypothesis
        let prompt = format!(
            "These errors occurred in sequence within {window_secs} seconds:\n{description}\n\n\
             In one sentence, what is the most likely root cause?"
        );
        let root_cause = crate::tentacles::log_monitor::llm_complete_internal(&prompt)
            .await
            .unwrap_or_else(|_| "Unknown — investigate the first error in the chain.".to_string());

        error_chains.push(ErrorChain {
            description,
            fingerprints,
            window_secs,
            root_cause,
        });
    }

    error_chains
}

async fn llm_complete_internal(prompt: &str) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let cfg = crate::config::load_config();
    let messages = vec![ConversationMessage::User(prompt.to_string())];
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    complete_turn(
        &cfg.provider,
        &cfg.api_key,
        &cfg.model,
        &messages,
        &no_tools,
        cfg.base_url.as_deref(),
    )
    .await
    .map(|t| t.content)
}

// ── 4. get_error_groups ───────────────────────────────────────────────────────

/// Return Sentry-style error groups from blade.db, ordered by last_seen desc.
pub fn get_error_groups() -> Vec<ErrorGroup> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("log_monitor get_error_groups: {e}");
            return vec![];
        }
    };

    let mut stmt = match conn.prepare(
        "SELECT fingerprint, source, level,
                COUNT(*) as cnt,
                MIN(timestamp) as first_seen,
                MAX(timestamp) as last_seen,
                message
         FROM log_entries
         WHERE level IN ('error', 'fatal', 'warn')
         GROUP BY fingerprint
         ORDER BY last_seen DESC
         LIMIT 100",
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("log_monitor get_error_groups prepare: {e}");
            return vec![];
        }
    };

    let rows = stmt.query_map([], |row| {
        let fingerprint: String = row.get(0)?;
        let source: String = row.get(1)?;
        let level: String = row.get(2)?;
        let count: u32 = row.get(3)?;
        let first_seen: i64 = row.get(4)?;
        let last_seen: i64 = row.get(5)?;
        let sample: String = row.get(6)?;

        // Use first 80 chars of sample as the group title
        let title = if sample.len() > 80 {
            format!("{}…", &sample[..80])
        } else {
            sample.clone()
        };

        Ok(ErrorGroup {
            fingerprint,
            title,
            source,
            level,
            count,
            first_seen,
            last_seen,
            sample,
        })
    });

    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(e) => {
            eprintln!("log_monitor get_error_groups query: {e}");
            vec![]
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn log_start_tailing(app: tauri::AppHandle, paths: Vec<String>) {
    start_log_tailing(app, paths).await
}

#[tauri::command]
pub async fn log_detect_anomalies(logs: Vec<String>) -> Vec<LogAnomaly> {
    detect_anomalies(&logs).await
}

#[tauri::command]
pub async fn log_correlate_errors(anomalies: Vec<LogAnomaly>) -> Vec<ErrorChain> {
    correlate_errors(&anomalies).await
}

#[tauri::command]
pub fn log_get_error_groups() -> Vec<ErrorGroup> {
    get_error_groups()
}

#[tauri::command]
pub fn log_search(query: String, limit: u32) -> Vec<ErrorGroup> {
    search_logs(&query, limit)
}

/// Full-text search across stored log entries.
pub fn search_logs(query: &str, limit: u32) -> Vec<ErrorGroup> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        "SELECT le.fingerprint, le.source, le.level, 1 as cnt,
                le.timestamp, le.timestamp, le.message
         FROM log_entries_fts
         JOIN log_entries le ON le.id = log_entries_fts.rowid
         WHERE log_entries_fts MATCH ?1
         ORDER BY le.timestamp DESC
         LIMIT ?2",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows = stmt.query_map(params![query, limit], |row| {
        let fingerprint: String = row.get(0)?;
        let source: String = row.get(1)?;
        let level: String = row.get(2)?;
        let count: u32 = row.get(3)?;
        let first_seen: i64 = row.get(4)?;
        let last_seen: i64 = row.get(5)?;
        let sample: String = row.get(6)?;
        let title = crate::safe_slice(&sample, 80).to_string();
        Ok(ErrorGroup { fingerprint, title, source, level, count, first_seen, last_seen, sample })
    });

    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}
