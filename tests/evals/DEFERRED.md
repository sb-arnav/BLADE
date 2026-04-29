# Deferred Evals — v1.3 candidates

These evals require live LLM API calls, which means budget per CI run and
non-determinism that doesn't fit the Phase-16 floor model. Each entry documents
the rationale, a per-run cost estimate at current OpenAI/Anthropic pricing, and
the trigger condition that would justify promoting it from a stub to a live
eval module.

Phase 16 (2026-04-29) does NOT implement these. It implements only the
deterministic, embedding-and-keyword-driven evals where local fastembed +
hand-crafted fixtures produce reproducible floor checks.

---

## extract_conversation_facts precision

**Rationale:** `memory.rs::extract_conversation_facts` calls a chat-completion
model with a fact-extraction prompt, then parses JSON output into `TypedMemory`
rows. Eval requires (a) a corpus of conversation transcripts with hand-labelled
"facts that should be extracted" ground truth, (b) live LLM call per
transcript, (c) precision/recall comparison against ground truth. None of
(a)–(c) lands in 2 days.

**Budget:** 50 transcripts × ~1k input tokens × ~300 output tokens on a cheap
model (Haiku / GPT-4o-mini) ≈ $0.15–$0.30 per CI run. Manageable but
unbudgeted. Cumulative cost over a year of CI runs at 1 run/day ≈ $50–$110.

**Promotion trigger:** when v1.3 ships a curated 50-transcript corpus with
ground-truth labels (probably hand-labelled from real BLADE conversation logs
after operator consent), AND when CI cost budget is allocated for $5–$10/month.

---

## weekly_memory_consolidation correctness

**Rationale:** `memory.rs::weekly_memory_consolidation` is a stochastic
LLM-driven process — given the same input on different days, the merge
decisions can differ. Eval requires either (a) deterministic seed +
fixed-prompt assertion, which fights the LLM, or (b) statistical assertions
across N runs, which is multi-run-cost. Neither fits the Phase-16 single-run
floor model.

**Budget:** 1 consolidation pass = ~5k input tokens × ~2k output ≈ $0.05 per
run on a cheap model. Cheap individually but multi-run statistical assertions
multiply (e.g. "merge correctness ≥ 80% across 10 runs" = $0.50/CI run).

**Promotion trigger:** when v1.3 introduces a "consolidation determinism"
config (e.g. temperature=0, fixed seed if model supports), enabling
assert-on-output. Or when statistical floor framework lands (e.g. "merge
correctness ≥ 80% across 10 runs"), which is its own eval-infra investment.

---

## evolution suggestion quality

**Rationale:** `evolution.rs::run_evolution_cycle` is the autonomous loop that
suggests capability upgrades based on detected app patterns. "Is this
suggestion useful?" is fundamentally a human-judgement call. Eval requires
either (a) hand-labelled ground truth ("for app context X, suggestion Y is
good / Y' is bad"), which requires periodic re-labelling as the catalog
evolves, or (b) downstream metric ("suggestion led to install AND user didn't
dismiss within N days"), which requires telemetry BLADE deliberately doesn't
collect (zero telemetry, per PROJECT.md).

**Budget:** $0.50–$1.00 per cycle (full cycle is many tool calls + LLM
reasoning). Highest cost of the deferred set. At 1 CI cycle/day = $180–$365/yr.

**Promotion trigger:** when the user opt-in feedback channel for evolution
suggestions ships (thumbs-up/down on `CapabilityReports.tsx`), accumulated
feedback becomes the eval corpus. Deferred to v1.3+ feedback-loop work.

---

## auto_resolve_unknown_gap resolution quality

**Rationale:** `capability_gap.rs::auto_resolve_unknown_gap` (v1.2 acting layer
candidate) takes an `UnknownAppGap` row — an app/screen the user invoked that
BLADE has no first-party adapter for — and decides whether to (a) prompt the
operator to install a community MCP, (b) auto-route to a generic browser-use
fallback, or (c) defer with a placeholder. Quality eval requires labelling
real `UnknownAppGap` rows with the *correct* resolution path, which depends
on context BLADE doesn't have at decision time (does the operator already
have the MCP? Is the browser-use fallback reliable for this surface?).

**Budget:** ~$0.10 per gap × N gaps in the eval corpus. Cheap, but the
labelling cost is the bottleneck — each gap row needs a human reviewer who
knows the operator's installed MCP catalog AND the browser-use reliability
matrix.

**Promotion trigger:** when v1.3 acting layer ships its first `auto_resolve`
implementation AND a 30+ row labelled corpus exists. Earliest realistic
candidate is v1.3 mid-cycle once the acting layer has been live long enough
to accumulate real gap rows.

---

*Phase 16 ships the deterministic 5-eval baseline (hybrid_search,
real_embedding, kg_integrity, typed_memory, capability_gap). These four are
queued for v1.3 once budget + corpora + feedback channels exist.*
