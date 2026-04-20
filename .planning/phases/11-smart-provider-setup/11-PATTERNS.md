---
phase: 11
slug: smart-provider-setup
role: pattern-map
status: draft
created: 2026-04-20
source_decisions: D-51..D-58 (locked in 11-CONTEXT.md)
consumed_by: [gsd-planner, gsd-executor]
---

# Phase 11 — Smart Provider Setup — Pattern Map

> Per-file analog map. The planner drops `<read_first>` pointers verbatim
> into PLAN task actions. Every pattern snippet is ≤10 lines and cites
> file:line so the executor can lift pattern without re-exploring.
>
> **Coverage:** 18 files (6 new Rust · 3 Rust edits · 7 new TS · 2 TS edits ·
> 1 verify script · 1 package.json edit · Playwright specs folder).
> **Analogs found:** 18 / 18 (100%). No novel territory — every surface has
> a production analog already in tree.

---

## File Classification

| File (New / Modify) | Role | Data Flow | Closest Analog | Match |
|---------------------|------|-----------|----------------|-------|
| `src-tauri/src/provider_paste_parser.rs` | NEW · pure parser module | request-response (sync) | `src-tauri/src/action_tags.rs` | exact |
| `src-tauri/src/capability_probe.rs` | NEW · network probe wrapper | request-response (async) | `src-tauri/src/providers/mod.rs::test_connection` | exact |
| `src-tauri/src/router.rs` | MODIFY · add `select_provider` + `#[cfg(test)] mod tests` | pure function + one emit | `src-tauri/src/config.rs::resolve_provider_for_task` (selector) + `src-tauri/src/action_tags.rs` (tests block) | exact |
| `src-tauri/src/config.rs` | MODIFY · 6-place pattern × 5 fields | disk + keyring | `task_routing` / `fallback_providers` rows in this same file | exact |
| `src-tauri/src/lib.rs` | MODIFY · register 2 new Tauri commands | registry | existing `generate_handler![]` block (lib.rs:590) | exact |
| `src-tauri/src/commands.rs` (thin wrappers) | MODIFY · `parse_provider_paste` + `probe_provider_capabilities` | IPC glue | `commands.rs:2228 test_provider` | exact |
| `src/features/providers/ProviderPasteForm.tsx` | NEW · shared paste card | request-response + state machine | `src/features/settings/panes/ProvidersPane.tsx` | exact |
| `src/features/providers/CapabilityPillStrip.tsx` | NEW · pill strip + re-probe | read-only view | `src/features/settings/panes/ProvidersPane.tsx` (Pill usage L138-146) | role-match |
| `src/features/providers/CapabilityGap.tsx` | NEW · empty-state component | read-only view + navigation | `src/features/admin/KeyVault.tsx:152-158` (EmptyState + openRoute) | exact |
| `src/features/providers/FallbackOrderList.tsx` | NEW · drag list | interactive reorder | NONE in `src/` — use HTML5 DnD (noted below) | partial |
| `src/features/providers/CAPABILITY_SURFACES.ts` | NEW · constant registry | static lookup | `src/features/onboarding/providers.ts` | exact |
| `src/features/providers/useCapability.ts` | NEW · hook | read+derive | `src/features/onboarding/useOnboardingState.ts` (shape) + `useConfig` consumer pattern | exact |
| `src/lib/events/index.ts` | MODIFY · add `ROUTING_CAPABILITY_MISSING` | event registry | existing `CAPABILITY_GAP_DETECTED` entry (line 60) | exact |
| `src/lib/events/payloads.ts` | MODIFY · add payload interface | type decl | existing `BladeRoutingSwitchedPayload` (payloads.ts:50-56) | exact |
| `src/lib/tauri/config.ts` | MODIFY · add 2 typed wrappers | IPC glue | `testProvider` / `storeProviderKey` (config.ts:62-85) | exact |
| `src/features/onboarding/ProviderPicker.tsx` | MODIFY · add paste card below 6-grid (D-56) | composition | existing `.providers` grid (L42-51) + `ProviderPasteForm` child | exact |
| `src/features/settings/panes/ProvidersPane.tsx` | MODIFY · paste on top + strip + fallback (D-57) | composition | existing per-card loop (L123-191) | exact |
| `scripts/verify-providers-capability.mjs` | NEW · gate script | static check | `scripts/verify-wiring-audit-shape.mjs` (node/zod) + `scripts/verify-empty-state-coverage.sh` (file-list grep) | exact |
| `package.json` | MODIFY · add `verify:providers-capability` + chain | scripts block | existing `verify:*` entries + `verify:all` chain (L8-30) | exact |
| `tests/e2e/*.spec.ts` (11 specs) | NEW · Playwright | e2e | `tests/e2e/settings-provider.spec.ts` (shim pattern) | exact |

---

## Pattern Assignments

### 1. `src-tauri/src/provider_paste_parser.rs` — NEW (Plan 11-01)

**Role:** self-contained parser module. Pure functions + one `#[tauri::command]` wrapper at bottom. Unit-tested via `#[cfg(test)] mod tests`.

**Analog:** `src-tauri/src/action_tags.rs` (255 lines, exact match for the shape Plan 11-01 wants).

**<read_first>** `src-tauri/src/action_tags.rs:1-10,211-255` (doc-comment header at top + tests block at bottom).

**Module header pattern** (action_tags.rs:1-12):
```rust
/// PROVIDER PASTE PARSER — Extracts provider / model / base_url / api_key from
/// cURL, JSON-blob, or Python-SDK snippets pasted by the user.
///
/// Detection order:
///   1. cURL (leading `curl `)
///   2. JSON blob (leading `{` parses as object)
///   3. Python SDK (OpenAI(...) / Anthropic(...) / Client(...) patterns)
///
/// `parse_provider_paste(input)` returns `Ok(ParsedProviderConfig)` or
/// `Err(descriptive_string)`. Never panics; all errors are user-facing.
use serde::{Deserialize, Serialize};
```

**Result struct pattern** (action_tags.rs:14-19):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedProviderConfig {
    pub provider_guess: String,   // "openai" | "anthropic" | … | "custom"
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub headers: std::collections::HashMap<String, String>,
}
```

**Parser-function signature + top-level dispatch pattern** (action_tags.rs:23-26):
```rust
pub fn parse_provider_paste(input: &str) -> Result<ParsedProviderConfig, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Paste is empty".to_string());
    }
    if trimmed.starts_with("curl ") || trimmed.starts_with("curl\\") { /* cURL */ }
    else if trimmed.starts_with('{')                                 { /* JSON */ }
    else                                                              { /* SDK  */ }
}
```

**Safe-slice usage in error messages** (see CLAUDE.md gotcha; grep `safe_slice` in lib.rs):
```rust
// NEVER: &input[..40]  — panics on non-ASCII
// ALWAYS:
format!("Input started with: '{}...'", crate::safe_slice(input, 40))
```

**Tests-block pattern** (action_tags.rs:211-255 — the canonical shape the planner must mirror):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_curl_basic() {
        let input = "curl https://api.openai.com/v1/chat/completions \\\n  -H 'Authorization: Bearer sk-xxx'";
        let r = parse_provider_paste(input).unwrap();
        assert_eq!(r.provider_guess, "openai");
        assert_eq!(r.api_key, Some("sk-xxx".to_string()));
    }

    #[test]
    fn test_malformed_returns_err() {
        assert!(parse_provider_paste("not a valid snippet").is_err());
    }
}
```

**Tauri command registration pattern** (router.rs:163-166 at bottom):
```rust
#[tauri::command]
pub fn parse_provider_paste(input: String) -> Result<ParsedProviderConfig, String> {
    parse_provider_paste_internal(&input)  // internal fn for test reuse
}
```

**Test-corpus reference:** 11-RESEARCH.md §"Paste Sample Corpus" has 7 cURL + 4 JSON + 5 Python samples + 3 negative cases. Planner copies into the `mod tests` block verbatim.

---

### 2. `src-tauri/src/capability_probe.rs` — NEW (Plan 11-02)

**Role:** async probe wrapping existing `providers::test_connection` + extracting capability metadata. Idempotent (single call, no retry loop — per tester-pass 4ab464c posture).

**Analog:** `src-tauri/src/providers/mod.rs::test_connection` (mod.rs:565-584 — exact shape, just adds metadata capture).

**<read_first>** `src-tauri/src/providers/mod.rs:562-584` (existing test_connection dispatch).

**Dispatch-by-provider pattern** (providers/mod.rs:572-583):
```rust
match provider {
    "gemini"     => gemini::test(api_key, model).await,
    "groq"       => groq::test(api_key, model).await,
    "openai"     => openai::test(api_key, model, base_url).await,
    "anthropic"  => anthropic::test(api_key, model).await,
    "ollama"     => ollama::test(model).await,
    "openrouter" => openai::test(api_key, model, Some(OPENROUTER_BASE_URL)).await,
    _            => Err(format!("Unknown provider: {}", provider)),
}
```

**Wrap-existing-call pattern** (probe builds on top, never duplicates HTTP plumbing):
```rust
pub async fn probe_provider_capabilities(
    provider: &str, api_key: &str, model: &str, base_url: Option<&str>,
) -> Result<ProviderCapabilityRecord, String> {
    // 1. delegate to existing test_connection (reuses provider-specific HTTP)
    let _ok = crate::providers::test_connection(provider, api_key, model, base_url).await?;
    // 2. apply static capability matrix from 11-RESEARCH.md §"Capability Matrix"
    let caps = capability_matrix_lookup(provider, model);
    Ok(ProviderCapabilityRecord {
        model: model.to_string(),
        vision: caps.vision, audio: caps.audio,
        tool_calling: caps.tool_calling, long_context: caps.long_context,
        context_window: caps.context_window,
        last_probed: chrono::Utc::now(),
        probe_status: ProbeStatus::Active,
    })
}
```

**Idempotent / no-retry-loop enforcement** — no `loop { … }`, no `while err.is_retryable()`. Single call, surface the error once:
```rust
// Plan 11-02: mirror commit 4ab464c posture — probe is one-shot.
// The UI re-invokes on user click; Rust never auto-retries.
```

**ProbeStatus enum pattern** (mirrors existing `TaskType` in router.rs:5-16):
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProbeStatus { Active, InvalidKey, ModelNotFound, RateLimited, ProviderDown }
```

**Tests-block pattern** — same as analog 1 above; 5 cases per 11-VALIDATION.md Wave 0:
happy path, 401/403 → InvalidKey, 404 → ModelNotFound, 429 → RateLimited, 5xx → ProviderDown.

---

### 3. `src-tauri/src/router.rs` — MODIFY (Plan 11-04)

**Role:** add `select_provider` function after existing `suggest_model`. Add `#[cfg(test)] mod tests` at bottom of file (none exists today — 166 lines; Plan 11-04 writes the first test block).

**Analog 1 (function shape):** `src-tauri/src/config.rs::resolve_provider_for_task` (config.rs:673-711). Already does tier-descending resolution; Plan 11-04 extends the tier set.

**<read_first>** `src-tauri/src/config.rs:665-711` (existing 2-tier selector). `src-tauri/src/router.rs:1-17` (TaskType enum).

**Tier-descending selector pattern** (config.rs:673-711):
```rust
pub fn resolve_provider_for_task(
    config: &BladeConfig,
    task_type: &crate::router::TaskType,
) -> (String, String, String) {
    use crate::router::TaskType;

    // Tier 0: custom base_url escape hatch (D-55)
    if config.base_url.is_some() {
        return (config.provider.clone(), config.api_key.clone(), config.model.clone());
    }

    // Tier 2: task-type soft preference
    let preferred = match task_type {
        TaskType::Code    => config.task_routing.code.as_deref(),
        TaskType::Vision  => config.task_routing.vision.as_deref(),
        // …
    };

    if let Some(prov) = preferred {
        if prov != config.provider {
            let key = get_api_key_from_keyring(prov);
            if !key.is_empty() || prov == "ollama" {
                // use preferred
            }
        }
    }
    // Tier 3: primary fallback
    (config.provider.clone(), config.api_key.clone(), config.model.clone())
}
```

**Plan 11-04 extends with Tier 1 (capability hard-filter) ABOVE the Tier 2 lookup.** Signature:
```rust
pub fn select_provider(
    task_type: TaskType,
    config: &BladeConfig,
    provider_capabilities: &std::collections::HashMap<String, ProviderCapabilityRecord>,
) -> (String, String, Vec<String>)  // (provider, model, fallback_chain)
```

**Analog 2 (tests block for new file section):** `src-tauri/src/action_tags.rs:211-255` — mirror this verbatim. Test names from 11-VALIDATION.md Wave 0:
- `select_provider_tier0_base_url`
- `select_provider_tier1_vision_override`
- `select_provider_tier2_task_routing`
- `select_provider_tier3_primary`
- `chain_filters_noncapable`
- `chain_dedupes`
- `emits_missing_event`

**Event-emit pattern (for tier-all-miss)** — mirror `commands.rs` emit style (check emit policy: `app.emit_to("main", ...)`, NOT `app.emit()` — gate `verify:emit-policy` blocks raw broadcast):
```rust
let _ = app.emit_to("main", "blade_routing_capability_missing", serde_json::json!({
    "capability": "vision", "task_type": "Vision",
    "message": "No vision-capable provider configured.",
}));
```

**Fallback-chain capability-filter pattern** — extend, don't replace, the existing `providers::mod.rs:599-651` `fallback_chain_complete`:
- Copy the for-loop body; add an `if !provider_supports_capability(fb_provider, required_cap) { continue; }` guard before the key lookup.
- `is_fallback_eligible_error` (providers/mod.rs:89-112) is reused verbatim — no changes.

---

### 4. `src-tauri/src/config.rs` — MODIFY (Plan 11-02 field additions)

**Role:** 6-place pattern for 5 new fields per D-53 + D-52. All 5 additions follow the identical shape — `fallback_providers` (config.rs:286-289) is the single closest row-level analog because it's `Vec<String>`; the `Option<String>` analog is `base_url` (config.rs:73-74 / 244-245 / 348 / 477 / 529).

**<read_first>** `src-tauri/src/config.rs:286-289` (DiskConfig row), `:322-326` (BladeConfig row), `:369` (default line), `:489` (load_config row), `:550` (save_config row).

**The 6 places (exact line citations for 5 new fields):**

| Place | File : Line | Analog field |
|-------|-------------|--------------|
| 1. `DiskConfig` struct | config.rs ≈ L225 | `fallback_providers: Vec<String>` at L286-289 |
| 2. `DiskConfig::default()` | config.rs ≈ L210 (default impl) | (none for Vec — Rust derives; but `serde(default)` attribute must be present) |
| 3. `BladeConfig` struct | config.rs:225-326 | `fallback_providers: Vec<String>` at L286-289 |
| 4. `BladeConfig::default()` | config.rs:336-383 | `fallback_providers: Vec::new()` at L369 |
| 5. `load_config()` mapping | config.rs:465-511 | `fallback_providers: disk.fallback_providers` at L489 (approx) |
| 6. `save_config()` mapping | config.rs:518-566 | `fallback_providers: config.fallback_providers.clone()` at L550 |

**Field 1 — `vision_provider`, `audio_provider`, `long_context_provider`, `tools_provider` (all Option<String>)**

Struct-line pattern (base_url is exact shape, config.rs:73-74 + 244-245):
```rust
#[serde(default)]
pub vision_provider: Option<String>,
```
default-impl line (config.rs:348):
```rust
vision_provider: None,
```

**Field 5 — `provider_capabilities: HashMap<String, ProviderCapabilityRecord>`**

Analog: `task_routing: TaskRouting` (already a struct-typed field with derive-Default) at config.rs:281 + 366. The HashMap equivalent uses `#[serde(default)]` + `HashMap::new()`:
```rust
#[serde(default)]
pub provider_capabilities: std::collections::HashMap<String, ProviderCapabilityRecord>,
// in default(): provider_capabilities: std::collections::HashMap::new(),
```

**Auto-population rule (D-53 — don't overwrite user choice):**
```rust
// After a successful probe, iff the slot is currently None, auto-set it.
// Never overwrite an explicit user choice.
if config.vision_provider.is_none() && caps.vision {
    config.vision_provider = Some(format!("{}/{}", provider, model));
}
```

**Tests-block addition** (Plan 11-02 acceptance-map task 11-02-01):
Grep for existing `#[cfg(test)] mod tests` in config.rs: **none exists today.** Plan 11-02 creates the first one. Mirror `action_tags.rs:211-255` shape. Required test: `phase11_fields_round_trip` — write a BladeConfig with all 5 new fields set, `save_config` it to a tempdir, `load_config`, assert round-trip equality.

---

### 5. `src-tauri/src/lib.rs` — MODIFY (Plan 11-01 + 11-02 registration)

**Role:** add 2 new Tauri commands to `generate_handler![]`. Zero-logic change — pure registration.

**<read_first>** `src-tauri/src/lib.rs:590-670` (existing generate_handler block).

**Registration pattern** (lib.rs:602-605):
```rust
config::get_all_provider_keys,
config::store_provider_key,
config::switch_provider,
config::get_task_routing,
```

**Plan 11-01/11-02 additions:**
```rust
commands::parse_provider_paste,         // Plan 11-01
commands::probe_provider_capabilities,  // Plan 11-02
```

**Module mod-registration** (lib.rs:1-30, add between alphabetically sorted `provider_*` entries):
```rust
mod provider_paste_parser;
mod capability_probe;
```

**Gotcha enforced via CLAUDE.md:** function name collisions. Verify `parse_provider_paste` and `probe_provider_capabilities` are unique across ALL `#[tauri::command]` sites (Tauri's macro namespace is flat). Current usage (all lowercase snake): no match — names are safe.

---

### 6. `src-tauri/src/commands.rs` — thin wrappers

**Role:** two 4-line wrappers delegating to the new modules. Needed because Plan 11-01/11-02 keep parser/probe modules pure (no Tauri dependency) while Tauri commands must live where the `#[tauri::command]` attribute can see the handler registry.

**Analog:** `commands.rs:2228-2236 test_provider` — exact shape.

**<read_first>** `src-tauri/src/commands.rs:2228-2236`.

**Pattern:**
```rust
#[tauri::command]
pub async fn probe_provider_capabilities(
    provider: String, api_key: String, model: String, base_url: Option<String>,
) -> Result<ProviderCapabilityRecord, String> {
    capability_probe::probe_provider_capabilities(&provider, &api_key, &model, base_url.as_deref()).await
}
```

Parser command is sync (no `.await`):
```rust
#[tauri::command]
pub fn parse_provider_paste(input: String) -> Result<ParsedProviderConfig, String> {
    provider_paste_parser::parse(&input)
}
```

---

### 7. `src/features/providers/ProviderPasteForm.tsx` — NEW (Plan 11-03)

**Role:** shared Card+Textarea+Button+StateMachine. Mounted by both onboarding (Surface A) and Settings (Surface B) per UI-SPEC Cross-Surface Invariant #1.

**Analog:** `src/features/settings/panes/ProvidersPane.tsx` (195 lines — exact match for the Input-with-Test+Save + error surface + busy state shape).

**<read_first>** `src/features/settings/panes/ProvidersPane.tsx:36-97` (handler shape + TauriError unwrap + busy state).

**Handler shape pattern** (ProvidersPane.tsx:59-74):
```tsx
const handleDetect = async () => {
  setBusy('parsing');
  try {
    const parsed = await parseProviderPaste(input);
    setBusy('probing');
    const caps = await probeProviderCapabilities({
      provider: parsed.provider_guess, apiKey: parsed.api_key ?? '',
      model: parsed.model ?? '', baseUrl: parsed.base_url,
    });
    setResult({ parsed, caps });
  } catch (e) {
    setError(errMessage(e));
  } finally {
    setBusy(null);
  }
};
```

**Error unwrap pattern** (ProvidersPane.tsx:36-39 — must be copied verbatim so TauriError messages surface cleanly):
```tsx
function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}
```

**Card + Input + Button composition pattern** (ProvidersPane.tsx:131-190, mirror the outer shape):
```tsx
<Card>
  <h3>{/* heading */}</h3>
  <textarea className="input mono" rows={6} value={input}
    onChange={(e) => setInput(e.target.value)} spellCheck={false} />
  <div className="settings-actions">
    <Button variant="primary" disabled={!input || busy != null} onClick={handleDetect}>
      {busy === 'parsing' ? 'Detecting…' : busy === 'probing' ? 'Probing…' : 'Detect & probe'}
    </Button>
  </div>
</Card>
```

**Busy/state-machine field pattern** (ProvidersPane.tsx:46 — Record<id, 'test' | 'save' | null>):
```tsx
const [busy, setBusy] = useState<'parsing' | 'probing' | null>(null);
```

**Copy strings** — from UI-SPEC.md §"Copywriting Contract":
- Button idle: `Detect & probe`
- Button parsing: `Detecting provider…`
- Button probing: `Probing…`
- Textarea placeholder: `Paste a cURL, JSON config, or Python SDK snippet…`

**a11y live-region pattern** — see UI-SPEC §"Screen-reader announcements". Mirror the `<div role="status" aria-live="polite" className="sr-only">` convention; no existing analog in ProvidersPane, so use the primitive composition directly.

---

### 8. `src/features/providers/CapabilityPillStrip.tsx` — NEW (Plan 11-03)

**Role:** render 4 Pill primitives + one re-probe icon button given a `ProviderCapabilityRecord`. Pure view component.

**Analog:** existing Pill usage inside ProvidersPane rows (ProvidersPane.tsx:138-146).

**<read_first>** `src/features/settings/panes/ProvidersPane.tsx:138-146`, `src/design-system/primitives/Pill.tsx:1-33`.

**Pill tone-per-state pattern** (ProvidersPane.tsx:138-146):
```tsx
{hasKey ? (
  <Pill tone="free">Key stored: {stored?.masked || '****'}</Pill>
) : p.needsKey ? (
  <Pill tone="new">No key</Pill>
) : (
  <Pill>No key needed (local)</Pill>
)}
```

**Plan 11-03 translation (per UI-SPEC §"Capability pill tone rules"):**
```tsx
<ul role="list" aria-label={`${provider} capabilities`}
  style={{ display: 'flex', gap: 'var(--s-1)', flexWrap: 'wrap', listStyle: 'none', padding: 0 }}>
  <li><Pill tone={caps.vision ? 'free' : 'default'}>
    {caps.vision ? '✓ vision' : '✗ vision'}
  </Pill></li>
  {/* audio, tools, ctx — same shape */}
</ul>
```

**Re-probe icon-button pattern** — UI-SPEC specifies `<Button variant="icon" size="sm">`. Closest analog for icon-only button: `src/features/admin/KeyVault.tsx` (has `Button` + icon usage). aria-label is required per UI-SPEC §"ARIA semantics":
```tsx
<Button variant="icon" onClick={onReprobe} aria-label={`Re-probe ${provider} capabilities`}>
  {busy ? <GlassSpinner size={12} /> : '↻'}
</Button>
```

---

### 9. `src/features/providers/CapabilityGap.tsx` — NEW (Plan 11-05)

**Role:** empty-state component rendered by consumer surfaces when `useCapability(cap).hasCapability === false`.

**Analog:** `src/features/admin/KeyVault.tsx:152-158` — exact composition (EmptyState + openRoute for CTA).

**<read_first>** `src/features/admin/KeyVault.tsx:21,92,148-159`, `src/design-system/primitives/EmptyState.tsx:1-67`.

**Composition pattern** (KeyVault.tsx:152-158):
```tsx
<EmptyState
  label="No API keys stored"
  description="Configure provider keys in Settings → Providers."
  actionLabel="Open settings"
  onAction={() => router.openRoute('settings-providers')}
/>
```

**openRoute pattern** (KeyVault.tsx:21 + 92):
```tsx
import { useRouterCtx } from '@/windows/main/useRouter';
// …
const router = useRouterCtx();
```

**Plan 11-05 translation (UI-SPEC §"CapabilityGap copy" locked):**
```tsx
const COPY = {
  vision:       { h: 'Needs a vision-capable model', b: '…', link: 'Learn which models support vision ↗' },
  audio:        { h: 'Needs an audio-capable model', b: '…', link: '…' },
  long_context: { h: 'Needs a long-context model',   b: '…', link: '…' },
  tools:        { h: 'Needs a tool-calling model',   b: '…', link: '…' },
} as const;
// …
<EmptyState
  icon={<IconFor capability={capability} />}
  label={COPY[capability].h}
  description={COPY[capability].b}
  actionLabel="Add a provider"
  onAction={() => router.openRoute('settings-providers', { needs: capability })}
  testId={`capability-gap-${capability}`}
/>
```

**Secondary link pattern** — ProvidersPane.tsx:158-171 (external link via `openUrl`):
```tsx
<a href={url} onClick={(e) => { e.preventDefault(); openUrl(url).catch(() => {}); }}
   className="settings-link">{COPY[capability].link}</a>
```

---

### 10. `src/features/providers/FallbackOrderList.tsx` — NEW (Plan 11-03)

**Role:** drag list for `config.fallback_providers` reorder.

**Analog (partial):** NONE in `src/`. Grep for `draggable` / `onDragStart` / `onDrop` returned only `TitleBar.tsx` (window-drag, not list-drag). This is the ONE novel component in Phase 11.

**Mitigation:** use native HTML5 DnD per UI-SPEC §"Fallback order section" — no library dependency (D-01 locks no new deps).

**<read_first>** (no existing analog) — instead, planner reads UI-SPEC §"Fallback order section" verbatim for:
- `draggable={true}` on each Card row
- `onDragStart`, `onDragOver`, `onDrop` handler triple
- source-row opacity 0.4 while dragging
- drop-target 2px `var(--a-cool)` top border
- keyboard DnD: Space/Enter pickup, Arrow Up/Down move, Space/Enter drop

**Shape template (derive from UI-SPEC, no codebase analog):**
```tsx
<GlassPanel tier={2}>
  <ul role="list" aria-label="Provider fallback order, drag to reorder">
    {ordered.map((entry, i) => (
      <li key={entry.provider} role="listitem" tabIndex={0}
          draggable aria-grabbed={draggingIdx === i}
          onDragStart={() => setDraggingIdx(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => reorder(draggingIdx!, i)}>
        <Card tier={2} padding="sm">
          <span>≡</span> {entry.provider} • {entry.model}
        </Card>
      </li>
    ))}
  </ul>
</GlassPanel>
```

**Persistence pattern** — reuse existing `saveConfigField` (config.ts:195):
```tsx
await saveConfigField('fallback_providers', JSON.stringify(newOrder));
```
(Note: `saveConfigField` takes `value: string`; Plan 11-03 may need a typed sibling command. Flag to planner.)

---

### 11. `src/features/providers/CAPABILITY_SURFACES.ts` — NEW (Plan 11-05)

**Role:** frozen constant registry. Typed `as const` literal.

**Analog:** `src/features/onboarding/providers.ts:40-101` — exact shape for a typed const record.

**<read_first>** `src/features/onboarding/providers.ts:18-101`.

**Pattern:**
```ts
// src/features/providers/CAPABILITY_SURFACES.ts
//
// Registry of routes that require each capability (D-54).
// Consumed by <CapabilityGap> + useCapability() to render capability-missing
// prompts on known surfaces. PROV-07/08 acceptance = ≥2 entries per capability.
//
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54

export const CAPABILITY_SURFACES = {
  vision: [
    { route: 'screen-timeline', label: 'Screen Timeline' },
    { route: 'quickask',        label: 'QuickAsk image input' },
    // …
  ],
  audio:        [ /* ≥2 */ ],
  long_context: [ /* ≥2 */ ],
  tools:        [ /* ≥2 */ ],
} as const;

export type Capability = keyof typeof CAPABILITY_SURFACES;
```

**Surface candidates (from 11-CONTEXT.md §"Capability-gap surface candidates"):** planner picks ≥2 per capability from:
- vision: ScreenTimeline.tsx · QuickAsk · WebAutomation.tsx
- audio: Voice Orb · Meeting Ghost (MeetingsView)
- long_context: Chat useChat.tsx · KnowledgeBase full-repo
- tools: Agents swarm · WebAutomation.tsx

---

### 12. `src/features/providers/useCapability.ts` — NEW (Plan 11-05)

**Role:** hook returning `{ hasCapability, suggestedProvider, openAddFlow }`. Consumed by surfaces to gate UI.

**Analog:** `src/features/onboarding/useOnboardingState.ts:71-158` (shape — useState + useCallback setters + returned tuple).

**<read_first>** `src/features/onboarding/useOnboardingState.ts:20-90`. Also `src/features/admin/KeyVault.tsx:92` for useRouterCtx usage.

**Pattern:**
```ts
// src/features/providers/useCapability.ts
import { useConfig } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import type { Capability } from './CAPABILITY_SURFACES';

export function useCapability(capability: Capability) {
  const { config } = useConfig();  // existing ConfigContext
  const router = useRouterCtx();

  const hasCapability = Object.values(config.provider_capabilities ?? {})
    .some((rec) => rec[capability]);

  const openAddFlow = () => router.openRoute('settings-providers', { needs: capability });

  return { hasCapability, openAddFlow };
}
```

**ConfigContext consumer analog:** `src/features/settings/panes/ProvidersPane.tsx:43` (`const { reload } = useConfig();`) — same import path.

---

### 13. `src/lib/events/index.ts` — MODIFY (Plan 11-04)

**Role:** one new registry entry for `ROUTING_CAPABILITY_MISSING`.

**Analog:** existing `CAPABILITY_GAP_DETECTED` entry (events/index.ts:60).

**<read_first>** `src/lib/events/index.ts:54-62`.

**Pattern** (events/index.ts:60 is the exact shape):
```ts
CAPABILITY_GAP_DETECTED: 'capability_gap_detected',
```

**Plan 11-04 addition** (placed near CAPABILITY_GAP_DETECTED so greppers find both):
```ts
// Phase 11 Plan 11-04 (D-55) — router emits when no capable provider found.
// Payload: RoutingCapabilityMissingPayload (see payloads.ts).
ROUTING_CAPABILITY_MISSING: 'blade_routing_capability_missing',
```

**Naming discipline** (per UI-SPEC "Pitfall 8"): ROUTING prefix differentiates from CAPABILITY_GAP_DETECTED (which is Phase-10 legacy). DO NOT reuse the older name.

---

### 14. `src/lib/events/payloads.ts` — MODIFY (Plan 11-04)

**Role:** one typed payload interface.

**Analog:** `BladeRoutingSwitchedPayload` (payloads.ts:50-56).

**<read_first>** `src/lib/events/payloads.ts:50-56`.

**Pattern:**
```ts
export interface BladeRoutingSwitchedPayload {
  from_provider: string;
  from_model: string;
  to_provider: string;
  to_model: string;
  reason: string;
}
```

**Plan 11-04 addition** (matches Rust struct verbatim, snake_case fields):
```ts
/** Phase 11 Plan 11-04 (D-55) — router emits when ALL tiers fail.
 *  Shape matches serde_json::json!() site in src-tauri/src/router.rs. */
export interface RoutingCapabilityMissingPayload {
  capability: 'vision' | 'audio' | 'long_context' | 'tools';
  task_type: string;
  message: string;
}
```

---

### 15. `src/lib/tauri/config.ts` — MODIFY (Plan 11-01 + 11-02 wrappers)

**Role:** two typed wrappers + TS types mirroring Rust output.

**Analog:** `testProvider` (config.ts:62-72) and `storeProviderKey` (config.ts:80-85).

**<read_first>** `src/lib/tauri/config.ts:55-85`.

**Pattern** — per-wrapper JSDoc @see + snake_case IPC boundary + camelCase TS API:
```ts
/** @see src-tauri/src/commands.rs `pub fn parse_provider_paste(input: String) -> Result<ParsedProviderConfig, String>` */
export function parseProviderPaste(input: string): Promise<ParsedProviderConfig> {
  return invokeTyped<ParsedProviderConfig, { input: string }>('parse_provider_paste', { input });
}

/** @see src-tauri/src/commands.rs `pub async fn probe_provider_capabilities(...)` */
export function probeProviderCapabilities(args: {
  provider: string; apiKey: string; model: string; baseUrl?: string;
}): Promise<ProviderCapabilityRecord> {
  return invokeTyped<ProviderCapabilityRecord, {
    provider: string; api_key: string; model: string; base_url?: string;
  }>('probe_provider_capabilities', {
    provider: args.provider, api_key: args.apiKey, model: args.model, base_url: args.baseUrl,
  });
}
```

**Arg-key casing gotcha** (_base.ts:49-56): `toCamelArgs` normalises outgoing keys, so either snake or camel works. Convention is snake_case at the boundary, matching existing wrappers (config.ts:65-85).

**Type exports:** add to `src/types/provider.ts`:
```ts
export interface ParsedProviderConfig { /* mirror Rust struct */ }
export interface ProviderCapabilityRecord { /* mirror Rust struct */ }
```

**Barrel re-export:** `src/lib/tauri/index.ts:18-28` — add `parseProviderPaste, probeProviderCapabilities` to the explicit export list.

---

### 16. `src/features/onboarding/ProviderPicker.tsx` — MODIFY (Plan 11-03)

**Role:** add a single `<ProviderPasteForm />` child below the `.providers` grid (D-56 — preserve 6 cards, add paste alongside).

**Analog:** the file itself — non-invasive mount of a sibling child.

**<read_first>** `src/features/onboarding/ProviderPicker.tsx:42-57`.

**Current grid structure:**
```tsx
<div className="providers" role="radiogroup" aria-label="AI providers">
  {PROVIDERS.map((p) => <ProviderCard … />)}
</div>

<div className="onb-footer">
  <Button variant="primary" onClick={() => setStep('apikey')}>Continue →</Button>
</div>
```

**Plan 11-03 insertion** (between `</div>` of `.providers` and `<div className="onb-footer">`):
```tsx
</div>

{/* Phase 11 D-56 — divider + paste card below 6-grid. */}
<div className="onb-divider" aria-hidden="true">
  <span className="t-small">or</span>
</div>
<ProviderPasteForm onSuccess={(parsed) => { setProvider(parsed.provider_guess, parsed.model); setStep('apikey'); }} />

<div className="onb-footer">
```

**CSS hook:** `.onb-divider` is a NEW class. Add to `src/features/onboarding/onboarding.css` mirroring the existing `.onb-error` / `.onb-footer` pattern (token-only — no hardcoded px).

---

### 17. `src/features/settings/panes/ProvidersPane.tsx` — MODIFY (Plan 11-03)

**Role:** 3 mutations (D-57 + D-52):
1. `<ProviderPasteForm />` at top (above settings-grid)
2. `<CapabilityPillStrip />` inside each provider card (between "Key stored" Pill and Input)
3. `<FallbackOrderList />` below the grid

**Analog:** the file itself.

**<read_first>** `src/features/settings/panes/ProvidersPane.tsx:117-194`.

**Current structure:**
```tsx
<div className="settings-section">
  <h2>Providers</h2>
  <p>Configure your API keys…</p>
  <div className="settings-grid">
    {PROVIDERS.map((p) => {
      // …
      return (
        <Card key={p.id}>
          {/* heading + pills + input + buttons */}
        </Card>
      );
    })}
  </div>
</div>
```

**Plan 11-03 mutations:**
```tsx
<div className="settings-section">
  <h2>Providers</h2>
  <p>Configure your API keys…</p>

  {/* ADDITION 1: paste form at top */}
  <ProviderPasteForm onSuccess={() => refresh()} />

  <div className="settings-grid">
    {PROVIDERS.map((p) => {
      const caps = keys?.provider_capabilities?.[p.id];  // new field from Plan 11-02
      return (
        <Card key={p.id}>
          {/* existing: heading + key-stored pill */}

          {/* ADDITION 2: capability strip (only if key stored) */}
          {hasKey && <CapabilityPillStrip provider={p.id} record={caps} onReprobe={() => handleReprobe(p.id)} />}

          {/* existing: Input + Test/Save buttons */}
        </Card>
      );
    })}
  </div>

  {/* ADDITION 3: fallback drag list */}
  <h3 className="t-h3">Fallback order</h3>
  <p className="t-small">If the primary provider errors, BLADE retries through this chain…</p>
  <FallbackOrderList />
</div>
```

**Capability data source:** Plan 11-02 extends `get_all_provider_keys` return shape (or adds a sibling `get_provider_capabilities` command). Planner decides; both paths are trivially wrapped in `src/lib/tauri/config.ts`.

---

### 18. `scripts/verify-providers-capability.mjs` — NEW (Plan 11-06)

**Role:** Phase 11 gate script. Chains into `verify:all` as gate 20.

**Analog 1 (Node + static parse):** `scripts/verify-wiring-audit-shape.mjs` (417 lines — zod-schema validation + file-list regex extraction). Exact shape for the structural checks (6-place count, fields appear in N places).

**Analog 2 (file-list grep):** `scripts/verify-empty-state-coverage.sh` (98 lines — union of required files, grep each for an expected pattern). Exact shape for the "≥1 `<CapabilityGap capability="X">` usage in src/" check.

**<read_first>** `scripts/verify-wiring-audit-shape.mjs:1-50,118-165` (walk + check), `scripts/verify-empty-state-coverage.sh:22-98` (required-files pattern).

**Checks per 11-VALIDATION.md Wave 0 task 11-06-01 and CONTEXT.md D-54 + D-53:**

1. **CAPABILITY_SURFACES has ≥2 entries per capability** (Node + regex parse):
   ```js
   const src = readFileSync('src/features/providers/CAPABILITY_SURFACES.ts', 'utf8');
   for (const cap of ['vision', 'audio', 'long_context', 'tools']) {
     const block = src.match(new RegExp(`${cap}:\\s*\\[([\\s\\S]*?)\\]`))?.[1] ?? '';
     const count = (block.match(/route:\s*['"]/g) || []).length;
     if (count < 2) failed.push(`${cap}: has ${count}/2 surfaces`);
   }
   ```

2. **Each capability has ≥1 `<CapabilityGap capability="X">` usage** (file walk + grep):
   ```js
   const pat = /<CapabilityGap\s+capability=["'](\w+)["']/g;
   // walk src/**/*.{tsx,ts}, accumulate matches
   for (const cap of CAPS) {
     if (!found.has(cap)) failed.push(`no <CapabilityGap capability="${cap}"> in src/`);
   }
   ```

3. **All 5 new BladeConfig fields appear in 6 places in config.rs** — mirror checkConfig from wiring-audit-shape.mjs (L268-298):
   ```js
   const NEW_FIELDS = ['vision_provider', 'audio_provider', 'long_context_provider', 'tools_provider', 'provider_capabilities'];
   const src = readFileSync('src-tauri/src/config.rs', 'utf8');
   for (const f of NEW_FIELDS) {
     const occurrences = (src.match(new RegExp(`\\b${f}\\b`, 'g')) || []).length;
     if (occurrences < 6) failed.push(`${f}: ${occurrences}/6 places`);
   }
   ```

4. **`BLADE_EVENTS.ROUTING_CAPABILITY_MISSING` exists + has ≥1 subscriber** (grep src/):
   ```js
   const events = readFileSync('src/lib/events/index.ts', 'utf8');
   if (!events.includes('ROUTING_CAPABILITY_MISSING')) failed.push('event constant missing');
   // walk src/**/*.{tsx,ts}, count `BLADE_EVENTS.ROUTING_CAPABILITY_MISSING` references
   ```

**Self-test flag pattern** (wiring-audit-shape.mjs:346-361): `--self-test` runs without side-effects; useful for CI dry-run.

**Soft-skip on Wave-0 gap** (wiring-audit-shape.mjs:367-370): if `src/features/providers/CAPABILITY_SURFACES.ts` doesn't exist yet, log WARN and skip — Wave 1 creates it.

---

### 19. `package.json` — MODIFY (Plan 11-06)

**Role:** two script entries + chain into `verify:all`.

**Analog:** existing `verify:wiring-audit-shape` entry (package.json:29) + the `verify:all` chain (package.json:30).

**<read_first>** `package.json:8-35`.

**Pattern** (line 29, verbatim shape):
```json
"verify:wiring-audit-shape": "node scripts/verify-wiring-audit-shape.mjs",
```

**Plan 11-06 additions:**
```json
"verify:providers-capability": "node scripts/verify-providers-capability.mjs",
"test:e2e:phase11": "playwright test tests/e2e/onboarding-paste-card.spec.ts tests/e2e/settings-providers-pane.spec.ts tests/e2e/fallback-order-drag.spec.ts tests/e2e/capability-gap-vision-*.spec.ts tests/e2e/capability-gap-audio-*.spec.ts tests/e2e/capability-gap-longctx-*.spec.ts tests/e2e/capability-gap-tools-*.spec.ts"
```

**`verify:all` chain extension** (append `&& npm run verify:providers-capability` at end of the existing chain on L30):
```
… && npm run verify:wiring-audit-shape && npm run verify:providers-capability
```

---

### 20. `tests/e2e/*.spec.ts` — NEW (11 specs, Plan 11-03 + 11-05)

**Role:** Playwright specs, one per acceptance criterion.

**Analog:** `tests/e2e/settings-provider.spec.ts` (258 lines — exact shape for the Tauri invoke shim + reflective keyring mock).

**<read_first>** `tests/e2e/settings-provider.spec.ts:40-165` (installShim pattern), `:179-257` (test body — nav + click + expect.poll + reload persistence).

**Shim pattern** (settings-provider.spec.ts:40-156) — reusable across all 11 new specs:
```ts
async function installShim(page: Page): Promise<ShimHandles> {
  await page.addInitScript(() => {
    // mutable keyring mock, localStorage-backed for reload persistence
    // invokeTyped routes via __TAURI_INTERNALS__.invoke
    async function handleInvoke(cmd: string, args): Promise<unknown> {
      switch (cmd) {
        case 'get_config':                return baseConfig;
        case 'parse_provider_paste':      return stubParsedConfig(args);
        case 'probe_provider_capabilities': return stubCapabilityRecord(args);
        // …
      }
    }
    (window as any).__TAURI_INTERNALS__ = { invoke: handleInvoke, /* … */ };
  });
}
```

**expect.poll pattern for async invoke observation** (settings-provider.spec.ts:212-216):
```ts
await expect.poll(
  async () => (await handles.getInvokeCalls()).find((c) => c.cmd === 'parse_provider_paste'),
  { timeout: 3000 },
).toBeTruthy();
```

**Required specs per 11-VALIDATION.md Wave 0:**
- `onboarding-paste-card.spec.ts` — Plan 11-03 PROV-04
- `settings-providers-pane.spec.ts` — Plan 11-03 PROV-05 visual
- `fallback-order-drag.spec.ts` — Plan 11-03 D-57
- `capability-gap-vision-screen-timeline.spec.ts` + `capability-gap-vision-quickask.spec.ts` — Plan 11-05 PROV-07
- `capability-gap-audio-voice-orb.spec.ts` + `capability-gap-audio-meeting-ghost.spec.ts` — Plan 11-05 PROV-08
- `capability-gap-longctx-chat.spec.ts` + `capability-gap-longctx-knowledge.spec.ts` — PROV-08
- `capability-gap-tools-swarm.spec.ts` + `capability-gap-tools-web-automation.spec.ts` — PROV-08

Each spec follows the same 4-step shape: (1) installShim, (2) goto + wait for boot gate, (3) navigate to surface, (4) expect `<EmptyState>` rendered with capability-specific copy per UI-SPEC §"CapabilityGap copy".

---

## Shared Patterns

### S-1. 6-place config pattern (CONFIG.rs — enforced convention)

**Source:** `src-tauri/src/config.rs` (entire file).
**Apply to:** every `BladeConfig` field added in Plan 11-02.

**The 6 places (CLAUDE.md "critical architecture rule"):**
1. `DiskConfig` struct (config.rs:54-224)
2. `DiskConfig::default()` (implicit via #[serde(default)] — use default fn if not HashMap/Vec/Option)
3. `BladeConfig` struct (config.rs:225-326)
4. `BladeConfig::default()` (config.rs:336-383)
5. `load_config()` disk→BladeConfig map (config.rs:465-512)
6. `save_config()` BladeConfig→disk map (config.rs:518-566)

**Gate:** `scripts/verify-providers-capability.mjs` check #3 (see §18 above) enforces `≥6 occurrences of each new field` in config.rs. Fewer = WIRED-NOT-USED (Phase 10 audit terminology).

### S-2. Tauri command registration (3 steps)

**Source:** `src-tauri/src/lib.rs:1-30,590-670` + `src-tauri/src/commands.rs:2228-2236`.
**Apply to:** `parse_provider_paste` (Plan 11-01) and `probe_provider_capabilities` (Plan 11-02).

1. `mod provider_paste_parser;` / `mod capability_probe;` — top of lib.rs
2. `commands::parse_provider_paste` — inside `generate_handler![]` block
3. Thin `#[tauri::command]` wrapper in commands.rs that delegates to the pure module

**Gate:** CLAUDE.md "Common mistakes" § — function-name collision. `grep -r "#\[tauri::command\]" -A 1` to verify uniqueness.

### S-3. invokeTyped wrapper discipline

**Source:** `src/lib/tauri/_base.ts:71-82` + all wrappers in `src/lib/tauri/config.ts`.
**Apply to:** every new wrapper (§15 above).

- NO raw `invoke()` imports in `src/` — enforced by `verify:no-raw-tauri` gate (package.json:12)
- Snake_case at the IPC boundary (matches Rust param names verbatim)
- camelCase TS API (arg-key casing normalised by `toCamelArgs`)
- JSDoc `@see` citing `src-tauri/src/...` file:line
- Re-export via `src/lib/tauri/index.ts:18-28` barrel

### S-4. useTauriEvent discipline for router event

**Source:** `src/lib/events/index.ts:226-265` (useTauriEvent hook).
**Apply to:** the single subscriber that listens for `ROUTING_CAPABILITY_MISSING` (Plan 11-04 emits; Plan 11-05's chat banner subscribes).

- NO raw `listen()` imports in `src/` — enforced by same gate as S-3
- Event-name literal must exist in `BLADE_EVENTS` (compile-time check via `BladeEventName` union)
- Payload type must exist in `src/lib/events/payloads.ts`
- Subscriber mounts via `useTauriEvent(BLADE_EVENTS.ROUTING_CAPABILITY_MISSING, handler)`

### S-5. Emit policy (no raw broadcast)

**Source:** `scripts/verify-emit-policy.mjs:26-78` (CROSS_WINDOW_ALLOWLIST).
**Apply to:** Plan 11-04's `blade_routing_capability_missing` emit.

- MUST be `app.emit_to("main", ...)`, NOT `app.emit(...)` or `emit_all(...)`
- If the emit is cross-window (unlikely for this event), add `router.rs:blade_routing_capability_missing` to the allowlist

### S-6. TauriError unwrap for user-facing messages

**Source:** `src/features/settings/panes/ProvidersPane.tsx:36-39`.
**Apply to:** ProviderPasteForm, CapabilityPillStrip re-probe, FallbackOrderList saves.

```tsx
function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}
```

### S-7. Design-system discipline (no new deps, no new tokens)

**Source:** UI-SPEC.md §"Design System" table + §"Verification Targets" L558-567.
**Apply to:** every new TSX file in `src/features/providers/`.

- 0 new dependencies (registry safety = pass by construction)
- 0 new tokens — use only `var(--s-*)`, `var(--t-*)`, `var(--a-*)`
- 0 hardcoded px font-sizes — use `.t-h*` / `.t-body` / `.t-small` / `.t-mono`
- 0 hardcoded px spacing — use Card `padding` prop or `var(--s-N)` tokens
- All imports resolve to `@/design-system/primitives` or local feature files

**Gate:** existing verify gates at package.json:25-28 cover aria-icon-buttons, motion-tokens, tokens-consistency, empty-state-coverage.

---

## No Analog Found

| File | Role | Data Flow | Reason | Mitigation |
|------|------|-----------|--------|------------|
| `src/features/providers/FallbackOrderList.tsx` | drag-reorder list | interactive | ONLY `TitleBar.tsx` uses `draggable=` and that's window-drag not list-drag — no list-DnD precedent | Use native HTML5 DnD per UI-SPEC §"Fallback order section" (D-01 locks no new deps). Template provided in §10 above. |

Every other file in Phase 11 has an in-tree analog with ≥80% pattern match.

---

## Metadata

**Analog search scope:**
- `src-tauri/src/` (130+ Rust modules — focused on parser / probe / config / router)
- `src/features/` (18 feature folders — focused on providers, onboarding, settings, admin, events)
- `src/design-system/primitives/` (12 primitives inspected for Pill/EmptyState/Button composition)
- `src/lib/tauri/` (18 wrapper files — focused on _base.ts and config.ts)
- `src/lib/events/` (3 files — index.ts + payloads.ts)
- `scripts/` (23 scripts — focused on verify-wiring-audit-shape.mjs and verify-empty-state-coverage.sh)
- `tests/e2e/` (34 specs — focused on settings-provider.spec.ts as shim shape)

**Files scanned:** ~45 source files read; ~15 greps executed. Stopped at 5 strong matches per file (no diminishing-return exploration).

**Pattern extraction date:** 2026-04-20 (Phase 11 active).

**Next step for planner:** each PLAN task consumes the `<read_first>` citations verbatim in its "references" section. No re-exploration needed — every code excerpt is already in this document with file:line.
