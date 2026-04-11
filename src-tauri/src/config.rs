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
    // Legacy field — read for migration, never written
    #[serde(default, skip_serializing)]
    api_key: Option<String>,
}

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
        api_key: None,
    };

    save_disk_config(&disk)
}

fn save_disk_config(config: &DiskConfig) -> Result<(), String> {
    let path = config_path();
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    write_blade_file(&path, &data)
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
