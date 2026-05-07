---
phase: 36-context-intelligence
plan: 8
subsystem: intelligence-frontend-and-brain-receiver
tags: [INTEL-06, frontend, brain.rs, anchor-injection, AnchorChip]
requires:
  - 36-01 (IntelligenceConfig substrate — context_anchor_enabled toggle)
  - 36-02 (reindex_symbol_graph Tauri command registered)
  - 36-05 (reload_capability_registry + get_active_model_capabilities Tauri commands registered)
  - 36-07 (commands.rs prelude populated anchor_injections)
provides:
  - "brain.rs::build_system_prompt_inner anchor_injections receiver (priority -1, bypasses Phase 32 gates)"
  - "build_system_prompt_for_model passes anchor_injections through (single new param)"
  - "src/features/chat/AnchorChip.tsx component + renderWithAnchors helper"
  - "src/features/chat/MessageBubble.tsx anchor-aware text rendering for committed user messages"
  - "src/lib/tauri/intelligence.ts — reindexSymbolGraph + reloadCapabilityRegistry + getActiveModelCapabilities + ReindexStats + ModelCapabilities"
affects:
  - "Per-turn LAST_BREAKDOWN now includes anchor_screen / anchor_file / anchor_memory rows"
  - "DoctorPane Context Budget panel (Plan 32-06) auto-renders new rows when anchors used"
tech-stack:
  added:
    - "no new deps — pure React + existing invokeTyped wrapper"
  patterns:
    - "design-token CSS-var fallbacks (CostMeterChip-style)"
    - "regex mirror-the-backend (\\B word-boundary with anchor_parser.rs)"
    - "BladeConfig sub-struct passthrough via [k: string]: unknown index signature"
key-files:
  created:
    - "src/features/chat/AnchorChip.tsx (177 lines)"
  modified:
    - "src-tauri/src/brain.rs (+205 / -21 — receiver body, param threading, 3 new tests)"
    - "src-tauri/src/commands.rs (post-build append swapped for pass-through)"
    - "src/lib/tauri/intelligence.ts (+83 — three wrappers + two interfaces)"
    - "src/features/chat/MessageBubble.tsx (+45 / -2 — useConfig + renderWithAnchors integration)"
decisions:
  - "Anchor receiver lives at priority -1 inside build_system_prompt_inner (above BLADE.md). Pushing into `parts` keeps SYSTEM_PROMPT_CHAR_BUDGET enforcement consistent — anchored content lands in the protected prefix that enforce_budget never pops."
  - "commands.rs swapped from 36-07's post-build append to a pass-through param. Single source of truth (brain.rs); record_section labels register exactly once per turn."
  - "AnchorChip rendering scoped to MessageBubble (not InputBar). Per project_chat_streaming_contract, the in-progress assistant streaming bubble must remain string-append-only — committed user messages are the safe insertion point."
  - "useConfig accessor reused — IntelligenceConfig flows via get_config's BladeConfig serde passthrough (verified at runtime: `[k: string]: unknown` index signature on the TS BladeConfig type covers it). Default-to-true matches Rust default_context_anchor_enabled."
  - "No icon library dependency. Three-letter glyphs (SCR / FIL / MEM) match the design-system-primitives discipline observed across other chat surfaces (CostMeterChip, JarvisPill)."
  - "Empty anchor pairs are skipped (no record_section call) — avoids zero-char noise rows in DoctorPane while still capturing real injections."
metrics:
  duration_min: 35
  tasks_completed: 3
  files_modified: 4
  files_created: 1
  tests_added: 3
  commits: 3
  completed: 2026-05-07
---

# Phase 36 Plan 36-08: INTEL-06 Frontend AnchorChip + brain.rs Receiver Summary

INTEL-06's frontend surface plus the brain.rs receiver that completes the
anchor-injection contract started in Plan 36-07. brain.rs now accepts
`anchor_injections: &[(String, String)]` and prepends each pair to the
prompt accumulator at priority -1, recording via `record_section` with the
labels `anchor_screen` / `anchor_file` / `anchor_memory`. AnchorChip.tsx
renders an inline chip per anchor variant in committed user messages,
gated by `config.intelligence.context_anchor_enabled` (mirroring the
backend toggle). Three new typed Tauri wrappers expose the Plan 36-02 +
36-05 commands to the frontend without breaking the no-raw-tauri rule.

## Commits

| # | Hash      | Title |
| - | --------- | --------------------------------------------------------------------- |
| 1 | `14197cf` | `feat(36-08): wire anchor_injections receiver into brain.rs (INTEL-06)` |
| 2 | `5a02b87` | `feat(36-08): add typed Phase 36 intelligence Tauri wrappers (INTEL-01/04)` |
| 3 | `96335a8` | `feat(36-08): inline AnchorChip rendering in committed user messages (INTEL-06)` |

## Verification Status

| Gate | Status | Notes |
| ---- | ------ | ----- |
| `cargo check` | green | 2m 20s; 29 pre-existing dead-code warnings unrelated to this plan |
| `cargo test --lib brain::tests` | green | 34/34 passed; 3 new INTEL-06 tests included |
| `cargo test --lib brain::tests::phase36_intel_06` | green | 3/3 passed in 4.84s |
| `npx tsc --noEmit` | green | zero output / zero errors |
| Runtime UAT | deferred to Plan 36-09 | per plan §Step E + the operator-deferred-UAT pattern |

## What Landed Per Task

### Task 1 — brain.rs anchor_injections receiver

- New trailing param on `build_system_prompt_inner` and `build_system_prompt_for_model`: `anchor_injections: &[(String, String)]`.
- Two thin wrappers (`build_system_prompt`, `build_system_prompt_with_recall`) pass `&[]`.
- All 11 existing test call sites updated to pass `&[]`.
- New body at top of `build_system_prompt_inner` (between `clear_section_accumulator()` and the BLADE.md push):
  ```rust
  for (label, content) in anchor_injections {
      if content.is_empty() { continue; }
      parts.push(content.clone());
      record_section(label, content.len());
  }
  ```
- commands.rs swap: removed the 36-07 post-build append block (lines 1425-1441) and threaded `&anchor_injections` through `build_system_prompt_for_model`. `mut` retained on `system_prompt` because downstream sections still mutate it.
- Three new tests, all using `BREAKDOWN_TEST_LOCK`:
  - `phase36_intel_06_anchor_injections_bypass_gating` — non-keyword query, three injections, asserts all three payload markers appear in prompt + all three labels register chars > 0 in `LAST_BREAKDOWN`.
  - `phase36_intel_06_anchor_injections_empty_is_noop` — empty slice → no anchor_* rows recorded.
  - `phase36_intel_06_anchor_injections_skip_empty_content` — empty-string content is skipped entirely (not recorded with 0 chars), but non-empty siblings still inject.

### Task 2 — src/lib/tauri/intelligence.ts wrappers

- Appended (not replaced — file was an existing Phase 14 wrapper file).
- Three exported functions:
  - `reindexSymbolGraph(projectRoot: string): Promise<ReindexStats>` (snake-cases the arg key per `_base.ts` `toCamelArgs` → tauri receives `projectRoot`).
  - `reloadCapabilityRegistry(): Promise<number>` (Rust `u32` → JSON number → TS number).
  - `getActiveModelCapabilities(): Promise<ModelCapabilities | null>`.
- Two exported interfaces matching backend serde shapes verbatim (snake_case).
- Verified Tauri command names match `lib.rs:1490-1493` (registered) and `intelligence/mod.rs:57/67/85` (handler signatures).

### Task 3 — AnchorChip.tsx + MessageBubble integration

- AnchorChip.tsx (NEW): pure component with three variants. Inline styles use design-token CSS vars (`--accent-bg`, `--accent-fg`, `--accent-border`) with conservative `rgba()` fallbacks — matches CostMeterChip pattern in InputBar.tsx. No icon library dependency; three-letter glyphs (SCR / FIL / MEM) for type signal. `data-anchor-variant` exposed for downstream theme overrides.
- `renderWithAnchors(text, enabled)` exported from the same file: walks `text` once with the unified backend-mirroring regex `\B@(?:(screen)\b|file:(\S+)|memory:(\S+))`. Returns `ReactNode[]` — empty matches yield text-only output. When `enabled = false`, short-circuits to `[text]` (CTX-07 escape hatch parity).
- MessageBubble.tsx integration:
  - Imports `useConfig` from `@/lib/context` and `renderWithAnchors` from `./AnchorChip`.
  - Reads `intelligence.context_anchor_enabled` via the `[k: string]: unknown` BladeConfig index signature; defaults to `true` if absent.
  - Routes through `renderWithAnchors` only for non-streaming user messages (`!streaming && msg.role === 'user'`). Assistant + system + streaming bubbles render verbatim — protects project_chat_streaming_contract.
  - Threat T-36-45 mitigated: `payload` flows through standard JSX children; React auto-escaping handles script-shaped paths.

## Discoveries / Deviations from Plan

- **Plan's "ChatComposer.tsx" doesn't exist in this codebase.** The chat input lives in `InputBar.tsx`; rendering lives in `MessageBubble.tsx` / `MessageList.tsx`. Plan acknowledged this with grep-discovery commentary. Render integration landed in `MessageBubble.tsx` (post-commit, the safe insertion point) — not in InputBar — preserving project_chat_streaming_contract.
- **Plan envisioned `anchor_injections` flowing into `build_system_prompt_inner` from Plan 36-07.** Plan 36-07 actually post-appended after `build_system_prompt_for_model` returned. Plan 36-08 swapped to the cleaner pass-through (single source of truth, single record_section call).
- **`get_config` already serializes `intelligence` sub-struct** (verified: BladeConfig has `#[derive(Serialize)]` and `IntelligenceConfig` does too). No new Tauri command needed for the frontend to read `context_anchor_enabled` — the existing `useConfig` hook covers it via the index-signature passthrough.
- **No new TS unit test** — the project doesn't ship Vitest/Jest for `src/`. Static gates (tsc) cover Plan 36-08; the runtime UAT in Plan 36-09 is the authoritative behavior check per CLAUDE.md Verification Protocol.
- **Pre-existing 188 worktree-level deletions in `.planning/phases/`** were intentionally NOT swept into any commit. Each commit staged only the specific files touched by that task (`git add <path>` — never `git add -A`).

## Threat Model Coverage

All five threats from the plan's STRIDE register are mitigated or accepted:

| Threat ID | Disposition | Mitigation Status |
|-----------|-------------|-------------------|
| T-36-45   | mitigate    | AnchorChip renders payload via standard JSX children (React auto-escaping) — no className interpolation, no markup bypass |
| T-36-46   | mitigate    | `renderWithAnchors` regex has no zero-width alternatives; every alternative consumes `\S+` or `\b screen` — `matchAll` terminates on bounded text |
| T-36-47   | accept      | User typed the path; rendering is consent (per plan) |
| T-36-48   | mitigate    | Frontend regex `\B@(?:(screen)\b\|file:(\S+)\|memory:(\S+))` mirrors backend `anchor_parser.rs::ANCHOR_RE` — Plan 36-09 UAT will catch drift |
| T-36-49   | accept      | get_active_model_capabilities exposes pricing per CONTEXT lock §INTEL-05 |

## Self-Check: PASSED

Per the executor self-check protocol:

- `[x] FOUND: src/features/chat/AnchorChip.tsx`
- `[x] FOUND: 14197cf` (brain.rs receiver)
- `[x] FOUND: 5a02b87` (intelligence.ts wrappers)
- `[x] FOUND: 96335a8` (AnchorChip + MessageBubble)
- `[x] cargo test phase36_intel_06 — 3/3 green`
- `[x] tsc --noEmit — clean`

## Streaming Contract Note

Per MEMORY.md `project_chat_streaming_contract`: every Rust streaming branch must
emit `blade_message_start` before `chat_token`. This plan does not touch the
streaming path — anchor injections are appended to the system prompt before any
provider call, and the frontend renderer runs only on committed user messages
(role='user', !streaming). The streaming-bubble path is unchanged.

## Hand-off to Plan 36-09

Plan 36-09 (panic regression + UAT) will:

1. Add a Rust regression test that forces a panic inside `anchor_parser::extract_anchors` and asserts the chat path remains responsive (catch_unwind in commands.rs already handles this — Plan 36-07; this is the v1.1 lesson regression fixture).
2. Run the runtime UAT at 1280×800 + 1100×700: send `@screen`, `@file:src/main.rs`, `@memory:project setup` and screenshot the chip rendering to `docs/testing ss/phase-36-anchor-chips.png` per `/blade-uat`.
3. Verify the per-turn DoctorPane Context Budget panel surfaces `anchor_screen` / `anchor_file` / `anchor_memory` rows when anchors are typed.
