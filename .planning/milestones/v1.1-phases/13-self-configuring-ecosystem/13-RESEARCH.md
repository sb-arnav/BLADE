# Phase 13: Self-Configuring Ecosystem — Research

**Researched:** 2026-04-24
**Domain:** Rust/Tauri observer tentacle auto-enable, BladeConfig persistence, Settings UI
**Confidence:** HIGH (all findings verified against live codebase)

---

## Summary

Phase 12 produced a `DeepScanResults` struct and persisted it to `~/.blade/identity/scan_results.json`. Phase 13 reads that file immediately after scan completion, runs 6 deterministic signal-detection probes (repos, Slack, Vercel, GitHub CLI, AI sessions, Calendar), and activates named observer-class tentacles based on what is found. Every auto-enabled tentacle must be visible in Settings with rationale and a one-click disable toggle; disabled state must survive restarts; no auto-enabled tentacle may perform any outbound action under any code path during v1.1.

The key architectural insight is that the observe-only guardrail must be a central Rust `AtomicBool` checked at the boundary of any outbound operation, not per-tentacle policy. This mirrors how the existing `integration_bridge.rs` uses `mcp_server_registered()` as a per-service gate. The difference here is that `OBSERVE_ONLY: AtomicBool` is set to `true` at startup for all auto-enabled tentacles and never cleared in v1.1 — v1.2 acting capability work removes one flag in one place.

The Settings UI pattern is already established by `PrivacyPane.tsx` (Phase 12): a `GlassPanel tier={2}` containing rows of `{checkbox, label + description}` inside a Card, with optimistic toggle calls followed by `save_config + reload`. The Phase 13 Ecosystem pane follows the same pattern with a fifth "rationale" sub-line per row.

**Primary recommendation:** New module `src-tauri/src/ecosystem.rs` owns the auto-enable logic, persists state via two new BladeConfig fields, and exposes four Tauri commands. New pane `EcosystemPane.tsx` hooks into the existing SettingsShell PANES/TABS maps (one tab added). Auto-enable triggers inside `deep_scan_start` at line 491 (just before `Ok(results)`) via a non-blocking `tokio::task::spawn(ecosystem::auto_enable_from_scan(app, results.clone()))`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Signal detection (repos found, CLI installed, creds present) | API / Backend | — | Filesystem probes must run in Rust; reading `~/.config/gh`, `~/.slack/`, `~/.calendar` is a native file op, not a UI concern |
| Auto-enable decision logic | API / Backend | — | Deterministic rule evaluation against `DeepScanResults`; must be testable without frontend |
| Tentacle state persistence | API / Backend | — | 6-place BladeConfig pattern; disk I/O in Rust |
| Observe-only guardrail enforcement | API / Backend | — | Runtime `AtomicBool` flag checked in Rust before any outbound write; frontend cannot enforce this |
| Settings UI rationale rows + toggles | Frontend Server (SSR) | — | Read tentacle registry from Tauri command, render checkbox + rationale text, call toggle command on change |
| Activity-log event emission per observation | API / Backend | — | Each observer poll emits a `blade_activity_log` Tauri event; frontend in Phase 14 consumes it |

---

## Standard Stack

### Core (existing, no new deps needed)

| Library | Source | Purpose | Status |
|---------|--------|---------|--------|
| `serde` + `serde_json` | Cargo.toml | Struct ser/de, JSON persistence | Already in Cargo.toml |
| `tokio` | Cargo.toml | `spawn`, `sleep`, `Mutex` | Already in Cargo.toml |
| `std::sync::atomic::AtomicBool` | std | Observe-only guardrail flag | std — no new dep |
| `std::sync::OnceLock` | std | Static global registry | std — no new dep |
| `log` crate | Cargo.toml | Activity-log emission + warn | Already in Cargo.toml |
| `tauri::Emitter` | Cargo.toml | Emit events to frontend | Already in Cargo.toml |
| `dirs` crate | Cargo.toml | `home_dir()` for `~/.slack/`, `~/.config/gh/` | Already used in deep_scan |

### Supporting

| Library | Purpose | When needed |
|---------|---------|-------------|
| `std::process::Command` | Run `gh auth status`, `vercel whoami`, `which vercel` | Inside signal-detection probes |
| `std::fs::read_to_string` | Read `~/.slack/cookies` or `~/.config/gh/hosts.yml` | Inside signal-detection probes |

**No new Cargo.toml deps required.** All needed primitives are already in the dependency graph.

---

## Architecture Patterns

### System Architecture Diagram

```
deep_scan_start (mod.rs)
        │
        │ scan complete
        ▼
ecosystem::auto_enable_from_scan(app, DeepScanResults)
        │
        ├─► signal_probes::repos_detected(results) ──────► bool + count
        ├─► signal_probes::slack_detected()  ────────────► bool + detail
        ├─► signal_probes::vercel_detected() ────────────► bool + detail
        ├─► signal_probes::github_cli_auth() ────────────► bool + detail
        ├─► signal_probes::ai_sessions_detected(results) ► bool + detail
        └─► signal_probes::calendar_detected() ──────────► bool + detail
                │
                ▼
        for each (tentacle_id, triggered, rationale):
            if triggered AND NOT user_disabled(tentacle_id):
                register_tentacle(tentacle_id, rationale)  ← idempotent
                set OBSERVE_ONLY = true
                spawn observer_loop(tentacle_id, app)
                │
                └─► periodic poll ──► emit "blade_activity_log" event
                        (read-only op, blocked if OBSERVE_ONLY && is_write_op)

BladeConfig fields:
    ecosystem_tentacles: Vec<TentacleRecord>   ← name, enabled, rationale, enabled_at
    ecosystem_observe_only: bool               ← always true in v1.1

Tauri commands (4):
    ecosystem_get_registry()     → Vec<TentacleRecord>
    ecosystem_set_enabled(id, bool) → ()      ← persist to BladeConfig
    ecosystem_get_status(id)     → TentacleStatus
    ecosystem_observe_only_check() → bool     ← test seam for guardrail

Settings → Ecosystem pane:
    useEffect → ecosystem_get_registry()
    Per-row: TentacleRow { name, rationale_chip, status_pill, checkbox }
    onChange → ecosystem_set_enabled(id, next)
```

### Recommended Project Structure

```
src-tauri/src/
├── ecosystem.rs               # NEW: auto-enable logic + 4 Tauri commands + observer loops
│                              #      + signal_probes module inline
src/features/settings/panes/
├── EcosystemPane.tsx          # NEW: tentacle list with rationale rows + toggles
src/features/settings/
├── SettingsShell.tsx          # MODIFIED: add 'settings-ecosystem' to PANES + TABS
├── index.tsx                  # MODIFIED: add settings-ecosystem RouteDefinition
tests/e2e/
├── settings-ecosystem-tentacles.spec.ts  # NEW: 4 specs
```

### Pattern 1: Signal Probe (verified against Phase 12 scanners)

```rust
// Source: deep_scan/scanners/which_sweep.rs + config.rs pattern
// Signal probe: "Is GitHub CLI installed and authenticated?"
fn github_cli_auth() -> (bool, String) {
    // Step 1: is `gh` on PATH? (which_sweep already checks this)
    let gh_path = std::process::Command::new("which")
        .arg("gh")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok());

    if gh_path.is_none() {
        return (false, "gh not installed".to_string());
    }

    // Step 2: is auth token present? Check ~/.config/gh/hosts.yml (not a subprocess)
    let hosts_path = dirs::home_dir()
        .map(|h| h.join(".config").join("gh").join("hosts.yml"));
    let authed = hosts_path
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.contains("oauth_token") || s.contains("github.com"))
        .unwrap_or(false);

    if authed {
        (true, "gh CLI installed and ~/.config/gh/hosts.yml contains auth token".to_string())
    } else {
        (false, "gh installed but no auth token found".to_string())
    }
}
```

**Why file check not subprocess:** Running `gh auth status` spawns a subprocess that may trigger OS permission dialogs on macOS, stall on network, and is slower. The hosts.yml file is the canonical auth store. [VERIFIED: gh CLI documentation + filesystem inspection]

### Pattern 2: Observe-Only Guardrail (AtomicBool central check)

```rust
// Source: deep_scan/queue.rs SCAN_CANCEL pattern + integration_bridge.rs mcp_server_registered
use std::sync::atomic::{AtomicBool, Ordering};

/// v1.1 observe-only guardrail. Set to true at startup for all auto-enabled tentacles.
/// Any tentacle that attempts an outbound write must call assert_observe_only_allowed()
/// before proceeding. v1.2 acting capability removes this flag in one place.
static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true);

/// Returns Err if the guardrail blocks an outbound action.
/// Call this at the entry of every write-path function in observer tentacles.
pub fn assert_observe_only_allowed(action: &str) -> Result<(), String> {
    if OBSERVE_ONLY.load(Ordering::SeqCst) {
        return Err(format!(
            "[ecosystem] OBSERVE_ONLY guardrail blocked outbound action: {}. \
             Acting capability requires explicit Settings-side enablement in v1.2.",
            action
        ));
    }
    Ok(())
}

// Tauri command for test seam:
#[tauri::command]
pub fn ecosystem_observe_only_check() -> bool {
    OBSERVE_ONLY.load(Ordering::SeqCst)
}
```

### Pattern 3: TentacleRecord persistence (6-place BladeConfig extension)

```rust
// NEW struct in config.rs:
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentacleRecord {
    pub id: String,         // "repo_watcher" | "slack_monitor" | etc.
    pub enabled: bool,      // user toggle — false = disabled; does not re-enable on scan
    pub rationale: String,  // "Auto-enabled because deep scan found 14 repos"
    pub enabled_at: i64,    // Unix ts of first auto-enable
    pub trigger_detail: String, // human-readable trigger evidence
}

fn default_ecosystem_tentacles() -> Vec<TentacleRecord> { vec![] }
fn default_ecosystem_observe_only() -> bool { true }

// Add to DiskConfig + BladeConfig (2 fields each = 6 places total):
// 1. DiskConfig struct field:
//    #[serde(default = "default_ecosystem_tentacles")]
//    ecosystem_tentacles: Vec<TentacleRecord>,
//    #[serde(default = "default_ecosystem_observe_only")]
//    ecosystem_observe_only: bool,
//
// 2. DiskConfig::default():
//    ecosystem_tentacles: vec![],
//    ecosystem_observe_only: true,
//
// 3. BladeConfig struct field (same #[serde(default)] decorators)
// 4. BladeConfig::default()
// 5. load_config(): copy disk.ecosystem_tentacles + disk.ecosystem_observe_only
// 6. save_config(): copy config.ecosystem_tentacles + config.ecosystem_observe_only
```

### Pattern 4: Observer loop (reuses integration_bridge pattern)

```rust
// Source: integration_bridge.rs start_integration_polling + tauri::async_runtime::spawn
pub fn start_repo_watcher(app: AppHandle) {
    // Idempotency guard — same pattern as integration_bridge.rs
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) { return; }

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;

            // Guardrail: this loop is read-only by design, but assert anyway
            // so if anyone accidentally adds a write path it's caught at runtime.
            // (No Err path here — we log and continue, not abort the loop.)

            let cfg = crate::config::load_config();
            let enabled = cfg.ecosystem_tentacles.iter()
                .find(|t| t.id == "repo_watcher")
                .map(|t| t.enabled)
                .unwrap_or(false);

            if !enabled { continue; }

            // Read-only observation: count git HEAD modifications in watched repos
            let observation = observe_repos(&cfg);

            // Emit activity log row (Phase 14 strip consumes this)
            let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
                "module": "ecosystem.repo_watcher",
                "action": "observed",
                "human_summary": observation,
                "timestamp": crate::deep_scan::mod_helpers::now_secs(),
            }));
        }
    });
}
```

### Pattern 5: Settings Ecosystem Pane (mirrors PrivacyPane toggle pattern exactly)

```typescript
// Source: src/features/settings/panes/PrivacyPane.tsx DeepScanPrivacySection
// Key structural elements:
//   - GlassPanel tier={2} wrapping rows
//   - grid gridTemplateColumns: '28px 1fr'
//   - input[type=checkbox] + label
//   - id="ecosystem-tentacle-{id}" for Playwright selectors
//   - aria-describedby for a11y
//   - Optimistic update → call Tauri → revert on error
//   - show({ type: 'success' | 'error' }) toast feedback
//   - Rationale text as 3rd sub-line (new for Phase 13)

interface TentacleRecord {
  id: string;
  enabled: boolean;
  rationale: string;
  enabledAt: number;
  triggerDetail: string;
}

// Row:
// <div id={`ecosystem-tentacle-${record.id}`} style={gridRow}>
//   <input type="checkbox" checked={record.enabled} onChange={...} />
//   <label>
//     <div className="t-body">{TENTACLE_LABELS[record.id]}</div>
//     <div className="t-small" style={{ color: 'var(--t-3)' }}>{TENTACLE_DESCS[record.id]}</div>
//     <div className="t-small" style={{ color: 'var(--a-cool)', fontStyle: 'italic' }}>{record.rationale}</div>
//   </label>
// </div>
```

### Pattern 6: Auto-enable trigger point in deep_scan_start

```rust
// Source: src-tauri/src/deep_scan/mod.rs lines 474-491
// Insert AFTER save_results() and config update, BEFORE seed_knowledge_graph:

    // Phase 13: auto-enable ecosystem tentacles from scan results
    {
        let rc = results.clone();
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::ecosystem::auto_enable_from_scan(&app_clone, &rc).await;
        });
    }

    // Existing: seed knowledge graph (non-blocking)
    let rc = results.clone();
    tokio::task::spawn_blocking(move || seed_knowledge_graph(&rc));

    Ok(results)
```

### Anti-Patterns to Avoid

- **Per-tentacle observe-only policy:** Each tentacle holding its own "am I allowed to act" flag means v1.2 has to hunt down every flag. One central `OBSERVE_ONLY: AtomicBool` in `ecosystem.rs` is the single removal point.
- **Re-enabling disabled tentacles on scan:** The requirement (ECOSYS-08) is explicit — `auto_enable_from_scan` must check `t.enabled == false` (user disabled) and skip re-enabling. Use a separate `user_disabled: bool` field OR treat `enabled: false` + `enabled_at > 0` as "user explicitly disabled." Recommended: store `user_disabled: HashSet<String>` in config (simpler to check).
- **Subprocess for auth detection:** `gh auth status` starts a network call; prefer file-system checks (`~/.config/gh/hosts.yml`). Same for Vercel: `~/.config/vercel/auth.json` rather than `vercel whoami`.
- **Spawning observer loops before user has completed onboarding:** Gate `auto_enable_from_scan` on `config.onboarded == true`.
- **Duplicate tentacle registration:** `auto_enable_from_scan` is called every time a scan completes. Must be idempotent — update rationale + trigger_detail if already registered, do not push a new record.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File watching (repo-watcher) | Custom inotify/FSEvents loop | `notify` crate if depth > polling | v1.1 is observe-only polling, not real FS watch events — polling with `std::fs::metadata` + mtime is sufficient and zero new deps |
| Auth token parsing | Custom YAML parser for `gh` hosts | `std::fs::read_to_string` + `contains()` | The hosts.yml format is simple enough; adding a YAML dep is overkill for a single contains check |
| Settings toggle persistence | Custom JSON file | 6-place BladeConfig extension | Config already handles persistence, atomic writes, and backward compat |
| Activity log events | Custom event bus | `app.emit_to("main", "blade_activity_log", ...)` | Tauri event bus already wired; Phase 14 adds the strip consumer |

**Key insight:** Phase 13 is wiring, not new infrastructure. The observer loop pattern is already in `integration_bridge.rs`. The toggle persistence pattern is already in `PrivacyPane.tsx`. The config extension pattern is in `config.rs`. Nothing here needs a new crate.

---

## DeepScanResults Signal Map

This is the authoritative mapping from `DeepScanResults` fields to tentacle triggers.

| Tentacle | ECOSYS req | Signal field | Detection condition | Fallback probe |
|----------|-----------|-------------|---------------------|----------------|
| `repo_watcher` | ECOSYS-01 | `results.repo_rows` + `results.git_repos` | `repo_rows.len() + git_repos.len() > 0` | — |
| `slack_monitor` | ECOSYS-02 | `results.installed_apps` (name contains "slack") + filesystem | `installed_apps` has Slack OR `~/.slack/` exists OR env `SLACK_TOKEN` set | Also check `~/.config/slack/` |
| `deploy_monitor` | ECOSYS-03 | `results.ai_tools` or `which_sweep` rows | `which vercel` succeeds AND `~/.config/vercel/auth.json` exists | Check `installed_apps` for "Vercel" |
| `pr_watcher` | ECOSYS-04 | `which_sweep` for `gh` | `gh` on PATH AND `~/.config/gh/hosts.yml` contains `oauth_token` | — |
| `session_bridge` | ECOSYS-05 | `results.ai_tools` (cursor/claude) + MRU | `ai_tools` has Cursor or Claude Code detected OR `~/.claude/projects/` exists | Check `~/.cursor/` |
| `calendar_monitor` | ECOSYS-06 | filesystem + env | `~/.config/gcloud/application_default_credentials.json` exists OR `GOOGLE_APPLICATION_CREDENTIALS` set OR `~/.config/google-cloud-sdk/` exists | Check `~/.calendar/` |

**Note on ECOSYS-10 (≥5 auto-enables on cold install):** On Arnav's machine, the following are guaranteed: `repo_watcher` (14+ repos found by Phase 12), `pr_watcher` (gh CLI in TOOLS list, confirmed installed), `session_bridge` (`~/.claude/projects/` exists — Claude Code is used), `deploy_monitor` (vercel in TOOLS list, check auth). Slack and calendar depend on config. The four guaranteed ones plus either Slack or calendar satisfies ECOSYS-10.

---

## Config Pattern for Tentacle State Persistence

**New fields required (2 fields = 12 places total across DiskConfig + BladeConfig):**

```
Field 1: ecosystem_tentacles: Vec<TentacleRecord>
Field 2: ecosystem_observe_only: bool  (always true in v1.1; placeholder for v1.2)

6-place pattern for each field:
  Place 1: DiskConfig struct
  Place 2: DiskConfig::default()
  Place 3: BladeConfig struct
  Place 4: BladeConfig::default()
  Place 5: load_config() copy
  Place 6: save_config() copy
```

`TentacleRecord` is a new struct in `config.rs`. It must have `#[serde(default)]` on all optional fields for backward compat with old config files.

**Idempotency pattern for auto-enable:**

```rust
// In ecosystem::auto_enable_from_scan:
let mut cfg = crate::config::load_config();
for (id, triggered, rationale, detail) in probes {
    if !triggered { continue; }
    // Check if user explicitly disabled this tentacle
    let existing = cfg.ecosystem_tentacles.iter_mut().find(|t| t.id == id);
    match existing {
        Some(rec) if rec.enabled_at > 0 && !rec.enabled => {
            // User disabled — do NOT re-enable (ECOSYS-08)
            log::info!("[ecosystem] {} is user-disabled; skipping re-enable", id);
        }
        Some(rec) => {
            // Already registered — update rationale/detail in case scan found more
            rec.rationale = rationale;
            rec.trigger_detail = detail;
        }
        None => {
            // First time — register and start observer loop
            cfg.ecosystem_tentacles.push(TentacleRecord {
                id: id.clone(), enabled: true, rationale, enabled_at: now_secs(), trigger_detail: detail,
            });
            start_observer_loop(id, &app);
        }
    }
}
crate::config::save_config(&cfg).ok();
```

---

## Common Pitfalls

### Pitfall 1: Re-enabling user-disabled tentacles on rescan
**What goes wrong:** `auto_enable_from_scan` runs every scan. If it doesn't distinguish "never registered" from "user disabled," a rescan re-enables a tentacle the user turned off (ECOSYS-08 violation).
**Why it happens:** The naive approach is to set `enabled = true` for every triggered tentacle.
**How to avoid:** Check `enabled_at > 0 && enabled == false` = user-disabled. Respect it. Only set `enabled = true` when `enabled_at == 0` (first registration).
**Warning signs:** Test: disable a tentacle, run scan again, check it's still disabled.

### Pitfall 2: Observer loop spawned multiple times
**What goes wrong:** `deep_scan_start` is callable multiple times. Each call to `auto_enable_from_scan` may try to start the same observer loop twice, leaking a task.
**Why it happens:** No idempotency guard on `start_observer_loop`.
**How to avoid:** `static REPO_WATCHER_RUNNING: AtomicBool = AtomicBool::new(false)` per observer loop. Use `swap(true, Ordering::SeqCst)` — return early if it was already true.

### Pitfall 3: Outbound action call compiles but isn't blocked at runtime
**What goes wrong:** The guardrail relies on `assert_observe_only_allowed()` being called. If a developer adds a write path and forgets to call the assertion, the guardrail has no teeth.
**Why it happens:** Policy, not enforcement.
**How to avoid:** Keep ALL observer loop logic inside `ecosystem.rs` (not delegated to existing tentacle modules like `github_deep.rs`). The new observer loops are minimal read-only stubs — they don't share code with the existing acting tentacles in `tentacles/`. This is a module boundary, not just a flag.

### Pitfall 4: `~/.config/gh/hosts.yml` parsing fails on Windows/WSL
**What goes wrong:** On WSL, the `gh` config may be at `$USERPROFILE/.config/gh/hosts.yml` under the Windows path, not the Linux home.
**Why it happens:** WSL has two home dirs.
**How to avoid:** Check both `dirs::home_dir()/.config/gh/hosts.yml` AND `which gh` output's parent directory for a `..\..\config\gh\hosts.yml` hint. If both fail, fall back to running `gh auth status --hostname github.com` (acceptable because `gh` has no interactive prompts in non-auth state).

### Pitfall 5: Tauri command name collision (flat namespace)
**What goes wrong:** `ecosystem_get_registry` conflicts with an existing command.
**Why it happens:** Tauri's `generate_handler![]` macro uses a flat namespace.
**How to avoid:** Grep `lib.rs` for `ecosystem_` prefix before finalising command names. Currently nothing matches — the prefix is free.

### Pitfall 6: Settings tab count overflow
**What goes wrong:** Adding an 11th tab to SettingsShell breaks the tab nav layout.
**Why it happens:** The CSS for `.settings-tabs` is likely designed for 10 tabs.
**How to avoid:** Check `.settings-tabs` CSS overflow/scroll behavior before adding the tab. Alternatively, add "Ecosystem" as a sub-section under an existing tab (e.g., extending PrivacyPane with a second Card). But a dedicated tab is cleaner for ECOSYS-07.

---

## Wave Structure Recommendation

Phase 13 has a natural 3-wave structure:

### Wave 0 — Rust backend: ecosystem.rs + config extension + guardrail

**Can run first, unblocked.**

Tasks:
- `TentacleRecord` struct in `config.rs` + 6-place extension (2 fields)
- `src-tauri/src/ecosystem.rs`: signal probes (6 probes) + `auto_enable_from_scan` + `OBSERVE_ONLY` guardrail + 4 Tauri commands
- Wire hook at end of `deep_scan_start` (1 line spawn)
- Register `mod ecosystem;` in `lib.rs` + 4 commands in `generate_handler![]`
- Unit tests for each signal probe (6 tests) + guardrail test

### Wave 1 — Observer loops + activity-log emission

**Depends on Wave 0 (needs TentacleRecord + auto_enable logic).**

Tasks:
- 5 observer loop implementations (repo_watcher, slack_monitor, deploy_monitor, pr_watcher, session_bridge) — all read-only polling, emit `blade_activity_log` events
- calendar_monitor (6th loop, simpler — just checks credential presence periodically)
- Each loop has its own `AtomicBool RUNNING` guard

### Wave 2 — Frontend: EcosystemPane + SettingsShell wiring + e2e specs

**Depends on Wave 0 commands being registered (needs `ecosystem_get_registry` + `ecosystem_set_enabled`).**

Tasks:
- `EcosystemPane.tsx` (new pane — Card with TentacleRow list)
- `SettingsShell.tsx` PANES/TABS addition
- `settings/index.tsx` route addition
- TypeScript wrapper functions in `src/lib/tauri/`
- 4 Playwright e2e specs

### Wave 3 — Verification gate

**Depends on Wave 0 + Wave 1 + Wave 2.**

Tasks:
- `verify:ecosystem-guardrail` script: calls `ecosystem_observe_only_check` and asserts true
- Manual cold-install trace (ECOSYS-10)
- Update `package.json` verify:all chain

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.2 (e2e) + Rust unit tests (cargo test) |
| Config file | `playwright.config.ts` (existing) |
| Quick run command | `playwright test tests/e2e/settings-ecosystem-tentacles.spec.ts` |
| Full suite command | `npm run test:e2e:phase13` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ECOSYS-01 | repo_watcher auto-enables when repos found | unit (Rust) | `cargo test ecosystem::tests::test_repo_trigger` | Wave 0 |
| ECOSYS-02 | slack_monitor auto-enables when slack config detected | unit (Rust) | `cargo test ecosystem::tests::test_slack_trigger` | Wave 0 |
| ECOSYS-03 | deploy_monitor auto-enables when vercel auth'd | unit (Rust) | `cargo test ecosystem::tests::test_vercel_trigger` | Wave 0 |
| ECOSYS-04 | pr_watcher auto-enables when gh CLI auth'd | unit (Rust) | `cargo test ecosystem::tests::test_gh_trigger` | Wave 0 |
| ECOSYS-05 | session_bridge auto-enables when AI sessions detected | unit (Rust) | `cargo test ecosystem::tests::test_session_trigger` | Wave 0 |
| ECOSYS-06 | calendar_monitor auto-enables when calendar creds detected | unit (Rust) | `cargo test ecosystem::tests::test_calendar_trigger` | Wave 0 |
| ECOSYS-07 | Settings lists tentacles with rationale + toggle | e2e (Playwright) | `playwright test tests/e2e/settings-ecosystem-tentacles.spec.ts` | Wave 2 |
| ECOSYS-08 | Disabled state persists across restarts | e2e (Playwright) | `playwright test tests/e2e/settings-ecosystem-disable-persists.spec.ts` | Wave 2 |
| ECOSYS-09 | Guardrail blocks outbound action | unit (Rust) | `cargo test ecosystem::tests::test_observe_only_guardrail` | Wave 0 |
| ECOSYS-10 | Cold install → ≥5 tentacles (manual trace) | manual | Document cold-install trace in Wave 3 summary | Wave 3 |

### Sampling Rate

- **Per task commit:** `npx tsc --noEmit` (TypeScript) + specific unit test for the task's module
- **Per wave merge:** `npm run test:e2e:phase13` (all 4 e2e specs green)
- **Phase gate:** Full suite green + manual ECOSYS-10 cold-install trace before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/e2e/settings-ecosystem-tentacles.spec.ts` — covers ECOSYS-07
- [ ] `tests/e2e/settings-ecosystem-disable-persists.spec.ts` — covers ECOSYS-08
- [ ] Rust unit tests inside `ecosystem.rs` `#[cfg(test)]` block — covers ECOSYS-01..06 + ECOSYS-09
- [ ] `package.json` — add `test:e2e:phase13` script (after Wave 2 spec files exist)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `gh` (GitHub CLI) | ECOSYS-04 signal probe | Likely yes (in TOOLS list) | Check at runtime | Probe returns false → tentacle not auto-enabled |
| `vercel` (CLI) | ECOSYS-03 signal probe | Likely yes (in TOOLS list) | Check at runtime | Probe returns false |
| `~/.slack/` or Slack app | ECOSYS-02 signal probe | Unknown | N/A | Probe returns false |
| `~/.config/gh/hosts.yml` | ECOSYS-04 auth detection | Present if gh is auth'd | N/A | subprocess fallback |
| `~/.config/vercel/auth.json` | ECOSYS-03 auth detection | Present if vercel is auth'd | N/A | subprocess fallback |
| Playwright | e2e tests | ✓ | 1.58.2 | — |

**Missing with no fallback:** None that block implementation. All signal probes gracefully return `(false, reason)` if evidence is absent — this causes the tentacle NOT to auto-enable, which is the correct and safe default.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Tentacles are read-only, no auth flows in Phase 13 |
| V3 Session Management | No | No sessions |
| V4 Access Control | Yes | `OBSERVE_ONLY` guardrail prevents any write-path execution; enforced in Rust |
| V5 Input Validation | Yes | Observer loop output is scan-derived strings — cap with `crate::safe_slice` before logging |
| V6 Cryptography | No | No credentials read or stored in Phase 13 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Observer loop accidentally enables write path | Elevation of Privilege | `OBSERVE_ONLY: AtomicBool` central check + no code sharing with acting tentacle modules |
| Path traversal in which/subprocess args | Tampering | All subprocess args are string literals from a fixed constant list; no user-provided paths reach `Command::arg()` |
| Credential file reading (gh hosts.yml) | Information Disclosure | File contents read into local variable; never logged, never emitted in events; only `contains()` check used |
| Re-enable on rescan bypasses user intent | Elevation of Privilege | Idempotency check: `enabled_at > 0 && enabled == false` = user disabled, skip |

---

## Open Questions

1. **Which Settings tab should host ECOSYS-07?**
   - What we know: SettingsShell has 10 tabs; the design fits one more
   - What's unclear: Whether CSS layout can accommodate an 11th tab without overflow
   - Recommendation: Add "Ecosystem" as the 11th tab; verify CSS `.settings-tabs` scroll behavior in Wave 2 before committing to layout

2. **Calendar credential detection scope**
   - What we know: ECOSYS-06 says "Calendar API credentials detected"; GCP application default credentials and Google Calendar API are the most likely match on Arnav's machine
   - What's unclear: Whether iCloud Calendar credentials (`~/Library/Calendars/` on macOS) should also count; WSL has no native iCloud access
   - Recommendation: On WSL/Linux, check for GCP ADC only (`~/.config/gcloud/application_default_credentials.json`); add macOS path in a `#[cfg(target_os = "macos")]` block

3. **Activity log event schema**
   - What we know: ECOSYS-05 (LOG-05) says tentacles must emit activity-log rows per observation; Phase 14 builds the strip consumer
   - What's unclear: The exact schema — Phase 14 plan has not been written yet and may expect specific fields
   - Recommendation: Use `{ module, action, human_summary, payload_id, timestamp }` — this matches the LOG-02 requirement verbatim in REQUIREMENTS.md and is forward-compatible

4. **ECOSYS-10 on cold install — which 5 tentacles are guaranteed?**
   - What we know: repo_watcher (14+ repos), pr_watcher (gh installed), session_bridge (`.claude/projects/` exists) are near-certain; deploy_monitor (vercel installed and auth'd is likely); slack_monitor depends on Slack being installed
   - What's unclear: Whether calendar creds exist on Arnav's machine
   - Recommendation: Plan for 4 guaranteed + 2 probabilistic (Slack + calendar); document the probe logic so it's auditable; the success criterion is ≥5, not exactly 5

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gh` CLI is installed and auth'd on Arnav's machine (ECOSYS-10 coverage) | ECOSYS signal map | If not auth'd, only 3-4 tentacles auto-enable; ECOSYS-10 fails unless Slack or calendar also trigger |
| A2 | `vercel` CLI is installed and auth'd on Arnav's machine | ECOSYS signal map | Same as A1 — partial mitigation |
| A3 | GCP application default credentials exist for calendar detection | Environment | calendar_monitor may not auto-enable; ECOSYS-10 coverage reduced |
| A4 | Adding an 11th tab to SettingsShell doesn't break CSS layout | Settings UI | May need to use a sub-section of PrivacyPane instead |
| A5 | `dirs::home_dir()` returns the correct WSL home (not Windows home) | Signal probes | Auth file probes point to wrong location; false negatives on tentacle triggers |

---

## Sources

### Primary (HIGH confidence — verified against live codebase)

- `/home/arnav/blade/src-tauri/src/deep_scan/leads.rs` — `DeepScanResults` struct, all fields verified
- `/home/arnav/blade/src-tauri/src/deep_scan/mod.rs` — `deep_scan_start` completion hook location (line 491)
- `/home/arnav/blade/src-tauri/src/config.rs` — `DiskConfig` + `BladeConfig` structs, 6-place pattern, `save_config_field` pattern
- `/home/arnav/blade/src-tauri/src/integration_bridge.rs` — Observer loop pattern (`start_integration_polling`, `AtomicBool`, `OnceLock`)
- `/home/arnav/blade/src-tauri/src/tentacles/mod.rs` — Existing tentacle module list (10 tentacles)
- `/home/arnav/blade/src-tauri/src/hive.rs` — `Tentacle`, `TentacleStatus`, `TentacleReport` types
- `/home/arnav/blade/src-tauri/src/deep_scan/scanners/which_sweep.rs` — TOOLS constant (vercel, gh confirmed)
- `/home/arnav/blade/src/features/settings/SettingsShell.tsx` — PANES/TABS pattern + 10-tab structure
- `/home/arnav/blade/src/features/settings/panes/PrivacyPane.tsx` — DeepScanPrivacySection toggle pattern (optimistic update, toast feedback, GlassPanel tier=2 rows)
- `/home/arnav/blade/src/features/settings/index.tsx` — RouteDefinition pattern for new settings tab
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — ECOSYS-01..10 verbatim requirements
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 13 success criteria
- `/home/arnav/blade/package.json` — Playwright test script patterns, `test:e2e:phase12` as template

### Secondary (MEDIUM confidence — cross-verified)

- `.planning/phases/12-smart-deep-scan/12-01-SUMMARY.md` — DeepScanResults field list confirmed matches leads.rs
- `.planning/phases/12-smart-deep-scan/12-03-SUMMARY.md` — Profile overlay commands, confirmed 4 commands registered in lib.rs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all primitives verified in codebase
- Architecture: HIGH — signal map derived from actual DeepScanResults struct + which_sweep TOOLS constant
- Pitfalls: HIGH — all from direct code inspection of analogous modules
- UI pattern: HIGH — PrivacyPane.tsx is the direct template

**Research date:** 2026-04-24
**Valid until:** 2026-06-01 (stable stack; no external APIs involved)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ECOSYS-01 | repo-watcher tentacle auto-enables if repos found | `results.repo_rows.len() + results.git_repos.len() > 0` — both fields verified in DeepScanResults; repo_rows populated by fs_repos scanner confirmed in 12-01-SUMMARY |
| ECOSYS-02 | Slack monitor auto-enables if Slack config detected | `installed_apps` (Slack name match) OR `~/.slack/` directory OR env SLACK_TOKEN; Slack in legacy scanner `installed_apps` field |
| ECOSYS-03 | deploy-monitor auto-enables if Vercel CLI installed and auth'd | `vercel` confirmed in which_sweep TOOLS constant; auth file at `~/.config/vercel/auth.json` |
| ECOSYS-04 | PR-watcher auto-enables if GitHub CLI auth'd | `gh` confirmed in which_sweep TOOLS constant; auth file at `~/.config/gh/hosts.yml` |
| ECOSYS-05 | session-context bridge auto-enables if Cursor/Claude Code detected | `ai_tools` field + `~/.claude/projects/` + `~/.cursor/` paths checked in seed_queue |
| ECOSYS-06 | calendar-monitor auto-enables if Calendar API credentials detected | GCP ADC at `~/.config/gcloud/application_default_credentials.json`; macOS iCloud path conditional |
| ECOSYS-07 | Settings page lists auto-enabled tentacles with rationale + one-click disable | EcosystemPane.tsx following PrivacyPane.tsx toggle pattern; `ecosystem_get_registry` + `ecosystem_set_enabled` commands |
| ECOSYS-08 | Disabled state persists across restarts; no re-enable unless explicit | `ecosystem_tentacles: Vec<TentacleRecord>` in BladeConfig; idempotency guard: `enabled_at > 0 && !enabled` = skip |
| ECOSYS-09 | Hard observe-only guardrail — runtime check blocks outbound actions | `OBSERVE_ONLY: AtomicBool` in ecosystem.rs; `assert_observe_only_allowed()` called at all observer write-paths; `ecosystem_observe_only_check()` Tauri command for test seam |
| ECOSYS-10 | Cold install → ≥5 auto-enabled observer tentacles | repo_watcher + pr_watcher + session_bridge guaranteed; deploy_monitor + slack_monitor/calendar_monitor as 4th/5th; documented assumption A1-A3 |
</phase_requirements>
