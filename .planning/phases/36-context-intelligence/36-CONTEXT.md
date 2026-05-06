# Phase 36: Context Intelligence — Context

**Gathered:** 2026-05-06
**Status:** Ready for planning
**Source:** Synthesised directly from ROADMAP.md, REQUIREMENTS.md, PROJECT.md, CLAUDE.md, the Phase 32 closure (32-CONTEXT.md), Phase 33 closure (33-CONTEXT.md), Phase 34 closure (34-CONTEXT.md + 34-11-SUMMARY.md), Phase 35 closure (35-CONTEXT.md), and codebase grounding at knowledge_graph.rs (916 lines, KnowledgeNode/KnowledgeEdge), router.rs (663 lines, classify_task + select_provider), capability_probe.rs (479 lines, static ProviderMatrix), brain.rs (3053 lines, build_system_prompt_inner + LAST_BREAKDOWN + score_or_default), indexer.rs (643 lines, CodeSymbol + project FTS), commands.rs (3030+ lines, send_message_stream_inline). Autonomous decisions per Arnav's instruction; no interactive discuss-phase.

<domain>
## Phase Boundary

**What this phase delivers:**
BLADE understands the *shape* of a codebase before injecting context. Tree-sitter parses TypeScript/JavaScript, Rust, and Python source files into a symbol-level dependency graph (functions calling functions, imports, type usage) persisted in the existing knowledge_graph.rs SQLite. A personalized PageRank pass — Aider's repo-map pattern — scores symbols by which ones the current chat actually mentions, so a query about `commands.rs` produces a different ranked map than a query about `brain.rs`. The top-N PageRank-scored symbols inject into the system prompt within a `repo_map_token_budget` (~1k tokens default) at Phase 32's existing code-section gate. Provider/model capabilities formalize into a checked-in `canonical_models.json` registry — context_length, tool_use, vision, cost_per_million_in/out per (provider, model) — and router.rs replaces its per-call `capability_probe::infer_capabilities` round-trip with a single startup-cached registry lookup, making vision-required-but-active-model-isn't routing transparent and testable. The chat input gains `@context-anchor` syntax: `@screen` injects current screenshot OCR, `@file:path` injects file content within a size cap, `@memory:topic` injects matching memory entries — each anchor is stripped from the user's query before it hits the provider, bypasses Phase 32 selective gating (anchor = explicit user ask), and renders as a labelled chip in the message surface. The whole intelligence surface falls back silently when `intelligence.tree_sitter_enabled` or `intelligence.context_anchor_enabled` is off — the v1.1 lesson, seventh application.

**What this phase does NOT touch:**
- Phase 32 selective injection / compaction / tool-output cap (already shipped — Phase 36 *consumes* the code-section gate but does not re-author the gating logic; LAST_BREAKDOWN gains a `repo_map` row but the accumulator API is unchanged)
- Phase 33 loop driver structure (LoopState, LoopHaltReason, ToolError, run_loop, verify_progress) — Phase 36 ships zero changes to the iteration body; INTEL-01..06 lives in pre-iteration prompt assembly + post-parse anchor extraction in commands.rs
- Phase 34 stuck detection / circuit breaker / cost guard / fallback chain / SessionWriter — Phase 36 ships no resilience surface changes; INTEL-05's registry consumption happens inside the existing `select_provider` body
- Phase 35 auto-decomposition / sub-agent isolation / merge_fork_back — Phase 36 ships no decomposition changes; sub-agents inherit the parent's repo map but do NOT independently call PageRank (parent computes once, sub-agents read; v1.6+ if cross-sub-agent personalisation proves valuable)
- Existing `indexer.rs` ProjectIndex (CodeSymbol + FTS5) — Phase 36 *complements* but does not replace it. Indexer keeps its broad-stroke project-wide symbol catalogue (FTS-searchable); INTEL-01's tree-sitter parser produces *call-graph edges* the existing indexer doesn't capture. The two coexist — INTEL-01 falls back to indexer's CodeSymbol output when `tree_sitter_enabled = false` (CTX-07-style escape hatch)
- Per-tool capability inference — `capability_probe::infer_capabilities` stays for legacy callers; INTEL-04 *adds* `canonical_models.json` as a higher-fidelity source-of-truth and INTEL-05 rewires `select_provider` to prefer the registry. The existing static matrix in capability_probe.rs becomes the v1 default content of canonical_models.json (one-time port)
- Cross-file refactoring intelligence (rename symbol across project) — current scope: read-only graph for context injection; v1.6+ for write-side
- Symbol graph live-update on file save — current scope: re-index on demand (CLI command + on-startup-if-stale); incremental file-watcher updates are v1.6+
- LSP integration for richer symbol info — current scope: tree-sitter alone (cheap, deterministic, no language server processes); LSP is v1.6+
- Multi-repo symbol graph — current scope: single project (the active project's root, derived from cwd at index time)
- Anchor autocomplete in chat input — current scope: regex-based parsing of typed `@screen`/`@file:`/`@memory:` patterns; autocomplete UX is v1.6+
- `@context-anchor` for swarm sub-agents — current scope: parent only (anchors live in user-typed text; sub-agents synthesize their own goals from StepGroup)
- Additional tree-sitter languages (Go, Ruby, Java, C++) — v1 scope is TypeScript/JavaScript, Rust, Python (≥80% of BLADE's codebase + user codebases per RESEARCH); other languages are v1.6+
- `verify:intelligence` gate (EVAL-05) — Phase 37
- INTEL-driven eval (EVAL-01 multi-step task completion benchmark) — Phase 37

**Why this is the cognition layer of v1.5:**
Phase 32 made the prompt sane (selective injection, compaction, tool caps). Phase 33 made the loop sane (LoopState, structured halts, verify_progress). Phase 34 made the loop survivable (stuck detection, circuit breaker, sessions). Phase 35 made the loop parallel (auto-decompose, sub-agent isolation, merge-back). Phase 36 makes the prompt *intelligent* — until INTEL-01..06 land, BLADE injects code context as a flat file list (or worse, no code context at all when the gate fires conservatively), and routing decisions are opaque (per-call probes that can disagree with the actual model's capabilities). The repo map gives the assistant the same kind of skeleton view a senior engineer carries in their head; the capability registry makes "I'll use Claude Sonnet for this vision query because it can see images" a queryable, testable assertion instead of a guess; the @context-anchor syntax lets the user say "look at *this*" without fighting the selective-injection gate. Phase 37's eval gate (EVAL-02 context efficiency) cannot score repo-map quality until INTEL-01..03 ship; Phase 38's close-out cannot claim "BLADE understands codebases" until the symbol graph + PageRank produce reproducibly-different maps for different queries. The 6 INTEL requirements close the v1.5 intelligence story.

</domain>

<decisions>
## Implementation Decisions

### IntelligenceConfig Sub-Struct (Module Boundary + 6-place Wire-up)

- **Locked: New `BladeConfig.intelligence: IntelligenceConfig` sub-struct in `config.rs`.** Mirrors Phase 32's `ContextConfig`, Phase 33's `LoopConfig`, Phase 34's `ResilienceConfig` + `SessionConfig`, Phase 35's `DecompositionConfig` placement. Six-place rule applies to every field per CLAUDE.md (DiskConfig struct, DiskConfig::default, BladeConfig struct, BladeConfig::default, load_config, save_config). Don't try to remember the six places from memory — copy the diff Phase 35-01 used for `DecompositionConfig` and adapt every line.
- **Locked: Five fields with locked defaults.**
  ```rust
  pub struct IntelligenceConfig {
      pub tree_sitter_enabled: bool,                       // default true; CTX-07-style escape hatch (INTEL-01)
      pub repo_map_token_budget: u32,                      // default 1000; INTEL-03 budget cap
      pub pagerank_damping: f32,                           // default 0.85; Aider's locked default (INTEL-02)
      pub capability_registry_path: PathBuf,               // default blade_config_dir().join("canonical_models.json") (INTEL-04)
      pub context_anchor_enabled: bool,                    // default true; CTX-07-style escape hatch (INTEL-06)
  }
  ```
- **Locked: When `tree_sitter_enabled = false`, every INTEL-01..03 code path is bypassed.** No tree-sitter parse pass, no PageRank, no repo map injection. Code-context queries fall back to the existing `indexer.rs` FTS lookup (Phase 32 + 33 baseline behavior). Mirrors Phase 32's `smart_injection_enabled` / Phase 33's `smart_loop_enabled` / Phase 34's `smart_resilience_enabled` + `jsonl_log_enabled` / Phase 35's `auto_decompose_enabled` escape hatches — sixth structural application of the v1.1 lesson.
- **Locked: When `context_anchor_enabled = false`, `@`-syntax in user queries is treated as plain text.** Anchor parser early-returns; the typed `@screen` survives into the provider request as the literal characters, with no injection side-effect. UAT must include both toggles. Seventh application of the v1.1 lesson.
- **Locked: `repo_map_token_budget = 1000` is the default**, matching ROADMAP.md success criterion #1 (`<= ~1k tokens`). Configurable so a power-user with a 200k-context model can dial up to 4k+ if their codebase justifies it; constrained at the consumer site to never exceed `0.10 × model_context_length` as a sanity check (computed once per prompt build via the existing providers metadata).
- **Locked: `pagerank_damping = 0.85`** — Aider's exact default (RESEARCH §Aider repo map). Don't bikeshed. The damping factor controls how much the rank flow stays local vs jumping uniformly; 0.85 is the canonical Brin/Page value and Aider's measured-good choice.
- **Locked: `capability_registry_path` default = `blade_config_dir().join("canonical_models.json")`.** Ships writable so users can edit; the binary copies the bundled `src-tauri/canonical_models.json` to that path on first boot if missing. INTEL-04's binary-bundled file is the source-of-truth for default values; the user's copy is the override.
- **Claude's discretion:** Whether to add a `repo_map_invalidation_seconds: u64 = 300` knob for the PageRank cache TTL. Recommend NO for v1 — the 5-minute cache is locked per Aider's pattern; expose only if eval (Phase 37) finds the TTL is wrong for BLADE's workload.

### Symbol Graph Schema Extension (INTEL-01)

- **Locked: New module `src-tauri/src/intelligence/` with submodules `tree_sitter_parser.rs`, `symbol_graph.rs`, `pagerank.rs`, `repo_map.rs`, `capability_registry.rs`, `anchor_parser.rs`, plus `mod.rs` root.** `mod intelligence;` in `lib.rs`. Submodule layout:
  ```
  src-tauri/src/intelligence/
    mod.rs                   // module root, re-exports IntelligenceConfig accessor + public types
    tree_sitter_parser.rs    // INTEL-01 parsing per-language (TS/JS, Rust, Python)
    symbol_graph.rs          // INTEL-01 SQLite extension to knowledge_graph.rs (Symbol nodes + Calls/Imports/UsesType/Defines edges)
    pagerank.rs              // INTEL-02 personalized PageRank with petgraph
    repo_map.rs              // INTEL-03 budget-bounded map builder + LAST_BREAKDOWN integration
    capability_registry.rs   // INTEL-04 + INTEL-05 canonical_models.json loader + router.rs lookup
    anchor_parser.rs         // INTEL-06 @screen / @file: / @memory: extraction + injection
  ```
- **Locked: Symbol graph extends knowledge_graph.rs's existing SQLite tables (`kg_nodes`, `kg_edges`) — no new database file.** New rows in `kg_nodes` distinguish via `node_type = "symbol"` (vs existing `"concept" | "person" | "project" | "technology" | "place" | "event"`). New rows in `kg_edges` use four new `relation` discriminants: `"calls" | "imports" | "uses_type" | "defines"` (vs existing `"is_a" | "part_of" | "related_to" | "depends_on" | "contradicts" | "enables" | "used_by"`). The schema is additive; existing knowledge_graph behavior is unchanged.
- **Locked: New `SymbolNode` struct** lives in `symbol_graph.rs` and serializes into the existing `kg_nodes` row shape with the symbol-specific payload encoded into the `description` column as JSON:
  ```rust
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct SymbolNode {
      pub id: String,                   // sha256("{file_path}::{name}::{kind}")[..16]
      pub name: String,
      pub kind: SymbolKind,             // Function | Type | Module | Constant
      pub file_path: String,
      pub line_start: u32,
      pub line_end: u32,
      pub language: String,             // "typescript" | "javascript" | "rust" | "python"
      pub indexed_at: i64,              // unix seconds
  }

  #[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
  pub enum SymbolKind { Function, Type, Module, Constant }
  ```
- **Locked: Tree-sitter language coverage v1 = TypeScript/JavaScript, Rust, Python.** Defer Go, Ruby, Java, C++ to v1.6+. Three Cargo deps land in `Cargo.toml`: `tree-sitter = "0.22"`, `tree-sitter-typescript = "0.21"` (covers both TS and JS via `tree_sitter_typescript::language_typescript()` / `language_tsx()`), `tree-sitter-rust = "0.21"`, `tree-sitter-python = "0.21"`. Plus `petgraph = "0.6"` for PageRank if not already present (it isn't — verify and add).
- **Locked: Per-language symbol-extraction queries are static `&str` constants in `tree_sitter_parser.rs`** (one s-expression query per language, capturing function definitions, type definitions, imports, call sites, type references). Don't generate queries dynamically; they're stable across releases. Keep them in a single file so a contributor adding a language adds one string + one match arm.
- **Locked: Symbol graph re-index is on-demand**, not on every file save. Two triggers: (a) explicit Tauri command `reindex_symbol_graph(project_root: String)` exposed for power users + a UI button in DoctorPane (Phase 32 surface), (b) auto-fire on app boot when the indexer's `last_indexed` for the active project is older than 24 hours. Live file-watcher integration is v1.6+ (acknowledged: a saved file change won't reflect in the symbol graph until next reindex; UAT exercises this).
- **Locked: Re-index is idempotent and deletes-then-rewrites symbol rows for the project.** No incremental diff in v1. The query is `DELETE FROM kg_nodes WHERE node_type = 'symbol' AND description LIKE '%"file_path":"{project_root}/%"' AND DELETE FROM kg_edges WHERE from_id IN (...) OR to_id IN (...)`, then bulk insert. SQLite's transactional batch keeps this fast (the existing knowledge_graph indices on `from_id` / `to_id` cover the cleanup query).
- **Locked: Parsing is wrapped in `AssertUnwindSafe(...).catch_unwind()`** per Phase 32-07 + 33-09 + 34-04 + 35-04 fallback discipline. A panic in tree-sitter's parser logs `[INTEL-01]` and the file is skipped. Sixth structural application of the v1.1 lesson — smart path must not crash the indexer.
- **Locked: `INTEL_FORCE_PARSE_ERROR: thread_local! Cell<Option<String>>` test seam** mirrors Phase 33's `LOOP_OVERRIDE` and Phase 34's `RES_FORCE_STUCK` and Phase 35's `DECOMP_FORCE_STEP_COUNT`. Tests inject a parse failure without crafting malformed source files. Production builds carry zero overhead via `#[cfg(test)]`.
- **Claude's discretion:** Whether to use sha256 (collision-safe) or `DefaultHasher` (fast) for `SymbolNode.id`. Recommend sha256 truncated to 16 hex chars per Phase 34 RES-01 hashing precedent — collisions on a 100k-symbol graph are non-zero with DefaultHasher, and the parse pass runs once per re-index, not per chat turn.

### Personalized PageRank (INTEL-02)

- **Locked: `pub fn rank_symbols(query: &str, mentioned_symbols: &[String], damping: f32) -> Vec<(SymbolNode, f32)>` in `intelligence/pagerank.rs`.** Loads the symbol graph from SQLite (Calls + UsesType edges drive the rank flow; Imports + Defines are weight-0 in v1 so they don't dominate), builds a `petgraph::DiGraph<SymbolId, f32>`, and runs personalized PageRank with the personalization vector seeded from `mentioned_symbols`.
- **Locked: Personalization vector construction.** For each entry in `mentioned_symbols` that resolves to a real `SymbolNode` (case-insensitive name match), set its personalization weight to `1.0 / mentioned_symbols.len()`. All other nodes get `0.0` initial weight. PageRank iterates with `damping = config.intelligence.pagerank_damping` (default 0.85) until L1 convergence < `1e-6` or `max_iterations = 50` (Aider's defaults). Output is sorted descending by score.
- **Locked: `mentioned_symbols` derivation.** The repo_map.rs caller harvests symbol names from the recent conversation (last `N = 10` messages) plus the current user query plus all currently-touched files (from any active swarm scratchpad / loop_engine recent_actions ToolCall args matching `read_file`/`bash` paths). Symbol names extracted via regex `\b[a-z_][a-z0-9_]*(?:::[a-zA-Z_][a-zA-Z0-9_]*)?\b` (Rust path syntax) plus `\b[A-Z][a-zA-Z0-9]*\b` (TypeScript/JS PascalCase types) — case-sensitive then deduped via a HashSet. Symbols mentioned in the current user query weight 2× the historical mentions (recency bias).
- **Locked: PageRank cache invalidation rule** — re-rank when (a) `mentioned_symbols` changes (set difference non-empty) OR (b) any code file modified since last index OR (c) cache is older than 5 minutes. Cache key = `sha256(canonical_json(sorted(mentioned_symbols)))[..16]`, value = `Vec<(SymbolNode, f32)>` capped at top-200 (more than INTEL-03's budget will ever need). Cache lives in a `Mutex<HashMap<String, (Instant, Vec<(SymbolNode, f32)>)>>` static singleton initialized via `once_cell::sync::Lazy`. Mirrors Aider's pattern (RESEARCH §Aider repo map).
- **Locked: Empty-mentioned-symbols fallback.** When `mentioned_symbols.is_empty()` (cold start, simple query, no recent context), the personalization vector falls back to uniform — the rank reduces to plain PageRank scoring intrinsic graph centrality. This produces a "default project map" useful for first-message-of-session queries.
- **Locked: PageRank panic discipline.** `rank_symbols` is wrapped in `AssertUnwindSafe(...).catch_unwind()` at the repo_map.rs call site. Panic logs `[INTEL-02]` and the caller falls back to FTS-based lookup (existing indexer.rs behavior). Same v1.1 discipline as INTEL-01.
- **Locked: PageRank determinism test required.** A unit test seeds a 6-symbol graph with known edges, runs `rank_symbols` twice with identical inputs, and asserts byte-identical Vec<(SymbolNode, f32)> output. Catches any non-deterministic edge-iteration that creeps in via HashMap ordering changes.
- **Claude's discretion:** Whether to also weight Calls edges by call frequency (a function called 10× scores higher than one called once). Recommend NO for v1 — tree-sitter gives us call-site presence, not invocation count; weighting requires runtime tracing which is out-of-scope. v1.6+ if eval finds it matters.

### Repo Map Injection in Code Section Gate (INTEL-03)

- **Locked: `pub fn build_repo_map(query: &str, mentioned_symbols: &[String], token_budget: u32, config: &BladeConfig) -> Option<String>` in `intelligence/repo_map.rs`.** Returns `Some(rendered_map)` when the query passes the code-section gate (delegates the gate check upward via the existing `score_or_default(query, "code", 1.0) > gate` pattern in brain.rs), `None` otherwise.
- **Locked: Map rendering shape.** The map is a flat list of `file_path::symbol_name (kind, score)` lines, ordered by PageRank score descending, capped at the token budget via repeated `safe_slice` checks. Format:
  ```
  REPO MAP (top-N symbols by relevance, total ~XXX tokens):
  src-tauri/src/commands.rs::send_message_stream_inline (function, score=0.142)
  src-tauri/src/brain.rs::build_system_prompt_inner (function, score=0.118)
  src-tauri/src/loop_engine.rs::run_loop (function, score=0.097)
  ...
  ```
  Token estimation reuses Phase 32's existing token-count helper (chars ÷ 4 approximation; same posture as `subagent_summary_max_tokens × 4 chars`). The renderer adds rows until adding the next row would exceed `token_budget`; it stops at the previous row.
- **Locked: Injection point in brain.rs.** A new branch inside `build_system_prompt_inner` at the existing code section gate (Phase 32-03 added the gate around line 929+ per the LAST_BREAKDOWN trace). When `score_or_default(user_query, "code", 1.0) > gate` AND `config.intelligence.tree_sitter_enabled` AND `build_repo_map(...).is_some()`, append the rendered map to the `prompt: String` accumulator and call `record_section("repo_map", rendered_map.len())`. The existing code-list section (FTS-based) remains; the repo map injects *above* it as a higher-fidelity replacement when available, and the FTS section is suppressed when the repo map is non-empty (avoid double-injection of the same symbols).
- **Locked: LAST_BREAKDOWN row.** Phase 32-06's per-section accumulator (brain.rs:275 `LAST_BREAKDOWN`) gains a new label `"repo_map"` whose char count maps to the rendered map length. DoctorPane's surface auto-picks this up — no frontend changes needed for Phase 36's basic visibility. (Optional polish: a label-specific renderer in DoctorPane that shows the top-3 symbols inline; deferred to Claude's discretion.)
- **Locked: When the code gate FIRES but the repo map is empty (no symbols indexed yet, or PageRank returned nothing), inject the existing FTS section unchanged.** The repo map is a *replacement* when present, not a hard requirement. CTX-07 silent-fallback discipline.
- **Locked: Repo map injection wraps in `AssertUnwindSafe(...).catch_unwind()` at the brain.rs call site.** A panic in `build_repo_map` logs `[INTEL-03]` and the prompt builder falls through to the existing FTS-based code section. Sixth application of the v1.1 lesson — smart path must not crash chat.
- **Locked: Sub-agent inheritance.** When Phase 35's auto-decomposition triggers, each sub-agent's `run_loop` calls `build_system_prompt_inner` with the parent's pre-decomposition `mentioned_symbols` snapshot — sub-agents see the *parent's* repo map, not their own. This is locked: per-sub-agent personalization would multiply the PageRank cost by N and would diverge sub-agents' views of the codebase mid-task. v1.6+ if eval shows convergent benefit.
- **Claude's discretion:** Whether to render the score in the map output (gives the assistant a soft prior on "how much should I trust this entry") or strip it (reduces prompt verbosity). Recommend INCLUDE — the score is a signal the assistant can act on; verbosity cost is ~6 chars per row × N rows < 200 tokens of overhead.

### canonical_models.json Capability Registry (INTEL-04)

- **Locked: `src-tauri/canonical_models.json` is checked into the repo as the binary-bundled default.** Path relative to crate root. The file is copied to `blade_config_dir().join("canonical_models.json")` on first app boot if missing; the user's copy is the runtime override.
- **Locked: Schema (canonical_models.json):**
  ```json
  {
    "version": 1,
    "providers": {
      "anthropic": {
        "models": {
          "claude-sonnet-4-20250514": {
            "context_length": 200000,
            "tool_use": true,
            "vision": true,
            "audio": false,
            "cost_per_million_in": 3.00,
            "cost_per_million_out": 15.00,
            "notes": "Frontier general-purpose model"
          }
        }
      },
      "openai": { "models": { ... } },
      "groq": { "models": { ... } },
      "gemini": { "models": { ... } },
      "openrouter": { "models": { ... } }
    }
  }
  ```
  Five providers ship by default: anthropic, openai, groq, gemini, openrouter. Ollama is intentionally OUT of the default registry (model set is per-user; covered by capability_probe runtime fallback). Custom base_url is also out (user-override; capability_probe handles it).
- **Locked: Initial content port.** v1 default values come from porting `capability_probe::OVR_ANTHROPIC` + `OVR_OPENAI` + `OVR_GEMINI` + `OVR_GROQ` + `OVR_OPENROUTER` (capability_probe.rs:59-107) into JSON. Cost values come from each provider's published pricing as of 2026-05-06 (anthropic.com/pricing, openai.com/pricing, etc.) — encoded conservatively (round up to two decimal places). The bundled file is the source-of-truth for the v1 ship.
- **Locked: Loader is `pub fn load_registry(path: &Path) -> Result<CapabilityRegistry, String>` in `intelligence/capability_registry.rs`.** Returns a deserialized `CapabilityRegistry` struct:
  ```rust
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct CapabilityRegistry {
      pub version: u32,
      pub providers: std::collections::HashMap<String, ProviderEntry>,
  }
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct ProviderEntry {
      pub models: std::collections::HashMap<String, ModelCapabilities>,
  }
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub struct ModelCapabilities {
      pub context_length: u32,
      pub tool_use: bool,
      pub vision: bool,
      #[serde(default)]
      pub audio: bool,
      pub cost_per_million_in: f32,
      pub cost_per_million_out: f32,
      #[serde(default)]
      pub notes: String,
  }
  ```
- **Locked: Registry caching.** A `static REGISTRY: once_cell::sync::Lazy<Mutex<Option<CapabilityRegistry>>>` is loaded on first access and refreshed when the file's mtime advances. Single load per app session under normal conditions. Reload trigger: a Tauri command `reload_capability_registry()` for power users (mirrors `reload_config` precedent).
- **Locked: Validation against capability_probe outputs at startup.** A startup check (in `lib.rs` setup or `intelligence::init`) compares each registry entry's `(vision, tool_use, audio, context_length)` with `capability_probe::infer_capabilities` for the same (provider, model). Mismatches log a structured warning `[INTEL-04] registry/probe mismatch for {provider}/{model}: registry says vision={x}, probe says vision={y}`. Mismatches do NOT halt — the registry wins (it's the source-of-truth; the probe's static matrix is the v0 approximation we're formalizing). The check is pure observability; v1.6+ may surface mismatches in DoctorPane.
- **Locked: `pub fn get_capabilities(provider: &str, model: &str) -> Option<ModelCapabilities>` in `capability_registry.rs`** is the single public lookup function. Returns `None` when (provider, model) isn't in the registry — caller falls back to capability_probe's static matrix (existing `infer_capabilities` path). Substring matching mirrors capability_probe (`":free"` wins over `"claude"` in OpenRouter); reuse the existing first-match-wins ordering convention via an explicit precedence array per provider.
- **Locked: Schema versioning.** `version: 1` is the current shape. A future v2 with cost-per-million-cached or per-region pricing bumps the version; the loader rejects unknown versions with a structured error and the system falls back to capability_probe's static matrix. Forward-compat is one-line: `if reg.version != 1 { return Err("unsupported registry version") }`.
- **Locked: Registry write-side is OUT-OF-SCOPE for v1.** Users hand-edit canonical_models.json with their text editor. A UI for adding custom models is v1.6+. The bundled file ships with all 5 default providers' currently-supported models; users adding new models edit the JSON directly.
- **Claude's discretion:** Whether to support per-region pricing fields (e.g. EU vs US). Recommend NO for v1 — adds schema complexity for marginal value; the cost field is conservative enough that regional variance < 10% doesn't materially affect routing.

### Router Consumes Registry (INTEL-05)

- **Locked: `router.rs::select_provider` rewires its capability check.** The current path (line 246-287) calls into `provider_capabilities()` (capability_probe's static HashMap) for each candidate. INTEL-05 inserts a registry lookup *before* the probe fallback:
  ```rust
  // BEFORE (Phase 11)
  let cap = required_capability;
  // ... scan capability_probe::PROVIDER_CAPABILITIES ...

  // AFTER (Phase 36)
  let cap = required_capability;
  if let Some(registry_entry) = capability_registry::get_capabilities(prov, model) {
      // Registry-driven decision — transparent, testable, single source-of-truth.
      let has_cap = match cap {
          "vision" => registry_entry.vision,
          "audio" => registry_entry.audio,
          "tools" => registry_entry.tool_use,
          "long_context" => registry_entry.context_length >= 100_000,
          _ => false,
      };
      // Use registry verdict.
  } else {
      // Fallback to capability_probe's static matrix (legacy behavior).
  }
  ```
- **Locked: Registry takes precedence over capability_probe for known (provider, model) pairs.** The probe stays as the fallback for OpenRouter free-tier substrings, custom base_url models, Ollama models, and any future provider not in the registry. Existing 25+ `resolve_provider_for_task` call sites are unaffected (per Phase 11's blast-radius discipline).
- **Locked: `select_provider` return tuple is unchanged.** `(provider, api_key, model, fallback_chain, capability_unmet)` shape stays — only the *source* of the capability check shifts. Frontend / commands.rs callers see no API delta.
- **Locked: Vision routing transparency test.** A unit test sets up a registry with `claude-haiku-4-5: { vision: false }` and `claude-sonnet-4: { vision: true }`, calls `select_provider(TaskType::Vision, ...)` with `provider = anthropic, model = claude-haiku-4-5`, and asserts the fallback_chain elevates `claude-sonnet-4` for the vision task. This locks ROADMAP success criterion #4 (vision query → vision-capable model selected without user intervention).
- **Locked: `INTEL_FORCE_REGISTRY_MISS: thread_local! Cell<bool>` test seam** lets tests force the registry-miss path (fallback to capability_probe) without unmounting the registry file. Mirrors Phase 33's `LOOP_OVERRIDE` and Phase 34's `RES_FORCE_PROVIDER_ERROR`.
- **Claude's discretion:** Whether to also expose `get_capabilities` as a Tauri command for frontend display (e.g. a "current model: tool_use=true, vision=false" chip). Recommend YES — high-signal observability for free; one extra entry in `generate_handler!`. Add as `get_active_model_capabilities` Tauri command in `intelligence/mod.rs`.

### @context-anchor Parsing (INTEL-06)

- **Locked: `pub fn extract_anchors(query: &str) -> (String, Vec<Anchor>)` in `intelligence/anchor_parser.rs`.** Returns the stripped query (anchors removed) plus the parsed anchors. Anchor enum:
  ```rust
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  pub enum Anchor {
      Screen,                                            // @screen
      File { path: String },                             // @file:src/main.rs
      Memory { topic: String },                          // @memory:my-deadline
  }
  ```
- **Locked: Regex-based parsing for v1.** Three patterns, evaluated in order against the original query:
  - `\B@screen\b` → `Anchor::Screen`
  - `\B@file:([^\s]+)` → `Anchor::File { path: $1 }`
  - `\B@memory:([^\s]+)` → `Anchor::Memory { topic: $1 }`
  Each match is captured, removed from the query (replaced with single space), and added to the anchors Vec. Multiple anchors of the same type allowed; deduped by `(type, payload)` tuple at extraction time. The trailing query is `safe_slice`'d to the original length and trimmed.
- **Locked: Wired into `commands.rs::send_message_stream_inline` at the user-query intake.** Before any provider call:
  ```rust
  let (clean_query, anchors) = if config.intelligence.context_anchor_enabled {
      std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          intelligence::anchor_parser::extract_anchors(&user_query)
      })).unwrap_or_else(|_| {
          log::warn!("[INTEL-06] anchor parser panicked; treating query as plain text");
          (user_query.clone(), Vec::new())
      })
  } else {
      (user_query.clone(), Vec::new())
  };
  ```
- **Locked: Per-anchor injection.**
  - **`Anchor::Screen`** → invoke existing screenshot OCR path (Phase 32 vision section harvester). The OCR text is appended to the prompt as a synthetic system note `[ANCHOR:@screen] {ocr_text}` BEFORE Phase 32's selective-injection gate runs. (Anchored content bypasses gating — see next lock.)
  - **`Anchor::File { path }`** → read the file via `std::fs::read_to_string`, capped at `max_anchor_file_bytes: u32 = 200_000` (~50k tokens). Truncated content gets `[truncated from N bytes]` suffix per Phase 32 CTX-05 pattern. Injected as `[ANCHOR:@file:{path}] {content}`.
  - **`Anchor::Memory { topic }`** → invoke existing `memory.rs::query_memories(topic, limit=5)` path. Top-5 matching facts injected as `[ANCHOR:@memory:{topic}] {fact_1}\n{fact_2}\n...`.
- **Locked: Anchored content bypasses Phase 32 selective gating.** When the anchor injection sites add to the prompt accumulator, they call `record_section` with a label like `"anchor_screen"` / `"anchor_file"` / `"anchor_memory"` — these labels do NOT route through `score_or_default(...)`; they're explicit user asks, not heuristic-driven sections. This is the locked semantic difference between ambient context (gated) and anchored context (always-injected). When `context_anchor_enabled = false`, no anchor injection happens — the @-text falls through to the provider as plain text per the locked escape hatch.
- **Locked: Anchor parse fuzz tests required.** Malformed inputs (`@`, `@file:`, `@file:`, `@memory:`, `@unknown:foo`, embedded UTF-8 in path, `@@screen`, `email@domain.com` — must NOT match `@screen` because of `\B` word boundary) must not crash. Test naming `phase36_intel_06_anchor_parser_fuzz_*`.
- **Locked: Anchor strip + injection wraps in `AssertUnwindSafe(...).catch_unwind()` per the v1.1 discipline.** Panic logs `[INTEL-06]` and falls back to the original query as plain text.
- **Locked: Frontend chip rendering for anchors.** The chat composer (per CLAUDE.md Frontend section) detects anchors via the same regex and renders them as inline chips (`@screen` chip, `@file:src/main.rs` chip, etc.) in the message bubble surface — visual confirmation the anchor was understood. New component: `src/features/chat/AnchorChip.tsx` (or extend an existing chip pattern from ActivityStrip). When `context_anchor_enabled = false` (config-mirrored to frontend via existing `get_config` path), chips are NOT rendered — the @-text shows as plain text, matching the backend behavior.
- **Locked: NO anchor autocomplete UI in v1.** The user types `@screen` / `@file:` / `@memory:` literally; the regex parser handles whatever they typed. Autocomplete is v1.6+.
- **Claude's discretion:** Whether anchored file content also strips out binary-detected files (e.g. `@file:assets/logo.png` → reject with `[ANCHOR:@file rejected: binary]`). Recommend YES — saves the embedding pipeline from a cliff. Implementation: `binaryornot`-style heuristic (scan first 8KB for null bytes; reject if present).

### Backward Compatibility (Intelligence Toggles)

- **Locked: Two new kill switches: `IntelligenceConfig.tree_sitter_enabled: bool` (default `true`) and `IntelligenceConfig.context_anchor_enabled: bool` (default `true`).** They are independent — a user can disable repo map injection without disabling anchors, and vice versa.
- **Locked: When `tree_sitter_enabled = false`:**
  - Tree-sitter parser pass is skipped at re-index time (no symbol_graph rows written)
  - PageRank is never called
  - `build_repo_map` returns `None` unconditionally
  - The brain.rs code-section gate falls through to the existing FTS-based code list (Phase 32 + 33 baseline)
  - capability_registry, anchor_parser are unaffected (independent surface)
- **Locked: When `context_anchor_enabled = false`:**
  - `extract_anchors` early-returns `(query.clone(), Vec::new())` without invoking the regex
  - `@screen` / `@file:` / `@memory:` text in user queries is sent verbatim to the provider (no injection, no strip)
  - Frontend AnchorChip rendering is suppressed (config mirrored via existing `get_config`)
  - tree_sitter, capability_registry are unaffected
- **Locked: capability_registry has NO escape hatch.** It's a read-only data file; a missing or malformed file falls back to capability_probe's static matrix automatically (the loader returns `Err`, the lookup returns `None`, the caller falls through to the legacy path). Equivalent to a no-op kill switch via filesystem.
- **Locked: This mirrors Phase 32's `context.smart_injection_enabled`, Phase 33's `loop.smart_loop_enabled`, Phase 34's `resilience.smart_resilience_enabled` + `session.jsonl_log_enabled`, Phase 35's `decomposition.auto_decompose_enabled` escape hatches.** Same v1.1 lesson, sixth and seventh structural applications.
- **Claude's discretion:** Whether to combine the two toggles into a single `intelligence.enabled` master switch. Recommend NO — they target different surfaces (repo map = ambient injection; anchors = explicit injection) and a user might reasonably want one without the other.

### Module Boundaries

- **Locked: New top-level Rust module `src-tauri/src/intelligence/`.** Declared via `mod intelligence;` in `lib.rs`. Submodule layout already locked above:
  ```
  src-tauri/src/intelligence/
    mod.rs                   // module root, re-exports + init() called from lib.rs setup
    tree_sitter_parser.rs    // INTEL-01 parsing per-language
    symbol_graph.rs          // INTEL-01 SymbolNode + edge persistence (extends knowledge_graph.rs schema)
    pagerank.rs              // INTEL-02 personalized PageRank with petgraph
    repo_map.rs              // INTEL-03 budget-bounded map builder
    capability_registry.rs   // INTEL-04 + INTEL-05 canonical_models.json loader + lookup
    anchor_parser.rs         // INTEL-06 regex-based @-syntax extractor
  ```
- **Locked: New Tauri commands** (added to `generate_handler![]` in `lib.rs`):
  - `reindex_symbol_graph`
  - `reload_capability_registry`
  - `get_active_model_capabilities` (Claude's discretion above; recommended)
- **Locked: `knowledge_graph.rs` extension is ADDITIVE — no existing function signature changes.** Symbol nodes share the existing `kg_nodes` table via the `node_type = "symbol"` discriminant; symbol edges share `kg_edges` via the four new `relation` strings. The existing `KnowledgeNode` / `KnowledgeEdge` API is unchanged. INTEL-01's symbol_graph.rs adds new helpers (`insert_symbol`, `query_symbols_by_file`, `query_calls_from`, `query_calls_to`) that wrap the same SQLite connection helpers.
- **Locked: `router.rs` extension is the INTEL-05 registry lookup only.** A single insertion inside `select_provider`'s tier-1 capability check (line 246-287). The existing capability_probe fallback path stays as the else-branch. No changes to `classify_task`, `suggest_model`, or any other public function.
- **Locked: `brain.rs` extension is the INTEL-03 repo map injection only.** A single new conditional branch inside `build_system_prompt_inner`'s code section (around line 929+). LAST_BREAKDOWN gains a `"repo_map"` row via the existing `record_section` helper. No changes to `score_context_relevance`, `score_or_default`, or any other public function.
- **Locked: `commands.rs` extension is the INTEL-06 anchor parsing only.** A single new prelude block inside `send_message_stream_inline` (post-input-validation, pre-prompt-build). The existing tool loop, compaction, fallback chain are unchanged.
- **Locked: `Cargo.toml` deps to add:** `tree-sitter = "0.22"`, `tree-sitter-typescript = "0.21"`, `tree-sitter-rust = "0.21"`, `tree-sitter-python = "0.21"`, `petgraph = "0.6"`. Verify `once_cell` is already present (it is, per Phase 32-06 LAST_BREAKDOWN). Verify `regex` is already present (it is, per multiple Phase 32+ usages).
- **Locked: New file `src-tauri/canonical_models.json`** is checked into the repo. Path: relative to `src-tauri/` crate root. Bundled into the binary via `tauri.conf.json` resource paths or via runtime `include_str!` in `capability_registry.rs` (Claude's discretion: include_str! is simpler; tauri resources is more flexible for user-overrides; recommend `include_str!` for the ship-default + filesystem read for the runtime override).
- **Locked: Frontend additions** are scoped to three files:
  - `src/features/chat/AnchorChip.tsx` (NEW) — render @screen/@file:/@memory: chips inline in chat bubbles
  - `src/features/chat/ChatComposer.tsx` (or wherever the existing message renderer lives) — extend the message-content parser to render AnchorChip when `intelligence.context_anchor_enabled = true` (mirrored from backend config)
  - `src/lib/tauri/intelligence.ts` (NEW) — typed wrappers for `reindex_symbol_graph`, `reload_capability_registry`, `get_active_model_capabilities`
- **Locked: Six-place config rule applies** to every new field in `IntelligenceConfig`. See CLAUDE.md. Don't try to remember the six places from memory; copy the diff Phase 35-01 used for `DecompositionConfig` and adapt every line.
- **Locked: `safe_slice` is mandatory** for any new string-slice operation on user/conversation/file content. Risk sites: anchored file content truncation (INTEL-06), repo map row rendering (INTEL-03), OCR text injection from `@screen` (INTEL-06), memory fact rendering (INTEL-06), file_path display in symbol map rows.

### Testing & Verification

- **Locked: Each INTEL-01..06 needs at least one unit test + 1 integration test.** Naming pattern follows Phase 35: `phase36_intel_01_tree_sitter_parses_rust_function_definition`, `phase36_intel_01_tree_sitter_parses_typescript_imports`, `phase36_intel_01_tree_sitter_parses_python_class`, `phase36_intel_01_symbol_graph_persists_to_kg_nodes`, `phase36_intel_02_pagerank_determinism`, `phase36_intel_02_personalized_vector_seeds_correctly`, `phase36_intel_02_cache_invalidates_on_mention_change`, `phase36_intel_03_repo_map_respects_token_budget`, `phase36_intel_03_repo_map_falls_through_to_fts_on_panic`, `phase36_intel_04_canonical_models_round_trip_serde`, `phase36_intel_04_registry_validation_against_probe_logs_mismatch`, `phase36_intel_05_router_uses_registry_for_vision_routing`, `phase36_intel_05_router_falls_through_when_registry_miss`, `phase36_intel_06_anchor_parser_strips_screen`, `phase36_intel_06_anchor_parser_strips_file_with_path`, `phase36_intel_06_anchor_parser_strips_memory_with_topic`, `phase36_intel_06_anchor_parser_fuzz_malformed_inputs_dont_crash`, `phase36_intel_06_email_address_does_not_match_screen`. Plus ≥1 integration test per requirement at the public IPC / prompt-assembly boundary:
  - `phase36_intelligence_default_config_matches_wave1_contract`
  - `phase36_intelligence_tree_sitter_off_skips_indexing`
  - `phase36_intelligence_anchor_off_treats_at_syntax_as_plain_text`
  - `phase36_intel_01_reindex_symbol_graph_via_force_seam`
  - `phase36_intel_03_repo_map_injects_into_brain_prompt_when_code_gate_fires`
  - `phase36_intel_05_canonical_models_json_load_at_startup`
  - `phase36_intel_06_anchor_screen_injects_ocr_into_prompt`
  - `phase36_intel_06_anchor_file_truncates_large_file_with_summary`
- **Locked: Test seam pattern.** Mirror Phase 33-04's `LOOP_OVERRIDE` and Phase 34-04's `RES_FORCE_STUCK` and Phase 35-04's `DECOMP_FORCE_STEP_COUNT` — introduce four seams:
  - `INTEL_FORCE_PARSE_ERROR: thread_local! Cell<Option<String>>` — tests inject a tree-sitter parse failure without crafting malformed source files.
  - `INTEL_FORCE_PAGERANK_RESULT: thread_local! Cell<Option<Vec<(SymbolNode, f32)>>>` — tests inject a fixed PageRank result without seeding a graph.
  - `INTEL_FORCE_REGISTRY_MISS: thread_local! Cell<bool>` — tests force the registry-miss path so the capability_probe fallback exercises.
  - `INTEL_FORCE_ANCHOR_PANIC: thread_local! Cell<bool>` — tests verify the catch_unwind fallback produces the original query when anchor parsing panics.
  All four `#[cfg(test)]`-gated; production builds carry zero overhead.
- **Locked: Tree-sitter-disabled regression test required.** A unit test sets `intelligence.tree_sitter_enabled = false` and asserts: (a) `reindex_symbol_graph` is a no-op, (b) `build_repo_map` returns `None`, (c) the code-section gate in brain.rs falls through to the existing FTS-based code list with no `repo_map` row in LAST_BREAKDOWN. Mirrors Phase 32-07 / 33-09 / 34-11 / 35-11 kill-switch posture.
- **Locked: Anchor-disabled regression test required.** A unit test sets `intelligence.context_anchor_enabled = false`, sends a query containing `@screen` + `@file:foo.rs`, asserts the query reaches the provider verbatim with NO injection side-effects. Same kill-switch posture.
- **Locked: Panic-injection regression test required for repo map injection** (mirrors Phase 33-09's `phase33_loop_01_panic_in_render_actions_json_is_caught` and Phase 34-04's `FORCE_STUCK_PANIC` and Phase 35-11's panic test). Force a panic inside `build_repo_map` via the test seam; assert brain.rs falls through to the FTS section without crashing the prompt build; assert the next chat reply renders correctly.
- **Locked: Fuzz test for anchor parser.** Generate ~100 randomized `@`-prefixed strings (mix of valid + malformed); assert no panic and that valid forms extract correctly. Pure-Rust fuzz; no `cargo-fuzz` infrastructure required (proptest-style enumerated cases are sufficient for v1).
- **Locked: PageRank determinism test.** Build a 6-node fixture graph, run `rank_symbols` 10× with identical inputs, assert byte-identical output. Catches HashMap-ordering drift across rust versions / platforms.
- **Locked: Registry round-trip test.** Serialize `CapabilityRegistry` → JSON → deserialize → assert structural equality via `serde_json::Value` comparison. Catches schema drift at PR time.
- **Locked: Vision routing transparency test.** Set up registry with `claude-haiku-4-5: { vision: false }`; configure `BladeConfig.provider = "anthropic"`, `model = "claude-haiku-4-5"`; call `select_provider(TaskType::Vision, ...)`; assert the returned `model` (or fallback_chain entry) is a vision-capable model. Locks ROADMAP success criterion #4.
- **Locked: NO new verify gate.** verify:intelligence is Phase 37's responsibility (EVAL-05). Phase 36 keeps the existing 37 gates green, adds unit tests + integration tests + the wiring-audit-shape entry (1 module + 5 config fields + 0 new routes — DoctorPane already registered Phase 32; AnchorChip is a sub-component).
- **Locked: Runtime UAT REQUIRED per CLAUDE.md Verification Protocol.** This phase has runtime UI work (AnchorChip rendering in chat bubbles) AND runtime backend behavior (repo map injection visible via DoctorPane breakdown panel; vision routing transparency via observed model selection). The final task in the phase-closure plan must be `checkpoint:human-verify`. UAT script:
  1. Open dev binary (`npm run tauri dev`)
  2. Run `reindex_symbol_graph` for the BLADE project root — assert SQLite `kg_nodes` gains rows with `node_type = 'symbol'`; assert `kg_edges` gains rows with `relation IN ('calls', 'imports', 'uses_type', 'defines')`
  3. Send a code-shaped query: "Where does send_message_stream_inline call into providers?" — assert DoctorPane breakdown shows a `repo_map` row with non-zero char count; assert the assistant reply references real symbols from BLADE's codebase (not hallucinations)
  4. Send a different code query: "What does build_system_prompt_inner depend on?" — assert the repo map row contains DIFFERENT top symbols than (3) (proves personalization)
  5. Send a non-code query: "What's the weather?" — assert no `repo_map` row appears in DoctorPane breakdown (gate closed)
  6. Toggle `intelligence.tree_sitter_enabled = false` — re-run (3) — assert the assistant still replies (FTS fallback works) but no `repo_map` row in DoctorPane
  7. Manually edit `~/.config/blade/canonical_models.json` to set `claude-haiku-4-5: { vision: false }`; configure BLADE to use `anthropic/claude-haiku-4-5` as primary; send a query with an attached image — assert the actual provider call goes to a vision-capable model (check via `get_active_model_capabilities` or trace logs); assert the assistant successfully replies about the image
  8. Type `@screen` in chat input — assert AnchorChip renders inline with the @ icon; send the message; assert the assistant reply references the current screen content
  9. Type `@file:src-tauri/src/loop_engine.rs explain run_loop` — assert AnchorChip renders for the file anchor; send; assert the reply references actual contents of loop_engine.rs (not hallucinated)
  10. Type `@memory:project-deadline what should I focus on` — assert AnchorChip renders for the memory anchor; assert the reply weaves in stored memory content
  11. Toggle `intelligence.context_anchor_enabled = false` — re-type `@screen test message` — assert NO chip renders; assert the assistant treats `@screen` as literal text
  12. Type a malformed anchor `@file:` (trailing colon, no path) — assert no crash; query passes through with degraded handling
  13. Type an email-shaped string `arnav@pollpe.in` — assert NO @screen / @file: chip renders (regex word boundary correctly distinguishes)
  14. Reload `canonical_models.json` via `reload_capability_registry` Tauri command — assert next provider call uses updated values
  15. Screenshot DoctorPane with repo_map breakdown row at 1280×800 + 1100×700, save under `docs/testing ss/`
  16. Screenshot ChatComposer with all three AnchorChip variants (@screen, @file:, @memory:) at 1280×800 + 1100×700
  17. Read back all screenshots via the Read tool and cite a one-line observation per breakpoint
- **Locked: tsc --noEmit + cargo check must remain clean.** No regressions in the 37 verify gates. The pre-existing OEVAL-01c v1.4 drift (verify:eval) remains out-of-scope per the SCOPE BOUNDARY established by Phase 32-07 / 33-09 / 34-11 / 35-11.

### Claude's Discretion (catch-all)

- File-level layout inside `intelligence/tree_sitter_parser.rs` — whether the four supported languages share a `match language { ... }` switch in one function or split into four sibling functions. Recommend split-by-language (one parse function per language) for testability — each can be unit-tested with a small fixture file independently.
- Whether the symbol graph SQLite extension uses a separate database file (`symbols.db`) or shares the existing `blade.db`. Recommend SHARE — co-located with knowledge_graph for atomic transactional consistency; Phase 32 STATE.md and Phase 34 sessions live in their own files because they're append-only logs, not transactional.
- Whether re-index on stale-trigger blocks the chat surface or runs in a tokio::spawn fire-and-forget. Recommend FIRE-AND-FORGET — the first chat after boot can use the previous index; Phase 32-04 establishes the precedent (compaction off the critical path).
- Priority order when multiple anchors fire on the same message (`@screen and @file:foo.rs and @memory:bar`). Recommend simple ordering: extract all, inject in extraction order (left-to-right). No need for explicit priority.
- Whether the DoctorPane repo_map row gets a sub-renderer that shows the top-3 symbol names inline (vs just the char count). Recommend YES — high-signal, low-cost; reuse existing collapsible-detail pattern from Phase 32-06.
- Whether `get_active_model_capabilities` Tauri command also returns the cost-per-million fields (lets the cost-meter chip show "this model is $X/M tokens"). Recommend YES — surfaces useful pricing transparency for the user; data is in the registry anyway.
- Whether `@file:` anchor supports glob patterns (e.g. `@file:src/**/*.rs`). Recommend NO for v1 — adds complexity; user can chain `@file:` calls or use `@memory:` for multi-file context. v1.6+ if eval shows it matters.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 36 row (lines 180-192) + 5 success criteria + INTEL-01..06 sequencing
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — INTEL-01..06 verbatim (lines 47-52)
- `/home/arnav/blade/.planning/STATE.md` — v1.5 milestone state, key decisions table
- `/home/arnav/blade/.planning/PROJECT.md` — Project core value (read for tone)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (six-place config, safe_slice, Tauri command namespace, verification protocol, what-not-to-do list)
- `/home/arnav/CLAUDE.md` — workspace defaults (Tauri 2 + React + Tailwind v4)

### Phase 32 Predecessor (read for inherited patterns — Phase 36 BUILDS ON THIS)
- `/home/arnav/blade/.planning/phases/32-context-management/32-CONTEXT.md` — selective-injection gating pattern at code section (INTEL-03 lands here); LAST_BREAKDOWN accumulator surface (INTEL-03 adds `repo_map` row); CTX-07 fallback discipline (INTEL-01..06 inherit verbatim); ContextConfig sub-struct + 6-place wire-up exemplar
- `src-tauri/src/brain.rs` — `build_system_prompt_inner` (line 714), `score_context_relevance` (line 400), `score_or_default` (line 549 wrapper), `record_section` (line 290), `LAST_BREAKDOWN` (line 275), gate threshold from `config.context.relevance_gate` (line 759). INTEL-03 injects at the code-section gate; reuses every one of these helpers.

### Phase 33 Predecessor (read for loop driver structure)
- `/home/arnav/blade/.planning/phases/33-agentic-loop/33-CONTEXT.md` — LoopState, LoopHaltReason, run_loop, ToolError surfaces. Phase 36 ships zero changes to the iteration body — INTEL-01..06 lives in pre-iteration prompt assembly.
- `src-tauri/src/loop_engine.rs` — current Phase 33 + 34 + 35 surface. Phase 36 does NOT extend.

### Phase 34 Predecessor (read for module-boundary discipline)
- `/home/arnav/blade/.planning/phases/34-resilience-session/34-CONTEXT.md` — gold-standard CONTEXT structure; ResilienceConfig + SessionConfig sub-struct + 6-place wire-up pattern (INTEL-04 capability_registry mirrors the on-disk-config-with-startup-load pattern); RES_FORCE_STUCK test seam → INTEL_FORCE_* seam pattern; SessionWriter / SessionEvent enum (Phase 36 does NOT extend)
- `src-tauri/src/session/list.rs` — fork_session pattern; capability_registry's reload command mirrors the same Tauri-command-around-on-disk-state shape.

### Phase 35 Predecessor (read for sub-agent inheritance)
- `/home/arnav/blade/.planning/phases/35-auto-decomposition/35-CONTEXT.md` — DecompositionConfig sub-struct exemplar (IntelligenceConfig mirrors verbatim); DECOMP_FORCE_* test seam pattern; sub-agent isolation contract (INTEL-03 locks: sub-agents inherit parent's repo map, do not re-PageRank)
- `src-tauri/src/decomposition/` — module layout exemplar (mod.rs + per-concern submodules). Phase 36's `intelligence/` mirrors the layout.

### Code Anchors (must read to plan accurately)
- `src-tauri/src/knowledge_graph.rs` — KnowledgeNode + KnowledgeEdge structs (lines 21-40); `ensure_tables` (line 86); kg_nodes / kg_edges schema (lines 92-112); INTEL-01 extends both tables additively via new `node_type = "symbol"` and four new `relation` strings.
- `src-tauri/src/router.rs` — `classify_task` (line 19), `suggest_model` (line 120), `select_provider` (line 221), tier-1 capability check (line 246-287), `build_capability_filtered_chain` (referenced lines around 263-273), `find_capable_providers` (line 299+). INTEL-05 inserts a registry lookup INSIDE the tier-1 capability check, BEFORE capability_probe fallback. No public API changes.
- `src-tauri/src/capability_probe.rs` — static ProviderMatrix (line 45-48), OVR_ANTHROPIC..OVR_OLLAMA (lines 59-115), `provider_capabilities()` HashMap loader (line 119+), `infer_capabilities` public function. INTEL-04 ports OVR_* arrays into JSON; INTEL-05 prefers the registry but falls back to this matrix on miss.
- `src-tauri/src/indexer.rs` — CodeSymbol (line 22), ProjectIndex (line 35), `init_schema` (line 56) — existing FTS5-based broad-stroke indexer. INTEL-01 *complements* (call-graph edges) but does not replace; the gate-fallback path in INTEL-03 routes through indexer.rs's existing FTS query when `tree_sitter_enabled = false` or symbol graph is empty.
- `src-tauri/src/commands.rs` — `send_message_stream_inline` entry (line 969), user_query intake (the line where `last_user_text` is captured before prompt build). INTEL-06 inserts the anchor-extraction prelude at this entry point, BEFORE Phase 32's prompt build, BEFORE Phase 35's DECOMP-01 trigger.
- `src-tauri/src/lib.rs` — `mod` registrations + `generate_handler!`. Phase 36 adds `mod intelligence;` + 3 new commands (`reindex_symbol_graph`, `reload_capability_registry`, `get_active_model_capabilities`).
- `src-tauri/src/config.rs` — `BladeConfig` / `DiskConfig` six-place pattern (already locked from Phase 32-07 / 33-01 / 34-01 / 35-01). New `intelligence: IntelligenceConfig` sub-struct lives here.
- `src-tauri/src/providers/mod.rs` — `complete_turn`, `stream_text`, `default_model_for(provider)`, model-context-length metadata. INTEL-04's registry validation cross-checks against this metadata at startup.
- `src-tauri/src/memory.rs` — `query_memories(topic, limit)` — INTEL-06's `@memory:` anchor injects through this existing path.
- `src-tauri/src/clipboard.rs` and `src-tauri/src/screen_timeline.rs` — current screenshot OCR path; INTEL-06's `@screen` anchor invokes the existing OCR harvest path that Phase 32 already uses for the vision section.
- `src/features/admin/DoctorPane.tsx` — Phase 32 surface; INTEL-03's `repo_map` row in LAST_BREAKDOWN auto-renders without frontend changes; Claude's-discretion sub-renderer for top-3 symbols extends here.
- `src/features/chat/ChatComposer.tsx` (or wherever existing message-content parsing lives) — INTEL-06 extends with AnchorChip rendering when `intelligence.context_anchor_enabled = true`.

### Research Citations (locked in v1.5 milestone)
- **Aider repo map** — Phase 36's repo map and personalized PageRank pattern are direct ports of Aider's approach (RESEARCH §Aider repo map). Damping factor 0.85, 5-minute cache, mention-personalization vector — all locked from Aider's measured-good defaults. https://aider.chat/2023/10/22/repomap.html
- **Goose capability registry** — Phase 36's canonical_models.json is structurally inspired by Goose's per-model capability descriptors. The schema (context_length / tool_use / vision / cost_per_million_in/out) is the v1 superset across the two projects' published schemas.
- **arxiv 2604.14228 — Claude Code architecture** — selective injection (Phase 32) + agentic loop (Phase 33) + tree-sitter context awareness (Phase 36 INTEL-01) form the locked v1.5 stack per RESEARCH.
- **Tree-sitter** — language coverage choice (TS/JS, Rust, Python for v1) and s-expression query approach are the standard tree-sitter usage pattern. https://tree-sitter.github.io/tree-sitter/
- **mini-SWE-agent** — used in Phase 33 + 35; not directly relevant to Phase 36 (no agent-loop changes here).
- **OpenHands condenser** — used in Phase 32; not extended in Phase 36.

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — BLADE memory index (chat-first pivot, UAT rule, ghost CSS tokens, streaming contract, deferred-UAT pattern). INTEL-06's AnchorChip rendering must respect the streaming contract: no chip render in the stream-during phase; chips render after the user message is committed (Phase 32 streaming-message-shape contract).
- `docs/testing ss/` (path has a literal space) — UAT screenshot storage

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete code patterns to reuse (not invent):**

- INTEL-03 repo map injection in brain.rs (within the existing code section gate):
  ```rust
  // ─── INTEL-03: repo map injection (replaces FTS code list when available) ──
  if config.intelligence.tree_sitter_enabled
      && score_or_default(user_query, "code", 1.0) > gate
  {
      let mentioned = harvest_mentioned_symbols(user_query, recent_messages);
      let map_opt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          intelligence::repo_map::build_repo_map(
              user_query,
              &mentioned,
              config.intelligence.repo_map_token_budget,
              &config,
          )
      })).unwrap_or_else(|_| {
          log::warn!("[INTEL-03] repo map builder panicked; falling through to FTS");
          None
      });
      if let Some(map) = map_opt {
          prompt.push_str(&map);
          record_section("repo_map", map.len());
          // FTS code list is suppressed when the repo map ships
      } else {
          inject_fts_code_section(...); // Phase 32 baseline
      }
  } else if score_or_default(user_query, "code", 1.0) > gate {
      inject_fts_code_section(...); // tree_sitter_enabled=false path
  }
  ```

- INTEL-05 router rewire (inside select_provider tier-1 capability check):
  ```rust
  // INTEL-05: prefer canonical_models.json over capability_probe matrix
  if let Some(reg_entry) = intelligence::capability_registry::get_capabilities(prov, model) {
      let has_cap = match cap {
          "vision" => reg_entry.vision,
          "audio" => reg_entry.audio,
          "tools" => reg_entry.tool_use,
          "long_context" => reg_entry.context_length >= 100_000,
          _ => false,
      };
      // ... use has_cap to drive the chain selection ...
  } else {
      // Legacy capability_probe path stays as fallback
      let cap_capable = capability_probe::infer_capabilities(prov, model);
      // ...
  }
  ```

- INTEL-06 anchor-parsing prelude in commands.rs send_message_stream_inline:
  ```rust
  let (clean_query, anchors) = if config.intelligence.context_anchor_enabled {
      std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          intelligence::anchor_parser::extract_anchors(&user_query)
      })).unwrap_or_else(|_| {
          log::warn!("[INTEL-06] anchor parser panicked; treating query as plain text");
          (user_query.clone(), Vec::new())
      })
  } else {
      (user_query.clone(), Vec::new())
  };
  // Inject anchored content as labelled system notes BEFORE Phase 32 selective gating runs.
  let anchor_injections = intelligence::anchor_parser::resolve_anchors(&anchors, &app, &config).await;
  // anchor_injections is Vec<(label, content)> — passed through to brain prompt assembly with bypass-gate flag.
  ```

- `safe_slice(text, max_chars)` from `lib.rs` is mandatory for: anchored file content truncation (INTEL-06), repo map row rendering (INTEL-03), OCR text injection from `@screen` (INTEL-06), memory fact rendering (INTEL-06), file_path display in symbol map rows.

- Six-place config wire-up — copy the diff Phase 35-01 used for `DecompositionConfig` and adapt every line for `IntelligenceConfig`. Don't try to remember the six places from memory.

**Concrete config additions (six-place rule applies to each):**
```rust
pub struct IntelligenceConfig {
    pub tree_sitter_enabled: bool,                       // default true
    pub repo_map_token_budget: u32,                      // default 1000
    pub pagerank_damping: f32,                           // default 0.85
    pub capability_registry_path: PathBuf,               // default blade_config_dir().join("canonical_models.json")
    pub context_anchor_enabled: bool,                    // default true
}
```
Add `intelligence: IntelligenceConfig` field to `BladeConfig` and `DiskConfig`. Default impl, load_config, save_config — six places per CLAUDE.md.

**Concrete SymbolNode + SymbolKind + Anchor + CapabilityRegistry shapes:**
```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SymbolNode {
    pub id: String,
    pub name: String,
    pub kind: SymbolKind,
    pub file_path: String,
    pub line_start: u32,
    pub line_end: u32,
    pub language: String,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SymbolKind { Function, Type, Module, Constant }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum Anchor {
    Screen,
    File { path: String },
    Memory { topic: String },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CapabilityRegistry {
    pub version: u32,
    pub providers: std::collections::HashMap<String, ProviderEntry>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProviderEntry {
    pub models: std::collections::HashMap<String, ModelCapabilities>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelCapabilities {
    pub context_length: u32,
    pub tool_use: bool,
    pub vision: bool,
    #[serde(default)]
    pub audio: bool,
    pub cost_per_million_in: f32,
    pub cost_per_million_out: f32,
    #[serde(default)]
    pub notes: String,
}
```

**Concrete Cargo.toml additions:**
```toml
tree-sitter = "0.22"
tree-sitter-typescript = "0.21"
tree-sitter-rust = "0.21"
tree-sitter-python = "0.21"
petgraph = "0.6"
```
(`once_cell` and `regex` are already present; verify before adding.)

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't run `cargo check` after every edit — batch first, check at end (1-2 min per check).
- Don't add Co-Authored-By lines to commits.
- Don't use `&text[..n]` on user content — use `safe_slice`. Especially load-bearing for anchored file content (INTEL-06) where user-supplied paths can hold arbitrary UTF-8.
- Don't create a Tauri command name that already exists in another module — Tauri's macro namespace is FLAT. Verify `reindex_symbol_graph`, `reload_capability_registry`, `get_active_model_capabilities` are unique before adding to `generate_handler!`.
- Don't migrate `capability_probe::infer_capabilities` callers in v1 — INTEL-05 inserts a registry-lookup BEFORE the legacy probe call inside `select_provider` only. The other 25+ probe call sites stay unchanged per Phase 11's blast-radius discipline.
- Don't claim the phase is "done" because static gates pass — runtime UAT per CLAUDE.md is mandatory; v1.1 retracted on this exact failure.
- Don't extend tree-sitter language coverage beyond TS/JS, Rust, Python in v1 — ROADMAP scope is fixed; Go/Ruby/Java/C++ are v1.6+.
- Don't replace `indexer.rs`'s FTS — INTEL-01 *complements* it. The fallback path when `tree_sitter_enabled = false` or symbol graph is empty MUST route through indexer.rs's existing FTS query.
- Don't allow @-syntax to be interpreted as plain text WHEN `context_anchor_enabled = true` — anchors must be parsed and either honored or surface a structured error to the user; silently dropping a typed `@file:foo.rs` is worse than an obvious error.

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 36 scope:

- **Additional tree-sitter languages (Go, Ruby, Java, C++, C)** — current scope: TypeScript/JavaScript, Rust, Python. ROADMAP fixes scope at the three above; v1.6+ for others. Go is the strongest candidate for the next addition (BLADE may itself add Go bindings; many user codebases are Go-heavy).
- **Cross-file refactoring intelligence (rename symbol across project)** — current scope: read-only graph for context injection; v1.6+ for write-side. The symbol graph data structure supports it; the executor is missing.
- **Symbol graph live-update on file save** — current scope: re-index on demand (CLI command + on-startup-stale-trigger). Live file-watcher integration is v1.6+; Phase 36's UAT step (5) explicitly verifies the staleness UX.
- **LSP integration for richer symbol info** — current scope: tree-sitter alone (cheap, deterministic, no language server processes). LSP would give us typescript-language-server-quality refactor-safe symbol resolution; v1.6+ when it justifies its memory + startup cost.
- **Multi-repo symbol graph** — current scope: single project (the active project's root, derived from cwd at index time). v1.6+ if BLADE ever workflows multiple repositories simultaneously.
- **Anchor autocomplete in chat input** — current scope: regex-based parsing of typed `@screen`/`@file:`/`@memory:` patterns. Autocomplete UX (Mention-style picker) is v1.6+.
- **`@context-anchor` for swarm sub-agents** — current scope: parent only (anchors live in user-typed text; sub-agents synthesize their own goals). v1.6+ if eval shows sub-agents benefit from explicit anchor inheritance.
- **PageRank cache TTL knob** — current scope: locked at 5 minutes per Aider's pattern. Configurable via `repo_map_invalidation_seconds: u64` if Phase 37 eval finds the TTL is wrong.
- **PageRank per-sub-agent personalization** — current scope: parent computes once, sub-agents inherit. v1.6+ if multi-divergent-context proves valuable for sub-agent fan-out.
- **Cross-edge weighting (Calls weighted by call frequency)** — current scope: tree-sitter gives us call-site presence; weighting by frequency requires runtime tracing. v1.6+ if eval shows ranking quality benefits from frequency weighting.
- **DoctorPane visualization of the symbol graph** — current scope: LAST_BREAKDOWN row + Claude's-discretion top-3 symbol inline. A force-directed graph renderer is v1.6+ polish.
- **canonical_models.json write-side UI** — current scope: hand-edit the JSON file. v1.6+ for a settings page with model-add UX.
- **Per-region pricing in canonical_models.json schema** — current scope: single cost field. v1.6+ if EU/US price drift becomes user-visible.
- **Anchor support for glob patterns (`@file:src/**/*.rs`)** — current scope: single-path per anchor; user chains multiple `@file:` for multi-file context. v1.6+ if eval shows it matters.
- **Anchor support for URLs (`@url:https://...`)** — current scope: three anchor types (screen, file, memory). URL fetch is a candidate for v1.6+; for v1, users invoke `@web:` via the existing tool path or paste content directly.
- **Vision-not-on-active-model mid-stream re-route** — current scope: routing decision at request entry; once a stream starts, it stays on the chosen model. Mid-stream re-route on capability mismatch is v1.6+.
- **Sub-agent provider selection consults registry** — current scope: Phase 35's role-based provider selection (`select_provider_for_task`) stays; INTEL-05 only rewires the top-level `select_provider`. Sub-agent provider selection consulting the registry is a v1.6+ harmonization.
- **Symbol graph compaction (collapse rarely-touched files)** — current scope: graph grows linearly with codebase size; for a 100k-symbol codebase, the graph is ~5-10MB SQLite which is fine. v1.6+ if cumulative session cost demands it.
- **EVAL-01 multi-step task completion benchmark** — Phase 37, NOT this phase. Phase 36 ships the intelligence; Phase 37 scores it on the 10 representative tasks.
- **`verify:intelligence` gate (EVAL-05)** — Phase 37's responsibility.
- **EVAL-02 context efficiency benchmark using repo map** — Phase 37, NOT this phase.
- **Auto-decomposition consulting the symbol graph for step boundaries** — current scope: Phase 35's heuristic step counter (verbs/files/tools). v1.6+ if INTEL eval shows symbol-graph-aware decomposition produces materially better DAGs.

</deferred>

---

*Phase: 36-context-intelligence*
*Context gathered: 2026-05-06 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / PROJECT.md / CLAUDE.md / Phase 35 predecessor (35-CONTEXT.md) / Phase 34 predecessor (34-CONTEXT.md + 34-11-SUMMARY.md) / Phase 33 predecessor (33-CONTEXT.md) / Phase 32 fallback discipline (32-CONTEXT.md, 32-07-PLAN.md) / live codebase grounding at knowledge_graph.rs (916 lines, KnowledgeNode/KnowledgeEdge schema for INTEL-01 extension) + router.rs (663 lines, select_provider tier-1 capability check at line 246-287 for INTEL-05 rewire) + capability_probe.rs (479 lines, OVR_* arrays for INTEL-04 JSON port) + brain.rs (3053 lines, build_system_prompt_inner code section gate + LAST_BREAKDOWN accumulator for INTEL-03 injection) + indexer.rs (643 lines, CodeSymbol + FTS5 for INTEL-01 fallback path) + commands.rs (3030+ lines, send_message_stream_inline entry for INTEL-06 anchor prelude).*
