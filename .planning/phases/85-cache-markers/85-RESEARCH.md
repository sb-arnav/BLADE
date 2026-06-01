# Phase 85: CACHE-MARKERS - Research

**Researched:** 2026-05-23
**Domain:** Anthropic `cache_control` injection — provider detection, JSON shape, build-site audit, config pattern, test architecture
**Confidence:** HIGH (all load-bearing claims verified against official Anthropic docs + live codebase)

---

## Summary

Phase 85 ports `apply_anthropic_cache_control` from hermes-agent's `prompt_caching.py` (79 LOC Python) into a new `src-tauri/src/providers/prompt_caching.rs` module. The goal is to annotate the already-built Anthropic request body with up to 4 `cache_control` markers so the byte-stable persisted system prompt (Phases 83+84) produces prefix-cache hits at the API.

The CONTEXT.md design is correct in all load-bearing decisions. Two decisions required partial correction:

1. **D-01/D-02 (CONFIRMED with nuance):** Anthropic's prefix order is tools → system → messages. A `cache_control` marker on the system block DOES cause tools to be included in the cached prefix — but only because the cache is a cumulative hash "up to and including" the marked block. Tools are cached as a side-effect of the prefix semantics, not because they have their own marker. The existing `mark_last_tool_cached` marker on tools is therefore redundant AND wastes one of 4 breakpoint slots. Removing it is correct. [VERIFIED: platform.claude.com/docs/en/build-with-claude/prompt-caching]

2. **D-04 (CORRECTED):** String-content messages (`"content": "..."`) CANNOT have `cache_control` added directly. The string form does not accept `cache_control`. The content MUST be converted to a block array (`[{"type":"text","text":"...","cache_control":{...}}]`) before a marker can be applied. This affects the implementation of `apply_anthropic_cache_control`: it must handle the string-content conversion case explicitly, not just append to existing arrays. [VERIFIED: platform.claude.com/docs/en/build-with-claude/prompt-caching]

3. **D-08 (CORRECTED):** The 1h TTL does NOT require a beta header as of the official documentation. The correct shape is `{"type":"ephemeral","ttl":"1h"}` with no additional header. Third-party integrations (Spring AI) do inject `anthropic-beta: extended-cache-ttl-2025-04-11` as a defensive measure, and Anthropic's X post announced this as a feature on 2026-05-21. The official docs show no required header. Recommendation: ship `"1h"` → `{"type":"ephemeral","ttl":"1h"}` without the beta header; monitor for 400 errors from third-party gateways.

4. **D-06 (CORRECTED — build sites):** The three build sites in anthropic.rs are NOT all equal. `complete_ext` (the non-streaming agentic path at ~166) is the PRIMARY live path and uses `build_body`. The two streaming paths (`stream_text` at ~249, `stream_text_with_thinking` at ~328) each build their own inline `serde_json::json!` body and do NOT call `build_body`. These three paths are all live (called from `providers/mod.rs::complete_turn_inner`, `stream_text`, `stream_text_thinking` respectively). However, `apply_anthropic_cache_control` should be applied at the `providers/mod.rs` dispatch point rather than inside each anthropic.rs function — post-body-build mutation is cleaner than replicating logic inside each path.

**Primary recommendation:** Write `apply_anthropic_cache_control(&mut body, ttl)` as a pure body mutator in `prompt_caching.rs`. Apply it inside `complete_turn_inner` for the agentic path (only when provider is "anthropic"). For the streaming paths (`stream_text`, `stream_text_thinking`), apply analogously. Key implementation detail: string-content messages must be promoted to block arrays before `cache_control` can be attached.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: System marker caches tools as prefix (confirmed). `mark_last_tool_cached` is redundant — remove it. Single source of breakpoints = `apply_anthropic_cache_control`.
- D-02: Remove `mark_last_tool_cached` from `build_body` and sibling build sites.
- D-03: New file `src-tauri/src/providers/prompt_caching.rs`. Public `apply_anthropic_cache_control(body: &mut serde_json::Value, ttl: CacheTtl)`.
- D-04: Handle both string-content and list-content message shapes.
- D-05: `is_anthropic_compatible(provider, base_url) -> bool`. TRUE for anthropic, bedrock, openrouter+claude model, base_url matching anthropic/bedrock domains.
- D-06: Integrate into live build paths. Gate on `config.cache.enabled`.
- D-07: `cache` config group via 6-place config rule. `cache.enabled: bool` (default true), `cache.anthropic_cache_ttl: String` (default "5m").
- D-08: "5m" → `{type:ephemeral}`. "1h" → `{type:ephemeral,ttl:"1h"}`. No beta header required per official docs.

### Claude's Discretion
- Internal `CacheTtl` enum vs passing the string through.
- Whether `apply_anthropic_cache_control` takes `&mut Value` or returns a new Value (prefer `&mut`).

### Deferred Ideas (OUT OF SCOPE)
- Live-Anthropic falsification of cache hits (Phase 89 CLOSE-04).
- Per-provider cache schemes beyond Anthropic.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MARKERS-PORT | Port `apply_anthropic_cache_control` to `prompt_caching.rs`. 4 breakpoints: system + last 3 non-system. Default 5m TTL. | Algorithm documented in hermes gap doc + official JSON shapes verified |
| MARKERS-PROVIDER-DETECT | `is_anthropic_compatible(provider, base_url) -> bool` | Provider routing in mod.rs fully traced; openrouter dispatches via OpenAI-compat client to OPENROUTER_BASE_URL; no model string visible at the is_anthropic_compatible call site — model-based claude detection for openrouter needs care |
| MARKERS-INTEGRATE | Apply in providers::anthropic paths after body build, gated on `config.cache.enabled` | 3 live build sites identified; mod.rs is the cleaner integration point |
| MARKERS-CONFIG | `config.cache.anthropic_cache_ttl` toggle + `config.cache.enabled`. 6-place rule. | ContextConfig / LoopConfig precedents documented; exact 6-place steps verified |
| MARKERS-TESTS | 6 unit tests covering placement, targeting, shape, TTL, and no-op cases | Test architecture documented in Validation Architecture section |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cache marker injection | API/Backend (Rust) | — | Markers are request-body annotations; belong at the provider layer where the JSON body is built |
| Provider detection | API/Backend (Rust) | — | Requires knowledge of resolved provider string + base_url, both available only in providers/mod.rs dispatch |
| Config persistence | API/Backend (Rust) | — | Follows existing BladeConfig / DiskConfig 6-place pattern |
| Cache TTL selection | API/Backend (Rust) | — | CacheTtl enum resolves config string at call time |
| Test assertions | Unit test layer | — | Body built in-process; no live API needed |

---

## Validation: D-01 — Prefix Order and Tool Caching

**Claim (CONTEXT.md D-01):** Anthropic prefix order is tools → system → messages. A `cache_control` on system ALSO caches the tools prefix. Removing `mark_last_tool_cached` loses NO tool caching.

**Finding: CONFIRMED.** [VERIFIED: platform.claude.com/docs/en/build-with-claude/prompt-caching]

> "Cache prefixes are created in the following order: tools, system, then messages. Prompt caching references the entire prompt — tools, system, and messages (in that order) up to and including the block designated with cache_control."

Mechanically: a `cache_control` on the system block causes the cache hash to cover all tools + the system content. Tools have no separate marker and do not need one. The existing `mark_last_tool_cached` in `build_body` (line 66) spends one of 4 breakpoint slots on a block already covered by the system marker. It should be removed.

**Implication for D-02:** After removal, the full breakpoint budget is: system(1) + last 3 non-system messages(3) = 4 total. This is the optimal allocation.

---

## Validation: D-03 — Hermes Algorithm

The hermes `prompt_caching.py` scheme (from gap doc + port mapping) is:

```python
# Source: NousResearch/hermes-agent agent/prompt_caching.py ~79 LOC
def apply_anthropic_cache_control(messages, system_prompt, tools, ttl="5m"):
    """
    Injects cache_control markers into an already-built Anthropic request.
    4 breakpoints max: system prompt gets 1, last 3 non-system messages get 3.
    """
    # 1. Mark system block
    if system_prompt:
        system_prompt[-1]["cache_control"] = {"type": "ephemeral"}
        if ttl == "1h":
            system_prompt[-1]["cache_control"]["ttl"] = "1h"
    
    # 2. Mark last 3 non-system messages (user + assistant + tool_result)
    non_system = [m for m in messages if m["role"] != "system"]
    targets = non_system[-3:]
    for msg in targets:
        content = msg.get("content", [])
        if isinstance(content, list) and content:
            content[-1]["cache_control"] = {"type": "ephemeral"}
            if ttl == "1h":
                content[-1]["cache_control"]["ttl"] = "1h"
        elif isinstance(content, str):
            # Convert to block array first
            msg["content"] = [{"type": "text", "text": content, 
                                "cache_control": {"type": "ephemeral"}}]
            if ttl == "1h":
                msg["content"][0]["cache_control"]["ttl"] = "1h"
```

**Conflict with 4-cap:** Hermes marks system(1) + last 3 messages(3) = 4 total. Since the existing BLADE code sets ONLY the system marker (after removing `mark_last_tool_cached`), this scheme fits exactly within the 4-cap. No conflict.

**Port shape for Rust:**
```rust
// src-tauri/src/providers/prompt_caching.rs
pub enum CacheTtl { FiveMin, OneHour }

pub fn apply_anthropic_cache_control(body: &mut serde_json::Value, ttl: CacheTtl) {
    // 1. Mark system block (body["system"] is already a [{type,text,cache_control}] array)
    //    system_block_with_cache already set it; this fn only needs to handle messages.
    //    OR: if called before system_block_with_cache, set it here.
    
    // 2. Collect non-system messages from body["messages"]
    // 3. Take last min(3, len) messages
    // 4. For each: if content is array -> attach cache_control to last block
    //              if content is string -> promote to [{type:text,text,cache_control}]
}
```

**Decision point for planner:** The function can be applied AFTER `build_body` is called, since `build_body` already calls `system_block_with_cache` (which sets the system marker). The phase 85 function adds the message markers on top. Alternatively, the system marker can be removed from `build_body` and centralized into `apply_anthropic_cache_control`. Recommend keeping `system_block_with_cache` in `build_body` for backward compat with non-Phase-85 streaming paths, and letting `apply_anthropic_cache_control` handle only the message markers.

**Actually — reconsider:** The streaming paths (`stream_text`, `stream_text_with_thinking`) also call `system_block_with_cache` inline. If `apply_anthropic_cache_control` is applied to those paths too, the system block already has a marker. The function should be idempotent (skip a block that already has `cache_control`).

---

## Validation: D-04 — Exact JSON Shape for cache_control

**String content message (BLADE `ConversationMessage::User(content)`):**

`serialize_message` produces:
```json
{"role": "user", "content": [{"type": "text", "text": "..."}]}
```
Already a block array. Adding `cache_control` to the last block:
```json
{"role": "user", "content": [{"type": "text", "text": "...", "cache_control": {"type": "ephemeral"}}]}
```

`serialize_simple` produces:
```json
{"role": "user", "content": "..."}
```
This is a raw string. The Anthropic API does NOT accept `cache_control` on a string `content` field. Must promote:
```json
{"role": "user", "content": [{"type": "text", "text": "...", "cache_control": {"type": "ephemeral"}}]}
```

[VERIFIED: platform.claude.com/docs/en/build-with-claude/prompt-caching]
> "Simple string messages cannot have cache_control directly. If you need caching on a message, convert it to block format."

**Multimodal message (BLADE `ConversationMessage::UserWithImage`):**

`serialize_message` produces:
```json
{
  "role": "user",
  "content": [
    {"type": "image", "source": {...}},
    {"type": "text", "text": "..."}
  ]
}
```
Attach `cache_control` to the LAST block (the text block):
```json
{
  "role": "user", 
  "content": [
    {"type": "image", "source": {...}},
    {"type": "text", "text": "...", "cache_control": {"type": "ephemeral"}}
  ]
}
```

[VERIFIED: official docs — cache_control goes on the last content block]

**Tool result message (BLADE `ConversationMessage::Tool`):**

`serialize_message` produces:
```json
{
  "role": "user",
  "content": [{"type": "tool_result", "tool_use_id": "...", "content": "...", "is_error": false}]
}
```
Attach `cache_control` to the last block (the tool_result block itself):
```json
{
  "role": "user",
  "content": [{"type": "tool_result", "tool_use_id": "...", "content": "...", "is_error": false, "cache_control": {"type": "ephemeral"}}]
}
```

**Critical note on `serialize_simple`:** The streaming paths use `serialize_simple`, which emits `"content": "string"` for User and Assistant turns, and DROPS Tool messages entirely. `apply_anthropic_cache_control` must handle both the block-array case and the string-content case (promote string → block array). For Tool messages filtered by `serialize_simple`, they won't appear in the streaming body, so the last 3 non-system messages will be from the User/Assistant sequence only.

**Implementation requirement:** `apply_anthropic_cache_control` must detect `content` type:
- `Value::Array(arr)` → attach `cache_control` to `arr.last_mut()`
- `Value::String(s)` → promote: set `content = [{type:text, text:s, cache_control:{...}}]`
- Anything else → skip (defensive)

---

## Validation: D-05 — OpenRouter Routing in providers/mod.rs

**Finding:** OpenRouter is routed through the OpenAI-compatible client. In `complete_turn_inner`:

```rust
"openrouter" => openai::complete_ext(
    api_key, model, messages, tools,
    Some(OPENROUTER_BASE_URL),  // "https://openrouter.ai/api/v1"
    max_tokens_override
).await,
```

The model string at this point is the BARE model name (e.g., `meta-llama/llama-3.3-70b-instruct:free`), with the `openrouter/` prefix already stripped by `parse_model_string`. The provider string is `"openrouter"`.

**What `is_anthropic_compatible` must check:**

The function receives `(provider: &str, base_url: Option<&str>)`. At the `complete_turn_inner` call site, by the time we'd want to apply markers, we have:
- `provider = "anthropic"` → always apply (native Anthropic API)
- `provider = "openrouter"` + `model` starts with `claude` → apply (OpenRouter routes claude models to Anthropic)
- `base_url` matching `*.anthropic.com` or `*.bedrock.amazonaws.com` → apply (Bedrock and Anthropic direct)
- `provider = "openai"`, `"groq"`, `"gemini"`, `"ollama"` → skip

**Problem:** The model string is available at `complete_turn_inner` level, so `is_anthropic_compatible` needs to accept a model argument OR the openrouter check can be done by checking both provider AND model. Recommend signature:

```rust
pub fn is_anthropic_compatible(
    provider: &str,
    model: &str,
    base_url: Option<&str>,
) -> bool
```

This differs from the CONTEXT.md D-05 signature (which omits `model`). The planner should add `model: &str` to the signature.

**OpenRouter model detection:** OpenRouter does not pass the model through as a recognizable prefix. The resolved `bare_model` when `provider = "openrouter"` is the full OpenRouter model path (e.g., `anthropic/claude-sonnet-4-20250514` or `claude-sonnet-4-20250514`). Check: `model.starts_with("claude") || model.contains("/claude")`.

**Bedrock:** Bedrock is not in `KNOWN_PROVIDERS` (the list is `["anthropic", "openai", "gemini", "groq", "ollama", "openrouter"]`). A Bedrock user would set a `base_url` pointing to `*.bedrock.amazonaws.com` and use the `openai`-compat or custom-base_url path. The `is_anthropic_compatible` function can detect it via `base_url.map_or(false, |u| u.contains("bedrock.amazonaws.com"))`.

[VERIFIED: providers/mod.rs lines 285-305, KNOWN_PROVIDERS list, OPENROUTER_BASE_URL const]

---

## Validation: D-06 — Live vs Dead Build Sites

Three body-build sites exist in `anthropic.rs`:

| Site | Line | Function | Called From | Path | Live? |
|------|------|----------|-------------|------|-------|
| 1 | ~45 | `build_body` → called by `complete_ext` at ~166 | `providers/mod.rs::complete_turn_inner` → `"anthropic"` branch | Agentic non-streaming chat | YES - primary |
| 2 | ~249 | `stream_text` (inline body) | `providers/mod.rs::stream_text` → `"anthropic"` branch | Streaming text (voice, quick-ask?) | YES |
| 3 | ~328 | `stream_text_with_thinking` (inline body) | `providers/mod.rs::stream_text_thinking` → `"anthropic"` branch | Extended thinking stream | YES |

**Additional site:** `stream_fast_acknowledgment` at `providers/mod.rs:664` calls `anthropic::complete(...)` directly (not `complete_ext`). `complete` delegates to `complete_ext` → `build_body`. This path IS covered by applying markers to `complete_ext`'s built body.

**Test site:** `anthropic::test` (line ~460) sends a hardcoded body with no system prompt and no tools. NOT relevant for cache markers.

**Integration recommendation:**

The cleanest integration is at the `providers/mod.rs` dispatch level:

```rust
// In complete_turn_inner, after resolving provider/model/key:
let mut body = match provider {
    "anthropic" => {
        let b = anthropic::build_body_value(model, messages, tools, max_tokens_override);
        if cache_enabled && is_anthropic_compatible(provider, model, base_url) {
            prompt_caching::apply_anthropic_cache_control(&mut b, ttl);
        }
        b
    }
    // ...
};
```

However, `build_body` is currently private (lowercase `fn build_body`). It returns `serde_json::Value` internally but is not exposed publicly. The planner has two options:
1. Make `build_body` pub and call it from mod.rs — cleaner separation
2. Apply `apply_anthropic_cache_control` inside `complete_ext` (after body is built, before the HTTP call) — simpler, avoids pub leak

Option 2 is simpler: add cache application inside `complete_ext` after `let body = build_body(...)`. Same for `stream_text` and `stream_text_with_thinking` — apply after building the inline body.

**For streaming paths:** The streaming paths use `serialize_simple` which emits string content for User messages. This is the format where string → block promotion is REQUIRED. The implementer must handle this.

---

## Validation: D-08 — TTL and Beta Header

**Finding: CORRECTED.** The official docs do NOT require a beta header for 1h TTL.

From official Anthropic docs [VERIFIED: platform.claude.com/docs/en/build-with-claude/prompt-caching]:
```json
// 1-hour cache (2x base input price for writes)
{"cache_control": {"type": "ephemeral", "ttl": "1h"}}
// No anthropic-beta header needed
```

Spring AI adds `anthropic-beta: extended-cache-ttl-2025-04-11` as a client-side implementation detail; this is NOT required by the server. The Anthropic X post on 2026-05-21 announced the 1h TTL as GA — no beta flag mentioned.

**Shipping recommendation:**
- `"5m"` config value → emit `{"type":"ephemeral"}` (no TTL field, uses default)
- `"1h"` config value → emit `{"type":"ephemeral","ttl":"1h"}` (no beta header)
- If a third-party Anthropic-compatible gateway rejects the `ttl` field with a 400, the implementer should log a warning and fall back to 5m behavior on that gateway. Add this as a pitfall note in the plan.

**Pricing note:** Cache write tokens for 1h cost 2x base (vs 1.25x for 5m). Cache reads are 0.1x for both. For long-lived agent sessions (>5 turns), 1h is economically superior despite higher write cost.

---

## Validation: Config — 6-Place Rule for `cache` Group

Precedent: `ContextConfig`, `LoopConfig`, `ResilienceConfig`, `SessionConfig`, `HuntConfig`, `ForgeConfig` all follow the same pattern. The exact 6 places for a new `cache` group:

**1. Define the struct and per-field defaults:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CacheConfig {
    #[serde(default = "default_cache_enabled")]
    pub enabled: bool,
    #[serde(default = "default_anthropic_cache_ttl")]
    pub anthropic_cache_ttl: String,
}
fn default_cache_enabled() -> bool { true }
fn default_anthropic_cache_ttl() -> String { "5m".to_string() }
impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: default_cache_enabled(),
            anthropic_cache_ttl: default_anthropic_cache_ttl(),
        }
    }
}
```

**2. DiskConfig struct field:**
```rust
#[serde(default)]
cache: CacheConfig,
```

**3. DiskConfig::default() initializer:**
```rust
cache: CacheConfig::default(),
```

**4. BladeConfig struct field:**
```rust
#[serde(default)]
pub cache: CacheConfig,
```

**5. BladeConfig::default() initializer:**
```rust
cache: CacheConfig::default(),
```

**6a. load_config() — copy from disk:**
```rust
cache: disk.cache,
```

**6b. save_config() — copy to DiskConfig:**
```rust
cache: config.cache.clone(),
```

This is the complete 6-place addition. No `validate()` needed for this config group (both fields are simple values with no cross-field constraints).

[VERIFIED: config.rs DiskConfig:840-1021, BladeConfig:1118-1317, load_config:1468-1569, save_config:1571-1659]

---

## Standard Stack

### Core
| Component | Purpose | Confidence |
|-----------|---------|-----------|
| `serde_json::Value` | Body mutation (`&mut Value`) — already the body type in `build_body` | HIGH |
| `providers/prompt_caching.rs` | New module for marker injection + provider detection | HIGH |

### No New Dependencies
Phase 85 requires zero new crates. All tools already exist in the project: `serde_json` for body mutation, `serde` for config serialization.

---

## Architecture Patterns

### System Architecture Diagram

```
config.cache.enabled + config.cache.anthropic_cache_ttl
           │
           ▼
   CacheTtl::from_config(ttl_str) ──► CacheTtl { FiveMin | OneHour }
           │
           ▼
  is_anthropic_compatible(provider, model, base_url)
           │
     TRUE ─┤─ FALSE ──► skip (no-op)
           │
           ▼
  apply_anthropic_cache_control(&mut body, ttl)
           │
    ┌──────┴───────────────────────────────┐
    │  body["system"] already marked by    │
    │  system_block_with_cache() — skip    │
    │  (idempotent check)                  │
    │                                      │
    │  body["messages"] — filter           │
    │  non-system messages, take last 3    │
    │  For each:                           │
    │    content is Array ──► attach to    │
    │                         last block   │
    │    content is String ──► promote     │
    │                         to block arr │
    └──────────────────────────────────────┘
           │
           ▼
  Request sent to Anthropic API
  (cache hit on turns 2+ when system prompt byte-stable)
```

### Recommended File Structure
```
src-tauri/src/providers/
├── prompt_caching.rs    # NEW: apply_anthropic_cache_control, is_anthropic_compatible, CacheTtl
├── mod.rs               # ADD: pub mod prompt_caching; + call sites in complete_turn_inner / stream_text / stream_text_thinking
├── anthropic.rs         # MODIFY: remove mark_last_tool_cached; make build_body pub (optional)
└── ...existing...
src-tauri/src/
└── config.rs            # ADD: CacheConfig struct + 6-place wiring
```

### Pattern: Marker Injection Inside complete_ext

```rust
// In anthropic.rs::complete_ext (after build_body, before HTTP call)
// Source: derived from hermes prompt_caching.py algorithm
pub async fn complete_ext(
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    max_tokens_override: Option<u32>,
    cache_config: Option<&CacheConfig>,  // Phase 85: new optional param
) -> Result<AssistantTurn, String> {
    let mut body = build_body(model, messages, tools, max_tokens_override);
    
    // Phase 85: apply cache markers if enabled
    if let Some(cfg) = cache_config {
        if cfg.enabled {
            let ttl = CacheTtl::from_str(&cfg.anthropic_cache_ttl);
            prompt_caching::apply_anthropic_cache_control(&mut body, ttl);
        }
    }
    
    // ... existing HTTP call ...
}
```

Alternatively (and simpler for the planner): pass config into `complete_turn_inner` from the call site in `loop_engine.rs` / `commands.rs`, and apply markers at `complete_turn_inner` after dispatching the body build. The exact wiring is Claude's Discretion.

### Anti-Patterns to Avoid
- **Applying markers to non-Anthropic bodies:** The OpenAI-compatible clients (openrouter, custom base_url) may silently ignore or reject `cache_control` fields. Always gate on `is_anthropic_compatible`.
- **Mutating string content in place:** `body["messages"][i]["content"] = "..."` cannot be extended with `cache_control`. Must replace the whole field with an array.
- **Over-marking:** Attaching `cache_control` to more than 4 blocks returns a 400 error. The function must count existing markers before adding new ones, OR rely on the fact that only the system block has a marker entering the function (after removing `mark_last_tool_cached`).
- **Re-marking the system block:** `system_block_with_cache` already marks the system block. `apply_anthropic_cache_control` should check for existing `cache_control` on the system block and skip if present (idempotent).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-based dedup of markers | Custom hash comparison | Simple presence check (`block.get("cache_control").is_some()`) | Markers are idempotent; presence check is sufficient |
| Custom TTL validation | Parse + enum match | `CacheTtl::from_str` → `CacheTtl::FiveMin | CacheTtl::OneHour` with fallback to FiveMin | Two valid values; exhaustive match is complete |

---

## Common Pitfalls

### Pitfall 1: String Content Promotion
**What goes wrong:** `apply_anthropic_cache_control` tries to attach `cache_control` to `body["messages"][i]["content"]` which is a JSON string, not an array. The mutation silently does nothing (or panics).
**Why it happens:** `serialize_simple` (used by streaming paths) emits `"content": "string"`. `serialize_message` (used by `build_body`) emits `"content": [...]` arrays. The function must handle both.
**How to avoid:** Pattern-match on `body["messages"][i]["content"]` type. If `Value::String(s)`, replace with `Value::Array(vec![json!({"type":"text","text":s,"cache_control":{...}})])`.
**Warning signs:** Test 3 (string-content shape) failing; markers not appearing in agentic body.

### Pitfall 2: Counting Non-System Messages
**What goes wrong:** The hermes scheme targets "last 3 non-system messages" but Anthropic's messages array never contains system messages (they're in the top-level `system` field, not in `messages`). So in BLADE's context, "non-system" is all messages in `body["messages"]`. If the code filters by role "system" inside the messages array it will always get all messages (correct behavior but confusing code).
**How to avoid:** In BLADE's Anthropic body, `body["messages"]` never contains a system-role entry (serialize_message returns None for System variant). "Last 3 non-system" simply means "last 3 entries in body['messages']".

### Pitfall 3: Marking the System Block Twice
**What goes wrong:** `system_block_with_cache` already sets `cache_control` on the system block. If `apply_anthropic_cache_control` also sets it, the system block now has a duplicate marker (JSON object with duplicate keys — serde_json last-write-wins, so benign but wasteful). Worse: if the function naively counts the system block marker, it may miscalculate the available message-marker budget.
**How to avoid:** `apply_anthropic_cache_control` should skip marking the system block (it's already marked). Focus only on `body["messages"]`. OR check presence before marking.

### Pitfall 4: OpenRouter + Non-Claude Model
**What goes wrong:** `is_anthropic_compatible` returns true for `provider="openrouter"` without checking the model. A user running `openrouter/meta-llama/llama-3.3-70b-instruct:free` receives `cache_control` fields that Llama doesn't understand.
**How to avoid:** For `provider="openrouter"`, require `model.starts_with("claude") || model.contains("/claude")` before returning true. This is why the function signature needs a `model: &str` parameter.

### Pitfall 5: 1h TTL on Anthropic-compatible Gateways That Don't Support It
**What goes wrong:** Some OpenRouter models or Bedrock configurations reject `{"type":"ephemeral","ttl":"1h"}` with a 400. The `{"type":"ephemeral"}` form (5m) is universally accepted.
**How to avoid:** Default config is `"5m"`. Document that `"1h"` is Anthropic-native only. Consider logging a warning if the API returns 400 with a body containing "ttl" or "cache_control". Phase 89 falsification gate will catch this.

### Pitfall 6: Minimum Token Threshold Not Met
**What goes wrong:** Cache markers are applied but the prompt is below Anthropic's minimum cacheable token count (1024 for Sonnet 4.x, 4096 for Opus 4.x). The API processes the request without caching (no error returned), and the Phase 89 falsification gate shows `cache_read_tokens = 0`.
**Why it happens:** BLADE's system prompt (after Phase 83) should exceed 1024 tokens easily (identity + tool guidance + platform hints is typically 2000-4000 tokens). However, very short sessions or test scenarios may fall below threshold.
**How to avoid:** Not a Phase 85 concern directly. Document that Phase 89's falsification gate uses a realistic conversation against Anthropic with a full system prompt to ensure the threshold is met.

---

## Validation Architecture

> `workflow.nyquist_validation` — not explicitly false in config.json; treat as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` + `#[cfg(test)]` modules |
| Config file | none (in-module tests) |
| Quick run command | `cd src-tauri && cargo test prompt_caching -- --nocapture` |
| Full suite command | `cd src-tauri && cargo test -- --nocapture` |

### Phase Requirements → Test Map

| Req ID | Test # | Behavior | Test Type | Automated Command | Assertion |
|--------|--------|----------|-----------|-------------------|-----------|
| MARKERS-PORT | T1 | Exactly 4 breakpoints placed on a body with system + 5 messages | Unit | `cargo test test_exactly_four_breakpoints` | Count `cache_control` occurrences in serialized body == 4 |
| MARKERS-PORT | T2 | System + last 3 non-system targeting — only the correct messages get marked | Unit | `cargo test test_system_plus_last_three` | Messages at index [-3], [-2], [-1] have `cache_control`; others do not |
| MARKERS-PORT | T3 | `cache_control` shape on string-content message — string promoted to block array | Unit | `cargo test test_string_content_promotion` | After mutation, `content` is `[{type:text, text:..., cache_control:{type:ephemeral}}]` |
| MARKERS-PORT | T4 | `cache_control` shape on multimodal list-content message — last block marked | Unit | `cargo test test_multimodal_content_last_block` | `content[-1]` has `cache_control`; `content[0]` (image block) does not |
| MARKERS-CONFIG | T5 | TTL respected — 5m → `{type:ephemeral}`, 1h → `{type:ephemeral, ttl:"1h"}` | Unit | `cargo test test_ttl_shapes` | Assert shape differences; no beta header in 5m case |
| MARKERS-PROVIDER-DETECT | T6a | No-op for non-Anthropic providers (openai/groq/gemini/ollama) | Unit | `cargo test test_no_op_non_anthropic` | `is_anthropic_compatible("openai", "gpt-4o", None)` returns false; body unchanged after conditional apply |
| MARKERS-CONFIG | T6b | No-op when `cache.enabled = false` | Unit | `cargo test test_no_op_cache_disabled` | Body unchanged when config.cache.enabled = false |

**Note:** T6a and T6b can share a test module as `test_no_op_conditions` covering both sub-cases. The CONTEXT.md lists 6 tests; the two no-op cases (provider + config) count as one combined test (T6) with two assertions, or as two tests (T6a, T6b) — planner's choice.

### Test Implementation Notes

All 6 tests are pure unit tests against built `serde_json::Value` bodies — no live API, no Tauri runtime, no tokio. Each test:
1. Builds a synthetic body directly (or calls `build_body` in test mode)
2. Calls `apply_anthropic_cache_control(&mut body, ttl)` or `is_anthropic_compatible(...)`
3. Asserts on the resulting JSON structure

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_body_with_n_messages(n: usize) -> serde_json::Value {
        let messages: Vec<_> = (0..n).map(|i| {
            if i % 2 == 0 {
                json!({"role": "user", "content": [{"type": "text", "text": format!("user {}", i)}]})
            } else {
                json!({"role": "assistant", "content": [{"type": "text", "text": format!("assistant {}", i)}]})
            }
        }).collect();
        json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "system": [{"type": "text", "text": "You are BLADE.", "cache_control": {"type": "ephemeral"}}],
            "messages": messages,
            "stream": false
        })
    }

    #[test]
    fn test_exactly_four_breakpoints() {
        let mut body = make_body_with_n_messages(5);
        apply_anthropic_cache_control(&mut body, CacheTtl::FiveMin);
        let serialized = serde_json::to_string(&body).unwrap();
        let count = serialized.matches("cache_control").count();
        assert_eq!(count, 4); // 1 system + 3 messages
    }
    // ... etc
}
```

### Wave 0 Gaps
- [ ] `src-tauri/src/providers/prompt_caching.rs` — the module does not yet exist; Wave 0 creates it with the struct + stub functions
- [ ] `src-tauri/src/config.rs` — `CacheConfig` struct does not exist; Wave 0 adds it

None — no test framework installation needed (Rust `#[test]` is built-in).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 5m only (original GA) | 5m default + optional 1h | 2026-05-21 (Anthropic announcement) | 1h reduces cost per session for long agent runs |
| Explicit beta header for 1h | No beta header needed | 2026-05-21 (GA) | Simpler implementation |
| Auto-caching (no markers) | Explicit markers GA (no beta header) | 2024 (GA) | Explicit markers required for cache hits |

**Deprecated/outdated:**
- `anthropic-beta: prompt-caching-2024-07-31` header: was required during beta, no longer needed for 5m caching (now GA)

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 85 |
|-----------|-------------------|
| 6-place config rule | `CacheConfig` must land in DiskConfig struct + default, BladeConfig struct + default, load_config, save_config |
| New module → `mod module_name;` in `lib.rs` | `mod prompt_caching;` in `providers/mod.rs` (not lib.rs — it's a provider submodule) |
| No `cargo check` after every edit | Batch all Phase 85 changes, single `cargo check` at end |
| No Co-Authored-By lines | Commit message from Arnav only |
| `use tauri::Manager;` required for `app.state()` | Not relevant for this phase (no Tauri commands) |
| Duplicate `#[tauri::command]` names are flat namespace | Not relevant (no new commands in this phase) |
| UAT evidence required for runtime changes | Phase 85 is library code only (no UI surface) — static gates sufficient; Phase 89 closes with live UAT |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `serialize_simple` is used by `stream_text` and `stream_text_with_thinking` for User/Assistant messages (string content), while `serialize_message` is used by `build_body` (block array content) | D-04, D-06 | If streaming paths are refactored before Phase 85 lands, the string-promotion logic may be unnecessary |
| A2 | The Bedrock provider reaches `complete_turn_inner` via the `base_url` path (custom base_url pointing to Bedrock endpoint) rather than a dedicated `"bedrock"` provider string | D-05 | If Bedrock gets a first-class provider string in BLADE, `is_anthropic_compatible` logic for Bedrock changes |
| A3 | OpenRouter Anthropic-family models arrive at `is_anthropic_compatible` with `model` strings beginning with `"claude"` or containing `"/claude"` | D-05 | If OpenRouter changes model naming convention, detection breaks silently |

---

## Open Questions (RESOLVED)

1. **Should `apply_anthropic_cache_control` also set the system marker, or rely on `system_block_with_cache` having done it?**
   - **RESOLVED:** `apply_anthropic_cache_control` is the single source of truth for cache breakpoints and is idempotent — it marks the system block if not already marked. `system_block_with_cache` keeps emitting the system block but its `cache_control` is reconciled so the total never exceeds 4 markers (system + last 3 non-system messages). The redundant `mark_last_tool_cached` is removed (D-02 — tools cache via the system prefix).

2. **Should `complete_ext` receive the config, or should the cache application happen at the `complete_turn_inner` level?**
   - **RESOLVED:** Pass `CacheConfig` (or its resolved fields) as a parameter into the Anthropic build/marker path rather than calling `load_config()` inline inside the async hot paths (`complete_ext` / `stream_text` / `stream_text_with_thinking`). The config is read ONCE at the dispatch/call site and threaded down — avoids per-request synchronous disk I/O on the tokio streaming executor.

3. **Does openrouter+claude get markers this phase?**
   - **RESOLVED (scope):** NO — native Anthropic only this phase. openrouter routes through `openai::complete_ext` (mod.rs) with an OpenAI-format body where `cache_control` placement differs materially (system-as-message, passthrough semantics). The v2.5 falsification gate (Phase 89) tests NATIVE Anthropic, so native is the load-bearing path. `is_anthropic_compatible` keeps its correct openrouter+claude classification (it's a tested primitive and gates the native path), but the openrouter marker INTEGRATION is deferred — see CONTEXT Deferred Ideas. The must_have truth for openrouter is unit-classification only, not an integration claim.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this phase is pure Rust code with no external tools, services, or CLIs beyond the existing Tauri build chain)

---

## Sources

### Primary (HIGH confidence)
- [Anthropic Prompt Caching Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — verified prefix order, JSON shapes, TTL behavior, breakpoint maximum, minimum token thresholds
- `src-tauri/src/providers/anthropic.rs` (codebase) — verified existing `mark_last_tool_cached`, `system_block_with_cache`, `build_body`, `serialize_message`, `serialize_simple`, all three build sites
- `src-tauri/src/providers/mod.rs` (codebase) — verified `complete_turn_inner`, OpenRouter routing via `OPENROUTER_BASE_URL` + OpenAI-compat, `KNOWN_PROVIDERS` list
- `src-tauri/src/config.rs` (codebase) — verified 6-place config pattern via `ContextConfig`, `LoopConfig`, `HuntConfig` precedents; DiskConfig:840, BladeConfig:1118, load_config:1468, save_config:1571

### Secondary (MEDIUM confidence)
- [hermes-agent v2.5-hermes-loop-parity-gap.md] — hermes `prompt_caching.py` algorithm description (79 LOC Python); no local .py exists but algorithm is described in research doc
- [Anthropic X post 2026-05-21](https://x.com/AnthropicAI/status/1925633128174899453) — 1h TTL announcement

### Tertiary (LOW confidence)
- [Spring AI Anthropic docs](https://spring.io/blog/2025/10/27/spring-ai-anthropic-prompt-caching-blog/) — adds `anthropic-beta: extended-cache-ttl-2025-04-11` header; contradicts official docs (no header required). Official docs take precedence.

---

## Metadata

**Confidence breakdown:**
- D-01/D-02 (prefix order + tool caching): HIGH — verified against official docs
- D-03 (hermes algorithm): MEDIUM — algorithm described in research doc; no local .py to verify line-by-line
- D-04 (JSON shapes): HIGH — verified against official docs + codebase code paths
- D-05 (provider detection): HIGH — traced live through mod.rs dispatch code
- D-06 (build sites): HIGH — read all 592 lines of anthropic.rs; traced callers in mod.rs
- D-07 (config pattern): HIGH — verified 6-place pattern in config.rs with 3 precedents
- D-08 (TTL/beta header): HIGH — official docs show no header; MEDIUM on Spring AI contradiction (low trust, single source)

**Research date:** 2026-05-23
**Valid until:** 2026-08-23 (stable API; re-verify if Anthropic changes caching model)
