---
phase: 21
type: patterns
status: complete
written: 2026-05-01T03:35Z
---

# Phase 21 — PATTERNS

Existing BLADE conventions Phase 21 must follow. Each pattern has a verbatim citation from production code so the executor can copy the shape without re-deriving.

## Module registration (CLAUDE.md §Critical Architecture Rules)

For every new module:
1. Add `mod skills;` to `src-tauri/src/lib.rs` (top-level mod list, no #[cfg(test)] guard for production code)
2. Skills are NOT Tauri commands themselves; the loader is invoked at startup from `lib.rs::run()` (the Tauri builder setup)
3. NO entries in `tauri::generate_handler![]` — Phase 21 doesn't expose IPC (Phase 22's Voyager loop will via `evolution.rs` wrappers)

Citation: `evals/mod.rs` is the closest analog (no IPC; module-level loader). But evals is `#[cfg(test)]` only; skills is production. So for production-mod no-IPC, `tool_forge.rs` is the closer analog — top-level `mod tool_forge;` + module-level public functions called by other modules.

## Error handling

Project convention from `commands.rs`, `evolution.rs`, `tool_forge.rs`:

```rust
pub fn parse_skill(text: &str) -> Result<(SkillFrontmatter, SkillBody), String> {
    let split = split_frontmatter(text)
        .ok_or_else(|| format!("[skills::parser] no frontmatter delimiter found"))?;
    // ...
}
```

- Return type: `Result<T, String>` for module-public surface (consistent with Tauri command convention; even though we're not a Tauri command, callers expect this shape)
- Error strings: prefix with `[skills::<submod>]` so log lines + tracebacks self-locate (matches the `[slack_outbound]` / `[github_outbound]` D-10 pattern from Phase 18)
- Use `?` operator for propagation; wrap with `.map_err(|e| format!(...))` at module boundaries

## SQLite (consent extension)

Citation: `consent.rs` Phase 18-06.

Pattern: never inline double-quotes inside `execute_batch!` macro SQL strings (CLAUDE.md). Use `params![]` with positional `?` placeholders.

```rust
fn record_skill_consent(
    db_path: &Path,
    skill_name: &str,
    script_basename: &str,
    decision: &str,
) -> Result<(), String> {
    let conn = open_db_at(db_path).map_err(|e| format!("[skills::consent] open: {e}"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let target = format!("{skill_name}:{script_basename}");
    conn.execute(
        "INSERT OR REPLACE INTO consent_decisions (intent_class, target_service, decision, decided_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params!["skill_script", target, decision, now],
    )
    .map_err(|e| format!("[skills::consent] insert: {e}"))?;
    Ok(())
}
```

Reuses v1.2's `consent::open_db_at` (testability seam). No schema migration.

## Path types

Project convention from `config.rs`, `tool_forge.rs`:

```rust
use std::path::{Path, PathBuf};
```

`Path` for borrowed (function args), `PathBuf` for owned (returned, stored). Use `.join()` for composition. Never string-concat path segments.

## Filesystem reads (lazy load)

Project convention: `std::fs::read_to_string(path)` for body content. Wrap errors with `[skills::loader] read <path>: {e}`.

For the byte counter (progressive disclosure assertion):

```rust
use std::sync::atomic::{AtomicU64, Ordering};

static BODY_BYTES_LOADED: AtomicU64 = AtomicU64::new(0);

pub fn body_bytes_loaded() -> u64 {
    BODY_BYTES_LOADED.load(Ordering::Relaxed)
}

pub fn reset_body_bytes_loaded() {
    BODY_BYTES_LOADED.store(0, Ordering::Relaxed);
}

// Inside Activate::load_body
let body = std::fs::read_to_string(&body_path)
    .map_err(|e| format!("[skills::activate] read {body_path:?}: {e}"))?;
BODY_BYTES_LOADED.fetch_add(body.len() as u64, Ordering::Relaxed);
```

`Ordering::Relaxed` is fine — no cross-thread synchronization required for this counter (it's an assertion-only metric; not load-bearing for correctness).

## ASCII-safe string handling

CLAUDE.md hard rule: NEVER `&text[..n]` on user content. ALWAYS `crate::safe_slice(text, max_chars)`.

Phase 21 doesn't process user content directly (skill files are author-trusted local content), but error messages may include skill content; use safe_slice when truncating skill bodies for error messages.

## No `#[tauri::command]` collisions

CLAUDE.md hard rule. Phase 21 adds zero Tauri commands, so this can't trip. Phase 22 will add `voyager_loop_*` commands; that's their problem.

## Atomic commit discipline

Per CLAUDE.md `## What NOT to Do` + project commit history:
- One plan = one logical commit (or 2-3 if the plan splits into clear sub-changes)
- No `--amend` after pushing
- No Co-Authored-By line (Arnav is the author)
- No `--no-verify`

Commit message format from v1.2:

```
feat(21-NN): <one-line summary>

<body — what changed and why; cite REQ-IDs satisfied>
```

For plan SUMMARY commits (after the code lands):

```
docs(21-NN): plan summary

<body — what shipped, deviations, evidence>
```

## Test placement

Per `evals/` convention: `#[cfg(test)] mod tests` at the bottom of each .rs file for unit tests. No separate test files for Phase 21's scope.

Citation from `consent.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_string_present() { /* ... */ }
}
```

## Cargo.toml dep addition

Project style:

```toml
serde_yaml = "0.9"
```

Place in alphabetical order in the `[dependencies]` section (rough — project doesn't strictly enforce alpha; place after `serde_json = "1"`).

## What NOT to do (project anti-patterns)

From CLAUDE.md `## What NOT to Do` and learned from v1.1/v1.2 retraction lessons:

- Don't run `cargo check` after every small edit — batch first, check at end of each plan
- Don't use `grep` / `cat` / `find` in bash within executor work — use Read/Grep/Glob tools (this rule applies to executor agents; for direct shell ops it's fine)
- Don't claim a phase done on static gates alone — substrate work has runtime tests, but Phase 21 is parser-shaped (deterministic) so static gates are sufficient if the unit tests cover the contract
- Don't add ghost CSS tokens — Phase 21 doesn't touch CSS
- Don't use `&text[..n]` — use `safe_slice`
- Don't add a `#[tauri::command]` with a name colliding another module
- Don't import `tauri::Emitter` or `tauri::Manager` unless needed (Phase 21 doesn't emit events)

---

*Phase 21 PATTERNS complete. Wave 1 code begins next.*
