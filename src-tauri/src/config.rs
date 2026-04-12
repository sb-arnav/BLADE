use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "blade-ai";

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
    // Legacy field — read for migration, never written
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
}

fn default_god_mode_tier() -> String { "normal".to_string() }
fn default_voice_mode() -> String { "off".to_string() }
fn default_tts_voice() -> String { "system".to_string() }
fn default_quick_ask_shortcut() -> String { "Alt+Space".to_string() }
fn default_voice_shortcut() -> String { "Ctrl+Shift+V".to_string() }
fn default_timeline_interval() -> u32 { 30 }
fn default_timeline_retention() -> u32 { 14 }

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
            quick_ask_shortcut: "Alt+Space".to_string(),
            voice_shortcut: "Ctrl+Shift+V".to_string(),
            screen_timeline_enabled: false,
            timeline_capture_interval: 30,
            timeline_retention_days: 14,
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
            quick_ask_shortcut: "Alt+Space".to_string(),
            voice_shortcut: "Ctrl+Shift+V".to_string(),
            screen_timeline_enabled: false,
            timeline_capture_interval: 30,
            timeline_retention_days: 14,
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
    let providers = ["anthropic", "openai", "gemini", "groq", "ollama"];
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
    save_config(&config)?;
    Ok(config)
}

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
