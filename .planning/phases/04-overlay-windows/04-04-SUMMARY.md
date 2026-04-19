---
phase: 04-overlay-windows
plan: 04
subsystem: overlay-ghost
tags: [ghost, overlay, meeting-assist, content-protection, tauri, react, wave-2]
dependency-graph:
  requires:
    - 04-01  # Rust sanity check: ghost_mode.rs:481 .content_protected(true) verified; GHOST_* events LIVE; Ctrl+G emit site at lib.rs:326
    - 01-04  # design-system primitives (Dialog, Button) + tokens
    - 01-01  # window bootstrap placeholder (replaced here)
  provides:
    - GhostOverlayWindow (src/features/ghost/GhostOverlayWindow.tsx) — top-level overlay with idle pill + suggestion card + Linux warning
    - clipHeadline (src/features/ghost/clipHeadline.ts) — pure helper enforcing D-10 (≤6-word headline + 1-2 bullets)
    - speakerColor / confColor (src/features/ghost/speakerColor.ts) — deterministic 6-color palette + 3-tier confidence color
    - ghost.css (src/features/ghost/ghost.css) — .ghost-idle pill + .ghost-card (blur 32px saturate 180%) + dialog actions
    - BLADE_EVENTS.GHOST_TOGGLE_CARD ('ghost_toggle_card') — frontend subscription to Rust Ctrl+G emit (D-112)
  affects:
    - src/windows/ghost/main.tsx  # Phase 1 placeholder div → GhostOverlayWindow mount
    - src/lib/events/index.ts     # +1 event constant (GHOST_TOGGLE_CARD)
tech-stack:
  added: []  # zero new deps — reuses Phase 1/3 React + Tauri substrate + Dialog/Button primitives
  patterns:
    - useTauriEvent-only subscription surface for 4 events (GHOST_SUGGESTION_READY_TO_SPEAK, GHOST_MEETING_STATE, GHOST_MEETING_ENDED, GHOST_TOGGLE_CARD) per D-13 / D-112
    - Zero raw @tauri-apps/api/core|event imports (D-34 invariant) — all IPC via invokeTyped / useTauriEvent / getCurrentWebviewWindow wrapper
    - Pure clipHeadline helper separated from component so Plan 04-07 can unit-test it without rendering the window
    - Retyped-not-imported src.bak recipe for speakerColor palette + confidence scale (D-17 dead-reference discipline)
    - D-10 enforcement is split across two layers: TS counts words/bullets, CSS clamps to 60ch max-width (defence-in-depth)
    - Linux warning dialog uses native <dialog> via Phase 1 Dialog primitive; acknowledgment persisted via usePrefs['ghost.linuxWarningAcknowledged']
    - Lazy useState initialiser for warningOpen mirrors usePrefs read-once-on-mount pattern — no flicker on first render
key-files:
  created:
    - src/features/ghost/clipHeadline.ts
    - src/features/ghost/speakerColor.ts
    - src/features/ghost/GhostOverlayWindow.tsx
    - src/features/ghost/index.tsx
    - src/features/ghost/ghost.css
  modified:
    - src/windows/ghost/main.tsx   # placeholder div → GhostOverlayWindow mount + ghost.css import
    - src/lib/events/index.ts      # +1 constant: GHOST_TOGGLE_CARD
decisions:
  - D-09 (content protection is Rust-side, not CSS): the overlay ships ZERO cursor / click-through properties in ghost.css or GhostOverlayWindow.tsx. Even the explanatory comments were rephrased to avoid the literal string `cursor:` so the Plan 04-07 grep check returns a clean 0.
  - D-10 (headline format) — enforced at TWO layers: clipHeadline.ts takes the first 6 whitespace-split words for the headline and the first 2 sentence-terminator splits for bullets; ghost.css clamps .ghost-headline and .ghost-bullets li to `max-width: 60ch` so even a glued-together word can't visually exceed the line cap.
  - D-109 (two-state visual): idle pill renders whenever `suggestion === null` OR `visible === false`; suggestion card replaces it on the next GHOST_SUGGESTION_READY_TO_SPEAK event (which also re-shows the card). Ctrl+G toggles `visible`. GHOST_TOGGLE_CARD event (emit from Rust at lib.rs:326) also toggles `visible` so the OS-level shortcut works from anywhere.
  - D-110 (Linux warning Dialog) — first activation blocks overlay UI behind a modal Dialog; "I understand, continue" sets `prefs['ghost.linuxWarningAcknowledged'] = true` and unblocks; "Cancel" hides the window without persisting (so the warning re-appears on next activation). macOS / Windows skip the dialog entirely because `isLinux` is false.
  - D-111 (no auto-reply) — Phase 4 surfaces suggestion text only. NO "Send now" / "Use" / "Type" button. The Rust `enigo`-based keyboard injection in ghost_mode.rs:515-544 remains dormant until Phase 7+ autonomy sliders land.
  - D-112 (useTauriEvent only) — GhostOverlayWindow subscribes 4 events via useTauriEvent and ZERO direct `listen()` calls. GHOST_TOGGLE_CARD added to BLADE_EVENTS as `'ghost_toggle_card'` so the Rust Ctrl+G emit at lib.rs:326 now has a matching typed subscription.
  - D-17 (src.bak READ-ONLY) — speakerColor 6-color palette + FNV-style hash (`(hash * 31 + charCode) >>> 0`) and confColor thresholds (≥0.85 green / ≥0.65 amber / else red) retyped from src.bak/components/GhostOverlay.tsx. NO import from src.bak. Verified: 0 matches for `src.bak` imports in the feature tree.
  - Platform detection via `navigator.platform` (not `navigator.userAgentData` which is Chromium-only) — widest Tauri WebView compatibility. Deprecated in modern browsers but Tauri exposes it consistently.
  - GhostMeetingStatePayload uses an index signature (`[k: string]: unknown`); platform field required a typeof-guard to render as ReactNode — documented inline as `rawPlatform → typeof 'string'` narrowing.
metrics:
  duration: ~15 minutes
  completed: 2026-04-19T12:08:00Z
  tasks: 2
  files_created: 5
  files_modified: 2
---

# Phase 4 Plan 04-04: Ghost Mode Summary

JARVIS-style meeting assist overlay: idle pill when active-but-silent, 480px suggestion card when Rust detects a response-worthy moment, Ctrl+G toggle, Esc hide. Content protection stays Rust-owned (D-09); Linux users see a one-time warning that screen capture IS NOT excluded (D-110). Replaces the Phase 1 `<div>BLADE Ghost — Phase 1 bootstrap</div>` placeholder with the working overlay surface.

## What Landed

- **`src/features/ghost/clipHeadline.ts`** — Pure helper. Whitespace-normalises, takes first ≤6 words as headline, first ≤2 sentences as bullets. Empty input returns `{ headline: '', bullets: [] }`. Easy to unit-test (no React, no Tauri).
- **`src/features/ghost/speakerColor.ts`** — Two exports. `speakerColor(name)` → stable hex from 6-color palette via `(h * 31 + charCode) >>> 0` hash; `confColor(c)` → 3-tier (green ≥0.85 / amber ≥0.65 / red else). Retyped from src.bak per D-17.
- **`src/features/ghost/GhostOverlayWindow.tsx`** — Top-level component. 4 useTauriEvent subscriptions (suggestion/meeting-state/meeting-ended/toggle). Ctrl+G / Esc keyboard handlers. Linux warning Dialog gated on `navigator.platform` + `usePrefs`. D-09 — zero pointer CSS anywhere.
- **`src/features/ghost/index.tsx`** — Barrel: `GhostOverlayWindow`, `clipHeadline`, `speakerColor`, `confColor`, `ClippedSuggestion` type.
- **`src/features/ghost/ghost.css`** — `.ghost-idle` (pill, blur 20px saturate 140%) + `.ghost-card` (480px, blur 32px saturate 180%) + `.ghost-speaker` / `.ghost-conf` / `.ghost-platform` / `.ghost-headline` / `.ghost-bullets` / `.ghost-dialog-actions`. `max-width: 60ch` on headline + bullets enforces D-10. Slide-up enter animation on card mount.
- **`src/windows/ghost/main.tsx`** — Bootstrap now mounts `<GhostOverlayWindow/>`; imports `@/styles/index.css` + `@/features/ghost/ghost.css`. Phase 1 placeholder div removed. D-09 comment preserved (window label `ghost_overlay` / Rust creation site at `src-tauri/src/ghost_mode.rs:471`).
- **`src/lib/events/index.ts`** — +1 constant `GHOST_TOGGLE_CARD: 'ghost_toggle_card'` so useTauriEvent has a typed subscription for the Rust Ctrl+G emit at `src-tauri/src/lib.rs:326`.

## Requirements Closed

| ID       | Requirement                                          | How                                                                      |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| GHOST-01 | Ghost Mode overlay window                            | `createRoot(#root).render(<GhostOverlayWindow/>)` in `src/windows/ghost/main.tsx` |
| GHOST-02 | Content-protected on macOS/Windows (verified Rust)   | Rust `.content_protected(true)` at `ghost_mode.rs:481` unchanged; sanity grep in Plan 04-01 confirms |
| GHOST-03 | Idle pill + card two-state visual (D-109)            | `.ghost-idle` when `!visible || !suggestion`; `.ghost-card` on live suggestion |
| GHOST-04 | Headline ≤6 words + 1-2 bullets + ≤60 chars/line     | `clipHeadline.ts` slices words.slice(0,6) and sentences.slice(0,2); `max-width: 60ch` in CSS |
| GHOST-05 | Ctrl+G toggle + Esc close                            | Window-level `keydown` handler + `useTauriEvent(GHOST_TOGGLE_CARD)` + `getCurrentWebviewWindow().hide()` on Esc |
| GHOST-06 | Linux content-protection warning Dialog (D-110)      | `navigator.platform` matches /linux/i → renders `<Dialog>` gated on `prefs['ghost.linuxWarningAcknowledged']` |
| GHOST-07 | Ghost events subscribed via useTauriEvent (D-112)    | 4 `useTauriEvent<…>()` calls in `GhostOverlayWindow.tsx` (3 ghost + toggle); zero raw `listen()` |
| GHOST-08 | Speaker attribution + confidence dot                 | `speakerColor(suggestion.speaker)` on `.ghost-speaker`; `confColor(suggestion.confidence)` on `.ghost-conf` dot |

## Success Criteria

- [x] `src/windows/ghost/main.tsx` mounts `<GhostOverlayWindow/>` (Phase 1 placeholder replaced).
- [x] `clipHeadline` returns headline ≤6 words + ≤2 bullets (runtime verified with long paragraph test: 6-word headline, 2 bullets).
- [x] `speakerColor` / `confColor` retyped (no src.bak import).
- [x] Idle pill renders when no suggestion; suggestion card replaces it on `ghost_suggestion_ready_to_speak`.
- [x] Ctrl+G toggles card visibility (via both window-level keydown AND Rust Ctrl+G emit → useTauriEvent(GHOST_TOGGLE_CARD)).
- [x] Esc hides window via `getCurrentWebviewWindow().hide()`.
- [x] Linux platform detection triggers Dialog; acknowledgment persists; on cancel, window hides without persisting.
- [x] Non-Linux platforms skip the Dialog entirely.
- [x] Ghost card uses `blur(32px) saturate(180%)`; `max-width: 60ch` on headline + bullets.
- [x] Zero `cursor:` properties in any ghost file (D-09) — verified via grep on `.css`, `.tsx`, `.ts` in the ghost tree.
- [x] Zero raw `@tauri-apps/api/core` or `/event` imports in ghost feature tree or window bootstrap.
- [x] `npx tsc --noEmit` passes.
- [x] `npm run verify:all` passes — 6/6 scripts green (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba).

## Verification Output

```bash
$ npx tsc --noEmit
(no output — 0 errors)

$ npm run verify:all
[verify-entries] OK — 5 entries present on disk
[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths
[verify-migration-ledger] OK — 7 referenced ids all tracked (of 89 ledger rows)
[verify-emit-policy] OK — all 59 broadcast emits match cross-window allowlist
[audit-contrast] OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline
[verify-chat-rgba] OK — no backdrop-filter property in src/features/chat (D-70 preserved)

$ grep -cE "cursor:" src/features/ghost/*.css src/features/ghost/*.tsx src/features/ghost/*.ts src/windows/ghost/main.tsx
src/features/ghost/ghost.css:0
src/features/ghost/GhostOverlayWindow.tsx:0
src/features/ghost/clipHeadline.ts:0
src/features/ghost/index.tsx:0
src/features/ghost/speakerColor.ts:0
src/windows/ghost/main.tsx:0

$ grep -cE "useTauriEvent" src/features/ghost/GhostOverlayWindow.tsx
7   # (4 subscriptions: import + type alias + 4 hook calls; 3 ghost events + GHOST_TOGGLE_CARD)

$ grep -cE "from '@tauri-apps/api/core'|from '@tauri-apps/api/event'" src/features/ghost/*.tsx src/features/ghost/*.ts src/windows/ghost/main.tsx
0   # D-34 invariant held
```

Runtime smoke test of `clipHeadline` (executed as plain JS with the ported function body):

```
Test 1 (26-word response):
  headline words: 6 (must be ≤6)  → "Remind them about the budget review"
  bullets: 2 (must be 1-2)          → ["tomorrow.", "It is time to present the Q2 numbers."]

Test 2 (short): headline="Hi there!"  bullets=0
Test 3 (empty): { headline: '', bullets: [] }
Test 4 (whitespace-only): { headline: '', bullets: [] }
```

## Commits

| Hash      | Subject                                                                                                           | Files                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `938b236` | feat(04-04): GhostOverlayWindow + clipHeadline + speakerColor + GHOST_TOGGLE_CARD event (GHOST-01, 03, 04, 05, 06, 07, 08) | `src/features/ghost/{GhostOverlayWindow.tsx, clipHeadline.ts, speakerColor.ts, index.tsx}`, `src/lib/events/index.ts` |
| `2be457b` | Ghost Task 2 content — see Deviations (parallel-lane commit-message mismatch; files are all Plan 04-04)            | `src/features/ghost/{GhostOverlayWindow.tsx, ghost.css}`, `src/windows/ghost/main.tsx`                          |

## Deviations from Plan

### Parallel-Execution Commit Attribution Mishap (Wave 2 race)

**Context:** Plan 04-04 executes in parallel with 04-03 (Voice Orb) and 04-05 (HUD) as Wave 2 lanes. The Voice Orb lane was also staging files via `git add` concurrently. When I ran `git commit` for Task 2, my 3 staged ghost files (`ghost.css`, `GhostOverlayWindow.tsx`, `src/windows/ghost/main.tsx`) had just been swept into a concurrent `git commit` in the Voice Orb lane. The resulting commit `2be457b` is labeled `feat(04-03): VoiceOrbWindow shell + overlay bootstrap + corner persistence (ORB-01,07,08)` but its diff contains ONLY ghost files — exactly the 3 files I intended for my Task 2 commit. Zero Voice Orb files are in `2be457b`; the Voice Orb lane's own files (`src/features/voice-orb/VoiceOrbWindow.tsx`, `src/features/voice-orb/index.tsx`) remain untracked.

**Net effect:** Plan 04-04 content IS fully committed (2 commits: `938b236` for Task 1 + `2be457b` for Task 2). Attribution on `2be457b`'s subject line is wrong but the content is correct. This is a Git-index race in parallel-executor mode; no behaviour regression.

**Not fixed in-flight:** The GSD execute protocol forbids `--amend` and `-i` rebase; creating a new "fix attribution" commit with no content change would spam history. Noting here for audit and carrying forward to the Phase 4 ROADMAP.

**Rule classification:** This is a **process observation**, not a Rule 1/2/3 deviation — the code landed correctly and verifies cleanly.

### Text-Content Hygiene for `verify:ghost-no-cursor` Grep (Rule 2 — Critical Correctness)

**Found during:** Task 2 verification. The plan specifies `grep -cE "cursor:" src/features/ghost/ghost.css` → 0. My initial draft contained comment lines with the literal phrase `` `cursor:` `` (backtick-wrapped) inside explanatory text, which matched the grep and returned 1 per file.

**Fix:** Rephrased D-09 comments in `ghost.css` and `GhostOverlayWindow.tsx` to describe the absent property as "pointer/mouse-pointer CSS" without the literal two-character sequence `cursor:`. Zero behaviour change — documentation only. Now `grep -cE "cursor:"` returns 0 across every ghost file (css / tsx / ts / window-bootstrap).

**Rationale:** The Phase 4 plan 04-07 `verify:ghost-no-cursor` script is a CI grep — false positives from comments defeat the safeguard. This is a D-45-regress-style guard on the D-09 invariant.

**Commit:** `2be457b` (Task 2 content).

### Type-Narrowing on `GhostMeetingStatePayload.platform` (Rule 1 — Bug fix during Task 1)

**Found during:** initial `npx tsc --noEmit` run of Task 1. `GhostMeetingStatePayload` in `src/lib/events/payloads.ts:259` uses an index signature `[k: string]: unknown`, so reading `meetingState?.platform` returned `unknown` — React doesn't render `unknown` as a ReactNode.

**Fix:** Added a `typeof rawPlatform === 'string' && rawPlatform.length > 0` guard to narrow to `string | null`, storing in `platformLabel` before passing to JSX.

**Rationale:** Rule 1 auto-fix — this is a correctness bug introduced by the plan's pattern snippet (which cast directly). The guard also defends against empty-string platforms.

**Commit:** `938b236` (Task 1).

## D-09 Invariant — Evidence

| File                                            | `cursor:` count (CSS property OR inline style) |
| ----------------------------------------------- | ---------------------------------------------- |
| `src/features/ghost/ghost.css`                  | 0                                              |
| `src/features/ghost/GhostOverlayWindow.tsx`     | 0                                              |
| `src/features/ghost/clipHeadline.ts`            | 0                                              |
| `src/features/ghost/speakerColor.ts`            | 0                                              |
| `src/features/ghost/index.tsx`                  | 0                                              |
| `src/windows/ghost/main.tsx`                    | 0                                              |
| **Total across ghost tree + window bootstrap**  | **0**                                          |

Rust-side content-protection contract unchanged (not touched by Plan 04-04):

- `src-tauri/src/ghost_mode.rs:481` still calls `.content_protected(true)` — verified by `sed -n '480,483p'` returning `.content_protected(true)` exactly. Plan 04-01 Rust sanity grep is still the authoritative gate.

## D-10 Invariant — Evidence

| Enforcement layer | Mechanism                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- |
| TypeScript        | `clipHeadline` takes `words.slice(0, 6)` for headline and `sentences.slice(0, 2)` for bullets |
| CSS               | `.ghost-headline { max-width: 60ch }` and `.ghost-bullets li { max-width: 60ch }`        |
| Defence-in-depth  | Even a 400-char single-word response cannot visually exceed 60ch due to CSS overflow; runtime slice caps the word count independent of CSS |

## Ghost Events — Subscription Table

| Event                                          | Handler action                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `ghost_suggestion_ready_to_speak`              | `setSuggestion(e.payload); setVisible(true)`                          |
| `ghost_meeting_state`                          | `setMeetingState(e.payload)` (used for platform label on card)        |
| `ghost_meeting_ended`                          | `setTimeout(() => getCurrentWebviewWindow().hide(), 2000)` (D-112)    |
| `ghost_toggle_card` (NEW — Plan 04-04)         | `setVisible(v => !v)` — Rust Ctrl+G emit from `lib.rs:326`            |

## Deferred

- **Auto-reply / "Send now" button (D-111)** — Rust `enigo` keyboard injection at `ghost_mode.rs:515-544` stays dormant; Phase 7+ autonomy sliders will gate its activation.
- **Auto-hide on meeting end fade animation** — current 2s timeout hides instantly after delay; a 300ms opacity fade before hide would be nicer but isn't in SC-3.
- **Per-bullet ≤60-char runtime truncation** — CSS `max-width: 60ch` visually caps but does NOT truncate; a bullet that's 400 chars of `a`s still occupies 400 chars of DOM text. Phase 9 ergonomic pass can add a `bullet.slice(0, 58) + '…'` if user feedback flags this.
- **Playwright ghost-overlay-headline.spec.ts** — belongs to Plan 04-07; Plan 04-04 just ships the component under test.

## Self-Check: PASSED

**Files created:**

- `src/features/ghost/clipHeadline.ts` — FOUND
- `src/features/ghost/speakerColor.ts` — FOUND
- `src/features/ghost/GhostOverlayWindow.tsx` — FOUND
- `src/features/ghost/index.tsx` — FOUND
- `src/features/ghost/ghost.css` — FOUND

**Files modified:**

- `src/windows/ghost/main.tsx` — FOUND (replaces placeholder)
- `src/lib/events/index.ts` — FOUND (GHOST_TOGGLE_CARD added)

**Commits:**

- `938b236` — FOUND in git log (Task 1)
- `2be457b` — FOUND in git log (Task 2; see Deviations re: attribution)

**Invariants:**

- D-09 (zero `cursor:` in ghost tree) — HELD
- D-34 (zero raw `@tauri-apps/api/core|event` imports) — HELD
- D-10 (6-word / ≤2-bullet / 60ch) — HELD at TS + CSS layers
- D-17 (no src.bak imports) — HELD (palette + hash retyped)

---

*Plan: 04-04 · Ghost Mode Overlay · Wave 2 · 2026-04-19*
