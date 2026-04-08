use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_READ_SIZE: usize = 1_000_000; // 1MB

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTree {
    pub path: String,
    pub name: String,
    pub children: Vec<FileTreeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub extension: Option<String>,
    pub children: Option<Vec<FileTreeEntry>>,
}

/// Read a file's contents (text only, capped at 1MB)
#[tauri::command]
pub fn file_read(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }

    let metadata = fs::metadata(p).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_READ_SIZE as u64 {
        return Err(format!(
            "File too large: {} bytes (max {})",
            metadata.len(),
            MAX_READ_SIZE
        ));
    }

    fs::read_to_string(p).map_err(|e| format!("Read error: {}", e))
}

/// Write content to a file (creates parent dirs if needed)
#[tauri::command]
pub fn file_write(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, content).map_err(|e| format!("Write error: {}", e))
}

/// List directory contents
#[tauri::command]
pub fn file_list(path: String) -> Result<Vec<FileInfo>, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(p).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and common noise
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
            continue;
        }

        entries.push(FileInfo {
            path: entry.path().to_string_lossy().to_string(),
            name,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            extension: entry
                .path()
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(entries)
}

/// Get a file tree (recursive, max 2 levels deep)
#[tauri::command]
pub fn file_tree(path: String, max_depth: Option<u32>) -> Result<FileTree, String> {
    let p = PathBuf::from(&path);
    let depth = max_depth.unwrap_or(2);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let children = build_tree(&p, 0, depth)?;

    Ok(FileTree {
        path,
        name,
        children,
    })
}

fn build_tree(dir: &Path, current_depth: u32, max_depth: u32) -> Result<Vec<FileTreeEntry>, String> {
    if current_depth >= max_depth || !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let children = if is_dir {
            Some(build_tree(&entry.path(), current_depth + 1, max_depth)?)
        } else {
            None
        };

        entries.push(FileTreeEntry {
            path: entry.path().to_string_lossy().to_string(),
            name,
            is_dir,
            extension: entry
                .path()
                .extension()
                .map(|e| e.to_string_lossy().to_string()),
            children,
        });
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

/// Check if a path exists
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Create a directory
#[tauri::command]
pub fn file_mkdir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}
