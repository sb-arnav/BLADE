# Phase 11: Smart Provider Setup - Context

**Gathered:** 2026-04-20
**Status:** Ready for research
**Mode:** Auto — all gray areas resolved by Claude applying pragmatic defaults grounded in Phase 10 audit + codebase scout (user delegation pattern from Phase 10 continues)

<domain>
## Phase Boundary

Replace the 6-hardcoded-provider onboarding + Settings UI with a **paste-any-config** flow that auto-extracts provider / model / `base_url` / headers from cURL, JSON-blob, or Python-SDK snippets, runs **one capability probe** on save, persists the probe result as provider capability metadata, and makes `router.rs` consult per-capability preferences with a fallback chain so "Groq + llama for vision" routes to `vision_provider` instead of silently failing.

**Scope (from ROADMAP.md Phase 11 + REQUIREMENTS.md PROV-01..09):**
1. Paste-parser module shared between onboarding and Settings (`src/features/providers/parser/`)
2. Capability probe on key save (`src-tauri/src/capability_probe.rs`)
3. Per-capability config fields in `BladeConfig` / `DiskConfig` (6-place pattern)
4. Capability-gap UX across ≥2 vision + ≥2 audio + long-context + tools surfaces (PROV-07/08)
5. `router.rs` rewire: consult capability config, fallback chain on miss (PROV-09)

**Out of scope (Phase 12+):**
- Smart Deep Scan defaults — that's Phase 12 (SCAN-01..13)
- Ecosystem auto-enable based on capability — that's Phase 13 (ECOSYS-01..10)
- Activity-surface wiring for probe events — Phase 14 (WIRE2/LOG-02)

**Anchors this phase mirrors:**
- Phase 10 audit §"Tester-Pass Evidence Map" symptom #7 (Groq+llama routing miss) is the falsifiable close-target.
- Phase 10 audit §4 NOT-WIRED rows: `fallback_providers`, `task_routing` capability slots, `router.rs::classify_message`.
- Tester-pass commit `4ab464c` silence-log-spam posture: probe test call is **idempotent** — surface error once, do NOT retry in loop (ROADMAP note).

</domain>

<decisions>
## Implementation Decisions

### D-51: Paste-Parser Design = Single Rust Module + Three Format Detectors

**Single source-of-truth parser** at `src-tauri/src/provider_paste_parser.rs`. Three detectors run in order:

1. **cURL detector** — matches on leading `curl ` (with optional backslashes for line continuations). Extracts `-X POST`, `--url`, `-H 'Authorization: Bearer …'`, `-H 'x-api-key: …'`, `--data` / `-d` payload (parse JSON body for `"model": "…"`). Returns `{ provider_guess, base_url, api_key, model, headers: {} }`.
2. **JSON-blob detector** — matches on leading `{` that parses as JSON with any of `base_url` / `api_key` / `model` / `provider` / `apiKey` keys. Returns same shape.
3. **Python-SDK detector** — matches on `OpenAI(…)` / `Anthropic(…)` / `Groq(…)` / generic `Client(api_key=…, base_url=…)` constructor patterns via regex. Returns same shape.

**Provider guessing** is done from `base_url` hostname: `api.openai.com` → `openai`, `api.anthropic.com` → `anthropic`, `api.groq.com` → `groq`, `generativelanguage.googleapis.com` → `gemini`, `openrouter.ai` → `openrouter`, `localhost` / `127.0.0.1` → `ollama`, else → `custom`.

**Model extraction priority:** explicit `"model"` key in JSON body > `model=` kwarg in SDK snippet > `-d` JSON body in cURL > fallback to empty string (user picks later).

**Exposed as one Tauri command:** `parse_provider_paste(input: String) -> Result<ParsedProviderConfig, String>`. Onboarding + Settings share this command — no frontend-side parser. Placing the parser in Rust avoids shipping regex-bloat to the web bundle and makes it accessible to future CLI/MCP callers.

**Why Rust over TypeScript:** Phase 10 audit §5 DEAD row `DiskConfig.api_key` flagged the keyring-is-source-of-truth pattern. The parser should produce a structured result that feeds directly into existing `test_connection()` + `storeProviderKey()` pipeline; keeping it in Rust avoids serialization round-trips and reuses `crate::config::get_provider_key()` when parsing fails and we need to show "detected but no key" state.

**Failure mode:** parse returns `Err(descriptive_string)` — "Could not detect provider from input. Supported: cURL / JSON config / Python SDK snippet. Your input started with: `<first 40 chars>`." The UI shows the error inline next to the textarea; does NOT attempt to re-parse with lower confidence.

### D-52: Capability Probe = One Idempotent Test Call + Metadata Table

**One probe per key save.** Not a loop, not retried, not automatic-on-config-change. Triggered explicitly by user clicking "Save & test" in Settings or completing paste flow in onboarding.

**Probe call shape:** minimal chat-completion call with `max_tokens: 1` (or provider-equivalent) against the detected model. Captures from the response:
- HTTP status (200 = ACTIVE, 401/403 = INVALID_KEY, 404 = MODEL_NOT_FOUND, 429 = RATE_LIMITED_BUT_VALID, 5xx = PROVIDER_DOWN)
- Response headers (`x-anthropic-beta`, `openrouter-capabilities`, response `usage` block)
- Response body `model` field (some providers rename; probe captures the canonical name)

**Capability inference rules (static table, not dynamic probing):**
- `vision`: true if provider ∈ {anthropic (claude-3+), openai (gpt-4o / gpt-4-vision / gpt-5), gemini (any), openrouter (model name contains `vision` / `gpt-4o` / `claude-3` / `gemini`)}
- `audio`: true if model name contains `audio` OR provider ∈ {openai (gpt-4o-audio-*, whisper-*), elevenlabs, cartesia}
- `tool_calling`: true if provider ∈ {anthropic, openai, gemini, groq (most llama-3.3+), openrouter (model-dependent — conservative false if model name contains `:free`)}
- `long_context`: true if model context_window ≥ 100k OR model name contains `1m` / `200k` / `claude-sonnet-4.5+` / `gpt-4o-long` / `gemini-1.5-pro` / `gemini-2`

**Why static table + API response inference (not a full dynamic image-upload test):** Full dynamic testing would require sending a real image / audio blob to every provider on every save — high latency, high API cost, fragile (providers rate-limit test calls). Static capability-matrix-per-provider is how every production LLM gateway (LiteLLM, LangChain, Vercel AI SDK) handles this. The probe's job is to **validate the key works and capture model metadata**; the capability flags come from the matrix.

**Probe metadata storage:** new field `BladeConfig.provider_capabilities: HashMap<String, ProviderCapabilityRecord>` where record is `{ model: String, context_window: u32, vision: bool, audio: bool, tool_calling: bool, long_context: bool, last_probed: DateTime<Utc>, probe_status: ProbeStatus }`. 6-place config pattern applied verbatim.

**Probe result display:** in Settings → Providers, each row shows a capability pill strip: `[✓ vision] [✗ audio] [✓ tools] [✓ 128k ctx]`. Onboarding shows the same strip right after paste-save.

**Re-probe trigger:** explicit user action only. Settings → Providers row has an "Re-probe" icon button next to the capability pills. No background automatic re-probing (per tester-pass `4ab464c` silence-log-spam discipline — no loops).

### D-53: Per-Capability Config Fields = 4 Fields (Vision / Audio / Long-Context / Tools)

**New fields in `BladeConfig` (6-place pattern, per PROV-06):**

```rust
pub vision_provider: Option<String>,        // e.g. "anthropic/claude-sonnet-4"
pub audio_provider: Option<String>,         // e.g. "openai/gpt-4o-audio-preview"
pub long_context_provider: Option<String>,  // e.g. "gemini/gemini-1.5-pro"
pub tools_provider: Option<String>,         // e.g. "anthropic/claude-sonnet-4"
```

These are `Option<String>` (not `String`) because empty = "derive from primary provider + capability matrix" (graceful degradation). When set, they override the routing heuristic.

**Existing `TaskRouting` struct (config.rs:17-33) relationship:** existing fields (`code`, `vision`, `fast`, `creative`, `fallback`) are **task-type** slots (which provider for code tasks, creative tasks, etc.). The new 4 fields are **capability-guaranteed** slots (which provider when a capability is REQUIRED). They coexist:
- `task_routing.creative = "groq/llama"` → user preference for creative tasks
- `vision_provider = "anthropic/claude"` → capability guarantee when image attached

Router resolution order (see D-55 below): capability requirement (hard) > task_routing preference (soft) > primary provider (fallback).

**Why not merge the two?** Task-type routing is a **preference layer**; capability routing is a **correctness layer**. Merging would conflate "user prefers Groq for creative" with "this request needs vision" — the first is override-able, the second is not. Keeping them distinct lets the router apply capability as a hard filter before applying task-type as a soft preference.

**Default values:** all 4 `None` on fresh install. First capability probe that shows a capability-supporting provider auto-populates the corresponding field (e.g. adding an Anthropic key with `vision=true` auto-sets `vision_provider` IFF the slot is currently `None`; does NOT overwrite an explicit user choice). This is the "smart default" behavior without being "magic that undoes what the user set".

### D-54: Capability-Gap UX = Reusable `<CapabilityGap>` Component + Surface Registry

**One component**, `src/features/providers/CapabilityGap.tsx`, renders the "needs vision-capable model" prompt. Props:
```tsx
<CapabilityGap capability="vision" /* | "audio" | "long_context" | "tools" */ />
```

**Component content:**
- Icon matching capability (camera for vision, mic for audio, clock for long-context, wrench for tools)
- Headline: "Needs a vision-capable model" (copy varies by capability; writing spec inline below)
- Body: "Your current provider doesn't support this. Add a provider that does to use this feature."
- CTA button: "Add a provider" → opens Settings → Providers with the paste-textarea focused, query-param `?needs=vision`
- Secondary link: "Learn which models support vision" → docs anchor

**Copy per capability (locked — planner uses verbatim):**
- `vision`: "Needs a vision-capable model" / "This view analyzes what's on screen. Add a provider like Anthropic, OpenAI, or Gemini that can read images."
- `audio`: "Needs an audio-capable model" / "This view transcribes or generates speech. Add a provider that supports audio (OpenAI gpt-4o-audio, ElevenLabs, Cartesia)."
- `long_context`: "Needs a long-context model" / "This input is too long for the current provider's context window. Add a provider with 100k+ context (Claude, Gemini 1.5, GPT-4-turbo)."
- `tools`: "Needs a tool-calling model" / "This feature uses tools to take actions. Add a provider that supports function calling (Claude, GPT-4, Gemini, most Llama 3.3+)."

**Surface registry** — `src/features/providers/CAPABILITY_SURFACES.ts`:
```ts
export const CAPABILITY_SURFACES = {
  vision: [
    { route: "screen-timeline", label: "Screen Timeline" },
    { route: "quickask", label: "QuickAsk image input" },
    { route: "web-automation", label: "Browser visual assertions" },
  ],
  audio: [
    { route: "voice-orb", label: "Voice Orb TTS" },
    { route: "meeting-ghost", label: "Meeting Ghost transcription" },
  ],
  long_context: [
    { route: "chat", label: "Chat with long input" },
    { route: "knowledge-full-repo", label: "Full-repo indexing" },
  ],
  tools: [
    { route: "agents-swarm", label: "Multi-agent swarm" },
    { route: "web-automation", label: "Web automation" },
  ],
} as const;
```

**Why a registry?** Phase 10 audit identified 3-5 candidate vision surfaces and similar for audio/long-context/tools. Hardcoding the list in a single registry makes PROV-07/08 falsifiable ("is this exact list of surfaces gated?") and gives Phase 14 a verbatim wiring target. The registry is consumed by the `useCapability(capability)` hook that returns `{ hasCapability, suggestedProvider, openAddFlow }` — surfaces call this hook and render `<CapabilityGap />` when `hasCapability === false`.

**Acceptance bar for PROV-07:** `CAPABILITY_SURFACES.vision` has at least 2 entries, all 2 render `<CapabilityGap capability="vision" />` when no vision-capable provider is configured. PROV-08 requires the same bar for audio + long-context + tools respectively (≥2 surfaces each where "surface" means a route or a component instance — counting repeats in different routes).

### D-55: Router Rewire = 3-Tier Resolution + Fallback Chain

**`router.rs::classify_task()` stays the same** (returns `TaskType` enum from keywords/image-detection). What changes is **provider selection** after classification.

**New function:** `router.rs::select_provider(task_type: TaskType, config: &BladeConfig, provider_capabilities: &HashMap<String, ProviderCapabilityRecord>) -> (String, String, Vec<String>)` returning `(provider, model, fallback_chain)`.

**Resolution tiers (in order, first match wins for primary; accumulate chain):**

1. **Capability-hard-filter.** If `task_type == Vision` (or audio / long-context / tools detected), fetch the capability-required list of providers (from `provider_capabilities` matrix, filter `.vision == true`). If `config.vision_provider` is Some AND its provider is in the capability list → primary. Else pick first provider from capability list that has a stored API key.

2. **Task-type-soft-preference.** If no capability required OR no capability-matching provider, consult `config.task_routing` for the task_type (e.g. `task_routing.creative` for `TaskType::Creative`). If set AND key exists → primary.

3. **Primary fallback.** `config.provider` + `config.model` — always the final primary if no more-specific routing applies.

**Fallback chain (for transient errors 429/503/5xx, same as existing `fallback_chain_complete()`):**
- Build ordered list: [primary, …capability-matching providers with keys, …`config.fallback_providers`, …other providers with keys] — dedupe preserving order.
- **Hard rule:** if the original task required vision (or other capability), **every element** in the fallback chain must support that capability. Non-capable providers are filtered out. Prevents "fallback to a non-vision provider on vision task" — the exact bug PROV-09 closes.

**Custom-`base_url` escape hatch (per codebase scout gotcha #2):** if `config.base_url.is_some()`, skip tiers 1–2 entirely and use `(provider, model, [primary_only])`. User who pasted a custom endpoint knows what they're doing — don't second-guess. This matches the existing config.rs:681-683 behavior.

**Error surface (per tester-pass 4ab464c posture):** if ALL tiers fail (no capable provider, no fallback), surface ONE clear error event `blade_routing_capability_missing` with payload `{ capability: "vision", task_type: "Vision", message: "..." }`. Frontend shows inline in chat stream. Does NOT retry, does NOT loop.

### D-56: Onboarding Custom-Paste Flow = Fourth Tab (Not Replacement) — Preserves v1.0 Discoverability

**Decision:** onboarding's 6 hardcoded provider cards STAY. A new "Custom / paste config" affordance is added as a **prominent fourth row / primary CTA** beneath the 6-card grid.

**Not "replace the 6 cards":** the tester-pass evidence (Phase 10 audit §A symptom #6) is about **unreachable options** — keys the user expected to configure weren't there. The 6 cards are already paths users know; removing them to force the paste flow creates a new discoverability gap for a worse reason (users who DON'T want to paste cURL have to).

**Layout spec (consumed verbatim by UI-SPEC.md research):**
```
[6-card grid — unchanged]
  [ Anthropic ] [ OpenAI ] [ OpenRouter ]
  [ Gemini    ] [ Groq   ] [ Ollama     ]

—— or ——                                   ← visual divider

[ ◈ Paste any config ]                    ← single-full-width card
  Paste a cURL, JSON config, or Python SDK
  snippet. We'll detect the provider and
  probe for capabilities.
  [ Paste here ... (textarea) ]
  [ Detect & probe ] button
```

**Why "or" framing:** communicates these are alternatives, not layered choices. Users who recognize their provider click its card; users with a custom endpoint (NVIDIA NIM, DeepSeek, self-hosted vLLM, OpenRouter with specific model) paste. Both paths converge to `parse_provider_paste` → `capability_probe` → `save_key` pipeline.

**PROV-04 "alongside" interpretation:** ROADMAP calls it "a custom config paste affordance alongside the 6 hardcoded provider cards". "Alongside" = preserve the cards, add paste. Locked.

### D-57: Fallback-Provider Order UI = Settings → Providers New Section

**Problem identified by codebase scout #3:** `config.fallback_providers` exists, is wired in `fallback_chain_complete()`, but has ZERO UI.

**Decision:** Settings → Providers gains a new section titled "Fallback order" below the provider list. Renders the current fallback chain as a draggable list of provider pills; each pill shows `[provider] [primary-model]`. User drags to reorder. A "Use all providers with keys" toggle auto-populates the list from keys-present providers.

**Persists to** `DiskConfig.fallback_providers: Vec<String>` (already exists; audit row confirmed). No new field.

**Why include this in Phase 11 (vs. Phase 14 WIRE2):** the router rewire (D-55) relies on `fallback_providers` for ordering. Without a UI, users can't tune the chain, and Phase 11's success criterion #5 ("fallback chain, not primary when primary lacks vision") becomes untestable end-to-end. A minimal drag-to-reorder list is cheap; deferring to Phase 14 would land the router change without its control surface.

**Out of scope for D-57:** per-task fallback chains (would require fallback_providers_by_task map). That's Phase 12+ if ever.

### D-58: Subagent Plan Layout = 5 Plans in 3 Waves

**Wave 0 (substrate — must land first):**
- **Plan 11-01:** `provider_paste_parser.rs` + `parse_provider_paste` Tauri command + unit tests (7+ paste scenarios: OpenAI cURL, Anthropic cURL, Groq cURL, JSON config, Python SDK, custom base_url, malformed input) — pure Rust, no UI.
- **Plan 11-02:** `capability_probe.rs` + `probe_provider_capabilities` Tauri command + ProviderCapabilityRecord struct + 6-place config pattern for `provider_capabilities` HashMap + `vision_provider` / `audio_provider` / `long_context_provider` / `tools_provider` fields — pure Rust.

**Wave 1 (parallel UI + router rewire — depends on Wave 0):**
- **Plan 11-03:** Onboarding paste flow + Settings paste flow (shared `<ProviderPasteForm>` component) + capability pill strip in provider rows + re-probe button + fallback-order drag list. Consumes `parse_provider_paste` + `probe_provider_capabilities` commands.
- **Plan 11-04:** `router.rs::select_provider` rewire + capability-hard-filter fallback chain + `blade_routing_capability_missing` event emission + unit test per resolution tier.
- **Plan 11-05:** `<CapabilityGap>` component + `useCapability()` hook + `CAPABILITY_SURFACES` registry + wiring the 4 capabilities across ≥2 surfaces each (minimum for PROV-07/08 acceptance).

**Wave 2 (integration verification):**
- **Plan 11-06:** End-to-end manual trace + unit tests proving success criteria 3+4+5 from ROADMAP. Updates `scripts/verify-providers-capability.mjs` (new gate) and chains into `npm run verify:all` as gate 20.

**Why Wave 1 has parallel frontend + router:** they don't share files. `router.rs` + `router.test.rs` (backend) vs. React components (frontend) — clean worktree parallelism like Phase 10.

### Claude's Discretion
- Exact shape of `ParsedProviderConfig` struct fields — researcher + planner can refine as cURL/JSON/SDK samples surface edge cases.
- React component decomposition within `<ProviderPasteForm>` (one component or sub-components for textarea / detected fields / probe status).
- Error event names beyond `blade_routing_capability_missing` — follow `BLADE_EVENTS` registry conventions.
- Whether capability probe runs a SECOND minimal call to verify tool-calling (via a dummy `tools: [{}]` request) — default NO (too expensive, static matrix suffices); planner can revisit if PROV-05 tester feedback demands.
- Default sort order in the fallback-order drag list (recommend: primary first, then capability-required providers alphabetically).
- Exact copy wording inside `<CapabilityGap>` — researcher may polish the body text; the 4 headlines above are locked.

### Folded Todos
None — no pending todos matched Phase 11 scope at init time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-level specs
- `.planning/PROJECT.md` — v1.1 anchor, M-01..M-07 decisions, constraints
- `.planning/REQUIREMENTS.md` §"Smart Provider Setup (PROV)" — PROV-01..09
- `.planning/ROADMAP.md` §"Phase 11: Smart Provider Setup" — goal, success criteria, depends_on
- `.planning/STATE.md` — current position (Phase 10 complete, Phase 11 active)
- `.planning/notes/v1-1-milestone-shape.md` §"Phase 1 — Smart Provider Setup" — locked shape; §"Why this framing" symptom #7 (Groq+llama) is the falsifiable close-target
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` §"NOT-WIRED Backlog" — `fallback_providers`, `task_routing` slots, `router.rs::classify_message` rows
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` — machine query target for capability-gap surface identification

### Backend authority (audit input)
- `src-tauri/src/config.rs:17-33` — existing `TaskRouting` struct (task-type slots; coexists with new capability slots per D-53)
- `src-tauri/src/config.rs:225-326` — `BladeConfig` struct (6-place pattern target)
- `src-tauri/src/config.rs:681-683` — custom `base_url` escape hatch (D-55 tier-0 gate)
- `src-tauri/src/config.rs:289` — `fallback_providers: Vec<String>` (D-57 UI target)
- `src-tauri/src/providers/mod.rs:40-64` — `parse_model_string` (reuse for capability-filtered chain)
- `src-tauri/src/providers/mod.rs:72-84` — `resolve_provider_model` key lookup
- `src-tauri/src/providers/mod.rs:565-584` — `test_connection` (probe wraps this)
- `src-tauri/src/providers/mod.rs:586-707` — `fallback_chain_complete` (D-55 extends with capability filter)
- `src-tauri/src/providers/mod.rs:90-112` — `is_fallback_eligible_error` (reuse verbatim)
- `src-tauri/src/router.rs:19-117` — `classify_task` (stays unchanged)
- `src-tauri/src/router.rs:150` — OpenRouter model opt-out (per CLAUDE.md gotcha)

### Frontend authority
- `src/features/onboarding/ProviderPicker.tsx` — 6-card grid (D-56 preserves, adds fourth-row paste card)
- `src/features/onboarding/providers.ts:40-101` — `PROVIDERS` array (reused by onboarding + Settings)
- `src/features/settings/panes/ProvidersPane.tsx` — current add-key UI (D-56 extends with paste form + capability pills)
- `src/features/settings/panes/RoutingPane.tsx` — `TaskRouting` editor (per-task-type slots; coexists with capability slots)
- `src/lib/tauri/` — `invokeTyped` wrappers; `parse_provider_paste` + `probe_provider_capabilities` + `select_provider_v2` get new typed wrappers
- `src/lib/events/index.ts` — `BLADE_EVENTS` registry; add `ROUTING_CAPABILITY_MISSING` constant
- `src/features/providers/` — NEW folder for CapabilityGap component + useCapability hook + CAPABILITY_SURFACES registry + ProviderPasteForm

### Capability-gap surface candidates (from codebase scout #8)
- `src/features/knowledge/ScreenTimeline.tsx` (vision)
- `src/features/quickask/*` (vision — image input path)
- `src/features/dev-tools/WebAutomation.tsx` (vision + tools)
- `src/features/settings/panes/RoutingPane.tsx` (all capabilities — gate dropdowns)
- `src/features/admin/ModelComparison.tsx` (all capabilities — flag unsupported task types per provider)
- `src/features/chat/useChat.tsx` (long-context + tools)
- Voice Orb route (audio) — exact path TBD during Plan 11-05 execution

### Architecture context
- `docs/architecture/2026-04-16-blade-body-architecture-design.md` — body system context
- `docs/architecture/2026-04-17-blade-frontend-architecture.md` — frontend router + feature structure
- `.planning/codebase/CONVENTIONS.md` — 6-place config pattern (critical for D-52 + D-53)

### Tester-pass evidence (ground-truth close target)
- Commit `4ab464c` — silence-log-spam + surface-chat-errors posture; capability probe MUST follow same "don't retry in loop, surface error once" rule
- `.planning/notes/v1-1-milestone-shape.md` §"Why this framing" symptom #7 (Groq+llama capability miss) — the single falsifiable regression this phase closes

### Explicitly NOT to read
- `src.bak/` — dead pre-rebuild frontend
- Phase 0-9 CONTEXT/RESEARCH — v1.0 substrate only, superseded by Phase 10+ for v1.1 context

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `providers/mod.rs::fallback_chain_complete` + `is_fallback_eligible_error` — router's new fallback logic extends this rather than re-implementing retry/classification
- `providers/mod.rs::test_connection` — capability probe wraps this with metadata extraction; don't duplicate the HTTP call plumbing
- `config.rs` 6-place config pattern — documented, enforced; new fields plug in directly
- `src/features/onboarding/providers.ts` `PROVIDERS` array — reused by Settings; continues to live as source-of-truth for the 6 "blessed" providers (D-56)
- `src/lib/tauri/invokeTyped` — single-entry-point enforces `verify:no-raw-tauri` gate; all new commands go through this

### Established Patterns
- **6-place config pattern** — any new `BladeConfig` field MUST appear in: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`. Phase 10 Subagent C audit surfaces fields <6 places as WIRED-NOT-USED.
- **`invokeTyped<T>(command, args)`** — no raw `invoke(...)` in `src/`; enforced by verify gate
- **`useTauriEvent(BLADE_EVENTS.X, handler)`** — no raw `listen(...)`; enforced
- **Capability matrix static-table** — matches LiteLLM / LangChain / Vercel AI SDK production approach; avoids dynamic probe cost

### Integration Points
- Phase 12 (Smart Deep Scan) consumes `provider_capabilities` to skip capability-specific scanners if no supporting provider exists
- Phase 13 (Self-Configuring Ecosystem) reads `provider_capabilities` + `task_routing` to auto-enable observer-class tentacles (e.g. vision-requiring screen-analyzer only if `vision_provider` is set)
- Phase 14 (WIRE2) consumes:
  - New `fallback-order` Settings section as the model for "WIRED-NOT-USED → UI added" pattern
  - `CAPABILITY_SURFACES` registry as the canonical list for Phase 14 wiring audits ("does surface X render `<CapabilityGap>` when `useCapability` says no?")
- Phase 15 (reachability) consumes:
  - New `verify:providers-capability` gate as an example of a Phase-N-originated gate joining `verify:all`

### Notable Scale Numbers (for subagent sizing)
- 0 existing paste parsers → Plan 11-01 starts from scratch
- 1 existing `test_connection()` → Plan 11-02 wraps it + adds capability extraction
- ~40 BladeConfig fields → +5 new fields (provider_capabilities HashMap + 4 capability_provider Options)
- 3-7 capability surfaces to wire × 4 capabilities = 12-28 touch points → Plan 11-05 does ~8 minimum (2 per capability per PROV-07/08)
- 19 verify gates → +1 (verify:providers-capability) = 20 post-Phase-11

### Explicitly not re-doing
- `task_routing` struct (exists, keeps its task-type semantics)
- `fallback_providers` persistence (exists, Phase 11 adds UI)
- `test_connection()` (exists, Phase 11 wraps for capability metadata)
- `classify_task()` keyword heuristics (exists, stays as-is — router.rs changes are ONLY in provider selection after classification)

</code_context>

<specifics>
## Specific Ideas

**From Arnav (direction delegated to Claude this session, continuing Phase 10 pattern):**
- *"continue"* — user delegated Phase 11 gray-area resolution to Claude. Decisions above are grounded in: (a) Phase 10 audit findings (the falsifiable close-targets), (b) codebase scout evidence (existing wiring gaps, keyring service pattern, custom-base_url escape hatch), (c) ROADMAP Phase 11 + REQUIREMENTS PROV-01..09 (locked scope), (d) tester-pass commit `4ab464c` posture (don't retry in loop, surface error once).

**Anchors from v1.1 shape doc (locked 2026-04-20):**
- *"Groq + llama produced nothing useful — no capability-aware routing"* → D-55 (3-tier resolution) + D-53 (capability config) are the primary closers.
- *"The probe test call is idempotent and must not be retried in a loop on failure — surface the error clearly"* → ROADMAP Phase 11 Notes, already a locked constraint. D-52 carries this verbatim.
- *"Replace the 6 hardcoded provider cards"* — D-56 nuances this to "ADD paste alongside, do not remove the 6". Rationale: the tester-pass symptom was about unreachable options, not about too-many-options; removing the cards trades one discoverability problem for another.

**Design lineage from Phase 10:**
- Single-monolithic-doc-with-appendices (Phase 0 → Phase 10 pattern) — N/A for Phase 11 (this is a build phase, not an audit phase).
- Hybrid subagent + inline synthesis (Phase 0 D-18 → Phase 10 D-50) — D-58 applies: 5 plans with Wave 0 substrate, Wave 1 parallel UI + router, Wave 2 verification. Not subagent-heavy because the work is code-changing not catalog-extraction.

</specifics>

<deferred>
## Deferred Ideas

### Out of Phase 11 scope — already assigned to other phases
- **Smart deep-scan defaults** — Phase 12 (SCAN-01..13). Phase 11 only adds capability config; Phase 12 uses it.
- **Ecosystem auto-enable based on capability** — Phase 13 (ECOSYS-01..10). Phase 11's capability metadata is a pure read by Phase 13.
- **Activity log for probe events** — Phase 14 (LOG-02). Phase 11 emits `blade_routing_capability_missing` + similar, Phase 14 instruments the activity surface.
- **`classify_message` Tauri command wiring** — Phase 14 WIRE2 (Phase 10 audit row). Router-internal use only in Phase 11; external wiring deferred.

### Out of Phase 11 scope — explicitly parked
- **Per-task-type fallback chains** (e.g. `fallback_providers_by_task: HashMap<TaskType, Vec<String>>`) — deferred. Single fallback chain suffices for v1.1. If tester feedback post-v1.1 demands per-task chains, add to v1.2 backlog.
- **Dynamic capability probing** (actually send a test image to confirm vision) — deferred. Static matrix is the production pattern; dynamic probing is v1.2+ exploration if static matrix proves inaccurate.
- **Re-probe on schedule** (weekly, on app launch, etc.) — deferred. Explicit user action only in v1.1 per tester-pass posture. Re-probe-on-use-error (auto-re-probe after 401) is in v1.2 idea parking lot.
- **OpenRouter model metadata auto-fetch** — OpenRouter exposes `/v1/models` with per-model capability flags; auto-populating capability matrix from that endpoint would be great. Deferred: adds per-provider-specific code complexity that v1.1 scope doesn't justify. v1.2 target.
- **Capability-matrix auto-update** — matrix lives in Rust code; new providers/models require a code change. Deferred: moving to config file + CDN refresh is v1.2+.

### Reviewed Todos (not folded)
No pending todos matched Phase 11 scope.

</deferred>

---

*Phase: 11-smart-provider-setup*
*Context gathered: 2026-04-20 — auto mode, user delegated all gray-area decisions to Claude (Phase 10 pattern continues)*
