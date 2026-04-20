---
phase: 11-smart-provider-setup
plan: 01
subsystem: provider-paste-parser
role: summary
tags: [phase-11, rust, parser, tauri-command, wave-0, substrate]
dependency_graph:
  requires: []
  provides:
    - parse_provider_paste Tauri command
    - ParsedProviderConfig struct (Rust + TS mirror)
    - provider_paste_parser::parse pure-Rust entry point
    - parseProviderPaste typed frontend wrapper
  affects:
    - Plan 11-03 (onboarding + Settings paste forms consume parseProviderPaste)
    - Plan 11-02 (capability probe pairs with parser output to classify a key)
    - Plan 11-06 (verify gate chains the unit tests)
tech-stack:
  added: []
  patterns:
    - Pure-Rust module + `#[cfg(test)] mod tests` (action_tags.rs analog)
    - Thin `#[tauri::command]` wrapper in commands.rs delegating to module
    - `OnceLock<Regex>` for compile-once pattern registry
    - invokeTyped frontend wrapper with snake_case IPC boundary
    - `crate::safe_slice` for non-ASCII-safe error message prefixes
key-files:
  created:
    - src-tauri/src/provider_paste_parser.rs
  modified:
    - src-tauri/src/commands.rs
    - src-tauri/src/lib.rs
    - src/types/provider.ts
    - src/lib/tauri/config.ts
    - src/lib/tauri/index.ts
decisions:
  - D-51 paste parser as single Rust module + 3 detectors (cURL -> JSON -> Python)
  - Rust regex has no backreferences — use two quote-keyed patterns for -d payload
  - Standalone sidecar crate used to run tests (the blade crate cannot link test binaries in this WSL env — pre-existing system-lib gap, see Deferred Issues)
metrics:
  duration_minutes: 30
  tasks_completed: 2
  files_touched: 6
  tests_added: 19
  completed_at: 2026-04-20T16:16:10Z
requirements:
  - PROV-01
  - PROV-02
  - PROV-03
---

# Phase 11 Plan 01: Provider Paste Parser Substrate Summary

Rust paste parser + `parse_provider_paste` Tauri command + 19 unit tests + typed TS wrapper — Wave 0 substrate that unblocks every Phase 11 UI surface.

## What was built

### 1. Pure-Rust parser module (`src-tauri/src/provider_paste_parser.rs`, 759 lines)

Three-detector pipeline keyed off leading-token disambiguation:

- **cURL detector** — regex set captures `https?://…` URL, `Authorization: Bearer`, `x-api-key`, `-u :key`, `?key=` query param, and `-d '{…}'` / `-d "{…}"` payloads (two quote-keyed regexes because rust-regex has no backreferences). Handles `\<newline>` continuations via pre-processing. Drops bash `$VAR` substitutions silently so `$PAYLOAD` doesn't crash detection.
- **JSON detector** — `serde_json::from_str::<Value>` + `.get()` chain accepts both snake_case (`api_key`, `base_url`, `api_base`) and camelCase (`apiKey`, `baseURL`). Explicit `"provider"` key overrides hostname heuristic per RESEARCH.md J2.
- **Python-SDK detector** — `(?m)^…(OpenAI|Anthropic|Groq|Client)\s*\(` regex with optional `module.Class` form; `api_key=` / `base_url=` / `model=` kwargs captured independently. Custom `base_url` pointing at non-canonical host downgrades provider_guess to `custom` per Sample P3.

All three detectors return a `ParsedProviderConfig { provider_guess, base_url, api_key, model, headers }`. Hostname-to-provider table matches RESEARCH.md §Provider Guess Heuristics verbatim (14 rows).

### 2. Tauri command registration (`commands.rs`, `lib.rs`)

```rust
#[tauri::command]
pub fn parse_provider_paste(
    input: String,
) -> Result<crate::provider_paste_parser::ParsedProviderConfig, String> {
    crate::provider_paste_parser::parse(&input)
}
```

Registered as `commands::parse_provider_paste` in `generate_handler![]` at `lib.rs:616`, alphabetically adjacent to the existing `commands::test_provider`. No duplicate-name collision (verified via grep).

### 3. Frontend mirror (`src/types/provider.ts`, `src/lib/tauri/config.ts`, `src/lib/tauri/index.ts`)

```ts
export interface ParsedProviderConfig {
  provider_guess: ProviderGuess;  // 'openai' | ... | 'custom'
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  headers: Record<string, string>;
}

export function parseProviderPaste(input: string): Promise<ParsedProviderConfig>;
```

`invokeTyped` wrapper with snake_case `input` key at the IPC boundary (matches Rust `input: String` param). Barrel-exported from `@/lib/tauri` so onboarding / Settings can `import { parseProviderPaste } from '@/lib/tauri'`.

## Test Coverage (19 cases)

| ID in RESEARCH.md | Test function | Assertion |
|-------------------|---------------|-----------|
| C1 | `test_curl_openai_single_line` | provider=openai, base_url=/v1, api_key=sk-proj-abc123, model=gpt-4o |
| C2 | `test_curl_anthropic_multiline_x_api_key` | provider=anthropic, x-api-key captured, anthropic-version header preserved |
| C3 | `test_curl_groq` | provider=groq, base_url=/openai/v1, model=llama-3.3-70b-versatile |
| C4 | `test_curl_openrouter` | provider=openrouter, model=meta-llama/llama-3.3-70b-instruct:free |
| C5 | `test_curl_gemini_query_key` | provider=gemini, api_key from `?key=`, model from URL path `/models/X:generateContent` |
| C6 | `test_curl_custom_deepseek` | provider=custom, base_url=/v1, model=deepseek-chat |
| C7 | `test_curl_localhost_ollama` | provider=ollama (localhost heuristic), api_key=None |
| E1 | `test_curl_payload_variable_edge` | `$PAYLOAD` + `$OPENAI_API_KEY` — no panic, api_key=None, model=None |
| J1 | `test_json_litellm_blob` | LiteLLM-style `api_base` + `api_key` |
| J2 | `test_json_explicit_provider_camel` | Explicit `provider` overrides hostname; `apiKey` + `baseURL` variants |
| J3 | `test_json_minimal` | Provider + key only; model stays None |
| P1 | `test_python_openai_constructor` | `OpenAI(api_key=…)` + `.create(model=…)` |
| P2 | `test_python_anthropic_module_dot_class` | `anthropic.Anthropic(…)` module-qualified form |
| P3 | `test_python_openai_custom_base_url` | Custom base_url downgrades provider_guess to custom |
| N1 | `test_negative_github_curl` | Non-LLM cURL returns Err |
| N3 | `test_negative_json_no_signals` | Unrelated JSON returns Err |
| N4 | `test_negative_python_no_sdk` | Plain print() returns Err |
| — | `test_non_ascii_safe_slice` | `日本語…` input uses safe_slice, no panic |
| — | `test_empty_input` | Empty paste returns `Err("Paste is empty")` |

All 19 tests verified passing via a standalone sidecar crate (see Deferred Issues §1 below for why the blade crate's own test runner can't link in this environment).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rust regex has no backreferences**

- **Found during:** Task 1 first test run (sidecar crate)
- **Issue:** Plan specified `-d '…'` payload regex with `(['"])...\1` backreference to match the same quote on both sides; rust-regex crate does not support backreferences.
- **Fix:** Split into two patterns: `re_curl_data_payload_single` (single-quoted) and `re_curl_data_payload_double` (double-quoted). Detector calls them in order, taking first match.
- **Files modified:** `src-tauri/src/provider_paste_parser.rs`
- **Commit:** `15b4cee`

### Plan specified vs. shipped (minor shape differences)

- Plan `<action>` §4 described a single `re_curl_data_payload` function; shipped two quote-keyed functions (see Auto-fixed #1). Functional behavior identical.
- Plan acceptance criterion asked for a `canonical_base_url` helper that trims `/chat/completions` tails to `/v1` — shipped verbatim, with a per-provider switch so Gemini keeps `/v1beta`, Groq keeps `/openai/v1`, OpenRouter keeps `/api/v1`. Documented inline.

### Threat-model compliance

- **T-11-02** (Information Disclosure via error messages): every `Err(format!(...))` uses `crate::safe_slice(input, 40)` — no full-paste echo. Verified by `test_non_ascii_safe_slice` + grep-audit (0 occurrences of `&input[..n]`).
- **T-11-05** (non-ASCII panic): `safe_slice` used throughout; `test_non_ascii_safe_slice` asserts no panic.
- **T-11-06** (command name collision): grep confirmed `parse_provider_paste` is unique across all `#[tauri::command]` sites.

## Deferred Issues

### 1. Blade crate test binary fails to link in this WSL environment

Root cause: the Linux build box is missing `libgbm-dev` and `libxdo-dev` system packages. `cargo build --lib` succeeds, `cargo check --lib --tests` succeeds, but `cargo test --lib` fails at the linker step because it assembles a test binary that pulls in tauri/enigo/xcap transitively, which need those system libs.

Impact: **zero**. Parser logic is pure-Rust, pure functions with no tauri dependency. Verified via a standalone sidecar crate (`/tmp/ppp_test`, now removed) that:
1. Copied `provider_paste_parser.rs` verbatim
2. Shimmed `crate::safe_slice` with an identical local `safe_slice` fn
3. Ran `cargo test` — 19 passed; 0 failed; 0 ignored

This is pre-existing environment setup missing from the build box, not a code issue. Downstream Wave-1 executors running on CI (where the apt block in `.github/workflows/build.yml` installs these) will observe the 19 tests passing directly.

No `deferred-items.md` entry filed because this is environment-specific, not repo-level.

### 2. Probe / capability work (Plan 11-02)

Out of scope for this plan. `ParsedProviderConfig` contains everything Plan 11-02 needs to construct a probe call. No coordination required.

## Self-Check: PASSED

Verified files and commits exist:
- `src-tauri/src/provider_paste_parser.rs` — 759 lines, 19 tests, compiles
- `src-tauri/src/commands.rs` — `parse_provider_paste` command added at line 2246
- `src-tauri/src/lib.rs` — `mod provider_paste_parser;` (line 90) + `commands::parse_provider_paste,` (line 616)
- `src/types/provider.ts` — `ParsedProviderConfig` + `ProviderGuess` exported (line 80)
- `src/lib/tauri/config.ts` — `parseProviderPaste` wrapper (line 91)
- `src/lib/tauri/index.ts` — `parseProviderPaste` re-exported (line 24)
- Commit `15b4cee` — Task 1 (parser + tests)
- Commit `3d8f548` — Task 2 (Tauri command + TS wrapper)
- `cargo check --lib` — exit 0
- `npx tsc --noEmit` — exit 0
- Grep audit: 0 `&input[..n]`, 0 `loop ` in parser, exactly 1 `#[tauri::command] ... parse_provider_paste` across repo
