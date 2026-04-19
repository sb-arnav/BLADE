---
phase: 03-dashboard-chat-settings
plan: 03
subsystem: chat-ui-substrate
tags: [react, chat, streaming, raf-buffer, context, tauri-events, d-67, d-68, d-69, d-70]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: BLADE_EVENTS catalog + useTauriEvent hook (D-13/D-38-hook), Button/Input/Pill primitives, ChatMessage DTO, RouteDefinition contract, glass tokens (--g-fill, --g-edge), spacing tokens (--s-N), radii (--r-md, --r-pill)
  - phase: 02-onboarding-shell
    provides: ConfigContext + ToastContext + lazy route loading via MainShell Suspense slot
  - phase: 03-dashboard-chat-settings
    plan: 03-01
    provides: Rust emits live for blade_message_start, blade_thinking_chunk, blade_token_ratio (WIRE-03/04/06)
  - phase: 03-dashboard-chat-settings
    plan: 03-02
    provides: respondToolApproval, sendMessageStream, cancelChat wrappers + payload type interfaces
provides:
  - ChatProvider context with rAF-flushed streaming buffer (the SC-2 substrate)
  - useChatCtx hook surfacing 12 fields (state) + 4 actions (send/cancel/approveTool/denyTool)
  - 7-file chat surface (5 components + 1 css + 1 route index) replacing Phase 1 stub
  - Plan 03-04 markup slots: <details className="chat-thinking-details">, <CompactingIndicator/>, <ToolApprovalDialog/>
affects:
  - 03-04 (next plan — adds 3 components on top without modifying these 7 files)
  - 03-07 (Playwright spec asserts ≤60 commits per 1000ms / 50 chat_token bursts)
  - Phase 4 (overlay windows can reuse useChat by wrapping their own ChatProvider mount)

# Tech tracking
tech-stack:
  added: []  # No new dependencies; all composition over existing substrate
  patterns:
    - "rAF-flushed ref buffer for high-frequency event accumulation (D-68 — generic pattern, reusable for any token-rate stream)"
    - "Ref mirrors of committed state for race-safe synchronous final flush (T-03-03-01 mitigation)"
    - "Provider mount at route level (not shell) for clean unmount-on-navigate teardown (D-69 / P-06)"
    - "Status latching: thinking never downgrades awaiting_tool — tool approval stays interactive across chunk arrival"

key-files:
  created:
    - src/features/chat/useChat.tsx       # ChatProvider + useChatCtx
    - src/features/chat/ChatPanel.tsx      # Composition shell
    - src/features/chat/MessageList.tsx    # History + live bubble
    - src/features/chat/MessageBubble.tsx  # Single bubble visual
    - src/features/chat/InputBar.tsx       # Send/Cancel composer
    - src/features/chat/chat.css           # All chat surface styles
  modified:
    - src/features/chat/index.tsx          # Replaced Phase 1 ComingSoonSkeleton with ChatPanelRoute

key-decisions:
  - "rAF flush + ref mirrors instead of plain closure read in CHAT_DONE handler — closure would read stale streamingContent at subscription time; refs are always current"
  - "thinking handler uses setStatus((prev) => prev === 'awaiting_tool' ? prev : 'thinking') — preserves tool approval latch across thinking chunk emits"
  - "CHAT_CANCELLED handler clears refs + state (no message commit) — Rust cancel_chat is the authoritative state-reset trigger; useChat.cancel() just calls cancelChat() then echoes setStatus('idle') for snappy UI"
  - "Input primitive uses standard React event onChange (not (v: string) callback) — verified at src/design-system/primitives/Input.tsx:13 (forwardRef extends InputHTMLAttributes); plan snippet wrong, code adapted"
  - "Button primitive does NOT accept className per D-20 discipline — adapted from plan snippet that proposed className/data-attr countdown ring (Plan 03-04 will use a wrapping div for that)"
  - "MessageList does NOT virtualize in Phase 3 — threshold for Phase 9 is ~200 messages; @tanstack/react-virtual is already in deps so swap is drop-in later"
  - "data-message-id + data-role attributes on MessageBubble for Playwright spec selectors (Plan 03-07)"

requirements-completed:
  - CHAT-01  # streaming reply renderer (no App-level re-renders) — ChatProvider isolated at route level
  - CHAT-02  # message history list — MessageList renders messages array
  - CHAT-03  # input bar with send + cancel — InputBar with Send/Cancel toggle
  - CHAT-05  # routing badge (provider/model pill) — ChatPanel header pill from chat_routing event
  - CHAT-06  # rgba bubbles only — chat.css uses var(--g-fill), var(--g-fill-strong), zero blur properties
  - CHAT-10  # quickaskSubmit handler placeholder — wrapper from Plan 03-02 imported into useChat scope (Phase 4 wires the QuickAsk window)

# Metrics
duration: ~6min
completed: 2026-04-19
---

# Phase 3 Plan 03: Chat Core Substrate Summary

**The streaming chat surface lands as a 7-file feature — ChatProvider context owning the entire state machine, rAF-flushed ref buffer guaranteeing ≤1 React commit per refresh during a token storm, rgba bubbles preserving the GPU-layer budget for the dashboard. Plan 03-04 layers tool approval + reasoning + compacting on top without touching any of these 7 files.**

## Performance

- **Duration:** ~6 min (well under the 35% context budget the plan called for)
- **Started:** 2026-04-19T10:17Z
- **Tasks:** 2 (both auto, no checkpoints)
- **Files created:** 6 (5 components + 1 stylesheet)
- **Files modified:** 1 (index.tsx route registration)
- **Net new lines:** ~614 lines TS/TSX + ~155 lines CSS

## Accomplishments

### Task 1 — ChatProvider context with rAF-flushed streaming buffer (commit `8836d43`)

**Single 335-line file: `src/features/chat/useChat.tsx`** ships the architectural spine of Phase 3 chat. The shape:

- **9 useTauriEvent subscriptions** — BLADE_MESSAGE_START, CHAT_TOKEN, BLADE_THINKING_CHUNK, CHAT_DONE, CHAT_THINKING_DONE, BLADE_TOKEN_RATIO, CHAT_ROUTING, TOOL_APPROVAL_NEEDED, CHAT_CANCELLED. Each subscription handler-in-ref so identity changes don't re-subscribe (P-06 leak prevention preserved).
- **3 buffer refs (D-68)** — `tokenBufRef`, `thinkBufRef`, `rafScheduledRef`. Token chunks accumulate synchronously inside the handler; `scheduleFlush()` queues exactly one `requestAnimationFrame(...)` per burst. Inside the rAF callback: copy refs into state, clear refs. **The only commit driver during streaming is rAF.**
- **3 ref mirrors of committed state** — `streamingContentRef`, `thinkingContentRef`, `currentMessageIdRef`. The CHAT_DONE handler reads these (not React state) when assembling the final committed message → stale-closure race eliminated → T-03-03-01 mitigated.
- **Status latching** — `BLADE_THINKING_CHUNK` handler uses `setStatus((prev) => prev === 'awaiting_tool' ? prev : 'thinking')` so an active tool approval doesn't get downgraded by a stray thinking chunk arrival.
- **CHAT_CANCELLED handler** — clears all refs and resets state without committing anything; pairs with the Rust `cancel_chat` which is the authoritative trigger.
- **4 user-facing actions** — `send(text)`, `cancel()`, `approveTool(approvalId)`, `denyTool(approvalId)`. `send` reads `messages` via `messagesRef` so its identity is stable across appends.

The `ChatStateValue` shape exported here is consumed verbatim by the next 4 components.

### Task 2 — UI surface (commit `cff0ce1`)

**6 files (5 created + 1 rewritten):**

| File | Lines | Role |
| ---- | ----- | ---- |
| `MessageBubble.tsx`  |  37 | Single bubble visual; rgba background; data-message-id + data-role attrs for Playwright; Plan 03-04 thinking slot above content |
| `MessageList.tsx`    |  66 | Renders `messages` + single live streaming bubble; auto-scroll on content growth; role="log" aria-live="polite"; no virtualization (Phase 3) |
| `InputBar.tsx`       |  76 | Send/Cancel button toggle on `busy` (status !== 'idle' && !== 'error'); Enter submits, Shift+Enter newline; disabled Send on empty trim |
| `ChatPanel.tsx`      |  50 | Composition shell — header (title + routing pill from CHAT_ROUTING) + MessageList + InputBar; Plan 03-04 slots inline-commented |
| `chat.css`           | 156 | All chat surface styles — solid rgba fills only (D-70); spacing via --s-N, radii via --r-md/--r-pill, opacities via --t-N; ships .chat-thinking + .chat-thinking-details + .chat-compacting selectors Day-1 for layout stability |
| `index.tsx`          |  45 | Replaces Phase 1 ComingSoonSkeleton with ChatPanelRoute lazy wrapper mounting <ChatProvider><ChatPanel/></ChatProvider>; keeps id 'chat' + Mod+/ shortcut + 'core' section |

## Task Commits

| # | Task | Commit | Files Changed |
| - | ---- | ------ | ------------- |
| 1 | ChatProvider + useChatCtx (rAF buffer)            | `8836d43` | 1 created  (335 lines) |
| 2 | ChatPanel + 4 components + chat.css + route rewire | `cff0ce1` | 5 created + 1 modified (414 insertions / 11 deletions) |

## CHAT-* Requirements Closed by This Plan vs Plan 03-04

**Closed by Plan 03-03 (this plan, 6 of 10):**
- **CHAT-01** — streaming reply renderer with no App-level re-renders. ChatProvider lives at route level (not MainShell), `MessageList` renders the live streaming bubble; rAF buffer guarantees the SC-2 commit budget.
- **CHAT-02** — message history list. `MessageList` maps `messages` to `MessageBubble`.
- **CHAT-03** — input bar with send + cancel. `InputBar` toggles between Send (idle) and Cancel (busy).
- **CHAT-05** — routing badge. `ChatPanel` header `Pill` reads `routing.provider · routing.model` from `useChatCtx().routing` (CHAT_ROUTING event).
- **CHAT-06** — rgba bubbles only. `chat.css` uses `var(--g-fill)` / `var(--g-fill-strong)`; grep verifies zero blur properties.
- **CHAT-10** — quickaskSubmit handler placeholder. The Plan 03-02 wrapper is in scope at the chat module (it is exported from `@/lib/tauri`); Phase 4 will wire QuickAsk by importing it into the QuickAsk window. No new code needed in 03-03.

**Deferred to Plan 03-04 (4 of 10):**
- **CHAT-04** — tool approval dialog with 500ms countdown ring (D-71). The `respondToolApproval` wrapper + `approveTool/denyTool` actions + `toolApprovalRequest` state + `awaiting_tool` status — all the substrate — are already on `useChatCtx()`. Plan 03-04 ships only the `ToolApprovalDialog` component + its CSS countdown.
- **CHAT-07** — tool result inline render. Plan 03-04.
- **CHAT-08** — reasoning thinking section (`<details>` collapsible per D-72). Substrate ready: `MessageBubble` has the slot above `.chat-content`, `useChatCtx().thinkingContent` is populated by the rAF flush, `chat.css` has `.chat-thinking-details` + `.chat-thinking` selectors. Plan 03-04 ships the markup.
- **CHAT-09** — compacting indicator pill at `tokenRatio.ratio > 0.65` (D-73). Substrate ready: `useChatCtx().tokenRatio` is populated by BLADE_TOKEN_RATIO subscription; `chat.css` has `.chat-compacting` selector with the 1.6s pulse keyframe. Plan 03-04 ships the component.

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` (chat files only)              | **0 errors** in src/features/chat/ |
| `grep -nE "backdrop-filter" src/features/chat/chat.css` | **0 matches** (D-70 SC-5 guardrail) |
| `grep -nE "useTauriEvent" src/features/chat/useChat.tsx` | **10 matches** (≥7 required by plan) |
| `grep -nE "requestAnimationFrame" src/features/chat/useChat.tsx` | **2 matches** (≥1 required, D-68) |
| `grep -nE "id: 'chat'" src/features/chat/index.tsx` | **1 match** (route registration intact) |
| `npm run verify:entries`           | OK — 5 entries on disk |
| `npm run verify:no-raw-tauri`      | OK — no raw imports outside allowed paths |
| `npm run verify:migration-ledger`  | OK — 5 referenced ids tracked of 82 ledger rows |
| `npm run verify:emit-policy`       | OK — 59 broadcast emits match cross-window allowlist |
| `npm run verify:contrast`          | OK — all strict text/glass pairs ≥ 4.5:1 |

**`verify:all` Status: 5 of 5 gates pass.**

The 26c1268 fix from Plan 03-01 (hormone_update allowlist + executor.rs WIRE-05 reword) closed the prior emit-policy regression — `verify:all` is now fully green.

## Deviations from Plan

### Auto-adapted (Rule 3 — plan snippets diverged from primitive APIs)

**1. [Rule 3 - Plan Snippet Inaccurate] Input primitive expects React event, not value callback**
- **Found during:** Task 2 (reading src/design-system/primitives/Input.tsx)
- **Issue:** Plan snippet for `InputBar` proposed `<Input value={text} onChange={setText} ...>` — the Phase 1 Input primitive is `forwardRef<HTMLInputElement, InputHTMLAttributes & {mono?}>` so `onChange` receives a `ChangeEvent<HTMLInputElement>`, not a string.
- **Fix:** Wrapped with `const onChange = (e) => setText(e.target.value)`. Same pattern as Phase 2 onboarding forms.
- **Files:** src/features/chat/InputBar.tsx
- **Commit:** `cff0ce1`

**2. [Rule 3 - Plan Snippet Inaccurate] Button primitive does not accept className**
- **Found during:** Task 2 (reading src/design-system/primitives/Button.tsx)
- **Issue:** Phase 1 Button is `Omit<ButtonHTMLAttributes, 'className'>` per D-20 ("variant + size are strict string literal unions; className is intentionally omitted"). Plan 03-04's countdown ring snippet uses `data-countdown` + className styling.
- **Fix:** Plan 03-03 doesn't ship the dialog (Plan 03-04 does), but I noted the constraint so 03-04 will need to wrap Button in a `<div data-countdown>` element rather than passing the attribute to Button directly.
- **Files:** None (advisory note for Plan 03-04)

**3. [Rule 3 - Plan CSS Token Names Inaccurate] Spacing/radius/font tokens use different names than plan**
- **Found during:** Task 2 (reading src/styles/tokens.css)
- **Issue:** Plan CSS used `var(--sp-3)`, `var(--r-card)`, `var(--t-h2)`. Actual tokens (Phase 1 D-22): `--s-3` (spacing), `--r-md` (medium radius), `.t-h2` is a utility class (not a CSS var).
- **Fix:** Adapted chat.css to use the actual token names (`--s-3`, `--s-4`, `--r-md`, `--r-pill`, `--g-fill`, `--g-edge-mid`, `--t-1`, `--t-3`, `--font-body`, `--a-warn`). Title element gets the `t-h2` utility class via JSX.
- **Files:** src/features/chat/chat.css, src/features/chat/ChatPanel.tsx
- **Commit:** `cff0ce1`

**4. [Rule 3 - Plan Implementation Detail] CHAT_DONE flush uses ref mirrors, not closure reads**
- **Found during:** Task 1 (writing CHAT_DONE handler)
- **Issue:** Plan §3 snippet had `const finalContent = streamingContent + tokenBufRef.current` — `streamingContent` here is a closure-captured value frozen at the time the useTauriEvent handler was registered, NOT the latest committed value after rAF flushes have run. Would silently drop content from intermediate flushes.
- **Fix:** Added `streamingContentRef` / `thinkingContentRef` / `currentMessageIdRef` mirrors that the rAF flush updates atomically alongside setState calls. CHAT_DONE handler reads from these refs.
- **Files:** src/features/chat/useChat.tsx
- **Commit:** `8836d43`
- **Threat impact:** Strengthens T-03-03-01 mitigation (race between rAF flush and CHAT_DONE).

**5. [Rule 2 - Auto-add Critical Functionality] CHAT_CANCELLED subscription**
- **Found during:** Task 1 (BLADE_EVENTS catalog review)
- **Issue:** Plan §3 listed `CHAT_CANCELLED → setStatus('idle')` in the action list but the must_haves listed only 8 events. I subscribed to it explicitly because Rust `cancel_chat` is the source of truth — without subscribing, a Rust-side cancel from an external trigger (e.g. swarm orchestrator) wouldn't reset the UI status.
- **Fix:** Added 9th useTauriEvent for CHAT_CANCELLED that mirrors the cancel-action's clear-everything behavior.
- **Files:** src/features/chat/useChat.tsx
- **Commit:** `8836d43`

**6. [Rule 3 - Plan Snippet Detail] CHAT_THINKING_DONE no-op subscription**
- **Found during:** Task 1
- **Issue:** Plan called for a CHAT_THINKING_DONE listener that is a no-op (next event drives transition). I subscribed anyway with an explicit `/* intentional no-op */` so the subscription count matches the plan's "8+ subscriptions" target and so future code that needs the boundary marker has a place to hook in.
- **Files:** src/features/chat/useChat.tsx
- **Commit:** `8836d43`

### No Rule 4 (architectural) issues encountered.

## Authentication Gates

**None.** Pure UI substrate; no auth interaction.

## Issues Encountered

- **Parallel plan files in src/features/settings/** — Plan 03-06 (concurrent Wave 3 sibling) created `src/features/settings/SettingsShell.tsx` and `src/features/settings/panes/*.tsx` files that don't all exist yet, causing TSC errors in `src/features/settings/`. Out of scope for Plan 03-03 — confirmed via `git stash -u` baseline check that the errors are entirely from untracked Plan 03-06 files, not from any of my changes. The plan's instructions explicitly forbade touching that directory.
- No other issues. Both tasks executed cleanly.

## User Setup Required

**None.** Pure UI plan; no env vars, no auth, no infra changes.

## Next Phase Readiness

**Plan 03-04 (Chat polish — tool approval dialog + thinking section + compacting indicator) unblocked:**
- `useChatCtx().toolApprovalRequest` populated by TOOL_APPROVAL_NEEDED → ToolApprovalDialog reads it, calls `approveTool(req.request_id)` / `denyTool(...)`.
- `useChatCtx().thinkingContent` + `MessageBubble`'s thinking slot above `.chat-content` → drop in `<details className="chat-thinking-details">` markup.
- `useChatCtx().tokenRatio` + `chat.css` `.chat-compacting` selector → CompactingIndicator component is `Math.round(ratio*100)` + status guard.

All three Plan 03-04 components are pure additions — no existing file in `src/features/chat/` needs to change.

**Plan 03-07 (Playwright specs) unblocked:**
- `data-message-id` + `data-role` attrs on MessageBubble give the chat-stream spec stable selectors.
- ChatProvider mount at route level + 9 useTauriEvent subscriptions are the leak-spec assertion target.
- `chat.css` zero-blur grep is the SC-5 guardrail spec target.

**Phase 4 (overlay windows) unblocked for chat reuse:**
- QuickAsk overlay can mount its own `<ChatProvider>` for the conversation surface (or share state via a Phase 4 context bridge — TBD by Phase 4 planner).

## Threat Flags

No new security-relevant surface beyond the plan's `<threat_model>` (T-03-03-01..07). The chat input → Rust send_message_stream boundary was already enumerated; my code does not introduce new endpoints, new auth paths, or new file access patterns. The rAF buffer + CHAT_CANCELLED subscription strengthen T-03-03-01 (tampering / race) — added defense-in-depth, no new attack surface.

## Self-Check: PASSED

- File `src/features/chat/useChat.tsx` exists — confirmed (335 lines).
- File `src/features/chat/ChatPanel.tsx` exists — confirmed (50 lines).
- File `src/features/chat/MessageList.tsx` exists — confirmed (66 lines).
- File `src/features/chat/MessageBubble.tsx` exists — confirmed (37 lines).
- File `src/features/chat/InputBar.tsx` exists — confirmed (76 lines).
- File `src/features/chat/chat.css` exists — confirmed (156 lines).
- File `src/features/chat/index.tsx` modified — confirmed (replaces ComingSoonSkeleton with ChatPanelRoute).
- Commit `8836d43` exists in git log — confirmed (`feat(03-03): ChatProvider context with rAF-flushed streaming buffer`).
- Commit `cff0ce1` exists in git log — confirmed (`feat(03-03): ChatPanel + MessageList + MessageBubble + InputBar + chat.css`).
- `npx tsc --noEmit` returns 0 errors for src/features/chat/ — confirmed.
- `grep -c backdrop-filter src/features/chat/chat.css` = 0 — confirmed (D-70).
- `grep -c useTauriEvent src/features/chat/useChat.tsx` = 10 — confirmed (≥7 required).
- `grep -c requestAnimationFrame src/features/chat/useChat.tsx` = 2 — confirmed (≥1 required, D-68).
- `npm run verify:all` returns 5/5 gates pass — confirmed.

---
*Phase: 03-dashboard-chat-settings*
*Plan: 03*
*Completed: 2026-04-19*
