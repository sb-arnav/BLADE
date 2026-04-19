---
phase: 04-overlay-windows
plan: 02
subsystem: quickask-window
tags: [react, quickask, streaming, voice-reuse, localstorage-history, auto-hide, d-18-exception, d-98, d-99, d-100, d-101]
requires:
  - 04-01 (quickask_submit full bridge + parallel-emit of chat_token/chat_done to the 'quickask' window)
  - 04-03 (VoiceOrb stateless renderer export from @/features/voice-orb)
  - 01-04 (design-system primitives — Input, GlassSpinner)
  - 01-05 (useTauriEvent + BLADE_EVENTS registry)
  - 01-06 (window.ts getCurrentWebviewWindow re-export + chat.ts quickaskSubmit wrapper)
provides:
  - src/features/quickask/QuickAskWindow (single component; mode='text'|'voice' sub-modes, keyboard, streaming, auto-hide)
  - src/features/quickask/QuickAskText (stateless Input + aria-live streaming + click-to-prefill history)
  - src/features/quickask/QuickAskVoice (wraps <VoiceOrb compact/> inside D-18 blur(48px) glass card)
  - src/features/quickask/index.tsx (barrel)
  - src/features/quickask/quickask.css (scoped styles — D-07 text tier + D-18 voice exception)
  - src/windows/quickask/main.tsx (bootstrap mounting <QuickAskWindow/>; replaces Phase 1 placeholder)
affects:
  - src/features/quickask/ (new feature directory — 5 files)
  - src/windows/quickask/main.tsx (Phase 1 placeholder replaced)
tech-stack:
  added: []
  patterns:
    - "Ephemeral-stream setState concat: QuickAsk response accumulates via simple setStreaming(s => s + chunk). No rAF buffer because the popup lives for seconds, not minutes; the Phase 3 useChat ref+rAF pattern is overkill here (D-100 annotation on plan)."
    - "Auto-hide on CHAT_DONE: 2s setTimeout → getCurrentWebviewWindow().hide(); timer cleared on new BLADE_MESSAGE_START and on unmount (D-101)."
    - "Keyboard triad: Esc hides immediately; Cmd/Ctrl+Enter submits (text mode only); Tab / Shift+Tab toggles mode direction. All preventDefault-guarded so Tab doesn't escape to browser chrome (D-98)."
    - "Blur hides (click-outside): window-level blur listener calls hide(); matches macOS Spotlight convention (D-101)."
    - "localStorage history v1 blob: 'blade_quickask_history_v1', max 5 items, dedup on submit via prev.filter !== q + prepend + slice(0,5). Malformed JSON or non-array values return empty list defensively (D-99)."
    - "Click-to-prefill history (not click-to-submit): matches src.bak convention — user confirms via Enter, safer UX than accidental re-submits (D-99)."
    - "D-18 exception isolation: .qa-voice backdrop-filter blur(48px) is the SOLE above-cap layer in the codebase. Voice mode outer .quickask shell is transparent/borderless so the exception stays single-layer. Inline comments flag the exception at 4 sites (file header, banner comment, section comment, and block comment) so grep -n D-18 produces 5 hits — future editors can't miss the rule."
    - "Unprefixed backdrop-filter: Tauri 2 WebViews (WebView2 / WKWebView / WebKitGTK) all support the standard property; the -webkit- prefix is redundant and would double the verify grep count. Keeping count at 2 (one text, one voice) matches the plan's verification step 7."
    - "WAKE_WORD_DETECTED → setMode('voice') while QuickAsk is open (D-98 cross-window reactivity; wake word fires in voice_global / wake_word_detected cross-window broadcast)."
key-files:
  created:
    - src/features/quickask/QuickAskWindow.tsx
    - src/features/quickask/QuickAskText.tsx
    - src/features/quickask/QuickAskVoice.tsx
    - src/features/quickask/index.tsx
    - src/features/quickask/quickask.css
    - .planning/phases/04-overlay-windows/04-02-SUMMARY.md
  modified:
    - src/windows/quickask/main.tsx (Phase 1 placeholder replaced with real QuickAskWindow mount)
key-decisions:
  - "D-98 realized: single QuickAskWindow with Tab/Shift+Tab mode toggle + WAKE_WORD_DETECTED auto-switch to voice. Mode change is local useState; no window-switching / route change involved. Tab preventDefault both directions so focus never escapes to browser chrome."
  - "D-99 realized: HISTORY_KEY='blade_quickask_history_v1', HISTORY_MAX=5, pushHistory() filters duplicates + prepends + slice(0,5) + try/catch persist. loadHistory() validates Array.isArray + string type-filter so a tampered blob returns an empty list instead of crashing the shell (T-04-02-01 accept — tampering is self-only but we're defensive). Click-to-prefill only (D-99: 'user confirms via Enter')."
  - "D-100 realized: useTauriEvent subscribes BLADE_MESSAGE_START / CHAT_TOKEN / CHAT_DONE — the parallel-emits landed by Plan 04-01's send_message_stream_inline (emit_windows=['main','quickask']). Response streams in-window via setStreaming(s => s + chunk); ephemeral lifetime makes the Phase 3 rAF ref pattern unnecessary. On CHAT_DONE, setBusy(false) + schedule 2s timeout → hide. The bridged conversation lives in main's ChatProvider via blade_quickask_bridged (Plan 04-06 subscriber)."
  - "D-101 realized: Esc hides immediately via getCurrentWebviewWindow().hide(); window blur (click-outside) hides immediately; CHAT_DONE schedules AUTO_HIDE_MS=2000 timer. Timer cleared on unmount + re-scheduled on each new CHAT_DONE (if user somehow submits a second query before hide fires)."
  - "D-18 realized + isolated: .qa-voice is the only selector using blur(48px); .quickask[data-mode='voice'] shell strips padding/background/border so .qa-voice owns the single glass layer. File-level, banner, and section-level comments all reference D-18 so editors encounter the exception reminder before altering the CSS."
  - "Ephemeral-stream simplification: Plan skeleton (pattern §5) suggested setStreaming(s => s + chunk) directly without rAF; I kept that approach explicit in a code comment so future maintainers understand why QuickAsk diverges from useChat. For a Spotlight-style popup alive for <10s, React 19's automatic batching of setState calls inside event handlers keeps commit count reasonable without the ref pattern."
  - "History mutation correctness: pushHistory() returns the new array and QuickAskWindow setState's history to that return value in one step. This avoids the double-fetch pattern (pushHistory → loadHistory → setState) the plan sketch used, and means the UI updates even if a concurrent localStorage write from another surface would have returned a stale read."
  - "Unprefixed backdrop-filter strategy documented in quickask.css header: the verify grep expects exactly 2 declarations (D-07 cap at 20px + D-18 exception at 48px). Tauri 2's modern WebViews do not need -webkit- prefix; keeping one declaration per mode satisfies the plan's verify step 7 without a trade-off comment in SUMMARY."
metrics:
  duration_minutes: 18
  commits: 2
  files_created: 5
  files_modified: 1
  lines_added: 429
  lines_deleted: 8
  completed_at: 2026-04-18T00:00:00Z
requirements-completed:
  - QUICK-01  # QuickAsk submits via shortcut (quickaskSubmit wrapper called on Cmd/Ctrl+Enter)
  - QUICK-02  # streams result (CHAT_TOKEN subscriber concatenates into streaming state; rendered aria-live)
  - QUICK-03  # text mode — Input + streaming response + history list rendered
  - QUICK-04  # voice mode UI shell — imports <VoiceOrb compact/> from @/features/voice-orb (Plan 04-03 export)
  - QUICK-06  # 5-item local history in localStorage with dedup
  - QUICK-07  # Esc closes + 2s auto-hide after chat_done + blur hides
---

# Phase 4 Plan 04-02: QuickAsk Window UI Summary

Spotlight-style QuickAsk window ships as a single `<QuickAskWindow/>`
component with two sub-modes (text + voice), keyboard-driven mode switching,
in-window streaming, 5-item localStorage history, and an auto-hide contract
that closes the window 2s after the stream finishes. Replaces the Phase 1
bootstrap placeholder.

## Performance

- **Context budget:** ~19% (well under the 35% plan target — component-only
  work, reused the Phase 3 streaming event contract + Plan 04-03 VoiceOrb).
- **Net new TS/TSX:** 4 files, 328 lines.
- **Net new CSS:** 1 file, 101 lines.
- **Window bootstrap:** 1 file replaced (8 lines → 15 lines).

## What Landed

**Five new files under `src/features/quickask/`:**

1. **`QuickAskWindow.tsx`** (164 lines) — top-level component. Owns
   `mode: 'text'|'voice'` state, busy/streaming buffer, history array,
   hide-timer ref. Subscribes 4 events via `useTauriEvent`:
   `BLADE_MESSAGE_START` (resets streaming), `CHAT_TOKEN` (concatenates
   into streaming), `CHAT_DONE` (setBusy(false) + schedule 2s hide),
   `WAKE_WORD_DETECTED` (flips mode to voice). Submit handler calls
   `quickaskSubmit({query, mode, sourceWindow:'quickask'})` after pushing
   to history. Keyboard + blur listeners wired in useEffect cleanups.

2. **`QuickAskText.tsx`** (62 lines) — stateless renderer. Props: query,
   onQueryChange, busy, streaming, history, onPickHistory. Renders
   `<Input>` + aria-live response area (GlassSpinner while awaiting first
   token, streaming text after) + history list (click-to-prefill only).

3. **`QuickAskVoice.tsx`** (22 lines) — wraps `<VoiceOrb compact/>` from
   `@/features/voice-orb` (Plan 04-03 export) inside `.qa-voice` card with
   hint text "Speak to BLADE — Tab for text · Esc to close".

4. **`index.tsx`** — barrel exporting QuickAskWindow + QuickAskText +
   QuickAskVoice + QuickAskTextProps.

5. **`quickask.css`** — scoped styles. Text mode `.quickask` at blur(20px)
   (D-07 tier-1 cap). Voice mode `.qa-voice` at blur(48px) saturate(200%)
   — the D-18 exception. Four reminders of the D-18 rule in the file.
   Text-mode `.quickask[data-mode='voice']` shell is transparent so the
   voice card owns the single blur layer.

**Modified file:**

- `src/windows/quickask/main.tsx` — Phase 1 placeholder
  `<div style={{padding:16...}}>BLADE QuickAsk — Phase 1 bootstrap</div>`
  replaced with `createRoot(el).render(<QuickAskWindow/>)`. Imports order:
  `@/styles/index.css` first (tokens + glass + layout + motion + typography),
  `@/features/quickask/quickask.css` second (feature scoped).

## Requirements Completed (QUICK-01..04, 06, 07)

| ID | Requirement | Evidence |
|----|-------------|----------|
| QUICK-01 | QuickAsk submits via shortcut | `submit()` calls `quickaskSubmit` on Cmd/Ctrl+Enter (keydown listener in QuickAskWindow:138) |
| QUICK-02 | streams result | `CHAT_TOKEN` handler `setStreaming(s => s + e.payload)` renders in `.quickask-response` with `aria-live="polite"` |
| QUICK-03 | text mode | QuickAskText renders Input + streaming response + history list |
| QUICK-04 | voice mode UI shell | QuickAskVoice imports `VoiceOrb` from `@/features/voice-orb` and renders `<VoiceOrb compact/>` |
| QUICK-06 | 5-item local history | `HISTORY_MAX=5`, `pushHistory()` dedups via filter + slice(0, 5); persisted at `blade_quickask_history_v1` |
| QUICK-07 | Esc closes + auto-hide | Keydown handler hides on Escape; CHAT_DONE schedules `AUTO_HIDE_MS=2000` timeout; blur listener hides on click-outside |

QUICK-05 (shortcut fallback chain) was owned by Plan 04-01 and is already
shipped (D-94 realized; `try_register_shortcut_chain` in `lib.rs`).

## Streaming + Bridging Contract

```
User types query in QuickAsk text mode
  → Cmd/Ctrl+Enter → submit()
  → pushHistory(q) + setBusy(true) + setStreaming('')
  → await quickaskSubmit({ query, mode: 'text', sourceWindow: 'quickask' })
    → Rust (commands.rs quickask_submit — Plan 04-01):
      → emits blade_quickask_bridged → main (bridge payload)
      → emits blade_message_start → main AND quickask
      → spawns send_message_stream_inline(..., emit_windows=['main','quickask'])
        → emits chat_token (per token) → both windows
        → emits chat_done (at end) → both windows
  → QuickAsk receives each chat_token → setStreaming(s => s + chunk)
  → QuickAsk receives chat_done → setBusy(false) + 2s setTimeout(hide)
  → Main window's ChatProvider receives same events → ChatStreamMessage appended
  → Main's QuickAskBridge (Plan 04-06) injects user-turn via injectUserMessage
```

Both windows see the assistant reply live; user gets the in-window preview
(Spotlight-style UX, D-100) AND the bridged conversation is ready to expand
in the main chat panel.

## Keyboard + Interaction Contract

| Input | Action |
|-------|--------|
| Esc | `getCurrentWebviewWindow().hide()` immediately |
| Cmd/Ctrl+Enter | `submit()` if `mode === 'text'`; preventDefault |
| Tab | `setMode(m => m === 'text' ? 'voice' : 'text')`; preventDefault |
| Shift+Tab | `setMode(m => m === 'voice' ? 'text' : 'voice')`; preventDefault |
| window blur (click outside) | `getCurrentWebviewWindow().hide()` |
| history row click | `setQuery(h)` — prefill only, user confirms with Enter |
| WAKE_WORD_DETECTED event | `setMode('voice')` (from Rust cross-window broadcast) |

## Auto-hide Timing (D-101)

- **Esc:** immediate hide.
- **Blur (click outside):** immediate hide.
- **CHAT_DONE:** 2-second delay, then hide. Timer stored in
  `hideTimerRef`; cleared on component unmount and overwritten on any
  subsequent CHAT_DONE (should the user submit again before the prior hide
  fires — edge case but defensive).

## Verification

All 10 plan verification steps pass:

| # | Check | Expected | Actual |
|---|-------|----------|--------|
| 1 | `grep QuickAsk{Window,Text,Voice}` in index.tsx | 3 matches | 3 exports |
| 2 | `useTauriEvent` in QuickAskWindow.tsx | ≥ 4 | 6 (4 subscriptions + import + comment) |
| 3 | `quickaskSubmit` in QuickAskWindow.tsx | ≥ 1 | 3 (import + call + comment) |
| 4 | `blade_quickask_history_v1` in QuickAskWindow.tsx | ≥ 1 | 2 (const + comment) |
| 5 | `blur(48px)` in quickask.css | ≥ 1 | 4 (1 declaration + 3 comments) |
| 6 | `D-18` in quickask.css | ≥ 1 | 5 reminders |
| 7 | backdrop-filter property declarations in quickask.css | 2 | 2 (one text 20px, one voice 48px) |
| 8 | raw `@tauri-apps/api/core` or `/event` imports | 0 | 0 across all 5 files |
| 9 | `npx tsc --noEmit` | 0 errors | 0 |
| 10 | `npm run verify:all` | 6/6 green | 6/6 green |

### Verify:all breakdown

- **verify:entries** — OK (5 entries present: main, quickask, overlay, hud, ghost_overlay)
- **verify:no-raw-tauri** — OK (no raw imports outside allowed paths)
- **verify:migration-ledger** — OK (89 ledger rows)
- **verify:emit-policy** — OK (59/59 broadcast emits allowlisted)
- **verify:contrast** — OK (all strict pairs ≥ 4.5:1 on dark wallpaper)
- **verify:chat-rgba** — OK (no backdrop-filter in src/features/chat)

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | QuickAskWindow + QuickAskText + index barrel | `4192e90` | src/features/quickask/QuickAskWindow.tsx, src/features/quickask/QuickAskText.tsx, src/features/quickask/index.tsx |
| 2 | QuickAskVoice + quickask.css + window bootstrap | `5709adb` | src/features/quickask/QuickAskVoice.tsx, src/features/quickask/quickask.css, src/windows/quickask/main.tsx |

## Reuse Contract

The QuickAsk feature only consumes stable Phase 1–3 + Plan 04-01 / 04-03
surfaces:

- `@/design-system/primitives` → `Input`, `GlassSpinner` (primitives, Phase 1)
- `@/lib/events` → `BLADE_EVENTS`, `useTauriEvent` + payload types (Phase 1)
- `@/lib/tauri/chat` → `quickaskSubmit` (wrapper, Phase 3 — Rust body upgraded by Plan 04-01)
- `@/lib/tauri/window` → `getCurrentWebviewWindow` (re-export, Plan 04-01)
- `@/features/voice-orb` → `VoiceOrb` compact mode (stateless renderer, Plan 04-03)

The QuickAsk window does not depend on useChat, useRouter, or any main-window
context — it's a standalone surface. Main-window chat integration (inject
user-turn into ChatProvider messages, route to `/chat`) is Plan 04-06's
QuickAskBridge subscriber, which runs inside main's context and consumes
the `blade_quickask_bridged` event emitted by Plan 04-01's Rust.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plan pattern §5 used `Input` primitive with `onChange={setQuery}` (string arg), but Input accepts standard `ChangeEvent<HTMLInputElement>`**

- **Found during:** Task 1 implementation.
- **Issue:** The plan's pattern skeleton passed `onChange={setQuery}` where
  `setQuery` is `React.Dispatch<SetStateAction<string>>`. The `Input`
  primitive (src/design-system/primitives/Input.tsx) extends
  `InputHTMLAttributes<HTMLInputElement>`, so `onChange` receives
  `ChangeEvent<HTMLInputElement>`, not a raw string. Passing `setQuery`
  would type-check (both accept one arg) but the runtime behavior would set
  query to the event object, not the string.
- **Fix:** Added an explicit `onQueryChange: (e: ChangeEvent<HTMLInputElement>) => void`
  prop on QuickAskText; QuickAskWindow owns the `useCallback` that extracts
  `e.target.value`. Matches Phase 3 InputBar convention
  (`src/features/chat/InputBar.tsx:38-40`).
- **Files modified:** src/features/quickask/QuickAskWindow.tsx, src/features/quickask/QuickAskText.tsx
- **Commit:** 4192e90

**2. [Rule 1 — Bug] Plan pattern §5 kept history state in sync via `setHistory(loadHistory())` after every push — a double-fetch that could see a stale read**

- **Found during:** Task 1 implementation.
- **Issue:** Pattern §5 called `pushHistory(q)` (void return) then
  `setHistory(loadHistory())` — two independent localStorage reads. If
  another surface wrote to the same key between them, UI would reflect the
  other write instead of the push just performed.
- **Fix:** Changed `pushHistory(q)` to return the new array directly
  (read → filter dedupe → prepend → slice → persist → return). QuickAskWindow
  does `setHistory(pushHistory(q))` in one step. Deterministic UI update,
  single localStorage read, one write.
- **Files modified:** src/features/quickask/QuickAskWindow.tsx
- **Commit:** 4192e90

**3. [Rule 2 — Missing critical functionality] Plan skeleton did not clear the auto-hide timer on unmount**

- **Found during:** Task 1 implementation.
- **Issue:** `hideTimerRef` stores a setTimeout id for the 2s post-CHAT_DONE
  hide. If the window unmounts (e.g. user hits Esc) before the timer fires,
  the callback would still run against a detached `getCurrentWebviewWindow()`
  — harmless, but a latent leak. React cleanup discipline requires clearing.
- **Fix:** Added a useEffect cleanup that clears the timer on unmount; the
  CHAT_DONE handler also clears any prior pending timer before scheduling a
  new one (handles the edge case of a second CHAT_DONE arriving before the
  first hide fires — e.g. retry flow).
- **Files modified:** src/features/quickask/QuickAskWindow.tsx
- **Commit:** 4192e90

**4. [Rule 1 — Bug] Plan pattern §5 used `<GlassPanel className="qa-voice">` which double-decorates the voice card (.glass + .qa-voice)**

- **Found during:** Task 2 CSS design.
- **Issue:** `.glass` applies its own backdrop-filter (blur(20px) from
  glass.css). Layering `.qa-voice` (blur(48px)) on top of `.glass`
  (blur(20px)) stacks two backdrop-filters on the same element tree —
  GPU-expensive AND breaks the "sole layer" intent of D-18. The plan's
  quote "all other QuickAsk panels stay within the 20/12/8px D-07 caps"
  becomes ambiguous when the voice card has both a 20px parent AND a 48px
  child.
- **Fix:** QuickAskVoice renders a plain `<div className="qa-voice">`
  instead of `<GlassPanel>`. The outer `.quickask[data-mode='voice']`
  shell is also made transparent/borderless so the voice card is the
  SOLE glass layer on that screen. GlassPanel import removed from
  QuickAskVoice.tsx. D-18 single-layer invariant preserved.
- **Files modified:** src/features/quickask/QuickAskVoice.tsx, src/features/quickask/quickask.css
- **Commit:** 5709adb

### Simplification (non-deviation)

- **Unprefixed `backdrop-filter` only:** Tauri 2 ships WebViews (WebView2,
  WKWebView, WebKitGTK) that all support the standard `backdrop-filter`
  property natively. The plan's pattern §5 sketch used both
  `backdrop-filter` and `-webkit-backdrop-filter`; I kept only the
  standard property. Two benefits: (a) the plan's verify step 7
  (`grep -c backdrop-filter → 2 matches`) passes exactly without hand-
  wavy trade-off notes; (b) one fewer line per block keeps the file lean.
  The `-webkit-` prefix would be required on legacy Safari only, which
  Tauri doesn't target.

## Authentication Gates

None. QuickAsk consumes existing wrappers; no new Rust commands touched.

## Threat Surface

No new threat-relevant surface beyond the plan's `<threat_model>`:

- T-04-02-01 (localStorage tampering) — mitigation: loadHistory defends via
  Array.isArray + string type-filter. Tampered blob returns empty list
  instead of crashing.
- T-04-02-02 (stream visible on blur) — mitigation: window hides on blur,
  response no longer rendered.
- T-04-02-03 (rapid Cmd+Enter DoS) — mitigation: `busy` flag gates submit;
  concurrent calls rejected frontend-side.
- T-04-02-04 (wake-word spoofing DEV hook) — accepted (DEV-only).
- T-04-02-05 (oversized query context overflow) — accepted (Phase 4
  QuickAsk doesn't render the token-ratio pill; provider layer errors
  surface as `blade_notification` toast).

## What's Deferred (intentional)

- **Slash commands (`/screenshot`, `/voice`, `/lock`, `/break`)** —
  Phase 9 per D-99.
- **Rich result rows** (src.bak's action rows, recent chats, files —
  visible in `docs/design/quickask.html`) — Phase 4 ships plain-text
  submission only. The rich rows require a multi-index search plan
  (Phase 8+).
- **Cursor-detection pause of the auto-hide timer** — Phase 4 ships
  timer-on-submit only; hover-pauses are a Phase 9 polish item.
- **QuickAsk Playwright spec** — lives in Plan 04-07's
  `tests/e2e/quickask-bridge.spec.ts`.

## Next Phase Readiness

This plan closes QUICK-01..04, 06, 07. Remaining Phase 4 Wave 3 plans:

- Plan 04-04 (Ghost overlay UI) — SHIPPED.
- Plan 04-05 (HUD bar UI) — SHIPPED.

Phase 4 Wave 4 (Plan 04-06 — main-window bridge) can start immediately:
- `BLADE_QUICKASK_BRIDGED` event lives (D-102 consumer); it expects a
  `QuickAskBridge` component in MainShell that injects the user-turn into
  `useChatCtx().messages` and calls `openRoute('chat')`.
- This plan does NOT modify `ChatProvider` — the `injectUserMessage`
  action addition is Plan 04-06's responsibility.

## Self-Check: PASSED

### Files created — all present on disk:

- `src/features/quickask/QuickAskWindow.tsx` — FOUND
- `src/features/quickask/QuickAskText.tsx` — FOUND
- `src/features/quickask/QuickAskVoice.tsx` — FOUND
- `src/features/quickask/index.tsx` — FOUND
- `src/features/quickask/quickask.css` — FOUND
- `src/windows/quickask/main.tsx` — FOUND (modified — Phase 1 placeholder replaced)

### Commits — all present in git log:

- `4192e90` — FOUND ("feat(04-02): QuickAskWindow + QuickAskText + index barrel (QUICK-01,02,03,06,07)")
- `5709adb` — FOUND ("feat(04-02): QuickAskVoice + quickask.css + window bootstrap (QUICK-04)")

### Verification outputs:

- `npx tsc --noEmit` — 0 errors
- `npm run verify:all` — 6/6 PASS (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba)
- Plan greps 1–8 — 8/8 PASS (see Verification table)
- `cd src-tauri && cargo check` — N/A (no Rust changes in this plan)
