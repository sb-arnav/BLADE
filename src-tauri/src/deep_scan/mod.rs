#![allow(dead_code)]

//! Deep System Discovery — Smart Lead-Following Scanner (Phase 12).
//!
//! Replaces the old tokio::join!-all-parallel approach with a priority
//! VecDeque<Lead> draining Hot → Warm → Cold. The seed phase enqueues
//! Hot leads from MRU, AI session dirs, shell history, and git HEAD freshness.
//! Each lead is processed by a dedicated scanner; follow-up leads are re-enqueued.
//!
//! The three existing Tauri commands (deep_scan_start, deep_scan_results,
//! deep_scan_summary) keep their original signatures (D-66).

pub mod leads;
pub mod queue;
pub mod scanners;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Emitter;

pub use leads::{
    DeepScanResults, InstalledApp, GitRepo, IdeInfo, ShellHistory, WslDistro,
    PackageManagerInfo, AiToolInfo, SystemInfo, SshKey, DockerInfo, BrowserBookmarks,
    AccountRow, MruFileRow, RepoRow,
    Lead, LeadKind, Tier,
};
// Re-export for downstream consumers (Plan 12-03, profile overlay)
#[allow(unused_imports)]
pub use leads::{RhythmSignal, LlmEnrichments};
pub use queue::{LeadQueue, SCAN_CANCEL};

// ── Row batch type used by process_lead ──────────────────────────────────────

struct RowBatch {
    repo_rows: Vec<RepoRow>,
    accounts: Vec<AccountRow>,
    mru_files: Vec<MruFileRow>,
}

impl RowBatch {
    fn empty() -> Self {
        Self { repo_rows: vec![], accounts: vec![], mru_files: vec![] }
    }
}

// ── Storage helpers (preserved verbatim from old deep_scan.rs) ───────────────

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

// ── Emit helper ───────────────────────────────────────────────────────────────

/// Build the D-64 extended progress payload. Pure function — testable without AppHandle.
pub(crate) fn build_progress_payload(
    phase: &str,
    found: usize,
    lead_kind: &str,
    tier: Option<&str>,
    message: Option<&str>,
    queue_depth: Option<usize>,
    elapsed_ms: u64,
) -> serde_json::Value {
    serde_json::json!({
        "phase": phase,
        "found": found,
        "lead_kind": lead_kind,
        "tier": tier.unwrap_or(""),
        "message": message.unwrap_or(""),
        "queue_depth": queue_depth.unwrap_or(0),
        "elapsed_ms": elapsed_ms,
    })
}

fn emit_progress(
    app: &tauri::AppHandle,
    phase: &str,
    found: usize,
    lead_kind: Option<&str>,
    tier: Option<&str>,
    message: Option<&str>,
    queue_depth: Option<usize>,
    _initial_queue_depth: usize,
    elapsed_ms: u64,
) {
    let payload = build_progress_payload(
        phase,
        found,
        lead_kind.unwrap_or(""),
        tier,
        message,
        queue_depth,
        elapsed_ms,
    );
    let _ = app.emit_to("main", "deep_scan_progress", payload);
}

// ── found_count helper ────────────────────────────────────────────────────────

fn found_count(results: &DeepScanResults) -> usize {
    results.git_repos.len() + results.repo_rows.len() + results.mru_files.len()
}

// ── merge_rows helper ─────────────────────────────────────────────────────────

fn merge_rows(results: &mut DeepScanResults, batch: RowBatch) {
    results.repo_rows.extend(batch.repo_rows);
    results.accounts.extend(batch.accounts);
    results.mru_files.extend(batch.mru_files);
}

// ── Seed phase ────────────────────────────────────────────────────────────────

/// Enqueue initial Hot/Warm leads from MRU dirs, AI session dirs, shell history,
/// and git HEAD freshness. Depth-1 walk only — full walks happen via FsRepoWalk leads.
fn seed_queue(lq: &mut LeadQueue, _app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    // 1. Filesystem MRU: candidate seed dirs modified within 7d → Hot, 8-30d → Warm
    let seed_dirs = [
        home.join("Projects"),
        home.join("repos"),
        home.join("src"),
        home.join("code"),
        home.join("Documents"),
        home.join("Desktop"),
        home.clone(),
    ];

    let now = std::time::SystemTime::now();
    for dir in &seed_dirs {
        if !dir.is_dir() { continue; }
        // Skip /mnt/c (T-12-02)
        if dir.to_string_lossy().starts_with("/mnt/c") { continue; }
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            if SCAN_CANCEL.load(Ordering::SeqCst) { return; }
            let path_str = path.to_string_lossy().to_string();
            if path_str.starts_with("/mnt/c") { continue; }

            let mtime_age_days = entry.metadata()
                .and_then(|m| m.modified())
                .and_then(|mtime| now.duration_since(mtime).map_err(|e| std::io::Error::other(e)))
                .map(|d| d.as_secs() / 86400)
                .unwrap_or(u64::MAX);

            let tier = if mtime_age_days <= 7 {
                Tier::Hot
            } else if mtime_age_days <= 30 {
                Tier::Warm
            } else {
                continue; // too old for seeding
            };

            let pb = PathBuf::from(&path_str);
            if lq.is_visited(&pb) { continue; }
            lq.mark_visited(pb);
            lq.enqueue(Lead::new(
                LeadKind::FsRepoWalk,
                tier,
                format!("seed_dir:{}", crate::safe_slice(&path_str, 80)),
                serde_json::json!({ "path": path_str }),
            ));
        }
    }

    // 2. AI session dirs → Hot ProjectRootHint leads
    let ai_dirs = [
        home.join(".claude").join("projects"),
        home.join(".codex").join("sessions"),
        home.join(".cursor"),
        home.join(".continue"),
        home.join(".aider"),
    ];
    for dir in &ai_dirs {
        if !dir.is_dir() { continue; }
        let dir_str = dir.to_string_lossy().to_string();
        let pb = dir.clone();
        if lq.is_visited(&pb) { continue; }
        lq.mark_visited(pb);
        lq.enqueue(Lead::new(
            LeadKind::ProjectRootHint,
            Tier::Hot,
            format!("ai_session:{}", crate::safe_slice(&dir_str, 80)),
            serde_json::json!({ "path": dir_str }),
        ));
    }

    // 3. Shell history: extract `cd <path>` targets
    let history_files = [
        (home.join(".zsh_history"), "zsh"),
        (home.join(".bash_history"), "bash"),
    ];
    for (hist_path, shell) in &history_files {
        let Ok(content) = std::fs::read_to_string(hist_path) else { continue };
        let lines: Vec<&str> = content.lines().rev().take(500).collect();
        for line in lines {
            let cmd = if line.starts_with(": ") {
                line.splitn(3, ';').nth(1).unwrap_or(line)
            } else {
                line
            }.trim();
            if let Some(rest) = cmd.strip_prefix("cd ") {
                let raw = rest.trim().trim_matches('"').trim_matches('\'');
                if raw.is_empty() || raw == "~" || raw == "-" { continue; }
                let expanded = if raw.starts_with('~') {
                    home.join(&raw[2..])
                } else {
                    PathBuf::from(raw)
                };
                if !expanded.is_dir() { continue; }
                let pb = expanded.clone();
                if lq.is_visited(&pb) { continue; }
                lq.mark_visited(pb);
                let path_str = expanded.to_string_lossy().to_string();
                lq.enqueue(Lead::new(
                    LeadKind::ShellHistoryScan,
                    Tier::Warm,
                    format!("shell_history:{}", shell),
                    serde_json::json!({ "path": path_str }),
                ));
            }
        }
    }

    // 4. Git HEAD freshness: walk candidate seed dirs for .git/HEAD files
    for dir in &seed_dirs {
        if !dir.is_dir() { continue; }
        if dir.to_string_lossy().starts_with("/mnt/c") { continue; }
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            let head_file = path.join(".git").join("HEAD");
            if !head_file.exists() { continue; }
            let head_age_days = head_file.metadata()
                .and_then(|m| m.modified())
                .and_then(|mtime| now.duration_since(mtime).map_err(|e| std::io::Error::other(e)))
                .map(|d| d.as_secs() / 86400)
                .unwrap_or(u64::MAX);
            let tier = if head_age_days <= 7 {
                Tier::Hot
            } else if head_age_days <= 30 {
                Tier::Warm
            } else {
                Tier::Cold
            };
            let path_str = path.to_string_lossy().to_string();
            let pb = PathBuf::from(&path_str);
            if lq.is_visited(&pb) { continue; }
            lq.mark_visited(pb);
            lq.enqueue(Lead::new(
                LeadKind::FsRepoWalk,
                tier,
                format!("git_head_freshness:{}", crate::safe_slice(&path_str, 80)),
                serde_json::json!({ "path": path_str }),
            ));
        }
    }
}

// ── Lead processor ────────────────────────────────────────────────────────────

/// Process a single lead. Returns (RowBatch, follow-up leads, human-readable message).
fn process_lead(lead: &Lead, _app: &tauri::AppHandle) -> (RowBatch, Vec<Lead>, String) {
    match lead.kind {
        LeadKind::FsRepoWalk | LeadKind::ProjectRootHint => {
            let (rows, follow_ups) = scanners::fs_repos::run(lead);
            let msg = format!("fs_repos: found {} repos", rows.len());
            (RowBatch { repo_rows: rows, accounts: vec![], mru_files: vec![] }, follow_ups, msg)
        }
        LeadKind::GitRemoteRead => {
            let (repos, accounts, follow_ups) = scanners::git_remotes::run(lead);
            let msg = format!("git_remotes: {} repos, {} accounts", repos.len(), accounts.len());
            (RowBatch { repo_rows: repos, accounts, mru_files: vec![] }, follow_ups, msg)
        }
        LeadKind::MruWalk => {
            let files = scanners::mru::run(lead, 30);
            let msg = format!("mru: {} files", files.len());
            (RowBatch { repo_rows: vec![], accounts: vec![], mru_files: files }, vec![], msg)
        }
        LeadKind::ShellHistoryScan => {
            // Shell history seed lead — treat as FsRepoWalk on the path
            let (rows, follow_ups) = scanners::fs_repos::run(lead);
            let msg = format!("shell_history lead: found {} repos", rows.len());
            (RowBatch { repo_rows: rows, accounts: vec![], mru_files: vec![] }, follow_ups, msg)
        }
        _ => {
            // Plan 12-02 adds remaining scanners
            (RowBatch::empty(), vec![], format!("{}: stub (plan 12-02)", lead.kind_str()))
        }
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

/// Start a full deep system scan using the priority lead queue.
/// Emits `deep_scan_progress` events with D-64 extended payload.
/// Returns the accumulated results as JSON when complete.
#[tauri::command]
pub async fn deep_scan_start(app: tauri::AppHandle) -> Result<DeepScanResults, String> {
    // Reset cancel flag from any prior cancelled scan
    LeadQueue::reset_cancel();

    let scan_start = std::time::Instant::now();
    let mut results = DeepScanResults::default();
    results.scanned_at = chrono::Utc::now().timestamp_millis();

    let mut lq = LeadQueue::new();
    // Seed phase: enqueue Hot/Warm leads
    seed_queue(&mut lq, &app);

    let initial_queue_depth = lq.len();
    emit_progress(&app, "starting", 0, None, None, None, Some(initial_queue_depth), initial_queue_depth, 0);

    // Drain loop: Hot → Warm → Cold
    while let Some(lead) = lq.dequeue() {
        if LeadQueue::is_cancelled() { break; }

        let tier_str = match lead.priority_tier {
            Tier::Hot => "hot",
            Tier::Warm => "warm",
            Tier::Cold => "cold",
        };
        let elapsed_ms = scan_start.elapsed().as_millis() as u64;

        let (batch, follow_ups, msg) = process_lead(&lead, &app);

        emit_progress(
            &app,
            lead.kind_str(),
            found_count(&results),
            Some(lead.kind_str()),
            Some(tier_str),
            Some(&msg),
            Some(lq.len()),
            initial_queue_depth,
            elapsed_ms,
        );

        merge_rows(&mut results, batch);

        // Enqueue follow-up leads (dedup via visited set)
        for fl in follow_ups {
            if LeadQueue::is_cancelled() { break; }
            let path_hint = fl.path_hint();
            if !lq.is_visited(&path_hint) {
                lq.mark_visited(path_hint);
                lq.enqueue(fl);
            }
        }
    }

    // Run the legacy parallel scanners for backward compat (installed_apps, ides, etc.)
    let legacy = run_legacy_scanners().await;
    results.installed_apps = legacy.installed_apps;
    results.default_browser = legacy.default_browser;
    results.ides = legacy.ides;
    results.git_repos = legacy.git_repos;
    results.shell_history = legacy.shell_history;
    results.wsl_distros = legacy.wsl_distros;
    results.package_managers = legacy.package_managers;
    results.ai_tools = legacy.ai_tools;
    results.system_info = legacy.system_info;
    results.ssh_keys = legacy.ssh_keys;
    results.docker = legacy.docker;
    results.browser_bookmarks = legacy.browser_bookmarks;

    emit_progress(
        &app,
        "complete",
        found_count(&results),
        None, None, None,
        Some(0),
        initial_queue_depth,
        scan_start.elapsed().as_millis() as u64,
    );

    if let Err(e) = save_results(&results) {
        log::warn!("deep_scan: failed to save results: {}", e);
    }

    // Update config last_deep_scan timestamp
    {
        let mut cfg = crate::config::load_config();
        cfg.last_deep_scan = chrono::Utc::now().timestamp();
        if let Err(e) = crate::config::save_config(&cfg) {
            log::warn!("deep_scan: failed to update last_deep_scan in config: {}", e);
        }
    }

    // Seed knowledge graph (non-blocking)
    let rc = results.clone();
    tokio::task::spawn_blocking(move || seed_knowledge_graph(&rc));

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

// ── Legacy parallel scanner runner (preserves backward-compat data) ──────────

struct LegacyScanResults {
    installed_apps: Vec<InstalledApp>,
    default_browser: Option<String>,
    ides: Vec<IdeInfo>,
    git_repos: Vec<GitRepo>,
    shell_history: Vec<ShellHistory>,
    wsl_distros: Vec<WslDistro>,
    package_managers: Vec<PackageManagerInfo>,
    ai_tools: Vec<AiToolInfo>,
    system_info: SystemInfo,
    ssh_keys: Vec<SshKey>,
    docker: DockerInfo,
    browser_bookmarks: Vec<BrowserBookmarks>,
}

async fn run_legacy_scanners() -> LegacyScanResults {
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
    LegacyScanResults {
        installed_apps: installed_apps.unwrap_or_default(),
        default_browser: default_browser.unwrap_or_default(),
        ides: ides.unwrap_or_default(),
        git_repos: git_repos.unwrap_or_default(),
        shell_history: shell_history.unwrap_or_default(),
        wsl_distros,
        package_managers,
        ai_tools,
        system_info,
        ssh_keys: ssh_keys.unwrap_or_default(),
        docker,
        browser_bookmarks: browser_bookmarks.unwrap_or_default(),
    }
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
fn scan_installed_apps() -> Vec<InstalledApp> { vec![] }

// ── 2. Default Browser ────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn scan_default_browser() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey_with_flags(
        r"SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
        KEY_READ,
    ).ok()?;
    let prog_id: String = key.get_value("ProgId").ok()?;
    let browser = if prog_id.contains("ChromeHTML") || prog_id.contains("Chrome") { "Chrome" }
        else if prog_id.contains("FirefoxURL") || prog_id.contains("Firefox") { "Firefox" }
        else if prog_id.contains("MSEdgeHTM") || prog_id.contains("Edge") { "Edge" }
        else if prog_id.contains("BraveHTML") || prog_id.contains("Brave") { "Brave" }
        else if prog_id.contains("OperaStable") || prog_id.contains("Opera") { "Opera" }
        else if prog_id.contains("Vivaldi") { "Vivaldi" }
        else if prog_id.contains("IE.HTTP") || prog_id.contains("IExplore") { "Internet Explorer" }
        else { &prog_id };
    Some(browser.to_string())
}

#[cfg(not(target_os = "windows"))]
fn scan_default_browser() -> Option<String> { None }

// ── 3. IDEs ───────────────────────────────────────────────────────────────────

fn scan_ides() -> Vec<IdeInfo> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut ides = Vec::new();

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
            ides.push(IdeInfo { name: "VS Code".to_string(), config_path: Some(p.to_string_lossy().to_string()), extensions });
        }
    }

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
            ides.push(IdeInfo { name: "Cursor".to_string(), config_path: Some(p.to_string_lossy().to_string()), extensions });
        }
    }

    if let Some(data_dir) = dirs::data_dir() {
        let jb_root = data_dir.join("JetBrains");
        if jb_root.exists() {
            if let Ok(entries) = std::fs::read_dir(&jb_root) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    ides.push(IdeInfo { name: format!("JetBrains/{}", name), config_path: Some(entry.path().to_string_lossy().to_string()), extensions: vec![] });
                }
            }
        }
    }

    let nvim_config = home.join(".config").join("nvim").join("init.lua");
    let nvim_config_vim = home.join(".config").join("nvim").join("init.vim");
    if nvim_config.exists() || nvim_config_vim.exists() {
        let p = if nvim_config.exists() { &nvim_config } else { &nvim_config_vim };
        ides.push(IdeInfo { name: "Neovim".to_string(), config_path: Some(p.to_string_lossy().to_string()), extensions: vec![] });
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
    entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().to_string()).collect()
}

// ── 4. Git Repos (legacy) ─────────────────────────────────────────────────────

fn scan_git_repos() -> Vec<GitRepo> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let candidate_dirs = [
        home.join("Documents"), home.join("projects"), home.join("dev"),
        home.join("code"), home.join("repos"), home.join("Desktop"),
        home.join("src"), home.join("work"),
    ];
    let mut repos = Vec::new();
    for root in &candidate_dirs {
        if !root.is_dir() { continue; }
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            if path.join(".git").exists() {
                repos.push(inspect_git_repo(&path));
            }
        }
    }
    repos
}

fn inspect_git_repo(path: &Path) -> GitRepo {
    let path_str = path.to_string_lossy().to_string();
    let mut repo = GitRepo { path: path_str.clone(), ..Default::default() };
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
    let head_file = path.join(".git").join("HEAD");
    if let Ok(content) = std::fs::read_to_string(&head_file) {
        let trimmed = content.trim();
        if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
            repo.branch = Some(branch.to_string());
        } else {
            repo.branch = Some(trimmed.chars().take(8).collect::<String>());
        }
    }
    let mut ext_counts: HashMap<String, usize> = HashMap::new();
    count_extensions_shallow(path, &mut ext_counts, 0, 3);
    if !ext_counts.is_empty() {
        let primary = ext_counts.iter().max_by_key(|(_, v)| *v).map(|(k, _)| k.clone());
        repo.primary_language = primary.map(|ext| ext_to_language(&ext).to_string());
        repo.language_counts = ext_counts.into_iter().map(|(k, v)| (ext_to_language(&k).to_string(), v))
            .fold(HashMap::new(), |mut acc, (lang, count)| { *acc.entry(lang).or_insert(0) += count; acc });
    }
    repo
}

fn count_extensions_shallow(path: &Path, counts: &mut HashMap<String, usize>, depth: usize, max_depth: usize) {
    if depth > max_depth { return; }
    let Ok(entries) = std::fs::read_dir(path) else { return };
    for entry in entries.filter_map(|e| e.ok()).take(100) {
        let p = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
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

    let ps_history = {
        #[cfg(target_os = "windows")]
        { dirs::data_dir().map(|d| d.join("Microsoft").join("Windows").join("PowerShell").join("PSReadLine").join("ConsoleHost_history.txt")) }
        #[cfg(not(target_os = "windows"))]
        { None::<PathBuf> }
    };
    if let Some(path) = ps_history {
        if let Some(h) = parse_history_file(&path, "PowerShell") { results.push(h); }
    }
    if let Some(h) = parse_history_file(&home.join(".bash_history"), "bash") { results.push(h); }
    let zsh_path = std::env::var("HISTFILE").map(PathBuf::from).unwrap_or_else(|_| home.join(".zsh_history"));
    if let Some(h) = parse_history_file(&zsh_path, "zsh") { results.push(h); }
    let fish_hist = home.join(".local").join("share").join("fish").join("fish_history");
    if let Some(h) = parse_history_file(&fish_hist, "fish") { results.push(h); }
    results
}

fn parse_history_file(path: &Path, shell: &str) -> Option<ShellHistory> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut cmd_counts: HashMap<String, usize> = HashMap::new();
    for line in content.lines() {
        let cmd = if line.starts_with(": ") { line.splitn(3, ';').nth(1).unwrap_or(line) } else { line };
        let cmd = if cmd.trim_start().starts_with("- cmd:") { cmd.trim_start().trim_start_matches("- cmd:").trim() } else { cmd.trim() };
        if cmd.is_empty() || cmd.starts_with('#') { continue; }
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
        let output = crate::cmd_util::silent_tokio_cmd("wsl").args(["--list", "--verbose"]).output().await;
        let Ok(out) = output else { return vec![] };
        let raw = String::from_utf8_lossy(&out.stdout).to_string();
        let text: String = raw.chars().filter(|c| *c != '\0' && *c != '\u{FEFF}').collect();
        let mut distros = Vec::new();
        for line in text.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 { continue; }
            let (name_start, state_idx, ver_idx) = if parts[0] == "*" { (1, 2, 3) } else { (0, 1, 2) };
            if parts.len() <= ver_idx { continue; }
            let name = parts[name_start].to_string();
            let state = parts.get(state_idx).copied().unwrap_or("").to_string();
            let version = parts.get(ver_idx).copied().unwrap_or("").to_string();
            let projects = if state.to_lowercase() == "running" { scan_wsl_home_projects(&name).await } else { vec![] };
            distros.push(WslDistro { name, state, version, projects });
        }
        distros
    }
}

#[cfg(target_os = "windows")]
async fn scan_wsl_home_projects(distro: &str) -> Vec<String> {
    let output = crate::cmd_util::silent_tokio_cmd("wsl")
        .args(["-d", distro, "--", "find", "/home", "-maxdepth", "3", "-name", ".git", "-type", "d"])
        .output().await;
    let Ok(out) = output else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().map(|l| l.trim_end_matches("/.git").to_string()).filter(|l| !l.is_empty()).take(20).collect()
}

#[cfg(not(target_os = "windows"))]
async fn scan_wsl_home_projects(_distro: &str) -> Vec<String> { vec![] }

// ── 7. Package Managers ───────────────────────────────────────────────────────

async fn scan_package_managers() -> Vec<PackageManagerInfo> {
    let mut results = Vec::new();
    if let Some(pkgs) = run_cmd_lines("npm", &["list", "-g", "--depth=0", "--parseable"]).await {
        let packages = pkgs.into_iter().filter(|l| !l.is_empty())
            .map(|l| l.split(['/', '\\']).last().unwrap_or(&l).to_string())
            .filter(|p| p != "lib").collect();
        results.push(PackageManagerInfo { name: "npm".to_string(), packages });
    }
    if let Some(pkgs) = run_cmd_lines("pip", &["list", "--format=freeze"]).await {
        let packages = pkgs.into_iter().filter_map(|l| l.split_once('=').map(|(n, _)| n.to_string())).collect();
        results.push(PackageManagerInfo { name: "pip".to_string(), packages });
    } else if let Some(pkgs) = run_cmd_lines("pip3", &["list", "--format=freeze"]).await {
        let packages = pkgs.into_iter().filter_map(|l| l.split_once('=').map(|(n, _)| n.to_string())).collect();
        results.push(PackageManagerInfo { name: "pip3".to_string(), packages });
    }
    if let Some(raw) = run_cmd_output("cargo", &["install", "--list"]).await {
        let packages = raw.lines().filter(|l| !l.starts_with(' ') && !l.starts_with('\t') && !l.is_empty())
            .map(|l| l.split_whitespace().next().unwrap_or(l).to_string()).collect();
        results.push(PackageManagerInfo { name: "cargo".to_string(), packages });
    }
    if let Some(pkgs) = run_cmd_lines("choco", &["list", "--local-only", "--limit-output"]).await {
        let packages = pkgs.into_iter().filter_map(|l| l.split_once('|').map(|(n, _)| n.to_string())).collect();
        results.push(PackageManagerInfo { name: "chocolatey".to_string(), packages });
    }
    if let Some(pkgs) = run_cmd_lines("scoop", &["list"]).await {
        let packages = pkgs.into_iter().skip(2).filter_map(|l| l.split_whitespace().next().map(|s| s.to_string())).filter(|s| !s.is_empty() && !s.starts_with('-')).collect();
        results.push(PackageManagerInfo { name: "scoop".to_string(), packages });
    }
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
    let ollama_list = run_cmd_output("ollama", &["list"]).await;
    let ollama_detected = ollama_list.is_some();
    let ollama_details = ollama_list.unwrap_or_default();
    let ollama_models: Vec<String> = ollama_details.lines().skip(1).filter_map(|l| l.split_whitespace().next().map(|s| s.to_string())).collect();
    tools.push(AiToolInfo { name: "Ollama".to_string(), detected: ollama_detected, details: if ollama_models.is_empty() { String::new() } else { ollama_models.join(", ") } });
    let hf_cache = home.join(".cache").join("huggingface");
    let hf_detected = hf_cache.exists();
    let hf_models = if hf_detected { list_dir_names(&hf_cache.join("hub")).into_iter().take(20).collect::<Vec<_>>().join(", ") } else { String::new() };
    tools.push(AiToolInfo { name: "HuggingFace".to_string(), detected: hf_detected, details: hf_models });
    let claude_dir = home.join(".claude");
    let claude_detected = claude_dir.exists();
    let claude_details = if claude_detected { let projects_dir = claude_dir.join("projects"); if projects_dir.exists() { format!("{} project(s)", list_dir_names(&projects_dir).len()) } else { "config present".to_string() } } else { String::new() };
    tools.push(AiToolInfo { name: "Claude Code".to_string(), detected: claude_detected, details: claude_details });
    let lm_studio = home.join(".lmstudio");
    let lm_detected = lm_studio.exists() || { #[cfg(target_os = "windows")] { dirs::data_dir().map(|d| d.join("LM Studio").exists()).unwrap_or(false) } #[cfg(not(target_os = "windows"))] { false } };
    tools.push(AiToolInfo { name: "LM Studio".to_string(), detected: lm_detected, details: String::new() });
    let aider_conf = home.join(".aider.conf.yml");
    let aider_detected = aider_conf.exists() || run_cmd_output("aider", &["--version"]).await.is_some();
    tools.push(AiToolInfo { name: "Aider".to_string(), detected: aider_detected, details: String::new() });
    let cursor_detected = { #[cfg(target_os = "windows")] { dirs::data_dir().map(|d| d.join("Cursor").exists()).unwrap_or(false) } #[cfg(target_os = "macos")] { home.join("Library/Application Support/Cursor").exists() } #[cfg(not(any(target_os = "windows", target_os = "macos")))] { home.join(".config/Cursor").exists() } };
    tools.push(AiToolInfo { name: "Cursor".to_string(), detected: cursor_detected, details: String::new() });
    tools
}

// ── 9. System Info ────────────────────────────────────────────────────────────

async fn scan_system_info() -> SystemInfo {
    let mut info = SystemInfo::default();
    #[cfg(target_os = "windows")]
    {
        if let Some(cpu) = run_cmd_output("wmic", &["cpu", "get", "Name", "/value"]).await { for line in cpu.lines() { if let Some(val) = line.strip_prefix("Name=") { info.cpu = val.trim().to_string(); break; } } }
        if let Some(gpu) = run_cmd_output("wmic", &["path", "win32_VideoController", "get", "Name", "/value"]).await { let gpus: Vec<String> = gpu.lines().filter_map(|l| l.strip_prefix("Name=").map(|v| v.trim().to_string())).filter(|s| !s.is_empty()).collect(); info.gpu = gpus.join(", "); }
        if let Some(ram_out) = run_cmd_output("wmic", &["ComputerSystem", "get", "TotalPhysicalMemory", "/value"]).await { for line in ram_out.lines() { if let Some(val) = line.strip_prefix("TotalPhysicalMemory=") { if let Ok(bytes) = val.trim().parse::<u64>() { info.total_ram_mb = bytes / (1024 * 1024); } } } }
        if let Some(disk_out) = run_cmd_output("wmic", &["logicaldisk", "where", "DriveType=3", "get", "Size", "/value"]).await { let total_bytes: u64 = disk_out.lines().filter_map(|l| l.strip_prefix("Size=")).filter_map(|v| v.trim().parse::<u64>().ok()).sum(); info.total_disk_gb = total_bytes / (1024 * 1024 * 1024); }
        if let Some(os_out) = run_cmd_output("wmic", &["os", "get", "Caption,Version", "/value"]).await { let mut caption = String::new(); let mut version = String::new(); for line in os_out.lines() { if let Some(v) = line.strip_prefix("Caption=") { caption = v.trim().to_string(); } if let Some(v) = line.strip_prefix("Version=") { version = v.trim().to_string(); } } info.os_version = if caption.is_empty() { version } else { format!("{} ({})", caption, version) }; }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(cpu) = run_cmd_output("sysctl", &["-n", "machdep.cpu.brand_string"]).await { info.cpu = cpu.trim().to_string(); }
        if let Some(ram) = run_cmd_output("sysctl", &["-n", "hw.memsize"]).await { if let Ok(bytes) = ram.trim().parse::<u64>() { info.total_ram_mb = bytes / (1024 * 1024); } }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") { for line in cpuinfo.lines() { if line.starts_with("model name") { if let Some(val) = line.splitn(2, ':').nth(1) { info.cpu = val.trim().to_string(); break; } } } }
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") { for line in meminfo.lines() { if line.starts_with("MemTotal:") { if let Some(val) = line.split_whitespace().nth(1) { if let Ok(kb) = val.parse::<u64>() { info.total_ram_mb = kb / 1024; } } } } }
    }
    info
}

// ── 10. SSH Keys ──────────────────────────────────────────────────────────────

fn scan_ssh_keys() -> Vec<SshKey> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let ssh_dir = home.join(".ssh");
    let Ok(entries) = std::fs::read_dir(&ssh_dir) else { return vec![] };
    entries.filter_map(|e| e.ok()).filter(|e| e.path().extension().map(|x| x == "pub").unwrap_or(false))
        .filter_map(|e| {
            let content = std::fs::read_to_string(e.path()).ok()?;
            let parts: Vec<&str> = content.trim().splitn(3, ' ').collect();
            let key_type = parts.first().copied().unwrap_or("unknown").to_string();
            let comment = parts.get(2).map(|s| s.to_string());
            Some(SshKey { filename: e.file_name().to_string_lossy().to_string(), key_type, comment })
        }).collect()
}

// ── 11. Docker ────────────────────────────────────────────────────────────────

async fn scan_docker() -> DockerInfo {
    let mut info = DockerInfo::default();
    if let Some(ps) = run_cmd_output("docker", &["ps", "--format", "{{.Names}} ({{.Image}})"]).await {
        info.running_containers = ps.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect();
    }
    if let Some(imgs) = run_cmd_output("docker", &["images", "--format", "{{.Repository}}:{{.Tag}}"]).await {
        info.images = imgs.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).take(50).collect();
    }
    info
}

// ── 12. Browser Bookmarks ─────────────────────────────────────────────────────

fn scan_browser_bookmarks() -> Vec<BrowserBookmarks> {
    let mut results = Vec::new();
    let chrome_path = { #[cfg(target_os = "windows")] { dirs::data_local_dir().map(|d| d.join("Google").join("Chrome").join("User Data").join("Default").join("Bookmarks")) } #[cfg(target_os = "macos")] { dirs::home_dir().map(|h| h.join("Library/Application Support/Google/Chrome/Default/Bookmarks")) } #[cfg(not(any(target_os = "windows", target_os = "macos")))] { dirs::home_dir().map(|h| h.join(".config/google-chrome/Default/Bookmarks")) } };
    if let Some(path) = chrome_path { if let Some(bm) = read_chromium_bookmarks(&path, "Chrome") { results.push(bm); } }
    let edge_path = { #[cfg(target_os = "windows")] { dirs::data_local_dir().map(|d| d.join("Microsoft").join("Edge").join("User Data").join("Default").join("Bookmarks")) } #[cfg(not(target_os = "windows"))] { None::<PathBuf> } };
    if let Some(path) = edge_path { if let Some(bm) = read_chromium_bookmarks(&path, "Edge") { results.push(bm); } }
    let brave_path = { #[cfg(target_os = "windows")] { dirs::data_local_dir().map(|d| d.join("BraveSoftware").join("Brave-Browser").join("User Data").join("Default").join("Bookmarks")) } #[cfg(not(target_os = "windows"))] { None::<PathBuf> } };
    if let Some(path) = brave_path { if let Some(bm) = read_chromium_bookmarks(&path, "Brave") { results.push(bm); } }
    results
}

fn read_chromium_bookmarks(path: &Path, browser: &str) -> Option<BrowserBookmarks> {
    let content = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let mut urls: Vec<String> = Vec::new();
    collect_bookmark_urls(&json, &mut urls);
    let mut domains: std::collections::HashSet<String> = std::collections::HashSet::new();
    for url in &urls { if let Some(domain) = extract_domain(url) { domains.insert(domain); } }
    let mut domain_list: Vec<String> = domains.into_iter().collect();
    domain_list.sort(); domain_list.truncate(50);
    Some(BrowserBookmarks { browser: browser.to_string(), count: urls.len(), domains: domain_list })
}

fn collect_bookmark_urls(value: &serde_json::Value, urls: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            if let (Some(serde_json::Value::String(t)), Some(serde_json::Value::String(u))) = (map.get("type"), map.get("url")) {
                if t == "url" { urls.push(u.clone()); }
            }
            for v in map.values() { collect_bookmark_urls(v, urls); }
        }
        serde_json::Value::Array(arr) => { for v in arr { collect_bookmark_urls(v, urls); } }
        _ => {}
    }
}

fn extract_domain(url: &str) -> Option<String> {
    let stripped = url.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
    let domain = stripped.split('/').next()?.split('?').next()?.split(':').next()?;
    if domain.contains('.') { Some(domain.to_lowercase()) } else { None }
}

// ── Subprocess helpers ────────────────────────────────────────────────────────

async fn run_cmd_output(program: &str, args: &[&str]) -> Option<String> {
    let out = crate::cmd_util::silent_tokio_cmd(program).args(args).output().await.ok()?;
    if out.status.success() || !out.stdout.is_empty() { Some(String::from_utf8_lossy(&out.stdout).to_string()) } else { None }
}

async fn run_cmd_lines(program: &str, args: &[&str]) -> Option<Vec<String>> {
    let out = run_cmd_output(program, args).await?;
    Some(out.lines().map(|l| l.to_string()).collect())
}

// ── Knowledge graph seeding (preserved verbatim) ──────────────────────────────

fn seed_knowledge_graph(results: &DeepScanResults) {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => { log::warn!("deep_scan: could not open DB for graph seeding: {}", e); return; }
    };
    for app in results.installed_apps.iter().take(100) {
        let id = format!("tool:{}", app.name.to_lowercase().replace(' ', "-").replace(['/', '\\', '(', ')'], ""));
        let summary = format!("Installed app: {}{}{}", app.name, app.version.as_deref().map(|v| format!(", v{}", v)).unwrap_or_default(), app.publisher.as_deref().map(|p| format!(", by {}", p)).unwrap_or_default());
        let _ = crate::db::brain_upsert_node(&conn, &id, &app.name, "tool", &summary);
    }
    for repo in &results.git_repos {
        let name = std::path::Path::new(&repo.path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| repo.path.clone());
        let id = format!("project:{}", name.to_lowercase().replace(' ', "-"));
        let lang = repo.primary_language.as_deref().unwrap_or("unknown");
        let remote = repo.remote_url.as_deref().unwrap_or("local");
        let summary = format!("Git project at {} ({}), remote: {}", repo.path, lang, remote);
        let _ = crate::db::brain_upsert_node(&conn, &id, &name, "project", &summary);
    }
    for ide in &results.ides {
        let id = format!("tool:{}", ide.name.to_lowercase().replace(' ', "-").replace('/', "-"));
        let summary = format!("IDE: {}", ide.name);
        let _ = crate::db::brain_upsert_node(&conn, &id, &ide.name, "tool", &summary);
    }
    for tool in results.ai_tools.iter().filter(|t| t.detected) {
        let id = format!("tool:ai-{}", tool.name.to_lowercase().replace(' ', "-"));
        let summary = format!("AI tool: {}{}", tool.name, if tool.details.is_empty() { String::new() } else { format!(". {}", tool.details) });
        let _ = crate::db::brain_upsert_node(&conn, &id, &tool.name, "tool", &summary);
    }
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
    lines.push(format!("Scanned: {}", chrono::DateTime::from_timestamp(results.scanned_at / 1000, 0).map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string()).unwrap_or_else(|| "unknown".to_string())));
    lines.push(String::new());
    lines.push(format!("System: {}", results.system_info.os_version));
    if !results.system_info.cpu.is_empty() { lines.push(format!("CPU: {}", results.system_info.cpu)); }
    if !results.system_info.gpu.is_empty() { lines.push(format!("GPU: {}", results.system_info.gpu)); }
    if results.system_info.total_ram_mb > 0 { lines.push(format!("RAM: {} GB", results.system_info.total_ram_mb / 1024)); }
    if results.system_info.total_disk_gb > 0 { lines.push(format!("Disk: {} GB", results.system_info.total_disk_gb)); }
    lines.push(String::new());
    lines.push(format!("Default Browser: {}", results.default_browser.as_deref().unwrap_or("unknown")));
    lines.push(String::new());
    lines.push(format!("Installed Apps: {} detected", results.installed_apps.len()));
    lines.push(String::new());
    lines.push(format!("IDEs ({}):", results.ides.len()));
    for ide in &results.ides { lines.push(format!("  - {} ({} extensions)", ide.name, ide.extensions.len())); }
    lines.push(String::new());
    lines.push(format!("Git Repos ({}):", results.git_repos.len()));
    for repo in results.git_repos.iter().take(15) {
        let name = std::path::Path::new(&repo.path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| repo.path.clone());
        let lang = repo.primary_language.as_deref().unwrap_or("?");
        lines.push(format!("  - {} [{}]", name, lang));
    }
    if results.git_repos.len() > 15 { lines.push(format!("  ... and {} more", results.git_repos.len() - 15)); }
    lines.push(String::new());
    lines.push("AI Tools:".to_string());
    for tool in &results.ai_tools { let status = if tool.detected { "yes" } else { "no" }; let detail = if tool.details.is_empty() { String::new() } else { format!(" — {}", tool.details) }; lines.push(format!("  - {}: {}{}", tool.name, status, detail)); }
    lines.push(String::new());
    lines.push("Package Managers:".to_string());
    for pm in &results.package_managers { lines.push(format!("  - {} ({} packages)", pm.name, pm.packages.len())); }
    if !results.wsl_distros.is_empty() { lines.push(String::new()); lines.push("WSL Distros:".to_string()); for d in &results.wsl_distros { lines.push(format!("  - {} ({}) v{}", d.name, d.state, d.version)); } }
    if !results.ssh_keys.is_empty() { lines.push(String::new()); lines.push("SSH Keys:".to_string()); for k in &results.ssh_keys { lines.push(format!("  - {} ({})", k.filename, k.key_type)); } }
    if !results.docker.running_containers.is_empty() || !results.docker.images.is_empty() { lines.push(String::new()); lines.push(format!("Docker: {} running, {} images", results.docker.running_containers.len(), results.docker.images.len())); }
    if !results.browser_bookmarks.is_empty() { lines.push(String::new()); lines.push("Browser Bookmarks:".to_string()); for bm in &results.browser_bookmarks { lines.push(format!("  - {} ({} bookmarks)", bm.browser, bm.count)); } }
    if !results.shell_history.is_empty() { lines.push(String::new()); lines.push("Shell History (top commands):".to_string()); for hist in &results.shell_history { let cmds: Vec<String> = hist.top_commands.iter().take(5).map(|(c, n)| format!("{}({})", c, n)).collect(); lines.push(format!("  - {}: {}", hist.shell, cmds.join(", "))); } }
    lines.join("\n")
}

// ── Public API for brain.rs ───────────────────────────────────────────────────

/// Return a compact 3-5 line identity block for injection into the system prompt.
pub fn load_scan_summary() -> Option<String> {
    let results = load_results()?;
    let mut lines: Vec<String> = Vec::with_capacity(6);
    let hw = if results.system_info.total_ram_mb > 0 {
        format!("{}{}{}", results.system_info.os_version, if !results.system_info.cpu.is_empty() { format!(", {}", results.system_info.cpu) } else { String::new() }, if results.system_info.total_ram_mb > 0 { format!(", {} GB RAM", results.system_info.total_ram_mb / 1024) } else { String::new() })
    } else { results.system_info.os_version.clone() };
    if !hw.is_empty() { lines.push(format!("Machine: {}", hw)); }
    if let Some(ref browser) = results.default_browser { lines.push(format!("Default browser: {}", browser)); }
    if !results.ides.is_empty() { let ide_names: Vec<&str> = results.ides.iter().map(|i| i.name.as_str()).collect(); lines.push(format!("IDEs: {}", ide_names.join(", "))); }
    {
        let mut lang_totals: HashMap<String, usize> = HashMap::new();
        for repo in &results.git_repos { for (lang, count) in &repo.language_counts { *lang_totals.entry(lang.clone()).or_insert(0) += count; } }
        if !lang_totals.is_empty() { let mut langs: Vec<(String, usize)> = lang_totals.into_iter().collect(); langs.sort_by(|a, b| b.1.cmp(&a.1)); let top: Vec<&str> = langs.iter().take(5).map(|(l, _)| l.as_str()).collect(); lines.push(format!("Primary languages: {}", top.join(", "))); }
    }
    if !results.git_repos.is_empty() {
        let repo_names: Vec<String> = results.git_repos.iter().take(5).map(|r| std::path::Path::new(&r.path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| r.path.clone())).collect();
        let suffix = if results.git_repos.len() > 5 { format!(" (+{} more)", results.git_repos.len() - 5) } else { String::new() };
        lines.push(format!("Git repos: {}{}", repo_names.join(", "), suffix));
    }
    {
        let active_ai: Vec<&str> = results.ai_tools.iter().filter(|t| t.detected).map(|t| t.name.as_str()).collect();
        if !active_ai.is_empty() { lines.push(format!("AI tools: {}", active_ai.join(", "))); }
    }
    if lines.is_empty() { None } else { Some(lines.join("\n")) }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emits_additive_payload() {
        let payload = build_progress_payload(
            "git_repos",
            42,
            "fs_repo_walk",
            Some("hot"),
            Some("found 3 repos"),
            Some(17),
            1250,
        );

        // D-64 backward-compat fields
        assert_eq!(payload["phase"], "git_repos");
        assert_eq!(payload["found"], 42);

        // New additive fields (D-64 extension)
        assert!(payload.get("lead_kind").is_some(), "missing lead_kind");
        assert!(payload.get("tier").is_some(), "missing tier");
        assert!(payload.get("message").is_some(), "missing message");
        assert!(payload.get("queue_depth").is_some(), "missing queue_depth");
        assert!(payload.get("elapsed_ms").is_some(), "missing elapsed_ms");

        // Values correct
        assert_eq!(payload["lead_kind"], "fs_repo_walk");
        assert_eq!(payload["tier"], "hot");
        assert_eq!(payload["message"], "found 3 repos");
        assert_eq!(payload["queue_depth"], 17);
        assert_eq!(payload["elapsed_ms"], 1250);
    }
}
