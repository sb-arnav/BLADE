# Phase 10: Inventory & Wiring Audit - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Read-only audit that produces `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` plus a machine-parseable `10-WIRING-AUDIT.json` sidecar. Classifies every Rust module under `src-tauri/src/`, every route in `src/lib/router.ts`, every command-palette entry across the 5 window entrypoints, and every `BladeConfig` / sibling-config field as one of `ACTIVE` / `WIRED-NOT-USED` / `NOT-WIRED` / `DEAD`.

**No code changes.** The audit is planning input. Output feeds:
- Phase 14 backlog (NOT-WIRED → UI surfaces to add; WIRED-NOT-USED → trigger fixes or removals)
- Phase 14 DENSITY pass (data-source confirmation for dashboard cards)
- Phase 15 reachability contract (`verify:feature-reachability` script ingests the JSON sidecar)

Mirrors the Phase 0 precedent (`00-CONTEXT.md` §D-17..D-19): backend + router + config are the authoritative sources; audit cross-references tester-pass evidence as ground-truth seed for known symptoms.

</domain>

<decisions>
## Implementation Decisions

### D-46: Output Shape = Single Monolithic `10-WIRING-AUDIT.md` + JSON Sidecar

One reviewable Markdown file with five clearly-headed sections, plus a `10-WIRING-AUDIT.json` sidecar for programmatic consumption:

**Sections of `10-WIRING-AUDIT.md`:**
1. **Module Catalog** — every `.rs` file under `src-tauri/src/` with purpose, trigger, UI surface reference, classification
2. **Route + Command-Palette Catalog** — every `ROUTE_MAP` entry in `src/lib/router.ts` + every palette entry across the 5 window shells, with data shape, data source, flow status
3. **Config Surface Catalog** — every field in `BladeConfig` + sibling configs + per-module `AtomicBool`/static toggles + env vars + Cargo feature flags, with UI surface, control type, discoverability path
4. **NOT-WIRED Backlog** — structured list with `file:line` per backend entry point; Phase 14 consumes this verbatim
5. **DEAD Deletion Plan** — per-item caller + import list + safe-to-delete flag; Phase 14 removal does not break the build

**Appendices:**
- **Appendix A: Tester-Pass Evidence Map** — cross-references tester symptoms (silent chat fail, 1-repo scan, Groq+llama routing miss, dashboard-empty, cluttered UI) to the underlying module/route/config gap that explains them. Grounds the audit in falsifiable reality.
- **Appendix B: Deferred-to-v1.2 Rationale** — any NOT-WIRED row the audit judges out-of-scope for v1.1 (e.g. acting-tentacle capability) is flagged here with a one-line rationale so Phase 14 doesn't re-argue scope.

**`10-WIRING-AUDIT.json` sidecar schema:**
```json
{
  "modules": [{ "file": "src-tauri/src/foo.rs", "classification": "NOT-WIRED", "purpose": "...", "trigger": "...", "ui_surface": null, "backend_entry_points": ["src-tauri/src/foo.rs:42"] }],
  "routes": [{ "id": "dashboard", "file": "src/features/dashboard/...", "classification": "ACTIVE", "data_shape": "...", "data_source": "...", "flow_status": "data pipes" }],
  "config": [{ "field": "BladeConfig.vision_provider", "file": "src-tauri/src/config.rs:123", "classification": "NOT-WIRED", "ui_surface": null, "control_type": "string" }],
  "not_wired_backlog": [...],
  "dead_deletion_plan": [...]
}
```
Phase 14 and Phase 15 verification scripts parse the JSON; humans read the Markdown. One source of truth, two presentations.

### D-47: Per-Row Depth = Minimum Useful (No Bloat)

Every row carries exactly what Phase 14 needs — no git-blame-last-touched, no Cargo dependency graph, no noise:

- **Every row:** `file` (full relative path), `classification`, `purpose` (one line), `trigger` (what invokes it), `ui_surface` (full relative path or `null`)
- **NOT-WIRED rows add:** `backend_entry_points` (list of `file:line` references Phase 14 can go straight to)
- **DEAD rows add:** `callers` (list of files that import the symbol), `imports` (what the file imports), `safe_to_delete` (bool — false if import cycle detected), and a one-line deletion-plan note
- **ACTIVE rows add:** `reachable_paths` (one representative user path from UI → backend, e.g. "`route:dashboard → invoke('get_dashboard_snapshot') → commands.rs:412`")

Git-blame and cargo-tree are available on-demand; bloating every row is cost for no Phase 14 benefit.

### D-48: Classification Heuristic = Static Analysis + Tester-Pass Ground Truth

Primary mechanism is static analysis (no runtime trace required):

**ACTIVE** — backend entry point is called from `src/` (user-reachable): every `#[tauri::command]` function whose name appears in a `invokeTyped(...)` / `invoke(...)` call in `src/`, reachable via a route or command-palette entry. Every event emitted by the backend has ≥1 `listen(...)` or `useTauriEvent(...)` subscriber in `src/`.

**WIRED-NOT-USED** — UI surface exists but backend never triggered: a route renders, a button exists, but the `invoke` it should fire is either missing or unreachable (e.g. button inside a never-opened overlay, palette entry hidden behind a disabled flag).

**NOT-WIRED** — backend exists, no UI surface: `#[tauri::command]` name does NOT appear in any `invoke(...)` call in `src/`; event name has no `listen(...)` subscriber. Internal-Rust-to-Rust modules (e.g. `body_registry.rs` called by `lib.rs` setup only) are tagged `ACTIVE` with `trigger = "internal — called by <caller>"` and do NOT surface in NOT-WIRED unless they expose a `#[tauri::command]` that nothing consumes.

**DEAD** — no current or planned usage: no `invoke` callers, no `listen` subscribers, no internal Rust callers, AND not referenced in roadmap/requirements for v1.1. Borderline cases (e.g. "might be used by v1.2 JARVIS") stay classified as `NOT-WIRED` with a `"deferred to v1.2"` note in Appendix B — never `DEAD`.

**Seed with tester-pass evidence:** before static classification runs, the audit pre-loads the 7 known symptoms from `notes/v1-1-milestone-shape.md` §"Why this framing" (silent chat, 1-repo scan, dashboard-empty, background terminal noise, cluttered UI, unreachable options, Groq+llama routing miss). Each symptom pre-seeds at least one expected NOT-WIRED or WIRED-NOT-USED row; if static analysis later contradicts the seed, the audit documents the conflict rather than silently picking one.

### D-49: Coverage Scope

**Modules** — every `.rs` file under `src-tauri/src/` (156 files per `ls` count). Includes nested `agents/` module. Excludes `build.rs` at crate root (build tooling, not runtime).

**Routes** — union of:
- `ROUTE_MAP` entries in `src/lib/router.ts` (authoritative route registry, FOUND-07)
- Command-palette entries registered across `src/windows/{main,quickask,hud,ghost,overlay}/main.tsx` (the 5 window shells — there is no single `App.tsx`; the CLAUDE.md reference is outdated)
- Overlay surfaces that have no route but render as windows (quickask, hud, ghost, overlay shells themselves)
- Onboarding sub-views (tracked as children of an onboarding root route; 3 steps per prototype precedent)

Dialogs and modals triggered from a parent route are listed under that parent with a `triggered_from` note, not enumerated as standalone routes.

**Config surfaces:**
- `BladeConfig` struct + its 6-place pattern siblings (`DiskConfig`, `BladeConfig::default`, `load_config`, `save_config`)
- Per-module `static AtomicBool` / `static` feature toggles discovered by grepping `static [A-Z_]+: AtomicBool` across `src-tauri/src/` — these ARE config, just undocumented
- Environment variables read by any Rust module (grep `std::env::var(`)
- Cargo feature flags declared in `src-tauri/Cargo.toml` (e.g. `local-whisper`)
- Keyring-stored secrets (per `config.rs` keyring integration) — listed with storage location, never value

### D-50: Execution Mode = 3 Parallel Subagents + Claude Inline Synthesis (mirrors D-18)

Three parallel subagents handle mechanical extraction; Claude synthesizes into `10-WIRING-AUDIT.md` + `10-WIRING-AUDIT.json`:

- **Subagent A — Rust Module Classifier.** Reads every `.rs` under `src-tauri/src/`. For each: purpose (one-line from file-level doc comment or top-of-file context), trigger (what invokes it — a command, a background loop, internal caller), and classification per D-48 heuristic. Outputs a flat table.
- **Subagent B — Route + Command-Palette Mapper.** Reads `src/lib/router.ts` ROUTE_MAP, then reads each of the 5 `src/windows/*/main.tsx` for palette-entry registrations and overlay-window definitions. For each: data shape (what props/state it consumes), data source (which Tauri command or event feeds it), flow status (`data pipes` / `placeholder` / `dead`).
- **Subagent C — Config Surface Catalog.** Reads `src-tauri/src/config.rs` + every module with a `static AtomicBool` / `static ... =` toggle + `Cargo.toml` feature flags + env-var call sites. For each field: current default, storage location (file/keyring/memory), UI surface that exposes it, control type, discoverability path.

**Claude inline synthesis:**
- Cross-reference the three outputs to resolve conflicts (e.g. Subagent A flags a module NOT-WIRED but Subagent B finds a palette entry that invokes it → reclassify as ACTIVE)
- Build the NOT-WIRED Backlog from the union of all 3 subagent outputs
- Build the DEAD Deletion Plan with caller + import checks
- Write Appendix A (Tester-Pass Evidence Map)
- Generate `10-WIRING-AUDIT.json` sidecar from the synthesized tables

**No mid-phase user checkpoints.** The phase ships one artifact; user review happens post-write. If a subagent returns a malformed table, Claude retries that subagent, not the whole phase.

### Claude's Discretion
- Exact subagent prompt wording and section formatting within `10-WIRING-AUDIT.md` (tables for catalogs, prose for cross-cuts, code blocks for file:line references).
- Handling of `agents/` subdirectory — flat list vs nested section; recommend nested for scan-ability.
- Whether the DEAD Deletion Plan goes in a separate commit after initial audit lands (recommend: same commit, keeps the artifact atomic).
- JSON schema evolution — if Phase 14 planning surfaces a missing field, patch the sidecar schema without re-auditing.

### Folded Todos
None — no pending todos matched Phase 10's scope at init time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level specs (already read during discussion)
- `.planning/PROJECT.md` — v1.1 anchor, M-01..M-07 decisions, constraints
- `.planning/REQUIREMENTS.md` §"Inventory & Wiring Audit (AUDIT)" — AUDIT-01..05
- `.planning/ROADMAP.md` §"Phase 10: Inventory & Wiring Audit" — goal, success criteria, depends-on
- `.planning/STATE.md` — current position, accumulated context, v1.0 + v1.1 locked decisions
- `.planning/notes/v1-1-milestone-shape.md` §"Phase 0 — Inventory & Wiring Audit" — **authoritative locked shape** (2026-04-20); also §"Why this framing" for the 7 tester-pass symptoms seeded into D-48

### Precedent (Phase 0 pattern to mirror)
- `.planning/phases/00-pre-rebuild-audit/00-CONTEXT.md` §D-17..D-19 — source-of-truth framing, hybrid-execution pattern, monolithic-output decision

### Backend authority (audit input — Subagent A + C)
- `src-tauri/src/lib.rs` — `generate_handler![]` macro enumerates every `#[tauri::command]` registered (the command inventory)
- `src-tauri/src/body_registry.rs` — enumerates subsystems (bodies / tentacles / hormones / heads); authoritative for which modules are live "organs" vs helpers
- `src-tauri/src/config.rs` — `BladeConfig` + sibling configs + keyring integration (Subagent C starts here)
- `src-tauri/src/commands.rs` — main chat pipeline (reference implementation for "how a fully-wired command looks")
- `src-tauri/Cargo.toml` — feature flag declarations (e.g. `local-whisper`)
- Scale reference: 156 `.rs` files under `src-tauri/src/`, 731 `#[tauri::command]` hits across those files, 283 emit call sites

### Frontend authority (audit input — Subagent B)
- `src/lib/router.ts` — ROUTE_MAP definition + RouteDefinition contract (FOUND-07, D-39); authoritative route registry
- `src/windows/main/main.tsx` — main window shell, primary command-palette host
- `src/windows/quickask/main.tsx` — QuickAsk shell
- `src/windows/hud/main.tsx` — HUD strip shell
- `src/windows/ghost/main.tsx` — Ghost Mode shell (content-protected)
- `src/windows/overlay/main.tsx` — generic overlay shell
- `src/lib/tauri/` — typed Tauri wrappers; every `invokeTyped<T>(...)` call in `src/` is the static-analysis seed for ACTIVE classification
- `src/lib/events/` — `useTauriEvent` hook + `BLADE_EVENTS` registry; every `listen(...)` call is the emitter-ACTIVE seed

### Architecture context (already-synthesized)
- `docs/architecture/2026-04-16-blade-body-architecture-design.md` — body system architecture
- `docs/architecture/2026-04-17-blade-frontend-architecture.md` — frontend rebuild architecture
- `docs/architecture/body-mapping.md` — Rust module → body subsystem mapping
- `docs/architecture/connection-map.md` — subsystem connectivity

### Codebase maps (audit cross-reference)
- `.planning/codebase/STRUCTURE.md` — directory layout
- `.planning/codebase/ARCHITECTURE.md` — current architecture snapshot
- `.planning/codebase/CONVENTIONS.md` — coding conventions (6-place config pattern etc.)
- `.planning/codebase/INTEGRATIONS.md` — third-party integrations
- `.planning/codebase/CONCERNS.md` — known concerns

### Tester-pass evidence (ground-truth seed per D-48)
- Commit `4ab464c` — `fix(tester-pass-1): silence log spam, stop self_upgrade loop, surface chat errors` (already on master; assume applied)
- Commit `580175f` — `docs(explore): lock v1.1 milestone shape`
- Commit `90d72aa` — `docs(explore): capture v2+ tentacles vision + browser-harness research question`

### Explicitly NOT to read
- `src.bak/` — dead pre-rebuild frontend; per Phase 0 D-17 do not mine for patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src-tauri/src/lib.rs` `generate_handler![]` — the command inventory; Subagent A iterates over this to anchor "what backend COULD be invoked"
- `src-tauri/src/body_registry.rs` — the subsystem graph; helps Subagent A tag Rust-to-Rust internal callers vs. user-facing commands
- `src/lib/router.ts` `RouteDefinition` shape — authoritative schema Subagent B uses to dedupe route coverage
- `.planning/codebase/CONVENTIONS.md` — already documents the 6-place config pattern; Subagent C uses this to find sibling configs

### Established Patterns
- **Single-monolithic-doc with tables + appendices** — Phase 0 `RECOVERY_LOG.md` precedent (D-19). Reviewable in one pass.
- **Hybrid subagent + inline synthesis** — Phase 0 D-18; proven executor for audit-class phases.
- **Full relative paths in canonical_refs** — every prior CONTEXT.md; Phase 14 + 15 downstream agents need to `cat path/to/file` directly.
- **Tester-pass as ground truth** — the 7 symptoms in `v1-1-milestone-shape.md` §"Why this framing" are the canonical gap-list seed; audit validates against them, not the reverse.

### Integration Points
- Output consumed by: Phase 14 (NOT-WIRED backlog → UI wiring backlog; DEAD deletion plan → removal backlog), Phase 15 (`verify:feature-reachability` script parses `10-WIRING-AUDIT.json`)
- Output cross-referenced by: Phase 11 (PROV-07/08 capability-gap empty states need a NOT-WIRED tag for "vision-required surface without vision provider") and Phase 13 (ECOSYS-07 rationale rows need to know which Settings control exposes each tentacle)
- Audit directory structure: `.planning/phases/10-inventory-wiring-audit/` (created this session)

### Notable Scale Numbers (for subagent sizing)
- 156 `.rs` files under `src-tauri/src/` → Subagent A table has ~156 rows
- 731 `#[tauri::command]` hits → static-analysis ACTIVE-seed set for D-48
- 283 emit call sites → event-emitter coverage for ACTIVE classification
- 50+ routes + 5 window shells + command palette across them → Subagent B output size
- ~40 `BladeConfig` fields + sibling structs + `AtomicBool` statics → Subagent C table size
- `npm run verify:all` 18/18 green baseline → Phase 15 adds `verify:feature-reachability` + `verify:a11y-pass-2`

</code_context>

<specifics>
## Specific Ideas

**From Arnav (direction delegated to Claude this session):**
- *"idk whatever you say"* — user delegated all gray-area decisions to Claude for Phase 10. Pragmatic defaults grounded in Phase 0 precedent + AUDIT-01..05 requirements were applied; every decision above carries Phase 0 pattern lineage (D-17/D-18/D-19 → D-46/D-47/D-48/D-49/D-50) so it is re-derivable.

**Anchors from v1.1 shape doc (locked 2026-04-20):**
- *"The V1 substrate is shipped. Tester pass surfaced that most of it is either unwired, unreachable, or uses bad defaults that make the surface feel empty."* — the audit's job is to translate "feels empty" into a structured gap list.
- *"Tag each item one of: ACTIVE / WIRED-NOT-USED / NOT-WIRED / DEAD."* — these four tags are the contract; do not invent new ones.
- *"Falsifiable success: WIRING-AUDIT.md exists, every Rust module under `src-tauri/src/` is classified, every route is classified, gap list becomes the Phase 14 backlog."* — AUDIT-01..05 are the falsifiable criteria; the JSON sidecar is additive, not replacement.

</specifics>

<deferred>
## Deferred Ideas

None raised during this session — all decisions sat inside Phase 10's boundary. Items that came up but are already covered by other phases:
- **Capability-gap empty states** — covered by Phase 11 PROV-07/08, not Phase 10. Phase 10 only tags the surfaces; Phase 11 implements the prompts.
- **Activity log cross-module coverage** — covered by Phase 14 LOG-02. Phase 10 catalogs emit sites; Phase 14 instruments them.
- **Acting-tentacle capability** — v1.2+ per M-03; Phase 10 flags any acting-class command as NOT-WIRED with `"deferred to v1.2 — acting capability"` rationale in Appendix B (never DEAD).

### Reviewed Todos (not folded)
No pending todos matched Phase 10 scope.

</deferred>

---

*Phase: 10-inventory-wiring-audit*
*Context gathered: 2026-04-20*
