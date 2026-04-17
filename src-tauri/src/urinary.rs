/// URINARY SYSTEM — BLADE's waste filtration and excretion.
///
/// 49 of 90 database tables have ZERO cleanup. They grow forever.
/// This module provides nephrons (filter rules) for each high-growth table,
/// and scheduled excretion via the homeostasis tick.
///
/// Runs from homeostasis tick — lightweight SQL DELETEs, no LLM calls.
/// Each nephron has its own retention policy based on data importance.

use rusqlite::params;

/// Run all nephrons. Called from homeostasis tick when energy > 0.3.
/// Returns total rows pruned.
pub fn filter_waste() -> u64 {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let now = chrono::Utc::now().timestamp();
    let mut total_pruned: u64 = 0;

    let cutoff_7d = now - 7 * 86400;
    let cutoff_14d = now - 14 * 86400;
    let cutoff_30d = now - 30 * 86400;

    // Nephron 1: audio_timeline (highest growth — 120 rows/hour)
    // Keep meeting transcripts indefinitely, prune non-meeting audio after 7 days
    total_pruned += del(&conn,
        "DELETE FROM audio_timeline WHERE timestamp < ?1 AND (meeting_id = '' OR meeting_id IS NULL)",
        cutoff_7d);

    // Nephron 2: causal_events — keep 14 days
    total_pruned += del(&conn, "DELETE FROM causal_events WHERE timestamp < ?1", cutoff_14d);

    // Nephron 3: causal_insights — keep 30 days
    total_pruned += del(&conn, "DELETE FROM causal_insights WHERE created_at < ?1", cutoff_30d);

    // Nephron 4: emotional_readings — keep 7 days
    total_pruned += del(&conn, "DELETE FROM emotional_readings WHERE timestamp < ?1", cutoff_7d);

    // Nephron 5: self_critiques — keep 90 days (feeds weekly_meta_critique learning)
    let cutoff_90d = now - 90 * 86400;
    total_pruned += del(&conn, "DELETE FROM self_critiques WHERE created_at < ?1", cutoff_90d);

    // Nephron 6: reasoning_traces — keep 60 days (user may ask "show me that analysis")
    let cutoff_60d = now - 60 * 86400;
    total_pruned += del(&conn, "DELETE FROM reasoning_traces WHERE created_at < ?1", cutoff_60d);

    // Nephron 7: voice_sessions + voice_segments — keep 7 days
    total_pruned += del(&conn, "DELETE FROM voice_segments WHERE timestamp < ?1", cutoff_7d);
    total_pruned += del(&conn, "DELETE FROM voice_sessions WHERE started_at < ?1", cutoff_7d);

    // Nephron 8: plan_memory — keep confirmed plans, prune pending/failed after 7 days
    total_pruned += del(&conn,
        "DELETE FROM plan_memory WHERE status != 'confirmed' AND last_used < ?1", cutoff_7d);

    // Nephron 9: behavior_patterns — only prune VERY low confidence AND old AND rarely seen
    // Be conservative: patterns are learning data. A pattern seen once might become important.
    total_pruned += del(&conn,
        "DELETE FROM behavior_patterns WHERE confidence < 0.15 AND frequency <= 1 AND last_seen < ?1", cutoff_30d);

    // Nephron 10: predictions — prune unfulfilled after 30 days (keep fulfilled forever — they're validated patterns)
    total_pruned += del(&conn,
        "DELETE FROM user_predictions WHERE fulfilled = 0 AND created_at < ?1", cutoff_30d);

    // Nephron 11: authority_audit_log — keep 30 days
    total_pruned += del(&conn, "DELETE FROM authority_audit_log WHERE timestamp < ?1", cutoff_30d);

    // Nephron 12: agent_delegations — keep 14 days
    total_pruned += del(&conn, "DELETE FROM agent_delegations WHERE created_at < ?1", cutoff_14d);

    // Nephron 13: debate_sessions + negotiation_scenarios — keep 90 days (user work product)
    total_pruned += del(&conn, "DELETE FROM debate_sessions WHERE created_at < ?1", cutoff_90d);
    total_pruned += del(&conn, "DELETE FROM negotiation_scenarios WHERE created_at < ?1", cutoff_90d);

    // Nephron 14: proactive_actions — keep 7 days
    total_pruned += del(&conn, "DELETE FROM proactive_actions WHERE created_at < ?1", cutoff_7d);

    // Nephron 15: streak_activity — keep 30 days (column is `last_active`, not `timestamp`)
    total_pruned += del(&conn, "DELETE FROM streak_activity WHERE last_active < ?1", cutoff_30d);

    // Nephron 16: accountability_checkins — keep 30 days
    total_pruned += del(&conn, "DELETE FROM accountability_checkins WHERE timestamp < ?1", cutoff_30d);

    // Nephron 17: health_logs — keep 14 days
    total_pruned += del(&conn, "DELETE FROM health_logs WHERE timestamp < ?1", cutoff_14d);

    // Nephron 18: habit_logs — keep 30 days
    total_pruned += del(&conn, "DELETE FROM habit_logs WHERE completed_at < ?1", cutoff_30d);

    // Nephron 19: evolution_suggestions — prune dismissed after 30 days
    total_pruned += del(&conn,
        "DELETE FROM evolution_suggestions WHERE status = 'dismissed' AND created_at < ?1", cutoff_30d);

    // Nephron 20: persona_outcomes — keep 30 days
    total_pruned += del(&conn, "DELETE FROM persona_outcomes WHERE recorded_at < ?1", cutoff_30d);

    // Nephron 21: completed swarms + their tasks — keep 14 days
    total_pruned += del(&conn,
        "DELETE FROM swarm_tasks WHERE swarm_id IN (SELECT id FROM swarms WHERE status = 'completed' AND created_at < ?1)",
        cutoff_14d);
    total_pruned += del(&conn,
        "DELETE FROM swarms WHERE status = 'completed' AND created_at < ?1", cutoff_14d);

    // Nephron 22: vector_entries — DON'T time-prune. These are the search index.
    // Deleting embeddings makes "what was I doing last month?" return nothing.
    // Only prune orphaned entries whose source was already deleted.
    total_pruned += conn.execute(
        "DELETE FROM vector_entries WHERE source = 'screen_timeline' AND source_id NOT IN (SELECT CAST(id AS TEXT) FROM screen_timeline)",
        [],
    ).unwrap_or(0) as u64;

    // Nephron 23: indexed_files — prune files deleted from disk (hourly check)
    static PRUNE_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let count = PRUNE_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if count % 60 == 0 {
        let cutoff_reindex = now - 7 * 86400;
        let stale: Vec<(i64, String)> = if let Ok(mut stmt) = conn.prepare(
            "SELECT id, path FROM indexed_files WHERE indexed_at < ?1 LIMIT 100"
        ) {
            stmt.query_map(params![cutoff_reindex], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
        } else {
            Vec::new()
        };

        for (id, path) in &stale {
            let home = dirs::home_dir().unwrap_or_default().to_string_lossy().to_string();
            let real_path = path.replace('~', &home);
            if !std::path::Path::new(&real_path).exists() {
                let _ = conn.execute("DELETE FROM indexed_files WHERE id = ?1", params![id]);
                total_pruned += 1;
            }
        }
    }

    if total_pruned > 0 {
        log::info!("[urinary] Filtered {} waste rows", total_pruned);
    }

    total_pruned
}

fn del(conn: &rusqlite::Connection, sql: &str, cutoff: i64) -> u64 {
    conn.execute(sql, params![cutoff]).unwrap_or(0) as u64
}

// ── Immune: lymph node defense ───────────────────────────────────────────────
//
// security_monitor.rs handles threat detection (phishing, network, code scan).
// permissions.rs handles tool risk classification (Blocked/Ask/Allow).
// These ARE the lymph nodes — already built, already filtering.
//
// What's missing: a summary function so homeostasis knows immune status.

/// Get immune system health — how many threats detected recently?
pub fn get_immune_status() -> ImmuneStatus {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return ImmuneStatus::default(),
    };

    let now = chrono::Utc::now().timestamp();
    let hour_ago = now - 3600;

    // Count security alerts in the last hour
    let alerts: i64 = conn.query_row(
        "SELECT COUNT(*) FROM activity_timeline WHERE event_type = 'security_alert' AND timestamp > ?1",
        params![hour_ago],
        |row| row.get(0),
    ).unwrap_or(0);

    // Count blocked tool calls
    let blocked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM authority_audit_log WHERE allowed = 0 AND timestamp > ?1",
        params![hour_ago],
        |row| row.get(0),
    ).unwrap_or(0);

    ImmuneStatus {
        threats_last_hour: alerts as u32,
        blocked_actions: blocked as u32,
        status: if alerts > 5 { "under_attack" } else if alerts > 0 { "alert" } else { "healthy" }.to_string(),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct ImmuneStatus {
    pub threats_last_hour: u32,
    pub blocked_actions: u32,
    pub status: String,
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn urinary_flush() -> u64 {
    filter_waste()
}

#[tauri::command]
pub fn immune_get_status() -> ImmuneStatus {
    get_immune_status()
}
