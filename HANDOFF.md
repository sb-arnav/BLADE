# BLADE — Frontend Handoff

> You're building the UI for a local-first desktop AI agent. Backend (Rust, ~800 commands) is done. Your job is the frontend.

---

## 30-minute onboarding

1. `git clone` → `cd blade` → `npm install`
2. `npm run tauri dev` (macOS or Windows, **not WSL** — Tauri webview needs a display)
3. Window opens. Press **Ctrl+Space from anywhere on your OS** → QuickAsk pill appears. Type, hit Enter, watch it stream.
4. Read, in order:
   - this file (you're here)
   - `docs/apple-research/README.md` — the 10 design rules
   - `docs/apple-research/DESIGN_TOKENS.md` — copy-pasteable CSS + TS tokens
   - `src/components/QuickAsk.tsx` — **the reference pattern for every screen you build**
5. You're ready.

---

## Stack (and what it means for you)

| Tool | What you need to know |
|---|---|
| **Tauri 2** | Think Electron, but the "backend" is Rust and the app is native + fast. You talk to it via `invoke("command", args)` (RPC) and `listen("event", cb)` (pub/sub). |
| **React 19** | Strict mode. No class components. No JS files — TS only. |
| **Vite 6** | Dev on port 1420 (hardcoded in `src-tauri/tauri.conf.json`). Multi-entry: `index.html` (main window) + `quickask.html` (overlay). Add more entries here for new windows. |
| **Tailwind v4** | CSS-first config. No `tailwind.config.js`. `@theme { … }` lives in `src/index.css`. New tokens → add there. |
| **Lucide React** | The only icon set. Always `strokeWidth={1.75}`, always 1em. Never emoji, never mix icon sets. |
| **Framer Motion** | Not installed yet. Add only when a screen actually needs physics-based motion. CSS transitions cover 80% of cases. |

---

## What's already built (what you inherit)

```
src/
├── main.tsx              → App.tsx  (main window — currently foundation smoke test, replace it)
├── quickask.tsx          → components/QuickAsk.tsx  (Ctrl+Space overlay — DONE, reference pattern)
├── index.css             Tailwind v4 @import + @theme block
├── styles/tokens.css     ALL design tokens (color, radius, font, motion) — single source of truth
├── lib/
│   ├── tauri.ts          Typed invoke/listen wrappers (one place to verify every Rust call)
│   └── platform.ts       OS detection → :root[data-platform="macos"|"windows"|"linux"]
└── types/blade.ts        TypeScript types mirroring Rust structs

index.html                Main entry
quickask.html             Overlay entry
vite.config.ts            Multi-entry + port 1420 + CSP env
tsconfig.json             Strict TS with @/* alias for src/*
```

What's **NOT** in here (yet):
- Router / app shell
- State management (React context + useReducer is the default — don't reach for Zustand/Redux until you hit a real problem)
- Data fetching / caching layer (TanStack Query is fine to add if you need it)
- Tests (add them when the payoff is obvious — this isn't a test-first project)

---

## Your backlog — pages to build

Priority order (build top-down, but you can parallelize):

| # | Page | Gated on | Rough effort | What it proves |
|---|---|---|---|---|
| 1 | **Onboarding** | `get_onboarding_status()` returns false | 1–2 days | 5-question persona flow + deep-scan progress. Gates the whole app. |
| 2 | **Settings** | `get_config` / `set_config` / keyring | 2 days | Provider keys, task routing, shortcuts, wake word, timeline. Lots of surface, low design complexity. |
| 3 | **Main window home** | replaces `App.tsx` foundation | 1 day | App shell: sidebar + topbar + content router. |
| 4 | **Chat (full)** | `send_message_stream` + history commands | 3–4 days | Xcode 4-zone layout: conversation list / document / inspector / hive drawer. |
| 5 | **Hive dashboard** | `hive_get_status`, `hive_get_reports`, `hive_pending_decisions` event | 2–3 days | 11 Logic-Pro-style channel strips, approval queue, autonomy slider. |
| 6 | **Memory explorer** | `memory_palace_*`, `knowledge_graph_*`, `typed_memory_*` | 3 days | Palace + graph + timeline + typed facets. |
| 7 | **Screen Timeline** | `screen_timeline_*` | 2 days | Scrubbable screenshot history + semantic search. |
| 8 | **Body / Dashboard** | `body_get_map`, `homeostasis`, `immune_get_status` | 2 days | Hormone spectrograph, organ health. |
| 9 | **Meetings** | `meeting_*` | 1–2 days | List + action items + follow-ups. |
| 10 | **Agents & Swarms** | `agent_*`, `swarm_*` | 2 days | Spawn, monitor, cancel. Live `agent_step_*` events. |
| 11+ | People · Goals · Habits · Finance · Workflows · Ghost Mode · Evolution · HUD bar · … | various | — | See full inventory at bottom of this file. |

**Rough total:** 4–6 weeks for Tier 1 (#1–#5). Then backlog of smaller surfaces.

---

## The 10 rules (non-negotiable)

From `docs/apple-research/README.md`. These are not suggestions.

1. **No purple gradients.** Iridescent is reserved for active AI generation (bounded, edge-only, amplitude-reactive).
2. **No chat bubbles.** Conversation is a document (Notes/Journal pattern), not an iMessage stream.
3. **No custom loaders.** 2px indeterminate bar in the toolbar, or 16px system spinner. That's it.
4. **No centered "How can I help?" hero.** QuickAsk is a pill. Main window opens to last state.
5. **No drop shadows on pane edges.** Elevation = hairline + vibrancy. Shadows only on popovers (see `.popover-shadow` in tokens.css).
6. **Typography: 400/500/600/700 only**, with negative tracking at 22px+. `-0.015em` at 22px, `-0.022em` at 28px.
7. **Icons: Lucide at `strokeWidth={1.75}`, 1em size.** One set. No emoji. Ever.
8. **Theme is 3 variables only: base, accent, contrast.** Everything else derives in LCH.
9. **Density is a first-class setting** (compact 24 / regular 28 / spacious 32 px row height).
10. **Snappy is the house spring.** `{ duration: 0.25, bounce: 0.15 }`. Smooth (0.35, 0) only for overlay reveals.

---

## Rust ↔ Frontend — how to not hallucinate

Every backend call must be real. Before writing `invoke("x")` or `listen("x")`, **verify**:

### Find a command

```bash
# Is it registered?
grep -n "generate_handler!" -A 1000 src-tauri/src/lib.rs | grep "your_command"

# What's the signature?
grep -rn "pub async fn your_command\|pub fn your_command" src-tauri/src/
```

Then add it to `src/lib/tauri.ts` with a comment citing the file + line:

```ts
/** src-tauri/src/commands.rs:1899  fn get_config() -> BladeConfig  (api_key redacted) */
export const getConfig = () => invoke<BladeConfig>("get_config");
```

### Find an event

```bash
# Find all emits across the Rust codebase
grep -rn 'app.emit("your_event"' src-tauri/src/
grep -rn 'emit_all("your_event"' src-tauri/src/
```

The payload is whatever follows the event name:
- `app.emit("chat_token", "hello")` → JS payload is the string `"hello"`
- `app.emit("chat_done", ())` → JS payload is `null`
- `app.emit("chat_routing", json!({...}))` → JS payload is the JSON object

### If it doesn't exist

Don't fake it. Don't write a stub that "would work if the backend existed." Ping the owner. The Rust side can add commands quickly.

---

## Walk-through: building "Settings" end-to-end

Worked example you can follow for any new page.

### 1. Find the commands

```bash
grep -n "generate_handler!" -A 600 src-tauri/src/lib.rs | grep -iE "config|provider|shortcut|wake"
```

You'll find: `get_config`, `set_config`, `get_all_provider_keys`, `store_provider_key`, `switch_provider`, `test_provider`, `get_task_routing`, `set_task_routing`, `save_config_field`, `toggle_background_ai`, etc.

### 2. Add wrappers to `src/lib/tauri.ts`

Each with a file:line citation, typed inputs, typed outputs.

### 3. Extend `src/types/blade.ts`

If any command returns a struct you don't have — open the Rust file, find the struct, mirror the subset of fields you need. Keep it narrow.

### 4. Build the component

- Reference `QuickAsk.tsx` for style.
- Use tokens only (`bg-canvas`, `text-label`, `border-separator`).
- Lucide icons, 1.75 stroke.
- Keyboard-navigable (Tab order, Esc to close, Enter to save).
- No hard-coded strings for colors/fonts/spacing.

### 5. Verify

Before opening the PR, grep your own file and cross-check:

```bash
grep -n "invoke\|listen" src/components/Settings.tsx
# Then for each one, confirm the Rust source still has it.
```

### 6. PR checklist (paste into the description)

- [ ] `npm run build` passes
- [ ] Every `invoke()` cited to Rust file:line
- [ ] Every `listen()` cited to Rust emit site
- [ ] No raw hex colors; no raw pixel values outside tokens.css
- [ ] No Lucide alternatives, no emoji, no sparkle chrome
- [ ] Keyboard: Tab, Shift+Tab, Enter, Esc all behave
- [ ] Tested on at least one OS (macOS or Windows)

---

## Common gotchas

- **CSP blocks everything by default.** If you need to fetch an image or embed something external, update `src-tauri/tauri.conf.json` → `app.security.csp`. Don't weaken it globally.
- **`invoke()` args are positional-by-name.** `invoke("foo", { messages: [] })` maps to Rust `fn foo(messages: Vec<…>)`. Missing/extra keys silently fail with a cryptic error.
- **Event payloads can be `null`.** `app.emit("x", ())` from Rust → `event.payload === null` in JS. Don't blow up on that.
- **Window labels matter.** Main = `"main"`, overlay = `"quickask"`. Creating a new window? Add an entry in `vite.config.ts` AND in `src-tauri/src/lib.rs` where windows are built (line ~1275).
- **Transparent windows require platform flags.** QuickAsk uses `transparent(true)` + `macosPrivateApi: true` in `tauri.conf.json`. If you add another transparent window, keep both set.
- **Linux won't render vibrancy.** `backdrop-filter` degrades to opaque fill on WebKitGTK. Use a solid `bg-[rgba(20,20,22,0.92)]` + hairline fallback — don't ship broken glass.
- **`npm run tauri dev` auto-reloads on frontend changes but NOT Rust.** If Rust changes, restart dev.
- **Keyring never exposes API keys to the frontend.** `get_config` returns `api_key: "••••••••"`. Don't try to read the real value — use `test_provider` to verify a key works.

---

## PR / review flow

- Branch name: `feat/page-name` or `fix/what-it-fixes`
- One page (or one logical component) per PR
- Owner reviews. Feedback usually in 24h.
- Squash-merge to `master`. No force push to master.

---

## Where to ask

- **Blocked on a command that doesn't exist:** ping the owner.
- **Unsure about design:** re-read `docs/apple-research/` first; then ping.
- **Tauri weirdness:** https://v2.tauri.app/ docs are good; search GitHub issues under `tauri-apps/tauri`.
- **React 19 specifics:** React docs + "use" hook, Actions, Server Components are all irrelevant here (this is a client app) — ignore them.

---

## Full page inventory (for when Tier 1 is done)

Grouped by capability, not priority:

**Always-on surfaces:** HUD bar · QuickAsk (✓) · Ghost meeting overlay

**Tier 2 differentiators:** Body/Dashboard · Hive · Memory · Agents & Swarms

**Power surfaces:** Screen Timeline · Meetings · Workflows & Proactive · People & Relationships · Desktop Control · Skills/Tools/MCP/Plugins · Integrations · Voice & Perception

**Life-ops:** Goals/OKRs · Habits · Health · Finance · Research & Journal · Reasoning/Debate/Sandbox · Evolution & Self-Upgrade

**System:** Settings (✓ priority) · Onboarding (✓ priority) · Analytics/Dev console

Full detail with commands per page: look at prior Git history / ask the owner for the 23-section brief if needed.

---

**You have everything. Don't guess, don't fake, don't ship generic. Let's build something worth the name.**
