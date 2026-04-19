---
phase: 06-life-os-identity
plan: 06
subsystem: frontend-identity-routes-subset-b
tags: [identity, reasoning, context-engine, sidecar, kali, wave-2]
requires:
  - Plan 06-02 (src/lib/tauri/identity.ts — 60 typed wrappers + types barrel)
  - Plan 06-02 (src/features/identity/index.tsx — 7 lazy routes)
  - Plan 06-02 (src/features/identity/identity.css — cluster base)
  - Phase 1 primitives: GlassPanel, Button, Dialog, Input, Pill, GlassSpinner
  - Phase 2 ToastContext (useToast)
  - Phase 5 Plan 05-02 status tokens (--status-running / --status-success / --status-error)
provides:
  - IDEN-05 — ReasoningView real surface (4 reasoning tools + traces list)
  - IDEN-06 — ContextEngineView real surface (assemble + score + clear cache)
  - IDEN-07 — SidecarView real surface (device table + kali pentest sub-section)
  - src/features/identity/identity-rich-b.css — scoped CSS partial for this plan
affects:
  - Closes SC-3 "Navigating to any Identity route produces a rendered surface"
    for these 3 routes. With Plan 06-05's 4 routes, all 7 Identity routes
    (SoulView, PersonaView, CharacterBible, NegotiationView, ReasoningView,
    ContextEngineView, SidecarView) have real surfaces and no 404 fallback.
  - No other-lane files modified (06-03 / 06-04 life-os lanes, 06-05 identity
    subset A lanes all disjoint per D-143).
tech-stack:
  added: []  # no new deps
  patterns:
    - D-13 no raw invoke / listen — every invoke via @/lib/tauri/identity
    - D-143 single-writer on index.tsx (this plan never touches index.tsx)
    - D-157 reasoning workshop layout — prompt + 4 tools + traces
    - D-158 context engine + sidecar + kali layout
    - D-164 CSS cluster-scoped (per-plan partial, project tokens)
    - T-06-06-01 mitigation — per-device explicit Run click + Dialog confirm on Run-all
    - T-06-06-02 acknowledgement — Kali warning banner above tool cards
    - T-06-06-04 mitigation — sidecarRunAll Dialog-confirmed
    - T-06-06-05 mitigation — contextClearCache Dialog-confirmed
key-files:
  created:
    - src/features/identity/identity-rich-b.css
  modified:
    - src/features/identity/ReasoningView.tsx  (placeholder → real surface)
    - src/features/identity/ContextEngineView.tsx  (placeholder → real surface)
    - src/features/identity/SidecarView.tsx  (placeholder → real surface)
decisions:
  - Applied the same token correction Plan 06-02 applied (--s-N / --r-md /
    --r-pill instead of plan-draft --sp-N / --radius-card / --radius-pill).
    No new divergence; inherit the project token set documented in
    src/styles/tokens.css.
  - Used a scoped CSS filename identity-rich-b.css (not an append to
    identity.css) so the file is exclusive to this plan — parallel peer
    Plan 06-05 owns identity-rich-a.css. Avoids the append-conflict risk of
    two wave-2 plans writing to the same CSS file.
  - Bundled Task 2's CSS into identity-rich-b.css during Task 1 rather than
    splitting into two CSS commits — Task 2 only appends TSX content to a
    single view file. Task 2's verify line grep `sidecar-device-table|kali-section`
    hits in the CSS created during Task 1; no verification drift.
  - For sidecar_start_server: exposed port + shared-secret inputs inside the
    Dialog (not silently derived) — the Rust signature requires both.
  - For kaliCheckTools: render the flat {toolName: bool} map + nested
    _wordlists map as a human-readable line list (installed / missing /
    present) rather than raw JSON — the dev-adjacent surface still deserves
    a legible readout.
  - For reasoningThink output: pretty-print the ReasoningTrace's steps +
    final_answer + confidence; for other tools, format the specific shape
    (decompose → numbered list; test-hypothesis → evidence-for/against
    block; socratic → Q/A pairs).
metrics:
  duration-minutes: ~10
  completed-date: 2026-04-19
  tasks-completed: 2
  commits: 2
  files-created: 1
  files-modified: 3
  lines-added: ~2266
---

# Phase 6 Plan 06-06: Identity Subset B — ReasoningView + ContextEngineView + SidecarView Summary

Replaced 3 of the 7 Identity route placeholders with real surfaces backed by Plan 06-02's typed wrappers, closing the remaining SC-3 coverage for the Identity cluster. Ran parallel to Plan 06-05 (subset A — Soul/Persona/Character/Negotiation) with zero `files_modified` overlap.

## Routes Shipped

| Route id         | Component           | Requirement | Layout anchor          |
|------------------|---------------------|-------------|------------------------|
| `reasoning`      | `ReasoningView`     | IDEN-05     | D-157                  |
| `context-engine` | `ContextEngineView` | IDEN-06     | D-158 (dev-adjacent)   |
| `sidecar`        | `SidecarView`       | IDEN-07     | D-158 (lifecycle)      |

All 3 previously rendered `<identity-placeholder>` skeletons with a "Ships in Plan 06-06" hint; now each renders a full `GlassPanel tier={1}` surface with wired invokes and testids the Plan 06-07 Playwright specs can hook.

## Surface Details

### ReasoningView (IDEN-05)

- Prompt textarea (disabled during run) + 4 tool buttons: **Think**, **Decompose**, **Test Hypothesis**, **Socratic**.
- Each button runs its respective `reasoning_engine.rs` wrapper with the current prompt:
  - Think → `reasoningThink({question})` → renders `ReasoningTrace` with final answer + step list + confidence.
  - Decompose → `reasoningDecompose(question)` → numbered sub-problem list.
  - Test Hypothesis → `reasoningTestHypothesis({hypothesis, evidence: ''})` → evidence-for / evidence-against blocks + verdict + confidence.
  - Socratic → `reasoningSocratic({question})` → Q/A pairs.
- Output card shows tool label pill + `{durationMs} ms` + timestamp + body (pre-wrap monospace).
- Recent traces: `reasoningGetTraces(20)` on mount → collapsible rows (click or Enter/Space to expand). Think refreshes the list post-run.
- `data-testid` surface: `reasoning-view-root`, `reasoning-tool-output`, `reasoning-trace-row` (with `data-trace-id` + `data-expanded`).

### ContextEngineView (IDEN-06)

- Three cards: **Assemble** / **Score a chunk** / **Clear cache** (Dialog-confirmed per T-06-06-05).
- Assemble: query textarea → `contextAssemble({query})` → result card with:
  - Meta pills: `{total_tokens} tokens`, `{chunks.length} chunks`, optional `truncated` pill, sources_used list.
  - `<pre>` block rendering `assembled.formatted`.
  - Per-chunk grid rows: 3-decimal relevance score (range-tinted low/mid/high), first-2-line chunk body preview, source + token estimate footer.
- Score a chunk: query + chunk textareas → `contextScoreChunk({query, chunk})` → range-tinted readout.
- Clear cache: Dialog-confirm; on confirm, `contextClearCache()` + success toast + assembled-result clear.
- `data-testid`: `context-engine-root`, `context-assemble-output`.
- Dev-adjacent style per D-158 Discretion — mono fonts, `<pre>`, no empty-state illustrations.

### SidecarView (IDEN-07)

Top → bottom:

1. **Header** — title + subtitle + Start-sidecar-server button → Dialog with port + shared-secret inputs → `sidecarStartServer({port, secret})`.
2. **Register device form** — name / address / secret (password input) → `sidecarRegisterDevice(...)` → refresh device list.
3. **Run-on-all banner** — command textarea + button → Dialog confirm ("This will run the command on ALL registered devices" with current command shown) → `sidecarRunAll(cmd)` → per-device output rendered inline with error-tint for non-empty `error` fields.
4. **Devices table** — `sidecarListDevices()` on mount; one `.sidecar-device-row` per device. Each row:
   - Name + address + status chip (`online` / `offline` / `unreachable` / `unknown`, driven by `[data-status]` left-border colors).
   - `formatSeenAgo(last_seen)` text.
   - Ping button → `sidecarPingDevice(id)` → toast with hostname/os/version + refresh.
   - Remove button → Dialog confirm → `sidecarRemoveDevice(id)`.
   - Inline command input (Enter-to-run) + Run button → `sidecarRunCommand({deviceId, command})` → output rendered in the same row's expander (output `<pre>` beneath the control row), plus capability pills.
   - `data-testid="sidecar-device-row" data-device-id={id}`.
   - Empty state when no devices registered.
5. **Kali Pentest Utilities** — collapsed by default; expand via header (Enter/Space toggle). On open, renders:
   - **Warning banner** (T-06-06-02 required): "These tools invoke network scanning + cryptographic operations. Use only on systems you are authorized to test."
   - **6 tool cards** (data-testid=kali-tool-card, data-tool=<name>):
     - Recon — target input → `kaliRecon(target)` → formatted scan result with findings count.
     - Crack Hash — hash + type dropdown (auto/md5/sha1/sha256/sha512/bcrypt/ntlm) → `kaliCrackHash({hash, hashType?})`.
     - Analyze CTF — name + category dropdown + description textarea → `kaliAnalyzeCtf({name, category, description, files: []})`.
     - Explain Exploit — code textarea → `kaliExplainExploit(code)`.
     - Generate Payload — type dropdown + target info → `kaliGeneratePayload({payloadType, targetInfo})`.
     - Check Tools — no input, button-only → `kaliCheckTools()` → flat tool-availability map + nested `_wordlists` rendered as a human-legible line list.
- `data-testid`: `sidecar-view-root`, `sidecar-device-row`, `kali-section-root`, `kali-tool-card`.

## Kali Sub-Section Home (D-158 Divergence Flag)

Per D-158, Kali's 6 commands ship inside SidecarView (the closest thematic home — offsite device + pentest). This is a divergence from the natural "Admin / Dev Tools" grouping that Phase 7 will introduce. **Flagged for Phase 7 retrospective:** if Kali gets its own dedicated route in Phase 7 Admin, the `KaliSection` component can move wholesale out of SidecarView — the state is self-contained and doesn't share refs with the Sidecar device table.

## Wrapper Signature Corrections Found (this plan)

None. Plan 06-02's identity.ts already documented every signature correction (see Plan 06-02 SUMMARY §"Rust Signature Corrections"). The 3 views in this plan consumed the wrappers as-documented without further Rust-surface discovery. Specifically verified during implementation:

- `reasoningGetTraces(limit?)` — takes `limit` positionally (the wrapper accepts `undefined` and passes `{ limit: undefined }`).
- `reasoningThink({question, context?, maxSteps?})` — questioned-only; AppHandle is Tauri-managed.
- `reasoningSocratic` returns `Array<[string, string]>` tuples — formatted as Q/A pairs.
- `contextAssemble({query, maxTokens?, sources?})` returns `AssembledContextResponse` (chunks / total_tokens / sources_used / was_truncated / formatted).
- `sidecarRegisterDevice({name, address, secret})` requires the secret (3-field form enforced client-side).
- `sidecarStartServer({port, secret})` — exposed both in the confirm Dialog.
- `sidecarRunAll(command)` — accepts a single command string; returns `SidecarRunAllEntry[]`.
- `kaliRecon(target: string)` — single-arg; returns `KaliScanResult` with `target / tool / output / findings[] / timestamp`.
- `kaliCheckTools()` returns `Record<string, unknown>` — rendered as a sorted flat list with special handling for the nested `_wordlists` key.

## CSS Delta — identity-rich-b.css

Scoped partial owned by Plan 06-06 (disjoint from Plan 06-05's identity-rich-a.css). ~660 lines grouped into 4 sections under a single `@layer features` block:

| Section              | Classes | Tokens used |
|----------------------|---------|-------------|
| ReasoningView        | `.reasoning-input-row`, `.reasoning-tools`, `.reasoning-output`, `.reasoning-output-header`, `.reasoning-section-label`, `.reasoning-traces-list`, `.reasoning-trace-row`, `.reasoning-trace-preview`, `.reasoning-trace-ts`, `.reasoning-trace-expanded`, `.reasoning-empty` | `--s-N`, `--r-md`, `--r-sm`, `--line`, `--line-strong`, `--t-1`/2/3, `--font-mono`, `--font-display`, `--ease-out` |
| ContextEngineView    | `.context-card`, `.context-card-actions`, `.context-result-meta`, `.context-assembled-text`, `.context-chunks-list`, `.context-chunk-row`, `.context-chunk-score` (range-tinted), `.context-chunk-body`, `.context-chunk-source`, `.context-score-readout` (range-tinted) | same set + `--status-running`, `--status-success`, `--a-warm` |
| SidecarView          | `.sidecar-header`, `.sidecar-register-form`, `.sidecar-run-all-banner`, `.sidecar-device-table`, `.sidecar-device-row` (status-tinted left border), `.sidecar-device-main/name/address/status/seen/actions`, `.sidecar-device-row-expand`, `.sidecar-device-run-row`, `.sidecar-device-output`, `.sidecar-run-all-results`, `.sidecar-run-all-row` | same set + `--status-running`, `--status-success`, `--status-error`, `--t-4` |
| Kali sub-section     | `.kali-section`, `.kali-section-header`, `.kali-section-toggle`, `.kali-warning`, `.kali-tools-grid`, `.kali-tool-card`, `.kali-tool-title`, `.kali-tool-desc`, `.kali-tool-inputs`, `.kali-tool-actions`, `.kali-tool-output`, `.kali-dialog-body`, `.kali-dialog-actions` | same set |

All tokens are project-standard (see Plan 06-02 correction). No hex colors. No `backdrop-filter` on inner cards (D-07 + D-70 preserved — only the outer `GlassPanel` blurs).

## Threat Mitigations Applied

| Threat ID      | Mitigation applied                                                                                  |
|----------------|-----------------------------------------------------------------------------------------------------|
| T-06-06-01     | Per-device Run requires explicit click on that row's button; Run-on-all gated by Dialog confirm.    |
| T-06-06-02     | Warning banner rendered above Kali tool cards whenever the section is expanded.                     |
| T-06-06-04     | `sidecarRunAll` gated by Dialog confirm showing the exact command + device count.                   |
| T-06-06-05     | `contextClearCache` gated by Dialog confirm.                                                        |
| (Out-of-register) `sidecarStartServer` — lifecycle command, also Dialog-gated (D-158 Discretion).   |
| (Out-of-register) `sidecarRemoveDevice` — Dialog-gated with device name shown before confirm.       |

## Non-Overlap Verification (D-143)

Confirmed this plan did NOT modify:

- `src/features/identity/index.tsx` — single-writer-Plan 06-02 invariant held.
- `src/features/identity/identity.css` — base file untouched; additions isolated to `identity-rich-b.css`.
- `src/features/identity/types.ts` — Plan 06-06 needed no new UI-only types.
- Any file in `src/features/life-os/*` — peer wave-2 lanes (06-03 / 06-04) untouched.
- `src/features/identity/SoulView.tsx`, `PersonaView.tsx`, `CharacterBible.tsx`, `NegotiationView.tsx`, `EditSectionDialog.tsx` — peer Plan 06-05's lane files untouched.
- Any Rust file under `src-tauri/` — zero Rust changes (D-140 invariant).
- Any wrapper file under `src/lib/tauri/` — all wrappers consumed as shipped by Plan 06-02.

## Verification

- `npx tsc --noEmit` — clean (0 errors).
- `npm run verify:all` — all 11 checks pass:
  - `verify:entries` OK
  - `verify:no-raw-tauri` OK (3 new files route every invoke through `@/lib/tauri/identity`)
  - `verify:migration-ledger` OK
  - `verify:emit-policy` OK
  - `verify:contrast` OK (no new hex colors introduced; every color a token)
  - `verify:chat-rgba` OK
  - `verify:ghost-no-cursor` OK
  - `verify:orb-rgba` OK
  - `verify:hud-chip-count` OK
  - `verify:phase5-rust` OK
  - `verify:feature-cluster-routes` OK
- Per-task grep verifications (from plan):
  - Task 1: `reasoningThink|reasoningGetTraces`, `contextAssemble|contextClearCache`, `reasoning-view-root|context-engine-root`, no residual "Ships in Plan 06-06" string, `reasoning-input-row|context-chunks-list` in CSS — all pass.
  - Task 2: `sidecarListDevices|sidecarPingDevice|sidecarRunCommand`, `kaliRecon|kaliCrackHash|kaliCheckTools`, `sidecar-view-root|sidecar-device-row|kali-section-root|kali-tool-card`, no residual placeholder string, `sidecar-device-table|kali-section` in CSS — all pass.
- ESLint `blade/no-raw-tauri` via bash backstop — OK (no raw `@tauri-apps/api/core` or `/event` imports in the 3 new files).
- `npm run lint` (ESLint 9 default parser) fails on these files as it does on every peer file using `import type {…}` syntax — pre-existing repo-wide Espree limitation, NOT introduced by this plan. `verify:all` uses the bash backstop which is the authoritative check.

## Operational Notes for Plan 06-07 (Playwright specs)

- `reasoning-view-root` + `reasoning-tool-output` + `reasoning-trace-row` are stable testids.
- `context-engine-root` + `context-assemble-output` are stable testids.
- `sidecar-view-root` + `sidecar-device-row` (with `data-device-id`) + `kali-section-root` + `kali-tool-card` (with `data-tool=<name>`) are stable testids.
- All Dialog confirmations are standard native `<dialog>` instances — Playwright can `page.locator('dialog')` them.
- No new events emitted or subscribed — Plan 06-06 is request-response only (matches D-162 expectation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] CSS tokens — reused Plan 06-02's correction**

- **Found during:** Task 1 CSS creation (reading the draft plan's `--sp-2 / --radius-card / --radius-pill` and comparing to Plan 06-02 SUMMARY + `src/styles/tokens.css`).
- **Issue:** The plan draft's CSS block used token names that don't exist in the project (same drift Plan 06-02 already flagged).
- **Fix:** Used project tokens (`--s-N` / `--r-md` / `--r-sm` / `--r-pill` / `--line` / `--line-strong`) verbatim.
- **Files modified:** `src/features/identity/identity-rich-b.css`.
- **Commit:** `f057c3f`.

**2. [Rule 2 — Critical] Dialog-confirm added to `sidecarRemoveDevice`**

- **Found during:** Task 2 SidecarView wiring — plan draft lists Register/Ping/Run/Run-All as "3 action buttons" but doesn't call out that Remove is destructive.
- **Issue:** Un-confirmed device removal is a footgun (user loses access without warning; threat T-06-06-01 adjacent).
- **Fix:** Added a fourth Dialog confirm for Remove, showing the device name before committing.
- **Files modified:** `src/features/identity/SidecarView.tsx`.
- **Commit:** `ecbfef0`.

No Rule 4 architectural decisions were required.

## Parallel-lane Coordination Notes

At the time Task 1 was committed, the working tree had concurrent staged changes from peer wave-2 executors (life-os subset B lane — `PredictionsView`/`SocialGraphView` and `life-os-rich-b.css`; and peer identity subset A lane — `SoulView`/`PersonaView` + `identity-rich-a.css` + `EditSectionDialog.tsx`). Used `git commit --only <pathspec>` to atomically commit ONLY my three identity files per commit, ensuring my commits carried nothing from other lanes and other lanes' staged files remained in their own working state. The final HEAD log shows both Task 1 and Task 2 commits contain exclusively files this plan owns.

## Self-Check

Artifact checks:
- `src/features/identity/ReasoningView.tsx` — FOUND (343 lines; `reasoning-view-root` testid present; `reasoningThink` + `reasoningGetTraces` wrapper calls present).
- `src/features/identity/ContextEngineView.tsx` — FOUND (273 lines; `context-engine-root` testid present; `contextAssemble` + `contextClearCache` wrapper calls present).
- `src/features/identity/SidecarView.tsx` — FOUND (990 lines; `sidecar-view-root` + `sidecar-device-row` + `kali-section-root` + `kali-tool-card` testids present; `sidecarListDevices` + `kaliCheckTools` wrapper calls present).
- `src/features/identity/identity-rich-b.css` — FOUND (660 lines; reasoning + context + sidecar + kali sections under `@layer features`).

Commit checks:
- `f057c3f` — feat(06-06): ReasoningView + ContextEngineView real surfaces (IDEN-05, IDEN-06) — FOUND; 3 files changed (2 modified + 1 created); only identity-lane files.
- `ecbfef0` — feat(06-06): SidecarView with device table + Kali pentest sub-section (IDEN-07) — FOUND; 1 file changed (SidecarView); only identity-lane.

## Self-Check: PASSED

Verified artifacts exist with expected content; both commits exist in git log with correct scope and only this plan's lane files.
