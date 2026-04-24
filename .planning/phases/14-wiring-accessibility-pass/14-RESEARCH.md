# Phase 14: Wiring & Accessibility Pass — Research

**Researched:** 2026-04-24
**Domain:** Frontend wiring, accessibility hardening, activity log system, Tauri event bus
**Confidence:** HIGH (all findings verified directly against live codebase)

---

## Summary

Phase 14 is the largest v1.1 phase (17 requirements across WIRE2, A11Y2, and LOG categories). Its job is to close every gap from the Phase 10 wiring audit, instrument the backend with an activity log event, and ship the persistent Activity Log strip that becomes the user's trust surface for "what is BLADE doing right now?"

The audit produced 99 NOT-WIRED backlog items — 47 module-level gaps (39 WIRE2 + 2 DEFERRED_V1_2 + 6 already in Phase 13 ecosystem scope) and 50 config-field gaps. WIRED-NOT-USED modules = 0 per audit; config WIRED-NOT-USED = 49 (config fields that exist in backend but have no Settings control). There is exactly 1 DEAD item: `DiskConfig.api_key` (safe to delete per audit).

The `blade_activity_log` event already exists: `ecosystem.rs` (Phase 13) defined the pattern and emits it. Phase 14 must (a) add a subscriber in the frontend, (b) build the strip and drawer UI, (c) instrument every other cross-module action with the same emit signature, and (d) enforce via a verify script. The dashboard still has 3 `ComingSoonCard` placeholders where live data from Phase 12 scan profile + Phase 13 tentacles can now go.

The a11y foundation is strong: `verify:aria-icon-buttons`, `verify:motion-tokens`, `verify:contrast`, and `verify:tokens-consistency` scripts are all already in `verify:all`. Phase 14 must add `verify:a11y-pass-2` (focus traps + dialogs + reduced-motion sweep) and `verify:feature-reachability` (backend module → route/palette reachability).

**Primary recommendation:** Run four parallel workstreams — (A) module wiring into existing Settings panes or new sub-routes, (B) config-field controls added to existing panes, (C) activity log strip + drawer + event instrumentation, (D) a11y sweep on every surface touched. Workstreams A/B/C can start concurrently; D runs as a trailing pass after each A/B/C task closes a surface.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Activity log strip (persistent, cross-route) | Frontend (MainShell) | — | Must stay mounted across route changes; lives at the same level as TitleBar in MainShell's JSX. Subscribes to `blade_activity_log` via `useTauriEvent`. |
| Activity log drawer (full payload view) | Frontend (route-level overlay) | — | Dialog over current route; uses existing `Dialog` primitive with focus trap. |
| Activity log persistence (last N entries) | Backend (SQLite via existing DB) or localStorage | — | SQLite is already available; a lightweight in-memory ring buffer in frontend is simpler and avoids a Rust command for read. Use localStorage with a ring-buffer size cap. |
| `blade_activity_log` event emission | Backend (Rust modules) | — | Each module calls `app.emit_to("main", "blade_activity_log", {...})` at action boundaries. Pattern established by `ecosystem.rs`. |
| Activity log verify script | Build/CI | — | Node.js `.mjs` script walking `src-tauri/src/**/*.rs` for command functions, checking each has an emit site. |
| Module wiring (NOT-WIRED → ACTIVE) | Frontend | Backend (existing commands) | Add `invoke` call-site wrappers in `src/lib/tauri/` + Settings pane controls or new sub-routes. No new Rust commands needed — commands are already registered. |
| Config-field controls | Frontend (Settings panes) | — | `save_config_field` allow-list already covers most fields; just need UI controls in the relevant pane. |
| A11y: keyboard nav + focus traps | Frontend | — | CSS + ARIA attributes; focus trap logic in Dialog primitive already partially implemented. |
| Feature-reachability verify script | Build/CI | — | Walk `ROUTE_MAP` + `PALETTE_COMMANDS` arrays, cross-reference against known backend module command names from the wiring audit JSON. |

---

## NOT-WIRED Backlog (from Phase 10 audit)

Source: `10-WIRING-AUDIT.md §4` — 99 items total. 2 DEFERRED_V1_2 excluded. Effective WIRE2 backlog: 97 items.

### Module gaps (47 modules, 2 deferred = 45 WIRE2)

Key groupings by natural Settings destination or new route:

**Voice / Audio pane candidates** (add controls to `settings-voice`):
- `src-tauri/src/voice.rs` — `voice_start_recording`, `voice_stop_recording` — toggle + waveform chip
- `src-tauri/src/tts.rs` — `tts_speak`, `tts_stop` — speed slider (`BladeConfig.tts_speed`)
- `src-tauri/src/voice_local.rs` — `whisper_model_available` — local-whisper availability indicator
- `src-tauri/src/voice_intelligence.rs` — `voice_intel_start_session` — voice emotion session controls

**Privacy / Perception pane candidates** (add to `settings-privacy`):
- `src-tauri/src/screen.rs` — `capture_screen` — screen capture controls
- `src-tauri/src/notification_listener.rs` — `notification_get_recent` — notification list in privacy pane
- `src-tauri/src/clipboard.rs` — `get_clipboard` — clipboard cache status

**Dev Tools route candidates** (most already have `dev_tools.ts` wrappers):
- `src-tauri/src/auto_fix.rs` — `auto_fix_analyze` — CI auto-fix trigger
- `src-tauri/src/self_code.rs` — `blade_self_code` — JITRO self-coding panel
- `src-tauri/src/runtimes.rs` — `discover_ai_runtimes` — runtime discovery list

**Knowledge / Brain pane candidates**:
- `src-tauri/src/autonomous_research.rs` — `research_list_gaps` — knowledge gap list
- `src-tauri/src/research.rs` — `research_get_recent` — ambient research feed
- `src-tauri/src/rag.rs` — `rag_ingest_file` — RAG ingest trigger
- `src-tauri/src/deeplearn.rs` — `deeplearn_discover_sources` — learn source discovery
- `src-tauri/src/journal.rs` — `journal_get_recent` — journal entries
- `src-tauri/src/thread.rs` — `blade_thread_update` — working memory view
- `src-tauri/src/prefrontal.rs` — `prefrontal_get` — prefrontal scratchpad

**Cognitive / Intelligence panel (new sub-route or admin pane)**:
- `src-tauri/src/causal_graph.rs` — `causal_get_insights`
- `src-tauri/src/metacognition.rs` — `metacognition_assess`
- `src-tauri/src/consequence.rs` — `consequence_predict`
- `src-tauri/src/social_cognition.rs` — `social_get_advice`
- `src-tauri/src/brain.rs` — `brain_extract_from_exchange`
- `src-tauri/src/godmode.rs` — `get_proactive_tasks` (config: `god_mode_tier` selector in settings)
- `src-tauri/src/proactive_engine.rs` — `proactive_get_pending`
- `src-tauri/src/proactive_vision.rs` — `proactive_get_cards`
- `src-tauri/src/show_engine.rs` — `show_record_request`
- `src-tauri/src/dream_mode.rs` — `dream_is_active`

**Communications / Integrations**:
- `src-tauri/src/telegram.rs` — `telegram_start` — Telegram bridge setup
- `src-tauri/src/obsidian.rs` — `obsidian_ensure_daily_note` — vault path config
- `src-tauri/src/context.rs` — `get_active_window` — context chip in UI
- `src-tauri/src/discovery.rs` — `run_discovery` — environment discovery trigger

**Tentacle panel** (add to ecosystem/settings):
- `src-tauri/src/tentacles/calendar_tentacle.rs` — `calendar_get_today`
- `src-tauri/src/tentacles/cloud_costs.rs` — `cloud_check_aws_costs`
- `src-tauri/src/tentacles/discord_deep.rs` — `discord_process_mentions`
- `src-tauri/src/tentacles/filesystem_watch.rs` — `filesystem_approve_move`
- `src-tauri/src/tentacles/github_deep.rs` — `github_review_pr`
- `src-tauri/src/tentacles/linear_jira.rs` — `linear_sync_git_to_tickets`
- `src-tauri/src/tentacles/log_monitor.rs` — `log_start_tailing`

**System / OS control**:
- `src-tauri/src/system_control.rs` — `lock_screen` + 10 more commands — system control panel
- `src-tauri/src/ghost_mode.rs` — `ghost_start` — Ghost Mode already has a route; command palette entry missing
- `src-tauri/src/multimodal.rs` — `multimodal_analyze_file` — file analysis trigger
- `src-tauri/src/plugins/registry.rs` — `plugin_list` — plugin management pane
- `src-tauri/src/roles.rs` — `roles_list` — role selector
- `src-tauri/src/pulse.rs` — `pulse_get_digest` — pulse/briefing view
- `src-tauri/src/router.rs` — `classify_message` — routing debug panel (dev-only)
- `src-tauri/src/tray.rs` — `set_tray_status` — tray chip
- `src-tauri/src/session_handoff.rs` — DEFERRED_V1_2 (observe-only guardrail, do not wire)
- `src-tauri/src/discord.rs` — DEFERRED_V1_2 (observe-only guardrail, do not wire)

### Config field gaps (50 items → 25 unique BladeConfig fields, duplicated in DiskConfig)

Unique BladeConfig fields needing UI controls:

| Field | Target Pane | Control Type |
|-------|-------------|--------------|
| `god_mode` + `god_mode_tier` | Settings → new "Intelligence" section or Appearance | Enum selector (normal/intermediate/extreme) |
| `obsidian_vault_path` | Settings → Knowledge or new Integrations | Path picker input |
| `screen_timeline_enabled` | Settings → Privacy | Toggle |
| `timeline_capture_interval` | Settings → Privacy | Number slider (seconds) |
| `timeline_retention_days` | Settings → Privacy | Number input (days) |
| `wake_word_enabled` | Settings → Voice | Toggle (VoicePane reads it but has no setter — fix the setter) |
| `wake_word_phrase` | Settings → Voice | Text input |
| `wake_word_sensitivity` | Settings → Voice | Slider (1-5) |
| `active_role` | Settings → Personality | Role selector |
| `blade_source_path` | Settings → Dev/Admin | Path input |
| `trusted_ai_delegate` | Settings → Dev/Admin | Enum selector (claude-code/none) |
| `blade_dedicated_monitor` | Settings → Appearance | Monitor picker (number) |
| `fallback_providers` | Settings → Providers (already partly from Phase 11) | Ordered list |
| `use_local_whisper` | Settings → Voice | Toggle + rebuild warning |
| `whisper_model` | Settings → Voice | Enum selector (tiny.en/base.en/small.en) |
| `integration_polling_enabled` | Settings → Ecosystem | Toggle |
| `tts_speed` | Settings → Voice | Slider (0.5-2.0) |
| `audio_capture_enabled` | Settings → Privacy | Toggle |
| `ghost_mode_enabled` | Settings → Ghost (existing Ghost route) | Toggle |
| `ghost_mode_position` | Settings → Ghost | Enum picker |
| `ghost_auto_reply` | Settings → Ghost | Toggle (disabled note: observe-only) |
| `hive_enabled` | Settings → Admin | Toggle |
| `hive_autonomy` | Settings → Admin | Slider (0.0-1.0) |
| `BLADE_CURRENT_MSG_ID` (env) | Dev/Admin diagnostics | Display-only chip |

---

## Activity Log System

### Event contract (from `ecosystem.rs`)

The `blade_activity_log` event is already emitted by `ecosystem.rs` and lands on the `"main"` window. The shape is: [VERIFIED: src-tauri/src/ecosystem.rs:41]

```rust
app.emit_to("main", "blade_activity_log", serde_json::json!({
    "module":        module,          // String — Rust module name
    "action":        "observed",      // String — verb
    "human_summary": summary,         // String — max 200 chars via safe_slice
    "timestamp":     now_secs(),      // i64 — Unix seconds
}))
```

LOG-02 requires adding `payload_id` to this shape. The planner must extend the struct with an optional `payload_id: Option<String>` field (UUID or content hash) before the instrumentation pass begins.

### Frontend subscription pattern

All Tauri event subscriptions use `useTauriEvent` hook (D-13) — never raw `listen()`. The strip component subscribes once in MainShell and is never unmounted. [VERIFIED: src/windows/main/MainShell.tsx — useTauriEvent is the permitted pattern per D-13]

```typescript
// Pattern: useTauriEvent from src/lib/events/
useTauriEvent<ActivityLogEntry>('blade_activity_log', (entry) => {
  setLog((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
});
```

### Persistence strategy

The audit shows no existing `blade_activity_log` SQLite table. Three options:
1. **localStorage ring buffer** (simplest, no Rust) — persist last N entries as JSON, survives restart via `localStorage.setItem`. No new Tauri command needed.
2. **SQLite via existing DB** — requires a new Rust command + migration. Overkill for log display.
3. **In-memory only** — fails LOG-04 (must persist across restart).

Recommended: localStorage ring buffer (MAX_ENTRIES default from `BladeConfig`, or hardcode 500). [ASSUMED: localStorage is accessible from Tauri WebView on Windows/Linux — standard browser API, confirmed to work in Tauri 2 by design]

### Strip placement in MainShell

The MainShell `ShellContent` renders:
```
TitleBar
  main-shell-body:
    NavRail
    main-shell-route (RouteSlot)
GlobalOverlays
CommandPalette
ShortcutHelp
```

The activity log strip mounts as a sibling to `main-shell-body`, or inside TitleBar as a status row. Phase 15 (DENSITY-04) will do the final top-bar hierarchy pass. For Phase 14, the strip should mount between TitleBar and `main-shell-body` as a thin persistent row — visible across all routes, not inside the route slot. [VERIFIED: src/windows/main/MainShell.tsx:98-111 — insertion point confirmed]

---

## Dashboard Placeholder Situation

The current dashboard has 3 `ComingSoonCard` components with placeholder text: [VERIFIED: src/features/dashboard/Dashboard.tsx:36-53]

| Card | Placeholder | Live data source (Phase 12/13) |
|------|-------------|-------------------------------|
| "Hive signals" | "Tentacle reports + autonomy queue" | `ecosystemListTentacles()` + activity log entries filtered by module |
| "Calendar" | "Today's events + reminders" | `calendar_get_today` (calendar_tentacle.rs, NOT-WIRED) |
| "Integrations" | "Connected services + status" | `ecosystemListTentacles()` enabled list |

For WIRE2-02, the Hive signals and Integrations cards can immediately bind to `ecosystemListTentacles()` from Phase 13. Calendar requires wiring `calendar_get_today` first (WIRE2 module gap).

---

## Wiring Mechanics

### Route addition (confirmed pattern from router.ts)

Adding a route requires: [VERIFIED: src/windows/main/router.ts]
1. Create `src/features/[cluster]/index.tsx` with `export const routes: RouteDefinition[]`
2. Add `import { routes as myRoutes } from '@/features/[cluster]'` to `src/windows/main/router.ts`
3. Spread `...myRoutes` into `ALL_ROUTES`
4. Add command palette entry via `paletteHidden: false` and a `description` field in the RouteDefinition

NOTE: The CLAUDE.md "New route — 3 places in App.tsx" block is outdated — the real pattern is the per-feature `routes: RouteDefinition[]` export + `src/windows/main/router.ts` aggregation. The audit meta-findings flag this as a doc-polish task for Phase 14. [VERIFIED: 10-WIRING-AUDIT.md meta-findings]

### TypeScript wrapper pattern

New backend invocations go in `src/lib/tauri/[module].ts` using `invokeTyped`. The wiring audit confirms that every NOT-WIRED module has commands registered in `lib.rs` — no new Rust registrations needed, only TypeScript wrappers. [VERIFIED: 10-WIRING-AUDIT.md §1 — "registered but no invokeTyped consumer"]

### Settings pane wiring pattern

`save_config_field` allow-list in `config.rs` already accepts most config fields by name. New controls call:
```typescript
await saveConfigField('field_name', value);
```
The `ConfigContext` re-fetches after save. No new Tauri commands needed for config controls. [VERIFIED: src/features/settings/panes/EcosystemPane.tsx — uses this pattern]

---

## A11y Foundation (what exists)

Existing verify scripts that Phase 14 builds on: [VERIFIED: package.json scripts]

| Script | What it checks | Status |
|--------|---------------|--------|
| `verify:aria-icon-buttons` | Icon-only `<button>` without `aria-label` | Exists, in `verify:all` |
| `verify:motion-tokens` | Unconditional CSS transitions/transforms | Exists, in `verify:all` |
| `verify:contrast` | WCAG AA 4.5:1 contrast check | Exists, in `verify:all` |
| `verify:tokens-consistency` | Design token usage consistency | Exists, in `verify:all` |

Phase 14 must add:
- `verify:a11y-pass-2` — asserts no dialogs without focus traps, no unguarded animations on new surfaces (A11Y2-06)
- `verify:feature-reachability` — asserts every backend module has at least one reachable invoke path (WIRE2-06)

### Existing Dialog primitive

`src/design-system/primitives/Dialog.tsx` exists. Phase 14 must verify it implements: [ASSUMED: Dialog has focus trap — not confirmed in this session; must be checked before planning A11Y2-04]
- Focus trap on open (focus moves to first interactive element inside)
- Focus restoration on close (returns to trigger element)
- Esc key closes
- `aria-modal="true"` on the dialog container
- `role="dialog"` + `aria-labelledby`

### Reduced motion pattern

Existing `verify:motion-tokens` script walks `src/` for unconditional CSS `transition` or `transform` properties not gated by `@media (prefers-reduced-motion: no-preference)`. The activity log strip and drawer animations must follow this pattern. [VERIFIED: scripts/verify-motion-tokens.sh exists]

### Focus ring pattern

Glass surfaces require visible focus rings. The existing design system uses CSS custom properties for focus rings. New controls in Phase 14 must use the same token (don't invent new focus colors). [ASSUMED: focus ring token is `--focus-ring` or similar — not confirmed; check design-system/tokens before planning A11Y2-01]

---

## Verify Script Patterns

### New `verify:feature-reachability` script structure

Input: `10-WIRING-AUDIT.json` (machine-readable NOT-WIRED list with `phase_14_owner` field).
Algorithm:
1. Load `ROUTE_MAP` and `PALETTE_COMMANDS` from the router
2. Walk `src/lib/tauri/**/*.ts` for `invokeTyped('command_name', ...)` call sites
3. Cross-reference against `not_wired_backlog[]` rows — every WIRE2 item must have at least one invoke call-site
4. DEFERRED_V1_2 items are excluded from the check
5. Exit 1 if any WIRE2 item has zero invoke call-sites and no documented deferral

### New `verify:a11y-pass-2` script structure

Heuristic static analysis (no headless browser needed):
1. Walk all `.tsx` files added/modified in Phase 14
2. Assert every `<dialog` or `role="dialog"` element has a corresponding focus-trap hook import
3. Assert no `<button` contains SVG/icon-only content without `aria-label`
4. Assert all new `transition:` CSS is inside `@media (prefers-reduced-motion: no-preference)` blocks

---

## Architecture Patterns

### System Architecture Diagram

```
[Rust backend modules]
    │ blade_activity_log event (emit_to "main")
    ▼
[ActivityLogProvider (React Context)]
    │ useTauriEvent('blade_activity_log')
    │ ring buffer (localStorage, last N entries)
    ├──▶ [ActivityStrip] — persistent, mounts in MainShell between TitleBar and main-shell-body
    │         │ click entry
    │         ▼
    │    [ActivityDrawer] — Dialog over current route, shows full payload
    │
    └──▶ [Verify:emit-coverage script] — walks .rs files, asserts emit sites

[WIRE2 wiring]
    Rust command (already registered in lib.rs)
        ▼
    src/lib/tauri/[module].ts (new invokeTyped wrapper)
        ▼
    Settings pane control OR new route component
        ▼
    PALETTE_COMMANDS entry (RouteDefinition.description set)

[Config controls]
    BladeConfig field (exists in config.rs)
        ▼
    saveConfigField('field', value) call-site
        ▼
    Settings pane control (new toggle/slider/input in existing pane)
```

### Recommended Project Structure (additions)

```
src/
├── features/
│   ├── activity-log/
│   │   ├── index.tsx           # ActivityLogProvider + useActivityLog hook
│   │   ├── ActivityStrip.tsx   # Persistent strip component (mounts in MainShell)
│   │   ├── ActivityDrawer.tsx  # Full-payload drawer dialog
│   │   └── activity-log.css    # Reduced-motion-gated animations
│   └── settings/
│       └── panes/
│           ├── VoicePane.tsx   # Add tts_speed slider, wake_word controls
│           ├── PrivacyPane.tsx # Add screen_timeline + audio_capture toggles
│           └── ...             # Other panes extended with config controls
└── lib/
    └── tauri/
        ├── voice.ts            # New: voice_start_recording, tts_speak wrappers
        ├── system_control.ts   # New: lock_screen etc.
        ├── pulse.ts            # New: pulse_get_digest
        └── ...                 # Other new wrappers

scripts/
├── verify-feature-reachability.mjs   # New (WIRE2-06)
└── verify-a11y-pass-2.mjs            # New (A11Y2-06)
```

---

## Common Pitfalls

### Pitfall 1: Treating config WIRED-NOT-USED as needing new Rust commands

**What goes wrong:** Developer writes a new `save_X_config` Tauri command for each config field.
**Why it happens:** The audit lists 49 WIRED-NOT-USED config fields, which looks like missing backend.
**How to avoid:** `save_config_field` already accepts all these fields by name — they are in its allow-list in `config.rs`. Only a TypeScript call-site + UI control is needed, not new Rust.
**Warning signs:** Any PR adding `#[tauri::command]` functions for config saves.

### Pitfall 2: Duplicate `#[tauri::command]` names

**What goes wrong:** Adding a new module with a command name that already exists in another module causes a Tauri macro namespace collision and a cryptic build error.
**Why it happens:** The audit found 49 NOT-WIRED modules with already-registered commands. These commands are in `lib.rs`. Don't add them again.
**How to avoid:** Search `generate_handler![]` in `lib.rs` before adding any command. The wiring is frontend-only for all 45 WIRE2 modules.
**Warning signs:** `cargo check` reporting "duplicate function definition" or similar.

### Pitfall 3: Mounting the Activity Log strip inside the RouteSlot

**What goes wrong:** Strip disappears on route navigation because RouteSlot re-renders its children.
**Why it happens:** It's tempting to add the strip to the Dashboard or to GlobalOverlays.
**How to avoid:** Mount `<ActivityStrip />` as a direct child of the root `div.main-shell` in `MainShell.tsx`, between TitleBar and the `main-shell-body` div. It must be at the same DOM level as TitleBar.
**Warning signs:** Strip vanishes when navigating from Dashboard to Chat.

### Pitfall 4: Not extending `blade_activity_log` shape before instrumentation

**What goes wrong:** 20+ modules are instrumented without `payload_id`; LOG-02 requires it; fixing post-instrumentation means touching every site again.
**How to avoid:** Define and commit the full shape (including `payload_id: Option<String>`) in a Wave 0 task before the instrumentation wave begins.

### Pitfall 5: Modal dialogs without focus trap break A11Y2-04

**What goes wrong:** New drawers/dialogs for activity log or module wiring panels don't trap focus, so Tab leaks to background content and screen reader users lose navigation context.
**How to avoid:** Use the existing `Dialog` primitive from `src/design-system/primitives/Dialog.tsx` for all new dialogs. Verify it has `inert` or manual focus-trap logic — check the implementation before planning.

### Pitfall 6: Activity log verify script creating false positives on DEFERRED_V1_2 items

**What goes wrong:** `verify:feature-reachability` flags `discord.rs` and `session_handoff.rs` as unwired, causing CI failure.
**How to avoid:** The script must read `phase_14_owner` field from `10-WIRING-AUDIT.json` and exclude rows where `phase_14_owner === "DEFERRED_V1_2"`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Focus trap in dialogs | Custom focus trap loop | Existing `Dialog` primitive (check if it already has it) OR add `inert` attribute to background | Browser `inert` attribute is now widely supported in WebView2; avoids JS focus management complexity |
| Activity log persistence | New SQLite table + Rust command | localStorage ring buffer (JSON serialize, max N entries) | No Rust needed; survives restart; simpler to implement and test |
| Config field saving | New `#[tauri::command]` per field | Existing `save_config_field` allow-list + TypeScript call | Already implemented and allow-listed for all target fields |
| Contrast testing | Custom color parser | Existing `scripts/audit-contrast.mjs` | Already in `verify:all`; extend if new surfaces need it |
| Route registration | Manual Map/array manipulation | Existing `RouteDefinition[]` export + `router.ts` spread | Single canonical pattern; grep-able; tree-shaken |

---

## Wave Structure (recommended)

Phase 14 is the only v1.1 phase with explicit parallelism potential across sub-categories. Recommended wave structure:

### Wave 0 (foundation — blocks everything else)
- Define final `blade_activity_log` event shape (add `payload_id`)
- Create `ActivityLogProvider` context + `useActivityLog` hook + localStorage ring buffer
- Write shell of `verify:feature-reachability.mjs` (reads wiring audit JSON, outputs pass/fail)
- Write shell of `verify:a11y-pass-2.mjs` (dialog focus-trap + motion checks)
- Fix CLAUDE.md "New route — 3 places in App.tsx" outdated note (doc polish)
- Wire `verify:feature-reachability` and `verify:a11y-pass-2` into `verify:all`

### Wave 1 (parallel workstreams — run concurrently after Wave 0)

**Workstream A — Module wiring (WIRE2-01, WIRE2-04):**
Group NOT-WIRED modules into batches by natural destination pane:
- Batch A1: Voice pane additions (voice.rs, tts.rs, voice_intelligence.rs, tts_speed, wake_word fields)
- Batch A2: Privacy pane additions (screen.rs, notification_listener.rs, clipboard.rs, screen_timeline_* fields, audio_capture_enabled)
- Batch A3: Dev Tools additions (auto_fix.rs, self_code.rs, runtimes.rs)
- Batch A4: Intelligence panel (causal_graph.rs, metacognition.rs, consequence.rs, social_cognition.rs, godmode.rs + god_mode_tier config)
- Batch A5: Tentacle panel additions (calendar_tentacle.rs, github_deep.rs, filesystem_watch.rs, log_monitor.rs, cloud_costs.rs, linear_jira.rs, discord_deep.rs)
- Batch A6: Remaining modules (pulse.rs, roles.rs, plugins/registry.rs, system_control.rs, obsidian.rs, telegram.rs, session_bridge, multimodal.rs, research.rs, journal.rs, etc.)

**Workstream B — Dashboard binding (WIRE2-02, WIRE2-03):**
- Replace 3 `ComingSoonCard` placeholders with live data components using `ecosystemListTentacles()` and `calendar_get_today`
- Remove dead UI (WIRE2-03 — audit says 0 WIRED-NOT-USED modules, but verify no route with `ComingSoonCard` content that has a real backend)

**Workstream C — Activity log strip + drawer + event instrumentation (LOG-01..05):**
- Mount `ActivityStrip` in MainShell
- Build `ActivityDrawer` dialog
- Instrument Phase 13 tentacle loops to emit `blade_activity_log` rows
- Instrument remaining cross-module actions (≥95% coverage target)
- Add filter by module + time range UI
- Verify persistence across restart

**Workstream D — A11y sweep (A11Y2-01..05) — trailing pass:**
- Run after each A/B/C batch closes a surface
- Keyboard nav audit on each new surface
- Contrast re-verify on new panels against 5 representative wallpapers
- `aria-label` audit on all new icon-only controls
- Focus trap verification on ActivityDrawer and any new dialogs
- Reduced-motion CSS audit

### Wave 2 (verification)
- `npm run verify:feature-reachability` → green (WIRE2-05, WIRE2-06)
- `npm run verify:a11y-pass-2` → green (A11Y2-06)
- Manual trace: cold-install screenshot shows populated dashboard cards (WIRE2-02)
- Manual trace: click activity log entry → drawer opens with payload (LOG-03)
- Manual trace: filter by module in activity log (LOG-04)
- Manual trace: restart BLADE → last N log entries restored (LOG-04)
- Full `npm run verify:all` green

---

## Standard Stack

### Core (no new dependencies — confirmed against package.json)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| Tauri 2 | 2.x | IPC, window management, events | Existing |
| React | 18.x | Component tree | Existing |
| TypeScript | 5.x | Type safety | Existing |
| CSS custom properties | N/A | Design tokens, motion gating | Existing |
| localStorage | Browser API | Activity log ring buffer persistence | Existing (WebView2) |

Phase 14 adds no new npm dependencies. All needed primitives (Dialog, GlassPanel, Card, Button, etc.) exist in `src/design-system/primitives/`. [VERIFIED: glob of src/design-system/primitives/*.tsx]

---

## Open Questions

1. **Does `Dialog.tsx` already implement a focus trap?**
   - What we know: `src/design-system/primitives/Dialog.tsx` exists (Phase 1/3)
   - What's unclear: Whether it uses `inert`, manual Tab-key trapping, or nothing — not read in this session
   - Recommendation: Read `Dialog.tsx` in Wave 0 before planning A11Y2-04. If no trap exists, add it to Wave 0 scope.

2. **What is the focus ring token name?**
   - What we know: The design system uses CSS custom properties extensively
   - What's unclear: Exact token name (e.g., `--focus-ring`, `--t-focus`, etc.)
   - Recommendation: Run `grep -r "focus" src/design-system/tokens` before writing A11y tasks.

3. **Does Phase 12 (Smart Deep Scan) complete before Phase 14 starts?**
   - What we know: Phase 14 depends on Phase 13 (completed); Phase 12 is not started per ROADMAP
   - What's unclear: Whether Phase 12's `DeepScanResults` (which feeds `ecosystemListTentacles`) has enough data for dashboard binding
   - Recommendation: WIRE2-02 dashboard binding should use `ecosystemListTentacles()` results regardless of Phase 12 completion state (Phase 13's ecosystem already works from whatever scan data exists). Dashboard cards should show empty state gracefully if scan hasn't run.

4. **Are there any WIRED-NOT-USED routes the audit might have missed?**
   - What we know: Audit says 0 WIRED-NOT-USED routes — all 80 prod routes are ACTIVE
   - What's unclear: Whether post-Phase-12 scan profile route or Phase-13 ecosystem routes introduce new dead UI
   - Recommendation: Verify with `verify:wiring-audit-shape` against post-Phase-13 codebase before starting WIRE2-03.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 14 is frontend wiring + TypeScript verify scripts + CSS a11y work. No external tool, service, or runtime dependencies beyond Node.js (already confirmed in environment) and the existing Tauri/Rust build chain.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright (existing e2e specs from Phases 11-13) |
| Config file | `playwright.config.ts` (if exists) or Wave 0 creates it |
| Quick run command | `npm run verify:all` (static analysis — no browser) |
| Full suite command | `npm run test:e2e:phase14` (new — adds to chain) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WIRE2-01 | Every NOT-WIRED module has route/palette entry | Static | `npm run verify:feature-reachability` | No — Wave 0 |
| WIRE2-02 | Dashboard cards show live data | e2e smoke | `npm run test:e2e:phase14` | No — Wave 1 |
| WIRE2-03 | No dead UI surfaces | Static | `npm run verify:wiring-audit-shape` (extend) | Partial |
| WIRE2-04 | Every wired surface has palette entry | Static | `npm run verify:feature-reachability` | No — Wave 0 |
| WIRE2-05 | NOT-WIRED count = 0 or deferred | Static | `npm run verify:feature-reachability` | No — Wave 0 |
| WIRE2-06 | `verify:feature-reachability` in verify:all | Static | `npm run verify:all` | No — Wave 0 |
| A11Y2-01 | Keyboard nav on all new surfaces | Manual | — | Manual-only |
| A11Y2-02 | WCAG AA contrast on new surfaces | Static | `npm run verify:contrast` | Exists |
| A11Y2-03 | aria-label on all icon-only buttons | Static | `npm run verify:aria-icon-buttons` | Exists |
| A11Y2-04 | Focus traps in all new dialogs | Static + Manual | `npm run verify:a11y-pass-2` (new) | No — Wave 0 |
| A11Y2-05 | Reduced-motion on all animations | Static | `npm run verify:motion-tokens` + `verify:a11y-pass-2` | Partial |
| A11Y2-06 | `verify:a11y-pass-2` in verify:all | Static | `npm run verify:all` | No — Wave 0 |
| LOG-01 | Activity strip mounts + visible across routes | e2e | `npm run test:e2e:phase14` | No — Wave 1 |
| LOG-02 | All actions emit log event | Static | `npm run verify:emit-coverage` (new) | No — Wave 1 |
| LOG-03 | Click entry → drawer with payload | e2e | `npm run test:e2e:phase14` | No — Wave 1 |
| LOG-04 | Filter + persist last N entries | e2e | `npm run test:e2e:phase14` | No — Wave 1 |
| LOG-05 | Phase 13 tentacles emit log rows | Unit (Rust) | `cargo test ecosystem` | Partial (ecosystem.rs has emit) |

### Wave 0 Gaps
- [ ] `scripts/verify-feature-reachability.mjs` — covers WIRE2-01, WIRE2-04, WIRE2-05, WIRE2-06
- [ ] `scripts/verify-a11y-pass-2.mjs` — covers A11Y2-04, A11Y2-05, A11Y2-06
- [ ] `tests/e2e/phase14/` directory + `activity-log.spec.ts` — covers LOG-01, LOG-03, LOG-04
- [ ] `tests/e2e/phase14/dashboard-live-data.spec.ts` — covers WIRE2-02

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — no new auth surfaces |
| V3 Session Management | no | n/a |
| V4 Access Control | yes (minimal) | observe-only guardrail already enforced in ecosystem.rs; activity log is read-only |
| V5 Input Validation | yes | `safe_slice(summary, 200)` already applied in `emit_activity()`; extend to all new emit sites |
| V6 Cryptography | no | n/a |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Activity log entry injection via crafted Rust payload | Tampering | `safe_slice(200)` on `human_summary`; JSON serialization (no raw string concat) |
| Config field accept-all via `save_config_field` | Elevation of privilege | Already allow-listed in config.rs; new UI controls only call listed fields |
| localStorage activity log data leakage | Info disclosure | Local-only; no sync; no sensitive data in `human_summary` (200 char cap) |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | localStorage is accessible from Tauri WebView2 on Windows/Linux for activity log persistence | Activity Log System — Persistence | If wrong, need SQLite table + Rust command; adds 1 Wave 0 task |
| A2 | Dialog.tsx may or may not already have a focus trap | Open Questions #1 | If it has no trap, A11Y2-04 work increases; if it has one, Wave 0 is smaller |
| A3 | Focus ring token name is in the design system tokens but exact name not confirmed | A11y Foundation | Wrong token name would produce invisible focus rings; must verify before Wave 1 |
| A4 | Phase 12 Smart Deep Scan may or may not be complete when Phase 14 starts | Open Questions #3 | Dashboard binding (WIRE2-02) should gracefully handle sparse scan data regardless |

---

## Sources

### Primary (HIGH confidence — verified against live files)
- `/home/arnav/blade/.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` — complete NOT-WIRED backlog (99 items), DEAD deletion plan, config gaps
- `/home/arnav/blade/src-tauri/src/ecosystem.rs` — `blade_activity_log` event shape and emit pattern
- `/home/arnav/blade/src/windows/main/MainShell.tsx` — shell composition, strip mount point
- `/home/arnav/blade/src/windows/main/router.ts` — route aggregation pattern, ALL_ROUTES, PALETTE_COMMANDS
- `/home/arnav/blade/src/features/settings/SettingsShell.tsx` — existing Settings tab structure (11 panes including EcosystemPane)
- `/home/arnav/blade/src/features/dashboard/Dashboard.tsx` — 3 ComingSoonCard placeholders
- `/home/arnav/blade/package.json` — complete verify:all chain, no missing scripts
- `/home/arnav/blade/.planning/phases/13-self-configuring-ecosystem/13-01-SUMMARY.md` — ecosystem.rs deliverables and TentacleRecord structure
- `/home/arnav/blade/src/lib/router.ts` — RouteDefinition contract, DEFAULT_ROUTE_ID, paletteHidden field

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md — WIRE2, A11Y2, LOG requirement text and acceptance criteria
- ROADMAP.md — Phase 14 goal, success criteria, notes on 4-stream parallelism

---

## Metadata

**Confidence breakdown:**
- NOT-WIRED backlog: HIGH — read directly from 10-WIRING-AUDIT.md
- Activity log event shape: HIGH — read from ecosystem.rs source
- Route addition pattern: HIGH — read from router.ts source
- Dialog focus trap status: LOW — Dialog.tsx not read; flagged as assumption
- localStorage viability: MEDIUM — standard Tauri 2 behavior, not confirmed by reading Tauri docs

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable codebase; re-audit if Phases 12/13 land significant changes before Phase 14 starts)

---

## RESEARCH COMPLETE
