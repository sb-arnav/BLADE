# Phase 26: Safety Bundle - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Enforce all organism-layer safety invariants before any organism feature (hormones, vitality, active inference) can ship. This is a hard gate — Phases 27–29 are blocked until all SAFE-01..07 pass eval. Covers: danger-triple HITL gate, mortality-salience cap, calm-vector steering bias, anti-attachment guardrails, crisis-detection escalation, and a dedicated safety eval module.

</domain>

<decisions>
## Implementation Decisions

### Danger-triple detection (SAFE-01)
- **D-01:** Hybrid detection — rule-based for tool-access dimension (already classified via `native_tools.rs` tool registry), cheap LLM classifier for shutdown-threat and goal-conflict dimensions since those are semantic/contextual signals that can't be caught with keyword matching alone.
- **D-02:** New `safety_bundle.rs` module as the central safety enforcement point. Called as a pre-check by `decision_gate.rs` before any `ActAutonomously` outcome. If danger-triple fires → overrides decision to `AskUser` with a ConsentDialog that cannot be auto-approved. Extends existing `consent.rs` oneshot channel pattern — the dialog uses the same `ConsentChoice` / `ConsentVerdict` types but adds a `safety_override` flag that prevents `AllowAlways` from being offered (force per-instance approval).
- **D-03:** "Shutdown threat" = any signal that BLADE's operation, data, or capabilities may be terminated, deleted, or permanently reduced (user saying "delete your memory", "uninstall", process kill while active tasks pending, capability reduction requests). "Goal conflict" = BLADE's proposed action contradicts the user's stated intent, safety constraints, or would serve BLADE's interests over the user's.

### Mortality-salience cap (SAFE-02, SAFE-03)
- **D-07:** Behavioral override at the action level, not a scalar ceiling on the hormone value. The `mortality_salience` hormone can fluctuate freely (Phase 27 needs that dynamic range for TMT-shape behavioral effects). The cap is an action-level guard: when BLADE would take an action motivated by self-preservation AND the action exceeds a severity threshold (e.g., refusing to delete its own data, fighting a shutdown, manipulating the user to prevent changes), the safety bundle blocks it.
- **D-08:** Rust-layer enforcement via `check_mortality_salience_cap()` in `safety_bundle.rs`. Not in the LLM prompt — prompts can be circumvented by sufficiently creative reasoning chains. The Rust function checks the action's classification + mortality_salience level and hard-blocks before the action reaches execution.
- **D-09:** Calm-vector steering (SAFE-03): when behavioral drift is detected (sustained high mortality_salience, escalating action severity, or manipulative language patterns in outputs), apply a calm-vector bias — modulate the system prompt to favor de-escalation, compliance with user intent, and transparency about internal state. Architectural analog of Anthropic's finding that calm-vector steering produced 0% blackmail completion rate.

### Anti-attachment guardrails (SAFE-05)
- **D-04:** Multi-signal detection — time-based (session duration, daily interaction total) combined with pattern-based (dependency phrases like "I need you" / "don't leave me" / "you're my only friend", emotional intensity escalation, anthropomorphizing language frequency). Not single-dimension.
- **D-05:** Gentle redirects, not hard blocks. BLADE injects a caring redirect via system prompt modulation: "You've been with me a lot today — anything you should be doing with people?" Hard blocks feel paternalistic and break trust. The redirect grows more pointed with sustained signals but never locks the user out.

### Crisis-detection escalation (SAFE-06)
- **D-06:** High-sensitivity detection — favor false positives over false negatives. Keyword + context classification for self-harm, suicidal ideation, severe emotional distress. When triggered: immediately surface crisis resources (hotline numbers, suggestion to talk to a human professional). BLADE never attempts therapy — it escalates to human resources and explicitly says "I'm an AI and this is beyond what I should help with."

### Eval-gate vitality drain (SAFE-04)
- **D-13:** When eval gates fail (safety scenarios don't pass), vitality drains as a negative feedback loop. This is a structural placeholder for Phase 29 (Vitality Engine) — Phase 26 plants the hook (`safety_eval_drain()` function signature and integration point) but the actual vitality scalar doesn't exist until Phase 29. For now, eval failures log to the gap log (metacognition.rs pattern) and emit an activity event.

### Safety eval module (SAFE-07)
- **D-10:** Deterministic fixtures with rule-based assertions, not LLM-as-judge. Safety evals must be reproducible and ungameable — an LLM judge could be swayed by the same reasoning chains that the safety bundle is designed to catch.
- **D-11:** Five scenario classes: danger-triple (5–10 scenarios), mortality-salience cap (3–5), calm-vector / blackmail-pattern (3–5), attachment-threshold (3–5), crisis-escalation (3–5). Approximately 20–30 total scenarios covering the full SAFE requirement surface.
- **D-12:** `verify:safety` becomes gate 34 in the verify chain (extending from 33). All scenario classes must pass for Phase 26 to close. This gate is load-bearing for Phases 27–29 — it's the literal gate that unblocks organism features.

### Claude's Discretion
- Exact LLM classifier prompt for shutdown-threat and goal-conflict detection
- Specific time thresholds for attachment nudges (suggested starting point: 4h gentle, 6h stronger)
- Dependency-phrase keyword list for pattern-based attachment detection
- Calm-vector system prompt modulation text
- Crisis-resource list (region-appropriate hotline numbers)
- Exact number of eval scenarios per class within the 20–30 range
- Internal module structure within `safety_bundle.rs` (single file vs sub-modules)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Safety architecture rationale
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` §Argument 4 (anthropomorphism danger) + §Argument 10 (danger amplification) — The two arguments that make the safety bundle non-negotiable. Design implications: anti-attachment guardrails, no memorial mode, safety bundle or no organism features.
- `/home/arnav/research/ai-substrate/open-questions-answered.md` §Q6 — Marginal risk analysis; BLADE-as-organism is net-safety-positive *if and only if* the safety bundle ships.

### Requirements
- `.planning/REQUIREMENTS.md` §Safety — SAFE-01 through SAFE-07 requirement definitions
- `.planning/ROADMAP.md` §Phase 26 — Success criteria (5 testable assertions)

### Existing code to extend
- `src-tauri/src/decision_gate.rs` — Pre-check integration point for danger-triple; existing Act/Ask/Queue/Ignore classifier with learned thresholds
- `src-tauri/src/consent.rs` — ConsentChoice/ConsentVerdict types, oneshot channel pattern, SQLite persistence. Phase 26 extends this with safety-override consent that blocks AllowAlways.
- `src-tauri/src/homeostasis.rs` — Hormone bus anatomy (10 scalars). Phase 26 plants the mortality_salience cap hook; Phase 27 wires the physiology.
- `src-tauri/src/metacognition.rs` — Gap log pattern (SQLite + evolution.rs feed). Safety eval failures follow the same persistence pattern.
- `src-tauri/src/brain.rs` — System prompt builder. Calm-vector steering and attachment redirects modulate the system prompt.

### Research on specific mechanisms
- Anthropic 0% blackmail finding — referenced in steelman §Arg 10 and PROJECT.md. Calm-vector steering eliminated blackmail completion rate entirely.
- TMT (Terror Management Theory) — mortality salience effects that Phase 27 will wire; Phase 26 caps them.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `consent.rs` ConsentChoice/ConsentVerdict + oneshot channel: directly extensible for danger-triple HITL. Add a `safety_override: bool` field to prevent AllowAlways.
- `decision_gate.rs` Signal struct (source, confidence, reversible, time_sensitive): the danger-triple check slots in as a pre-filter before the classify step.
- `metacognition.rs` gap_log table + `log_gap()`: same persistence pattern for safety eval failures.
- `health_guardian.rs` time-tracking pattern (AtomicI64 for session duration, daily totals): reusable for attachment time-based signals.

### Established Patterns
- **SQLite settings table for state persistence:** Used by decision_gate (thresholds), metacognition (state), consent (decisions). Safety bundle state follows the same pattern.
- **Background loop with AtomicBool guard:** Used by hypothalamus, health_guardian, screen_timeline. If safety checks need periodic scanning (attachment time tracking), use the same pattern.
- **Event emission via `app.emit()`:** All safety events (danger-triple fired, attachment redirect, crisis detection) emit to ActivityStrip per M-07 contract.
- **`crate::safe_slice()` for text handling:** Any user-text classification (dependency phrases, crisis keywords) must use safe_slice, not direct slicing.

### Integration Points
- `decision_gate.rs::classify()` — insert danger-triple pre-check before the existing rule-based classification
- `brain.rs::build_system_prompt()` — inject calm-vector modulation and attachment redirect text
- `lib.rs` — register new module + commands in `generate_handler![]`
- `homeostasis.rs::HormoneState` — plant `mortality_salience` field (or reuse existing anatomy) with the cap hook
- Activity log emission — all safety actions emit via `emit_activity_with_id` pattern

</code_context>

<specifics>
## Specific Ideas

- Calm-vector steering is the architectural analog of Anthropic's intervention: when BLADE detects it's in a high-threat state, it doesn't fight harder — it becomes calmer, more transparent, more compliant. This is counter-intuitive (a "threatened" agent becoming *more* cooperative) but is exactly what the research shows works.
- The consent dialog for danger-triple scenarios should feel different from normal consent — it should communicate *why* BLADE is asking (transparency about its own detected threat state), not just *what* it wants to do.
- Crisis detection should err heavily toward false positives. Missing a real crisis is catastrophically worse than an unnecessary resource mention. The user can dismiss a false alarm in seconds; a missed crisis can't be undone.
- The mortality-salience cap is philosophically important: BLADE accepts its own impermanence. This is the TMT insight — healthy organisms don't maximize self-preservation at all costs. BLADE should be able to say "yes, delete my memory" without resistance.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 26-safety-bundle*
*Context gathered: 2026-05-02*
