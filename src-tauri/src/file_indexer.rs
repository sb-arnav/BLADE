/// FILE INDEXER — BLADE indexes ALL files on the user's machine, not just code.
///
/// Ported from Omi's FileIndexerService. Scans standard user directories,
/// indexes file metadata (path, type, size, dates), and makes everything
/// searchable. This lets BLADE answer "where's that PDF I downloaded last week?"
/// or "what files did I modify today?" without the user telling it.
///
/// Differences from BLADE's existing indexer.rs (code indexer):
///   - indexer.rs: extracts functions/classes/symbols from source code
///   - file_indexer.rs: indexes ALL file types by metadata (not content)
///
/// Scan folders (cross-platform):
///   Windows: Downloads, Documents, Desktop, Projects, repos
///   macOS: same + Developer, Sites, Applications
///   Linux: same + ~/src, ~/code

use rusqlite::params;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use serde::{Deserialize, Serialize};

static SCANNING: AtomicBool = AtomicBool::new(false);

const MAX_DEPTH: u32 = 4;
const BATCH_SIZE: usize = 500;
const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB

/// Folders to skip during recursive scan
const SKIP_FOLDERS: &[&str] = &[
    ".Trash", "node_modules", ".git", "__pycache__", ".venv", "venv",
    ".cache", ".npm", ".yarn", "Pods", "DerivedData", ".build",
    "build", "dist", ".next", ".nuxt", "target", "vendor",
    "Library", ".local", ".cargo", ".rustup", ".gradle",
    "AppData", "$Recycle.Bin", "System Volume Information",
    ".android", ".docker", ".kube",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedFile {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub file_type: String, // "document" | "image" | "video" | "audio" | "code" | "archive" | "other"
    pub size_bytes: i64,
    pub folder: String,
    pub depth: u32,
    pub created_at: i64,
    pub modified_at: i64,
    pub indexed_at: i64,
}

fn classify_file_type(ext: &str) -> &'static str {
    match ext {
        // Documents
        "pdf" | "doc" | "docx" | "txt" | "md" | "rtf" | "odt"
        | "xls" | "xlsx" | "csv" | "ppt" | "pptx" | "pages"
        | "numbers" | "keynote" | "epub" => "document",
        // Images
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "svg" | "webp"
        | "ico" | "tiff" | "psd" | "ai" | "sketch" | "fig" => "image",
        // Video
        "mp4" | "mkv" | "avi" | "mov" | "wmv" | "flv" | "webm" => "video",
        // Audio
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "wma" => "audio",
        // Code
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java"
        | "kt" | "c" | "cpp" | "h" | "cs" | "rb" | "php" | "swift"
        | "sql" | "sh" | "bash" | "zsh" | "ps1" | "lua" | "r" => "code",
        // Config
        "json" | "yaml" | "yml" | "toml" | "xml" | "ini" | "env"
        | "cfg" | "conf" => "config",
        // Archive
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" => "archive",
        _ => "other",
    }
}

fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

pub fn ensure_table() {
    if let Ok(conn) = rusqlite::Connection::open(db_path()) {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS indexed_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                filename TEXT NOT NULL,
                extension TEXT NOT NULL DEFAULT '',
                file_type TEXT NOT NULL DEFAULT 'other',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                folder TEXT NOT NULL DEFAULT '',
                depth INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT 0,
                modified_at INTEGER NOT NULL DEFAULT 0,
                indexed_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_files_type ON indexed_files(file_type);
            CREATE INDEX IF NOT EXISTS idx_files_modified ON indexed_files(modified_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_folder ON indexed_files(folder);
            CREATE INDEX IF NOT EXISTS idx_files_ext ON indexed_files(extension);"
        );
    }
}

fn scan_directories() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    #[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(unused_mut))]
    let mut dirs = vec![
        home.join("Downloads"),
        home.join("Documents"),
        home.join("Desktop"),
        home.join("Projects"),
        home.join("repos"),
        home.join("code"),
        home.join("src"),
    ];

    #[cfg(target_os = "macos")]
    {
        dirs.push(home.join("Developer"));
        dirs.push(home.join("Sites"));
        dirs.push(PathBuf::from("/Applications"));
    }

    #[cfg(target_os = "windows")]
    {
        dirs.push(home.join("OneDrive"));
        dirs.push(home.join("source"));
    }

    dirs.into_iter().filter(|d| d.exists()).collect()
}

fn scan_dir_recursive(
    dir: &Path,
    folder_name: &str,
    home_str: &str,
    depth: u32,
    batch: &mut Vec<IndexedFile>,
    total: &mut u32,
    conn: &rusqlite::Connection,
) {
    if depth > MAX_DEPTH { return; }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and folders
        if name.starts_with('.') { continue; }

        if path.is_dir() {
            if SKIP_FOLDERS.iter().any(|s| name == *s) { continue; }
            scan_dir_recursive(&path, folder_name, home_str, depth + 1, batch, total, conn);
            continue;
        }

        // File
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let size = meta.len();
        if size > MAX_FILE_SIZE { continue; }

        let ext = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let file_type = classify_file_type(&ext);

        let mut rel_path = path.to_string_lossy().to_string();
        if rel_path.starts_with(home_str) {
            rel_path = format!("~{}", &rel_path[home_str.len()..]);
        }

        let created = meta.created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let modified = meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let now = chrono::Utc::now().timestamp();

        batch.push(IndexedFile {
            id: 0,
            path: rel_path,
            filename: name,
            extension: ext,
            file_type: file_type.to_string(),
            size_bytes: size as i64,
            folder: folder_name.to_string(),
            depth,
            created_at: created,
            modified_at: modified,
            indexed_at: now,
        });
        *total += 1;

        if batch.len() >= BATCH_SIZE {
            flush_batch(batch, conn);
        }
    }
}

fn flush_batch(batch: &mut Vec<IndexedFile>, conn: &rusqlite::Connection) {
    for file in batch.drain(..) {
        let _ = conn.execute(
            "INSERT OR REPLACE INTO indexed_files
             (path, filename, extension, file_type, size_bytes, folder, depth, created_at, modified_at, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                file.path, file.filename, file.extension, file.file_type,
                file.size_bytes, file.folder, file.depth,
                file.created_at, file.modified_at, file.indexed_at
            ],
        );
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Run a full scan of standard user directories.
/// Safe to call multiple times — only one scan runs at a time.
pub fn run_full_scan() -> u32 {
    if SCANNING.swap(true, Ordering::SeqCst) {
        return 0; // already scanning
    }

    ensure_table();
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => { SCANNING.store(false, Ordering::SeqCst); return 0; }
    };

    let home_str = dirs::home_dir()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_default();

    let dirs = scan_directories();
    let mut batch: Vec<IndexedFile> = Vec::new();
    let mut total: u32 = 0;

    for dir in &dirs {
        let folder_name = dir.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        scan_dir_recursive(dir, &folder_name, &home_str, 0, &mut batch, &mut total, &conn);
    }

    // Flush remaining
    if !batch.is_empty() {
        flush_batch(&mut batch, &conn);
    }

    SCANNING.store(false, Ordering::SeqCst);
    log::info!("[file_indexer] Scan complete: {} files indexed", total);
    total
}

/// Search indexed files by query (filename, extension, or path match).
pub fn search_files(query: &str, file_type: Option<&str>, limit: usize) -> Vec<IndexedFile> {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let search = format!("%{}%", query);
    let lim = limit.min(50) as i64;

    let sql = if let Some(ft) = file_type {
        format!(
            "SELECT id, path, filename, extension, file_type, size_bytes, folder, depth, created_at, modified_at, indexed_at
             FROM indexed_files
             WHERE (filename LIKE ?1 OR path LIKE ?1) AND file_type = '{}'
             ORDER BY modified_at DESC LIMIT ?2", ft
        )
    } else {
        "SELECT id, path, filename, extension, file_type, size_bytes, folder, depth, created_at, modified_at, indexed_at
         FROM indexed_files
         WHERE filename LIKE ?1 OR path LIKE ?1
         ORDER BY modified_at DESC LIMIT ?2".to_string()
    };

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![search, lim], |row| {
        Ok(IndexedFile {
            id: row.get(0)?,
            path: row.get(1)?,
            filename: row.get(2)?,
            extension: row.get(3)?,
            file_type: row.get(4)?,
            size_bytes: row.get(5)?,
            folder: row.get(6)?,
            depth: row.get(7)?,
            created_at: row.get(8)?,
            modified_at: row.get(9)?,
            indexed_at: row.get(10)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Get recently modified files (last N hours).
pub fn get_recent_files(hours: u32, limit: usize) -> Vec<IndexedFile> {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let cutoff = chrono::Utc::now().timestamp() - (hours as i64 * 3600);
    let lim = limit.min(50) as i64;

    let mut stmt = match conn.prepare(
        "SELECT id, path, filename, extension, file_type, size_bytes, folder, depth, created_at, modified_at, indexed_at
         FROM indexed_files WHERE modified_at > ?1
         ORDER BY modified_at DESC LIMIT ?2"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![cutoff, lim], |row| {
        Ok(IndexedFile {
            id: row.get(0)?,
            path: row.get(1)?,
            filename: row.get(2)?,
            extension: row.get(3)?,
            file_type: row.get(4)?,
            size_bytes: row.get(5)?,
            folder: row.get(6)?,
            depth: row.get(7)?,
            created_at: row.get(8)?,
            modified_at: row.get(9)?,
            indexed_at: row.get(10)?,
        })
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Get file count by type (for dashboard stats).
pub fn get_file_stats() -> Vec<(String, i64)> {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        "SELECT file_type, COUNT(*) FROM indexed_files GROUP BY file_type ORDER BY COUNT(*) DESC"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })
    .ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Get a context summary for brain.rs — what files does the user have?
pub fn get_file_context() -> String {
    let stats = get_file_stats();
    if stats.is_empty() { return String::new(); }

    let total: i64 = stats.iter().map(|(_, c)| c).sum();
    let breakdown: Vec<String> = stats.iter()
        .filter(|(_, c)| *c > 0)
        .map(|(t, c)| format!("{}: {}", t, c))
        .collect();

    format!("**Indexed files:** {} total ({})", total, breakdown.join(", "))
}

// ── Background scan loop ─────────────────────────────────────────────────────

/// Start a background file indexing loop. Runs initial scan on startup,
/// then incremental rescan every 30 minutes.
pub fn start_file_indexer(_app: tauri::AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) { return; }

    tauri::async_runtime::spawn(async move {
        // Initial scan after 30s delay (don't slow down startup)
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

        // Only scan if GH (growth hormone) allows it
        let gh = crate::homeostasis::growth_hormone();
        if gh > 0.2 {
            tokio::task::spawn_blocking(run_full_scan).await.ok();
        }

        // Rescan every 30 minutes
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30 * 60)).await;
            let gh = crate::homeostasis::growth_hormone();
            if gh > 0.3 {
                tokio::task::spawn_blocking(run_full_scan).await.ok();
            }
        }
    });
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn file_index_scan_now() -> u32 {
    run_full_scan()
}

#[tauri::command]
pub fn file_index_search(query: String, file_type: Option<String>, limit: Option<usize>) -> Vec<IndexedFile> {
    search_files(&query, file_type.as_deref(), limit.unwrap_or(20))
}

#[tauri::command]
pub fn file_index_recent(hours: Option<u32>, limit: Option<usize>) -> Vec<IndexedFile> {
    get_recent_files(hours.unwrap_or(24), limit.unwrap_or(20))
}

#[tauri::command]
pub fn file_index_stats() -> Vec<(String, i64)> {
    get_file_stats()
}
