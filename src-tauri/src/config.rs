use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "blade-ai";

/// Per-task-type provider routing.
/// Each field is an optional provider name override — if set and the provider has a stored key,
/// requests of that type use that provider. Otherwise falls back to the active provider.
///
/// This lets BLADE use Groq for quick replies, Anthropic for code, and Gemini for vision
/// while feeling like one unified brain (the system prompt / soul is injected regardless).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskRouting {
    /// Provider for code tasks (code gen, debugging, refactoring)
    #[serde(default)]
    pub code: Option<String>,
    /// Provider for vision tasks (screenshots, images)
    #[serde(default)]
    pub vision: Option<String>,
    /// Provider for fast/simple tasks (one-liner answers, classification)
    #[serde(default)]
    pub fast: Option<String>,
    /// Provider for creative tasks (writing, brainstorming)
    #[serde(default)]
    pub creative: Option<String>,
    /// Fallback provider when the primary fails (rate limit, outage, quota)
    #[serde(default)]
    pub fallback: Option<String>,
}

// ---------------------------------------------------------------------------
// Phase 11 Plan 11-02 (D-52, D-53) — capability probe result metadata.
//
// ProbeStatus classifies the outcome of a single idempotent capability probe.
// ProviderCapabilityRecord carries the capability flags (derived from the
// static matrix in capability_probe.rs) plus the probe timestamp. Records are
// persisted on BladeConfig.provider_capabilities and surfaced in the UI so
// the user knows which providers the app has confirmed working.
//
// @see src-tauri/src/capability_probe.rs
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-52
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub enum ProbeStatus {
    #[default]
    NotProbed,
    Active,
    InvalidKey,
    ModelNotFound,
    RateLimitedButValid,
    ProviderDown,
    NetworkError,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderCapabilityRecord {
    pub provider: String,
    pub model: String,
    pub context_window: u32,
    pub vision: bool,
    pub audio: bool,
    pub tool_calling: bool,
    pub long_context: bool,
    pub last_probed: chrono::DateTime<chrono::Utc>,
    #[serde(default)]
    pub probe_status: ProbeStatus,
}

// ---------------------------------------------------------------------------
// Phase 11 Plan 11-02 — test-only keyring override seam.
//
// Used by router + probe unit tests (Plan 11-04) to deterministically mock
// `get_provider_key` without touching the real OS keyring. Production builds
// never compile this; the `#[cfg(test)]` gate excludes it from release
// artifacts by compiler contract.
//
// Usage:
//     config::test_set_keyring_override("anthropic", "sk-ant-fake");
//     let k = config::get_provider_key("anthropic");
//     assert_eq!(k, "sk-ant-fake");
//     config::test_clear_keyring_overrides();
// ---------------------------------------------------------------------------

#[cfg(test)]
thread_local! {
    static TEST_KEYRING_OVERRIDES: std::cell::RefCell<std::collections::HashMap<String, String>>
        = std::cell::RefCell::new(std::collections::HashMap::new());
}

#[cfg(test)]
pub fn test_set_keyring_override(provider: &str, key: &str) {
    TEST_KEYRING_OVERRIDES.with(|o| {
        o.borrow_mut().insert(provider.to_string(), key.to_string());
    });
}

#[cfg(test)]
pub fn test_clear_keyring_overrides() {
    TEST_KEYRING_OVERRIDES.with(|o| o.borrow_mut().clear());
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SavedMcpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

// ── Phase 12 Plan 12-02 (D-65) — per-source-class privacy toggles. ─────────
// All 8 scan source classes are ON by default so the SCAN-13 baseline is
// reachable out of the box. User can opt out per class in Settings → Privacy.
// Follows the 6-place config pattern (CLAUDE.md §Config field 6-place rule).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanClassesEnabled {
    pub fs_repos: bool,
    pub git_remotes: bool,
    pub ide_workspaces: bool,
    pub ai_sessions: bool,
    pub shell_history: bool,
    pub mru: bool,
    pub bookmarks: bool,
    pub which_sweep: bool,
}

fn default_scan_classes_enabled() -> ScanClassesEnabled {
    ScanClassesEnabled {
        fs_repos: true,
        git_remotes: true,
        ide_workspaces: true,
        ai_sessions: true,
        shell_history: true,
        mru: true,
        bookmarks: true,
        which_sweep: true,
    }
}

// ── Phase 13 Plan 13-01 — Ecosystem tentacle persistence ─────────────────────
// TentacleRecord tracks the lifecycle of each auto-enabled observer tentacle.
// enabled_at == 0 → never registered (first-time registration sets enabled_at = now_secs()).
// enabled_at > 0 && enabled == false → user explicitly disabled; auto_enable_from_scan
// must NOT re-enable (ECOSYS-08).
// Follows 6-place config pattern (CLAUDE.md §Config field 6-place rule).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TentacleRecord {
    pub id: String,            // "repo_watcher" | "slack_monitor" | "deploy_monitor" | "pr_watcher" | "session_bridge" | "calendar_monitor"
    pub enabled: bool,
    pub rationale: String,     // "Auto-enabled because deep scan found 14 repos"
    pub enabled_at: i64,       // Unix timestamp of first auto-enable; 0 = never registered
    #[serde(default)]
    pub trigger_detail: String, // human-readable evidence for Settings display
}

fn default_ecosystem_tentacles() -> Vec<TentacleRecord> { vec![] }
fn default_ecosystem_observe_only() -> bool { true }

// Phase 22 (v1.3) — Voyager skill-write budget cap (VOYAGER-07).
// Total tokens (prompt + estimated response) above which forge_tool refuses
// the LLM call. 50_000 is generous headroom for typical scripts (~1K prompt
// + 5K-30K response); pathological cases trigger the refusal instead of
// runaway token spend.
fn default_voyager_skill_write_budget_tokens() -> u64 { 50_000 }

// ---------------------------------------------------------------------
// Phase 23 Plan 23-01 (v1.3) — Composite reward weights (REWARD-01).
// Per D-23-01, the v1.3 default sums to 0.9 because the acceptance
// component is silenced via weight=0.0 (no regenerate UI on chat surface
// today; v1.4 will flip acceptance back to 0.1). validate() therefore
// tolerates sums in [0.0, 1.0+1e-3] rather than == 1.0.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RewardWeights {
    pub skill_success: f32,
    pub eval_gate:     f32,
    pub acceptance:    f32,
    pub completion:    f32,
}

impl Default for RewardWeights {
    fn default() -> Self {
        // v1.3 default: 0.5/0.3/0.0/0.1 (sum 0.9). Acceptance silenced via
        // weight=0.0 per D-23-01 — formula stays computable; v1.4 flips
        // acceptance to 0.1 when the regenerate UI lands, restoring sum=1.0.
        Self { skill_success: 0.5, eval_gate: 0.3, acceptance: 0.0, completion: 0.1 }
    }
}

impl RewardWeights {
    /// Sum of all four weights. v1.3 default = 0.9. Validation accepts
    /// `[0.0, 1.0 + 1e-3]` — the 1e-3 epsilon is float-roundoff slack, not
    /// a semantic allowance for >1.0 sums.
    pub fn sum(&self) -> f32 {
        self.skill_success + self.eval_gate + self.acceptance + self.completion
    }

    /// Validate every weight is in `[0.0, 1.0]` AND the sum is in
    /// `[0.0, 1.0 + 1e-3]`. Called as the FIRST executable statement of
    /// `save_config` so a corrupt sum is hard-rejected before any keychain
    /// write. Read-side soft-clamp lives in Wave 3 hook (Pitfall 5).
    pub fn validate(&self) -> Result<(), String> {
        for (name, v) in [
            ("skill_success", self.skill_success),
            ("eval_gate",     self.eval_gate),
            ("acceptance",    self.acceptance),
            ("completion",    self.completion),
        ] {
            if v < 0.0 || v > 1.0 {
                return Err(format!("reward_weights.{} out of [0,1]: {}", name, v));
            }
        }
        let s = self.sum();
        if s < 0.0 || s > 1.0 + 1e-3 {
            return Err(format!("reward_weights sum out of [0,1]: {}", s));
        }
        Ok(())
    }
}

fn default_reward_weights() -> RewardWeights { RewardWeights::default() }

// ---------------------------------------------------------------------
// Phase 32 Plan 32-01 (CTX-07) — Context Management runtime knobs.
//
// Locked decisions (32-CONTEXT.md):
//   - smart_injection_enabled (default true) is the CTX-07 escape hatch.
//     Flag off = unconditional naive injection (pre-Phase-32 behaviour).
//   - relevance_gate (default 0.2) is the threshold passed to
//     `score_context_relevance` gates. Sections inject when score > gate.
//   - compaction_trigger_pct (default 0.80) — fraction of model context
//     window at which `compress_conversation_smart` fires.
//   - tool_output_cap_tokens (default 4000) — per-tool-output cap;
//     outputs above this are truncated head + tail + summary.
//
// Six-place rule (CLAUDE.md): every BladeConfig field MUST land in
// DiskConfig struct, DiskConfig::default, BladeConfig struct,
// BladeConfig::default, load_config, and save_config.
//
// Backward compatibility: `#[serde(default)]` on the field allows old
// user config.json files (without a `context` key) to load with
// `ContextConfig::default()`. Per-field `#[serde(default = "fn")]`
// guards against partial JSON (missing sub-fields).
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ContextConfig {
    /// CTX-07 escape hatch. true = smart selective injection enabled.
    /// false = unconditional naive injection (pre-Phase-32 behavior).
    #[serde(default = "default_smart_injection_enabled")]
    pub smart_injection_enabled: bool,
    /// Threshold passed to `score_context_relevance` gates. Sections
    /// inject when score > relevance_gate. Default 0.2 matches the
    /// existing low-water mark in `thalamus_threshold`.
    #[serde(default = "default_relevance_gate")]
    pub relevance_gate: f32,
    /// Fraction of model context window at which compaction fires.
    /// Default 0.80.
    #[serde(default = "default_compaction_trigger_pct")]
    pub compaction_trigger_pct: f32,
    /// Per-tool-output cap in tokens. Outputs exceeding this are
    /// truncated head + tail + summary. Default 4000 tokens.
    #[serde(default = "default_tool_output_cap_tokens")]
    pub tool_output_cap_tokens: usize,
}

fn default_smart_injection_enabled() -> bool { true }
fn default_relevance_gate() -> f32 { 0.2 }
fn default_compaction_trigger_pct() -> f32 { 0.80 }
fn default_tool_output_cap_tokens() -> usize { 4000 }

impl Default for ContextConfig {
    fn default() -> Self {
        Self {
            smart_injection_enabled: default_smart_injection_enabled(),
            relevance_gate: default_relevance_gate(),
            compaction_trigger_pct: default_compaction_trigger_pct(),
            tool_output_cap_tokens: default_tool_output_cap_tokens(),
        }
    }
}

// ---------------------------------------------------------------------
// Phase 33 Plan 33-01 (LOOP-06) — Agentic Loop runtime knobs.
//
// Locked decisions (33-CONTEXT.md):
//   - smart_loop_enabled (default true) is the CTX-07-style escape hatch.
//     Flag off = legacy 12-iteration blind loop with no smart features
//     (mirrors context.smart_injection_enabled discipline).
//   - max_iterations (default 25) — hard cap on tool-loop iterations
//     (was hardcoded `for iteration in 0..12` at commands.rs:1621).
//     When smart_loop_enabled=false, the loop reverts to literal 12.
//   - cost_guard_dollars (default 5.0) — per-conversation cumulative
//     spend cap in USD. When exceeded, the loop halts with
//     LoopHaltReason::CostExceeded.
//   - verification_every_n (default 3) — LOOP-01 mid-loop verification
//     probe cadence. Probe fires at iterations N, 2N, 3N, ...
//
// Six-place rule (CLAUDE.md): every BladeConfig field MUST land in
// DiskConfig struct, DiskConfig::default, BladeConfig struct,
// BladeConfig::default, load_config, and save_config.
//
// Rust keyword: `loop` is a keyword. Use raw identifier `r#loop` for
// the FIELD name in struct definitions and access sites. The TYPE name
// `LoopConfig` is fine (Capitalized identifiers don't collide).
//
// Backward compatibility: `#[serde(default)]` on the field allows old
// user config.json files (without a `loop` key) to load with
// `LoopConfig::default()`. Per-field `#[serde(default = "fn")]` guards
// against partial JSON (missing sub-fields).
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LoopConfig {
    /// CTX-07-style escape hatch. true = smart loop enabled (verification,
    /// plan adaptation, token escalation, cost guard, fast-path supplement).
    /// false = legacy 12-iteration blind loop with no smart features.
    #[serde(default = "default_smart_loop_enabled")]
    pub smart_loop_enabled: bool,
    /// Hard cap on tool-loop iterations. Default 25 (was hardcoded 12).
    /// When smart_loop_enabled=false, the loop reverts to literal 12.
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Per-conversation cumulative spend cap in USD. When exceeded, the loop
    /// halts with LoopHaltReason::CostExceeded. Default 5.0.
    #[serde(default = "default_cost_guard_dollars")]
    pub cost_guard_dollars: f32,
    /// LOOP-01 verification probe cadence — fires every N iterations. Default 3.
    #[serde(default = "default_verification_every_n")]
    pub verification_every_n: u32,
}

fn default_smart_loop_enabled() -> bool { true }
fn default_max_iterations() -> u32 { 25 }
fn default_cost_guard_dollars() -> f32 { 5.0 }
fn default_verification_every_n() -> u32 { 3 }

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            smart_loop_enabled: default_smart_loop_enabled(),
            max_iterations: default_max_iterations(),
            cost_guard_dollars: default_cost_guard_dollars(),
            verification_every_n: default_verification_every_n(),
        }
    }
}

impl LoopConfig {
    /// Phase 33 / 33-NN-FIX (BL-01) — hard-reject corrupt loop knobs BEFORE any
    /// keychain write (mirrors `RewardWeights::validate()` at config.rs:219 and
    /// is invoked as the first executable statement of `save_config`).
    ///
    /// The bug this guards against: `verification_every_n: 0` causes an
    /// integer-modulo panic at the firing site
    /// (`(iteration as u32) % verification_every_n`) at iter 1, killing the
    /// run_loop Tokio task with no `chat_done`/`chat_error` — chat appears to
    /// hang. The default is 3 so the happy path is fine, but a hostile config
    /// edit, a future migration that defaults the field to 0, or an
    /// off-by-one in a legacy upgrade path would all DoS the chat task.
    ///
    /// Fields validated:
    ///   - `verification_every_n` MUST be >= 1 (zero panics on `%`)
    ///   - `max_iterations`       MUST be >= 1 (zero would skip the loop body
    ///     entirely; safe but pointless — reject as a clear-error signal)
    ///   - `cost_guard_dollars`   MUST be >= 0.0 (negative values invert the
    ///     `cumulative > cap` halt check)
    ///
    /// The firing site at `loop_engine.rs:537` ALSO carries an in-line
    /// zero-guard (defense in depth) — `validate()` is the strict gate, the
    /// firing-site guard is a safety net for any state that bypassed validate
    /// (e.g. an in-memory edit in tests, or a future deserialize path that
    /// skips `save_config`).
    pub fn validate(&self) -> Result<(), String> {
        if self.verification_every_n == 0 {
            return Err(
                "loop.verification_every_n must be >= 1 (zero panics on integer modulo at the verification firing site)".to_string()
            );
        }
        if self.max_iterations == 0 {
            return Err(
                "loop.max_iterations must be >= 1 (zero would skip the loop body)".to_string()
            );
        }
        if self.cost_guard_dollars < 0.0 {
            return Err(format!(
                "loop.cost_guard_dollars must be >= 0.0, got {}",
                self.cost_guard_dollars
            ));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------
// Phase 34 Plan 34-01 — Resilience runtime knobs (RES-01..05).
//
// Locked decisions (34-CONTEXT.md §Module Boundaries):
//   - smart_resilience_enabled (default true) — CTX-07-style escape hatch.
//     false = stuck detection / circuit breaker / cost-warn / provider
//     fallback all skipped (per-conversation 100% halt still enforced
//     for data integrity; PerLoop cap untouched).
//   - 5 RES-01 stuck thresholds (recent_actions_window, monologue,
//     compaction_thrash, no_progress, plus the circuit-breaker
//     threshold reused by RES-02).
//   - cost_guard_per_conversation_dollars (default 25.0) — RES-04 cap.
//     Phase 33's loop.cost_guard_dollars stays — Phase 34 adds a SECOND
//     cap with PerConversation scope. Both ceilings coexist.
//   - provider_fallback_chain (default vec!["primary","openrouter","groq",
//     "ollama"]) — RES-05 chain. "primary" resolves to BladeConfig.provider.
//   - max_retries_per_provider / backoff_base_ms / backoff_max_ms — RES-05
//     exponential backoff with jitter (0..=200ms additive).
//
// Six-place rule (CLAUDE.md): every BladeConfig field MUST land in
// DiskConfig struct, DiskConfig::default, BladeConfig struct,
// BladeConfig::default, load_config, and save_config.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ResilienceConfig {
    /// CTX-07-style escape hatch. true = stuck/circuit/cost-warn/fallback all
    /// active. false = legacy posture (PerConversation 100% halt still enforced).
    #[serde(default = "default_smart_resilience_enabled")]
    pub smart_resilience_enabled: bool,
    /// RES-01 master toggle for the 5-pattern stuck detector.
    #[serde(default = "default_stuck_detection_enabled")]
    pub stuck_detection_enabled: bool,
    /// RES-01 — capacity of LoopState.recent_actions ring buffer. Default 6.
    #[serde(default = "default_recent_actions_window")]
    pub recent_actions_window: u32,
    /// RES-01 MonologueSpiral threshold (consecutive no-tool turns). Default 5.
    #[serde(default = "default_monologue_threshold")]
    pub monologue_threshold: u32,
    /// RES-01 ContextWindowThrashing threshold (compactions per run). Default 3.
    #[serde(default = "default_compaction_thrash_threshold")]
    pub compaction_thrash_threshold: u32,
    /// RES-01 NoProgress threshold (iterations without new tool/content). Default 5.
    #[serde(default = "default_no_progress_threshold")]
    pub no_progress_threshold: u32,
    /// RES-02 — N consecutive same-type failures before circuit opens. Default 3.
    #[serde(default = "default_circuit_breaker_threshold")]
    pub circuit_breaker_threshold: u32,
    /// RES-04 — per-conversation spend cap in USD. Warn at 80%, halt at 100%.
    /// Default 25.0. Phase 33's loop.cost_guard_dollars stays as the per-loop cap.
    #[serde(default = "default_cost_guard_per_conversation_dollars")]
    pub cost_guard_per_conversation_dollars: f32,
    /// RES-05 — provider fallback chain. "primary" resolves to BladeConfig.provider.
    /// Default ["primary","openrouter","groq","ollama"].
    #[serde(default = "default_provider_fallback_chain")]
    pub provider_fallback_chain: Vec<String>,
    /// RES-05 — retries per chain element before falling over. Default 2.
    #[serde(default = "default_max_retries_per_provider")]
    pub max_retries_per_provider: u32,
    /// RES-05 — exponential backoff base in ms. Default 500.
    #[serde(default = "default_backoff_base_ms")]
    pub backoff_base_ms: u64,
    /// RES-05 — exponential backoff cap in ms. Default 30000.
    #[serde(default = "default_backoff_max_ms")]
    pub backoff_max_ms: u64,
}

fn default_smart_resilience_enabled() -> bool { true }
fn default_stuck_detection_enabled() -> bool { true }
fn default_recent_actions_window() -> u32 { 6 }
fn default_monologue_threshold() -> u32 { 5 }
fn default_compaction_thrash_threshold() -> u32 { 3 }
fn default_no_progress_threshold() -> u32 { 5 }
fn default_circuit_breaker_threshold() -> u32 { 3 }
fn default_cost_guard_per_conversation_dollars() -> f32 { 25.0 }
fn default_provider_fallback_chain() -> Vec<String> {
    vec![
        "primary".to_string(),
        "openrouter".to_string(),
        "groq".to_string(),
        "ollama".to_string(),
    ]
}
fn default_max_retries_per_provider() -> u32 { 2 }
fn default_backoff_base_ms() -> u64 { 500 }
fn default_backoff_max_ms() -> u64 { 30_000 }

impl Default for ResilienceConfig {
    fn default() -> Self {
        Self {
            smart_resilience_enabled: default_smart_resilience_enabled(),
            stuck_detection_enabled: default_stuck_detection_enabled(),
            recent_actions_window: default_recent_actions_window(),
            monologue_threshold: default_monologue_threshold(),
            compaction_thrash_threshold: default_compaction_thrash_threshold(),
            no_progress_threshold: default_no_progress_threshold(),
            circuit_breaker_threshold: default_circuit_breaker_threshold(),
            cost_guard_per_conversation_dollars: default_cost_guard_per_conversation_dollars(),
            provider_fallback_chain: default_provider_fallback_chain(),
            max_retries_per_provider: default_max_retries_per_provider(),
            backoff_base_ms: default_backoff_base_ms(),
            backoff_max_ms: default_backoff_max_ms(),
        }
    }
}

// ---------------------------------------------------------------------
// Phase 34 Plan 34-01 — Session persistence knobs (SESS-01..04).
//
// Locked decisions (34-CONTEXT.md §Append-Only JSONL Session Log):
//   - jsonl_log_enabled (default true) — independent escape hatch from
//     resilience.smart_resilience_enabled. false = SessionWriter is no-op.
//   - jsonl_log_dir = blade_config_dir().join("sessions") — auto-created
//     on first SessionWriter::new.
//   - auto_resume_last (default false) — explicit user action is the
//     safer default per v1.1 lesson. SESS-02 toggle.
//   - keep_n_sessions (default 100) — rotation moves older to
//     {jsonl_log_dir}/archive/. Move, not delete.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct SessionConfig {
    /// SESS-01 master toggle. false = SessionWriter::append is silent no-op;
    /// no JSONL files written. Existing files still readable via list_sessions
    /// for legacy session inspection.
    #[serde(default = "default_jsonl_log_enabled")]
    pub jsonl_log_enabled: bool,
    /// SESS-01 directory containing one JSONL per session_id. Auto-created.
    /// Default blade_config_dir().join("sessions"). Tests use BLADE_CONFIG_DIR
    /// env override (config.rs::blade_config_dir line 852).
    #[serde(default = "default_jsonl_log_dir")]
    pub jsonl_log_dir: PathBuf,
    /// SESS-02 auto-resume last session on app boot. Default false (explicit
    /// user action is the safer default per v1.1 lesson).
    #[serde(default = "default_auto_resume_last")]
    pub auto_resume_last: bool,
    /// SESS-01 rotation — keep N most-recent sessions in jsonl_log_dir.
    /// Older sessions move to {jsonl_log_dir}/archive/. Default 100.
    #[serde(default = "default_keep_n_sessions")]
    pub keep_n_sessions: u32,
}

fn default_jsonl_log_enabled() -> bool { true }
fn default_jsonl_log_dir() -> PathBuf { blade_config_dir().join("sessions") }
fn default_auto_resume_last() -> bool { false }
fn default_keep_n_sessions() -> u32 { 100 }

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            jsonl_log_enabled: default_jsonl_log_enabled(),
            jsonl_log_dir: default_jsonl_log_dir(),
            auto_resume_last: default_auto_resume_last(),
            keep_n_sessions: default_keep_n_sessions(),
        }
    }
}

/// Config as stored on disk — api_key is NOT stored here anymore
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiskConfig {
    provider: String,
    model: String,
    onboarded: bool,
    #[serde(default)]
    mcp_servers: Vec<SavedMcpServerConfig>,
    #[serde(default)]
    window_state: Option<WindowState>,
    #[serde(default)]
    token_efficient: bool,
    #[serde(default)]
    user_name: String,
    #[serde(default)]
    work_mode: String,
    #[serde(default)]
    response_style: String,
    #[serde(default)]
    blade_email: String,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    god_mode: bool,
    #[serde(default = "default_god_mode_tier")]
    god_mode_tier: String,
    #[serde(default = "default_voice_mode")]
    voice_mode: String,
    #[serde(default)]
    obsidian_vault_path: String,
    #[serde(default = "default_tts_voice")]
    tts_voice: String,
    #[serde(default = "default_quick_ask_shortcut")]
    quick_ask_shortcut: String,
    #[serde(default = "default_voice_shortcut")]
    voice_shortcut: String,
    #[serde(default)]
    screen_timeline_enabled: bool,
    #[serde(default = "default_timeline_interval")]
    timeline_capture_interval: u32,
    #[serde(default = "default_timeline_retention")]
    timeline_retention_days: u32,
    #[serde(default)]
    wake_word_enabled: bool,
    #[serde(default = "default_wake_word_phrase")]
    wake_word_phrase: String,
    #[serde(default = "default_wake_word_sensitivity")]
    wake_word_sensitivity: u8,
    #[serde(default = "default_active_role")]
    active_role: String,
    #[serde(default)]
    blade_source_path: String,
    #[serde(default)]
    trusted_ai_delegate: String,  // "claude-code" | "none" | ""
    #[serde(default = "default_dedicated_monitor")]
    blade_dedicated_monitor: i32,
    #[serde(default)]
    task_routing: TaskRouting,
    #[serde(default = "default_background_ai_enabled")]
    background_ai_enabled: bool,
    #[serde(default)]
    persona_onboarding_complete: bool,
    /// Ordered list of provider names to try if the primary fails with 429/503/5xx.
    /// Example: ["groq", "openrouter", "ollama"]
    #[serde(default)]
    fallback_providers: Vec<String>,
    #[serde(default)]
    use_local_whisper: bool,
    #[serde(default = "default_whisper_model")]
    whisper_model: String,
    /// Unix timestamp (seconds) of the last completed deep scan. 0 = never.
    #[serde(default = "default_last_deep_scan")]
    last_deep_scan: i64,
    /// Enable background polling of real-world integrations (Gmail, Calendar, Slack, GitHub)
    #[serde(default)]
    integration_polling_enabled: bool,
    #[serde(default = "default_tts_speed")]
    tts_speed: f32,
    /// Home Assistant base URL, e.g. "http://homeassistant.local:8123" (empty = disabled)
    #[serde(default)]
    ha_base_url: String,
    #[serde(default)]
    audio_capture_enabled: bool,
    #[serde(default)]
    ghost_mode_enabled: bool,
    #[serde(default = "default_ghost_mode_position")]
    ghost_mode_position: String,
    #[serde(default)]
    ghost_auto_reply: bool,
    /// Enable HIVE distributed agent mesh (default false — opt-in)
    #[serde(default)]
    hive_enabled: bool,
    /// HIVE global autonomy level: 0.0 = always ask, 1.0 = fully autonomous
    #[serde(default = "default_hive_autonomy")]
    hive_autonomy: f32,
    // Phase 11 Plan 11-02 — probe-driven capability metadata + per-capability
    // provider slots (D-53). Each has `#[serde(default)]` for backward compat
    // with older config files that predate Phase 11.
    #[serde(default)]
    provider_capabilities: std::collections::HashMap<String, ProviderCapabilityRecord>,
    #[serde(default)]
    vision_provider: Option<String>,
    #[serde(default)]
    audio_provider: Option<String>,
    #[serde(default)]
    long_context_provider: Option<String>,
    #[serde(default)]
    tools_provider: Option<String>,
    // Phase 12 Plan 12-02 (D-65) — per-source-class privacy toggles
    #[serde(default = "default_scan_classes_enabled")]
    scan_classes_enabled: ScanClassesEnabled,
    // Phase 13 Plan 13-01 — ecosystem tentacle state + guardrail flag
    #[serde(default = "default_ecosystem_tentacles")]
    ecosystem_tentacles: Vec<TentacleRecord>,
    #[serde(default = "default_ecosystem_observe_only")]
    ecosystem_observe_only: bool,
    // Phase 22 Plan 22-03 (v1.3) — Voyager skill-write budget cap (VOYAGER-07)
    #[serde(default = "default_voyager_skill_write_budget_tokens")]
    voyager_skill_write_budget_tokens: u64,
    // Phase 23 Plan 23-01 (v1.3) — Composite reward weight tuple (REWARD-01)
    #[serde(default = "default_reward_weights")]
    reward_weights: RewardWeights,
    // Phase 32 Plan 32-01 — Context Management runtime knobs (CTX-07 escape hatch +
    // CTX-01/04/05 tunables). #[serde(default)] keeps legacy configs loadable.
    #[serde(default)]
    context: ContextConfig,
    // Phase 33 Plan 33-01 (LOOP-06) — Agentic Loop runtime knobs (smart_loop_enabled
    // escape hatch + max_iterations/cost_guard/verification_every_n). #[serde(default)]
    // keeps legacy configs loadable. Field name uses raw identifier (`loop` is a Rust keyword).
    #[serde(default)]
    r#loop: LoopConfig,
    // Phase 34 Plan 34-01 — Resilience runtime knobs (RES-01..05).
    // smart_resilience_enabled escape hatch + 5 stuck thresholds + circuit
    // breaker threshold + per-conversation cost cap + provider fallback chain
    // + retries/backoff. #[serde(default)] keeps legacy configs loadable.
    #[serde(default)]
    resilience: ResilienceConfig,
    // Phase 34 Plan 34-01 — Session persistence knobs (SESS-01..04).
    // jsonl_log_enabled escape hatch + jsonl_log_dir + auto_resume_last +
    // keep_n_sessions rotation policy. #[serde(default)] keeps legacy
    // configs loadable.
    #[serde(default)]
    session: SessionConfig,
    // Legacy field — read for migration, never written
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
}

fn default_tts_speed() -> f32 { 1.0 }
fn default_ghost_mode_position() -> String { "bottom-right".to_string() }
fn default_hive_autonomy() -> f32 { 0.3 }
fn default_background_ai_enabled() -> bool { true }
fn default_whisper_model() -> String { "tiny.en".to_string() }
fn default_last_deep_scan() -> i64 { 0 }
fn default_god_mode_tier() -> String { "normal".to_string() }
fn default_voice_mode() -> String { "off".to_string() }
fn default_tts_voice() -> String { "system".to_string() }
fn default_quick_ask_shortcut() -> String { "Ctrl+Space".to_string() }
fn default_voice_shortcut() -> String { "Ctrl+Shift+B".to_string() }
fn default_timeline_interval() -> u32 { 30 }
fn default_timeline_retention() -> u32 { 14 }
fn default_wake_word_phrase() -> String { "hey blade".to_string() }
fn default_wake_word_sensitivity() -> u8 { 3 }
fn default_active_role() -> String { "engineering".to_string() }
fn default_dedicated_monitor() -> i32 { -1 }

impl Default for DiskConfig {
    fn default() -> Self {
        Self {
            provider: "gemini".to_string(),
            model: "gemini-2.0-flash".to_string(),
            onboarded: false,
            mcp_servers: Vec::new(),
            window_state: None,
            token_efficient: false,
            user_name: String::new(),
            work_mode: String::new(),
            response_style: String::new(),
            blade_email: String::new(),
            base_url: None,
            god_mode: false,
            god_mode_tier: "normal".to_string(),
            voice_mode: "off".to_string(),
            obsidian_vault_path: String::new(),
            tts_voice: "system".to_string(),
            quick_ask_shortcut: "Ctrl+Space".to_string(),
            voice_shortcut: "Ctrl+Shift+B".to_string(),
            screen_timeline_enabled: false,
            timeline_capture_interval: 30,
            timeline_retention_days: 14,
            wake_word_enabled: false,
            wake_word_phrase: "hey blade".to_string(),
            wake_word_sensitivity: 3,
            active_role: "engineering".to_string(),
            blade_source_path: String::new(),
            trusted_ai_delegate: String::new(),
            blade_dedicated_monitor: -1,
            task_routing: TaskRouting::default(),
            background_ai_enabled: true,
            persona_onboarding_complete: false,
            fallback_providers: Vec::new(),
            use_local_whisper: false,
            whisper_model: "tiny.en".to_string(),
            last_deep_scan: 0,
            integration_polling_enabled: false,
            tts_speed: 1.0,
            ha_base_url: String::new(),
            audio_capture_enabled: false,
            ghost_mode_enabled: false,
            ghost_mode_position: "bottom-right".to_string(),
            ghost_auto_reply: false,
            hive_enabled: false,
            hive_autonomy: 0.3,
            provider_capabilities: std::collections::HashMap::new(),
            vision_provider: None,
            audio_provider: None,
            long_context_provider: None,
            tools_provider: None,
            scan_classes_enabled: default_scan_classes_enabled(),
            ecosystem_tentacles: vec![],
            ecosystem_observe_only: true,
            voyager_skill_write_budget_tokens: default_voyager_skill_write_budget_tokens(),
            reward_weights: default_reward_weights(),
            context: ContextConfig::default(),
            r#loop: LoopConfig::default(),
            resilience: ResilienceConfig::default(),
            session: SessionConfig::default(),
            api_key: None,
        }
    }
}

/// Config as used by the app — includes the API key from keychain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BladeConfig {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub onboarded: bool,
    #[serde(default)]
    pub mcp_servers: Vec<SavedMcpServerConfig>,
    #[serde(default)]
    pub window_state: Option<WindowState>,
    #[serde(default)]
    pub token_efficient: bool,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub work_mode: String,
    #[serde(default)]
    pub response_style: String,
    #[serde(default)]
    pub blade_email: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub god_mode: bool,
    #[serde(default = "default_god_mode_tier")]
    pub god_mode_tier: String,
    #[serde(default = "default_voice_mode")]
    pub voice_mode: String,
    #[serde(default)]
    pub obsidian_vault_path: String,
    #[serde(default = "default_tts_voice")]
    pub tts_voice: String,
    #[serde(default = "default_quick_ask_shortcut")]
    pub quick_ask_shortcut: String,
    #[serde(default = "default_voice_shortcut")]
    pub voice_shortcut: String,
    #[serde(default)]
    pub screen_timeline_enabled: bool,
    #[serde(default = "default_timeline_interval")]
    pub timeline_capture_interval: u32,
    #[serde(default = "default_timeline_retention")]
    pub timeline_retention_days: u32,
    #[serde(default)]
    pub wake_word_enabled: bool,
    #[serde(default = "default_wake_word_phrase")]
    pub wake_word_phrase: String,
    #[serde(default = "default_wake_word_sensitivity")]
    pub wake_word_sensitivity: u8,
    #[serde(default = "default_active_role")]
    pub active_role: String,
    #[serde(default)]
    pub blade_source_path: String,
    #[serde(default)]
    pub trusted_ai_delegate: String,
    #[serde(default = "default_dedicated_monitor")]
    pub blade_dedicated_monitor: i32,
    #[serde(default)]
    pub task_routing: TaskRouting,
    #[serde(default = "default_background_ai_enabled")]
    pub background_ai_enabled: bool,
    #[serde(default)]
    pub persona_onboarding_complete: bool,
    /// Ordered list of provider names to try if the primary fails with 429/503/5xx.
    /// Example: ["groq", "openrouter", "ollama"]
    #[serde(default)]
    pub fallback_providers: Vec<String>,
    /// Use local whisper.cpp for transcription instead of cloud API
    #[serde(default)]
    pub use_local_whisper: bool,
    /// Which whisper model to use locally: "tiny.en", "base.en", "small.en"
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
    /// Unix timestamp (seconds) of the last completed deep scan. 0 = never run.
    #[serde(default = "default_last_deep_scan")]
    pub last_deep_scan: i64,
    /// Enable background polling of real-world integrations (Gmail, Calendar, Slack, GitHub)
    #[serde(default)]
    pub integration_polling_enabled: bool,
    /// TTS playback speed multiplier (0.5 = half speed, 2.0 = double speed, default 1.0)
    #[serde(default = "default_tts_speed")]
    pub tts_speed: f32,
    /// Home Assistant base URL, e.g. "http://homeassistant.local:8123" (empty = disabled)
    #[serde(default)]
    pub ha_base_url: String,
    /// Always-on audio capture alongside screenshots (Omi-style)
    #[serde(default)]
    pub audio_capture_enabled: bool,
    /// Enable Ghost Mode — invisible overlay during meetings
    #[serde(default)]
    pub ghost_mode_enabled: bool,
    /// Position of ghost overlay: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    #[serde(default = "default_ghost_mode_position")]
    pub ghost_mode_position: String,
    /// Auto-type suggested reply into chat input (requires hotkey confirmation)
    #[serde(default)]
    pub ghost_auto_reply: bool,
    /// Enable HIVE distributed agent mesh (default false — opt-in)
    #[serde(default)]
    pub hive_enabled: bool,
    /// HIVE global autonomy level: 0.0 = always ask, 1.0 = fully autonomous
    #[serde(default = "default_hive_autonomy")]
    pub hive_autonomy: f32,
    // Phase 11 Plan 11-02 (D-52, D-53) — probe-driven capability metadata + 4
    // per-capability provider slots. `provider_capabilities` stores the latest
    // ProviderCapabilityRecord per provider name; the 4 Option<String> slots
    // hold "provider/model" strings chosen either by auto-populate (first
    // capable provider fills a None slot) or explicit user override.
    #[serde(default)]
    pub provider_capabilities: std::collections::HashMap<String, ProviderCapabilityRecord>,
    #[serde(default)]
    pub vision_provider: Option<String>,
    #[serde(default)]
    pub audio_provider: Option<String>,
    #[serde(default)]
    pub long_context_provider: Option<String>,
    #[serde(default)]
    pub tools_provider: Option<String>,
    /// Phase 12 Plan 12-02 (D-65) — per-source-class privacy toggles.
    /// All classes default to true. User can opt-out in Settings → Privacy.
    #[serde(default = "default_scan_classes_enabled")]
    pub scan_classes_enabled: ScanClassesEnabled,
    // Phase 13 Plan 13-01
    #[serde(default = "default_ecosystem_tentacles")]
    pub ecosystem_tentacles: Vec<TentacleRecord>,
    #[serde(default = "default_ecosystem_observe_only")]
    pub ecosystem_observe_only: bool,
    /// Phase 22 Plan 22-03 (v1.3) — Voyager skill-write budget cap (VOYAGER-07).
    /// Total tokens (prompt + estimated response) above which `tool_forge::
    /// forge_tool` refuses the LLM call. Default 50_000.
    #[serde(default = "default_voyager_skill_write_budget_tokens")]
    pub voyager_skill_write_budget_tokens: u64,
    /// Phase 23 Plan 23-01 (v1.3) — Composite reward weight tuple per D-23-01 (REWARD-01).
    /// Default `0.5 / 0.3 / 0.0 / 0.1` (acceptance silenced via weight=0 until v1.4 lands
    /// regenerate UI). Sum-to-1.0 validation tolerates `[0.0, 1.0+1e-3]` per Pitfall 5.
    #[serde(default = "default_reward_weights")]
    pub reward_weights: RewardWeights,
    /// Phase 32 Plan 32-01 — Context Management runtime knobs (CTX-07 escape hatch +
    /// CTX-01/04/05 tunables). Defaults: smart_injection_enabled=true, relevance_gate=0.2,
    /// compaction_trigger_pct=0.80, tool_output_cap_tokens=4000. See `ContextConfig`.
    #[serde(default)]
    pub context: ContextConfig,
    /// Phase 33 Plan 33-01 (LOOP-06) — Agentic Loop runtime knobs. Defaults:
    /// smart_loop_enabled=true, max_iterations=25, cost_guard_dollars=5.0,
    /// verification_every_n=3. Field name uses raw identifier (`loop` is a Rust keyword).
    /// See `LoopConfig`.
    #[serde(default)]
    pub r#loop: LoopConfig,
    /// Phase 34 Plan 34-01 — Resilience runtime knobs (RES-01..05). Defaults:
    /// smart_resilience_enabled=true, 5 stuck thresholds, circuit_breaker_threshold=3,
    /// cost_guard_per_conversation_dollars=25.0, provider_fallback_chain=
    /// ["primary","openrouter","groq","ollama"], max_retries_per_provider=2,
    /// backoff_base_ms=500, backoff_max_ms=30_000. See `ResilienceConfig`.
    #[serde(default)]
    pub resilience: ResilienceConfig,
    /// Phase 34 Plan 34-01 — Session persistence knobs (SESS-01..04). Defaults:
    /// jsonl_log_enabled=true, jsonl_log_dir=blade_config_dir().join("sessions"),
    /// auto_resume_last=false, keep_n_sessions=100. See `SessionConfig`.
    #[serde(default)]
    pub session: SessionConfig,
}

impl BladeConfig {
    pub fn active_model_for_display(&self) -> String {
        format!("{}/{}", self.provider, self.model)
    }
}

impl Default for BladeConfig {
    fn default() -> Self {
        Self {
            provider: "gemini".to_string(),
            api_key: String::new(),
            model: "gemini-2.0-flash".to_string(),
            onboarded: false,
            mcp_servers: Vec::new(),
            window_state: None,
            token_efficient: false,
            user_name: String::new(),
            work_mode: String::new(),
            response_style: String::new(),
            blade_email: String::new(),
            base_url: None,
            god_mode: false,
            god_mode_tier: "normal".to_string(),
            voice_mode: "off".to_string(),
            obsidian_vault_path: String::new(),
            tts_voice: "system".to_string(),
            quick_ask_shortcut: "Ctrl+Space".to_string(),
            voice_shortcut: "Ctrl+Shift+B".to_string(),
            screen_timeline_enabled: false,
            timeline_capture_interval: 30,
            timeline_retention_days: 14,
            wake_word_enabled: false,
            wake_word_phrase: "hey blade".to_string(),
            wake_word_sensitivity: 3,
            active_role: "engineering".to_string(),
            blade_source_path: String::new(),
            trusted_ai_delegate: String::new(),
            blade_dedicated_monitor: -1,
            task_routing: TaskRouting::default(),
            background_ai_enabled: true,
            persona_onboarding_complete: false,
            fallback_providers: Vec::new(),
            use_local_whisper: false,
            whisper_model: "tiny.en".to_string(),
            last_deep_scan: 0,
            integration_polling_enabled: false,
            tts_speed: 1.0,
            ha_base_url: String::new(),
            audio_capture_enabled: false,
            ghost_mode_enabled: false,
            ghost_mode_position: "bottom-right".to_string(),
            ghost_auto_reply: false,
            hive_enabled: false,
            hive_autonomy: 0.3,
            provider_capabilities: std::collections::HashMap::new(),
            vision_provider: None,
            audio_provider: None,
            long_context_provider: None,
            tools_provider: None,
            scan_classes_enabled: default_scan_classes_enabled(),
            ecosystem_tentacles: vec![],
            ecosystem_observe_only: true,
            voyager_skill_write_budget_tokens: default_voyager_skill_write_budget_tokens(),
            reward_weights: default_reward_weights(),
            context: ContextConfig::default(),
            r#loop: LoopConfig::default(),
            resilience: ResilienceConfig::default(),
            session: SessionConfig::default(),
        }
    }
}

pub fn blade_config_dir() -> PathBuf {
    // Test/eval override — set BLADE_CONFIG_DIR to redirect all config + db
    // operations to a temp dir without touching the real user config. Used by
    // tests/memory_recall_eval.rs and any future eval harness. Production code
    // never sets this; if unset we fall back to the OS config dir.
    if let Ok(override_dir) = std::env::var("BLADE_CONFIG_DIR") {
        let p = PathBuf::from(override_dir);
        fs::create_dir_all(&p).ok();
        return p;
    }
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("blade");
    fs::create_dir_all(&config_dir).ok();
    config_dir
}

fn config_path() -> PathBuf {
    blade_config_dir().join("config.json")
}

// --- Keyring ---

fn get_api_key_from_keyring(provider: &str) -> String {
    if provider.is_empty() {
        return String::new();
    }
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .and_then(|entry| entry.get_password())
        .unwrap_or_default()
}

/// Retrieve the stored API key for any provider. Returns empty string if none.
/// Used by modules that need to probe available providers (e.g. fast-ack routing).
///
/// Phase 11 Plan 11-02 — in `#[cfg(test)]` builds, callers can pre-seed
/// `TEST_KEYRING_OVERRIDES` via `test_set_keyring_override(provider, key)` to
/// deterministically bypass the real OS keyring. Production builds never
/// compile the override branch (gated behind `#[cfg(test)]`).
pub(crate) fn get_provider_key(provider: &str) -> String {
    #[cfg(test)]
    {
        let override_val = TEST_KEYRING_OVERRIDES.with(|o| o.borrow().get(provider).cloned());
        if let Some(k) = override_val {
            return k;
        }
    }
    get_api_key_from_keyring(provider)
}

fn set_api_key_in_keyring(provider: &str, api_key: &str) -> Result<(), String> {
    if provider.is_empty() {
        return Ok(());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|e| format!("Keyring error: {}", e))?;
    if api_key.is_empty() {
        let _ = entry.delete_credential();
        Ok(())
    } else {
        entry
            .set_password(api_key)
            .map_err(|e| format!("Failed to store API key: {}", e))
    }
}

// --- Load / Save ---

pub fn load_config() -> BladeConfig {
    let path = config_path();
    let disk: DiskConfig = match fs::read_to_string(&path) {
        Ok(data) => match serde_json::from_str(&data) {
            Ok(cfg) => cfg,
            Err(e) => {
                log::warn!("[config] Config file corrupt, using defaults: {}", e);
                // Backup the corrupt file so user can recover manually
                let backup = path.with_extension("json.bak");
                let _ = fs::copy(&path, &backup);
                DiskConfig::default()
            }
        },
        Err(_) => DiskConfig::default(),
    };

    // Migrate legacy plaintext key to keyring
    if let Some(legacy_key) = &disk.api_key {
        if !legacy_key.is_empty() {
            let _ = set_api_key_in_keyring(&disk.provider, legacy_key);
            // Re-save config without the plaintext key
            let clean = DiskConfig {
                api_key: None,
                ..disk.clone()
            };
            let _ = save_disk_config(&clean);
        }
    }

    // Load API key from keyring
    let api_key = get_api_key_from_keyring(&disk.provider);

    BladeConfig {
        provider: disk.provider,
        api_key,
        model: disk.model,
        onboarded: disk.onboarded,
        mcp_servers: disk.mcp_servers,
        window_state: disk.window_state,
        token_efficient: disk.token_efficient,
        user_name: disk.user_name,
        work_mode: disk.work_mode,
        response_style: disk.response_style,
        blade_email: disk.blade_email,
        base_url: disk.base_url,
        god_mode: disk.god_mode,
        god_mode_tier: disk.god_mode_tier,
        voice_mode: disk.voice_mode,
        obsidian_vault_path: disk.obsidian_vault_path,
        tts_voice: disk.tts_voice,
        quick_ask_shortcut: disk.quick_ask_shortcut,
        voice_shortcut: disk.voice_shortcut,
        screen_timeline_enabled: disk.screen_timeline_enabled,
        timeline_capture_interval: disk.timeline_capture_interval,
        timeline_retention_days: disk.timeline_retention_days,
        wake_word_enabled: disk.wake_word_enabled,
        wake_word_phrase: disk.wake_word_phrase,
        wake_word_sensitivity: disk.wake_word_sensitivity,
        active_role: disk.active_role,
        blade_source_path: disk.blade_source_path,
        trusted_ai_delegate: disk.trusted_ai_delegate,
        blade_dedicated_monitor: disk.blade_dedicated_monitor,
        task_routing: disk.task_routing,
        background_ai_enabled: disk.background_ai_enabled,
        persona_onboarding_complete: disk.persona_onboarding_complete,
        fallback_providers: disk.fallback_providers,
        use_local_whisper: disk.use_local_whisper,
        whisper_model: disk.whisper_model,
        last_deep_scan: disk.last_deep_scan,
        integration_polling_enabled: disk.integration_polling_enabled,
        tts_speed: disk.tts_speed,
        ha_base_url: disk.ha_base_url,
        audio_capture_enabled: disk.audio_capture_enabled,
        ghost_mode_enabled: disk.ghost_mode_enabled,
        ghost_mode_position: disk.ghost_mode_position,
        ghost_auto_reply: disk.ghost_auto_reply,
        hive_enabled: disk.hive_enabled,
        hive_autonomy: disk.hive_autonomy,
        provider_capabilities: disk.provider_capabilities,
        vision_provider: disk.vision_provider,
        audio_provider: disk.audio_provider,
        long_context_provider: disk.long_context_provider,
        tools_provider: disk.tools_provider,
        scan_classes_enabled: disk.scan_classes_enabled,
        ecosystem_tentacles: disk.ecosystem_tentacles,
        ecosystem_observe_only: disk.ecosystem_observe_only,
        voyager_skill_write_budget_tokens: disk.voyager_skill_write_budget_tokens,
        reward_weights: disk.reward_weights.clone(),
        context: disk.context,
        r#loop: disk.r#loop,
        resilience: disk.resilience,
        session: disk.session,
    }
}

pub fn save_config(config: &BladeConfig) -> Result<(), String> {
    // Phase 23 Plan 23-01 (REWARD-01) — hard-reject corrupt reward weights
    // BEFORE any keychain write. Sum tolerance is `[0.0, 1.0 + 1e-3]` to
    // accommodate the v1.3 default sum=0.9 (acceptance silenced).
    config.reward_weights.validate()?;

    // Phase 33 / 33-NN-FIX (BL-01) — hard-reject corrupt loop knobs BEFORE
    // any keychain write. Mirrors the RewardWeights gate above. Most
    // importantly, rejects `verification_every_n = 0` which would integer-
    // modulo-panic the chat task at iter 1 (see LoopConfig::validate()
    // doc for the failure mode). Defense-in-depth: the firing site at
    // loop_engine.rs:537 also carries an in-line zero-guard.
    config.r#loop.validate()?;

    // Store API key in keyring, not on disk
    set_api_key_in_keyring(&config.provider, &config.api_key)?;

    let disk = DiskConfig {
        provider: config.provider.clone(),
        model: config.model.clone(),
        onboarded: config.onboarded,
        mcp_servers: config.mcp_servers.clone(),
        window_state: config.window_state.clone(),
        token_efficient: config.token_efficient,
        user_name: config.user_name.clone(),
        work_mode: config.work_mode.clone(),
        response_style: config.response_style.clone(),
        blade_email: config.blade_email.clone(),
        base_url: config.base_url.clone(),
        god_mode: config.god_mode,
        god_mode_tier: config.god_mode_tier.clone(),
        voice_mode: config.voice_mode.clone(),
        obsidian_vault_path: config.obsidian_vault_path.clone(),
        tts_voice: config.tts_voice.clone(),
        quick_ask_shortcut: config.quick_ask_shortcut.clone(),
        voice_shortcut: config.voice_shortcut.clone(),
        screen_timeline_enabled: config.screen_timeline_enabled,
        timeline_capture_interval: config.timeline_capture_interval,
        timeline_retention_days: config.timeline_retention_days,
        wake_word_enabled: config.wake_word_enabled,
        wake_word_phrase: config.wake_word_phrase.clone(),
        wake_word_sensitivity: config.wake_word_sensitivity,
        active_role: config.active_role.clone(),
        blade_source_path: config.blade_source_path.clone(),
        trusted_ai_delegate: config.trusted_ai_delegate.clone(),
        blade_dedicated_monitor: config.blade_dedicated_monitor,
        task_routing: config.task_routing.clone(),
        background_ai_enabled: config.background_ai_enabled,
        persona_onboarding_complete: config.persona_onboarding_complete,
        fallback_providers: config.fallback_providers.clone(),
        use_local_whisper: config.use_local_whisper,
        whisper_model: config.whisper_model.clone(),
        last_deep_scan: config.last_deep_scan,
        integration_polling_enabled: config.integration_polling_enabled,
        tts_speed: config.tts_speed,
        ha_base_url: config.ha_base_url.clone(),
        audio_capture_enabled: config.audio_capture_enabled,
        ghost_mode_enabled: config.ghost_mode_enabled,
        ghost_mode_position: config.ghost_mode_position.clone(),
        ghost_auto_reply: config.ghost_auto_reply,
        hive_enabled: config.hive_enabled,
        hive_autonomy: config.hive_autonomy,
        provider_capabilities: config.provider_capabilities.clone(),
        vision_provider: config.vision_provider.clone(),
        audio_provider: config.audio_provider.clone(),
        long_context_provider: config.long_context_provider.clone(),
        tools_provider: config.tools_provider.clone(),
        scan_classes_enabled: config.scan_classes_enabled.clone(),
        ecosystem_tentacles: config.ecosystem_tentacles.clone(),
        ecosystem_observe_only: config.ecosystem_observe_only,
        voyager_skill_write_budget_tokens: config.voyager_skill_write_budget_tokens,
        reward_weights: config.reward_weights.clone(),
        context: config.context.clone(),
        r#loop: config.r#loop.clone(),
        resilience: config.resilience.clone(),
        session: config.session.clone(),
        api_key: None,
    };

    save_disk_config(&disk)
}

fn save_disk_config(config: &DiskConfig) -> Result<(), String> {
    let path = config_path();
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_blade_file(&path, &data)
}

/// Set an API key for any provider without requiring the full config flow.
/// Blade can call this autonomously when the user pastes a key in conversation.
pub fn set_api_key_for_provider(
    provider: &str,
    api_key: &str,
    base_url: Option<&str>,
    model: Option<&str>,
) -> Result<(), String> {
    set_api_key_in_keyring(provider, api_key)?;

    // Switch to this provider in config
    let mut config = load_config();
    config.provider = provider.to_string();
    if !api_key.is_empty() {
        config.api_key = api_key.to_string();
    }
    if let Some(url) = base_url {
        config.base_url = if url.is_empty() { None } else { Some(url.to_string()) };
    }
    if let Some(m) = model {
        if !m.is_empty() {
            config.model = m.to_string();
        }
    }
    save_config(&config)
}

/// Get all stored provider keys — returns which providers have a key stored
/// and masked previews (never the full key). Also returns the active provider.
#[tauri::command]
pub fn get_all_provider_keys() -> serde_json::Value {
    let providers = ["anthropic", "openai", "openrouter", "gemini", "groq", "ollama"];
    let config = load_config();

    let keys: Vec<serde_json::Value> = providers.iter().map(|p| {
        let key = get_api_key_from_keyring(p);
        let has_key = !key.is_empty();
        let masked = if has_key && key.len() > 8 {
            format!("{}...{}", &key[..4], &key[key.len()-4..])
        } else if has_key {
            "****".to_string()
        } else {
            String::new()
        };
        serde_json::json!({
            "provider": p,
            "has_key": has_key,
            "masked": masked,
            "is_active": config.provider == *p,
        })
    }).collect();

    serde_json::json!({
        "providers": keys,
        "active_provider": config.active_model_for_display(),
    })
}

/// Phase 12 Plan 12-04 (D-65) — Update which scan source classes are enabled.
/// Called by the Settings → Privacy Deep Scan section toggles.
/// Each toggle change fires this with the full updated ScanClassesEnabled struct.
#[tauri::command]
pub fn set_scan_classes_enabled(
    fs_repos: bool,
    git_remotes: bool,
    ide_workspaces: bool,
    ai_sessions: bool,
    shell_history: bool,
    mru: bool,
    bookmarks: bool,
    which_sweep: bool,
) -> Result<(), String> {
    let mut config = load_config();
    config.scan_classes_enabled = ScanClassesEnabled {
        fs_repos,
        git_remotes,
        ide_workspaces,
        ai_sessions,
        shell_history,
        mru,
        bookmarks,
        which_sweep,
    };
    save_config(&config)
}

/// Store a key for any provider without switching to it.
/// Use this to pre-load all your keys without changing the active provider.
#[tauri::command]
pub fn store_provider_key(provider: String, api_key: String) -> Result<(), String> {
    if provider.is_empty() {
        return Err("Provider name is required".to_string());
    }
    set_api_key_in_keyring(&provider, &api_key)
}

/// Switch the active provider (and load its stored key)
#[tauri::command]
pub fn switch_provider(provider: String, model: Option<String>) -> Result<BladeConfig, String> {
    let mut config = load_config();
    config.provider = provider.clone();
    config.api_key = get_api_key_from_keyring(&provider);
    if let Some(m) = model {
        if !m.is_empty() { config.model = m; }
    }
    // Clear stale base_url when switching to providers that have their own native endpoints.
    // Without this, a leftover base_url from a custom provider (e.g. DeepSeek) would cause
    // all requests to route through the OpenAI-compatible path at the wrong endpoint.
    match provider.as_str() {
        "anthropic" | "gemini" | "groq" | "openai" | "openrouter" => {
            config.base_url = None;
        }
        _ => {} // Keep base_url for ollama/custom providers
    }
    save_config(&config)?;
    Ok(config)
}

/// Resolve the best (provider, api_key, model) triple for a given task type.
///
/// Priority:
///   1. Task-specific routing override (if set AND has a stored key)
///   2. Active provider
///
/// The brain/soul system prompt is injected regardless — BLADE stays coherent
/// no matter which model handles the request.
pub fn resolve_provider_for_task(
    config: &BladeConfig,
    task_type: &crate::router::TaskType,
) -> (String, String, String) {
    use crate::router::TaskType;

    // Custom endpoint (base_url set) — the router has no knowledge of what models
    // that endpoint supports, so never override the user's configured model.
    if config.base_url.is_some() {
        return (config.provider.clone(), config.api_key.clone(), config.model.clone());
    }

    let preferred = match task_type {
        TaskType::Code => config.task_routing.code.as_deref(),
        TaskType::Vision => config.task_routing.vision.as_deref(),
        TaskType::Simple => config.task_routing.fast.as_deref(),
        TaskType::Creative => config.task_routing.creative.as_deref(),
        TaskType::Complex => None, // complex always goes to active provider (usually the best one)
    };

    if let Some(prov) = preferred {
        if prov != config.provider {
            let key = get_api_key_from_keyring(prov);
            if !key.is_empty() || prov == "ollama" {
                let model = crate::router::suggest_model(prov, task_type)
                    .unwrap_or_else(|| config.model.clone());
                return (prov.to_string(), key, model);
            }
        }
    }

    // Default: use the user's configured model. The router's suggest_model is only
    // a hint for *explicit* task routing overrides — it should NEVER override the
    // user's deliberate model choice on the active provider. This was causing 404s
    // on OpenRouter because suggest_model returned model IDs the user never asked for.
    (config.provider.clone(), config.api_key.clone(), config.model.clone())
}

/// Get the stored routing config.
#[tauri::command]
pub fn get_task_routing() -> TaskRouting {
    load_config().task_routing
}

/// Save routing preferences.
#[tauri::command]
pub fn set_task_routing(routing: TaskRouting) -> Result<(), String> {
    let mut config = load_config();
    config.task_routing = routing;
    save_config(&config)
}

/// Generic single-field config updater for simple string settings.
/// Avoids round-tripping the full config just to change one path/flag.
#[tauri::command]
pub fn save_config_field(key: String, value: String) -> Result<(), String> {
    let mut config = load_config();
    match key.as_str() {
        "blade_source_path" => config.blade_source_path = value,
        "user_name" => config.user_name = value,
        "obsidian_vault_path" => config.obsidian_vault_path = value,
        "work_mode" => config.work_mode = value,
        "response_style" => config.response_style = value,
        "trusted_ai_delegate" => config.trusted_ai_delegate = value,
        "ha_base_url" => config.ha_base_url = value,
        // Boolean fields — accept "true"/"false"
        "screen_timeline_enabled" => {
            config.screen_timeline_enabled = value == "true";
        }
        "audio_capture_enabled" => {
            config.audio_capture_enabled = value == "true";
        }
        "wake_word_enabled" => {
            config.wake_word_enabled = value == "true";
        }
        "use_local_whisper" => {
            config.use_local_whisper = value == "true";
        }
        "god_mode" => {
            config.god_mode = value == "true";
        }
        // String fields — Phase 14 voice + intelligence additions
        "wake_word_phrase" => config.wake_word_phrase = value,
        "whisper_model" => config.whisper_model = value,
        "god_mode_tier" => config.god_mode_tier = value,
        // Float fields
        "tts_speed" => {
            config.tts_speed = value.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
        }
        // Integer fields
        "wake_word_sensitivity" => {
            config.wake_word_sensitivity = value.parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        }
        "timeline_capture_interval" => {
            config.timeline_capture_interval = value.parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        }
        "timeline_retention_days" => {
            config.timeline_retention_days = value.parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        }
        _ => return Err(format!("Unknown config field: {}", key)),
    }
    save_config(&config)
}

/// Enable or disable all background AI calls globally.
/// When disabled, all timer-driven LLM functions (pulse, proactive engine,
/// character consolidation, etc.) skip their API calls immediately.
#[tauri::command]
pub fn toggle_background_ai(enabled: bool) -> Result<(), String> {
    let mut config = load_config();
    config.background_ai_enabled = enabled;
    save_config(&config)
}

/// If an LLM error indicates 402 (out of credits), auto-disable background_ai_enabled
/// to prevent further wasted calls. Returns true if background AI was just disabled.
pub fn check_and_disable_on_402(err_msg: &str) -> bool {
    if err_msg.contains("Out of credits") {
        let mut config = load_config();
        if config.background_ai_enabled {
            config.background_ai_enabled = false;
            let _ = save_config(&config);
            log::warn!("402 credits exhausted — auto-disabled background AI");
            return true;
        }
    }
    false
}

#[allow(dead_code)]
pub fn update_window_state(window_state: WindowState) -> Result<(), String> {
    // Don't save minimized/off-screen sentinel positions (Windows uses -32000)
    if window_state.x < -10000 || window_state.y < -10000 {
        return Ok(());
    }
    // Don't save tiny sizes (likely minimized or transitional)
    if window_state.width < 200 || window_state.height < 100 {
        return Ok(());
    }
    let mut config = load_config();
    config.window_state = Some(window_state);
    save_config(&config)
}

/// Returns the cheapest suitable model for background/ambient LLM calls.
/// For openrouter and ollama, returns the user's configured model — on BYOK it's
/// free, and the user chose it deliberately. For other providers, returns a
/// dedicated cheap model so the main model stays responsive.
pub fn cheap_model_for_provider(provider: &str, user_model: &str) -> String {
    match provider {
        "anthropic"  => "claude-haiku-4-5-20251001".to_string(),
        "openai"     => "gpt-4o-mini".to_string(),
        "gemini"     => "gemini-2.0-flash".to_string(),
        "groq"       => "llama-3.1-8b-instant".to_string(),
        "openrouter" => user_model.to_string(),
        "ollama"     => user_model.to_string(),
        _            => user_model.to_string(),
    }
}

pub fn write_blade_file(path: &PathBuf, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(path, contents).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 11 Plan 11-02 — unit tests (config round-trip + keyring seam).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip `BladeConfig` through serde_json and assert all 5 new
    /// Phase 11 fields persist. Serde is the same codec `save_disk_config`
    /// uses, so this exercises the same keys the keyring-coupled on-disk
    /// path would — without requiring a live OS keyring.
    #[test]
    fn phase11_fields_round_trip() {
        let mut cfg = BladeConfig::default();
        cfg.vision_provider = Some("anthropic/claude-sonnet-4".to_string());
        cfg.audio_provider = Some("openai/gpt-4o-audio-preview".to_string());
        cfg.long_context_provider = Some("gemini/gemini-1.5-pro".to_string());
        cfg.tools_provider = Some("anthropic/claude-sonnet-4".to_string());

        let rec = ProviderCapabilityRecord {
            provider: "anthropic".to_string(),
            model: "claude-sonnet-4".to_string(),
            context_window: 200_000,
            vision: true,
            audio: false,
            tool_calling: true,
            long_context: true,
            last_probed: chrono::Utc::now(),
            probe_status: ProbeStatus::Active,
        };
        cfg.provider_capabilities
            .insert("anthropic".to_string(), rec.clone());

        let serialized = serde_json::to_string(&cfg).expect("serialize BladeConfig");
        let loaded: BladeConfig = serde_json::from_str(&serialized).expect("deserialize BladeConfig");

        assert_eq!(loaded.vision_provider, cfg.vision_provider);
        assert_eq!(loaded.audio_provider, cfg.audio_provider);
        assert_eq!(loaded.long_context_provider, cfg.long_context_provider);
        assert_eq!(loaded.tools_provider, cfg.tools_provider);
        assert_eq!(
            loaded.provider_capabilities.get("anthropic"),
            cfg.provider_capabilities.get("anthropic"),
            "ProviderCapabilityRecord must round-trip byte-for-byte"
        );
    }

    /// The `#[cfg(test)]` keyring-override seam short-circuits `get_provider_key`
    /// so router + probe unit tests (Plan 11-04) can inject deterministic keys
    /// without touching the real OS keyring. Clearing the seam restores the
    /// real-keyring code path.
    #[test]
    fn keyring_override_seam_returns_overridden_value() {
        // Use a per-test unique provider name so sibling tests running on the
        // same thread-local state don't collide (thread_local is scoped to the
        // test-runner thread but cargo-test uses one thread per test by default).
        let slot = "anthropic_probe_seam_test";
        test_clear_keyring_overrides();
        test_set_keyring_override(slot, "sk-ant-fake-test-key");
        let k = get_provider_key(slot);
        assert_eq!(
            k, "sk-ant-fake-test-key",
            "override must take precedence over real keyring"
        );
        test_clear_keyring_overrides();
        let cleared = get_provider_key(slot);
        assert_ne!(
            cleared, "sk-ant-fake-test-key",
            "override must be cleared — fall-through to real keyring"
        );
    }

    /// Defaults for the 5 Phase 11 fields match the spec: empty HashMap +
    /// four None Options. Guards against silent drift where a future edit
    /// adds a non-None default that would leak an unintended provider hint.
    #[test]
    fn phase11_defaults_are_empty_or_none() {
        let cfg = BladeConfig::default();
        assert!(cfg.provider_capabilities.is_empty());
        assert!(cfg.vision_provider.is_none());
        assert!(cfg.audio_provider.is_none());
        assert!(cfg.long_context_provider.is_none());
        assert!(cfg.tools_provider.is_none());
    }

    /// Phase 12 Plan 12-02 (D-65) — ScanClassesEnabled round-trips through serde
    /// with partial fields set to false. Guards against silent drift where a new
    /// scan class is added but not registered in ScanClassesEnabled.
    #[test]
    fn test_scan_classes_roundtrip() {
        let classes = ScanClassesEnabled {
            fs_repos: true,
            git_remotes: false,
            ide_workspaces: true,
            ai_sessions: false,
            shell_history: true,
            mru: true,
            bookmarks: false,
            which_sweep: true,
        };

        let serialized = serde_json::to_string(&classes).expect("serialize ScanClassesEnabled");
        let loaded: ScanClassesEnabled =
            serde_json::from_str(&serialized).expect("deserialize ScanClassesEnabled");

        assert_eq!(loaded.fs_repos, true);
        assert_eq!(loaded.git_remotes, false);
        assert_eq!(loaded.ide_workspaces, true);
        assert_eq!(loaded.ai_sessions, false);
        assert_eq!(loaded.shell_history, true);
        assert_eq!(loaded.mru, true);
        assert_eq!(loaded.bookmarks, false);
        assert_eq!(loaded.which_sweep, true);
    }

    /// Default ScanClassesEnabled has all 8 classes enabled — required for SCAN-13 baseline.
    #[test]
    fn test_scan_classes_default_all_true() {
        let classes = default_scan_classes_enabled();
        assert!(classes.fs_repos);
        assert!(classes.git_remotes);
        assert!(classes.ide_workspaces);
        assert!(classes.ai_sessions);
        assert!(classes.shell_history);
        assert!(classes.mru);
        assert!(classes.bookmarks);
        assert!(classes.which_sweep);
    }

    // ---------------------------------------------------------------------
    // Phase 23 Plan 23-01 — RewardWeights tests (REWARD-01).
    //
    // The 5 tests below lock D-23-01:
    //   - default returns 0.5/0.3/0.0/0.1 (sum 0.9; acceptance silenced)
    //   - per-component out-of-[0,1] is rejected by validate()
    //   - sum-out-of-[0,1+1e-3] is rejected by validate()
    //   - non-default weights round-trip through DiskConfig serde
    //   - save_config gate rejects corrupt sums BEFORE any keyring write
    // ---------------------------------------------------------------------

    #[test]
    fn reward_weights_default_validates() {
        let w = RewardWeights::default();
        assert_eq!(w.skill_success, 0.5);
        assert_eq!(w.eval_gate,     0.3);
        assert_eq!(w.acceptance,    0.0);
        assert_eq!(w.completion,    0.1);
        // v1.3 default sum is 0.9 (NOT 1.0) per D-23-01.
        assert!((w.sum() - 0.9).abs() < 1e-6, "default sum should be 0.9, got {}", w.sum());
        assert!(w.validate().is_ok(), "default weights must pass validate(): {:?}", w.validate());
    }

    #[test]
    fn reward_weights_rejects_per_component_out_of_range() {
        let w = RewardWeights { skill_success: 1.5, eval_gate: 0.3, acceptance: 0.0, completion: 0.1 };
        let err = w.validate().expect_err("must reject skill_success > 1.0");
        assert!(
            err.contains("reward_weights.skill_success out of [0,1]"),
            "error did not match expected prefix: {}",
            err
        );

        let w_neg = RewardWeights { skill_success: -0.1, eval_gate: 0.3, acceptance: 0.0, completion: 0.1 };
        let err_neg = w_neg.validate().expect_err("must reject negative skill_success");
        assert!(err_neg.contains("reward_weights.skill_success out of [0,1]"), "got: {}", err_neg);
    }

    #[test]
    fn reward_weights_rejects_sum_out_of_range() {
        // Sum = 0.6 + 0.6 + 0.0 + 0.0 = 1.2 — exceeds 1.0+1e-3 tolerance.
        let w = RewardWeights { skill_success: 0.6, eval_gate: 0.6, acceptance: 0.0, completion: 0.0 };
        let err = w.validate().expect_err("must reject sum > 1.0+1e-3");
        assert!(
            err.contains("reward_weights sum out of [0,1]"),
            "error did not match expected prefix: {}",
            err
        );
    }

    /// Round-trip a non-default `RewardWeights` through `DiskConfig` serde.
    /// This guards the DiskConfig field + DiskConfig::default() + #[serde(default)]
    /// helper wiring (sites 2 + 3) — if any of the 6 places drifts, this test fails.
    #[test]
    fn reward_weights_round_trip() {
        let mut cfg = BladeConfig::default();
        cfg.reward_weights = RewardWeights {
            skill_success: 0.4,
            eval_gate:     0.4,
            acceptance:    0.1,
            completion:    0.1,
        };
        // Sanity: this non-default weight tuple must validate (sum=1.0 exactly).
        assert!(cfg.reward_weights.validate().is_ok());

        // Build the equivalent DiskConfig snapshot and round-trip it through
        // serde_json (the same codec save_disk_config uses). This exercises
        // the same wire format the on-disk config sees.
        let disk = DiskConfig {
            provider: cfg.provider.clone(),
            model: cfg.model.clone(),
            onboarded: cfg.onboarded,
            mcp_servers: cfg.mcp_servers.clone(),
            window_state: cfg.window_state.clone(),
            token_efficient: cfg.token_efficient,
            user_name: cfg.user_name.clone(),
            work_mode: cfg.work_mode.clone(),
            response_style: cfg.response_style.clone(),
            blade_email: cfg.blade_email.clone(),
            base_url: cfg.base_url.clone(),
            god_mode: cfg.god_mode,
            god_mode_tier: cfg.god_mode_tier.clone(),
            voice_mode: cfg.voice_mode.clone(),
            obsidian_vault_path: cfg.obsidian_vault_path.clone(),
            tts_voice: cfg.tts_voice.clone(),
            quick_ask_shortcut: cfg.quick_ask_shortcut.clone(),
            voice_shortcut: cfg.voice_shortcut.clone(),
            screen_timeline_enabled: cfg.screen_timeline_enabled,
            timeline_capture_interval: cfg.timeline_capture_interval,
            timeline_retention_days: cfg.timeline_retention_days,
            wake_word_enabled: cfg.wake_word_enabled,
            wake_word_phrase: cfg.wake_word_phrase.clone(),
            wake_word_sensitivity: cfg.wake_word_sensitivity,
            active_role: cfg.active_role.clone(),
            blade_source_path: cfg.blade_source_path.clone(),
            trusted_ai_delegate: cfg.trusted_ai_delegate.clone(),
            blade_dedicated_monitor: cfg.blade_dedicated_monitor,
            task_routing: cfg.task_routing.clone(),
            background_ai_enabled: cfg.background_ai_enabled,
            persona_onboarding_complete: cfg.persona_onboarding_complete,
            fallback_providers: cfg.fallback_providers.clone(),
            use_local_whisper: cfg.use_local_whisper,
            whisper_model: cfg.whisper_model.clone(),
            last_deep_scan: cfg.last_deep_scan,
            integration_polling_enabled: cfg.integration_polling_enabled,
            tts_speed: cfg.tts_speed,
            ha_base_url: cfg.ha_base_url.clone(),
            audio_capture_enabled: cfg.audio_capture_enabled,
            ghost_mode_enabled: cfg.ghost_mode_enabled,
            ghost_mode_position: cfg.ghost_mode_position.clone(),
            ghost_auto_reply: cfg.ghost_auto_reply,
            hive_enabled: cfg.hive_enabled,
            hive_autonomy: cfg.hive_autonomy,
            provider_capabilities: cfg.provider_capabilities.clone(),
            vision_provider: cfg.vision_provider.clone(),
            audio_provider: cfg.audio_provider.clone(),
            long_context_provider: cfg.long_context_provider.clone(),
            tools_provider: cfg.tools_provider.clone(),
            scan_classes_enabled: cfg.scan_classes_enabled.clone(),
            ecosystem_tentacles: cfg.ecosystem_tentacles.clone(),
            ecosystem_observe_only: cfg.ecosystem_observe_only,
            voyager_skill_write_budget_tokens: cfg.voyager_skill_write_budget_tokens,
            reward_weights: cfg.reward_weights.clone(),
            context: cfg.context.clone(),
            r#loop: cfg.r#loop.clone(),
            resilience: cfg.resilience.clone(),
            session: cfg.session.clone(),
            api_key: None,
        };

        let serialized = serde_json::to_string(&disk).expect("serialize DiskConfig");
        // Field MUST appear on the wire — guards against accidental
        // #[serde(skip_serializing)] regression.
        assert!(
            serialized.contains("\"reward_weights\""),
            "serialized DiskConfig missing reward_weights field: {}",
            serialized
        );
        let loaded: DiskConfig = serde_json::from_str(&serialized).expect("deserialize DiskConfig");
        assert_eq!(loaded.reward_weights, cfg.reward_weights);
    }

    /// `save_config` MUST hard-reject a corrupt sum BEFORE attempting any
    /// keychain write. We verify by passing a weights tuple that fails
    /// validation and asserting the error text matches the validate() shape.
    /// (Per-thread BLADE_CONFIG_DIR isolation is unnecessary because the
    /// save call short-circuits on validate() before touching disk.)
    #[test]
    fn reward_weights_save_config_rejects_corrupt_sum() {
        let mut cfg = BladeConfig::default();
        cfg.reward_weights = RewardWeights {
            skill_success: 0.7,
            eval_gate:     0.7,
            acceptance:    0.0,
            completion:    0.0,
        };
        let err = save_config(&cfg).expect_err("save_config must reject sum > 1.0+1e-3");
        assert!(
            err.contains("reward_weights sum out of [0,1]"),
            "save_config rejection text did not match validate() format: {}",
            err
        );
    }

    // ---------------------------------------------------------------------
    // Phase 32 Plan 32-01 — ContextConfig tests (CTX-07 + tunables).
    //
    // These three tests lock the six-place config wire-up:
    //   - default_values: ContextConfig::default() returns the locked
    //     CTX-01/04/05/07 defaults (true / 0.2 / 0.80 / 4000).
    //   - round_trip: a non-default ContextConfig survives serialization
    //     through DiskConfig (mirrors save_config -> load_config wire format).
    //   - missing_in_disk_uses_defaults: legacy config.json without a
    //     `context` key MUST load with ContextConfig::default()
    //     (#[serde(default)] on the field — non-negotiable per CLAUDE.md).
    // ---------------------------------------------------------------------

    #[test]
    fn phase32_context_config_default_values() {
        let c = ContextConfig::default();
        assert_eq!(c.smart_injection_enabled, true,
            "CTX-07 escape hatch defaults to enabled (smart path on)");
        assert!((c.relevance_gate - 0.2).abs() < 1e-6,
            "default relevance_gate must be 0.2, got {}", c.relevance_gate);
        assert!((c.compaction_trigger_pct - 0.80).abs() < 1e-6,
            "default compaction_trigger_pct must be 0.80, got {}", c.compaction_trigger_pct);
        assert_eq!(c.tool_output_cap_tokens, 4000,
            "default tool_output_cap_tokens must be 4000");
    }

    #[test]
    fn phase32_context_config_round_trip() {
        // Build BladeConfig with non-default context values to verify all
        // four fields survive byte-for-byte through the DiskConfig wire format.
        let mut cfg = BladeConfig::default();
        cfg.context = ContextConfig {
            smart_injection_enabled: false,
            relevance_gate: 0.5,
            compaction_trigger_pct: 0.65,
            tool_output_cap_tokens: 8000,
        };

        // Mirror the save_config DiskConfig snapshot — reuse DiskConfig::default()
        // for the unrelated fields and overlay the context we care about.
        let mut disk = DiskConfig::default();
        disk.context = cfg.context.clone();

        let json = serde_json::to_string(&disk).expect("serialize DiskConfig");
        // Field MUST appear on the wire — guards against accidental
        // #[serde(skip_serializing)] regression on the new field.
        assert!(
            json.contains("\"context\""),
            "serialized DiskConfig missing context field: {}",
            json
        );

        let parsed: DiskConfig = serde_json::from_str(&json).expect("parse DiskConfig");
        assert_eq!(parsed.context, cfg.context,
            "ContextConfig round-trip lost data");
    }

    #[test]
    fn phase32_context_config_missing_in_disk_uses_defaults() {
        // An old user's config.json that predates Phase 32 has no `context`
        // key. The #[serde(default)] on DiskConfig.context MUST fall back to
        // ContextConfig::default() rather than failing the load. This is the
        // CLAUDE.md backward-compat invariant — every existing user must
        // upgrade without a manual config edit.
        let legacy_json = r#"{
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "onboarded": true
        }"#;
        let parsed: DiskConfig = serde_json::from_str(legacy_json)
            .expect("legacy config without context key must parse with defaults");
        assert_eq!(parsed.context, ContextConfig::default(),
            "missing context key must fall back to ContextConfig::default()");
    }

    // ---------------------------------------------------------------------
    // Phase 33 Plan 33-01 — LoopConfig tests (LOOP-06 substrate).
    //
    // These three tests lock the six-place config wire-up for the new
    // r#loop: LoopConfig field (raw identifier — `loop` is a Rust keyword):
    //   - default_values: LoopConfig::default() returns the locked
    //     LOOP-01/06 defaults (true / 25 / 5.0 / 3).
    //   - round_trip: a non-default LoopConfig survives serialization
    //     through DiskConfig (mirrors save_config -> load_config wire format).
    //   - missing_in_disk_uses_defaults: legacy config.json without a
    //     `loop` key MUST load with LoopConfig::default()
    //     (#[serde(default)] on the field — non-negotiable per CLAUDE.md).
    // ---------------------------------------------------------------------

    #[test]
    fn phase33_loop_config_default_values() {
        let c = LoopConfig::default();
        assert_eq!(c.smart_loop_enabled, true,
            "LoopConfig default smart_loop_enabled must be true (CTX-07-style escape hatch)");
        assert_eq!(c.max_iterations, 25,
            "LoopConfig default max_iterations must be 25 (was hardcoded 12)");
        assert!((c.cost_guard_dollars - 5.0).abs() < 1e-6,
            "LoopConfig default cost_guard_dollars must be 5.0 USD, got {}",
            c.cost_guard_dollars);
        assert_eq!(c.verification_every_n, 3,
            "LoopConfig default verification_every_n must be 3");
    }

    #[test]
    fn phase33_loop_config_round_trip() {
        // Build BladeConfig with non-default loop values to verify all four
        // fields survive byte-for-byte through the DiskConfig wire format.
        let mut cfg = BladeConfig::default();
        cfg.r#loop = LoopConfig {
            smart_loop_enabled: false,
            max_iterations: 10,
            cost_guard_dollars: 1.5,
            verification_every_n: 5,
        };

        // Mirror the save_config DiskConfig snapshot — reuse DiskConfig::default()
        // for unrelated fields and overlay the loop config we care about.
        let mut disk = DiskConfig::default();
        disk.r#loop = cfg.r#loop.clone();

        let json = serde_json::to_string(&disk).expect("serialize DiskConfig");
        // Field MUST appear on the wire — guards against accidental
        // #[serde(skip_serializing)] regression on the new field.
        assert!(
            json.contains("\"loop\""),
            "serialized DiskConfig missing loop field: {}",
            json
        );

        let parsed: DiskConfig = serde_json::from_str(&json).expect("parse DiskConfig");
        assert_eq!(parsed.r#loop, cfg.r#loop,
            "LoopConfig round-trip lost data");
    }

    #[test]
    fn phase33_loop_config_missing_in_disk_uses_defaults() {
        // An old user's config.json that predates Phase 33 has no `loop`
        // key. The #[serde(default)] on DiskConfig.r#loop MUST fall back to
        // LoopConfig::default() rather than failing the load. This is the
        // CLAUDE.md backward-compat invariant — every existing user must
        // upgrade without a manual config edit.
        let legacy_json = r#"{
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "onboarded": true
        }"#;
        let parsed: DiskConfig = serde_json::from_str(legacy_json)
            .expect("legacy config without loop key must parse with defaults");
        assert_eq!(parsed.r#loop, LoopConfig::default(),
            "missing loop key must fall back to LoopConfig::default()");
    }

    // ---------------------------------------------------------------------
    // Phase 34 Plan 34-01 — ResilienceConfig + SessionConfig tests
    // (RES-01..05 + SESS-01..04 substrate).
    //
    // Six tests lock the twelve-place config wire-up for the two new
    // sub-structs (six places per struct):
    //   - default_values: each ::default() returns the locked
    //     RES-01..05 / SESS-01..04 defaults verbatim.
    //   - round_trip: a non-default sub-struct survives serialization
    //     through DiskConfig (mirrors save_config -> load_config wire format).
    //   - missing_uses_defaults: legacy config.json without a `resilience`
    //     or `session` key MUST load with the respective ::default()
    //     (#[serde(default)] on the field — non-negotiable per CLAUDE.md).
    // ---------------------------------------------------------------------

    #[test]
    fn phase34_resilience_config_default_values() {
        let c = ResilienceConfig::default();
        assert!(c.smart_resilience_enabled, "default smart_resilience_enabled must be true");
        assert!(c.stuck_detection_enabled, "default stuck_detection_enabled must be true");
        assert_eq!(c.recent_actions_window, 6);
        assert_eq!(c.monologue_threshold, 5);
        assert_eq!(c.compaction_thrash_threshold, 3);
        assert_eq!(c.no_progress_threshold, 5);
        assert_eq!(c.circuit_breaker_threshold, 3);
        assert!((c.cost_guard_per_conversation_dollars - 25.0).abs() < 1e-6);
        assert_eq!(c.provider_fallback_chain,
            vec!["primary","openrouter","groq","ollama"]
                .into_iter().map(String::from).collect::<Vec<_>>());
        assert_eq!(c.max_retries_per_provider, 2);
        assert_eq!(c.backoff_base_ms, 500);
        assert_eq!(c.backoff_max_ms, 30_000);
    }

    #[test]
    fn phase34_session_config_default_values() {
        let c = SessionConfig::default();
        assert!(c.jsonl_log_enabled, "default jsonl_log_enabled must be true");
        assert_eq!(c.jsonl_log_dir, blade_config_dir().join("sessions"));
        assert!(!c.auto_resume_last, "default auto_resume_last must be false (v1.1 lesson)");
        assert_eq!(c.keep_n_sessions, 100);
    }

    #[test]
    fn phase34_resilience_config_round_trip() {
        let mut cfg = BladeConfig::default();
        cfg.resilience = ResilienceConfig {
            smart_resilience_enabled: false,
            stuck_detection_enabled: false,
            recent_actions_window: 12,
            monologue_threshold: 8,
            compaction_thrash_threshold: 5,
            no_progress_threshold: 7,
            circuit_breaker_threshold: 4,
            cost_guard_per_conversation_dollars: 99.99,
            provider_fallback_chain: vec!["x".to_string(), "y".to_string()],
            max_retries_per_provider: 5,
            backoff_base_ms: 1000,
            backoff_max_ms: 60_000,
        };
        let mut disk = DiskConfig::default();
        disk.resilience = cfg.resilience.clone();
        let json = serde_json::to_string(&disk).expect("serialize");
        let parsed: DiskConfig = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.resilience, cfg.resilience, "ResilienceConfig roundtrip lost data");
    }

    #[test]
    fn phase34_session_config_round_trip() {
        let mut cfg = BladeConfig::default();
        cfg.session = SessionConfig {
            jsonl_log_enabled: false,
            jsonl_log_dir: std::path::PathBuf::from("/tmp/blade-test-sessions"),
            auto_resume_last: true,
            keep_n_sessions: 42,
        };
        let mut disk = DiskConfig::default();
        disk.session = cfg.session.clone();
        let json = serde_json::to_string(&disk).expect("serialize");
        let parsed: DiskConfig = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.session, cfg.session, "SessionConfig roundtrip lost data");
    }

    #[test]
    fn phase34_resilience_missing_uses_defaults() {
        let legacy_json = r#"{
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "onboarded": true
        }"#;
        let parsed: DiskConfig = serde_json::from_str(legacy_json)
            .expect("legacy config should parse with defaults");
        assert_eq!(parsed.resilience, ResilienceConfig::default(),
            "missing 'resilience' key must fall back to ResilienceConfig::default()");
    }

    #[test]
    fn phase34_session_missing_uses_defaults() {
        let legacy_json = r#"{
            "provider": "anthropic",
            "model": "claude-sonnet-4",
            "onboarded": true
        }"#;
        let parsed: DiskConfig = serde_json::from_str(legacy_json)
            .expect("legacy config should parse with defaults");
        assert_eq!(parsed.session, SessionConfig::default(),
            "missing 'session' key must fall back to SessionConfig::default()");
    }
}
