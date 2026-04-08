use super::{InstalledPlugin, PluginManifest, plugins_dir};
use std::fs;
use std::path::Path;

/// Load all installed plugins from the plugins directory
pub fn load_all_plugins() -> Vec<InstalledPlugin> {
    let dir = plugins_dir();
    let mut plugins = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("blade-plugin.json");
            if !manifest_path.exists() {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                    // Check if plugin is enabled (default: true)
                    let enabled_file = path.join(".enabled");
                    let disabled_file = path.join(".disabled");
                    let enabled = !disabled_file.exists() || enabled_file.exists();

                    plugins.push(InstalledPlugin {
                        manifest,
                        path: path.to_string_lossy().to_string(),
                        enabled,
                    });
                }
            }
        }
    }

    plugins
}

/// Install a plugin from a directory (copies to plugins dir)
pub fn install_plugin(source_path: &str) -> Result<InstalledPlugin, String> {
    let source = Path::new(source_path);
    let manifest_path = source.join("blade-plugin.json");

    if !manifest_path.exists() {
        return Err("No blade-plugin.json found".to_string());
    }

    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: PluginManifest =
        serde_json::from_str(&content).map_err(|e| format!("Invalid manifest: {}", e))?;

    let dest = plugins_dir().join(&manifest.name);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }

    copy_dir_recursive(source, &dest)?;

    Ok(InstalledPlugin {
        manifest,
        path: dest.to_string_lossy().to_string(),
        enabled: true,
    })
}

/// Uninstall a plugin
pub fn uninstall_plugin(plugin_name: &str) -> Result<(), String> {
    let path = plugins_dir().join(plugin_name);
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Toggle plugin enabled/disabled
pub fn toggle_plugin(plugin_name: &str, enabled: bool) -> Result<(), String> {
    let path = plugins_dir().join(plugin_name);
    let enabled_file = path.join(".enabled");
    let disabled_file = path.join(".disabled");

    if enabled {
        let _ = fs::remove_file(&disabled_file);
        fs::write(&enabled_file, "").map_err(|e| e.to_string())?;
    } else {
        let _ = fs::remove_file(&enabled_file);
        fs::write(&disabled_file, "").map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
