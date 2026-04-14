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
    // Legacy field — read for migration, never written
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
}

fn default_tts_speed() -> f32 { 1.0 }
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
pub(crate) fn get_provider_key(provider: &str) -> String {
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
        Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
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
