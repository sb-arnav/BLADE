pub mod loader;
pub mod registry;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Plugin manifest (blade-plugin.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub commands: Vec<PluginCommand>,
    #[serde(default)]
    pub ui_slots: Vec<UiSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCommand {
    pub name: String,
    pub description: String,
    pub handler: String, // JS function name
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiSlot {
    pub slot: String, // "sidebar", "settings", "message-action", "slash-command"
    pub component: String, // JS component name or file
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub path: String,
    pub enabled: bool,
}

pub fn plugins_dir() -> PathBuf {
    let dir = crate::config::blade_config_dir().join("plugins");
    std::fs::create_dir_all(&dir).ok();
    dir
}
