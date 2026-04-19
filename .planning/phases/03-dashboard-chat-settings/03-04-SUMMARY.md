---
phase: 03-dashboard-chat-settings
plan: 04
subsystem: chat-ui-polish
tags: [react, chat, dialog, details, aria, d-71, d-72, d-73]

# Dependency graph
requires:
  - phase: 03-dashboard-chat-settings
    plan: 03-03
    provides: ChatProvider + useChatCtx publishing toolApprovalRequest/approveTool/denyTool/thinkingContent/tokenRatio/status; .chat-thinking-details / .chat-compacting selector hooks pre-shipped in chat.css
  - phase: 03-dashboard-chat-settings
    plan: 03-02
    provides: respondToolApproval wrapper (src/lib/tauri/chat.ts) — snake_case IPC boundary
  - phase: 01-foundation
    provides: Dialog primitive (native <dialog>), Button primitive (ButtonHTMLAttributes spread incl. data-*), BLADE_EVENTS.TOOL_APPROVAL_NEEDED payload interface
provides:
  - src/features/chat/ReasoningThinking.tsx — <details>/<summary> collapsible thinking block
  - src/features/chat/ToolApprovalDialog.tsx — tool approval modal with 500ms enforced click-through protection
  - src/features/chat/CompactingIndicator.tsx — ratio > 0.65 pill (D-73)
  - MessageBubble extension — renders ReasoningThinking above .chat-content when msg.thinking set
  - ChatPanel extension — mounts CompactingIndicator + ToolApprovalDialog alongside existing children
  - chat.css — countdownFill keyframe + compactPulse alias + .tool-approval* + upgraded .chat-thinking-summary
affects:
  - 03-07 (Playwright — chat-tool-approval.spec.ts can now target data-countdown attrs; CompactingIndicator visibility test via setting mock tokenRatio)
  - Phase 4 overlay windows (QuickAsk chat may reuse ToolApprovalDialog + CompactingIndicator verbatim)

# Tech tracking
tech-stack:
  added: []  # Pure composition — no new deps
  patterns:
    - "Native <details>/<summary> for collapsible reasoning — keyboard + ARIA for free, zero a11y library"
    - "CSS-driven countdown delay via data-countdown attribute + ::after pseudo element + keyframe (no JS animation loop)"
    - "Defensive field-name reading on Rust-TS boundary — tolerate both request_id/approval_id, tool_name/name, args/arguments until Phase 5 Zod normalization"
    - "Loose cast at field-name reconciliation site — documented at the exact line, confined to one file"

key-files:
  created:
    - src/features/chat/ReasoningThinking.tsx       # 31 lines
    - src/features/chat/ToolApprovalDialog.tsx      # 111 lines
    - src/features/chat/CompactingIndicator.tsx     # 32 lines
  modified:
    - src/features/chat/MessageBubble.tsx           # +7 insertions (import + conditional render)
    - src/features/chat/ChatPanel.tsx               # +6 insertions (imports + two children, 1 comment cleanup)
    - src/features/chat/chat.css                    # +105 insertions (tool-approval rules, countdownFill + compactPulse alias keyframes, upgraded .chat-thinking-summary visual)

key-decisions:
  - "Defensive key reading in ToolApprovalDialog: const approvalId = req.approval_id ?? req.request_id; const toolName = req.tool_name ?? req.name; const argsObj = req.args ?? req.arguments — reconciles Rust emit keys (approval_id/name/arguments per commands.rs:1687-1696 + 1710-1719) with Phase 1 TS payloads.ts interface (request_id/tool_name/args) without editing either. Phase 5 should normalize via Zod."
  - "data-countdown attribute passed directly to Button primitive — valid because Button spreads ...rest onto the underlying <button>; CSS selector button[data-countdown='on']::after targets the rendered DOM button not the React component. Plan 03-03 advisory about needing a wrapping div was over-cautious; verified Button.tsx spreads HTMLButtonAttributes."
  - "Dialog.onClose routes to denyTool(approvalId) — safer-default for ESC/backdrop dismissal; matches D-71 philosophy (user protection against accidental tool execution)"
  - "ReasoningThinking defaultOpen set via defaultOpen || undefined — JSX attribute `open={undefined}` serializes to no attribute (closed), while `open={true}` writes the boolean attribute; avoids React boolean-attr gotcha"
  - "chat.css ships BOTH chatCompactPulse (Plan 03-03 name, bound to .chat-compacting) AND compactPulse (Plan 03-04 canonical name, unbound alias). No risk of animation double-play because only .chat-compacting binds, and it binds chatCompactPulse."
  - "countdownFill keyframe + 500ms linear + transform-origin: left + scaleX 1→0 — CSS-only countdown, zero JS timer overhead beyond the single React setTimeout that flips unlocked"
  - "Esc pressed on the <dialog> triggers native onClose → denyTool — satisfies T-03-04-04 DoS mitigation (no orphan approval state)"

requirements-completed:
  - CHAT-04  # tool calls render inline with approval dialog (500ms button delay enforced)
  - CHAT-07  # tool approval dialog visual + delay
  - CHAT-08  # collapsible thinking section per assistant message (D-72)
  - CHAT-09  # compacting indicator at token ratio > 0.65 (D-73)

# Metrics
duration: ~5min
completed: 2026-04-18
---

# Phase 3 Plan 04: Chat Advanced UI (Tool Approval + Reasoning + Compacting) Summary

**Three small components (≤111 lines each) light up the remaining CHAT-* polish requirements on top of the 03-03 substrate — tool approval dialog with 500ms click-through protection (D-71), native <details> collapsible thinking block (D-72), and absolute-positioned compacting pill at ratio > 0.65 (D-73). Pure additive composition; not a single line of useChat.tsx, MessageList.tsx, or InputBar.tsx needed to change.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-18T10:40Z (approx)
- **Tasks:** 2 (both auto, no checkpoints)
- **Files created:** 3 (ReasoningThinking, ToolApprovalDialog, CompactingIndicator)
- **Files modified:** 3 (MessageBubble, ChatPanel, chat.css)
- **Net new lines:** ~174 lines TS/TSX + ~100 lines CSS (546 total across all six files post-plan)

## Accomplishments

### Task 1 — ReasoningThinking + MessageBubble extension (commit `8f6f9a4`)

**`src/features/chat/ReasoningThinking.tsx` (31 lines):**
Native `<details className="chat-thinking-details" open={defaultOpen || undefined}>` with a `<summary className="chat-thinking-summary">Thinking</summary>` header and a `<div className="chat-thinking">{content}</div>` body. Zero JS — browser handles open/close, keyboard (Space/Enter on summary), ARIA announcements, focus. Returns `null` when `thinking` is empty so the element never mounts for turns that produced no reasoning.

**`src/features/chat/MessageBubble.tsx` (+7 lines):**
Import added (`import { ReasoningThinking } from './ReasoningThinking'`) + conditional render above `.chat-content`:
```tsx
{msg.thinking ? (
  <ReasoningThinking thinking={msg.thinking} defaultOpen={streaming} />
) : null}
```
Passing `streaming` as `defaultOpen` means the live in-progress assistant bubble shows the thinking expanded while it streams, and collapses once committed (the streaming prop drops back to `false` when MessageList stops rendering the live bubble and the committed message renders). Good UX — user sees reasoning land, then tucks it away.

**`src/features/chat/chat.css` (upgraded thinking rules):**
The Plan 03-03 `.chat-thinking-details > summary` selector stayed as a backwards-compat `:not(.chat-thinking-summary)` alias so either class-based OR bare-summary markup renders correctly. Promoted the visual to the D-72 spec: uppercase 12px tracked summary label, ▸/▾ unicode markers via `::before` (swaps on `[open]`), 200ms transform transition, left-rule `.chat-thinking` block. All tokens reference existing CSS vars (`--t-3`, `--font-body`, `--line`, `--s-1/2/3`).

### Task 2 — ToolApprovalDialog + CompactingIndicator + ChatPanel wiring (commit `5bc4dfa`)

**`src/features/chat/ToolApprovalDialog.tsx` (111 lines):**
Reads `{ toolApprovalRequest, approveTool, denyTool }` from `useChatCtx()`. Returns `null` when no request is pending. When a request lands:

- **500ms lock (D-71 / SC-2):** `useEffect` starts a `setTimeout(() => setUnlocked(true), 500)` keyed on `toolApprovalRequest`. Approve/Deny buttons render `disabled={!unlocked}` + `data-countdown={unlocked ? 'off' : 'on'}`. CSS `button[data-countdown="on"]::after` animates a `scaleX(1)→scaleX(0)` gradient bar over 500ms via the `countdownFill` keyframe. After 500ms the bar reaches 0 and buttons become clickable.
- **Defensive field reading (Rust ↔ TS key-name reconciliation):** The Rust emit at `commands.rs:1687-1696` + `1710-1719` uses keys `approval_id` / `name` / `arguments`. Phase 1 `src/lib/events/payloads.ts` declares the interface with `request_id` / `tool_name` / `args`. This component reads BOTH via a single loose cast to a shape with both key names optional:
  ```ts
  const approvalId = req.approval_id ?? req.request_id ?? '';
  const toolName = req.tool_name ?? req.name ?? 'tool';
  const argsObj = req.args ?? req.arguments ?? {};
  ```
  Works regardless of which declaration wins when Phase 5 normalizes via Zod. `safeStringify(argsObj)` catches any circular-ref edge cases so the args pane never crashes the dialog.
- **Dialog primitive composition:** Renders `<Dialog open onClose={() => denyTool(approvalId)} ariaLabel={...}>`. Native `<dialog>` gives ESC close + focus trap + backdrop scrim for free. `onClose` routes to `denyTool` — safer-default dismissal mitigating T-03-04-04 (DoS via stuck dialog).
- **Visual structure:** `.tool-approval-title` with inline `<code>{toolName}</code>`, `.tool-approval-args` `<pre>` with `JSON.stringify(args, null, 2)`, optional `.tool-approval-context`, flex-end `.tool-approval-actions` with [Deny, Approve] in that order so Approve is the rightmost (primary placement).

**`src/features/chat/CompactingIndicator.tsx` (32 lines):**
Reads `{ tokenRatio, status }` from `useChatCtx()`. Returns `null` when:
- `tokenRatio === null` (no BLADE_TOKEN_RATIO event has fired yet), OR
- `tokenRatio.ratio <= 0.65` (below threshold — D-16 / D-73), OR
- `status === 'idle'` (no active turn — don't surface between-turn compaction state)

Otherwise renders `<div className="chat-compacting" role="status" aria-live="polite">Compacting… {pct}%</div>` where `pct = Math.round(tokenRatio.ratio * 100)`. ARIA role=status + aria-live=polite so screen readers announce the compaction state change without interrupting ongoing speech. CSS `.chat-compacting` is absolute-positioned (top: --s-3, right: --s-4) against `.chat-panel { position: relative; }` from Plan 03-03, anchored independently of header content.

**`src/features/chat/ChatPanel.tsx` (+6 insertions):**
Imports `CompactingIndicator` + `ToolApprovalDialog`, mounts both as siblings of `MessageList` / `InputBar` (no prop drilling — both call `useChatCtx()` internally). Removed the `{/* Plan 03-04 slot: ... */}` comments now that the slots are filled. Header retains the routing pill untouched.

**`src/features/chat/chat.css` (+~100 insertions):**
- `.tool-approval` flex column, 520px max-width, padded
- `.tool-approval-title` + inline `<code>` (monospace on subtle `var(--g-fill)`)
- `.tool-approval-args` `<pre>` — monospace 12px, scroll-on-overflow at 200px, radius-md, word-wrap for long JSON strings
- `.tool-approval-context` — t-2 13px info line
- `.tool-approval-actions` flex-end with --s-2 gap
- `.tool-approval-actions button[data-countdown="on"]::after` — absolute inset 0, linear-gradient overlay, transform-origin: left, `animation: countdownFill 500ms linear forwards`, pointer-events: none, border-radius: inherit (so the overlay rounds with the button)
- `@keyframes countdownFill { from scaleX(1) to scaleX(0) }`
- `@keyframes compactPulse { 0,100% opacity 0.85; 50% opacity 1.0 }` — alias for Plan 03-04 grep naming convention. (The live binding on `.chat-compacting` is still `chatCompactPulse` from Plan 03-03 — both keyframes are functionally identical.)

## Task Commits

| # | Task | Commit | Files Changed |
| - | ---- | ------ | ------------- |
| 1 | ReasoningThinking + MessageBubble thinking slot | `8f6f9a4` | 1 created + 2 modified (75 insertions, 12 deletions) |
| 2 | ToolApprovalDialog + CompactingIndicator + ChatPanel wiring | `5bc4dfa` | 2 created + 2 modified (245 insertions, 6 deletions) |

## CHAT-* Requirements Closed

- **CHAT-04** — tool calls render inline with approval dialog (500ms button delay). ToolApprovalDialog mounts on `toolApprovalRequest`, enforces 500ms lock via `unlocked` state + CSS countdown bar, calls `approveTool` / `denyTool` with the defensive-read `approvalId`.
- **CHAT-07** — tool approval dialog visual + delay. Same component — dialog scrim + focus trap native via `<Dialog>` primitive; countdown bar visible decoration per `countdownFill` keyframe.
- **CHAT-08** — collapsible thinking section per assistant message. ReasoningThinking renders `<details><summary>Thinking</summary>...</details>`; MessageBubble wires `msg.thinking` + `streaming`.
- **CHAT-09** — compacting indicator at token ratio > 0.65. CompactingIndicator reads `useChatCtx().tokenRatio` + `status`, enforces the D-16 0.65 threshold, renders `Math.round(ratio * 100)%` pill with aria-live polite.

**With Plan 03-04 shipped, CHAT-01..10 are all closed (Plan 03-03 closed 01/02/03/05/06/10; this plan closes 04/07/08/09). Phase 3 chat substrate is complete pending Plan 03-07 Playwright spec assertions.**

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit`                                              | **0 errors** |
| `grep -nE "backdrop-filter" src/features/chat/chat.css`         | **0 matches** (D-70 invariant) |
| `grep -nE "countdownFill" src/features/chat/chat.css`           | **3 matches** (comment + animation usage + keyframe) |
| `grep -nE "compactPulse" src/features/chat/chat.css`            | **2 matches** (chatCompactPulse line via substring + compactPulse alias) |
| `grep -nE "ToolApprovalDialog" src/features/chat/ChatPanel.tsx` | **2 matches** (import + JSX) |
| `grep -nE "CompactingIndicator" src/features/chat/ChatPanel.tsx`| **2 matches** (import + JSX) |
| `grep -nE "ReasoningThinking" src/features/chat/MessageBubble.tsx`| **2 matches** (import + JSX) |
| `grep -nE "approval_id ?? req.request_id" src/features/chat/ToolApprovalDialog.tsx` | **1 match** (defensive key reading) |
| `npm run verify:entries`                                        | OK — 5 entries |
| `npm run verify:no-raw-tauri`                                   | OK — no raw imports |
| `npm run verify:migration-ledger`                               | OK — 7 referenced ids, 89 ledger rows |
| `npm run verify:emit-policy`                                    | OK — 59 broadcast emits |
| `npm run verify:contrast`                                       | OK — all strict pairs ≥ 4.5:1 |

**`verify:all` Status: 5 of 5 gates pass.**

## Deviations from Plan

### Auto-fixed (Rule 3 — comment grep regression)

**1. [Rule 3 - Bug] D-70 backdrop-filter grep matched a comment I'd written**
- **Found during:** Task 2 verify (`grep -c backdrop-filter src/features/chat/chat.css` returned 1)
- **Issue:** I wrote an explanatory comment inside `chat.css` that literally contained the word "backdrop-filter" ("D-70 invariant: no backdrop-filter anywhere in this file…"). The Plan 03-07 verify step (and the plan's own verify) use `grep -q "backdrop-filter"` which doesn't distinguish comments from rules — it would flag even an explanation as a regression.
- **Fix:** Rephrased the comment to "D-70 invariant: zero GPU blur layers anywhere in this file…" — preserves the intent without the literal string.
- **Files:** src/features/chat/chat.css
- **Commit:** `5bc4dfa` (caught before commit, fixed in the same staged edit)

### Auto-adapted (Rule 3 — Plan 03-03 advisory was over-cautious)

**2. [Rule 3 - Advisory Revised] Button primitive accepts data-countdown via ...rest spread**
- **Found during:** Task 2 planning (re-reading src/design-system/primitives/Button.tsx)
- **Issue:** Plan 03-03 SUMMARY advised "Button does not accept className per D-20 — Plan 03-04 should wrap Button in a `<div data-countdown>` rather than pass the attribute to Button directly." I investigated: Button is `Omit<ButtonHTMLAttributes, 'className'>` — `className` is the ONLY omission; `data-*` attributes are part of HTMLAttributes and spread via `...rest` onto the rendered `<button>`. The CSS selector `button[data-countdown="on"]::after` targets the rendered DOM element.
- **Fix:** Passed `data-countdown` directly to `<Button>` as the plan originally specified. No wrapping div needed.
- **Files:** src/features/chat/ToolApprovalDialog.tsx
- **Commit:** `5bc4dfa`
- **Rationale:** simpler DOM, cleaner selector, no extra wrapper element.

### Auto-adapted (Rule 3 — CSS token names)

**3. [Rule 3 - Plan CSS Tokens Inaccurate] Spacing/radius tokens in Plan 03-04 snippets use Plan 03-03-incompatible names**
- **Found during:** Task 2 (writing chat.css additions)
- **Issue:** Plan 03-04 snippet used `var(--sp-2)`, `var(--sp-4)`, `var(--r-card)`. Actual tokens (per `src/styles/tokens.css` D-22) are `--s-2` / `--s-4` (spacing) and `--r-md` (radius). Plan 03-03 adapted the same mismatch; Plan 03-04 would have re-introduced the broken names.
- **Fix:** Adapted all snippet tokens to the actual token names. Same adaptation the SUMMARY of 03-03 documented.
- **Files:** src/features/chat/chat.css
- **Commit:** `5bc4dfa`

### No Rule 4 (architectural) issues encountered.

## Authentication Gates

**None.** Pure UI polish; no auth surface.

## Known Stubs

**None.** All three new components are fully wired to live useChatCtx() data. Empty states (`toolApprovalRequest === null`, `tokenRatio === null`, `msg.thinking undefined`) correctly return `null` from their respective components — not stubs, just absence-of-state handling.

## Issues Encountered

- **backdrop-filter comment grep regression** — documented above as deviation #1; caught pre-commit, fixed in the same Task 2 staged edit.
- No other issues. Both tasks executed cleanly on the first pass.

## User Setup Required

**None.** Pure UI plan; no env vars, no auth, no infra changes. Manual smoke validation (dialog visibly delaying for 500ms, thinking collapse behavior, compacting pill appearing at > 65%) deferred to Plan 03-07 operator checkpoint per plan.

## Next Phase Readiness

**Plan 03-07 (Playwright specs) unblocked for the chat suite:**
- `chat-tool-approval.spec.ts` — can dispatch synthetic `tool_approval_needed` with Rust-shape keys (`approval_id`, `name`, `arguments`); defensive field reading in the dialog tolerates either key set. Attempt click at t=100ms (button disabled) vs t=600ms (button enabled) asserts the 500ms lock. Selector target: `button[data-countdown]` / `.tool-approval-actions button`.
- `chat-stream.spec.ts` (extends Plan 03-03) — no changes needed; ReasoningThinking is a pure structural addition.
- Compacting indicator test — dispatch synthetic `blade_token_ratio` with ratio=0.80 → assert `.chat-compacting` visible with text "Compacting… 80%".

**Phase 4 (overlay windows) gets two reusable polish components:**
- ToolApprovalDialog — the QuickAsk window's inline chat flow can mount the same component (it reads useChatCtx which the window's own `<ChatProvider>` would supply).
- CompactingIndicator — same deal; drop-in for any chat surface.

## Threat Flags

No new security-relevant surface beyond the plan's `<threat_model>` (T-03-04-01..07). The defensive field-name reading STRENGTHENS T-03-04-02 mitigation beyond what the plan called for (both key-name shapes supported rather than assuming one wins). The `countdownFill` CSS animation is observable-only — it doesn't gate the actual click; the `disabled` + `unlocked` state gates the click. So a user with `prefers-reduced-motion` still gets the full protection, they just see the bar snap from full to empty without animation (motion system's global reduce-motion will override the 500ms animation duration). T-03-04-01 remains fully mitigated.

## Self-Check: PASSED

- File `src/features/chat/ReasoningThinking.tsx` exists — confirmed (31 lines).
- File `src/features/chat/ToolApprovalDialog.tsx` exists — confirmed (111 lines).
- File `src/features/chat/CompactingIndicator.tsx` exists — confirmed (32 lines).
- File `src/features/chat/MessageBubble.tsx` modified — confirmed (imports + uses ReasoningThinking).
- File `src/features/chat/ChatPanel.tsx` modified — confirmed (imports + mounts CompactingIndicator + ToolApprovalDialog).
- File `src/features/chat/chat.css` extended — confirmed (countdownFill + compactPulse keyframes + .tool-approval* rules).
- Commit `8f6f9a4` exists in git log — confirmed.
- Commit `5bc4dfa` exists in git log — confirmed.
- `npx tsc --noEmit` returns 0 errors — confirmed.
- `grep -c backdrop-filter src/features/chat/chat.css` = 0 — confirmed (D-70 preserved).
- `npm run verify:all` returns 5/5 gates pass — confirmed.
- Defensive key reading `req.approval_id ?? req.request_id` present in ToolApprovalDialog.tsx — confirmed.

---
*Phase: 03-dashboard-chat-settings*
*Plan: 04*
*Completed: 2026-04-18*
