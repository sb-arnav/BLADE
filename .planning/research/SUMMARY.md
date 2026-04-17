# BLADE Skin Rebuild — Research Summary

**Project:** BLADE Skin Rebuild (V1)
**Researched:** 2026-04-17
**Confidence:** HIGH — all source files grounded in live codebase audit + primary API docs + user-gathered prior art
**For:** Roadmapper agent. Read this first, then read individual research files for detail.

---

## Executive Summary

BLADE's Skin rebuild is a nuke-and-rebuild of the React frontend — replacing a 1,300-line App.tsx monolith and 234 raw invokes with a feature-clustered, typed-wrapper architecture over a fully functional 178-module Rust backend. The aesthetic target is macOS Liquid Glass across 5 windows, 59 routes, and 18 surface clusters. The backend is complete and documented; the work is entirely frontend wiring and visual system construction.

The core risk is not complexity — it is ordering. Six pitfalls (P-01 through P-06) are Critical-severity and all must be addressed in Foundation phase before any feature work begins. If the GPU budget, typed wrapper discipline, event listener hygiene, three missing HTML files, QuickAsk bridge, and route migration ledger are not locked in Phase 1, each later phase will rediscover the same failures. Recovery cost after the fact is HIGH for half of them.

User-gathered prior art (PRIOR_ART.md) from deep reads of Cluely, OpenClaw, Pluely, and Omi provides concrete, tuned constants — animation math, audio pipeline configs, content-protection mechanisms — that override generic recommendations wherever they conflict. These are not suggestions; they are already partially applied to the backend and endorsed by the product owner.

---

## Locked Decisions

All decisions below are committed. "Decided" means no further evaluation needed — proceed as stated.

| # | Decision | Rationale | Source |
|---|----------|-----------|--------|
| D-01 | **Self-built 8 primitives. No shadcn, no Radix.** | Radix DOM structure fights glass layout; shadcn token namespace conflicts; 8 components takes 2-4h, not worth the override cost | STACK.md:441-446 |
| D-02 | **No Framer Motion, no Motion One. CSS-only motion.** | PROJECT.md explicitly prohibits it; orb.css proves CSS is sufficient; 31 KB gzip cost unwarranted | STACK.md:540-548, PROJECT.md:58 |
| D-03 | **No TauRPC, no tauri-typegen.** Hand-written wrapper in `src/lib/tauri/`. | TauRPC requires backend rewrite (764 handlers); tauri-typegen fails on BLADE macros; hand-written = ~171 commands, reviewable per cluster | STACK.md:469-471, ARCHITECTURE.md:420-485 |
| D-04 | **No Zustand, no Jotai.** `useChat` hook + lift-to-App pattern. | No second cross-route state today; YAGNI | STACK.md:38, PROJECT.md:55 |
| D-05 | **No React Router / Wouter.** Custom discriminated-union registry (`src/lib/router.ts`). | No URL needs; History API conflicts with Tauri; current router works | STACK.md:37, ARCHITECTURE.md:230-305 |
| D-06 | **Two-track glass: window-vibrancy (native NSVisualEffectView) for window chrome; CSS backdrop-filter over DOM .wallpaper for in-webview panels.** | Tauri transparent window + backdrop-filter cannot see through to real wallpaper — confirmed open bug (tauri#12804, #12437, #10064). CSS blur only works on in-DOM content. | STACK.md:58-71 |
| D-07 | **Max 3 backdrop-filter elements active per viewport. Blur radius cap: glass-1=20px, glass-2=12px, glass-3=8px.** | GPU budget; integrated GPU cliff; dashboard first paint must be <=200ms | PITFALLS.md:P-01, STACK.md:588 |
| D-08 | **OpenClaw animation math applied verbatim to VoiceOrb. No deviation without A/B reason.** | Tuned values from shipped product: 0.12 scale multiplier, 0.06 speaking amplitude, 6Hz sine, 0.28 ring stagger, 0.45/0.55 EMA, 12fps audio throttle | PRIOR_ART.md:106-226 |
| D-09 | **Ghost Mode: `.content_protected(true)` in WebviewWindowBuilder at creation time. No cursor CSS inside ghost window.** | Creation-time-only (not post-show setter); cursor CSS leaks interactivity to screen-share viewers | PRIOR_ART.md:49-68, 380-382 |
| D-10 | **Ghost Mode response format locked: <=6-word headline, 1-2 bullets, <=60 chars/line. No markdown renderer needed.** | Cluely format endorsed by product owner; already applied to ghost_mode.rs system prompt | PRIOR_ART.md:31-45, 379-381 |
| D-11 | **QuickAsk -> Main bridge: invoke("quickask_submit") -> Rust pipelines conversation -> emit_to("main", "blade_quickask_bridged", { conversation_id }).** | Only correct pattern — bypassing Rust loses the conversation from SQLite history | ARCHITECTURE.md:360-370, PITFALLS.md:P-02 |
| D-12 | **Single `blade_prefs_v1` localStorage blob. `usePrefs()` hook reads once on mount.** | Current src.bak has 252 localStorage sites = potential 1.26s main-thread block on mount | PITFALLS.md:P-13 |
| D-13 | **`useTauriEvent(name, handler)` hook is the only permitted event subscription pattern. Raw `listen()` banned outside `lib/events/index.ts`.** | 43 inconsistent cleanup sites in current code cause listener leaks after route changes | PITFALLS.md:P-06, ARCHITECTURE.md:626-673 |
| D-14 | **`emit_to(window_label, event, payload)` for single-window events. `emit_all` only for cross-window signals.** | emit_all causes cross-window chat token contamination between QuickAsk and Main | PITFALLS.md:P-12, ARCHITECTURE.md:355-370 |
| D-15 | **No light theme. Single Liquid Glass dark treatment.** | One authentic aesthetic beats several mediocre ones | PROJECT.md:53 |
| D-16 | **Token compaction fires at token ratio > 0.65. Frontend shows "compacting..." indicator via blade_token_ratio event.** | OpenClaw gateway pattern; endorsed by user | PRIOR_ART.md:204-207 |

---

## MVP Scope — Conflict Resolution

**FEATURES.md recommended** keeping 12 of 18 surfaces in V1 and deferring Life OS, Dev Tools, DAG visualization, and Personality Mirror to V2+. [FEATURES.md:648-660]

**PROJECT.md locks all 18 surfaces as V1 Active scope.** [PROJECT.md:31-49]: "Every surface the user touches is coherent, Liquid-Glass-native, and wired end-to-end."

**SYNTHESIS DECISION: PROJECT.md wins. All 18 surface clusters ship in V1.**

This does not mean every sub-view within a cluster ships at full fidelity on day one. FEATURES.md's P2/P3 clusters (Agents, Knowledge, Life OS, Dev Tools, Body, Hive) are wired and routable in V1 — they may have skeleton states for low-priority sub-views. The constraint: no 404s, no dead routes, no orphan screens. The Polish pass (last phase) enforces this across all 18 clusters.

---

## Critical Build-Order Constraints

Non-negotiable ordering rules from ARCHITECTURE.md section 8 and PITFALLS.md.

```
[1] styles/tokens.css + design-system/primitives (8 components)
        |  all components depend on these
[2] lib/tauri/_base.ts + lib/events/index.ts + useTauriEvent hook
        |  all wrappers depend on _base
[3] lib/tauri/config.ts + ConfigContext + lib/tauri/chat.ts
        |
[4] All 5 HTML files (index, quickask, overlay, hud, ghost_overlay) -- Day 1 Phase 1
        |
[5] Onboarding (gates entry; must ship before any AI surface is usable)
        |
[6] Main shell (TitleBar + Nav + CommandPalette + ToastContext + route registry)
        |
[7a] Dashboard + Chat ----------- [7b] Settings + QuickAsk bridge
        |
[8] Overlay windows: Voice Orb, Ghost, HUD (parallel -- each independent)
        |
[9] Feature clusters (any order; each adds lib/tauri/ wrappers as needed)
        |
[10] Polish pass (requires all routes to exist)
```

**Hard constraints:**
- Step [4]: 5 HTML files on Day 1. Three are missing; Rust crashes trying to open them. [PITFALLS.md:P-05, ARCHITECTURE.md:737]
- Step [2]: `useTauriEvent` hook before any component subscribes to events. [PITFALLS.md:P-06]
- GPU budget baked into tokens.css before any component is built. Retrofit is prohibitively expensive. [PITFALLS.md:P-01]
- QuickAsk bridge contract documented before Phase 1 ends (requires reading src.bak/quickask.tsx). [PITFALLS.md:P-02, P-11]

---

## Critical Pitfalls — Phase Guardrails

5 Critical-severity pitfalls that must appear as explicit phase gate checks:

### P-01: GPU Budget Collapse (Foundation)
Max 3 `backdrop-filter` per viewport. Chat message bubbles use rgba solids, not blur. Measure: dashboard first paint <=200ms on integrated GPU via `about:tracing`. [PITFALLS.md:P-01]

### P-02: QuickAsk -> Main Bridge Undocumented (Pre-Rebuild Audit)
Read `src.bak/src/quickask.tsx` before Phase 1. Write bridge contract explicitly. Test: submit in QuickAsk -> conversation appears in main window history drawer. [PITFALLS.md:P-02]

### P-03: Route Migration Ledger (Foundation)
Create `.planning/migration-ledger.md` tracking every route: old_name -> new_component -> phase. Includes every backend event or command palette entry referencing that route. Do not remove old routes until new component ships AND all cross-route references updated. [PITFALLS.md:P-03]

### P-04: Typed Wrapper Argument Casing (Foundation)
Invoke arg keys must be snake_case (Rust param names). TS function names are camelCase. Every wrapper cites `file.rs:function_name` in JSDoc. Smoke-test each wrapper in dev with Rust-side logging. [PITFALLS.md:P-04]

### P-05: Three Missing HTML Files (Foundation Day 1)
`overlay.html`, `hud.html`, `ghost_overlay.html` -- create all three on Day 1. Add CI check: Vite inputs must match actual HTML files on disk. [PITFALLS.md:P-05, P-18]

### P-06: Event Listener Leaks (Foundation)
`useTauriEvent` hook built before any component is written. Navigate Chat->Dashboard x5; verify exactly 1 `chat_token` consumed per backend token event. [PITFALLS.md:P-06]

---

## User-Research-Derived Choices (PRIOR_ART.md overrides generics)

Product-owner-endorsed constants. Do not change without explicit A/B evidence.

### VoiceOrb -- OpenClaw Math (exact constants)
```
Listening scale:  1 + (micVolume * 0.12)
Speaking scale:   1 + 0.06 * sin(t * 6)   // 6 Hz, range 0.94-1.06
Ring stagger:     0.28 cycle offset per ring (3 rings)
EMA smoothing:    0.45 * prev + 0.55 * current
Audio throttle:   12fps (83ms interval) -- separate from 60fps render loop
Thinking arcs:    arc1 trim(0.08, 0.26) +42deg/s @ 0.88 opacity
                  arc2 trim(0.62, 0.86) -35deg/s @ 0.70 opacity
Render loop:      requestAnimationFrame (16ms target), NOT setInterval
```
[PRIOR_ART.md:106-226]

**Conflict note:** FEATURES.md says "CSS-only animation engine." PRIOR_ART.md specifies requestAnimationFrame. RESOLUTION: rAF drives the ring animation (sets CSS custom properties at 60fps); 12fps interval is the audio level sampling only. CSS animations read the custom properties. Both are satisfied.

### Ghost Mode -- Cluely Format (exact)
- <=6-word headline as `<h3>`
- 1-2 bullets as plain `<ul>`, <=15 words each, <=60 chars/line
- No cursor CSS on any ghost overlay element (no `cursor: pointer`, `cursor: text`)
- Confidence gate: 50%+ before firing
- Last 10-15 words of transcript is the detection window (not full context)
- Zoom caveat: ghost overlay IS visible in Zoom screen share on macOS -- document in settings tooltip
[PRIOR_ART.md:28-83]

### Audio Pipeline -- VAD Required (not optional)
5-second fixed chunks produce 4-second-stale context and always-on STT cost. Pluely VAD config:
```
sensitivity_rms=0.012, peak_threshold=0.035,
silence_chunks=45, min_speech_chunks=7, pre_speech_chunks=12
Pre-roll: 0.27s before detected speech onset
```
Speaker extraction delay: 120s minimum (Omi -- early audio corrupts embeddings).
[PRIOR_ART.md:411-418, 273-274]

### Missing Events to Add to Rust
```
blade_message_start   -- add if missing
blade_thinking_chunk  -- add for Claude 3.5+ reasoning stream
blade_agent_event     -- add for swarm step events
blade_token_ratio     -- add to commands.rs; fires when ratio > 0.65
```
Keep existing: `blade_stream_chunk`, `blade_stream_done`, `blade_tool_result`
[PRIOR_ART.md:209-217]

### Bounded Queues (Omi pattern)
Hot-path audio queues must be bounded deque(maxlen=N). Unbounded queues cause memory growth in long meetings. [PRIOR_ART.md:268-271]

---

## Backend Wiring Gaps

Concrete list of backend items that must be added or fixed during the Skin rebuild (backend is "mutable for wiring gaps only" per PROJECT.md:57):

| Gap | Rust Location | Frontend Surface | Action |
|-----|---------------|------------------|--------|
| overlay.html, hud.html, ghost_overlay.html missing | lib.rs:349, overlay_manager.rs:76, ghost_mode.rs:472 | Voice Orb, HUD, Ghost | Create 3 HTML files + Vite inputs + bootstrap TSX |
| quickask_submit command (bridge) | commands.rs -- undocumented | QuickAsk -> Main | Implement or document; must emit blade_quickask_bridged with conversation_id |
| Hormone bus event stream | homeostasis.rs -- no UI emit today | Body Map, Dashboard ambient strip | Add app.emit_to("main", "hormone_update", state) on each cycle |
| blade_token_ratio event | commands.rs:send_message_stream | Chat "compacting..." indicator | Emit when token_count / context_window > 0.65 |
| blade_message_start event | commands.rs | Chat streaming start-of-message | Add emit before first token |
| blade_thinking_chunk event | commands.rs | Chat reasoning stream display | Add emit for Claude 3.5+ extended thinking tokens |
| blade_agent_event event | swarm.rs / agents/executor.rs | AgentDetail step trace | Add per-step emit with step_id, tool_name, status, result_preview |
| VAD in audio_timeline.rs | Not yet implemented | Ghost Mode, Voice Orb | Port Pluely run_vad_capture with VadConfig above |

[Sources: PROJECT.md:63-64, PRIOR_ART.md:405-418, ARCHITECTURE.md:910-924]

---

## Key Numbers

| Metric | Value | Applies To | Source |
|--------|-------|------------|--------|
| Dashboard first paint | <=200ms | Main window | PROJECT.md:74, PITFALLS.md:P-01 |
| Voice Orb frame rate | 60fps all 4 phase transitions | Overlay window | PROJECT.md:75 |
| Audio level UI throttle | 12fps (83ms interval) | VoiceOrb audio sampling | PRIOR_ART.md:135 |
| Text contrast minimum | 4.5:1 WCAG AA | All surfaces | PITFALLS.md:P-08 |
| Token ratio compaction trigger | 0.65 | Chat UI indicator | PRIOR_ART.md:204 |
| Ghost Mode confidence floor | 50% | Decision gate before LLM fire | PRIOR_ART.md:28 |
| Ghost Mode detection window | Last 10-15 words | Transcript analysis | PRIOR_ART.md:28 |
| Ghost card line width | <=60 chars | Card renderer CSS | PRIOR_ART.md:36-38 |
| Orb scale multiplier (listening) | 0.12 | CSS custom property | PRIOR_ART.md:106 |
| Orb speaking amplitude | 0.06 at 6Hz | CSS animation | PRIOR_ART.md:107 |
| Ring stagger offset | 0.28 cycle | Per-ring timing | PRIOR_ART.md:112 |
| EMA smoothing ratio | 0.45 prev / 0.55 current | Audio level display | PRIOR_ART.md:131 |
| Speaker extraction delay | 120s minimum | audio_timeline.rs | PRIOR_ART.md:273 |
| Pre-speech buffer | 0.27s pre-roll | VAD pipeline | PRIOR_ART.md:248 |
| Max backdrop-filter per viewport | 3 | All windows | PITFALLS.md:P-01 |
| Blur radius caps | 20px / 12px / 8px (tier 1/2/3) | CSS tokens | PITFALLS.md:P-01 |
| Approval button delay | 500ms before active | ToolApprovalDialog | PITFALLS.md:P-20 |
| localStorage reads on boot | <=10 startup-critical | usePrefs() hook | PITFALLS.md:P-13 |
| Glass opacity floor | >=0.55 on darkest tier | tokens.css | PITFALLS.md:P-08 |

---

## What We Are NOT Using

| Not Using | Reason | Use Instead |
|-----------|--------|-------------|
| shadcn/ui | Radix DOM constraints fight glass layout; token namespace conflict | Self-built 8 primitives in design-system/ |
| Framer Motion | 31 KB gzip; PROJECT.md prohibits; orb.css proves CSS sufficient | CSS @keyframes + transition + custom properties |
| TauRPC | Requires replacing 764 #[tauri::command] -- backend rewrite out of scope | Hand-written typed wrappers in src/lib/tauri/ |
| tauri-typegen | Immature (v0.4.0); fails on BLADE execute_batch! macro patterns | Same hand-written wrappers |
| Zustand / Jotai | No second cross-route state today; YAGNI | useChat() hook + lift-to-App + ConfigContext |
| React Router / Wouter | No URL needs; History API conflicts with Tauri | Custom registry in src/lib/router.ts |
| tauri-plugin-liquid-glass | Private API risk; macOS 26+ only | window-vibrancy crate (official Tauri ecosystem) |
| Radix UI headless | Same DOM structural constraints as shadcn; adds 10-15 KB gzip | Native dialog, details, aria-* attributes |
| emit_all for single-window events | Cross-window event contamination (P-12) | app.emit_to(window_label, event, payload) |
| Raw invoke() in components | 234 refactor traps; silent casing bugs (P-04) | invokeTyped() via lib/tauri/_base.ts |
| Raw listen() in components | Listener leaks on route change (P-06) | useTauriEvent(BLADE_EVENTS.X, handler) |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against live Tauri 2.10 docs; GitHub issues for known bugs |
| Features | HIGH | Grounded in 11 prototype HTML files + live backend source + named competitors |
| Architecture | HIGH | Based on live src/ audit (docs/architecture/ pair docs + lib.rs + App.tsx) |
| Pitfalls | HIGH | All 6 Critical pitfalls confirmed against live source with exact line references |
| Prior Art | HIGH | User-gathered from 8 primary research files; product owner explicitly endorsed OpenClaw math, Cluely format, content-protection approach |
| Backend Wiring Gaps | MEDIUM | Missing events inferred from gateway patterns; exact signatures need src-tauri/ verification during implementation |

**Overall: HIGH**

---

## Next Steps for Roadmapper -- Build-Order Punch List

**Phase 0 -- Pre-Rebuild Audit (no code, reading only)**
- Read src.bak/src/quickask.tsx -> document QuickAsk bridge contract
- Read src.bak/ for voice orb, event listener, onboarding patterns -> create RECOVERY_LOG.md
- Audit all emit_all calls in Rust codebase -> classify single-window vs cross-window

**Phase 1 -- Foundation**
- Day 1: Create overlay.html, hud.html, ghost_overlay.html + Vite inputs (P-05)
- styles/tokens.css: glass tiers (opacity floor >=0.55), radii, motion, type. Blur caps 20/12/8px. (P-01, P-08)
- design-system/primitives/: 8 components (Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog)
- lib/tauri/_base.ts + lib/events/index.ts + useTauriEvent hook (P-06)
- lib/tauri/config.ts + ConfigContext (D-04)
- Route registry (src/lib/router.ts) + RouteDefinition contract (D-05)
- Migration ledger (.planning/migration-ledger.md) for all 59 routes (P-03)
- usePrefs() hook -- single blob localStorage (P-13, D-12)
- Prod build verification: all 5 HTML files in dist/ (P-05, P-18, P-19)
- GPU budget test: dashboard first paint <=200ms on integrated GPU (P-01)
- WCAG 4.5:1 contrast test on 5 macOS wallpapers (P-08)
- Gate: useTauriEvent in place; 5 HTML files pass prod build; GPU budget confirmed

**Phase 2 -- Onboarding + Main Shell**
- Onboarding: 3 screens (ProviderPick -> ApiKeyEntry -> DeepScanReady); wire get_onboarding_status + complete_onboarding + deep_scan_*
- Main shell: TitleBar + Nav + CommandPalette (Cmd+K) + ToastContext + GlobalOverlays
- Gate: New user completes onboarding; main shell renders with nav working

**Phase 3 -- Dashboard + Chat + Settings (parallel workstreams)**
- Dashboard: RightNowHero (perception_fusion wire), HiveSignals, CalendarStrip, IntegrationsGrid
- Chat: streaming (blade_stream_chunk, blade_stream_done), tool call inline, ApprovalDialog (P-20: 500ms delay), history drawer
- Settings: provider key vault, routing grid, tab navigation, lib/tauri/config.ts writes
- Add blade_message_start and blade_token_ratio events to Rust during this phase
- Gate: Chat streams without re-render storm; Settings saves config; Dashboard shows live Right Now

**Phase 4 -- Overlay Windows (parallel)**
- QuickAsk: grouped results, streaming inline, voice mode, bridge (D-11); audit CJK shortcut (P-09)
- Voice Orb: 4-phase states, OpenClaw math verbatim (D-08), rAF render loop + 12fps audio throttle
- Ghost Mode: .content_protected(true) at creation, Cluely card format (D-09, D-10), Linux warning (P-16)
- HUD Bar: HTML entry, live-state dot, click-to-open-main
- Gate: QuickAsk bridge verified (conversation in main history); Ghost not visible in OBS on macOS

**Phase 5 -- Feature Clusters (parallel workstreams per cluster)**
- Agents, Knowledge, Life OS, Identity, Dev Tools, Admin, Body Visualization, Hive Mesh
- Each cluster: wire lib/tauri/ wrappers for its domain; register routes via feature index.ts
- Add missing Rust events (hormone bus, agent step events) as wiring gaps surface
- Gate: All 18 surface clusters routable with no 404s; no orphan screens

**Phase 6 -- Polish**
- Motion audit: all transitions use motion tokens; orb 60fps on target hardware
- Keyboard shortcuts: every surface has discoverable bindings
- Accessibility: WCAG 4.5:1 on all new surfaces; focus traps in dialogs
- Empty states + error boundaries on every route
- Cross-route consistency pass; final prod build verification
- Gate: Arnav review; all 18 clusters coherent end-to-end

---

## Research Flags

**Needs deeper research before phase planning:**
- Phase 5 Body visualization and Hive Mesh: no prior art for hormone bus UI or tentacle autonomy controls -- needs spike/sketch before planning
- Phase 4 QuickAsk bridge: must read src.bak before designing; HIGH-risk (P-02)

**Standard patterns (skip research-phase):**
- Phase 1 Foundation: Glass CSS, Vite multi-entry, useTauriEvent hook -- all documented in STACK.md and ARCHITECTURE.md
- Phase 2 Onboarding: 3 screens already prototyped; backend commands exist and documented
- Phase 3 Chat: streaming pattern clear; send_message_stream + token events fully documented
- Phase 6 Polish: WCAG, motion audit, error boundaries -- established patterns

---

## Sources

- PROJECT.md -- scope, constraints, out-of-scope, key decisions (HIGH)
- STACK.md (720 lines) -- Liquid Glass CSS, multi-window Tauri, typed wrapper, motion system (HIGH)
- FEATURES.md (700 lines) -- 18 surface clusters, table stakes, differentiators, anti-features (HIGH)
- ARCHITECTURE.md (943 lines) -- directory layout, route registry, window topology, state rules, design system boundary (HIGH)
- PITFALLS.md (603 lines) -- 20 pitfalls, 5 Critical tier, pitfall-to-phase mapping (HIGH)
- PRIOR_ART.md (441 lines) -- OpenClaw math, Cluely content protection + response format, Omi audio protocol, Pluely VAD config (HIGH -- user-gathered, product-owner-endorsed)

---

*Research synthesized: 2026-04-17*
*Ready for roadmap: yes*
*Source files committed together with this SUMMARY.md*
