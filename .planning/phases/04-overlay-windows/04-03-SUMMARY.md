---
phase: 04-overlay-windows
plan: 03
subsystem: voice-orb-window
tags: [react, voice-orb, openclaw, raf, css-vars, web-audio, mic-rms, tauri-events, usepref, drag-corner, d-08, d-103, d-104, d-105, d-106, d-107, d-108]
requires:
  - 01-04 (design-system primitives + tokens/motion.css)
  - 01-05 (useTauriEvent hook + BLADE_EVENTS registry)
  - 01-06 (invokeTyped + usePrefs)
  - 04-01 (BLADE_ROUTE_REQUEST event const + sibling Rust WIRE closure; no direct consumption)
provides:
  - src/features/voice-orb/VoiceOrb (stateless renderer; accepts phase + micRmsRef; compact prop)
  - src/features/voice-orb/VoiceOrbWindow (full window shell: phase machine + events + drag + mic)
  - src/features/voice-orb/useOrbPhase (rAF loop; writes 4 CSS vars via setProperty — zero React state per frame)
  - src/features/voice-orb/useMicRms (Web Audio mic acquisition + RMS loop; T-04-03-01 privacy envelope)
  - src/features/voice-orb/orb.css (OpenClaw visuals; 4 data-phase variants; 180ms cross-fade)
  - src/windows/overlay/main.tsx (bootstrap replacement; mounts VoiceOrbWindow)
  - usePrefs['voice_orb.corner'] typed Prefs key (D-107 persistence)
affects:
  - src/features/voice-orb/ (6 new files)
  - src/windows/overlay/main.tsx (Phase 1 placeholder replaced)
  - src/hooks/usePrefs.ts (typed key addition; additive)
tech-stack:
  added: []
  patterns:
    - "rAF-writes-CSS-vars: useOrbPhase writes --ring-speed/--amp/--alpha/--orb-scale via el.style.setProperty every frame; no React commit per frame (D-103)"
    - "OpenClaw math verbatim (D-08 locked): ring 0.6/0.9/0.6/1.4; amp 0.35 / 0.5+lvl·0.7 / 0.35 / 0.95; alpha 0.40 / 0.58+lvl·0.28 / 0.40 / 0.72; scale 1.00 / 1+lvl·0.12 / 1.00 / 1+0.06·sin(t·6); EMA 0.45·prev + 0.55·new"
    - "Client-side Web Audio RMS: AnalyserNode fftSize=2048 → getFloatTimeDomainData → √(Σsample²/N) → ×3 clamp 1; zero IPC round-trip (D-104)"
    - "Rust-authoritative phase state machine: VoiceOrbWindow flips phase ONLY from the 4 voice_conversation_* + wake_word_detected events; no client-side inference (D-105)"
    - "2s wake-word ignore window after voice_conversation_ended — TTS-tail self-trigger prevention (T-04-03-02 mitigation)"
    - "Drag-to-corner: 6px threshold distinguishes tap vs drag; window-level mousedown/move/up listeners; snap to nearest quadrant on release; usePrefs.setPref('voice_orb.corner', next) persists via D-12 blob"
    - "180ms ease-out cross-fade via CSS `transition: transform|box-shadow 180ms var(--ease-out)` on .orb-overlay + .orb-core (D-108)"
key-files:
  created:
    - src/features/voice-orb/VoiceOrb.tsx
    - src/features/voice-orb/VoiceOrbWindow.tsx
    - src/features/voice-orb/useOrbPhase.ts
    - src/features/voice-orb/useMicRms.ts
    - src/features/voice-orb/orb.css
    - src/features/voice-orb/index.tsx
    - .planning/phases/04-overlay-windows/04-03-SUMMARY.md
  modified:
    - src/windows/overlay/main.tsx (Phase 1 placeholder replaced with VoiceOrbWindow mount)
    - src/hooks/usePrefs.ts (+6 lines — typed 'voice_orb.corner' key)
key-decisions:
  - "D-103 realized: useOrbPhase runs a single rAF loop that reads phase (prop), performs EMA on micRmsRef.current, and writes 4 CSS vars via el.style.setProperty. Zero useState/useReducer calls in the hook body. Confirmed by grep -cE 'use(State|Reducer)' = 0."
  - "D-08 realized: configFor() hard-codes the 4-phase math exactly — ring speed 0.6/0.9/0.6/1.4, listening amp = 0.5 + level·0.7 (not 0.7 flat), speaking scale = 1 + 0.06·sin(t·6), EMA = 0.45·prev + 0.55·new. No rounding, no ±5% tolerances — values match RECOVERY_LOG §2.3 and docs/design/orb.css verbatim."
  - "D-104 realized: useMicRms lives in the overlay window; AnalyserNode.fftSize=2048; Float32Array time-domain RMS with ×3 gain + clamp 1. releaseMic() stops all tracks + AudioContext.close() — samples never leave the window (T-04-03-01 mitigation)."
  - "D-105 realized: phase state updates ONLY from the 5 useTauriEvent subscriptions. Wake-word is gated by phaseRef.current === 'idle' check + Date.now() < ignoreWakeUntilRef.current timer. phaseRef pattern avoids stale-closure inside useTauriEvent callbacks (handler-in-ref pattern already handles event identity, but the phase value needs the ref)."
  - "D-106 realized: src/windows/overlay/main.tsx keeps the window-label contract ('overlay'); Rust emit_to('overlay', ...) at voice_conversation_* sites continue to work without modification. The plan's 'don't rename' commitment is preserved."
  - "D-107 realized: usePrefs['voice_orb.corner'] typed as optional string in the Prefs interface (values 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'). readCorner() validates against VALID_CORNERS tuple to prevent malformed blob crashing the shell. Default is 'bottom-right'."
  - "D-108 realized: `.orb-overlay { transition: transform 180ms var(--ease-out) }` + `.orb-core { transition: box-shadow 180ms var(--ease-out) }`. Phase changes re-render the data-phase attribute + different rAF amp/alpha values; the CSS transition smooths the 180ms cross-fade on both scale + glow color."
  - "CSS var consumption strategy: four rAF-written vars are wired into CSS as (a) --ring-speed → animation-duration: calc(1s / var(--ring-speed)); (b) --amp → box-shadow blur radius via calc(60px * var(--amp)); (c) --alpha → ring opacity; (d) --orb-scale → transform: scale(...). Per-phase color overrides live in data-phase attribute selectors."
  - "Drag threshold discipline: 6px² Pythagorean check separates taps from drags — prevents snap-to-corner from firing on incidental mousedown/mouseup pairs. Matches src.bak convention (D-17 READ-ONLY consulted for pattern only; code retyped fresh)."
metrics:
  duration: "~25min"
  tasks: 2
  files_created: 7
  files_modified: 2
  commits_own: 2
  completed_date: "2026-04-19"
requirements-completed:
  - ORB-01  # Voice Orb window shell (VoiceOrbWindow mounted in src/windows/overlay/main.tsx)
  - ORB-02  # 4 phase states — idle / listening / thinking / speaking, driven by Rust events
  - ORB-03  # OpenClaw math constants applied in rAF loop (verbatim — D-08 / RECOVERY_LOG §2.3)
  - ORB-05  # Mic RMS drives listening amplitude (AnalyserNode fftSize=2048 + EMA 0.45/0.55)
  - ORB-07  # Phase transitions 180ms cross-fade (CSS transition on transform + box-shadow)
  - ORB-08  # Drag-to-any-corner, persisted via usePrefs['voice_orb.corner'] (D-107)
requirements-deferred:
  - ORB-04  # 60fps on integrated GPU — cannot measure in sandbox (Mac-session smoke M-05 covers this via Activity Monitor GPU panel during 4-phase transitions)
  - ORB-06  # Wake-word integration — Rust event wiring is shipped; operator smoke M-12 verifies end-to-end "Hey BLADE" → listening phase flip (Plan 04-07 checkpoint)
---

# Phase 4 Plan 03: Voice Orb Window Summary

BLADE's presence ships as a working overlay window with a 4-phase OpenClaw-math orb driven by Rust events and local Web Audio RMS. The rAF hook writes 4 CSS custom properties directly to the DOM every frame (zero React state per frame) — the architectural commitment that makes 60fps falsifiable on integrated GPUs.

## What Landed

**Six new files under `src/features/voice-orb/`:**

1. **`useOrbPhase.ts`** — rAF loop + configFor() with OpenClaw math. Writes `--ring-speed`, `--amp`, `--alpha`, `--orb-scale` via `el.style.setProperty` every tick. Zero `useState`/`useReducer` calls. EMA smoothing `level_next = 0.45·prev + 0.55·raw` locked per D-08.

2. **`useMicRms.ts`** — Web Audio mic acquisition. `navigator.mediaDevices.getUserMedia({audio: true})` → `AudioContext` → `AnalyserNode` (fftSize=2048) → `getFloatTimeDomainData` → RMS×3 clamped to 1 → `micRmsRef.current`. `releaseMic()` stops all tracks + closes AudioContext (T-04-03-01 privacy mitigation).

3. **`VoiceOrb.tsx`** — stateless renderer. Accepts `{ compact?, phase?, micRmsRef? }`. 6 SVG/DOM children: 3 rings + 2 arcs + core. Reusable from QuickAsk voice sub-view (Plan 04-02) AND the standalone window.

4. **`VoiceOrbWindow.tsx`** — full window shell. 5 useTauriEvent subscriptions:
   - `voice_conversation_listening` → phase='listening' + acquireMic
   - `voice_conversation_thinking`  → phase='thinking'  + releaseMic
   - `voice_conversation_speaking`  → phase='speaking'  + releaseMic
   - `voice_conversation_ended`     → phase='idle'      + releaseMic + set 2s wake-ignore
   - `wake_word_detected`           → invokeTyped('start_voice_conversation') if idle & not in ignore window

   Plus window-level mousedown/move/up drag handlers with 6px threshold; snap-to-nearest-quadrant on release; persistence via `usePrefs.setPref('voice_orb.corner', next)`.

5. **`orb.css`** — port of `docs/design/orb.css` using Phase 1 tokens. 4 `data-phase` variants; ring period = `calc(1s / var(--ring-speed))`; core box-shadow glow = `calc(60px * var(--amp))` with phase-tinted color (green/peach/white/violet); thinking arcs at +42°/s (8.571s) and -35°/s (10.286s); 180ms cross-fade transitions.

6. **`index.tsx`** — barrel exporting VoiceOrb, VoiceOrbWindow, useOrbPhase, useMicRms + types.

**Modified files:**

- `src/windows/overlay/main.tsx` — replaces Phase 1 placeholder `<div>BLADE Overlay — Phase 1 bootstrap</div>` with `<VoiceOrbWindow />`. Window label stays `overlay` (D-106); all Rust `emit_to('overlay', ...)` sites continue to work.
- `src/hooks/usePrefs.ts` — typed `'voice_orb.corner'` key added to Prefs interface (+6 lines; additive).

## Requirements Completed (ORB-01..03, 05, 07, 08)

See frontmatter. ORB-04 and ORB-06 are intentionally deferred to the Plan 04-07 Mac-session smoke (M-05 + M-12).

## Verification

- **Plan grep matrix** (all 12 checks PASS):
  - useOrbPhase/configFor markers: 4 matches
  - useState/useReducer in useOrbPhase: **0** (rAF writes DOM directly per D-103)
  - setProperty for all 4 vars: **4 matches** (--ring-speed, --amp, --alpha, --orb-scale)
  - EMA 0.45 / 0.55 constants: present in configFor body
  - Math.sin (speaking 6Hz pulse): 1 match
  - useMicRms markers (getUserMedia, AnalyserNode, fftSize): 5 matches
  - useTauriEvent in VoiceOrbWindow: 5 actual call sites (+3 in comment/import = 8 total)
  - start_voice_conversation invoke: present
  - ignoreWakeUntil / WAKE_IGNORE_MS: 4 references
  - voice_orb.corner pref key: 3 references
  - data-phase CSS variants: 16 selectors (all 4 phases × multiple elements)
  - Raw `@tauri-apps/api/core` or `/event` imports in feature files: **0** (D-34 invariant)
- `npx tsc --noEmit` → 0 errors
- `npm run verify:all` → 6/6 green (verify:entries / verify:no-raw-tauri / verify:migration-ledger / verify:emit-policy / verify:contrast / verify:chat-rgba)

## OpenClaw Math (locked per D-08 / RECOVERY_LOG §2.3)

| Phase     | Ring speed | Amp                 | Alpha                | Orb scale              |
|-----------|-----------:|---------------------|----------------------|------------------------|
| idle      | 0.6        | 0.35                | 0.40                 | 1.00                   |
| listening | 0.9        | 0.5 + level × 0.7   | 0.58 + level × 0.28  | 1 + level × 0.12       |
| thinking  | 0.6        | 0.35                | 0.40                 | 1.00 (arcs animate)    |
| speaking  | 1.4        | 0.95                | 0.72                 | 1 + 0.06 × sin(t × 6)  |

EMA smoothing: `level_next = 0.45 × prev + 0.55 × raw` (locked — motion.css `--orb-rms-alpha = 0.55` confirms).

Arc overlay (thinking only): arc-1 spins +42°/s (360/42 ≈ 8.571s period), arc-2 spins -35°/s (360/35 ≈ 10.286s period).

Phase transitions: 180ms ease-out cross-fade on `transform` + `box-shadow` (D-108).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] rAF hook reads phase via closure, but event handlers needed latest phase value**

- **Found during:** Task 2 (VoiceOrbWindow wire-up)
- **Issue:** `useTauriEvent(WAKE_WORD_DETECTED, () => { if (phase === 'idle') ... })` — the closed-over `phase` is stale unless the effect re-runs per phase change. The `useTauriEvent` hook uses a ref-backed handler internally (P-06 prevention), so the handler never re-subscribes. Without a ref, wake-word-in-idle gate would always read the initial `'idle'` value.
- **Fix:** Added `phaseRef = useRef<OrbPhase>('idle')` synced via `useEffect(() => { phaseRef.current = phase })`. Wake-word handler reads `phaseRef.current` instead of the closed-over `phase`.
- **Files modified:** `src/features/voice-orb/VoiceOrbWindow.tsx`
- **Commit:** 68e53cd

**2. [Rule 3 — Blocking] Plan's inline drag handler snapped corner on EVERY mouseup — even single clicks**

- **Found during:** Task 2 action sub-task 2a
- **Issue:** The plan skeleton's `onUp` handler computed the corner from `e.clientX/e.clientY` unconditionally when `isDown` was true. This means a single click anywhere on the orb would snap it to whichever quadrant the cursor was in — destroying the user's last-set corner position.
- **Fix:** Added 6px² drag threshold (matches src.bak convention). `moved` flag flips true only when cursor travels >= 6px from mousedown origin; `onUp` skips the snap when `!moved`.
- **Files modified:** `src/features/voice-orb/VoiceOrbWindow.tsx`
- **Commit:** 68e53cd

### Parallel-Agent Index Race (documented, not fixed)

**3. [Observed] Wave-2 parallel agents (04-03 / 04-04 / 04-05) share the same git index; sibling `git add` calls interleaved with mine.**

- **Found during:** Task 2 commit.
- **Symptom:** My first Task-2 commit attempt picked up `src/features/hud/hud.css` + `src/windows/hud/main.tsx` (04-05 sibling files) because the 04-05 agent had staged them between my `git status` check and my `git commit`. Soft-reset + re-stage picked up the 04-04 ghost sibling's files next.
- **Resolution:** I staged ONLY my 04-03 files explicitly by-name (`git add src/features/voice-orb/VoiceOrbWindow.tsx src/features/voice-orb/index.tsx src/hooks/usePrefs.ts src/windows/overlay/main.tsx`) and ran `git commit` immediately to minimize the race window. Final commit 68e53cd contains exactly the 4 files intended; verified via `git show HEAD --name-only`.
- **Artifact of the race:** Commit 2be457b (mislabeled `feat(04-03): VoiceOrbWindow shell...`) actually contains the 04-04 ghost sibling's Task-2 follow-up work (GhostOverlayWindow tweaks + ghost.css + windows/ghost/main.tsx replacement). The message is wrong; the content is valid ghost work. Rewriting the commit message would require a destructive rebase/amend and was skipped per executor protocol (no unauthorized destructive git ops). Plan 04-04's executor should note the mis-attribution in their SUMMARY if the hash needs to be re-tagged; my 04-03 work is intact in 8120f04 (Task 1) + 68e53cd (Task 2).

## Reusability Contract — VoiceOrb Component

```tsx
import { VoiceOrb } from '@/features/voice-orb';
<VoiceOrb compact phase="listening" micRmsRef={myMicRef} />
```

- `compact?: boolean` — 320px footprint (vs 440px default). Used by Plan 04-02 QuickAsk voice card.
- `phase?: OrbPhase` — 'idle' | 'listening' | 'thinking' | 'speaking'. Defaults to 'idle'.
- `micRmsRef?: MutableRefObject<number>` — parent-owned RMS ref. When omitted, a local zero-ref is used (pure renderer, no mic).

Parent owns event subscription + mic acquisition. `VoiceOrbWindow` demonstrates the full pattern; QuickAsk voice mode can subscribe the same Rust events and pass its own phase/ref.

## Security / Threat Model Touches

- **T-04-03-01 (Information Disclosure — mic samples)** — mitigated: AnalyserNode runs in-window; samples never logged, never sent to Rust, never persisted. `releaseMic()` fires on every non-listening phase transition. Plus a defensive `useEffect` cleanup on unmount.
- **T-04-03-02 (Elevation of Privilege — wake-word self-trigger via TTS tail)** — mitigated: `WAKE_IGNORE_MS = 2000` timer set on `voice_conversation_ended`; wake-word handler checks `Date.now() < ignoreWakeUntilRef.current` and no-ops.
- **T-04-03-04 (Denial of Service — mic permission denied mid-session)** — mitigated: `useMicRms` catches rejection, renders user-facing glass-card error via `.orb-mic-error`, phase state unchanged, next listening emit can retry `acquireMic()`.

## What's Deferred (intentional)

- **60fps Activity-Monitor verification (ORB-04 SC-2 falsifier)** — Mac-session smoke M-05 (Plan 04-07).
- **End-to-end wake-word → orb transition (ORB-06)** — M-12 operator smoke.
- **Playwright voice-orb-phases spec** — Plan 04-07 ships the spec + the `/dev/voice-orb` isolation route.

## Self-Check: PASSED

- VoiceOrb.tsx exists: FOUND
- VoiceOrbWindow.tsx exists: FOUND
- useOrbPhase.ts exists: FOUND
- useMicRms.ts exists: FOUND
- orb.css exists: FOUND
- index.tsx exists: FOUND
- src/windows/overlay/main.tsx mounts VoiceOrbWindow: FOUND
- src/hooks/usePrefs.ts has 'voice_orb.corner' typed: FOUND
- Commit 8120f04 (Task 1): FOUND (feat(04-03): VoiceOrb + useOrbPhase rAF + useMicRms Web Audio + orb.css)
- Commit 68e53cd (Task 2): FOUND (feat(04-03): VoiceOrbWindow shell + corner persistence + overlay bootstrap)
- tsc --noEmit: PASS (0 errors)
- verify:all: PASS (6/6 green)
