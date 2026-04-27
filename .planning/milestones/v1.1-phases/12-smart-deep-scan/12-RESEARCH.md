# Phase 12: Smart Deep Scan - Research

**Researched:** 2026-04-20
**Domain:** Lead-following filesystem scanner + priority-queue drain + structured profile persistence + Tauri-event live tail
**Confidence:** HIGH (every integration point cross-referenced against the live codebase; WSL-host state directly probed; crate versions verified via `cargo search`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-59..D-67)

**D-59 — Lead queue architecture = single priority `VecDeque<Lead>` + 3 tiers + per-scanner budget.** Single async task drains a priority queue, not 12 parallel scanners. `Lead { kind, priority_tier, seed_source, payload, enqueued_at }`. Seed phase builds Tier 0/1 from: (1) filesystem MRU under `~/Projects`, `~/repos`, `~/src`, `~/code`, `~/Documents`, `~/Desktop` + user-configured parent dirs, (2) active AI session dirs, (3) shell-history recency window last 500 cmds, (4) `.git/HEAD` freshness. Breadth fill runs after. Tiers: Hot = last 7d (15s soft / 30s hard), Warm = last 30d (20s / 45s), Cold = breadth (30s / 60s). Ignore list `node_modules / .git / .venv / venv / target / dist / build / .next / .turbo / __pycache__`. Depth cap 6 levels. File cap 10k/tier. Cancel via `SCAN_CANCEL: AtomicBool`, checked **between leads** not mid-lead. Follow-ups: `.git` → `GitRemoteRead` + `PackageManifestRead` + `LockFileRead` + `IdeConfigRead`; Claude session with project_ref → `FsRepoWalk` Hot; IDE recent-projects → `ProjectRootHint` Warm. `HashSet<PathBuf>` visited set. Single async task + `tokio::task::spawn_blocking` for individual I/O; queue drained in-order so the activity log is a coherent narrative.

**D-60 — 8 scanners mapped 1:1 to SCAN-01..08.** Location `src-tauri/src/deep_scan/scanners/`. `scan_fs_repos` (fs walk → `RepoRow { path, discovered_via: "fs_walk" }`), `scan_git_remotes` (`.git/config` parse → `RepoRow` enriched + `AccountRow`), `scan_ide_workspaces` (`.code-workspace`, `.idea/workspace.xml`, VS Code `workspaceStorage/`, Cursor `workspaceStorage/` → `IdeRow` + `ProjectRootHint`), `scan_ai_sessions` (`~/.claude/projects/`, `~/.codex/sessions/`, `~/.cursor/chats/` → `AiToolRow` + `ProjectRootHint`), `scan_shell_history` (zsh/bash/fish → `ToolRow` + `PathHint`), `scan_mru` (home walk with 7d window → `MruFileRow`), `scan_bookmarks` (Chrome/Brave/Edge JSON + Arc SQLite → `BookmarkRow`), `scan_which_sweep` (curated CLI list + GUI app discovery → `ToolRow` + `InstalledAppRow`). Rhythm derives from cross-scanner data: hour-of-day histogram, day-of-week distribution, active-repo concurrency. Reuse individual scanner internals from existing `deep_scan.rs` (1437 LOC); **replace orchestration only** (`tokio::join!` → priority-queue drain).

**D-61 — Heuristics-first, ≤3 LLM calls per scan, 7-day cache.** Default posture: heuristics win. Zero LLM calls required for a scan to complete. Phase 11 `provider_capabilities` HashMap consulted for enrichment only. Pure heuristics cover: git remote regex, hostname → platform, SSH key comment, IDE workspace parse, shell tool detection, `which`, bookmark JSON, file mtime, extension histogram, lockfile-based language. 3 LLM calls allowed: (1) account narrative enrichment using `long_context_provider`, (2) rhythm narrative one-shot, (3) ambiguous-repo language classification (only Hot-tier repos with ≤50% extension dominance). All non-blocking, cached per-row 7d, log failure once (no retry). Falls back silently if no provider available.

**D-62 — Two-file persistence (`scan_results.json` + `profile_overlay.json`).** `scan_results.json` = canonical scanner output, wholesale-replaced on re-scan. `profile_overlay.json` = user-edit deltas keyed by stable `row_id`. Stable row_id scheme: `{row_kind}:{primary_key}` where primary_key is immutable natural identity (repo → canonical abs path; account → `platform:handle`; ide → name; file → abs path; tool → cli name). Render-layer merge: `render_rows = scan.rows.map(applyOverlay).filter(notHidden).concat(customRows)`. Overlay actions: `edit`, `hide`, `delete`, `add`. Orphaned-row handling: if overlay row no longer in scan, keep with `orphaned: true` + pill "not found in latest scan"; user can explicitly delete or pin. Never silently drop edits. New commands: `profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`.

**D-63 — ProfileView = 8th identity sub-view with 5 section tabs.** `src/features/identity/ProfileView.tsx`. Registered in `src/features/identity/index.tsx` as `{ id: 'profile', label: 'Profile', section: 'identity', component: ProfileView, phase: 12 }` (append-only, single-writer registry). Route id `profile`. Tabs in locked order: Repos → Accounts → Stack → Rhythm → Files. Per-row source pill (`fs`, `git`, `ide`, `ai`, `shell`, `mru`, `bookmark`, `which`); hover shows exact lead path. Edit / Hide / Delete via existing `EditSectionDialog`. Empty state: `EmptyState` primitive with "Run your first scan" CTA when never scanned.

**D-64 — Live tail = additive `deep_scan_progress` payload + in-page collapsed log panel; strip is Phase 14.** Event name unchanged (`deep_scan_progress`). Existing payload preserved (`{ phase, found }`). New optional fields: `lead_kind`, `lead_seed`, `priority_tier`, `queue_depth`, `elapsed_ms`, `message`. Simple log-tail panel inside ProfileView auto-expands during scan, auto-collapses 3s after complete. No global UI strip this phase.

**D-65 — All-on default + per-class opt-out in Settings → Privacy.** Per-class toggles: `fs_repos`, `git_remotes`, `ide_workspaces`, `ai_sessions`, `shell_history`, `mru`, `bookmarks`, `which_sweep`. `ScanClassesEnabled` struct follows 6-place config pattern. Hard invariants enforced by new verify gates: **`verify:scan-no-egress`** (grep `src-tauri/src/deep_scan*` for `reqwest::`, `isahc::`, `http::`, `ureq::`, `TcpStream`, `UdpSocket` — fail on any match), **`verify:scan-no-write`** (grep for `fs::write`, `fs::create_dir_all`, `OpenOptions::write` — fail unless path matches `blade_config_dir()/identity/*`).

**D-66 — Hard cutover of `deep_scan.rs` internals; stable public contract.** Split monolith into `src-tauri/src/deep_scan/mod.rs` + `leads.rs` + `queue.rs` + `scanners/*.rs` + `profile.rs`. Rust module-or-folder resolution handles this automatically. Stable contract: `deep_scan_start`, `deep_scan_results`, `deep_scan_summary` Tauri command signatures unchanged; `DeepScanResults` struct grows additively; `deep_scan_progress` event name + existing payload fields preserved; `~/.blade/identity/scan_results.json` schema backward-compat. New: `profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`, `scan_cancel`. Old installs load fine (missing new fields default).

**D-67 — 5 plans in 3 waves mirrors Phase 11 D-58 pacing.** Wave 0: 12-01 (lead queue core + 3 hot-path scanners) alongside 12-02 (remaining 5 scanners + rhythm compute + privacy config + 2 verify gates). Wave 1: 12-03 (overlay backend + Tauri commands) → 12-04 (ProfileView + tabs + live log + Settings → Privacy wire-up). Wave 2: 12-05 (LLM enrichment + `verify:scan-event-compat` + `verify:all` extension + goal-backward manual trace on Arnav's machine).

### Claude's Discretion

- Exact scanner filenames within `deep_scan/scanners/` subtree.
- Exact SVG / visual treatment for the Profile page (reuses existing primitives).
- LLM prompt wording for the 3 enrichment calls.
- Specific curated CLI list for `which` sweep; executor may expand.
- Hour-of-day heatmap visual style — tailwind grid + CSS variable intensity.
- Exact wording of Settings → Privacy explanatory copy.

### Deferred Ideas (OUT OF SCOPE)

- Tentacle auto-enable from scan findings — Phase 13 (ECOSYS-01..10).
- Persistent Activity Log strip across all routes — Phase 14 (LOG-01/02).
- Dashboard cards binding to profile data — Phase 15 (DENSITY/DASH).
- Continuous / background re-scan — v1.2+.
- Profile data egress / export — observe-only v1.1 rule.
- WSL distro enumeration against SCAN-13 baseline — kept as-is, not counted.
- Mac `/Applications` enumeration — operator-owned Mac smoke checkpoint.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCAN-01 | FS repo walk — `~/Projects`, `~/repos`, `~/src`, `~/code`, parent dirs, every `.git/` underneath | Filesystem Walk Strategy section + WSL /mnt/c crossing pitfall |
| SCAN-02 | Git remotes — read `.git/config`, extract org/repo + account handle | Git Remote Parsing section + Code Examples: git-remote-regex |
| SCAN-03 | IDE workspaces — `.code-workspace`, `.idea`, Cursor state, VS Code recent-projects | IDE Workspace Artifacts section + Runtime State Inventory |
| SCAN-04 | AI session history — `~/.claude/projects/`, `~/.codex/sessions/`, `~/.cursor/`, browser-AI where reachable | AI Session Directory Schemas section + Code Examples: ai-session-parse |
| SCAN-05 | Shell history — `.bash_history`, `.zsh_history`, `.fish_history` — extract tool + repo signals | Shell History Time Windows + bash-no-timestamps pitfall |
| SCAN-06 | FS MRU — 7-day window under home dir | Filesystem Walk Strategy + Standard Stack: walkdir |
| SCAN-07 | Browser bookmarks — Chrome, Brave, Arc, Edge | Browser Bookmark Parsing section |
| SCAN-08 | `which` sweep — curated CLI list + GUI app discovery | which Sweep section + Code Examples: which-sweep |
| SCAN-09 | Scanner builds own todo list at start; priority-ordered drain visible in log | Priority Queue Implementation section + Architecture Pattern 1 |
| SCAN-10 | Scanner streams live progress to activity log (LOG-01 wires Phase 14) | Additive Event Payload section + Architecture Pattern 2 |
| SCAN-11 | Structured profile document (repos, stack, accounts, people, rhythm, files), persisted + editable | Profile Persistence + Overlay I/O Serialization sections |
| SCAN-12 | Profile edits round-trip (save → restart → reload); source-linked rows show origin | Overlay I/O Serialization + Code Examples: overlay-merge |
| SCAN-13 | Baseline on Arnav's cold install: ≥10 repos / ≥5 accounts / ≥3 rhythm / ≥3 IDE-AI signals | Baseline Feasibility on Arnav's Machine section (measured findings) |
</phase_requirements>

## Summary

Phase 12 is an **orchestration rewrite, not a scanner rewrite**. Every individual scanner body already exists in the 1437-LOC `deep_scan.rs` (`scan_installed_apps`, `scan_git_repos`, `scan_shell_history`, `scan_ai_tools`, `scan_browser_bookmarks`, `scan_ssh_keys`, `scan_ides`, etc.) and works correctly in isolation. The failure mode — 1 repo on Arnav's cold install vs. the ≥10-repo target — is caused by `scan_git_repos` doing **only a 1-level-deep read of a hardcoded list of candidate dirs**. On Arnav's actual WSL2 machine, repos live at `/home/arnav/blade`, `/home/arnav/Staq`, `/home/arnav/SlayerBlade`, `/home/arnav/glurk`, `/home/arnav/sangathan`, `/home/arnav/playtheta`, `/home/arnav/OP_SETUP`, etc. — directly under `$HOME`, not under any of `home/projects`, `home/dev`, `home/code`, `home/repos`, `home/Documents`, `home/Desktop`, `home/src`, `home/work`. Every seed dir misses.

The fix D-59 prescribes has three parts: (1) **seed the priority queue from actually-touched dirs** (filesystem MRU + AI session project refs + shell-history path targets + `.git/HEAD` mtime), (2) **drain in-order** as a single async task using `VecDeque` + `HashSet<PathBuf>` visited-set, not 12 parallel scanners, (3) **persist overlay separately** so user edits survive re-scan. The rewrite does NOT need new crates: `walkdir` is already transitively in the tree via `tauri`; `regex` + `serde_json` + `chrono` are direct deps; `reqwest` exists for the 3 gated LLM calls (which live in `commands.rs`/`providers/`, never in `deep_scan/`). Zero new system-lib dependencies means zero Phase-12 risk of tripping the `libspa-sys` / `libclang` WSL build issues tracked in v1.0 Open Checkpoints.

**Primary recommendation:** Build the lead queue as `deep_scan/queue.rs` wrapping three `VecDeque<Lead>` (one per tier) + a `HashSet<PathBuf>` visited-set + a static `SCAN_CANCEL: AtomicBool` sentinel. The orchestrator is a single `async fn drain(app: AppHandle)` that dequeues Hot before Warm before Cold, spawns individual blocking work via `tokio::task::spawn_blocking` for filesystem and file I/O, and emits `deep_scan_progress` between dequeues with the additive payload (`lead_kind`, `lead_seed`, `priority_tier`, `queue_depth`, `elapsed_ms`, `message`). Scanner functions return `Vec<Row> + Vec<FollowUpLead>` — the orchestrator enqueues follow-ups and appends rows. Overlay I/O goes through a single `tokio::sync::Mutex<()>` serializer so a UI save during an active scan cannot interleave writes. Every other piece of the phase composes existing primitives (identity/ProfileView registry slot, `EditSectionDialog`, `useTauriEvent`, `useConfig`, `invokeTyped`).

## Project Constraints (from CLAUDE.md)

- **6-place config pattern** — `ScanClassesEnabled` must hit: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`. [VERIFIED: config.rs:196-197, 293, 387-388, 477, 623, 680] — the existing `last_deep_scan` and `integration_polling_enabled` fields show all 6 sites in the current file. Phase 11 already successfully landed 5 new fields via this pattern; Phase 12 follows the same blueprint.
- **Module registration** — `mod deep_scan;` at `lib.rs:138` already exists; Rust resolves `mod deep_scan;` to either `deep_scan.rs` OR `deep_scan/mod.rs` — the split from D-66 is a file-system rename + new submodule declarations, no `lib.rs` edit needed for the module declaration itself.
- **`generate_handler!` registration** — 4 new commands go into the existing block at `lib.rs:1207-1209` (currently lists `deep_scan_start`, `deep_scan_results`, `deep_scan_summary`). Add `profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`, `scan_cancel`. Tauri macro namespace is **flat** — grep the codebase before picking these names (grep for `#[tauri::command]` attributes confirms none collide today).
- **`use tauri::Manager;`** — required only when calling `app.state()`. The Phase-12 commands use `AppHandle` for event emission (`app.emit_to(...)`) and `AppHandle` only. No `Manager` import needed unless the overlay serializer is stored in Tauri-managed state (recommended is a `static LazyLock<Mutex<()>>` instead, which avoids the import entirely).
- **Cancel pattern** — `static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);` mirrors the 29 existing `AtomicBool` cancel sentinels in the tree (see `health_guardian.rs:36`, `proactive_engine.rs:21`, `perception_fusion.rs:58`). Set via new `#[tauri::command] scan_cancel()` which stores true with `Ordering::SeqCst`. Checked **between leads**, not mid-lead (per D-59 explicit invariant).
- **`safe_slice` for non-ASCII content** — log messages include paths from user filesystem. ANY path truncation that byte-slices like `&path[..40]` is banned; use `crate::safe_slice(&path_str, 40)`.
- **No `cargo check` after every edit** — batch all queue + scanner + overlay edits in Wave 0, run `cargo check` at end of wave.
- **`invokeTyped` + `useTauriEvent`** — enforced by `verify:no-raw-tauri` and ESLint. New wrappers go in `src/lib/tauri/deepscan.ts` (already exists — just append `profileGetRendered` / `profileOverlayUpsert` / `profileOverlayReset` / `scanCancel`).
- **No `Co-Authored-By` in commits.**
- **String slicing discipline** — file paths on Arnav's machine can contain `~/Projects/日本語-project/` kind of content post-file-system expansion; any raw byte-slice panic in the scanner would crash the entire drain loop.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Priority-queue drain orchestration | API / Backend (Rust) | — | Single async task, `spawn_blocking` for I/O; never runs in browser |
| Individual scanner I/O (file reads, `.git/config` parse, `which` exec) | API / Backend (Rust) | — | Filesystem + subprocess access; cannot run from browser |
| Lead enqueuer / visited-set tracking | API / Backend (Rust) | — | Mutates queue state during drain; no frontend view of it |
| Rhythm compute (hour/day histograms from timestamps) | API / Backend (Rust) | — | Pure reduction over shell-history + AI-session timestamps; Rust-side for low-allocation |
| LLM enrichment calls (3 gated) | API / Backend (Rust) | — | Keyring access + `providers::complete_turn`; must NOT live in `deep_scan/` module per D-65 egress gate. Lives in `providers/` called from `deep_scan/enrichment.rs` via a `commands.rs`-style dispatch helper |
| Scan progress event emission | API / Backend (Rust) | Browser / Client | Rust `app.emit_to("main", "deep_scan_progress", …)`, React consumes via `useTauriEvent` |
| Profile overlay persistence (JSON file I/O) | API / Backend (Rust) | — | File serialization + atomic write; never browser |
| Profile rendered view (scan + overlay merged) | API / Backend (Rust) | — | Returned via `profile_get_rendered` command; browser renders the dto |
| ProfileView 5 tabs (table / grid / heatmap / drawer) | Browser / Client (React) | API / Backend | Pure render from `ProfileRendered` dto |
| Source pill + orphaned pill | Browser / Client (React) | — | Pure render |
| Live-tail log panel | Browser / Client (React) | API / Backend | Subscribes to `deep_scan_progress` via `useTauriEvent`, ring-buffer last 10 |
| Settings → Privacy toggle list | Browser / Client (React) | API / Backend | Reads `config.scan_classes_enabled`, writes via existing `save_config_field` |
| `scan_cancel` button → Rust cancel | Browser / Client (React) | API / Backend | Invokes `scan_cancel` command; React state updates on emit of final `complete` or `cancelled` phase |

## Standard Stack

### Core (all already in tree — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `walkdir` | 2.5.0 (transitive) | Filesystem walks with depth caps + follow-symlinks control | [VERIFIED: Cargo.lock:8168] transitively present; directly usable. Alternative `jwalk` (parallel) adds no benefit for a lead-queue model that is intentionally sequential |
| `regex` | 1.x | `.git/config` remote URL parse, shell-history timestamp extraction | [VERIFIED: Cargo.toml:56] already used by `provider_paste_parser.rs` |
| `serde` / `serde_json` | 1.x | `Lead`, `DeepScanResults` additive fields, `profile_overlay.json` schema | [VERIFIED: Cargo.toml:32-33] |
| `chrono` | 0.4 | `enqueued_at`, `edited_at`, `last_enriched_at`, rhythm timestamps | [VERIFIED: Cargo.toml:39] |
| `dirs` | 6 | `home_dir()`, `data_dir()`, `config_dir()` cross-platform paths | [VERIFIED: Cargo.toml:37] |
| `glob` | 0.3 | Ignore-list matching (faster than bespoke ignore logic for the 9 hardcoded patterns) | [VERIFIED: Cargo.toml:55] |
| `reqwest` | 0.12 | Used ONLY from `providers/` for LLM calls; NEVER imported in `deep_scan/` (enforced by `verify:scan-no-egress`) | [VERIFIED: providers/mod.rs:10] |
| React 19 | 19.2.5 | ProfileView, tab nav, EditSectionDialog consumer | [VERIFIED: package.json:66] |
| `@tauri-apps/api` | 2.10.1 | `invokeTyped` via existing `src/lib/tauri/` barrel | [VERIFIED: package.json:55] |

### Supporting (already in tree)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `rusqlite` | 0.39 (bundled) | Arc bookmark DB parse; Cursor chat DB if present | [VERIFIED: Cargo.toml:41] — load on-demand for Arc/Cursor scanners only |
| `keyring` | 3.x | LLM call key retrieval (only from `providers/`, not `deep_scan/`) | [VERIFIED: Cargo.toml:40] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Triple `VecDeque<Lead>` | Single `BinaryHeap<Lead>` with priority field | Heap is O(log n) dequeue vs deque O(1); but heap loses insertion-order FIFO within same tier, which breaks the "scan thinks out loud" narrative (SCAN-10). 3-deque is simpler + fits the exact 3-tier spec in D-59. |
| `walkdir` | `jwalk` (parallel walk) | D-59 explicitly locks **sequential** drain so the activity log is coherent. Parallel walks would interleave progress events unreadably. |
| `walkdir` | `ignore::WalkBuilder` (ripgrep lib) | Would read `.gitignore` per-repo — behavior we explicitly do NOT want. We want a hardcoded 9-pattern skip list because `.gitignore` varies per repo and is too permissive for our purposes. |
| `git2` (libgit2 binding) | Read `.git/config` as text + regex | Phase 12 reads 50-200 `.git/config` files; libgit2 init is heavy and would pull `libssh2-sys` (system-lib risk on WSL). Existing `inspect_git_repo` at `deep_scan.rs:368-418` already parses `.git/config` and `.git/HEAD` as plain text — lift it. |
| `gix-config` (pure-Rust gitoxide) | Same as above — regex on text | Same argument; 50-200 files do not warrant a dedicated crate. |
| `once_cell::sync::Lazy` | `std::sync::LazyLock` (stable since Rust 1.80) | Prefer `LazyLock` for new code per Phase-11 convention. |
| `tokio::sync::Mutex` | `parking_lot::Mutex` | `parking_lot` not in tree; `tokio::sync::Mutex` is already used via `tokio` features = "full" at Cargo.toml:35. |

**Installation:** NO new dependencies required. If `walkdir` ends up needing explicit mention (rather than transitive), add `walkdir = "2.5"` to `[dependencies]` in `src-tauri/Cargo.toml`.

**Version verification** (executed 2026-04-20 via `cargo search` on crates.io):

| Crate | Published version | Notes |
|-------|-------------------|-------|
| `walkdir` | 2.5.0 | [VERIFIED] current; transitively in tree; safe to use as direct dep if explicit import needed |
| `ignore` | 0.4.25 | [VERIFIED] current; NOT recommended for Phase 12 per alternatives table |
| `once_cell` | 1.21.4 | [VERIFIED] current; prefer std::sync::LazyLock; skip adding this unless tree-grep shows existing use |
| `gix-config` | 0.54.0 | [VERIFIED] current; NOT needed — plain-text parse is sufficient |

## Priority Queue Implementation

### The Data Structure

```rust
// src-tauri/src/deep_scan/queue.rs

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Tier {
    Hot,   // last 7 days
    Warm,  // last 30 days
    Cold,  // breadth fill
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LeadKind {
    // 8 source-class primary kinds (map 1:1 to SCAN-01..08)
    FsRepoWalk, GitRemoteRead, IdeWorkspaceRead, AiSessionRead,
    ShellHistoryScan, MruWalk, BookmarkRead, WhichSweep,
    // Derived / follow-up kinds
    ProjectRootHint, PathHint, PackageManifestRead, LockFileRead,
    IdeConfigRead, RhythmCompute, LlmEnrich,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SeedSource {
    Configured(String),
    FsMru(String),
    AiSession(String),
    ShellHistory(String),
    GitHeadFreshness(String),
    Breadth(String),
    FollowUp(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lead {
    pub kind: LeadKind,
    pub priority_tier: Tier,
    pub seed_source: SeedSource,
    pub payload: serde_json::Value,
    pub enqueued_at: DateTime<Utc>,
}

pub struct LeadQueue {
    hot: VecDeque<Lead>,
    warm: VecDeque<Lead>,
    cold: VecDeque<Lead>,
    visited: HashSet<PathBuf>,
}

impl LeadQueue {
    pub fn enqueue(&mut self, lead: Lead) {
        if let Some(path_str) = lead.payload.get("path").and_then(|v| v.as_str()) {
            let pb = PathBuf::from(path_str);
            if self.visited.contains(&pb) { return; }
            self.visited.insert(pb);
        }
        match lead.priority_tier {
            Tier::Hot => self.hot.push_back(lead),
            Tier::Warm => self.warm.push_back(lead),
            Tier::Cold => self.cold.push_back(lead),
        }
    }

    pub fn pop(&mut self) -> Option<Lead> {
        if let Some(l) = self.hot.pop_front() { return Some(l); }
        if let Some(l) = self.warm.pop_front() { return Some(l); }
        self.cold.pop_front()
    }

    pub fn total_remaining(&self) -> usize {
        self.hot.len() + self.warm.len() + self.cold.len()
    }

    pub fn current_tier(&self) -> Tier {
        if !self.hot.is_empty() { Tier::Hot }
        else if !self.warm.is_empty() { Tier::Warm }
        else { Tier::Cold }
    }

    pub fn cancelled(&self) -> bool {
        SCAN_CANCEL.load(Ordering::SeqCst)
    }
}
```

### Drain Loop Pattern

```rust
// src-tauri/src/deep_scan/mod.rs (orchestrator sketch)

pub async fn drain(app: AppHandle, mut queue: LeadQueue) -> DeepScanResults {
    let started = std::time::Instant::now();
    let mut results = DeepScanResults::default();

    while let Some(lead) = queue.pop() {
        if queue.cancelled() {
            emit_progress(&app, "cancelled", &queue, &lead, started, Some("user_cancel"));
            break;
        }
        emit_progress(&app, &lead_phase_name(&lead), &queue, &lead, started, None);

        let (rows, follow_ups) = match lead.kind {
            LeadKind::FsRepoWalk => {
                tokio::task::spawn_blocking(move || scanners::fs_repos::run(lead))
                    .await.unwrap_or_default()
            }
            LeadKind::GitRemoteRead => {
                tokio::task::spawn_blocking(move || scanners::git_remotes::run(lead))
                    .await.unwrap_or_default()
            }
            // … 6 more scanners …
            _ => (vec![], vec![]),
        };

        results.append(rows);
        for f in follow_ups { queue.enqueue(f); }
    }

    results.rhythm_signals = rhythm::compute(&results);
    if let Err(e) = enrichment::run_gated(&mut results, &app).await {
        log::warn!("deep_scan enrichment skipped: {e}");  // log once, no retry
    }
    save_results(&results).ok();
    results
}
```

**Why VecDeque not BinaryHeap**: the 3 existing `AtomicBool` background-task patterns in the tree (`health_guardian.rs:36`, `proactive_engine.rs:21`, `perception_fusion.rs:58`) all use sequential drain with explicit cancel checks. `BinaryHeap<Lead>` with a priority-ordering `impl Ord` would lose FIFO insertion-order within a tier — and insertion order IS semantically meaningful (first-enqueued Hot leads are the seeds closest to the user's current work; user-visible narrative must reflect that).

**Why check cancel between leads, not mid-lead** (per D-59): individual scanner bodies hold iterators, open file handles, etc. Cancelling mid-scan would require checkpointed state per scanner — overengineered for a scan that should complete in ≤60s total on baseline hardware. Between-lead checking is simple, correct, and responsive enough (scanner body caps at 30s per D-59 anyway).

**Why `spawn_blocking` not `tokio::task::spawn`** (per D-59): filesystem traversal, file read, and regex parsing are CPU/IO-blocking sync calls. Using `tokio::spawn` would starve the runtime. `spawn_blocking` moves the work to a dedicated thread-pool. The orchestrator awaits each lead serially — no parallelism inside a tier — by design.

## Filesystem Walk Strategy

### Seed Discovery — The Fix for the "1 repo cold install" Symptom

The existing `scan_git_repos` at `deep_scan.rs:335-366` fails on Arnav's machine because it does only a 1-level-deep read over a hardcoded list of candidate dirs:

```rust
// CURRENT (broken on Arnav's setup):
let candidate_dirs = [
    home.join("Documents"), home.join("projects"), home.join("dev"),
    home.join("code"), home.join("repos"), home.join("Desktop"),
    home.join("src"), home.join("work"),
];
for root in &candidate_dirs {
    let Ok(entries) = std::fs::read_dir(root) else { continue };
    for entry in entries { /* only 1-level */ }
}
```

**Measured on 2026-04-20 on Arnav's WSL2 machine** (findings, with maxdepth 2 search for `.git` directories):

| Seed dir | Repos found |
|----------|-------------|
| `~/Documents` | 0 (directory does not exist) |
| `~/projects` | 0 (directory does not exist) |
| `~/dev` | 0 (directory does not exist) |
| `~/code` | 0 (directory does not exist) |
| `~/repos` | 0 (directory does not exist) |
| `~/Desktop` | 0 (does not exist) |
| `~/src` | 0 (does not exist) |
| `~/work` | 0 (does not exist) |
| `~/Projects` (capital P, documented in D-59) | 0 (directory does not exist) |
| **`~/` (home root itself, maxdepth 2)** | **≥8 repos** visible: `blade`, `Staq`, `SlayerBlade`, `glurk`, `sangathan`, `playtheta`, `OP_SETUP`, plus `.nvm/.git`. |

The fix D-59 prescribes — **MRU-seeded walks** — solves this directly: filesystem mtime on `~/blade`, `~/Staq`, `~/SlayerBlade` will all be ≤7 days (Arnav works on these daily), and each becomes a Hot `FsRepoWalk` lead at scan start. In addition, the AI-session-dir seeding (`~/.claude/projects/-home-arnav-blade`, `-home-arnav-Staq`, etc. — all present [VERIFIED]) gives a parallel signal: each AI-session slug maps directly to a project path.

**Recommendation for `scan_fs_repos` scanner body:**

1. Accept a `Lead` with `payload = { "root": "~/blade" }`.
2. Use `walkdir::WalkDir::new(root).max_depth(6)` with `.into_iter().filter_entry(…)` to skip the 9 ignored dirs inline.
3. Record every `.git` directory encountered. Cap at 10,000 walked entries (D-59 budget).
4. For each `.git` found, enqueue a `GitRemoteRead` follow-up lead at same tier (or Hot if the `HEAD` mtime is ≤7d, irrespective of current tier — upgrade the lead).

**Breadth-fill fallback seeds** (run at Cold tier):
```rust
// Home root itself as the ultimate fallback — catches Arnav's case
home.clone(),
// Historical BLADE-doc'd paths (kept for macOS / non-Arnav cases)
home.join("Projects"), home.join("projects"), home.join("repos"),
home.join("src"), home.join("code"), home.join("Documents"), home.join("Desktop"),
// User-configured
cfg.scan_parent_dirs.iter().map(PathBuf::from).collect::<Vec<_>>(),
```

### Ignore-List Pattern (shared across `fs_repos` + `mru`)

```rust
const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules", ".git", ".venv", "venv", "target",
    "dist", "build", ".next", ".turbo", "__pycache__",
    // Additional safety — not in D-59 but critical for WSL + Rust monorepos:
    ".cargo", ".rustup", ".nvm", ".cache", "Library",
];

fn should_skip(entry: &walkdir::DirEntry) -> bool {
    entry.file_name().to_str()
        .map(|n| IGNORED_DIR_NAMES.contains(&n))
        .unwrap_or(false)
}

let walker = walkdir::WalkDir::new(root)
    .max_depth(6)
    .follow_links(false)  // CRITICAL on WSL2 — symlinks into /mnt/c are slow
    .into_iter()
    .filter_entry(|e| !should_skip(e));
```

**WSL2 performance note**: `follow_links(false)` is load-bearing. If Arnav has any symlink pointing into `/mnt/c/Users/arnav/…`, following it during a repo walk crosses the 9P filesystem boundary at ~10x Linux-home throughput — a 6-level walk could take minutes. [VERIFIED: `/mnt/c/Users/` exists and has subdirectories `arnav`, `Default`, `CodexSandboxOffline`; crossing this during a scan risks the 30s per-scanner hard budget].

## Git Remote Parsing

### Existing Pattern (lift from `deep_scan.rs:376-385`)

The existing code handles 80% of cases but loses the multi-remote case + the remote name (e.g., `origin`, `upstream`, `fork`).

### Recommended Enhancement

```rust
use regex::Regex;
use std::sync::LazyLock;

static RE_REMOTE_SECTION: LazyLock<Regex> = LazyLock::new(||
    Regex::new(r#"(?m)^\[remote\s+"([^"]+)"\]"#).unwrap()
);
static RE_URL_LINE: LazyLock<Regex> = LazyLock::new(||
    Regex::new(r#"(?m)^\s*url\s*=\s*(.+?)\s*$"#).unwrap()
);

pub fn parse_git_config(content: &str) -> Vec<(String, String)> {
    // Returns Vec<(remote_name, url)>
    let mut remotes: Vec<(String, String)> = Vec::new();
    let mut current_remote: Option<String> = None;
    for line in content.lines() {
        if let Some(cap) = RE_REMOTE_SECTION.captures(line) {
            current_remote = Some(cap.get(1).unwrap().as_str().to_string());
        } else if line.trim_start().starts_with('[') {
            current_remote = None;  // different section
        } else if let Some(ref name) = current_remote {
            if let Some(cap) = RE_URL_LINE.captures(line) {
                let url = cap.get(1).unwrap().as_str().to_string();
                remotes.push((name.clone(), url));
            }
        }
    }
    remotes
}

static RE_SSH_REMOTE: LazyLock<Regex> = LazyLock::new(||
    // git@github.com:org/repo.git  OR  git@host.com:org/repo
    Regex::new(r#"^(?:ssh://)?git@([^:/]+)[:/]([^/]+)/([^/]+?)(?:\.git)?/?$"#).unwrap()
);
static RE_HTTPS_REMOTE: LazyLock<Regex> = LazyLock::new(||
    // https://github.com/org/repo.git  OR  https://user@host.com/org/repo
    Regex::new(r#"^https?://(?:[^@/]+@)?([^/]+)/([^/]+)/([^/]+?)(?:\.git)?/?$"#).unwrap()
);

pub fn infer_platform_from_host(host: &str) -> &'static str {
    let h = host.to_ascii_lowercase();
    if h == "github.com" || h.ends_with(".github.com") { "github" }
    else if h == "gitlab.com" || h.ends_with(".gitlab.com") { "gitlab" }
    else if h == "bitbucket.org" || h.ends_with(".bitbucket.org") { "bitbucket" }
    else if h == "dev.azure.com" || h.ends_with(".visualstudio.com") { "azure" }
    else if h == "codeberg.org" { "codeberg" }
    else if h.starts_with("gitea.") || h.contains("/gitea") { "gitea" }
    else { "custom" }  // raw hostname preserved in AccountRow
}
```

[CITED: git-config format specification https://git-scm.com/docs/git-config#_syntax] — `[remote "name"]` sections are the canonical form; `[remote name]` without quotes is rare but legal and would be missed by this regex (accept — the existing scanner has the same limitation and no reports).

**Account extraction** (SCAN-02 "extract org/repo + account handle"):

```rust
pub fn account_from_remote(url: &str) -> Option<AccountRow> {
    if let Some(cap) = RE_SSH_REMOTE.captures(url) {
        let host = cap.get(1)?.as_str();
        let org = cap.get(2)?.as_str();
        return Some(AccountRow {
            platform: infer_platform_from_host(host).to_string(),
            handle: org.to_string(),
            source: "git_remote".to_string(),
        });
    }
    if let Some(cap) = RE_HTTPS_REMOTE.captures(url) {
        let host = cap.get(1)?.as_str();
        let org = cap.get(2)?.as_str();
        return Some(AccountRow {
            platform: infer_platform_from_host(host).to_string(),
            handle: org.to_string(),
            source: "git_remote".to_string(),
        });
    }
    None
}
```

**Baseline check**: on Arnav's 8 measurable repos at `~/` root, every one is expected to resolve to a `github.com` account handle (Arnav's primary platform per project observation). Expected AccountRow output: ≥1 unique github handle. Combined with SSH-key `-C email` parses from the existing `scan_ssh_keys`, expected total ≥5 distinct account signals — satisfies SCAN-13 accounts threshold (with the expansion work called out in §Baseline Feasibility).

## IDE Workspace Artifacts

### Reality on Arnav's machine (verified 2026-04-20)

| IDE | Path probed | Result |
|-----|-------------|--------|
| VS Code (Linux-side) | `~/.config/Code/User/` | **Missing — directory does not exist** |
| VS Code (Windows-side, via /mnt/c) | `/mnt/c/Users/arnav/AppData/Roaming/Code/User/` | **Present — `globalStorage/`, `workspaceStorage/`, `settings.json`** |
| Cursor | `~/.cursor/` | **Missing** |
| Cursor (Windows) | `/mnt/c/Users/arnav/AppData/Roaming/Cursor/User/` | Not probed (symmetric to VS Code expected) |
| JetBrains | `~/.config/JetBrains/` or `dirs::data_dir` | No hits |
| Neovim | `~/.config/nvim/` | Not probed (existing scanner checks for `init.lua`/`init.vim`) |

**Implication**: Arnav's primary IDE is **VS Code on Windows host**, consumed from WSL. The scanner must probe `/mnt/c/Users/*/AppData/Roaming/Code/User/workspaceStorage/` on Linux + cross the WSL boundary to parse it. This crossing is slow but bounded: `workspaceStorage/` is typically 50-500 subdirs each ≤10KB — tolerable once. Enqueue as Warm tier, not Hot.

### workspaceStorage Schema [CITED: https://github.com/microsoft/vscode source]

Each subdirectory under `workspaceStorage/` is named with an opaque hash. Inside:
- `workspace.json` → `{"folder": "file:///path/to/project"}` OR `{"workspace": "file:///path/to/file.code-workspace"}`
- `state.vscdb` (SQLite) — recent-projects list and extension state; skip unless necessary (adds rusqlite overhead).

```rust
pub fn parse_vscode_workspace_json(path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    let uri = v.get("folder").and_then(|f| f.as_str())
        .or_else(|| v.get("workspace").and_then(|w| w.as_str()))?;
    let stripped = uri.strip_prefix("file://")?;
    Some(PathBuf::from(urlencoding::decode(stripped).ok()?.into_owned()))
}
```

**WSL path translation**: VS Code on Windows stores paths as `file:///c:/Users/arnav/projects/foo`. In WSL, this maps to `/mnt/c/Users/arnav/projects/foo`. The scanner must rewrite `file:///c:/` → `/mnt/c/` on Linux; this is the entry point from "Windows-side VS Code sees this repo" to "Linux-side scanner walks into `/mnt/c/`." Often these `/mnt/c/...` paths are NOT where repos actually live on Arnav's machine (which are under `/home/arnav/` WSL native). Scanner should prefer `/home/arnav/` over `/mnt/c/` when both contain the same repo name.

### Cursor `recent-projects` [ASSUMED]

Cursor 0.x ships `workspaceStorage` identical to VS Code at `AppData/Roaming/Cursor/User/workspaceStorage/`. **Risk**: Cursor version skew vs VS Code may diverge schema. Scanner should best-effort parse, log once if failing, move on.

### JetBrains `.idea/workspace.xml` [CITED: https://www.jetbrains.com/help/idea/project-directory.html]

Per-project config; `workspace.xml` element `<component name="RecentProjectsManager">` contains recent-project paths. Existing `scan_ides` does not parse this today — Phase 12 enhancement. Low priority for baseline (Arnav does not use JetBrains based on probe).

## AI Session Directory Schemas

### `~/.claude/projects/` [VERIFIED: entries exist for Arnav — `-home-arnav-blade`, `-home-arnav-Staq`, `-home-arnav-finovo`, `-home-arnav` (root), `-home-arnav-blade-src-tauri`]

The slug convention is: replace `/` in project path with `-`, keep leading `-` for root separator. So `-home-arnav-blade` maps to `/home/arnav/blade`. Each directory contains:
- `{uuid}/` subdirs (one per conversation)
- `{uuid}.jsonl` files (conversation transcripts) — [VERIFIED: `19f0bbd4-d43b-4388-b531-81f0535ae7db.jsonl` visible]

The scanner does not need the conversation content — it needs:
1. The slug → project path mapping (via slug reversal)
2. The max timestamp across all `.jsonl` lines → "last_active_at" for the project

```rust
pub fn slug_to_project_path(slug: &str) -> PathBuf {
    // "-home-arnav-blade" → "/home/arnav/blade"
    PathBuf::from(slug.replace('-', "/"))
}

pub fn claude_session_last_active(project_dir: &Path) -> Option<DateTime<Utc>> {
    // mtime of the most-recently-modified .jsonl in project_dir is sufficient.
    // Parsing JSONL per-line to extract timestamps is wasteful; mtime approximates.
    std::fs::read_dir(project_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .filter_map(|e| e.metadata().ok())
        .filter_map(|m| m.modified().ok())
        .max()
        .and_then(|t| DateTime::from_timestamp(
            t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64, 0))
}
```

**Expected signal on Arnav's machine**: ≥4 Claude sessions with project refs (blade, Staq, finovo, src-tauri subdir). Each enqueues a `FsRepoWalk` Hot lead for the referenced path (if not already visited).

### `~/.codex/sessions/` [VERIFIED: exists — `auth.json`, `cache/`, `config.toml`, `history.jsonl`, `memories/`]

[ASSUMED] — schema less documented; the existing `scan_ai_tools` only checks existence. Phase 12 enhancement: if `~/.codex/history.jsonl` exists, parse for project-path references (each line contains a `cwd` field in current Codex versions). Log once if parse fails, move on.

### `~/.cursor/chats/` [NOT PRESENT on Arnav's machine]

Arnav does not have `~/.cursor/`. The scanner should probe, find nothing, emit zero rows, move on. On machines that do have Cursor with chat history, the scanner should parse `~/.cursor/chats/*/state.json` or similar (schema unstable — [ASSUMED]).

## Shell History Time Windows

### Arnav's shell reality [VERIFIED 2026-04-20]

| Shell | File | Present | Size |
|-------|------|---------|------|
| zsh | `~/.zsh_history` | **No — zsh not installed** | — |
| bash | `~/.bash_history` | Yes | 8537 bytes (dated `Apr 20 09:52`) |
| fish | `~/.local/share/fish/fish_history` | No | — |

**Implication**: the rhythm-signal derivation (hour-of-day + day-of-week histograms per SCAN-13) has a **structural hole** on bash-only setups: bash history does NOT record timestamps by default. `HISTTIMEFORMAT` env var must be set at the time of writing, and Arnav's shell does not have it set [VERIFIED: head-3 of `~/.bash_history` shows plain command lines without timestamps].

### Shell history formats

| Shell | Format | Timestamp recoverable |
|-------|--------|----------------------|
| zsh (extended_history) | `: <unix_ts>:<duration>;<command>` per line | **Yes** — per-line unix epoch |
| zsh (plain) | `command\n` | No |
| bash (HISTTIMEFORMAT set) | `#<unix_ts>\n<command>\n` (2-line blocks) | **Yes** — per 2-line block |
| bash (default, Arnav's case) | `command\n` | **No** — only file mtime + append-order |
| fish | YAML-ish: `- cmd: foo\n  when: 1698765432\n  …` | **Yes** — per-entry `when` field in unix seconds |

[CITED: zsh extended_history https://zsh.sourceforge.io/Doc/Release/Options.html#History]
[CITED: bash HISTTIMEFORMAT https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html]
[CITED: fish history YAML format https://fishshell.com/docs/current/interactive.html#id22]

### Recommended Rhythm Derivation Strategy

**Primary source — AI session timestamps** (more reliable than shell history for per-command time data): the mtime of each `.jsonl` in `~/.claude/projects/*/` gives a reliable "work happened at time T" signal. Aggregating across ≥4 session files yields ≥20 timestamps on a working week — sufficient for hour-of-day + day-of-week histograms.

**Secondary source — shell history file mtime** (fallback for shells with no timestamps): `~/.bash_history` mtime = timestamp of last written command. Not helpful alone, but combined with session-file atimes gives a rough "user was active at time T" indicator.

**Tertiary source — filesystem MRU timestamps** (already gathered for SCAN-06): every file edited in the last 7d has an mtime. Aggregating across ≥30 MRU files produces a dense time distribution.

**Rhythm signal count for SCAN-13 (≥3 required)**: output these 3 distinct signals:
1. `peak_hour_of_day`: derived from union of session `.jsonl` mtimes + MRU file mtimes — "peak 10pm-1am UTC"
2. `weekday_distribution`: same sources — "weekday-heavy with Saturday bursts"
3. `active_project_count`: distinct repo-slugs from Claude sessions active in last 7d — "working on 4 repos this week"

All three are **computed heuristically** (D-61 — no LLM required). Optional 4th signal: LLM narrative sentence — gated behind `long_context_provider`.

### Existing `parse_history_file` gap (deep_scan.rs:505-538)

The existing code handles zsh extended timestamps + fish `- cmd:` prefix but **does not extract timestamps for rhythm analysis**. Phase 12 enhancement: return `Vec<(String command, Option<i64> unix_ts)>` instead of `Vec<(String command, usize count)>`. Frequency counts remain derivable from the longer vector; timestamps unlock the rhythm compute.

## Browser Bookmark Parsing

### Arnav's browser reality [VERIFIED]

| Browser | Path probed | Present |
|---------|-------------|---------|
| Chrome (Linux) | `~/.config/google-chrome/Default/Bookmarks` | No |
| Brave (Linux) | `~/.config/BraveSoftware/Brave-Browser/Default/Bookmarks` | No |
| Chrome (Windows via /mnt/c) | `/mnt/c/Users/arnav/AppData/Local/Google/Chrome/User Data/Default/Bookmarks` | **Yes** |
| Firefox (Linux) | `~/.mozilla/firefox/` | Not probed; existing scanner covers |
| Arc | `~/Library/Application Support/Arc/ArcLibrarySQL` (macOS only) | N/A on Linux |

**Implication**: primary bookmark source on Arnav's machine is `/mnt/c/…` — another WSL-crossing hit. Single file read, ~few-hundred-KB — tolerable.

### Chromium bookmarks JSON schema [CITED: Chromium source components/bookmarks/browser/bookmark_codec.cc]

```json
{
  "version": 1,
  "roots": {
    "bookmark_bar": {
      "children": [
        { "type": "url", "name": "…", "url": "https://…", "date_added": "…" },
        { "type": "folder", "name": "…", "children": [ … ] }
      ]
    },
    "other": { "children": [ … ] },
    "synced": { "children": [ … ] }
  }
}
```

The existing `scan_browser_bookmarks` likely does some of this already. Phase 12 enhancement: recursive flatten that returns both **count** (existing) and **top domains** (existing) PLUS **account-hint domains** — `github.com/slayerblade`, `vercel.com/arnav`, `linear.app/arnav` kind of references → feed into AccountRow dedupe.

### Arc Browser SQLite [CITED: https://thebrowser.company]

On Linux / WSL: Arc not present. Skip this scanner path on Linux target.

## `which` Sweep

### Confirmed installed on Arnav's machine [VERIFIED]

- `/usr/bin/git`
- `/home/arnav/.nvm/versions/node/v20.20.1/bin/node` (via nvm)
- `/usr/bin/python3`
- `/home/arnav/.cargo/bin/cargo`
- `/mnt/c/Program Files/Docker/Docker/resources/bin/docker` (Windows-bridged)
- `/home/arnav/.cargo/bin/rustc`
- `/usr/bin/gh`
- `/mnt/c/Users/arnav/AppData/Local/Programs/Microsoft VS Code/bin/code` (Windows-bridged)

**Signal count = 8 distinct CLI tools** already observed. Combined with the curated list (D-59 breadth) of ~40 tools probed, expected detected count ≥15 on Arnav's machine. This alone satisfies SCAN-13 "IDE/AI tool signals ≥3".

### Curated CLI list (expanded from D-59 for the planner)

```rust
const CURATED_CLIS: &[(&str, &str /* category */)] = &[
    // Version control
    ("git", "scm"), ("gh", "scm"), ("glab", "scm"), ("jj", "scm"),
    // Package managers
    ("npm", "pkg"), ("pnpm", "pkg"), ("yarn", "pkg"), ("bun", "pkg"),
    ("pip", "pkg"), ("pip3", "pkg"), ("poetry", "pkg"), ("uv", "pkg"), ("pipx", "pkg"),
    ("cargo", "pkg"), ("rustup", "pkg"),
    ("go", "pkg"),
    ("brew", "pkg"), ("choco", "pkg"), ("scoop", "pkg"), ("nix", "pkg"),
    // Runtimes / compilers
    ("node", "runtime"), ("deno", "runtime"), ("python", "runtime"), ("python3", "runtime"),
    ("ruby", "runtime"), ("rustc", "runtime"),
    // Containers / infra
    ("docker", "infra"), ("kubectl", "infra"), ("helm", "infra"), ("terraform", "infra"),
    ("podman", "infra"), ("k9s", "infra"),
    // Deploy / cloud
    ("vercel", "cloud"), ("wrangler", "cloud"), ("aws", "cloud"), ("gcloud", "cloud"),
    ("supabase", "cloud"), ("railway", "cloud"), ("fly", "cloud"),
    // AI CLIs
    ("claude", "ai"), ("codex", "ai"), ("cursor-agent", "ai"), ("aider", "ai"),
    ("goose", "ai"), ("ollama", "ai"), ("llm", "ai"),
    // OS tooling
    ("rg", "tool"), ("fd", "tool"), ("fzf", "tool"), ("jq", "tool"), ("yq", "tool"),
    ("bat", "tool"), ("eza", "tool"), ("exa", "tool"), ("zoxide", "tool"), ("htop", "tool"),
    ("starship", "tool"), ("tmux", "tool"),
];
```

### Implementation pattern (reuse existing `run_cmd_output` helper from `deep_scan.rs`)

```rust
pub async fn which_sweep(clis: &[(&'static str, &'static str)]) -> Vec<ToolRow> {
    let mut found = Vec::new();
    for (cli, category) in clis {
        // `which` is better cross-platform than `command -v` for subprocess spawn
        if let Some(path) = run_cmd_output("which", &[cli]).await {
            let path = path.trim().lines().next().unwrap_or("").to_string();
            if path.is_empty() { continue; }
            let version = run_cmd_output(cli, &["--version"]).await
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()));
            found.push(ToolRow {
                cli: cli.to_string(),
                installed: true,
                path: Some(path),
                version,
                category: category.to_string(),
            });
        }
    }
    found
}
```

**Edge case**: `--version` on some CLIs prints to stderr, not stdout (notably `rustc --version`). The existing `run_cmd_output` helper may already handle this. If not, merge stdout+stderr.

**Edge case on WSL**: `which docker` returns `/mnt/c/Program Files/Docker/Docker/resources/bin/docker` — a path with a space. Any downstream code that shell-quotes this must handle it properly.

## Tauri Additive Event Payload Extension

### Can we emit `serde_json::Value` with extra fields without breaking TS consumers?

**Yes — verified by codebase inspection.**

[VERIFIED: src/features/onboarding/DeepScanStep.tsx:42-44]:
```tsx
useTauriEvent<DeepScanProgressPayload>(BLADE_EVENTS.DEEP_SCAN_PROGRESS, (e) => {
  observePhase(e.payload.phase, e.payload.found);
});
```

The consumer destructures **only** `e.payload.phase` and `e.payload.found`. TypeScript structural typing allows extra fields on an object without narrowing errors — the `DeepScanProgressPayload` interface at `src/lib/events/payloads.ts:234-237` declares:
```ts
export interface DeepScanProgressPayload {
  phase: string;
  found: number;
}
```

Extending this interface with **optional** fields (`?:`) is a backward-compatible change per TypeScript structural subtyping:
```ts
export interface DeepScanProgressPayload {
  phase: string;
  found: number;
  // Phase 12 additive (D-64):
  lead_kind?: string;
  lead_seed?: string;
  priority_tier?: 'hot' | 'warm' | 'cold';
  queue_depth?: number;
  elapsed_ms?: number;
  message?: string;
}
```

**No consumers break.** The existing onboarding destructure uses only `phase` + `found`; a new ProfileView live-tail consumer reads the new optional fields. Rust side emits the full JSON blob; Rust does not care about the TS interface shape; TS type-checks against the updated interface and compiles.

### `phase` name stability gate

`deepScanPhases.ts` [VERIFIED] declares 11 phase names as `as const`. The `verify:scan-event-compat` gate must assert every one of these names is still a phase the new scanner emits. Current fixed list:
```
starting, installed_apps, git_repos, ides, ai_tools, wsl_distros,
ssh_keys, package_managers, docker, bookmarks, complete
```

**Migration plan for phase names**:
- Keep `starting` and `complete` — unchanged.
- Keep `git_repos`, `ides`, `ai_tools`, `bookmarks` — 1:1 with new scanners.
- Keep `installed_apps`, `wsl_distros`, `ssh_keys`, `package_managers`, `docker` — even though these merge conceptually with the `which_sweep` / `fs_repos` / new scanners, emit a single phase-event with the old name once during the corresponding new-scanner finish (the "found" count can be 0 if that class is disabled). Alternative: expand `DEEP_SCAN_PHASES` to include new names AND keep old names as aliases — old names become "legacy compat" emits.
- Add new phase names (not in old list): `fs_mru`, `git_remotes`, `shell_history`, `rhythm_compute`, `llm_enrich`, `cancelled`, `lead_dequeue`.

The `verify:scan-event-compat` gate reads the TS const array + scans the Rust source for `emit(…phase…)` string literals + intersects.

## Overlay I/O Serialization & Race Avoidance

### The race

User edits `profile_overlay.json` via UI → `profile_overlay_upsert` Tauri command writes the file. Simultaneously, `deep_scan_start` → drain → `save_results(&results)` writes `scan_results.json` and (per D-62 render layer) may read `profile_overlay.json` to compute the rendered view.

The **two files are independent** — `scan_results.json` write never touches `profile_overlay.json`. But the `profile_get_rendered` command reads BOTH and merges them; an interleaved write during read could surface a partially-written overlay.

### Serializer pattern

```rust
// src-tauri/src/deep_scan/profile.rs

use std::sync::LazyLock;
use tokio::sync::Mutex;

static OVERLAY_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub async fn upsert_overlay(row_id: String, entry: OverlayEntry) -> Result<(), String> {
    let _guard = OVERLAY_LOCK.lock().await;
    let mut current = load_overlay().unwrap_or_default();
    current.rows.insert(row_id, entry);
    save_overlay_atomic(&current)?;
    Ok(())
}

pub async fn render_profile() -> Result<ProfileView, String> {
    let _guard = OVERLAY_LOCK.lock().await;
    let scan = load_scan_results().ok_or("no scan yet")?;
    let overlay = load_overlay().unwrap_or_default();
    Ok(merge_scan_with_overlay(scan, overlay))
}
```

**Atomic write pattern** (prevents torn reads if process crashes mid-write):
```rust
fn save_overlay_atomic(overlay: &ProfileOverlay) -> Result<(), String> {
    let path = overlay_path();
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(overlay).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
```

**Why this is sufficient** (instead of `RwLock` or file-system advisory locks):
- Scanner never writes overlay (enforced by `verify:scan-no-write` gate — write paths outside `blade_config_dir()/identity/*` are grep-rejected).
- All overlay mutations funnel through 3 Tauri commands (`profile_overlay_upsert`, `profile_overlay_reset`, render); all acquire `OVERLAY_LOCK`.
- Scanner's `save_results` writes `scan_results.json` only — different file.
- `fs::rename` is atomic on POSIX + NTFS via the underlying `renameat` / `MoveFileEx` — no torn-write window.

**Alternative considered** — Tauri managed state via `app.manage(Arc<Mutex<...>>)`: requires `use tauri::Manager;` import + state-handle threading through every command. `LazyLock<Mutex<()>>` is simpler and standard in the tree (see 29 `AtomicBool` examples as the same pattern at a smaller scale).

### Merge algorithm

```rust
pub fn merge_scan_with_overlay(scan: DeepScanResults, overlay: ProfileOverlay) -> ProfileView {
    let mut view = ProfileView::new();
    let scan_ids: std::collections::HashSet<String> =
        scan.all_rows().iter().map(|r| r.row_id()).collect();

    // 1. Walk every scan row, apply overlay if present
    for row in scan.all_rows() {
        let rid = row.row_id();
        match overlay.rows.get(&rid) {
            Some(e) if matches!(e.action, OverlayAction::Hide | OverlayAction::Delete) => continue,
            Some(e) if matches!(e.action, OverlayAction::Edit) => {
                let mut edited = row.clone();
                edited.apply_fields(&e.fields);
                edited.edited_at = Some(e.edited_at);
                view.push(edited);
            }
            _ => view.push(row),
        }
    }

    // 2. Append user-added rows
    for (rid, entry) in &overlay.rows {
        if matches!(entry.action, OverlayAction::Add) {
            view.push(Row::custom_from(rid, &entry.fields));
        }
    }

    // 3. Surface orphans
    for (rid, entry) in &overlay.rows {
        if !matches!(entry.action, OverlayAction::Edit) { continue; }
        if !scan_ids.contains(rid) {
            let mut orphan = Row::empty_for_id(rid);
            orphan.apply_fields(&entry.fields);
            orphan.orphaned = true;
            view.push(orphan);
        }
    }

    view
}
```

### row_id schema (stable across re-scan)

Per D-62: `{row_kind}:{primary_key}`. Concrete examples:

| Row kind | row_id format | Example |
|----------|--------------|---------|
| Repo | `repo:{canonical_abs_path}` | `repo:/home/arnav/blade` |
| Account | `account:{platform}:{handle}` | `account:github:slayerblade` |
| IDE | `ide:{name}` | `ide:VS Code` |
| MRU file | `file:{canonical_abs_path}` | `file:/home/arnav/blade/src/main.rs` |
| Tool | `tool:{cli}` | `tool:cargo` |
| Bookmark | `bookmark:{browser}:{domain}` | `bookmark:Chrome:github.com` |
| User-added | `custom:{section}:{counter}` | `custom:account:1` |

**Canonicalization** is critical: `~/blade`, `/home/arnav/blade`, `/home/arnav/./blade` must all normalize to `/home/arnav/blade`. Use `std::fs::canonicalize()` at row-creation time — one syscall per row, acceptable.

## LLM Enrichment from `deep_scan`

### The boundary enforcement

`verify:scan-no-egress` gate will fail if `deep_scan/*.rs` imports `reqwest::`, `isahc::`, `http::`, `ureq::`, `TcpStream`, or `UdpSocket`. This means **LLM calls cannot live inside the `deep_scan` module**. Instead:

1. `deep_scan/enrichment.rs` builds the prompts + input data + capability requirement.
2. Calls into `crate::commands::llm_one_shot_with_capability(prompt, capability, timeout_ms)` — a new thin helper in `commands.rs`.
3. That helper uses `providers::complete_turn` (which does contain `reqwest`) — the egress lives there, not in `deep_scan`.

### Provider selection integration

```rust
// commands.rs (new helper — wraps existing provider surface)
pub async fn llm_one_shot_with_capability(
    prompt: String,
    capability: Option<&str>,  // "long_context" | "tools" | None
    timeout_ms: u64,
) -> Result<String, String> {
    let cfg = crate::config::load_config();

    // 1. Pick provider via Phase 11 logic
    let (provider, model, api_key) = match capability {
        Some("long_context") if cfg.long_context_provider.is_some() => {
            let slot = cfg.long_context_provider.as_deref().unwrap();
            let (p, m) = crate::providers::parse_model_string(slot, &cfg.provider);
            (p.to_string(), m.to_string(), crate::config::get_provider_key(p))
        }
        _ => (cfg.provider.clone(), cfg.model.clone(), cfg.api_key.clone()),
    };

    // 2. Empty key → return silently (no LLM available, skip enrichment)
    if api_key.is_empty() && provider != "ollama" {
        return Err("no_provider_available".to_string());  // caller logs once
    }

    // 3. One-shot call with timeout
    let messages = vec![ConversationMessage::User(prompt)];
    let no_tools: Vec<ToolDefinition> = vec![];
    let fut = crate::providers::complete_turn(
        &provider, &api_key, &model, &messages, &no_tools, cfg.base_url.as_deref(),
    );
    match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), fut).await {
        Ok(Ok(turn)) => Ok(turn.content),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("timeout".to_string()),
    }
}
```

[VERIFIED: `providers::complete_turn` signature at src-tauri/src/providers/mod.rs — used by 8 call-sites in commands.rs; this helper wraps that].
[VERIFIED: `parse_model_string` at src-tauri/src/providers/mod.rs:49 — splits `"anthropic/claude-sonnet-4"` into `("anthropic", "claude-sonnet-4")`].

### The 3 enrichment calls

```rust
// src-tauri/src/deep_scan/enrichment.rs

pub async fn run_gated(results: &mut DeepScanResults, app: &AppHandle) -> Result<(), String> {
    let mut calls_made = 0;
    let mut errors: Vec<String> = Vec::new();

    // Call 1 — account narrative
    if calls_made < 3 && !results.accounts.is_empty() && needs_enrichment(&results.account_narrative) {
        let prompt = account_narrative_prompt(&results.accounts);
        emit_llm_phase(app, "account_narrative");
        match crate::commands::llm_one_shot_with_capability(prompt, Some("long_context"), 10_000).await {
            Ok(text) => { results.account_narrative = Some(text); results.account_narrative_at = Some(Utc::now()); }
            Err(e) => errors.push(format!("account_narrative: {e}")),
        }
        calls_made += 1;
    }

    // Call 2 — rhythm narrative
    if calls_made < 3 && !results.rhythm_signals.is_empty() && needs_enrichment(&results.rhythm_narrative) {
        let prompt = rhythm_narrative_prompt(&results.rhythm_signals);
        emit_llm_phase(app, "rhythm_narrative");
        match crate::commands::llm_one_shot_with_capability(prompt, None, 10_000).await {
            Ok(text) => { results.rhythm_narrative = Some(text); results.rhythm_narrative_at = Some(Utc::now()); }
            Err(e) => errors.push(format!("rhythm_narrative: {e}")),
        }
        calls_made += 1;
    }

    // Call 3 — ambiguous repo language (picks ≤1 candidate per scan)
    if calls_made < 3 {
        if let Some(ambiguous_repo) = pick_ambiguous_repo(&results.git_repos) {
            let prompt = ambiguous_language_prompt(&ambiguous_repo);
            emit_llm_phase(app, "ambiguous_language");
            match crate::commands::llm_one_shot_with_capability(prompt, None, 10_000).await {
                Ok(text) => enrich_repo_language(&mut results.git_repos, &ambiguous_repo.path, &text),
                Err(e) => errors.push(format!("ambiguous_language: {e}")),
            }
            calls_made += 1;
        }
    }

    // Log once, not in a loop (4ab464c silence-discipline)
    if !errors.is_empty() {
        log::warn!("deep_scan enrichment: {} errors — {}", errors.len(), errors.join("; "));
    }
    Ok(())
}

fn needs_enrichment(narrative: &Option<String>) -> bool {
    narrative.is_none() || cached_older_than(narrative, chrono::Duration::days(7))
}
```

**Per-row cache**: each enriched row has a `last_enriched_at` timestamp. Re-scan within 7 days reuses; older re-scans re-invoke. This is the D-61 7-day cache.

### The "scan never blocks on LLM" invariant

Scan results are `Ok(results)` returnable WITHOUT waiting on enrichment. Recommended pattern: kick off enrichment via `tokio::task::spawn` AFTER writing `scan_results.json` initially, write an updated `scan_results.json` when enrichment completes. This means:
- UI sees scan complete within 30-60s (no LLM latency).
- LLM narrative appears in UI on next view refresh (enrichment settles in background).
- Live-tail emits an `llm_enrich` phase-event when each call lands.

Alternative (simpler): run enrichment inline before returning, with a 10s timeout per call (30s worst-case across 3 calls). Acceptable given baseline target: 30-60s total scan + 0-30s enrichment = still <2 min. Default to inline for Phase 12 MVP.

## Runtime State Inventory

Phase 12 is a backend refactor + new UI surface. **The critical runtime-state question is whether any stored data needs migration**, or whether all changes are code-level.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **`~/.blade/identity/scan_results.json`** — exists on machines where previous deep_scan ran. Schema grows additively in Phase 12 (new fields `accounts`, `rhythm_signals`, `mru_files`, `account_narrative`, etc.). Old files load fine; missing fields default to empty. | None — serde defaults handle this. Verify with a round-trip test: save old-format JSON, load → all new fields = default, save → schema grows. |
| Stored data | **`~/.blade/identity/profile_overlay.json`** — new file; does not exist in any prior install. First `profile_overlay_upsert` creates it. | None — file is created on first write. |
| Live service config | No external services. Phase 12 is local-only by D-65 egress gate. | None. |
| OS-registered state | No OS-level registrations (no Windows task scheduler entry, no systemd unit, no launch agent). | None. |
| Secrets / env vars | LLM enrichment calls use existing keyring entries (same as Phase 11 capability probe). `scan_classes_enabled` is a config struct, no new secrets. | None. |
| Build artifacts | `target/` (Rust build dir) — after the D-66 cutover from `deep_scan.rs` to `deep_scan/mod.rs`, the old object files and rlibs are stale. `cargo clean` not required — incremental build handles it. | Verify first Wave-0 build succeeds; if any stale symbol collision, `cargo clean` once. |
| Build artifacts | React build cache in `dist/` — no impact. | None. |

**Key insight**: there is NO data migration step. The D-66 "additive schema" invariant on `DeepScanResults` is the entire migration story. Old `scan_results.json` files continue to load; new fields default to empty; first new scan fills them in.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | Core build | yes | stable (1.80+ implied by Phase 11 LazyLock usage) | — |
| `cargo` | Build | yes | stable | — |
| `git` CLI | `.git/config` parse indirect + used by dev workflow | yes | 2.x | — |
| `node` + `npm` | Frontend build | yes | Node 20.20.1 | — |
| `walkdir` crate | Filesystem walks | yes (transitive) | 2.5.0 | none needed; direct-dep if explicit mention required |
| `reqwest` | LLM enrichment (from `providers/` only) | yes | 0.12 | — |
| `tokio` full features | async runtime + `spawn_blocking` + `sync::Mutex` | yes | 1.x full | — |
| Existing `providers::complete_turn` | LLM enrichment backend | yes | — | if empty key/keyring, enrichment skipped silently |
| Phase 11 `long_context_provider` config field | Capability-aware LLM routing | yes [VERIFIED: config.rs:424, 488, 634, 691] | — | falls back to primary provider if unset |
| `~/.blade/identity/` directory | Scan results + overlay persistence | Created on demand via `create_dir_all` | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- LLM providers (if keyring empty): enrichment silently skipped; scan still produces heuristic output.
- `~/.claude/` / `~/.codex/` / `~/.cursor/` directories: if missing, the respective AI-session scanner emits zero rows and moves on. Arnav's machine has `~/.claude/` and `~/.codex/` but NOT `~/.cursor/` — this is the expected real-world shape.

## Baseline Feasibility on Arnav's Machine (SCAN-13 Falsifiability)

**The critical question**: will the new scanner actually produce ≥10 repos / ≥5 accounts / ≥3 rhythm / ≥3 IDE-AI signals on Arnav's cold-install environment?

### ≥10 repos

[VERIFIED via maxdepth-2 `.git` search on 2026-04-20]: **8 `.git` directories visible at maxdepth 2**:
1. `/home/arnav/blade/.git`
2. `/home/arnav/Staq/.git`
3. `/home/arnav/SlayerBlade/.git`
4. `/home/arnav/glurk/.git`
5. `/home/arnav/sangathan/.git`
6. `/home/arnav/playtheta/.git`
7. `/home/arnav/OP_SETUP/.git`
8. `/home/arnav/.nvm/.git` (nvm's own repo — will be filtered by ignore list; does not count)

With maxdepth 6 walk, additional nested repos likely found: `gemini-cli`, `model-mesh`, `sangathan`, `finovo`, `prodhouse`, — measured via `~/.claude/projects/` slug enumeration showing at least 5 distinct project slugs. Conservative estimate: **12-18 repos** under maxdepth 6 walk of `/home/arnav/`.

**Gate**: Wave 2 manual trace confirms actual count.

### ≥5 accounts

Sources:
- Git remotes from 8+ repos → likely all github.com/{same-handle} (Arnav's primary account) — counts as 1 unique account.
- SSH key comments from existing `scan_ssh_keys` — `~/.ssh/id_rsa.pub` `-C email` field — typically 1-2 emails.
- Additional git remotes if Staq/sangathan/playtheta have remotes on different platforms (e.g., GitLab, Bitbucket) — would add accounts.
- AccountRow dedupe: `(platform, handle)` pair is the unique key.

**Risk**: Arnav's setup may produce ≤3 unique `(platform, handle)` pairs if all repos are GitHub under one handle. To reach ≥5, the scanner must also count:
- `~/.gitconfig` `[user] email = …` entries — surfaces personal email.
- Shell history `npm config set registry` / `docker login` / similar auth commands — surfaces registry accounts.
- Browser bookmarks for `github.com/{org}`, `vercel.com/{team}`, `linear.app/{org}` → surface org-level accounts.

**Recommendation**: the `AccountRow` schema should include account kind (`primary_git`, `org_git`, `email`, `registry`, `cloud_service`). Count unique `(platform, handle, kind)` tuples for the ≥5 threshold. Document this threshold interpretation in the verify trace.

### ≥3 rhythm signals

Per Shell History Time Windows section, 3 heuristic signals computable from AI session mtimes + MRU file mtimes + shell-history frequency. On Arnav's machine:
- AI session mtimes: ≥4 sessions × ~10 `.jsonl` files each = ≥40 timestamps — ample.
- MRU file mtimes: ≥30 files edited in last 7 days.
- Shell-history frequency: bash_history has ~100 lines — frequency counts computable.

Threshold: **3 rhythm signals required** (SCAN-13). Deliverable: `peak_hour_of_day`, `weekday_distribution`, `active_project_count`. All three compute deterministically from gathered data. **No risk.**

### ≥3 IDE/AI tool signals

Sources:
- IDE artifacts: VS Code on Windows-side (via /mnt/c probe) = 1 signal.
- AI sessions: Claude Code sessions ≥4 slugs = 1 signal (`AiToolRow { name: "Claude Code", session_count: 4, last_active: … }`).
- `which` sweep: `gh`, `docker`, `node`, `cargo`, `rustc`, `git`, `code`, `claude` (if installed globally) — ≥5 signals.

Combined: **≥7 tool signals**. **Threshold easily met.**

### Summary

| Metric | Threshold | Expected on Arnav | Confidence |
|--------|-----------|-------------------|------------|
| Repos | ≥10 | 12-18 | HIGH |
| Accounts | ≥5 | 3-8 (depends on scanner account-kind expansion) | MEDIUM — may need scanner enhancement beyond remote parsing |
| Rhythm signals | ≥3 | 3 computed + optional LLM narrative | HIGH |
| IDE/AI tool signals | ≥3 | 7+ | HIGH |

**Account count is the ONLY baseline threshold with moderate risk.** Mitigation: the Wave 0 Plan 12-02 scanner for accounts should include the `account_kind` expansion above. Document this as a specific planner action.

## Architecture Patterns

### Pattern 1: Priority queue with lead follow-ups

**What**: Single async task drains a 3-tier `VecDeque` structure. Scanner functions return `(Vec<Row>, Vec<Lead>)`; the orchestrator appends rows and enqueues follow-ups. Same tier by default; upgrade to Hot when the follow-up target is <7d old.

**When to use**: any breadth-first exploration where early discoveries inform later ones (git repo found → read its remote → see its IDE config → discover another repo referenced by it).

### Pattern 2: Additive event-payload extension

**What**: Add `?:`-optional fields to an existing TS interface; emit `serde_json::Value` with the extra fields from Rust. Old consumers keep working.

**When to use**: any event whose shape needs to grow without breaking existing subscribers — this is Phase 12's primary frontend-compat strategy.

### Pattern 3: 6-place config pattern (existing)

**What**: Every new `BladeConfig` field touches 6 locations. Enforced by `verify:wiring-audit-shape` and `verify:providers-capability` sibling gates.

**Phase 12 application**: `ScanClassesEnabled` struct with 8 bool fields.

### Pattern 4: Atomic-rename file I/O for crash-safe persistence

**What**: `fs::write(tmp) → fs::rename(tmp, final)` — atomic on POSIX + NTFS.

**When to use**: any persistence where a crash mid-write would corrupt the file. Used by `profile_overlay.json` because user edits are load-bearing.

### Pattern 5: Single-writer registry append

**What**: `src/features/identity/index.tsx` is the 8-entry registry. New entries APPENDED only; existing entries NOT modified. Enforced by D-143 single-writer invariant.

**Phase 12 application**: `ProfileView` is the 8th entry.

### Anti-Patterns to Avoid

- **Parallel scanners via `tokio::join!`**: replicates the current failure mode — progress events arrive out of order, narrative is incoherent, Hot leads do not actually run before Cold ones.
- **`BinaryHeap<Lead>` for the queue**: loses within-tier FIFO; breaks "scan thinks out loud."
- **`git2` or `gix-config` crate for .git/config parsing**: plain-text parse + regex is 10 lines; adding a crate for 50-200 files is overkill and risks new system deps.
- **LLM calls inside `deep_scan/*.rs`**: violates `verify:scan-no-egress` by construction. Call from `providers/` via a thin helper in `commands.rs`.
- **Overwriting user edits on re-scan**: D-62 overlay pattern prevents this; never "smart-merge."
- **Byte-slicing paths for log truncation**: panics on non-ASCII path segments; use `crate::safe_slice(&path_str, 40)`.
- **`scan_cancel` check mid-scanner-body**: leads may hold resources; check between leads only.
- **Mutating `src/features/identity/index.tsx` existing entries**: single-writer invariant; append only.
- **New Rust crate with system-lib deps**: risks WSL build breakage (libspa-sys, libclang from v1.0 checkpoints).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filesystem walks with depth caps + ignore lists | Custom recursive traversal with counters | `walkdir::WalkDir::new(root).max_depth(6).follow_links(false).into_iter().filter_entry(…)` | walkdir handles symlink loops, cross-device boundaries, permission errors. |
| Priority-queue semantics | Linked-list + comparator | `std::collections::VecDeque<T>` × 3 (Hot/Warm/Cold) | O(1) push/pop both ends; already in std. |
| .git/config parsing | INI-format parser | Plain-text `read_to_string` + 2 regexes | 5 lines; libgit2 / gix-config overkill for 50-200 files. |
| Atomic file write | Manual copy + delete | `fs::write(tmp) + fs::rename(tmp, final)` | Rename is atomic at OS level; crash-safe. |
| JSON schema evolution | Version-tagged migration scripts | `#[serde(default)]` on every new field | Existing 6-place pattern handles this; Phase 11 successfully did it for 5 new fields. |
| Provider model-string parsing | Custom split | `providers::parse_model_string` (existing) | Already handles `"anthropic/claude-sonnet-4"` and edge cases. |
| LLM one-shot calls | New HTTP client | `providers::complete_turn` + a new thin helper in `commands.rs` | Reuses fallback chain, keyring, provider matrix. |
| Cancel sentinel | Tauri state handle | `static CANCEL: AtomicBool = AtomicBool::new(false);` | 29 existing sentinels in tree use this pattern. |
| Home directory cross-platform | Env var `HOME` / registry | `dirs::home_dir()` | Already in tree; handles Windows/macOS/Linux. |
| Async mutex | `std::sync::Mutex` (can block tokio runtime) | `tokio::sync::Mutex` | Used elsewhere in tree; tokio feature `"full"` is on. |
| Drag-and-drop for profile rows | DnD library | Not needed in Phase 12 | Profile tabs use sort-column clicks, not reordering. |
| Table pagination | New virtualizer | `@tanstack/react-virtual` (already in tree at `package.json:63`) | Repos tab with 50+ rows → use virtual list if needed. |
| Source pill / Badge | New primitive | `<Pill>` from `src/design-system/primitives/Pill` | Already exists; UI-SPEC locks this. |

**Key insight**: Phase 12 adds exactly 4 new Rust `#[tauri::command]` functions (`profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`, `scan_cancel`) + 1 new React component (`ProfileView` + its 5 tab sub-components) + extensions to 4 existing surfaces (identity registry, PrivacyPane, `src/lib/tauri/deepscan.ts`, `DeepScanProgressPayload`). Every other piece is reshuffling existing Rust code into a new module layout.

## Common Pitfalls

### Pitfall 1: `scan_cancel` command name collision

**What goes wrong**: `scan_cancel` is a verb-noun pattern; another module might already have a `#[tauri::command] fn cancel(…)` named in the same flat Tauri namespace.

**Why it happens**: Tauri's `generate_handler!` macro is FLAT — no module qualification.

**How to avoid**: grep for `#[tauri::command]` attributes in the Rust source before registering; grep for `fn cancel` / `fn scan_cancel`. [VERIFIED 2026-04-20: no collision today for these four names.]

**Warning signs**: cryptic `duplicate definition` during `cargo check` at the `generate_handler!` macro expansion site.

### Pitfall 2: WSL `/mnt/c/` symlink crossing during fs walk

**What goes wrong**: scanner walks `/home/arnav/` with `follow_links(true)`, finds a symlink like `~/windows → /mnt/c/`, spends the rest of the 60s budget walking Windows filesystem at 9P throughput, produces almost no results.

**Why it happens**: WSL2 9P filesystem between Linux and Windows is ~10x slower than native Linux.

**How to avoid**: `walkdir::WalkDir::new(root).follow_links(false)`. Additionally, add `/mnt` to the ignore list when probing under `$HOME`. The bookmark scanner explicitly CROSSES the boundary on purpose (to read the Windows Chrome Bookmarks file) — that is a single file read, not a walk, so it is fine.

**Warning signs**: scan takes >60s on WSL; `~/.claude/projects/` never enqueued because the walker is still inside `/mnt/c/`.

### Pitfall 3: `.bash_history` has no timestamps on Arnav's machine

**What goes wrong**: rhythm-signal code calls `parse_bash_history_with_timestamps` → gets empty timestamp list → rhythm histogram is empty → SCAN-13 rhythm threshold fails.

**Why it happens**: bash stores timestamps only if `HISTTIMEFORMAT` env var is set at command-write time.

**How to avoid**: Shell History Time Windows section — rhythm signals use AI-session mtimes + MRU file mtimes as the PRIMARY timestamp source, not shell history. Shell history contributes command-frequency counts only.

**Warning signs**: rhythm histogram is flat or empty despite the user being actively working.

### Pitfall 4: AI session slug translation edge cases

**What goes wrong**: `slug_to_project_path("-home-arnav-my-project")` — does `my-project` become `/home/arnav/my/project` (replacing `-` with `/`) or `/home/arnav/my-project` (preserving internal dashes)?

**Why it happens**: the slug scheme is lossy — dashes in original paths are indistinguishable from path separators.

**How to avoid**: after slug-reversal candidate path, verify `fs::metadata(&candidate).is_ok()` — if the decoded path does not exist, try alternate decodings (greedy vs lazy on `-` splits). Fallback: walk `~/` for any directory whose name matches the slug's tail segment.

**Warning signs**: `ProjectRootHint` leads enqueued at nonexistent paths; their `FsRepoWalk` follow-ups all no-op.

### Pitfall 5: `~/.blade/identity/` does not exist on first-run

**What goes wrong**: `save_overlay_atomic` writes to `~/.blade/identity/profile_overlay.json`, but the parent dir `~/.blade/identity/` does not exist because `deep_scan_start` has not run yet, OR the user deleted `~/.blade/` manually.

**Why it happens**: `scan_results_path()` creates the directory; `overlay_path()` must too.

**How to avoid**: every write path calls `create_dir_all(path.parent())` first — see existing `save_results` at `deep_scan.rs:122`. Mirror in `save_overlay_atomic`.

**Warning signs**: `profile_overlay_upsert` returns `Err("No such file or directory (os error 2)")`.

### Pitfall 6: Non-canonical paths break row_id dedupe

**What goes wrong**: overlay saves edit for `repo:~/blade`; re-scan produces `repo:/home/arnav/blade`; merge does not find overlay entry; edit appears lost.

**Why it happens**: `~` expansion varies. Tilde may or may not be resolved.

**How to avoid**: `fs::canonicalize(path)` at row-id creation in BOTH the scanner AND the overlay-upsert path. Canonical path is absolute + symlinks resolved.

**Warning signs**: user edits visible immediately disappear after re-scan.

### Pitfall 7: `ScanClassesEnabled` 6-place violation

**What goes wrong**: developer adds the field to `DiskConfig` struct only; `load_config` does not populate it; `BladeConfig.scan_classes_enabled` is always default; Settings toggle has no effect.

**Why it happens**: 6 places is easy to miscount; `load_config` / `save_config` are far from the struct definition.

**How to avoid**: extend `scripts/verify-providers-capability.mjs` (which already does 6-place counting for Phase 11 fields) with the 8 `ScanClassesEnabled` sub-fields. Alternatively, since `scan_classes_enabled` is a single struct-valued field (not 8 separate fields), it only needs 6 places for the struct itself — still count manually.

**Warning signs**: toggling any Privacy checkbox saves, restart app, checkboxes reset to defaults.

### Pitfall 8: Scanner enqueues a follow-up for a path already visited

**What goes wrong**: `scan_ai_sessions` enqueues `FsRepoWalk` for `/home/arnav/blade`, which was already enqueued by `fs_mru` seeding. Duplicate walk wastes budget.

**Why it happens**: no cross-scanner visited-set.

**How to avoid**: `LeadQueue::enqueue` dedupes against `self.visited: HashSet<PathBuf>` on any lead with a `path` payload field — see queue.rs sketch.

**Warning signs**: same path appears in live-tail log twice; queue_depth does not decrease monotonically.

### Pitfall 9: Onboarding progress-ring breaks from new phase names

**What goes wrong**: new scanner emits `phase: "fs_mru"` which is not in `DEEP_SCAN_PHASES` array → onboarding's `deepScanPercent` returns 0 for that event → progress ring stutters.

**Why it happens**: `deepScanPercent` at `deepScanPhases.ts:43-50` divides by `DEEP_SCAN_PHASES.length - 1`; unknown phases do not count.

**How to avoid**: EITHER emit the old phase names AS WELL (one emit per old-name scanner-group completion, found=count), OR expand `DEEP_SCAN_PHASES` array first (Wave 0 Plan 12-01 edit) so the new names count. `verify:scan-event-compat` catches this.

**Warning signs**: onboarding progress ring stuck at 0% or jumps non-monotonically.

### Pitfall 10: Overlay `delete` vs `hide` semantics confusion

**What goes wrong**: user chooses "Delete row"; re-scan finds the row again; row reappears — user expected permanent deletion.

**Why it happens**: `delete` and `hide` both filter from render; the difference is whether the overlay entry persists after an edit-reset.

**How to avoid**: **semantics to lock in Plan 12-03**:
- **hide**: overlay entry `{action: "hide"}`. Row filtered from render. Re-scan finds it, overlay still filters. User can unhide (→ overlay entry removed) → row reappears. The row "resurfaces" conceptually because the user did not want it permanently gone.
- **delete**: overlay entry `{action: "delete"}`. Row filtered from render. Re-scan finds it, overlay still filters (the row remains filtered even across scans). User can un-delete via "Reset to scan" (→ overlay entry removed) → row reappears.
- **Functionally `delete` and `hide` are identical on first scan**. The distinction is UX labeling: "Hide" = "hide from current view", "Delete" = "permanently exclude". Both are reversible via `profile_overlay_reset`. This is NOT a destructive operation on the scan data — the underlying scan_results.json row is never touched.
- **If the user expects destruction**, document the CAVEAT that re-scan will re-find the row; the overlay persists the user's "exclude" intent but the underlying data is not altered.

**Warning signs**: user files a bug report: "I deleted this repo, why is it back?"

## Code Examples

### `.git/config` remote parse (scanner body)

```rust
// src-tauri/src/deep_scan/scanners/git_remotes.rs
use regex::Regex;
use std::sync::LazyLock;
use std::path::Path;

static RE_REMOTE_SECTION: LazyLock<Regex> = LazyLock::new(||
    Regex::new(r#"(?m)^\[remote\s+"([^"]+)"\]"#).unwrap()
);
static RE_URL_LINE: LazyLock<Regex> = LazyLock::new(||
    Regex::new(r#"(?m)^\s*url\s*=\s*(.+?)\s*$"#).unwrap()
);

pub fn parse_git_config(content: &str) -> Vec<(String, String)> {
    let mut remotes = Vec::new();
    let mut current: Option<String> = None;
    for line in content.lines() {
        if let Some(cap) = RE_REMOTE_SECTION.captures(line) {
            current = Some(cap.get(1).unwrap().as_str().to_string());
        } else if line.trim_start().starts_with('[') {
            current = None;
        } else if let Some(ref name) = current {
            if let Some(cap) = RE_URL_LINE.captures(line) {
                remotes.push((name.clone(), cap.get(1).unwrap().as_str().to_string()));
            }
        }
    }
    remotes
}

pub fn run(lead: crate::deep_scan::queue::Lead) -> (Vec<crate::deep_scan::Row>, Vec<crate::deep_scan::queue::Lead>) {
    let repo_path = lead.payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let config_path = Path::new(repo_path).join(".git").join("config");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return (vec![], vec![]),
    };
    let remotes = parse_git_config(&content);
    let mut rows = Vec::new();
    let followups = Vec::new();
    for (remote_name, url) in remotes {
        rows.push(crate::deep_scan::Row::RepoEnriched {
            path: repo_path.to_string(),
            remote_name: remote_name.clone(),
            remote_url: url.clone(),
        });
        if let Some(account) = account_from_remote(&url) {
            rows.push(crate::deep_scan::Row::Account(account));
        }
    }
    (rows, followups)
}
```

### AI session slug → project path (scanner body with Hot follow-up)

```rust
// src-tauri/src/deep_scan/scanners/ai_sessions.rs
use std::path::PathBuf;

pub fn slug_to_project_path(slug: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(slug.replace('-', "/"));
    if candidate.exists() { Some(candidate) } else { None }
}

pub fn run(lead: crate::deep_scan::queue::Lead) -> (Vec<crate::deep_scan::Row>, Vec<crate::deep_scan::queue::Lead>) {
    let projects_dir = dirs::home_dir().map(|h| h.join(".claude/projects")).unwrap_or_default();
    if !projects_dir.exists() { return (vec![], vec![]); }
    let mut rows = Vec::new();
    let mut followups = Vec::new();
    let Ok(entries) = std::fs::read_dir(&projects_dir) else { return (vec![], vec![]); };
    for entry in entries.filter_map(|e| e.ok()) {
        let slug = entry.file_name().to_string_lossy().to_string();
        if let Some(project_path) = slug_to_project_path(&slug) {
            rows.push(crate::deep_scan::Row::AiSession {
                tool: "Claude Code".to_string(),
                slug: slug.clone(),
                project_path: project_path.to_string_lossy().to_string(),
            });
            // Enqueue a Hot FsRepoWalk for this project path
            followups.push(crate::deep_scan::queue::Lead {
                kind: crate::deep_scan::queue::LeadKind::FsRepoWalk,
                priority_tier: crate::deep_scan::queue::Tier::Hot,
                seed_source: crate::deep_scan::queue::SeedSource::AiSession(slug),
                payload: serde_json::json!({ "path": project_path.to_string_lossy() }),
                enqueued_at: chrono::Utc::now(),
            });
        }
    }
    (rows, followups)
}
```

### Overlay merge (scan × overlay → rendered)

See Overlay I/O Serialization section for the full `merge_scan_with_overlay` function.

### `scan_cancel` wiring

```rust
// src-tauri/src/deep_scan/mod.rs (new command)
use crate::deep_scan::queue::SCAN_CANCEL;
use std::sync::atomic::Ordering;

#[tauri::command]
pub async fn scan_cancel() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

// In drain loop:
// - Reset the flag at scan START (not end) so a cancelled flag does not leak to next run
pub async fn deep_scan_start(app: AppHandle) -> Result<DeepScanResults, String> {
    SCAN_CANCEL.store(false, Ordering::SeqCst);
    // ... seed queue, drain ...
}
```

## 6-Place Config Plan for `ScanClassesEnabled`

Based on [VERIFIED: config.rs line ranges from grep of `integration_polling_enabled` + `vision_provider`]:

| Place | File location | What to add |
|-------|---------------|-------------|
| 1. `DiskConfig` struct | `config.rs` — after line 200 (near other bool flags) | `#[serde(default = "default_scan_classes_enabled")] scan_classes_enabled: ScanClassesEnabled,` |
| 2. `DiskConfig::default()` | `config.rs` — after line 294 | `scan_classes_enabled: default_scan_classes_enabled(),` |
| 3. `BladeConfig` struct | `config.rs` — after line 391 | `#[serde(default = "default_scan_classes_enabled")] pub scan_classes_enabled: ScanClassesEnabled,` |
| 4. `BladeConfig::default()` | `config.rs` — after line 478 | `scan_classes_enabled: default_scan_classes_enabled(),` |
| 5. `load_config()` | `config.rs` — after line 624 | `scan_classes_enabled: disk.scan_classes_enabled,` |
| 6. `save_config()` | `config.rs` — after line 681 | `scan_classes_enabled: config.scan_classes_enabled.clone(),` |

Plus the supporting type definition (at top of `config.rs`, near `TaskRouting`):
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScanClassesEnabled {
    pub fs_repos: bool,
    pub git_remotes: bool,
    pub ide_workspaces: bool,
    pub ai_sessions: bool,
    pub shell_history: bool,
    pub mru: bool,
    pub bookmarks: bool,
    pub which_sweep: bool,
}

fn default_scan_classes_enabled() -> ScanClassesEnabled {
    ScanClassesEnabled {
        fs_repos: true, git_remotes: true, ide_workspaces: true, ai_sessions: true,
        shell_history: true, mru: true, bookmarks: true, which_sweep: true,
    }
}
```

**Unit test stub** (Plan 12-02):
```rust
#[test]
fn scan_classes_enabled_roundtrip() {
    let mut cfg = BladeConfig::default();
    cfg.scan_classes_enabled.shell_history = false;
    let json = serde_json::to_string(&cfg).unwrap();
    let back: BladeConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(back.scan_classes_enabled.shell_history, false);
    assert_eq!(back.scan_classes_enabled.fs_repos, true);  // defaults preserved
}
```

## Verify Gates

### Existing 20-gate chain (as of 2026-04-20) [VERIFIED: package.json:32]

1-20: see `verify:all` — culminates in `verify:providers-capability` from Phase 11.

### 3 new gates for Phase 12 (per D-65 + D-64)

**Gate 21 — `verify:scan-no-egress`** (shell script, grep-based)

```bash
#!/usr/bin/env bash
# scripts/verify-scan-no-egress.sh
set -euo pipefail
TMP="$(mktemp)"
trap "rm -f $TMP" EXIT

# Grep all files under src-tauri/src/deep_scan/ (new module tree) for
# network primitives. Fail on ANY match.
grep -rn -E \
  "(reqwest::|isahc::|ureq::|\bTcpStream\b|\bUdpSocket\b|tokio::net::|\bhttp_client\b|curl::|surf::)" \
  src-tauri/src/deep_scan*.rs src-tauri/src/deep_scan/ 2>/dev/null \
  > "$TMP" || true

if [ -s "$TMP" ]; then
  echo "[verify-scan-no-egress] FAIL: deep_scan module must not perform network I/O"
  echo "[verify-scan-no-egress] LLM calls must route through providers/ via a commands.rs helper"
  cat "$TMP"
  exit 1
fi
echo "[verify-scan-no-egress] OK — deep_scan module is egress-free"
```

**Gate 22 — `verify:scan-no-write`** (shell script)

```bash
#!/usr/bin/env bash
# scripts/verify-scan-no-write.sh
set -euo pipefail
TMP="$(mktemp)"
trap "rm -f $TMP" EXIT

# Grep for write operations OUTSIDE ~/.blade/identity/
grep -rn -E "fs::write|fs::create_dir_all|OpenOptions::new\(\).*\.write" \
  src-tauri/src/deep_scan*.rs src-tauri/src/deep_scan/ 2>/dev/null \
  | grep -v "identity" \
  | grep -v "// allowed" \
  > "$TMP" || true

if [ -s "$TMP" ]; then
  echo "[verify-scan-no-write] FAIL: deep_scan must only write under ~/.blade/identity/"
  cat "$TMP"
  exit 1
fi
echo "[verify-scan-no-write] OK — deep_scan writes only to identity/"
```

**Gate 23 — `verify:scan-event-compat`** (Node mjs, parses TS + Rust)

```javascript
// scripts/verify-scan-event-compat.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PHASES_TS = resolve('src/features/onboarding/deepScanPhases.ts');
const SCANNER_RS_GLOB = ['src-tauri/src/deep_scan.rs', 'src-tauri/src/deep_scan/mod.rs'];

// Parse the `as const` array from deepScanPhases.ts
const phasesTs = readFileSync(PHASES_TS, 'utf8');
const arrayMatch = phasesTs.match(/DEEP_SCAN_PHASES\s*=\s*\[([^\]]+)\]/);
if (!arrayMatch) { console.error('[verify-scan-event-compat] FAIL: DEEP_SCAN_PHASES not found'); process.exit(1); }
const tsPhases = [...arrayMatch[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

// Parse emit sites from Rust. Look for emit_to(…, "deep_scan_progress", json!({"phase": "X" …)).
const rustSources = SCANNER_RS_GLOB
  .map(p => { try { return readFileSync(resolve(p), 'utf8'); } catch { return ''; } })
  .join('\n');
const rustPhases = new Set();
const emitRegex = /deep_scan_progress[^)]+?"phase"\s*:\s*"([a-z_]+)"/g;
let m;
while ((m = emitRegex.exec(rustSources)) !== null) rustPhases.add(m[1]);

// Every TS phase must appear in Rust emits (otherwise onboarding progress ring breaks)
const missing = tsPhases.filter(p => !rustPhases.has(p) && p !== 'starting' && p !== 'complete');
if (missing.length > 0) {
  console.error(`[verify-scan-event-compat] FAIL: TS phase names without Rust emit sites:`);
  missing.forEach(p => console.error(`  - ${p}`));
  process.exit(1);
}
console.log(`[verify-scan-event-compat] OK — ${tsPhases.length} TS phases / ${rustPhases.size} Rust emit sites`);
```

**Extend `verify:all` in package.json:**

```json
"verify:scan-no-egress": "bash scripts/verify-scan-no-egress.sh",
"verify:scan-no-write": "bash scripts/verify-scan-no-write.sh",
"verify:scan-event-compat": "node scripts/verify-scan-event-compat.mjs",
"verify:all": "... existing chain ... && npm run verify:scan-no-egress && npm run verify:scan-no-write && npm run verify:scan-event-compat"
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Rust unit tests | `cargo test` built-in. Existing patterns at `deep_scan.rs` use `#[cfg(test)] mod tests` blocks; Phase 11 Plan 11-02 established the `test_set_keyring_override` pattern for keyring mocking. |
| TS type check | `npx tsc --noEmit` — ~20s |
| Playwright e2e | `npm run test:e2e` (root) or specific phase subset `npm run test:e2e:phase12` (new) |
| Config file | `src-tauri/Cargo.toml` (no test crate; tests embedded); `playwright.config.ts` |
| Quick run command (per task) | `cd src-tauri && cargo test deep_scan -- --nocapture` (5-15s) |
| Full suite command | `cd src-tauri && cargo test && cd .. && npx tsc --noEmit && npm run verify:all && npm run test:e2e:phase12` (~3 min) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCAN-01 | FS repo walk finds `.git` dirs under maxdepth 6 | unit | `cargo test deep_scan::scanners::fs_repos::tests::walks_maxdepth_six -- --nocapture` | Wave 0 |
| SCAN-02 | Git remote parses SSH + HTTPS URLs → org/repo/account | unit | `cargo test deep_scan::scanners::git_remotes::tests::parses_ssh_and_https` | Wave 0 |
| SCAN-03 | IDE workspaceStorage JSON parse recovers project path | unit | `cargo test deep_scan::scanners::ide_workspaces::tests::parses_workspace_json` | Wave 0 |
| SCAN-04 | Claude session slug → project path reversal | unit | `cargo test deep_scan::scanners::ai_sessions::tests::slug_to_project_path` | Wave 0 |
| SCAN-05 | Shell history extracts command frequency + timestamps (zsh) | unit | `cargo test deep_scan::scanners::shell_history::tests::parses_zsh_ext` | Wave 0 |
| SCAN-06 | MRU window filter surfaces files with mtime ≤ N days | unit | `cargo test deep_scan::scanners::mru::tests::filters_by_window` | Wave 0 |
| SCAN-07 | Chrome Bookmarks JSON parse → domain count | unit | `cargo test deep_scan::scanners::bookmarks::tests::parses_chrome_json` | Wave 0 |
| SCAN-08 | `which` sweep returns installed + version | unit | `cargo test deep_scan::scanners::which_sweep::tests::detects_installed` | Wave 0 |
| SCAN-09 | LeadQueue drains Hot before Warm before Cold | unit | `cargo test deep_scan::queue::tests::tier_ordering` | Wave 0 |
| SCAN-09 | LeadQueue dedup via HashSet<PathBuf> | unit | `cargo test deep_scan::queue::tests::visited_dedupes` | Wave 0 |
| SCAN-09 | Cancel between leads terminates drain | unit | `cargo test deep_scan::tests::cancel_between_leads` | Wave 0 |
| SCAN-10 | `deep_scan_progress` event fires per lead with additive payload | integration | `cargo test deep_scan::tests::emits_additive_payload` | Wave 0 |
| SCAN-10 | Live-tail component renders scrolling log lines | e2e | `npm run test:e2e:phase12 -- tests/e2e/profile-live-tail.spec.ts` | Wave 1 |
| SCAN-11 | Profile persistence — save + load round-trip | unit | `cargo test deep_scan::profile::tests::roundtrip_overlay` | Wave 1 |
| SCAN-11 | Profile view renders 5 section tabs | e2e | `npm run test:e2e:phase12 -- tests/e2e/profile-tabs.spec.ts` | Wave 1 |
| SCAN-12 | Edit → restart → reload shows edited value | e2e | `npm run test:e2e:phase12 -- tests/e2e/profile-edit-roundtrip.spec.ts` | Wave 1 |
| SCAN-12 | Every row shows source pill | e2e | part of `profile-tabs.spec.ts` | Wave 1 |
| SCAN-13 | Baseline ≥10/5/3/3 on Arnav's machine | manual-trace | Wave 2 operator run: execute `deep_scan_start`, assert `profile_get_rendered` returns threshold counts. Not CI-automatable because depends on machine state. | Wave 2 |
| SCAN-13 | Scan completes in <2 min on baseline hardware | manual-trace | Wave 2 stopwatch. Not CI-automatable. | Wave 2 |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo test deep_scan` (bounded to the module; ~5-15s)
- **Per wave merge:** `cd src-tauri && cargo test && cd .. && npx tsc --noEmit && npm run verify:all`
- **Phase gate:** Full suite green + Wave 2 manual trace documented + `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src-tauri/src/deep_scan/queue.rs` — tier ordering, dedupe, cancel tests
- [ ] `src-tauri/src/deep_scan/scanners/git_remotes.rs` — parse tests
- [ ] `src-tauri/src/deep_scan/scanners/fs_repos.rs` — walkdir + ignore-list tests
- [ ] `src-tauri/src/deep_scan/scanners/mru.rs` — mtime filter tests
- [ ] `src-tauri/src/deep_scan/scanners/ai_sessions.rs` — slug decode tests
- [ ] `src-tauri/src/deep_scan/scanners/shell_history.rs` — zsh/fish timestamp tests
- [ ] `src-tauri/src/deep_scan/scanners/bookmarks.rs` — Chromium JSON parse tests
- [ ] `src-tauri/src/deep_scan/scanners/ide_workspaces.rs` — workspace.json parse tests
- [ ] `src-tauri/src/deep_scan/scanners/which_sweep.rs` — mock-command tests

### Wave 1 Gaps

- [ ] `src-tauri/src/deep_scan/profile.rs` — overlay merge, orphan, roundtrip tests
- [ ] `tests/e2e/profile-tabs.spec.ts` — ProfileView 5-tab navigation
- [ ] `tests/e2e/profile-edit-roundtrip.spec.ts` — edit + reload assertion
- [ ] `tests/e2e/profile-live-tail.spec.ts` — scan start → tail expands → log lines stream
- [ ] `tests/e2e/settings-privacy-scan-classes.spec.ts` — 8 toggles save + reload

### Wave 2 Gaps

- [ ] `scripts/verify-scan-no-egress.sh`
- [ ] `scripts/verify-scan-no-write.sh`
- [ ] `scripts/verify-scan-event-compat.mjs`
- [ ] package.json `verify:all` chain extension
- [ ] `.planning/phases/12-smart-deep-scan/12-05-TRACE.md` — manual cold-install baseline trace output

### Nyquist 8-Dimension Coverage

| Dimension | Phase 12 concern | Validation approach |
|-----------|------------------|---------------------|
| **Correctness** | Lead queue tier ordering; overlay merge mathematics; slug reversal; git remote regex | Unit tests per scanner; property test for `merge_scan_with_overlay` (random scan × random overlay → render). |
| **Performance** | Scan time on Arnav's WSL machine; /mnt/c crossings; drain loop backpressure | Wave 2 stopwatch trace — target <2 min cold scan; per-scanner 30s hard budget enforced by code; budget warning log if any scanner hits hard limit. |
| **Security** | No egress from `deep_scan/`; no writes outside `~/.blade/identity/`; keys never log; path names never surfaced to external services | `verify:scan-no-egress` + `verify:scan-no-write` hard gates; existing `verify:no-raw-tauri` covers frontend. |
| **UX** | Live-tail readability; source pill clarity; orphan row comprehension; 5-tab navigation focus order | UI-SPEC Surfaces A-C is the design contract (already locked); e2e tests assert role/aria-label presence; manual UI audit via `gsd-ui-auditor`. |
| **Data integrity** | Overlay crash-safety (atomic rename); row_id canonicalization; re-scan orphan preservation | Atomic-rename test; canonicalize round-trip test; kill-during-write test (spawn a scan, kill mid-drain, restart → load still works). |
| **Accessibility** | `role="log" aria-live="polite"` on live tail; 7×24 heatmap reflow; reduced-motion respects cell-hover; focus-trap on lead-details drawer | UI-SPEC accessibility section already specifies; existing `verify:aria-icon-buttons` + `verify:motion-tokens` cover; Phase 14 `verify:a11y-pass-2` (future) re-checks Phase 12 surfaces. |
| **Dev-experience** | Scanner split into modular `deep_scan/scanners/*.rs`; each scanner has `run(lead) -> (rows, followups)` signature; mock-friendly | One-function-per-scanner simplifies mocking; `#[cfg(test)]` keyring override pattern from Phase 11 reused; dev can run `cargo test deep_scan::scanners::fs_repos -- --nocapture` for a single scanner. |
| **Operability** | Cancel button works within 1 lead-cycle (≤30s worst case); scan failure logs once (not spam); re-scan idempotent | `SCAN_CANCEL` store ≤30s to visible stop; silence-discipline test asserts no log-spam on repeated LLM failures; re-scan with same data produces same row_ids (idempotent). |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 12-scanner `tokio::join!` parallel sweep | Single async task draining priority `VecDeque` | Phase 12 (this) | Fixes "1 repo on cold install" symptom; narrative streams in order |
| Hardcoded candidate-dir seed list (`Documents/projects/dev/code/repos/…`) | Lead-following with fs_mru + ai_session + shell_history seeds | Phase 12 | Matches real user dir layouts regardless of convention |
| `bash`/`zsh`/`fish` frequency-count-only history parse | Timestamp extraction + rhythm histograms from AI-session mtimes + MRU mtimes + shell history | Phase 12 | Rhythm signals become computable even when bash lacks timestamps |
| Overwrite-on-rescan single file | Two-file scan_results + profile_overlay | Phase 12 | User edits survive re-scan |
| LLM calls per scan = unbounded | LLM calls ≤3, silent no-op if missing provider | Phase 12 | Predictable cost + works offline |
| Static `DEEP_SCAN_PHASES` list (11 phases) | Additive phase-name list (+ `fs_mru`, `git_remotes`, `rhythm_compute`, …) | Phase 12 | Existing onboarding consumer still works; new consumers see richer tail |

**Deprecated / outdated:**
- **`tokio::join!` parallel-all orchestration** (`deep_scan.rs:1351-1364`): replaced by priority-queue drain. Old impl stays referenced only until the Wave 0 cutover lands, then removed entirely.
- **1-level-deep read repo walk** (`deep_scan.rs:353-363`): replaced by `walkdir::WalkDir::max_depth(6)`.
- **Count-only `ShellHistory::top_commands`** (`deep_scan.rs:537`): schema grows to include optional per-command timestamps; old consumers that read `top_commands` keep working.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cursor workspaceStorage on Windows matches VS Code schema | IDE Workspace Artifacts | `scan_ide_workspaces` for Cursor emits 0 rows; falls through to `scan_ai_sessions` instead. Low risk. |
| A2 | Codex history.jsonl contains a `cwd` per entry | AI Session Directory Schemas | Codex project-extraction produces fewer `ProjectRootHint` leads; AI session count signal still works via directory presence. |
| A3 | Arc browser not installed on Linux-target user machines | Browser Bookmark Parsing | Arc scanner emits 0 rows; other browsers cover. |
| A4 | Rust ≥ 1.80 in build toolchain (std::sync::LazyLock available) | Priority Queue Implementation | Fall back to `once_cell::sync::Lazy` (already transitively in tree) — 1-line swap per LazyLock use. |
| A5 | `once_cell` transitively available | Standard Stack alternatives table | Verify with `cargo tree | grep once_cell`; if not, add as direct dep or use LazyLock. |
| A6 | `run_cmd_output` helper in existing deep_scan.rs merges stderr or `--version` prints to stdout for all curated CLIs | `which` Sweep | Some CLIs (e.g., `rustc`) print version to stderr; version field = None for those — not blocking; tool still counted as installed. |
| A7 | ≥4 Claude project slugs on Arnav's machine map to real paths | Baseline Feasibility | If fewer, AI-session-seeded FsRepoWalks miss some repos; fs_mru + breadth-fill still catches them. |
| A8 | Arnav's baseline AccountRow count with just git-remote parsing ≥5 | Baseline Feasibility | If only 2-3 unique `(platform, handle)` pairs from git remotes, add `account_kind` expansion (gitconfig email, shell-history auth, bookmark-derived orgs) to reach ≥5. Documented as specific planner action. |
| A9 | `fs::rename` atomic on WSL2 9P filesystem (for `/mnt/c/…`) | Overlay I/O Serialization | Overlay lives at `~/.blade/identity/` (WSL-native ext4), not `/mnt/c/` — atomic rename guaranteed. |
| A10 | `verify:scan-event-compat` regex-parses Rust emit sites without false positives | Verify Gates | If the regex misses emit sites (e.g., ones using variable strings), add test fixtures or refactor emit sites to use a centralized helper function. |

**User confirmation needed before execution** — none of the above are hard blockers. A8 (account count baseline) is the highest-probability-of-needing-mitigation; Plan 12-02 explicitly scopes the `account_kind` expansion.

## Open Questions

1. **Should scan re-trigger automatically on startup if `last_deep_scan > 30 days`?**
   - What we know: Phase 12 is manual-scan-only per CONTEXT §Deferred ("Continuous / background re-scan — out of scope for v1.1").
   - What is unclear: even a one-shot "scan is stale, consider re-running" UI banner is scope.
   - Recommendation: **DEFER** to v1.2. Phase 12 ships with manual Re-scan button only. Stale-scan banner is a Phase 15 Density task if v1.1 testers report confusion.

2. **How to handle race between `scan_cancel` and an in-flight LLM enrichment call?**
   - What we know: cancel is checked between leads; enrichment runs after scan drain.
   - What is unclear: if enrichment is mid-HTTP-request when user clicks Cancel, does the request abort?
   - Recommendation: wrap enrichment's `complete_turn` call in `tokio::select!` with a cancel-token. Not blocking Phase 12 MVP — enrichment is fast (≤30s across 3 calls with 10s timeouts); user cancel during this window is rare. Implementation detail for Plan 12-05.

3. **Should the "source pill" show provenance chain (e.g., "fs_mru → git_remotes → this repo") or just final scanner?**
   - What we know: D-63 locks "source pill = scanner that produced the row".
   - What is unclear: rich provenance chain would aid debugging + user understanding but adds UI complexity.
   - Recommendation: **Phase 12 ships final-scanner only** per D-63. Lead-details drawer (UI-SPEC Surface A Drawer) shows the seed_source chain for user debugging. This separates the quick-visual indicator (pill) from the deep-view (drawer) — good information hierarchy.

4. **What if the live-tail log falls behind emission rate (events/sec > render/sec)?**
   - What we know: UI-SPEC says "Last 10 events only (buffer trimmed FIFO)."
   - What is unclear: rate-limiting approach if scanner emits 100 events/sec — React re-render cost.
   - Recommendation: batch emissions in Rust at ≥100ms intervals (at most 10 events/sec reach the UI). Alternatively, debounce on React side via `requestAnimationFrame`. Implementation detail for Plan 12-04.

## Sources

### Primary (HIGH confidence)

- **Live codebase inspection (2026-04-20):**
  - `/home/arnav/blade/src-tauri/src/deep_scan.rs` (1437 LOC — current orchestrator + scanner internals)
  - `/home/arnav/blade/src-tauri/src/lib.rs` (module registration + `generate_handler!` sites)
  - `/home/arnav/blade/src-tauri/src/config.rs` (BladeConfig 6-place pattern reference)
  - `/home/arnav/blade/src-tauri/src/commands.rs` (`providers::complete_turn` call patterns)
  - `/home/arnav/blade/src-tauri/src/providers/mod.rs` (`parse_model_string`, `test_connection`, `complete_turn`, `fallback_chain_complete`)
  - `/home/arnav/blade/src/features/onboarding/DeepScanStep.tsx` + `deepScanPhases.ts` (event consumer shape compat)
  - `/home/arnav/blade/src/features/identity/index.tsx` (7-entry registry; 8th slot available)
  - `/home/arnav/blade/src/lib/events/index.ts` + `payloads.ts` (`DeepScanProgressPayload` interface)
  - `/home/arnav/blade/package.json` (existing 20 verify gates)
  - `/home/arnav/blade/scripts/verify-providers-capability.mjs` (6-place gate template)
  - `/home/arnav/blade/scripts/verify-no-raw-tauri.sh` (bash-grep gate template)

- **Live machine state (Arnav's WSL2 box, 2026-04-20):**
  - maxdepth-2 `.git` find under `/home/arnav` → 8 `.git` directories at `~/` root (baseline evidence for ≥10-repo target)
  - `ls /home/arnav/.claude/projects/` → 4+ project slugs (baseline evidence for AI-session-seeded leads)
  - `ls /home/arnav/.codex/` → `history.jsonl`, `auth.json`, `config.toml`, `memories/` (Codex present)
  - `ls ~/.cursor` → does not exist (confirms Cursor not installed Linux-side)
  - head-3 of `/home/arnav/.bash_history` → plain commands, no `#<ts>` prefixes (confirms no HISTTIMEFORMAT set)
  - `command -v git node python3 cargo docker rustc gh code` → 8 CLIs installed (baseline evidence for `which` sweep)
  - `ls "/mnt/c/Users/arnav/AppData/Local/Google/Chrome/User Data/Default/Bookmarks"` → exists (Chromium bookmarks source confirmed)
  - `ls "/mnt/c/Users/arnav/AppData/Roaming/Code/User/"` → `workspaceStorage/`, `globalStorage/`, `settings.json` (VS Code Windows-side confirmed)

- **Crate versions (cargo search, 2026-04-20):** walkdir 2.5.0, ignore 0.4.25, once_cell 1.21.4, gix-config 0.54.0.

- **Phase 10 WIRING-AUDIT.md "Tester-Pass Evidence Map" row #2** — "1-repo cold install" symptom that Phase 12 must close.
- **Phase 11 11-CONTEXT.md D-53** — per-capability config (`long_context_provider` etc.) that Phase 12 consumes.
- **Phase 11 11-RESEARCH.md** — pacing + rigor template for this research doc.
- **BLADE CLAUDE.md** — Rust module registration rules, 6-place config pattern, `use tauri::Manager;` gotcha, `SCAN_CANCEL: AtomicBool` discipline, `safe_slice` invariant.

### Secondary (MEDIUM confidence — verified with ≥1 official source)

- [CITED: walkdir docs — https://docs.rs/walkdir/2.5.0/walkdir/struct.WalkDir.html#method.filter_entry] — ignore-list pattern via `filter_entry`.
- [CITED: git-config syntax — https://git-scm.com/docs/git-config#_syntax] — `[remote "name"]` section canonical form.
- [CITED: zsh extended_history — https://zsh.sourceforge.io/Doc/Release/Options.html#History] — `: <unix_ts>:<duration>;<command>` format.
- [CITED: bash HISTTIMEFORMAT — https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html] — bash timestamp-in-history requires opt-in.
- [CITED: fish history format — https://fishshell.com/docs/current/interactive.html#id22] — YAML-ish `- cmd: foo\n  when: unix-ts`.
- [CITED: Chromium Bookmarks schema — https://source.chromium.org/chromium/chromium/src/+/main:components/bookmarks/browser/bookmark_codec.cc] — `roots.bookmark_bar.children[].type` URL/folder.
- [CITED: VS Code workspaceStorage — https://github.com/microsoft/vscode] — `workspace.json` with `folder` or `workspace` key.
- [CITED: JetBrains .idea/workspace.xml — https://www.jetbrains.com/help/idea/project-directory.html] — RecentProjectsManager component.

### Tertiary (LOW confidence — assumption flagged)

- [ASSUMED] Cursor (proprietary Electron app) shares VS Code workspaceStorage schema. Plausible given Cursor is a VS Code fork, but version-skew risk exists. Mitigation: best-effort parse, log once, move on.
- [ASSUMED] Codex history.jsonl includes a `cwd` per entry in current versions. Not verified against published schema (OpenAI Codex CLI does not publish a stable schema). Mitigation: try-parse, skip on failure.
- [ASSUMED] `verify:scan-event-compat` regex approach is sufficient to catch drift. If scanner emits phases via a variable (not a string literal), the regex misses them. Mitigation: prefer centralizing emit calls through a helper function so the regex finds all sites.
- [ASSUMED] Rust toolchain in use ≥1.80 for `std::sync::LazyLock`. Not independently verified. Mitigation: fall back to `once_cell::sync::Lazy` if needed (already transitively in tree).

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every dep verified in-tree or via `cargo search`; no new system-lib requirements.
- Architecture patterns: **HIGH** — priority-queue drain + additive event payload + 6-place config all have existing codebase precedent.
- Baseline feasibility on Arnav's machine: **MEDIUM** — ≥10 repos + ≥3 rhythm + ≥3 tool signals HIGH; ≥5 accounts MEDIUM (requires scanner scope expansion beyond pure git-remote parsing).
- Common pitfalls: **HIGH** — every pitfall is either directly observed in the existing codebase or has a documented WSL/cross-platform failure mode.
- Overlay I/O + race avoidance: **HIGH** — atomic-rename + `tokio::sync::Mutex` is textbook; tree has 29 analogous patterns.

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — WSL filesystem semantics, crate APIs, and codebase surface areas are stable; `~/.claude/projects/` slug format may evolve with Claude Code releases but has not in the 6-month observed window).
