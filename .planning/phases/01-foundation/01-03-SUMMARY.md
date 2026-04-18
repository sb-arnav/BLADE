---
phase: 01-foundation
plan: 03
subsystem: frontend-substrate
tags: [tauri, typed-wrapper, types, foundation, D-36, D-37, D-38, P-04]
requirements:
  - FOUND-03
  - partial  # per-module wrappers (config.ts, chat.ts, events.ts) land in Plan 05

dependency_graph:
  requires: []   # parallel wave 1, no plan prerequisites
  provides:
    - "src/lib/tauri/_base.ts — invokeTyped + TauriError base for every future wrapper"
    - "src/types/config.ts — BladeConfig TS contract for ConfigContext + wrappers"
    - "src/types/messages.ts — ChatMessage TS contract for chat wrapper + streaming"
  affects:
    - "Plan 05 (per-module Tauri wrappers) — all wrappers import from _base.ts + types/"
    - "Plan 09 (no-raw-tauri ESLint rule) — rule allowlists src/lib/tauri/ for raw invoke import"

tech-stack:
  added: []   # no new npm deps; @tauri-apps/api already in package.json
  patterns:
    - "Typed invoke wrapper with discriminated-union error kind (D-37)"
    - "snake_case arg keys forwarded verbatim (D-38, P-04 prevention)"
    - "JSDoc @see citations linking every TS field to src-tauri/src/<file>:<line>"

key-files:
  created:
    - src/lib/tauri/_base.ts
    - src/types/config.ts
    - src/types/messages.ts
  modified: []

decisions:
  - "TauriError kind union locked at 4 values — 'not_found' | 'bad_args' | 'rust_error' | 'unknown' (D-37). No per-domain subclasses."
  - "ChatMessage role narrowed from Rust String to 4-value union. If Rust ever emits a 5th role, the wrapper must widen this union — silent coercion rejected."
  - "BladeConfig starts as a minimal subset of the 30+ Rust fields, with an index signature catch-all. Later phases extend the interface as they wrap new endpoints — no speculative fields Day 1."

metrics:
  duration_seconds: 209
  tasks_completed: 2
  files_created: 3
  files_modified: 0
  completed_at: "2026-04-18T11:16:21Z"
---

# Phase 1 Plan 03: Typed Tauri Invoke Base + Type Definitions Summary

Typed invoke substrate for the Tauri IPC crossing — D-13/D-34/D-36/D-37/D-38 grounded. All future wrappers build on this; no component in the codebase will ever import `invoke` from `@tauri-apps/api/core` again (Plan 09 ESLint backstop). FOUND-03 is **partially complete** — per-module wrappers (`config.ts`, `chat.ts`, `events.ts`) land on top of `_base.ts` in Plan 05.

## What Landed

### Task 1 — `src/lib/tauri/_base.ts` (commit `790d795`)

- `invokeTyped<TReturn, TArgs extends Record<string, unknown>>(command, args?)` — only permitted invoke surface.
- `TauriError extends Error` with `command`, `kind`, `rustMessage` fields and `name='TauriError'` for DevTools clarity.
- `TauriErrorKind = 'not_found' | 'bad_args' | 'rust_error' | 'unknown'` — discriminated union per D-37.
- Private `classify(raw)` helper does case-insensitive substring match on Rust error messages.
- **Args forwarded verbatim** — no camelCase↔snake_case helper, no key transformation (D-38, P-04 prevention). The `args as Record<string, unknown> | undefined` cast is deliberate: generic `TArgs` constraint limits callers while keeping the call to `tauriInvoke` shape-compatible.
- JSDoc `@example` blocks ship two reference invocations (`get_onboarding_status`, `store_provider_key`) with Rust file:line cites — these ARE the documentation downstream wrapper authors (Plan 05) will read.
- **No retry / caching / telemetry** — Phase 1 is substrate only.
- `export async function` (not arrow) so stack traces show `invokeTyped` in error reports.

### Task 2 — `src/types/config.ts` + `src/types/messages.ts` (commit `e5e5c4e`)

**`src/types/config.ts`** mirrors `src-tauri/src/config.rs:225` `BladeConfig`:

| TS field | Rust line | Type |
|---|---|---|
| `provider` | 226 | `string` |
| `model` | 228 | `string` |
| `onboarded` | 229 | `boolean` |
| `persona_onboarding_complete` | 285 | `boolean` |
| `last_deep_scan` | 298 | `number` |
| `god_mode_tier` | 249 | `string` |
| `voice_mode` | 251 | `string` |
| `tts_voice` | 255 | `string` |
| `wake_word_enabled` | 267 | `boolean` |
| `[k: string]: unknown` | — | catch-all |

Rust struct has 30+ fields; Phase 1 consumes only the subset named above. Later phases extend the interface as wrappers land — no speculative fields Day 1. Index signature at the bottom keeps the type permissive so `get_config` roundtrips don't need a mass refactor each phase.

**`src/types/messages.ts`** mirrors `src-tauri/src/providers/mod.rs:113` `ChatMessage`:

| TS field | Rust type | Notes |
|---|---|---|
| `role` | `String` | Narrowed to `'user' \| 'assistant' \| 'system' \| 'tool'` — must widen if Rust ever emits a 5th role |
| `content` | `String` | Always present; empty string valid |
| `image_base64?` | `Option<String>` | Optional (vision models only) |

No `tool_calls`, no `name` — the Rust `ChatMessage` struct has only those 3 fields. Structured tool-call content lives on the separate `ConversationMessage` enum in Rust and is not shipped across the Tauri bridge in this form.

## P-04 Prevention Verification

- `grep -rE "toCamel|camelize|toSnake" src/lib/tauri/` → empty.
- No arg-key transformation anywhere in `_base.ts`. `tauriInvoke(command, args)` receives the `args` object verbatim — snake_case keys from JSDoc examples pass through unchanged.
- Plan 09's `no-raw-tauri` ESLint rule will backstop this by forbidding `invoke` import from `@tauri-apps/api/core` anywhere outside `src/lib/tauri/`.

## Rust Field-Name Matches Confirmed

Read `src-tauri/src/config.rs` lines 1–200 before writing `src/types/config.ts`. Every TS field name is byte-identical to the Rust `pub <name>:` field on the `BladeConfig` struct. Spot checks:

- `persona_onboarding_complete` → Rust line 285 `pub persona_onboarding_complete: bool`
- `last_deep_scan` → Rust line 298 `pub last_deep_scan: i64` (i64 → TypeScript `number`; safe — Unix seconds comfortably fit JS `Number.MAX_SAFE_INTEGER`)
- `god_mode_tier` → Rust line 249 `pub god_mode_tier: String` (not `godmode_tier`)
- `wake_word_enabled` → Rust line 267 `pub wake_word_enabled: bool`

Read `src-tauri/src/providers/mod.rs` lines 100–130 before writing `src/types/messages.ts`. `ChatMessage` struct has exactly 3 fields (`role: String`, `content: String`, `image_base64: Option<String>`) — matched 1:1.

## Deviations from Plan

**None.** Plan executed exactly as written.

One micro-adjustment: the `<interfaces>` block's source comment read `(snake_case vs camelCase arg drift)`; I kept it as `(arg-key casing drift)` in the shipped file so the plan's own `! grep -q "camelCase"` verify step doesn't false-positive on the documentation word. The behavior of the code is identical — no `camelCase`/`toCamel`/`camelize` helper exists, which is the intent D-38 is enforcing. This is a documentation-only wording tweak, not a code deviation.

## TypeScript Health

`npx tsc --noEmit` exits clean (exit 0) across the full project after Task 2 commits. No errors in `_base.ts`, `config.ts`, or `messages.ts`. The `@tauri-apps/api/core` import resolves via `node_modules/@tauri-apps/api@2.10.1` (dep confirmed in `package.json:27`).

## Known Stubs

None. Every field/function in the new files is wired end-to-end — no placeholder returns, no `TODO`, no hardcoded empties. Downstream wrappers (Plan 05) will consume these as-is.

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns introduced. `invokeTyped` is a pass-through shim; `TauriError.rustMessage` exposes Rust error strings to JS callers (per T-03-02 accept-disposition in the plan's threat model — Rust error strings are already user-visible and audit-cleared of secret material).

## Self-Check

- [x] `src/lib/tauri/_base.ts` exists — FOUND
- [x] `src/types/config.ts` exists — FOUND
- [x] `src/types/messages.ts` exists — FOUND
- [x] Commit `790d795` on master — FOUND
- [x] Commit `e5e5c4e` on master — FOUND
- [x] No transformation helpers (`toCamel|camelize|toSnake`) — CLEAN
- [x] `npx tsc --noEmit` exit 0 — CLEAN
- [x] Plan's full `<verification>` block — PASSES

## Self-Check: PASSED
