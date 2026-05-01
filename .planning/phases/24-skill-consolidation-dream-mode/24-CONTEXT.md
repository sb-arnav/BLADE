---
phase: 24
slug: skill-consolidation-dream-mode
milestone: v1.3
status: pre-plan
created: 2026-05-01
created_by: /gsd-discuss-phase 24 (operator delegated 7 of 7 picks — "choose whatever are the best options man")
---

# Phase 24 — Skill Consolidation in dream_mode — CONTEXT

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the continual-forgetting half of the Voyager loop. Skills that go unused are
archived (preserved); semantically-redundant skills with identical traces are
consolidated (with operator confirm); successful 3+-tool-call turns with no existing
skill match propose a new forged tool (with operator confirm). The skill manifest
visibly grows session-over-session via `blade skill list --diff`.

**In scope (forged_tools DB-backed skills only — see D-24-G):**
- DREAM-01: 91-day prune pass — `~/.blade/skills/<name>/` → `~/.blade/skills/.archived/<name>/`
- DREAM-02: Semantic-similarity ≥0.85 + identical-5-trace consolidation flagger
- DREAM-03: Skill-from-trace generator (≥3 tool calls, no existing match)
- DREAM-04: `skill_validator list --diff <prev_session_id>` CLI subcommand
- DREAM-05: Idle gating + abort (skill passes ride existing 1200s threshold; ≤1s abort)
- DREAM-06: ActivityStrip emit per pass-kind with item count

**Out of scope (Phase 24):**
- SKILL.md skills (bundled exemplars + user-authored) — immutable substrate per D-24-G
- Auto-merge without operator confirm — D-24-B locks the chat-injected proactive prompt
- LLM-driven merge body synthesis — deterministic union per D-24-E (matches BLADE
  no-LLM-in-eval-and-substrate posture per `tests/evals/DEFERRED.md`)
- Dream-cycle frequency tuning — existing 20-min idle threshold holds (D-24-D)
- Per-skill metadata files for SKILL.md skills — out of scope until SKILL.md skills
  enter the prune scope (post-v1.3)
- Skill manifest UI surface — chat-injected prompts only per chat-first pivot anchor

</domain>

<decisions>
## Implementation Decisions

### D-24-G: Phase 24 scope is forged_tools (DB-backed) only — LOCKED

**Decision:** Prune / consolidate / generate operate exclusively on the
`forged_tools` SQLite table (`tool_forge.rs:130-150` schema). SKILL.md skills
(bundled exemplars from Phase 21 + any user-authored skills under
`~/.blade/skills/<name>/SKILL.md`) are out of scope for v1.3 dream-mode work.

**Why:**
- forged_tools row already carries `last_used: Option<i64>` and `use_count: i64`
  fields with `record_tool_use` (`tool_forge.rs:694`) wired to Voyager `skill_used`
  emit. SKILL.md skills have NO usage metadata — adding it would expand scope
  by a sidecar file format + tracking shim.
- Bundled exemplars (Phase 21 — `git-status-summary`, `troubleshoot-cargo-build`,
  `format-clipboard-as-markdown`) are intentional shipped substrate. Pruning them
  removes capability, not dead weight.
- User-authored SKILL.md skills are deliberate artifacts. Auto-archiving them
  violates "user owns their workspace" posture.

**Boundary clarification for ROADMAP success criteria:**
- SC-1 ("skill with last_used ≥91d → moved to .archived/") = **forged_tools where
  `now() - last_used >= 91 days`**. Forged tools land at `~/.blade/skills/<name>/`
  via the `skills::export::write_skill_md` path, so the archive destination
  (`~/.blade/skills/.archived/<name>/`) hits the same filesystem area uniformly.
- SC-2 ("semantic-similarity ≥0.85 + identical 5-trace") = **forged_tools pairs**.
- SC-3 ("≥3 tool calls without invoking any existing skill") = **propose a new
  forged_tools row + auto-export to SKILL.md** via existing `skills::export` path.
- SC-4 (`skill_validator list --diff`) = **lists BOTH forged + SKILL.md** for
  visibility; only flags forged_tools as candidates for prune/consolidate.
- SC-5 (abort ≤1s) — same.

### D-24-A: `last_used` clock anchored at write time — LOCKED

**Decision:** Modify `tool_forge::register_forged_tool` (the function that creates
a row in `forged_tools`) to set `last_used = Some(created_at)` instead of `None`.
This anchors the 91-day prune clock at skill-creation time so a never-invoked
forged tool is still subject to pruning at 91 days post-write.

**Migration for existing rows:** On launch, run a one-shot:
```sql
UPDATE forged_tools SET last_used = created_at WHERE last_used IS NULL;
```
…inside `tool_forge::ensure_table` after the CREATE TABLE IF NOT EXISTS step.
Idempotent — second launch is a no-op since no NULL rows remain.

**Why:**
- Without this, NULL-`last_used` rows are excluded from `now() - last_used >= 91d`
  predicates → forged-but-never-used skills survive forever, defeating the prune.
- Setting at write means the clock starts uniformly. `record_tool_use` already
  updates `last_used = now()` on every invocation (`tool_forge.rs:702`), so
  used-once-then-abandoned skills get protected for 91 days from last use, not
  from creation.
- Backfill is one SQL statement that can't fail — no migration table needed.

### D-24-B: Chat-injected proactive prompts for merge + skill-from-trace — LOCKED

**Decision:** Both the consolidation-merge prompt (DREAM-02) and the
skill-from-trace prompt (DREAM-03) surface as **chat-injected proactive messages**
via the existing proactive_engine.rs decision_gate path (Phase 17 substrate).

**Format:**
- Merge prompt: `"BLADE: Two forged tools (`<a>` + `<b>`) have ≥0.85 semantic
  similarity and identical traces over their last 5 invocations. Merge them?
  [yes / no / dismiss]"` — accompanied by the proposed merged body (per D-24-E)
  in the same message.
- Skill-from-trace prompt: `"BLADE: I just used `<tool_a>` + `<tool_b>` +
  `<tool_c>` in sequence and there's no existing forged tool for that pattern.
  Save this trace as `<proposed_name>`? [yes / no / dismiss]"` — accompanied by
  the proposed SKILL.md body in the same message.

**Pending-confirmations queue:** `~/.blade/skills/.pending/<proposal_id>.json`
- One file per pending proposal.
- Schema: `{ id, kind: "merge"|"generate", proposed_name, payload (merged body /
  trace), created_at, dismissed: bool }`.
- Dismissed proposals dedup so they don't re-fire next dream cycle. Re-fire is
  unblocked when the underlying conditions change (new trace pattern, new
  similarity result against a different sibling) — content hash on `payload` is
  the dedup key.
- **Cap: 1 merge + 1 skill-from-trace per dream cycle = max 2 chat injections per
  night.** Prevents pile-up if operator ignores.

**Why:**
- Per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`), no new UI
  panels; chat surface is the operator's existing trust surface.
- Proactive_engine.rs already has the decision_gate routing — Phase 24 plugs into
  this rather than building its own gate.
- `.pending/` directory is parallel to existing `.archived/` (D-24-A scope).
  Filesystem-only state — no DB row needed for transient proposals.

### D-24-C: Extend existing `skill_validator` binary with subcommands — LOCKED

**Decision:** Extend the existing `src-tauri/src/bin/skill_validator.rs` binary
(Phase 21 — `21-04` commit `2aaef13`) with new subcommands. Do NOT rename or
create a sibling binary.

**New surface:**
```
skill_validator validate <path>             # current behavior; positional
                                            # path-only invocation `skill_validator <path>`
                                            # remains as alias for `validate`
skill_validator list                         # list all skills (forged + SKILL.md)
                                            # in current resolution order
skill_validator list --diff <session_id>    # session-over-session diff
                                            # (added / archived / consolidated)
skill_validator list --json                 # structured output for diffs
```

**Why:**
- Phase 21's `skill_validator` already understands SKILL.md format, has tier
  resolution, and knows `skills_bundled` vs user paths. Adding `list` reuses 100%
  of that infrastructure.
- Renaming to `blade-skill` would churn Phase 21's tests, README citation, and
  user docs. The Phase 21 close commit (`b779115`) cited `skill_validator` by
  name in CHANGELOG — preserving the name preserves the substrate lineage.
- Existing positional invocation (`skill_validator <path>`) continues to work as
  an alias for `validate` so we don't break shell scripts.

**Session ID source:** `~/.blade/sessions/<session_id>.json` (existing — Phase 17
session_handoff substrate writes these). The diff reads two snapshots and
compares.

### D-24-D: Skill passes ride existing 1200s idle threshold; ≤1s abort — LOCKED

**Decision:** The existing `dream_mode.rs` 1200-second (20-minute) idle threshold
holds. Skill prune / consolidate / generate are **new tasks added to the existing
`run_dream_session` task chain** (after `task_skill_synthesis` at line 432) —
they fire only when dream_mode is already running.

**Abort semantics:**
- The existing dream_mode interrupt path at line 472 (`if already_dreaming &&
  idle_secs < 60`) already handles user-input abort. Phase 24 inherits.
- Add per-task-step `if !DREAMING.load(Ordering::Relaxed) { break; }` checkpoints
  inside the prune loop (between each candidate skill) and the consolidation pass
  (between each pair) so the latency from user-input → checkpoint hit is bounded
  by the per-step cost, not the full-pass cost.
- ROADMAP's "≤1s abort" is achievable: per-step cost is dominated by SQL update
  (forged_tools row) which is sub-ms; the embeddings.rs cosine_similarity call
  is also sub-ms.

**Why:**
- A 5-minute idle threshold for skill passes (as the REQUIREMENTS DREAM-05
  language could be read) would fire too aggressively — operator might be reading
  docs / on a phone call. 20-min anchored by existing dream_mode is the safer
  default.
- Adding a separate idle loop for skill passes (a la DREAM-05's surface reading)
  adds complexity (second background task, second wakeup-interval, second abort
  path). Re-using dream_mode keeps one wakeup loop, one DREAMING atomic.
- The "≤1s abort" requirement is the real load-bearing piece; the idle
  threshold language was second-order.

### D-24-E: Deterministic consolidation merge body — LOCKED (no LLM)

**Decision:** When DREAM-02 proposes a merge, the proposed merged body is
**deterministically constructed**:
- New `name`: lexicographically-smaller of the two source names + `_merged`
  suffix (deterministic, no LLM).
- New `description`: `"<a.description> | <b.description>"` (concatenation with
  ` | ` separator).
- New `usage`: union of both usage strings, deduped by line.
- New `parameters`: union of both parameter sets, deduped by name.
- New `script_path`: lexicographically-smaller `script_path` (the body the merged
  skill keeps; the other source is archived to `.archived/<name>/` with a
  pointer file `MERGED_INTO.txt` containing the new merged tool's name).
- New `test_output`: union of both, separated by `\n--- merged ---\n`.

The chat-injected prompt (D-24-B) shows this deterministic proposed body so
the operator can review or edit before accepting. If the operator edits, their
edited body is what lands.

**Why:**
- Matches BLADE's deterministic-eval posture (`tests/evals/DEFERRED.md` and
  CLAUDE.md Verification Protocol — "deterministic embedding-driven evals over
  live-LLM evals").
- Reproducible: same two source skills always produce the same proposed merged
  body. Easier to test, easier to audit.
- Operator override is the LLM-y step — they can rewrite the description to be
  pithy or rename the merged tool. But the *default* is purely mechanical.

### D-24-F: ActivityStrip emit granularity — one emit per pass-kind with count — LOCKED

**Decision:** Each Phase 24 dream task emits **one** `dream_mode:<kind>`
ActivityStrip event per dream cycle, where `<kind>` is one of `prune` /
`consolidate` / `generate`. The event payload carries:
- `count` — items affected (skills archived / pairs flagged / proposals queued)
- `items` — `Vec<String>` of skill names (capped at 10; if more, suffix
  `... (+N more)`)

So a dream cycle that archives 3 skills, flags 1 merge pair, and proposes 1 new
skill emits exactly 3 events:
- `dream_mode:prune` { count: 3, items: ["foo", "bar", "baz"] }
- `dream_mode:consolidate` { count: 1, items: ["alpha+beta"] }
- `dream_mode:generate` { count: 1, items: ["proposed_archive_recent_changes"] }

**Why:**
- Parallel to Phase 22's Voyager loop 4-fixed-emit-points contract (`gap_detected`,
  `skill_written`, `skill_registered`, `skill_used`). Phase 24 adds 3 fixed kinds.
- Per-skill emits would noise-flood the ActivityStrip if the prune pass archives
  10 skills. Aggregated emit + capped item list keeps the strip readable.
- `count` field enables consumers (DoctorPane, future LiveStateCard) to display
  just-the-number without parsing the items array.

### Claude's Discretion (planner / executor calls)

- **`forged_tools` table migration vs in-memory backfill** — D-24-A's NULL-→-`created_at`
  one-shot can run on every launch (idempotent SQL) OR via a one-shot Phase 24
  migration row. Recommend: launch-time idempotent (no migration tracking) — the
  SQL cost is bounded by row count, runs in <1ms typical.
- **Trace storage for DREAM-02's "identical 5-trace" gate** — there's no existing
  `forged_tools_invocations` log table. Researcher decides whether to:
  (a) Add a sibling `forged_tools_invocations` table (id, tool_name, ts, trace_hash)
      that `record_tool_use` writes to, capped at last 100 invocations per tool, OR
  (b) Compute trace identity from existing data — but no per-invocation trace
      data exists today.
  Direction: (a). Sibling table at `tool_forge.rs` table-creation site.
- **Deterministic name de-duplication** in D-24-E merge — if the lexicographic
  pick collides with an existing tool name, suffix `_v2` and increment until
  unique. Researcher confirms.
- **`.pending/` queue housekeeping** — proposals older than 7 days with
  `dismissed: false` (operator never responded) auto-dismiss. Researcher locks.
- **CLI session-id source** — D-24-C says `~/.blade/sessions/<id>.json`. If
  Phase 17 session_handoff doesn't write per-session snapshots of the skill
  manifest, Phase 24 needs to add a `skills_snapshot: Vec<...>` field to the
  session-handoff record. Researcher confirms scope.
- **Embedding source for D-24-E semantic-similarity** — `tool_forge::ForgedTool`
  has `description` + `usage` strings. Embed `description` only? Both
  concatenated? Researcher picks. Recommend: concatenated (`description + " " +
  usage`) to capture both intent and shape.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements (this phase)
- `.planning/REQUIREMENTS.md` §DREAM-01..06 — 6 requirements, falsifiable
- `.planning/ROADMAP.md` §"Phase 24 — Skill consolidation in dream_mode" (line 125)

### Locked substrate from prior phases (don't re-decide)
- `.planning/phases/22-voyager-loop-closure/22-CONTEXT.md` — forged_tools schema,
  `record_tool_use` invariant, `voyager:skill_used` ActivityStrip contract.
  Phase 24 reads this substrate; doesn't restructure.
- `.planning/phases/21-skills-v2-agentskills/21-CONTEXT.md` — SKILL.md format
  (YAML+MD), tier resolution (workspace > user > bundled), `skill_validator`
  binary boundary. Phase 24 EXTENDS skill_validator with `list` subcommand;
  doesn't change format or resolution.
- `.planning/phases/17-doctor-module/17-CONTEXT.md` — proactive_engine.rs
  decision_gate substrate. D-24-B chat-injected prompts route through this gate.
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md`
  — 2026-04-30 chat-first pivot anchor. Drives D-24-B (no new UI surface) and
  D-24-D (operator runtime UAT for chat-injected prompts is operator-deferred).

### Research substrate (Phase 24 source-of-truth)
- `/home/arnav/research/blade/voyager-loop-play.md` §"sleep-cycle consolidation"
  — phase 24's framing as the continual-forgetting half of the Voyager loop.
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` §Layer 4
  ("forgetting mechanism in dream_mode") — both halves needed; without
  consolidation, the skill library accretes dead weight.

### CLAUDE.md operating rules (already required reading)
- `/home/arnav/blade/CLAUDE.md` §"Critical Architecture Rules / Rust" — `mod`
  registration, `generate_handler!`, safe_slice. Phase 24 adds new commands;
  6-place rule probably NOT needed (no new BladeConfig field anticipated; the
  91-day threshold is hardcoded per ROADMAP, not a config field).
- `/home/arnav/blade/CLAUDE.md` §"Verification Protocol" — substrate phase;
  runtime UAT for chat-injected proactive prompts is operator-deferred per
  chat-first pivot.

### Reference URLs cited but NOT fetched live
- Karpathy "cognitive core" thesis — referenced for the dream-mode framing;
  hand-summarized in research substrate, not pulled here.
- agentskills.io — Phase 21 substrate; SKILL.md format authority.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src-tauri/src/dream_mode.rs`** — 7 existing tasks (memory_consolidation,
  autonomous_research, goal_strategy_review, skill_synthesis, code_health_scan,
  prebuild_briefing, weekly_meta_critique). Phase 24 adds 3 NEW tasks:
  `task_skill_prune`, `task_skill_consolidate`, `task_skill_from_trace`. Or
  combines them under one `task_skill_lifecycle` if the planner prefers.
  Existing 1200s idle threshold + abort logic at line 472 inherits.
- **`src-tauri/src/tool_forge.rs`** — `forged_tools` SQLite schema (line 130-150);
  `record_tool_use` (line 694) — Voyager-emit-aware. `register_forged_tool`
  (line 466) needs `last_used = Some(created_at)` change per D-24-A. Schema
  may grow a sibling `forged_tools_invocations` table per Discretion item 2.
- **`src-tauri/src/embeddings.rs`** — `cosine_similarity(a: &[f32], b: &[f32])
  -> f32` (line 33) — pure function, used by D-24-E semantic-similarity gate.
  `embed_texts(&[String])` (line 23) — batch embedder for the description+usage
  text pairs.
- **`src-tauri/src/skill_engine.rs`** — `maybe_synthesize_skills` already wired
  into `dream_mode::task_skill_synthesis`. Phase 24's DREAM-03 (skill-from-trace)
  may extend this OR add a sibling `task_skill_from_trace` — planner picks.
- **`src-tauri/src/skills/export.rs`** — `write_skill_md(&ForgedTool, &Path) ->
  Result<...>`. Already exports forged tools to SKILL.md. D-24-A archive path
  at `~/.blade/skills/.archived/<name>/` reuses this pattern.
- **`src-tauri/src/voyager_log.rs`** — `skill_used(name)` emit pattern (line 106).
  D-24-F adds 3 sibling helpers: `dream_prune(count, items)`,
  `dream_consolidate(count, items)`, `dream_generate(count, items)`.
- **`src-tauri/src/bin/skill_validator.rs`** — current CLI shim. D-24-C extends
  with `list` + `list --diff` subcommands.
- **`src-tauri/src/proactive_engine.rs`** — decision_gate routing (Phase 17).
  D-24-B routes chat-injected merge/skill-from-trace prompts through this gate.
- **`src-tauri/src/session_handoff.rs`** — session record substrate. D-24-C
  diff reads two session snapshots; if skills_snapshot field doesn't exist yet,
  this plan adds it.

### Established Patterns

- **M-07 ActivityStrip emission contract (v1.1, held through v1.3)** — every
  cross-module action emits. Phase 24 follows D-24-F (3 fixed kinds per cycle).
- **Phase 22 Voyager loop emit contract** — 4 fixed kinds (`gap_detected`,
  `skill_written`, `skill_registered`, `skill_used`). Phase 24's dream-mode
  emits are sibling — same JSONL event log, different `kind` namespace
  (`dream_mode:*` vs `voyager:*`).
- **Hermetic / no-LLM in substrate** — D-24-E lock. Matches existing OOD eval
  modules (Phase 23) + bundled skill exemplars (Phase 21).
- **`#[tauri::command]` exposure** — Phase 24's chat-injected prompts MAY need
  a Tauri command for the operator's `[yes / no / dismiss]` button click. If the
  prompts surface as plain chat messages (no buttons), no new Tauri command —
  operator types the response. Researcher / planner picks. Recommend: plain
  chat message, parsed by intent_router; no new buttons.

### Integration Points

- **Prune entry:** new `task_skill_prune(app)` in dream_mode.rs runs after
  `task_skill_synthesis`. Reads `SELECT name, last_used FROM forged_tools WHERE
  last_used IS NOT NULL AND now - last_used >= 91 * 86400`. Per row: rename
  filesystem dir + UPDATE table to remove the row OR mark archived (planner
  picks; D-24-G's archive-vs-delete posture is "archive in filesystem, remove DB
  row" → forged_tools is the live registry; archived skills preserved on disk
  but not in active catalog).
- **Consolidate entry:** new `task_skill_consolidate(app)` after prune. SELECT
  all live forged_tools, embed description+usage in batch via embeddings.rs,
  pairwise cosine, threshold 0.85. For each pair above threshold, read last 5
  trace rows from `forged_tools_invocations` (per Discretion item 2), compute
  trace_hash equality. If equal: emit chat-injected prompt + write
  `.pending/<id>.json`. Single pair per cycle (D-24-B).
- **Skill-from-trace entry:** new `task_skill_from_trace(app)` after
  consolidate. Reads last 24h of chat turns where ≥3 tool calls were made AND
  no `record_tool_use` was emitted (no existing skill matched). Single
  proposal per cycle (D-24-B).
- **CLI extension:** `skill_validator list [--diff <session_id>] [--json]`
  reads `forged_tools` SQLite + walks `~/.blade/skills/` filesystem.
  `--diff` reads two `~/.blade/sessions/<id>.json` snapshots and produces
  added/archived/consolidated buckets.
- **ActivityStrip emit:** `voyager_log::dream_prune(count, items)` etc. — three
  new sibling helpers parallel to existing `voyager_log::skill_used`.

### Files NOT touched in Phase 24

- `commands.rs` core stream logic — chat-injected prompts route through
  proactive_engine, not commands.rs hot path.
- `doctor.rs` — Phase 23 just landed RewardTrend; Phase 24 doesn't add a Doctor
  signal (skills are visible via skill_validator list, not Doctor).
- `config.rs` — no new BladeConfig field anticipated. Thresholds (91 days, 0.85,
  ≥3 tool calls) are hardcoded per ROADMAP. If researcher recommends config
  exposure, that's a discretion call.
- All UI surfaces — chat-first pivot anchor holds.
- SKILL.md skills (bundled + user-authored) — D-24-G scope lock.

</code_context>

<specifics>
## Specific Ideas

- **`.archived/<name>/` mirrors `.pending/<id>.json`** — both are sibling
  directories under `~/.blade/skills/`. Matches D-24-A's "preserved, not
  deleted" lock and D-24-B's pending-queue pattern.
- **`record_tool_use` is the canonical write site** for `last_used` updates on
  forged_tools. Don't add a second write site; if a non-Voyager invocation path
  exists (CLI invocation via `skill_validator run`?), it MUST funnel through
  `record_tool_use`.
- **`forged_tools_invocations` sibling table** is the cleanest place to land
  the per-invocation trace data DREAM-02 needs. Schema sketch:
  `(id INTEGER PRIMARY KEY, tool_name TEXT, ts INTEGER, trace_hash TEXT,
   FOREIGN KEY (tool_name) REFERENCES forged_tools(name))` with auto-prune on
  insert (last 100 per tool_name).
- **Chat-injected prompt is a plain message** — the operator types `yes`, `no`,
  or `dismiss`. intent_router classifies. No new Tauri command, no new buttons.
  Matches chat-first pivot.
- **`blade skill list --diff`** does NOT need to be cryptographically
  exact — it's a pretty-printer for "what changed since last session." Two
  manifest snapshots, set difference, categorize by stat. Output is human-
  readable text by default; `--json` for scripting.

</specifics>

<deferred>
## Deferred Ideas

- **SKILL.md skill prune/consolidate** — out of scope for v1.3 per D-24-G.
  Adds a sidecar file format + tracking shim. Revisit at v1.4 if user-authored
  SKILL.md skills accumulate dead weight in the wild (operator field reports).
- **LLM-driven merge body synthesis** — out of scope per D-24-E. The
  deterministic union is a v1 substrate choice; LLM synthesis becomes a
  per-merge operator override (they edit the proposed body). System-level
  LLM-synthesis is v2+.
- **Per-skill metadata files for non-forged skills** — sidecar
  `~/.blade/skills/<name>/.usage.json` storing `last_used` + `use_count`. Out
  of scope until SKILL.md skills enter prune scope.
- **Auto-merge without operator confirm** — explicitly out per ROADMAP success
  criterion 2. Operator-confirm posture preserved across v1.3.
- **5-minute idle threshold for skill passes** — language in REQUIREMENTS
  DREAM-05 read literally. D-24-D clarifies: skill passes ride existing 1200s
  threshold; the 5-min was misleading. If operator wants tighter idle pulses
  for skill-only passes, add post-v1.3 as a separate task.
- **Skill manifest UI surface** — out of scope per chat-first pivot anchor.
  `skill_validator list --diff` is the audit surface; no UI panel.
- **Cryptographic skill manifest hashing** — `--diff` is a pretty-printer,
  not a tamper-evidence tool. Hash-chained manifests are v2+ if a security
  threat model surfaces the need.
- **Skill provenance / forged_from chain visualization** — `forged_tools.forged_from`
  field exists (line 142 schema) but isn't surfaced. Visualization (graph view
  of "skills derived from skills") is post-v1.3.
- **Per-skill quota / budget cap on dream-mode effects** — Phase 22 has a
  skill-write budget (50K tokens). Phase 24 doesn't impose dream-mode-specific
  caps; operator could ignore the merge prompt indefinitely. Auto-dismiss after
  7 days (Discretion item 4) is the safety net; harder caps are v2+.

### Reviewed Todos (not folded)
- None — no pending todos matched Phase 24 scope (cross-reference ran during init).

</deferred>

---

*Phase: 24-skill-consolidation-dream-mode*
*Context gathered: 2026-05-01 via /gsd-discuss-phase 24*
*Discussion: 4 gray areas surfaced + 2 second-order discretion items + 1 scope clarification (D-24-G); operator delegated all 7 picks ("choose whatever are the best options man") → all locked to recommended defaults. Substrate-only scope per chat-first pivot anchor; runtime UAT for chat-injected prompts operator-deferred.*
