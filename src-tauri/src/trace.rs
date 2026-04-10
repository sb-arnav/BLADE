use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static TRACE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEntry {
    pub trace_id: String,
    pub provider: String,
    pub model: String,
    pub method: String,
    pub duration_ms: u64,
    pub success: bool,
    pub error: Option<String>,
    pub timestamp: String,
}

pub struct TraceSpan {
    pub trace_id: String,
    pub provider: String,
    pub model: String,
    pub method: String,
    start: Instant,
}

impl TraceSpan {
    pub fn new(provider: &str, model: &str, method: &str) -> Self {
        let id = TRACE_COUNTER.fetch_add(1, Ordering::SeqCst);
        Self {
            trace_id: format!("blade-{}", id),
            provider: provider.to_string(),
            model: model.to_string(),
            method: method.to_string(),
            start: Instant::now(),
        }
    }

    pub fn finish(self, success: bool, error: Option<String>) -> TraceEntry {
        TraceEntry {
            trace_id: self.trace_id,
            provider: self.provider,
            model: self.model,
            method: self.method,
            duration_ms: self.start.elapsed().as_millis() as u64,
            success,
            error,
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// Log a trace entry to the blade log file
pub fn log_trace(entry: &TraceEntry) {
    let log_dir = crate::config::blade_config_dir().join("logs");
    std::fs::create_dir_all(&log_dir).ok();

    let log_file = log_dir.join("provider_traces.jsonl");
    if let Ok(line) = serde_json::to_string(entry) {
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file)
        {
            let _ = writeln!(file, "{}", line);
        }
    }
}

#[tauri::command]
pub fn get_recent_traces() -> Vec<TraceEntry> {
    let log_file = crate::config::blade_config_dir()
        .join("logs")
        .join("provider_traces.jsonl");

    let content = match std::fs::read_to_string(&log_file) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    content
        .lines()
        .rev()
        .take(50)
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}
