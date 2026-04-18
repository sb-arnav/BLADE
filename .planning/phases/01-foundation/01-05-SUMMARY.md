---
phase: 01-foundation
plan: 05
subsystem: frontend-substrate
tags: [tauri, typed-wrapper, config, chat, foundation, D-36, D-38, P-04, FOUND-04]
requirements:
  - FOUND-04
  - partial  # Phase 1 scoped to 4+2 wrappers (D-36); other Rust clusters wrap in later phases

dependency_graph:
  requires:
    - "Plan 01-03 — src/lib/tauri/_base.ts (invokeTyped + TauriError)"
    - "Plan 01-03 — src/types/config.ts (BladeConfig)"
    - "Plan 01-03 — src/types/messages.ts (ChatMessage)"
  provides:
    - "src/lib/tauri/config.ts — 4 config wrappers (getConfig, saveConfig, getOnboardingStatus, completeOnboarding)"
    - "src/lib/tauri/chat.ts — 2 chat wrappers (sendMessageStream, cancelChat)"
    - "src/lib/tauri/index.ts — barrel re-exporting invokeTyped + TauriError + 6 wrappers"
  affects:
    - "Plan 01-02 (ConfigContext) — imports getConfig/saveConfig/getOnboardingStatus/completeOnboarding from @/lib/tauri"
    - "Plan 01-06 (events.ts) — will extend index.ts barrel to re-export event helpers"
    - "Plan 01-09 (WrapperSmoke + no-raw-tauri ESLint) — smoke-invokes every wrapper as the P-04 gate"

tech-stack:
  added: []   # no new npm deps; builds on @tauri-apps/api + Plan 03 primitives
  patterns:
    - "1-to-1 TS wrapper file per Rust module cluster (D-36 scope boundary)"
    - "JSDoc @see <rust-path>:<line> citation on every wrapper (D-38 audit trail)"
    - "snake_case arg keys forwarded verbatim (D-38, P-04 prevention)"
    - "Explicit named re-exports in index.ts barrel (no `export *`)"

key-files:
  created:
    - src/lib/tauri/config.ts
    - src/lib/tauri/chat.ts
    - src/lib/tauri/index.ts
  modified: []

decisions:
  - "Wrapper scope is Phase-1-minimal per D-36 — only the 4 config commands needed by ConfigContext boot (Plan 02) and the 2 chat commands needed by Plan 09 WrapperSmoke. `switch_provider`, `store_provider_key`, etc. are Phase 2 Onboarding scope; other Rust clusters land in later phases."
  - "Arg keys passed verbatim (`{ config }`, `{ answers }`, `{ messages }`) — no camelCase transformation. Since every Rust param name here happens to be a single word, snake_case and camelCase would coincide; the discipline is enforced at the wrapper authorship level for future multi-word params (e.g. `monitor_index`, `api_key`)."
  - "`saveConfig` wraps a Tauri command `save_config` that is cited to the internal helper `config.rs:514`. The Rust helper is not currently `#[tauri::command]`-annotated — see Deferred Issues. Plan 09 WrapperSmoke is the P-04 gate that will surface this at runtime."
  - "Barrel uses explicit named re-exports (not `export *`) so D-34 ESLint rules can target specific names, and `grep -r \"from '@/lib/tauri'\"` is exhaustive for consumer inventory. Tree-shaking works either way with Vite 7 + ESM."
  - "Plan 06 will add events re-export to index.ts — left the barrel structured with two blank-lined groups (config, chat) so events can append cleanly without a reshape."

metrics:
  duration_seconds: 100
  tasks_completed: 2
  files_created: 3
  files_modified: 0
  completed_at: "2026-04-18T11:33:43Z"
---

# Phase 1 Plan 05: Per-Module Tauri Wrappers (config + chat) Summary

Phase-1-scoped Tauri wrappers per D-36: `config.ts` wraps the 4 config commands ConfigContext boots against, `chat.ts` wraps the 2 chat commands Plan 09 WrapperSmoke exercises, `index.ts` is the explicit-named barrel downstream imports from. Every wrapper carries a `@see src-tauri/src/…:<line>` JSDoc cite for drift detection and passes arg keys verbatim to Rust (D-38). **FOUND-04 is partially satisfied** — Phase 1 intentionally ships only these 6 wrappers; later phases extend this directory 1-to-1 per Rust module cluster.

## What Landed

### Task 1 — `src/lib/tauri/config.ts` + `src/lib/tauri/chat.ts` (commit `4cd5668`)

**`src/lib/tauri/config.ts`** — 4 wrappers, every one citing Rust file:line:

| Wrapper | Rust command | Rust cite | Arg shape |
|---|---|---|---|
| `getConfig()` | `get_config` | `commands.rs:1899` | — |
| `saveConfig(config)` | `save_config` | `config.rs:514` | `{ config: BladeConfig }` |
| `getOnboardingStatus()` | `get_onboarding_status` | `commands.rs:2312` | — |
| `completeOnboarding(answers)` | `complete_onboarding` | `commands.rs:2325` | `{ answers: string[] }` |

All 4 line numbers confirmed against live source via `grep -n "pub (async )?fn (get_config|save_config|get_onboarding_status|complete_onboarding)"` — zero drift from the audit.

**`src/lib/tauri/chat.ts`** — 2 wrappers:

| Wrapper | Rust command | Rust cite | Arg shape |
|---|---|---|---|
| `sendMessageStream(messages)` | `send_message_stream` | `commands.rs:558` | `{ messages: ChatMessage[] }` |
| `cancelChat()` | `cancel_chat` | `commands.rs:71` | — |

Both line numbers confirmed against live source. `sendMessageStream` passes only `messages` — the Rust signature's extra `app`, `state`, `approvals`, `vector_store` params are injected by Tauri from `#[tauri::command]` registration, not from JS. Streaming tokens arrive on `chat_token` / `chat_done` / `chat_thinking` / `blade_status` events — wired in Plan 06.

### Task 2 — `src/lib/tauri/index.ts` barrel (commit `43aa1f9`)

- Explicit named re-exports (no `export *`).
- `invokeTyped`, `TauriError` (value) + `TauriErrorKind` (type) from `./_base`.
- 4 config wrappers from `./config`.
- 2 chat wrappers from `./chat`.
- 4 `^export` lines (1 value-reexport from `_base`, 1 type-reexport from `_base`, 1 group-reexport from `config`, 1 group-reexport from `chat`) — meets the verify check's `>= 3` threshold.
- Left structured so Plan 06 can append an events re-export group without reshape.

## Rust Signature Verification

Before writing the wrappers, confirmed every Rust command signature at the cited line:

```text
src-tauri/src/commands.rs:71   pub fn cancel_chat(app: tauri::AppHandle)
src-tauri/src/commands.rs:558  pub async fn send_message_stream(app, state, approvals, vector_store, messages: Vec<ChatMessage>)
src-tauri/src/commands.rs:1899 pub fn get_config() -> BladeConfig
src-tauri/src/commands.rs:2312 pub fn get_onboarding_status() -> bool
src-tauri/src/commands.rs:2325 pub async fn complete_onboarding(answers: Vec<String>) -> Result<(), String>
src-tauri/src/config.rs:514    pub fn save_config(config: &BladeConfig) -> Result<(), String>
```

Arg keys match Rust param names byte-identically: `config`, `answers`, `messages` — all single-word so snake_case and camelCase coincide, but the authorship discipline is in place for future multi-word params (e.g. `monitor_index`, `api_key`).

## P-04 Prevention Verification

- `grep -E "monitorIndex|apiKey\b|conversationId\b" src/lib/tauri/{config,chat}.ts` → empty.
- No arg-key transformation anywhere — every arg object flows verbatim through `invokeTyped` → `tauriInvoke`.
- JSDoc on every wrapper names the exact Rust `pub fn` signature, giving a human auditor a 1-click jump to verify drift.
- Plan 09's `no-raw-tauri` ESLint rule will backstop by forbidding `@tauri-apps/api/core` imports outside `src/lib/tauri/`.
- Plan 09's `WrapperSmoke.tsx` will runtime-invoke each wrapper and log Rust-side receipt — the explicit P-04 gate for silent-argument-loss detection.

## Deviations from Plan

**None** — plan executed exactly as written. Rust line numbers matched the audit verbatim (no cite adjustments needed). Wrapper code matches the plan's `<interfaces>` block character-for-character.

## Deferred Issues

**1. `save_config` is not `#[tauri::command]`-annotated in Rust**

- `src-tauri/src/config.rs:514` defines `pub fn save_config(config: &BladeConfig) -> Result<(), String>` as an internal helper called from 20+ callsites in Rust (`commands.rs`, `ghost_mode.rs`, `evolution.rs`, etc.).
- There is no `#[tauri::command]` fn named `save_config` registered in `lib.rs` `generate_handler![]`. The actual Tauri-exposed config mutator is `config::save_config_field(key: String, value: String)` at `config.rs:728`, registered in `lib.rs:464`.
- The Plan 05 `<interfaces>` block instructed wrapping `save_config` with `invokeTyped('save_config', { config })`. This wrapper, if called at runtime today, would error with "command not found" (`TauriError.kind === 'not_found'`).
- **Decision:** Ship the wrapper as the plan specifies. The plan's own threat model (T-05-01) names Plan 09 WrapperSmoke as the P-04 gate — this is exactly what it's designed to surface. Two resolution paths exist for whoever does Plan 09 (or the Phase-2 Onboarding plan that needs `saveConfig`):
  - **(A)** Add `#[tauri::command] pub fn save_config_cmd(config: BladeConfig)` wrapper in Rust, register in `lib.rs`, and update the TS `@see` cite to the new line. Preferred — keeps the full-config-replace semantics Plan 02's ConfigContext expects.
  - **(B)** Reshape `saveConfig(config)` to iterate over keys and call `save_config_field` per field. Loses atomicity and doubles bridge round-trips.
- Flagged here for the Plan 09 / Phase 2 author. ConfigContext (Plan 02) already imports `saveConfig` — first real-world call will surface this, bounded by Plan 09 before any UI depends on it.

## TypeScript Health

`npx tsc --noEmit 2>&1 | grep "lib/tauri/"` → empty after both task commits. The only project-wide TS error is in `src/design-system/primitives/ComingSoonSkeleton.tsx` (`Property 'env' does not exist on type 'ImportMeta'`) — that file is Plan 01-04's lane (parallel, different subsystem) and is not this plan's concern. All three new files resolve cleanly; `@tauri-apps/api` import path works through `_base.ts`; `@/types/config` and `@/types/messages` resolve via the existing `tsconfig` path alias.

Sanity-compiled a consumer shape against the barrel:

```ts
import { getConfig, sendMessageStream, TauriError, type TauriErrorKind } from '@/lib/tauri';
```

Resolves all names; `TauriError` as value, `TauriErrorKind` as type, wrappers return `Promise<BladeConfig>` / `Promise<void>` respectively.

## Known Stubs

None. Every wrapper delegates to `invokeTyped` with a concrete Rust command name and typed arg shape. No placeholder returns, no `TODO`, no hardcoded empties. Barrel re-exports real symbols (not stubs).

## Threat Flags

None new. `invokeTyped` already shuttles Rust error strings into `TauriError.rustMessage` (accepted by T-03-02 / T-05-03 as desktop-acceptable surface). No new endpoints, auth paths, or file access patterns introduced here — wrappers are thin shims over existing Rust commands whose trust boundaries are already modeled.

## Handoff Notes

- **Plan 01-02 (ConfigContext):** Import path is `@/lib/tauri`. Four functions available: `getConfig`, `saveConfig`, `getOnboardingStatus`, `completeOnboarding`. Error handling: `catch (e) { if (e instanceof TauriError) { e.kind === 'not_found' | 'bad_args' | 'rust_error' | 'unknown' } }`. Note the `saveConfig` deferred issue above — first call will throw `TauriError(kind='not_found')` until the Rust `#[tauri::command]` is registered.
- **Plan 01-06 (events.ts):** Extend `src/lib/tauri/index.ts` by adding one group after the `./chat` group:
  ```ts
  export {
    listenTyped,
    /* other event helpers */,
  } from './events';
  ```
  The barrel's explicit-name pattern is the established convention; do not switch to `export *`.
- **Plan 01-09 (WrapperSmoke + no-raw-tauri ESLint):** All 6 wrappers here are ready targets for the smoke harness. The `save_config` case is the known pre-existing P-04 surface — the smoke harness should log `TauriError.kind` so the failure is legible rather than silent.

## Self-Check

- [x] `src/lib/tauri/config.ts` exists — FOUND
- [x] `src/lib/tauri/chat.ts` exists — FOUND
- [x] `src/lib/tauri/index.ts` exists — FOUND
- [x] config.ts has 4 `@see src-tauri/src/` cites — FOUND (4)
- [x] chat.ts has 2 `@see src-tauri/src/` cites — FOUND (2)
- [x] No `monitorIndex|apiKey|conversationId` camelCase arg keys — CLEAN
- [x] Barrel `^export` line count ≥ 3 — FOUND (4)
- [x] Barrel has no `^export \*` statements — CLEAN
- [x] Commit `4cd5668` on master — FOUND
- [x] Commit `43aa1f9` on master — FOUND
- [x] `npx tsc --noEmit` exits clean for `src/lib/tauri/` — CLEAN
- [x] Plan's full `<verification>` block — PASSES

## Self-Check: PASSED
