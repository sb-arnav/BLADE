# Phase 49 — Hunt Advanced + Cost Surfacing — SUMMARY

**Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Status:** Complete
**Date closed:** 2026-05-13

## What shipped

### HUNT-05-ADV — answer-driven probing chain (commit `2459af7`)

The agentic hunt now detects a fresh-machine condition mid-session (heuristic:
fewer than 3 useful probes after iter 3, no installed agents detected by
pre-scan, no git signal in probe trail). When that fires, the hunt:

1. Emits a `hunt_question` chat-line: *"Fresh machine — what do you do? not
   your job, the thing you'd point a friend at if they asked."*
2. Parks (up to 60s) waiting for the frontend to call
   `hunt_post_user_answer(answer)`.
3. On arrival, injects the user's answer as a user message back into the
   conversation and exposes a new sandboxed tool `hunt_seed_search(seed)`
   that walks `~/code` (depth 3) and `~` (depth 2) for matching directories
   and surfaces `git remote -v` URLs.
4. The seed sandbox (`vet_seed`) rejects shell metacharacters,
   path-traversal, sensitive-name overlap, and seeds longer than 60 chars.
   The deny list mirrors v2.0's `check_sensitive`.
5. Falls back to basic synthesis with whatever the user said if the LLM
   still can't ground after the seed-driven pass.

### HUNT-06-ADV — thematic contradiction detection (commit `66d9bda`)

New module `src-tauri/src/onboarding/contradictions.rs`. After the main
hunt accumulates ≥ 3 useful probes, a second-pass LLM call routes through
`config::cheap_model_for_provider` with a 5s `tokio::time::timeout` budget.
The prompt asks the model to classify findings into work / personal /
hobby / past-self clusters and surface contradictions where clusters
disagree on the user's primary identity.

On `Ok(Some(report))` with `contradictions.len() > 0`, the first
contradiction's `question` field emits as a `hunt_question` chat-line
using the same answer-channel `HUNT-05-ADV` set up. The user's choice
gets recorded into `findings.chat_lines` for synthesis.

Skip silently (return `Ok(None)`) when: no API key, model unavailable,
5s budget exceeded, or response not parseable as the expected JSON shape.

### HUNT-COST-CHAT — live cost surfacing (commit `dec0e69`)

`CostTracker` primitive in `onboarding::hunt` (struct: cumulative tokens
+ USD + budget + warning/block flags). Per-session: `HUNT_COST_TRACKER`
for the agentic hunt, `FORGE_COST_TRACKER` for `tool_forge`. Both reset
at the top of their respective entry points with the configured budget
from `cfg.hunt.budget_usd` / `cfg.forge.budget_usd` (default $3.00 each).

The shared wrapper `complete_turn_cost_tracked` (hunt-side) and the
mirror `forge_complete_turn_tracked` (forge-side) sit between every
`providers::complete_turn` call site and:

1. Compute marginal USD cost via `providers::price_per_million` (falls
   back to `$0.001/1K in + $0.005/1K out` estimate for unknown pairs).
2. Emit a `cost` chat-line with `{ cumulative_cost_usd, budget_usd,
   percent_used }` on every successful turn.
3. Emit `cost_warning` (once) when cumulative crosses 50% of budget.
4. Emit `cost_block` when cumulative crosses 100%. The hunt loop parks
   on `HUNT_COST_CONTINUE`; the forge wrapper polls `FORGE_COST_CONTINUE`.
   Frontend `huntContinueAfterCostBlock` / `forgeContinueAfterCostBlock`
   acks raise the budget by another bucket and clear the block flag.

Frontend `Hunt.tsx` renders the cost-block inline confirmation row with
Yes/No buttons. `useChat.tsx` BLADE_FORGE_LINE handler discriminates the
two payload shapes (phase + detail vs. text + kind + payload).

## REQ-ID coverage

| Req | Status | Notes |
|-----|--------|-------|
| HUNT-05-ADV | DONE | Answer-driven probing, seed sandbox, fallback |
| HUNT-06-ADV | DONE | Second-pass contradiction LLM with 5s budget |
| HUNT-COST-CHAT | DONE | Live cost lines, soft/hard thresholds, budget extension |

## Files touched

### Rust
- `src-tauri/src/onboarding/hunt.rs` — extended `HuntLine` (kind +
  payload); `CostTracker` + `complete_turn_cost_tracked`; fresh-machine
  heuristic; `hunt_seed_search` tool with `vet_seed`; `wait_for_user_answer`
  / `wait_for_cost_continue`; new Tauri commands `hunt_post_user_answer`
  and `hunt_continue_after_cost_block`. Wired contradiction pass before
  emitting `EVENT_HUNT_DONE`.
- `src-tauri/src/onboarding/contradictions.rs` — NEW. Cheap-model
  classification + JSON parsing. 4 unit tests.
- `src-tauri/src/onboarding/mod.rs` — `pub mod contradictions;`
- `src-tauri/src/tool_forge.rs` — `FORGE_COST_TRACKER`,
  `forge_complete_turn_tracked`, `generate_tool_script_with_app` variant,
  `reset_forge_cost_tracker()`, `forge_continue_after_cost_block` command,
  cost-aware triage call.
- `src-tauri/src/config.rs` — `HuntConfig` + `ForgeConfig` structs.
  Wired through DiskConfig / DiskConfig::default / BladeConfig /
  BladeConfig::default / load_config / save_config (6-place rule).
  Also threaded through the round-trip test fixture.
- `src-tauri/src/lib.rs` — registered 3 new commands.

### Frontend
- `src/features/onboarding/Hunt.tsx` — `awaitingAnswer` + `costBlocked`
  state; submit handler routes through `huntPostUserAnswer`; inline
  cost-block confirmation row; per-kind className suffix on rendered
  lines.
- `src/features/onboarding/hunt.css` — per-kind styling: cost lines mono
  + small + gray; cost_warning amber; cost_block red bold; hunt_question
  green-accent left-border; cost_block actions horizontal layout.
- `src/features/chat/useChat.tsx` — BLADE_FORGE_LINE handler now
  discriminates HuntLine-shaped vs. ForgeLine-shaped payloads.
- `src/lib/events/payloads.ts` — added `BladeHuntLineKind`,
  `BladeHuntCostPayload`, and `kind` / `payload` fields on
  `BladeHuntLinePayload`.
- `src/lib/tauri/onboarding.ts` — `huntPostUserAnswer`,
  `huntContinueAfterCostBlock`, `forgeContinueAfterCostBlock`.
- `src/lib/tauri/index.ts` — re-exports.

### Planning
- `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`
  — added contradictions module entry; added `BladeConfig.hunt` +
  `BladeConfig.forge` config entries.

## LOC delta

```
9 files changed, 1089 insertions(+), 13 deletions(-)   commit 1 (HUNT-05-ADV)
1 file  changed,  222 insertions(+)                    commit 2 (HUNT-06-ADV)
2 files changed,  200 insertions(+),  38 deletions(-)  commit 3 (HUNT-COST-CHAT)
```

## Static gates

- `cargo check` — clean (3 pre-existing dead_code warnings, unrelated).
- `npx tsc --noEmit` — clean.
- `cargo test --lib onboarding` — 45/45 passing (30 existing + 15 new
  for vet_seed / turn_cost_usd / CostTracker / fresh-machine /
  contradiction JSON parsing).
- `npm run verify:all` — green except `evals::organism_eval` failing on
  OEVAL-01c. This is the documented v1.4 carry-forward per phase brief.
  No new regressions introduced.

## Commit SHAs

- `2459af7` — feat(49): HUNT-05-ADV — answer-driven probing chain
- `66d9bda` — feat(49): HUNT-06-ADV — thematic contradiction detection
- `dec0e69` — feat(49): HUNT-COST-CHAT — live cost surfacing for hunt + forge
- (this doc) — docs(49): SUMMARY — hunt advanced + cost surfacing complete

## Carry-forward

- `evals::organism_eval::evaluates_organism` — OEVAL-01c "timeline
  recovery arc" still expects scalar ≥ 0.45 but the recovery arc lands
  at 0.4032 (Declining band). Per phase brief this is acceptable v1.4
  carry-forward.
- The cost block extension currently raises the budget by another
  `cfg.hunt.budget_usd` bucket. Future polish: surface a configurable
  multiplier in Settings.
- The contradiction pass's `Cluster.recency` field is currently
  free-form text from the LLM. A v2.2 follow-up could normalise it to
  an enum + drive synthesis weighting from it.
