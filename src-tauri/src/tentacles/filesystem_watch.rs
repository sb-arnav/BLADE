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
        let category = categorise(&file_path);
        let dest_opt = suggested_destination(category);

        // Check if we should auto-move
        let should_auto = {
            let learning = category_learning().lock().unwrap();
            *learning.approvals.get(category).unwrap_or(&0) >= AUTO_MOVE_THRESHOLD
        };

        if should_auto {
            if let Some(dest) = &dest_opt {
                if let Some(file_name) = file_path.file_name() {
                    let target = dest.join(file_name);
                    // Ensure destination exists
                    let _ = std::fs::create_dir_all(dest);
                    if std::fs::rename(&file_path, &target).is_ok() {
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

        // Suggest the move
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
