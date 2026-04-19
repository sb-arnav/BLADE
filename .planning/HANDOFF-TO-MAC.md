# BLADE Mac Operator Handoff

**For:** Arnav's brother (running on macOS — finally a real desktop)
**Date:** 2026-04-19
**Branch:** master
**Status:** Phases 0–7 substrate fully shipped. Phase 8 Wave 1 done (wrappers + placeholders). Phase 8 Waves 2+3 and Phase 9 pending — can be resumed later with Claude after quota reset.

---

## TL;DR

You're running the first real test of the BLADE frontend rebuild. The project was built entirely blind on WSL (no desktop) because Arnav's laptop doesn't have the juice to run Tauri dev. Your job is to boot it, click through it, and report what breaks.

All the automated checks (TypeScript, 13 CI gates, headless Playwright specs) are green. What you're verifying is the stuff that only shows up with a real window: rendering, animations, 5 windows launching, shortcuts, content protection, notch positioning, 60fps orb, and the 50+ manual smoke items we've accumulated across all phases.

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

# 3. Install Node deps
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

# 13 CI gates (entries, no-raw-tauri, migration-ledger, emit-policy, contrast,
# chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust,
# feature-cluster-routes, phase6-rust, phase7-rust)
npm run verify:all
# Expect: all 13 "OK" lines

# Rust compile (this is the Phase 3 D-65 deferred cargo check + Phase 4 Plan 04-01 Rust)
cd src-tauri && cargo check 2>&1 | tail -20 && cd ..
# Expect: "Finished dev [unoptimized + debuginfo] target(s)"
# Warnings are OK; `error[E…]` is not

# Headless e2e (Phase 1 + 2 + 3 + 4 + 5 + 6 + 7 specs run against Vite dev)
npm run dev &
DEV_PID=$!
sleep 8
npm run test:e2e
kill $DEV_PID 2>/dev/null || true
# Expect: all specs pass (total ~25 specs)
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

## Manual Smoke Checklist

50 items across 7 phases. Work through them in order. Mark each `[x]` when verified, add a note for anything broken. When done, paste the whole list back.

### Phase 1 — Foundation (WCAG backstop) · 4 items

- [ ] **P1-1** (M-WCAG) Main window renders; open DevTools (Right-click → Inspect). In Console, look for `[perf] boot-to-first-paint: XXXms`. Target ≤200ms on integrated GPU. Record the number: ___
- [ ] **P1-2** Navigate to `/primitives` route. Open DevTools Application tab → Local Storage → set `blade_prefs_v1` to `{"app.lastRoute":"primitives"}` → reload. Screenshot over 5 wallpapers (Sonoma light/dark, Sequoia Iridescence, Monterey Hello, any bright). Save to `.planning/phases/01-foundation/wcag-screenshots/`. Eyeball legibility — any text look washed out on bright wallpapers?
- [ ] **P1-3** `npm run tauri build` — completes without error. Then `npm run verify:html-entries` — all 5 HTML files present in `dist/`.
- [ ] **P1-4** Confirm you can read t-1, t-2, and t-3 text classes clearly on glass-1, glass-2, and glass-3 backgrounds. (Phase 1 audit-contrast.mjs asserted ≥4.5:1 programmatically; this is the eyeball check.)

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

- [ ] **P5-1** `/agents` route renders without 404. AgentDashboard shows list (may be empty).
- [ ] **P5-2** Navigate to `/agent-detail` (via palette or deep link) → timeline appends entries live as agent runs.
- [ ] **P5-3** `/swarm-view` → DAG renders with nodes + edges (grid layout).
- [ ] **P5-4** `/knowledge-base` → 3-group search (Knowledge / Memory / Timeline columns).
- [ ] **P5-5** `/screen-timeline` → ≥1 thumbnail if Total Recall has captured anything (may be empty on fresh install).
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

### Phase 8 — Body + Hive (Wave 1 only — placeholders) · INCOMPLETE

Phase 8 Wave 1 shipped wrappers + 11 placeholders. Wave 2 (real routes) + Wave 3 (specs) are pending. You can navigate to these routes but they'll show placeholder GlassPanels, not real UI:
- `/body-map`, `/body-system-detail`, `/hormone-bus`, `/organ-registry`, `/dna`, `/world-model`
- `/hive-view`, `/tentacle-detail`, `/autonomy-controls`, `/approval-queue`, `/ai-delegate`

No verification needed here — just confirm the routes resolve without 404. Arnav will resume Phase 8 Wave 2+3 after quota reset.

---

## What You're Reporting Back

Paste back:
1. The `[perf] boot-to-first-paint` number from P1-1
2. The checklist with `[x]` for passes and notes for failures
3. Any Rust panics or stack traces
4. Any visual weirdness (glass looks wrong on some wallpaper, animation judders, etc.)
5. Screenshots from P1-2 (5 wallpapers)

If everything passes end-to-end: just say **"approved, ship it"** and Arnav will commit Phase 1–7 as fully complete in STATE.md.

---

## If the App Won't Boot

1. Copy the full terminal output from `npm run tauri dev`.
2. Run `cd src-tauri && cargo check 2>&1 | tail -30` and paste that too.
3. Check `~/Library/Logs/com.blade.app/` for any crash logs.
4. Send all three to Arnav.

Common boot failures and fixes are in `.planning/phases/04-overlay-windows/04-07-SUMMARY.md` §Troubleshooting.

---

## What's Shipped vs What's Pending

### Shipped (7.2 phases, ~120 commits)
- Phase 0 — Pre-Rebuild Audit (planning artifacts only, no code)
- Phase 1 — Foundation (9 plans, 36 commits): 5 HTML entries, design tokens, 9 primitives, typed Tauri base, BLADE_EVENTS + useTauriEvent, 82 route stubs, migration ledger, WIRE-08 refactor across 66 Rust files, 6 verify scripts + ESLint + Playwright
- Phase 2 — Onboarding + Shell (7 plans, ~20 commits): TitleBar, CommandPalette, NavRail, ToastContext, OnboardingFlow (Provider/Key/Scan/Persona), MainShell under 300 lines
- Phase 3 — Dashboard + Chat + Settings (7 plans, ~25 commits): Rust WIRE-01..06 events, ChatProvider with rAF-flushed streaming, ToolApprovalDialog (500ms delay), CompactingIndicator, Dashboard RightNowHero + AmbientStrip, Settings 10 panes
- Phase 4 — Overlay Windows (7 plans, ~20 commits): QuickAsk full bridge, Voice Orb 4-state + OpenClaw math, Ghost Mode ≤6-word headline, HUD 5-chip notch-aware, cross-window ChatProvider hoist
- Phase 5 — Agents + Knowledge (7 plans, ~25 commits): zero Rust, AgentDashboard/Detail/Team/BackgroundAgents, SwarmDAG (topological grid), AgentFactory/Timeline/TaskAgents/PixelWorld, KnowledgeBase (3-group) + KnowledgeGraph (polar layout), ScreenTimeline, RewindTimeline, MemoryPalace, LiveNotes, DailyLog, ConversationInsights, CodebaseExplorer
- Phase 6 — Life OS + Identity (7 plans, ~25 commits): zero Rust, Health/Finance/Goal/Habit/Meetings/SocialGraph/Predictions/EmotionalIntel/Accountability + Soul/Persona/CharacterBible/Negotiation/Reasoning/ContextEngine/Sidecar(Kali)
- Phase 7 — Dev Tools + Admin (7 plans, ~25 commits): zero Rust, Terminal/FileBrowser/GitPanel/Canvas/WorkflowBuilder/WebAutomation/EmailAssistant/DocumentGenerator/CodeSandbox/ComputerUse + Analytics/CapabilityReports/DecisionLog/SecurityDashboard/Temporal/Diagnostics/IntegrationStatus/McpSettings/ModelComparison/KeyVault
- Phase 8 Wave 1 (2 plans): body.ts + hive.ts wrappers, 11 placeholders, CSS bases

### Pending (Arnav resumes after quota reset)
- Phase 8 Wave 2 (plans 08-03 + 08-04): real bodies for 11 body/hive routes
- Phase 8 Wave 3 (plan 08-05): 4 Playwright specs + verify-phase8-rust-surface.sh + M-35..M-40
- Phase 9: Polish Pass — motion audit, a11y, empty states, error boundaries, skeletons, cross-route consistency, prod build verification, perf budget

### Stats
- 10 phases total, 7.2 complete
- 58 plans, 52 shipped
- ~120 atomic commits
- 13 CI verify gates (all green)
- ~50 manual smoke items this checklist covers

---

*This doc lives at `.planning/HANDOFF-TO-MAC.md`. Update it with your results and Arnav will commit.*
