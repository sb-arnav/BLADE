---
phase: 18
plan: 11
subsystem: frontend / chat
tags: [frontend, react, chat, tauri-wrappers, consent-dialog, jarvis, wave-4]
requirements: [JARVIS-05, JARVIS-11]
dependency_graph:
  requires:
    - "Plan 18-04 (event registry — BLADE_EVENTS.JARVIS_INTERCEPT, CONSENT_REQUEST)"
    - "Plan 18-04 (payload interfaces — JarvisInterceptPayload, ConsentRequestPayload)"
    - "Plan 18-05 (ego.rs — emit_jarvis_intercept emit site)"
    - "Plan 18-06 (intent_router.rs + consent.rs commands)"
    - "Plan 18-09 (jarvis_dispatch.rs — emit_consent_request emit site)"
    - "Plan 18-10 (commands.rs ego integration — jarvis_intercept now fires for real)"
  provides:
    - "src/lib/tauri/admin.ts: 6 typed Tauri wrappers + 3 type aliases"
    - "src/features/chat/JarvisPill.tsx: 4-state inline pill component"
    - "src/features/chat/ConsentDialog.tsx: consent modal with T-18-03 plain-text render"
    - "src/features/chat/MessageList.tsx: JARVIS_INTERCEPT subscriber + pill render"
    - "src/features/chat/ChatPanel.tsx: CONSENT_REQUEST subscriber + dialog mount"
    - "src/features/chat/chat.css: jarvis-pill + consent-dialog selectors (zero ghost tokens)"
  affects:
    - "Plan 18-12 cold-install demo (exercises both surfaces end-to-end)"
    - "Plan 18-14 Task 4 (REPLACES the re-invoke handler in ChatPanel.tsx with consentRespond + tokio::oneshot)"
tech-stack:
  added: []
  patterns:
    - "Phase 17 admin.ts wrapper pattern (banner + @see docblock + invokeTyped) — 6 new wrappers"
    - "Phase 17 Doctor Dialog primitive composition — ConsentDialog wraps Dialog"
    - "Activity-log handler-in-ref pattern — useTauriEvent + useState + interceptRef for auto-clear"
    - "T-18-03 render-layer lock — React text-node interpolation only (no innerHTML render path)"
key-files:
  created:
    - "src/features/chat/JarvisPill.tsx (78 lines)"
    - "src/features/chat/ConsentDialog.tsx (115 lines)"
  modified:
    - "src/lib/tauri/admin.ts (+138 lines — Phase 18 wrapper block)"
    - "src/features/chat/MessageList.tsx (+38 lines — JARVIS_INTERCEPT subscriber + pill render)"
    - "src/features/chat/ChatPanel.tsx (+86 lines — CONSENT_REQUEST subscriber + dialog mount + handler)"
    - "src/features/chat/chat.css (+128 lines — jarvis-pill + consent-dialog selectors)"
decisions:
  - "Wire-form mirrored verbatim from Rust serde: tag='kind', rename_all='snake_case'. EgoVerdict / IntentClass / DispatchResult use TypeScript discriminated unions on a literal `kind` field — TS compiler enforces correctness at every dispatch site."
  - "consentSetDecision compile-time forbids 'allow_once' via TS literal-union ('allow_always' | 'denied'). Rust validates at runtime too (T-18-CARRY-15) — defense in depth."
  - "JarvisPill auto-clear is owned by MessageList (not useChat). Effect keyed on currentMessageId, reads intercept via ref so streaming token tics don't churn. Hard-refused stays sticky until user dismisses (D-18)."
  - "ConsentDialog content_preview rendered via <pre>{content_preview}</pre> — React auto-escapes text nodes (T-18-03 mitigation). Backend already safe_slices the preview to 200 chars at emit boundary (jarvis_dispatch.rs:69). Defense in depth."
  - "ChatPanel handleDecide ships Wave-4 SIMPLIFICATION (re-invoke jarvisDispatchAction with hardcoded action='post'). Plan 14 Task 4 REPLACES this with consentRespond(request_id, choice) over tokio::oneshot — preserves original action verb and no re-invoke needed. Forward-pointer comment in ChatPanel.tsx flags the deletion site for Plan 14."
metrics:
  duration_seconds: 454
  duration_minutes: 7.6
  task_count: 3
  files_created: 2
  files_modified: 4
  completed_at: "2026-04-30T18:44:04Z"
---

# Phase 18 Plan 11: Frontend JarvisPill + ConsentDialog + MessageList wiring Summary

**One-liner:** Wired the 6 typed Tauri wrappers + 2 chat-feature components + MessageList/ChatPanel subscribers that close the JARVIS chat-first frontend loop — `jarvis_intercept` now renders a 4-state inline pill, `consent_request` opens a 3-button modal with T-18-03-locked plain-text preview rendering, and the Wave-4 simplified decision handler is ready for Plan 14 to supersede with `consentRespond` over `tokio::oneshot`.

## What Shipped

### Task 1 — 6 typed Tauri wrappers (admin.ts)

Appended a Phase 18 section to `src/lib/tauri/admin.ts` with 3 type aliases and 6 wrappers, all keyed off the `kind` discriminator field that mirrors `#[serde(tag = "kind", rename_all = "snake_case")]` on the Rust side:

| Wrapper | Rust source | Returns | Notes |
|---------|-------------|---------|-------|
| `egoIntercept(transcript)` | `ego.rs:295` | `EgoVerdict` | Sync classification — does NOT trigger retries/installs (that's `handle_refusal` inside `commands.rs`). |
| `intentRouterClassify(message)` | `intent_router.rs` | `IntentClass` | Heuristic-first (verb × service token); LLM-fallback returns `chat_only` in v1.2. |
| `jarvisDispatchAction(intent)` | `jarvis_dispatch.rs` | `DispatchResult` | 3-tier dispatch native → MCP → native_tools. Consent gate runs first; on `NeedsPrompt` emits `consent_request` and returns `NoConsent`. |
| `consentGetDecision(intentClass, targetService)` | `consent.rs:62` | `string \| null` | Returns `null` on no row, otherwise `"allow_always"` or `"denied"`. |
| `consentSetDecision(intentClass, targetService, decision)` | `consent.rs:76` | `void` | TS literal-union forbids `'allow_once'` at compile time (T-18-CARRY-15). |
| `consentRevokeAll()` | `consent.rs:99` | `void` | Wipes every row from `consent_decisions` (D-10 Settings → Privacy). |

**3 type aliases (discriminated unions):**

- `EgoVerdict` = `pass | refusal | capability_gap`
- `IntentClass` = `chat_only | action_required`
- `DispatchResult` = `executed | no_consent | hard_failed_no_creds | not_applicable`

### Task 2 — JarvisPill + ConsentDialog components

**JarvisPill.tsx** — D-18 state-mapping table:

| `payload.action` | Tone | Text |
|------------------|------|------|
| `intercepting` | `default` | "Detecting capability gap…" |
| `installing` | `warn` | "Installing {capability}…" |
| `retrying` | `warn` | "Retrying with {capability}…" |
| `hard_refused` | `hot` | "Couldn't complete: {reason}" + dismiss × button |

Composes the existing Badge primitive — `aria-live="polite"` on the wrapper. NO new design tokens introduced.

**ConsentDialog.tsx** — D-09 layout:

- Title: "Allow BLADE to {action_verb} on {target_service}?"
- Body: target service / action / content preview
- Buttons: **[Allow once]** (default focus, primary) / [Allow always] / [Deny]

**T-18-03 mitigation evidence (the unsafe innerHTML attribute prop — literal name spelled `dangerously` + `Set` + `Inner` + `HTML` — is BANNED in both files):**

```bash
$ grep -ic '<the-banned-attr-prop>' src/features/chat/ConsentDialog.tsx
0
$ grep -ic '<the-banned-attr-prop>' src/features/chat/JarvisPill.tsx
0
```

Content preview rendered via `<pre>{content_preview}</pre>` — React auto-escapes text nodes. Backend (jarvis_dispatch.rs:69) already `safe_slice`s the preview to 200 chars at the emit boundary. Defense in depth.

**Ghost-token check (memory `project_ghost_css_tokens.md` lesson held):**

```bash
$ grep -nc -- "--jarvis-" src/features/chat/{JarvisPill.tsx,ConsentDialog.tsx,chat.css}
0  0  0
$ grep -nc -- "--consent-" src/features/chat/{JarvisPill.tsx,ConsentDialog.tsx,chat.css}
0  0  0
```

All chat.css extensions use canonical tokens from `tokens.css`: `--s-N`, `--r-N`, `--t-N`, `--g-fill*`, `--g-edge-*`, `--font-*`, `--a-hot`. Zero new tokens.

### Task 3 — MessageList + ChatPanel integration

**MessageList.tsx** (subscribe to `BLADE_EVENTS.JARVIS_INTERCEPT`):

- `src/features/chat/MessageList.tsx:46` — `useTauriEvent<JarvisInterceptPayload>(BLADE_EVENTS.JARVIS_INTERCEPT, handleIntercept)`
- `src/features/chat/MessageList.tsx:96` — `<JarvisPill payload={intercept} onDismiss={...} />` rendered below the latest assistant bubble
- Auto-clear: `useEffect` keyed on `currentMessageId`; reads intercept via ref to avoid churn during streaming. Hard-refused stays sticky.

**ChatPanel.tsx** (subscribe to `BLADE_EVENTS.CONSENT_REQUEST`):

- `src/features/chat/ChatPanel.tsx:68` — `useTauriEvent<ConsentRequestPayload>(BLADE_EVENTS.CONSENT_REQUEST, handleConsentRequest)`
- `src/features/chat/ChatPanel.tsx:131` — `<ConsentDialog open={!!pendingConsent} onClose={...} payload={pendingConsent} onDecide={handleDecide} />`
- `handleDecide`: persist allow_always/denied via `consentSetDecision`, then re-invoke `jarvisDispatchAction` (Wave-4 simplification — see KNOWN GAP below).

**D-13 lock honored:**

```bash
$ grep -rE "from ['\"]@tauri-apps/api/event['\"]" src/features/chat/
(no matches)
```

No raw `listen()` imports in any chat surface — the only listener path is `useTauriEvent` from `@/lib/events`. ESLint's `no-raw-tauri.js` rule is silent.

## KNOWN GAP — RESOLVED IN PLAN 14 (same wave)

**"Allow once" one-shot dispatch.** Plan 11 ships the re-invoke version: when the user clicks Allow once, `handleDecide` re-invokes `jarvisDispatchAction(...)`. The dispatcher re-checks consent and sees `NeedsPrompt` again because allow_once is NEVER persisted (RESEARCH Open Q1 / T-18-CARRY-15) — so the user is prompted twice. Acceptable v1.2 limitation; the cold-install demo prompt only requires Allow always to complete end-to-end.

**Additional gap:** `handleDecide` re-invokes with `action: 'post'` hardcoded — the original action verb is lost between the consent_request emit and the re-invoke.

**Plan 14 Task 4 supersession:** Plan 14 (Wave 4, lands AFTER Plan 11) replaces the entire `handleDecide` body with a single `consentRespond(payload.request_id, choice)` call. Backend-side, `jarvis_dispatch::dispatch_action` awaits a `tokio::oneshot::Receiver<ConsentChoice>` keyed by `request_id` instead of returning `NoConsent`. The original action verb stays in scope for the dispatcher; there's no re-invoke; all 3 choices (allow_once / allow_always / denied) work in one round-trip.

A `FORWARD-POINTER` comment block in `src/features/chat/ChatPanel.tsx` (lines 27–46) flags the deletion site for Plan 14 with a `TODO(plan-14)` marker on the hardcoded action.

## Verification

| Gate | Status |
|------|--------|
| `npx tsc --noEmit` | exit 0 |
| `npm run verify:all` | OK — all 27+ gates green |
| `npm run lint` | 0 errors, 16 unrelated pre-existing warnings |
| Raw `listen()` import grep in chat surfaces | 0 matches (D-13 lock) |
| Banned innerHTML attr-prop grep in ConsentDialog/JarvisPill | 0 matches (T-18-03) |
| Ghost-token grep `--jarvis-` / `--consent-` | 0 matches |
| `useTauriEvent` count in chat surfaces | 6 calls across 2 files (MessageList + ChatPanel) |
| `<JarvisPill>` in MessageList.tsx | 1 site |
| `<ConsentDialog>` in ChatPanel.tsx | 1 site |
| `consentSetDecision` + `jarvisDispatchAction` in ChatPanel.tsx | 4 references (import + 2 call sites + 1 doc) |

## Deviations from Plan

None — plan executed exactly as written. The plan's revised Task 3 forward-pointer for Plan 14 was added verbatim as a 20-line comment block at the top of ChatPanel.tsx (lines 27–46), and the `TODO(plan-14)` marker landed on the hardcoded `action: 'post'` line.

The plan suggested a `clearIntercept` callback exposed from useChat for parent-coordinated auto-clear. Implementation kept the intercept state local to MessageList instead — it's strictly simpler (no provider mutation, no extra context surface), uses an existing signal (`currentMessageId` flip from null → string is precisely the BLADE_MESSAGE_START semantics), and the plan explicitly permits this in Step 3 ("the simplest implementation: keep intercept state local to MessageList per Step 2"). This wasn't a deviation — it was the plan's preferred path.

## Authentication Gates

None — no auth steps in this plan. All 6 wrappers proxy to Rust commands that don't require external credentials at the wrapper level (consent SQLite is local-first, intent router is heuristic-only in v1.2, ego_intercept is pure regex, dispatch routes to tentacles which handle their own creds).

## Open

- **Plan 18-12** cold-install demo will exercise this end-to-end: send a "post to slack" → ego intercept → JarvisPill flashes → consent_request fires → ConsentDialog opens → click Allow always → re-invoke dispatches → ActivityStrip shows `[JARVIS] action_required: slack → executed`.
- **Plan 18-14 Task 4** REPLACES the ChatPanel `handleDecide` re-invoke with `consentRespond + tokio::oneshot`. The forward-pointer comment block in ChatPanel.tsx (lines 27–46) is the deletion target.

## Self-Check: PASSED

Files created:
- FOUND: `/home/arnav/blade/src/features/chat/JarvisPill.tsx`
- FOUND: `/home/arnav/blade/src/features/chat/ConsentDialog.tsx`

Commits:
- FOUND: `e962ed3` (feat 18-11: 6 typed Tauri wrappers)
- FOUND: `618cd4f` (feat 18-11: JarvisPill + ConsentDialog components)
- FOUND: `67a3077` (feat 18-11: wire JarvisPill in MessageList + ConsentDialog in ChatPanel)
