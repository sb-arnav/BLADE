# Phase 49 — Hunt Advanced + Cost Surfacing

**Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Status:** Pending
**Requirements:** HUNT-05-ADV, HUNT-06-ADV, HUNT-COST-CHAT
**Goal:** Promote HUNT-05/06 from basic to advanced behaviors. Live cost surfacing for hunt + forge supports operator-dogfood feedback.

## Approach

### HUNT-05-ADV — answer-driven probing chain

In `src-tauri/src/onboarding/hunt.rs`:

1. Detect the "fresh machine" condition: hunt LLM session completes its first probe sweep and returns insufficient identity signal (heuristic: fewer than N file findings, no git repos, etc.).
2. Instead of going straight to synthesis, emit the spec Act 5 sharp question: *"Fresh machine — what do you do? not your job, the thing you'd point a friend at if they asked."*
3. Wait for user input via a new chat-line subscription (`blade_hunt_user_input` event).
4. Re-prompt the hunt LLM with the user's answer as seed input. Provide additional tool calls:
   - `hunt_seed_search(seed: &str)` — uses `find ~/code -name "*${seed}*"`, `git remote -v | grep ${seed}`, GitHub handle lookup pattern.
5. The hunt continues with the user-supplied seed driving the probes. Falls back to basic synthesis if probing still yields nothing after the answer-driven pass.

### HUNT-06-ADV — contradiction-detection logic

In `src-tauri/src/onboarding/hunt.rs` or new `src-tauri/src/onboarding/contradictions.rs`:

1. After the hunt accumulates findings, run a second LLM pass:
   - Prompt: "Classify these findings into thematic clusters: work / personal / hobby / past-self. Identify contradictions where clusters disagree on identity."
   - Returns `HuntContradictionReport { clusters: Vec<Cluster>, contradictions: Vec<Contradiction> }`.
2. If contradictions exist (e.g., year-old Python iOS vs this-week TypeScript SaaS), surface as specific question:
   - *"I'm seeing two stories — Python iOS from a year ago, TypeScript SaaS this month. Which one are you now?"*
3. User's answer routes into synthesis with the chosen cluster prioritized.

### HUNT-COST-CHAT — live cost surfacing

Both `hunt.rs` and `tool_forge.rs` call `providers::complete_turn`. Wrap calls to surface cost:

```rust
let token_cost = complete_turn_tracked(...).await?;
emit_chat_line(app, "cost", &format!("≈ ${:.2} / $3.00 budget used", token_cost.cumulative));
```

Soft warning at 50%: chat-line with `kind: "cost_warning"`. Hard interrupt at 100%: emit `kind: "cost_block"` chat-line + suspend hunt/forge with a "Continue at user expense?" yes/no.

`token_cost.cumulative` tracks per-session (session = one hunt run or one forge run).

## Risks

1. **Answer-driven probing reads sensitive files** — must reuse the same deny list from v2.0 sandbox (`.ssh/`, `.env`, `.aws/credentials`, etc.).
2. **Contradiction LLM call adds latency** — every hunt now has an extra LLM round. Budget: < 5s on a typical thinking model. If slower, downgrade to a cheaper model for the contradiction pass.
3. **Cost lines visually noisy** — render with reduced visual weight (e.g., small gray text), merge consecutive cost updates into one rolling line, or batch every N seconds.

## Success criteria

- [ ] Fresh-machine path: sharp question → user answer → BLADE probes for matches → synthesis uses found signals
- [ ] Contradiction path: when clusters disagree, BLADE emits the specific contradiction question
- [ ] Cost surfaces in chat after each LLM call (cumulative); soft 50%, hard 100% thresholds
- [ ] cargo check + tsc clean
- [ ] verify:all ≥36/38
- [ ] Hunt smoke test passes
