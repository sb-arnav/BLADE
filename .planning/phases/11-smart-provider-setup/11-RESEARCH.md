# Phase 11: Smart Provider Setup - Research

**Researched:** 2026-04-20
**Domain:** LLM provider config parsing + capability-aware routing + 6-place config pattern
**Confidence:** HIGH (codebase evidence for all integration points; capability matrix cross-referenced with provider docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-51..D-58)

**D-51 — Paste-parser = single Rust module + three format detectors.** Location `src-tauri/src/provider_paste_parser.rs`. Three detectors run in order (cURL, JSON-blob, Python-SDK). Provider guessed from `base_url` hostname. Exposed as one Tauri command `parse_provider_paste(input: String) -> Result<ParsedProviderConfig, String>`. No frontend parser. Failure returns `Err(descriptive_string)` inline, no silent retry.

**D-52 — Capability probe = one idempotent test call + metadata table.** One probe per key save. Minimal chat call with `max_tokens: 1`. Capability flags from **static capability matrix** (not dynamic image/audio upload). Stored in new `BladeConfig.provider_capabilities: HashMap<String, ProviderCapabilityRecord>`. Re-probe is explicit user action only, no background re-probing. Follows `4ab464c` "don't loop, surface once" posture.

**D-53 — Per-capability config = 4 fields.** `vision_provider`, `audio_provider`, `long_context_provider`, `tools_provider` — all `Option<String>` in `BladeConfig`. Coexist with existing `TaskRouting` (task-type preferences). Router order: capability hard-filter > task_routing soft preference > primary fallback. Smart auto-population: first capable provider populates IFF slot is `None`, never overwrites user choice.

**D-54 — `<CapabilityGap>` component + surface registry.** `src/features/providers/CapabilityGap.tsx` + `CAPABILITY_SURFACES.ts` registry (9 entries across 4 capabilities). `useCapability(cap)` hook. CTA opens Settings → Providers with `?needs=vision` and focuses paste textarea. Copy locked verbatim in UI-SPEC §Copywriting Contract.

**D-55 — Router rewire = 3-tier resolution + fallback chain.** `classify_task` stays unchanged. New function `select_provider(task_type, config, provider_capabilities) -> (provider, model, fallback_chain)`. Tier 1 capability-hard-filter, tier 2 task-routing soft preference, tier 3 primary fallback. Custom `base_url` escape hatch = tiers 1-2 skipped. Fallback chain capability-filtered so vision tasks never fall to a non-vision provider. Emits `blade_routing_capability_missing` event when no capable provider found.

**D-56 — Onboarding preserves 6 cards + adds paste card.** The 6-card grid stays; new "Paste any config" full-width card added beneath with "or" divider. Both paths converge into the same `parse_provider_paste → capability_probe → save_key` pipeline.

**D-57 — Fallback-order drag UI.** New Settings → Providers section "Fallback order". Draggable list of provider pills, "Use all providers with keys" toggle. Persists to existing `DiskConfig.fallback_providers: Vec<String>` (no new field).

**D-58 — 5 plans in 3 waves.**
- Wave 0 (Rust substrate): Plan 11-01 (parser), Plan 11-02 (probe + config fields)
- Wave 1 (parallel UI + router): Plan 11-03 (UI: paste flow, pill strip, fallback drag list), Plan 11-04 (router rewire), Plan 11-05 (CapabilityGap + surface wiring)
- Wave 2 (integration): Plan 11-06 (verify gate + e2e traces)

### Claude's Discretion

- Exact shape of `ParsedProviderConfig` struct (researcher/planner refine with paste samples)
- Sub-component decomposition inside `<ProviderPasteForm>`
- Error event names beyond `blade_routing_capability_missing` (follow `BLADE_EVENTS` conventions)
- Second tool-calling verification probe — default NO
- Default sort order in fallback-order drag list (recommend: primary first, then capability-required alphabetically)
- Exact body copy polish inside `<CapabilityGap>` (4 headlines are LOCKED, body can be tuned)

### Deferred Ideas (OUT OF SCOPE)

- **Smart deep-scan defaults** — Phase 12
- **Ecosystem auto-enable based on capability** — Phase 13
- **Activity log for probe events** — Phase 14
- **`classify_message` command external wiring** — Phase 14
- **Per-task-type fallback chains** — v1.2+
- **Dynamic capability probing** (send real image/audio to confirm) — v1.2+
- **Re-probe on schedule** — v1.2+
- **OpenRouter `/v1/models` auto-ingest** — v1.2+
- **Capability-matrix from config file + CDN refresh** — v1.2+
- **Extended-thinking as a 5th capability** — NOT in Phase 11 scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROV-01 | Pasting a raw cURL auto-extracts provider/model/base_url/headers | §Standard Stack (parser module) + §Code Examples §cURL detector + §Paste Sample Corpus |
| PROV-02 | Pasting a JSON config blob produces the same auto-fill | §Paste Sample Corpus §JSON + §Code Examples §JSON detector |
| PROV-03 | Pasting a Python SDK snippet produces the same auto-fill | §Paste Sample Corpus §Python + §Code Examples §Python detector |
| PROV-04 | Onboarding exposes a "custom config paste" alongside 6 cards | UI-SPEC Surface A — component reused verbatim; no new routing needed |
| PROV-05 | Key save triggers one test call; probe result persists in config | §Standard Stack (`capability_probe.rs` wraps `test_connection`) + §Test-Call Shapes |
| PROV-06 | `BladeConfig` stores per-capability preference | §6-Place Config Plan — 5 new fields; exact line-ranges documented |
| PROV-07 | Vision-requiring UI surfaces show CapabilityGap prompt — ≥2 surfaces | §Capability Surfaces — 3 vision surfaces already identified |
| PROV-08 | Same handling for audio / long-context / tools capability gaps | §Capability Surfaces — 2+ surfaces per capability identified |
| PROV-09 | Router consults per-capability config; fallback chain on miss | §Router Rewire + §Fallback Chain Algorithm |
</phase_requirements>

## Summary

Phase 11 is a pure integration phase: every Rust primitive (keyring, `test_connection`, fallback chain, 6-place config pattern) already exists; every frontend primitive (`<Card>`, `<Pill>`, `<Input>`, `<EmptyState>`, `<GlassSpinner>`, `useTauriEvent`, `invokeTyped`, `openRoute`) already exists. Phase 11 wires them together with **one new Rust module** (`provider_paste_parser.rs`), **one new capability probe wrapper** (`capability_probe.rs`), **one new router function** (`select_provider`), **four new frontend components** (ProviderPasteForm, CapabilityPillStrip, CapabilityGap, FallbackOrderList), and **5 new BladeConfig fields** (each requires the strict 6-place update).

The risk surface is narrow and well-understood: paste parsing is a regex problem with ≥7 test samples per format, capability matrix is a static hard-coded HashMap (zero drift vs. production LLM gateways), router rewire has exactly **one high-frequency call site** (`commands.rs:744`) plus **25+ low-frequency background-task call sites** using `resolve_provider_for_task` — the new `select_provider` replaces only the chat call path in Wave 1, background loops keep using `resolve_provider_for_task` (phase-out is v1.2 work).

**Primary recommendation:** Build `provider_paste_parser.rs` as pure Rust with no Tauri dependency (unit-testable), publish as `#[tauri::command] parse_provider_paste`, and consume from both onboarding + Settings via a shared `<ProviderPasteForm>` — exactly as D-51 + D-56 dictate. The 4 capability fields route through D-55's 3-tier resolution in `commands.rs:send_message_stream`; defer the 25+ background call sites' routing upgrade to a v1.2 deliberate sweep because changing them mid-Phase-11 expands blast radius beyond capability routing into "background LLM calls suddenly route differently."

## Project Constraints (from CLAUDE.md)

- **6-place config pattern** — MUST hit `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`. Phase 10 audit catches any field with <6 places as WIRED-NOT-USED.
- **Module registration** — new Rust module requires `mod module_name;` in `lib.rs`; new Tauri command requires addition to `generate_handler![]`. Tauri macro namespace is FLAT — no duplicate `#[tauri::command]` function names across modules.
- **`use tauri::Manager;`** — required when calling `app.state()` (not needed for the Phase 11 commands, which use `AppHandle` only for event emission).
- **Don't run `cargo check` after every small edit** — batch edits, check at wave boundaries.
- **String slicing** — use `crate::safe_slice(text, max_chars)` for user content, not `&text[..n]`. Applies to parser error messages that include "your input started with: `<first 40 chars>`".
- **No `grep`/`cat`/`find` in bash for research** — use Read/Grep/Glob tools (already followed).
- **`invokeTyped` + `useTauriEvent`** — enforced by `verify:no-raw-tauri` gate.
- **No `Co-Authored-By` in commits** — Arnav is the sole author.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Paste parsing (cURL / JSON / Python-SDK) | API / Backend (Rust) | — | D-51: regex-heavy; keeping in Rust avoids bundle bloat and lets CLI/MCP reuse |
| Capability probe (HTTP test call) | API / Backend (Rust) | — | Network call with keyring access; cannot run from browser due to CORS + key handling |
| Capability matrix (model → flags) | API / Backend (Rust) | — | Static `LazyLock<HashMap<…>>`; router reads it server-side |
| Provider selection (`select_provider`) | API / Backend (Rust) | — | Called from `commands.rs::send_message_stream` before LLM dispatch |
| Fallback chain construction | API / Backend (Rust) | — | Same call path; reuses `fallback_chain_complete` infrastructure |
| Paste form UX (textarea + state machine) | Browser / Client (React) | API / Backend | Frontend owns input, invokes `parse_provider_paste` |
| Capability pill strip rendering | Browser / Client (React) | — | Pure render from `ProviderCapabilityRecord` dto |
| `<CapabilityGap>` empty state | Browser / Client (React) | — | Pure render + `openRoute` call |
| Fallback-order drag list | Browser / Client (React) | API / Backend | HTML5 DnD + persist via `set_fallback_providers` command |
| Event emission (`blade_routing_capability_missing`) | API / Backend (Rust) | Browser / Client | Rust emits via `app.emit`, React subscribes via `useTauriEvent` |
| `?needs=vision` query routing | Browser / Client (React) | — | Router extension — NO new Rust needed |

## Standard Stack

### Core (all already in tree — no new deps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `regex` | 1.x | cURL / Python-SDK pattern matching in parser | [VERIFIED: src-tauri/Cargo.toml:56] already in tree |
| `serde_json` | 1.x | JSON-blob detection + capability matrix serialization | [VERIFIED: Cargo.toml:33] already in tree |
| `serde` | 1.x | `ParsedProviderConfig` + `ProviderCapabilityRecord` derive | [VERIFIED: Cargo.toml:32] |
| `reqwest` | 0.12 | Capability probe HTTP call (reuses `http_client()`) | [VERIFIED: providers/mod.rs:10] |
| `chrono` | 0.4 | `last_probed: DateTime<Utc>` on capability record | [VERIFIED: Cargo.toml:39] |
| `keyring` | 3.x | Reuses `get_provider_key` for stored key retrieval | [VERIFIED: config.rs:404] |
| React 19 | 19.2.5 | `<ProviderPasteForm>`, `<CapabilityGap>`, `<FallbackOrderList>` | [VERIFIED: package.json:66] |
| `@tauri-apps/api` | 2.10.1 | `invokeTyped` wrapping (no raw `invoke`) | [VERIFIED: package.json:55] |

### No new dependencies required

[VERIFIED] The UI-SPEC locks this: "Phase 11 introduces ZERO external component dependencies." The regex crate for the parser, the static capability matrix via `LazyLock`, HTML5 DnD for drag list, native `<a href>` + `openUrl` for secondary links — all existing capabilities.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex parser | Parser combinator (nom) | nom produces better errors; regex is already in tree and simpler for 3 well-defined formats |
| Static capability matrix | OpenRouter `/v1/models` endpoint | Dynamic fetch is v1.2+ per CONTEXT.md deferred. Static matches LiteLLM/LangChain production. |
| `blade_routing_capability_missing` as single event | One event per capability (4 events) | Single event with `capability: String` payload is simpler and follows existing `CAPABILITY_GAP_DETECTED` pattern |
| HTML5 drag-and-drop | `@dnd-kit/core` library | D-01 locks "no new dependencies". Native DnD works for 3-10 row list. |
| `?needs=vision` query string | Global context / Zustand store | React context already set up via `useRouterCtx`; query param is locally-scoped UX hint, global state is overkill |

**Version verification:** Required deps are already at committed versions. No `npm view` / `cargo search` round-trip needed because no new packages are added.

## Paste Sample Corpus (Plan 11-01 Unit-Test Fixtures)

The parser's test module at `src-tauri/src/provider_paste_parser.rs` (below `#[cfg(test)] mod tests`) MUST cover these samples. Each sample below is grep-verifiable against a real-world snippet convention documented in [CITED: each provider's docs].

### cURL samples (7 positive + 2 edge + 2 negative)

**Sample C1 — OpenAI chat completions, single-line:**
```bash
curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer sk-proj-abc123" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hi"}]}'
```
Expected parse: `{ provider_guess: "openai", base_url: "https://api.openai.com/v1", api_key: "sk-proj-abc123", model: "gpt-4o" }`.

**Sample C2 — Anthropic with x-api-key + multi-line backslashes:**
```bash
curl https://api.anthropic.com/v1/messages \
  --header "x-api-key: sk-ant-api03-xyz789" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{"model":"claude-sonnet-4-20250514","max_tokens":1024,"messages":[{"role":"user","content":"Hi"}]}'
```
Expected: `{ provider_guess: "anthropic", base_url: "https://api.anthropic.com/v1", api_key: "sk-ant-api03-xyz789", model: "claude-sonnet-4-20250514", headers: { "anthropic-version": "2023-06-01" } }`.

**Sample C3 — Groq (OpenAI-compatible):**
```bash
curl https://api.groq.com/openai/v1/chat/completions -H "Authorization: Bearer gsk_abc123def456" -H "Content-Type: application/json" -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hi"}]}'
```
Expected: `provider_guess: "groq"`, `base_url: "https://api.groq.com/openai/v1"`, `model: "llama-3.3-70b-versatile"`.

**Sample C4 — OpenRouter:**
```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer sk-or-v1-abcdef" \
  -H "HTTP-Referer: https://blade.ai" \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/llama-3.3-70b-instruct:free","messages":[{"role":"user","content":"Hi"}]}'
```
Expected: `provider_guess: "openrouter"`, `model: "meta-llama/llama-3.3-70b-instruct:free"`.

**Sample C5 — Gemini (api key as query param):**
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAbCdEfGh" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hi"}]}]}'
```
Expected: `provider_guess: "gemini"`, `api_key: "AIzaSyAbCdEfGh"` (extracted from `?key=`), `model: "gemini-2.0-flash"` (extracted from URL path).

**Sample C6 — Custom base_url (DeepSeek, OpenAI-compatible):**
```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer sk-deepseek-xyz" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hi"}]}'
```
Expected: `provider_guess: "custom"`, `base_url: "https://api.deepseek.com/v1"`, `api_key: "sk-deepseek-xyz"`, `model: "deepseek-chat"`.

**Sample C7 — Local vLLM / Ollama-compatible at localhost:**
```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta-llama/Llama-3.3-70B-Instruct","messages":[{"role":"user","content":"Hi"}]}'
```
Expected: `provider_guess: "ollama"` (localhost heuristic), `base_url: "http://localhost:8000/v1"`, `api_key: ""`, `model: "meta-llama/Llama-3.3-70B-Instruct"`.

**Edge case E1 — cURL with body variable substitution:**
```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "$PAYLOAD"
```
Expected: parser returns `Err` with message clarifying that inline variables aren't supported — NOT a crash. Provider detection ("openai") can succeed but key + model extraction fail. Preferred: return `Ok` with `provider_guess: "openai"`, `api_key: ""`, `model: ""`, and UI prompts the user to paste resolved values.

**Edge case E2 — cURL with `-u` (basic auth):**
```bash
curl https://api.openai.com/v1/chat/completions \
  -u ":sk-proj-abc123" \
  -d '{"model":"gpt-4o","messages":[]}'
```
Expected: `api_key` extracted from `-u :key` syntax; degrade gracefully if not supported.

**Negative N1 — non-LLM cURL (should fail gracefully):**
```bash
curl https://api.github.com/repos/anthropics/claude-code -H "Accept: application/vnd.github+json"
```
Expected: `Err("Could not detect provider...")` because hostname `api.github.com` is not in the known provider table.

**Negative N2 — malformed body:**
```bash
curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer sk-abc" -d 'not json at all'
```
Expected: provider_guess succeeds, api_key extracted, model empty (JSON body parse fails → fallback to empty model). UI prompts user to pick a model.

### JSON samples (4 positive + 1 negative)

**Sample J1 — LiteLLM-style config blob:**
```json
{
  "model": "gpt-4o",
  "api_base": "https://api.openai.com/v1",
  "api_key": "sk-proj-abc123"
}
```
Expected: `provider_guess: "openai"`, `base_url: "https://api.openai.com/v1"`, `model: "gpt-4o"`.

**Sample J2 — OpenAI config-file-style:**
```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-xyz789",
  "model": "claude-opus-4-20250514",
  "baseURL": "https://api.anthropic.com/v1"
}
```
Expected: explicit `provider` key wins over hostname heuristic. Detector accepts `apiKey` / `api_key`, `baseURL` / `base_url` variants.

**Sample J3 — Minimal (provider + key only):**
```json
{
  "provider": "groq",
  "api_key": "gsk_xyz"
}
```
Expected: `provider_guess: "groq"`, `model: ""` (empty), user picks later.

**Sample J4 — With headers:**
```json
{
  "base_url": "https://api.anthropic.com/v1",
  "api_key": "sk-ant-abc",
  "model": "claude-sonnet-4-20250514",
  "headers": { "anthropic-version": "2023-06-01" }
}
```
Expected: headers passed through.

**Negative N3 — JSON with no provider signals:**
```json
{"foo": "bar", "count": 42}
```
Expected: `Err("Could not detect provider...")`.

### Python-SDK samples (5 positive + 1 negative)

**Sample P1 — OpenAI SDK constructor:**
```python
from openai import OpenAI
client = OpenAI(api_key="sk-proj-abc123")
response = client.chat.completions.create(model="gpt-4o", messages=[{"role":"user","content":"Hi"}])
```
Expected: `provider_guess: "openai"` (constructor name), `api_key: "sk-proj-abc123"`, `model: "gpt-4o"` (from `model=` kwarg).

**Sample P2 — Anthropic SDK:**
```python
import anthropic
client = anthropic.Anthropic(api_key="sk-ant-xyz")
msg = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=1024, messages=[...])
```
Expected: `provider_guess: "anthropic"`, detector handles `anthropic.Anthropic(` (module.Class form).

**Sample P3 — OpenAI with custom base_url:**
```python
client = OpenAI(api_key="sk-deepseek-xyz", base_url="https://api.deepseek.com/v1")
response = client.chat.completions.create(model="deepseek-chat", messages=[])
```
Expected: `provider_guess: "custom"` (base_url hostname overrides "openai" from constructor when non-OpenAI base_url is present).

**Sample P4 — Groq SDK:**
```python
from groq import Groq
client = Groq(api_key="gsk_abc")
```
Expected: `provider_guess: "groq"`.

**Sample P5 — Generic `Client(…)` pattern:**
```python
client = Client(api_key="key123", base_url="http://localhost:11434")
```
Expected: `provider_guess: "ollama"` (localhost heuristic; Client name is unknown).

**Negative N4 — Python with no SDK constructor:**
```python
print("hello world")
```
Expected: `Err("Could not detect provider...")`.

### Grep-verifiable regex patterns (for parser implementation)

| Detector | Pattern | Notes |
|----------|---------|-------|
| cURL entry | `^\s*curl\s` | Must be first non-whitespace token. Handle `\\`-line-continuations by pre-processing (replace `\\\n` with ` `). |
| cURL `-H Authorization: Bearer` | `(?i)-H\s*['"]?Authorization:\s*Bearer\s+([\w\-\.]+)['"]?` | Case-insensitive. Captures key. |
| cURL `-H x-api-key` | `(?i)-H\s*['"]?x-api-key:\s*([\w\-\.]+)['"]?` | Anthropic style. |
| cURL `?key=…` (Gemini) | `[?&]key=([\w\-]+)` | URL query param. |
| cURL URL | `curl\s+(?:-X\s+\w+\s+)?(?:--url\s+)?['"]?(https?://[^\s'"]+)` | Capture first URL after `curl`. |
| cURL `-d` / `--data` payload | `(?:-d\|--data(?:-raw)?)\s+['"]({\|[\[].+?)['"]` | Non-greedy to first matching quote. Then `serde_json::from_str` the capture. |
| JSON entry | `^\s*\{` | Try `serde_json::from_str` on full input. |
| JSON provider keys | Keys: `provider`, `api_key`, `apiKey`, `base_url`, `baseURL`, `api_base`, `model`, `headers` | Use `serde_json::Value` and `.get()`. |
| Python-SDK entry | `(?m)^(?:client\s*=\s*)?(?:\w+\.)?(OpenAI\|Anthropic\|Groq\|Client)\s*\(` | Class-constructor form. |
| Python kwarg `api_key=…` | `api_key\s*=\s*['"]([\w\-\.]+)['"]` | Captures key. |
| Python kwarg `base_url=…` | `base_url\s*=\s*['"]([^'"]+)['"]` | Captures base URL. |
| Python kwarg `model=…` | `model\s*=\s*['"]([^'"]+)['"]` | Captures model name. Works for `.create(model="…")` too. |

**Pre-processing pipeline (applied to raw input before detector runs):**
1. `trim()` leading/trailing whitespace
2. Replace `\\\n` (backslash-newline) with a single space — joins cURL line continuations
3. Remove comment lines starting with `#` (Python comments, bash comments)

[ASSUMED] Detection order in code matches documentation order (cURL → JSON → Python-SDK). Verified by D-51 which explicitly states "Three detectors run in order" with cURL first.

## Provider Guess Heuristics (Hostname → Provider)

The hostname-to-provider mapping in D-51 is accurate; expanded table below covers edge cases.

| Hostname substring | provider_guess | Notes |
|--------------------|----------------|-------|
| `api.openai.com` | `openai` | Canonical OpenAI endpoint |
| `api.anthropic.com` | `anthropic` | Canonical Anthropic endpoint |
| `api.groq.com` | `groq` | Canonical Groq endpoint (OpenAI-compatible path `/openai/v1`) |
| `generativelanguage.googleapis.com` | `gemini` | Google AI Studio / Gemini API |
| `openrouter.ai` | `openrouter` | OpenRouter gateway |
| `localhost` OR `127.0.0.1` OR `::1` | `ollama` | Local LLM — assume Ollama by default even if it's actually vLLM/LMStudio (same OpenAI-compatible contract) |
| `api.deepseek.com` | `custom` | DeepSeek — OpenAI-compatible; keep as custom so `base_url` flows through |
| `integrate.api.nvidia.com` OR `build.nvidia.com` | `custom` | NVIDIA NIM — OpenAI-compatible |
| `api.mistral.ai` | `custom` | Mistral API — OpenAI-compatible |
| `api.perplexity.ai` | `custom` | Perplexity — OpenAI-compatible |
| `api.together.xyz` | `custom` | Together AI |
| `.azure.openai.com` OR `.openai.azure.com` | `custom` | Azure OpenAI — base_url routing |
| `api.cohere.ai` | `custom` | Cohere — different API shape, still usable |
| anything else | `custom` | Default fallback — D-55 custom-base_url escape hatch applies |

[VERIFIED: providers/mod.rs:225-235] The `complete_turn` function already handles the custom `base_url` case by routing through `openai::complete` — so `provider_guess = "custom"` + `base_url = Some(x)` gives a working end-to-end path with no new adapter code. [CITED: https://platform.openai.com/docs/api-reference/introduction], [CITED: https://docs.anthropic.com/en/api/getting-started], [CITED: https://console.groq.com/docs/api-reference].

## Capability Matrix (Static — Plan 11-02 Target)

The static matrix lives at `src-tauri/src/capability_probe.rs` as `static PROVIDER_CAPABILITIES: LazyLock<HashMap<&'static str, ProviderCapabilityDefaults>>`. Per-model overrides matched by model-name substring.

### Structure

```rust
struct ProviderCapabilityDefaults {
    vision: bool,
    audio: bool,
    tool_calling: bool,
    long_context: bool,
    context_window: u32,
    // Per-model overrides; key = substring matched against model name
    model_overrides: &'static [(&'static str, ProviderCapabilityDefaults)],
}
```

### Initial Matrix

**Anthropic** — [CITED: https://docs.anthropic.com/en/docs/about-claude/models]

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | true | false | true | true | 200_000 |
| `claude-sonnet-4` | true | false | true | true | 200_000 |
| `claude-opus-4` | true | false | true | true | 200_000 |
| `claude-haiku-4-5` | true | false | true | true | 200_000 |
| `claude-3-5-sonnet` | true | false | true | true | 200_000 |

**OpenAI** — [CITED: https://platform.openai.com/docs/models]

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | false | false | true | false | 128_000 |
| `gpt-4o` (not `-audio`) | true | false | true | true | 128_000 |
| `gpt-4o-mini` | true | false | true | true | 128_000 |
| `gpt-4o-audio-preview` | true | true | true | true | 128_000 |
| `gpt-5` | true | false | true | true | 400_000 |
| `gpt-4-turbo` | true | false | true | true | 128_000 |
| `gpt-3.5-turbo` | false | false | true | false | 16_385 |
| `whisper-1` | false | true | false | false | 0 |
| `tts-1` | false | true | false | false | 0 |
| `o1`, `o3-mini`, `o4-mini` | true | false | true | true | 128_000 |

**Gemini** — [CITED: https://ai.google.dev/gemini-api/docs/models/gemini]

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | true | false | true | true | 1_000_000 |
| `gemini-2.0-flash` | true | false | true | true | 1_048_576 |
| `gemini-1.5-pro` | true | true | true | true | 2_097_152 |
| `gemini-1.5-flash` | true | true | true | true | 1_048_576 |
| `gemini-2.5-pro` | true | true | true | true | 2_097_152 |

**Groq** — [CITED: https://console.groq.com/docs/models]

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | false | false | true | true | 131_072 |
| `llama-3.3-70b-versatile` | false | false | true | true | 131_072 |
| `llama-3.1-8b-instant` | false | false | true | true | 131_072 |
| `meta-llama/llama-4-scout` | true | false | true | true | 131_072 |
| `llama-3.2-vision` or `-90b-vision` | true | false | true | true | 131_072 |
| `mixtral-8x7b` | false | false | true | true | 32_768 |
| `whisper-large-v3` | false | true | false | false | 0 |

**OpenRouter** — [CITED: https://openrouter.ai/docs/models]

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | false | false | false | false | 8_192 |
| model name contains `:free` | false | false | false | false | 8_192 |
| model name contains `gpt-4o` | true | false | true | true | 128_000 |
| model name contains `claude` | true | false | true | true | 200_000 |
| model name contains `gemini` | true | false | true | true | 1_000_000 |
| model name contains `vision` | true | false | true | true | 128_000 |
| model name contains `llama-3.3` | false | false | true | true | 131_072 |
| model name contains `llama-4` | true | false | true | true | 131_072 |

**Ollama** — [CITED: https://ollama.com/library]

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | false | false | false | false | 8_192 |
| `llava` or contains `vision` | true | false | false | false | 8_192 |
| `hermes3` | false | false | true | false | 8_192 |
| `llama3.2` | false | false | true | false | 128_000 |
| `llama3.3` | false | false | true | true | 128_000 |

**Custom (any base_url set)** — CONSERVATIVE FLAGS OFF

| Model pattern | vision | audio | tools | long_ctx | ctx_window |
|---------------|--------|-------|-------|----------|------------|
| default | false | false | false | false | 8_192 |

User override path: explicitly set `vision_provider = "custom/mymodel"` in Settings forces the capability regardless of matrix. [ASSUMED] Custom-provider capability override UI not in Phase 11 scope; deferred to v1.2 if users complain.

### Matrix Lookup Function

```rust
pub fn infer_capabilities(provider: &str, model: &str, ctx_window_from_api: Option<u32>)
    -> (bool, bool, bool, bool, u32) // (vision, audio, tools, long_context, context_window)
{
    let defaults = PROVIDER_CAPABILITIES.get(provider).unwrap_or(&CUSTOM_DEFAULTS);
    let lower_model = model.to_ascii_lowercase();
    let best = defaults.model_overrides.iter()
        .find(|(pat, _)| lower_model.contains(pat))
        .map(|(_, v)| v)
        .unwrap_or(defaults);
    let ctx = ctx_window_from_api.unwrap_or(best.context_window);
    (best.vision, best.audio, best.tool_calling, ctx >= 100_000, ctx)
}
```

`long_context` is a **derived** flag: `context_window >= 100_000`. This matches the D-54 copy ("100k+ context") and LiteLLM's convention.

## Test-Call Shapes (Capability Probe Implementation)

[VERIFIED: providers/{anthropic,openai,gemini,groq,ollama}.rs] Each provider has an existing `pub async fn test(api_key, model, [base_url]) -> Result<String, String>` that sends a minimal chat completion and returns the text or an error. The probe WRAPS this with capability extraction.

### Canonical probe flow

```rust
pub async fn probe_provider_capabilities(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<ProviderCapabilityRecord, String> {
    // Step 1: test call via existing test_connection
    let probe_result = crate::providers::test_connection(provider, api_key, model, base_url).await;

    // Step 2: classify HTTP outcome
    let probe_status = match &probe_result {
        Ok(_) => ProbeStatus::Active,
        Err(e) if e.contains("401") || e.contains("Unauthorized") => ProbeStatus::InvalidKey,
        Err(e) if e.contains("404") || e.contains("not_found") => ProbeStatus::ModelNotFound,
        Err(e) if e.contains("429") || e.contains("Rate limited") => ProbeStatus::RateLimitedButValid,
        Err(e) if e.contains("5") /* 5xx */ => ProbeStatus::ProviderDown,
        Err(_) => ProbeStatus::NetworkError,
    };

    // Step 3: derive capabilities from static matrix
    // (The test() return body is text-only; we don't get usage metadata.
    //  Static matrix is the sole capability source per D-52.)
    let (vision, audio, tools, long_context, context_window) =
        infer_capabilities(provider, model, None);

    // Step 4: build record
    Ok(ProviderCapabilityRecord {
        provider: provider.to_string(),
        model: model.to_string(),
        context_window,
        vision,
        audio,
        tool_calling: tools,
        long_context,
        last_probed: Utc::now(),
        probe_status,
    })
}
```

**Key behavior for probe_status = RateLimitedButValid:** UI-SPEC surfaces this as `.onb-ok` (success-toned) — "Key works — rate limited during probe. Capabilities inferred from provider defaults." This is NOT an error; we still return `Ok` with the capability record because the key authenticated successfully (429 requires auth to even be reached).

### Per-provider probe minimums (what `test_connection` already sends)

| Provider | Endpoint | Body (minimum) | Key location |
|----------|----------|----------------|--------------|
| Anthropic | `POST https://api.anthropic.com/v1/messages` | `{ model, max_tokens: 32, messages: [{role:"user",content:"Say hi in one word."}] }` | `x-api-key` header |
| OpenAI | `POST {base_url}/chat/completions` | `{ model, max_tokens: 10, stream: false, messages: [{role,content}] }` | `Authorization: Bearer` |
| Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=…` | `{ contents: [{ role:"user", parts:[{ text:"Say hi…"}] }] }` | URL query param |
| Groq | Uses `openai::test` path via OpenRouter-style compat | (same as OpenAI) | `Authorization: Bearer` |
| OpenRouter | Uses `openai::test` with `base_url=https://openrouter.ai/api/v1` | (same as OpenAI) | `Authorization: Bearer` |
| Ollama | `POST http://localhost:11434/api/generate` | `{ model, prompt:"Hi", stream:false, options:{ num_predict: 10 } }` | (none) |
| Custom | `openai::test` path + base_url | (same as OpenAI) | `Authorization: Bearer` |

All existing test functions use `max_tokens: 10-32`, not `max_tokens: 1`. D-52 says "max_tokens: 1 (or provider-equivalent)" — 10 is close enough, and changing these is out of scope (would regress existing `testProvider` UX). The probe reuses these as-is.

[CITED: OpenAI: https://platform.openai.com/docs/api-reference/chat/create]
[CITED: Anthropic: https://docs.anthropic.com/en/api/messages]
[CITED: Gemini: https://ai.google.dev/api/generate-content]
[CITED: Ollama: https://github.com/ollama/ollama/blob/main/docs/api.md]

## Router Rewire — Integration Points

### Current flow (call sites that use task-type routing)

[VERIFIED via grep] `resolve_provider_for_task` is called from **27 distinct call sites** across the codebase:

| Call site | Task type | Purpose | Phase 11 action |
|-----------|-----------|---------|-----------------|
| `commands.rs:744` | dynamic (from `classify_task`) | Main chat send | **REWIRE to `select_provider`** |
| `accountability.rs:391` | dynamic | Background reasoning | keep using `resolve_provider_for_task` |
| `brain_planner.rs:45` | Simple | Planning helper | keep |
| `code_sandbox.rs:526` | Code | Code sandbox | keep |
| `emotional_intelligence.rs:{210,665}` | varied | Emotion classification | keep |
| `financial_brain.rs:{456,487,526,1063}` | varied | Finance analysis | keep |
| `habit_engine.rs:{580,619}` | Complex | Habit analysis | keep |
| `health_tracker.rs:{384,643}` | Complex | Health nudges | keep |
| `meeting_intelligence.rs:{178,466,519,592}` | Complex | Meeting analysis | keep |
| `negotiation_engine.rs:98` | Complex | Debate | keep |
| `persona_engine.rs:342` | dynamic | Personality | keep |
| `reasoning_engine.rs:125` | dynamic | Reasoning | keep |
| `social_graph.rs:364` | Complex | Graph analysis | keep |
| `temporal_intel.rs:695` | Complex | Temporal analysis | keep |
| `tentacles/calendar_tentacle.rs:117` | Complex | Calendar analysis | keep |
| `voice_intelligence.rs:481` | Complex | Voice analysis | keep |
| `workflow_builder.rs:{270,758}` | dynamic | Workflow | keep |

**Only ONE call site needs rewiring in Phase 11: `commands.rs:744` (send_message_stream).** This is the user-facing chat pipeline where vision/audio attachments flow in; it's also where `classify_task` already returns `TaskType::Vision` when `has_image == true`. The 25+ background-task call sites use `TaskType::Complex` or `TaskType::Simple` and don't process user-attached images/audio directly — they're safe to leave on `resolve_provider_for_task` in Phase 11.

**Rationale for not rewiring all 27:** (1) minimizes Phase 11 blast radius; (2) existing `resolve_provider_for_task` already handles `task_routing.vision` for the Vision case; (3) deferring the background-task upgrade to v1.2 lets us observe whether Phase 11's primary path closes symptom #7 without further changes.

### New function: `select_provider`

Location: `src-tauri/src/router.rs` (appended below `classify_task`). Called once in `commands.rs::send_message_stream` right after `classify_task`.

```rust
pub fn select_provider(
    task_type: TaskType,
    config: &crate::config::BladeConfig,
) -> (String, String, String, Vec<(String, String)>)
// Returns (provider, api_key, model, fallback_chain: Vec<(provider, model)>)
{
    // Tier 0: Custom base_url escape hatch (D-55)
    if config.base_url.is_some() {
        return (
            config.provider.clone(),
            config.api_key.clone(),
            config.model.clone(),
            vec![], // no fallback when base_url is custom
        );
    }

    // Determine required capability from task_type
    let required_capability = match task_type {
        TaskType::Vision => Some("vision"),
        // In v1.1 only Vision is capability-mapped from TaskType.
        // Audio/long_context/tools enter via other paths (voice orb, large context, tool loop).
        _ => None,
    };

    // Tier 1: capability-hard-filter
    if let Some(cap) = required_capability {
        let cap_provider_field = match cap {
            "vision" => config.vision_provider.as_deref(),
            "audio" => config.audio_provider.as_deref(),
            "long_context" => config.long_context_provider.as_deref(),
            "tools" => config.tools_provider.as_deref(),
            _ => None,
        };
        if let Some(prov_model_str) = cap_provider_field {
            let (prov, model) = crate::providers::parse_model_string(prov_model_str, &config.provider);
            let key = crate::config::get_provider_key(prov);
            if !key.is_empty() || prov == "ollama" {
                let chain = build_capability_filtered_chain(cap, prov, config);
                return (prov.to_string(), key, model.to_string(), chain);
            }
        }
        // User didn't set cap_provider; scan provider_capabilities for capable providers
        let capable = find_capable_providers(cap, config);
        if let Some((prov, model)) = capable.first() {
            let key = crate::config::get_provider_key(prov);
            let chain = build_capability_filtered_chain(cap, prov, config);
            return (prov.clone(), key, model.clone(), chain);
        }
        // No capable provider — emit event, fall through to primary (graceful degrade)
        // The caller (commands.rs) is responsible for emitting blade_routing_capability_missing
        // if the returned provider doesn't satisfy the capability requirement.
    }

    // Tier 2: task-type soft preference (reuses existing resolve_provider_for_task)
    let (prov, key, model) = crate::config::resolve_provider_for_task(config, &task_type);

    // Tier 3: build generic fallback chain (no capability filter)
    let chain = build_generic_chain(&prov, config);
    (prov, key, model, chain)
}
```

### Fallback chain construction algorithm

```rust
fn build_capability_filtered_chain(
    capability: &str,
    primary_provider: &str,
    config: &BladeConfig,
) -> Vec<(String, String)> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    seen.insert(primary_provider.to_string());

    // Step 1: other capability-capable providers with stored keys
    for (prov, rec) in &config.provider_capabilities {
        if seen.contains(prov) { continue; }
        let has_cap = match capability {
            "vision" => rec.vision,
            "audio" => rec.audio,
            "tools" => rec.tool_calling,
            "long_context" => rec.long_context,
            _ => false,
        };
        if !has_cap { continue; }
        let key = crate::config::get_provider_key(prov);
        if key.is_empty() && prov != "ollama" { continue; }
        seen.insert(prov.clone());
        chain.push((prov.clone(), rec.model.clone()));
    }

    // Step 2: user-ordered fallback_providers (filtered by capability)
    for prov in &config.fallback_providers {
        if seen.contains(prov) { continue; }
        let rec = config.provider_capabilities.get(prov);
        let has_cap = rec.map(|r| match capability {
            "vision" => r.vision, "audio" => r.audio,
            "tools" => r.tool_calling, "long_context" => r.long_context,
            _ => false,
        }).unwrap_or(false);
        if !has_cap { continue; }
        let key = crate::config::get_provider_key(prov);
        if key.is_empty() && prov != "ollama" { continue; }
        seen.insert(prov.clone());
        chain.push((prov.clone(), rec.map(|r| r.model.clone()).unwrap_or_default()));
    }

    chain // may be empty; caller handles degraded mode
}
```

**Dedup strategy:** `HashSet<String>` on provider names. Same provider never appears twice regardless of whether it's in capability-list + fallback_providers + primary.

**Empty-chain handling:** if `chain.is_empty()` AND `required_capability.is_some()`:
- Caller (`commands.rs::send_message_stream`) emits `blade_routing_capability_missing` with payload `{ capability, task_type, primary_provider, message }`
- Continues with primary provider anyway (graceful degrade — better to try and fail loudly than silently do nothing)
- UI chat stream banner prompts user to add a capable provider

## Event: `blade_routing_capability_missing`

Follows `BLADE_EVENTS` registry pattern ([VERIFIED: src/lib/events/index.ts:44]).

### Payload shape

```typescript
// src/lib/events/payloads.ts — new interface
export interface RoutingCapabilityMissingPayload {
  capability: 'vision' | 'audio' | 'long_context' | 'tools';
  task_type: string;           // "Vision" | "Simple" | etc.
  primary_provider: string;    // e.g. "groq"
  primary_model: string;       // e.g. "llama-3.3-70b-versatile"
  message: string;             // user-facing — UI-SPEC §Error states: "This task needs a {capability}-capable model, but none of your providers support it."
}
```

### Constant name (locked)

```typescript
// src/lib/events/index.ts
ROUTING_CAPABILITY_MISSING: 'blade_routing_capability_missing',
```

**Name collision check:** `CAPABILITY_GAP_DETECTED: 'capability_gap_detected'` already exists ([VERIFIED: src/lib/events/index.ts:60]) but refers to the `self_upgrade` catalog system ([CITED: src-tauri/src/self_upgrade.rs]) — a different subsystem. Phase 11's routing event uses the explicit `routing_` prefix to disambiguate.

### Subscriber

**Chat stream banner** in `src/features/chat/ChatView.tsx` (or wherever the chat error surface lives) subscribes via:
```tsx
useTauriEvent<RoutingCapabilityMissingPayload>(
  BLADE_EVENTS.ROUTING_CAPABILITY_MISSING,
  (e) => { /* render inline banner with e.payload.message + Add button */ }
);
```

## `?needs=vision` Deep-Link Behavior

### Current router limitation

[VERIFIED: src/windows/main/useRouter.ts:35] `openRoute(id: string)` takes **only a route ID** — no params support today. Two options:

**Option A — extend `openRoute` signature (recommended):**
```typescript
// useRouter.ts
openRoute: (id: string, hint?: Record<string, string>) => void;
```
And add a second piece of state:
```typescript
const [routeHint, setRouteHint] = useState<Record<string, string> | null>(null);
```
Returns via context so settings-providers pane can read `useRouterCtx().routeHint?.needs`.

**Option B — URL query param via History API (rejected):** React router expectations; conflicts with existing in-memory routing model (D-52). Too invasive for Phase 11.

**Option C — New hook `useRouteHint()` + sessionStorage (compromise):** If `openRoute` signature change is too invasive, use a sidecar hook that reads/writes `sessionStorage['blade.route.hint']` at every `openRoute` call. Ephemeral — cleared on next `openRoute`.

**Recommendation:** Option A. Clean, type-safe, matches the D-52 in-memory-router spirit, and the change is localized to `useRouter.ts` + `<CapabilityGap>` caller + ProvidersPane consumer.

### Settings pane consumption

```tsx
// ProvidersPane.tsx
const { routeHint } = useRouterCtx();
const pasteFormRef = useRef<HTMLTextAreaElement>(null);
useEffect(() => {
  if (routeHint?.needs) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pasteFormRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
      pasteFormRef.current?.focus();
    }));
  }
}, [routeHint]);
```

## Re-Probe Trigger Semantics

[LOCKED per D-52 + UI-SPEC §Surface B]

| Question | Answer |
|----------|--------|
| Re-probe all providers or only clicked one? | **Only clicked one.** `[↻]` button lives per-row in ProvidersPane; invokes `probe_provider_capabilities(provider_id, model_id)` for that row only. |
| Cached or always-fresh? | **Always fresh.** Re-probe makes a new HTTP call, replaces the `ProviderCapabilityRecord` in `config.provider_capabilities[provider]` with the new `last_probed: Utc::now()`. |
| Global spinner or per-row shimmer? | **Per-row shimmer.** Capability strip row-local state transitions `probed → probing → probed` via React state. Global pane isn't blocked. |
| Background re-probe? | **Never in v1.1.** Per `4ab464c` no-loop posture. User action only. |
| Cold-migration state (key exists, no probe record) | Render `.t-small` "Click ↻ to probe capabilities." next to neutral `[—]` pills (UI-SPEC §Empty states). |

## 6-Place Config Plan (PROV-06 Implementation Target)

[VERIFIED: src-tauri/src/config.rs] The existing BladeConfig has 79 fields. Phase 11 adds **5 new fields**:

1. `provider_capabilities: HashMap<String, ProviderCapabilityRecord>` (D-52 metadata table)
2. `vision_provider: Option<String>` (D-53)
3. `audio_provider: Option<String>` (D-53)
4. `long_context_provider: Option<String>` (D-53)
5. `tools_provider: Option<String>` (D-53)

### New supporting types (at top of `config.rs`, near `TaskRouting` lines 17-33)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub enum ProbeStatus {
    #[default]
    NotProbed,
    Active,
    InvalidKey,
    ModelNotFound,
    RateLimitedButValid,
    ProviderDown,
    NetworkError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilityRecord {
    pub provider: String,
    pub model: String,
    pub context_window: u32,
    pub vision: bool,
    pub audio: bool,
    pub tool_calling: bool,
    pub long_context: bool,
    pub last_probed: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    pub probe_status: ProbeStatus,
}
```

### Exact 6-place line ranges

(Based on current file state [VERIFIED: config.rs:1-824]; planner should re-grep actual lines at execution time since insertions shift offsets.)

| Place | File location | What to add |
|-------|---------------|-------------|
| 1. `DiskConfig` struct | `config.rs:55-151` (end of struct before `api_key` legacy field line 149) | 5 fields with `#[serde(default)]` |
| 2. `DiskConfig::default()` | `config.rs:172-220` | 5 default values (`HashMap::new()` / `None` × 4) |
| 3. `BladeConfig` struct | `config.rs:225-326` | 5 fields with `#[serde(default)]` |
| 4. `BladeConfig::default()` | `config.rs:334-384` | 5 default values |
| 5. `load_config()` | `config.rs:465-511` | 5 field assignments from `disk.*` |
| 6. `save_config()` | `config.rs:518-564` | 5 field assignments into `DiskConfig` |

Field 6-place pattern example (vision_provider):

```rust
// Place 1 — DiskConfig struct (~line 119):
#[serde(default)]
vision_provider: Option<String>,

// Place 2 — DiskConfig::default() (~line 205):
vision_provider: None,

// Place 3 — BladeConfig struct (~line 290):
#[serde(default)]
pub vision_provider: Option<String>,

// Place 4 — BladeConfig::default() (~line 369):
vision_provider: None,

// Place 5 — load_config() (~line 498):
vision_provider: disk.vision_provider,

// Place 6 — save_config() (~line 550):
vision_provider: config.vision_provider.clone(),
```

**Auto-population hook:** `capability_probe.rs::probe_provider_capabilities` on success calls `maybe_auto_populate(&mut config, &record)`:
```rust
fn maybe_auto_populate(config: &mut BladeConfig, rec: &ProviderCapabilityRecord) {
    let prov_model = format!("{}/{}", rec.provider, rec.model);
    if rec.vision && config.vision_provider.is_none() {
        config.vision_provider = Some(prov_model.clone());
    }
    if rec.audio && config.audio_provider.is_none() {
        config.audio_provider = Some(prov_model.clone());
    }
    if rec.long_context && config.long_context_provider.is_none() {
        config.long_context_provider = Some(prov_model.clone());
    }
    if rec.tool_calling && config.tools_provider.is_none() {
        config.tools_provider = Some(prov_model);
    }
}
```

## Thinking vs Capability

[CONFIRMED per CONTEXT.md deferred list] **Extended thinking is NOT a 5th capability in Phase 11.** Rationale:

1. D-53 locks 4 capabilities: `vision`, `audio`, `long_context`, `tools`. Adding "thinking" expands scope.
2. Thinking is already handled ad-hoc at `commands.rs:741` (`use_extended_thinking` flag for Anthropic + Complex tasks).
3. Extended thinking is semantically closer to a model *feature* than a capability *requirement* — no user-facing surface says "this needs a thinking model" (unlike vision: "this needs to read the screen").
4. Users who want Claude-thinking-by-default can set `task_routing.complex = "anthropic/claude-sonnet-4-20250514"` today via existing RoutingPane.

**Dissenting note:** once Plan 11-04 ships, the `select_provider` function becomes the natural extension point for "thinking_provider" if tester feedback post-v1.1 surfaces demand. Architectural symmetry suggests thinking would fit as a 5th `Option<String>` + 5th bool on `ProviderCapabilityRecord`. Parking for v1.2.

## Capability Surfaces (PROV-07/08 Wiring Targets)

[SOURCE: CONTEXT.md §Canonical Refs §Capability-gap surface candidates + UI-SPEC §CAPABILITY_SURFACES registry]

### Minimum for acceptance (≥2 surfaces per capability)

**Vision (3 identified — ≥2 wired required):**
1. `src/features/knowledge/ScreenTimeline.tsx` — screen-aware analysis
2. `src/features/quickask/*` — image input path
3. `src/features/dev-tools/WebAutomation.tsx` — browser visual assertions (also consumes `tools`)

**Audio (2 identified — ≥2 wired required):**
1. Voice Orb route (`src/features/voice-orb/*` — exact path TBD at Plan 11-05 execution)
2. Meeting Ghost transcription surface (`src/features/ghost/*` or new route)

**Long-context (2 identified):**
1. `src/features/chat/useChat.tsx` — gate when conversation ratio > 0.65 (reuses `blade_token_ratio` payload)
2. `src/features/knowledge/KnowledgeBase.tsx` — full-repo indexing dropdown

**Tools (2 identified):**
1. `src/features/agents/SwarmView.tsx` — multi-agent DAG (needs tool calling)
2. `src/features/dev-tools/WebAutomation.tsx` (reused — same component, different capability)

### useCapability hook (contract)

```tsx
// src/features/providers/useCapability.ts
export function useCapability(capability: CapabilityName) {
  const { config } = useConfig();
  const hasCapability = useMemo(() => {
    const record = config.provider_capabilities?.[config.provider];
    if (!record) return false;
    return {
      vision: record.vision, audio: record.audio,
      long_context: record.long_context, tools: record.tool_calling,
    }[capability] ?? false;
  }, [config.provider_capabilities, config.provider, capability]);

  const { openRoute } = useRouterCtx();
  const openAddFlow = useCallback(
    () => openRoute('settings-providers', { needs: capability }),
    [openRoute, capability],
  );

  return { hasCapability, openAddFlow };
}
```

## Architecture Patterns

### Pattern 1: Tauri-command-first parsing

**What:** Expose the parser as a `#[tauri::command]` with a pure-Rust implementation; React calls through `invokeTyped`.

**When to use:** Any parsing/normalization logic that (a) benefits from Rust's regex + serde ecosystem, (b) has nothing frontend-specific, (c) will plausibly be reused by CLI/MCP/background tasks.

**Example:**
```rust
// src-tauri/src/provider_paste_parser.rs
#[tauri::command]
pub fn parse_provider_paste(input: String) -> Result<ParsedProviderConfig, String> {
    detect_curl(&input)
        .or_else(|_| detect_json(&input))
        .or_else(|_| detect_python_sdk(&input))
        .map_err(|_| format!(
            "Could not detect provider from that input. Supported: cURL command, JSON config object, or Python SDK snippet. Your input started with: \"{}...\"",
            crate::safe_slice(&input, 40),
        ))
}
```
Tauri handler registration in `lib.rs::generate_handler![]`.

Frontend wrapper in `src/lib/tauri/providers.ts` (NEW file):
```typescript
export function parseProviderPaste(input: string): Promise<ParsedProviderConfig> {
  return invokeTyped<ParsedProviderConfig, { input: string }>('parse_provider_paste', { input });
}
```

### Pattern 2: Tier-descending resolution

**What:** Try narrowest constraint first (hard capability filter), fall through to broader constraints (task preference → primary), accumulate a fallback chain along the way.

**When to use:** Any "pick one of N candidates" problem where some candidates are *required-quality* and others are *preferred-quality*.

### Pattern 3: 6-place config pattern (existing, enforced)

**What:** Every new `BladeConfig` field MUST appear in exactly 6 locations. Phase 10 audit catches violations as WIRED-NOT-USED.

**Guard:** Phase 10 audit shape gate already exists (`scripts/verify-wiring-audit-shape.mjs`). Phase 11 re-runs audit at Plan 11-06 Wave 2 — any sub-6 field fails the gate.

### Anti-Patterns to Avoid

- **Dynamic capability probing** (sending a real image/audio to check):
  - Why bad: high cost, rate-limits, fragile. Defer to v1.2.
- **Frontend-side parsing:** bundle bloat, no reuse across CLI/MCP/background paths.
- **Auto-retry probe on failure:** violates `4ab464c` silence-log-spam posture. One call, surface error, done.
- **Overwriting user-set capability providers on new probe:** the `maybe_auto_populate` guard (`if .is_none()`) prevents this.
- **Rewiring all 27 `resolve_provider_for_task` call sites in Phase 11:** blast radius too large; only `commands.rs:744` gets the new `select_provider`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing cURL shell commands | Custom lexer / shlex port | `regex` crate + pre-processing (`\\\n` → ` `) | cURL's shell grammar is infinite; a pragmatic regex handles 95% of real-world snippets. Users who need shell-quoting semantics paste JSON instead. |
| HTTP retry / fallback | New retry loop | Existing `providers::fallback_chain_complete` | Already handles 429/5xx/network with `is_fallback_eligible_error`. Phase 11 extends with capability filter, doesn't replace. |
| Drag-and-drop list | `@dnd-kit/core`, `react-dnd`, `react-sortable-hoc` | Native HTML5 `draggable` + `onDragOver/onDrop` | D-01 locks "no new dependencies"; list is 3-10 rows; HTML5 DnD handles this well. |
| Model context-window lookup | Dynamic `/v1/models` fetch per provider | Static HashMap in `capability_probe.rs` | LiteLLM/LangChain/Vercel AI SDK all ship static tables. v1.2 can add dynamic refresh. |
| Keyring management | New key storage abstraction | `crate::config::get_provider_key` / `set_api_key_in_keyring` | Already handles cross-platform (`keyring` crate with `windows-native`, `apple-native`, `sync-secret-service`). |
| OS Secret store | Plaintext file | Existing keyring | Security + existing migration code at `load_config():449-460`. |
| Event broadcasting | New event bus | `app.emit` + `BLADE_EVENTS` + `useTauriEvent` | Already audited, lint-enforced. |

**Key insight:** Phase 11 adds exactly 1 new Tauri command (`parse_provider_paste`) + 1 new probe command (`probe_provider_capabilities`) + 1 new config setter (`set_fallback_providers`) + 1 new router function. Every other piece reuses existing infrastructure. The value is in the *composition*, not in new primitives.

## Common Pitfalls

### Pitfall 1: Non-ASCII string slicing in parser error messages
**What goes wrong:** `format!("Your input started with: {}…", &input[..40])` panics if `input` has multi-byte chars in byte position 0-39.
**Why it happens:** Rust strings are UTF-8; byte-index slicing can land mid-codepoint.
**How to avoid:** Use `crate::safe_slice(text, 40)` per CLAUDE.md convention. Grep-verifiable: any `&input[..N]` in parser code fails review.
**Warning signs:** Test with a paste starting with `日本語curl …` or emoji.

### Pitfall 2: Duplicate `#[tauri::command]` function names
**What goes wrong:** `probe_provider_capabilities` collides with a future same-name command in another module; Tauri's macro namespace is FLAT.
**Why it happens:** Rust's module system doesn't enforce uniqueness across modules.
**How to avoid:** Grep the codebase for `#\[tauri::command\]\s*\n\s*pub (async )?fn probe` before registering.
**Warning signs:** Cryptic `duplicate definition` errors at `generate_handler!` expansion.

### Pitfall 3: Probe record auto-population overwrites user choice
**What goes wrong:** User sets `vision_provider = "openai/gpt-4o"`, later adds an Anthropic key — probe silently overwrites `vision_provider` to Anthropic.
**Why it happens:** Naive "populate latest" logic.
**How to avoid:** `maybe_auto_populate` MUST check `is_none()` before setting. Unit test with fixture `vision_provider = Some("x")` + new probe showing vision — assert `vision_provider` stays `Some("x")`.
**Warning signs:** User complaints that routing "randomly changed".

### Pitfall 4: Fallback chain circular reference
**What goes wrong:** Primary = Anthropic, `fallback_providers = ["anthropic", "openai"]`, chain retries Anthropic after Anthropic failed.
**Why it happens:** Not deduping primary from fallback list.
**How to avoid:** `HashSet<String>` dedup in `build_capability_filtered_chain`; unit test with overlapping config.
**Warning signs:** Double API calls to the failed provider in logs.

### Pitfall 5: `base_url` set but capability override ignored
**What goes wrong:** User pastes a custom endpoint (DeepSeek), sets `vision_provider = "openai/gpt-4o"`, expects vision tasks to route to OpenAI. Instead, D-55 tier-0 forces custom endpoint for all tasks.
**Why it happens:** Custom-base_url escape hatch is absolute.
**How to avoid:** Document clearly in copy + consider a future tier-0-override where `*_provider` explicit-set overrides base_url. For Phase 11: base_url wins (matches existing `resolve_provider_for_task` behavior); ship as-is, address in v1.2 if tester feedback demands.
**Warning signs:** Users confused why their OpenAI key isn't used for screen-analysis while DeepSeek is the primary.

### Pitfall 6: Paste card icon + textarea backdrop-filter layer count
**What goes wrong:** UI-SPEC caps 3 backdrop-filter layers per viewport (D-07). Paste card adds glass-1 (pane) + glass-1 (card) + glass-2 (probe result panel) + glass-2 (pill strip) = 4 layers.
**Why it happens:** Nested glass containers accumulate.
**How to avoid:** Probe result panel inside the card must NOT add a new `backdrop-filter` — use `background: var(--g-fill-strong)` solid fill instead. UI-SPEC §Surface D spec: badge uses `glass-2` but it's tiny and audited; pill strip is flat (no backdrop-filter — `.chip` class).
**Warning signs:** `audit-contrast.mjs` visual regression failures; blur feels muddy in screenshots.

### Pitfall 7: Concurrent probe requests on stale key
**What goes wrong:** User pastes a key, clicks "Detect & probe" twice rapidly, two concurrent test calls. On 429 both fail → UI shows "rate limited" when actually the first succeeded.
**Why it happens:** No in-flight guard on the "Detect & probe" button.
**How to avoid:** `disabled={busy}` on button; `busy=true` for the lifetime of the probe promise.
**Warning signs:** Duplicate keyring writes observable in logs.

### Pitfall 8: Event name collision with existing CAPABILITY_GAP_DETECTED
**What goes wrong:** Dev assumes `CAPABILITY_GAP_DETECTED` is the right event for Phase 11 routing gaps; subscribes to it; never fires for vision-missing case.
**Why it happens:** `capability_gap_detected` exists already, but it refers to `self_upgrade.rs` capability system.
**How to avoid:** Use the explicit `ROUTING_CAPABILITY_MISSING` name. Document both in the events registry with a comment pointing at each other.
**Warning signs:** Event handler never fires despite correct wiring.

## Code Examples

Verified patterns from existing codebase + new sketches:

### Paste parser: cURL detector (sketch)

```rust
// src-tauri/src/provider_paste_parser.rs
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedProviderConfig {
    pub provider_guess: String,  // "openai" | "anthropic" | … | "custom"
    pub base_url: Option<String>,
    pub api_key: String,         // may be empty
    pub model: String,           // may be empty
    pub headers: HashMap<String, String>,
}

static RE_CURL_URL: Lazy<Regex> = Lazy::new(||
    Regex::new(r#"curl\s+(?:-X\s+\w+\s+)?(?:--url\s+)?['"]?(https?://[^\s'"]+)"#).unwrap()
);
static RE_BEARER: Lazy<Regex> = Lazy::new(||
    Regex::new(r#"(?i)-H\s*['"]?Authorization:\s*Bearer\s+([\w\-\.]+)['"]?"#).unwrap()
);
static RE_XAPIKEY: Lazy<Regex> = Lazy::new(||
    Regex::new(r#"(?i)-H\s*['"]?x-api-key:\s*([\w\-\.]+)['"]?"#).unwrap()
);
static RE_DATA: Lazy<Regex> = Lazy::new(||
    Regex::new(r#"(?:-d|--data(?:-raw)?)\s+['"](\{.+?)['"]"#).unwrap()
);
static RE_GEMINI_KEY: Lazy<Regex> = Lazy::new(||
    Regex::new(r#"[?&]key=([\w\-]+)"#).unwrap()
);

fn preprocess(input: &str) -> String {
    // Join cURL line continuations: "\\\n" -> " "
    input.trim().replace("\\\n", " ").replace("\\\r\n", " ")
}

fn guess_provider_from_url(url: &str) -> &'static str {
    let u = url.to_lowercase();
    if u.contains("api.openai.com") { "openai" }
    else if u.contains("api.anthropic.com") { "anthropic" }
    else if u.contains("api.groq.com") { "groq" }
    else if u.contains("generativelanguage.googleapis.com") { "gemini" }
    else if u.contains("openrouter.ai") { "openrouter" }
    else if u.contains("localhost") || u.contains("127.0.0.1") || u.contains("[::1]") { "ollama" }
    else { "custom" }
}

fn base_url_from_url(url: &str) -> Option<String> {
    // Trim common path suffixes: /chat/completions, /messages, /:generateContent
    let mut b = url.to_string();
    for suffix in &["/chat/completions", "/messages", "/generateContent"] {
        if let Some(idx) = b.rfind(suffix) { b.truncate(idx); }
    }
    // For Gemini, strip the :method and model
    if let Some(colon) = b.rfind(':') {
        if colon > 8 /* past https:// */ { b.truncate(colon); }
    }
    // Strip trailing /models/{model_id}
    if let Some(idx) = b.rfind("/models/") { b.truncate(idx); }
    Some(b)
}

pub fn detect_curl(raw: &str) -> Result<ParsedProviderConfig, String> {
    let input = preprocess(raw);
    if !input.trim_start().starts_with("curl ") && !input.trim_start().starts_with("curl\t") {
        return Err("not curl".to_string());
    }
    let url_cap = RE_CURL_URL.captures(&input).ok_or("no URL found")?;
    let url = url_cap.get(1).unwrap().as_str();
    let provider_guess = guess_provider_from_url(url).to_string();
    let base_url = base_url_from_url(url);

    let api_key = RE_BEARER.captures(&input).and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
        .or_else(|| RE_XAPIKEY.captures(&input).and_then(|c| c.get(1).map(|m| m.as_str().to_string())))
        .or_else(|| RE_GEMINI_KEY.captures(url).and_then(|c| c.get(1).map(|m| m.as_str().to_string())))
        .unwrap_or_default();

    let mut model = String::new();
    if let Some(data_cap) = RE_DATA.captures(&input) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data_cap.get(1).unwrap().as_str()) {
            model = parsed.get("model").and_then(|m| m.as_str()).unwrap_or("").to_string();
        }
    }
    // Gemini: extract model from URL /models/{model}:generateContent
    if model.is_empty() && provider_guess == "gemini" {
        if let Some(start) = url.find("/models/") {
            let rest = &url[start + 8 ..];
            if let Some(end) = rest.find(':') { model = rest[..end].to_string(); }
        }
    }

    Ok(ParsedProviderConfig {
        provider_guess,
        base_url,
        api_key,
        model,
        headers: HashMap::new(),
    })
}
```

Note: `once_cell::sync::Lazy` — if not in tree, use `std::sync::LazyLock` (stable since Rust 1.80). [ASSUMED: Rust version in use is ≥ 1.80 based on Cargo `edition = "2021"` + recent features; planner should verify in Plan 11-01].

### select_provider call from commands.rs

```rust
// Replaces commands.rs:737-748:
if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
    let has_image = last_user_msg.image_base64.is_some();
    let task = crate::router::classify_task(&last_user_msg.content, has_image);
    if task == crate::router::TaskType::Complex && config.provider == "anthropic" {
        use_extended_thinking = true;
    }
    // NEW: Phase 11 — select_provider with capability filter + fallback chain
    let (provider, api_key, model, chain) = crate::router::select_provider(task.clone(), &config);

    // Emit capability-missing event if the task needed a capability but fallback chain is empty
    if task == crate::router::TaskType::Vision {
        let primary_has_vision = config.provider_capabilities
            .get(&provider)
            .map(|r| r.vision)
            .unwrap_or(false);
        if !primary_has_vision && chain.is_empty() {
            let _ = app.emit("blade_routing_capability_missing", serde_json::json!({
                "capability": "vision",
                "task_type": format!("{:?}", task),
                "primary_provider": provider,
                "primary_model": model,
                "message": "This task needs a vision-capable model, but none of your providers support it.",
            }));
        }
    }

    config.provider = provider;
    config.api_key = api_key;
    config.model = model;
    config.fallback_providers = chain.into_iter().map(|(p, _m)| p).collect();
}
```

### `<CapabilityGap>` component sketch

```tsx
// src/features/providers/CapabilityGap.tsx
import { EmptyState } from '@/design-system/primitives';
import { useCapability } from './useCapability';

const COPY: Record<CapabilityName, { headline: string; body: string; secondary: string; icon: ReactNode }> = {
  vision: {
    headline: 'Needs a vision-capable model',
    body: "This view analyzes what's on screen. Add a provider like Anthropic, OpenAI, or Gemini that can read images.",
    secondary: 'Learn which models support vision ↗',
    icon: <CameraIcon />,
  },
  audio: { headline: 'Needs an audio-capable model', body: "…", secondary: 'Learn which models support audio ↗', icon: <MicIcon /> },
  long_context: { headline: 'Needs a long-context model', body: "…", secondary: '…', icon: <ClockIcon /> },
  tools: { headline: 'Needs a tool-calling model', body: "…", secondary: '…', icon: <WrenchIcon /> },
};

export function CapabilityGap({ capability, surfaceLabel }: { capability: CapabilityName; surfaceLabel?: string }) {
  const { openAddFlow } = useCapability(capability);
  const c = COPY[capability];
  return (
    <EmptyState
      testId={`capability-gap-${capability}`}
      icon={c.icon}
      label={c.headline}
      description={c.body}
      actionLabel="Add a provider"
      onAction={openAddFlow}
      secondaryLink={{ label: c.secondary, href: DOCS_URL[capability], external: true }}
      eyebrow={surfaceLabel}
    />
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dynamic capability probing per-provider | Static capability matrix (LiteLLM/LangChain/Vercel AI pattern) | 2023+ production gateways | Zero API cost for capability lookup; tradeoff: matrix updates require code change |
| One provider per app | Litellm-style gateway with per-capability routing | Late 2024+ | Users multi-provision (Anthropic for code, Groq for speed, Gemini for long ctx). D-55 formalizes for BLADE. |
| Hardcoded 5-6 provider picker | Paste-any-config flow | 2025+ (Cursor, Cline, Aider already do this) | Unlocks custom endpoints: DeepSeek, NVIDIA NIM, Azure, self-hosted vLLM without per-provider dev work. |
| Blank state on missing capability | Empty-state-with-CTA pattern | Design-system standard | Replaces broken UI with action. UI-SPEC §CapabilityGap implements for 4 capabilities. |
| OpenAI's `/v1/models` polling | Static matrix + explicit re-probe | v1.1 choice | Matrix is faster, zero-cost; re-probe covers model deprecation. OpenRouter `/v1/models` ingest is v1.2+. |

**Deprecated/outdated:**
- **Dynamic image-upload capability probing** — too expensive, too slow, rate-limit-fragile. Not in any production gateway I could verify.
- **Running a single-provider gateway** — users want multi-provider on cost grounds (free tier pooling) and latency grounds (Groq for fast, Claude for quality).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust: built-in `#[cfg(test)] mod tests` (existing pattern in crypto.rs, action_tags.rs, db.rs, code_sandbox.rs, agents/thought_tree.rs). Frontend: Playwright e2e (existing). |
| Config file | `src-tauri/Cargo.toml` (no separate test config). `playwright.config.ts` at repo root. |
| Quick run command | `cd src-tauri && cargo test --lib provider_paste_parser` (per-file) |
| Full suite command | `cd src-tauri && cargo test --lib` + `npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | cURL (OpenAI) parse extracts provider/model/base_url/key | unit (Rust) | `cargo test --lib provider_paste_parser::tests::parses_openai_curl` | ❌ Wave 0 — Plan 11-01 creates |
| PROV-01 | cURL (Anthropic, multi-line) parse | unit | `cargo test --lib provider_paste_parser::tests::parses_anthropic_curl_multiline` | ❌ Wave 0 |
| PROV-01 | cURL (Groq) parse | unit | `cargo test --lib provider_paste_parser::tests::parses_groq_curl` | ❌ Wave 0 |
| PROV-02 | JSON config blob (LiteLLM-style) parse | unit | `cargo test --lib provider_paste_parser::tests::parses_litellm_json` | ❌ Wave 0 |
| PROV-02 | JSON config (OpenAI-style with camelCase) parse | unit | `cargo test --lib provider_paste_parser::tests::parses_openai_json_camelcase` | ❌ Wave 0 |
| PROV-03 | Python SDK (OpenAI constructor) parse | unit | `cargo test --lib provider_paste_parser::tests::parses_openai_python_sdk` | ❌ Wave 0 |
| PROV-03 | Python SDK (Anthropic module.Class) parse | unit | `cargo test --lib provider_paste_parser::tests::parses_anthropic_python_sdk` | ❌ Wave 0 |
| PROV-03 | Python SDK + custom base_url → provider_guess=custom | unit | `cargo test --lib provider_paste_parser::tests::python_sdk_custom_base_url` | ❌ Wave 0 |
| PROV-01/02/03 negative | Malformed input → descriptive Err | unit (3 cases) | `cargo test --lib provider_paste_parser::tests::rejects_{malformed,github_curl,random_json}` | ❌ Wave 0 |
| PROV-01 edge | `curl --data "$PAYLOAD"` → graceful degrade, no panic | unit | `cargo test --lib provider_paste_parser::tests::curl_with_variable_substitution` | ❌ Wave 0 |
| PROV-04 | Onboarding renders paste card alongside 6 cards | e2e (Playwright) | `playwright test tests/e2e/onboarding-paste-card.spec.ts` | ❌ Wave 0 — Plan 11-03 creates |
| PROV-05 | capability_probe on key save writes ProviderCapabilityRecord | unit (Rust) | `cargo test --lib capability_probe::tests::probe_writes_record` | ❌ Wave 0 — Plan 11-02 creates |
| PROV-05 | Probe invalid key → probe_status=InvalidKey, no record written | unit | `cargo test --lib capability_probe::tests::probe_invalid_key_classifies` | ❌ Wave 0 |
| PROV-05 | Probe 429 → probe_status=RateLimitedButValid, capabilities from matrix | unit | `cargo test --lib capability_probe::tests::probe_429_uses_matrix` | ❌ Wave 0 |
| PROV-06 | 5 new config fields round-trip save → load | unit | `cargo test --lib config::tests::phase11_fields_round_trip` | ❌ Wave 0 |
| PROV-07 | ScreenTimeline renders CapabilityGap when no vision provider | e2e or unit (React) | `playwright test tests/e2e/capability-gap-vision.spec.ts` | ❌ Wave 0 — Plan 11-05 creates |
| PROV-07 | QuickAsk renders CapabilityGap for images when no vision | e2e | `playwright test tests/e2e/capability-gap-quickask.spec.ts` | ❌ Wave 0 |
| PROV-08 | ≥2 surfaces each for audio / long_context / tools | e2e (6 total) | `playwright test tests/e2e/capability-gap-{audio,longctx,tools}-*.spec.ts` | ❌ Wave 0 |
| PROV-09 | select_provider tier-1 (vision capable override) | unit | `cargo test --lib router::tests::select_provider_tier1_vision_override` | ❌ Wave 0 — Plan 11-04 creates |
| PROV-09 | select_provider tier-2 (task_routing soft preference) | unit | `cargo test --lib router::tests::select_provider_tier2_task_routing` | ❌ Wave 0 |
| PROV-09 | select_provider tier-3 (primary fallback) | unit | `cargo test --lib router::tests::select_provider_tier3_primary` | ❌ Wave 0 |
| PROV-09 | select_provider tier-0 (base_url escape hatch) | unit | `cargo test --lib router::tests::select_provider_tier0_base_url` | ❌ Wave 0 |
| PROV-09 | fallback chain capability-filters non-vision providers | unit | `cargo test --lib router::tests::chain_filters_noncapable` | ❌ Wave 0 |
| PROV-09 | fallback chain dedups primary + fallback_providers | unit | `cargo test --lib router::tests::chain_dedups` | ❌ Wave 0 |
| PROV-09 | empty chain + vision task emits blade_routing_capability_missing | integration | `cargo test --lib router::tests::emits_missing_event` + manual trace | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd src-tauri && cargo test --lib <module>` (per-file, runs < 10s)
- **Per wave merge:** `cd src-tauri && cargo test --lib` + `npm run verify:all` + `npm run test:e2e:phase11` (new)
- **Phase gate:** `cargo test --lib` clean + `npm run verify:all` clean + `npm run verify:providers-capability` (new gate) clean

### Wave 0 Gaps

- [ ] `src-tauri/src/provider_paste_parser.rs` + `#[cfg(test)] mod tests` with ≥12 test cases — covers PROV-01/02/03
- [ ] `src-tauri/src/capability_probe.rs` + `#[cfg(test)] mod tests` with ≥5 cases — covers PROV-05
- [ ] `src-tauri/src/router.rs` tests module (new `#[cfg(test)] mod tests` block) — covers PROV-09
- [ ] `src-tauri/src/config.rs` tests module addition (round-trip test for 5 new fields) — covers PROV-06
- [ ] `tests/e2e/onboarding-paste-card.spec.ts` — PROV-04
- [ ] `tests/e2e/capability-gap-*.spec.ts` (8 files, 2 per capability) — PROV-07, PROV-08
- [ ] `scripts/verify-providers-capability.mjs` — new gate; asserts (1) `CAPABILITY_SURFACES` has ≥2 entries per capability, (2) all 4 `<CapabilityGap capability="*">` instantiations exist in tree, (3) no bespoke `.onb-error`-equivalents outside approved list, (4) all 5 new BladeConfig fields present in 6 places.
- [ ] Add `verify:providers-capability` to `verify:all` chain in package.json (gate 20).
- [ ] Add `test:e2e:phase11` npm script listing the 8 spec files.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust 1.80+ (for `LazyLock`) | `provider_paste_parser.rs` | ✓ (assumed from edition 2021) | — | Use `once_cell::sync::Lazy` if < 1.80 |
| `regex` crate 1.x | Parser regex patterns | ✓ | 1.x [VERIFIED: Cargo.toml:56] | — |
| `serde_json` 1.x | JSON detector | ✓ | 1.x [VERIFIED: Cargo.toml:33] | — |
| `chrono` 0.4 | `last_probed` field | ✓ | 0.4 [VERIFIED: Cargo.toml:39] | — |
| `keyring` 3.x | Key retrieval | ✓ | 3.x [VERIFIED: Cargo.toml:40] | — |
| Node.js + Playwright | e2e tests | ✓ | Playwright 1.58.2 [VERIFIED: package.json:39] | — |
| `cargo test` toolchain | Unit tests | ✓ (standard Rust) | — | — |
| Network access for probe | Capability probe live testing | ✓ (dev machine); CI skip via feature flag recommended | — | Mock `test_connection` in unit tests; live call in e2e or manual only |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Mock HTTP for probe unit tests (reuse `wiremock` or raw `reqwest::Client` with local stub) — keeps unit tests offline; live probe only in e2e / manual QA.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Rust version in use supports `LazyLock` (1.80+) | §Code Examples, §Capability Matrix | Use `once_cell::sync::Lazy` instead; 5-line change |
| A2 | Capability matrix values (vision/audio/tools/ctx) are accurate as of 2026-04-20 | §Capability Matrix | Model flags wrong — user sees "✓ vision" on a non-vision model; error surfaces at first actual use. Mitigation: static matrix is easy to update in code |
| A3 | `provider_guess = "custom"` + `base_url = Some(x)` routes through `openai::complete` for any OpenAI-compatible endpoint | §Provider Guess Heuristics | Custom-endpoint support broken for Phase 11 — users stuck with 6 hardcoded providers. Mitigated by [VERIFIED: providers/mod.rs:223-236] which shows this path already works |
| A4 | `openRoute` can accept a second param without breaking existing callers | §`?needs=vision` Deep-Link | Additional signature change impact on ~15 callers. Mitigated by making the param optional (`hint?`) |
| A5 | The 4 ASCII-surface spec diagrams in UI-SPEC are the complete UI surface area | §Surface B/D | Missed surface in implementation; caught at Plan 11-06 audit |
| A6 | Background-task call sites (25+) can continue using `resolve_provider_for_task` without Phase 11 changes | §Router Rewire | Background loop on vision task — e.g. proactive screen-analysis — routes to non-vision provider silently. Mitigation: none of the 25 sites classify tasks as `Vision`; they all pass `TaskType::Complex` or `Simple` explicitly |
| A7 | Email copy for CapabilityGap body (locked headlines notwithstanding) can be polished | §Copywriting Contract | Locked copy per UI-SPEC; deviations flagged at checker; discretion is in body text only per CONTEXT.md §Claude's Discretion |
| A8 | `blade_routing_capability_missing` event name doesn't collide with existing `capability_gap_detected` | §Event | Confirmed by grep — different subsystem. Dual-docs in registry recommended |
| A9 | `once_cell` crate is NOT in tree — need to verify before using in sample code | §Code Examples | If not in tree, use `std::sync::LazyLock` (Rust 1.80+). Plan 11-01 should verify before writing parser. |

## Open Questions (RESOLVED)

1. **OpenAI-compatible custom endpoints — detect `/chat/completions` path pattern?**
   - What we know: sample C7 (localhost vLLM) already works via hostname heuristic + OpenAI-compat path.
   - What's unclear: NVIDIA NIM uses `/v1/chat/completions` but at `integrate.api.nvidia.com`; Azure uses `{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions`.
   - RESOLVED: parser captures base_url as-is; router lets `complete_turn` route through openai-compat path when `base_url.is_some()`. No additional logic needed.

2. **Ollama key detection — should parser set `api_key: ""` or omit?**
   - What we know: Ollama doesn't need a key; current `get_all_provider_keys` considers `!key.is_empty() || prov == "ollama"` as "has key".
   - What's unclear: if user pastes a localhost curl without auth header, is `api_key: ""` the right default?
   - RESOLVED: Yes — `api_key: ""` for Ollama. Downstream `config.is_empty() && config.provider != "ollama"` guard in `send_message_stream` already handles this.

3. **Capability matrix maintenance cadence**
   - What we know: matrix is in Rust; updates need code change + rebuild.
   - What's unclear: How often do model/capability flags change? Quarterly feels right; weekly is excessive.
   - RESOLVED: Phase 11 ships the matrix. Model additions to matrix are treated as normal bugfix commits, not separate releases. v1.2 considers dynamic ingest from OpenRouter `/v1/models` as a nice-to-have.

4. **Error panel reuse across Surface A + Surface B**
   - What we know: UI-SPEC locks `.onb-error` class usage across both surfaces.
   - What's unclear: `.onb-error` lives in `src/features/onboarding/onboarding.css`; using it in Settings implies CSS import from Settings pane into onboarding feature (cross-feature dep).
   - RESOLVED: at Plan 11-03 execution, move `.onb-error` + `.onb-ok` classes to a shared CSS file (e.g. `src/features/providers/paste-form.css`) and import from both feature panes. Surfaces at the planner for approval before execution.

5. **Auto-populate on probe: match behavior for `fallback_providers`**
   - What we know: D-52 auto-populates capability slots on first probe IFF slot is `None`.
   - What's unclear: does probe also auto-append to `fallback_providers`? CONTEXT.md is silent.
   - RESOLVED: NO auto-append. `fallback_providers` is user-explicit (D-57 drag UI); silently adding entries violates the "don't overwrite user choice" principle even more than capability slots (user more likely to have an intentional chain order).

## Security Domain

Phase 11 touches key management + HTTP requests — security review is load-bearing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | API keys stored in OS keyring (existing `keyring` crate); paste parser extracts but doesn't persist outside keyring |
| V3 Session Management | no | No user sessions; keys are per-provider static creds |
| V4 Access Control | no | Desktop-local; no multi-user |
| V5 Input Validation | yes | Paste parser MUST treat input as untrusted; regex bounded, `serde_json::from_str` + error handling; no `unwrap()` on parsed fields |
| V6 Cryptography | yes | Never hand-roll key storage; delegate to `keyring` crate (existing — [VERIFIED: Cargo.toml:40]) |
| V7 Error Handling & Logging | yes | Parser errors must NOT echo the full raw input back (info disclosure); use `safe_slice(input, 40)` then "…" |
| V11 Business Logic | yes | Probe must be idempotent; one call, no retry loop (D-52 + tester-pass `4ab464c`) |
| V12 File & Resources | no | No file uploads in Phase 11 |
| V14 Config | yes | 6-place pattern prevents partial config updates; `#[serde(default)]` on every new field to survive schema evolution |

### Known Threat Patterns for Phase 11 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User pastes key into textarea + browser extension scrapes it | Information Disclosure | UI-SPEC §Textarea attrs: `data-1p-ignore="true"`, `autoComplete="off"`, `autoCapitalize="off"`, `spellCheck={false}` — prevents password-manager and autofill interception |
| Clipboard manager logs paste | Information Disclosure | User responsibility; mitigated by prompting user to paste from ephemeral source (paste dialog closes clipboard access on submit) |
| Regex catastrophic backtracking on malicious input | DoS | Bounded regex (`[^\s'"]+` not `.+`); parser times out via Rust's sync execution (no `tokio::timeout` needed because regex crate uses linear-time NFA) [VERIFIED: https://docs.rs/regex/latest/regex/#untrusted-input] |
| Key disclosure in error messages | Information Disclosure | Parser errors quote input via `safe_slice(input, 40)` but that covers only the first 40 chars; keys typically start 5+ chars in (sk-, sk-ant-, gsk_, AIza…) so disclosure risk exists. Mitigation: error panel says "your input started with" and shows first 40 chars — if a key is in the first 40 chars the user already pasted it openly. Low residual risk. |
| Key exfil via URL query param (Gemini pattern) | Information Disclosure | `?key=…` is extracted from clipboard text, routed to keyring. NO logging of the parsed `api_key` field. Existing `get_all_provider_keys` returns only `masked` (4-char prefix + 4-char suffix) to frontend. |
| Event payload contains provider/model but NOT api_key | Information Disclosure | `blade_routing_capability_missing` payload spec explicitly excludes api_key. [VERIFIED: payload shape in §Event section] |
| Custom base_url → request leaks to attacker-controlled endpoint | Server-Side Request Forgery | User paste is explicit authorization; no prompt injection path. Still: `base_url` must be HTTPS (document in parser — warn on `http://` unless hostname is localhost/127.0.0.1). |

### Phase 11 security-specific checklist

- [ ] Parser returns `Err` with `safe_slice`-truncated input, never raw input
- [ ] No `println!` / `log::debug!` of parsed `api_key` anywhere in `provider_paste_parser.rs` or `capability_probe.rs`
- [ ] `probe_provider_capabilities` MUST reuse existing `test_connection` (which already routes keys correctly via the provider adapters — [VERIFIED: providers/anthropic.rs:395, openai.rs:306])
- [ ] New fields `vision_provider` / `audio_provider` / ... store only provider+model strings, NO keys
- [ ] `ProviderCapabilityRecord` serialization excludes any key-material (struct has no key field — verified from D-52 spec)
- [ ] Event `blade_routing_capability_missing` payload MUST NOT include api_key or base_url (grep verify in Plan 11-04 review)
- [ ] Textarea `data-1p-ignore` + `autoComplete="off"` confirmed in UI-SPEC — Plan 11-03 executor copy-paste from spec
- [ ] Parser rejects input > 10KB to prevent regex DoS (add `if input.len() > 10_240 { return Err("input too large") }` early return)

## Sources

### Primary (HIGH confidence)
- [VERIFIED: .planning/phases/11-smart-provider-setup/11-CONTEXT.md] — D-51..D-58 locked decisions
- [VERIFIED: .planning/phases/11-smart-provider-setup/11-UI-SPEC.md] — Surface A/B/C/D visual contract
- [VERIFIED: src-tauri/src/config.rs] — existing 6-place pattern with 79 fields
- [VERIFIED: src-tauri/src/providers/mod.rs] — `test_connection`, `fallback_chain_complete`, `parse_model_string`, `resolve_provider_model`, `is_fallback_eligible_error`
- [VERIFIED: src-tauri/src/providers/{anthropic,openai,gemini,groq,ollama}.rs] — existing `test()` minimal HTTP call shapes
- [VERIFIED: src-tauri/src/router.rs] — `classify_task`, `suggest_model`, stays unchanged
- [VERIFIED: src-tauri/src/commands.rs:737-748] — sole rewire target for `select_provider`
- [VERIFIED via grep: `resolve_provider_for_task` @ 27 call sites] — scope of router rewire
- [VERIFIED: src/lib/events/index.ts + payloads.ts] — `BLADE_EVENTS` registry + `CapabilityGapPayload` collision check
- [VERIFIED: src/windows/main/useRouter.ts] — `openRoute(id: string)` needs extension for `?needs=vision`
- [VERIFIED: src/features/settings/SettingsShell.tsx] — `settings-providers` route + pane mount point
- [VERIFIED: src/features/settings/panes/ProvidersPane.tsx] — existing add-key UI (Phase 11 extends in-place)
- [VERIFIED: src/features/onboarding/{ProviderPicker.tsx,providers.ts}] — 6-card grid (preserved per D-56)
- [VERIFIED: src-tauri/Cargo.toml] — `regex`, `serde_json`, `chrono`, `keyring`, `reqwest` already in tree
- [VERIFIED: package.json] — `test:e2e` + Playwright 1.58.2 available
- [VERIFIED: .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md] — `fallback_providers`, `task_routing` WIRED-NOT-USED rows confirmed; `router.rs::classify_message` NOT-WIRED row confirmed

### Secondary (MEDIUM confidence)
- [CITED: Anthropic API https://docs.anthropic.com/en/docs/about-claude/models] — model capabilities table
- [CITED: OpenAI Models https://platform.openai.com/docs/models] — model capabilities table
- [CITED: Gemini API https://ai.google.dev/gemini-api/docs/models/gemini] — context windows + capabilities
- [CITED: Groq Models https://console.groq.com/docs/models] — OpenAI-compatible contract
- [CITED: OpenRouter https://openrouter.ai/docs/models] — per-model routing
- [CITED: Ollama Models https://ollama.com/library] — local model capabilities
- [CITED: regex crate https://docs.rs/regex/latest/regex/] — linear-time NFA, untrusted-input safe

### Tertiary (LOW confidence)
- [ASSUMED] Rust 1.80+ for `std::sync::LazyLock` — verify at Plan 11-01 execution
- [ASSUMED] `once_cell` availability — check Cargo.lock before using
- [ASSUMED] Capability matrix accuracy across 6 providers × 20+ models as of 2026-04-20 — curated from docs but model deprecations are frequent

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all primitives in tree; no new deps needed
- Architecture (paste parser, capability probe, select_provider): HIGH — sketch code compiles against existing APIs
- 6-place config plan: HIGH — mirrors existing pattern 40× in `config.rs`
- Router integration: HIGH — exact call sites identified via grep
- Event + deep-link: HIGH — follows established conventions
- Capability matrix values: MEDIUM — curated from provider docs 2026-04-20; subject to model churn
- Paste sample corpus: HIGH — covers 3 formats × ≥5 positive × ≥2 negative = 17 fixtures
- Pitfalls: HIGH — grounded in Phase 10 audit + CLAUDE.md gotchas + `4ab464c` posture
- Security: HIGH — reuses keyring pattern; no new crypto, no new storage
- Validation architecture: HIGH — test framework already in tree; gaps enumerated

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — stable domain; capability matrix flags may churn but structural guidance is durable)
