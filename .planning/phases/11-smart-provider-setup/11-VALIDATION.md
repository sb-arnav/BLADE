---
phase: 11
slug: smart-provider-setup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Domain:** Rust backend (paste-parser, capability-probe, router rewire, config fields) + React frontend (paste form, capability-gap surfaces, fallback drag list). Unit-test-heavy for Rust; Playwright-heavy for frontend capability-gap surfaces.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: built-in `#[cfg(test)] mod tests` (existing pattern — crypto.rs, action_tags.rs, db.rs, code_sandbox.rs, agents/thought_tree.rs). Frontend: Playwright 1.58.2 (existing). |
| **Config file** | `src-tauri/Cargo.toml` (no separate test config); `playwright.config.ts` at repo root |
| **Quick run command** | `cd src-tauri && cargo test --lib <module>` (runs < 10s per module) |
| **Full suite command** | `cd src-tauri && cargo test --lib && npm run test:e2e:phase11 && npm run verify:all` |
| **Estimated runtime** | ~15s for Rust unit tests, ~90s for e2e Phase 11 subset, ~90s for verify:all |

---

## Sampling Rate

- **After every task commit:** `cd src-tauri && cargo test --lib <module>` for the module touched (~10s per module).
- **After every plan wave:** `cd src-tauri && cargo test --lib` (all Rust tests) + `npm run test:e2e:phase11` (new script, 8 spec files) + `npm run verify:all`.
- **Before `/gsd-verify-work`:** Full suite clean + `npm run verify:providers-capability` (new gate) clean.
- **Max feedback latency:** 10s for per-task; 4 min for full chain.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | PROV-01 | — | N/A — key never logged; redacted in error strings via `safe_slice` | unit (Rust) | `cd src-tauri && cargo test --lib provider_paste_parser::tests` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 0 | PROV-05, PROV-06 | — | Test calls use `max_tokens: 1`; no key logged | unit | `cd src-tauri && cargo test --lib capability_probe::tests && cargo test --lib config::tests::phase11_fields_round_trip` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 1 | PROV-04 | — | Paste textarea content never persisted (only parsed value is stored) | e2e | `npx playwright test tests/e2e/onboarding-paste-card.spec.ts` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 1 | PROV-05 visual | — | Capability pill strip reflects only probe-result data, no inference from key | visual | `npx playwright test tests/e2e/settings-providers-pane.spec.ts` | ❌ W0 | ⬜ pending |
| 11-03-03 | 03 | 1 | PROV-06 | — | Fallback order writes only provider names, no keys | e2e | `npx playwright test tests/e2e/fallback-order-drag.spec.ts` | ❌ W0 | ⬜ pending |
| 11-04-01 | 04 | 1 | PROV-09 tier-1 | — | Capability hard-filter never bypassed on vision task | unit | `cd src-tauri && cargo test --lib router::tests::select_provider_tier1_vision_override` | ❌ W0 | ⬜ pending |
| 11-04-02 | 04 | 1 | PROV-09 tier-2 | — | — | unit | `cd src-tauri && cargo test --lib router::tests::select_provider_tier2_task_routing` | ❌ W0 | ⬜ pending |
| 11-04-03 | 04 | 1 | PROV-09 tier-3 | — | — | unit | `cd src-tauri && cargo test --lib router::tests::select_provider_tier3_primary` | ❌ W0 | ⬜ pending |
| 11-04-04 | 04 | 1 | PROV-09 base_url escape | — | Custom `base_url` bypasses capability filter (user knows what they're doing) | unit | `cd src-tauri && cargo test --lib router::tests::select_provider_tier0_base_url` | ❌ W0 | ⬜ pending |
| 11-04-05 | 04 | 1 | PROV-09 chain filter | — | Fallback chain never falls through to non-capable provider on vision task | unit | `cd src-tauri && cargo test --lib router::tests::chain_filters_noncapable` | ❌ W0 | ⬜ pending |
| 11-04-06 | 04 | 1 | PROV-09 event emit | — | Single-shot event, no retry loop (per 4ab464c posture) | integration | `cd src-tauri && cargo test --lib router::tests::emits_missing_event` | ❌ W0 | ⬜ pending |
| 11-05-01 | 05 | 1 | PROV-07 vision ≥2 | — | Capability gap surface prompts only; never hides the feature entirely (preserves discoverability) | e2e | `npx playwright test tests/e2e/capability-gap-vision-*.spec.ts` | ❌ W0 | ⬜ pending |
| 11-05-02 | 05 | 1 | PROV-08 audio ≥2 | — | — | e2e | `npx playwright test tests/e2e/capability-gap-audio-*.spec.ts` | ❌ W0 | ⬜ pending |
| 11-05-03 | 05 | 1 | PROV-08 long_ctx ≥2 | — | — | e2e | `npx playwright test tests/e2e/capability-gap-longctx-*.spec.ts` | ❌ W0 | ⬜ pending |
| 11-05-04 | 05 | 1 | PROV-08 tools ≥2 | — | — | e2e | `npx playwright test tests/e2e/capability-gap-tools-*.spec.ts` | ❌ W0 | ⬜ pending |
| 11-06-01 | 06 | 2 | PROV-01..09 | — | `verify:providers-capability` gate: (a) CAPABILITY_SURFACES has ≥2 per capability, (b) all 4 `<CapabilityGap capability="*">` usages present, (c) 5 new BladeConfig fields appear in 6 places | integrity | `npm run verify:providers-capability && npm run verify:all` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/provider_paste_parser.rs` — new module with `#[cfg(test)] mod tests` block containing ≥12 cases (7 cURL + 4 JSON + 5 Python + 3 negative + 1 `$PAYLOAD` edge) — covers PROV-01/02/03
- [ ] `src-tauri/src/capability_probe.rs` — new module with `#[cfg(test)] mod tests` block containing ≥5 cases (happy path, 401/403, 404, 429-rate-limit-but-valid, 5xx) — covers PROV-05
- [ ] `src-tauri/src/router.rs` — extend existing file with `#[cfg(test)] mod tests` (≥7 cases covering tier-0/1/2/3 + chain filter + chain dedup + event emission) — covers PROV-09
- [ ] `src-tauri/src/config.rs` — extend tests module with `phase11_fields_round_trip` test covering all 5 new fields (`provider_capabilities`, `vision_provider`, `audio_provider`, `long_context_provider`, `tools_provider`) — covers PROV-06
- [ ] `tests/e2e/onboarding-paste-card.spec.ts` — e2e coverage for PROV-04
- [ ] `tests/e2e/settings-providers-pane.spec.ts` — pill strip + re-probe (PROV-05 visual)
- [ ] `tests/e2e/fallback-order-drag.spec.ts` — drag list reorder persists (D-57)
- [ ] `tests/e2e/capability-gap-{vision,audio,longctx,tools}-*.spec.ts` — 8 spec files total, ≥2 per capability — covers PROV-07 + PROV-08
- [ ] `scripts/verify-providers-capability.mjs` — new Node gate script asserting: (1) `src/features/providers/CAPABILITY_SURFACES.ts` has ≥2 entries per capability key, (2) each capability has ≥1 `<CapabilityGap capability="X">` usage in `src/`, (3) all 5 new BladeConfig fields appear in 6 places in `config.rs`, (4) `BLADE_EVENTS.ROUTING_CAPABILITY_MISSING` constant exists and has ≥1 subscriber in `src/`
- [ ] `package.json` — add `"verify:providers-capability"` and `"test:e2e:phase11"` script entries; chain `verify:providers-capability` into `verify:all` (gate 20)

**No framework install needed** — Rust test toolchain native; `regex`/`chrono`/`serde_json`/`keyring` already in Cargo.toml; Playwright 1.58.2 already in package.json.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Paste 3 representative cURL snippets (OpenAI, Anthropic, Groq) into the onboarding paste card — provider, model, base_url, key auto-populate | PROV-01 (ROADMAP success criterion 1) | e2e covers one sample; full representative set is manual per ROADMAP "verified across 3 representative cURL snippets" | Run dev build, step through onboarding, paste each sample, verify form fields match expected values. |
| Real API probe against live provider on key save (PROV-05 ROADMAP success criterion 3) | PROV-05 | Automated e2e uses mocked provider responses; real-network probe against live key is manual | Add real OpenAI/Anthropic/Groq keys in Settings, confirm probe ≤3s, capability pill strip reflects live response. |
| Vision-needing surface shows CapabilityGap prompt when only Groq key is configured | PROV-07 (ROADMAP success criterion 4) | Specific key-combo + surface-render pairing is e2e-covered but the "add key" CTA opening provider drawer is manual-first for UX polish | Configure only Groq, open Screen Timeline + QuickAsk image input, confirm both show CapabilityGap → click "Add a provider" → Settings opens with paste textarea focused. |
| `router.rs` manual trace for vision task → vision_provider → non-vision fallback filter (PROV-09 ROADMAP success criterion 5) | PROV-09 | Automated unit test covers logic; "manual trace" per ROADMAP means log-trace in dev build | Enable debug logging, send image-attached message with Groq as primary + Anthropic as fallback, confirm routing selects Anthropic, not Groq. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 Rust test modules + 8 Playwright specs + verify script + package.json wiring)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s per task, < 4min for full chain
- [ ] `nyquist_compliant: true` set in frontmatter once planner task IDs align with this map

**Approval:** pending
