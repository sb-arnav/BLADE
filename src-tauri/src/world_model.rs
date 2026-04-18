use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorldState {
    pub timestamp: i64,
    pub git_repos: Vec<GitRepoState>,
    pub running_processes: Vec<ProcessInfo>,
    pub open_ports: Vec<PortInfo>,
    pub recent_file_changes: Vec<FileChange>,
    pub system_load: SystemLoad,
    pub active_window: String,
    pub workspace_cwd: String,
    pub pending_todos: Vec<TodoItem>,
    pub network_activity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitRepoState {
    pub path: String,
    pub branch: String,
    pub uncommitted: usize,
    pub untracked: usize,
    pub ahead: usize,
    pub last_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
    pub interesting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PortInfo {
    pub port: u16,
    pub process: String,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileChange {
    pub path: String,
    pub changed_at: i64,
    pub change_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SystemLoad {
    pub cpu_cores: usize,
    pub memory_total_mb: u64,
    pub memory_used_mb: u64,
    pub disk_free_gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TodoItem {
    pub file: String,
    pub line: usize,
    pub text: String,
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

static WORLD: std::sync::OnceLock<std::sync::Mutex<WorldState>> = std::sync::OnceLock::new();

fn world() -> &'static std::sync::Mutex<WorldState> {
    WORLD.get_or_init(|| std::sync::Mutex::new(WorldState::default()))
}

// ---------------------------------------------------------------------------
// Git scanning
// ---------------------------------------------------------------------------

fn find_git_root(start: &str) -> Option<String> {
    let mut current = std::path::Path::new(start).to_path_buf();
    loop {
        let git_dir = current.join(".git");
        if git_dir.exists() {
            return Some(current.to_string_lossy().to_string());
        }
        match current.parent() {
            Some(p) => current = p.to_path_buf(),
            None => return None,
        }
    }
}

fn scan_git_repo(repo_path: &str) -> Option<GitRepoState> {
    // Get current branch
    let branch = crate::cmd_util::silent_cmd("git")
        .args(["-C", repo_path, "branch", "--show-current"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Get status --porcelain for uncommitted/untracked
    let status_out = crate::cmd_util::silent_cmd("git")
        .args(["-C", repo_path, "status", "--porcelain"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut uncommitted = 0usize;
    let mut untracked = 0usize;
    for line in status_out.lines() {
        if line.starts_with("??") {
            untracked += 1;
        } else if !line.trim().is_empty() {
            uncommitted += 1;
        }
    }

    // Get ahead count from -sb
    let sb_out = crate::cmd_util::silent_cmd("git")
        .args(["-C", repo_path, "status", "-sb"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let ahead = sb_out
        .lines()
        .next()
        .and_then(|first| {
            // e.g. ## main...origin/main [ahead 2]
            let i = first.find("ahead ")?;
            let rest = &first[i + 6..];
            let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            rest[..end].parse::<usize>().ok()
        })
        .unwrap_or(0);

    // Last commit
    let last_commit = crate::cmd_util::silent_cmd("git")
        .args(["-C", repo_path, "log", "--oneline", "-1"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    Some(GitRepoState {
        path: repo_path.to_string(),
        branch,
        uncommitted,
        untracked,
        ahead,
        last_commit,
    })
}

fn scan_git_repos(cwd: &str) -> Vec<GitRepoState> {
    let mut repo_paths: Vec<String> = Vec::new();

    // Walk up from cwd
    if let Some(root) = find_git_root(cwd) {
        if !repo_paths.contains(&root) {
            repo_paths.push(root);
        }
    }

    // Common dev directories to check
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();

    let extra_dirs = [
        format!("{}/code", home),
        format!("{}/projects", home),
        format!("{}/dev", home),
        format!("{}/src", home),
        format!("{}/Documents", home),
        home.clone(),
    ];

    for dir in &extra_dirs {
        if repo_paths.len() >= 5 {
            break;
        }
        let p = std::path::Path::new(dir);
        if !p.is_dir() {
            continue;
        }
        // Check if this dir itself is a git repo
        if p.join(".git").exists() {
            let s = dir.clone();
            if !repo_paths.contains(&s) {
                repo_paths.push(s);
            }
            continue;
        }
        // Check one level of subdirectories
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                if repo_paths.len() >= 5 {
                    break;
                }
                let sub = entry.path();
                if sub.is_dir() && sub.join(".git").exists() {
                    let s = sub.to_string_lossy().to_string();
                    if !repo_paths.contains(&s) {
                        repo_paths.push(s);
                    }
                }
            }
        }
    }

    repo_paths
        .iter()
        .take(5)
        .filter_map(|p| scan_git_repo(p))
        .collect()
}

// ---------------------------------------------------------------------------
// Port scanning
// ---------------------------------------------------------------------------

const INTERESTING_PORTS: &[u16] = &[
    3000, 4000, 5000, 8000, 8080, 8888, 9000, 3306, 5432, 6379, 27017, 4200, 5173, 3001,
];

fn scan_open_ports() -> Vec<PortInfo> {
    let mut results: Vec<PortInfo> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // netstat -ano outputs lines like:
        //   TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345
        let out = crate::cmd_util::silent_cmd("netstat")
            .args(["-ano"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();

        for line in out.lines() {
            let upper = line.to_uppercase();
            if !upper.contains("LISTENING") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            // parts[0] = TCP/UDP, parts[1] = local addr, parts[4] = PID
            if parts.len() < 5 {
                continue;
            }
            let proto = parts[0].to_string();
            let local = parts[1];
            let pid_str = parts[parts.len() - 1];

            // Extract port from "0.0.0.0:PORT" or "[::]:PORT"
            let port_num: u16 = local
                .rsplit(':')
                .next()
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);

            if port_num == 0 || !INTERESTING_PORTS.contains(&port_num) {
                continue;
            }

            // Try to look up process name from PID using tasklist
            let pid: u32 = pid_str.parse().unwrap_or(0);
            let process_name = get_process_name_by_pid_windows(pid);

            results.push(PortInfo {
                port: port_num,
                process: process_name,
                protocol: proto,
            });

            if results.len() >= 20 {
                break;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Try ss first, fall back to netstat
        let out = crate::cmd_util::silent_cmd("ss")
            .args(["-tlnp"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .or_else(|| {
                crate::cmd_util::silent_cmd("netstat")
                    .args(["-tlnp"])
                    .output()
                    .ok()
                    .filter(|o| o.status.success())
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            })
            .unwrap_or_default();

        for line in out.lines() {
            // Skip header
            if line.starts_with("State") || line.starts_with("Proto") || line.starts_with("Netid") {
                continue;
            }
            // ss format: State Recv-Q Send-Q Local-Address:Port Peer-Address:Port Process
            // netstat format: Proto Recv-Q Send-Q Local-Address Foreign-Address State PID/Program
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }

            // Find local address field (contains ':')
            let local = parts.iter().find(|p| p.contains(':')).copied().unwrap_or("");
            let port_num: u16 = local
                .rsplit(':')
                .next()
                .and_then(|p| p.parse().ok())
                .unwrap_or(0);

            if port_num == 0 || !INTERESTING_PORTS.contains(&port_num) {
                continue;
            }

            // Extract process name from "users:(("node",pid=12345,fd=22))" or PID/name
            let process = parts
                .last()
                .map(|s| {
                    // ss: users:(("node",...))
                    if s.contains("users:") {
                        s.split('"')
                            .nth(1)
                            .unwrap_or("unknown")
                            .to_string()
                    } else if s.contains('/') {
                        // netstat: 12345/node
                        s.split('/').nth(1).unwrap_or("unknown").to_string()
                    } else {
                        "unknown".to_string()
                    }
                })
                .unwrap_or_else(|| "unknown".to_string());

            results.push(PortInfo {
                port: port_num,
                process,
                protocol: "TCP".to_string(),
            });

            if results.len() >= 20 {
                break;
            }
        }
    }

    results
}

#[cfg(target_os = "windows")]
fn get_process_name_by_pid_windows(pid: u32) -> String {
    if pid == 0 {
        return "unknown".to_string();
    }
    crate::cmd_util::silent_cmd("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            // "node.exe","12345","Console","1","10,000 K"
            let line = s.lines().next()?.to_string();
            let name = line.split(',').next()?.trim_matches('"').to_string();
            // Strip .exe suffix for cleanliness
            Some(name.trim_end_matches(".exe").to_string())
        })
        .unwrap_or_else(|| format!("pid:{}", pid))
}

// ---------------------------------------------------------------------------
// Recent file changes
// ---------------------------------------------------------------------------

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", ".git", "dist", "build", "__pycache__", ".next",
    ".svelte-kit", "vendor", ".venv", "venv", ".cargo",
];

fn scan_recent_file_changes(cwd: &str) -> Vec<FileChange> {
    let now = std::time::SystemTime::now();
    let cutoff_secs = 3600u64;
    let mut changes: Vec<FileChange> = Vec::new();

    walk_dir_for_changes(
        std::path::Path::new(cwd),
        0,
        3,
        &now,
        cutoff_secs,
        &mut changes,
    );

    // Sort by most recently modified first
    changes.sort_by(|a, b| b.changed_at.cmp(&a.changed_at));
    changes.truncate(20);
    changes
}

fn walk_dir_for_changes(
    dir: &std::path::Path,
    depth: usize,
    max_depth: usize,
    now: &std::time::SystemTime,
    cutoff_secs: u64,
    results: &mut Vec<FileChange>,
) {
    if depth > max_depth || results.len() >= 100 {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        if path.is_dir() {
            walk_dir_for_changes(&path, depth + 1, max_depth, now, cutoff_secs, results);
        } else if path.is_file() {
            if let Ok(meta) = std::fs::metadata(&path) {
                if let Ok(modified) = meta.modified() {
                    let age = now
                        .duration_since(modified)
                        .map(|d| d.as_secs())
                        .unwrap_or(u64::MAX);
                    if age <= cutoff_secs {
                        let changed_at = modified
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        results.push(FileChange {
                            path: path.to_string_lossy().to_string(),
                            changed_at,
                            change_type: "modified".to_string(),
                        });
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// System load
// ---------------------------------------------------------------------------

fn scan_system_load() -> SystemLoad {
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let (memory_total_mb, memory_used_mb) = get_memory_stats();
    let disk_free_gb = get_disk_free_gb();

    SystemLoad {
        cpu_cores,
        memory_total_mb,
        memory_used_mb,
        disk_free_gb,
    }
}

#[cfg(target_os = "windows")]
fn get_memory_stats() -> (u64, u64) {
    let out = crate::cmd_util::silent_cmd("wmic")
        .args(["OS", "get", "FreePhysicalMemory,TotalVisibleMemorySize", "/VALUE"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut total_kb = 0u64;
    let mut free_kb = 0u64;

    for line in out.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("TotalVisibleMemorySize=") {
            total_kb = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("FreePhysicalMemory=") {
            free_kb = val.trim().parse().unwrap_or(0);
        }
    }

    let total_mb = total_kb / 1024;
    let free_mb = free_kb / 1024;
    let used_mb = total_mb.saturating_sub(free_mb);
    (total_mb, used_mb)
}

#[cfg(target_os = "linux")]
fn get_memory_stats() -> (u64, u64) {
    let content = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let mut total_kb = 0u64;
    let mut available_kb = 0u64;

    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            total_kb = rest.split_whitespace().next().and_then(|v| v.parse().ok()).unwrap_or(0);
        } else if let Some(rest) = line.strip_prefix("MemAvailable:") {
            available_kb = rest.split_whitespace().next().and_then(|v| v.parse().ok()).unwrap_or(0);
        }
    }

    let total_mb = total_kb / 1024;
    let used_mb = total_mb.saturating_sub(available_kb / 1024);
    (total_mb, used_mb)
}

#[cfg(target_os = "macos")]
fn get_memory_stats() -> (u64, u64) {
    // vm_stat gives pages; sysctl gives total
    let total_bytes: u64 = crate::cmd_util::silent_cmd("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        .unwrap_or(0);

    let total_mb = total_bytes / (1024 * 1024);

    // vm_stat is harder to parse; use a rough heuristic
    let used_mb = total_mb * 60 / 100; // rough fallback
    (total_mb, used_mb)
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn get_memory_stats() -> (u64, u64) {
    (0, 0)
}

fn get_disk_free_gb() -> f64 {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());

    #[cfg(target_os = "windows")]
    {
        // Use wmic to get free space on the drive containing home
        let drive = std::path::Path::new(&home)
            .components()
            .next()
            .map(|c| format!("{}", c.as_os_str().to_string_lossy()))
            .unwrap_or_else(|| "C:".to_string());

        crate::cmd_util::silent_cmd("wmic")
            .args(["logicaldisk", &format!("where DeviceID='{}'", drive), "get", "FreeSpace", "/VALUE"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                s.lines()
                    .find(|l| l.starts_with("FreeSpace="))
                    .and_then(|l| l.strip_prefix("FreeSpace="))
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(|bytes| bytes as f64 / (1024.0 * 1024.0 * 1024.0))
            })
            .unwrap_or(0.0)
    }

    #[cfg(not(target_os = "windows"))]
    {
        crate::cmd_util::silent_cmd("df")
            .args(["-k", &home])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                // df -k: Filesystem 1K-blocks Used Available Use% Mounted
                s.lines().nth(1).and_then(|line| {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    // Available is column index 3
                    parts.get(3).and_then(|v| v.parse::<u64>().ok())
                        .map(|kb| kb as f64 / (1024.0 * 1024.0))
                })
            })
            .unwrap_or(0.0)
    }
}

// ---------------------------------------------------------------------------
// Process scanning
// ---------------------------------------------------------------------------

const INTERESTING_PROCESS_NAMES: &[&str] = &[
    "node", "python", "python3", "uvicorn", "gunicorn", "nginx", "postgres", "postgresql",
    "mysql", "mysqld", "redis", "redis-server", "mongod", "mongodb", "cargo", "go", "java",
    "docker", "dockerd", "bun", "deno", "ruby", "rails", "webpack", "vite", "next", "nuxt",
];

fn is_interesting_process(name: &str) -> bool {
    let lower = name.to_lowercase();
    let lower = lower.trim_end_matches(".exe");
    INTERESTING_PROCESS_NAMES
        .iter()
        .any(|&n| lower == n || lower.starts_with(n))
}

fn scan_processes() -> Vec<ProcessInfo> {
    let mut results: Vec<ProcessInfo> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let out = crate::cmd_util::silent_cmd("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();

        for line in out.lines() {
            if results.len() >= 15 {
                break;
            }
            // "node.exe","12345","Console","1","10,000 K"
            let fields: Vec<&str> = line.splitn(5, ',').collect();
            if fields.len() < 2 {
                continue;
            }
            let raw_name = fields[0].trim_matches('"');
            let pid_str = fields[1].trim_matches('"');

            if !is_interesting_process(raw_name) {
                continue;
            }

            let pid: u32 = pid_str.parse().unwrap_or(0);
            let name = raw_name.trim_end_matches(".exe").to_string();

            results.push(ProcessInfo {
                name,
                pid,
                interesting: true,
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let out = crate::cmd_util::silent_cmd("ps")
            .args(["aux"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();

        for line in out.lines().skip(1) {
            if results.len() >= 15 {
                break;
            }
            // USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
            let parts: Vec<&str> = line.splitn(11, ' ').collect();
            if parts.len() < 11 {
                continue;
            }
            let pid: u32 = parts[1].parse().unwrap_or(0);
            let command = parts[10];
            // Get just the binary name (first token of the command)
            let bin_name = command
                .split_whitespace()
                .next()
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("");

            if !is_interesting_process(bin_name) {
                continue;
            }

            results.push(ProcessInfo {
                name: bin_name.to_string(),
                pid,
                interesting: true,
            });
        }
    }

    results
}

// ---------------------------------------------------------------------------
// TODO scanning
// ---------------------------------------------------------------------------

const TODO_EXTENSIONS: &[&str] = &["rs", "ts", "tsx", "js", "jsx", "py", "go"];
const TODO_MARKERS: &[&str] = &["TODO:", "FIXME:", "HACK:", "XXX:", "NOTE:"];

fn find_todos(cwd: &str) -> Vec<TodoItem> {
    let mut todos: Vec<TodoItem> = Vec::new();
    let mut file_count = 0usize;

    collect_todos(
        std::path::Path::new(cwd),
        0,
        4,
        &mut todos,
        &mut file_count,
    );

    todos
}

fn collect_todos(
    dir: &std::path::Path,
    depth: usize,
    max_depth: usize,
    results: &mut Vec<TodoItem>,
    file_count: &mut usize,
) {
    if depth > max_depth || results.len() >= 20 || *file_count >= 200 {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut entries_vec: Vec<_> = entries.flatten().collect();
    // Dirs first so we recurse before counting too many files
    entries_vec.sort_by_key(|e| !e.path().is_dir());

    for entry in entries_vec {
        if results.len() >= 20 || *file_count >= 200 {
            break;
        }

        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        if path.is_dir() {
            collect_todos(&path, depth + 1, max_depth, results, file_count);
        } else if path.is_file() {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();

            if !TODO_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }

            *file_count += 1;

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            for (idx, line) in content.lines().take(500).enumerate() {
                if results.len() >= 20 {
                    break;
                }
                let trimmed = line.trim();
                for marker in TODO_MARKERS {
                    if trimmed.contains(marker) {
                        // Extract the comment text after the marker
                        let text = if let Some(pos) = trimmed.find(marker) {
                            trimmed[pos..].to_string()
                        } else {
                            trimmed.to_string()
                        };
                        results.push(TodoItem {
                            file: path.to_string_lossy().to_string(),
                            line: idx + 1,
                            text,
                        });
                        break; // One marker per line
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Core update function
// ---------------------------------------------------------------------------

pub fn update_world_state(cwd: &str, active_window: &str) {
    let state = WorldState {
        timestamp: chrono::Utc::now().timestamp(),
        git_repos: scan_git_repos(cwd),
        running_processes: scan_processes(),
        open_ports: scan_open_ports(),
        recent_file_changes: scan_recent_file_changes(cwd),
        system_load: scan_system_load(),
        active_window: active_window.to_string(),
        workspace_cwd: cwd.to_string(),
        pending_todos: find_todos(cwd),
        network_activity: String::new(),
    };

    if let Ok(mut w) = world().lock() {
        *w = state;
    }
}

// ---------------------------------------------------------------------------
// Background monitoring loop
// ---------------------------------------------------------------------------

pub fn start_world_model(app: tauri::AppHandle) {
    static RUNNING: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);

    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return; // Already running
    }

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));

            let cwd = std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let window = crate::context::get_active_window()
                .map(|w| format!("{} — {}", w.app_name, w.window_title))
                .unwrap_or_default();

            update_world_state(&cwd, &window);

            let _ = app.emit_to("main", "world_state_updated", get_world_summary());
        }
    });
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

pub fn get_world_state() -> WorldState {
    world().lock().map(|w| w.clone()).unwrap_or_default()
}

pub fn get_world_summary() -> String {
    let state = get_world_state();

    if state.timestamp == 0 {
        return String::new();
    }

    let mut lines: Vec<String> = vec!["## Current World State".to_string()];

    // Git repos
    if state.git_repos.is_empty() {
        lines.push("**Git:** no repos detected".to_string());
    } else {
        let repo_count = state.git_repos.len();
        let total_uncommitted: usize = state.git_repos.iter().map(|r| r.uncommitted).sum();
        let primary = &state.git_repos[0];
        lines.push(format!(
            "**Git:** {} repo{} — {} uncommitted change{} in `{}`{}",
            repo_count,
            if repo_count == 1 { "" } else { "s" },
            total_uncommitted,
            if total_uncommitted == 1 { "" } else { "s" },
            primary.branch,
            if primary.ahead > 0 {
                format!(", {} commit{} ahead of remote", primary.ahead, if primary.ahead == 1 { "" } else { "s" })
            } else {
                String::new()
            }
        ));
        if repo_count > 1 {
            for repo in state.git_repos.iter().skip(1) {
                if repo.uncommitted > 0 || repo.untracked > 0 {
                    lines.push(format!(
                        "  - `{}` ({}): {} uncommitted, {} untracked",
                        std::path::Path::new(&repo.path)
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| repo.path.clone()),
                        repo.branch,
                        repo.uncommitted,
                        repo.untracked,
                    ));
                }
            }
        }
    }

    // Open ports / servers
    if state.open_ports.is_empty() {
        lines.push("**Servers running:** none".to_string());
    } else {
        let port_list: Vec<String> = state
            .open_ports
            .iter()
            .map(|p| {
                if p.process.is_empty() || p.process == "unknown" {
                    format!(":{}", p.port)
                } else {
                    format!(":{} ({})", p.port, p.process)
                }
            })
            .collect();
        lines.push(format!("**Servers running:** {}", port_list.join(", ")));
    }

    // Recent file changes
    if !state.recent_file_changes.is_empty() {
        let top5: Vec<String> = state
            .recent_file_changes
            .iter()
            .take(5)
            .map(|fc| {
                let short_path = std::path::Path::new(&fc.path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| fc.path.clone());
                short_path
            })
            .collect();
        lines.push(format!(
            "**Recent changes:** {} (last hour{})",
            top5.join(", "),
            if state.recent_file_changes.len() > 5 {
                format!(", +{} more", state.recent_file_changes.len() - 5)
            } else {
                String::new()
            }
        ));
    }

    // Running processes
    if !state.running_processes.is_empty() {
        let proc_list: Vec<String> = state
            .running_processes
            .iter()
            .map(|p| p.name.clone())
            .collect();
        lines.push(format!("**Processes:** {}", proc_list.join(", ")));
    }

    // TODOs
    if !state.pending_todos.is_empty() {
        lines.push(format!(
            "**TODOs found:** {} item{} (top: {})",
            state.pending_todos.len(),
            if state.pending_todos.len() == 1 { "" } else { "s" },
            state
                .pending_todos
                .first()
                .map(|t| crate::safe_slice(&t.text, 60).to_string())
                .unwrap_or_default()
        ));
    }

    // System load
    lines.push(format!(
        "**System:** {} core{}, {}/{} MB RAM, {:.1} GB disk free",
        state.system_load.cpu_cores,
        if state.system_load.cpu_cores == 1 { "" } else { "s" },
        state.system_load.memory_used_mb,
        state.system_load.memory_total_mb,
        state.system_load.disk_free_gb,
    ));

    // CWD
    if !state.workspace_cwd.is_empty() {
        lines.push(format!("**CWD:** `{}`", state.workspace_cwd));
    }

    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn world_get_state() -> WorldState {
    get_world_state()
}

#[tauri::command]
pub fn world_get_summary() -> String {
    get_world_summary()
}

#[tauri::command]
pub fn world_refresh() -> WorldState {
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let window = crate::context::get_active_window()
        .map(|w| format!("{} — {}", w.app_name, w.window_title))
        .unwrap_or_default();

    update_world_state(&cwd, &window);
    get_world_state()
}
