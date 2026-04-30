---
phase: 18
slug: jarvis-ptt-cross-app
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Bootstrapped from `## Validation Architecture` in 18-RESEARCH.md. Refines the planner's per-task verification map.

> **Chat-first pivot note (operator 2026-04-30):** UI-polish runtime UAT is deferred for Phase 18. The cold-install end-to-end demo (JARVIS-12 rewritten — D-21) is NOT polish — it's a phase success criterion and MUST run end-to-end before phase close. Other UI surfaces (ConsentDialog, JarvisPill rendering fidelity) can defer screenshot UAT until v1.3.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | Cargo test (built-in); `--test-threads=1` per BLADE harness convention |
| **Framework (TS)** | `npx tsc --noEmit` for type checks; runtime UAT covers UI |
| **Eval gate** | `bash scripts/verify-eval.sh` (Phase 16 — unchanged) |
| **Static gate** | `npm run verify:all` — must include verify-emit-policy + verify-wiring-audit-shape |
| **Cold-install demo** | `/blade-uat` slash command — operator types chat command → consent dialog → real outbound write → ActivityStrip emission → screenshot saved + read back |
| **Quick run command** | `cd src-tauri && cargo test --lib ego::tests intent_router::tests jarvis_dispatch::tests -- --nocapture --test-threads=1 && npx tsc --noEmit` |
| **Full suite command** | `npm run verify:all && bash scripts/verify-eval.sh` |
| **Phase gate** | All static green AND JARVIS-12 e2e demo passes (real cross-app write recorded) |

---

## Sampling Rate

- **After every task commit:** quick run command (per-module unit tests + tsc)
- **After every plan wave:** full static suite (verify:all + cargo test --lib)
- **Before phase close:** JARVIS-12 cold-install demo executed + recorded
- **Max feedback latency:** ~30s static; ~5 min e2e demo

---

## Per-Task Verification Map

> Populated by the planner during plan generation. Each task MUST list either an `<automated>` verify command (mapped here) or a Wave 0 fixture dependency. The cold-install demo is a single mandatory runtime checkpoint at phase close.

| Task ID | Plan | Wave | Requirement | Threat Ref | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------|-------------------|-------------|--------|
| _populated_by_planner_ | — | — | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Tests / fixtures that MUST exist before Wave 1 implementation. Wave 0 task list:

- [ ] `src-tauri/src/intent_router.rs` (or extend `router.rs`) — `IntentClass` enum + `classify_intent` skeleton; tests stubbed
- [ ] `src-tauri/src/ego.rs` — module file + `EgoVerdict` / `EgoOutcome` enums + `REFUSAL_PATTERNS: &[(Regex, &str)]` slice + `intercept_assistant_output` skeleton; `mod tests` block stubbed
- [ ] `src-tauri/src/jarvis_dispatch.rs` (or fold into ego.rs) — dispatch fan-out skeleton (tentacle / MCP / native_tools resolution); tests stubbed
- [ ] `src-tauri/src/tentacles/{slack_outbound,github_outbound,gmail_outbound}.rs` — empty modules with module-registration entries; tests stubbed
- [ ] `src-tauri/src/consent.rs` (new module) — SQLite `consent_decisions` table CREATE-IF-NOT-EXISTS + getter/setter API; tests stubbed
- [ ] `src-tauri/src/ecosystem.rs` extension — `WRITE_UNLOCKS: HashMap<tentacle, Instant>` + `WriteScope` RAII guard + 30s TTL cap (research-locked correction to D-06)
- [ ] `src-tauri/src/lib.rs` — `mod ego;` + `mod intent_router;` (if separate) + `mod jarvis_dispatch;` + `mod consent;` + new tentacle mods; `generate_handler!` entries for new commands
- [ ] `src-tauri/src/self_upgrade.rs` extension — extend `CapabilityGap` struct with `kind: Runtime | Integration` discriminator; backfill existing entries; add 5 integration entries (slack_outbound / github_outbound / gmail_outbound / calendar_write / linear_outbound)
- [ ] `src/lib/events/index.ts` — `JARVIS_INTERCEPT: 'jarvis_intercept'` constant added to BLADE_EVENTS frozen registry
- [ ] `src/lib/events/payloads.ts` — `JarvisInterceptPayload` interface
- [ ] `scripts/verify-emit-policy.mjs` — NO entry needed if `jarvis_intercept` uses `app.emit_to("main", …)` (single-window). Wave 0 confirms emit shape.
- [ ] `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` — Wave 0 adds entries for the 4 new Rust modules (intent_router OR router-extension, ego, jarvis_dispatch, consent) + 3 new tentacles (slack_outbound, github_outbound, gmail_outbound) so verify-wiring-audit-shape passes on first run (Phase 17 missed this, hit blocker; Phase 18 preempts)
- [ ] `.planning/research/questions.md` — Q1 closed (file already exists per research finding; modification not creation)

Wave 0 closes when each item is committed and the workspace compiles clean (cargo + tsc).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cold-install end-to-end demo | JARVIS-12 (rewritten) | Real cross-app write needs operator + creds in keyring | Operator opens BLADE → types `"create a Linear issue: test JARVIS demo from Phase 18"` → ConsentDialog opens → operator clicks "Allow once" → BLADE calls `linear_create_issue` → operator opens Linear → confirms issue created → screenshot of issue page saved to `docs/testing ss/jarvis-cold-install-demo.png` (literal space). Linear is the safer demo target per RESEARCH § Demo viability. Slack alternate path requires operator to have Slack MCP installed. |
| ConsentDialog opens with correct content | JARVIS-05 / D-09 | DOM rendering needs running app | `/blade-uat` step — capture dialog screenshot at 1280×800; confirm target name + action verb + content preview + 3 buttons render |
| JarvisPill renders inline on intercept | JARVIS-11 / D-18 | Cross-component event flow | `/blade-uat` step — synthetic refusal triggers `jarvis_intercept` event; pill appears in MessageList until next assistant message |
| ActivityStrip emission on action turn | JARVIS-10 / D-17 / M-07 | Multi-window event flow | `/blade-uat` step — observe `[JARVIS] action_required: linear → executed` line in ActivityStrip after demo completion |
| Auto-approve after first consent | JARVIS-05 / D-08 | Persistence round-trip + UI | `/blade-uat` — second action with same (intent, service) tuple skips dialog; ActivityStrip shows "Auto-approved" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependency reference
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (file_exists ❌)
- [ ] No watch-mode flags in commands
- [ ] Feedback latency < 30s (unit), < 5 min (full + cold-install demo)
- [ ] `nyquist_compliant: true` set in frontmatter once planner populates the verification map
- [ ] Cold-install demo (JARVIS-12 e2e) executed + recorded before phase close
- [ ] UI-polish runtime UAT for ConsentDialog + JarvisPill explicitly DEFERRED per operator chat-first pivot (recorded in plan SUMMARY)

**Approval:** pending (planner populates per-task map; operator signs off cold-install demo at phase close)
