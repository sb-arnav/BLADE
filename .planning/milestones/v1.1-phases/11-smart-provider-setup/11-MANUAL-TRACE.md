# Phase 11 — Goal-Backward Manual Trace

**Purpose:** Map each of the 5 ROADMAP Phase 11 success criteria to the exact
Phase 11 artifacts (files, tests, manual steps) that close them. Consumed by
`/gsd-verify-work` and future auditors.

**Source of truth:** `.planning/ROADMAP.md` §"Phase 11: Smart Provider Setup"
§"Success Criteria" (locked 2026-04-20).

**Generated:** 2026-04-20 by Plan 11-06 Task 2.

---

## How to read this document

Each of the 5 success criteria below has 4 blocks:

1. **Criterion verbatim** — quoted from ROADMAP.md §Phase 11 §Success Criteria
2. **Implementing plans** — which Phase 11 plan(s) shipped the closing artifacts
3. **Automated verify** — exact command(s) that prove the criterion is met
4. **Expected evidence** — what passing output looks like
5. **Manual verify** — steps a human takes in a dev build when automation alone is insufficient (matches 11-VALIDATION.md §Manual-Only Verifications)

Run every command from the repo root (`/home/arnav/blade`) unless noted.

---

## Criterion 1 — cURL paste auto-fills provider + model + base_url + headers

> "Pasting a raw OpenAI / Anthropic / Groq cURL command into the provider form
> auto-extracts provider + model + `base_url` + headers and fills the form —
> verified across 3 representative cURL snippets."

**Implementing plans:** Plan 11-01 (parser + unit tests) + Plan 11-03 (paste UI e2e).

**Implementing artifacts:**

- `src-tauri/src/provider_paste_parser.rs` — `detect_curl` + `parse_provider_paste` Tauri command.
- `src-tauri/src/provider_paste_parser.rs` `#[cfg(test)] mod tests` — OpenAI / Anthropic / Groq cURL test cases (names follow `test_curl_*` + format-specific variations).
- `src-tauri/src/lib.rs` — `parse_provider_paste` registered in `generate_handler![]`.
- `src/features/providers/ProviderPasteForm.tsx` — shared paste card, consumed by onboarding + Settings.
- `tests/e2e/onboarding-paste-card.spec.ts` — Playwright spec proving paste → parse → form-fill flow end-to-end.

**Automated verify:**

```bash
# Rust parser — cURL cases must all pass
cd src-tauri && cargo test --lib provider_paste_parser::tests

# Playwright — onboarding paste card
cd /home/arnav/blade && npx playwright test tests/e2e/onboarding-paste-card.spec.ts
```

**Expected evidence:**

- `cargo test` output includes `test provider_paste_parser::tests::test_curl_* ... ok` lines (≥ 3 cURL cases passing; total parser tests ≥ 17 per Wave 0 requirement).
- `playwright test` exits 0 with `1 passed`.
- `npm run verify:providers-capability` check #3 confirms the config fields that store parsed-provider metadata are 6-place-wired.

**Manual verify** (ROADMAP bar — 3 representative samples):

1. `npm run tauri dev` — start dev build.
2. Complete onboarding up to the provider-picker screen.
3. Paste each of the 3 representative samples (from `11-RESEARCH.md §Paste Sample Corpus`): OpenAI cURL, Anthropic cURL with `x-api-key` header, Groq cURL.
4. After each paste, confirm the detected `provider`, `model`, `base_url`, and `api_key` are displayed in the form and match the pasted values (cross-check against the research corpus expected values).

---

## Criterion 2 — JSON config blob OR Python SDK snippet produces same auto-fill

> "Pasting a JSON config blob OR a Python SDK snippet produces the same
> auto-fill behavior."

**Implementing plans:** Plan 11-01 (parser + JSON + Python SDK detectors + tests).

**Implementing artifacts:**

- `src-tauri/src/provider_paste_parser.rs` — `detect_json` + `detect_python_sdk` functions.
- `#[cfg(test)] mod tests` — JSON cases (≥ 4) + Python SDK cases (≥ 5) per Wave 0 requirement.
- Same `parse_provider_paste` Tauri command entry point as Criterion 1.
- Same `ProviderPasteForm.tsx` consumer — no branching by format; the parser normalises all 3 formats into one `ParsedProviderConfig` shape.

**Automated verify:**

```bash
# All parser tests — JSON + Python paths pass
cd src-tauri && cargo test --lib provider_paste_parser::tests
```

**Expected evidence:**

- `cargo test` reports all `test_json_*` and `test_python_*` cases passing.
- Total parser test count ≥ 17 (Wave 0 requirement: 7 cURL + 4 JSON + 5 Python + ≥ 3 negative / edge).

**Manual verify:** Same dev-build flow as Criterion 1 but paste a representative JSON blob and a representative Python SDK snippet instead. Form must auto-fill identically to the cURL case.

---

## Criterion 3 — Key save triggers probe; result persists in provider row

> "Saving a new API key triggers one test call that retrieves and persists
> model name, context window, vision / audio / tool-calling support; the probe
> result is visible in the provider row."

**Implementing plans:** Plan 11-02 (probe + config fields + round-trip test) + Plan 11-03 (pill strip UI + e2e).

**Implementing artifacts:**

- `src-tauri/src/capability_probe.rs` — `probe_provider_capabilities` Tauri command. Idempotent single-call wrapping `test_connection` + static capability matrix. No retry loop (4ab464c posture).
- `src-tauri/src/capability_probe.rs` `#[cfg(test)] mod tests` — `matrix_*` + `auto_populate_*` cases (≥ 5 per Wave 0 requirement: happy, 401/403, 404, 429-valid, 5xx).
- `src-tauri/src/config.rs` — 5 new BladeConfig fields in 6-place pattern (`provider_capabilities: HashMap<String, ProviderCapabilityRecord>`, `vision_provider` / `audio_provider` / `long_context_provider` / `tools_provider: Option<String>`).
- `src-tauri/src/config.rs` `phase11_fields_round_trip` test — save/load preserves all 5 fields.
- `src/features/providers/CapabilityPillStrip.tsx` — renders `[vision] [audio] [tools] [N-k ctx]` pills from `ProviderCapabilityRecord`.
- `src/features/settings/panes/ProvidersPane.tsx` — consumes `CapabilityPillStrip`; has a "Re-probe" icon button.
- `tests/e2e/settings-providers-pane.spec.ts` — e2e proving pill strip renders + re-probe triggers `probe_provider_capabilities` invocation + result persists.

**Automated verify:**

```bash
# Rust: probe + config round-trip
cd src-tauri && cargo test --lib capability_probe::tests
cd src-tauri && cargo test --lib config::tests::phase11_fields_round_trip

# Playwright: pill strip + re-probe
cd /home/arnav/blade && npx playwright test tests/e2e/settings-providers-pane.spec.ts

# Structural gate: 5 new BladeConfig fields present in 6 places
cd /home/arnav/blade && npm run verify:providers-capability
```

**Expected evidence:**

- `cargo test` reports `capability_probe::tests::*` (≥ 5) + `config::tests::phase11_fields_round_trip` all passing.
- `playwright test` exits 0 with `1 passed`.
- `verify:providers-capability` output line: `check #3 config 6-place (provider_capabilities=N, vision_provider=M, …)` where every `N ≥ 6`.

**Manual verify** (ROADMAP "result persists in provider row"):

1. `npm run tauri dev` with a real provider API key (OpenAI, Anthropic, or Groq).
2. Settings → Providers → add the key via paste flow.
3. Confirm the probe completes in ≤ 3 s and the pill strip under the provider row shows the expected capabilities for that provider's default model.
4. Click the "Re-probe" icon — confirm the pills refresh (may show updated `last_probed` timestamp in the tooltip or row meta).
5. Quit and relaunch the app — confirm the same pill strip is rendered without re-probing (probe result persisted to disk via `save_config`).

---

## Criterion 4 — Capability-needing surfaces show CapabilityGap + CTA opens provider add flow

> "Adding a key with no vision support causes vision-needing UI surfaces (e.g.
> screen-aware views) to show 'needs vision-capable model' prompt with an 'add
> key' CTA that opens the provider add flow — verified on ≥ 2 vision-consuming
> surfaces. Same behavior for audio, long-context, and tool-calling capability
> gaps."

**Implementing plans:** Plan 11-05 (CapabilityGap component + useCapability hook + CAPABILITY_SURFACES registry + 8 consumer surface wires + 8 e2e specs).

**Implementing artifacts:**

- `src/features/providers/CapabilityGap.tsx` — reusable empty-state component with 4 capability copy variants.
- `src/features/providers/useCapability.ts` — hook returning `{ hasCapability, suggestedProvider, openAddFlow }`. `openAddFlow(cap)` uses the extended `openRoute(id, hint?)` to deep-link Settings → Providers with `?needs=<cap>`.
- `src/features/providers/CAPABILITY_SURFACES.ts` — registry with ≥ 2 entries per capability (8 entries total — vision × 2, audio × 2, long_context × 2, tools × 2).
- `src/windows/main/useRouter.ts` — extended `openRoute(id, hint?)` + `routeHint` state.
- `src/features/settings/panes/ProvidersPane.tsx` — `routeHint` scroll-focus effect so the paste textarea is focused when the deep link opens.
- 8 consumer surfaces in Plan 11-05 Task 2: `ScreenTimeline.tsx`, `QuickAskView.tsx`, `VoiceOrbView.tsx`, `MeetingGhostView.tsx`, `ChatView.tsx`, `KnowledgeBase.tsx`, `SwarmView.tsx`, `WebAutomation.tsx`.
- 8 e2e specs `tests/e2e/capability-gap-*.spec.ts` — 2 per capability.

**Automated verify:**

```bash
# Structural gate: surfaces registry has >= 2 per capability; every capability has >= 1 <CapabilityGap> usage in src/
cd /home/arnav/blade && npm run verify:providers-capability

# Playwright: 8 spec files — one per consumer surface
cd /home/arnav/blade && npx playwright test tests/e2e/capability-gap-vision-screen-timeline.spec.ts \
                                             tests/e2e/capability-gap-vision-quickask.spec.ts \
                                             tests/e2e/capability-gap-audio-voice-orb.spec.ts \
                                             tests/e2e/capability-gap-audio-meeting-ghost.spec.ts \
                                             tests/e2e/capability-gap-longctx-chat.spec.ts \
                                             tests/e2e/capability-gap-longctx-knowledge.spec.ts \
                                             tests/e2e/capability-gap-tools-swarm.spec.ts \
                                             tests/e2e/capability-gap-tools-web-automation.spec.ts

# Or all 11 Phase 11 specs at once
cd /home/arnav/blade && npm run test:e2e:phase11
```

**Expected evidence:**

- `verify:providers-capability` output includes:
  - `check #1 surfaces (vision=N, audio=N, long_context=N, tools=N)` with every `N ≥ 2`.
  - `check #2 CapabilityGap usages (vision, audio, long_context, tools)` (all 4 capabilities listed, none marked `MISSING`).
- `playwright test` exits 0 with `8 passed` for the capability-gap suite (or `11 passed` for the full Phase 11 suite).

**Manual verify** (ROADMAP "add key CTA opens provider add flow"):

1. `npm run tauri dev` with ONLY a Groq API key configured (Groq has tool-calling + text but no vision / no audio).
2. Open Screen Timeline (`Cmd/Ctrl + K → "Screen Timeline"`). Confirm it renders `<CapabilityGap capability="vision">` (camera icon + "Needs a vision-capable model" headline + body + "Add a provider" CTA).
3. Click "Add a provider" — confirm Settings → Providers opens AND the paste textarea is focused AND the deep-link hint `?needs=vision` (or equivalent `routeHint`) is present.
4. Repeat on QuickAsk image input path for a second vision surface.
5. Repeat the same pattern for audio (Voice Orb + Meeting Ghost), long-context (Chat + Knowledge Base), and tools (Swarm + Web Automation) — 8 surfaces total, 2 per capability, per PROV-07 + PROV-08.

---

## Criterion 5 — router.rs consults per-capability; vision task routes to vision_provider with fallback chain

> "`router.rs` routing consults per-capability config; a task classified as
> requiring vision routes to `vision_provider` with fallback chain, not to the
> primary provider when primary lacks vision — verified by unit test + manual
> trace."

**Implementing plans:** Plan 11-04 (router rewire + capability-filtered chain + event emit + unit tests).

**Implementing artifacts:**

- `src-tauri/src/router.rs::select_provider` — public fn implementing 3-tier resolution: (0) `config.base_url` escape hatch, (1) capability-hard-filter (explicit `vision_provider` slot wins; fallback to first capable provider with stored key), (2) `task_routing` soft preference, (3) primary fallback.
- `src-tauri/src/router.rs::build_capability_filtered_chain` + `build_generic_chain` + `find_capable_providers` — helper functions.
- `src-tauri/src/router.rs` `#[cfg(test)] mod tests` — 8 cases (all 7 Wave 0 required + 1 tier-1 fall-through).
- `src-tauri/src/providers/mod.rs::fallback_chain_complete_with_override` — streaming sibling of `fallback_chain_stream`; consumes a pre-built capability-filtered chain; never falls through to a non-capable provider.
- `src-tauri/src/commands.rs::send_message_stream` — single rewired call site. Emits exactly one `blade_routing_capability_missing` event via `app.emit_to("main", ...)` when no capable provider has a key (4ab464c posture: one-shot, no retry loop).
- `src/lib/events/index.ts` — `BLADE_EVENTS.ROUTING_CAPABILITY_MISSING: 'blade_routing_capability_missing'` constant (disjoint from legacy `CAPABILITY_GAP_DETECTED`).
- `src/lib/events/payloads.ts` — `RoutingCapabilityMissingPayload` interface (capability + task_type + primary_provider + primary_model + message; no api_key, no user content per T-11-24 mitigation).

**Automated verify:**

```bash
# Router unit tests — 8 cases covering tier 0/1/2/3 + chain filter + chain dedup + event emission
cd src-tauri && cargo test --lib router::tests

# Structural gate: event constant + literal present; 5 capability config fields 6-place wired
cd /home/arnav/blade && npm run verify:providers-capability

# Grep audits (from Plan 11-04 acceptance criteria):
grep -c 'router::select_provider'      src-tauri/src/commands.rs   # expect >= 1 (call site)
grep -c 'resolve_provider_for_task'    src-tauri/src/commands.rs   # expect 0 (rewire complete)
grep -c 'fallback_chain_complete_with_override' src-tauri/src/commands.rs  # expect 1
grep -c 'emit_to("main", "blade_routing_capability_missing"' src-tauri/src/commands.rs  # expect 1
```

**Expected evidence:**

- `cargo test --lib router::tests` reports ≥ 7 passing (`select_provider_tier0_base_url`, `select_provider_tier1_vision_override`, `select_provider_tier2_task_routing`, `select_provider_tier3_primary`, `chain_filters_noncapable`, `chain_dedupes`, `emits_missing_event`, and the 8th fall-through test).
- `verify:providers-capability` output line: `check #4 event registry (ROUTING_CAPABILITY_MISSING constant + literal)`.
- The grep audit row `resolve_provider_for_task in commands.rs = 0` confirms the single-site rewire landed.
- In WSL2 / constrained environments where `cargo test --lib` cannot link against `-lgbm` / `-lxdo`, the Plan 11-04 sidecar pattern at `/tmp/blade-sidecar-11-04/` proves 8/8 assertions in isolation (Plan 11-02 precedent).

**Manual verify** (ROADMAP "manual trace"):

1. `npm run tauri dev` with `RUST_LOG=blade=debug` (or set `debug_logging=true` in BladeConfig).
2. Configure providers: Groq as primary (no vision capability) + Anthropic as fallback (vision-capable).
3. Set `vision_provider = Some("anthropic/…")` in Settings → Providers (or leave `None` to exercise tier 1b scan).
4. Open Chat. Attach an image. Send a message.
5. Tail the dev log — confirm the router selects **Anthropic** (not Groq), and the fallback chain is guaranteed-capable (no Groq entry). Look for log lines emitted from `select_provider` / `build_capability_filtered_chain`.
6. Alternative unconfigured case: remove all vision-capable keys, set only Groq. Send an image-attached message. Confirm exactly one `blade_routing_capability_missing` event fires (grep log for `emit_to("main", "blade_routing_capability_missing"`) AND the request proceeds degraded to primary (Groq) without a retry loop.

---

## Full Verification Command Set

Running this list from the repo root reproduces the full goal-backward check.
Exit code 0 for every block is the Phase 11 "DONE" signal.

```bash
cd /home/arnav/blade

# 1. Rust unit + integration tests — covers Criteria 1, 2, 3, 5.
cd src-tauri && cargo test --lib provider_paste_parser::tests \
                                capability_probe::tests \
                                config::tests::phase11_fields_round_trip \
                                router::tests

# 2. Batched cargo check — Phase 11 must compile end-to-end.
cd src-tauri && cargo check

# 3. TypeScript compile — frontend surfaces type-check.
cd /home/arnav/blade && npx tsc --noEmit

# 4. Phase 11 Playwright suite (11 specs: 3 from Plan 11-03 + 8 from Plan 11-05).
cd /home/arnav/blade && npm run test:e2e:phase11

# 5. Phase 11 structural gate — verifies the 4 invariants.
cd /home/arnav/blade && npm run verify:providers-capability

# 6. Full verify chain — existing 19 gates + new Phase 11 gate = 20 gates total.
cd /home/arnav/blade && npm run verify:all
```

**Each block must exit 0 for Phase 11 to be considered complete.**

---

## Notes for Future Auditors

- **Subscriber advisory on `ROUTING_CAPABILITY_MISSING`:** `verify:providers-capability` emits a WARN when no `src/` file subscribes to `BLADE_EVENTS.ROUTING_CAPABILITY_MISSING`. Plan 11-04 shipped the emit + TS constant; the UI consumer (toast prompting "Add a vision-capable key") is an explicit follow-up from 11-04-SUMMARY.md §"Next Phase Readiness". The warning is advisory-only and does not block the gate — it gives a future wiring plan a visible target to silence.
- **Capability matrix source-of-truth:** the matrix lives in `src-tauri/src/capability_probe.rs` (static per D-52). Adding a new provider or model with different capabilities requires a code change there — this is intentional (D-52 rationale: dynamic per-API capability probing is cost-prohibitive + fragile).
- **6-place pattern enforcement:** `verify:providers-capability` check #3 uses `>= 6 occurrences` as a necessary-but-not-sufficient signal. A passing check does NOT prove the field is correctly wired in all 6 places — it only proves the name appears at least 6 times. Treat this gate as a regression tripwire, not a sufficiency proof; the accompanying `config::tests::phase11_fields_round_trip` is the sufficiency test.
- **Related gates outside Phase 11:** `verify:migration-ledger.mjs` will orphan-fail if a new Phase 11 route id is added to `src/features/<cluster>/index.tsx` without a corresponding migration-ledger row. Plan 11-06 backfilled 4 such rows (`quickask`, `voice-orb`, `meeting-ghost`, `agents-swarm`) introduced by Plan 11-05.

---

*Generated 2026-04-20 by Plan 11-06 Task 2 as the Phase 11 goal-backward trace.*
