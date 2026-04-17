# Phase 0: Pre-Rebuild Audit - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Read-only documentation pass that produces `.planning/RECOVERY_LOG.md` — the contract map Phase 1 builds against. No code changes.

**The audit extracts contracts from three authoritative sources** (not from the dead `src.bak/`):
1. **Backend** (`src-tauri/src/`) — command signatures, event names, payload shapes
2. **Prototypes** (`docs/design/`) — user flow + Liquid Glass visual language
3. **Research + codebase maps** (`.planning/research/`, `.planning/codebase/`) — already-synthesized architecture + pitfalls

`src.bak/` is treated as dead reference — **we do not read it to recover patterns**. It was broken, unscalable, structureless; building a UI from that pre-history would bake the same problems back in. We rebuild from backend truth + prototype direction.

The 5 audit areas in ROADMAP.md Phase 0 remain in spirit; only the *sources* change (see D-17 and Success Criteria Reframe below).

</domain>

<decisions>
## Implementation Decisions

### D-17: Audit Source Pivot
**Source of truth is backend + prototypes + research — not `src.bak/`.**
- Why: The old frontend was broken in design (no component structure, no scalability, raw code floating with no primitives). Extracting "implicit contracts" from broken code imports the broken patterns into the rebuild. The backend is complete and authoritative; the prototypes lock visual language and user flow; the research already captured pitfalls.
- Consequence: All 5 ROADMAP.md Phase 0 success criteria need rewording to reference backend/prototype sources instead of `src.bak/src/quickask.tsx` etc. (See "Success Criteria Reframe" below.)

### D-18: Execution Mode = Hybrid (3 Parallel Subagents + Inline Synthesis)
Three parallel subagents handle mechanical extraction; Claude synthesizes into one `RECOVERY_LOG.md`:

- **Subagent A — Backend Contract Extractor** reads `src-tauri/src/` for:
  - `commands.rs` — QuickAsk submission path, streaming events (`blade_stream_chunk`, `blade_message_start`, `blade_thinking_chunk`, `blade_token_ratio`)
  - `voice_conversation_*` / `voice_global.rs` / `wake_word.rs` — events that drive orb phase states (Idle/Listening/Thinking/Speaking)
  - `config.rs` / `commands.rs` — `get_onboarding_status`, `complete_onboarding`, `deep_scan_*` signatures and expected payloads
  - `homeostasis.rs` — current hormone emit surface (to design the `hormone_update` event contract in Phase 3)
- **Subagent B — `emit_all` Classifier** scans all 73 `emit_all` / `app.emit` / `emit_to` sites in `src-tauri/src/`. For each: file:line, event name, payload type, classification (cross-window / single-window / ambiguous), and suggested `emit_to(label)` replacement inline when single-window. Output: a table Phase 1 can consume directly.
- **Subagent C — Prototype-to-Flow Mapper** reads the 11 `docs/design/` HTML + companion PNG files (onboarding ×3, dashboard, dashboard+chat, voice-orb + states, ghost-overlay, quickask ×2, settings) and produces: Liquid Glass visual tokens extracted from `shared.css` + `proto.css` + `orb.css`, user flow contracts per screen, interaction states documented from the mockups.

Inline synthesis: Claude reads the three outputs, resolves cross-cutting patterns (e.g., QuickAsk event flowing through `emit_all` routing policy), writes `.planning/RECOVERY_LOG.md`.

### D-19: Output Shape = Single Monolithic `.planning/RECOVERY_LOG.md`
One file with five clearly-headed sections plus appendices:
1. QuickAsk ↔ Main bridge contract
2. Voice Orb driving-event state machine
3. Onboarding backend wiring (command sequence + payloads)
4. Event catalog (all Rust emitters that Phase 1's `useTauriEvent` will subscribe to)
5. `emit_all` classification table (73 sites)
+ Appendix A: Prototype → user-flow contract map (11 screens)
+ Appendix B: Liquid Glass token set pulled from prototype CSS

Matches ROADMAP.md "`RECOVERY_LOG.md` exists in `.planning/`" (singular). Reviewable in one pass.

### Success Criteria Reframe
The ROADMAP.md Phase 0 success criteria explicitly reference `src.bak/` paths (including a wrong path — `src.bak/src/quickask.tsx` should be `src.bak/quickask.tsx`). Since D-17 drops `src.bak/` as a source, the criteria must reword to backend/prototype sources. Phase 1 planning (or an in-phase ROADMAP.md patch) should rewrite them as:

1. `RECOVERY_LOG.md` exists in `.planning/` with explicit QuickAsk → Main bridge contract: invoke name, event name, payload shape, conversation persistence path — **derived from `commands.rs` + `docs/design/quickask.html`**.
2. Voice orb state machine documented: which Rust events (`voice_conversation_*`, `wake_word_detected`) drive which of the 4 phase states — **derived from `voice_global.rs`, `wake_word.rs`, and `docs/design/voice-orb-states.html`** (OpenClaw math locked via D-08).
3. All Rust event emitters catalogued (replaces "43 listener sites" from src.bak): every `emit_all` / `emit_to` site with event name and payload type; this becomes the subscription surface for Phase 1's `useTauriEvent`.
4. Onboarding backend wiring documented: `get_onboarding_status`, `complete_onboarding`, `deep_scan_*` call sequence and expected payloads — **derived from `commands.rs` + the 3 onboarding prototype screens**.
5. `emit_all` audit complete: every `app.emit_all(...)` classified as cross-window (keep) or single-window (convert to `emit_to`); suggested replacement inline where single-window.

### Claude's Discretion
- Exact subagent prompt wording (general-purpose, follow the extraction scope above).
- Formatting inside each `RECOVERY_LOG.md` section (tables for catalogs, prose for contracts, code blocks for payload schemas).
- Whether to patch `ROADMAP.md` Phase 0 success criteria in this phase or defer to Phase 1 (recommend in-phase patch — clean transition).
- Whether to patch the wrong `src.bak/src/quickask.tsx` path reference in `STATE.md` (recommend yes — one-line fix).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level specs (already read during discussion)
- `.planning/PROJECT.md` — core value, requirements, constraints, Key Decisions D-01..D-16
- `.planning/REQUIREMENTS.md` — 156 v1 requirements, categorized; out-of-scope list
- `.planning/ROADMAP.md` §"Phase 0: Pre-Rebuild Audit" — goal, depends-on, success criteria (requires reframe per D-17)
- `.planning/STATE.md` — current position, accumulated context, locked decisions D-01..D-16

### Architecture authority (backend source of truth)
- `docs/architecture/2026-04-16-blade-body-architecture-design.md` — body system architecture (12 body systems, 10 tentacles, 10 hormones, 4 heads)
- `docs/architecture/2026-04-17-blade-frontend-architecture.md` — frontend rebuild architecture target state
- `docs/architecture/body-mapping.md` — Rust module → body subsystem mapping
- `docs/architecture/connection-map.md` — subsystem connectivity
- `src-tauri/src/body_registry.rs` — enumerates every subsystem (authoritative)
- `src-tauri/src/lib.rs` — `generate_handler![]` list = 764 command inventory
- `src-tauri/src/commands.rs` — main chat pipeline, streaming, QuickAsk submission
- `src-tauri/src/homeostasis.rs` — hormone bus (WIRE-02 source)
- `src-tauri/src/voice_global.rs`, `src-tauri/src/wake_word.rs`, `src-tauri/src/voice_conversation.rs` (if present) — orb driving events
- `src-tauri/src/ghost_mode.rs` — content protection + window creation (GHOST-01 source)
- `src-tauri/src/audio_timeline.rs` — VAD target site (WIRE-07)
- `src-tauri/src/config.rs` — BladeConfig, keyring, onboarding status

### Design authority (visual + flow source of truth)
- `docs/design/shared.css` — design token primitives to port
- `docs/design/proto.css` — prototype-layer styles
- `docs/design/orb.css` — orb-specific motion math
- `docs/design/onboarding-01-provider.html` + `.png` — provider picker flow + visuals
- `docs/design/onboarding-02-apikey.html` + `.png` — API key entry flow + visuals
- `docs/design/onboarding-03-ready.html` + `.png` — deep scan ready + enter-BLADE CTA
- `docs/design/dashboard.html` + `.png` + `.hover.png` — dashboard layout, ambient strip, integrations grid
- `docs/design/dashboard-chat.html` + `.png` — chat side-panel over dashboard
- `docs/design/voice-orb.html` + `.png` — orb default state
- `docs/design/voice-orb-states.html` + `.png` — 4 phase state visuals
- `docs/design/ghost-overlay.html` + `.png` — ghost card format + content protection
- `docs/design/quickask.html` + `.png` — text mode
- `docs/design/quickask-voice.html` + `.png` — voice mode
- `docs/design/settings.html` + `.png` — settings tab rail + key vault

### Research (already-synthesized context)
- `.planning/research/SUMMARY.md` — consolidated research summary
- `.planning/research/ARCHITECTURE.md` — architectural research
- `.planning/research/STACK.md` — stack research
- `.planning/research/FEATURES.md` — feature research
- `.planning/research/PITFALLS.md` — known pitfalls, including Liquid Glass gotchas
- `.planning/research/PRIOR_ART.md` — prior-art scan

### Codebase maps (audit starting points)
- `.planning/codebase/STRUCTURE.md` — directory layout, 159 Rust modules, 145+ components
- `.planning/codebase/ARCHITECTURE.md` — current architecture
- `.planning/codebase/STACK.md` — stack inventory
- `.planning/codebase/CONVENTIONS.md` — coding conventions
- `.planning/codebase/INTEGRATIONS.md` — third-party integrations
- `.planning/codebase/CONCERNS.md` — known concerns
- `.planning/codebase/TESTING.md` — testing posture

### Explicitly NOT to read (dead reference)
- `src.bak/` — 1443-line App.tsx, 159 components, 43 listen sites, broken design, no primitives. Per D-17: do not read to recover patterns. Referenced here only so downstream agents know to skip it.

</canonical_refs>

<code_context>
## Existing Code Insights

### Backend scale (authoritative)
- 178 Rust modules, 764 `#[tauri::command]` handlers, 73 `emit_all`/`emit` sites, 29+ frontend-subscribed events
- `body_registry.rs` enumerates the subsystem graph — authoritative for Body cluster (Phase 8)
- Backend is complete; Phase 0..9 are Skin only. Wiring gaps (WIRE-01..08) are scoped exceptions, not expansion.

### Prototypes as directional truth
- 11 HTML prototypes under `docs/design/` + corresponding PNG renders = target visual language
- `shared.css` + `proto.css` + `orb.css` contain the design tokens to port into `src/styles/tokens.css` during Phase 1 (FOUND-01)
- `render.mjs` + `proto.js` are prototype rendering scaffolding — reference, not production

### Integration points for Phase 0 output
- `RECOVERY_LOG.md` feeds directly into: FOUND-03/04 (typed Tauri wrapper cites command signatures), FOUND-05 (event registry imports event names + payload types), FOUND-06 (`useTauriEvent` hook subscribes to catalogued events), WIRE-08 (`emit_all` audit output), ONBD-01..06 (onboarding backend signatures), ORB-02..06 (voice orb driving events), QUICK-04 (bridge contract)

### Dead reference context (not to be read)
- `src.bak/` = 5.2M mirror of broken pre-rebuild frontend. Kept on disk only in case a specific pattern needs spot-lookup from Arnav; default posture is "do not open".

</code_context>

<specifics>
## Specific Ideas

**From Arnav (direction locked during discussion):**
- *"The previous UI was broken on the design part. Nothing was scalable: no components, no structure."* — src.bak is not a source. Do not mine it for patterns.
- *"You already have the backend clearly; you know the goal. You figure out what UX is needed. You already have the actual prototypes."* — backend + prototypes + research are the inputs. Claude synthesizes UX from the prototypes' flow + backend's capabilities.
- *"We are building that liquid glass so whatever research you have, try to incorporate all the things in a correct manner."* — the Liquid Glass treatment is THE aesthetic (D-15); research already captured the implementation pattern; incorporate it faithfully.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. The ROADMAP.md success-criteria reframe (noted in D-17 and the Success Criteria Reframe subsection) is an in-phase follow-on, not a deferred idea.

</deferred>

---

*Phase: 00-pre-rebuild-audit*
*Context gathered: 2026-04-17*
