#![allow(dead_code)]

//! Rhythm signal computation — derives activity patterns from scan results.
//!
//! Computes three signals from cross-scanner timestamp data:
//! 1. Hour-of-day histogram (24 buckets)
//! 2. Day-of-week distribution (7 buckets, Mon=0)
//! 3. Active-repo concurrency count (repos active in last 30 days)
//!
//! Called once after the lead-queue drain loop completes.
//! Returns empty vec if no timestamp data is available.

use crate::deep_scan::leads::{DeepScanResults, RhythmSignal};

/// Compute rhythm signals from cross-scanner data in scan results.
/// Returns up to 3 signals; returns empty vec on data absence.
pub fn compute(results: &DeepScanResults) -> Vec<RhythmSignal> {
    let mut signals: Vec<RhythmSignal> = Vec::new();

    // Collect Unix timestamps from mru_files and ai_session last_active
    let mut timestamps: Vec<i64> = Vec::new();

    // MRU file mtimes
    for mru in &results.mru_files {
        if mru.mtime_unix > 0 {
            timestamps.push(mru.mtime_unix);
        }
    }

    // Signal 3: Active-repo concurrency (doesn't need timestamps)
    let active_repo_count = results.repo_rows.iter()
        .filter(|r| r.last_active_days.map(|d| d <= 30).unwrap_or(false))
        .count();

    if !timestamps.is_empty() {
        // Signal 1: Hour-of-day histogram
        let mut hour_buckets = [0usize; 24];
        for &ts in &timestamps {
            let hour = ((ts % 86400) / 3600) as usize;
            if hour < 24 {
                hour_buckets[hour] += 1;
            }
        }
        if let Ok(data) = serde_json::to_value(&hour_buckets) {
            signals.push(RhythmSignal {
                kind: "hour_histogram".to_string(),
                data,
            });
        }

        // Signal 2: Day-of-week distribution (Mon=0 .. Sun=6)
        // Unix epoch 1970-01-01 was a Thursday (day 3 if Mon=0).
        // Formula: (ts / 86400 + 3) % 7  → Mon=0 .. Sun=6
        let mut day_buckets = [0usize; 7];
        for &ts in &timestamps {
            let day = ((ts / 86400 + 3) % 7) as usize;
            if day < 7 {
                day_buckets[day] += 1;
            }
        }
        if let Ok(data) = serde_json::to_value(&day_buckets) {
            signals.push(RhythmSignal {
                kind: "day_histogram".to_string(),
                data,
            });
        }
    }

    // Signal 3: Active-repo concurrency (always emitted, even if 0)
    signals.push(RhythmSignal {
        kind: "active_repo_count".to_string(),
        data: serde_json::json!(active_repo_count),
    });

    signals
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deep_scan::leads::{MruFileRow, RepoRow, DeepScanResults};

    #[test]
    fn test_rhythm_compute_from_timestamps() {
        // 3 MRU file rows at known Unix timestamps
        // 1700000000 = 2023-11-14 22:13:20 UTC → hour=22, day=(1700000000/86400+3)%7
        let ts1: i64 = 1700000000;
        let ts2: i64 = 1700086400; // +24h
        let ts3: i64 = 1700172800; // +48h

        let mut results = DeepScanResults::default();
        results.mru_files = vec![
            MruFileRow {
                row_id: "file:/tmp/a".to_string(),
                path: "/tmp/a".to_string(),
                mtime_unix: ts1,
                size_bytes: 100,
                project_root: None,
                source: "mru".to_string(),
            },
            MruFileRow {
                row_id: "file:/tmp/b".to_string(),
                path: "/tmp/b".to_string(),
                mtime_unix: ts2,
                size_bytes: 200,
                project_root: None,
                source: "mru".to_string(),
            },
            MruFileRow {
                row_id: "file:/tmp/c".to_string(),
                path: "/tmp/c".to_string(),
                mtime_unix: ts3,
                size_bytes: 300,
                project_root: None,
                source: "mru".to_string(),
            },
        ];

        // Add an active repo (last_active_days = 5 → within 30 day window)
        results.repo_rows = vec![
            RepoRow {
                row_id: "repo:/home/user/proj".to_string(),
                path: "/home/user/proj".to_string(),
                last_active_days: Some(5),
                discovered_via: "fs_repos".to_string(),
                source_scanner: "fs_repos".to_string(),
                ..Default::default()
            },
        ];

        let signals = compute(&results);

        // Must return 3 signals
        assert_eq!(signals.len(), 3, "expected 3 rhythm signals, got {}: {:?}",
            signals.len(), signals.iter().map(|s| &s.kind).collect::<Vec<_>>());

        // All expected kinds present
        let kinds: Vec<&str> = signals.iter().map(|s| s.kind.as_str()).collect();
        assert!(kinds.contains(&"hour_histogram"), "missing hour_histogram");
        assert!(kinds.contains(&"day_histogram"), "missing day_histogram");
        assert!(kinds.contains(&"active_repo_count"), "missing active_repo_count");

        // active_repo_count should be 1
        let arc = signals.iter().find(|s| s.kind == "active_repo_count").unwrap();
        assert_eq!(arc.data, serde_json::json!(1), "expected active_repo_count=1");
    }

    #[test]
    fn test_rhythm_no_timestamps_returns_count_signal() {
        // With no MRU files, only active_repo_count signal is emitted
        let results = DeepScanResults::default();
        let signals = compute(&results);

        // Should have at least the active_repo_count signal
        assert!(!signals.is_empty(), "expected at least 1 signal even without timestamps");
        let arc = signals.iter().find(|s| s.kind == "active_repo_count");
        assert!(arc.is_some(), "expected active_repo_count signal");
        assert_eq!(arc.unwrap().data, serde_json::json!(0));
    }
}
