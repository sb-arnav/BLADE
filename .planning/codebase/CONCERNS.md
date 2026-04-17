# Codebase Concerns

**Analysis Date:** 2026-04-17

## Tech Debt

### Large Monolithic Modules in src-tauri/src/
- **Issue:** Several core modules exceed 3,000+ lines, making them difficult to navigate, test, and refactor
- **Files:**
  - `runtimes.rs` (5,785 lines) — Provider/model switching logic
  - `native_tools.rs` (3,477 lines) — 37+ built-in tools in single file
  - `hive.rs` (3,351 lines) — Distributed agent mesh coordination
  - `agent_commands.rs` (2,884 lines) — Agent task execution
  - `commands.rs` (2,485 lines) — Main chat command + streaming
- **Impact:** Harder to locate specific code; increased risk of merge conflicts; slower compilation; refactoring becomes risky
- **Fix approach:** Gradually split these modules into logical submodules (e.g., `runtimes/anthropic.rs`, `runtimes/openai.rs`, `native_tools/shell.rs`, etc.). Use barrel file re-exports to maintain API.

### 722+ Tauri Commands Across Flat Namespace
- **Issue:** `lib.rs` registers 722+ commands in a single `generate_handler![]` macro. Tauri's command namespace is globally flat—duplicate function names across modules cause silent failures or overrides
- **Files:** `src-tauri/src/lib.rs` (~1,577 lines); 150+ module declarations
- **Impact:** Easy to accidentally create name collisions; hard to audit all registered commands; refactoring module names requires searching all files for name changes
- **Fix approach:** Introduce explicit command prefixes per subsystem (e.g., `agent_`, `memory_`, `browser_`). Add a build script that validates no duplicate command names exist. Consider organizing commands into feature-gated groups.

### 82 Unsafe/Unwrap Invocations in Rust Code
- **Issue:** Found 82 instances of `unsafe`, `panic!`, or `unwrap()` across src-tauri/src (mostly in tests and fallback paths, but some in runtime code)
- **Files:** `db.rs` (multiple unwrap calls in tests), `background_agent.rs` (lines 244-245), `crypto.rs` (test unwraps), various others
- **Impact:** Potential panics in production; unwrap() on failed operations can crash the app instead of gracefully degrading
- **Fix approach:** Audit each unwrap—replace with Result propagation or Option.ok_or(). For tests, unwrap is acceptable. For runtime code, always use `?` operator or explicit error handling.

### Config Registration Discipline (6-Place Rule Fragility)
- **Issue:** New config fields require updates in 6 places: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, and `save_config()`. Missing even one breaks the feature silently
- **Files:** `src-tauri/src/config.rs` (lines 55-250+); calls from `lib.rs`, commands
- **Impact:** Easy to add a field and forget to migrate it in save/load, causing config loss on app restart; no compile-time enforcement
- **Fix approach:** Create a config builder macro or trait that validates all 6 places at compile time. Alternatively, use serde defaults more aggressively and unit test config round-trips.

### String Slicing on Non-ASCII Without Safe Guards
- **Issue:** Code uses `&text[..n]` in many places instead of `crate::safe_slice()`. While `safe_slice()` exists and is documented in CLAUDE.md, not all call sites use it
- **Files:** Search `split_whitespace()` (98 occurrences), parsing in `security_monitor.rs` (lines 84-96), `context.rs` (multiple places)
- **Impact:** Emoji, CJK, or multi-byte UTF-8 in user input could panic the app at string slice boundaries
- **Fix approach:** Audit all user-facing string truncation; replace with `safe_slice()`. Add a lint rule (via pre-commit hook or CI check) to reject bare `&s[..n]` patterns.

## Known Bugs & Regressions

### Recent Git Pattern: Transparency Overhaul (Dec 2024)
- **Issue:** Series of commits suggest a major UI overhaul from opaque backgrounds to transparent glass (985ece1, d3cd803, d784f09). While completed, the scale (280+ opaque → transparent changes across 88 components) suggests possible visual regressions or edge cases
- **Symptoms:** Potential rendering glitches on certain OS/theme combos; possible readability issues in bright daylight
- **Fix approach:** UI/visual regression testing on all three platforms (Windows, macOS, Linux). Capture baseline screenshots of all major views.

### Voice History JSON Enum Mismatch (0abd8e5)
- **Issue:** Fixed in commit 0abd8e5 ("voice history JSON — match ConversationMessage enum variants"). Suggests past enum changes broke serialization
- **Symptoms:** Voice recordings lost on enum field rename/reorder
- **Workaround:** Already fixed; monitor for similar issues during model refactoring

### Five Runtime Bugs Fixed Recently (7b654a4, 5c52850, 7b654a4)
- **Issue:** Multiple "fix: X runtime bugs" commits in Jan–Feb 2025 suggest ongoing stability issues in production usage
- **Files:** Likely in `commands.rs`, voice/agent code paths
- **Impact:** Users hit crashes/hangs that took multiple patches to surface and fix
- **Fix approach:** Add structured logging for all error paths; set up crash telemetry (with consent) or require users to report crashes with logs.

## Security Considerations

### Keyring Storage Trust Model
- **Risk:** API keys stored via OS keyring (Windows Credential Manager, macOS Keychain, Linux secret-service) assume OS-level security. If the OS is compromised, keys are exposed
- **Files:** `src-tauri/src/config.rs` (lines 400-426, keyring usage); legacy plain-text migration (line 449)
- **Current mitigation:** Uses standard OS keyring API; no keys stored in config.json
- **Recommendations:**
  - Ensure legacy plaintext keys are migrated on first load and deleted
  - Log a warning if the app detects a plaintext key in disk config
  - Consider adding a "rotate all keys" command in Settings
  - Document keyring trust assumptions in user-facing docs

### Flat Tauri Command Namespace Invites Injection
- **Risk:** With 722+ commands globally registered, any naming collision could allow an attacker to hijack a command. Malicious code could register a command with the same name as a legitimate one
- **Files:** `src-tauri/src/lib.rs` (generate_handler macro); all command-defining modules
- **Current mitigation:** Single-author codebase; no third-party command registration in current code
- **Recommendations:** Add a build-time check that fails the build if two commands have the same name. Use prefixes per subsystem (e.g., `agent_execute`, `memory_set`).

### `execute_batch!` SQL Macro — Double Quote Vulnerability
- **Risk:** Documented in CLAUDE.md: SQL inside `execute_batch!` macro must NOT have double quotes, or the macro breaks. This is a footgun for SQL injection if dynamic SQL is ever added
- **Files:** `src-tauri/src/db.rs` (any uses of execute_batch!); `crate::db` usage throughout
- **Current mitigation:** All SQL is static (templated at compile time)
- **Recommendations:**
  - Add a comment on the execute_batch! macro definition warning about quote handling
  - If dynamic SQL is ever needed, refactor away from the macro

### Browser Automation (CDP) XSS & Phishing
- **Risk:** `browser_native.rs` and `browser_agent.rs` allow BLADE to control Chrome/Edge/Brave browsers, potentially auto-filling passwords, clicking links, or submitting forms
- **Files:** `src-tauri/src/browser_native.rs` (1,102 lines), `src-tauri/src/browser_agent.rs` (untested agent loop)
- **Current mitigation:** Local-only; no remote command input
- **Recommendations:**
  - Add safeguards: require explicit user confirmation before auto-filling passwords
  - Log all browser automation actions for audit
  - Warn if browser_agent tries to submit forms to unfamiliar domains
  - Test phishing URLs against known lists before agent visits them

### Clipboard Auto-Action (Potential Code Execution)
- **Risk:** `clipboard.rs` monitors clipboard, detects shell commands, and may auto-execute. If detection is naive, malicious code pasted by accident could run
- **Files:** `src-tauri/src/clipboard.rs` (lines 1-100+ decision logic)
- **Current mitigation:** Routes through decision_gate for filtering
- **Recommendations:**
  - Always ask for confirmation before executing clipboard content, even in Extreme god_mode
  - Log clipboard actions and allow user review/denial
  - Add a "block clipboard execution" panic button

### Whisper Local Model (LLVM Dependency)
- **Risk:** `whisper-rs` requires LLVM/libclang (gated behind `local-whisper` feature). Default build skips it, but if enabled, adds large binary size and system dependency
- **Files:** `src-tauri/Cargo.toml` (line 57, optional feature); `.github/workflows/build.yml` (line 56, installs libclang-dev)
- **Current mitigation:** Feature-gated; not enabled by default; CI correctly installs libclang-dev
- **Recommendations:**
  - Document that `local-whisper` feature requires LLVM on the system
  - Provide pre-built whisper.cpp binaries for each platform to avoid compilation
  - Consider bundling a smaller whisper model as default rather than requiring full download

## Performance Bottlenecks

### Screen Timeline: 30s Capture + OCR Every Screenshot
- **Issue:** `screen_timeline.rs` captures a screenshot every 30s, runs OCR (likely via fastembed or external service), and stores. With 24/7 operation, this is 2,880 screenshots/day
- **Files:** `src-tauri/src/screen_timeline.rs`, `src-tauri/src/screen_timeline_commands.rs`
- **Cause:** Brute-force indexing for Total Recall feature; no intelligent sampling (e.g., skip if screen hasn't changed)
- **Improvement path:**
  - Add frame-difference detection: only OCR if > 10% pixels changed
  - Compress older screenshots to lower resolution
  - Implement tiered storage: hot (today), warm (this week), cold (archive)
  - Set retention limits per tier (e.g., 7 days at full res, 30 days at 50%, delete after 90 days)

### Compression Logic in `send_message_stream`
- **Issue:** `compress_conversation_smart()` (lines 119–180+) uses a heuristic to compress older turns when hitting token limits. If compression fails, falls back to `truncate_to_budget()` which may lose context
- **Files:** `src-tauri/src/commands.rs`
- **Cause:** Async LLM call to compress within hot path; no timeout on compression request itself
- **Improvement path:**
  - Add a timeout to compression requests (e.g., 5 seconds)
  - If compression times out, immediately truncate instead of blocking
  - Log compression events (success/fail/fallback) for debugging

### Embedding Search (BM25 + Vector Hybrid)
- **Issue:** `embeddings.rs` does hybrid search (BM25 + vector). Unclear if this scales to large knowledge bases
- **Files:** `src-tauri/src/embeddings.rs` (untested module)
- **Cause:** No pagination or result limits documented
- **Improvement path:**
  - Profile embedding search with 10K+ documents
  - Add pagination (offset/limit) to search results
  - Cache frequent queries

### Network Monitor Parsing (98 split_whitespace calls)
- **Issue:** `security_monitor.rs` lines 83–96 parse netstat output via split_whitespace(). Format varies by OS/locale; this is fragile
- **Files:** `src-tauri/src/security_monitor.rs`
- **Cause:** Text parsing instead of structured data (netstat JSON flag not available on all platforms)
- **Improvement path:**
  - Use `netstat -j` (JSON) on systems that support it
  - Fall back to regex parsing for consistent field extraction
  - Add unit tests with real netstat output from each OS

## Fragile Areas

### Module Registration (150+ mods in lib.rs)
- **Files:** `src-tauri/src/lib.rs` (lines 1–155)
- **Why fragile:** Adding a new module requires:
  1. Create the .rs file
  2. Add `mod module_name;` in lib.rs
  3. Add all public commands to `generate_handler![]`
  4. If it needs config, add to 6 places in config.rs
  Missing any step causes silent failures or compilation errors
- **Safe modification:**
  - Always add mod declaration AND commands in the same commit
  - Write a module registration checklist comment in lib.rs
  - Use a script or build.rs to validate all mods in generate_handler
- **Test coverage:** No automated test verifies all registered commands can be called

### Decision Gate Thresholds
- **Files:** `src-tauri/src/decision_gate.rs` (act/ask/queue/ignore classifier)
- **Why fragile:** Thresholds are hand-tuned (e.g., confidence > 0.8 = act). No A/B testing or user feedback loop documented
- **Safe modification:** Log all decisions (act/ask/queue/ignore) with confidence scores. Add telemetry (with consent) to measure false positives
- **Test coverage:** Likely none; no unit tests for decision logic found

### Ghost Mode Content Protection
- **Files:** `src-tauri/src/ghost_mode.rs` (lines 700–750+)
- **Why fragile:** Detects "meeting" mode and blurs/hides sensitive content. Detection is heuristic-based (TODO comment at line 747: "let user calibrate which speaker index is 'me'")
- **Safe modification:** Add explicit "I'm in a meeting" toggle in UI. Allow user to configure which apps trigger ghost mode
- **Test coverage:** None found

### MCP Server Health Monitoring + Auto-Reconnect
- **Files:** `src-tauri/src/mcp.rs` (lines 1–631); health monitoring loop spawned in lib.rs
- **Why fragile:** Reconnect logic tries 3 times (line 13) with 30-second interval. If an MCP server is flaky, this could cause thrashing
- **Safe modification:** Add exponential backoff: retry at 5s, 10s, 30s, then give up
- **Test coverage:** No unit tests for MCP reconnection logic

## Scaling Limits

### SQLite Single-Writer Constraint
- **Current capacity:** SQLite supports concurrent readers but only one writer at a time. With async Rust spawning many writes (conversations, knowledge graph, timestamps), contention is possible
- **Limit:** Under high load (many agents writing simultaneously), `db.rs` could see SQLITE_BUSY errors
- **Scaling path:**
  - Monitor for SQLITE_BUSY in production logs
  - If it becomes an issue, migrate to PostgreSQL (Supabase)
  - Add write queue + batch commits to reduce lock contention

### Memory Usage: Screen Timeline + Embeddings
- **Current capacity:** Storing 2,880 screenshots/day at 500KB each = ~1.4GB/day. Embeddings for knowledge graph add to RAM usage during indexing
- **Limit:** 30 days of storage = 42GB disk; RAM spike during search could cause OOM on constrained machines
- **Scaling path:**
  - Implement tiered storage (compress old screenshots)
  - Add memory limits to embedding index (e.g., max 100K vectors in memory)
  - Use mmap for large indexes

### MCP Server Polling Loop
- **Current capacity:** `integration_bridge.rs` spawns background polls for Gmail, Calendar, Slack, GitHub. Each poll adds latency + memory
- **Limit:** 10+ MCP servers polled every 5 minutes = 2+ API calls/second in background
- **Scaling path:**
  - Add smarter polling: skip if user is idle, backoff if server is slow
  - Cache poll results aggressively

## Dependencies at Risk

### whisper-rs (Audio Transcription)
- **Risk:** Requires LLVM/libclang to build; behind feature flag. If enabled, adds 200MB+ binary size
- **Impact:** Users with local Whisper model requirement must have LLVM dev tools; CI complexity
- **Migration plan:** Consider switching to `fast-whisper` (Python) or bundling pre-built whisper.cpp binary instead of compiling

### reqwest (HTTP Client)
- **Risk:** Does not validate certificate chains by default in some versions; relies on OS CA store
- **Impact:** Potential MITM attacks if certificate validation is misconfigured
- **Recommendations:** Audit TLS setup in `reqwest` initialization; ensure certificate pinning for sensitive endpoints (Anthropic API, keyring services)

### Tauri Plugins (15+ dependencies)
- **Risk:** All Tauri plugins are tied to Tauri v2. Any breaking change in Tauri requires updating all plugins
- **Impact:** Upgrade path is all-or-nothing; harder to pin specific versions
- **Recommendations:** Monitor Tauri releases; test upgrades in a branch before releasing to users

### Deprecated tauri-plugin-sql (Removed)
- **Issue:** Removed in favor of manual `rusqlite`. Good decision for control, but increases maintenance burden
- **Impact:** Any schema changes now require hand-written migrations
- **Recommendations:** Document schema versioning; add a `schema_version` column to track migrations

## Test Coverage Gaps

### No Unit Tests for Core Modules
- **Untested areas:**
  - `decision_gate.rs` — Act/ask/queue/ignore classifier (critical for autonomy)
  - `brain.rs` — System prompt assembly (risk: subtle prompt injection or context loss)
  - `memory.rs` — Virtual context blocks (risk: conversation context corrupted)
  - `mcp.rs` — MCP communication (risk: protocol errors, tool failures)
  - `config.rs` — Config load/save (risk: silent corruption on schema changes)
- **Files:** See above
- **Risk:** Regressions in core logic go unnoticed until user-reported bugs
- **Priority:** High — add unit tests for config round-trip, decision_gate thresholds, MCP protocol parsing

### No Integration Tests for Provider Fallback
- **Untested:** Multi-provider fallback chain (e.g., Anthropic → Groq → OpenRouter). If one provider's API changes, others must seamlessly take over
- **Files:** `src-tauri/src/providers/mod.rs`, `src-tauri/src/router.rs`
- **Risk:** Silent failures if provider fallback logic breaks
- **Priority:** Medium — set up mock providers for testing fallback chains

### No E2E Tests (Frontend + Backend)
- **Untested:** Full message flow: user types → invoke command → streaming response → display
- **Files:** React frontend (`src/`), all Tauri commands
- **Risk:** UI/backend desync (e.g., loading state never clears, response never appears)
- **Priority:** Medium — Playwright is in devDeps; write smoke tests for main flows

## Missing Critical Features

### Structured Logging & Observability
- **Problem:** Debug logs exist (console.log, log crate), but no structured event tracking. Hard to diagnose user issues from logs alone
- **Blocks:** Root-cause analysis of user-reported crashes; performance profiling
- **Impact:** Each bug report requires back-and-forth with user to gather logs
- **Approach:** Add structured logging with serde_json for events (e.g., command latency, decision_gate choices, MCP reconnects). Export via events or log file.

### Build-Time Validation of Command Namespace
- **Problem:** 722 commands registered in flat namespace; no build-time check for duplicates
- **Blocks:** Safe refactoring of command names
- **Impact:** Easy to introduce silent command name collisions
- **Approach:** Add a build.rs script that parses lib.rs and generates_handler, validates no duplicates, fails build if found

### Comprehensive Test Suite for Config Migrations
- **Problem:** Config schema has evolved (legacy api_key migration, many new fields). No tests verify round-trip load/save
- **Blocks:** Safe schema evolution without data loss
- **Impact:** Users could lose config on update if migration breaks
- **Approach:** Add tests that create old-format config, load it, verify migration, save, reload, assert no loss

### Automated Visual Regression Testing
- **Problem:** Major UI overhaul (Dec 2024) had no baseline tests. Hard to verify no regressions introduced
- **Blocks:** Safe UI refactoring
- **Impact:** Visual bugs only caught after release
- **Approach:** Use Playwright to take screenshots of major views on each platform; baseline them; diff on CI

## Build & CI Concerns

### CI Builds Three Platforms (Windows, macOS, Linux)
- **Risk:** Each platform has different system deps. Missing deps cause CI to fail after code is committed
- **Files:** `.github/workflows/build.yml`, `release.yml`
- **Current mitigation:** Ubuntu CI includes libsecret, libxdo, libspa, libclang-dev. macOS and Windows rely on built-in deps
- **Recommendation:** Document exact system requirements for local dev. Add a setup script (`./scripts/setup-dev-env.sh`) that validates all deps.

### Smoke Build Only (No Full Build on PR)
- **Issue:** `.github/workflows/build.yml` runs a "smoke build" (tsc typecheck + cargo check) but does NOT build the final app bundle
- **Impact:** A PR could pass CI but fail to bundle; users only discover on release
- **Recommendation:** Add a full release build step on tagged commits (already done in release.yml), but consider adding selective full builds on PRs that touch Tauri config

### Version Mismatch Between package.json, Cargo.toml, tauri.conf.json
- **Issue:** All three must be kept in sync (currently all 0.7.9)
- **Impact:** If they diverge, updater and versioning break
- **Recommendation:** Add a pre-commit hook that validates all three have the same version

## Architectural Risks

### 130+ Rust Modules with Circular Dependencies Potential
- **Risk:** With 130+ modules, accidental circular dependencies can creep in (`mod A uses mod B uses mod A`)
- **Mitigation:** Rust's borrow checker prevents some cycles, but not all (traits, re-exports)
- **Recommendation:** Document module dependency tree. Use `cargo-tree` in CI to detect cycles

### Flat Tauri Command Namespace Discourages Layering
- **Risk:** All 722 commands are equally accessible from frontend. No concept of "user-facing" vs "internal" commands
- **Impact:** Frontend can call internal commands (e.g., debug commands) that shouldn't be user-accessible
- **Recommendation:** Adopt a naming convention (e.g., `__internal_` prefix for internal commands) and document which commands are stable API

### Streaming Response Compression Uses Online LLM Call
- **Risk:** `send_message_stream` calls an LLM to compress old turns if hitting token limit. This adds latency + potential failure point mid-conversation
- **Impact:** If compression LLM fails, entire conversation stalls
- **Recommendation:** Compress asynchronously in background after conversation ends, not during streaming

---

*Concerns audit: 2026-04-17*
