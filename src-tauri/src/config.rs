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
        }
    }
}

pub fn blade_config_dir() -> PathBuf {
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
    }
}

pub fn save_config(config: &BladeConfig) -> Result<(), String> {
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
        // Integer fields
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
}
