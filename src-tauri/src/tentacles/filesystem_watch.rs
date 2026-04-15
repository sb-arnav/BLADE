/// TENTACLE: filesystem_watch.rs — Proactive file-system management.
///
/// Scans the Downloads folder every 5 min. Auto-categorises new files and
/// emits `proactive_suggestion` events for moves. After a category is approved
/// 5+ times it auto-moves future files silently (learned pattern).
/// Also provides duplicate detection, disk-usage breakdown, and stale-file listing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use chrono::Datelike;

// ── Static state ──────────────────────────────────────────────────────────────

static FS_WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Per-category approval counts and auto-move threshold.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CategoryLearning {
    /// category → approval count
    approvals: HashMap<String, u32>,
    /// category → auto-move destination chosen by the user
    auto_destinations: HashMap<String, PathBuf>,
}

static CATEGORY_LEARNING: OnceLock<Mutex<CategoryLearning>> = OnceLock::new();

fn category_learning() -> &'static Mutex<CategoryLearning> {
    CATEGORY_LEARNING.get_or_init(|| Mutex::new(CategoryLearning::default()))
}

/// Set of file paths already seen in Downloads so we only act on new arrivals.
static SEEN_FILES: OnceLock<Mutex<std::collections::HashSet<PathBuf>>> = OnceLock::new();

fn seen_files() -> &'static Mutex<std::collections::HashSet<PathBuf>> {
    SEEN_FILES.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

const AUTO_MOVE_THRESHOLD: u32 = 5;

// ── File access pattern learning ─────────────────────────────────────────────

/// Persistent store for file access patterns.
fn access_log_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("fs_access_log.json")
}

/// log: path → (access_count, last_access_ts, day_of_week_bitmap)
type AccessLog = HashMap<String, (u32, i64, u8)>;

fn load_access_log() -> AccessLog {
    std::fs::read_to_string(access_log_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_access_log(log: &AccessLog) {
    if let Ok(json) = serde_json::to_string_pretty(log) {
        let _ = std::fs::write(access_log_path(), json);
    }
}

/// Record a file access event (call from brain.rs or file open hooks when possible).
pub fn record_file_access(path: &str) {
    let now = now_secs();
    let day_of_week = chrono::DateTime::from_timestamp(now, 0)
        .map(|dt| dt.weekday().num_days_from_monday() as u8)
        .unwrap_or(0);

    let mut log = load_access_log();
    let entry = log.entry(path.to_string()).or_insert((0, 0, 0));
    entry.0 += 1;
    entry.1 = now;
    entry.2 |= 1 << day_of_week; // set bit for this day of week
    save_access_log(&log);
}

/// Get the top N most-accessed files (path, count) sorted by access count.
pub fn get_hot_files(n: usize) -> Vec<(String, u32)> {
    let mut log: Vec<(String, u32)> = load_access_log()
        .into_iter()
        .map(|(path, (count, _, _))| (path, count))
        .collect();
    log.sort_by(|a, b| b.1.cmp(&a.1));
    log.truncate(n);
    log
}

/// Get files that are typically accessed on a given day of week (0=Mon … 6=Sun).
pub fn files_for_day_of_week(day: u8) -> Vec<String> {
    let mask = 1u8 << day;
    load_access_log()
        .into_iter()
        .filter(|(_, (count, _, dow_bitmap))| *count >= 2 && (dow_bitmap & mask) != 0)
        .map(|(path, _)| path)
        .collect()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn downloads_dir() -> Option<PathBuf> {
    dirs::download_dir()
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

// ── Category detection ────────────────────────────────────────────────────────

/// Classify a file path into a high-level category based on extension.
fn categorise(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        // Images
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "heic" | "raw"
            => "images",
        // Videos
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "flv" | "wmv"
            => "videos",
        // Audio
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a"
            => "audio",
        // Documents
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "pages"
            => "documents",
        // Spreadsheets / finance
        "xls" | "xlsx" | "csv" | "ods" | "numbers"
            => "spreadsheets",
        // Presentations
        "ppt" | "pptx" | "odp" | "key"
            => "presentations",
        // Archives
        "zip" | "tar" | "gz" | "bz2" | "7z" | "rar" | "xz"
            => "archives",
        // Code / dev
        "rs" | "py" | "js" | "ts" | "go" | "java" | "c" | "cpp" | "h" | "rb" | "sh"
        | "json" | "toml" | "yaml" | "yml" | "xml" | "html" | "css"
            => "code",
        // Installer / executables
        "exe" | "msi" | "deb" | "rpm" | "dmg" | "pkg" | "appimage"
            => "installers",
        // Finance markers in name (invoices, receipts, statements)
        _ => {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if name.contains("invoice")
                || name.contains("receipt")
                || name.contains("statement")
                || name.contains("payment")
            {
                "finance"
            } else {
                "other"
            }
        }
    }
}

/// Suggest a destination directory for a given category.
fn suggested_destination(category: &str) -> Option<PathBuf> {
    let home = home_dir()?;
    Some(match category {
        "images"        => home.join("Pictures"),
        "videos"        => home.join("Videos"),
        "audio"         => home.join("Music"),
        "documents"     => home.join("Documents"),
        "spreadsheets"  => home.join("Documents").join("Spreadsheets"),
        "presentations" => home.join("Documents").join("Presentations"),
        "code"          => home.join("code"),
        "finance"       => home.join("Documents").join("Finance"),
        "archives"      => home.join("Downloads").join("Archives"),
        "installers"    => home.join("Downloads").join("Installers"),
        _               => return None,
    })
}

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub size_bytes: u64,
    pub files: Vec<String>,
    pub partial_hash: String,
}

// ── Duplicate detection ───────────────────────────────────────────────────────

/// Read the first 64 KiB of a file and return a hex string of its XOR-fold hash.
/// Fast and good enough for deduplication hints; not cryptographically secure.
fn partial_hash(path: &Path) -> String {
    let mut buf = [0u8; 65536];
    if let Ok(mut f) = std::fs::File::open(path) {
        let n = f.read(&mut buf).unwrap_or(0);
        let hash: u64 = buf[..n]
            .chunks(8)
            .fold(0u64, |acc, chunk| {
                let mut val = 0u64;
                for (i, &b) in chunk.iter().enumerate() {
                    val |= (b as u64) << (i * 8);
                }
                acc ^ val
            });
        return format!("{:016x}", hash);
    }
    "0000000000000000".to_string()
}

/// Find duplicate files in `dir` by grouping on (size, partial_hash).
pub fn detect_duplicates(dir: &str) -> Vec<DuplicateGroup> {
    // size → Vec<path>
    let mut size_groups: HashMap<u64, Vec<PathBuf>> = HashMap::new();

    let walk_dir = walkdir_lite(Path::new(dir));
    for entry in walk_dir {
        if let Ok(meta) = std::fs::metadata(&entry) {
            if meta.is_file() {
                size_groups.entry(meta.len()).or_default().push(entry);
            }
        }
    }

    let mut duplicates: Vec<DuplicateGroup> = Vec::new();

    for (size, paths) in size_groups {
        if paths.len() < 2 || size == 0 {
            continue;
        }
        // Group by partial hash
        let mut hash_groups: HashMap<String, Vec<String>> = HashMap::new();
        for path in paths {
            let h = partial_hash(&path);
            hash_groups
                .entry(h)
                .or_default()
                .push(path.display().to_string());
        }
        for (hash, files) in hash_groups {
            if files.len() >= 2 {
                duplicates.push(DuplicateGroup {
                    size_bytes: size,
                    files,
                    partial_hash: hash,
                });
            }
        }
    }

    duplicates.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    duplicates
}

/// Minimal iterative directory walker (BFS). Limits depth to 8 levels.
fn walkdir_lite(root: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    // Stack carries (path, depth_from_root)
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > 8 {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push((path, depth + 1));
                } else {
                    result.push(path);
                }
            }
        }
    }
    result
}

// ── Disk usage ────────────────────────────────────────────────────────────────

/// Return the top-10 immediate subdirectories (plus the root itself) of the home
/// directory, sorted by total size descending.
pub fn get_disk_usage_breakdown() -> Vec<(String, u64)> {
    let home = match home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    let mut entries: Vec<(String, u64)> = Vec::new();

    if let Ok(dirs) = std::fs::read_dir(&home) {
        for entry in dirs.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let size = dir_size_shallow(&path);
            entries.push((path.display().to_string(), size));
        }
    }

    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries.truncate(10);
    entries
}

/// Sum file sizes one level deep (not full recursive, to stay fast).
fn dir_size_shallow(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

// ── Stale file detection ──────────────────────────────────────────────────────

/// List files in the home directory tree (max depth 3) not accessed in `days`.
/// Returns their display paths. Caller can present these as archival candidates.
pub fn archive_stale_files(days: u32) -> Vec<String> {
    let home = match home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };

    let threshold_secs = days as i64 * 86400;
    let now = now_secs();
    let mut stale: Vec<String> = Vec::new();

    // Walk up to depth 3 for performance
    collect_stale(&home, 0, 3, now, threshold_secs, &mut stale);
    stale.sort();
    stale
}

fn collect_stale(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    now: i64,
    threshold_secs: i64,
    out: &mut Vec<String>,
) {
    if depth > max_depth {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_stale(&path, depth + 1, max_depth, now, threshold_secs, out);
        } else if let Ok(meta) = std::fs::metadata(&path) {
            let accessed = meta
                .accessed()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            if accessed > 0 && (now - accessed) >= threshold_secs {
                out.push(path.display().to_string());
            }
        }
    }
}

// ── Background loop ───────────────────────────────────────────────────────────

/// Start the filesystem watcher background loop. Idempotent.
pub fn start_filesystem_watcher(app: AppHandle) {
    if FS_WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tick_filesystem_watcher(&app);
            // 5-minute interval
            tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
        }
    });

    log::info!("[FilesystemWatch] Started.");
}

fn tick_filesystem_watcher(app: &AppHandle) {
    let downloads = match downloads_dir() {
        Some(d) => d,
        None => return,
    };

    let entries = match std::fs::read_dir(&downloads) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut new_files: Vec<PathBuf> = Vec::new();
    {
        let mut seen = seen_files().lock().unwrap();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && !seen.contains(&path) {
                seen.insert(path.clone());
                new_files.push(path);
            }
        }
    }

    for file_path in new_files {
        // Sensitive file detection — check BEFORE categorising
        if is_sensitive_file(&file_path) {
            let safe_loc = suggest_safe_location(&file_path);
            let _ = app.emit(
                "proactive_suggestion",
                serde_json::json!({
                    "source": "filesystem_watch",
                    "title": "Sensitive file detected in unsafe location",
                    "body": format!(
                        "`{}` looks like a sensitive file (secrets/credentials). {}",
                        file_path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
                        safe_loc.as_deref().unwrap_or("Move it to a project directory and add it to .gitignore.")
                    ),
                    "severity": "warning",
                    "file": file_path.display().to_string(),
                    "action": "secure_file",
                }),
            );
            continue;
        }

        let category = categorise(&file_path);
        let dest_opt = suggested_destination(category);

        let should_auto = {
            let learning = category_learning().lock().unwrap();
            *learning.approvals.get(category).unwrap_or(&0) >= AUTO_MOVE_THRESHOLD
        };

        if should_auto {
            if let Some(dest) = &dest_opt {
                if let Some(file_name) = file_path.file_name() {
                    let target = dest.join(file_name);
                    let _ = std::fs::create_dir_all(dest);
                    if std::fs::rename(&file_path, &target).is_ok() {
                        // Record access for the moved file's new location
                        record_file_access(&target.display().to_string());
                        let _ = app.emit(
                            "proactive_suggestion",
                            serde_json::json!({
                                "source": "filesystem_watch",
                                "title": format!("Auto-moved {} file", category),
                                "body": format!(
                                    "Moved `{}` → `{}`",
                                    file_path.display(),
                                    target.display()
                                ),
                                "auto_moved": true,
                            }),
                        );
                        continue;
                    }
                }
            }
        }

        let suggestion = serde_json::json!({
            "source": "filesystem_watch",
            "title": format!("New {} file in Downloads", category),
            "body": format!(
                "`{}` looks like a {} file.{}",
                file_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file"),
                category,
                dest_opt.as_ref()
                    .map(|d| format!(" Move to `{}`?", d.display()))
                    .unwrap_or_default()
            ),
            "file": file_path.display().to_string(),
            "category": category,
            "suggested_dest": dest_opt.as_ref().map(|d| d.display().to_string()),
            "action": "move_file",
        });
        let _ = app.emit("proactive_suggestion", suggestion);
    }

    // Surface day-of-week file patterns (e.g. "You always open README.md on Mondays")
    let now = now_secs();
    let current_day = chrono::DateTime::from_timestamp(now, 0)
        .map(|dt| dt.weekday().num_days_from_monday() as u8)
        .unwrap_or(0);

    let day_files = files_for_day_of_week(current_day);
    if !day_files.is_empty() {
        let day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
        let day_name = day_names.get(current_day as usize).unwrap_or(&"today");
        let preview: Vec<&str> = day_files.iter()
            .take(3)
            .filter_map(|p| Path::new(p).file_name().and_then(|n| n.to_str()))
            .collect();
        if !preview.is_empty() {
            let _ = app.emit(
                "filesystem_pattern_reminder",
                serde_json::json!({
                    "source": "filesystem_watch",
                    "title": format!("Your usual {} files", day_name),
                    "body": format!(
                        "You typically access {} on {}s. Opening them for you?",
                        preview.join(", "), day_name
                    ),
                    "files": day_files,
                }),
            );
        }
    }

    // Periodic stale project check (once per watcher tick = every 5 min, but only emit occasionally)
    check_stale_projects(app);
}

/// Detect sensitive files in unsafe locations (Desktop, Downloads, home root).
fn is_sensitive_file(path: &Path) -> bool {
    let name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    let sensitive_names = [
        ".env", ".env.local", ".env.production", ".env.development",
        "secrets.json", "credentials.json", "credentials.csv",
        "id_rsa", "id_ed25519", "id_ecdsa",
        ".pem", ".key", ".p12", ".pfx",
        "service-account.json", "serviceaccount.json",
        "aws_credentials", ".aws_credentials",
        "token.json", "access_token.txt",
    ];

    let sensitive_extensions = [".pem", ".key", ".p12", ".pfx", ".cer", ".crt"];

    // Check by exact name
    if sensitive_names.iter().any(|s| name == *s || name.starts_with(*s)) {
        return true;
    }
    // Check by extension
    if sensitive_extensions.iter().any(|ext| name.ends_with(ext)) {
        return true;
    }
    // Check if it looks like it contains secrets by path context
    // File is in Downloads or Desktop (not in a project directory)
    let path_str = path.display().to_string().to_lowercase();
    let in_unsafe = path_str.contains("downloads") || path_str.contains("desktop");
    if in_unsafe && (name.contains("secret") || name.contains("credential") || name.contains("password") || name.contains("token")) {
        return true;
    }

    false
}

/// Suggest a safe location for a sensitive file.
fn suggest_safe_location(path: &Path) -> Option<String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    Some(format!(
        "Move `{name}` to your project directory and add it to `.gitignore`. \
         Never commit secrets to version control."
    ))
}

/// Check for project directories that haven't been touched in weeks.
fn check_stale_projects(app: &AppHandle) {
    let home = match home_dir() {
        Some(h) => h,
        None => return,
    };

    let project_dirs = ["code", "projects", "dev", "src", "workspace"];
    let stale_threshold_days: u64 = 21;
    let now = now_secs() as u64;

    for dir_name in &project_dirs {
        let parent = home.join(dir_name);
        if !parent.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&parent) else { continue };

        for entry in entries.flatten() {
            let proj = entry.path();
            if !proj.is_dir() {
                continue;
            }
            // Get last modified time of the directory
            let last_modified = std::fs::metadata(&proj)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            if last_modified == 0 {
                continue;
            }
            let age_days = (now.saturating_sub(last_modified)) / 86400;
            if age_days >= stale_threshold_days {
                let proj_name = proj.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("project");
                let _ = app.emit(
                    "filesystem_stale_project",
                    serde_json::json!({
                        "source": "filesystem_watch",
                        "title": format!("Stale project: {}", proj_name),
                        "body": format!(
                            "You haven't worked on `{}` in {} days. Archive it or keep?",
                            proj_name, age_days
                        ),
                        "path": proj.display().to_string(),
                        "age_days": age_days,
                        "action": "archive_or_keep",
                    }),
                );
            }
        }
    }
}

/// Call this when the user approves a suggested move for a category.
/// After 5 approvals the watcher will auto-move future files in that category.
#[tauri::command]
pub fn filesystem_approve_move(category: String, destination: String) {
    let mut learning = category_learning().lock().unwrap();
    let count = learning.approvals.entry(category.clone()).or_insert(0);
    *count += 1;
    learning
        .auto_destinations
        .insert(category, PathBuf::from(destination));
}
