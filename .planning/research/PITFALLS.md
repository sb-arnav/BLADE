# Pitfalls Research

**Domain:** Multi-window Tauri desktop AI — nuke-and-rebuild React frontend with Liquid Glass aesthetic, wired to 764 Rust commands
**Researched:** 2026-04-17
**Confidence:** HIGH — grounded in live source audit of `src/`, `src-tauri/src/`, and `docs/architecture/`

---

## Critical Pitfalls

### P-01: `backdrop-filter` GPU Budget Collapse on Transparent Main Window

**Severity:** Critical

**What goes wrong:**
The main window is a transparent glass surface sitting directly on the user's wallpaper. Every `backdrop-filter: blur(...)` element composites a new GPU layer. With five translucent tiers (glass-1 → glass-3 + specular + chromatic dispersion), the compositor must re-blur every pixel underneath each layer independently. On an integrated GPU — the majority of the target user's hardware — this causes visible frame drops and fan spin on the dashboard first paint. Adding `backdrop-filter` to a scrolling message list (Chat panel) makes this dramatically worse because every scroll frame requires a full re-composite.

**Why it happens:**
The prototype CSS drives the design. Prototype screenshots look perfect because they're static PNGs rendered by a browser with GPU acceleration and no real content underneath. The production app has a live, animated wallpaper underneath three layers of blur, a streaming chat response with per-token updates, and animated orb states — all simultaneously.

**Warning signs:**
- Dashboard first paint exceeds 200ms (the stated performance budget)
- `about:tracing` in dev webview shows `CompositeLayers` exceeding 16ms per frame
- `chrome://gpu` reports software rendering fallback
- macOS Activity Monitor shows GPU usage above 40% at idle on the main window

**How to avoid:**
1. **Establish a GPU budget before writing any component.** Limit: maximum 3 `backdrop-filter` elements active in any viewport at once.
2. **Lock the blur radius per tier** to `--glass-1-blur: 20px`, `--glass-2-blur: 12px`, `--glass-3-blur: 8px` — never exceed these. Larger blurs don't look better and cost exponentially more.
3. **Do not apply `backdrop-filter` to anything that scrolls.** Chat message bubbles: use `background: var(--glass-2-bg)` (an rgba solid) not a blur. The wallpaper is already visible through the window chrome — content areas can be slightly opaque.
4. **Promote the static glass chrome to its own composite layer** with `will-change: transform` but only on elements that animate (Orb, title bar drag region). Static panels: no `will-change`.
5. **Implement a CPU-fallback path.** If `matchMedia('(prefers-reduced-motion: reduce)')` or a Tauri capability check shows integrated GPU, drop `backdrop-filter` from glass-2 and glass-3, keep only glass-1 on title bar.

**Phase to address:** Foundation (Phase 1) — bake the budget into design tokens before any component is built. Retrofit is catastrophically expensive.

---

### P-02: QuickAsk → Main Conversation Bridge Is Undocumented and Likely Broken

**Severity:** Critical

**What goes wrong:**
QuickAsk runs in a separate webview with no access to the main window's `useChat()` state (`src/App.tsx:211`). The architecture doc flags this explicitly: "How QuickAsk submissions get routed into the main conversation is **unclear**" (`docs/architecture/2026-04-17-blade-frontend-architecture.md`, Layer 3). If the rebuild implements QuickAsk as a standalone `invoke("send_message_stream")` caller, it creates a second conversation thread that never appears in the main chat history drawer. The user sees QuickAsk as broken, not "a separate thread."

**Why it happens:**
The src.bak implementation existed and presumably worked, but the bridge was never documented. A nuke-and-rebuild will lose this implicit contract. The rebuild dev will wire QuickAsk to send messages, get responses back, and call it done — without testing whether those messages appear in the main window's history.

**Warning signs:**
- QuickAsk shows a response but the main window's history drawer does not gain a new conversation entry
- Submitting in QuickAsk and then opening the main window shows an empty conversation list
- Backend event `chat_done` fires in the QuickAsk webview but the main window's `listen("chat_done")` does not fire

**How to avoid:**
1. **Before any rebuild begins**, read `src.bak/quickask.tsx` and trace exactly how it submits and whether it emits a Tauri event to the main window or relies on shared SQLite state.
2. **Design the bridge explicitly as a contract:** QuickAsk sends a message via the normal `send_message_stream` command (creating a real conversation in SQLite), then emits a custom Tauri event `"quickask_submitted"` with the conversation ID. The main window listens to `"quickask_submitted"` and optionally surfaces the thread.
3. **Write the bridge specification before Phase 2 (QuickAsk phase)** and get it reviewed. Do not discover it's broken in Phase 5.

**Phase to address:** Pre-Rebuild Audit (before Phase 1). The bridge contract must be documented before QuickAsk is reimplemented.

---

### P-03: Removing App.tsx Routes Before All Features Have Migrated

**Severity:** Critical

**What goes wrong:**
`App.tsx` has 59 routes. The rebuild replaces them phase by phase. If Phase 3 removes the old `App.tsx` route table before every component has a new home, any route that hasn't been rebuilt yet 404s silently — the discriminated-union router falls through to the Dashboard fallback. The user sees the Dashboard instead of an error, which masks the breakage. A backend event that pushes `openRoute("reports")` (`App.tsx:341`) will now silently land on Dashboard.

**Why it happens:**
Phase-by-phase delivery feels like progress. Each phase "finishes" a cluster of routes and removes them from the old monolith. But the old App.tsx has cross-route dependencies — event-driven `openRoute()` calls from backend pushes, command-palette entries that jump to specific routes — that aren't obvious from reading the route table.

**Warning signs:**
- `capability_gap_detected` backend event lands on Dashboard instead of the reports surface
- ⌘K command palette entries do nothing (open route silently resolves to Dashboard)
- Tray menu "open settings" lands on Dashboard

**How to avoid:**
1. **Maintain a migration ledger** in `.planning/` tracking every route's status: `old_name → new_component → phase_that_ships_it`. The ledger must include every backend event or command-palette entry that references the route.
2. **Do not remove old route entries from App.tsx until the new component is built AND all cross-route references have been updated.** Removal is the last act in a route's migration, not the first.
3. **Run a grep for `openRoute(` and `"open_settings_tab"` events** before each phase closes, to verify no unhandled references remain.

**Phase to address:** Foundation (Phase 1) — create the migration ledger. Enforce removal discipline in every subsequent phase.

---

### P-04: Typed Tauri Wrapper Drift — Rust snake_case vs TS Argument Keys

**Severity:** Critical

**What goes wrong:**
Tauri's `invoke()` in JS accepts an args object where **keys must match Rust parameter names exactly**, in snake_case. The architecture doc confirms: "Backend coupling: `invoke()` uses snake_case Rust names, React convention is camelCase — typed wrapper must preserve Rust names exactly." (`PROJECT.md`, Constraints). If the typed wrapper author writes `{ monitorIndex: 1 }` expecting Tauri to auto-convert, the command silently receives `None` for `monitor_index` and returns a default or error. 234 current raw invokes all have this risk. During typed-wrapper creation, the most common mistake is writing the argument in camelCase because that's what TypeScript linters suggest.

**Why it happens:**
Tauri v2 does NOT auto-camelCase argument keys (it does auto-camelCase the command name itself, but not parameter keys). New devs assume symmetry between command-name and argument-name transformation. The existing `src.bak` code has inconsistency — some invokes use `camelCase` args, some use `snake_case`.

**Warning signs:**
- A command returns its default value (empty array, empty string, `null`) even when backend data exists
- Rust receives `None` on an `Option<T>` parameter that the frontend passed
- `tauri::Error` log shows "Command parameter missing" but the JS side looks correct
- TypeScript passes type-check but the command silently fails at runtime

**How to avoid:**
1. **The typed wrapper file (`src/lib/tauri.ts`) MUST use a JSDoc comment or inline type annotation that cites the Rust function signature, parameter names, and file path.** Example:
   ```ts
   // Rust: src-tauri/src/system_control.rs:move_to_monitor(monitor_index: u32)
   export const moveToMonitor = (monitorIndex: number) =>
     invoke<void>("move_to_monitor", { monitor_index: monitorIndex });
   ```
2. **Enforce a linting rule:** in the typed wrapper, argument object keys must be snake_case. Any camelCase arg key in `src/lib/tauri.ts` is a bug.
3. **Write a smoke test for each wrapper** during Foundation: call the command with a known arg, verify the Rust side receives it (log at Rust entry point during dev).
4. **Generate wrappers from `body_registry.rs`** where possible — the registry enumerates commands and their parameter shapes, making auto-generation feasible.

**Phase to address:** Foundation (Phase 1) — the typed wrapper is a Phase 1 deliverable. The discipline must be established before any component writes its first `invoke`.

---

### P-05: Three Missing HTML Entries Causing Silent Runtime Crashes

**Severity:** Critical

**What goes wrong:**
`overlay.html`, `hud.html`, and `ghost_overlay.html` are missing. Vite's build succeeds (only a warning, not an error) because the inputs are declared but missing. At runtime, Rust calls `WebviewUrl::App("overlay.html")` from `lib.rs:349-366`, `WebviewUrl::App("hud.html")` from `overlay_manager.rs:76`, and `WebviewUrl::App("ghost_overlay.html")` from `ghost_mode.rs:472`. Each call panics or logs an error. If the rebuild replaces all five HTML files at once, these three will be forgotten again because they're not on any "visible route" — no user opens them from a UI button.

**Why it happens:**
These are non-main-window entries. They're created by background Rust logic (overlay manager startup, ghost mode activation, screen capture trigger) — not by user navigation. A route-focused rebuild naturally rebuilds the main window routes and misses these entirely.

**Warning signs:**
- Ghost mode toggle in settings produces no overlay
- HUD bar never appears despite `hive_start` succeeding
- Screen capture overlay never renders
- Rust logs show `"failed to create webview window"` or similar

**How to avoid:**
1. **Phase 1 checklist MUST include creating all 5 HTML files**, not just `index.html`. The three missing files should be the very first deliverable so they're never forgotten again.
2. **Add a CI check**: `vite.config.ts` declares 5 inputs; verify all 5 HTML files exist at build time.
3. Follow the `quickask.html` template — it's a 10-line file.

**Phase to address:** Foundation (Phase 1) — day one of the rebuild.

---

### P-06: 43 Inline Event Listeners Leaking on Route Change

**Severity:** Critical

**What goes wrong:**
There are 43 `listen(...)` call sites across `src/` (`docs/architecture/2026-04-17-blade-frontend-architecture.md`, Layer 5). Many are in `useEffect` blocks in components that mount and unmount on route change. If cleanup is inconsistent — some `useEffect` blocks return `unlisten.then(fn => fn())` and some don't (`docs/architecture/2026-04-17-blade-frontend-architecture.md`, "What's clearly broken or dead", item 5) — each route navigation leaves a dangling Tauri event subscriber in the webview's JS context. After navigating through 20 routes, there are 20+ duplicate listeners for events like `"blade_status"`, `"wake_word_detected"`, and `"chat_token"`. The chat token listener is the worst: each orphan listener appends tokens to its stale state, causing duplicate token rendering and state corruption.

**Why it happens:**
The Promise-based `listen()` API makes cleanup non-obvious. `listen()` returns `Promise<UnlistenFn>`. Developers write `listen("event", handler)` without capturing the return value. Even when they do capture it, `unlisten.then(fn => fn())` is syntactically awkward and easy to forget.

**Warning signs:**
- Chat messages render duplicate tokens after navigating away and back to chat
- `"blade_status"` toast appears twice for one backend event
- React DevTools shows `useEffect` cleanup warnings
- Long sessions accumulate degraded performance

**How to avoid:**
1. **Build `useTauriEvent(eventName, handler)` hook in Foundation**, before any component is written. The hook handles all Promise cleanup internally:
   ```ts
   export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
     useEffect(() => {
       const unlisten = listen<T>(event, (e) => handler(e.payload));
       return () => { unlisten.then(fn => fn()); };
     }, [event]); // handler should be stable (useCallback at callsite)
   }
   ```
2. **Ban raw `listen()` calls in components.** All event subscriptions go through `useTauriEvent`. Enforce via ESLint rule or PR review checklist.
3. **Consolidate the 43 App.tsx-level listeners** into a single `useAppEvents()` hook that mounts once and never unmounts (because App.tsx never unmounts).

**Phase to address:** Foundation (Phase 1) — `useTauriEvent` is a primitive, not a feature.

---

### P-07: `useChat` Re-renders on Every Streaming Token

**Severity:** High

**What goes wrong:**
`useChat()` holds the messages array in React state. During a streaming response, the backend emits `chat_token` events at up to 50 tokens/second. Each token appends to the last message's content and calls `setState(...)`. Each `setState` triggers a React reconciliation. If the message list is rendered with `MessageList.tsx` (containing markdown + syntax highlight + mermaid), every token re-renders every message in the list. At 50 messages of conversation history + 50 tokens/second, React is re-rendering the entire message list 50 times per second. Even with `React.memo`, each `Message` component will re-render if its props change (and the last message's content is changing).

**Why it happens:**
Streaming is append-only at the tail. Only the last message changes. But without careful memoization, the entire list re-renders. `highlight.js` and mermaid are synchronous parsers — running them on each token event is CPU-prohibitive.

**Warning signs:**
- React DevTools profiler shows >100ms renders during streaming
- UI drops frames during token stream
- Syntax highlighting flickers per-token (new highlight.js run on each)
- Mermaid diagrams re-render mid-stream

**How to avoid:**
1. **Split `StreamingMessage` from `HistoryMessage`.** The streaming tail is a separate uncontrolled component that appends to a DOM ref directly (`textContent += token`) — no React state, no re-render. When `chat_done` fires, swap the ref-driven tail for a final React-rendered message.
2. **Defer markdown/highlight parsing.** Parse markdown only on `chat_done`, never on `chat_token`. During streaming, render raw text in a `<pre>` or plain `<p>`.
3. **Memoize `MessageList` items** with `React.memo` keyed on message ID + version number (incremented only on edit/completion, not on streaming).
4. **Batch token state updates** if direct DOM ref approach is not used: collect tokens in a ref, flush to state at 60fps with `requestAnimationFrame`.

**Phase to address:** Chat phase — but the streaming message pattern must be decided in Foundation so it doesn't get built wrong.

---

### P-08: Liquid Glass Chromatic Dispersion Breaking WCAG Contrast

**Severity:** High

**What goes wrong:**
Chromatic dispersion (the RGB split glow around glass edges) and specular highlights are decorative. Underneath them, text sits on a glass surface that may have 0-opacity floor — meaning pure wallpaper shows through. A user with a bright or busy wallpaper (white photo background, tiled pattern) will have white text on white background or black text lost in a dark photo. The glass material specification needs a minimum luminance floor that survives all wallpaper colors.

**Why it happens:**
The prototypes in `docs/design/` were tested on one specific dark wallpaper chosen by the designer. The production app runs on every wallpaper the user has. macOS Liquid Glass (system vibrancy) handles this automatically via adaptive blending — a pure CSS implementation must handle it manually.

**Warning signs:**
- Text contrast ratio below 4.5:1 when tested against white, gray, and light-photo wallpapers
- Specular highlights (white) invisible against a white wallpaper
- Dark vibrancy fallback (`prefers-color-scheme: light`) not implemented

**How to avoid:**
1. **The opacity floor on every glass tier must be at least 40% of the background dark color.** `--glass-1-bg: rgba(20, 20, 24, 0.65)` — not below 0.55 on the darkest tier.
2. **Test against the 5 macOS wallpaper defaults** (light, dark, one white abstract, one light photo) as part of the Foundation design token audit.
3. **For the main window**, implement a luminance detection pass: on window focus, sample the wallpaper region via a canvas trick (if available) or fall back to a slightly more opaque glass tier.
4. **Specular highlights** must use `mix-blend-mode: overlay` not pure white — overlay adapts to the background luminance.

**Phase to address:** Foundation (Phase 1) — baked into design tokens. Per-surface verification in Polish pass.

---

### P-09: Global Shortcut Conflict with OS-Level IME (Ctrl+Space)

**Severity:** High

**What goes wrong:**
QuickAsk is toggled by global shortcut (confirmed in `src-tauri/src/lib.rs:274`). The default is almost certainly `Ctrl+Space`. On macOS, `Ctrl+Space` is the default IME (input method) switcher for users with CJK keyboards enabled. On Linux, it is often used by Fcitx, IBus, and other input method frameworks. Registering `Ctrl+Space` as a global shortcut via Tauri will either fail silently or conflict with IME switching, breaking CJK text input system-wide when BLADE is running.

**Why it happens:**
The shortcut works for the developer (English keyboard, no IME). It's never tested with a CJK locale.

**Warning signs:**
- `register_global_shortcut` returns an error in the Tauri log on CJK locale machines
- Japanese, Chinese, or Korean users report they can't switch input methods
- QuickAsk doesn't open on some machines despite the shortcut appearing correct

**How to avoid:**
1. **Audit the current default shortcut.** If it is `Ctrl+Space`, change the default to `Cmd+Shift+Space` (macOS) / `Alt+Space` (Windows/Linux) — both are unoccupied by IME on most locales.
2. **Make the shortcut user-configurable** in Settings (a dedicated "QuickAsk shortcut" field, not a raw string input — use a shortcut recorder).
3. **Register with fallback:** if the preferred shortcut registration fails, log a warning and fall back to an alternative.

**Phase to address:** QuickAsk phase — but the shortcut must be audited before shipping.

---

### P-10: Transparent Window Click-Through on Fully Transparent Regions

**Severity:** High

**What goes wrong:**
Windows and Linux treat fully transparent regions of a `decorations: false, transparent: true` window as click-through — mouse events pass through to the app below. This is correct behavior for the ghost overlay and HUD. But the main window's transparent chrome (the gap between the glass panels and the window edge) will also be click-through, which means clicking on the wallpaper visible through the main window's padding will unexpectedly focus whatever app is underneath BLADE. On macOS, this behavior is handled differently — transparent regions are still part of the window's hit target unless `setIgnoreCursorEvents` is called.

**Why it happens:**
The main window uses `transparent: true`. The CSS glassmorphic layout leaves visible padding around panels. Windows/Linux will make those padding regions passthrough without explicit configuration.

**Warning signs:**
- Clicking in the gutter between glass panels focuses the app behind BLADE
- Drag-to-move the window only works on the glass panels, not the full window chrome
- On Windows: window loses focus when user clicks near the edge

**How to avoid:**
1. **Define explicit drag regions** via Tauri's `data-tauri-drag-region` attribute on the title bar only. Do not make the entire window chrome a drag target.
2. **On Windows/Linux**, ensure the padding regions have a minimal background color (even `rgba(0,0,0,0.01)`) rather than pure transparent — this keeps them in the hit target.
3. **Ghost overlay and HUD**: these should use `setIgnoreCursorEvents(true)` explicitly on the Rust side when the overlay is in passive mode.

**Phase to address:** Foundation (Phase 1) for the main window. Overlay/HUD/Ghost phases for their respective windows.

---

### P-11: Stranded `src.bak/` Knowledge Nobody Consults

**Severity:** High

**What goes wrong:**
`src.bak/` is a 5.2M mirror of the pre-rebuild frontend. It contains the working implementation of: QuickAsk → main bridge, 43 event listeners with working cleanup, voice orb state machine, ghost mode CSS, onboarding flow backend wiring, and 234 raw invoke patterns that (mostly) work despite being stringly-typed. If rebuilding devs don't consult `src.bak/` before implementing a feature, they will rediscover the same undocumented contracts from scratch — or worse, get them slightly wrong.

The project doc says `src.bak/` is "read-only reference. If any recovered pattern helps, we copy it forward and cite it." But without a structured audit, this doesn't happen in practice.

**Why it happens:**
`src.bak/` is out of sight (not in the main `src/` tree). The rebuild is framed as a clean slate, psychologically discouraging reference to the old code.

**Warning signs:**
- A feature gets rebuilt and then breaks in a way the old code handled
- Post-phase review reveals that the same bug exists in `src.bak/` and the fix is there
- Developer invents a new pattern for something that `src.bak/` already solved correctly

**How to avoid:**
1. **Before each phase**, add a mandatory step: grep `src.bak/` for the relevant component file and read it. Document what the old implementation did, extract any implicit contracts, and carry forward the good parts. Note: `src.bak/` is flat — files live at `src.bak/<name>.tsx` (e.g., `src.bak/quickask.tsx`), not under a `src.bak/src/` subdir.
2. **Create a `src.bak/RECOVERY_LOG.md`** (or a section in the planning doc) that lists every pattern/contract recovered from `src.bak/`, with the target phase that should apply it.
3. **The QuickAsk bridge, event listener patterns, and voice orb state machine** are the three highest-risk items — do the `src.bak/` read on these explicitly before building.

**Phase to address:** Pre-Rebuild Audit — systematic `src.bak/` pass before Phase 1.

---

### P-12: State Divergence Between Windows via `emit_all`

**Severity:** High

**What goes wrong:**
The backend broadcasts events via `app.emit_all("event_name", payload)` — confirmed for `blade_status`, `chat_token`, `wake_word_detected`, and others (`docs/architecture/2026-04-17-blade-frontend-architecture.md`, 29 event types). `emit_all` delivers to every open webview — main window, QuickAsk, overlay, HUD, ghost overlay. If QuickAsk listens to `"chat_token"` (it should — for streaming its own responses), and the main window is also streaming, both windows may be updating their own message state from the same event stream. The windows will diverge: QuickAsk shows tokens from a main-window conversation; main window shows tokens from a QuickAsk conversation.

**Why it happens:**
`emit_all` is the easiest Tauri emit — devs reach for it by default. The multi-window architecture makes this a cross-window contamination vector.

**Warning signs:**
- QuickAsk shows tokens from a conversation the user didn't start in QuickAsk
- Main window chat shows tokens from a QuickAsk submission
- Two simultaneous streaming events corrupt each other's display

**How to avoid:**
1. **Use `app.emit_to("main", event, payload)` for main-window-targeted events.** Only use `emit_all` for truly cross-window signals (e.g., `"config_updated"`, `"theme_changed"`).
2. **Include a `window_id` or `conversation_id` field in every streaming event payload.** Each window filters events by whether the conversation ID matches one it owns.
3. **Audit every `app.emit_all()` call in the Rust codebase** and classify: is this cross-window or single-window? Convert single-window emits to `emit_to`.

**Phase to address:** Foundation (Phase 1) — establish the event routing policy before any window beyond main is built. Revisit in QuickAsk phase.

---

### P-13: 252 localStorage Reads on Mount — All at Once

**Severity:** High

**What goes wrong:**
`src/` has 252 `localStorage` / `sessionStorage` access sites. In the current App.tsx monolith, many of these are in `useEffect` blocks that fire synchronously on mount. A complete app load triggers a large number of synchronous storage reads in the same tick. localStorage is synchronous and blocks the main thread. On some machines (particularly Windows with large storage), a single `localStorage.getItem` can take 1-5ms. 252 reads on mount = up to 1.26 seconds of main-thread blocking before first render.

**Why it happens:**
Each feature author adds localStorage persistence independently, using consistent patterns. Nobody audits the cumulative cost because each individual access is fast in isolation.

**Warning signs:**
- First render of the app is slow (>200ms) even with an empty conversation history
- Browser performance profile shows a wide synchronous block before the first paint
- Reducing the number of features loaded doesn't help (the cost is on mount, not per-feature)

**How to avoid:**
1. **Replace localStorage with a single serialized blob** keyed `blade_prefs_v1`. One read on mount, one write on change. Deserialize into in-memory state once.
2. **Defer non-critical state reads** to after first paint using `useEffect` (not the component body or useMemo).
3. **Audit the 252 sites in `src.bak/`** before rebuilding, classify as: startup-critical (must read before paint) vs. deferred (can read after first interaction). The rebuild should have ≤10 startup-critical reads.
4. **Set a hard limit in the Foundation phase**: no component reads localStorage in its render function or synchronous initialization. All reads go through a single `usePrefs()` hook that batches.

**Phase to address:** Foundation (Phase 1) — establish the `usePrefs()` hook. Polish pass verifies no regressions.

---

## Moderate Pitfalls

### P-14: Phase-by-Phase Delivery Creating Coupling That Later Phases Fight

**Severity:** Medium

**What goes wrong:**
Foundation ships glass tier design tokens optimized for the Dashboard surface. The Chat panel (later phase) needs a different glass opacity floor because it sits over wallpaper with message content on top, not over a dark panel. Backporting a token change to Foundation means every earlier component that used the original token must be re-tested.

Similarly, the Foundation typography scale (built for the Dashboard hero) may be too large for the dense Settings layout (later phase). By the time Settings is built, changing the type scale means touching every Phase 1, 2, 3 component.

**How to avoid:**
1. Before Foundation ships, design-review at least one late-stage surface (Settings, Agents cluster) to stress-test the token set against dense, information-heavy layouts.
2. Establish token naming that allows surface-specific overrides without breaking the system: `--glass-panel-bg` for regular panels, `--glass-chat-bg` for the chat surface — derived from base tiers but independently adjustable.
3. Schedule a "design system checkpoint" after Phase 3 (before any cluster work begins) to catch drift early.

**Phase to address:** Foundation (Phase 1) token design + Phase 3 checkpoint.

---

### P-15: Wake-Word False Triggers During Regular Keyboard Use

**Severity:** Medium

**What goes wrong:**
`wake_word.rs` runs always-on audio detection. False trigger rate depends on threshold tuning. On a developer's machine (quiet room, known mic), the threshold may be tuned correctly. On a user's machine (open-plan office, loud keyboard, noisy mic), false triggers will cause the voice orb to activate mid-typing. The orb's "listening" UI state must not be confused with the backend actually hot-miking — if the frontend shows "Listening" but the backend hasn't armed the mic, the user speaks into nothing.

**Warning signs:**
- Voice orb activates during fast typing sessions
- Backend emits `wake_word_detected` but `voice_conversation_listening` event never follows
- User reports "BLADE randomly activates"

**How to avoid:**
1. **Decouple the "show listening UI" from `wake_word_detected`.** The orb should only show "Listening" when the backend emits `voice_conversation_listening` — not on `wake_word_detected`. The wake word event means "wake word heard, beginning to arm mic" — there's a gap.
2. **Expose wake-word sensitivity as a user setting** (low/medium/high). Default to medium.
3. **Add a cooldown**: after a false trigger, suppress additional `wake_word_detected` events for 2 seconds. Implement in Rust, not the frontend.

**Phase to address:** Voice Orb phase.

---

### P-16: Ghost Overlay Not Actually Invisible to Screen Share on All Platforms

**Severity:** Medium

**What goes wrong:**
`ghost_mode.rs` calls `set_content_protection` (line 472). On macOS, this uses `NSWindow.sharingType = .none`, which excludes the window from screen capture — effective. On Windows, the equivalent is `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — effective on Windows 10 2004+. On Linux (X11), there is no equivalent API. On Wayland, screen capture protocol behavior varies by compositor. A user on Linux Wayland who uses Ghost Mode in a meeting may unknowingly share BLADE's ghost overlay with the other participants.

**Warning signs:**
- During testing on Linux, the ghost overlay appears in OBS or screen share capture
- Wayland compositor (GNOME/KDE) does not honor content protection

**How to avoid:**
1. **On Linux, warn the user** during Ghost Mode activation: "Content protection is not available on this platform. Ghost Mode overlay may be visible in screen share."
2. **Document the platform limitation** in the Ghost overlay UI component.
3. **Test content protection** on each platform in CI (via screenshot utility) as part of the Ghost phase.

**Phase to address:** Ghost Overlay phase.

---

### P-17: Design System Changing Mid-Rebuild Requiring Backport

**Severity:** Medium

**What goes wrong:**
Liquid Glass is a new Apple design language (released at WWDC 2025). Implementation patterns for CSS-based Liquid Glass are still being discovered by the web community. A design decision made in Foundation (e.g., how to implement specular highlight flicker on hover) will be invalidated when a better pattern is found during Phase 4. Backporting to earlier phases is expensive and demoralizing.

**How to avoid:**
1. **Treat design tokens and CSS primitives as versioned.** Any change to a token in `.planning/` or `src/styles/` that affects already-shipped components requires a brief backport audit.
2. **Limit "discovery" work to the Foundation phase.** If a new glass effect technique is found later, record it for the Polish pass — don't retrofit during feature delivery phases.
3. **The glass tier CSS must be tested against every shipped component surface** before any token change is merged.

**Phase to address:** Foundation (Phase 1) must explicitly "freeze" the glass implementation before Phase 2 begins.

---

### P-18: `vite.config.ts` Input Drift from Actual HTML Entries

**Severity:** Medium

**What goes wrong:**
`vite.config.ts` declares 5 inputs: `main`, `quickask`, `overlay`, `hud`, `ghost_overlay`. Currently 3 of the 5 HTML files are missing — Vite warns but doesn't fail. If the rebuild adds HTML entries without updating `vite.config.ts`, or removes an entry without updating Vite config, the build silently drops or adds bundles. CI smoke build uses `tsc --noEmit` + `cargo check` — neither validates Vite input/output alignment.

**Warning signs:**
- A new HTML entry is created but Vite's build does not generate a corresponding bundle
- `dist/` does not contain the expected `overlay.html` after a prod build
- Vite warns "Could not resolve input" in the build log

**How to avoid:**
1. **Add a pre-build validation script** (in `package.json` `prebuild` hook) that asserts: for every input in `vite.config.ts`, an HTML file exists at the declared path; and for every HTML file at the root that matches the window pattern, a Vite input exists.
2. **Checklist item in every phase PR** that creates or removes a window: verify `vite.config.ts` inputs are updated.

**Phase to address:** Foundation (Phase 1) — create the validation script. Verify in every subsequent window phase.

---

### P-19: Dev vs Prod URL Divergence — `devUrl` vs `frontendDist`

**Severity:** Medium

**What goes wrong:**
In dev mode, Tauri uses `devUrl: "http://localhost:1420"` — all windows serve from the same Vite dev server. In prod, each window has its own compiled `frontendDist` HTML. A window that works in dev because it shares the dev server's JS module graph may fail in prod because its compiled bundle has missing assets or incorrect base URLs.

**Why it happens:**
Dev mode is what developers use. Prod builds are only run for releases. A bug that only manifests in prod (e.g., a missing asset reference, an incorrect relative path in an HTML file) ships to users.

**Warning signs:**
- An overlay window shows correctly in `npm run tauri dev` but is blank after `npm run tauri build`
- Console error in prod: "Failed to load resource" for a JS chunk
- Ghost overlay or HUD shows in dev but white-screens in prod

**How to avoid:**
1. **Run a full prod build (`npm run tauri build`)** at the end of every phase before marking it done.
2. **Include prod build verification** in the CI smoke job, not just typecheck.
3. **Use root-relative asset paths** (`/assets/...`) not relative paths (`./assets/...`) in HTML entry files — relative paths break when the entry is served from a different base in prod.

**Phase to address:** Foundation (Phase 1) — establish the convention. Every phase should run a prod build before declaring completion.

---

### P-20: Accidental Tool Approval by Clicking Through an Approval Dialog

**Severity:** Medium

**What goes wrong:**
BLADE executes autonomous tools (bash commands, file writes, browser automation). The `ToolApprovalDialog.tsx` component requires user confirmation before executing. If the dialog appears while the user is mid-typing or mid-clicking on something else, they may click "Approve" accidentally because the dialog appeared under their cursor at the wrong moment. This is particularly dangerous for destructive tools: `rm -rf`, `browser_agent` form submission, file overwrite.

**Warning signs:**
- User reports "BLADE deleted a file I didn't approve"
- Dialog appears and disappears too quickly to be noticed
- Approve button is the default/primary action and is keyboard-reachable without tabbing

**How to avoid:**
1. **Add a 500ms delay** before the Approve button becomes active — a visible countdown ring on the button. This prevents accidental click-through.
2. **Never make Approve the default keyboard action.** The dialog must require explicit Tab + Enter or mouse click, not just Enter on focus.
3. **For destructive tools** (bash with `rm`, file delete, form submit to external URLs), require the user to type the command or file path to confirm — like GitHub's repo deletion modal.
4. **Log every approval** with timestamp and tool details. Surface in the DecisionLog view.

**Phase to address:** Chat phase (where tool approval dialogs first appear). Security audit pass verifies.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Raw `invoke()` instead of typed wrapper | Fast to write | 234 future refactor traps; silent argument drift; no central logging | Never in new code. Only during migration when the wrapper doesn't exist yet — must be tracked in migration ledger |
| `useState` per component for config | Simple, obvious | Config re-read on every mount; 252 localStorage reads accumulate | Never for shared config. OK for ephemeral local UI state |
| Inline Tailwind class sets instead of primitive components | Fast per-component | Visual drift; design-system changes touch 150+ files | Only in spike/prototype phase. Foundation phase must extract primitives |
| `emit_all` instead of `emit_to` | One API call | Cross-window event contamination; state divergence | Only for truly cross-window events (config changes, theme changes) |
| `backdrop-filter` on all glass tiers without GPU budget | Visually complete | CPU/GPU cliff on integrated hardware | Only for the topmost chrome tier. Content areas must use rgba solids |
| Skipping `src.bak/` audit | Feels like clean start | Re-inventing broken bridges; losing implicit contracts | Never. `src.bak/` audit is mandatory pre-Phase 1 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Tauri `invoke()` arg keys | Writing `{ monitorIndex: 1 }` | Write `{ monitor_index: 1 }` — Rust param names are snake_case, Tauri does NOT auto-convert arg keys |
| Tauri `listen()` cleanup | Ignoring the `Promise<UnlistenFn>` return | `const ul = listen(...); return () => { ul.then(fn => fn()); };` — always capture and clean up |
| Tauri `emit_all` | Broadcasting single-window events to all windows | Use `app.emit_to("main", event, payload)` for main-window events; reserve `emit_all` for global signals |
| Multi-window HTML entries | Creating a window in Rust without a corresponding HTML file | HTML file + Vite input + bootstrap TSX + Rust `WebviewWindowBuilder` — all four are required, all four at once |
| QuickAsk → main conversation | Calling `send_message_stream` independently | Route through a shared conversation ID mechanism; emit a cross-window event so main window can optionally surface the thread |
| `backdrop-filter` on Windows | CSS blur not rendering | Windows requires `background: rgba(...)` with non-zero alpha — pure `transparent` backgrounds disable compositor blending; ensure a minimum `rgba(0,0,0,0.01)` floor |
| Content protection on Linux | Assuming `set_content_protection` works | Linux/X11 has no equivalent API; warn the user explicitly |
| Global shortcuts | Registering IME-conflicting keys | Audit Tauri's `register_global_shortcut` return value; log failures; provide fallback shortcut |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `backdrop-filter` on chat message bubbles | Frame drops during scroll in long conversations | Use rgba background on message bubbles, not blur | >50 messages in view |
| `chat_token` triggering full message list re-render | Stutter during streaming; >100ms React render frames | Separate streaming tail (DOM ref) from history (React state) | >20 messages in history |
| 252 localStorage reads on mount | Slow app boot (>200ms) even before first API call | Single `blade_prefs_v1` blob; `usePrefs()` hook reads once | Day one, always |
| markdown + highlight.js + mermaid on each token | CPU spike per token; mermaid flicker | Parse only on `chat_done`; defer highlight to `requestIdleCallback` | Long code blocks in streaming response |
| 43 event listeners not cleaned up | Memory and CPU accumulate per navigation; duplicate events after 10+ route changes | `useTauriEvent` hook with mandatory cleanup | After 5-10 route changes in a session |
| `will-change: transform` on static elements | Excess GPU memory allocation | Only apply `will-change` to actively animated elements (Orb, toast) | Per-session GPU memory exhaustion on low-end machines |

---

## "Looks Done But Isn't" Checklist

- [ ] **QuickAsk:** Shows a response in the QuickAsk window — verify the conversation also appears in the main window's history drawer
- [ ] **Voice Orb "Listening" state:** Orb shows listening UI — verify `voice_conversation_listening` (not just `wake_word_detected`) drove the state change
- [ ] **Ghost Mode:** Ghost overlay is visible in dev — verify it is NOT visible in OBS/screen share capture on the target platform
- [ ] **Overlay/HUD/Ghost windows:** All three render in dev — run `npm run tauri build` and verify all three HTML files are in `dist/`
- [ ] **Typed wrapper:** `invoke("move_to_monitor", { monitor_index: 1 })` succeeds — verify in Rust logs that the parameter was received, not defaulted
- [ ] **Settings tab navigation:** Settings opens the correct subtab from the tray menu event `"open_settings_tab"` — the backend event must still route correctly after App.tsx is rebuilt
- [ ] **Tool approval:** ToolApprovalDialog appears before a bash command runs — verify it does NOT appear and immediately close (race condition) on fast machines
- [ ] **Event cleanup:** Navigate away from Chat and back 5 times — verify `chat_token` does not appear multiple times per backend token event
- [ ] **CI references old files:** After removing a component, verify `.github/workflows/build.yml` does not reference the removed file path

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| GPU budget collapse (P-01) | HIGH | Audit every `backdrop-filter` site; replace content-area blurs with rgba; may require redesign of glass tier 2 and 3 |
| QuickAsk bridge lost (P-02) | HIGH | Read `src.bak/` to recover the bridge; rewrite the contract; may require a backend event added to `ghost_mode.rs` or a new command |
| Route removed before feature migrated (P-03) | MEDIUM | Restore the route entry from `src.bak/`; add to migration ledger; build the replacement view before removing again |
| Typed wrapper argument casing bug (P-04) | LOW | grep for the wrapper call sites; fix the key casing; test the command with known args |
| Missing HTML entries (P-05) | LOW | Add the three 10-line HTML files; no component changes needed |
| Event listener leak (P-06) | MEDIUM | Audit all 43 listen sites; add cleanup to each; merge `useTauriEvent` hook |
| useChat re-render storm (P-07) | HIGH | Requires architectural change to streaming message component; affects Chat phase timeline |
| Contrast failure on bright wallpaper (P-08) | MEDIUM | Increase opacity floors in design tokens; re-test all glass surfaces |
| localStorage accumulation (P-13) | HIGH | Requires designing `usePrefs()` hook and migrating all 252 sites; touches every component |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P-01: GPU budget collapse | Foundation | Measure `about:tracing` on dashboard first paint; must be ≤200ms on integrated GPU |
| P-02: QuickAsk bridge undocumented | Pre-Rebuild Audit | Bridge contract written and reviewed before QuickAsk phase begins |
| P-03: Route removed before feature migrated | Foundation (migration ledger) | Ledger shows every route's status at each phase gate review |
| P-04: Typed wrapper arg casing | Foundation | Every wrapper in `src/lib/tauri.ts` is smoke-tested; Rust logs confirm arg received |
| P-05: Missing HTML entries | Foundation (Phase 1 day one) | `dist/` after prod build contains all 5 HTML files |
| P-06: Event listener leaks | Foundation (`useTauriEvent` hook) | Navigate Chat→Dashboard×5; exactly 1 `chat_token` event consumed per token |
| P-07: useChat re-render storm | Chat phase | React Profiler shows ≤16ms render during 50 token/sec streaming |
| P-08: Contrast failure | Foundation (token design) | WCAG 4.5:1 contrast ratio against 5 wallpaper variants |
| P-09: IME shortcut conflict | QuickAsk phase | Test on CJK locale; `register_global_shortcut` return value checked |
| P-10: Click-through transparent regions | Foundation (main window) | Click the gutter between glass panels; BLADE should retain focus |
| P-11: Stranded src.bak knowledge | Pre-Rebuild Audit | Recovery log exists in `.planning/` before Phase 1 |
| P-12: emit_all state divergence | Foundation (event routing policy) | QuickAsk open + main window streaming simultaneously; no cross-contamination |
| P-13: 252 localStorage reads | Foundation (`usePrefs()` hook) | Boot time measured before/after; `usePrefs()` hook covers all persistence |
| P-14: Design system coupling | Foundation + Phase 3 checkpoint | Settings surface stress-tested against Foundation tokens before cluster phases |
| P-15: Wake-word false triggers | Voice Orb phase | "Listening" state only shows on `voice_conversation_listening`, not `wake_word_detected` |
| P-16: Ghost overlay visible in screen share | Ghost Overlay phase | OBS capture test on macOS, Windows, Linux |
| P-17: Design system mid-rebuild churn | Foundation (freeze decision) | Glass tier CSS is tagged "frozen" before Phase 2; changes require backport audit |
| P-18: Vite input drift | Foundation (validation script) | `npm run build` fails if HTML/Vite input count mismatch |
| P-19: Dev vs prod divergence | Every phase | Each phase runs `npm run tauri build` before marking done |
| P-20: Accidental tool approval | Chat phase | 500ms delay on Approve button verified manually; destructive tools require typed confirmation |

---

## Sources

- Live codebase audit: `docs/architecture/2026-04-17-blade-frontend-architecture.md` (verified 2026-04-17)
- Live codebase audit: `docs/architecture/2026-04-16-blade-body-architecture-design.md`
- Known fragile areas: `.planning/codebase/CONCERNS.md` (verified 2026-04-17)
- Project scope and constraints: `.planning/PROJECT.md`
- Common Tauri mistakes: `blade/CLAUDE.md` (Common mistakes section)
- Tauri v2 multi-window behavior: known behavior from `src-tauri/src/lib.rs`, `overlay_manager.rs`, `ghost_mode.rs` (live source)
- Rust backend: `src-tauri/src/lib.rs:274` (QuickAsk shortcut), `lib.rs:349-366` (overlay creation), `overlay_manager.rs:76` (HUD), `ghost_mode.rs:472` (ghost overlay + content protection)
- Frontend state: `src/App.tsx:71` (route union), `src/App.tsx:211` (route state), `src/App.tsx:986-1078` (command palette), `src/hooks/useChat.ts` (chat state)

---
*Pitfalls research for: BLADE Skin Rebuild (multi-window Tauri + Liquid Glass + nuke-and-rebuild React frontend)*
*Researched: 2026-04-17*
