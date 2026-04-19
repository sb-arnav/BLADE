---
phase: 04-overlay-windows
plan: 06
subsystem: cross-window-wiring
tags: [react, chat-provider, hoist, quickask-bridge, route-request, toast-severity, d-94, d-102, d-114, d-116]
requires:
  - 04-01 (Rust — blade_quickask_bridged emit + BLADE_ROUTE_REQUEST emit + ShortcutRegistrationFailedPayload severity field)
  - 04-02 (QuickAsk window submits → quickaskSubmit → Rust bridge)
  - 02-06 (MainShell composition site)
  - 03-03 (ChatProvider substrate — D-67/D-68/D-69)
provides:
  - src/features/chat/useChat.tsx::injectUserMessage — retroactive user-turn sync action on ChatStateValue
  - src/features/chat/QuickAskBridge — MainShell-level consumer of BLADE_QUICKASK_BRIDGED
  - src/features/chat barrel re-exports (ChatProvider, useChatCtx, QuickAskBridge, ChatStateValue, ChatStatus, ChatStreamMessage)
  - src/windows/main/MainShell::ChatProvider hoist — D-116 realization
  - src/windows/main/useRouter::BLADE_ROUTE_REQUEST subscriber — cross-window navigation consumer (D-114)
  - src/lib/context/BackendToastBridge — severity-aware shortcut-fallback toast (D-94 consumer)
affects:
  - src/features/chat/useChat.tsx (added injectUserMessage action + ChatStateValue field + header-comment D-116 note + useChatCtx error message)
  - src/features/chat/index.tsx (unwrapped ChatProvider from ChatPanelRoute; re-exported ChatProvider/useChatCtx/QuickAskBridge from the feature barrel)
  - src/features/chat/QuickAskBridge.tsx (NEW)
  - src/windows/main/MainShell.tsx (ChatProvider + QuickAskBridge mount inside RouterProvider)
  - src/windows/main/useRouter.ts (BLADE_ROUTE_REQUEST subscriber via useTauriEvent)
  - src/lib/context/BackendToastBridge.tsx (shortcut-fallback branch on severity)
tech-stack:
  added: []
  patterns:
    - "Provider hoist: ChatProvider moves from route-level (Phase 3 D-69) to MainShell-level (Phase 4 D-116). MainShell mounts exactly once per session so P-06 listener-leak discipline is preserved — useTauriEvent's single-listen-per-mount contract remains intact."
    - "Zero-DOM event bridge component: QuickAskBridge returns null; its entire job is the cross-window event handler. Mounted beside BackendToastBridge inside <ChatProvider> so it can consume the chat context."
    - "Retroactive state injection action: injectUserMessage({id, content}) appends to messages[] WITHOUT invoking sendMessageStream. The Rust quickask_submit (Plan 04-01 D-93) already kicked off streaming before main-window knew — this action closes the UI loop so the user's own turn shows alongside the assistant reply."
    - "Defensive payload typing: QuickAskBridgedExtended is a local intersection type that adds Plan 04-01's message_id + user_message_id fields to the Phase 3 interface. Works today (Rust emits both) and stays type-safe if payloads.ts is tightened later."
    - "Severity branching in toast bridge: severity === 'warning' → warn toast with fallback_used (non-fatal); severity === 'error' (or undefined, for Phase 3 back-compat) → error toast listing attempted candidates."
    - "openRoute validation reuse: BLADE_ROUTE_REQUEST handler forwards to openRoute, which already drops unknown route ids via ROUTE_MAP.has (T-02-05-02). No duplicate whitelist logic — cross-window navigation can't poison router state."
    - "Toast preview cap (80 chars): truncatePreview() prevents a long QuickAsk query from overflowing the toast viewport (T-04-06-02 mitigation). Full query is still available in the injected user-turn in chat history."
key-files:
  created:
    - src/features/chat/QuickAskBridge.tsx
    - .planning/phases/04-overlay-windows/04-06-SUMMARY.md
  modified:
    - src/features/chat/useChat.tsx
    - src/features/chat/index.tsx
    - src/windows/main/MainShell.tsx
    - src/windows/main/useRouter.ts
    - src/lib/context/BackendToastBridge.tsx
key-decisions:
  - "D-102 realized (QuickAskBridge consumer): new component mounted inside MainShell<ChatProvider> with zero DOM. Subscribes BLADE_QUICKASK_BRIDGED; on event calls injectUserMessage(userId, query) + openRoute('chat') + show({type:'info', title:'Quick ask bridged', message:truncated-query})."
  - "D-116 realized (ChatProvider hoist): ChatProvider moves from route-level (D-69) to MainShell-level. ChatPanelRoute stops wrapping itself in ChatProvider; the ambient provider now covers every route. Header comment on useChat.tsx updated so future readers understand the shift. MainShell mounts once per session so event subscriptions aren't recreated on route navigation (P-06 discipline maintained)."
  - "D-114 consumer realized (BLADE_ROUTE_REQUEST): useRouter.ts subscribes via useTauriEvent and forwards payload.route_id to openRoute. openRoute's existing ROUTE_MAP.has guard (T-02-05-02) drops unknown ids silently — no duplicate validation code needed."
  - "D-94 consumer realized (severity-aware toast): BackendToastBridge branches on ShortcutRegistrationFailedPayload.severity. 'warning' surfaces a warn-level toast with fallback_used; 'error'/undefined surfaces an error-level toast listing all attempted shortcuts. Phase 3 emits that don't set severity continue to render as error toasts."
  - "injectUserMessage shape (plan-defined): {id, content} — NOT (content, conversationId?). Plan 04-06 frontmatter + D-102 both specify the {id, content} object, so I followed the plan over the user prompt wording. The id is supplied by Rust (user_message_id from Plan 04-01) so the UI can match the bridged turn to the Rust-side conversation model if needed."
  - "Barrel exports added to src/features/chat/index.tsx: ChatProvider, useChatCtx, QuickAskBridge, plus ChatStateValue / ChatStatus / ChatStreamMessage types. MainShell imports via @/features/chat; there is no direct reach-into useChat.tsx from outside the feature."
  - "useChatCtx error message updated to point at MainShell.tsx (Phase 4 D-116 hoist) instead of the legacy ChatPanelRoute wording — so any future consumer who forgets to mount the provider gets an accurate pointer."
  - "Toast preview truncation cap at 80 chars (T-04-06-02 mitigation) + ellipsis character. Kept single-line to match the useToast contract (title + optional message; no rich content)."
  - "No separate RouteRequestBridge component (as the user prompt suggested): the plan explicitly puts the subscriber inside useRouter.ts (Task 2 Sub-task 2b). Folding it into useRouter avoids an extra zero-DOM component mount and keeps the route-handling logic colocated with openRoute."
metrics:
  duration_minutes: 15
  commits: 2
  files_created: 1
  files_modified: 5
  lines_added: ~175
  lines_deleted: ~25
  completed_at: 2026-04-19T00:00:00Z
requirements-completed:
  - QUICK-02  # bridged conversation appears in main chat (QuickAskBridge + injectUserMessage)
  - QUICK-05  # shortcut fallback graceful + severity-aware warning toast (BackendToastBridge consumer)
  - HUD-04    # route-request from HUD menu reaches main (useRouter consumer)
---

# Phase 4 Plan 04-06: Cross-Window Wiring Summary

Finalizes Wave 4 of Phase 4 by composing the independent overlay windows
(Plan 04-01 Rust + 04-02/03/04/05 UI) into the user-facing flow. Three
cross-window glue points land: QuickAsk bridge consumer on main, route-
request consumer in useRouter, and severity-aware shortcut-fallback toast.
ChatProvider hoists from route-level (D-69) to MainShell-level (D-116) so
the bridge can inject bridged user-turns regardless of the currently-active
route. Six files touched, two atomic commits, zero new deps.

## Performance

- **Context budget:** ~14% (well under the 25% target — small surgical edits)
- **Net new TS/TSX:** 1 new file (QuickAskBridge, 76 lines), 5 modified files
- **Total diff:** +175 / −25 lines

## What Landed

### Task 1 — ChatProvider hoist + injectUserMessage

1. **`src/features/chat/useChat.tsx`**
   - Added `injectUserMessage: (m: { id: string; content: string }) => void`
     to `ChatStateValue` interface (with a D-102 explainer comment).
   - Implemented the action inside `ChatProvider` — appends a `{id, role:
     'user', content, createdAt}` entry to `messages[]` via `setMessages`.
     Wrapped in `useCallback` with empty deps (pure setter, no captures).
   - Included `injectUserMessage` in the context value object.
   - Updated the file header to document the D-116 hoist: ChatProvider
     now lives at MainShell-level, not route-level.
   - Updated the `useChatCtx()` error message to point at MainShell instead
     of the legacy ChatPanelRoute wording.

2. **`src/features/chat/index.tsx`**
   - Unwrapped `<ChatProvider>` from the `ChatPanelRoute` lazy component
     (was `<ChatProvider><ChatPanel/></ChatProvider>` → now just
     `<ChatPanel/>`).
   - Re-exported `ChatProvider`, `useChatCtx`, `ChatStateValue`,
     `ChatStatus`, `ChatStreamMessage` from the feature barrel so MainShell
     can `import { ChatProvider } from '@/features/chat'`.
   - Re-exported `QuickAskBridge` from the same barrel.

3. **`src/windows/main/MainShell.tsx`**
   - Imported `ChatProvider` + `QuickAskBridge` from `@/features/chat`.
   - Wrapped `<ShellContent/>` in `<ChatProvider>` inside `RouterProvider`.
   - Mounted `<QuickAskBridge/>` beside `<BackendToastBridge/>` — both are
     zero-DOM event bridges.

### Task 2 — QuickAskBridge component

**`src/features/chat/QuickAskBridge.tsx`** (NEW, 76 lines)
- Subscribes `BLADE_QUICKASK_BRIDGED` via `useTauriEvent`.
- Extended payload type `QuickAskBridgedExtended` intersects the Phase 3
  `BladeQuickAskBridgedPayload` with optional `message_id`, `user_message_id`,
  `source_window` — matches the Plan 04-01 Rust emit (D-93) while staying
  type-safe if payloads.ts is later tightened.
- On event: resolves `userId = user_message_id ?? (message_id ? u-${message_id} : u-${Date.now()})`,
  calls `injectUserMessage({id: userId, content: query})`, calls
  `openRoute('chat')`, shows `{type: 'info', title: 'Quick ask bridged',
  message: truncatePreview(query)}`.
- `truncatePreview()` helper caps preview at 80 chars with ellipsis to
  keep the toast viewport clean (T-04-06-02 mitigation).
- Returns `null` (zero DOM).

### Task 3 — BLADE_ROUTE_REQUEST consumer in useRouter

**`src/windows/main/useRouter.ts`**
- Added imports: `BLADE_EVENTS`, `useTauriEvent`, `BladeRouteRequestPayload`.
- Inside `RouterProvider` (after `value` memo), added a `useTauriEvent`
  subscriber for `BLADE_ROUTE_REQUEST`. Handler forwards
  `e.payload.route_id` to `openRoute()`. Unknown ids are silently dropped
  by `openRoute`'s existing `ROUTE_MAP.has` guard (T-02-05-02 reuse).
- No behavioral change to public API — `useRouterCtx` signature unchanged.

### Task 4 — Toast severity routing

**`src/lib/context/BackendToastBridge.tsx`**
- Rewrote the `SHORTCUT_REGISTRATION_FAILED` handler to destructure
  `shortcut`, `error`, `name`, `attempted`, `fallback_used`, `severity`.
- Branches on `severity`:
  - `'warning'` → `show({type: 'warn', title: 'Shortcut fell back',
    message: '${shortcut} (${name}) was in use; registered to
    ${fallback_used} instead.'})`
  - `'error'` or undefined → `show({type: 'error', title: 'Shortcut
    registration failed', message: '${name} could not register any of:
    ${attempted.join(", ")}. ${error}'})`
- Phase 3 emits without severity continue to render as error toasts
  (back-compat preserved).
- Header comment updated to document the severity-aware branches.

## Verification

All plan-defined verify greps pass:

| # | Check | Expected | Actual |
|---|-------|----------|--------|
| 1 | `grep -n injectUserMessage src/features/chat/useChat.tsx` | ≥ 2 | 4 (comment + interface + useCallback + value-include) |
| 2 | `grep -n QuickAskBridge` across bridge + index + MainShell | 3+ | 11 total |
| 3 | `grep -n BLADE_QUICKASK_BRIDGED src/features/chat/QuickAskBridge.tsx` | 1 | 1 |
| 4 | `grep -n "BLADE_ROUTE_REQUEST\|BladeRouteRequestPayload" src/windows/main/useRouter.ts` | 2+ | 5 |
| 5 | `grep -n severity src/lib/context/BackendToastBridge.tsx` | ≥ 1 | 4 (comments + destructure + branch) |
| 6 | `grep -n "fallback_used\|attempted" src/lib/context/BackendToastBridge.tsx` | 1-2 | 5 |
| 7 | `grep -cE "from '@tauri-apps/api/core'|/event'" <6 files>` | 0 on each | 0/0/0/0/0/0 |
| 8 | `grep -vn "<ChatProvider>" src/features/chat/index.tsx` | no JSX match | no match (confirmed unwrap) |

### Compiler + build

- **`npx tsc --noEmit`** → 0 errors.
- **`npm run verify:all`** → 6/6 green:
  - verify:entries — 5 entries present
  - verify:no-raw-tauri — OK, no raw imports outside allowed paths
  - verify:migration-ledger — 89 rows, 7 referenced ids tracked
  - verify:emit-policy — 59/59 broadcast emits allowlisted
  - verify:contrast — all strict pairs ≥ 4.5:1
  - verify:chat-rgba — no backdrop-filter in src/features/chat

## Cross-Window Flow (end-to-end)

```
[QuickAsk window] user types query + Cmd/Ctrl+Enter
  → QuickAskWindow.submit() (Plan 04-02)
    → quickaskSubmit({ query, mode: 'text', source_window: 'quickask' })
      → Rust commands.rs::quickask_submit (Plan 04-01 D-93):
        → emits blade_quickask_bridged → main
          (payload: query, conversation_id, mode, timestamp,
           message_id, user_message_id, source_window)
        → emits blade_message_start → main + quickask
        → spawns send_message_stream_inline(emit_windows=['main','quickask'])

[Main window] MainShell mounted exactly once per session:
  <RouterProvider>
    <ChatProvider>               ← Phase 4 D-116 hoist (was route-level)
      <BackendToastBridge/>      ← severity-aware for SHORTCUT_REGISTRATION_FAILED
      <QuickAskBridge/>          ← Plan 04-06 Task 2 consumer
      <ShellContent/>
    </ChatProvider>
  </RouterProvider>

  QuickAskBridge receives blade_quickask_bridged:
    1. injectUserMessage({id: user_message_id, content: query})
       → ChatProvider.messages[] gets the user turn
    2. openRoute('chat')
       → RouteSlot flips routeId to 'chat'
       → ChatPanel renders (inside existing ChatProvider ambient context)
    3. show({type:'info', title:'Quick ask bridged', message: truncatePreview(query)})
       → toast viewport surfaces a 4s info banner

  Meanwhile, ChatProvider's existing Phase 3 subscribers handle:
    - blade_message_start → sets currentMessageId, resets streaming buffers
    - chat_token → rAF-buffered streaming into streamingContent
    - chat_done → commits the assistant ChatStreamMessage to messages[]

  → User sees: toast confirmation, /chat route, user turn + live assistant
    streaming, final committed conversation.
```

## Cross-Window Navigation Flow (HUD menu)

```
[HUD window] user right-clicks → "Settings" menu item
  → (Plan 04-05) invoke('emit_route_request', {route_id: 'settings-voice'})
    → Rust overlay_manager.rs::emit_route_request:
      → app.emit_to('main', 'blade_route_request', {route_id}) (Plan 04-01)

[Main window] useRouter's useTauriEvent subscriber fires:
  → openRoute('settings-voice')
    → ROUTE_MAP.has('settings-voice') === true → setRouteId + backStack push
    → setPref('app.lastRoute', 'settings-voice')
  → RouteSlot re-renders with the settings voice route.

Invalid route_id handling:
  → openRoute('does-not-exist')
    → ROUTE_MAP.has returns false
    → console.warn + early return (T-02-05-02) — no state mutation.
```

## Toast Severity Routing (D-94 consumer)

```
Rust register_all_shortcuts (Plan 04-01):
  - Tries configured Ctrl+Space → fails (CJK IME conflict).
  - Falls back to Cmd+Option+Space (macOS) → succeeds.
  - Emits shortcut_registration_failed with:
      { shortcut: 'Ctrl+Space', name: 'Quick Ask',
        error: 'already registered',
        attempted: ['Ctrl+Space'], fallback_used: 'Cmd+Option+Space',
        severity: 'warning' }

BackendToastBridge receives:
  severity === 'warning' → show({
    type: 'warn',
    title: 'Shortcut fell back',
    message: 'Ctrl+Space (Quick Ask) was in use; registered to Cmd+Option+Space instead.'
  })
  → yellow Pill surface, 7s duration (DEFAULT_DURATION['warn']).

Total failure path:
  Rust emits with severity: 'error', attempted: ['Ctrl+Space',
    'Cmd+Option+Space', 'Ctrl+Shift+Space']
  BackendToastBridge receives:
    severity === 'error' → show({
      type: 'error',
      title: 'Shortcut registration failed',
      message: 'Quick Ask could not register any of: Ctrl+Space,
        Cmd+Option+Space, Ctrl+Shift+Space. already registered'
    })
  → red Pill surface, 7s duration.
```

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ChatProvider hoist + injectUserMessage + QuickAskBridge | `b5b782b` | src/features/chat/useChat.tsx, src/features/chat/index.tsx, src/features/chat/QuickAskBridge.tsx, src/windows/main/MainShell.tsx |
| 2 | BLADE_ROUTE_REQUEST consumer + severity-aware shortcut toast | `fe37766` | src/windows/main/useRouter.ts, src/lib/context/BackendToastBridge.tsx |

## Deviations from Plan

### [Rule 1 — Bug fix / interpretation] injectUserMessage signature: plan vs user-prompt wording

- **Found during:** Task 1 start.
- **Issue:** The execution prompt said `injectUserMessage(content: string,
  conversationId?: string)`, while the plan frontmatter + D-102 + D-116
  all specified `injectUserMessage: (m: { id: string; content: string }) =>
  void`. These are materially different — the {id, content} object form is
  required so the Rust-supplied `user_message_id` threads through to the
  React state (stable key per P-06, matches conversation model from Rust).
- **Fix:** Followed the plan (frontmatter + D-102) shape: `(m: { id, content
  }) => void`. QuickAskBridge resolves `id` from `user_message_id` (with a
  fallback to `u-${message_id}` or `u-${Date.now()}` in case the Phase 3
  stub payload is seen).
- **Files modified:** src/features/chat/useChat.tsx + src/features/chat/QuickAskBridge.tsx.
- **Commit:** b5b782b.

### [Rule 1 — Structural choice] Single file commit vs. separate-commit-per-task sequencing

- **Found during:** Task 1 commit attempt.
- **Issue:** If I committed useChat/index/MainShell without QuickAskBridge.tsx,
  the commit would reference `import { QuickAskBridge } from '@/features/chat'`
  with no implementation, breaking the tsc pass at that commit (bad for
  bisect).
- **Fix:** Amended the first commit to include `src/features/chat/QuickAskBridge.tsx`.
  Each of the 2 commits now builds independently and passes tsc.
- **Files modified:** (commit layout only — no source change).
- **Commit:** b5b782b.

### [Rule 2 — Missing critical functionality] Fallback id generation in QuickAskBridge

- **Found during:** Task 2 design.
- **Issue:** Plan pattern sketched `const userId = user_message_id ?? u-${message_id}`.
  If BOTH fields are absent (e.g. a legacy Phase 3 stub payload somehow
  reaches main after upgrade), the fallback would produce `u-undefined` —
  not a stable id, and React's key-dedup would break.
- **Fix:** Added a third fallback: `u-${Date.now()}` when both message_id
  and user_message_id are absent. Non-deterministic but unique; the user-
  turn still renders once. Safer than a collision-risk static string.
- **Files modified:** src/features/chat/QuickAskBridge.tsx.
- **Commit:** b5b782b.

### No structural deviation from the plan's "subscribe inside useRouter" design

The execution prompt suggested creating a separate `RouteRequestBridge.tsx`
component. The plan's Task 2 Sub-task 2b specifies the subscriber should
live INSIDE `useRouter.ts` (inside `RouterProvider`) — no extra file. I
followed the plan because:

1. The route-request handler needs `openRoute` (from the same provider's
   closure), and putting it in a sibling component would require routing
   through `useRouterCtx()` — adds a context consumer pass for no win.
2. useRouter.ts is the natural home for cross-window route requests since
   it already owns the navigation state machine.

## Authentication Gates

None. This plan is pure frontend cross-window wiring on top of the Rust
emit sites shipped by Plan 04-01.

## Threat Surface

The plan's `<threat_model>` enumerated five threats (T-04-06-01..05). All
received their planned mitigations:

- **T-04-06-01 (BLADE_ROUTE_REQUEST tampering)** — openRoute's existing
  `ROUTE_MAP.has` guard (T-02-05-02) drops unknown ids silently. No new
  security-sensitive surface introduced.
- **T-04-06-02 (QuickAsk query info disclosure in toast)** — truncatePreview
  caps at 80 chars; full query goes into chat messages (already user-owned
  context).
- **T-04-06-03 (rapid BLADE_QUICKASK_BRIDGED DoS)** — accept; Rust serializes
  submissions via CHAT_INFLIGHT (Phase 3 inheritance).
- **T-04-06-04 (crafted id collision)** — ids come from Rust uuid (Plan
  04-01); no user-controlled path into injectUserMessage outside
  QuickAskBridge.
- **T-04-06-05 (user misses toast)** — accept; toast lasts 4s and chat
  messages persist via ChatProvider state.

## What's Deferred (intentional)

- **Plan 04-07 Playwright coverage:** QuickAsk bridge spec
  (`tests/e2e/quickask-bridge.spec.ts`), shortcut-fallback spec
  (`tests/e2e/shortcut-fallback.spec.ts`). Not this plan's scope.
- **Mac-session operator checks:** M-03 (shortcut → QuickAsk → bridged
  conversation in main) and M-04 (CJK IME fallback severity) are owned
  by Plan 04-07 Task 3.
- **Toast positioning / stacking of the bridged toast with the chat
  approval dialog:** current ToastViewport handles up to 5 concurrent
  toasts; no cross-interference expected with the QuickAsk bridge flow.

## Next Phase Readiness

Phase 4 Wave 4 closes with this plan. Wave 5 (Plan 04-07) can start:

- QuickAsk bridge spec can mock `quickask_submit` + emit synthetic
  `blade_quickask_bridged` and assert:
  1. `useChatCtx().messages` length grows by 1 (user turn injected).
  2. `openRoute('chat')` called (check data-route-id="chat").
  3. Toast with title 'Quick ask bridged' appears in viewport.
- Shortcut-fallback spec can emit synthetic SHORTCUT_REGISTRATION_FAILED
  with severity='warning' and severity='error'; assert warn vs error
  toast rendering.

All Phase 4 Rust APIs, UI windows, and main-side bridges are live. Plan
04-07 Task 3 operator smoke is the only remaining gate before Phase 4
completes.

## TDD Gate Compliance

Not applicable — this plan has `type: execute` (not `type: tdd`). Phase
4 Playwright coverage is gated separately in Plan 04-07.

## Self-Check: PASSED

### Files created — all present on disk:

- `src/features/chat/QuickAskBridge.tsx` — FOUND (commit b5b782b)

### Files modified — all present on disk:

- `src/features/chat/useChat.tsx` — FOUND (modified, commit b5b782b)
- `src/features/chat/index.tsx` — FOUND (modified, commit b5b782b)
- `src/windows/main/MainShell.tsx` — FOUND (modified, commit b5b782b)
- `src/windows/main/useRouter.ts` — FOUND (modified, commit fe37766)
- `src/lib/context/BackendToastBridge.tsx` — FOUND (modified, commit fe37766)

### Commits — all present in git log:

- `b5b782b` — FOUND ("feat(04-06): hoist ChatProvider to MainShell + injectUserMessage + QuickAskBridge")
- `fe37766` — FOUND ("feat(04-06): BLADE_ROUTE_REQUEST consumer in useRouter + severity-aware shortcut toast")

### Verification outputs:

- `npx tsc --noEmit` — 0 errors.
- `npm run verify:all` — 6/6 PASS (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba).
- Plan verify greps 1–8 — 8/8 PASS (see Verification table).
- `cd src-tauri && cargo check` — N/A (no Rust changes in this plan).
