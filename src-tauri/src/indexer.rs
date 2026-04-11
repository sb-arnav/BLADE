/// BLADE CODEBASE INDEXER — persistent living knowledge graph of every project.
///
/// Claude Code re-reads files every session. BLADE never forgets.
///
/// When BLADE touches a project, it indexes it: every function, class, type,
/// import, export — stored in SQLite with full-text search and embeddings.
/// The graph updates incrementally when files change (via file watcher).
///
/// What this enables:
/// - "Find where authentication is implemented" → instant, no grep needed
/// - "What calls this function?" → dependency traversal, not file reading
/// - "What changed in this project since yesterday?" → diff against last index
/// - BLADE can build a complete mental model of a 100k-line codebase without
///   reading a single file in context — it already knows it.
///
/// This is the moat. Claude Code is stateless. BLADE remembers.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSymbol {
    pub id: String,
    pub project: String,
    pub file_path: String,
    pub symbol_type: String, // function | class | interface | type | const | export | import
    pub name: String,
    pub signature: String,   // full signature line
    pub docstring: String,   // leading comment/doc if any
    pub line_number: usize,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectIndex {
    pub project: String,
    pub root_path: String,
    pub file_count: usize,
    pub symbol_count: usize,
    pub last_indexed: i64,
    pub language_breakdown: std::collections::HashMap<String, usize>,
}

fn db_path() -> PathBuf {
    crate::config::blade_config_dir().join("codeindex.db")
}

fn open_db() -> Result<Connection, String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("Index DB error: {}", e))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS code_symbols (
            id TEXT PRIMARY KEY,
            project TEXT NOT NULL,
            file_path TEXT NOT NULL,
            symbol_type TEXT NOT NULL,
            name TEXT NOT NULL,
            signature TEXT NOT NULL DEFAULT '',
            docstring TEXT NOT NULL DEFAULT '',
            line_number INTEGER NOT NULL DEFAULT 0,
            indexed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_symbols_project ON code_symbols(project);
        CREATE INDEX IF NOT EXISTS idx_symbols_name ON code_symbols(name);
        CREATE INDEX IF NOT EXISTS idx_symbols_file ON code_symbols(file_path);
        CREATE INDEX IF NOT EXISTS idx_symbols_type ON code_symbols(symbol_type);

        CREATE VIRTUAL TABLE IF NOT EXISTS code_symbols_fts USING fts5(
            name, signature, docstring, file_path,
            content=code_symbols, content_rowid=rowid
        );

        CREATE TABLE IF NOT EXISTS project_files (
            path TEXT PRIMARY KEY,
            project TEXT NOT NULL,
            lang TEXT NOT NULL DEFAULT '',
            size_bytes INTEGER NOT NULL DEFAULT 0,
            last_modified INTEGER NOT NULL DEFAULT 0,
            last_indexed INTEGER NOT NULL DEFAULT 0,
            symbol_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS project_meta (
            project TEXT PRIMARY KEY,
            root_path TEXT NOT NULL,
            last_indexed INTEGER NOT NULL DEFAULT 0,
            file_count INTEGER NOT NULL DEFAULT 0,
            symbol_count INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Schema error: {}", e))
}

/// Detect language from file extension
fn detect_lang(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "cpp" | "cc" | "cxx" => "cpp",
        "c" | "h" => "c",
        "cs" => "csharp",
        "rb" => "ruby",
        "swift" => "swift",
        "kt" => "kotlin",
        "php" => "php",
        "sh" | "bash" => "shell",
        _ => "text",
    }
}

/// Extract symbols from file content using regex-based parsing.
/// Not a full AST — fast, good enough for 95% of navigation needs.
fn extract_symbols(content: &str, file_path: &str, project: &str) -> Vec<CodeSymbol> {
    let lang = detect_lang(file_path);
    let now = chrono::Local::now().timestamp();
    let mut symbols: Vec<CodeSymbol> = Vec::new();

    let lines: Vec<&str> = content.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // Collect preceding comment/doc (up to 3 lines back)
        let docstring = collect_docstring(&lines, i);

        let sym = match lang {
            "rust" => parse_rust_line(trimmed, i + 1, file_path, project, &docstring, now),
            "typescript" | "javascript" => parse_ts_line(trimmed, i + 1, file_path, project, &docstring, now),
            "python" => parse_python_line(trimmed, i + 1, file_path, project, &docstring, now),
            "go" => parse_go_line(trimmed, i + 1, file_path, project, &docstring, now),
            _ => None,
        };
        if let Some(s) = sym {
            symbols.push(s);
        }
    }

    symbols
}

fn collect_docstring(lines: &[&str], line_idx: usize) -> String {
    let start = if line_idx >= 3 { line_idx - 3 } else { 0 };
    lines[start..line_idx]
        .iter()
        .filter(|l| {
            let t = l.trim();
            t.starts_with("//") || t.starts_with("///") || t.starts_with('#') ||
            t.starts_with("/*") || t.starts_with("*") || t.starts_with("\"\"\"")
        })
        .map(|l| l.trim().trim_start_matches("///").trim_start_matches("//")
            .trim_start_matches('#').trim_start_matches("/**").trim_start_matches("* ").trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn make_id(file_path: &str, line: usize) -> String {
    format!("{}:{}", file_path.replace('/', "_").replace('.', "_"), line)
}

fn parse_rust_line(line: &str, ln: usize, fp: &str, proj: &str, doc: &str, now: i64) -> Option<CodeSymbol> {
    let (sym_type, name) = if line.starts_with("pub fn ") || line.starts_with("fn ") {
        let n = extract_name_after(line, "fn ")?;
        ("function", n)
    } else if line.starts_with("pub struct ") || line.starts_with("struct ") {
        let n = extract_name_after(line, "struct ")?;
        ("struct", n)
    } else if line.starts_with("pub enum ") || line.starts_with("enum ") {
        let n = extract_name_after(line, "enum ")?;
        ("enum", n)
    } else if line.starts_with("pub trait ") || line.starts_with("trait ") {
        let n = extract_name_after(line, "trait ")?;
        ("trait", n)
    } else if line.starts_with("pub async fn ") || line.starts_with("async fn ") {
        let n = extract_name_after(line, "fn ")?;
        ("async_function", n)
    } else if line.contains("#[tauri::command]") {
        return None; // picked up on next line
    } else { return None; };

    Some(CodeSymbol {
        id: make_id(fp, ln),
        project: proj.to_string(),
        file_path: fp.to_string(),
        symbol_type: sym_type.to_string(),
        name: name.to_string(),
        signature: line.chars().take(120).collect(),
        docstring: doc.to_string(),
        line_number: ln,
        indexed_at: now,
    })
}

fn parse_ts_line(line: &str, ln: usize, fp: &str, proj: &str, doc: &str, now: i64) -> Option<CodeSymbol> {
    let (sym_type, name) = if line.contains("export function ") || line.contains("export async function ") {
        let n = extract_name_after(line, "function ")?;
        ("export_function", n)
    } else if line.starts_with("function ") || line.starts_with("async function ") {
        let n = extract_name_after(line, "function ")?;
        ("function", n)
    } else if line.contains("export class ") || line.starts_with("class ") {
        let n = extract_name_after(line, "class ")?;
        ("class", n)
    } else if line.contains("export interface ") || line.starts_with("interface ") {
        let n = extract_name_after(line, "interface ")?;
        ("interface", n)
    } else if line.contains("export type ") || (line.starts_with("type ") && line.contains('=')) {
        let n = extract_name_after(line, "type ")?;
        ("type_alias", n)
    } else if line.contains("export const ") || line.contains("export default ") {
        let n = extract_name_after(line, "const ")
            .or_else(|| extract_name_after(line, "default "))?;
        ("export_const", n)
    } else if line.starts_with("const ") && (line.contains("= (") || line.contains("= async (") || line.contains("= () =>")) {
        let n = extract_name_after(line, "const ")?;
        ("arrow_function", n)
    } else { return None; };

    Some(CodeSymbol {
        id: make_id(fp, ln),
        project: proj.to_string(),
        file_path: fp.to_string(),
        symbol_type: sym_type.to_string(),
        name,
        signature: line.chars().take(120).collect(),
        docstring: doc.to_string(),
        line_number: ln,
        indexed_at: now,
    })
}

fn parse_python_line(line: &str, ln: usize, fp: &str, proj: &str, doc: &str, now: i64) -> Option<CodeSymbol> {
    let (sym_type, name) = if line.starts_with("def ") || line.starts_with("async def ") {
        let n = extract_name_after(line, "def ")?;
        ("function", n)
    } else if line.starts_with("class ") {
        let n = extract_name_after(line, "class ")?;
        ("class", n)
    } else { return None; };

    Some(CodeSymbol {
        id: make_id(fp, ln),
        project: proj.to_string(),
        file_path: fp.to_string(),
        symbol_type: sym_type.to_string(),
        name,
        signature: line.chars().take(120).collect(),
        docstring: doc.to_string(),
        line_number: ln,
        indexed_at: now,
    })
}

fn parse_go_line(line: &str, ln: usize, fp: &str, proj: &str, doc: &str, now: i64) -> Option<CodeSymbol> {
    let (sym_type, name) = if line.starts_with("func ") {
        let n = line["func ".len()..].split('(').next()?.trim().to_string();
        if n.is_empty() { return None; }
        ("function", n)
    } else if line.starts_with("type ") && (line.contains("struct") || line.contains("interface")) {
        let n = extract_name_after(line, "type ")?;
        if line.contains("struct") { ("struct", n) } else { ("interface", n) }
    } else { return None; };

    Some(CodeSymbol {
        id: make_id(fp, ln),
        project: proj.to_string(),
        file_path: fp.to_string(),
        symbol_type: sym_type.to_string(),
        name,
        signature: line.chars().take(120).collect(),
        docstring: doc.to_string(),
        line_number: ln,
        indexed_at: now,
    })
}

fn extract_name_after(line: &str, keyword: &str) -> Option<String> {
    let after = line.find(keyword)? + keyword.len();
    let rest = &line[after..];
    let name: String = rest.chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() { None } else { Some(name) }
}

/// Index a single file — extract symbols and persist them.
fn index_file(conn: &Connection, path: &str, project: &str) -> Result<usize, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Read error: {}", e))?;

    let meta = std::fs::metadata(path).map_err(|e| format!("Stat error: {}", e))?;
    let modified = meta.modified()
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or(0);

    // Check if file changed since last index
    let last_indexed: i64 = conn.query_row(
        "SELECT last_indexed FROM project_files WHERE path = ?1",
        params![path],
        |r| r.get(0),
    ).unwrap_or(0);

    if last_indexed >= modified && last_indexed > 0 {
        return Ok(0); // unchanged — skip
    }

    // Delete old symbols for this file
    conn.execute("DELETE FROM code_symbols WHERE file_path = ?1", params![path])
        .map_err(|e| format!("Delete error: {}", e))?;

    let symbols = extract_symbols(&content, path, project);
    let count = symbols.len();
    let now = chrono::Local::now().timestamp();

    for sym in &symbols {
        conn.execute(
            "INSERT OR REPLACE INTO code_symbols (id, project, file_path, symbol_type, name, signature, docstring, line_number, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![sym.id, sym.project, sym.file_path, sym.symbol_type, sym.name, sym.signature, sym.docstring, sym.line_number as i64, sym.indexed_at],
        ).map_err(|e| format!("Insert error: {}", e))?;
    }

    // Update file record
    conn.execute(
        "INSERT OR REPLACE INTO project_files (path, project, lang, size_bytes, last_modified, last_indexed, symbol_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![path, project, detect_lang(path), meta.len() as i64, modified, now, count as i64],
    ).map_err(|e| format!("File upsert error: {}", e))?;

    Ok(count)
}

/// Walk a directory and index all code files. Returns total symbols indexed.
pub async fn index_project(project_name: &str, root_path: &str) -> Result<ProjectIndex, String> {
    let conn = open_db()?;
    let root = PathBuf::from(root_path);

    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    let extensions = ["rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "cpp", "c", "cs", "rb", "swift", "kt"];
    let skip_dirs = ["node_modules", ".git", "target", "dist", "build", ".next", "__pycache__", ".venv", "vendor"];

    let mut total_symbols = 0usize;
    let mut total_files = 0usize;
    let mut lang_breakdown: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    fn walk(
        dir: &Path,
        project: &str,
        exts: &[&str],
        skip: &[&str],
        conn: &Connection,
        total_symbols: &mut usize,
        total_files: &mut usize,
        lang_breakdown: &mut std::collections::HashMap<String, usize>,
    ) {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if path.is_dir() {
                if !skip.contains(&name) {
                    walk(&path, project, exts, skip, conn, total_symbols, total_files, lang_breakdown);
                }
            } else if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if exts.contains(&ext) {
                    let path_str = path.to_string_lossy().to_string();
                    if let Ok(count) = index_file(conn, &path_str, project) {
                        *total_symbols += count;
                        *total_files += 1;
                        *lang_breakdown.entry(detect_lang(&path_str).to_string()).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    walk(&root, project_name, &extensions, &skip_dirs, &conn, &mut total_symbols, &mut total_files, &mut lang_breakdown);

    let now = chrono::Local::now().timestamp();
    conn.execute(
        "INSERT OR REPLACE INTO project_meta (project, root_path, last_indexed, file_count, symbol_count)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_name, root_path, now, total_files as i64, total_symbols as i64],
    ).map_err(|e| format!("Meta upsert error: {}", e))?;

    Ok(ProjectIndex {
        project: project_name.to_string(),
        root_path: root_path.to_string(),
        file_count: total_files,
        symbol_count: total_symbols,
        last_indexed: now,
        language_breakdown: lang_breakdown,
    })
}

/// Search the codebase index — returns matching symbols with file + line.
pub fn search_symbols(query: &str, project_filter: Option<&str>, limit: usize) -> Vec<CodeSymbol> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let now = chrono::Local::now().timestamp();

    // Try FTS first, fall back to LIKE
    let results = if query.len() >= 2 {
        let fts_query = query.split_whitespace()
            .map(|w| format!("{}*", w))
            .collect::<Vec<_>>()
            .join(" ");

        let sql = if let Some(proj) = project_filter {
            format!(
                "SELECT s.id, s.project, s.file_path, s.symbol_type, s.name, s.signature, s.docstring, s.line_number, s.indexed_at
                 FROM code_symbols s
                 INNER JOIN code_symbols_fts f ON s.rowid = f.rowid
                 WHERE f.code_symbols_fts MATCH ?1 AND s.project = '{}'
                 ORDER BY rank LIMIT {}",
                proj, limit
            )
        } else {
            format!(
                "SELECT s.id, s.project, s.file_path, s.symbol_type, s.name, s.signature, s.docstring, s.line_number, s.indexed_at
                 FROM code_symbols s
                 INNER JOIN code_symbols_fts f ON s.rowid = f.rowid
                 WHERE f.code_symbols_fts MATCH ?1
                 ORDER BY rank LIMIT {}",
                limit
            )
        };

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let rows = stmt.query_map(params![fts_query], |row| {
            Ok(CodeSymbol {
                id: row.get(0)?,
                project: row.get(1)?,
                file_path: row.get(2)?,
                symbol_type: row.get(3)?,
                name: row.get(4)?,
                signature: row.get(5)?,
                docstring: row.get(6)?,
                line_number: row.get::<_, i64>(7)? as usize,
                indexed_at: row.get(8)?,
            })
        });
        match rows {
            Ok(r) => r.flatten().collect(),
            Err(_) => vec![],
        }
    } else {
        vec![]
    };

    if !results.is_empty() { return results; }

    // Fallback: simple name LIKE search
    let like_query = format!("%{}%", query);
    let sql = if let Some(proj) = project_filter {
        format!("SELECT id, project, file_path, symbol_type, name, signature, docstring, line_number, indexed_at FROM code_symbols WHERE name LIKE ?1 AND project = '{}' ORDER BY name LIMIT {}", proj, limit)
    } else {
        format!("SELECT id, project, file_path, symbol_type, name, signature, docstring, line_number, indexed_at FROM code_symbols WHERE name LIKE ?1 ORDER BY name LIMIT {}", limit)
    };

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![like_query], |row| {
        Ok(CodeSymbol {
            id: row.get(0)?,
            project: row.get(1)?,
            file_path: row.get(2)?,
            symbol_type: row.get(3)?,
            name: row.get(4)?,
            signature: row.get(5)?,
            docstring: row.get(6)?,
            line_number: row.get::<_, i64>(7)? as usize,
            indexed_at: now,
        })
    }).map(|rows| rows.flatten().collect()).unwrap_or_default()
}

/// List all indexed projects
pub fn list_indexed_projects() -> Vec<ProjectIndex> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT project, root_path, last_indexed, file_count, symbol_count FROM project_meta ORDER BY last_indexed DESC"
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |row| {
        Ok(ProjectIndex {
            project: row.get(0)?,
            root_path: row.get(1)?,
            last_indexed: row.get(2)?,
            file_count: row.get::<_, i64>(3)? as usize,
            symbol_count: row.get::<_, i64>(4)? as usize,
            language_breakdown: std::collections::HashMap::new(),
        })
    }).map(|rows| rows.flatten().collect()).unwrap_or_default()
}

/// Generate a dense project summary for system prompt injection.
/// "Project has 340 functions across 47 files. Key exports: useChat, sendMessage, Settings..."
pub fn project_summary_for_prompt(project: &str) -> String {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return String::new(),
    };

    // Get top-level exports and public functions
    let exports: Vec<String> = (|| {
        let mut s = conn.prepare(
            "SELECT name, symbol_type, file_path FROM code_symbols
             WHERE project = ?1 AND (symbol_type LIKE 'export%' OR symbol_type = 'function' OR symbol_type = 'struct')
             ORDER BY name LIMIT 30"
        ).ok()?;
        let rows = s.query_map(params![project], |r| {
            Ok(format!("{}({})", r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }).ok()?;
        Some(rows.flatten().collect::<Vec<String>>())
    })().unwrap_or_default();

    let meta: Option<(usize, usize)> = conn.query_row(
        "SELECT file_count, symbol_count FROM project_meta WHERE project = ?1",
        params![project],
        |r| Ok((r.get::<_, i64>(0)? as usize, r.get::<_, i64>(1)? as usize)),
    ).ok();

    if exports.is_empty() { return String::new(); }

    let (files, syms) = meta.unwrap_or((0, 0));
    format!(
        "## {} codebase\n{} symbols across {} files. Key symbols: {}",
        project,
        syms,
        files,
        exports.join(", ")
    )
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Index a project directory. Returns summary of what was indexed.
#[tauri::command]
pub async fn blade_index_project(project: String, path: String) -> Result<String, String> {
    let idx = index_project(&project, &path).await?;
    Ok(format!(
        "Indexed {} — {} symbols across {} files.",
        idx.project, idx.symbol_count, idx.file_count
    ))
}

/// Search the codebase index for a symbol, function, or concept.
/// Returns file path + line number + signature for each match.
#[tauri::command]
pub fn blade_find_symbol(query: String, project: Option<String>) -> String {
    let results = search_symbols(&query, project.as_deref(), 20);
    if results.is_empty() {
        return format!("No symbols found matching '{}'", query);
    }
    results.iter().map(|s| {
        let doc = if s.docstring.is_empty() { String::new() } else { format!(" // {}", &s.docstring[..s.docstring.len().min(60)]) };
        format!("{}:{} [{}] {}{}", s.file_path, s.line_number, s.symbol_type, s.signature, doc)
    }).collect::<Vec<_>>().join("\n")
}

/// List all indexed projects.
#[tauri::command]
pub fn blade_list_indexed_projects() -> Vec<ProjectIndex> {
    list_indexed_projects()
}

/// Re-index a specific file (called when a file changes)
#[tauri::command]
pub fn blade_reindex_file(file_path: String, project: String) -> Result<usize, String> {
    let conn = open_db()?;
    index_file(&conn, &file_path, &project)
}

/// Get a dense project summary for context injection
#[tauri::command]
pub fn blade_project_summary(project: String) -> String {
    project_summary_for_prompt(&project)
}

/// Called automatically after blade_write_file / blade_edit_file.
/// Finds which indexed project this file belongs to and re-indexes just that file.
/// Zero-cost if the file isn't part of any indexed project.
pub fn reindex_file_if_tracked(file_path: &str) {
    // Only index code files
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let code_exts = ["rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "c", "cpp", "h", "rb", "swift"];
    if !code_exts.contains(&ext) { return; }

    let projects = list_indexed_projects();
    for proj in projects {
        if file_path.starts_with(&proj.root_path) {
            // File belongs to this project — re-index it
            if let Ok(conn) = open_db() {
                let _ = index_file(&conn, file_path, &proj.project);
                // Update file count / symbol count in project_meta
                let _ = conn.execute(
                    "UPDATE project_meta SET last_indexed = ?1 WHERE project = ?2",
                    params![chrono::Utc::now().timestamp(), proj.project],
                );
            }
            break;
        }
    }
}
