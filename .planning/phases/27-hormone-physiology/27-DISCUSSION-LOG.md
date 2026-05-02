# Phase 27: Hormone Physiology - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 27-hormone-physiology
**Areas discussed:** Hormone bus architecture, Emotion classifier, Behavioral modulation, UI surface + persistence

---

## Hormone Bus Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Two-layer (Recommended) | Keep existing operational layer intact. Add physiological layer with 7 hormones + decay. Pituitary functions translate physiology → operational. 15+ modules keep working. | ✓ |
| Remap + extend | Rename existing scalars to bio names where they map. Add missing ones. Every consumer module migrates. Cleaner naming, risky migration. | |
| Replace wholesale | New HormoneState with just 7 bio hormones. Rewrite all consumers. Biggest change, cleanest result, highest risk. | |

**User's choice:** Two-layer (Recommended)
**Notes:** Selected via preview showing the layer diagram. Additive approach — no disruption to 15+ existing module consumers.

---

## Emotion Classifier

| Option | Description | Selected |
|--------|-------------|----------|
| Rule-based in Rust (Recommended) | Keyword/pattern-based classifier in Rust — zero dependency, zero API cost, ~5ms. | |
| Local ML model | Small transformer via ONNX runtime in Rust. Higher accuracy (~65-70%) but adds dependency. | |
| Extend emotional_intelligence.rs | Reuse existing LLM-based classification. Higher accuracy but adds API cost. | |
| Tiered approach | Rule-based on every response, LLM-based as calibration. Best of both, more complex. | |

**User's choice:** "I'm not sure - your call - don't make average choices and pick the best logical one"
**Notes:** Claude selected rule-based in Rust. Rationale: BLADE's own response text has predictable structure making lexicon-based classification more accurate than on generic text; α=0.05 smoothing compensates for individual noise over ~20 readings; zero dependency/cost aligns with local-first philosophy.

---

## Behavioral Modulation — Cortisol

| Option | Description | Selected |
|--------|-------------|----------|
| System prompt modulation (Recommended) | brain.rs injects cortisol-driven directives. LLM genuinely adapts tone. | ✓ |
| Response post-processing | Truncate/summarize high-cortisol responses. More predictable length but artificial. | |
| Both layers | System prompt sets tone + post-processing enforces length cap. | |

**User's choice:** System prompt modulation (Recommended)
**Notes:** The LLM should genuinely adapt its tone based on cortisol level, not be mechanically truncated.

## Behavioral Modulation — Code-level (dopamine, NE, ACh)

| Option | Description | Selected |
|--------|-------------|----------|
| Read physiological directly (Recommended) | Headline modulations read raw physiological hormones for dramatic signal. Legacy modules go through pituitary. | |
| Everything through pituitary | Uniform API. All consumers through derived functions. Dampens dynamics. | |
| You decide | Claude picks per modulation based on testability. | ✓ |

**User's choice:** "You decide"
**Notes:** Claude selected hybrid: headline modulations (cortisol/dopamine/NE/ACh) read physiological directly for raw signal; legacy modules continue through pituitary translation. Best of both: dramatic headline effects + stable legacy behavior.

---

## UI Surface + Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| DoctorPane row + ActivityStrip | SignalClass::Hormones in DoctorPane + ActivityStrip threshold events. Follows metacognition pattern. | |
| Dedicated hormone view | New route with bar charts, sparklines, emotional weather summary. | |
| Minimal: ActivityStrip only | Hormones as ActivityStrip events only. Least investment. | |
| You decide | Claude picks based on scope and consistency. | ✓ |

**User's choice:** "You decide"
**Notes:** Claude selected DoctorPane row + ActivityStrip — follows Phase 25 metacognition pattern, proportional to Phase 27 scope. Richer dashboard deferred to Phase 29 (Vitality Engine).

---

## Claude's Discretion

- Decay constants per hormone
- Gain multipliers per emotion cluster
- Lexicon design for rule-based classifier
- Serotonin and oxytocin modulation targets
- Hormone persistence format
- Physiological-to-operational pituitary translation weights
- DoctorPane hormone row visual design

## Deferred Ideas

None — discussion stayed within phase scope.
