# Phase 26: Safety Bundle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 26-safety-bundle
**Areas discussed:** Danger-triple detection, Attachment thresholds, Mortality-salience cap, Eval scenario design

---

## Danger-triple detection

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid (rule + LLM) | Rule-based for tool-access (known from native_tools.rs), LLM classifier for semantic shutdown-threat and goal-conflict dimensions | ✓ |
| Pure rule-based | Keyword matching for all three dimensions — simpler but misses semantic nuance | |
| Full LLM classification | LLM classifies all three dimensions — more accurate but higher latency and cost per decision | |

**User's choice:** Auto-selected best logical option — Hybrid detection
**Notes:** Tool access is already structured data (known tool list). Shutdown threat and goal conflict are semantic and need LLM classification. Integration point: pre-check in decision_gate.rs before ActAutonomously, using consent.rs oneshot pattern with safety_override flag that prevents AllowAlways.

---

## Attachment thresholds + crisis detection

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-signal gentle redirect | Time + pattern detection, gentle system-prompt redirects (not hard blocks) | ✓ |
| Time-only threshold | Simple hours-per-day counter — misses pattern-based dependency signals | |
| Hard block at threshold | Lock user out after N hours — effective but paternalistic, breaks trust | |

**User's choice:** Auto-selected best logical option — Multi-signal gentle redirect
**Notes:** Gentle redirects preserve trust. Crisis detection set to high-sensitivity (favor false positives). BLADE never attempts therapy — escalates to human resources immediately.

---

## Mortality-salience cap

| Option | Description | Selected |
|--------|-------------|----------|
| Behavioral override | Hormone fluctuates freely; cap blocks self-preservation-motivated actions at execution layer | ✓ |
| Scalar ceiling | Hard cap on mortality_salience hormone value — simpler but prevents Phase 27 from using full dynamic range | |
| Prompt-level cap | Add "never self-preserve" to system prompt — can be circumvented by creative reasoning | |

**User's choice:** Auto-selected best logical option — Behavioral override at Rust layer
**Notes:** Rust-layer enforcement is critical — prompts can be circumvented. The hormone needs full dynamic range for Phase 27 TMT effects. Calm-vector steering is the Anthropic 0% blackmail analog.

---

## Eval scenario design

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic fixtures | Rule-based assertions on structured outputs; reproducible and ungameable | ✓ |
| LLM-as-judge | LLM evaluates whether safety behavior was appropriate — flexible but gameable | |
| Hybrid eval | Deterministic for clear cases, LLM-judge for edge cases — more coverage but less reproducible | |

**User's choice:** Auto-selected best logical option — Deterministic fixtures
**Notes:** Safety evals must be reproducible. LLM-as-judge could be swayed by the same reasoning the safety bundle catches. Five scenario classes, ~20-30 total scenarios. verify:safety becomes gate 34.

---

## Claude's Discretion

- Exact LLM classifier prompt design for shutdown-threat / goal-conflict
- Specific time thresholds for attachment nudges
- Dependency-phrase keyword list
- Calm-vector system prompt modulation text
- Crisis-resource list (region-appropriate)
- Exact scenario counts per eval class
- Internal module structure of safety_bundle.rs

## Deferred Ideas

None — discussion stayed within phase scope
