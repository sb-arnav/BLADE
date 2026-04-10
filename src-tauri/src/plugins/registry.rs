use super::{loader, InstalledPlugin};

/// Tauri commands for plugin management

#[tauri::command]
pub fn plugin_list() -> Vec<InstalledPlugin> {
    loader::load_all_plugins()
}

#[tauri::command]
pub fn plugin_install(source_path: String) -> Result<InstalledPlugin, String> {
    loader::install_plugin(&source_path)
}

#[tauri::command]
pub fn plugin_uninstall(plugin_name: String) -> Result<(), String> {
    loader::uninstall_plugin(&plugin_name)
}

#[tauri::command]
pub fn plugin_toggle(plugin_name: String, enabled: bool) -> Result<(), String> {
    loader::toggle_plugin(&plugin_name, enabled)
}

#[tauri::command]
pub fn plugin_get_commands() -> Vec<PluginCommandInfo> {
    let plugins = loader::load_all_plugins();
    plugins
        .iter()
        .filter(|p| p.enabled)
        .flat_map(|p| {
            p.manifest
                .commands
                .iter()
                .map(move |cmd| PluginCommandInfo {
                    plugin: p.manifest.name.clone(),
                    name: cmd.name.clone(),
                    description: cmd.description.clone(),
                })
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct PluginCommandInfo {
    pub plugin: String,
    pub name: String,
    pub description: String,
}
