#![allow(dead_code)]

//! Deep System Discovery — scans the user's machine on first run to build
//! a complete identity profile stored in ~/.blade/identity/scan_results.json.
//!
//! Each scanner is an independent async function. `deep_scan_start` runs them
//! all in parallel via tokio::join! and emits progress events as work lands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

// ── Result types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstalledApp {
    pub name: String,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub install_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitRepo {
    pub path: String,
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub primary_language: Option<String>,
    pub language_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdeInfo {
    pub name: String,
    pub config_path: Option<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShellHistory {
    pub shell: String,
    pub top_commands: Vec<(String, usize)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WslDistro {
    pub name: String,
    pub state: String,
    pub version: String,
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PackageManagerInfo {
    pub name: String,
    pub packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiToolInfo {
    pub name: String,
    pub detected: bool,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SystemInfo {
    pub cpu: String,
    pub gpu: String,
    pub total_ram_mb: u64,
    pub total_disk_gb: u64,
    pub os_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SshKey {
    pub filename: String,
    pub key_type: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DockerInfo {
    pub running_containers: Vec<String>,
    pub images: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserBookmarks {
    pub browser: String,
    pub count: usize,
    pub domains: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeepScanResults {
    pub scanned_at: i64,
    pub installed_apps: Vec<InstalledApp>,
    pub default_browser: Option<String>,
    pub ides: Vec<IdeInfo>,
    pub git_repos: Vec<GitRepo>,
    pub shell_history: Vec<ShellHistory>,
    pub wsl_distros: Vec<WslDistro>,
    pub package_managers: Vec<PackageManagerInfo>,
    pub ai_tools: Vec<AiToolInfo>,
    pub system_info: SystemInfo,
    pub ssh_keys: Vec<SshKey>,
    pub docker: DockerInfo,
    pub browser_bookmarks: Vec<BrowserBookmarks>,
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn scan_results_path() -> PathBuf {
    let blade_dir = crate::config::blade_config_dir();
    blade_dir.join("identity").join("scan_results.json")
}

fn save_results(results: &DeepScanResults) -> Result<(), String> {
    let path = scan_results_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(results).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_results() -> Option<DeepScanResults> {
    let path = scan_results_path();
    let data = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Public API for persona_engine.rs — returns the full scan results struct.
pub fn load_results_pub() -> Option<DeepScanResults> {
    load_results()
}

// ── 1. Installed Apps — Windows registry ─────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_installed_apps() -> Vec<InstalledApp> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let paths = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    let mut apps: Vec<InstalledApp> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (hive_const, sub_path) in &paths {
        let hive = RegKey::predef(*hive_const);
        let Ok(key) = hive.open_subkey_with_flags(sub_path, KEY_READ) else { continue };

        for sub_name in key.enum_keys().filter_map(|r| r.ok()) {
            let Ok(sub) = key.open_subkey_with_flags(&sub_name, KEY_READ) else { continue };

            // Skip entries without a display name (drivers, patches, etc.)
            let name: String = match sub.get_value("DisplayName") {
                Ok(v) => v,
                Err(_) => continue,
            };
            if name.trim().is_empty() { continue; }
            if !seen.insert(name.clone()) { continue; }

            let version: Option<String> = sub.get_value("DisplayVersion").ok();
            let publisher: Option<String> = sub.get_value("Publisher").ok();
            let install_date: Option<String> = sub.get_value("InstallDate").ok();

            apps.push(InstalledApp { name, version, publisher, install_date });
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[cfg(not(target_os = "windows"))]
fn scan_installed_apps() -> Vec<InstalledApp> {
    // macOS: parse `system_profiler SPApplicationsDataType -json` (stub)
    // Linux: parse `dpkg -l` or `rpm -qa` (stub)
    vec![]
}

// ── 2. Default Browser ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_default_browser() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
            KEY_READ,
        )
        .ok()?;
    let prog_id: String = key.get_value("ProgId").ok()?;

    let browser = if prog_id.contains("ChromeHTML") || prog_id.contains("Chrome") {
        "Chrome"
    } else if prog_id.contains("FirefoxURL") || prog_id.contains("Firefox") {
        "Firefox"
    } else if prog_id.contains("MSEdgeHTM") || prog_id.contains("Edge") {
        "Edge"
    } else if prog_id.contains("BraveHTML") || prog_id.contains("Brave") {
        "Brave"
    } else if prog_id.contains("OperaStable") || prog_id.contains("Opera") {
        "Opera"
    } else if prog_id.contains("Vivaldi") {
        "Vivaldi"
    } else if prog_id.contains("IE.HTTP") || prog_id.contains("IExplore") {
        "Internet Explorer"
    } else {
        &prog_id
    };

    Some(browser.to_string())
}

#[cfg(not(target_os = "windows"))]
fn scan_default_browser() -> Option<String> {
    // macOS: `defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`
    // Linux: `xdg-settings get default-web-browser`
    None
}

// ── 3. IDEs ───────────────────────────────────────────────────────────────────

fn scan_ides() -> Vec<IdeInfo> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut ides = Vec::new();

    // VS Code
    let vscode_settings = {
        #[cfg(target_os = "windows")]
        { dirs::data_dir().map(|d| d.join("Code").join("User").join("settings.json")) }
        #[cfg(target_os = "macos")]
        { Some(home.join("Library/Application Support/Code/User/settings.json")) }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        { Some(home.join(".config/Code/User/settings.json")) }
    };

    if let Some(ref p) = vscode_settings {
        if p.exists() {
            let extensions = scan_vscode_extensions(&home);
            ides.push(IdeInfo {
                name: "VS Code".to_string(),
                config_path: Some(p.to_string_lossy().to_string()),
                extensions,
            });
        }
    }

    // Cursor (Electron app, similar layout to VS Code)
    let cursor_settings = {
        #[cfg(target_os = "windows")]
        { dirs::data_dir().map(|d| d.join("Cursor").join("User").join("settings.json")) }
        #[cfg(target_os = "macos")]
        { Some(home.join("Library/Application Support/Cursor/User/settings.json")) }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        { Some(home.join(".config/Cursor/User/settings.json")) }
    };

    if let Some(ref p) = cursor_settings {
        if p.exists() {
            let extensions = scan_cursor_extensions(&home);
            ides.push(IdeInfo {
                name: "Cursor".to_string(),
                config_path: Some(p.to_string_lossy().to_string()),
                extensions,
            });
        }
    }

    // JetBrains family
    if let Some(data_dir) = dirs::data_dir() {
        let jb_root = data_dir.join("JetBrains");
        if jb_root.exists() {
            if let Ok(entries) = std::fs::read_dir(&jb_root) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    ides.push(IdeInfo {
                        name: format!("JetBrains/{}", name),
                        config_path: Some(entry.path().to_string_lossy().to_string()),
                        extensions: vec![],
                    });
                }
            }
        }
    }

    // Neovim
    let nvim_config = home.join(".config").join("nvim").join("init.lua");
    let nvim_config_vim = home.join(".config").join("nvim").join("init.vim");
    if nvim_config.exists() || nvim_config_vim.exists() {
        let p = if nvim_config.exists() { &nvim_config } else { &nvim_config_vim };
        ides.push(IdeInfo {
            name: "Neovim".to_string(),
            config_path: Some(p.to_string_lossy().to_string()),
            extensions: vec![],
        });
    }

    ides
}

fn scan_vscode_extensions(home: &Path) -> Vec<String> {
    let ext_dir = home.join(".vscode").join("extensions");
    list_dir_names(&ext_dir)
}

fn scan_cursor_extensions(home: &Path) -> Vec<String> {
    let ext_dir = home.join(".cursor").join("extensions");
    list_dir_names(&ext_dir)
}

fn list_dir_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect()
}

// ── 4. Git Repos ──────────────────────────────────────────────────────────────

fn scan_git_repos() -> Vec<GitRepo> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let candidate_dirs = [
        home.join("Documents"),
        home.join("projects"),
        home.join("dev"),
        home.join("code"),
        home.join("repos"),
        home.join("Desktop"),
        home.join("src"),
        home.join("work"),
    ];

    let mut repos = Vec::new();

    for root in &candidate_dirs {
        if !root.is_dir() { continue; }
        // 1-level deep only
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            let git_dir = path.join(".git");
            if git_dir.exists() {
                let repo = inspect_git_repo(&path);
                repos.push(repo);
            }
        }
    }

    repos
}

fn inspect_git_repo(path: &Path) -> GitRepo {
    let path_str = path.to_string_lossy().to_string();
    let mut repo = GitRepo {
        path: path_str.clone(),
        ..Default::default()
    };

    // Remote URL from .git/config
    let git_config = path.join(".git").join("config");
    if let Ok(content) = std::fs::read_to_string(&git_config) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("url = ") {
                repo.remote_url = Some(trimmed.trim_start_matches("url = ").to_string());
                break;
            }
        }
    }

    // Current branch from .git/HEAD
    let head_file = path.join(".git").join("HEAD");
    if let Ok(content) = std::fs::read_to_string(&head_file) {
        let trimmed = content.trim();
        if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
            repo.branch = Some(branch.to_string());
        } else {
            repo.branch = Some(trimmed.chars().take(8).collect::<String>()); // detached HEAD
        }
    }

    // Primary language by counting file extensions (shallow scan, first 200 files)
    let mut ext_counts: HashMap<String, usize> = HashMap::new();
    count_extensions_shallow(path, &mut ext_counts, 0, 3);

    if !ext_counts.is_empty() {
        let primary = ext_counts
            .iter()
            .max_by_key(|(_, v)| *v)
            .map(|(k, _)| k.clone());
        repo.primary_language = primary.map(|ext| ext_to_language(&ext).to_string());
        repo.language_counts = ext_counts
            .into_iter()
            .map(|(k, v)| (ext_to_language(&k).to_string(), v))
            .fold(HashMap::new(), |mut acc, (lang, count)| {
                *acc.entry(lang).or_insert(0) += count;
                acc
            });
    }

    repo
}

fn count_extensions_shallow(path: &Path, counts: &mut HashMap<String, usize>, depth: usize, max_depth: usize) {
    if depth > max_depth { return; }
    let Ok(entries) = std::fs::read_dir(path) else { return };
    for entry in entries.filter_map(|e| e.ok()).take(100) {
        let p = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        // skip hidden dirs and common non-source dirs
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" { continue; }
        if p.is_file() {
            if let Some(ext) = p.extension() {
                *counts.entry(ext.to_string_lossy().to_string()).or_insert(0) += 1;
            }
        } else if p.is_dir() && depth < max_depth {
            count_extensions_shallow(&p, counts, depth + 1, max_depth);
        }
    }
}

fn ext_to_language(ext: &str) -> &str {
    match ext {
        "rs" => "Rust", "ts" | "tsx" => "TypeScript", "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" => "Python", "go" => "Go", "java" => "Java", "kt" | "kts" => "Kotlin",
        "swift" => "Swift", "cpp" | "cc" | "cxx" => "C++", "c" => "C", "cs" => "C#",
        "rb" => "Ruby", "php" => "PHP", "scala" => "Scala", "dart" => "Dart",
        "lua" => "Lua", "r" => "R", "jl" => "Julia", "ex" | "exs" => "Elixir",
        "hs" => "Haskell", "clj" | "cljs" => "Clojure", "ml" | "mli" => "OCaml",
        "zig" => "Zig", "nim" => "Nim", "v" => "V",
        "html" | "htm" => "HTML", "css" | "scss" | "sass" | "less" => "CSS",
        "sh" | "bash" | "zsh" => "Shell", "ps1" => "PowerShell",
        "toml" => "TOML", "yaml" | "yml" => "YAML", "json" => "JSON", "xml" => "XML",
        "sql" => "SQL", "md" | "mdx" => "Markdown",
        _ => ext,
    }
}

// ── 5. Shell History ──────────────────────────────────────────────────────────

fn scan_shell_history() -> Vec<ShellHistory> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut results = Vec::new();

    // PowerShell history
    let ps_history = {
        #[cfg(target_os = "windows")]
        {
            dirs::data_dir().map(|d| {
                d.join("Microsoft")
                    .join("Windows")
                    .join("PowerShell")
                    .join("PSReadLine")
                    .join("ConsoleHost_history.txt")
            })
        }
        #[cfg(not(target_os = "windows"))]
        { None::<PathBuf> }
    };

    if let Some(path) = ps_history {
        if let Some(h) = parse_history_file(&path, "PowerShell") {
            results.push(h);
        }
    }

    // bash history
    if let Some(h) = parse_history_file(&home.join(".bash_history"), "bash") {
        results.push(h);
    }

    // zsh history
    let zsh_path = std::env::var("HISTFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".zsh_history"));
    if let Some(h) = parse_history_file(&zsh_path, "zsh") {
        results.push(h);
    }

    // fish history
    let fish_hist = home.join(".local").join("share").join("fish").join("fish_history");
    if let Some(h) = parse_history_file(&fish_hist, "fish") {
        results.push(h);
    }

    results
}

fn parse_history_file(path: &Path, shell: &str) -> Option<ShellHistory> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut cmd_counts: HashMap<String, usize> = HashMap::new();

    for line in content.lines() {
        // Strip zsh extended_history timestamps (": 1234567890:0;command")
        let cmd = if line.starts_with(": ") {
            line.splitn(3, ';').nth(1).unwrap_or(line)
        } else {
            line
        };
        // Fish history lines: "- cmd: command"
        let cmd = if cmd.trim_start().starts_with("- cmd:") {
            cmd.trim_start().trim_start_matches("- cmd:").trim()
        } else {
            cmd.trim()
        };

        if cmd.is_empty() || cmd.starts_with('#') { continue; }

        // Extract base command (first word)
        let base = cmd.split_whitespace().next().unwrap_or(cmd);
        if base.len() > 60 { continue; }
        *cmd_counts.entry(base.to_string()).or_insert(0) += 1;
    }

    if cmd_counts.is_empty() { return None; }

    let mut top: Vec<(String, usize)> = cmd_counts.into_iter().collect();
    top.sort_by(|a, b| b.1.cmp(&a.1));
    top.truncate(20);

    Some(ShellHistory { shell: shell.to_string(), top_commands: top })
}

// ── 6. WSL Distros ────────────────────────────────────────────────────────────

async fn scan_wsl_distros() -> Vec<WslDistro> {
    #[cfg(not(target_os = "windows"))]
    { return vec![]; }

    #[cfg(target_os = "windows")]
    {
        let output = crate::cmd_util::silent_tokio_cmd("wsl")
            .args(["--list", "--verbose"])
            .output()
            .await;

        let Ok(out) = output else { return vec![] };

        // WSL outputs UTF-16LE on some versions; try to decode gracefully
        let raw = String::from_utf8_lossy(&out.stdout).to_string();
        // Strip BOM and null bytes (UTF-16 artefact)
        let text: String = raw.chars().filter(|c| *c != '\0' && *c != '\u{FEFF}').collect();

        let mut distros = Vec::new();
        for line in text.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 { continue; }
            let (name_start, state_idx, ver_idx) = if parts[0] == "*" {
                (1, 2, 3)
            } else {
                (0, 1, 2)
            };
            if parts.len() <= ver_idx { continue; }
            let name = parts[name_start].to_string();
            let state = parts.get(state_idx).copied().unwrap_or("").to_string();
            let version = parts.get(ver_idx).copied().unwrap_or("").to_string();

            let projects = if state.to_lowercase() == "running" {
                scan_wsl_home_projects(&name).await
            } else {
                vec![]
            };

            distros.push(WslDistro { name, state, version, projects });
        }
        distros
    }
}

#[cfg(target_os = "windows")]
async fn scan_wsl_home_projects(distro: &str) -> Vec<String> {
    // List /home/*/  dirs that look like project dirs (contain .git or package.json)
    let output = crate::cmd_util::silent_tokio_cmd("wsl")
        .args(["-d", distro, "--", "find", "/home", "-maxdepth", "3", "-name", ".git", "-type", "d"])
        .output()
        .await;

    let Ok(out) = output else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .map(|l| l.trim_end_matches("/.git").to_string())
        .filter(|l| !l.is_empty())
        .take(20)
        .collect()
}

#[cfg(not(target_os = "windows"))]
async fn scan_wsl_home_projects(_distro: &str) -> Vec<String> { vec![] }

// ── 7. Package Managers ───────────────────────────────────────────────────────

async fn scan_package_managers() -> Vec<PackageManagerInfo> {
    let mut results = Vec::new();

    // npm global
    if let Some(pkgs) = run_cmd_lines("npm", &["list", "-g", "--depth=0", "--parseable"]).await {
        let packages = pkgs.into_iter()
            .filter(|l| !l.is_empty())
            .map(|l| {
                // parseable output: /path/to/node_modules/pkg-name
                l.split(['/', '\\']).last().unwrap_or(&l).to_string()
            })
            .filter(|p| p != "lib")
            .collect();
        results.push(PackageManagerInfo { name: "npm".to_string(), packages });
    }

    // pip list
    if let Some(pkgs) = run_cmd_lines("pip", &["list", "--format=freeze"]).await {
        let packages = pkgs.into_iter()
            .filter_map(|l| l.split_once('=').map(|(n, _)| n.to_string()))
            .collect();
        results.push(PackageManagerInfo { name: "pip".to_string(), packages });
    } else if let Some(pkgs) = run_cmd_lines("pip3", &["list", "--format=freeze"]).await {
        let packages = pkgs.into_iter()
            .filter_map(|l| l.split_once('=').map(|(n, _)| n.to_string()))
            .collect();
        results.push(PackageManagerInfo { name: "pip3".to_string(), packages });
    }

    // cargo install --list
    if let Some(raw) = run_cmd_output("cargo", &["install", "--list"]).await {
        // Output: "pkg-name v1.2.3:\n    bin-name\n"
        let packages = raw.lines()
            .filter(|l| !l.starts_with(' ') && !l.starts_with('\t') && !l.is_empty())
            .map(|l| l.split_whitespace().next().unwrap_or(l).to_string())
            .collect();
        results.push(PackageManagerInfo { name: "cargo".to_string(), packages });
    }

    // Chocolatey
    if let Some(pkgs) = run_cmd_lines("choco", &["list", "--local-only", "--limit-output"]).await {
        let packages = pkgs.into_iter()
            .filter_map(|l| l.split_once('|').map(|(n, _)| n.to_string()))
            .collect();
        results.push(PackageManagerInfo { name: "chocolatey".to_string(), packages });
    }

    // Scoop
    if let Some(pkgs) = run_cmd_lines("scoop", &["list"]).await {
        let packages = pkgs.into_iter()
            .skip(2) // header lines
            .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
            .filter(|s| !s.is_empty() && !s.starts_with('-'))
            .collect();
        results.push(PackageManagerInfo { name: "scoop".to_string(), packages });
    }

    // Homebrew (macOS/Linux)
    #[cfg(not(target_os = "windows"))]
    if let Some(pkgs) = run_cmd_lines("brew", &["list", "--formula"]).await {
        results.push(PackageManagerInfo { name: "homebrew".to_string(), packages: pkgs });
    }

    results
}

// ── 8. AI Tools ───────────────────────────────────────────────────────────────

async fn scan_ai_tools() -> Vec<AiToolInfo> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut tools = Vec::new();

    // Ollama
    let ollama_list = run_cmd_output("ollama", &["list"]).await;
    let ollama_detected = ollama_list.is_some();
    let ollama_details = ollama_list.unwrap_or_default();
    let ollama_models: Vec<String> = ollama_details.lines()
        .skip(1) // header
        .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
        .collect();
    tools.push(AiToolInfo {
        name: "Ollama".to_string(),
        detected: ollama_detected,
        details: if ollama_models.is_empty() { String::new() } else { ollama_models.join(", ") },
    });

    // HuggingFace cache
    let hf_cache = home.join(".cache").join("huggingface");
    let hf_detected = hf_cache.exists();
    let hf_models = if hf_detected {
        let hub = hf_cache.join("hub");
        list_dir_names(&hub).into_iter().take(20).collect::<Vec<_>>().join(", ")
    } else {
        String::new()
    };
    tools.push(AiToolInfo {
        name: "HuggingFace".to_string(),
        detected: hf_detected,
        details: hf_models,
    });

    // Claude Code
    let claude_dir = home.join(".claude");
    let claude_detected = claude_dir.exists();
    let claude_details = if claude_detected {
        let projects_dir = claude_dir.join("projects");
        if projects_dir.exists() {
            format!("{} project(s)", list_dir_names(&projects_dir).len())
        } else {
            "config present".to_string()
        }
    } else {
        String::new()
    };
    tools.push(AiToolInfo {
        name: "Claude Code".to_string(),
        detected: claude_detected,
        details: claude_details,
    });

    // LM Studio
    let lm_studio = home.join(".lmstudio");
    let lm_detected = lm_studio.exists() || {
        #[cfg(target_os = "windows")]
        { dirs::data_dir().map(|d| d.join("LM Studio").exists()).unwrap_or(false) }
        #[cfg(not(target_os = "windows"))]
        { false }
    };
    tools.push(AiToolInfo {
        name: "LM Studio".to_string(),
        detected: lm_detected,
        details: String::new(),
    });

    // Aider
    let aider_conf = home.join(".aider.conf.yml");
    let aider_detected = aider_conf.exists()
        || run_cmd_output("aider", &["--version"]).await.is_some();
    tools.push(AiToolInfo {
        name: "Aider".to_string(),
        detected: aider_detected,
        details: String::new(),
    });

    // Cursor IDE (AI-first)
    let cursor_detected = {
        #[cfg(target_os = "windows")]
        { dirs::data_dir().map(|d| d.join("Cursor").exists()).unwrap_or(false) }
        #[cfg(target_os = "macos")]
        { home.join("Library/Application Support/Cursor").exists() }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        { home.join(".config/Cursor").exists() }
    };
    tools.push(AiToolInfo {
        name: "Cursor".to_string(),
        detected: cursor_detected,
        details: String::new(),
    });

    tools
}

// ── 9. System Info ────────────────────────────────────────────────────────────

async fn scan_system_info() -> SystemInfo {
    let mut info = SystemInfo::default();

    #[cfg(target_os = "windows")]
    {
        // CPU via WMIC
        if let Some(cpu) = run_cmd_output("wmic", &["cpu", "get", "Name", "/value"]).await {
            for line in cpu.lines() {
                if let Some(val) = line.strip_prefix("Name=") {
                    info.cpu = val.trim().to_string();
                    break;
                }
            }
        }

        // GPU via WMIC
        if let Some(gpu) = run_cmd_output("wmic", &["path", "win32_VideoController", "get", "Name", "/value"]).await {
            let gpus: Vec<String> = gpu.lines()
                .filter_map(|l| l.strip_prefix("Name=").map(|v| v.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect();
            info.gpu = gpus.join(", ");
        }

        // RAM via WMIC
        if let Some(ram_out) = run_cmd_output("wmic", &["ComputerSystem", "get", "TotalPhysicalMemory", "/value"]).await {
            for line in ram_out.lines() {
                if let Some(val) = line.strip_prefix("TotalPhysicalMemory=") {
                    if let Ok(bytes) = val.trim().parse::<u64>() {
                        info.total_ram_mb = bytes / (1024 * 1024);
                    }
                }
            }
        }

        // Disk via WMIC
        if let Some(disk_out) = run_cmd_output("wmic", &["logicaldisk", "where", "DriveType=3", "get", "Size", "/value"]).await {
            let total_bytes: u64 = disk_out.lines()
                .filter_map(|l| l.strip_prefix("Size="))
                .filter_map(|v| v.trim().parse::<u64>().ok())
                .sum();
            info.total_disk_gb = total_bytes / (1024 * 1024 * 1024);
        }

        // OS version
        if let Some(os_out) = run_cmd_output("wmic", &["os", "get", "Caption,Version", "/value"]).await {
            let mut caption = String::new();
            let mut version = String::new();
            for line in os_out.lines() {
                if let Some(v) = line.strip_prefix("Caption=") { caption = v.trim().to_string(); }
                if let Some(v) = line.strip_prefix("Version=") { version = v.trim().to_string(); }
            }
            info.os_version = if caption.is_empty() { version } else { format!("{} ({})", caption, version) };
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(cpu) = run_cmd_output("sysctl", &["-n", "machdep.cpu.brand_string"]).await {
            info.cpu = cpu.trim().to_string();
        }
        if let Some(ram) = run_cmd_output("sysctl", &["-n", "hw.memsize"]).await {
            if let Ok(bytes) = ram.trim().parse::<u64>() {
                info.total_ram_mb = bytes / (1024 * 1024);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
            for line in cpuinfo.lines() {
                if line.starts_with("model name") {
                    if let Some(val) = line.splitn(2, ':').nth(1) {
                        info.cpu = val.trim().to_string();
                        break;
                    }
                }
            }
        }
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
            for line in meminfo.lines() {
                if line.starts_with("MemTotal:") {
                    if let Some(val) = line.split_whitespace().nth(1) {
                        if let Ok(kb) = val.parse::<u64>() {
                            info.total_ram_mb = kb / 1024;
                        }
                    }
                }
            }
        }
    }

    info
}

// ── 10. SSH Keys ──────────────────────────────────────────────────────────────

fn scan_ssh_keys() -> Vec<SshKey> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let ssh_dir = home.join(".ssh");
    let Ok(entries) = std::fs::read_dir(&ssh_dir) else { return vec![] };

    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|x| x == "pub").unwrap_or(false)
        })
        .filter_map(|e| {
            let content = std::fs::read_to_string(e.path()).ok()?;
            let parts: Vec<&str> = content.trim().splitn(3, ' ').collect();
            let key_type = parts.first().copied().unwrap_or("unknown").to_string();
            let comment = parts.get(2).map(|s| s.to_string());
            Some(SshKey {
                filename: e.file_name().to_string_lossy().to_string(),
                key_type,
                comment,
            })
        })
        .collect()
}

// ── 11. Docker ────────────────────────────────────────────────────────────────

async fn scan_docker() -> DockerInfo {
    let mut info = DockerInfo::default();

    // docker ps
    if let Some(ps) = run_cmd_output("docker", &["ps", "--format", "{{.Names}} ({{.Image}})"]).await {
        info.running_containers = ps.lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();
    }

    // docker images
    if let Some(imgs) = run_cmd_output("docker", &["images", "--format", "{{.Repository}}:{{.Tag}}"]).await {
        info.images = imgs.lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .take(50)
            .collect();
    }

    info
}

// ── 12. Browser Bookmarks ─────────────────────────────────────────────────────

fn scan_browser_bookmarks() -> Vec<BrowserBookmarks> {
    let mut results = Vec::new();

    // Chrome
    let chrome_path = {
        #[cfg(target_os = "windows")]
        { dirs::data_local_dir().map(|d| d.join("Google").join("Chrome").join("User Data").join("Default").join("Bookmarks")) }
        #[cfg(target_os = "macos")]
        { dirs::home_dir().map(|h| h.join("Library/Application Support/Google/Chrome/Default/Bookmarks")) }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        { dirs::home_dir().map(|h| h.join(".config/google-chrome/Default/Bookmarks")) }
    };

    if let Some(path) = chrome_path {
        if let Some(bm) = read_chromium_bookmarks(&path, "Chrome") {
            results.push(bm);
        }
    }

    // Edge (Chromium-based)
    let edge_path = {
        #[cfg(target_os = "windows")]
        { dirs::data_local_dir().map(|d| d.join("Microsoft").join("Edge").join("User Data").join("Default").join("Bookmarks")) }
        #[cfg(not(target_os = "windows"))]
        { None::<PathBuf> }
    };

    if let Some(path) = edge_path {
        if let Some(bm) = read_chromium_bookmarks(&path, "Edge") {
            results.push(bm);
        }
    }

    // Brave
    let brave_path = {
        #[cfg(target_os = "windows")]
        { dirs::data_local_dir().map(|d| d.join("BraveSoftware").join("Brave-Browser").join("User Data").join("Default").join("Bookmarks")) }
        #[cfg(not(target_os = "windows"))]
        { None::<PathBuf> }
    };

    if let Some(path) = brave_path {
        if let Some(bm) = read_chromium_bookmarks(&path, "Brave") {
            results.push(bm);
        }
    }

    results
}

fn read_chromium_bookmarks(path: &Path, browser: &str) -> Option<BrowserBookmarks> {
    let content = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let mut urls: Vec<String> = Vec::new();
    collect_bookmark_urls(&json, &mut urls);

    let mut domains: std::collections::HashSet<String> = std::collections::HashSet::new();
    for url in &urls {
        if let Some(domain) = extract_domain(url) {
            domains.insert(domain);
        }
    }

    let mut domain_list: Vec<String> = domains.into_iter().collect();
    domain_list.sort();
    domain_list.truncate(50);

    Some(BrowserBookmarks {
        browser: browser.to_string(),
        count: urls.len(),
        domains: domain_list,
    })
}

fn collect_bookmark_urls(value: &serde_json::Value, urls: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let (Some(serde_json::Value::String(t)), Some(serde_json::Value::String(u))) =
                (map.get("type"), map.get("url"))
            {
                if t == "url" {
                    urls.push(u.clone());
                }
            }
            for v in map.values() {
                collect_bookmark_urls(v, urls);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                collect_bookmark_urls(v, urls);
            }
        }
        _ => {}
    }
}

fn extract_domain(url: &str) -> Option<String> {
    let stripped = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");
    let domain = stripped.split('/').next()?.split('?').next()?.split(':').next()?;
    if domain.contains('.') {
        Some(domain.to_lowercase())
    } else {
        None
    }
}

// ── Subprocess helpers ────────────────────────────────────────────────────────

async fn run_cmd_output(program: &str, args: &[&str]) -> Option<String> {
    let out = crate::cmd_util::silent_tokio_cmd(program)
        .args(args)
        .output()
        .await
        .ok()?;
    if out.status.success() || !out.stdout.is_empty() {
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    }
}

async fn run_cmd_lines(program: &str, args: &[&str]) -> Option<Vec<String>> {
    let out = run_cmd_output(program, args).await?;
    Some(out.lines().map(|l| l.to_string()).collect())
}

// ── Knowledge graph seeding ───────────────────────────────────────────────────

fn seed_knowledge_graph(results: &DeepScanResults) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("deep_scan: could not open DB for graph seeding: {}", e);
            return;
        }
    };

    // Seed installed apps as tool nodes
    for app in results.installed_apps.iter().take(100) {
        let id = format!("tool:{}", app.name.to_lowercase().replace(' ', "-").replace(['/', '\\', '(', ')'], ""));
        let summary = format!(
            "Installed app: {}{}{}",
            app.name,
            app.version.as_deref().map(|v| format!(", v{}", v)).unwrap_or_default(),
            app.publisher.as_deref().map(|p| format!(", by {}", p)).unwrap_or_default(),
        );
        let _ = crate::db::brain_upsert_node(&conn, &id, &app.name, "tool", &summary);
    }

    // Seed git repos as project nodes
    for repo in &results.git_repos {
        let name = std::path::Path::new(&repo.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| repo.path.clone());
        let id = format!("project:{}", name.to_lowercase().replace(' ', "-"));
        let lang = repo.primary_language.as_deref().unwrap_or("unknown");
        let remote = repo.remote_url.as_deref().unwrap_or("local");
        let summary = format!("Git project at {} ({}), remote: {}", repo.path, lang, remote);
        let _ = crate::db::brain_upsert_node(&conn, &id, &name, "project", &summary);
    }

    // Seed IDEs as tool nodes
    for ide in &results.ides {
        let id = format!("tool:{}", ide.name.to_lowercase().replace(' ', "-").replace('/', "-"));
        let summary = format!("IDE: {}", ide.name);
        let _ = crate::db::brain_upsert_node(&conn, &id, &ide.name, "tool", &summary);
    }

    // Seed AI tools
    for tool in results.ai_tools.iter().filter(|t| t.detected) {
        let id = format!("tool:ai-{}", tool.name.to_lowercase().replace(' ', "-"));
        let summary = format!("AI tool: {}{}", tool.name,
            if tool.details.is_empty() { String::new() } else { format!(". {}", tool.details) });
        let _ = crate::db::brain_upsert_node(&conn, &id, &tool.name, "tool", &summary);
    }

    // Seed default browser
    if let Some(ref browser) = results.default_browser {
        let id = format!("tool:browser-{}", browser.to_lowercase().replace(' ', "-"));
        let _ = crate::db::brain_upsert_node(&conn, &id, browser, "tool", &format!("Default browser: {}", browser));
    }

    log::info!("deep_scan: knowledge graph seeding complete");
}

// ── Summary builder ───────────────────────────────────────────────────────────

fn build_summary(results: &DeepScanResults) -> String {
    let mut lines = Vec::new();

    lines.push("=== BLADE Deep System Scan ===".to_string());
    lines.push(format!("Scanned: {}", chrono::DateTime::from_timestamp(results.scanned_at / 1000, 0)
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "unknown".to_string())));

    lines.push(String::new());
    lines.push(format!("System: {}", results.system_info.os_version));
    if !results.system_info.cpu.is_empty() {
        lines.push(format!("CPU: {}", results.system_info.cpu));
    }
    if !results.system_info.gpu.is_empty() {
        lines.push(format!("GPU: {}", results.system_info.gpu));
    }
    if results.system_info.total_ram_mb > 0 {
        lines.push(format!("RAM: {} GB", results.system_info.total_ram_mb / 1024));
    }
    if results.system_info.total_disk_gb > 0 {
        lines.push(format!("Disk: {} GB", results.system_info.total_disk_gb));
    }

    lines.push(String::new());
    lines.push(format!("Default Browser: {}", results.default_browser.as_deref().unwrap_or("unknown")));

    lines.push(String::new());
    lines.push(format!("Installed Apps: {} detected", results.installed_apps.len()));

    lines.push(String::new());
    lines.push(format!("IDEs ({}):", results.ides.len()));
    for ide in &results.ides {
        lines.push(format!("  - {} ({} extensions)", ide.name, ide.extensions.len()));
    }

    lines.push(String::new());
    lines.push(format!("Git Repos ({}):", results.git_repos.len()));
    for repo in results.git_repos.iter().take(15) {
        let name = std::path::Path::new(&repo.path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| repo.path.clone());
        let lang = repo.primary_language.as_deref().unwrap_or("?");
        lines.push(format!("  - {} [{}]", name, lang));
    }
    if results.git_repos.len() > 15 {
        lines.push(format!("  ... and {} more", results.git_repos.len() - 15));
    }

    lines.push(String::new());
    lines.push("AI Tools:".to_string());
    for tool in &results.ai_tools {
        let status = if tool.detected { "yes" } else { "no" };
        let detail = if tool.details.is_empty() { String::new() } else { format!(" — {}", tool.details) };
        lines.push(format!("  - {}: {}{}", tool.name, status, detail));
    }

    lines.push(String::new());
    lines.push("Package Managers:".to_string());
    for pm in &results.package_managers {
        lines.push(format!("  - {} ({} packages)", pm.name, pm.packages.len()));
    }

    if !results.wsl_distros.is_empty() {
        lines.push(String::new());
        lines.push("WSL Distros:".to_string());
        for d in &results.wsl_distros {
            lines.push(format!("  - {} ({}) v{}", d.name, d.state, d.version));
        }
    }

    if !results.ssh_keys.is_empty() {
        lines.push(String::new());
        lines.push("SSH Keys:".to_string());
        for k in &results.ssh_keys {
            lines.push(format!("  - {} ({})", k.filename, k.key_type));
        }
    }

    if !results.docker.running_containers.is_empty() || !results.docker.images.is_empty() {
        lines.push(String::new());
        lines.push(format!("Docker: {} running, {} images",
            results.docker.running_containers.len(),
            results.docker.images.len()));
    }

    if !results.browser_bookmarks.is_empty() {
        lines.push(String::new());
        lines.push("Browser Bookmarks:".to_string());
        for bm in &results.browser_bookmarks {
            lines.push(format!("  - {} ({} bookmarks)", bm.browser, bm.count));
        }
    }

    if !results.shell_history.is_empty() {
        lines.push(String::new());
        lines.push("Shell History (top commands):".to_string());
        for hist in &results.shell_history {
            let cmds: Vec<String> = hist.top_commands.iter().take(5)
                .map(|(c, n)| format!("{}({})", c, n))
                .collect();
            lines.push(format!("  - {}: {}", hist.shell, cmds.join(", ")));
        }
    }

    lines.join("\n")
}

// ── Public API for brain.rs ───────────────────────────────────────────────────

/// Return a compact 3-5 line identity block for injection into the system prompt.
/// Reads the last saved scan result from disk; returns None if no scan has been run.
/// This is intentionally terse — it goes into EVERY prompt, so every byte counts.
pub fn load_scan_summary() -> Option<String> {
    let results = load_results()?;

    let mut lines: Vec<String> = Vec::with_capacity(6);

    // Line 1: OS + hardware
    let hw = if results.system_info.total_ram_mb > 0 {
        format!(
            "{}{}{}",
            results.system_info.os_version,
            if !results.system_info.cpu.is_empty() {
                format!(", {}", results.system_info.cpu)
            } else {
                String::new()
            },
            if results.system_info.total_ram_mb > 0 {
                format!(", {} GB RAM", results.system_info.total_ram_mb / 1024)
            } else {
                String::new()
            },
        )
    } else {
        results.system_info.os_version.clone()
    };
    if !hw.is_empty() {
        lines.push(format!("Machine: {}", hw));
    }

    // Line 2: Browser
    if let Some(ref browser) = results.default_browser {
        lines.push(format!("Default browser: {}", browser));
    }

    // Line 3: IDEs + top languages
    if !results.ides.is_empty() {
        let ide_names: Vec<&str> = results.ides.iter().map(|i| i.name.as_str()).collect();
        lines.push(format!("IDEs: {}", ide_names.join(", ")));
    }

    // Line 4: Coding languages (from git repos)
    {
        let mut lang_totals: HashMap<String, usize> = HashMap::new();
        for repo in &results.git_repos {
            for (lang, count) in &repo.language_counts {
                *lang_totals.entry(lang.clone()).or_insert(0) += count;
            }
        }
        if !lang_totals.is_empty() {
            let mut langs: Vec<(String, usize)> = lang_totals.into_iter().collect();
            langs.sort_by(|a, b| b.1.cmp(&a.1));
            let top: Vec<&str> = langs.iter().take(5).map(|(l, _)| l.as_str()).collect();
            lines.push(format!("Primary languages: {}", top.join(", ")));
        }
    }

    // Line 5: Git repos (just count + names, max 5)
    if !results.git_repos.is_empty() {
        let repo_names: Vec<String> = results.git_repos.iter().take(5).map(|r| {
            std::path::Path::new(&r.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| r.path.clone())
        }).collect();
        let suffix = if results.git_repos.len() > 5 {
            format!(" (+{} more)", results.git_repos.len() - 5)
        } else {
            String::new()
        };
        lines.push(format!("Git repos: {}{}", repo_names.join(", "), suffix));
    }

    // Line 6: Active AI tools
    {
        let active_ai: Vec<&str> = results.ai_tools.iter()
            .filter(|t| t.detected)
            .map(|t| t.name.as_str())
            .collect();
        if !active_ai.is_empty() {
            lines.push(format!("AI tools: {}", active_ai.join(", ")));
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Start a full deep system scan. Emits `deep_scan_progress` events.
/// Returns the results as JSON when complete.
#[tauri::command]
pub async fn deep_scan_start(app: tauri::AppHandle) -> Result<DeepScanResults, String> {

    let emit = |phase: &str, found: usize| {
        let _ = app.emit_to("main", "deep_scan_progress", serde_json::json!({
            "phase": phase,
            "found": found,
        }));
    };

    emit("starting", 0);

    // Run all 12 scanners in parallel.
    // spawn_blocking tasks return JoinResult<T> — unwrap_or_default() absorbs panics.
    // Async tasks are wrapped in tokio::spawn so a panic in one doesn't abort the join.
    // Each scanner is fully independent: failure returns an empty/default value, never
    // crashes the whole scan.
    let (
        installed_apps,
        default_browser,
        ides,
        git_repos,
        shell_history,
        wsl_distros,
        package_managers,
        ai_tools,
        system_info,
        ssh_keys,
        docker,
        browser_bookmarks,
    ) = tokio::join!(
        tokio::task::spawn_blocking(scan_installed_apps),
        tokio::task::spawn_blocking(scan_default_browser),
        tokio::task::spawn_blocking(scan_ides),
        tokio::task::spawn_blocking(scan_git_repos),
        tokio::task::spawn_blocking(scan_shell_history),
        async { tokio::spawn(scan_wsl_distros()).await.unwrap_or_default() },
        async { tokio::spawn(scan_package_managers()).await.unwrap_or_default() },
        async { tokio::spawn(scan_ai_tools()).await.unwrap_or_default() },
        async { tokio::spawn(scan_system_info()).await.unwrap_or_default() },
        tokio::task::spawn_blocking(scan_ssh_keys),
        async { tokio::spawn(scan_docker()).await.unwrap_or_default() },
        tokio::task::spawn_blocking(scan_browser_bookmarks),
    );

    // JoinHandle results from spawn_blocking: unwrap_or_default absorbs panics/cancellations.
    let installed_apps = installed_apps.unwrap_or_default();
    let default_browser = default_browser.unwrap_or_default();
    let ides = ides.unwrap_or_default();
    let git_repos = git_repos.unwrap_or_default();
    let shell_history = shell_history.unwrap_or_default();
    let ssh_keys = ssh_keys.unwrap_or_default();
    let browser_bookmarks = browser_bookmarks.unwrap_or_default();

    emit("installed_apps", installed_apps.len());
    emit("git_repos", git_repos.len());
    emit("ides", ides.len());
    emit("ai_tools", ai_tools.iter().filter(|t| t.detected).count());
    emit("wsl_distros", wsl_distros.len());
    emit("ssh_keys", ssh_keys.len());
    emit("package_managers", package_managers.len());
    emit("docker", docker.running_containers.len());
    emit("bookmarks", browser_bookmarks.iter().map(|b| b.count).sum());

    let results = DeepScanResults {
        scanned_at: chrono::Utc::now().timestamp_millis(),
        installed_apps,
        default_browser,
        ides,
        git_repos,
        shell_history,
        wsl_distros,
        package_managers,
        ai_tools,
        system_info,
        ssh_keys,
        docker,
        browser_bookmarks,
    };

    // Persist results to disk
    if let Err(e) = save_results(&results) {
        log::warn!("deep_scan: failed to save results: {}", e);
    }

    // Record scan timestamp in config so the UI can show "last scanned X days ago"
    {
        let mut cfg = crate::config::load_config();
        cfg.last_deep_scan = chrono::Utc::now().timestamp();
        if let Err(e) = crate::config::save_config(&cfg) {
            log::warn!("deep_scan: failed to update last_deep_scan in config: {}", e);
        }
    }

    // Seed knowledge graph (non-blocking — runs after we return results)
    let results_clone = results.clone();
    tokio::task::spawn_blocking(move || seed_knowledge_graph(&results_clone));

    emit("complete", 0);

    Ok(results)
}

/// Return the last saved scan results without re-scanning.
#[tauri::command]
pub async fn deep_scan_results() -> Result<Option<DeepScanResults>, String> {
    Ok(load_results())
}

/// Return a human-readable summary of the last scan.
#[tauri::command]
pub async fn deep_scan_summary() -> Result<String, String> {
    match load_results() {
        Some(results) => Ok(build_summary(&results)),
        None => Ok("No scan results found. Run deep_scan_start first.".to_string()),
    }
}
