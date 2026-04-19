# BLADE Mac Operator Handoff

**For:** Arnav's brother (running on macOS — real desktop, real testing)
**Date:** 2026-04-18
**Branch:** master
**Status:** V1 substrate complete (Phases 0–9 all shipped, all automated gates green). Awaiting your Mac smoke to sign off 1.0.0 cutover.

---

## TL;DR

You're running the final pre-release smoke for the BLADE V1 Skin Rebuild. The entire substrate was built blind on WSL (no desktop, no real window) because Arnav's laptop can't run Tauri dev with any confidence. Your job is to boot it, click through it, and confirm the real-window behaviors.

All automated checks are green: TypeScript compile (0 errors), 18 CI gates, headless Playwright specs compile clean. What's left is the stuff that only shows up with a real macOS window: rendering, 60fps animations, 5 windows launching, native dialogs, content-protection, notch positioning, prefers-reduced-motion system toggle, macOS `.app` bundle, and 56 manual smoke items split across all 9 phases.

If every checkpoint passes end-to-end, you say **"approved, ship it"** and Arnav bumps to 1.0.0 + tags + runs the release workflow.

## Setup (one-time, ~15 min)

```bash
# 1. Clone
git clone <repo-url> ~/dev/blade
cd ~/dev/blade
git checkout master

# 2. Install Rust + cargo + system deps
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable

# macOS: libclang (fixes Phase 3 D-65 deferred cargo check)
brew install llvm@15
echo 'export LIBCLANG_PATH="/opt/homebrew/opt/llvm@15/lib"' >> ~/.zshrc  # or /usr/local on Intel
export LIBCLANG_PATH="/opt/homebrew/opt/llvm@15/lib"

# 3. Install Node deps + Playwright Chromium
npm install
npx playwright install chromium
```

## Pre-Flight Verification (~5 min, automated)

Run these in order. All should be green.

```bash
cd ~/dev/blade

# TypeScript compile check
npx tsc --noEmit
# Expect: exit 0, zero output

# 18 CI gates (14 pre-Phase-9 + 4 Phase-9 additions)
npm run verify:all
# Expect: all 18 "OK" lines

# Rust compile
cd src-tauri && cargo check 2>&1 | tail -20 && cd ..
# Expect: "Finished dev [unoptimized + debuginfo] target(s)"
# Warnings OK; `error[E…]` is not

# Headless e2e (all 30 specs across Phase 1..9)
npm run dev &
DEV_PID=$!
sleep 8
npm run test:e2e
kill $DEV_PID 2>/dev/null || true
# Expect: all specs pass (~30 specs)
```

If any of the above fail, **stop and paste the output to Arnav** before proceeding.

## The Real Test: `npm run tauri dev`

This is what WSL couldn't do. Boot the app:

```bash
# Wipe any stale config from prior sessions
rm -rf ~/Library/Application\ Support/BLADE/config.json 2>/dev/null

# First compile — 10–15 min on Mac
npm run tauri dev
```

All 5 windows should launch without Rust panic:
- **Main** (the big one with sidebar + routes)
- **QuickAsk** (hidden; Cmd+Option+Space to summon)
- **Voice Orb** (overlay window — phase states)
- **HUD bar** (always-on-top strip)
- **Ghost Mode** (hidden; activates on meeting detection)

If the app panics on boot, paste the terminal output to Arnav. Most likely cause: a missing HTML entry (shouldn't happen — all 5 HTML files are in the repo).

---

## Manual Smoke Checklist — All Phases

~56 items across 9 phases. Work through them in order. Mark each `[x]` when verified, add a note for anything broken. When done, paste the whole list back.

### Phase 1 — Foundation (WCAG backstop) · 4 items

- [ ] **P1-1** (M-WCAG) Main window renders; open DevTools (Right-click → Inspect). In Console, look for `[perf] boot-to-first-paint: XXXms`. Target ≤200ms on integrated GPU. Record the number: ___
- [ ] **P1-2** Navigate to `/primitives` route. Open DevTools Application tab → Local Storage → set `blade_prefs_v1` to `{"app.lastRoute":"primitives"}` → reload. Screenshot over 5 wallpapers (Sonoma light/dark, Sequoia Iridescence, Monterey Hello, any bright). Save to `.planning/phases/01-foundation/wcag-screenshots/`. Eyeball legibility — any text look washed out on bright wallpapers?
- [ ] **P1-3** `npm run tauri build` — completes without error. Then `npm run verify:html-entries` — all 5 HTML files present in `dist/`.
- [ ] **P1-4** Confirm you can read t-1, t-2, and t-3 text classes clearly on glass-1, glass-2, and glass-3 backgrounds. (Phase 1 `audit-contrast.mjs` asserted ≥4.5:1 programmatically; this is the eyeball check.)

### Phase 2 — Onboarding + Shell · 5 items

- [ ] **P2-1** Fresh boot with empty config → Provider Picker screen appears (not Dashboard).
- [ ] **P2-2** Select Anthropic → paste valid API key → Test & Continue → Deep Scan ring progresses → Persona step (5 questions) → Enter BLADE → Dashboard.
- [ ] **P2-3** Close app → reopen → boots straight to last route (no onboarding).
- [ ] **P2-4** Press `Cmd+K` → Command Palette opens. Type "settings" → Enter → Settings route. Press `Cmd+[` → back to Dashboard.
- [ ] **P2-5** Trigger a backend notification (or use DevTools: `window.__TAURI_INTERNALS__.invoke('emit_test_toast')` if exposed; otherwise skip or use clipboard monitor). Toast appears and auto-dismisses ≤7s.

### Phase 3 — Dashboard + Chat + Settings · 8 items

- [ ] **P3-1** Dashboard "Right Now" hero shows live perception data (app name, window title, or similar).
- [ ] **P3-2** Dashboard AmbientStrip reflects current hormone state (color shifts based on `hormone_update` event).
- [ ] **P3-3** Chat panel streams a response from Anthropic without App-level re-renders (open React DevTools Profiler — render time ≤16ms at 50 tok/sec is the automated SC; eyeball test = smooth).
- [ ] **P3-4** Chat message bubbles have no blur (they use rgba solid per D-70). Inspect element → confirm no `backdrop-filter` on `.chat-bubble`.
- [ ] **P3-5** Use a reasoning-capable model (Claude 4.7 Sonnet Thinking) → send a complex prompt → collapsible "Thinking" section appears before the response.
- [ ] **P3-6** Long conversation → "compacting…" indicator appears when token ratio > 0.65 (force by pasting a 30k-token doc).
- [ ] **P3-7** Settings → Providers → add a new provider key → save → quit app → relaunch → key persists.
- [ ] **P3-8** Dashboard first paint with chat panel open is still ≤200ms (Perf tool).

### Phase 4 — Overlay Windows · 13 items (M-01..M-13)

- [ ] **P4-1** `cd src-tauri && cargo check` returns 0 errors (covers Plan 04-01's deferred check).
- [ ] **P4-2** All 5 windows launch without Rust panic (main, quickask, overlay, hud, ghost_overlay).
- [ ] **P4-3** Press Cmd+Option+Space → QuickAsk pops up. Type "hello" → Cmd+Enter. Response streams in QuickAsk. After `chat_done` + 2s, QuickAsk auto-hides. Navigate to main `/chat` — the conversation is there (bridge worked).
- [ ] **P4-4** Add a CJK IME (Chinese/Japanese) → switch to it → press QuickAsk shortcut. Either QuickAsk opens OR a warning toast appears saying the shortcut fell back to Ctrl+Shift+Space. Both paths are valid.
- [ ] **P4-5** Voice Orb window (if visible — check if window label is "overlay") → transitions smoothly through Idle → Listening → Thinking → Speaking at 60fps. Use Activity Monitor → confirm GPU utilization <20%.
- [ ] **P4-6** Start QuickTime Player → New Screen Recording → record for 5s. Stop → playback. Ghost overlay card (if any) should be INVISIBLE in the recording. This is D-09 content protection.
- [ ] **P4-7** Windows screen capture test — SKIP (Mac only).
- [ ] **P4-8** Linux content-protection warning — SKIP (Mac only).
- [ ] **P4-9** HUD bar appears at top of screen. On notched MacBook, it sits 37px below the top edge (clears the notch).
- [ ] **P4-10** Right-click HUD bar → 4-item popover appears (Open Main, Open QuickAsk, Mute Notifications, Quit). Click "Open Main" → main window focuses.
- [ ] **P4-11** Drag Voice Orb to a corner → release → quit app → relaunch → orb appears in the same corner.
- [ ] **P4-12** Enable Wake Word in Settings → say "Hey BLADE" → Voice Orb phase transitions to Listening. Self-trigger protection: BLADE's own TTS playback does NOT wake itself (2s ignore window).
- [ ] **P4-13** Revoke mic permission in System Settings → press Voice Orb record. Instead of crash, a banner + Retry button appears.

### Phase 5 — Agents + Knowledge · 7 items (M-14..M-20)

- [ ] **P5-1** `/agents` route renders without 404. AgentDashboard shows list (may be empty → EmptyState CTA).
- [ ] **P5-2** Navigate to `/agent-detail` (via palette or deep link) → timeline appends entries live as agent runs.
- [ ] **P5-3** `/swarm-view` → DAG renders with nodes + edges (grid layout).
- [ ] **P5-4** `/knowledge-base` → 3-group search (Knowledge / Memory / Timeline columns).
- [ ] **P5-5** `/screen-timeline` → ≥1 thumbnail if Total Recall has captured anything (may be empty → EmptyState).
- [ ] **P5-6** `/knowledge-graph` → nodes render in polar layout (deterministic across reloads).
- [ ] **P5-7** `cargo check` still 0 errors.

### Phase 6 — Life OS + Identity · 7 items (M-21..M-27)

- [ ] **P6-1** `/health` route renders with streak chip and 5 stats.
- [ ] **P6-2** `/finance` route renders 4 KPIs + transactions + "Import CSV" button.
- [ ] **P6-3** Import a sample CSV → transactions appear → Auto-categorize runs.
- [ ] **P6-4** `/soul` renders state card + character Bible content.
- [ ] **P6-5** `/character` → thumbs-up a chat message → navigate to `/persona` → see updated trait (round-trip).
- [ ] **P6-6** Navigate all 16 Phase 6 routes via palette — each renders without 404.
- [ ] **P6-7** `cargo check` still 0 errors.

### Phase 7 — Dev Tools + Admin · 7 items (M-28..M-34)

- [ ] **P7-1** `/terminal` route renders with shell input. Type `echo hello` → Enter → "hello" output appears.
- [ ] **P7-2** `/file-browser` → tree + preview + indexed search works.
- [ ] **P7-3** `/workflow-builder` → list + CRUD + Run button on a workflow.
- [ ] **P7-4** `/web-automation` → browser agent loop starts; BROWSER_AGENT_STEP events populate the live trace.
- [ ] **P7-5** `/security-dashboard` → alerts + pentest danger gating (Pentest actions require Dialog confirmation).
- [ ] **P7-6** `/diagnostics` → supervisor-health-grid shows per-service status chips.
- [ ] **P7-7** Navigate all 21 Phase 7 routes (10 dev-tools + 11 admin) — each renders without 404.

### Phase 8 — Body + Hive · 6 items (M-35..M-40)

- [ ] **P8-1** (M-35) `/body-map` → 12-card system grid renders. Click "nervous" card → `/body-system-detail` activates with Modules / Vitals / Events tabs.
- [ ] **P8-2** (M-36) `/hormone-bus` → real-time feeds update at least one value on hormone_update event (wait ~5s). Four tabs (Levels / Trends / Circadian / Directives) all render.
- [ ] **P8-3** (M-37) `/organ-registry` → organ rows render + expand → capability list → autonomy slider. Set slider ≥ 4 → Dialog confirms before write (D-204 gate).
- [ ] **P8-4** (M-38) `/hive-mesh` → 10-tentacle grid renders. Click tentacle → `/tentacle-detail` shows recent reports. Click Dismiss on a pending decision → ApprovalQueue removes the row AND backend `hive_reject_decision` is invoked (Phase 9 Plan 09-01 backfill).
- [ ] **P8-5** (M-39) `/ai-delegate` → recent decisions render. Click 👍/👎 on a row → `delegate_feedback` fires (Phase 9 Plan 09-01 backfill); re-open page → feedback persisted (not in-memory-only).
- [ ] **P8-6** (M-40) `/dna` → 4 tabs (Identity / Goals / Patterns / Query). Identity tab: edit text → Save → `dna_set_identity` fires (Phase 9 Plan 09-01 backfill). Close + reopen app → edit persists.

### Phase 9 — Polish Pass · 6 items (M-41..M-46)

- [ ] **P9-1** (M-41 — SC-5 tight) Dashboard first paint ≤ 200ms on integrated GPU.
  1. `npm run tauri dev` launches.
  2. Chrome DevTools (right-click → Inspect) → Performance tab → record a navigation to `/dashboard`.
  3. Measure `navigation-start → first-contentful-paint`.
  4. Record number: ___ ms (target ≤ 200ms; CI budget is 250ms loose).
- [ ] **P9-2** (M-42 — SC-5 tight) Chat render ≤ 16ms at 50 tokens/sec.
  1. Navigate to `/chat`.
  2. Send a prompt that triggers streaming at ≥ 50 tok/sec.
  3. React DevTools Profiler → record → confirm max render time ≤ 16ms during stream.
  4. Flame graph shows NO full-tree re-renders (only the streaming bubble updates).
  5. Record max render time: ___ ms.
- [ ] **P9-3** (M-43 — SC-5) Agent timeline rAF stability, 5-minute continuous stream.
  1. Navigate to `/agent-detail` (requires an active agent — spawn one via palette → "Spawn background agent").
  2. Let it stream for 5 minutes. ~100+ events expected.
  3. Confirm scroll does not stutter; no dropped rAF callbacks in the console.
- [ ] **P9-4** (M-44 — SC-1 direct falsifier) Prod build bundle.
  1. `npm run tauri build` on macOS (takes 5-15 min).
  2. Confirm bundle at `src-tauri/target/release/bundle/macos/Blade.app` (or `.dmg`).
  3. Launch the bundle — confirm all 5 windows open without Rust panic.
  4. Navigate to /dashboard + /chat + /body-map + /hive-mesh + /world-model + /agent-detail — no 404 fallbacks; no orphan routes.
  5. Run `node scripts/verify-html-entries.mjs --prod` — passes.
- [ ] **P9-5** (M-45 — POL-07) prefers-reduced-motion system toggle.
  1. macOS System Settings → Accessibility → Display → **Reduce motion ON**.
  2. Launch app (or reload if already running).
  3. Confirm NO entrance animations on lists (list-entrance class honored).
  4. Confirm GlassSpinner does not spin (rotation frozen).
  5. Confirm no transitions visible longer than 0.01ms.
  6. Toggle **Reduce motion OFF** → animations resume.
- [ ] **P9-6** (M-46 — SC-4 direct falsifier) `⌘?` shortcut help panel.
  1. Launch app.
  2. Press `⌘?` (Cmd+Shift+?) — shortcut help panel opens.
  3. Confirm ALL global shortcuts render with labels: ⌘K, ⌘1, ⌘/, ⌘,, ⌘[, ⌘], ⌘?, Alt+Space.
  4. Confirm any route-scoped shortcuts (if declared on `RouteDefinition.shortcut`) also render.
  5. Press **Escape** — panel closes. Focus returns to NavRail (visible focus ring).
  6. Re-open panel, click a shortcut label — navigation triggers.

---

## What You're Reporting Back

Paste back:
1. The `[perf] boot-to-first-paint` number from P1-1 and the M-41/M-42 measurements from P9-1/P9-2
2. The full checklist with `[x]` for passes and notes for any failures
3. Any Rust panics or stack traces
4. Any visual weirdness (glass looks wrong on some wallpaper, animation judders, focus ring missing, etc.)
5. Screenshots from P1-2 (5 wallpapers)
6. Any failures of M-44 (Tauri bundle) — if `.app` launches, we're golden; if it panics, full stack trace

If everything passes end-to-end: just say **"approved, ship it"** and Arnav bumps to 1.0.0, moves CHANGELOG `[Unreleased]` → `[1.0.0]`, tags `v1.0.0`, and triggers the release workflow.

---

## If the App Won't Boot

1. Copy the full terminal output from `npm run tauri dev`.
2. Run `cd src-tauri && cargo check 2>&1 | tail -30` and paste that too.
3. Check `~/Library/Logs/com.blade.app/` for any crash logs.
4. Send all three to Arnav.

Common boot failures and fixes are in `.planning/phases/04-overlay-windows/04-07-SUMMARY.md` §Troubleshooting.

---

## Post-Approval Cutover Sequence (for Arnav, after you approve)

Per [D-227](./phases/09-polish/09-CONTEXT.md) — version bump is operator decision, NOT planner authority. Sequence after you approve:

1. Bump `package.json` `version` → `1.0.0`.
2. Bump `src-tauri/Cargo.toml` `version` → `1.0.0`.
3. Bump `src-tauri/tauri.conf.json` `version` → `1.0.0`.
4. Move `CHANGELOG.md` `[Unreleased]` → `[1.0.0] — YYYY-MM-DD`.
5. `git commit -m "chore: bump v1.0.0 — V1 shipped"`.
6. `git tag v1.0.0`.
7. `npm run release:prepare-updater` (if release pipeline wired).
8. Push tag + trigger GitHub Actions release workflow.

---

## What's Shipped (V1 Substrate Complete)

### Full phase inventory — 10 phases, all shipped in sandbox
- Phase 0 — Pre-Rebuild Audit (planning artifacts only, no code)
- Phase 1 — Foundation: 5 HTML entries, design tokens, 9 primitives, typed Tauri base, BLADE_EVENTS + useTauriEvent, 82 route stubs, migration ledger, WIRE-08 refactor across 66 Rust files, 6 verify scripts + ESLint + Playwright
- Phase 2 — Onboarding + Shell: TitleBar, CommandPalette, NavRail, ToastContext, OnboardingFlow (Provider/Key/Scan/Persona), MainShell under 220 LOC
- Phase 3 — Dashboard + Chat + Settings: Rust WIRE-01..06 events, ChatProvider with rAF-flushed streaming, ToolApprovalDialog (500ms delay), CompactingIndicator, Dashboard RightNowHero + AmbientStrip, Settings 10 panes
- Phase 4 — Overlay Windows: QuickAsk full bridge, Voice Orb 4-state + OpenClaw math, Ghost Mode ≤6-word headline, HUD 4-chip notch-aware, cross-window ChatProvider hoist
- Phase 5 — Agents + Knowledge: zero Rust, AgentDashboard/Detail/Team/BackgroundAgents, SwarmDAG, AgentFactory/Timeline/TaskAgents/PixelWorld, KnowledgeBase (3-group) + KnowledgeGraph (polar layout), ScreenTimeline, RewindTimeline, MemoryPalace, LiveNotes, DailyLog, ConversationInsights, CodebaseExplorer
- Phase 6 — Life OS + Identity: zero Rust, Health/Finance/Goal/Habit/Meetings/SocialGraph/Predictions/EmotionalIntel/Accountability + Soul/Persona/CharacterBible/Negotiation/Reasoning/ContextEngine/Sidecar(Kali)
- Phase 7 — Dev Tools + Admin: zero Rust, Terminal/FileBrowser/GitPanel/Canvas/WorkflowBuilder/WebAutomation/EmailAssistant/DocumentGenerator/CodeSandbox/ComputerUse + Analytics/CapabilityReports/DecisionLog/SecurityDashboard/Temporal/Diagnostics/IntegrationStatus/McpSettings/ModelComparison/KeyVault/Reports
- Phase 8 — Body + Hive: BodyMap/BodySystemDetail/HormoneBus/OrganRegistry/DNA/WorldModel + HiveMesh/TentacleDetail/AutonomyControls/ApprovalQueue/AiDelegate
- Phase 9 — Polish Pass: 3 primitives (ErrorBoundary, EmptyState, ListSkeleton), MainShell RouteSlot wrap, `prefers-reduced-motion`, a11y sweep, list-entrance class, `⌘?` help panel, 5 Playwright specs, 4 verify scripts, CHANGELOG.md, 3 Rust backfills (hive_reject_decision, dna_set_identity, delegate_feedback)

### Stats
- 10 phases complete (sandbox)
- ~60 plans across all phases
- ~165 atomic commits
- 18 CI verify gates (all green)
- 30+ Playwright specs (all tsc-clean; headless passes green)
- ~56 manual Mac-smoke items this checklist covers

---

*This doc lives at `.planning/HANDOFF-TO-MAC.md`. Update it with your results and Arnav will commit + bump to 1.0.0 on "approved, ship it".*
