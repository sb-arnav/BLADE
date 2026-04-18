# Phase 1: Foundation — Pattern Map

**Mapped:** 2026-04-18
**Files analyzed:** 63 new files (5 HTML + 5 bootstrap + 4 tokens + 9 primitives + 4 wrappers + 2 events + 4 router/context/pref + 3 dev surfaces + 11 feature index.ts stubs + 1 migration seed + 6 CI scripts + 1 ESLint rule + 1 Playwright test + 7 misc)
**Analogs found:** 58 strong / 63 (5 have no analog — flagged below)

---

## Source-of-Truth Inventory

| Analog source | Kind | Why it anchors Phase 1 |
|---|---|---|
| `docs/design/shared.css` | Design tokens + glass primitive CSS | Sole surviving visual ground truth; tokens.css/glass.css/motion.css/layout.css port from here (per D-22, CONTEXT §D-22). Provides glass tier vars, radii, spacing, accents, orb accents. |
| `.planning/RECOVERY_LOG.md` §B.1–B.12 | Token conflict resolutions | Resolves shared.css vs proto.css radii conflict (Phase 1 uses proto.css values per §B.12). Final typography, accents, motion constants. |
| `src-tauri/src/commands.rs:558` (`send_message_stream`) | Rust wrapper source | Seeds `src/lib/tauri/chat.ts::sendMessageStream` (D-36). Arg-casing (snake_case) → D-38 discipline. |
| `src-tauri/src/commands.rs:71,1899,2312,2325` | Rust wrapper sources | Seeds `src/lib/tauri/chat.ts::cancelChat`, `config.ts::{getConfig, getOnboardingStatus, completeOnboarding}`. |
| `src-tauri/src/config.rs:514,605,636,645,713,719,728` | Rust wrapper sources | Seeds extended `config.ts` wrappers (save, keys, routing) — Phase 2/3 add these; Phase 1 scopes only the 4 in D-36. |
| `.planning/RECOVERY_LOG.md` §4 Event Catalog | Event registry source | Seeds `src/lib/events/index.ts::BLADE_EVENTS` + payload interfaces (D-38-evt, D-38-payload). 29 LIVE + 5 WIRE-REQUIRED forward declarations. |
| `.planning/RECOVERY_LOG.md` §5 emit_all classification | WIRE-08 refactor sites | Drives `scripts/verify-emit-policy.mjs` allowlist (D-45, D-45-regress). 142 single-window refactors + 42 cross-window allowlist entries. |
| `.planning/research/ARCHITECTURE.md` §4 (lines 426–522) | Wrapper + event hook recipe | Canonical `invokeTyped` + `TauriError` + `useTauriEvent` patterns (D-36, D-37, D-38-hook). |
| `.planning/research/ARCHITECTURE.md` §2 (lines 223–336) | Route registry recipe | Canonical `RouteDefinition` + `feature.index.ts` export + aggregator pattern (D-39, D-40). |
| `.planning/research/STACK.md` §Area 1, §Area 7 | Glass CSS + Tailwind v4 `@theme` recipe | Two-track glass (D-06), tier system, `@theme` bridge (D-23). |
| `vite.config.ts` (existing) | Multi-entry Vite config | Already declares all 5 entries; verify via `scripts/verify-entries.mjs` (D-31). |
| `src-tauri/src/homeostasis.rs:28` (`HormoneState`) | Event payload type source | Seeds `src/lib/events/index.ts::HormoneUpdatePayload` (WIRE-02 forward declaration, consumed by Phase 3). |
| `src-tauri/src/ghost_mode.rs:115` (`GhostMeetingState`) | Event payload type source | Seeds `src/lib/events/index.ts::GhostMeetingStatePayload`. |
| `src-tauri/src/providers/mod.rs:114` (`ChatMessage`) | DTO source | Seeds `src/types/messages.ts::ChatMessage` for wrapper signatures. |

**Deliberately NOT read:** `src.bak/` (dead per D-17) — no components there are analogs. The seed script for the migration ledger is the only consumer and runs once.

---

## File Classification

Grouped by build step (per CONTEXT §D-26 9-step plan).

### Step 1 — HTML entries + Window bootstraps (10 files)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `/index.html` | html-entry | window-boot | `vite.config.ts:15–20` (input declared) + D-43 minimal template spec | exact (spec-driven) |
| `/quickask.html` | html-entry | window-boot | same | exact |
| `/overlay.html` | html-entry | window-boot | same + `src-tauri/src/lib.rs:349` (Rust creation site) | exact |
| `/hud.html` | html-entry | window-boot | same + `src-tauri/src/overlay_manager.rs:76` | exact |
| `/ghost_overlay.html` | html-entry | window-boot | same + `src-tauri/src/ghost_mode.rs:472` | exact |
| `src/windows/main/main.tsx` | bootstrap | window-boot | ARCHITECTURE.md §1 lines 44–48 (directory contract) + D-29 perf mark | exact (spec-driven) |
| `src/windows/quickask/main.tsx` | bootstrap | window-boot | same | exact |
| `src/windows/overlay/main.tsx` | bootstrap | window-boot | same | exact |
| `src/windows/hud/main.tsx` | bootstrap | window-boot | same | exact |
| `src/windows/ghost/main.tsx` | bootstrap | window-boot | same | exact |

### Step 2 — Design tokens (4 files + 1 index)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/styles/tokens.css` | design-token | static-css | `docs/design/shared.css:11–70` (CSS custom properties block) + RECOVERY_LOG §B.6–B.12 resolutions | exact |
| `src/styles/glass.css` | design-token | static-css | `docs/design/shared.css:135–171` (.glass + tiers) + RECOVERY_LOG §B.3 blur-cap table | exact |
| `src/styles/motion.css` | design-token | static-css | STACK.md §Area 6 lines 552–568 (easings + durations) + RECOVERY_LOG §B.5 | exact |
| `src/styles/layout.css` | design-token | static-css | `docs/design/shared.css:207–214` (.nav-rail dimensions) → token-ified | role-match |
| `src/styles/index.css` | design-token | static-css | Simple `@import` barrel; no analog needed | no-analog |

### Step 3 — Primitives (9 files + 1 barrel)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/design-system/primitives/Button.tsx` | primitive-component | prop-only | `docs/design/shared.css:256–278` (.btn + variants) | exact |
| `src/design-system/primitives/Card.tsx` | primitive-component | prop-only | `docs/design/shared.css:135–148` (.glass composition) + `src/design-system/primitives/GlassPanel.tsx` (sibling) | role-match |
| `src/design-system/primitives/GlassPanel.tsx` | primitive-component | prop-only | `docs/design/shared.css:135–171` (.glass + .glass.flat/.heavy/.pill/.sm) | exact |
| `src/design-system/primitives/Input.tsx` | primitive-component | prop-only + local-state | `docs/design/shared.css:283–295` (.input) | exact |
| `src/design-system/primitives/Pill.tsx` | primitive-component | prop-only | `docs/design/shared.css:300–315` (.chip + .chip.dot variants) | exact |
| `src/design-system/primitives/Badge.tsx` | primitive-component | prop-only | `docs/design/shared.css:300–315` (.chip subset) | role-match |
| `src/design-system/primitives/GlassSpinner.tsx` | primitive-component | prop-only | `docs/design/shared.css:340–344` (.bar / spin keyframe) + RECOVERY_LOG §B.5 spin 0.9s linear | role-match |
| `src/design-system/primitives/Dialog.tsx` | primitive-component | prop-only + imperative | STACK.md §Area 4 lines 450–460 (`<dialog>` spec, native focus trap) | exact (spec-driven) |
| `src/design-system/primitives/ComingSoonSkeleton.tsx` | primitive-component | prop-only | D-44 spec; uses `GlassPanel` (sibling) | exact (spec-driven) |
| `src/design-system/primitives/index.ts` | primitive-component | barrel | ARCHITECTURE.md §1 line 141 (explicit barrel pattern) | exact |

### Step 4 — Typed Tauri wrappers (4 files + 1 barrel)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/lib/tauri/_base.ts` | wrapper | request-response | ARCHITECTURE.md §4 lines 426–449 (`invokeTyped` + `TauriError` recipe) | exact |
| `src/lib/tauri/config.ts` | wrapper | request-response | ARCHITECTURE.md §4 lines 451–478 (chat.ts analog) + Rust cites below | exact |
| `src/lib/tauri/chat.ts` | wrapper | request-response + streaming-events | ARCHITECTURE.md §4 lines 451–478 (verbatim recipe) + `src-tauri/src/commands.rs:558,71` | exact |
| `src/lib/tauri/events.ts` | event | event-driven | ARCHITECTURE.md §4 lines 488–522 (`BLADE_EVENTS` + `useTauriEvent`) + RECOVERY_LOG §4 | exact |
| `src/lib/tauri/index.ts` | wrapper | barrel | Simple re-export barrel | no-analog |

### Step 5 — Event registry + hook (2 files)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/lib/events/index.ts` | event | event-driven | ARCHITECTURE.md §7 lines 629–668 (`useTauriEvent` recipe) + RECOVERY_LOG §4 (event catalog) + D-38-evt/payload/hook | exact |
| `src/lib/events/payloads.ts` | event | event-driven | RECOVERY_LOG §4 payload column (TS interfaces keyed by event name) + Rust struct sources | exact |

*(Alternative: single `src/lib/events/index.ts` with payloads inline — planner's discretion per D-38-payload. Split recommended when file exceeds ~250 lines.)*

### Step 6 — Route registry (2 files)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/lib/router.ts` | route | registry | ARCHITECTURE.md §2 lines 254–272 (`RouteDefinition` contract) + D-39 expanded shape | exact |
| `src/windows/main/router.ts` | route | registry-aggregator | ARCHITECTURE.md §2 lines 275–305 (explicit imports + concat) + D-40 | exact |

### Step 7 — Feature index stubs (11 files, one per D-39 section)

Each exports `routes: RouteDefinition[]` mounting `ComingSoonSkeleton phase={N}` for every route it owns. 59 total route entries distributed.

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/features/dashboard/index.ts` | route | registry-entry | ARCHITECTURE.md §2 lines 233–251 (feature index pattern) | exact |
| `src/features/chat/index.ts` | route | registry-entry | same | exact |
| `src/features/settings/index.ts` | route | registry-entry | same | exact |
| `src/features/agents/index.ts` | route | registry-entry | same | exact |
| `src/features/knowledge/index.ts` | route | registry-entry | same | exact |
| `src/features/life-os/index.ts` | route | registry-entry | same | exact |
| `src/features/identity/index.ts` | route | registry-entry | same | exact |
| `src/features/dev-tools/index.ts` | route | registry-entry | same | exact |
| `src/features/admin/index.ts` | route | registry-entry | same | exact |
| `src/features/body/index.ts` | route | registry-entry | same | exact |
| `src/features/hive/index.ts` | route | registry-entry | same | exact |
| `src/features/onboarding/index.ts` | route | registry-entry | same | exact |
| `src/features/dev/index.ts` | route | registry-entry (palette-hidden, DEV only) | same + D-21, D-30 | exact |

### Step 7b — Dev surfaces (3 files, `paletteHidden: true`, `import.meta.env.DEV` gated)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/features/dev/Primitives.tsx` | primitive-component | showcase | D-21 spec: iterate every primitive × variant × size × state on real glass wallpaper | no-analog (spec-driven) |
| `src/features/dev/WrapperSmoke.tsx` | test (dev UI) | request-response iteration | D-30 spec: table with `function · Rust cite · args · result · pass/fail` | no-analog (spec-driven) |
| `src/features/dev/Diagnostics.tsx` | primitive-component | observability | Minimal — shows `window.__BLADE_LISTENERS_COUNT__`, perf marks, git hash. Sibling for P-06 leak test. | role-match |

### Step 8 — Prefs + Config (3 files)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/hooks/usePrefs.ts` | hook | transform + local-storage | D-42 spec (single `blade_prefs_v1` blob, dotted namespaces, 250ms debounced writes) | no-analog (spec-driven; PITFALLS.md:P-13 drives discipline) |
| `src/lib/context/ConfigContext.tsx` | provider | request-response + event-driven | ARCHITECTURE.md §5 lines 553–566 (ConfigProvider recipe) | exact |
| `src/lib/context/index.ts` | provider | barrel | Simple re-export | no-analog |

### Step 9 — Migration ledger seed (2 files)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `.planning/migration-ledger.md` | doc | static | D-27, D-28 (seeded Day 1 with all 59 rows) | no-analog (seeded output) |
| `scripts/seed-migration-ledger.mjs` | verify-script | file-io + parsing | Walks `src.bak/components/` + reads `App.tsx` route union + `00-PROTO-FLOW.md` + ARCHITECTURE.md (D-28) | no-analog (one-shot) |

### Verify scripts (6 files, CI-wired)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `scripts/verify-entries.mjs` | verify-script | file-io | D-31: read vite.config input keys, `fs.existsSync` each, exit non-zero on miss | no-analog (spec-driven) |
| `scripts/verify-no-raw-tauri.sh` | verify-script | grep-based | D-34: grep-ban `invoke` / `listen` imports outside allowed paths | no-analog (spec-driven) |
| `scripts/verify-migration-ledger.mjs` | verify-script | file-io + grep | D-27: parse ledger, grep `src/` for removed route IDs, fail on orphan | no-analog (spec-driven) |
| `scripts/verify-emit-policy.mjs` | verify-script | grep-based | D-45-regress: grep `emit_all`/`app.emit(` in `src-tauri/src/`, cross-ref allowlist embedded in 00-EMIT-AUDIT.md | no-analog (spec-driven) |
| `scripts/audit-contrast.mjs` | verify-script | css-parse + math | D-33 (P-08): parse tokens.css+glass.css, compute WCAG 2.1 ratios, fail < 4.5:1 | no-analog (spec-driven) |
| `scripts/verify-html-entries.mjs` | verify-script | file-io | WIN-09: assert all 5 HTML present in `dist/` after build | role-match (sibling of verify-entries) |

### ESLint + tests (2 files)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `eslint-rules/no-raw-tauri.js` | eslint-rule | AST | D-34 spec; shape of flat ESLint rule | no-analog (spec-driven) |
| `tests/e2e/listener-leak.spec.ts` | test | playwright-e2e | D-32 spec: boot headlessly, churn routes ×5, assert `window.__BLADE_LISTENERS_COUNT__` stable | no-analog (new harness) |

### Supporting types (1+ file)

| New file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/types/messages.ts` | model | type-def | `src-tauri/src/providers/mod.rs:114` (`ChatMessage` struct) | exact |

### WIRE-08 Rust refactor sites (142 single-window refactors in `src-tauri/src/`)

Not new files — **modifications to existing Rust files**. Classified in RECOVERY_LOG §5 (complete table). Planner must split this into a batch refactor plan.

| Rust file | Refactor count | Example site | Replacement |
|---|---|---|---|
| `src-tauri/src/commands.rs` | 26 single-window | `commands.rs:742` `chat_token` | `emit_to("main", "chat_token", payload)` |
| `src-tauri/src/voice_global.rs` | 12 single-window | `voice_global.rs:114` `voice_global_started` | `emit_to("quickask", "voice_global_started", ())` |
| `src-tauri/src/providers/anthropic.rs` | 6 single-window | `anthropic.rs:236` `chat_token` | `emit_to("main", "chat_token", payload)` |
| `src-tauri/src/providers/openai.rs` | 2 single-window | `openai.rs:279` | `emit_to("main", ...)` |
| `src-tauri/src/providers/gemini.rs` | 2 single-window | `gemini.rs:224` | `emit_to("main", ...)` |
| `src-tauri/src/providers/groq.rs` | 2 single-window | `groq.rs:317` | `emit_to("main", ...)` |
| `src-tauri/src/providers/ollama.rs` | 2 single-window | `ollama.rs:129` | `emit_to("main", ...)` |
| `src-tauri/src/overlay_manager.rs` | 2 single-window | `overlay_manager.rs:252` `hud_data_updated` | `emit_to("hud", "hud_data_updated", payload)` |
| `src-tauri/src/ghost_mode.rs` | 4 single-window | `ghost_mode.rs:522` | `emit_to("ghost_overlay", ...)` |
| `src-tauri/src/swarm_commands.rs` | 9 single-window | `swarm_commands.rs:452` | `emit_to("main", ...)` |
| `src-tauri/src/agents/executor.rs` | 5 single-window | `executor.rs:240` `blade_agent_event` | `emit_to("main", ...)` |
| `src-tauri/src/agent_commands.rs` | 11 single-window | `agent_commands.rs:426` | `emit_to("main", ...)` |
| `src-tauri/src/background_agent.rs` | 7 single-window | `background_agent.rs:205` | `emit_to("main", ...)` |
| `src-tauri/src/deep_scan.rs` | 1 single-window | `deep_scan.rs:1325` | `emit_to("main", ...)` |
| `src-tauri/src/tentacles/` (terminal, filesystem, calendar, log_monitor) | 20 single-window | `terminal_watch.rs:620` | `emit_to("main", ...)` |
| `src-tauri/src/autoskills.rs` | 5 single-window | `autoskills.rs:176` | `emit_to("main", ...)` |
| `src-tauri/src/auto_fix.rs` | 11 single-window | `auto_fix.rs:825` | `emit_to("main", ...)` |
| All other single-window | ~22 remaining | see RECOVERY_LOG §5.2 rows | per table |
| **Ambiguous (63)** | per-row judgment | RECOVERY_LOG §5.3 synthesis notes | convert to `emit_to("main", ...)` per notes unless flagged |
| **Cross-window (42, keep as-is)** | all `homeostasis_update`, most `blade_status`, `godmode_update`, `wake_word_detected`, `proactive_nudge`, `blade_toast`, `clipboard_changed`, `tts_interrupted`, `health_break_reminder`, `goal_reminder`, `habit_reminder` | — | allowlist embedded in `scripts/verify-emit-policy.mjs` |

---

## Pattern Assignments

### `src/styles/tokens.css` (design-token)

**Analog:** `docs/design/shared.css` (lines 11–70) + RECOVERY_LOG §B.6–B.12 (conflict resolutions).

**Token groups to port** (verbatim CSS vars from shared.css lines 11–70):

```css
:root {
  /* Glass fills (per D-22) */
  --g-fill-weak:   rgba(255, 255, 255, 0.04);
  --g-fill:        rgba(255, 255, 255, 0.07);
  --g-fill-strong: rgba(255, 255, 255, 0.11);
  --g-fill-heavy:  rgba(255, 255, 255, 0.16);

  /* Glass edges */
  --g-edge-hi:  rgba(255, 255, 255, 0.32);
  --g-edge-mid: rgba(255, 255, 255, 0.14);
  --g-edge-lo:  rgba(255, 255, 255, 0.04);

  /* Rim (inset shadow ensemble) */
  --g-rim: inset 0 1px 0 rgba(255,255,255,0.28),
           inset 0 -1px 0 rgba(255,255,255,0.04),
           inset 1px 0 0 rgba(255,255,255,0.12),
           inset -1px 0 0 rgba(255,255,255,0.03);

  /* Shadows (same values shared.css lines 34-36) */
  --g-shadow-sm: 0 8px 24px rgba(0, 0, 0, 0.24);
  --g-shadow-md: 0 20px 50px rgba(0, 0, 0, 0.32);
  --g-shadow-lg: 0 40px 80px rgba(0, 0, 0, 0.42);

  /* Text opacities */
  --t-1: rgba(255, 255, 255, 0.97);
  --t-2: rgba(255, 255, 255, 0.72);
  --t-3: rgba(255, 255, 255, 0.50);
  --t-4: rgba(255, 255, 255, 0.32);

  /* Accents (shared.css lines 48-55) */
  --a-warm: #ffd2a6;
  --a-cool: #c8e0ff;
  --a-ok:   #8affc7;
  --a-warn: #ffc48a;
  --a-hot:  #ff9ab0;
}
```

**Radii conflict resolution** (RECOVERY_LOG §B.12): use proto.css values (tighter, matches screens) not shared.css. Phase 1 final:
```css
--r-xs:   8px;  /* same */
--r-sm:  10px;  /* was 12 in shared.css */
--r-md:  16px;  /* was 18 */
--r-lg:  20px;  /* was 26 */
--r-xl:  28px;  /* was 34 */
--r-2xl: 40px;  /* was 44 */
--r-pill: 999px;
```

**Spacing** (shared.css lines 67–70, verbatim):
```css
--s-1:  4px;  --s-2:  8px;  --s-3: 12px;  --s-4: 16px;
--s-5: 20px;  --s-6: 24px;  --s-8: 32px;  --s-10: 40px;
--s-12: 48px; --s-16: 64px; --s-20: 80px;
```

**Font tokens** (D-24: self-hosted WOFF2 per offline-first):
```css
--font-display: 'Syne', -apple-system, system-ui, sans-serif;
--font-body:    'Bricolage Grotesque', -apple-system, system-ui, sans-serif;
--font-serif:   'Fraunces', Georgia, serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;
```

**Tailwind v4 bridge** (D-23) — after `:root {}`:
```css
@import "tailwindcss";

@theme {
  /* Tokens as Tailwind utilities — single source of truth is :root */
  --color-glass-1:      var(--g-fill);
  --color-glass-2:      var(--g-fill-strong);
  --color-glass-3:      var(--g-fill-heavy);
  --color-text-strong:  var(--t-1);
  --color-text-muted:   var(--t-2);
  --color-accent-ok:    var(--a-ok);
  --radius-card:        var(--r-md);
  --radius-panel:       var(--r-lg);
  --spacing-sp-1:       var(--s-1);
  --spacing-sp-4:       var(--s-4);
  /* Motion tokens stay in :root only — @theme doesn't model cubic-bezier cleanly */
}
```

---

### `src/styles/glass.css` (design-token)

**Analog:** `docs/design/shared.css` lines 135–171 (.glass + tier variants).

**Core .glass class** (verbatim, but with blur caps per D-07 + PITFALLS P-01):

```css
.glass {
  position: relative;
  background:
    linear-gradient(180deg,
      rgba(255, 255, 255, 0.13) 0%,
      rgba(255, 255, 255, 0.06) 45%,
      rgba(255, 255, 255, 0.04) 100%);
  backdrop-filter: blur(20px) saturate(160%) brightness(1.05);   /* CAPPED per D-07 */
  -webkit-backdrop-filter: blur(20px) saturate(160%) brightness(1.05);
  border: 1px solid var(--g-edge-mid);
  border-radius: var(--r-lg);
  box-shadow: var(--g-rim), var(--g-shadow-md);
  isolation: isolate;
}

/* Specular highlight — shared.css lines 151-160 verbatim */
.glass::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(130% 80% at 0% 0%,   rgba(255,255,255,0.14) 0%, transparent 45%),
    radial-gradient(90%  60% at 100% 100%, rgba(0,0,0,0.10)       0%, transparent 55%);
  pointer-events: none;
  z-index: 0;
}
.glass > * { position: relative; z-index: 1; }

/* Tiers — capped per D-07: 20 / 12 / 8 */
.glass-1 { backdrop-filter: blur(20px) saturate(160%); }  /* standard, nav, cards */
.glass-2 { backdrop-filter: blur(12px) saturate(150%); }  /* secondary surfaces */
.glass-3 { backdrop-filter: blur(8px)  saturate(140%); }  /* minimal (hud, ambient) */
.glass.pill { border-radius: var(--r-pill); }
.glass.sm   { border-radius: var(--r-md); }

/* Fallback (STACK.md lines 162-170) */
@supports not (backdrop-filter: blur(1px)) {
  .glass, .glass-1, .glass-2, .glass-3 {
    background: rgba(20, 10, 40, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
}
```

**Note:** Opacity floor ≥0.55 on darkest tier (D-22) applies to text-on-darkest-glass — validated by `scripts/audit-contrast.mjs` (D-33).

---

### `src/styles/motion.css` (design-token)

**Analog:** STACK.md §Area 6 lines 552–568 + RECOVERY_LOG §B.5.

```css
:root {
  /* Easings — Apple HIG spring curves */
  --ease-spring: cubic-bezier(0.22, 1, 0.36, 1);   /* entry, lift */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);    /* exit */
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);     /* default */

  /* Durations */
  --dur-snap:   80ms;
  --dur-fast:  150ms;
  --dur-base:  200ms;
  --dur-enter: 280ms;
  --dur-slow:  400ms;
  --dur-float: 6200ms;

  /* Phase 4 orb constants — declared now so VoiceOrb doesn't need token retrofit */
  --orb-rms-alpha: 0.55;   /* EMA: new = 0.45·prev + 0.55·new */
  --orb-throttle:  83;     /* ms, 12fps audio sampling */
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

**Phase 4 accommodation** (CONTEXT §specifics): constants above do not block verbatim OpenClaw math (0.12 scale, 0.06 speaking amplitude, 6Hz sine, 0.28 stagger) — those live in `src/features/voice/` in Phase 4, using these tokens as the underlying rhythm.

---

### `src/styles/layout.css` (design-token)

**Analog:** `docs/design/shared.css:207–214` (`.nav-rail` dimensions). Port sizing into CSS vars per D-22.

```css
:root {
  /* Per CONTEXT §D-22 explicit list */
  --nav-width:    76px;   /* shared.css line 211: width 76px */
  --chat-width:   420px;  /* feature placeholder; Phase 3 finalizes */
  --title-height: 40px;   /* TitleBar in Phase 2 */
  --gap:          var(--s-4);  /* 16px, per prototypes */
}
```

---

### `src/design-system/primitives/Button.tsx` (primitive-component)

**Analog:** `docs/design/shared.css:256–278` (.btn + variants).

**CSS to emit** (composed via design-system; not re-embedded in `shared.css` — references tokens):
```css
/* Ported from shared.css lines 256-278 */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 20px; border-radius: var(--r-pill);
  font-size: 14px; font-weight: 500; color: var(--t-1);
  border: 1px solid var(--g-edge-mid);
  background: linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.05) 100%);
  backdrop-filter: blur(20px) saturate(180%);
  box-shadow: var(--g-rim), 0 4px 12px rgba(0,0,0,0.18);
  cursor: pointer; transition: all var(--dur-base) var(--ease-smooth);
}
.btn.primary { background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.82)); color: #1a0b2a; }
.btn.ghost   { background: transparent; border-color: var(--g-edge-mid); }
.btn.icon    { padding: 12px; width: 44px; height: 44px; }
.btn.sm      { padding: 8px 14px; font-size: 13px; }
.btn.lg      { padding: 16px 28px; font-size: 15px; }
```

**TSX shape** (props pattern per D-20, typed literal unions):
```tsx
import type { ReactNode, ButtonHTMLAttributes } from 'react';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', children, ...rest }: ButtonProps) {
  const cls = [
    'btn',
    variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : variant === 'icon' ? 'icon' : '',
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '',
  ].filter(Boolean).join(' ');
  return <button className={cls} {...rest}>{children}</button>;
}
```

**No CVA** (per D-20). Simple conditional joins.

---

### `src/design-system/primitives/GlassPanel.tsx` (primitive-component)

**Analog:** `docs/design/shared.css:135–171`.

**TSX shape** (D-20 variant pattern):
```tsx
import type { ReactNode, HTMLAttributes } from 'react';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  tier?: 1 | 2 | 3;
  shape?: 'card' | 'pill' | 'sm';
  interactive?: boolean;
  children: ReactNode;
}

export function GlassPanel({
  tier = 1, shape = 'card', interactive = false, children, className = '', ...rest
}: GlassPanelProps) {
  const cls = [
    'glass',
    `glass-${tier}`,
    shape === 'pill' ? 'pill' : shape === 'sm' ? 'sm' : '',
    interactive ? 'interactive' : '',
    className,
  ].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}
```

**Blur cap discipline:** component cannot override blur via prop — tier 1/2/3 are the only ceiling. Enforces D-07 at component level.

---

### `src/design-system/primitives/Input.tsx` (primitive-component)

**Analog:** `docs/design/shared.css:283–295`.

**CSS** (verbatim port):
```css
.input {
  width: 100%;
  padding: 14px 18px;
  font: inherit; font-size: 15px; color: var(--t-1);
  background: rgba(0,0,0,0.22);
  border: 1px solid var(--g-edge-mid);
  border-radius: var(--r-md);
  backdrop-filter: blur(20px);
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
  outline: none;
}
.input::placeholder { color: var(--t-3); }
.input.mono { font-family: var(--font-mono); font-size: 14px; letter-spacing: 0; }
```

---

### `src/design-system/primitives/Pill.tsx` + `Badge.tsx` (primitive-component)

**Analog:** `docs/design/shared.css:300–315` (.chip + variants).

Pill = full `.chip`; Badge = `.chip.dot`. Variants: `'default' | 'free' | 'new' | 'pro'` per shared.css lines 309–311.

---

### `src/design-system/primitives/GlassSpinner.tsx` (primitive-component)

**Analog:** Progress bar pattern `docs/design/shared.css:340–344` (generalized to rotation).

```tsx
// Uses --dur-spin (0.9s) from motion.css (RECOVERY_LOG §B.5)
export function GlassSpinner({ size = 24 }: { size?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{ width: size, height: size, animation: 'spin 0.9s linear infinite' }}
    >
      {/* inline SVG arc stroked with var(--t-1) */}
    </div>
  );
}
```

---

### `src/design-system/primitives/Dialog.tsx` (primitive-component)

**Analog:** STACK.md §Area 4 lines 450–460 (native `<dialog>` + `showModal()`).

```tsx
import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ open, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="glass glass-1">
      {children}
    </dialog>
  );
}
```

Browser handles focus trap + ESC close natively — no Radix dependency per D-01.

---

### `src/design-system/primitives/ComingSoonSkeleton.tsx` (primitive-component)

**Analog:** D-44 spec (no existing analog). Uses `GlassPanel`.

```tsx
import { GlassPanel } from './GlassPanel';

interface Props { routeLabel: string; phase: number; }

export function ComingSoonSkeleton({ routeLabel, phase }: Props) {
  return (
    <GlassPanel tier={1} role="region" aria-label={`${routeLabel} — ships in Phase ${phase}`}>
      <div style={{ padding: 'var(--s-10)', textAlign: 'center' }}>
        <h2 className="t-h2">{routeLabel}</h2>
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          Ships in Phase {phase}
        </p>
        {import.meta.env.DEV && (
          <span className="chip" style={{ marginTop: 'var(--s-4)', fontFamily: 'var(--font-mono)' }}>
            [Route: /{routeLabel.toLowerCase().replace(/\s+/g, '-')} · Phase {phase}]
          </span>
        )}
      </div>
    </GlassPanel>
  );
}
```

**Critical:** no interactions (D-44). Backend-pushed routes (e.g. `capability_gap_detected → openRoute('reports')`) land here cleanly instead of 404.

---

### `src/lib/tauri/_base.ts` (wrapper)

**Analog:** ARCHITECTURE.md §4 lines 426–449 (verbatim recipe, adapted for D-37 discriminated-union `TauriError.kind`).

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type TauriErrorKind = 'not_found' | 'bad_args' | 'rust_error' | 'unknown';

export class TauriError extends Error {
  constructor(
    public command: string,
    public kind: TauriErrorKind,
    public rustMessage: string,
  ) {
    super(`[${command}] ${kind}: ${rustMessage}`);
    this.name = 'TauriError';
  }
}

function classify(raw: string): TauriErrorKind {
  const msg = raw.toLowerCase();
  if (msg.includes('not found') || msg.includes('missing')) return 'not_found';
  if (msg.includes('invalid') || msg.includes('bad arg') || msg.includes('expected')) return 'bad_args';
  if (msg.includes('rust') || msg.includes('panic')) return 'rust_error';
  return 'unknown';
}

/**
 * Only permitted invoke surface (D-13, D-34).
 * Arg keys passed verbatim (snake_case) — no transformation (D-38).
 */
export async function invokeTyped<TReturn, TArgs extends Record<string, unknown> = Record<string, never>>(
  command: string,
  args?: TArgs,
): Promise<TReturn> {
  try {
    return await tauriInvoke<TReturn>(command, args);
  } catch (e) {
    const raw = typeof e === 'string' ? e : String(e);
    throw new TauriError(command, classify(raw), raw);
  }
}
```

---

### `src/lib/tauri/config.ts` (wrapper)

**Analog:** ARCHITECTURE.md §4 lines 451–478 pattern + Rust cites `src-tauri/src/commands.rs:1899,2312,2325` + `src-tauri/src/config.rs:514`.

```typescript
import { invokeTyped } from './_base';
import type { BladeConfig } from '@/types/config';

/** @see src-tauri/src/commands.rs:1899 `pub fn get_config() -> BladeConfig` */
export function getConfig(): Promise<BladeConfig> {
  return invokeTyped<BladeConfig>('get_config');
}

/** @see src-tauri/src/config.rs:514 `pub fn save_config(config: &BladeConfig) -> Result<(), String>` */
export function saveConfig(config: BladeConfig): Promise<void> {
  // snake_case arg per D-38 — Rust receives `config` verbatim
  return invokeTyped<void, { config: BladeConfig }>('save_config', { config });
}

/** @see src-tauri/src/commands.rs:2312 `pub fn get_onboarding_status() -> bool` */
export function getOnboardingStatus(): Promise<boolean> {
  return invokeTyped<boolean>('get_onboarding_status');
}

/** @see src-tauri/src/commands.rs:2325 `pub async fn complete_onboarding(answers: Vec<String>) -> Result<(), String>` */
export function completeOnboarding(answers: string[]): Promise<void> {
  return invokeTyped<void, { answers: string[] }>('complete_onboarding', { answers });
}
```

**JSDoc cite pattern** (D-38): `@see src-tauri/src/<file>.rs:<line_or_fn>` — every wrapper carries one.

---

### `src/lib/tauri/chat.ts` (wrapper)

**Analog:** ARCHITECTURE.md §4 lines 460–470 + Rust cites `src-tauri/src/commands.rs:558,71`.

```typescript
import { invokeTyped } from './_base';
import type { ChatMessage } from '@/types/messages';

/** @see src-tauri/src/commands.rs:558 `pub async fn send_message_stream(messages: Vec<ChatMessage>) -> Result<(), String>` */
export function sendMessageStream(messages: ChatMessage[]): Promise<void> {
  return invokeTyped<void, { messages: ChatMessage[] }>('send_message_stream', { messages });
}

/** @see src-tauri/src/commands.rs:71 `pub fn cancel_chat(app: tauri::AppHandle)` */
export function cancelChat(): Promise<void> {
  return invokeTyped<void>('cancel_chat');
}
```

---

### `src/lib/events/index.ts` (event)

**Analog:** ARCHITECTURE.md §7 lines 629–668 (hook recipe) + RECOVERY_LOG §4 (event catalog 29 LIVE + 5 WIRE-REQUIRED forward declarations).

**BLADE_EVENTS constant** (D-38-evt flat frozen object, per CONTEXT):

```typescript
export const BLADE_EVENTS = {
  // Chat pipeline (LIVE — commands.rs)
  CHAT_TOKEN:          'chat_token',
  CHAT_DONE:           'chat_done',
  CHAT_ACK:            'chat_ack',
  CHAT_ROUTING:        'chat_routing',
  CHAT_CANCELLED:      'chat_cancelled',
  CHAT_THINKING:       'chat_thinking',
  CHAT_THINKING_DONE:  'chat_thinking_done',
  BLADE_STATUS:        'blade_status',
  BLADE_PLANNING:      'blade_planning',
  BLADE_NOTIFICATION:  'blade_notification',
  BLADE_ROUTING_SWITCHED: 'blade_routing_switched',

  // WIRE-REQUIRED forward declarations (type surface complete Day 1 per D-38-payload)
  BLADE_MESSAGE_START:   'blade_message_start',   // WIRE-03
  BLADE_THINKING_CHUNK:  'blade_thinking_chunk',  // WIRE-04
  BLADE_TOKEN_RATIO:     'blade_token_ratio',     // WIRE-06
  BLADE_QUICKASK_BRIDGED:'blade_quickask_bridged',// WIRE-01
  HORMONE_UPDATE:        'hormone_update',        // WIRE-02 (rename of homeostasis_update)

  // Tool + approval (LIVE)
  TOOL_APPROVAL_NEEDED:   'tool_approval_needed',
  TOOL_RESULT:            'tool_result',
  AI_DELEGATE_APPROVED:   'ai_delegate_approved',
  AI_DELEGATE_DENIED:     'ai_delegate_denied',
  BRAIN_GREW:             'brain_grew',
  CAPABILITY_GAP_DETECTED:'capability_gap_detected',
  RESPONSE_IMPROVED:      'response_improved',

  // Voice (LIVE — voice_global.rs + wake_word.rs)
  VOICE_CONVERSATION_LISTENING: 'voice_conversation_listening',
  VOICE_CONVERSATION_THINKING:  'voice_conversation_thinking',
  VOICE_CONVERSATION_SPEAKING:  'voice_conversation_speaking',
  VOICE_CONVERSATION_ENDED:     'voice_conversation_ended',
  VOICE_GLOBAL_STARTED:         'voice_global_started',
  VOICE_GLOBAL_TRANSCRIBING:    'voice_global_transcribing',
  VOICE_GLOBAL_ERROR:           'voice_global_error',
  VOICE_TRANSCRIPT_READY:       'voice_transcript_ready',
  WAKE_WORD_DETECTED:           'wake_word_detected',

  // System / background (LIVE)
  DEEP_SCAN_PROGRESS:    'deep_scan_progress',
  HOMEOSTASIS_UPDATE:    'homeostasis_update',  // existing; aliased by HORMONE_UPDATE in Phase 3
  HUD_DATA_UPDATED:      'hud_data_updated',
  BLADE_TOAST:           'blade_toast',
  GODMODE_UPDATE:        'godmode_update',
  PROACTIVE_NUDGE:       'proactive_nudge',

  // Ghost (LIVE)
  GHOST_MEETING_STATE:             'ghost_meeting_state',
  GHOST_MEETING_ENDED:             'ghost_meeting_ended',
  GHOST_SUGGESTION_READY_TO_SPEAK: 'ghost_suggestion_ready_to_speak',

  // Agents (LIVE)
  BLADE_AGENT_EVENT: 'blade_agent_event',  // WIRE-05 (event exists, frontend consumer pending Phase 5)
} as const;

export type BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS];
```

**useTauriEvent hook** (ARCHITECTURE.md §7 lines 629–668 verbatim, handler-in-ref pattern per D-38-hook):

```typescript
import { useEffect, useRef } from 'react';
import { listen, type EventCallback, type Event } from '@tauri-apps/api/event';

export function useTauriEvent<T>(name: BladeEventName, handler: EventCallback<T>): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;   // always up to date without re-subscribing

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    // Dev-only listener counter for P-06 leak test (D-32)
    if (import.meta.env.DEV) {
      (window as any).__BLADE_LISTENERS_COUNT__ =
        ((window as any).__BLADE_LISTENERS_COUNT__ ?? 0) + 1;
    }

    listen<T>(name, (event: Event<T>) => {
      if (!cancelled) handlerRef.current(event);
    }).then(fn => {
      if (cancelled) fn();
      else unlistenFn = fn;
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
      if (import.meta.env.DEV) {
        (window as any).__BLADE_LISTENERS_COUNT__ -= 1;
      }
    };
  }, [name]);   // handler intentionally omitted — callers memoize if needed
}
```

---

### `src/lib/events/payloads.ts` (event)

**Analog:** RECOVERY_LOG §4 Event Catalog payload columns + Rust struct sources for the complex payloads.

```typescript
// Simple payloads (direct from RECOVERY_LOG §4)
export type ChatTokenPayload = string;
export type ChatDonePayload  = null;  // () in Rust

export interface ChatRoutingPayload {
  provider: string;
  model: string;
  hive_active: boolean;
}

export type BladeStatusPayload = 'processing' | 'thinking' | 'idle' | 'error';

export interface BladeNotificationPayload {
  type: 'info' | 'warn' | 'error';
  message: string;
}

// WIRE-02 forward declaration — mirrors src-tauri/src/homeostasis.rs:28 HormoneState
export interface HormoneUpdatePayload {
  arousal: number;
  energy_mode: number;
  exploration: number;
  trust: number;
  urgency: number;
  hunger: number;
  thirst: number;
  insulin: number;
  adrenaline: number;
  leptin: number;
}

// WIRE-01 forward declaration
export interface BladeQuickAskBridgedPayload {
  query: string;
  response: string;
  conversation_id: string;
  mode: 'text' | 'voice';
  timestamp: number;
}

// Ghost — mirrors src-tauri/src/ghost_mode.rs:115 GhostMeetingState
export interface GhostMeetingStatePayload {
  /* full shape to port from Rust struct during implementation */
  [k: string]: unknown;
}

// Tool approval — matches commands.rs:1631,1653
export interface ToolApprovalNeededPayload {
  tool_name: string;
  args: Record<string, unknown>;
  context: string;
  request_id: string;
}

// Voice
export interface VoiceConversationSpeakingPayload { text: string; }
export interface VoiceConversationThinkingPayload { text: string; }
export interface VoiceConversationEndedPayload { reason: 'stopped' | 'no_mic'; }
export interface WakeWordDetectedPayload { phrase: string; play_chime: boolean; }

// Deep scan (onboarding)
export interface DeepScanProgressPayload {
  step: number;
  total: number;
  label: string;
  percent: number;
}
```

**Discipline:** every row in RECOVERY_LOG §4 that Phase 1 seeds gets a payload type here. No zod (D-38-payload: plain TS interfaces; revisit in Phase 5 if drift hurts).

---

### `src/lib/router.ts` (route)

**Analog:** ARCHITECTURE.md §2 lines 254–272 + expanded per D-39.

```typescript
import type { ComponentType, LazyExoticComponent } from 'react';

export type Section =
  | 'core' | 'agents' | 'knowledge' | 'life'
  | 'identity' | 'dev' | 'admin' | 'body' | 'hive';

export interface RouteDefinition {
  id: string;                              // kebab-case unique
  label: string;
  section: Section;
  component: LazyExoticComponent<ComponentType<any>>;
  icon?: ComponentType;
  shortcut?: string;
  paletteHidden?: boolean;
  description?: string;
  phase?: number;                          // drives ComingSoonSkeleton
}

// Static fallback per D-40-default
export const DEFAULT_ROUTE_ID = 'dashboard';
```

---

### `src/windows/main/router.ts` (route-aggregator)

**Analog:** ARCHITECTURE.md §2 lines 275–305 (explicit concat, no glob per D-40).

```typescript
import { routes as dashboardRoutes } from '@/features/dashboard';
import { routes as chatRoutes }      from '@/features/chat';
import { routes as settingsRoutes }  from '@/features/settings';
import { routes as agentRoutes }     from '@/features/agents';
import { routes as knowledgeRoutes } from '@/features/knowledge';
import { routes as lifeOsRoutes }    from '@/features/life-os';
import { routes as identityRoutes }  from '@/features/identity';
import { routes as devToolsRoutes }  from '@/features/dev-tools';
import { routes as adminRoutes }     from '@/features/admin';
import { routes as bodyRoutes }      from '@/features/body';
import { routes as hiveRoutes }      from '@/features/hive';
import { routes as onboardingRoutes }from '@/features/onboarding';
import type { RouteDefinition } from '@/lib/router';

const devRoutes: RouteDefinition[] = import.meta.env.DEV
  ? (await import('@/features/dev')).routes
  : [];

export const ALL_ROUTES: RouteDefinition[] = [
  ...dashboardRoutes,
  ...chatRoutes,
  ...settingsRoutes,
  ...agentRoutes,
  ...knowledgeRoutes,
  ...lifeOsRoutes,
  ...identityRoutes,
  ...devToolsRoutes,
  ...adminRoutes,
  ...bodyRoutes,
  ...hiveRoutes,
  ...onboardingRoutes,
  ...devRoutes,
];

export const ROUTE_MAP = new Map(ALL_ROUTES.map(r => [r.id, r]));
export const PALETTE_COMMANDS = ALL_ROUTES.filter(r => !r.paletteHidden);
```

---

### Feature `index.ts` stubs (13 files)

**Analog:** ARCHITECTURE.md §2 lines 233–251 (chat feature exemplar).

**Template** for every feature cluster:
```typescript
// src/features/<cluster>/index.ts
import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';
import { ComingSoonSkeleton } from '@/design-system/primitives';

const placeholder = (label: string, phase: number) =>
  lazy(async () => ({
    default: () => <ComingSoonSkeleton routeLabel={label} phase={phase} />,
  }));

export const routes: RouteDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', section: 'core',
    component: placeholder('Dashboard', 3), phase: 3 },
  // ... more per cluster
];
```

**Expected distribution** (seeds migration ledger D-28; total ~59 routes):

| Cluster | Section | Phase ships | Route ids (examples) |
|---|---|---|---|
| dashboard | core | 3 | `dashboard` |
| chat | core | 3 | `chat` |
| settings | core | 3 | `settings`, `settings/providers`, `settings/routing`, `settings/memory`, `settings/mcp`, `settings/personality`, `settings/privacy` |
| agents | agents | 5 | `agents`, `bg-agents`, `swarm`, `agent-detail`, `agent-factory` |
| knowledge | knowledge | 5 | `knowledge`, `graph`, `screen-timeline`, `rewind`, `embeddings` |
| life-os | life | 5 | `health`, `finance`, `goals`, `habits`, `meetings`, `social-graph`, `predictions` |
| identity | identity | 5 | `soul`, `persona`, `character`, `negotiation`, `reasoning`, `context-engine` |
| dev-tools | dev | 5 | `terminal`, `files`, `git`, `canvas`, `workflows`, `web-automation`, `email`, `docs` |
| admin | admin | 5 | `analytics`, `reports`, `decision-log`, `security`, `diagnostics`, `mcp-settings` |
| body | body | 5–8 | `body-map`, `organ-registry`, `hormone-bus`, `tentacles` |
| hive | hive | 5–8 | `hive-mesh`, `hive-signals` |
| onboarding | core | 2 | `onboarding` (step routing internal to OnboardingFlow) |
| dev (palette-hidden) | dev | 1 | `primitives`, `wrapper-smoke`, `diagnostics` |

Planner finalizes exact count — ledger seed script is source of truth (D-28).

---

### `src/hooks/usePrefs.ts` (hook)

**Analog:** D-42 spec (no existing analog — drives PITFALLS P-13 discipline).

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'blade_prefs_v1';
const DEBOUNCE_MS = 250;

export interface Prefs {
  'app.defaultRoute'?: string;
  'app.lastRoute'?: string;
  'chat.showTimestamps'?: boolean;
  'chat.inlineToolCalls'?: boolean;
  'ghost.linuxWarningAcknowledged'?: boolean;
  [k: string]: string | number | boolean | undefined;
}

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(() => read());   // single read on mount (P-13)
  const timeout = useRef<number | null>(null);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs(p => {
      const next = { ...p, [key]: value };
      if (timeout.current) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => {
        localStorage.setItem(KEY, JSON.stringify(next));
      }, DEBOUNCE_MS);
      return next;
    });
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs({});
    localStorage.removeItem(KEY);
  }, []);

  return { prefs, setPref, resetPrefs };
}
```

**Enforcement:** every component that would reach for `localStorage.getItem` must route through `usePrefs` (per CONTEXT §code_context). ESLint rule `no-raw-tauri.js` is scoped to Tauri APIs; a sibling lint or grep-CI pass may be needed if Phase 1 team wants the same rigor for localStorage (deferred — planner's call).

---

### `src/lib/context/ConfigContext.tsx` (provider)

**Analog:** ARCHITECTURE.md §5 lines 553–566 verbatim.

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getConfig } from '@/lib/tauri/config';
import { useTauriEvent } from '@/lib/events';
import { BLADE_EVENTS } from '@/lib/events';
import { GlassSpinner } from '@/design-system/primitives';
import type { BladeConfig } from '@/types/config';

const ConfigContext = createContext<{ config: BladeConfig; reload: () => void } | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<BladeConfig | null>(null);

  useEffect(() => { getConfig().then(setConfig); }, []);

  // Reload on backend config change (event TBD — stubbed for Phase 3)
  useTauriEvent<void>(BLADE_EVENTS.BLADE_STATUS, () => { /* placeholder trigger */ });

  if (!config) return <GlassSpinner />;

  return (
    <ConfigContext.Provider value={{ config, reload: () => getConfig().then(setConfig) }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used inside <ConfigProvider>');
  return ctx;
}
```

**Scope:** main window only (D-41). Overlay/HUD/QuickAsk/Ghost do not mount this provider.

---

### `src/features/dev/WrapperSmoke.tsx` (test dev UI)

**Analog:** D-30 spec (no existing analog).

```tsx
// Route: /wrapper-smoke — palette-hidden, DEV only
// Each row: { fnName, rustCite, args, result, pass }
// Iterate every Phase-1 wrapper; invoke read-only only; render table.

const TESTS = [
  { name: 'getConfig',             cite: 'commands.rs:1899',        args: [], readOnly: true },
  { name: 'getOnboardingStatus',   cite: 'commands.rs:2312',        args: [], readOnly: true },
  { name: 'sendMessageStream',     cite: 'commands.rs:558',         args: [/* dry-run */], readOnly: false, skipIfNotReadOnly: true },
  // ...
];
```

---

### `tests/e2e/listener-leak.spec.ts` (test)

**Analog:** D-32 spec. Harness choice (Playwright direct vs `@tauri-apps/test`) left to planner discretion per CONTEXT.

```typescript
test('listener leak: 5× route churn keeps count stable', async ({ page }) => {
  await launchDev(page);                             // boot dev build
  const initialCount = await page.evaluate(() => (window as any).__BLADE_LISTENERS_COUNT__);

  for (let i = 0; i < 5; i++) {
    await openRoute(page, 'chat');
    await openRoute(page, 'dashboard');
  }

  // Emit test event from Rust via `app.emit_to('main', 'test_event', null)`
  await emitTestEvent(page);
  await expectHandlerCalled(page, 1);                // consumed exactly once

  const finalCount = await page.evaluate(() => (window as any).__BLADE_LISTENERS_COUNT__);
  expect(finalCount).toBeLessThanOrEqual(initialCount);   // no growth
});
```

---

### `scripts/verify-entries.mjs` (verify-script)

**Analog:** D-31 spec.

```javascript
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');

// Extract `build.rollupOptions.input` keys — regex sufficient for this shape
const inputs = [...config.matchAll(/(\w+):\s*resolve\(__dirname,\s*"([^"]+)"\)/g)]
  .map(m => ({ key: m[1], path: m[2] }));

let failed = false;
for (const { key, path } of inputs) {
  const full = resolve(ROOT, path);
  if (!existsSync(full)) {
    console.error(`[verify-entries] MISSING: ${key} -> ${path}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`[verify-entries] OK — ${inputs.length} entries present`);
```

---

### `scripts/verify-emit-policy.mjs` (verify-script)

**Analog:** D-45-regress spec + RECOVERY_LOG §5.2 classification table.

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Allowlist embedded from RECOVERY_LOG §5 cross-window classifications
const CROSS_WINDOW_ALLOWLIST = new Set([
  'src-tauri/src/commands.rs:78:blade_status',
  'src-tauri/src/commands.rs:311:blade_status',
  'src-tauri/src/homeostasis.rs:424:homeostasis_update',
  'src-tauri/src/wake_word.rs:274:wake_word_detected',
  'src-tauri/src/overlay_manager.rs:323:blade_toast',
  'src-tauri/src/godmode.rs:233:godmode_update',
  'src-tauri/src/clipboard.rs:194:clipboard_changed',
  'src-tauri/src/tts.rs:264:tts_interrupted',
  'src-tauri/src/tts.rs:272:tts_interrupted',
  'src-tauri/src/voice_global.rs:223:voice_conversation_listening',
  'src-tauri/src/voice_global.rs:239:voice_conversation_ended',
  // ... 31 more rows from RECOVERY_LOG §5.2 cross-window classification
]);

function* walk(dir) { /* recursive .rs files */ }

let failed = false;
for (const file of walk('src-tauri/src')) {
  const text = readFileSync(file, 'utf8');
  const matches = [...text.matchAll(/\b(app\.emit|emit_all)\s*\(\s*"(\w+)"/g)];
  for (const m of matches) {
    const line = text.slice(0, m.index).split('\n').length;
    const key = `${file}:${line}:${m[2]}`;
    if (!CROSS_WINDOW_ALLOWLIST.has(key)) {
      console.error(`[verify-emit-policy] VIOLATION: ${key} (use emit_to(label, ...) or add to allowlist)`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('[verify-emit-policy] OK');
```

---

### `scripts/audit-contrast.mjs` (verify-script, P-08)

**Analog:** D-33 spec.

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Parse tokens.css + glass.css, extract RGBA pairs, compute WCAG 2.1 relative luminance
// Fail if any documented text-on-background pair < 4.5:1

function rgbaToRgb(a, bg) { /* composite alpha over background */ }
function relativeLuminance(r, g, b) { /* WCAG 2.1 formula */ }
function contrast(l1, l2) { return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

const pairs = [
  // text on glass tier 1 (darkest realistic — black wallpaper + glass opacity ≥0.55)
  { fg: 't-1 on glass-1', fgRgba: [255,255,255,0.97], bgRgba: [255,255,255,0.07], wallpaper: [10,5,24] },
  { fg: 't-2 on glass-1', fgRgba: [255,255,255,0.72], bgRgba: [255,255,255,0.07], wallpaper: [10,5,24] },
  // ... for t-3, t-4 against glass-2, glass-3
];

// Threshold 4.5:1 (WCAG AA); assert per CONTEXT key numbers table
```

---

### `scripts/verify-no-raw-tauri.sh` (verify-script, D-34 backstop)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Ban: raw invoke outside src/lib/tauri/
if grep -rE "from '@tauri-apps/api/core'" src/ --include='*.ts' --include='*.tsx' \
   | grep -v 'src/lib/tauri/'; then
  echo "[verify-no-raw-tauri] FAIL: raw invoke import outside src/lib/tauri/"
  exit 1
fi

# Ban: raw listen outside src/lib/events/
if grep -rE "from '@tauri-apps/api/event'" src/ --include='*.ts' --include='*.tsx' \
   | grep -v 'src/lib/events/'; then
  echo "[verify-no-raw-tauri] FAIL: raw listen import outside src/lib/events/"
  exit 1
fi

echo "[verify-no-raw-tauri] OK"
```

---

### `eslint-rules/no-raw-tauri.js` (eslint-rule)

**Analog:** D-34 spec. Flat ESLint rule (ESLint v9 flat config).

```javascript
// Fail on raw @tauri-apps/api/core `invoke` or @tauri-apps/api/event `listen` imports
// outside allowed paths.
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Ban raw Tauri invoke/listen outside lib/tauri and lib/events' },
    messages: {
      rawInvoke: 'Use invokeTyped from @/lib/tauri/_base instead of raw invoke (D-34)',
      rawListen: 'Use useTauriEvent from @/lib/events instead of raw listen (D-34)',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const isAllowedInvoke = filename.includes('/src/lib/tauri/');
    const isAllowedListen = filename.includes('/src/lib/events/');
    return {
      ImportDeclaration(node) {
        if (node.source.value === '@tauri-apps/api/core' && !isAllowedInvoke) {
          const hasInvoke = node.specifiers.some(s =>
            s.imported?.name === 'invoke');
          if (hasInvoke) context.report({ node, messageId: 'rawInvoke' });
        }
        if (node.source.value === '@tauri-apps/api/event' && !isAllowedListen) {
          const hasListen = node.specifiers.some(s =>
            s.imported?.name === 'listen');
          if (hasListen) context.report({ node, messageId: 'rawListen' });
        }
      },
    };
  },
};
```

---

### HTML entry template (applies to all 5)

**Analog:** D-43 spec (no existing HTML analog in `src/` post-nuke; `index.html` may already exist pre-nuke and gets rewritten).

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>BLADE</title>
    <!-- Inline dark-bg default per D-43: prevents white-flash before tokens.css hydrates -->
    <style>html,body{background:#000;margin:0}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/windows/main/main.tsx"></script>
  </body>
</html>
```

**Variations:** each window points at its own bootstrap (`quickask/main.tsx`, `overlay/main.tsx`, `hud/main.tsx`, `ghost/main.tsx`). No inline React, no CSS imports in HTML — all through the bootstrap.

---

### `src/windows/main/main.tsx` (bootstrap)

**Analog:** ARCHITECTURE.md §1 lines 44–48 + D-29 P-01 perf mark.

```tsx
import 'performance-mark-boot';   // inline below — must run BEFORE React import
performance.mark('boot');

import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from '@/lib/context/ConfigContext';
import { GlassSpinner } from '@/design-system/primitives';
import { MainApp } from './MainApp';
import '@/styles/index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <ConfigProvider>
      <Suspense fallback={<GlassSpinner />}>
        <MainApp />
      </Suspense>
    </ConfigProvider>
  </React.StrictMode>
);
```

**Other 4 bootstraps** skip `ConfigProvider` (per D-41). QuickAsk/overlay/hud/ghost receive config snapshots via `config_snapshot` emit (D-41).

---

## Shared Patterns

### Pattern: Rust → TS wrapper with `@see` cite (D-38)

**Source:** ARCHITECTURE.md §4 lines 451–478 + Anti-Pattern 1.
**Apply to:** every file in `src/lib/tauri/*.ts`.

```typescript
/** @see src-tauri/src/<file>.rs:<fn_or_line> `<rust_signature>` */
export function camelCaseFn(arg1: T1): Promise<TReturn> {
  return invokeTyped<TReturn, { snake_case_arg: T1 }>('rust_command_name', { snake_case_arg: arg1 });
}
```

**Discipline:** TS function = camelCase; invoke string = snake_case (Rust command name verbatim); arg keys = snake_case (no transform). Cite line helps Rust refactor track-down.

---

### Pattern: Event subscription via `useTauriEvent` (D-38-hook)

**Source:** ARCHITECTURE.md §7 lines 629–668 + PITFALLS P-06.
**Apply to:** every component that subscribes to Tauri events.

```typescript
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
import type { ChatTokenPayload } from '@/lib/events/payloads';

// Inside a component:
useTauriEvent<ChatTokenPayload>(BLADE_EVENTS.CHAT_TOKEN, (event) => {
  appendToStream(event.payload);
});
```

**Never** import `listen` directly outside `src/lib/events/`. ESLint rule + `verify-no-raw-tauri.sh` enforce.

---

### Pattern: Route declaration with `ComingSoonSkeleton` placeholder (D-44)

**Source:** D-26 step 7.
**Apply to:** every feature index.ts in Phase 1 (until the real view lands in its destination phase).

```typescript
import { lazy } from 'react';
import { ComingSoonSkeleton } from '@/design-system/primitives';
import type { RouteDefinition } from '@/lib/router';

const makePlaceholder = (label: string, phase: number) =>
  lazy(async () => ({
    default: () => <ComingSoonSkeleton routeLabel={label} phase={phase} />,
  }));

export const routes: RouteDefinition[] = [
  { id: 'my-route', label: 'My Route', section: 'core', phase: 3,
    component: makePlaceholder('My Route', 3) },
];
```

**Phase flip:** when a real view ships, replace `makePlaceholder` call with real `lazy(() => import('./MyView'))`; update migration ledger status to `Shipped`.

---

### Pattern: CSS custom properties as single source of truth (D-23)

**Source:** STACK.md §Area 7 lines 610–649.
**Apply to:** every visual-token definition.

```css
/* :root in tokens.css defines the literal value */
:root {
  --g-fill: rgba(255, 255, 255, 0.07);
}

/* @theme bridges to Tailwind — references :root, doesn't redefine */
@theme {
  --color-glass-1: var(--g-fill);
}

/* Components consume via Tailwind util OR CSS var directly */
<div className="bg-glass-1">           <!-- preferred -->
<div style={{ background: 'var(--g-fill)' }}>   <!-- when no util exists yet -->
```

**Discipline:** adding a new token = 1 edit in `:root`; Tailwind util appears automatically via `@theme` bridge. Never hardcode rgba in components (ARCHITECTURE.md Anti-Pattern 5).

---

### Pattern: Verify script (D-27, D-31, D-33, D-34, D-45-regress)

**Source:** 6 verify scripts listed above.
**Apply to:** every CI-enforced invariant.

```javascript
#!/usr/bin/env node
// 1. Read source (CSS / config / Rust)
// 2. Parse / grep / regex
// 3. Assert invariant
// 4. console.error + process.exit(1) on failure
// 5. console.log 'OK — <summary>' on pass
```

**Runnable locally** via `npm run verify:<check>`; wired into `.github/workflows/build.yml` (exact job structure is planner's discretion per CONTEXT).

---

### Pattern: Dev-only route gating (D-21, D-30, D-40-palette)

**Source:** `src/windows/main/router.ts` conditional + `paletteHidden: true`.
**Apply to:** `src/features/dev/*` (Primitives, WrapperSmoke, Diagnostics).

```typescript
// In src/features/dev/index.ts:
export const routes: RouteDefinition[] = [
  { id: 'primitives',    label: 'Primitives Showcase', section: 'dev',
    paletteHidden: true, component: lazy(() => import('./Primitives')),
    phase: 1 },
  { id: 'wrapper-smoke', label: 'Wrapper Smoke Test',  section: 'dev',
    paletteHidden: true, component: lazy(() => import('./WrapperSmoke')),
    phase: 1 },
  { id: 'diagnostics',   label: 'Diagnostics',          section: 'dev',
    paletteHidden: true, component: lazy(() => import('./Diagnostics')),
    phase: 1 },
];

// In windows/main/router.ts:
const devRoutes = import.meta.env.DEV
  ? (await import('@/features/dev')).routes
  : [];
```

Prod build tree-shakes the feature/dev/ subtree entirely.

---

### Pattern: Rust `emit_to(label, ...)` for single-window events (D-14, D-45, WIRE-08)

**Source:** RECOVERY_LOG §5.2 classification; 142 refactor sites.
**Apply to:** every single-window emit in `src-tauri/src/`.

**Before (broken, cross-window contamination risk):**
```rust
let _ = app.emit("chat_token", payload);           // broadcasts to all windows
```

**After (Phase 1 refactor):**
```rust
let _ = app.emit_to("main", "chat_token", payload);
```

**Discipline:** 5 window labels — `main`, `quickask`, `overlay`, `hud`, `ghost_overlay`. Cross-window (42 sites, allowlisted) keep `app.emit(...)` / `emit_all`. Regression prevented by `scripts/verify-emit-policy.mjs` CI gate.

---

## No Analog Found

Files with no existing code analog in the repo (planner uses research docs + the spec excerpts above instead):

| File | Role | Reason |
|---|---|---|
| `src/hooks/usePrefs.ts` | hook | New pattern — D-42 spec drives it; PITFALLS P-13 provides the anti-pattern (252 scattered localStorage calls in src.bak) |
| `eslint-rules/no-raw-tauri.js` | eslint-rule | First custom ESLint rule in the repo |
| `tests/e2e/listener-leak.spec.ts` | test | First Playwright + Tauri harness; harness dep choice deferred to planner |
| `scripts/verify-*.mjs` (6 scripts) | verify-script | All new — spec-driven per D-27, D-31, D-33, D-34, D-45-regress; no prior CI verify scripts in repo |
| `src/features/dev/Primitives.tsx`, `WrapperSmoke.tsx`, `Diagnostics.tsx` | dev UI | New dev surfaces; spec-driven (D-21, D-30) |
| `.planning/migration-ledger.md` | doc | New doc, seeded by one-shot script; no prior ledger |
| `src/styles/index.css` | design-token-barrel | Trivial `@import` barrel |
| `src/lib/context/index.ts` | barrel | Trivial re-export |
| `src/lib/tauri/index.ts` | barrel | Trivial re-export |

---

## Metadata

- **Analog search scope:** `docs/design/*.css`, `src-tauri/src/**/*.rs`, `.planning/research/*.md`, `.planning/phases/00-*/00-*.md`, `.planning/RECOVERY_LOG.md`, `vite.config.ts`, `package.json`
- **Files scanned:** ~40 (selective via Grep where structure was known from research)
- **Source of truth for visuals:** `docs/design/shared.css` (378 lines read in full) + RECOVERY_LOG §B (token conflict resolutions)
- **Source of truth for backend:** `00-BACKEND-EXTRACT.md` (316 lines) + RECOVERY_LOG §4–5 (event catalog + emit classification) + targeted Rust Grep for `pub (async) fn` signatures
- **Source of truth for architecture recipes:** ARCHITECTURE.md §1, §2, §4, §5, §7 + STACK.md §Area 1, 4, 6, 7
- **Intentionally NOT referenced:** `src.bak/` per D-17. Only the one-shot `scripts/seed-migration-ledger.mjs` peeks at it (runs once, commits output).
- **Pattern extraction date:** 2026-04-18
