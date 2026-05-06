// src-tauri/src/session/list.rs
//
// Phase 34 / SESS-03 + SESS-04 — Session list + fork Tauri commands.
//
// Plan 34-03 ships SessionMeta struct + 4 Tauri command stubs.
// Plan 34-10 fills:
//   - list_sessions: walk jsonl_log_dir, parse each *.jsonl's first ~5 events,
//     extract SessionMeta, return sorted desc by started_at_ms
//   - resume_session: validate session_id, delegate to resume::load_session
//   - fork_session: validate parent_id, copy events up to fork_at_message_index,
//     prepend SessionMeta, write to new ULID
//   - get_conversation_cost: read JSONL, sum cost_update LoopEvent payloads

use serde::{Deserialize, Serialize};

/// SESS-03 — frontend-facing session metadata. Distinct from the
/// SessionEvent::SessionMeta variant (which only carries id/parent/etc, not
/// the message_count / approximate_tokens / first_message_excerpt fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub started_at_ms: u64,
    /// Count of UserMessage + AssistantTurn events in the JSONL.
    pub message_count: u32,
    /// safe_slice(first_user_message_content, 120).
    pub first_message_excerpt: String,
    /// Sum of (tokens_in + tokens_out) across AssistantTurn events.
    pub approximate_tokens: u32,
    /// Reason from most-recent HaltReason event, or None.
    pub halt_reason: Option<String>,
    /// Populated for forked sessions (SESS-04).
    pub parent: Option<String>,
}

/// SESS-03 — list past sessions sorted by start time descending. Walks
/// `BladeConfig.session.jsonl_log_dir`, filters `*.jsonl` files (skipping the
/// `archive/` subdir which is a directory not a file), validates each
/// filename's stem via `validate_session_id` (defense-in-depth — rejects any
/// stray non-ULID files a user may have dropped in), parses metadata via
/// `read_meta`, returns SessionMeta entries sorted desc by `started_at_ms`.
///
/// Corrupted files (no SessionMeta event present) are skipped silently with
/// a `log::warn` line — they neither block listing nor surface to the UI.
///
/// Wrapped in `catch_unwind` per Phase 31 / 34 panic-safety discipline:
/// any panic in metadata parsing must NOT crash the command host.
#[tauri::command]
pub async fn list_sessions() -> Result<Vec<SessionMeta>, String> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let dir = crate::config::load_config().session.jsonl_log_dir.clone();
        if !dir.exists() {
            return Ok::<Vec<SessionMeta>, String>(Vec::new());
        }
        let mut metas: Vec<SessionMeta> = Vec::new();
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("[SESS-03] read_dir entry error: {}", e);
                    continue;
                }
            };
            let path = entry.path();
            // archive/ subdir is a directory, not a file — skipped here. We
            // also skip any other dirs or non-*.jsonl files.
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if validate_session_id(&stem).is_err() {
                continue;
            }
            match read_meta(&path) {
                Ok(Some(m)) => metas.push(m),
                Ok(None) => {
                    log::warn!(
                        "[SESS-03] skip {}: no SessionMeta event (corrupted)",
                        path.display()
                    );
                }
                Err(e) => {
                    log::warn!("[SESS-03] read_meta {}: {}", path.display(), e);
                }
            }
        }
        // Newest first.
        metas.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
        Ok(metas)
    }));
    match result {
        Ok(r) => r,
        Err(_panic) => {
            eprintln!("[SESS-03] list_sessions panicked; returning empty list");
            Ok(Vec::new())
        }
    }
}

/// Walk a JSONL file, extract SessionMeta. Returns None when no
/// `SessionEvent::SessionMeta` is found (corrupted file). Returns Err on I/O
/// error opening the file.
///
/// Per CONTEXT lock §SESS-03: forward-read full file; metadata-only; no
/// full-text search. Per threat T-34-45 acceptance: rotation caps live
/// sessions at `keep_n_sessions` (default 100), so worst-case file count is
/// bounded. v1.6+ optimisation may stream only the first/last N events.
fn read_meta(path: &std::path::Path) -> std::io::Result<Option<SessionMeta>> {
    use std::io::BufRead;
    let f = std::fs::File::open(path)?;
    let reader = std::io::BufReader::new(f);
    let mut id = String::new();
    let mut parent: Option<String> = None;
    let mut started_at_ms: u64 = 0;
    let mut first_message_excerpt = String::new();
    let mut message_count: u32 = 0;
    let mut approximate_tokens: u32 = 0;
    let mut halt_reason: Option<String> = None;
    let mut found_meta = false;
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                log::warn!("[SESS-03] read_meta line error: {}", e);
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let ev = match serde_json::from_str::<crate::session::log::SessionEvent>(&line) {
            Ok(e) => e,
            Err(_) => continue, // skip corrupt lines
        };
        match ev {
            crate::session::log::SessionEvent::SessionMeta {
                id: i,
                parent: p,
                started_at_ms: t,
                ..
            } => {
                id = i;
                parent = p;
                started_at_ms = t;
                found_meta = true;
            }
            crate::session::log::SessionEvent::UserMessage { content, .. } => {
                if first_message_excerpt.is_empty() {
                    first_message_excerpt = crate::safe_slice(&content, 120).to_string();
                }
                message_count = message_count.saturating_add(1);
            }
            crate::session::log::SessionEvent::AssistantTurn {
                tokens_in,
                tokens_out,
                ..
            } => {
                message_count = message_count.saturating_add(1);
                approximate_tokens = approximate_tokens
                    .saturating_add(tokens_in.saturating_add(tokens_out));
            }
            crate::session::log::SessionEvent::HaltReason { reason, .. } => {
                halt_reason = Some(reason);
            }
            _ => {}
        }
    }
    if !found_meta {
        return Ok(None);
    }
    Ok(Some(SessionMeta {
        id,
        started_at_ms,
        message_count,
        first_message_excerpt,
        approximate_tokens,
        halt_reason,
        parent,
    }))
}

/// SESS-02 — Tauri command wrapper. Validates session_id (defense against
/// path traversal — see threat T-34-37), checks
/// `BladeConfig.session.jsonl_log_enabled` (a disabled JSONL log has nothing
/// to resume from), builds `{jsonl_log_dir}/{session_id}.jsonl`, and
/// delegates to `crate::session::resume::load_session`.
///
/// Wrapped in `catch_unwind` per Phase 31 / 34 panic-safety discipline:
/// a panic in JSONL replay must NOT crash the chat host.
#[tauri::command]
pub async fn resume_session(
    session_id: String,
) -> Result<crate::session::resume::ResumedConversation, String> {
    validate_session_id(&session_id)?;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let cfg = crate::config::load_config();
        if !cfg.session.jsonl_log_enabled {
            return Err(
                "session JSONL logging is disabled — nothing to resume".to_string(),
            );
        }
        let dir = cfg.session.jsonl_log_dir.clone();
        let path = dir.join(format!("{}.jsonl", &session_id));
        crate::session::resume::load_session(&path, &session_id)
    }));
    match result {
        Ok(r) => r,
        Err(_panic) => {
            eprintln!(
                "[SESS-02] resume_session panicked for {}; surfacing Err",
                session_id
            );
            Err("resume_session internal error (panic caught)".to_string())
        }
    }
}

/// SESS-04 — Tauri command. Two-pass copy of a parent JSONL up to the chosen
/// message index, prepending a fresh `SessionMeta` carrying `parent` +
/// `fork_at_index`, writing to a new ULID-named file in the same dir.
///
/// Per CONTEXT lock §SESS-04:
///   - Shallow — child cannot itself be forked. Plan 34-10 ENFORCES this by
///     reading parent's SessionMeta.parent: if Some, reject. v1.6+ may relax.
///   - Ordinal counts UserMessage + AssistantTurn ONLY (CompactionBoundary,
///     ToolCall, HaltReason, LoopEvent pass through unconditionally so
///     forensic continuity is preserved up to the chosen cut point).
///   - `fork_at_message_index` is CLAMPED to actual message count: the
///     SessionMeta records the *clamped* value so the user sees the truth.
///   - Forking does NOT auto-resume — frontend explicitly chooses Resume.
///
/// Wrapped in `catch_unwind` per Phase 31 / 34 panic-safety discipline.
#[tauri::command]
pub async fn fork_session(
    parent_id: String,
    fork_at_message_index: u32,
) -> Result<String, String> {
    validate_session_id(&parent_id)?;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let cfg = crate::config::load_config();
        let dir = cfg.session.jsonl_log_dir.clone();
        let parent_path = dir.join(format!("{}.jsonl", &parent_id));
        if !parent_path.exists() {
            return Err(format!("parent session not found: {}", parent_id));
        }

        // First pass: count UserMessage + AssistantTurn ordinals AND detect
        // grandchild rejection (parent.parent.is_some()). Buffer all lines so
        // the second pass doesn't reopen the file (the on-disk content can't
        // change mid-fork without external interference, but reading once is
        // simpler + matches Phase 34 single-pass-where-possible discipline).
        use std::io::BufRead;
        let f =
            std::fs::File::open(&parent_path).map_err(|e| format!("open parent: {}", e))?;
        let reader = std::io::BufReader::new(f);
        let mut total_messages: u32 = 0;
        let mut parent_is_fork = false;
        let mut all_lines: Vec<String> = Vec::new();
        for line in reader.lines() {
            let line = line.map_err(|e| format!("read parent line: {}", e))?;
            if line.trim().is_empty() {
                continue;
            }
            all_lines.push(line.clone());
            if let Ok(ev) =
                serde_json::from_str::<crate::session::log::SessionEvent>(&line)
            {
                match ev {
                    crate::session::log::SessionEvent::SessionMeta {
                        parent, ..
                    } => {
                        if parent.is_some() {
                            parent_is_fork = true;
                        }
                    }
                    crate::session::log::SessionEvent::UserMessage { .. }
                    | crate::session::log::SessionEvent::AssistantTurn { .. } => {
                        total_messages = total_messages.saturating_add(1);
                    }
                    _ => {}
                }
            }
        }
        if parent_is_fork {
            return Err(
                "cannot fork a session that is itself a fork — one-level deep only (v1.6+ may relax this)"
                    .to_string(),
            );
        }

        let fork_at_clamped = fork_at_message_index.min(total_messages);

        // Generate new ULID + open new JSONL.
        let new_id = ulid::Ulid::new().to_string();
        let new_path = dir.join(format!("{}.jsonl", &new_id));

        use std::io::Write;
        let mut out =
            std::fs::File::create(&new_path).map_err(|e| format!("create child: {}", e))?;

        // Prepend fresh SessionMeta — parent + fork_at_index (clamped).
        let meta = crate::session::log::SessionEvent::SessionMeta {
            id: new_id.clone(),
            parent: Some(parent_id.clone()),
            fork_at_index: Some(fork_at_clamped),
            started_at_ms: crate::session::log::now_ms(),
        };
        let meta_line =
            serde_json::to_string(&meta).map_err(|e| format!("serialize meta: {}", e))?;
        out.write_all(meta_line.as_bytes())
            .map_err(|e| format!("write meta: {}", e))?;
        out.write_all(b"\n").map_err(|e| format!("write nl: {}", e))?;

        // Second pass: copy parent's lines, skipping its own SessionMeta,
        // capping UserMessage + AssistantTurn at fork_at_clamped. Other event
        // types (CompactionBoundary, ToolCall, HaltReason, LoopEvent) pass
        // through unconditionally — forensic continuity per CONTEXT lock.
        let mut copied_messages: u32 = 0;
        for line in &all_lines {
            if let Ok(ev) =
                serde_json::from_str::<crate::session::log::SessionEvent>(line)
            {
                match ev {
                    crate::session::log::SessionEvent::SessionMeta { .. } => continue,
                    crate::session::log::SessionEvent::UserMessage { .. }
                    | crate::session::log::SessionEvent::AssistantTurn { .. } => {
                        if copied_messages >= fork_at_clamped {
                            // Stop copying messages once we've hit the cap;
                            // do NOT break since later lines may be ToolCall /
                            // LoopEvent that we'd normally pass through, but
                            // those events are scoped to specific turns — once
                            // we stop the message stream we should stop the
                            // whole copy to avoid orphan tool-results that
                            // belong to messages NOT in the fork.
                            break;
                        }
                        out.write_all(line.as_bytes())
                            .map_err(|e| format!("write msg: {}", e))?;
                        out.write_all(b"\n")
                            .map_err(|e| format!("write nl: {}", e))?;
                        copied_messages = copied_messages.saturating_add(1);
                    }
                    _ => {
                        // CompactionBoundary, ToolCall, HaltReason, LoopEvent
                        // all pass through unconditionally — they belong to
                        // already-copied messages (we're walking in file order
                        // so anything between message N and N+1 is causally
                        // tied to message N which we've already copied).
                        out.write_all(line.as_bytes())
                            .map_err(|e| format!("write aux: {}", e))?;
                        out.write_all(b"\n")
                            .map_err(|e| format!("write nl: {}", e))?;
                    }
                }
            }
        }

        Ok(new_id)
    }));
    match result {
        Ok(r) => r,
        Err(_panic) => {
            eprintln!(
                "[SESS-04] fork_session panicked for parent {}; surfacing Err",
                parent_id
            );
            Err("fork_session internal error (panic caught)".to_string())
        }
    }
}

/// RES-03 — Tauri command. Returns `{spent_usd, cap_usd, percent}` for the
/// conversation identified by `session_id`. Reads `{jsonl_log_dir}/<id>.jsonl`,
/// finds the LAST `LoopEvent` with `kind == "cost_update"`, returns its payload
/// joined with the current cost cap. When no cost_update events exist
/// (brand-new session OR every turn ran with smart-off and never emitted —
/// see Plan 34-06 loop_engine cost_update emit which fires UNCONDITIONALLY),
/// returns `spent_usd = 0`.
///
/// Used by:
///   - the chat-input cost-meter chip on session load (one-shot poll —
///     Plan 34-11 frontend);
///   - live ticks come via the `blade_loop_event { kind: "cost_update" }`
///     stream; this command answers "what was the spend before I subscribed?".
///
/// Threat T-34-26 disposition (accept): jsonl_log_dir lives inside the user's
/// own config dir (chmod 0700 on macOS/Linux); cross-user access requires sudo.
/// Threat T-34-27 disposition (accept): forward read with last-wins. For
/// sessions ≥ 10 MB a v1.6 follow-up reads the file's tail first.
#[tauri::command]
pub async fn get_conversation_cost(
    session_id: String,
) -> Result<serde_json::Value, String> {
    validate_session_id(&session_id)?;
    let cfg = crate::config::load_config();
    let cap = cfg.resilience.cost_guard_per_conversation_dollars;
    let dir = cfg.session.jsonl_log_dir.clone();
    let path = dir.join(format!("{}.jsonl", &session_id));
    if !path.exists() {
        return Ok(serde_json::json!({
            "spent_usd": 0.0_f32,
            "cap_usd": cap,
            "percent": 0_u32,
        }));
    }
    let f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    use std::io::BufRead;
    let reader = std::io::BufReader::new(f);
    let mut last_spent: f32 = 0.0;
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<crate::session::log::SessionEvent>(&line) {
            Ok(crate::session::log::SessionEvent::LoopEvent { kind, payload, .. })
                if kind == "cost_update" =>
            {
                if let Some(s) = payload.get("spent_usd").and_then(|v| v.as_f64()) {
                    last_spent = s as f32;
                }
            }
            Ok(_) => continue,
            Err(e) => {
                // Threat T-34-X (defense): a single corrupt line cannot block
                // the whole read. Log to stderr and continue scanning.
                eprintln!(
                    "[SESS-03] get_conversation_cost: skip corrupt JSONL line in {}: {}",
                    session_id, e
                );
                continue;
            }
        }
    }
    let percent = (100.0 * last_spent / cap.max(0.0001)) as u32;
    Ok(serde_json::json!({
        "spent_usd": last_spent,
        "cap_usd": cap,
        "percent": percent,
    }))
}

/// DECOMP-04 (Plan 35-08) — IPC return shape for the `merge_fork_back`
/// Tauri command. The frontend `mergeForkBack(forkId)` typed wrapper
/// (Plan 35-09) deserializes this. Exposed to JS via Tauri's serde bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub fork_id: String,
    pub parent_id: String,
    pub summary_text: String,
}

/// DECOMP-04 (Plan 35-08) — fold a fork's summary back into its parent
/// conversation. Explicit user action only (no auto-merge on fork halt);
/// the SessionsView "Merge back" button (Plan 35-10) calls this.
///
/// Flow per CONTEXT lock §DECOMP-04:
///   1. Validate `fork_id` via Phase 34 SESS-04's `validate_session_id`
///      (Crockford-base32 regex; rejects `../` traversal, null bytes, etc).
///   2. Open `{jsonl_log_dir}/{fork_id}.jsonl`. Read first SessionMeta event,
///      extract parent attribution. If `parent.is_none()` →
///      `Err("session is not a fork — cannot merge back")`.
///   3. Distill the fork's conversation via Plan 35-06's
///      `distill_subagent_summary` with `AgentRole::Analyst`
///      (branch-merge distillation is structurally analytical).
///   4. Append two events to parent's JSONL atomically (fs2 advisory lock):
///        - `LoopEvent { kind: "fork_merged", payload: {fork_id, summary_text}, ts }`
///        - `UserMessage { content: "[Branch merged from fork {id8}…] {summary}", ts }`
///   5. Return `MergeResult { fork_id, parent_id, summary_text }`.
///
/// The fork's own JSONL is NOT deleted; users can fork-then-merge multiple
/// times. Each merge stacks a new event with a fresh ULID (T-35-29 accept).
///
/// Wrapped in `catch_unwind` per Phase 31 / 34 panic-safety discipline:
///   - the distillation path uses async catch_unwind (futures::FutureExt)
///   - the synchronous append path uses std::panic::catch_unwind
/// Either failure surfaces as `Err`; the host process never crashes.
#[tauri::command]
pub async fn merge_fork_back(fork_id: String) -> Result<MergeResult, String> {
    validate_session_id(&fork_id)?;

    let cfg = crate::config::load_config();
    let dir = cfg.session.jsonl_log_dir.clone();
    let fork_path = dir.join(format!("{}.jsonl", &fork_id));
    if !fork_path.exists() {
        return Err(format!("fork session not found: {}", fork_id));
    }

    // (1) Read parent attribution from the fork's first SessionMeta event.
    //     Wrap the synchronous read in catch_unwind so a corrupt JSONL line
    //     never crashes the IPC host.
    let parent_meta_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        read_parent_from_meta(&fork_path)
    }));
    let parent_id = match parent_meta_result {
        Ok(Ok(Some(p))) => p,
        Ok(Ok(None)) => {
            return Err("session is not a fork — cannot merge back".to_string());
        }
        Ok(Err(e)) => return Err(format!("read fork meta: {}", e)),
        Err(_) => {
            eprintln!(
                "[DECOMP-04] read_parent_from_meta panicked for fork {}",
                fork_id
            );
            return Err("read fork meta panicked (catch_unwind)".to_string());
        }
    };

    // Validate the parent_id we just read off disk (defense in depth — if a
    // hostile user edited the JSONL by hand, validate_session_id catches it
    // BEFORE the dir.join() builds a path with traversal segments).
    validate_session_id(&parent_id)
        .map_err(|e| format!("invalid parent id in fork meta: {}", e))?;

    let parent_path = dir.join(format!("{}.jsonl", &parent_id));
    if !parent_path.exists() {
        return Err(format!(
            "parent session not found for fork {} (expected {}.jsonl)",
            fork_id, parent_id
        ));
    }

    // (2) Distill summary via Plan 35-06 (cheap-model + heuristic fallback).
    //     `distill_subagent_summary` already wraps its inner future in
    //     catch_unwind, but we mirror the discipline here for an extra layer
    //     since this is an IPC boundary.
    use futures::FutureExt;
    let distill_future = std::panic::AssertUnwindSafe(async {
        crate::decomposition::summary::distill_subagent_summary(
            &fork_id,
            crate::agents::AgentRole::Analyst,
            &cfg,
        )
        .await
    });
    let summary = match distill_future.catch_unwind().await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            eprintln!("[DECOMP-04] distillation error: {}", e);
            return Err(format!("distillation failed: {}", e));
        }
        Err(_) => {
            eprintln!("[DECOMP-04] distillation panicked");
            return Err("distillation panicked (catch_unwind)".to_string());
        }
    };

    // (3) Build + append the 2 events to parent JSONL.
    let now = crate::session::log::now_ms();
    let merge_event = crate::session::log::SessionEvent::LoopEvent {
        kind: "fork_merged".to_string(),
        payload: serde_json::json!({
            "fork_id": fork_id,
            "summary_text": summary.summary_text,
        }),
        timestamp_ms: now,
    };

    // 8-char fork_id excerpt for the synthetic message header. fork_id is a
    // 26-char ULID after validate_session_id, but use safe_slice anyway —
    // ASCII Crockford base32 is single-byte so &[..8] is safe, but the helper
    // gives uniform discipline across the codebase.
    let id_excerpt = crate::safe_slice(&fork_id, 8);
    let max_chars = (cfg.decomposition.subagent_summary_max_tokens as usize) * 4;
    let synthetic_user = crate::session::log::SessionEvent::UserMessage {
        id: ulid::Ulid::new().to_string(),
        content: format!(
            "[Branch merged from fork {}…] {}",
            id_excerpt,
            crate::safe_slice(&summary.summary_text, max_chars),
        ),
        timestamp_ms: now,
    };

    let append_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        append_events_to_jsonl(&parent_path, &[merge_event, synthetic_user])
    }));
    match append_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            eprintln!("[DECOMP-04] append error: {}", e);
            return Err(format!("append events: {}", e));
        }
        Err(_) => {
            eprintln!("[DECOMP-04] append panicked");
            return Err("append panicked (catch_unwind)".to_string());
        }
    }

    Ok(MergeResult {
        fork_id: fork_id.clone(),
        parent_id,
        summary_text: summary.summary_text,
    })
}

/// Plan 35-08 (DECOMP-04) helper — read first `SessionMeta` event from a
/// JSONL file and return its `parent` attribution.
///   - `Ok(Some(parent))` → file is a fork; parent is the source session.
///   - `Ok(None)` → file is a top-level session OR no SessionMeta found.
///   - `Err(_)` → I/O error opening the file.
///
/// Mirrors `read_meta`'s discipline: corrupt lines are skipped silently;
/// the FIRST SessionMeta wins (later ones, if any, are ignored).
fn read_parent_from_meta(path: &std::path::Path) -> Result<Option<String>, String> {
    use std::io::BufRead;
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(f);
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(ev) = serde_json::from_str::<crate::session::log::SessionEvent>(&line) {
            if let crate::session::log::SessionEvent::SessionMeta { parent, .. } = ev {
                return Ok(parent);
            }
        }
    }
    Ok(None)
}

/// Plan 35-08 (DECOMP-04) helper — atomically append one or more
/// `SessionEvent`s to an existing JSONL file. Uses `fs2` advisory exclusive
/// lock per Phase 34 SESS-01 discipline (T-35-31 mitigation: serializes
/// merge-back appends against any concurrent SessionWriter::append on the
/// same parent JSONL).
///
/// File is opened with `create(true).append(true)` — append-only semantics
/// match SessionWriter; never truncates.
fn append_events_to_jsonl(
    path: &std::path::Path,
    events: &[crate::session::log::SessionEvent],
) -> Result<(), String> {
    use fs2::FileExt;
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("open {}: {}", path.display(), e))?;
    f.lock_exclusive().map_err(|e| format!("flock: {}", e))?;
    for ev in events {
        let line = serde_json::to_string(ev).map_err(|e| format!("serialize: {}", e))?;
        f.write_all(line.as_bytes())
            .map_err(|e| format!("write: {}", e))?;
        f.write_all(b"\n").map_err(|e| format!("write nl: {}", e))?;
    }
    f.unlock().map_err(|e| format!("unlock: {}", e))?;
    Ok(())
}

/// SESS-03 — validate that a session_id is a 26-char Crockford base32 ULID.
/// Rejects path-traversal, null bytes, slashes, etc. Plan 34-03 ships the
/// regex; Plan 34-10 wires it into every command body.
#[allow(dead_code)]
pub(crate) fn validate_session_id(id: &str) -> Result<(), String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"^[0-9A-HJKMNP-TV-Z]{26}$").unwrap());
    if !re.is_match(id) {
        return Err(format!("invalid session id: {}", id));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plan 34-06 — tests that mutate the process-global BLADE_CONFIG_DIR
    /// env var must run serially. Cargo's default parallel-by-default test
    /// harness will interleave set_var/remove_var across threads otherwise,
    /// causing a sibling test to read another test's tmp dir. We acquire
    /// this mutex at the top of every BLADE_CONFIG_DIR-touching test.
    static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn phase34_session_meta_serde_roundtrip() {
        let m = SessionMeta {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            started_at_ms: 1234,
            message_count: 5,
            first_message_excerpt: "hello world".to_string(),
            approximate_tokens: 1000,
            halt_reason: Some("CostExceeded".to_string()),
            parent: None,
        };
        let json = serde_json::to_string(&m).expect("serialize");
        let parsed: SessionMeta = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.id, m.id);
        assert_eq!(parsed.message_count, 5);
        assert_eq!(parsed.halt_reason, Some("CostExceeded".to_string()));
    }

    #[test]
    fn phase34_validate_session_id_accepts_ulid() {
        assert!(validate_session_id("01ARZ3NDEKTSV4RRFFQ69G5FAV").is_ok());
    }

    #[test]
    fn phase34_validate_session_id_rejects_traversal() {
        assert!(validate_session_id("../../etc/passwd").is_err());
        assert!(validate_session_id("..").is_err());
        assert!(validate_session_id("01ARZ3NDEKTSV4RRFFQ69G5FA/").is_err());
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("hello").is_err());
    }

    // ─── Plan 34-10 (SESS-03) — list_sessions metadata extraction tests ───

    /// Helper — write a JSONL session file under `BLADE_CONFIG_DIR/sessions/`.
    /// First line is SessionMeta; remaining events are written in order. Caller
    /// must hold the TEST_ENV_LOCK and have `BLADE_CONFIG_DIR` already set.
    fn write_session_file(
        sessions_dir: &std::path::Path,
        id: &str,
        started_at_ms: u64,
        events_after_meta: &[crate::session::log::SessionEvent],
    ) {
        use std::io::Write;
        let path = sessions_dir.join(format!("{}.jsonl", id));
        let mut f = std::fs::File::create(&path).expect("create session file");
        let meta = crate::session::log::SessionEvent::SessionMeta {
            id: id.to_string(),
            parent: None,
            fork_at_index: None,
            started_at_ms,
        };
        let line = serde_json::to_string(&meta).expect("serialize meta");
        f.write_all(line.as_bytes()).unwrap();
        f.write_all(b"\n").unwrap();
        for e in events_after_meta {
            let line = serde_json::to_string(e).expect("serialize event");
            f.write_all(line.as_bytes()).unwrap();
            f.write_all(b"\n").unwrap();
        }
    }

    /// Helper — provision an isolated BLADE_CONFIG_DIR with `sessions/` subdir.
    /// Returns (root_tmp_dir, sessions_dir). Caller must hold TEST_ENV_LOCK.
    fn provision_sessions_dir(label: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!(
            "blade-sess-list-{}-{}-{}",
            label,
            std::process::id(),
            nanos
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).expect("create tmp root");
        let sessions = tmp.join("sessions");
        std::fs::create_dir_all(&sessions).expect("create sessions dir");
        std::env::set_var("BLADE_CONFIG_DIR", &tmp);
        (tmp, sessions)
    }

    /// SESS-03 — list_sessions returns sessions sorted desc by started_at_ms,
    /// with first_message_excerpt populated from the first UserMessage event,
    /// message_count summing UserMessage + AssistantTurn, approximate_tokens
    /// summing AssistantTurn(tokens_in + tokens_out), and halt_reason from
    /// the last HaltReason event.
    #[tokio::test]
    async fn phase34_sess_03_list_sessions_returns_sorted_by_started_at_desc() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("sorted");

        write_session_file(
            &sessions,
            "01ARZ3NDEKTSV4RRFFQ69G5FAA",
            1000,
            &[
                crate::session::log::SessionEvent::UserMessage {
                    id: "u".into(),
                    content: "hello first".into(),
                    timestamp_ms: 1001,
                },
                crate::session::log::SessionEvent::AssistantTurn {
                    content: "hi".into(),
                    tool_calls: vec![],
                    stop_reason: None,
                    tokens_in: 100,
                    tokens_out: 50,
                    timestamp_ms: 1002,
                },
            ],
        );
        write_session_file(
            &sessions,
            "01ARZ3NDEKTSV4RRFFQ69G5FAB",
            2000,
            &[crate::session::log::SessionEvent::UserMessage {
                id: "u".into(),
                content: "hello second".into(),
                timestamp_ms: 2001,
            }],
        );
        write_session_file(
            &sessions,
            "01ARZ3NDEKTSV4RRFFQ69G5FAC",
            3000,
            &[crate::session::log::SessionEvent::HaltReason {
                reason: "Cancelled".into(),
                payload: serde_json::json!({}),
                timestamp_ms: 3001,
            }],
        );

        let r = list_sessions().await.expect("list");
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);

        assert_eq!(r.len(), 3, "all 3 sessions must be returned");
        assert_eq!(r[0].started_at_ms, 3000, "newest first");
        assert_eq!(r[1].started_at_ms, 2000);
        assert_eq!(r[2].started_at_ms, 1000);
        // SESS-03 metadata extraction
        assert_eq!(r[2].first_message_excerpt, "hello first");
        assert_eq!(r[2].message_count, 2);
        assert_eq!(r[2].approximate_tokens, 150);
        assert_eq!(r[0].halt_reason, Some("Cancelled".to_string()));
    }

    /// SESS-03 — list_sessions skips corrupted JSONL files (no SessionMeta
    /// event present). Writes one valid + one corrupted file, asserts only
    /// the valid one is returned.
    #[tokio::test]
    async fn phase34_sess_03_list_sessions_skips_corrupt_files() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("corrupt");

        write_session_file(&sessions, "01ARZ3NDEKTSV4RRFFQ69G5FA1", 1000, &[]);
        // Corrupt: no SessionMeta event, just garbage lines
        let corrupt = sessions.join("01ARZ3NDEKTSV4RRFFQ69G5FA2.jsonl");
        std::fs::write(&corrupt, b"not json at all\n{}\n").unwrap();

        let r = list_sessions().await.expect("list");
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);

        assert_eq!(r.len(), 1, "corrupted files must be skipped");
        assert_eq!(r[0].id, "01ARZ3NDEKTSV4RRFFQ69G5FA1");
    }

    /// SESS-03 — first_message_excerpt is the first UserMessage's content
    /// (truncated via safe_slice to 120 chars).
    #[tokio::test]
    async fn phase34_sess_03_list_sessions_populates_first_message_excerpt() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("excerpt");

        let long = "a".repeat(500);
        write_session_file(
            &sessions,
            "01ARZ3NDEKTSV4RRFFQ69G5FA3",
            1000,
            &[
                crate::session::log::SessionEvent::UserMessage {
                    id: "u1".into(),
                    content: long.clone(),
                    timestamp_ms: 1,
                },
                crate::session::log::SessionEvent::UserMessage {
                    id: "u2".into(),
                    content: "second message".into(),
                    timestamp_ms: 2,
                },
            ],
        );

        let r = list_sessions().await.expect("list");
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);

        assert_eq!(r.len(), 1);
        assert_eq!(
            r[0].first_message_excerpt.chars().count(),
            120,
            "long content must be truncated to 120 chars by safe_slice"
        );
        assert!(
            r[0].first_message_excerpt.chars().all(|c| c == 'a'),
            "excerpt is the FIRST UserMessage, not the second"
        );
        assert_eq!(r[0].message_count, 2);
    }

    /// SESS-03 — list_sessions does NOT walk the archive/ subdir; only LIVE
    /// sessions are returned.
    #[tokio::test]
    async fn phase34_sess_03_list_sessions_skips_archive_subdir() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("archive");

        write_session_file(&sessions, "01ARZ3NDEKTSV4RRFFQ69G5FA4", 1000, &[]);
        // Place a session in archive/ — it must NOT appear in list_sessions.
        let archive = sessions.join("archive");
        std::fs::create_dir_all(&archive).expect("mkdir archive");
        let archived = archive.join("01ARZ3NDEKTSV4RRFFQ69G5FA0.jsonl");
        let meta = crate::session::log::SessionEvent::SessionMeta {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FA0".into(),
            parent: None,
            fork_at_index: None,
            started_at_ms: 500,
        };
        std::fs::write(
            &archived,
            format!("{}\n", serde_json::to_string(&meta).unwrap()),
        )
        .unwrap();

        let r = list_sessions().await.expect("list");
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);

        assert_eq!(r.len(), 1, "archived sessions must NOT appear");
        assert_eq!(r[0].id, "01ARZ3NDEKTSV4RRFFQ69G5FA4");
    }

    /// SESS-03 — empty jsonl_log_dir → Ok(vec![]).
    #[tokio::test]
    async fn phase34_sess_03_list_sessions_empty_dir() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, _sessions) = provision_sessions_dir("empty");
        let r = list_sessions().await.expect("list");
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(r.is_empty());
    }

    // ─── Plan 34-10 (SESS-04) — fork_session two-pass copy tests ──────────

    /// SESS-04 — fork at index 3 over a parent with 5 messages must copy
    /// exactly 3 messages preceded by a fresh SessionMeta carrying parent.
    #[tokio::test]
    async fn phase34_sess_04_fork_session_creates_new_file_with_parent() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("fork-creates");
        let parent_id = "01ARZ3NDEKTSV4RRFFQ69G5FA1";
        write_session_file(
            &sessions,
            parent_id,
            1000,
            &[
                crate::session::log::SessionEvent::UserMessage {
                    id: "u1".into(),
                    content: "first".into(),
                    timestamp_ms: 1,
                },
                crate::session::log::SessionEvent::AssistantTurn {
                    content: "a1".into(),
                    tool_calls: vec![],
                    stop_reason: None,
                    tokens_in: 0,
                    tokens_out: 0,
                    timestamp_ms: 2,
                },
                crate::session::log::SessionEvent::UserMessage {
                    id: "u2".into(),
                    content: "second".into(),
                    timestamp_ms: 3,
                },
                crate::session::log::SessionEvent::AssistantTurn {
                    content: "a2".into(),
                    tool_calls: vec![],
                    stop_reason: None,
                    tokens_in: 0,
                    tokens_out: 0,
                    timestamp_ms: 4,
                },
                crate::session::log::SessionEvent::UserMessage {
                    id: "u3".into(),
                    content: "third".into(),
                    timestamp_ms: 5,
                },
            ],
        );

        let new_id = fork_session(parent_id.to_string(), 3)
            .await
            .expect("fork");

        let new_path = sessions.join(format!("{}.jsonl", new_id));
        assert!(new_path.exists(), "child session file must exist");
        let buf = std::fs::read_to_string(&new_path).expect("read child");
        let lines: Vec<&str> = buf.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(
            lines.len(),
            4,
            "expected 4 lines (SessionMeta + 3 messages); got {}: {:?}",
            lines.len(),
            lines
        );
        let meta: crate::session::log::SessionEvent =
            serde_json::from_str(lines[0]).expect("parse meta");
        match meta {
            crate::session::log::SessionEvent::SessionMeta {
                parent,
                fork_at_index,
                id,
                ..
            } => {
                assert_eq!(parent, Some(parent_id.to_string()));
                assert_eq!(fork_at_index, Some(3));
                assert_eq!(id, new_id, "SessionMeta.id must match returned ULID");
            }
            _ => panic!("first line must be SessionMeta"),
        }
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// SESS-04 — forking past the end clamps to actual message count. Parent
    /// with 2 messages, fork at 999 → SessionMeta.fork_at_index = 2.
    #[tokio::test]
    async fn phase34_sess_04_fork_session_clamps_index_to_message_count() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("fork-clamp");
        let parent_id = "01ARZ3NDEKTSV4RRFFQ69G5FA2";
        write_session_file(
            &sessions,
            parent_id,
            1000,
            &[
                crate::session::log::SessionEvent::UserMessage {
                    id: "u1".into(),
                    content: "u".into(),
                    timestamp_ms: 1,
                },
                crate::session::log::SessionEvent::AssistantTurn {
                    content: "a".into(),
                    tool_calls: vec![],
                    stop_reason: None,
                    tokens_in: 0,
                    tokens_out: 0,
                    timestamp_ms: 2,
                },
            ],
        );

        let new_id = fork_session(parent_id.to_string(), 999)
            .await
            .expect("fork");
        let new_path = sessions.join(format!("{}.jsonl", new_id));
        let buf = std::fs::read_to_string(&new_path).expect("read child");
        let first_line = buf.lines().next().unwrap_or("");
        let meta: crate::session::log::SessionEvent =
            serde_json::from_str(first_line).expect("parse meta");
        match meta {
            crate::session::log::SessionEvent::SessionMeta {
                fork_at_index, ..
            } => {
                assert_eq!(
                    fork_at_index,
                    Some(2),
                    "fork_at_index must be clamped to actual message count (2)"
                );
            }
            _ => panic!("first line must be SessionMeta"),
        }
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// SESS-04 — forking a session that is itself a fork is rejected with
    /// a clear error message (one-level deep per CONTEXT lock).
    #[tokio::test]
    async fn phase34_sess_04_fork_session_rejects_grandchild() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("fork-grandchild");
        let parent_id = "01ARZ3NDEKTSV4RRFFQ69G5FA3";
        // Construct a parent that is ITSELF a fork.
        let path = sessions.join(format!("{}.jsonl", parent_id));
        let meta = crate::session::log::SessionEvent::SessionMeta {
            id: parent_id.into(),
            parent: Some("01ARZ3NDEKTSV4RRFFQ69G5FA0".into()),
            fork_at_index: Some(2),
            started_at_ms: 1000,
        };
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string(&meta).unwrap()),
        )
        .unwrap();

        let r = fork_session(parent_id.to_string(), 1).await;
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(r.is_err(), "must reject forking a fork");
        let err = r.unwrap_err();
        assert!(
            err.contains("one-level deep") || err.contains("itself a fork"),
            "error must explain the one-level-deep limit; got: {}",
            err
        );
    }

    /// SESS-04 — invalid parent_id is rejected before any filesystem access.
    #[tokio::test]
    async fn phase34_sess_04_fork_session_validates_parent_id() {
        let r = fork_session("../../etc/passwd".to_string(), 0).await;
        assert!(r.is_err(), "must reject path-traversal parent_id");
    }

    // ─── Plan 34-10 (SESS-02 wrapper) — resume_session validation tests ───

    /// SESS-02 wrapper — resume_session must reject path-traversal IDs at
    /// the entry, before any filesystem access fires.
    #[tokio::test]
    async fn phase34_resume_session_validates_session_id() {
        let r = resume_session("../../etc/passwd".to_string()).await;
        assert!(r.is_err(), "must reject path-traversal");
    }

    /// SESS-02 wrapper — when `session.jsonl_log_enabled = false`, resume
    /// returns Err with a clear message (nothing to resume from).
    #[tokio::test]
    async fn phase34_resume_session_disabled_returns_err() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!(
            "blade-resume-disabled-{}-{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&tmp).expect("mkdir");
        // Write a config.json with jsonl_log_enabled=false. DiskConfig
        // requires `provider`, `model`, `onboarded` to be present (no
        // serde(default) on those three fields — see config.rs DiskConfig);
        // every other field uses #[serde(default)] / SessionConfig#[serde(default)]
        // so the partial JSON below is sufficient for our purposes.
        let cfg_path = tmp.join("config.json");
        std::fs::write(
            &cfg_path,
            r#"{"provider":"","model":"","onboarded":false,"session":{"jsonl_log_enabled":false}}"#,
        )
        .unwrap();
        std::env::set_var("BLADE_CONFIG_DIR", &tmp);

        let r = resume_session("01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string()).await;
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(r.is_err(), "must Err when jsonl_log_enabled=false");
        let err = r.unwrap_err();
        assert!(
            err.contains("disabled") || err.contains("nothing to resume"),
            "error must indicate logging disabled; got: {}",
            err
        );
    }

    // ─── Plan 34-06 (RES-03) — get_conversation_cost JSONL read tests ─────

    /// RES-03 — get_conversation_cost reads the LAST cost_update LoopEvent
    /// from the JSONL (not sum, not first — last-wins because each iteration's
    /// emit overwrites the running total). Writes 3 events with spent values
    /// 1.0, 2.0, 3.5 and asserts the read returns 3.5.
    #[tokio::test]
    async fn phase34_get_conversation_cost_reads_last_cost_update() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "blade-test-cost-last-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("BLADE_CONFIG_DIR", &tmp);

        let sessions_dir = tmp.join("sessions");
        std::fs::create_dir_all(&sessions_dir).expect("create sessions dir");
        let session_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        let path = sessions_dir.join(format!("{}.jsonl", session_id));

        let events = vec![
            crate::session::log::SessionEvent::LoopEvent {
                kind: "cost_update".to_string(),
                payload: serde_json::json!({"spent_usd": 1.0, "cap_usd": 25.0, "percent": 4}),
                timestamp_ms: 1000,
            },
            crate::session::log::SessionEvent::LoopEvent {
                kind: "cost_update".to_string(),
                payload: serde_json::json!({"spent_usd": 2.0, "cap_usd": 25.0, "percent": 8}),
                timestamp_ms: 2000,
            },
            crate::session::log::SessionEvent::LoopEvent {
                kind: "cost_update".to_string(),
                payload: serde_json::json!({"spent_usd": 3.5, "cap_usd": 25.0, "percent": 14}),
                timestamp_ms: 3000,
            },
        ];
        use std::io::Write;
        let mut f = std::fs::File::create(&path).expect("create jsonl");
        for e in &events {
            let line = serde_json::to_string(e).expect("serialize");
            f.write_all(line.as_bytes()).expect("write");
            f.write_all(b"\n").expect("newline");
        }
        drop(f);

        let r = get_conversation_cost(session_id.to_string())
            .await
            .expect("read");
        let spent = r["spent_usd"].as_f64().expect("spent_usd");
        assert!(
            (spent - 3.5).abs() < 0.001,
            "expected last cost_update.spent_usd=3.5; got {}",
            spent
        );
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// RES-03 — missing JSONL (brand-new session that hasn't run yet) returns
    /// spent_usd=0 with the configured cap. NOT an error.
    #[tokio::test]
    async fn phase34_get_conversation_cost_missing_session_returns_zero() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "blade-test-cost-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        // Create the dir but NOT the sessions/ subdir or any JSONL — the
        // command must handle the missing-file path cleanly.
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("BLADE_CONFIG_DIR", &tmp);
        let r = get_conversation_cost("01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string())
            .await
            .expect("read");
        let spent = r["spent_usd"].as_f64().expect("spent_usd");
        assert_eq!(spent, 0.0);
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// RES-03 / SESS-03 — validate_session_id rejects path-traversal IDs
    /// before any filesystem access fires. Defense in depth even though the
    /// canonical path build (jsonl_log_dir.join(format!("{}.jsonl"))) would
    /// not honor a ".." segment cleanly anyway.
    #[tokio::test]
    async fn phase34_get_conversation_cost_rejects_invalid_id() {
        let r = get_conversation_cost("../../etc/passwd".to_string()).await;
        assert!(r.is_err(), "must reject path-traversal id");
    }

    /// Phase 34 / BL-02 (REVIEW finding) — full resume round-trip integration
    /// test. Provisions a JSONL file in a tmp BLADE_CONFIG_DIR with a real
    /// SessionWriter (so we exercise the actual append path), calls
    /// `resume_session`, and verifies the returned messages match what was
    /// appended in order. This is the regression guard for the v1.5
    /// "Resume returns empty conversation" bug — if a future edit drops the
    /// replay step or returns Err for live JSONL, this test fails loudly.
    #[tokio::test]
    async fn phase34_sess_02_resume_round_trip_e2e() {
        let _g = TEST_ENV_LOCK.lock().unwrap();
        let (tmp, sessions) = provision_sessions_dir("resume-roundtrip");

        // Use the real SessionWriter::new_with_id with a known id so we can
        // resume by that exact id afterwards. ULID format required by
        // validate_session_id, so generate one fresh.
        let id = ulid::Ulid::new().to_string();
        let (writer, returned_id) =
            crate::session::log::SessionWriter::new_with_id(&sessions, true, Some(id.clone()))
                .expect("writer init");
        assert_eq!(
            returned_id, id,
            "new_with_id must reuse the existing id verbatim (BL-02 contract)"
        );

        // Append: SessionMeta + UserMessage + AssistantTurn + ToolCall.
        writer.append(&crate::session::log::SessionEvent::SessionMeta {
            id: id.clone(),
            parent: None,
            fork_at_index: None,
            started_at_ms: crate::session::log::now_ms(),
        });
        writer.append(&crate::session::log::SessionEvent::UserMessage {
            id: "u1".to_string(),
            content: "first user message".to_string(),
            timestamp_ms: 1,
        });
        writer.append(&crate::session::log::SessionEvent::AssistantTurn {
            content: "first assistant reply".to_string(),
            tool_calls: vec![],
            stop_reason: Some("end_turn".to_string()),
            tokens_in: 10,
            tokens_out: 5,
            timestamp_ms: 2,
        });
        writer.append(&crate::session::log::SessionEvent::ToolCall {
            name: "read_file".to_string(),
            args: serde_json::json!({"path": "/tmp/x"}),
            result: Some("ok content".to_string()),
            error: None,
            timestamp_ms: 3,
        });

        // Now resume — same id.
        let r = resume_session(id.clone()).await.expect("resume_session");

        // Round-trip assertions:
        assert_eq!(r.session_id, id, "resume must echo the requested id");
        assert_eq!(
            r.messages.len(),
            3,
            "expected 3 messages: User + Assistant + Tool. Got {}: {:?}",
            r.messages.len(),
            r.messages
        );
        assert_eq!(r.messages[0]["role"], "user");
        assert_eq!(r.messages[0]["content"], "first user message");
        assert_eq!(r.messages[1]["role"], "assistant");
        assert_eq!(r.messages[1]["content"], "first assistant reply");
        assert_eq!(r.messages[2]["role"], "tool");
        assert_eq!(r.messages[2]["tool_name"], "read_file");
        assert_eq!(r.messages[2]["content"], "ok content");
        assert_eq!(r.messages[2]["is_error"], false);

        // Cleanup.
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ─── Plan 35-08 (DECOMP-04) — merge_fork_back tests ─────────────────────

    /// DECOMP-04 — MergeResult serializes/deserializes losslessly. Frontend
    /// IPC contract: Plan 35-09 mirrors this struct in TS.
    #[test]
    fn phase35_decomp_04_merge_result_serde_roundtrip() {
        let m = MergeResult {
            fork_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            parent_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW".to_string(),
            summary_text: "merged content from fork".to_string(),
        };
        let json = serde_json::to_string(&m).expect("serialize");
        let parsed: MergeResult = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.fork_id, m.fork_id);
        assert_eq!(parsed.parent_id, m.parent_id);
        assert_eq!(parsed.summary_text, m.summary_text);
    }

    /// DECOMP-04 — `read_parent_from_meta` returns Some(parent) for a fork
    /// (SessionMeta with `parent: Some(_)`) and None for a top-level session
    /// (SessionMeta with `parent: None`). Both cases exercise the helper's
    /// first-SessionMeta-wins discipline.
    #[test]
    fn phase35_decomp_04_read_parent_from_meta_helper() {
        // Use a fresh tmp dir; this test does NOT mutate BLADE_CONFIG_DIR
        // (read_parent_from_meta takes an absolute path), so no env lock.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "blade-decomp-04-readmeta-{}-{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");

        // Fork file: SessionMeta.parent = Some(parent_id).
        let parent_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string();
        let fork_id = "01ARZ3NDEKTSV4RRFFQ69G5FAW".to_string();
        let fork_path = dir.join(format!("{}.jsonl", fork_id));
        let fork_meta = crate::session::log::SessionEvent::SessionMeta {
            id: fork_id.clone(),
            parent: Some(parent_id.clone()),
            fork_at_index: Some(3),
            started_at_ms: 0,
        };
        std::fs::write(
            &fork_path,
            format!("{}\n", serde_json::to_string(&fork_meta).unwrap()),
        )
        .unwrap();
        assert_eq!(
            read_parent_from_meta(&fork_path).unwrap(),
            Some(parent_id),
            "fork SessionMeta must yield Some(parent_id)"
        );

        // Top-level file: SessionMeta.parent = None.
        let top_id = "01ARZ3NDEKTSV4RRFFQ69G5FAX".to_string();
        let top_path = dir.join(format!("{}.jsonl", top_id));
        let top_meta = crate::session::log::SessionEvent::SessionMeta {
            id: top_id.clone(),
            parent: None,
            fork_at_index: None,
            started_at_ms: 0,
        };
        std::fs::write(
            &top_path,
            format!("{}\n", serde_json::to_string(&top_meta).unwrap()),
        )
        .unwrap();
        assert_eq!(
            read_parent_from_meta(&top_path).unwrap(),
            None,
            "top-level SessionMeta must yield None"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// DECOMP-04 — `append_events_to_jsonl` extends an existing JSONL file
    /// rather than truncating it; events are written in order, one per line.
    #[test]
    fn phase35_decomp_04_append_events_to_jsonl_helper() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "blade-decomp-04-append-{}-{}",
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("01ARZ3NDEKTSV4RRFFQ69G5FAV.jsonl");

        // Seed the file with one event so we can verify append semantics.
        let seed = crate::session::log::SessionEvent::UserMessage {
            id: "u-seed".to_string(),
            content: "seed turn".to_string(),
            timestamp_ms: 1,
        };
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string(&seed).unwrap()),
        )
        .unwrap();

        let appended = vec![
            crate::session::log::SessionEvent::LoopEvent {
                kind: "fork_merged".to_string(),
                payload: serde_json::json!({"fork_id": "X", "summary_text": "S"}),
                timestamp_ms: 2,
            },
            crate::session::log::SessionEvent::UserMessage {
                id: "u-merge".to_string(),
                content: "[Branch merged from fork XXXXXXXX…] S".to_string(),
                timestamp_ms: 3,
            },
        ];
        append_events_to_jsonl(&path, &appended).expect("append ok");

        let buf = std::fs::read_to_string(&path).expect("read");
        let lines: Vec<&str> = buf.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(
            lines.len(),
            3,
            "seed + 2 appended must yield 3 lines; got {}: {:?}",
            lines.len(),
            lines
        );
        assert!(
            lines[0].contains("seed turn"),
            "seed must survive append (no truncation); line0={}",
            lines[0]
        );
        assert!(
            lines[1].contains("fork_merged"),
            "first appended must be the LoopEvent; line1={}",
            lines[1]
        );
        assert!(
            lines[2].contains("[Branch merged from fork"),
            "second appended must be the synthetic UserMessage; line2={}",
            lines[2]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// DECOMP-04 — `merge_fork_back` rejects path-traversal fork ids before
    /// any filesystem access fires (Phase 34 SESS-04 hardening reused).
    #[tokio::test]
    async fn phase35_decomp_04_merge_validates_session_id() {
        let r = merge_fork_back("../../etc/passwd".to_string()).await;
        assert!(r.is_err(), "path-traversal fork_id must be rejected");
        let r2 = merge_fork_back("".to_string()).await;
        assert!(r2.is_err(), "empty fork_id must be rejected");
        let r3 = merge_fork_back("not-a-ulid".to_string()).await;
        assert!(r3.is_err(), "non-ULID fork_id must be rejected");
    }

    /// DECOMP-04 — `merge_fork_back` returns Err when the fork JSONL exists
    /// but its SessionMeta carries `parent: None` (top-level session that is
    /// not a fork). The error message must explain the rejection.
    #[tokio::test]
    async fn phase35_decomp_04_merge_rejects_non_fork() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("decomp-04-non-fork");
        let id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        // SessionMeta with NO parent — file exists, but it's not a fork.
        write_session_file(&sessions, id, 1000, &[]);

        let r = merge_fork_back(id.to_string()).await;
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(r.is_err(), "non-fork session must be rejected");
        let err = r.unwrap_err();
        assert!(
            err.contains("not a fork") || err.contains("cannot merge back"),
            "error must explain non-fork rejection; got: {}",
            err
        );
    }

    /// DECOMP-04 — `merge_fork_back` returns Err when the fork JSONL itself
    /// is missing on disk (e.g. user manually deleted it).
    #[tokio::test]
    async fn phase35_decomp_04_merge_rejects_missing_fork_file() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, _sessions) = provision_sessions_dir("decomp-04-missing-fork");
        let r = merge_fork_back("01ARZ3NDEKTSV4RRFFQ69G5FZZ".to_string()).await;
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(r.is_err(), "missing fork JSONL must Err");
        let err = r.unwrap_err();
        assert!(
            err.contains("not found") || err.contains("fork session"),
            "error must indicate missing fork; got: {}",
            err
        );
    }

    /// DECOMP-04 — `merge_fork_back` returns Err when the fork attributes a
    /// parent but the parent JSONL is missing (orphaned fork).
    #[tokio::test]
    async fn phase35_decomp_04_merge_rejects_missing_parent_jsonl() {
        let _guard = TEST_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (tmp, sessions) = provision_sessions_dir("decomp-04-orphan");
        let parent_id = "01ARZ3NDEKTSV4RRFFQ69G5FAA";
        let fork_id = "01ARZ3NDEKTSV4RRFFQ69G5FAB";
        // Write ONLY the fork; deliberately do NOT create the parent file.
        let fork_path = sessions.join(format!("{}.jsonl", fork_id));
        let meta = crate::session::log::SessionEvent::SessionMeta {
            id: fork_id.to_string(),
            parent: Some(parent_id.to_string()),
            fork_at_index: Some(0),
            started_at_ms: 1000,
        };
        std::fs::write(
            &fork_path,
            format!("{}\n", serde_json::to_string(&meta).unwrap()),
        )
        .unwrap();

        let r = merge_fork_back(fork_id.to_string()).await;
        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);

        assert!(r.is_err(), "orphan fork (missing parent) must Err");
        let err = r.unwrap_err();
        assert!(
            err.contains("parent session not found"),
            "error must explain missing parent; got: {}",
            err
        );
    }

    /// Phase 34 / BL-02 — `SessionWriter::new_with_id` reusing an existing id
    /// MUST append to the existing JSONL file rather than truncating it.
    /// Critical for the resume → continue flow: when the user resumes a
    /// session and types a new message, that turn's UserMessage event must
    /// extend the same JSONL.
    #[tokio::test]
    async fn phase34_sess_01_new_with_id_appends_to_existing_jsonl() {
        let _g = TEST_ENV_LOCK.lock().unwrap();
        let (tmp, sessions) = provision_sessions_dir("new-with-id-append");

        let id = ulid::Ulid::new().to_string();

        // First writer — write event A.
        let (w1, _) =
            crate::session::log::SessionWriter::new_with_id(&sessions, true, Some(id.clone()))
                .expect("first writer");
        w1.append(&crate::session::log::SessionEvent::UserMessage {
            id: "u1".to_string(),
            content: "first turn".to_string(),
            timestamp_ms: 1,
        });
        drop(w1);

        // Second writer — same id, write event B. Must NOT truncate event A.
        let (w2, _) =
            crate::session::log::SessionWriter::new_with_id(&sessions, true, Some(id.clone()))
                .expect("second writer");
        w2.append(&crate::session::log::SessionEvent::UserMessage {
            id: "u2".to_string(),
            content: "second turn".to_string(),
            timestamp_ms: 2,
        });
        drop(w2);

        // Read the file back; both events must be present in order.
        let path = sessions.join(format!("{}.jsonl", &id));
        let content = std::fs::read_to_string(&path).expect("read jsonl");
        let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(
            lines.len(),
            2,
            "JSONL must contain both events (no truncation on second writer); got {} lines",
            lines.len()
        );
        assert!(
            lines[0].contains("first turn"),
            "first event must survive a second SessionWriter::new_with_id; line0={}",
            lines[0]
        );
        assert!(
            lines[1].contains("second turn"),
            "second event must be appended; line1={}",
            lines[1]
        );

        std::env::remove_var("BLADE_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
