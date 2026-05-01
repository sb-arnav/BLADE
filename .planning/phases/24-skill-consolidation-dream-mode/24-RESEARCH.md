# Phase 24: Skill Consolidation in dream_mode — Research

**Researched:** 2026-05-01
**Domain:** dream_mode background substrate (Rust/Tauri) + forged_tools SQLite + skill lifecycle
**Confidence:** HIGH (all substrate read first-hand from source; no external library
research required — pure repo-internal substrate work)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-24-A** `last_used` clock anchored at write — `register_forged_tool` /
  `persist_forged_tool` sets `Some(created_at)` instead of `None` at
  `tool_forge.rs:500-501`. Migration: idempotent
  `UPDATE forged_tools SET last_used = created_at WHERE last_used IS NULL`
  inside `ensure_table` after `CREATE TABLE IF NOT EXISTS`.
- **D-24-B** Chat-injected proactive prompts via `proactive_engine.rs`
  `decision_gate` route. `~/.blade/skills/.pending/<id>.json` queue. Schema
  `{ id, kind: "merge"|"generate", proposed_name, payload, created_at,
  dismissed: bool }`. Cap **1 merge + 1 generate** per dream cycle.
- **D-24-C** Extend `src-tauri/src/bin/skill_validator.rs` with subcommands:
  `validate <path>` (positional invocation `<path>` aliased), `list`,
  `list --diff <session_id>`, `--json` flag. Read sessions from
  `~/.blade/sessions/<session_id>.json`.
- **D-24-D** Skill passes ride existing 1200s threshold; per-step
  `DREAMING.load(Ordering::Relaxed)` checkpoints for ≤1s abort.
- **D-24-E** Deterministic merge body — lexicographic name pick + `_merged`
  suffix; description concatenation with ` | `; usage union deduped by
  line; parameters union deduped by name; smaller `script_path` kept (other
  archived); `test_output` union with `\n--- merged ---\n` separator.
  Operator override at the chat-injected prompt is the LLM-y step.
- **D-24-F** ActivityStrip emit — one event per pass-kind per cycle:
  `dream_mode:prune`, `dream_mode:consolidate`, `dream_mode:generate`. Each
  carries `count: i64` + `items: Vec<String>` (capped at 10 with
  `... (+N more)` suffix).
- **D-24-G** SCOPE — forged_tools only. SKILL.md skills (bundled +
  user-authored) NOT subject to prune/consolidate/generate. CLI
  `list --diff` lists both for visibility but only flags forged_tools.

### Claude's Discretion (8 items resolved in §"Open Questions Closed")

forged_tools migration mechanism · trace_hash schema · merge name
de-duplication · `.pending/` housekeeping · CLI session-id source ·
embedding source · chat-prompt routing · DREAMING checkpoint placement.

### Deferred Ideas (OUT OF SCOPE)

SKILL.md skill prune/consolidate · LLM-driven merge body · Per-skill
metadata for non-forged skills · Auto-merge without operator confirm ·
5-min idle threshold for skill-only passes · Skill manifest UI surface ·
Cryptographic skill manifest hashing · Skill provenance graph view ·
Per-skill quota/budget cap.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DREAM-01 | Skill-prune pass — `last_used ≥ 91d` → `~/.blade/skills/.archived/<name>/` | §"Prune Pass Mechanics"; SQL + filesystem move; `tool_forge.rs:580-618` row enumeration shape |
| DREAM-02 | Consolidation pass — semantic ≥0.85 + identical 5-trace → flag pair w/ confirm | §"Consolidation Pass Mechanics"; `embeddings.rs:23,33` batch + cosine; new `forged_tools_invocations` sibling table |
| DREAM-03 | Skill-from-trace generation — ≥3 tool calls + no existing match → propose | §"Skill-from-Trace Generation"; reuse `TurnAccumulator.tool_calls` snapshot from `reward.rs:248-259`; persist to `~/.blade/skills/.pending/` |
| DREAM-04 | `skill_validator list --diff <prev_session_id>` shows added/archived/consolidated | §"CLI Subcommand Surface"; `session_handoff.rs:21` `SessionHandoff` extended w/ `skills_snapshot` |
| DREAM-05 | Idle gating + abort — dream_mode pauses on user input within 1s | §"Idle Gating + Abort"; `dream_mode.rs:472,492` interrupt logic; per-step `DREAMING.load` between SQL ops |
| DREAM-06 | ActivityStrip emit per pass-kind w/ count | §"ActivityStrip Emit Helpers"; 3 new sibling helpers in `voyager_log.rs:107` style |

</phase_requirements>

## Summary

Phase 24 is **pure substrate work** — no new libraries, no external research.
All needed primitives already exist in-repo. The phase adds three sibling
dream-mode tasks (prune / consolidate / generate), one new SQLite sibling
table (`forged_tools_invocations`), three new ActivityStrip emit helpers,
two `skill_validator` CLI subcommands, and one new field on
`SessionHandoff`. No new BladeConfig field; thresholds are hardcoded per
ROADMAP. No new Tauri command anticipated (chat-injected prompts surface
through existing proactive_engine → decision_gate emit path; operator
replies as plain chat parsed by intent_router).

**Primary recommendation:** Wave 1 ships the foundation (last_used
backfill + forged_tools_invocations table + record_tool_use wiring + 3
voyager_log helpers + session_handoff snapshot field). Wave 2 ships the 3
dream tasks (prune → consolidate → generate). Wave 3 ships the CLI
subcommands + chat-injected prompt route + integration test. **Five plans
total** if combined cleanly, with foundation first to unblock the rest.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| 91-day prune pass | Background / dream_mode | Database (forged_tools UPDATE/DELETE) | Idle-only work; no chat-loop entry point |
| Semantic-similarity flag | Background / dream_mode | Embeddings (in-process model) | Fastembed model already loaded; cosine is sub-ms |
| Skill-from-trace proposal | Background / dream_mode | Filesystem (.pending/ JSON) | Trace data lives in-memory in TurnAccumulator; persistence is JSON-on-disk |
| Operator confirmation | Chat surface (existing) | proactive_engine + intent_router | No new UI per chat-first pivot |
| Diff CLI | CLI binary (skill_validator) | Filesystem (sessions/) | Standalone shell tool; no Tauri runtime |
| ActivityStrip emit | voyager_log helpers | Frontend (no change) | Sibling helpers parallel to skill_used |

## Standard Stack (in-repo substrate; no new deps)

| Crate / Module | Version | Purpose | Already In Repo? |
|----------------|---------|---------|-----------------|
| rusqlite | (project pinned) | SQLite for forged_tools + new sibling table | Yes (`tool_forge.rs:12`) |
| fastembed | (project pinned) | AllMiniLML6V2 embeddings — `description+usage` text | Yes (`embeddings.rs:1-30`) |
| serde + serde_json | (project pinned) | `.pending/<id>.json` payload (de)serialization | Yes (everywhere) |
| chrono | (project pinned) | `Utc::now().timestamp()` for cycles + 7-day expiry | Yes |
| uuid | (project pinned) | proposal IDs in `.pending/` queue | Yes (`tool_forge.rs:460`) |
| tauri::Emitter | (project pinned) | ActivityStrip + dream_mode lifecycle events | Yes |

**No new crates required.** No new feature flags. `cargo check` cost in
Phase 24 should be ≤1 incremental rebuild after each wave.

## Architecture Patterns

### System Architecture Diagram

```
                       Existing dream_mode loop (dream_mode.rs:463-505)
                       ┌────────────────────────────────────────────────┐
                       │ idle ≥ 1200s → DREAMING=true → run_dream_session│
                       └─────────────┬──────────────────────────────────┘
                                     │ runs sequentially (run_task! macro)
   ┌─────────────────────────────────┼──────────────────────────────────┐
   │ Tasks 1-7 (existing)            │   Task 8 (NEW)  Task 9 (NEW)  Task 10 (NEW) │
   │ memory_consolidation, …         │   skill_prune    skill_consol  skill_from_trace│
   │ skill_synthesis (line 432)      │                                              │
   └────────────────────────────────────────────┬─────────────────────────────────┘
                                                │
                                                ▼ each task
                       ┌─────────────────────────────────────────────┐
                       │ Per-step `DREAMING.load(Relaxed)` checkpoint │
                       │ ↓ if false: early return (≤1s abort)         │
                       └─────────────────────────────────────────────┘
                                                │
                                                ▼
                       ┌──────────── on completion of pass ─────────────┐
                       │ voyager_log::dream_prune       (M-07 emit)      │
                       │ voyager_log::dream_consolidate (M-07 emit)      │
                       │ voyager_log::dream_generate    (M-07 emit)      │
                       └────────────────────────────┬────────────────────┘
                                                    │
                                 (consolidate / generate write here)
                                                    ▼
                       ┌─────────── ~/.blade/skills/.pending/<id>.json ───────────┐
                       │ kind: "merge" | "generate"   payload + proposed body     │
                       └────────────────────────────┬────────────────────────────┘
                                                    │
                                          drained on next chat turn by
                                  proactive_engine → decision_gate → emit "proactive_action"
                                                    │
                                  operator replies in chat → intent_router parses
                                                    │
                                                    ▼
                   apply (merge writes new forged_tools row; generate writes new SKILL.md
                    via skills::export::export_to_user_tier) | dismiss (mark + dedup)
```

### Component Responsibilities

| File | Role in Phase 24 |
|------|------------------|
| `src-tauri/src/dream_mode.rs` | Add 3 new task fns + 3 new `run_task!` invocations after `task_skill_synthesis` line 432 |
| `src-tauri/src/tool_forge.rs` | (a) Anchor `last_used = Some(now)` at line 500-501 + write site at line 467 (NULL → ?N); (b) idempotent migration in `ensure_table` line 132; (c) create `forged_tools_invocations` sibling table; (d) wire `record_tool_use` to write trace row |
| `src-tauri/src/voyager_log.rs` | Add `dream_prune` / `dream_consolidate` / `dream_generate` sibling helpers parallel to `skill_used` line 107 |
| `src-tauri/src/skills/mod.rs` (or new `skills/lifecycle.rs`) | Pure logic for prune candidate selection, deterministic merge body construction, trace-hash derivation |
| `src-tauri/src/skills/pending.rs` (NEW) | Read/write `.pending/<id>.json` queue; dedup by content-hash; 7-day auto-dismiss helper |
| `src-tauri/src/skills/loader.rs` | Add `list_skills_snapshot() -> Vec<SkillRef>` for session_handoff + CLI consumption |
| `src-tauri/src/session_handoff.rs` | Add `skills_snapshot: Vec<SkillRef>` field to `SessionHandoff` struct + populate in `write_session_handoff` |
| `src-tauri/src/bin/skill_validator.rs` | Add `list` + `list --diff` subcommands; preserve current positional `<path>` invocation as alias for `validate` |
| `src-tauri/src/proactive_engine.rs` | Drain `.pending/` queue at top of detector loop; route through `decision_gate::evaluate_and_record` w/ source `"dream_mode_proposal"` (highest threshold to demand operator confirm) |
| `src-tauri/src/intent_router.rs` | Extend pattern set to recognize `yes <id>` / `no <id>` / `dismiss <id>` against pending proposals |

### Anti-Patterns to Avoid

- **Don't add a second wakeup loop for skill passes** — D-24-D ride
  existing 1200s threshold + DREAMING atomic. A second loop would race the
  abort path.
- **Don't trigger consolidate-merge body LLM synthesis** — D-24-E
  deterministic union; LLM is operator's option at confirmation step only.
- **Don't operate on SKILL.md skills under bundled/ or workspace/** —
  D-24-G locks scope; only forged_tools rows are subject to lifecycle.
- **Don't emit per-skill ActivityStrip events** — D-24-F locks one emit
  per pass-kind per cycle with count + capped items.
- **Don't write multiple .pending/ proposals per cycle** — D-24-B locks
  cap at 1 merge + 1 generate per cycle.
- **Don't run cargo check after every micro-edit** — CLAUDE.md batch rule;
  one cargo check at end of each wave.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Embedding model bootstrap | New embedder | `embeddings::embed_texts(&[String])` (line 23) — fastembed AllMiniLML6V2 already lazy-loaded |
| Cosine similarity | Hand-rolled dot product | `embeddings::cosine_similarity` (line 33) — handles zero-vector edge case |
| Tauri AppHandle access in non-command sites | Pass `&AppHandle` through dream task signatures | `integration_bridge::get_app_handle()` (used by `voyager_log::emit` line 40) |
| ActivityStrip emit | New emit function | New helper in `voyager_log.rs` parallel to `skill_used` (lines 107-116) — same `app.emit_to("main", "blade_activity_log", ...)` shape |
| SKILL.md export from `ForgedTool` | Hand-write SKILL.md | `skills::export::export_to_user_tier(&forged, &user_root())` — used at `tool_forge.rs:509` |
| forged_tools row read | Re-implement query | `tool_forge::get_forged_tools()` (line 580) — handles param parsing |
| `safe_slice` for non-ASCII trim | `&s[..n]` slicing | `crate::safe_slice(s, n)` (`lib.rs:177`) — required by CLAUDE.md |
| UUID generation | Hand-rolled | `uuid::Uuid::new_v4()` already in `tool_forge.rs:460` and `proactive_engine.rs:56` |

## Common Pitfalls

### Pitfall 1: register_forged_tool has TWO insertion sites

**What goes wrong:** D-24-A names `register_forged_tool` but the canonical
write site is the INSERT at `tool_forge.rs:464-480` inside
`persist_forged_tool` (the Plan 22-05 refactored path). The literal
`NULL` in line 467 must be changed to `?9` (or kept `?9` and the param
slot at line 477 changed from `now` to repeat — actually current line is
`NULL, 0, ?10`; the migration is to bind `last_used` as a param). Plus
the ForgedTool struct construction at line 500-501 must change
`last_used: None` → `last_used: Some(now)`.

**Why it happens:** Same row written twice — once in SQL (default NULL),
once in struct (default None). Both must move to `Some(created_at)`.

**How to avoid:** Plan task body must touch BOTH the INSERT statement
SQL+params AND the struct literal. Acceptance grep: `grep -c "last_used: None" src-tauri/src/tool_forge.rs` MUST equal 0 after the change.

### Pitfall 2: record_tool_use has zero internal callers today

**What goes wrong:** `tool_forge.rs:693` notes "Currently called by zero
internal sites; tracked as a forward-pointer for the chat tool-loop branch
to call when a forged tool is actually invoked." DREAM-02's identical-trace
gate depends on per-invocation rows in `forged_tools_invocations`. If
`record_tool_use` is never called from the chat dispatch loop, the table
stays empty and DREAM-02 can never flag anything.

**Why it happens:** The dispatch loop in `commands.rs:1857-1950+` knows
which tool was called but doesn't currently distinguish forged_tools from
native/MCP tools — it just executes via bash. The `voyager:skill_used`
emit also never fires from chat.

**How to avoid:** Phase 24 Wave 1 MUST add a dispatch-loop hook that calls
`tool_forge::record_tool_use(&tool_call.name)` when the dispatched tool
matches a row in `forged_tools` (cheap name-set lookup). This is the
canonical write site per CONTEXT.md "Specific Ideas" → "record_tool_use is
the canonical write site for last_used updates."

### Pitfall 3: forged_tools_invocations cleanup race

**What goes wrong:** Auto-prune-to-100-per-tool inside `record_tool_use`
runs in the same connection that just wrote the new row. Without a
transaction, a concurrent dream-mode read could see <5 rows for a tool
that legitimately has 5+ invocations.

**Why it happens:** SQLite default mode (no explicit BEGIN) — auto-commit
per statement. Insert + delete-overflow are two statements; another
connection between them reads inconsistent state.

**How to avoid:** Wrap insert + cleanup in `conn.transaction()`. Dream
task uses a separate `Connection::open` so it sees committed state only.

### Pitfall 4: Concurrent forged_tools writes during dream pass

**What goes wrong:** Operator forges a new tool while dream_mode prune
pass is iterating. Prune holds a `SELECT` cursor; new INSERT fights for
write lock; SQLite returns SQLITE_BUSY.

**Why it happens:** `dream_mode.rs:472` interrupt path checks idle <60s
and aborts — but the chat path that triggers `forge_tool` doesn't update
`LAST_ACTIVITY` before forging. So forge-during-dream is technically
possible.

**How to avoid:** (a) Materialize the prune candidate list with
`stmt.query_map(...).collect::<Vec<_>>()` BEFORE the cursor closes; iterate
the Vec, not the rows. (b) Each per-row update opens its own short-lived
`Connection`. SQLite's WAL mode (default for blade.db per existing
patterns) allows readers + 1 writer concurrently.

### Pitfall 5: Race between consolidate flag and prune

**What goes wrong:** Skill A is flagged for merge with B. Same cycle, A
also crosses 91-day prune threshold. Prune archives A first, then merge
proposal references a no-longer-existent forged_tool.

**Why it happens:** Prune and consolidate run sequentially in the same
cycle (per recommended task order). Without coordination, merge can
reference archived rows.

**How to avoid:** Run prune **first** in the dream cycle (matches
DREAM-01 → DREAM-02 → DREAM-03 hint order). The consolidate pass selects
from forged_tools AFTER prune has removed stale rows; nothing to flag if
both candidates are already archived.

### Pitfall 6: Chat-injected prompt during active turn

**What goes wrong:** Operator typing a chat message at the moment
proactive_engine drains `.pending/`. The merge prompt arrives mid-typing
and steals focus.

**Why it happens:** `proactive_engine` doesn't currently gate on chat
in-flight; it just emits when its detector loop ticks.

**How to avoid:** Drain `.pending/` only when `LAST_ACTIVITY` indicates
≥30s idle (defensive — operator paused typing). Use existing `dream_mode::record_user_activity()`
clock; it's the same one the dream-mode interrupt uses.

### Pitfall 7: Reply-to-proposal disambiguation

**What goes wrong:** Operator says "yes" — but two pending proposals
exist (one merge, one generate). Which one are they accepting?

**Why it happens:** Plain chat reply has no proposal binding; intent_router
sees only the message text.

**How to avoid:** **Always include the proposal_id in the prompt itself**
(e.g., `"Reply 'yes 7af3' or 'dismiss 7af3' to confirm."`). Per-session
in-memory map (most-recent prompt id) is fragile and breaks across app
restart. Cap of 1 merge + 1 generate per cycle (D-24-B) keeps the surface
to ≤2 active proposals at a time. Intent router pattern: regex
`(yes|no|dismiss)\s+([a-f0-9]{4,})` → look up in `.pending/` directory.

### Pitfall 8: SKILL.md export side effects on archive

**What goes wrong:** During prune, the forged_tools row is archived but
`skills::export::export_to_user_tier` already wrote the SKILL.md to
`~/.blade/skills/<name>/`. If the archive moves the dir but a stale
`brain_skills` or future Catalog::resolve cache holds a reference, the
skill still appears.

**Why it happens:** `~/.blade/skills/<name>/` is the canonical user-tier
location. Moving it to `.archived/<name>/` makes it disappear from
`scan_tier` (line 34 skips dotfiles) — that part works correctly. But
brain_skills table (skill_engine.rs synthesis output) is independent.

**How to avoid:** Phase 24 prune touches ONLY `forged_tools` (DB) +
`~/.blade/skills/<name>/` (filesystem dir). Do NOT touch `brain_skills`.
Document the boundary explicitly: brain_skills is Skills v1 substrate,
forged_tools is Voyager substrate, and they coexist (per Phase 21/22
comments).

### Pitfall 9: Test isolation for SQLite tests

**What goes wrong:** Tests that touch `forged_tools` mutate the dev
machine's `~/.blade/blade.db`.

**Why it happens:** `tool_forge::open_db()` line 126 reads from
`config::blade_config_dir()`.

**How to avoid:** Existing pattern is `BLADE_CONFIG_DIR` env var override
(`config.rs:659`). Tests wrap with a `TempDir` + `std::env::set_var`. The
existing reward.rs / doctor.rs tests use this pattern. No `harness.rs`
file in `src-tauri/src/tests/` — test isolation is per-file via
`tempfile::TempDir + BLADE_CONFIG_DIR`. Reference: `reward.rs:1095+` test
shape.

## Runtime State Inventory

> Phase 24 IS substrate work, not a rename. Most categories are N/A.
> Listed for completeness per researcher protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) `forged_tools` rows with `last_used = NULL` from prior phases — must be backfilled. (2) Existing `~/.blade/skills/<name>/` dirs from Phase 22 forge_tool exports. | (1) Idempotent SQL migration in `ensure_table` per D-24-A. (2) None — these are the candidate set for prune; living dirs untouched until pruned. |
| Live service config | None — Phase 24 doesn't touch external services. | None |
| OS-registered state | None — no schedulers/launchd/etc. | None |
| Secrets/env vars | None new. `BLADE_CONFIG_DIR` override remains for test isolation. | None |
| Build artifacts | `skill_validator` binary at `target/{debug,release}/skill_validator` — gets new subcommands, requires rebuild. | `cargo build --bin skill_validator` after subcommand wiring. |

## Prune Pass Mechanics (DREAM-01)

### Selection SQL

```sql
-- Run after D-24-A migration (so no NULLs survive)
SELECT id, name, script_path, last_used
FROM forged_tools
WHERE last_used IS NOT NULL
  AND ?1 - last_used >= 91 * 86400
ORDER BY last_used ASC;  -- stale-first for deterministic ordering
```

The `?1` bind is `chrono::Utc::now().timestamp()` snapshotted once at
pass entry (consistency: don't recompute mid-loop or boundary candidates
flicker).

### Per-Row Action

For each candidate row:

1. **Compute `~/.blade/skills/<name>/` path** via `crate::skills::user_root().join(&sanitized_name)`. Sanitization MUST match
   `skills::export::sanitize_name(&row.name)` (line 39) — underscore →
   hyphen; if `None` returned, the skill has no SKILL.md export, so skip
   filesystem move.
2. **Compute archive destination** `<user_root>/.archived/<sanitized>/`.
   Create `<user_root>/.archived/` if missing.
3. **Filesystem move:**
   - If source dir doesn't exist (e.g., never exported, or already
     archived) → log warn, continue with DB delete (idempotent).
   - If destination dir already exists (re-archival edge case) → suffix
     with `_dup<unix_ts>` to preserve both copies.
   - Use `std::fs::rename`; on cross-device-link error, fall back to
     `fs_extra::dir::move_dir` or hand-rolled copy+remove. (WSL on
     `/home` rarely crosses mount; cite as a defensive fallback only.)
4. **Tool script in `~/.blade/tools/<name>.<ext>`** — leave in place.
   D-24-G "preserved on disk but not in active catalog"; the script file
   is preserved at its original location even though the SKILL.md wrapper
   moved. (Alternative: also move script. Recommend leave — simpler, and
   the catalog resolver only looks at `~/.blade/skills/`.)
5. **DB row removal** — `DELETE FROM forged_tools WHERE id = ?1`. This is
   the "remove from live registry" step per CONTEXT.md "Integration
   Points." Archived skills are filesystem-only after prune.
6. **Append item to `pruned_names: Vec<String>`** for the
   `voyager_log::dream_prune` emit at end of pass.

### Error Handling

- Filesystem move failure → log error, **skip DB delete**, continue. Row
  stays live; will be retried next cycle.
- DB delete failure → log error, continue. The dir is already archived,
  so worst case is an orphaned DB row whose script file is at the old
  location but SKILL.md is in `.archived/`. Self-heals next cycle once
  filesystem move idempotency triggers (renamed+already_archived suffix).

### DB Row Removal vs Mark-Archived Choice

**Locked: remove DB row.** D-24-G "live registry" posture + CONTEXT.md
"Integration Points." The filesystem dir under `.archived/` is the
preservation surface. `--diff` CLI lists archived dirs separately so they
remain visible.

## Consolidation Pass Mechanics (DREAM-02)

### Pairwise Embedding Strategy

**Batch over incremental** — `embeddings::embed_texts(&Vec<String>)` is
batched-friendly. Build the input vec from
`SELECT name, description, usage FROM forged_tools` once per pass:

```rust
let texts: Vec<String> = rows.iter()
    .map(|r| format!("{} {}", r.description, r.usage))  // D-24-E embedding source
    .collect();
let embeddings = crate::embeddings::embed_texts(&texts)?;  // single call
```

**Pairwise cosine** — outer loop `i in 0..n`, inner `j in (i+1)..n`. For
n forged tools, this is O(n²) cosine ops; each cosine is sub-ms; n is
expected ≤100 in practice; total <10ms. Per-step `DREAMING.load` checkpoint
between outer-loop iterations (per Discretion item 8 lock).

### trace_hash Derivation (Discretion item 2 → LOCKED)

Sibling table `forged_tools_invocations`:

```sql
CREATE TABLE IF NOT EXISTS forged_tools_invocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    trace_hash TEXT NOT NULL,
    FOREIGN KEY (tool_name) REFERENCES forged_tools(name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fti_tool ON forged_tools_invocations(tool_name, id DESC);
```

`trace_hash` = SHA-256 hex (first 16 chars) of comma-joined tool-name
sequence from the SAME chat turn that invoked this skill. Format:
`"<tool_a>,<tool_b>,<this_skill_name>,<tool_c>"` — INCLUDES the skill
itself in position-correct order. Empty turn = `trace_hash` of just the
skill name.

The hash source is `TurnAccumulator.tool_calls.snapshot_calls()` at the
point `record_tool_use(&skill_name)` is called from the chat dispatch
loop. **This requires Wave 1 to wire** the dispatch loop in
`commands.rs:1857+` to (a) detect when a forged tool is being invoked,
(b) call `record_tool_use(name, &turn_acc.snapshot_calls())` (note: the
function signature must grow to take the trace), (c) inside record_tool_use
compute the hash and write the invocation row.

**Recommend signature:**

```rust
pub fn record_tool_use(name: &str, turn_tool_names: &[String]) {
    // existing UPDATE last_used + use_count + voyager_log::skill_used emit
    // NEW: hash + INSERT into forged_tools_invocations + auto-prune to last 100
}
```

Backward-compat: call sites that don't have the trace pass `&[]`.

### Auto-Prune to Last 100 Per Tool

Inside `record_tool_use` after INSERT:

```sql
DELETE FROM forged_tools_invocations
WHERE tool_name = ?1
  AND id NOT IN (
    SELECT id FROM forged_tools_invocations
    WHERE tool_name = ?1
    ORDER BY id DESC LIMIT 100
  );
```

Wrap insert + this delete in a `conn.transaction()` per Pitfall 3.

### Threshold Gate

```rust
if cosine >= 0.85 {
    // Read last 5 trace_hashes for both tools
    let hashes_a: Vec<String> = SELECT trace_hash FROM forged_tools_invocations
                                WHERE tool_name = ?1 ORDER BY id DESC LIMIT 5;
    let hashes_b: Vec<String> = ... same for tool b ...;
    if hashes_a.len() == 5 && hashes_a == hashes_b {  // identical trace hash sequences
        // Flag for merge → write .pending/<id>.json
    }
}
```

Cap of 1 merge proposal per cycle (D-24-B): break out of the pairwise
loop after the first pair flagged.

### Queue Write

```rust
let proposal_id = uuid::Uuid::new_v4().to_string()[..8].to_string();  // short hash
let payload = json!({
    "id": proposal_id,
    "kind": "merge",
    "proposed_name": deterministic_merged_name(&a, &b),
    "payload": {
        "source_a": &a.name,
        "source_b": &b.name,
        "merged_body": deterministic_merge_body(&a, &b),  // D-24-E
    },
    "created_at": chrono::Utc::now().timestamp(),
    "dismissed": false,
    "content_hash": sha256_hex(payload_json_canonical),  // dedup vs prior cycle
});
// Write to ~/.blade/skills/.pending/<proposal_id>.json
```

Dedup logic: before writing, scan `.pending/*.json`; if any existing file
has matching `content_hash`, skip (don't refire).

### Deterministic Merge Body (D-24-E expanded)

Pure function in `skills/lifecycle.rs`:

```rust
pub fn deterministic_merge_body(a: &ForgedTool, b: &ForgedTool) -> ForgedTool {
    let (smaller, larger) = if a.name <= b.name { (a, b) } else { (b, a) };
    let base_name = format!("{}_merged", smaller.name);
    let merged_name = ensure_unique_name(&base_name);  // appends _v2, _v3 ... if exists

    ForgedTool {
        id: uuid::Uuid::new_v4().to_string(),
        name: merged_name,
        description: format!("{} | {}", a.description, b.description),
        language: smaller.language.clone(),  // tied to script_path keep
        script_path: smaller.script_path.clone(),
        usage: dedup_lines(&format!("{}\n{}", a.usage, b.usage)),
        parameters: union_dedup_by_name(&a.parameters, &b.parameters),
        test_output: format!("{}\n--- merged ---\n{}", a.test_output, b.test_output),
        created_at: chrono::Utc::now().timestamp(),
        last_used: Some(chrono::Utc::now().timestamp()),  // D-24-A
        use_count: 0,
        forged_from: format!("merge:{}+{}", a.name, b.name),
    }
}
```

`ensure_unique_name` (Discretion item 3 LOCK):

```rust
fn ensure_unique_name(base: &str) -> String {
    if !forged_tools_has(base) { return base.to_string(); }
    for n in 2..1000 {
        let cand = format!("{}_v{}", base, n);
        if !forged_tools_has(&cand) { return cand; }
    }
    format!("{}_{}", base, uuid::Uuid::new_v4())  // ultra-safe last resort
}
```

## Skill-from-Trace Generation (DREAM-03)

### Chat Turn Source

**Locked: `TurnAccumulator.tool_calls` is the source.** Reasoning:

- `reward.rs:248-259` already accumulates per-turn `Vec<ToolCallTrace>`
  including `tool_name`, `args_str`, `result_content`, `is_error`,
  `timestamp_ms`. Each chat turn produces exactly one populated
  `TurnAccumulator` consumed at `commands.rs:1831`.
- The `messages` table (db.rs line 760) stores conversation text but NOT
  per-tool-call rows — extracting tool sequences would require parsing
  message content, which is fragile.
- `activity_timeline` table has a generic `event_type='tool_call'` slot
  (db.rs line 1792 comment) but we do not currently emit there for tool
  calls.

**Recommended path:** Phase 24 introduces a sibling SQLite table
`turn_traces` written from the same `compute_and_persist_turn_reward`
hook at `commands.rs:1831`, capturing:

```sql
CREATE TABLE IF NOT EXISTS turn_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_ts INTEGER NOT NULL,                 -- chrono::Utc seconds
    tool_names TEXT NOT NULL,                 -- JSON array of strings, in order
    forged_tool_used TEXT,                    -- name of the forged tool invoked, if any (NULL = none)
    success INTEGER NOT NULL DEFAULT 1        -- 1 if no errors in any tool call
);
CREATE INDEX IF NOT EXISTS idx_tt_ts ON turn_traces(turn_ts DESC);
```

The dream task reads:

```sql
SELECT tool_names FROM turn_traces
WHERE turn_ts >= ?1                          -- now - 24h
  AND forged_tool_used IS NULL               -- no existing skill matched
  AND success = 1
  AND json_array_length(tool_names) >= 3     -- ≥3 tool calls
ORDER BY turn_ts DESC;
```

Group by tool-sequence-equality across the 24h window. If a sequence
appears ≥1 time (recommend 2+ for noise reduction; document threshold as
LOCKED at 1 per literal ROADMAP reading — REQUIREMENTS DREAM-03 says
"successful 4-tool turn" without a frequency gate, so 1 is the floor) →
propose new skill.

**Trade-off acknowledged:** ROADMAP literally says 1+ → propose. Sticking
with 1 honors the spec; cap-of-1-proposal-per-cycle (D-24-B) is the
spam-control layer.

### "No Existing Skill Match" Check

`forged_tool_used IS NULL` in the WHERE clause does this. The hook at
`commands.rs:1831` writes `forged_tool_used = Some(name)` when ANY of the
turn's tool calls matches a row in `forged_tools` (cheap `HashSet<String>`
lookup of forged names). **This is the same hook needed for the
record_tool_use wiring (Pitfall 2).** Wave 1 ships both together.

### proposed_name Derivation

Deterministic from the tool sequence:

```rust
fn proposed_name_from_trace(tool_names: &[String]) -> String {
    // Take first 2-3 tool names, snake_case, join with '_', prefix "auto_"
    let truncated: String = tool_names.iter()
        .take(3)
        .map(|n| n.split('_').take(2).collect::<Vec<_>>().join("_"))
        .collect::<Vec<_>>()
        .join("_");
    format!("auto_{}", crate::safe_slice(&truncated, 50))
}
```

Run through `ensure_unique_name` from §"Consolidation" before persisting.

### Proposed SKILL.md Body

Write proposal to `.pending/<id>.json` containing the SKILL.md frontmatter
+ a body that lists the tool sequence as scripts/ steps. On operator
"yes," `proactive_engine` consumer hands off to
`skills::export::export_to_user_tier(&forged_proxy, &user_root())` to
land the SKILL.md.

## CLI Subcommand Surface (DREAM-04)

### Argument Parsing

Current `skill_validator.rs:21-56` does manual flag parsing. Phase 24
extends with subcommand dispatch:

```rust
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let (subcmd, rest) = match args.get(1).map(|s| s.as_str()) {
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

### `list` Output (Text Default)

```
[forged]    youtube-transcript-fetch       last_used: 2026-04-15  use_count: 12
[forged]    git-status-summarizer           last_used: 2026-04-22  use_count: 47
[bundled]   git-status-summary              -                       -
[bundled]   format-clipboard-as-markdown    -                       -
[user]      my-custom-thing                 -                       -
```

Three tier columns map: `forged` (read from `forged_tools` SQLite),
`bundled` (read from `skills::bundled_root()`), `user` (read from
`skills::user_root()`, excluding dotfile dirs i.e. `.archived` and
`.pending`).

### `--json` Flag

```json
{
  "forged": [{"name": "...", "last_used": 1737..., "use_count": 12, "id": "..."}],
  "bundled": [{"name": "...", "path": "..."}],
  "user": [{"name": "...", "path": "..."}],
  "archived": [{"name": "...", "path": ".../.archived/..."}]
}
```

### `--diff <session_id>` Behavior

1. Read `~/.blade/sessions/<session_id>.json` → `SessionHandoff` with
   new `skills_snapshot: Vec<SkillRef>` field.
2. Read current snapshot via the same `list_skills_snapshot()` helper
   the session_handoff writer uses.
3. Compute set-diff:
   - `added` = current ∖ prior (by name)
   - `archived` = prior ∖ current AND present under `.archived/<name>/`
   - `consolidated` = prior ∖ current AND name appears in any current
     forged_tool's `forged_from` field with `merge:` prefix

Output:

```
+ added (3):
    auto_git_log_pretty
    extract_youtube_transcript
+ archived (1):
    legacy_csv_parser
+ consolidated (1):
    foo_bar + baz_quux → foo_bar_merged
```

`--json` flips to structured output of the three buckets.

### session_handoff.rs `skills_snapshot` Field (Discretion item 5 → LOCKED)

`session_handoff.rs:21` `SessionHandoff` struct gains:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRef {
    pub name: String,
    pub source: String,           // "forged" | "bundled" | "user" | "archived"
    pub last_used: Option<i64>,
    pub forged_from: Option<String>,  // for consolidate detection
}

// In SessionHandoff:
pub skills_snapshot: Vec<SkillRef>,   // NEW
```

`#[serde(default)]` on the new field for backward-compat with old
session JSONs. Populated in `write_session_handoff` line 51 by calling a
new `skills::loader::list_skills_snapshot()` helper that walks all four
sources.

**Where sessions live:** `session_handoff.rs:29` writes to a SINGLE file
`<config_dir>/session_handoff.json` — NOT `<config_dir>/sessions/<id>.json`.
Phase 24 must EITHER (a) extend session_handoff to write per-session
files keyed by session id, OR (b) accept that `--diff` only diffs against
the most recent session. Recommend (a) — write both:

- `session_handoff.json` (existing, latest-only — preserved)
- `sessions/<id>.json` (NEW, archived for diff history; cap at last 30
  to bound disk usage)

The `<id>` is `chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string()`
or use the existing `generated_at: i64` as the basename.

## Idle Gating + Abort (DREAM-05)

### Inheritance from dream_mode.rs

`dream_mode.rs:472` interrupt path triggers when
`already_dreaming && idle_secs < 60` — operator activity within last 60s
flips DREAMING off. The `run_task!` macro at line 408-418 checks
`DREAMING.load(Relaxed)` between tasks and early-returns the session as
"interrupted." Phase 24 inherits this entirely; no new gate logic.

### Per-Step Checkpoint Placement (Discretion item 8 → LOCKED)

**After every unit of work expected to take >100ms.** Concretely:

| Pass | Checkpoint Site |
|------|-----------------|
| Prune | After each per-row archive (filesystem move + DB delete) — the longest single op (~10-50ms for `fs::rename` on hot dir). Loop body: `if !DREAMING.load(Relaxed) { break; }` then archive row N+1. |
| Consolidate | (a) After `embed_texts` batch (the heavy lifter — 50-500ms for n≤100 rows). (b) After each pair similarity check inside the O(n²) inner loop, but only every 20 pairs (not every pair — n=100 → 4950 pairs at 100µs each = under 1s anyway, so per-20 is conservative). |
| Generate | After each `turn_traces` row evaluated. Each is a HashMap lookup + small JSON parse — sub-ms — but the 24h window may have hundreds of rows. Per-row check is cheap. |

### Verification of Inherited Threshold

The inherited 1200s + interrupt logic was last exercised by Phase 19
manual UAT and Phase 22-08 close. Phase 24 should add an integration
test: drive `dream_trigger_now()` (line 516 — the manual entrypoint) +
between prune SQL ops, set `DREAMING.store(false, SeqCst)` + call
`record_user_activity()` + assert the `run_task!` early-return fires
within 1 second. Test uses `tokio::time::Instant::now()` bracket to
measure abort latency.

## ActivityStrip Emit Helpers (DREAM-06)

Three new helpers in `voyager_log.rs` parallel to `skill_used` line 107:

```rust
/// One emit per dream-mode prune pass.
pub fn dream_prune(count: i64, items: Vec<String>) {
    let summary = format!("dream:prune {} skill(s) archived", count);
    emit("dream_mode:prune", &summary, json!({
        "count": count,
        "items": cap_items(&items, 10),
    }));
}

pub fn dream_consolidate(count: i64, items: Vec<String>) {
    let summary = format!("dream:consolidate {} pair(s) flagged", count);
    emit("dream_mode:consolidate", &summary, json!({
        "count": count,
        "items": cap_items(&items, 10),
    }));
}

pub fn dream_generate(count: i64, items: Vec<String>) {
    let summary = format!("dream:generate {} skill(s) proposed", count);
    emit("dream_mode:generate", &summary, json!({
        "count": count,
        "items": cap_items(&items, 10),
    }));
}

fn cap_items(items: &[String], cap: usize) -> Vec<String> {
    if items.len() <= cap { return items.to_vec(); }
    let mut out: Vec<String> = items.iter().take(cap).cloned().collect();
    out.push(format!("... (+{} more)", items.len() - cap));
    out
}
```

### Action namespace

Phase 22 used bare `gap_detected` / `skill_written` / etc. (no module
prefix). Phase 24 prefixes `dream_mode:` to disambiguate from voyager
emits. Both share `MODULE = "Voyager"` constant — frontend filters by
action prefix.

**Open question:** Should Phase 24 helpers use `MODULE = "DreamMode"`
distinct from `MODULE = "Voyager"`? Recommend NO — keep `MODULE =
"Voyager"` (these ARE Voyager-loop closure events, just the forgetting
half) and let the action prefix differentiate. This matches the
voyager-loop-play.md framing of dream-mode-as-Voyager-half.

## forged_tools_invocations Sibling Table (Discretion item 2 → LOCKED)

### Schema

```sql
CREATE TABLE IF NOT EXISTS forged_tools_invocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    ts INTEGER NOT NULL,
    trace_hash TEXT NOT NULL
    -- NOTE: no FOREIGN KEY because forged_tools.name has UNIQUE not PK,
    -- and rusqlite default doesn't enforce FK without PRAGMA foreign_keys=ON.
    -- Sufficient guarantee: prune cascade is application-level (delete
    -- invocations where tool_name not in (SELECT name FROM forged_tools)).
);
CREATE INDEX IF NOT EXISTS idx_fti_tool_id ON forged_tools_invocations(tool_name, id DESC);
```

### Write Site

`tool_forge::record_tool_use(name: &str, turn_tool_names: &[String])`:

```rust
pub fn record_tool_use(name: &str, turn_tool_names: &[String]) {
    let conn = match open_db() { Ok(c) => c, Err(_) => return };
    ensure_table(&conn).ok();
    ensure_invocations_table(&conn).ok();  // NEW

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

    // Auto-prune to last 100 per tool
    tx.execute(
        "DELETE FROM forged_tools_invocations WHERE tool_name = ?1 AND id NOT IN \
         (SELECT id FROM forged_tools_invocations WHERE tool_name = ?1 ORDER BY id DESC LIMIT 100)",
        params![name],
    ).ok();

    tx.commit().ok();

    crate::voyager_log::skill_used(name);
}

fn compute_trace_hash(tool_names: &[String]) -> String {
    use sha2::{Digest, Sha256};
    let joined = tool_names.join(",");
    let mut hasher = Sha256::new();
    hasher.update(joined.as_bytes());
    let bytes = hasher.finalize();
    hex_short(&bytes[..8])  // 16 hex chars
}
```

**Note:** `sha2` crate is not yet a dependency — verify with
`Cargo.toml` grep. If absent, alternative: `std::collections::hash_map::DefaultHasher`
(used in dream_mode.rs:53 for uuid_v4) — produces u64; format hex. Less
collision-resistant but adequate for trace identity (we want stable
identity, not cryptographic uniqueness). Recommend default hasher to
avoid new dependency.

### Read Site

Consolidate pass — see §"Consolidation Pass Mechanics."

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust nextest-compatible; project uses default) + integration tests via standalone test binaries |
| Config file | `src-tauri/Cargo.toml` (no separate test config) |
| Quick run command | `cd src-tauri && cargo test --lib dream_mode -- --test-threads=1` (per CLAUDE.md "batch first") |
| Full suite command | `cd src-tauri && cargo test --lib -- --test-threads=1` (single-threaded due to shared `BLADE_CONFIG_DIR` env var pattern) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DREAM-01 | Stale skill `last_used ≥91d` → moved to `.archived/` + DB row removed | unit | `cargo test --lib skills::lifecycle::tests::prune_archives_stale_skill -- --test-threads=1` | ❌ Wave 1 (new module `skills/lifecycle.rs`) |
| DREAM-01 | last_used backfill — `ensure_table` post-migration sets created_at on NULL rows | unit | `cargo test --lib tool_forge::tests::ensure_table_backfills_null_last_used` | ❌ Wave 1 |
| DREAM-02 | 2 forged tools w/ identical 5-trace + cosine ≥0.85 → pair flagged + .pending/ written | integration | `cargo test --lib skills::lifecycle::tests::consolidate_flags_identical_traces` | ❌ Wave 2 |
| DREAM-02 | trace_hash sequence equality test — different orderings of same tools produce different hashes | unit | `cargo test --lib tool_forge::tests::trace_hash_order_sensitive` | ❌ Wave 1 |
| DREAM-02 | deterministic_merge_body — same 2 inputs always produce same merged ForgedTool | unit | `cargo test --lib skills::lifecycle::tests::merge_body_deterministic` | ❌ Wave 2 |
| DREAM-02 | ensure_unique_name — collision suffixed with _v2 | unit | `cargo test --lib skills::lifecycle::tests::merge_name_collision_suffixed` | ❌ Wave 2 |
| DREAM-03 | 4-tool successful turn w/ no forged_tool_used → proposal written | integration | `cargo test --lib skills::lifecycle::tests::skill_from_trace_proposes` | ❌ Wave 2 |
| DREAM-03 | proposed_name from trace — same trace input → same name | unit | `cargo test --lib skills::lifecycle::tests::proposed_name_deterministic` | ❌ Wave 2 |
| DREAM-04 | `skill_validator list` — 3-tier output text | CLI integration | `cargo test --bin skill_validator -- list_subcommand_text_format` | ❌ Wave 3 |
| DREAM-04 | `skill_validator list --json` — structured 4-bucket output | CLI integration | `cargo test --bin skill_validator -- list_subcommand_json_format` | ❌ Wave 3 |
| DREAM-04 | `skill_validator list --diff <id>` — added/archived/consolidated buckets | CLI integration | `cargo test --bin skill_validator -- list_diff_categorizes` | ❌ Wave 3 |
| DREAM-04 | session_handoff `skills_snapshot` field round-trips | unit | `cargo test --lib session_handoff::tests::skills_snapshot_serde_roundtrip` | ❌ Wave 1 |
| DREAM-05 | abort within 1s — drive `dream_trigger_now` + flip DREAMING mid-prune | integration | `cargo test --lib dream_mode::tests::abort_within_one_second` | ❌ Wave 2 |
| DREAM-05 | per-step checkpoint — pruning 10 skills, abort after #3 → 7 untouched | integration | `cargo test --lib skills::lifecycle::tests::prune_respects_dreaming_atomic` | ❌ Wave 2 |
| DREAM-06 | `dream_prune` emit shape — count + capped items | unit | `cargo test --lib voyager_log::tests::dream_prune_caps_items_at_10` | ❌ Wave 1 |
| DREAM-06 | All 3 helpers safe without AppHandle | unit | `cargo test --lib voyager_log::tests::dream_emit_helpers_safe_without_app_handle` | ❌ Wave 1 |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo test --lib <module>::tests -- --test-threads=1` (e.g., `skills::lifecycle::tests`) — under 30s
- **Per wave merge:** `cd src-tauri && cargo test --lib -- --test-threads=1` — full suite, 4-5min
- **Phase gate:** Full suite + `cargo build --bin skill_validator` + `npx tsc --noEmit` (no TS lockstep expected — this is pure Rust substrate) — green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/src/skills/lifecycle.rs` (NEW) — covers DREAM-01, -02, -03 pure logic (deterministic_merge_body, prune candidate selection, proposed_name). Tests inline.
- [ ] `src-tauri/src/skills/pending.rs` (NEW) — covers .pending/ queue read/write, content_hash dedup, 7-day auto-dismiss.
- [ ] `tool_forge.rs` test additions — `ensure_table_backfills_null_last_used`, `trace_hash_order_sensitive`, `record_tool_use_writes_invocation_row`. Tests append to existing `mod tests` block.
- [ ] `dream_mode.rs` test additions — `abort_within_one_second` integration test using `BLADE_CONFIG_DIR` + tempdir.
- [ ] `voyager_log.rs` test additions — extend existing `mod tests` (line 118+) with 4 new tests.
- [ ] `session_handoff.rs` test additions — `skills_snapshot_serde_roundtrip` + `skills_snapshot_default_for_old_json`.
- [ ] `bin/skill_validator.rs` — extract subcommand handlers into `pub` module entries so they can be unit-tested without spawning subprocesses (existing binary uses ExitCode + stderr). Recommend factoring into `mod handlers; pub fn run_list(...)` etc.
- [ ] No new framework install; no new test config.

## Open Questions Closed

| # | Question | Locked Answer | Rationale |
|---|----------|--------------|-----------|
| 1 | `forged_tools` migration: launch-time idempotent SQL vs `_migrations` table | **Launch-time idempotent.** Single `UPDATE … WHERE last_used IS NULL` inside `ensure_table` after CREATE TABLE. | <1ms cost on bounded row count; second launch is no-op. Migration table adds infra without proportional safety; the SQL is its own idempotency proof. |
| 2 | Trace storage for DREAM-02 5-trace gate | **New `forged_tools_invocations` sibling table.** Schema: `(id PK, tool_name, ts, trace_hash)` + index on `(tool_name, id DESC)`. trace_hash = first 16 hex chars of SHA-256 (or DefaultHasher u64) over comma-joined turn tool-name sequence. Auto-prune to last 100 per tool inside `record_tool_use`, wrapped in transaction. | No existing per-invocation log. Trace identity needs to be order-sensitive over the same chat turn's tool sequence — comma-join + hash is canonical. 100-row cap bounds disk; sliding-window-of-5 always available. |
| 3 | Deterministic name de-duplication in D-24-E merge | **`<base>_merged` → on collision append `_v2`, `_v3` … up to `_v999`; ultra-last-resort `_<uuid>`.** | Lexicographic semantics (sorted, stable, machine-friendly). 999 collisions on the same merged base is impossibly large — uuid fallback is paranoid completeness. |
| 4 | `.pending/` queue housekeeping — auto-dismiss timing | **7-day auto-dismiss runs at TOP of each dream cycle, before prune pass.** Walks `~/.blade/skills/.pending/*.json`; if `created_at < now - 7*86400` and `dismissed == false`, set `dismissed = true` + write back. Don't delete — keep for 30-day audit trail (then delete by file mtime in same sweep). | Top-of-cycle is the natural sweep point — already idle, already running. Separate cron is over-engineered. Per Discretion item 4 lock + bound disk via 30-day delete. |
| 5 | CLI session-id source — does session_handoff write per-session snapshots? | **NO — session_handoff.rs:29 writes single `session_handoff.json` (latest-only).** Phase 24 must EXTEND `write_session_handoff` to ALSO write `sessions/<generated_at_iso>.json` archived copy + add `skills_snapshot: Vec<SkillRef>` field. Cap last 30 sessions; `--diff <id>` reads from that dir. | Confirmed by reading session_handoff.rs end-to-end. Adding the field via `#[serde(default)]` is back-compat. 30-session cap bounds disk to ~30KB. |
| 6 | Embedding source for D-24-E semantic-similarity | **`format!("{} {}", description, usage)` — concatenate w/ space.** | ForgedTool struct has both fields (line 31, 33). Description captures intent; usage captures invocation shape. Concatenation lets the embedding cover both surfaces. Per CONTEXT.md Discretion recommendation. |
| 7 | Chat-injected prompt — Tauri command vs plain message | **Plain chat message parsed by `intent_router`.** No new Tauri command, no buttons. Prompt format MUST include the proposal_id literal: `"Reply 'yes 7af3' or 'dismiss 7af3'"`. intent_router pattern: regex `\b(yes\|no\|dismiss)\s+([a-f0-9]{4,})\b` → look up in `.pending/`. Per-session in-memory map rejected (fragile across restart, breaks on multi-pending case). | D-24-B explicit + chat-first pivot anchor. Prompt-embedded id is the simplest binding; cap of 1+1 per cycle keeps surface small. |
| 8 | Per-step DREAMING checkpoint placement | **Locked: between archive operations (prune), between embedding pairs (consolidate every 20 pairs), between turn_traces rows (generate). Per Discretion item 8.** Skip checkpoints inside pure-CPU sub-ms ops (cosine, hash) — only check between work units >100ms. | Excessive checkpoints add overhead; absent checkpoints break the 1s abort SLA. Boundary is "anything that touches disk or a sleep-equivalent." |

## Risks / Pitfalls

> See §"Common Pitfalls" 1-9 above for full treatment. Brief recap:

| # | Risk | Mitigation |
|---|------|------------|
| 1 | last_used NULL in 2 sites (SQL default + struct literal) | Acceptance grep on `last_used: None` count = 0 |
| 2 | record_tool_use has no callers — DREAM-02 starves | Wave 1 wires dispatch loop hook |
| 3 | forged_tools_invocations cleanup race | conn.transaction() wrap |
| 4 | Concurrent forged_tools writes during dream pass | Materialize candidates via `.collect::<Vec<_>>()` before iter; SQLite WAL handles reader+writer |
| 5 | Race between consolidate flag and prune | Prune runs FIRST in cycle; consolidate selects from post-prune state |
| 6 | Chat prompt during typing | Drain `.pending/` only when `LAST_ACTIVITY` ≥30s idle |
| 7 | Reply-to-proposal disambiguation | Prompt embeds proposal_id literal; intent_router regex parses `(verb) (id)` |
| 8 | SKILL.md export side effects on archive | Touch only forged_tools DB + filesystem dir; leave brain_skills + tools/ alone |
| 9 | SQLite test isolation | TempDir + `BLADE_CONFIG_DIR` env override (per reward.rs:1095 pattern) |

## Files to Create / Modify

### Wave 1 — Foundation (3 plans, ~600 LOC)

| File | Action | Est. LOC | Notes |
|------|--------|----------|-------|
| `src-tauri/src/tool_forge.rs` | MODIFY | +60 / -3 | (a) `last_used: Some(now)` at line 500-501; (b) INSERT change line 467 (NULL → ?N + bind now); (c) idempotent migration in `ensure_table` line 132-150; (d) `ensure_invocations_table` helper; (e) `record_tool_use` signature change to take trace + transaction wrap; (f) `compute_trace_hash` private fn; (g) 4 new unit tests appended to existing `mod tests` |
| `src-tauri/src/voyager_log.rs` | MODIFY | +90 | 3 new helpers (dream_prune/consolidate/generate) + cap_items + 4 new tests in existing `mod tests` |
| `src-tauri/src/commands.rs` | MODIFY | +20 | Wire dispatch loop at line 1857+ to call `record_tool_use(name, turn_acc.snapshot_calls().tool_names())` when forged tool invoked. Also write `turn_traces` row at line 1831 alongside `compute_and_persist_turn_reward` (or factor into reward hook). |
| `src-tauri/src/db.rs` | MODIFY | +15 | Add `CREATE TABLE turn_traces` migration in existing CREATE TABLE batch (line 167+). |
| `src-tauri/src/session_handoff.rs` | MODIFY | +50 | Add `SkillRef` struct, `skills_snapshot: Vec<SkillRef>` field with `#[serde(default)]`, populate in `write_session_handoff`, write `sessions/<id>.json` archived copy w/ 30-cap, 2 new tests |
| `src-tauri/src/skills/loader.rs` | MODIFY | +40 | New `pub fn list_skills_snapshot() -> Vec<SkillRef>` — walks forged_tools + 3 tier roots + .archived; 1 new test |

**Wave 1 acceptance:** `cargo test --lib tool_forge::tests voyager_log::tests session_handoff::tests skills::loader::tests -- --test-threads=1` all green.

### Wave 2 — Dream Tasks (2 plans, ~700 LOC)

| File | Action | Est. LOC | Notes |
|------|--------|----------|-------|
| `src-tauri/src/skills/lifecycle.rs` | CREATE | +400 | Pure logic: `prune_candidates(now, all_rows) -> Vec<...>`, `archive_skill(name) -> Result<...>`, `consolidate_flag(rows, embeds) -> Option<MergePair>`, `deterministic_merge_body`, `ensure_unique_name`, `proposed_name_from_trace`, `recent_unmatched_traces(now, conn) -> Vec<TraceCandidate>`. ~12 unit tests. |
| `src-tauri/src/skills/pending.rs` | CREATE | +180 | `pending_dir() -> PathBuf` (creates `.pending/`), `write_proposal(&Proposal) -> Result<()>` w/ content_hash dedup, `read_proposals() -> Vec<Proposal>`, `mark_dismissed(id)`, `auto_dismiss_old(7_days_secs, 30_days_purge_secs)`. ~6 unit tests. |
| `src-tauri/src/dream_mode.rs` | MODIFY | +120 | 3 new task fns (`task_skill_prune`, `task_skill_consolidate`, `task_skill_from_trace`) + 3 new `run_task!` invocations after line 432 (skill_synthesis). Each task delegates to `skills::lifecycle` for logic, calls `voyager_log::dream_*` at end, threads `DREAMING.load` checkpoints between work units. 3 new integration tests including abort-within-1s. |
| `src-tauri/src/skills/mod.rs` | MODIFY | +2 | `pub mod lifecycle; pub mod pending;` |
| `src-tauri/src/lib.rs` | MODIFY | +0-2 | No new Tauri commands expected for Wave 2. |

**Wave 2 acceptance:** `cargo test --lib skills::lifecycle skills::pending dream_mode::tests` all green; `cargo build` clean.

### Wave 3 — CLI + Chat-Injected Route (2 plans, ~400 LOC)

| File | Action | Est. LOC | Notes |
|------|--------|----------|-------|
| `src-tauri/src/bin/skill_validator.rs` | MODIFY | +200 | Add subcommand dispatcher (validate/list); `run_list(rest)` → text + JSON output; `run_list_diff(id, rest)` → 3-bucket diff. Keep positional `<path>` alias for `validate`. Factor handlers into testable functions. ~5 new test functions in `#[cfg(test)] mod tests`. |
| `src-tauri/src/proactive_engine.rs` | MODIFY | +80 | New `drain_pending_proposals(&app)` helper called at top of detector loop (line ~575); reads `.pending/`, builds `decision_gate::Signal` w/ source `"dream_mode_proposal"`, emits `proactive_action` for any approved proposal. Cooldown: only when `LAST_ACTIVITY` ≥30s old. |
| `src-tauri/src/intent_router.rs` | MODIFY | +50 | New IntentClass variant `ProposalReply { verb: String, id: String }` (or extend ChatOnly args bag). Pattern detector: `\b(yes\|no\|dismiss)\s+([a-f0-9]{4,})\b` regex. ~3 new test cases in existing `mod tests`. |
| `src-tauri/src/commands.rs` | MODIFY | +60 | When intent classifies as ProposalReply: read `.pending/<id>.json`; on `yes`/merge → call `tool_forge::persist_forged_tool(...)` with merged_body; on `yes`/generate → call `skills::export::export_to_user_tier`; on `no`/`dismiss` → mark dismissed in pending. Surface confirmation message in chat. |
| Integration test | CREATE | +60 | `tests/dream_mode_e2e_test.rs` (or inline in dream_mode.rs) — full lifecycle drive: forge 2 fixture tools w/ identical traces → run `dream_trigger_now` → assert .pending/ has 1 merge proposal → simulate intent_router reply "yes <id>" → assert merged tool exists in forged_tools + sources archived. |

**Wave 3 acceptance:** Full `cargo test --lib` green; `cargo build --bin skill_validator` produces working binary; `verify:skill-format` chain (Phase 21) untouched (still passes); manual smoke (per CLAUDE.md Verification Protocol — note this is substrate, runtime UAT for chat-injected prompts is operator-deferred per chat-first pivot anchor).

### Wave-by-Wave Plan Count Estimate

- **Wave 1:** 3 plans (24-01 last_used + migration; 24-02 voyager_log helpers + record_tool_use wiring; 24-03 session_handoff snapshot + skills::loader::list_skills_snapshot)
- **Wave 2:** 2 plans (24-04 skills::lifecycle + skills::pending; 24-05 dream_mode 3 tasks + integration abort test)
- **Wave 3:** 2 plans (24-06 skill_validator subcommands; 24-07 proactive_engine drain + intent_router + commands.rs apply path + e2e test)

**Total: 7 plans across 3 waves.** No wave exceeds 3 plans. No phase split recommended — Phase 24 is cohesive substrate work.

## State of the Art

Phase 24 is repo-internal substrate; no external "state of the art" tracking required. The
domain references are research substrate from `voyager-loop-play.md` §"sleep-cycle
consolidation" + `synthesis-blade-architecture.md` §Layer 4 ("forgetting mechanism in
dream_mode") which are operator-curated and cited per CONTEXT.md.

Cited references (NOT fetched live, per scope):

- Wang et al, "Voyager: An Open-Ended Embodied Agent with LLM," NeurIPS 2023 — origin of the skill-library-grows-from-experience framing
- Karpathy, "cognitive core" thesis (referenced in research substrate, hand-summarized)
- agentskills.io — SKILL.md format authority (Phase 21 substrate)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | sha2 crate is NOT a current dependency; trace_hash recommendation falls back to `DefaultHasher` u64 | §"forged_tools_invocations / Write Site" | Low — DefaultHasher is in std; if sha2 IS already pulled in, recommendation flips to sha2 with no other change [ASSUMED — verify with `grep '^sha2' src-tauri/Cargo.toml`] |
| A2 | `commands.rs:1857+` dispatch loop currently doesn't distinguish forged from native/MCP — no `record_tool_use` or `voyager_log::skill_used` fires from chat | §"Pitfall 2" | Medium — if a hidden write site exists, the wiring change in Wave 1 becomes a reorder rather than an addition. Verified by grep: `record_tool_use` only declared at tool_forge.rs:694 and called by zero internal sites [VERIFIED: grep across src-tauri/src/] |
| A3 | `~/.blade/sessions/<id>.json` directory does NOT exist today; `session_handoff.json` (singular) is the only write site | §"CLI Subcommand Surface / session_handoff field" | Low — verified by `grep "sessions/" session_handoff.rs` → no matches [VERIFIED] |
| A4 | DefaultHasher u64 collision risk over expected n=100 invocations per tool is negligible; trace identity stability is sufficient (we don't need cryptographic uniqueness) | §"forged_tools_invocations" | Low — birthday paradox at 100 unique traces is effectively zero [ASSUMED] |
| A5 | SQLite WAL mode is enabled on blade.db (default for project) — multi-reader + single-writer concurrency is available so dream pass + chat forge don't deadlock | §"Pitfall 4" | Medium — if WAL is OFF, dream pass must hold a single connection and block forge_tool. Recommend Wave 1 task verifies `PRAGMA journal_mode` returns `wal` [ASSUMED — needs verification] |
| A6 | `intent_router.rs` ChatOnly + ArgsBag substrate can absorb a new ProposalReply variant without major refactor | §"Files to Create / Modify Wave 3" | Medium — intent_router is a discrete classifier; adding a class is a known pattern (Plan 18-14 added args bag) but requires reading ChatOnly fall-through carefully [ASSUMED] |

## Open Questions

> All Discretion items are closed in §"Open Questions Closed." Below are
> questions that are NOT planner-blocking but worth flagging:

1. **dream-mode trigger frequency in dev environments** — 1200s idle is
   the prod default, but dev test runs need `dream_trigger_now()` to
   exercise the path. Is operator OK with the test path bypassing idle
   gating? **Recommendation:** YES — `dream_trigger_now` is the existing
   Phase 19 test entrypoint at line 516, designed for this. No blocker.

2. **forged_tools name-sanitization edge case** — if a forged_tool's
   `name` doesn't sanitize to agentskills.io-compliant form,
   `skills::export::export_to_user_tier` returns `NonCompliantName` and
   no SKILL.md is written. Prune logic must handle: row in DB but no
   filesystem dir to archive. **Recommendation:** Already handled in
   §"Prune Pass Mechanics / Per-Row Action" step 3 — log + continue.

3. **Operator response timing for chat-injected prompts** — what if
   operator never responds? Auto-dismiss at 7 days handles staleness, but
   the visible chat message persists in conversation history. Is this OK
   for the v1.3 surface? **Recommendation:** YES — operator can scroll
   past; dismissal at 7 days takes effect at the system-state level
   (operator opinion locked in `.pending/`); chat history is observational.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| rusqlite | All SQLite work | ✓ | (project pinned, line `rusqlite = ` in Cargo.toml) | — |
| fastembed | DREAM-02 embeddings | ✓ | (project pinned) | — |
| serde / serde_json | .pending/ JSON | ✓ | (project pinned) | — |
| chrono | Timestamps | ✓ | (project pinned) | — |
| uuid | Proposal IDs | ✓ | (project pinned) | — |
| tauri::Emitter | ActivityStrip emit | ✓ | (project pinned) | — |
| sha2 | trace_hash (preferred) | UNCONFIRMED | — | std `DefaultHasher` (always available) |
| Cargo build env | Compile | ✓ | (existing CLAUDE.md notes WSL libspa-sys edge — out of scope) | — |
| `cargo build --bin skill_validator` | DREAM-04 binary | ✓ | (Phase 21-04 substrate) | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** sha2 (use `DefaultHasher`).

## Sources

### Primary (HIGH confidence — read first-hand from repo this session)

- `/home/arnav/blade/.planning/phases/24-skill-consolidation-dream-mode/24-CONTEXT.md` — 7 locked decisions (D-24-A..G), discretion items, code_context, specifics
- `/home/arnav/blade/.planning/STATE.md` — milestone v1.3 state; M-08..M-12 + chat-first pivot anchor
- `/home/arnav/blade/.planning/ROADMAP.md` line 125-141 — Phase 24 success criteria
- `/home/arnav/blade/.planning/REQUIREMENTS.md` line 58-67 — DREAM-01..06 falsifiable
- `/home/arnav/blade/src-tauri/src/dream_mode.rs` — 7 existing tasks + run_task! macro + 1200s threshold + line 472 interrupt + line 492 atomic clear
- `/home/arnav/blade/src-tauri/src/tool_forge.rs` — schema (line 130-150); register_forged_tool / persist_forged_tool (line 442-527); record_tool_use (line 694-708) — confirmed zero callers; INSERT site (line 464-480)
- `/home/arnav/blade/src-tauri/src/embeddings.rs` — embed_texts (line 23) + cosine_similarity (line 33) public API
- `/home/arnav/blade/src-tauri/src/voyager_log.rs` — 4-emit-helper pattern; integration_bridge::get_app_handle (line 40)
- `/home/arnav/blade/src-tauri/src/skills/export.rs` — export_to_user_tier + sanitize_name (line 39, 70)
- `/home/arnav/blade/src-tauri/src/skills/loader.rs` — user_root / bundled_root / scan_tier (lines 21, 101, 108, 119)
- `/home/arnav/blade/src-tauri/src/skill_engine.rs` — maybe_synthesize_skills + brain_skills coexistence (independent of forged_tools)
- `/home/arnav/blade/src-tauri/src/proactive_engine.rs` — decision_gate routing (line 584-617, 633-653, 911-935)
- `/home/arnav/blade/src-tauri/src/decision_gate.rs` — Signal + DecisionOutcome + evaluate_and_record API (lines 33-58, 356)
- `/home/arnav/blade/src-tauri/src/session_handoff.rs` — SessionHandoff struct (line 21); single-file write site at handoff_path() line 28-30
- `/home/arnav/blade/src-tauri/src/intent_router.rs` — classify_intent + IntentClass + ArgsBag pattern (line 45)
- `/home/arnav/blade/src-tauri/src/bin/skill_validator.rs` — current 56-line shim w/ flag-only parsing
- `/home/arnav/blade/src-tauri/src/reward.rs` line 248-286 — TurnAccumulator shape; line 1095+ test isolation pattern
- `/home/arnav/blade/src-tauri/src/db.rs` line 167-450 — CREATE TABLE batch site for new sibling tables; activity_timeline (line 390); messages (line 182)
- `/home/arnav/blade/src-tauri/src/config.rs` line 654-672 — `BLADE_CONFIG_DIR` test override
- `/home/arnav/blade/CLAUDE.md` — 6-place rule (not triggered this phase); cargo check batching; safe_slice; Verification Protocol substrate-vs-runtime distinction
- `/home/arnav/blade/.planning/config.json` — `nyquist_validation: true` (Validation Architecture section required)

### Cited (referenced; NOT fetched live per scope rule)

- Wang et al, "Voyager," NeurIPS 2023 — Voyager loop substrate motivation
- Karpathy "cognitive core" thesis — dream-mode framing
- agentskills.io — SKILL.md format
- `/home/arnav/research/blade/voyager-loop-play.md` §"sleep-cycle consolidation"
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` §Layer 4
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — operator-blessed UI-only-phase UAT deferral

### Tertiary (LOW confidence — none required)

Phase 24 is fully repo-internal; no LOW confidence claims surfaced.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every primitive read first-hand from repo source
- Architecture: HIGH — substrate locked by D-24-A..G + read from existing dream_mode.rs / tool_forge.rs
- Pitfalls: HIGH — Pitfalls 1-5 are concrete code-site issues verified by reading the relevant lines; Pitfalls 6-9 are domain-pattern risks confirmed against existing repo idioms (LAST_ACTIVITY clock pattern, BLADE_CONFIG_DIR test isolation pattern)
- Validation strategy: HIGH — reuses existing `cargo test --lib --test-threads=1` + `BLADE_CONFIG_DIR` pattern proven in reward.rs / doctor.rs

**Research date:** 2026-05-01
**Valid until:** 2026-05-15 (substrate is repo-internal; only invalidated by code reorgs to dream_mode.rs / tool_forge.rs / proactive_engine.rs)
