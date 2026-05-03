# Phase 24 — Skill Consolidation in dream_mode — Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 14 (5 NEW, 9 MODIFIED — count includes one binary handlers refactor target & one optional integration test)
**Analogs found:** 14 / 14 (100% — Phase 24 is fully repo-internal substrate; every target has a sibling pattern in-tree)

---

## File Classification

| New / Modified File | Action | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|--------|------|-----------|----------------|---------------|
| `src-tauri/src/skills/lifecycle.rs` | NEW | pure-logic module | transform / batch | `src-tauri/src/reward.rs` (Phase 23 pure compose + persist) | **role + flow match** |
| `src-tauri/src/skills/pending.rs` | NEW | filesystem queue / store | CRUD (file-I/O) | `src-tauri/src/session_handoff.rs` (single-file JSON read/write under blade_config_dir) | **role + flow match** |
| `src-tauri/src/skills/mod.rs` | MODIFY | module index | n/a | itself (lines 36–43, existing `pub mod` block) | **exact** |
| `src-tauri/src/tool_forge.rs` | MODIFY | service (CRUD) — schema + writes | request-response (DB) | self (lines 132–150 `ensure_table`; 694–708 `record_tool_use`); INSERT site (464–480) | **exact** |
| `src-tauri/src/dream_mode.rs` | MODIFY | background task chain | event-driven (idle pulse) | self (lines 243–246 `task_skill_synthesis`; 393–420 `run_task!`; 467–505 monitor loop) | **exact** |
| `src-tauri/src/voyager_log.rs` | MODIFY | event emitter | pub-sub (ActivityStrip) | self (lines 67–116 four existing `gap_detected`/`skill_written`/`skill_registered`/`skill_used` helpers) | **exact** |
| `src-tauri/src/session_handoff.rs` | MODIFY | model + filesystem record | request-response (file-I/O) | self (lines 21–26 `SessionHandoff` struct; 51–116 `write_session_handoff` JSON write) | **exact** |
| `src-tauri/src/skills/loader.rs` | MODIFY | scanner / aggregator | batch read | self (lines 21–98 `scan_tier`; 100–122 root resolvers) | **exact** |
| `src-tauri/src/skills/export.rs` | MODIFY (touch only if archive helper lands) | service — fs write | request-response (file-I/O) | self (lines 70–134 `export_to_user_tier`) | **exact** |
| `src-tauri/src/proactive_engine.rs` | MODIFY | detector + decision_gate router | pub-sub (event loop) | self (lines 576–668 `run_detector!` macro + decision_gate routing) | **exact** |
| `src-tauri/src/intent_router.rs` | MODIFY | classifier | request-response (sync) | self (lines 17–95 `IntentClass` enum + `classify_intent_class` heuristic Tier 1) | **exact** |
| `src-tauri/src/commands.rs` | MODIFY | controller — dispatch hook | request-response | self (line 715 `turn_acc.new()`; line 1831 `compute_and_persist_turn_reward`; lines 2167–2179 `turn_acc.record_tool_call`) | **exact** |
| `src-tauri/src/db.rs` | MODIFY | schema migration | n/a | self (lines 167–250+ `run_migrations` `execute_batch` block) | **exact** |
| `src-tauri/src/bin/skill_validator.rs` | MODIFY | CLI binary | request-response | self (lines 21–105 `main()` flag-parser → `ExitCode`) | **exact** |
| `tests/dream_mode_e2e_test.rs` (optional Wave 3) | NEW | integration test | request-response | `src-tauri/src/reward.rs` lines 945–971 `record_appends_jsonl` (TempDir + env override pattern) | **role + flow match** |

---

## Pattern Assignments

### NEW: `src-tauri/src/skills/lifecycle.rs` (pure-logic module — DREAM-01/-02/-03)

**Analog:** `src-tauri/src/reward.rs` — Phase 23's parallel pure-logic substrate.

**Why this analog:** `reward.rs` is the freshest example of "pure-arithmetic + DB read + thin persistence wrapper" in the repo. It establishes the canonical shape for new substrate modules: `compose()` is a pure stateless function; `record_reward()` does fs append; tests live inline in `mod tests` with `BLADE_REWARD_HISTORY_PATH` env override. `lifecycle.rs` mirrors that: pure functions (`prune_candidates`, `deterministic_merge_body`, `ensure_unique_name`, `proposed_name_from_trace`) + a few side-effecting helpers (`archive_skill`) + inline tests.

**Imports excerpt** (`reward.rs:49–55`):
```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use crate::config::RewardWeights;
```

**Pure-function pattern** — `reward.rs:compose` is the deterministic-arithmetic shape `deterministic_merge_body` will mirror (no LLM, no I/O, deterministic on inputs, clamped/normalized output). Test names from `reward.rs:920–940` (`composite_clamps_to_unit_interval`) demonstrate the required test invariants.

**Deterministic merge body — exact spec from RESEARCH.md §"Deterministic Merge Body" (lines 546–584):**
```rust
pub fn deterministic_merge_body(a: &ForgedTool, b: &ForgedTool) -> ForgedTool {
    let (smaller, larger) = if a.name <= b.name { (a, b) } else { (b, a) };
    let base_name = format!("{}_merged", smaller.name);
    let merged_name = ensure_unique_name(&base_name);
    ForgedTool {
        id: uuid::Uuid::new_v4().to_string(),
        name: merged_name,
        description: format!("{} | {}", a.description, b.description),
        language: smaller.language.clone(),
        script_path: smaller.script_path.clone(),
        usage: dedup_lines(&format!("{}\n{}", a.usage, b.usage)),
        parameters: union_dedup_by_name(&a.parameters, &b.parameters),
        test_output: format!("{}\n--- merged ---\n{}", a.test_output, b.test_output),
        created_at: chrono::Utc::now().timestamp(),
        last_used: Some(chrono::Utc::now().timestamp()),  // D-24-A
        use_count: 0,
        forged_from: format!("merge:{}+{}", smaller.name, larger.name),
    }
}
```

**Test isolation pattern** (clone from `reward.rs:945–971` — uses `tempfile::NamedTempFile` + `BLADE_*` env override + `--test-threads=1`). The `BLADE_CONFIG_DIR` env var is the canonical seam (`config.rs:654–668`):
```rust
pub fn blade_config_dir() -> PathBuf {
    if let Ok(override_dir) = std::env::var("BLADE_CONFIG_DIR") {
        let p = PathBuf::from(override_dir);
        fs::create_dir_all(&p).ok();
        return p;
    }
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("blade");
    fs::create_dir_all(&config_dir).ok();
    config_dir
}
```

**Imports / wiring required:**
- `crate::tool_forge::{ForgedTool, ToolParameter}` for the merge body type
- `crate::skills::user_root` for archive destination (loader.rs:108)
- `crate::skills::export::sanitize_name` for name → fs-dir mapping (export.rs:39)
- `crate::embeddings::{embed_texts, cosine_similarity}` (embeddings.rs:23, 33) — note `cosine_similarity` is currently private (`fn` not `pub fn`); lifecycle.rs needs it `pub` or reimplements (4-line port)
- `chrono`, `uuid`, `serde_json` (all in Cargo.toml)
- `rusqlite::Connection` open via `crate::tool_forge::open_db()` (currently private — also needs `pub(crate)` exposure or a lifecycle-side reopen)

**Gotchas:**
- **Pitfall 4 (RESEARCH.md:261–276):** materialize prune candidates via `.collect::<Vec<_>>()` BEFORE the SELECT cursor closes; per-row update opens its own short-lived `Connection`. SQLite WAL handles reader+writer concurrency.
- **Pitfall 8 (RESEARCH.md:321–338):** prune touches ONLY `forged_tools` DB row + `~/.blade/skills/<name>/` filesystem dir. Do NOT touch `brain_skills` (Phase 21 substrate) or `~/.blade/tools/<name>.<ext>` script file.
- **CLAUDE.md "Don't use `&text[..n]` on user content":** any string trim in `proposed_name_from_trace` MUST use `crate::safe_slice` — see `proposed_name_from_trace` reference impl in RESEARCH.md:651–660 already uses `crate::safe_slice(&truncated, 50)`.
- **CLAUDE.md "Tauri command name uniqueness is FLAT":** lifecycle.rs is *not* expected to expose any `#[tauri::command]` — keep it pure-Rust.

---

### NEW: `src-tauri/src/skills/pending.rs` (filesystem queue — D-24-B)

**Analog:** `src-tauri/src/session_handoff.rs` — single-file JSON read/write under `blade_config_dir()` is the closest established pattern for transient operator-state files.

**Why this analog:** `session_handoff.rs` writes `<config_dir>/session_handoff.json` via plain `fs::write` of a `serde_json::to_string_pretty`-encoded struct, with read-side guarded by recency (`< 7 days`). `pending.rs` does the same, except per-proposal (one file per id) instead of single-file — but the read/write/age-filter primitives are identical.

**Imports excerpt** (`session_handoff.rs:16–26`):
```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandoff {
    pub summary: String,
    pub last_commands: Vec<String>,
    pub pending_items: Vec<String>,
    pub generated_at: i64,
}

fn handoff_path() -> PathBuf {
    crate::config::blade_config_dir().join("session_handoff.json")
}
```

**Read-with-age-filter pattern** (`session_handoff.rs:37–48` — clone for `auto_dismiss_old`):
```rust
pub fn load_last_handoff() -> Option<SessionHandoff> {
    let data = std::fs::read_to_string(handoff_path()).ok()?;
    let handoff: SessionHandoff = serde_json::from_str(&data).ok()?;
    let age = chrono::Utc::now().timestamp() - handoff.generated_at;
    if age > 7 * 86400 {
        return None;
    }
    Some(handoff)
}
```

**Write pattern** (`session_handoff.rs:113–115`):
```rust
if let Ok(json) = serde_json::to_string_pretty(&handoff) {
    let _ = std::fs::write(handoff_path(), json);
}
```

**Directory-walk pattern (clone from `skills/loader.rs:24–47` for `read_proposals()`):**
```rust
let entries = match fs::read_dir(root) {
    Ok(rd) => rd,
    Err(_) => return out, // not-a-directory or doesn't-exist — silent (expected)
};
for entry in entries.flatten() {
    let dir = entry.path();
    if !dir.is_dir() { continue; }
    if dir.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with('.')).unwrap_or(false) {
        continue;
    }
    // … parse / collect
}
```

**Imports / wiring required:**
- `serde::{Serialize, Deserialize}`, `std::path::PathBuf`, `std::fs`, `chrono`, `uuid`, `serde_json`
- `crate::config::blade_config_dir` (config.rs:654)
- `crate::skills::user_root` (loader.rs:108) for the parent `<user_root>/.pending/` path
- For `content_hash` dedup: use `std::collections::hash_map::DefaultHasher` per RESEARCH.md A1 (sha2 NOT in Cargo.toml — confirmed line 32–64 of `src-tauri/Cargo.toml`)

**Gotchas:**
- **Pitfall 6 (RESEARCH.md:293–304):** `proactive_engine` consumer of pending.rs MUST gate drain on `LAST_ACTIVITY ≥30s` — that's a consumer concern, but `pending.rs` should expose `read_proposals()` purely (no automatic drain).
- **Pitfall 7 (RESEARCH.md:306–319):** proposal_id is the binding key in the chat-injected message; `pending.rs::write_proposal` MUST use a short, lookup-friendly id (RESEARCH.md:526 — `uuid::Uuid::new_v4().to_string()[..8]`). All ids must satisfy regex `[a-f0-9]{4,}` for intent_router parsing.
- **`.pending/` is a hidden dir** — `skills/loader.rs:34–42` already skips dotfiles, so a future scan_tier on user_root won't pick up pending entries (this is what we want).

---

### MODIFY: `src-tauri/src/skills/mod.rs` (module registration)

**Analog:** itself, lines 36–43:

```rust
pub mod activate;
pub mod consent;
pub mod export;
pub mod loader;
pub mod parser;
pub mod resolver;
pub mod types;
pub mod validator;
```

**Action:** add two lines after `validator;`:
```rust
pub mod lifecycle;
pub mod pending;
```

**Imports / wiring required:** none — Tauri's lib.rs auto-picks up via the existing `mod skills;` declaration. **CLAUDE.md "Module registration EVERY TIME"** rule item 1 is satisfied by editing this file (mod.rs IS the registration site for the skills/ submodule tree); item 2 (generate_handler!) does NOT trigger because Wave 2 lands NO `#[tauri::command]` per RESEARCH.md:1041 ("No new Tauri commands expected for Wave 2").

**Gotchas:** none — mod.rs is the canonical exposure site.

---

### MODIFY: `src-tauri/src/tool_forge.rs` (schema + record_tool_use extension)

**Analog:** itself — `ensure_table` (lines 132–150) and `record_tool_use` (lines 694–708) are the canonical sites.

**Existing `ensure_table` pattern** (lines 132–150 — extend with backfill UPDATE + sibling table):
```rust
fn ensure_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS forged_tools (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            language TEXT NOT NULL,
            script_path TEXT NOT NULL,
            usage TEXT NOT NULL,
            parameters TEXT DEFAULT '[]',
            test_output TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            last_used INTEGER,
            use_count INTEGER DEFAULT 0,
            forged_from TEXT DEFAULT ''
        );",
    )
    .map_err(|e| format!("DB schema error: {}", e))
}
```

**INSERT site** (lines 464–480) — D-24-A bind change. Current literal `NULL` at column 10 of the VALUES tuple becomes `?10`, and the params! list grows from 10 args to 11 (or, equivalently, reuse `now` as the bind):
```rust
if let Err(e) = conn.execute(
    "INSERT INTO forged_tools \
     (id, name, description, language, script_path, usage, parameters, test_output, created_at, last_used, use_count, forged_from) \
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 0, ?10)",  // ← change NULL → ?9 (rebind now) or add ?11
    params![
        id, name, gen.description, language, script_path_str,
        usage, params_json, test_output, now, capability,
    ],
)
```

**Struct-literal site** (lines 490–503) — must change `last_used: None` → `last_used: Some(now)`:
```rust
let forged = ForgedTool {
    id, name,
    description: gen.description,
    language: language.to_string(),
    script_path: script_path_str,
    usage,
    parameters: gen.parameters,
    test_output,
    created_at: now,
    last_used: None,        // ← change to Some(now) per D-24-A
    use_count: 0,
    forged_from: capability.to_string(),
};
```

**Existing `record_tool_use`** (lines 694–708) — the function whose signature must grow to take a trace per RESEARCH.md:888–917:
```rust
#[allow(dead_code)]
pub fn record_tool_use(name: &str) {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return,
    };
    ensure_table(&conn).ok();
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE forged_tools SET use_count = use_count + 1, last_used = ?1 WHERE name = ?2",
        params![now, name],
    )
    .ok();
    crate::voyager_log::skill_used(name);
}
```

**Imports / wiring required:**
- `rusqlite::params` already imported (line 12)
- For `compute_trace_hash`: `std::collections::hash_map::DefaultHasher` + `std::hash::{Hash, Hasher}` — same pattern as `dream_mode.rs:52–62` `uuid_v4()` (no new dep needed; sha2 not in Cargo.toml per RESEARCH.md A1)
- `conn.transaction()` for the INSERT+DELETE auto-prune wrap (Pitfall 3) — `rusqlite::Transaction` is on the existing `rusqlite::Connection` surface

**Gotchas:**
- **Pitfall 1 (RESEARCH.md:210–225):** TWO sites — SQL `NULL` AND struct `last_used: None`. Acceptance grep: `grep -c "last_used: None" src-tauri/src/tool_forge.rs` MUST equal 0 after the change.
- **Pitfall 3 (RESEARCH.md:247–259):** wrap INSERT + auto-prune DELETE in `conn.transaction()`. Without the txn, a concurrent dream-mode read between the two statements sees inconsistent state.
- **Pitfall 4 (RESEARCH.md:261–276):** dream pass should open its OWN `Connection`, not share one with the chat path; SQLite WAL handles concurrent readers + 1 writer.
- **CLAUDE.md "SQL in `execute_batch!` — NO double quotes inside SQL strings":** the existing string at line 134–148 uses single quotes for SQL string literals (`DEFAULT '[]'`, `DEFAULT ''`); preserve that convention in the new `forged_tools_invocations` CREATE block.
- **CLAUDE.md "Duplicate `#[tauri::command]` function names":** no new commands here, but verify no naming collisions if `record_tool_use` ever gains `#[tauri::command]`.

---

### MODIFY: `src-tauri/src/dream_mode.rs` (3 new tasks + DREAMING checkpoints)

**Analog:** itself — `task_skill_synthesis` (lines 243–246) is the closest existing 1-line task; `run_task!` macro (lines 393–420) is the per-task wrapper that must be reused; lines 467–505 are the monitor loop with idle-threshold + interrupt logic that Phase 24 inherits unchanged.

**Existing 1-task pattern (lines 243–246 — clone shape for new tasks):**
```rust
/// Task 4 — Skill synthesis.
async fn task_skill_synthesis(app: tauri::AppHandle) -> String {
    crate::skill_engine::maybe_synthesize_skills(app).await;
    "Reviewed skill patterns".to_string()
}
```

**Existing `run_task!` macro + bail-early DREAMING checkpoint (lines 393–420):**
```rust
macro_rules! run_task {
    ($name:expr, $fut:expr) => {{
        let task_name = $name;
        let _ = app.emit_to("main", "dream_task_start", serde_json::json!({ "task": task_name }));
        let result: String =
            match tokio::time::timeout(tokio::time::Duration::from_secs(120), $fut).await {
                Ok(insight) => insight,
                Err(_) => format!("{} timed out", task_name),
            };
        let _ = app.emit_to("main", "dream_task_complete",
            serde_json::json!({ "task": task_name, "insight": result }),
        );
        tasks_completed.push(task_name.to_string());
        insights.push(result);

        // Bail early if user became active during a task
        if !DREAMING.load(Ordering::Relaxed) {
            return DreamSession { id, started_at, ended_at: Some(now_secs()),
                                  tasks_completed, insights,
                                  status: "interrupted".to_string() };
        }
    }};
}
```

**Existing task-chain invocation site (lines 422–442) — Phase 24 splices 3 new lines after line 432:**
```rust
// Task 4 — Skill synthesis
run_task!("skill_synthesis", task_skill_synthesis(app.clone()));

// Phase 24 (v1.3) — Voyager forgetting half:
run_task!("skill_prune",       task_skill_prune(app.clone()));
run_task!("skill_consolidate", task_skill_consolidate(app.clone()));
run_task!("skill_from_trace",  task_skill_from_trace(app.clone()));

// Task 5 — Code health scan
run_task!("code_health_scan", task_code_health_scan());
```

**Existing 1200s idle threshold + interrupt (lines 467–505) — INHERITED, no edits per D-24-D:**
```rust
let last = LAST_ACTIVITY.load(Ordering::Relaxed);
let idle_secs = now_secs() - last;
let already_dreaming = DREAMING.load(Ordering::Relaxed);

if already_dreaming && idle_secs < 60 {
    DREAMING.store(false, Ordering::SeqCst);
    let _ = app.emit_to("main", "dream_mode_end", serde_json::json!({
        "reason": "interrupted",
        "tasks_completed": 0,
    }));
    continue;
}
if idle_secs >= 1200 && !already_dreaming { /* spawn run_dream_session */ }
```

**Per-step DREAMING checkpoint pattern (per RESEARCH.md §"Per-Step Checkpoint Placement" lines 794–803):** inside the new task bodies, between work units >100ms — the literal pattern is the same `if !DREAMING.load(Ordering::Relaxed) { break; }` already in the macro. Example placement (paraphrased from research:800):
```rust
for candidate in prune_candidates {
    if !crate::dream_mode::DREAMING.load(std::sync::atomic::Ordering::Relaxed) { break; }
    // archive row N+1
}
```

**Manual test entrypoint (lines 515–531) — REUSED for `abort_within_one_second` integration test:**
```rust
#[tauri::command]
pub async fn dream_trigger_now(app: tauri::AppHandle) -> Result<DreamSession, String> {
    if DREAMING.swap(true, Ordering::SeqCst) {
        return Err("Dream session already in progress".to_string());
    }
    let _ = app.emit_to("main", "dream_mode_start", serde_json::json!({ "idle_secs": 0, "manual": true }));
    let session = run_dream_session(app.clone()).await;
    DREAMING.store(false, Ordering::SeqCst);
    // ...emit dream_mode_end...
    Ok(session)
}
```

**Imports / wiring required:**
- Existing `use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};` (line 7) covers DREAMING checkpoint
- `crate::skills::lifecycle` (NEW Wave 2) for the actual logic
- `crate::skills::pending` (NEW Wave 2) for queue writes
- `crate::voyager_log::{dream_prune, dream_consolidate, dream_generate}` (NEW Wave 1)

**Gotchas:**
- **Pitfall 5 (RESEARCH.md:278–291):** prune MUST run BEFORE consolidate in the task chain — order is `prune → consolidate → from_trace`. Consolidate must select from post-prune `forged_tools` state, not pre-prune (else merge can reference archived rows).
- **DREAMING is module-private** (`static DREAMING: AtomicBool` at line 13) — `lifecycle.rs` cannot directly reference `dream_mode::DREAMING`. Either expose `pub fn is_dreaming()` (already exists at line 27) or add a helper closure parameter to lifecycle's loop functions. The latter keeps lifecycle.rs pure.
- **CLAUDE.md "Background task" pattern:** the existing monitor loop at line 463–505 already follows the canonical `tauri::async_runtime::spawn(async move { loop { … sleep … } })` shape — Phase 24 inherits, doesn't add another loop.
- **`run_task!` 120-second per-task timeout** wraps each task in `tokio::time::timeout`. For the skill passes this is generous (RESEARCH.md:801 expects sub-1s for n≤100 tools); the timeout is the fallback ceiling.

---

### MODIFY: `src-tauri/src/voyager_log.rs` (3 new dream_* helpers)

**Analog:** itself — the file already has 4 emit helpers using a fixed shape; Phase 24 adds 3 sibling functions.

**Existing `skill_used` (lines 106–116) — clone for `dream_prune`:**
```rust
/// Convenience: skill_used (forged tool invoked from chat).
pub fn skill_used(skill_name: &str) {
    let summary = format!("skill_used: {}", crate::safe_slice(skill_name, 80));
    emit(
        "skill_used",
        &summary,
        json!({
            "skill_name": skill_name,
        }),
    );
}
```

**Existing core `emit` helper (lines 39–64) — REUSED unchanged:**
```rust
pub fn emit(action: &'static str, human_summary: &str, payload: serde_json::Value) {
    let app = match crate::integration_bridge::get_app_handle() {
        Some(h) => h,
        None => {
            log::warn!(
                "[voyager_log] no app handle for {action}: {}",
                crate::safe_slice(human_summary, 100)
            );
            return;
        }
    };
    if let Err(e) = app.emit_to(
        "main",
        "blade_activity_log",
        json!({
            "module":        MODULE,
            "action":        action,
            "human_summary": crate::safe_slice(human_summary, 200),
            "payload_id":    serde_json::Value::Null,
            "payload":       payload,
            "timestamp":     chrono::Utc::now().timestamp(),
        }),
    ) {
        log::warn!("[voyager_log] emit_to main failed for {action}: {e}");
    }
}
```

**Existing test pattern (lines 118–146) — REUSED for the 4 new tests; no AppHandle needed:**
```rust
#[test]
fn emit_helpers_safe_without_app_handle() {
    // Must not panic in any test context.
    gap_detected("youtube_transcript", "summarize this video: <url>");
    skill_written("youtube-transcript-fetch", "/tmp/yt.py");
    skill_registered("youtube-transcript-fetch", "test-id", Some("/tmp/skills/yt/SKILL.md"));
    skill_used("youtube-transcript-fetch");
}
```

**Imports / wiring required:** none new — `serde_json::json` and `tauri::Emitter` are already imported (lines 23–24). The new `cap_items` helper from RESEARCH.md:844–849 is pure-Rust slice operations, no deps.

**Gotchas:**
- **`MODULE = "Voyager"` constant** (line 28) — D-24-F locks Phase 24 to keep `MODULE = "Voyager"` and use action prefix `dream_mode:` (e.g. `"dream_mode:prune"`) to disambiguate. Do NOT add `MODULE_DREAM` or rename — frontend filters by action prefix.
- **`action: &'static str`** — the literal string passed must be a `&'static str`. Use `"dream_mode:prune"` directly, not `format!("dream_mode:{kind}")`.
- **Silent on missing AppHandle** — the test convention `emit_helpers_safe_without_app_handle` (line 131) requires the new helpers to also return cleanly with a warn log when `integration_bridge::get_app_handle()` returns None; the `emit` core already handles this, so direct calls inherit the behavior.

---

### MODIFY: `src-tauri/src/session_handoff.rs` (skills_snapshot field + per-session archive)

**Analog:** itself — the existing `SessionHandoff` struct + `write_session_handoff` is the integration site.

**Existing struct (lines 21–26):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandoff {
    pub summary: String,
    pub last_commands: Vec<String>,
    pub pending_items: Vec<String>,
    pub generated_at: i64,
}
```

**Phase 24 extension (per RESEARCH.md:749–769) — add new field + new sibling type `SkillRef`:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRef {
    pub name: String,
    pub source: String,           // "forged" | "bundled" | "user" | "archived"
    pub last_used: Option<i64>,
    pub forged_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandoff {
    pub summary: String,
    pub last_commands: Vec<String>,
    pub pending_items: Vec<String>,
    pub generated_at: i64,
    #[serde(default)]            // NEW — back-compat with old handoff JSONs
    pub skills_snapshot: Vec<SkillRef>,
}
```

**Existing write site (lines 106–115) — extend to also write `sessions/<generated_at>.json` (cap 30):**
```rust
let handoff = SessionHandoff {
    summary,
    last_commands: cmd_summaries.drain(..cmd_summaries.len().min(10)).collect(),
    pending_items: pending,
    generated_at: chrono::Utc::now().timestamp(),
};

if let Ok(json) = serde_json::to_string_pretty(&handoff) {
    let _ = std::fs::write(handoff_path(), json);
}
```

**Pattern for the per-session archive directory** — use `crate::config::blade_config_dir().join("sessions")` (creates if missing per the create_dir_all idiom in `tool_forge.rs:tools_dir` lines 119–123):
```rust
fn sessions_dir() -> PathBuf {
    let dir = crate::config::blade_config_dir().join("sessions");
    std::fs::create_dir_all(&dir).ok();
    dir
}
```

**Imports / wiring required:**
- New: `crate::skills::loader::list_skills_snapshot()` (NEW Wave 1 — lives in `skills/loader.rs`) returning `Vec<SkillRef>`
- Existing: `serde::{Serialize, Deserialize}`, `std::path::PathBuf`, `chrono` (all already imported lines 16–18)
- For 30-cap: directory enumeration + sort-by-mtime + `std::fs::remove_file` on overflow — same pattern shape as `skills/loader.rs:scan_tier` (lines 24–47 directory walk)

**Gotchas:**
- **`#[serde(default)]` is load-bearing** — old `session_handoff.json` files written before Phase 24 lack `skills_snapshot`; deserialization MUST tolerate the missing field. Test name from RESEARCH.md:966: `skills_snapshot_default_for_old_json`.
- **Cap-30 sweep** must ignore the singular `session_handoff.json` (latest-only — preserved per RESEARCH.md:776–779) and only purge entries under `sessions/`.
- **Discretion item 5 (CONTEXT.md:266–268)** — Phase 24 needs this field; if researcher had locked otherwise, this plan would defer. RESEARCH.md:997 confirms LOCKED.

---

### MODIFY: `src-tauri/src/skills/loader.rs` (new `list_skills_snapshot` helper)

**Analog:** itself — `scan_tier` (lines 21–98) is the exact directory-walk pattern; `user_root` / `bundled_root` (lines 100–122) are the root resolvers; `workspace_root` (line 101) handles cwd-relative.

**Existing scan_tier shape (lines 21–98 — clone the iteration body):**
```rust
pub fn scan_tier(root: &Path, source: SourceTier) -> Vec<SkillStub> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(rd) => rd,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        // Skip dotfiles (`.archived/`, `.git/`, etc.)
        if dir.file_name().and_then(|n| n.to_str())
              .map(|n| n.starts_with('.')).unwrap_or(false) {
            continue;
        }
        let skill_md = dir.join("SKILL.md");
        if !skill_md.is_file() { continue; }
        // … parse, push SkillStub …
    }
    out
}
```

**Imports / wiring required:**
- For `list_skills_snapshot()`: read forged_tools via `crate::tool_forge::get_forged_tools` (tool_forge.rs:580) to build the `[forged]` rows; walk `user_root()` via `scan_tier` for `[user]`; walk `bundled_root()` for `[bundled]`; walk `<user_root>/.archived/` for `[archived]` (special-case — must explicitly enter the dotfile dir, since scan_tier skips them by default — see RESEARCH.md:709 "excluding dotfile dirs i.e. `.archived` and `.pending`")
- `crate::session_handoff::SkillRef` for the return type — circular dependency risk; alternative is to define `SkillRef` in `skills/loader.rs` and re-export from `session_handoff.rs`

**Gotchas:**
- **Dotfile-skip is a feature** for scan_tier but a bug for archive enumeration — `list_skills_snapshot` must explicitly walk `<user_root>/.archived/<name>/` separately (don't reuse scan_tier for this tier).
- **Circular module import** — if `SkillRef` lives in `session_handoff.rs` and `loader.rs` imports it, but `session_handoff.rs` calls `loader::list_skills_snapshot()`, that's a normal one-way import (loader → session_handoff via SkillRef). Recommend `SkillRef` lives in `skills/loader.rs` and `session_handoff.rs` re-exports `pub use crate::skills::loader::SkillRef;`.

---

### MODIFY: `src-tauri/src/skills/export.rs` (touched ONLY if archive helper lands here)

**Analog:** itself — `export_to_user_tier` (lines 70–134) is the existing skill-write pattern.

**Status:** RESEARCH.md does NOT explicitly require modifying `export.rs`. The archive operation (D-24-A — `~/.blade/skills/<name>/` → `~/.blade/skills/.archived/<name>/`) lives in `lifecycle.rs::archive_skill` per RESEARCH.md:1037 ("`archive_skill(name) -> Result<...>`"). Pattern from RESEARCH.md §"Per-Row Action" lines 385–412 uses `std::fs::rename` directly, not via export.rs.

**If a helper does land here**, the pattern to clone is `export_to_user_tier`'s sanitize → create_dir_all → fs::write/copy → return Outcome enum — fully extractable.

**Imports / wiring required:** none if export.rs untouched. If extended: `std::fs::rename` (cross-device fallback acknowledged in RESEARCH.md:401–402).

**Gotchas:**
- **Pitfall 8 (RESEARCH.md:321–338):** export.rs already wrote `~/.blade/skills/<name>/SKILL.md` at forge time. The archive moves the dir; `scan_tier` skips dotfiles so `.archived/<name>/` disappears from active catalog correctly. DO NOT touch `~/.blade/tools/<name>.<ext>` script file (separate location, intentionally preserved).
- **`sanitize_name`** (line 39) MUST be reused by `lifecycle.rs::archive_skill` to compute the on-disk dir name — `forged_tools.name` is `snake_case`, dir is `kebab-case`.

---

### MODIFY: `src-tauri/src/proactive_engine.rs` (drain `.pending/` proposals)

**Analog:** itself — `run_detector!` macro (lines 577–617) is the canonical decision_gate routing site.

**Existing detector → decision_gate → emit pattern (lines 577–617):**
```rust
macro_rules! run_detector {
    ($rule_type:expr, $detector_expr:expr) => {{
        if let Some(rule) = get_rule(&conn, $rule_type) {
            if rule.enabled && cooldown_elapsed(&rule) {
                if let Some(action) = $detector_expr.await {
                    if action.confidence >= rule.threshold {
                        let signal = crate::decision_gate::Signal {
                            source: format!("proactive_{}", $rule_type),
                            description: action.content.clone(),
                            confidence: action.confidence,
                            reversible: true,
                            time_sensitive: action.action_type == "StuckDetection"
                                || action.action_type == "DeadlineWarning",
                        };
                        let (_, outcome) = crate::decision_gate::evaluate_and_record(
                            signal, &perception,
                        ).await;
                        let should_emit = matches!(
                            &outcome,
                            crate::decision_gate::DecisionOutcome::ActAutonomously { .. }
                            | crate::decision_gate::DecisionOutcome::AskUser { .. }
                        );
                        if should_emit {
                            if save_action(&conn, &action).is_ok() {
                                let _ = app.emit_to("main", "proactive_action", &action);
                                mark_rule_fired(&conn, $rule_type);
                                fired += 1;
                            }
                        }
                    }
                }
            }
        }
    }};
}
```

**Phase 24 — `drain_pending_proposals` shape (per RESEARCH.md:1050):**
```rust
async fn drain_pending_proposals(app: &tauri::AppHandle) {
    // Cooldown gate — only when LAST_ACTIVITY ≥30s old
    let last = crate::dream_mode::LAST_ACTIVITY.load(Ordering::Relaxed);
    let now = chrono::Utc::now().timestamp();
    if now - last < 30 { return; }

    for proposal in crate::skills::pending::read_proposals() {
        if proposal.dismissed { continue; }
        let signal = crate::decision_gate::Signal {
            source: "dream_mode_proposal".to_string(),
            description: format!("BLADE: …Reply 'yes {id}' or 'dismiss {id}'", id = proposal.id),
            confidence: 0.9, // pre-filtered by dream-mode pass
            reversible: true,
            time_sensitive: false,
        };
        let (_, outcome) = crate::decision_gate::evaluate_and_record(signal, &perception).await;
        // … same emit as existing detectors
    }
}
```

**Decision gate types (decision_gate.rs:31–58 — REUSED):**
```rust
pub enum DecisionOutcome {
    ActAutonomously { action: String, reasoning: String },
    AskUser { question: String, suggested_action: String },
    QueueForLater { task: String, priority: Priority },
    Ignore { reason: String },
}

pub struct Signal {
    pub source: String,
    pub description: String,
    pub confidence: f64,
    pub reversible: bool,
    pub time_sensitive: bool,
}
```

**Imports / wiring required:**
- `crate::skills::pending::read_proposals` (NEW Wave 2)
- `crate::dream_mode::LAST_ACTIVITY` (currently `static LAST_ACTIVITY: AtomicI64` in `dream_mode.rs:14` — module-private; needs `pub(crate) static` exposure OR a `pub fn last_activity_ts() -> i64` accessor added in dream_mode.rs)
- `std::sync::atomic::Ordering` already imported
- `crate::decision_gate::{Signal, DecisionOutcome, evaluate_and_record}` — already in decision_gate.rs surface

**Gotchas:**
- **Pitfall 6 (RESEARCH.md:293–304):** the 30-second `LAST_ACTIVITY` gate is the load-bearing piece — without it, the chat-injected prompt steals focus mid-typing. Use `dream_mode::record_user_activity` clock (line 17–25), don't add a new clock.
- **Pitfall 7 (RESEARCH.md:306–319):** the prompt MUST embed `proposal_id` literally in the description so intent_router can disambiguate ("Reply 'yes 7af3' or 'dismiss 7af3'"). Cap at 1 merge + 1 generate per cycle (D-24-B) keeps surface ≤2 active proposals.
- **`source: "dream_mode_proposal"`** — distinct from `source: "proactive_<rule_type>"` so decision_gate's per-source threshold tracking doesn't conflate Phase 24 proposals with detector signals.

---

### MODIFY: `src-tauri/src/intent_router.rs` (new `ProposalReply` variant)

**Analog:** itself — `IntentClass` enum (lines 17–22) + `classify_intent_class` (lines 58–75) Tier 1 heuristic.

**Existing enum (lines 17–22):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
}
```

**Existing classifier (lines 58–75):**
```rust
async fn classify_intent_class(message: &str) -> IntentClass {
    let lower = message.to_lowercase();
    if let Some((verb, service)) = match_heuristic(&lower) {
        return IntentClass::ActionRequired {
            service: service.to_string(),
            action: verb.to_string(),
        };
    }
    classify_intent_llm(message)
        .await
        .unwrap_or(IntentClass::ChatOnly)
}
```

**Phase 24 extension (per RESEARCH.md:1051):** add a new variant + a regex-check before the existing `match_heuristic`:
```rust
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
    ProposalReply { verb: String, id: String },  // NEW Phase 24
}

// Inside classify_intent_class, BEFORE match_heuristic:
// regex `\b(yes|no|dismiss)\s+([a-f0-9]{4,})\b`
if let Some((verb, id)) = match_proposal_reply(&lower) {
    return IntentClass::ProposalReply { verb, id };
}
```

**Imports / wiring required:**
- For regex: project does NOT add `regex` lightly — verify whether it's already in Cargo.toml. Alternative: hand-rolled pattern match using `str::split_whitespace` + char filter. RESEARCH.md:1051 doesn't insist on regex crate.
- `serde::{Serialize, Deserialize}` already imported (line 15)

**Gotchas:**
- **`#[serde(tag = "kind", rename_all = "snake_case")]`** — the existing serde attribute means new variants serialize as `{"kind": "proposal_reply", …}`. Frontend types must update if they consume IntentClass.
- **Tier 1 ordering** — `ProposalReply` must run BEFORE `ActionRequired` because "yes 7af3" could otherwise miss-match nothing in Tier 1 and fall through to ChatOnly (acceptable). The order is for correctness when "dismiss" overlaps with action verbs in some future grammar.
- **`ProposalReply.id` length:** 4+ hex chars per RESEARCH.md:1051, matching the `[..8]` slice in `pending.rs::write_proposal`. Anything shorter is rejected by the regex.

---

### MODIFY: `src-tauri/src/commands.rs` (dispatch hook + ProposalReply apply path)

**Analog:** itself — line 715 (turn_acc creation), line 1831 (reward hook), lines 2167–2179 (turn_acc.record_tool_call site) are the reward-side wiring sites; same loop body is the canonical Phase 24 wiring point per RESEARCH.md:1026.

**Existing turn_acc creation (line 715):**
```rust
let turn_acc = crate::reward::TurnAccumulator::new();
```

**Existing per-tool-call accumulation (lines 2167–2179):**
```rust
// Phase 23 / REWARD-04 — record this tool call into the turn accumulator
turn_acc.record_tool_call(crate::reward::ToolCallTrace {
    tool_name:      tool_call.name.clone(),
    args_str:       serde_json::to_string(&tool_call.arguments).unwrap_or_default(),
    result_content: crate::safe_slice(&content, 500).to_string(),
    is_error,
    timestamp_ms:   chrono::Utc::now().timestamp_millis(),
});
```

**Existing reward persistence hook (line 1831):**
```rust
let _ = crate::reward::compute_and_persist_turn_reward(&app, turn_acc).await;
```

**Phase 24 wiring (per RESEARCH.md:1026 + Pitfall 2):** add a sibling call in the dispatch loop body that funnels into `tool_forge::record_tool_use` IFF `tool_call.name` is in `forged_tools`. Recommended placement: alongside or shortly after line 2179 (post-`record_tool_call`), and `turn_traces` row write at the same hook as `compute_and_persist_turn_reward` (line 1831):
```rust
// Phase 24 — Voyager record_tool_use wiring (RESEARCH.md Pitfall 2)
if forged_tool_names.contains(&tool_call.name) {
    crate::tool_forge::record_tool_use(&tool_call.name, &turn_acc.snapshot_calls()
        .iter().map(|t| t.tool_name.clone()).collect::<Vec<_>>());
}
```

**ProposalReply apply path (per RESEARCH.md:1052) — fits the existing `classify_intent` consumer at line 889:**
Existing site (line 886–905):
```rust
let dispatch_app = app.clone();
let dispatch_msg = last_user_text.clone();
{
    let (intent, args) = crate::intent_router::classify_intent(&dispatch_msg).await;
    if let Err(e) = crate::jarvis_dispatch::jarvis_dispatch_action(
        dispatch_app, // …
    ).await {
        eprintln!("[jarvis_dispatch] background dispatch error: {}", e);
    }
}
```

**Imports / wiring required:**
- `crate::tool_forge::{record_tool_use, get_forged_tools}` (or a cheaper `forged_tool_names_set`)
- New `turn_traces` table CREATE — handled in `db.rs` (see below)
- `crate::skills::pending::{read_proposal, mark_dismissed}` for ProposalReply apply
- `crate::skills::export::export_to_user_tier` for `yes`/generate path (export.rs:70)
- `crate::tool_forge::persist_forged_tool` for `yes`/merge path (already public — line 530+ test seam)

**Gotchas:**
- **Pitfall 2 (RESEARCH.md:227–245):** `record_tool_use` is the canonical write site per CONTEXT.md "Specific Ideas" — DON'T add a second write site. The dispatch-loop hook is THE one funnel.
- **Pitfall 3 (RESEARCH.md:247–259):** `record_tool_use` will become a transactional write (INSERT + auto-prune DELETE). The chat hot path tolerates the small txn cost; SQLite WAL means no blocking.
- **`turn_acc.snapshot_calls()`** returns `Vec<ToolCallTrace>` (reward.rs:268–270) — extract `.tool_name` for the trace_hash input. The trace must include the forged-tool-name itself per RESEARCH.md:466–469 (position-correct comma-join).
- **CLAUDE.md "Don't hardcode model names for OpenRouter"** — N/A here (we're not picking a model), but the operator-types-yes pattern means commands.rs DOES need to swallow the reply text before it reaches the LLM provider call — see RESEARCH.md:1052.

---

### MODIFY: `src-tauri/src/db.rs` (new `turn_traces` table)

**Analog:** itself — `run_migrations` (lines 167–250+) is the canonical CREATE TABLE site.

**Existing migration shape (lines 167–250):**
```rust
fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Conversations
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0
        );

        -- Messages
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            image_base64 TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
        // … more tables …
```

**Phase 24 addition — append at the end of the existing `execute_batch` block (per RESEARCH.md:608–616):**
```sql
-- Phase 24 (v1.3) — turn_traces for skill-from-trace generation (DREAM-03)
CREATE TABLE IF NOT EXISTS turn_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_ts INTEGER NOT NULL,
    tool_names TEXT NOT NULL,             -- JSON array of strings, in order
    forged_tool_used TEXT,                -- name of the forged tool invoked, if any (NULL = none)
    success INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tt_ts ON turn_traces(turn_ts DESC);
```

**Imports / wiring required:** none — extending an existing `execute_batch` literal SQL string.

**Gotchas:**
- **CLAUDE.md "SQL in `execute_batch!` — NO double quotes inside SQL strings":** preserve single-quote convention (`DEFAULT 1`, not `DEFAULT "1"`). Verified existing tables (lines 172–250) all use single quotes.
- **Migration is auto-applied** at first DB open via `run_migrations(&conn)` at line 162 — no separate one-shot needed.

---

### MODIFY: `src-tauri/src/bin/skill_validator.rs` (subcommand dispatcher)

**Analog:** itself — the existing `main()` (lines 21–105) is a hand-rolled flag parser; Phase 24 extends it to dispatch on `args[1]` first (subcommand) before flag parsing.

**Existing main pattern (lines 21–56) — REUSED + extended per RESEARCH.md:680–694:**
```rust
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: skill_validator [--json] [--recursive] <path>");
        return ExitCode::from(2);
    }

    let mut json = false;
    let mut recursive = false;
    let mut path: Option<&str> = None;

    for arg in &args[1..] {
        match arg.as_str() {
            "--json" => json = true,
            "--recursive" => recursive = true,
            "-h" | "--help" => { /* print + return SUCCESS */ }
            other if other.starts_with("--") => {
                eprintln!("unknown flag: {other}");
                return ExitCode::from(2);
            }
            other => { path = Some(other); }
        }
    }
    // … dispatch validate logic …
}
```

**Phase 24 dispatcher shape (per RESEARCH.md:680–694) — clap NOT used (Cargo.toml line 32-64 has no `clap` dep; preserve hand-rolled style):**
```rust
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let (subcmd, rest): (&str, &[String]) = match args.get(1).map(|s| s.as_str()) {
        Some("validate") => ("validate", &args[2..]),
        Some("list") => ("list", &args[2..]),
        Some(p) if !p.starts_with("--") => ("validate", &args[1..]),  // alias
        _ => return usage_error(),
    };
    match subcmd {
        "validate" => run_validate(rest),
        "list" => run_list(rest),
        _ => unreachable!(),
    }
}
```

**Existing emit pattern (lines 107–202) — REUSED for `list`'s text + JSON outputs:** the `emit_human` and `emit_json` functions plus `json_string` helper at line 188 demonstrate the hand-rolled JSON convention; clone for the list/diff outputs.

**Refactoring for testability (per RESEARCH.md:986):** factor handlers into `pub fn run_validate(rest: &[String]) -> ExitCode` + `pub fn run_list(rest: &[String]) -> ExitCode` so unit tests can call them directly without spawning subprocesses. Tests live in `#[cfg(test)] mod tests` at the bottom of `bin/skill_validator.rs`.

**Imports / wiring required:**
- `blade_lib::tool_forge::get_forged_tools` for the `[forged]` rows
- `blade_lib::skills::loader::{user_root, bundled_root, scan_tier}` for the 3 SKILL.md tiers
- `blade_lib::session_handoff::SessionHandoff` for `--diff` snapshot read
- `blade_lib::skills::loader::list_skills_snapshot` (NEW Wave 1) for the current snapshot
- `std::path::Path`, `std::process::ExitCode` already imported

**Gotchas:**
- **Positional alias** (line 686): `Some(p) if !p.starts_with("--") => ("validate", &args[1..])` — preserves the Phase 21 invocation `skill_validator <path>` so existing shell scripts and the `verify:skill-format` chain (Plan 21-07) keep working.
- **`blade_lib` is the lib name** (cargo workspace) — the existing binary uses `use blade_lib::skills::validator::...` at line 19. Phase 24 imports follow the same `blade_lib::*` prefix for new modules.
- **CLAUDE.md "Cargo binary subcommand pattern":** verified the project does NOT use `clap` (Cargo.toml grep returned no clap entries). Preserve the hand-rolled `args.get(1)` pattern.
- **Test isolation:** the binary tests use `BLADE_CONFIG_DIR` override (config.rs:659) — same pattern as `reward.rs` lib tests. RESEARCH.md:949 mandates `--test-threads=1`.

---

### NEW (optional Wave 3): `tests/dream_mode_e2e_test.rs`

**Analog:** `src-tauri/src/reward.rs` lines 945–971 — the `record_appends_jsonl` test pattern with `tempfile::NamedTempFile` + `BLADE_*` env override is the closest "drive a hermetic SQLite + filesystem path through real code" pattern.

**Test isolation excerpt (`reward.rs:945–971`):**
```rust
#[test]
fn record_appends_jsonl() {
    let tmp = tempfile::NamedTempFile::new().expect("create tempfile");
    let path = tmp.path().to_path_buf();
    std::env::set_var("BLADE_REWARD_HISTORY_PATH", &path);
    std::fs::write(&path, "").expect("truncate tempfile");

    let rec = sample_record(0.42);
    record_reward(&rec);

    let read_back = read_reward_history(usize::MAX);
    assert_eq!(read_back.len(), 1);
    assert!((read_back[0].reward - 0.42).abs() < 1e-6);
    std::env::remove_var("BLADE_REWARD_HISTORY_PATH");
}
```

**Imports / wiring required:**
- `tempfile::TempDir` (Cargo.toml line 64) for `BLADE_CONFIG_DIR` override
- `tokio::time::Instant` for the abort-latency bracket per RESEARCH.md:811–812
- `blade_lib::dream_mode::dream_trigger_now` (already a `#[tauri::command]` at line 516) — but the integration test calls the underlying logic via a non-Tauri-context entrypoint; since `dream_trigger_now` is `pub async fn`, direct `.await` works as long as we hand it a fake `tauri::AppHandle` or use the Phase 22 fixture pattern

**Gotchas:**
- **Phase 22-05 test seam** — `tool_forge::forge_tool_from_fixture` (line 537–543, gated `#[cfg(any(test, feature = "voyager-fixture"))]`) is the canonical way to seed `forged_tools` rows in tests. Use this, not the LLM-driven `forge_tool` path.
- **--test-threads=1** required (RESEARCH.md:949) — `BLADE_CONFIG_DIR` is process-global.

---

## Cross-Cutting / Shared Patterns

### `record_tool_use` invariant (Phase 22 lock + Phase 24 extension)

**Source:** `src-tauri/src/tool_forge.rs:687–708` + Phase 22 voyager-loop close commit `9e800fc`.

**Apply to:** the chat dispatch hook in `commands.rs:2167–2179` AND every internal forged-tool invocation site (currently zero — Pitfall 2). After Phase 24, `record_tool_use(name, &turn_tool_names)` is THE write site for `forged_tools.last_used`.

**Invariant from CONTEXT.md "Specific Ideas":**
> `record_tool_use` is the canonical write site for `last_used` updates on forged_tools. Don't add a second write site; if a non-Voyager invocation path exists (CLI invocation via `skill_validator run`?), it MUST funnel through `record_tool_use`.

**Phase 24 extension shape (RESEARCH.md:885–917):**
```rust
pub fn record_tool_use(name: &str, turn_tool_names: &[String]) {
    let conn = match open_db() { Ok(c) => c, Err(_) => return };
    ensure_table(&conn).ok();
    ensure_invocations_table(&conn).ok();          // NEW Phase 24

    let now = chrono::Utc::now().timestamp();
    let tx = conn.transaction().expect("blade.db txn open");

    tx.execute(
        "UPDATE forged_tools SET use_count = use_count + 1, last_used = ?1 WHERE name = ?2",
        params![now, name],
    ).ok();

    let trace_hash = compute_trace_hash(turn_tool_names);
    tx.execute(
        "INSERT INTO forged_tools_invocations (tool_name, ts, trace_hash) VALUES (?1, ?2, ?3)",
        params![name, now, trace_hash],
    ).ok();
    // auto-prune to last 100 …
    tx.commit().ok();

    crate::voyager_log::skill_used(name);          // PRESERVED — voyager loop step 4
}
```

The `voyager_log::skill_used(name)` call MUST remain at the end — it's the load-bearing M-07 emit Phase 22 closed on, and `verify-voyager-loop` (commit `c935cd3`) checks for it.

---

### M-07 ActivityStrip emit contract — Phase 24 adds 3 sibling kinds

**Source:** `src-tauri/src/voyager_log.rs:1–22` doc-comment + `MODULE = "Voyager"` const at line 28.

**Apply to:** all 3 new `task_skill_*` functions in `dream_mode.rs`. Each emits ONE event at task end with `count` + `items` (capped at 10).

**Existing 4-emit contract (voyager_log.rs:6–22):**
> 4 actions per closed loop iteration: `gap_detected`, `skill_written`, `skill_registered`, `skill_used`.

**Phase 24 adds 3 sibling kinds with `dream_mode:` action prefix (RESEARCH.md:814–863):**
- `dream_mode:prune` { count, items }
- `dream_mode:consolidate` { count, items }
- `dream_mode:generate` { count, items }

**MODULE constant stays `"Voyager"`** — D-24-F locks: dream-mode is "the forgetting half of Voyager," not a separate module. Frontend filters by action prefix, not module.

---

### `BLADE_CONFIG_DIR` test-isolation pattern

**Source:** `src-tauri/src/config.rs:654–668`. Established by reward.rs Phase 23 tests (lines 945–971) and skills/loader.rs Phase 21 tests (lines 207–215).

**Apply to:** all Phase 24 tests that touch `forged_tools` SQLite, `~/.blade/skills/`, `~/.blade/sessions/`, or `~/.blade/skills/.pending/`.

**Pattern shape:**
```rust
let tmp = tempfile::TempDir::new().expect("tempdir");
std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
// … run code under test …
std::env::remove_var("BLADE_CONFIG_DIR");
```

**Threading constraint:** `--test-threads=1` is mandatory (RESEARCH.md:949) because `BLADE_CONFIG_DIR` is a process-global env var. All Phase 24 test invocations must include this flag.

---

### `DREAMING.load(Ordering::Relaxed)` checkpoint pattern

**Source:** `src-tauri/src/dream_mode.rs:13` (static decl) + `:393–420` (run_task! macro inserts the check between tasks).

**Apply to:** all per-step loops inside `task_skill_prune` / `task_skill_consolidate` / `task_skill_from_trace`. The check sites are between work units >100ms (RESEARCH.md:794–803):

| Pass | Checkpoint |
|------|------------|
| Prune | After each per-row archive (fs::rename + DB DELETE — ~10–50ms) |
| Consolidate | (a) after `embed_texts` batch (50–500ms); (b) every 20 inner-loop pairs |
| Generate | After each `turn_traces` row evaluated |

**Pattern shape (clone from `dream_mode.rs:409`):**
```rust
if !DREAMING.load(Ordering::Relaxed) { break; }
```

**`DREAMING` exposure:** currently module-private. To use it from `lifecycle.rs`, either expose `pub(crate) static DREAMING` OR add `pub fn is_dreaming() -> bool` accessor (already exists at `dream_mode.rs:27` — REUSE this).

---

## SQLite schema additions (forged_tools_invocations + turn_traces)

**Source pattern:** `src-tauri/src/tool_forge.rs:132–150` `ensure_table` for forged_tools_invocations (per-module schema); `src-tauri/src/db.rs:167–250` `run_migrations` for turn_traces (global blade.db schema).

**Two distinct strategies in the repo:**
1. **`tool_forge.rs::ensure_table`** — module-scoped CREATE called on every module-internal `open_db()`. Used for `forged_tools` and (Phase 24) `forged_tools_invocations`. Idempotent via `IF NOT EXISTS`.
2. **`db.rs::run_migrations`** — global CREATE batch run once at first `init_db()` call. Used for cross-module tables.

**Phase 24 places:**
- `forged_tools_invocations` → tool_forge.rs (sibling of forged_tools, owned by tool_forge module) — RESEARCH.md:867–881
- `turn_traces` → db.rs run_migrations (sibling of `messages`, written from commands.rs hot path) — RESEARCH.md:608–616

**`forged_tools_invocations` schema (RESEARCH.md:867–881):**
```sql
CREATE TABLE IF NOT EXISTS forged_tools_invocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    trace_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fti_tool_id ON forged_tools_invocations(tool_name, id DESC);
```

**Idempotent migration for `last_used` backfill (D-24-A — runs in `ensure_table` post-CREATE):**
```sql
UPDATE forged_tools SET last_used = created_at WHERE last_used IS NULL;
```

---

## Cargo binary subcommand pattern (skill_validator extension)

**Verified:** project does NOT use `clap`. Cargo.toml lines 32–64 contain no `clap` entry. The existing `bin/skill_validator.rs:21–105` uses hand-rolled `args[1..]` iteration with `match arg.as_str()`. Phase 24 extends this style — does NOT introduce clap.

**Pattern source (`bin/skill_validator.rs:21–56` — already cited above):**
```rust
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 { /* usage error */ }
    let mut json = false;
    let mut recursive = false;
    let mut path: Option<&str> = None;
    for arg in &args[1..] {
        match arg.as_str() { /* … */ }
    }
    // dispatch …
}
```

**Phase 24 extends with subcommand dispatcher BEFORE flag parsing** (RESEARCH.md:680–694). Backward-compat: positional `<path>` invocation aliases to `validate`.

---

## Files NOT touched in Phase 24 (per CONTEXT.md:400–411)

- `commands.rs` core stream logic — only the dispatch hook + reward hook sites get extended; the streaming code is untouched.
- `doctor.rs` — Phase 23 just landed RewardTrend; Phase 24 doesn't add a Doctor signal.
- `config.rs` — no new BladeConfig field. Thresholds (91d, 0.85, ≥3 tool calls) hardcoded per ROADMAP. **CLAUDE.md 6-place rule does NOT trigger.**
- All UI surfaces — chat-first pivot anchor.
- `brain_skills` table (Phase 21 substrate) — Pitfall 8 boundary: Phase 24 archive touches ONLY `forged_tools` + `~/.blade/skills/<name>/`.

---

## Metadata

**Analog search scope:** `src-tauri/src/` (skills/, dream_mode.rs, tool_forge.rs, voyager_log.rs, session_handoff.rs, intent_router.rs, decision_gate.rs, proactive_engine.rs, reward.rs, config.rs, embeddings.rs, db.rs, commands.rs, bin/skill_validator.rs)
**Files scanned:** 14 source files + 2 .planning files (CONTEXT.md, RESEARCH.md) + Cargo.toml
**Pattern extraction date:** 2026-05-01
**Drift detected:** none. RESEARCH.md cited line numbers (e.g. tool_forge.rs:464–480 INSERT site, tool_forge.rs:694–708 record_tool_use, dream_mode.rs:472 interrupt path, voyager_log.rs:106 skill_used) all verified against current HEAD (commit `a270874`). Discrepancy on RESEARCH.md:1024 — `last_used: Some(now)` is at line **500** in the struct literal (`last_used: None`) but the SQL `NULL` is at line **467** column 10 of the VALUES tuple; both sites confirmed.
