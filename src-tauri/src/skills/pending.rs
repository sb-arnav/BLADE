//! Phase 24 (v1.3) — `.pending/` proposal queue substrate.
//!
//! Per D-24-B: chat-injected proactive prompts surface via the existing
//! `proactive_engine` decision_gate path (Plan 24-07). Each pending
//! proposal lives at `<user_root>/.pending/<id>.json`. Schema:
//!
//! ```json
//! { "id": "abc12345", "kind": "merge"|"generate",
//!   "proposed_name": "...", "payload": {...},
//!   "created_at": 1714579200, "dismissed": false,
//!   "content_hash": "..." }
//! ```
//!
//! Per Discretion item 4 LOCK: 7-day-old `dismissed:false` proposals
//! auto-dismiss; 30-day-old files are purged. Both run at top of next
//! dream cycle (single sweep per cycle; no separate cron).
//!
//! Per Pitfall 6: this module exposes pure read/write — the 30-second
//! `LAST_ACTIVITY` cooldown is the *consumer*'s concern (Plan 24-07's
//! `proactive_engine::drain_pending_proposals`).

#![allow(dead_code)] // Wave 2 substrate; consumers wire in Plans 24-05 + 24-07.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Phase 24 (v1.3) — pending proposal in the operator-confirmation queue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Proposal {
    pub id: String,
    pub kind: String,
    pub proposed_name: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
    #[serde(default)]
    pub dismissed: bool,
    pub content_hash: String,
}

/// Resolve the pending queue dir; create on first use.
pub fn pending_dir() -> PathBuf {
    let dir = crate::skills::loader::user_root().join(".pending");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Compute a stable content_hash from the human-meaningful fields. Uses
/// `std::collections::hash_map::DefaultHasher` (sha2 not in Cargo.toml per
/// 24-RESEARCH A1). Format: 16 hex chars (u64 → lowercase hex).
pub fn compute_content_hash(kind: &str, proposed_name: &str, payload: &serde_json::Value) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let canonical = serde_json::to_string(payload).unwrap_or_default();
    let mut h = DefaultHasher::new();
    kind.hash(&mut h);
    proposed_name.hash(&mut h);
    canonical.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Write a Proposal to disk with content_hash dedup. If any existing
/// `<dir>/*.json` file has a matching content_hash, the new write is
/// skipped (idempotent — same proposal won't refire next cycle). Returns
/// Ok(true) if written, Ok(false) if deduped, Err on disk error.
pub fn write_proposal(prop: &Proposal) -> Result<bool, String> {
    let dir = pending_dir();
    // Dedup scan.
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&p) {
                if let Ok(existing) = serde_json::from_str::<Proposal>(&text) {
                    if existing.content_hash == prop.content_hash {
                        return Ok(false);
                    }
                }
            }
        }
    }
    let path = dir.join(format!("{}.json", prop.id));
    let json = serde_json::to_string_pretty(prop)
        .map_err(|e| format!("serialize proposal: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(true)
}

/// Read all proposals in the .pending/ dir. Malformed JSON files are
/// logged + skipped (mirrors `skills::loader::scan_tier` posture).
pub fn read_proposals() -> Vec<Proposal> {
    let dir = pending_dir();
    let mut out: Vec<Proposal> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&p) {
                match serde_json::from_str::<Proposal>(&text) {
                    Ok(prop) => out.push(prop),
                    Err(e) => log::warn!("[skills::pending] parse {}: {e}", p.display()),
                }
            }
        }
    }
    out
}

/// Read a single proposal by id (filename stem).
pub fn read_proposal(id: &str) -> Option<Proposal> {
    let path = pending_dir().join(format!("{}.json", id));
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Mark a proposal dismissed (writes back the JSON with dismissed = true).
pub fn mark_dismissed(id: &str) -> Result<(), String> {
    let mut prop = read_proposal(id).ok_or_else(|| format!("not found: {}", id))?;
    prop.dismissed = true;
    let path = pending_dir().join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&prop)
        .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

/// Delete a proposal file by id. Used by Plan 24-07's apply path on
/// successful merge / generate confirmation.
pub fn delete_proposal(id: &str) -> Result<(), String> {
    let path = pending_dir().join(format!("{}.json", id));
    std::fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))
}

/// Phase 24 (v1.3) — Discretion item 4 LOCK. Single sweep:
/// - proposals with `created_at < now - 7*86400` AND `dismissed == false` → mark dismissed
/// - proposals with `created_at < now - 30*86400` → delete file
pub fn auto_dismiss_old(now_ts: i64) {
    let dir = pending_dir();
    let week_cutoff = now_ts - 7 * 86400;
    let month_cutoff = now_ts - 30 * 86400;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let text = match std::fs::read_to_string(&p) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let mut prop: Proposal = match serde_json::from_str(&text) {
                Ok(pp) => pp,
                Err(_) => continue,
            };
            if prop.created_at < month_cutoff {
                let _ = std::fs::remove_file(&p);
                continue;
            }
            if prop.created_at < week_cutoff && !prop.dismissed {
                prop.dismissed = true;
                if let Ok(json) = serde_json::to_string_pretty(&prop) {
                    let _ = std::fs::write(&p, json);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn isolated() -> TempDir {
        let tmp = TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        tmp
    }

    fn sample_proposal(id: &str, kind: &str, name: &str, hash: &str) -> Proposal {
        Proposal {
            id: id.to_string(),
            kind: kind.to_string(),
            proposed_name: name.to_string(),
            payload: serde_json::json!({"k": "v"}),
            created_at: chrono::Utc::now().timestamp(),
            dismissed: false,
            content_hash: hash.to_string(),
        }
    }

    #[test]
    fn write_proposal_creates_file() {
        let _tmp = isolated();
        let p = sample_proposal("abc12345", "merge", "foo_merged", "h1");
        assert_eq!(write_proposal(&p).unwrap(), true);
        let read = read_proposal("abc12345").unwrap();
        assert_eq!(read, p);
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn write_proposal_dedup_by_content_hash() {
        let _tmp = isolated();
        let a = sample_proposal("idA", "merge", "foo_merged", "samehash");
        let b = sample_proposal("idB", "merge", "foo_merged", "samehash");
        assert_eq!(write_proposal(&a).unwrap(), true);
        assert_eq!(write_proposal(&b).unwrap(), false, "second write must be deduped");
        let all = read_proposals();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "idA");
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn auto_dismiss_old_marks_7day() {
        let _tmp = isolated();
        let now = chrono::Utc::now().timestamp();
        let mut old = sample_proposal("aged", "merge", "x", "h_aged");
        old.created_at = now - 8 * 86400; // 8 days old
        assert!(write_proposal(&old).unwrap());

        // Younger proposal — must NOT be dismissed.
        let young = sample_proposal("young", "merge", "y", "h_young");
        assert!(write_proposal(&young).unwrap());

        auto_dismiss_old(now);

        let aged = read_proposal("aged").unwrap();
        assert!(aged.dismissed, "8-day-old proposal must be auto-dismissed");
        let young_after = read_proposal("young").unwrap();
        assert!(!young_after.dismissed, "young proposal must be untouched");
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn auto_dismiss_old_purges_30day() {
        let _tmp = isolated();
        let now = chrono::Utc::now().timestamp();
        let mut very_old = sample_proposal("ancient", "merge", "x", "h_anc");
        very_old.created_at = now - 31 * 86400;
        assert!(write_proposal(&very_old).unwrap());
        assert!(read_proposal("ancient").is_some());

        auto_dismiss_old(now);
        assert!(read_proposal("ancient").is_none(), "31-day-old file must be purged");
        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
