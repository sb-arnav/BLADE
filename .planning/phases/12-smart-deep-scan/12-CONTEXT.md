# Phase 12: Smart Deep Scan - Context

**Gathered:** 2026-04-20
**Status:** Ready for research
**Mode:** Auto — all gray areas resolved by Claude applying pragmatic defaults grounded in Phase 10 audit + Phase 11 decisions + codebase scout (user delegation pattern continuing from Phase 11)

<domain>
## Phase Boundary

Replace the dumb 12-scanner parallel sweep in `src-tauri/src/deep_scan.rs` (1437 LOC, surfaces 1 repo on Arnav's cold install) with a **lead-following scanner** that reads 8 source classes (SCAN-01..08), builds its own priority-ordered todo queue at start (SCAN-09), streams live progress (SCAN-10), and persists a structured, user-editable profile whose edits round-trip (SCAN-11, SCAN-12). Baseline target on Arnav's machine: ≥10 repos, ≥5 accounts, ≥3 daily-rhythm signals, ≥3 IDE/AI tool signals (SCAN-13).

**In scope (ROADMAP Phase 12 + REQUIREMENTS SCAN-01..13):**
1. Lead-following scanner rewrite (new `deep_scan/` module tree; keeps `#[tauri::command] deep_scan_start` + `deep_scan_progress` event as stable public contract)
2. Priority queue with tiered leads (hot/warm/cold) + breadth fill + per-scanner budgets
3. Structured profile persistence split into two files: scan output + user-edit overlay
4. New Profile sub-view under `src/features/identity/` (joins Soul/Persona/Character Bible/etc.)
5. Event-payload extension (additive) for live tail-style progress during Phase 12; full activity-log strip integration is Phase 14
6. Optional LLM-augmented classification gated behind Phase 11's `provider_capabilities` — graceful no-op if Phase 11 not yet landed

**Out of scope (Phase 13+):**
- Tentacle auto-enable from scan findings — Phase 13 (ECOSYS-01..10)
- Activity-log strip UI (persistent "BLADE is doing…" drawer) — Phase 14 (LOG-01/02)
- Dashboard binding to profile data — Phase 15 (DENSITY/DASH)
- Any outbound/acting behavior on scan findings — v1.2+ (M-03 hard rule)

**Anchors this phase mirrors:**
- Phase 10 audit §"Tester-Pass Evidence Map" symptom #2 (1-repo cold install) is the falsifiable close-target.
- Phase 11 D-53 per-capability config (`vision_provider` / `long_context_provider` / `tools_provider` / `audio_provider`) is the soft-dep entry point for LLM classification.
- Phase 11 D-58 wave layout (Wave 0 backend → Wave 1 shared infra → Wave 2 integrate) is the pacing template for Phase 12 plans.
- M-03 observe-only guardrail: scan never writes to external services, enforced at code + verify-gate level.

</domain>

<decisions>
## Implementation Decisions

### D-59: Lead Queue Architecture = Single Priority `VecDeque<Lead>` + 3 Tiers + Per-Scanner Budget

**Scanner architecture is a single async task draining a priority queue, not 12 parallel scanners.** The queue lives in-memory for the duration of the scan.

**Lead shape:**
```rust
pub struct Lead {
    pub kind: LeadKind,             // FsRepoWalk / GitRemoteRead / IdeWorkspaceRead / AiSessionRead / ShellHistoryScan / MruWalk / BookmarkRead / WhichSweep / derived follow-ups
    pub priority_tier: Tier,        // Hot | Warm | Cold
    pub seed_source: SeedSource,    // Explains why this lead was enqueued
    pub payload: serde_json::Value, // Kind-specific args (path, repo_root, etc.)
    pub enqueued_at: Instant,
}
```

**Seeding (populates Tier 0/1 at scan start, runs before any breadth work):**
1. **Filesystem MRU walk** — files modified in last 7 days under `~/Projects`, `~/repos`, `~/src`, `~/code`, `~/Documents`, `~/Desktop`, + user-configured parent dirs. Each hot directory (≥5 MRU files in last 7d) enqueues a `FsRepoWalk` lead as **Hot**.
2. **Active AI session dirs** — `~/.claude/projects/*/` with `last_message_at` ≤ 7d, `~/.codex/sessions/*/`, `~/.cursor/recent/`, VS Code `workspaceStorage/`. Each session enqueues a `ProjectRootHint` lead pointing at the project it references.
3. **Shell history recency window** — last 500 commands from `.zsh_history` / `.bash_history` / `.fish_history`. Extract `cd <path>` targets + known tool invocations (`git`, `npm`, `cargo`, `poetry`, `docker compose`, `vercel`, `wrangler`, etc.). Each unique path → `PathHint` lead.
4. **Git HEAD freshness sweep** — every `.git/HEAD` under scan roots; repos with HEAD mtime ≤ 30d are **Hot**, ≤ 90d **Warm**, older **Cold**.

**Breadth fill (runs once Hot drains, then Warm, then Cold):**
- Full filesystem `.git` directory walk under configured parent dirs (SCAN-01)
- `which` sweep of curated CLI list (SCAN-08) — ~40 tools: dev CLIs (git, node, python, rust, cargo, poetry, uv, npm, pnpm, yarn, bun, deno, docker, kubectl, terraform, vercel, wrangler, aws, gcloud, supabase, railway, fly, gh, glab), AI CLIs (claude, codex, cursor-agent, aider, goose), OS tools (rg, fd, fzf, jq, yq, bat, exa/eza, zoxide)
- Browser bookmark dumps (Chrome / Brave / Arc / Edge — JSON file parse)
- Package manager inventory (global npm, pip, cargo install list, brew leaves)

**Priority tiers:**
- **Hot (Tier 0):** seeds from last 7 days. Must drain fully before Warm starts. Per-scanner budget: 15s soft, 30s hard.
- **Warm (Tier 1):** seeds from last 30 days. Per-scanner budget: 20s soft, 45s hard.
- **Cold (Tier 2):** breadth fill. Per-scanner budget: 30s soft, 60s hard.

**Stopping conditions (per-scanner):**
- Time budget exceeded → emit partial, enqueue `{kind}_deferred` lead for next scan, move on (no hang).
- Depth cap on filesystem walk: 6 levels from parent dir (prevents runaway scan into `node_modules`, `.venv`, `target`, `dist` — these are filtered at walk time via a standard ignore-list: `node_modules`, `.git`, `.venv`, `venv`, `target`, `dist`, `build`, `.next`, `.turbo`, `__pycache__`).
- File count cap: 10,000 files per tier before moving on.
- User-initiated cancel → static `SCAN_CANCEL: AtomicBool` matches the pattern in §lib.rs cancel discipline; scanner checks between leads, not mid-lead.

**Lead-following (follow-ups are where "intelligence" lives):**
- Finding a `.git` dir → enqueue `GitRemoteRead`, `PackageManifestRead`, `LockFileRead`, `IdeConfigRead` leads for that repo at same tier.
- Finding a Claude session with a project reference → enqueue `FsRepoWalk` for the referenced path at Hot tier (if it exists and isn't already visited).
- Finding an IDE workspace with recent-projects list → each project becomes a `ProjectRootHint` at Warm tier.
- Visited set (`HashSet<PathBuf>`) prevents re-enqueue of the same path.

**Concurrency model:** single async task, sequential drain. Not concurrent scanners. Scanner uses `tokio::task::spawn_blocking` for individual I/O (file reads, git remote reads) but the lead queue is drained in-order so the activity log is a coherent narrative ("found repo → reading remotes → reading manifest → found 3 more leads"). This is the "scan thinks out loud" requirement (SCAN-10 / shape-doc §Phase 2 algorithm).

---

### D-60: Source Class Coverage = 8 Scanners Mapped 1:1 to SCAN-01..08

Every SCAN-0N requirement maps to exactly one scanner function. Location: `src-tauri/src/deep_scan/scanners/`.

| SCAN-0N | Scanner fn | Reads from | Emits row type |
|---------|-----------|------------|----------------|
| SCAN-01 | `scan_fs_repos` | `~/Projects`, `~/repos`, `~/src`, `~/code`, `scan_parent_dirs` config | `RepoRow { path, discovered_via: "fs_walk" }` |
| SCAN-02 | `scan_git_remotes` | `.git/config` per repo found by SCAN-01 | `RepoRow` enriched `{ remote_url, org, repo_name }` + `AccountRow { platform: "github"\|"gitlab"\|..., handle }` |
| SCAN-03 | `scan_ide_workspaces` | `.code-workspace`, `.idea/workspace.xml`, `~/.config/Code/User/workspaceStorage/`, `~/.cursor/`, `.vscode/` | `IdeRow { name, recent_projects }` + `ProjectRootHint` follow-ups |
| SCAN-04 | `scan_ai_sessions` | `~/.claude/projects/`, `~/.codex/sessions/`, `~/.cursor/chats/`, Claude Desktop IndexedDB paths | `AiToolRow { name, session_count, last_active }` + `ProjectRootHint` follow-ups |
| SCAN-05 | `scan_shell_history` | `~/.zsh_history`, `~/.bash_history`, `~/.local/share/fish/fish_history` | `ToolRow { cli, invocations }` + `PathHint` follow-ups |
| SCAN-06 | `scan_mru` | `~/Documents`, `~/Desktop`, parent dirs from SCAN-01 (recursively, 7-day window) | `MruFileRow { path, mtime, size_bytes, project_root? }` |
| SCAN-07 | `scan_bookmarks` | Chrome/Brave/Edge Bookmarks JSON, Arc `ArcLibrarySQL` / pinboards | `BookmarkRow { browser, count, top_domains }` |
| SCAN-08 | `scan_which_sweep` | Curated CLI list (see D-59 breadth section) + GUI app discovery (`/Applications`, `~/.local/share/applications`, Windows Registry `DisplayName`) | `ToolRow { cli, installed: true, version? }` + `InstalledAppRow` |

**Reuse from existing `deep_scan.rs`:** the current module already has working implementations of `scan_installed_apps`, `scan_default_browser`, `scan_ides`, `scan_git_repos`, `scan_shell_history`, `scan_wsl_distros`, `scan_package_managers`, `scan_ai_tools`, `scan_system_info`, `scan_ssh_keys`, `scan_docker`, `scan_browser_bookmarks`. These are **lifted and adapted** into the new `scanners/` tree, not written from scratch. The failure mode is the **orchestration layer** (parallel-all vs lead-following), not the individual scanners. The rewrite preserves the individual-scanner working code; it replaces the `tokio::join!` all-parallel wrapper with the priority-queue drain (D-59).

**Derived rhythm signals (SCAN-13 requirement ≥3):** computed from cross-scanner data after all leads drain:
1. **Hour-of-day histogram** from shell-history timestamps + AI-session timestamps → "peak 9pm-1am" style narrative.
2. **Day-of-week distribution** from same source → "weekday-heavy with Saturday morning bursts."
3. **Active-repo concurrency** — #repos with activity in the last 7d → "working on 4 repos this week."

These are computed, not LLM-generated (D-61 bounds LLM use). Optional one-shot LLM summary per D-61 §Rhythm narrative.

---

### D-61: LLM Classification Boundary = Heuristics First, LLM On-Demand, ≤3 Calls per Scan

**Default posture: heuristics win.** Zero LLM calls are required for a scan to complete. Phase 11's capability providers are consulted only for enrichment, never for primary classification.

**Pure heuristics (no LLM):**
- Git remote → org/repo regex on `git@host:org/repo.git` or `https://host/org/repo.git`
- Account inference: git remote host → platform (`github.com` → github, `gitlab.com` → gitlab, `bitbucket.org` → bitbucket, `dev.azure.com` → azure, custom host → raw hostname)
- SSH key comment → email account (existing `scan_ssh_keys` already does this)
- IDE workspace parse (JSON / XML per IDE)
- Shell history tool detection (regex on known tool list)
- `which` sweep (exec + parse)
- Browser bookmark JSON parse
- File mtime ranking (fs stat)
- Primary language per repo: file-extension histogram + common-lockfile detection (existing `language_counts` in `GitRepo` struct already does this)

**LLM calls (gated, batched, budgeted):**
1. **Account narrative enrichment** — batch all `AccountRow` entries into one prompt: "given this list of detected accounts, what's the user's likely identity summary?" → caches to `~/.blade/identity/llm_narrative.json`. Uses `long_context_provider` (Phase 11 D-53) if set, else primary provider. Skip if no provider available.
2. **Rhythm narrative** — one-shot summary of the timestamp histogram → 1-2 sentence human-readable description. Uses primary provider.
3. **Ambiguous-repo language classification** — only when extension histogram has no clear winner (≤50% dominance) AND repo is in Hot tier. Uses primary provider. Skipped on Warm/Cold repos.

**Budget:** strict ≤3 LLM calls per scan. All non-blocking — scan result is valid + usable with zero LLM calls. Each call is idempotent and its output caches per-row with `last_enriched_at` timestamp; re-scan within 7 days reuses cache, older re-scans re-invoke.

**If Phase 11 isn't landed when Phase 12 code-merges:** `provider_capabilities` HashMap is absent or empty. Scanner falls back to primary provider (existing `cfg.providers[primary_provider]`). Soft-dep language in ROADMAP §37 already covers this.

**Silence discipline (inherited from tester-pass `4ab464c`):** LLM call failures are logged once per scan, not retried in a loop. Partial narrative is better than a spinning UI.

---

### D-62: Profile Persistence = Two-File Split (scan_results.json + profile_overlay.json)

User edits must round-trip (SCAN-12 hard req: "save → restart → reload"). Overwrite-on-rescan fails this; overlay is the correct pattern.

**Two files on disk under `~/.blade/identity/`:**

1. **`scan_results.json`** (path already exists today — reused). Canonical scanner output. Replaced wholesale on re-scan. Read-only from UI perspective.
2. **`profile_overlay.json`** (new). User-edit deltas keyed by stable row_id. Shape:
   ```json
   {
     "version": 1,
     "rows": {
       "repo:~/Projects/blade": { "action": "edit", "fields": { "remote_url": "corrected-value" }, "edited_at": "2026-04-21T..." },
       "account:github:slayerblade": { "action": "hide" },
       "repo:~/Projects/old-crap": { "action": "delete" },
       "custom:account:1": { "action": "add", "fields": { "platform": "linear", "handle": "arnav", "source": "user" } }
     }
   }
   ```

**Stable row_id scheme:** `{row_kind}:{primary_key}` where primary_key is derived from the immutable natural identity of the row (repo → canonical abs path; account → `platform:handle`; ide → `name`; file → abs path; tool → cli name). Hashed-surrogate IDs are avoided — if the user deletes + re-scan re-finds, hash-matching by natural key gives a deterministic merge.

**Render layer (in-UI):**
```
render_rows = scan_results.rows
  .map(row => apply_overlay(row, overlay[row_id]))   // edits win
  .filter(row => overlay[row_id]?.action !== "hide")  // hides filtered out
  .concat(overlay_custom_rows)                       // user-added rows appended
```

**Re-scan conflict behavior (row in overlay, no longer in scan output):**
- Row is kept in render with `orphaned: true` flag + pill `not found in latest scan`.
- User can explicitly delete (overlay entry removes itself) or pin (overlay entry becomes `action: "add"`).
- Never silently drops an edit.

**Edit round-trip Tauri commands:**
- `profile_get_rendered() -> Result<ProfileView, String>` (existing `deep_scan_results` stays for raw output)
- `profile_overlay_upsert(row_id: String, action: OverlayAction, fields: Option<HashMap<String, Value>>) -> Result<(), String>`
- `profile_overlay_reset(row_id: String) -> Result<(), String>` (removes an overlay entry — reveals the underlying scan row)

No existing overlay contract → no back-compat concerns on this command surface.

---

### D-63: Profile Surface = New `features/identity/ProfileView.tsx` + 5 Section Tabs

**Location:** `src/features/identity/ProfileView.tsx`, registered in `src/features/identity/index.tsx` as the 8th entry:
```tsx
{ id: 'profile', label: 'Profile', section: 'identity', component: ProfileView, phase: 12 }
```
Registry pattern already exists (Phase 6 D-143 single-writer on shared registry files — `index.tsx` edit is permitted because `index.tsx` is the registry itself, not a consumer).

**Route id:** `profile`. Appears in the identity section sidebar alongside Soul, Persona, Character Bible, Negotiation, Reasoning, Context Engine, Sidecar. Command palette entry added in the same wave as the component lands.

**Layout — five section tabs within one page:**
1. **Repos** — table: path, remote, primary_language, last_active_days, source_pill. Sortable columns. Row click → details drawer showing follow-up leads that produced this row.
2. **Accounts** — table: platform, handle, source_pill. Add-row button (overlay `custom:account`).
3. **Stack** — summary cards: primary languages (bar chart of language_counts aggregate), package managers detected, installed CLIs (checklist pill strip), IDEs detected.
4. **Rhythm** — hour-of-day heatmap (7×24 grid, cell intensity = activity count) + day-of-week bar + LLM narrative sentence (if enriched, else "narrative not generated — configure long_context_provider in Settings" inline CTA).
5. **Files** — MRU table: path, mtime, size, project_root (hyperlink to repo row). 7-day window toggle (default 7d, user can expand to 30d).

**Per-row source pill (SCAN-12 hard req "source-linked rows show origin"):** small Pill primitive (already exists per PROJECT.md §Validated) with label = scanner that produced the row (`fs`, `git`, `ide`, `ai`, `shell`, `mru`, `bookmark`, `which`). Hover → tooltip with exact scan lead path. Edited rows also show an `edited` pill.

**Empty state:** when scan has never run → "BLADE hasn't scanned yet. Run your first scan to see your profile." + CTA button that invokes `deep_scan_start`. When scan is running → live-updating row counts per section + the lead tail from D-64.

**Edit affordances (per SCAN-12):**
- Row right-click / menu button → Edit / Hide / Delete.
- Edit opens existing `EditSectionDialog` primitive (already in `features/identity/EditSectionDialog.tsx`) wired to the overlay commands (D-62).
- Hide/Delete fires overlay upsert directly.
- Add-row button per section fires overlay upsert with `action: "add"`.
- "Reset to scan" button per row unhides / un-edits (calls `profile_overlay_reset`).

**No custom CSS file needed** — reuses `identity.css` + existing primitives (Card, Pill, Badge, Button, Dialog). Stays within PROJECT.md §Constraints "9 primitives self-built, no shadcn/Radix."

---

### D-64: Live Tail During Phase 12 = Extended `deep_scan_progress` Payload (No Strip UI Yet)

ROADMAP §125 is explicit: "LOG-01 wires Phase 14; during Phase 12 a simple log tail is sufficient, and the strip integration completes in Phase 14."

**What Phase 12 ships:**

1. **Event name stays `deep_scan_progress`.** `src/lib/events/index.ts:92` `DEEP_SCAN_PROGRESS: 'deep_scan_progress'` unchanged. OnboardingFlow.tsx keeps working unmodified.

2. **Additive payload extension** — current payload `{ phase: string, found: number }` is preserved; new fields are optional:
   ```ts
   type DeepScanProgressPayload = {
     phase: string;                    // existing — coarse phase name
     found: number;                    // existing — running count
     // New in Phase 12 (optional — old consumers ignore):
     lead_kind?: LeadKind;             // e.g. "GitRemoteRead"
     lead_seed?: string;               // why this lead ran, e.g. "fs_mru:~/blade"
     priority_tier?: "hot"|"warm"|"cold";
     queue_depth?: number;             // leads still in queue
     elapsed_ms?: number;              // since scan started
     message?: string;                 // human-readable e.g. "reading remotes for blade"
   };
   ```

3. **Simple log tail view inside the Profile page** — a small collapsed "Activity" panel at the top of ProfileView shows the last 10 progress events as a scrolling log. During a scan, this auto-expands; after scan completes, it collapses to "Last scan: 2m ago — N rows" summary. This is the "simple log tail" per ROADMAP.

4. **No new global UI strip.** The persistent Activity Log strip across all routes is deferred to Phase 14 (LOG-01/02). Phase 12 does not add route-independent chrome.

**Onboarding compat verification:**
- `src/features/onboarding/deepScanPhases.ts` hardcodes a known list of phase names → **additive extension only** (new phase names append, existing names stay). A verify script `verify:scan-event-compat` (new) asserts: every name in `DEEP_SCAN_PHASES` resolves to a phase that the new scanner will emit. Fails CI if a name is dropped.
- `src/features/onboarding/DeepScanStep.tsx` renders a static SVG animation indexed by `phase` name → still works with additive phases (unknown names fall through to a generic tick).

---

### D-65: Source-Class Privacy Model = All-On Default + Per-Class Toggle in Settings → Privacy

**Default: all 8 source classes ON.** "BLADE works out of the box" (PROJECT.md §Core Value) and the baseline target (≥10 repos, ≥5 accounts) is only reachable with full coverage. Defaulting classes off would reproduce the "1 repo on cold install" failure we're rewriting.

**Per-class opt-out at `Settings → Privacy` (new section, new route id `settings-privacy` under the existing settings section):**
```
Deep Scan — Source Classes
  [✓] Filesystem repo walk
  [✓] Git remote reads
  [✓] IDE workspace artifacts
  [✓] AI session history (Claude / Codex / Cursor)
  [✓] Shell history
  [✓] Filesystem MRU
  [✓] Browser bookmarks
  [✓] Installed CLIs + apps (`which` sweep)

  [ Re-scan now ]
```

**Config surface — 6-place pattern (per CLAUDE.md §Config field 6-place rule):**
```rust
#[serde(default = "default_scan_classes_enabled")]
pub scan_classes_enabled: ScanClassesEnabled,

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

fn default_scan_classes_enabled() -> ScanClassesEnabled { /* all true */ }
```
Field added to `DiskConfig`, `DiskConfig::default()`, `BladeConfig`, `BladeConfig::default()`, `load_config()`, `save_config()` — the six places.

**Hard network + write invariants (verify gates):**
- **`verify:scan-no-egress`** (new gate) — grep `src-tauri/src/deep_scan*` for `reqwest::`, `isahc::`, `http::`, `ureq::`, `TcpStream`, `UdpSocket` occurrences → fail on any match. The single LLM call path lives in `commands.rs` / `providers/` (called with serialized findings as input), not in `deep_scan/`.
- **`verify:scan-no-write`** (new gate) — grep `src-tauri/src/deep_scan*` for write operations outside `~/.blade/identity/` (`fs::write`, `fs::create_dir_all`, `OpenOptions::write`) → fail unless target path matches `blade_config_dir()/identity/*`.
- Both gates extend the existing `npm run verify:all` chain (PROJECT.md §18 verify gates green).

---

### D-66: Existing-Scanner Migration = Hard Cutover with Stable Public Contract

**The 1437-LOC parallel sweep in `src-tauri/src/deep_scan.rs` is the thing being replaced.** A compat shim that keeps the old sweep alongside the new lead-following scanner would double scan time, double maintenance, duplicate `scan_results.json` writers, and directly re-create the "1 repo cold install" failure mode. Hard cutover.

**What changes:**
- `src-tauri/src/deep_scan.rs` → **split into `src-tauri/src/deep_scan/mod.rs`, `deep_scan/leads.rs`, `deep_scan/queue.rs`, `deep_scan/scanners/{fs_repos,git_remotes,ide_workspaces,ai_sessions,shell_history,mru,bookmarks,which_sweep}.rs`, `deep_scan/profile.rs`**. Internal scanners are lifted from the old module (they work — individually).
- `tokio::join!` orchestration block in old `deep_scan_start` → **replaced** with priority-queue drain (D-59).

**What stays stable (public contract):**
- `#[tauri::command] deep_scan_start` — same signature `(app: AppHandle) -> Result<DeepScanResults, String>`. The `DeepScanResults` struct grows additively (new fields for accounts/rhythm/mru; existing fields remain).
- `#[tauri::command] deep_scan_results` — unchanged.
- `#[tauri::command] deep_scan_summary` — unchanged.
- `deep_scan_progress` event — payload extended additively (D-64).
- `~/.blade/identity/scan_results.json` — path + schema-backward-compat (new fields added, existing fields kept).

**What's new (public contract):**
- `#[tauri::command] profile_get_rendered` — overlay-applied profile view.
- `#[tauri::command] profile_overlay_upsert` + `profile_overlay_reset` — edit round-trip.
- `#[tauri::command] scan_cancel` — sets `SCAN_CANCEL: AtomicBool`. New command because old module had no cancel path.
- `~/.blade/identity/profile_overlay.json` — new file, new responsibility.

**Migration story for an existing install:**
- Old `scan_results.json` on disk → loads fine (additive schema — missing new fields default). First new-scanner run writes the new fields in place.
- No data migration script needed. Old installs just see fewer rows in Rhythm/MRU until the next scan.

**Register new module in `lib.rs`:** the existing `mod deep_scan;` line is replaced with `mod deep_scan;` that resolves to `deep_scan/mod.rs`. Rust module system handles file-or-folder resolution automatically. New commands added to `tauri::generate_handler![]` in `lib.rs` (per CLAUDE.md §Module registration §2).

---

### D-67: Plan Layout = 5 Plans in 3 Waves (Mirrors Phase 11 D-58 Pacing)

```
Wave 0 (backend scanner foundation) — parallel:
  12-01  Lead queue core + 3 hot-path scanners
         (queue.rs, leads.rs, scanners/{fs_repos, git_remotes, mru}.rs
         + deep_scan_start rewrite with queue drain
         + SCAN_CANCEL pattern
         + DeepScanResults schema extension
         + unit tests on queue ordering + tier transitions
         + payload additive extension D-64
         — SCAN-01, SCAN-02, SCAN-06, SCAN-09, SCAN-10 backend)

  12-02  Remaining 5 scanners + rhythm compute + privacy config
         (scanners/{ide_workspaces, ai_sessions, shell_history, bookmarks, which_sweep}.rs
         + rhythm signal compute
         + ScanClassesEnabled 6-place field + Settings → Privacy skeleton
         + verify:scan-no-egress + verify:scan-no-write gates
         — SCAN-03, SCAN-04, SCAN-05, SCAN-07, SCAN-08, SCAN-13 data-side)

Wave 1 (profile surface + overlay) — sequential on Wave 0:
  12-03  Profile overlay backend + Tauri commands
         (deep_scan/profile.rs + overlay file format + 3 new #[tauri::command]s
         + orphaned-row merge logic
         + Tauri wrapper in src/lib/tauri/
         — SCAN-11, SCAN-12 backend + command contract)

  12-04  ProfileView + 5 section tabs + live log tail + Settings → Privacy wire-up
         (src/features/identity/ProfileView.tsx + register in identity/index.tsx
         + row edit / hide / delete flows via EditSectionDialog
         + per-row source pill + orphaned pill
         + live log tail collapsed panel
         + Settings → Privacy route with ScanClassesEnabled toggles
         — SCAN-10 UI, SCAN-11 UI, SCAN-12 UI)

Wave 2 (integration + gates + goal-backward trace) — sequential on Wave 1:
  12-05  LLM enrichment + verify gates + manual cold-install trace
         (LLM narrative calls behind Phase 11 providers with 3-call budget
         + 7-day narrative cache
         + verify:scan-event-compat gate (onboarding phase-name stability)
         + verify:all chain extension
         + goal-backward manual trace on Arnav's machine: run scan → assert ≥10 repos / ≥5 accounts / ≥3 rhythm / ≥3 IDE-AI signals per SCAN-13
         — SCAN-13 verification, all remaining SCAN-0N verification)
```

**Wave structure rationale (matches Phase 11 D-58):**
- Wave 0 plans are parallel-safe (independent modules).
- Wave 1 plans depend on Wave 0 output (overlay commands build on the scanner's row_id scheme).
- Wave 2 plans are goal-backward verification — nothing ships if baseline SCAN-13 fails on Arnav's machine.

---

### Claude's Discretion

Areas where the user explicitly delegated; planner/executor have latitude:
- Exact scanner filenames within `deep_scan/scanners/` subtree — D-60 table is the authoritative map, filenames can adjust if conflicts arise.
- Exact SVG / visual treatment for the Profile page (reuses existing primitives per D-63).
- LLM prompt wording for the 3 enrichment calls (D-61) — planner + executor choose wording that fits existing `providers/` module prompt style.
- Specific curated CLI list for `which` sweep (D-59 breadth fill) — D-59 gives the starting list; executor may expand during implementation if obvious tools are missing.
- Hour-of-day heatmap visual style — tailwind grid + CSS variable intensity, following identity feature's existing CSS pattern.
- Exact wording of Settings → Privacy explanatory copy.

### Folded Todos

None — no pending todos in `.planning/todos/` match Phase 12 scope per match-phase query.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 12 goal + falsifiable criteria
- `.planning/ROADMAP.md` §"Phase 12: Smart Deep Scan" (lines 113–131) — Goal, Depends on, SCAN-01..13 map, 5 Success Criteria including SCAN-13 baseline, soft-dep language on Phase 11, observe-only hard rule
- `.planning/REQUIREMENTS.md` §SCAN-01..13 (lines 36–48) — 13 falsifiable requirements
- `.planning/notes/v1-1-milestone-shape.md` §"Phase 2 — Smart Deep Scan" (lines 78–98) — authoritative shape: sources to probe, algorithm, falsifiable success

### Tester-pass evidence grounding
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` §"Tester-Pass Evidence Map" row for symptom #2 (1-repo cold install) — anchors the falsifiable close-target
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` — sidecar for any NOT-WIRED scanner-adjacent rows

### Phase 11 capability-aware routing (soft dep)
- `.planning/phases/11-smart-provider-setup/11-CONTEXT.md` §D-53 — per-capability config fields (`vision_provider`, `audio_provider`, `long_context_provider`, `tools_provider`); D-61 consumes these
- `.planning/phases/11-smart-provider-setup/11-CONTEXT.md` §D-55 — router 3-tier resolution; LLM calls in D-61 route through this

### Project-level constraints
- `.planning/PROJECT.md` §Constraints — observe-only guardrail (v1.1 hard rule) + performance budgets + "no backend rewrites beyond wiring gaps"
- `.planning/PROJECT.md` §"Key Decisions" M-01..M-07 — v1.1 framing decisions locked 2026-04-20
- `/home/arnav/blade/CLAUDE.md` §"Critical Architecture Rules — Rust" — module registration, 6-place config rule, `use tauri::Manager;` gotcha, cancel pattern, `safe_slice` invariant

### Existing module being rewritten
- `src-tauri/src/deep_scan.rs` (1437 LOC) — individual scanner implementations being lifted into `deep_scan/scanners/*.rs`; `deep_scan_start` orchestration at lines 1321–1423 being replaced
- `src-tauri/src/lib.rs` — `mod deep_scan;` + `generate_handler!` registration sites
- `src-tauri/src/config.rs` — `BladeConfig`, `DiskConfig`, `load_config`, `save_config` — 6-place pattern target for `ScanClassesEnabled` (D-65)

### Existing public contract (must stay stable per D-66)
- `src/lib/events/index.ts:92` — `BLADE_EVENTS.DEEP_SCAN_PROGRESS = 'deep_scan_progress'` event name
- `src/lib/events/payloads.ts` §`DeepScanProgressPayload` (line 221 references emit site) — payload shape being extended additively
- `src/features/onboarding/deepScanPhases.ts` — hardcoded phase name list; D-64 compat gate covers this
- `src/features/onboarding/DeepScanStep.tsx` — SVG animation keyed by phase name; must keep working
- `src/lib/tauri/deepscan.ts` + `src/lib/tauri/admin.ts` (lines 1458–1470) — Tauri wrappers for `deep_scan_start` / `deep_scan_results`

### Identity feature pattern (Profile page sibling)
- `src/features/identity/index.tsx` — 7-entry route registry; D-63 adds an 8th entry at same shape
- `src/features/identity/EditSectionDialog.tsx` — reused for per-row edit flow (D-63)
- `src/features/identity/identity.css` — shared styles; no new CSS file needed

### Cross-cutting
- `src/types/provider.ts` §DeepScanResults — permissive `Record<string, unknown>`; additive schema extension is free
- `src/hooks/usePrefs.ts:51` — existing comment `set true after deep_scan_start completes once` — behavior preserved

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src-tauri/src/deep_scan.rs` individual scanner fns** — `scan_installed_apps`, `scan_default_browser`, `scan_ides`, `scan_git_repos`, `scan_shell_history`, `scan_wsl_distros`, `scan_package_managers`, `scan_ai_tools`, `scan_system_info`, `scan_ssh_keys`, `scan_docker`, `scan_browser_bookmarks` — lifted into `deep_scan/scanners/*.rs`; internals kept, orchestration replaced (D-60, D-66).
- **`DeepScanResults` struct** (deep_scan.rs:97–111) — additively extended for `accounts`, `rhythm_signals`, `mru_files` fields (D-60).
- **`save_results` / `load_results` helpers** — keep for `scan_results.json`; new overlay file gets parallel helpers (D-62).
- **`seed_knowledge_graph` downstream side-effect** — stays wired (currently spawned via `tokio::task::spawn_blocking` after scan completes); re-used unchanged.
- **`deep_scan_progress` Tauri event** — additively extended payload (D-64) keeps onboarding consumer working.
- **`src/features/identity/index.tsx` registry** — 8th entry adds cleanly (D-63); shape already proven across 7 sibling views.
- **`src/features/identity/EditSectionDialog.tsx`** — reused for per-row profile edits (D-63).
- **`src/hooks/useTauriEvent`** (PROJECT.md §Validated) — only permitted event subscription pattern (D-13); ProfileView live-tail uses this.
- **Config 6-place pattern** (CLAUDE.md) — `ScanClassesEnabled` follows exact pattern from Phase 11 D-53's 4 new fields.
- **`AtomicBool` cancel sentinel pattern** (CLAUDE.md) — `SCAN_CANCEL` mirrors background-task cancel pattern.

### Established Patterns
- **Sibling-view registration** — `features/identity/index.tsx` is the registry; editing it is the Phase 6 D-143 single-writer exception (the file IS the registry).
- **Module registration 6-place rule** (CLAUDE.md) — every new BladeConfig field touches 6 sites or the disk round-trip breaks.
- **Additive event payloads** — existing consumers keep working when new optional fields are added; verified by a new `verify:scan-event-compat` gate.
- **Verify-gate extension** — v1.1 adds verify scripts to the existing 18-gate chain; Phase 12 adds 3 (scan-no-egress, scan-no-write, scan-event-compat).
- **Phase 11 D-58 wave structure** — Wave 0 backend parallel, Wave 1 shared UI sequential, Wave 2 verification. D-67 mirrors this.
- **Silence-log-spam discipline** (tester-pass `4ab464c`) — LLM call failures log once, no retry loops (D-61).

### Integration Points
- **Frontend route registry** — `src/lib/router.ts` gets a `profile` route entry via identity `index.tsx`; no change to `router.ts` itself.
- **Command palette** — new `profile` entry in App.tsx command palette (Features section), matches CLAUDE.md new-route 3-place rule.
- **Tauri command registration** — `lib.rs` `generate_handler![]` gets: `profile_get_rendered`, `profile_overlay_upsert`, `profile_overlay_reset`, `scan_cancel` (4 new commands).
- **Verify chain** — `package.json` `verify:all` script extends to call `verify:scan-no-egress`, `verify:scan-no-write`, `verify:scan-event-compat`.
- **Phase 11 provider layer** — `providers/mod.rs` unified gateway is called from `deep_scan/mod.rs` for the 3 LLM enrichment calls; uses `provider_capabilities` HashMap lookup (D-53) to pick `long_context_provider` first.
- **Onboarding compat** — `OnboardingFlow.tsx` → `DeepScanStep.tsx` → listens for `deep_scan_progress` → no change required; additive payload keeps old consumers happy.

</code_context>

<specifics>
## Specific Ideas

- **Scan "thinks out loud" UX** — milestone shape §Phase 2 algorithm: "streams results to the activity log so user sees the scan think out loud." Render the lead tail as prose-ish messages ("found 12 git repos → reading remotes for 3 hot repos → found 2 GitHub accounts") rather than raw JSON events. Message comes from the emit-site at scanner level, not computed in the UI.
- **Priority queue is observable** — SCAN-09 "todo order is visible in the activity log stream" requires the tail to show the priority_tier and queue_depth; user sees "hot queue 4/12 remaining" style progress, not just a spinner.
- **Baseline is measured, not claimed** — Wave 2 manual trace on Arnav's machine is goal-backward verification matching Phase 11 11-06. Numbers come from the actual cold-install run, not from synthesized test data.
- **Overlay wins over scan, always** — if a user edits "this repo is actually for work-project-X" and re-scan keeps finding it as "personal", the edit persists. No "smart merge" that second-guesses the user.
- **New Profile page gets its own entry, doesn't replace anything** — the 7 existing identity sub-views (Soul, Persona, Character Bible, Negotiation, Reasoning, Context Engine, Sidecar) stay untouched; Profile becomes the 8th entry.

</specifics>

<deferred>
## Deferred Ideas

Ideas surfaced in analysis but belong in other phases or backlog:

- **Tentacle auto-enable from scan findings** — Phase 13 (ECOSYS-01..10). Phase 12 produces the structured profile that Phase 13 consumes.
- **Persistent Activity Log strip across all routes** — Phase 14 (LOG-01/02). Phase 12 ships the simple in-page log tail only.
- **Dashboard cards binding to profile data** (e.g. "working on X repos this week") — Phase 15 (DENSITY/DASH).
- **Continuous / background re-scan** — out of scope for v1.1. Current behavior: manual scan via Onboarding (once) + manual Re-scan button in Profile / Settings. A scheduled re-scan (cron-style, e.g. weekly) is a v1.2+ conversation once we have telemetry on scan cost.
- **Profile data egress / export** — out of scope. The observe-only guardrail means scan results stay on disk in `~/.blade/identity/`; no share, no upload, no MCP resource exposure in v1.1.
- **Deep-scan WSL distro enumeration** — currently implemented in `scan_wsl_distros` and works on Windows host. Kept as-is (lifted into `scanners/`) but not counted toward SCAN-13 baseline on Arnav's Linux-WSL machine (baseline counts Linux-side signals).
- **Mac-specific app enumeration (`/Applications`)** — already handled by existing `scan_installed_apps`; lifted unchanged. Mac-smoke checkpoint M-46 remains operator-owned.

</deferred>

---

*Phase: 12-smart-deep-scan*
*Context gathered: 2026-04-20*
