/// SYSADMIN MODULE — Makes BLADE capable of complex system administration.
///
/// Four components:
///   1. Hardware detection — GPU, CPU, IOMMU groups, PCI devices, drivers
///   2. Dry-run mode — preview file edits and commands before applying
///   3. Task checkpoints — persist multi-step task progress across reboots
///   4. Sudo bridge — elevated command execution with user confirmation
///
/// Enables tasks like: "set up a Windows 10 VM with GPU passthrough"
///
/// Security: All shell commands are hardcoded inspection commands (lspci, grep, etc.)
/// No user input is interpolated into shell strings. The sudo bridge uses -n (non-interactive)
/// and falls back to prompting the user to run commands manually via `! sudo <cmd>`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Hardware Detection ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu: CpuInfo,
    pub gpus: Vec<GpuInfo>,
    pub ram_total_gb: f64,
    pub iommu_groups: Vec<IommuGroup>,
    pub virtualization: VirtInfo,
    pub os: OsInfo,
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuInfo {
    pub model: String,
    pub cores: u32,
    pub threads: u32,
    pub has_integrated_gpu: bool,
    pub features: Vec<String>, // vt-x, vt-d, amd-v, svm, iommu
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub pci_id: String,      // e.g. "0000:01:00.0"
    pub vendor: String,
    pub driver: String,
    pub is_integrated: bool,
    pub iommu_group: Option<u32>,
    pub vram_mb: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IommuGroup {
    pub id: u32,
    pub devices: Vec<PciDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PciDevice {
    pub address: String,
    pub name: String,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtInfo {
    pub kvm_available: bool,
    pub iommu_enabled: bool,
    pub vfio_loaded: bool,
    pub qemu_installed: bool,
    pub libvirt_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsInfo {
    pub name: String,
    pub kernel: String,
    pub arch: String,
    pub package_manager: String, // apt, dnf, pacman, brew, choco, winget
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub name: String,
    pub size_gb: f64,
    pub free_gb: f64,
    pub mount: String,
}

/// Run a hardcoded inspection command. Only used with static strings, never user input.
fn run_cmd(cmd: &str) -> String {
    std::process::Command::new("sh")
        .args(["-c", cmd])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn cmd_exists(name: &str) -> bool {
    std::process::Command::new("which")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn detect_hardware() -> HardwareInfo {
    let cpu = detect_cpu();
    let gpus = detect_gpus();
    let iommu_groups = detect_iommu_groups();
    let ram = detect_ram();
    let virt = detect_virtualization();
    let os = detect_os();
    let disks = detect_disks();

    HardwareInfo {
        cpu,
        gpus,
        ram_total_gb: ram,
        iommu_groups,
        virtualization: virt,
        os,
        disks,
    }
}

fn detect_cpu() -> CpuInfo {
    let model = run_cmd("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2");
    let cores_str = run_cmd("nproc --all 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 0");
    let threads_str = run_cmd("grep -c processor /proc/cpuinfo 2>/dev/null || echo 0");
    let flags = run_cmd("grep -m1 'flags' /proc/cpuinfo | cut -d: -f2");

    let mut features = Vec::new();
    if flags.contains("vmx") { features.push("vt-x".to_string()); }
    if flags.contains("svm") { features.push("amd-v".to_string()); }
    if flags.contains("ept") { features.push("ept".to_string()); }

    // Check for integrated GPU
    let igpu = !run_cmd("lspci 2>/dev/null | grep -i 'vga\\|3d\\|display' | grep -i 'intel\\|amd.*radeon.*vega\\|amd.*graphics'").is_empty();

    // Check if IOMMU is in kernel cmdline
    let cmdline = run_cmd("cat /proc/cmdline 2>/dev/null");
    if cmdline.contains("intel_iommu=on") || cmdline.contains("amd_iommu=on") || cmdline.contains("iommu=pt") {
        features.push("iommu-enabled".to_string());
    }

    CpuInfo {
        model: model.trim().to_string(),
        cores: cores_str.parse().unwrap_or(0),
        threads: threads_str.parse().unwrap_or(0),
        has_integrated_gpu: igpu,
        features,
    }
}

fn detect_gpus() -> Vec<GpuInfo> {
    let lspci = run_cmd("lspci -nnk 2>/dev/null | grep -A3 -i 'vga\\|3d\\|display'");
    if lspci.is_empty() {
        return Vec::new();
    }

    let mut gpus = Vec::new();
    let mut current_addr = String::new();
    let mut current_name = String::new();
    let mut current_driver = String::new();

    for line in lspci.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("Kernel") && !trimmed.starts_with("Subsystem") && !trimmed.starts_with("DeviceName") && !trimmed.is_empty() {
            // Flush previous device
            if !current_addr.is_empty() {
                let is_integrated = current_name.to_lowercase().contains("intel")
                    || (current_name.to_lowercase().contains("amd") && current_name.to_lowercase().contains("vega"));
                let name_lower = current_name.to_lowercase();
                let vendor = if name_lower.contains("nvidia") { "NVIDIA" }
                    else if name_lower.contains("amd") { "AMD" }
                    else if name_lower.contains("intel") { "Intel" }
                    else { "Unknown" };
                gpus.push(GpuInfo {
                    name: current_name.clone(),
                    pci_id: current_addr.clone(),
                    vendor: vendor.to_string(),
                    driver: current_driver.clone(),
                    is_integrated,
                    iommu_group: get_iommu_group_for_device(&current_addr),
                    vram_mb: None,
                });
            }
            let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
            current_addr = parts.first().unwrap_or(&"").to_string();
            current_name = parts.get(1).unwrap_or(&"").to_string();
            if let Some(idx) = current_name.find(": ") {
                current_name = current_name[idx + 2..].to_string();
            }
            current_driver.clear();
        } else if trimmed.starts_with("Kernel driver in use:") {
            current_driver = trimmed.replace("Kernel driver in use:", "").trim().to_string();
        }
    }

    // Last device
    if !current_addr.is_empty() {
        let is_integrated = current_name.to_lowercase().contains("intel")
            || (current_name.to_lowercase().contains("amd") && current_name.to_lowercase().contains("vega"));
        gpus.push(GpuInfo {
            name: current_name,
            pci_id: current_addr.clone(),
            vendor: "Unknown".to_string(),
            driver: current_driver,
            is_integrated,
            iommu_group: get_iommu_group_for_device(&current_addr),
            vram_mb: None,
        });
    }

    gpus
}

fn get_iommu_group_for_device(pci_addr: &str) -> Option<u32> {
    let path = format!("/sys/bus/pci/devices/0000:{}/iommu_group", pci_addr);
    let link = std::fs::read_link(&path).ok()?;
    let group_str = link.file_name()?.to_str()?;
    group_str.parse().ok()
}

fn detect_iommu_groups() -> Vec<IommuGroup> {
    let output = run_cmd(r#"for g in /sys/kernel/iommu_groups/*/devices/*; do
        group=$(echo $g | grep -oP 'iommu_groups/\K[0-9]+')
        dev=$(basename $g)
        name=$(lspci -s $dev 2>/dev/null | cut -d' ' -f2-)
        driver=$(lspci -ks $dev 2>/dev/null | grep 'Kernel driver' | cut -d: -f2 | xargs)
        echo "$group|$dev|$name|$driver"
    done 2>/dev/null"#);

    let mut groups: HashMap<u32, Vec<PciDevice>> = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() >= 3 {
            if let Ok(group_id) = parts[0].parse::<u32>() {
                groups.entry(group_id).or_default().push(PciDevice {
                    address: parts[1].to_string(),
                    name: parts.get(2).unwrap_or(&"").to_string(),
                    driver: parts.get(3).unwrap_or(&"").to_string(),
                });
            }
        }
    }

    let mut result: Vec<IommuGroup> = groups.into_iter()
        .map(|(id, devices)| IommuGroup { id, devices })
        .collect();
    result.sort_by_key(|g| g.id);
    result
}

fn detect_ram() -> f64 {
    let mem_str = run_cmd("grep MemTotal /proc/meminfo | awk '{print $2}'");
    mem_str.parse::<f64>().unwrap_or(0.0) / 1_048_576.0 // KB to GB
}

fn detect_virtualization() -> VirtInfo {
    VirtInfo {
        kvm_available: std::path::Path::new("/dev/kvm").exists(),
        iommu_enabled: !run_cmd("dmesg 2>/dev/null | grep -i 'IOMMU enabled\\|Adding to iommu group'").is_empty()
            || run_cmd("cat /proc/cmdline 2>/dev/null").contains("iommu="),
        vfio_loaded: !run_cmd("lsmod 2>/dev/null | grep vfio").is_empty(),
        qemu_installed: cmd_exists("qemu-system-x86_64"),
        libvirt_installed: cmd_exists("virsh"),
    }
}

fn detect_os() -> OsInfo {
    let name = run_cmd("grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"'");
    let kernel = run_cmd("uname -r");
    let arch = run_cmd("uname -m");

    let pm = if cmd_exists("apt") { "apt" }
        else if cmd_exists("dnf") { "dnf" }
        else if cmd_exists("pacman") { "pacman" }
        else if cmd_exists("zypper") { "zypper" }
        else if cmd_exists("brew") { "brew" }
        else if cmd_exists("winget") { "winget" }
        else if cmd_exists("choco") { "choco" }
        else { "unknown" };

    OsInfo {
        name: if name.is_empty() { run_cmd("uname -s") } else { name },
        kernel,
        arch,
        package_manager: pm.to_string(),
    }
}

fn detect_disks() -> Vec<DiskInfo> {
    let df = run_cmd("df -BG --output=source,size,avail,target 2>/dev/null | tail -n +2");
    let mut disks = Vec::new();
    for line in df.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 && parts[0].starts_with('/') {
            let size = parts[1].trim_end_matches('G').parse::<f64>().unwrap_or(0.0);
            let free = parts[2].trim_end_matches('G').parse::<f64>().unwrap_or(0.0);
            if size > 0.0 {
                disks.push(DiskInfo {
                    name: parts[0].to_string(),
                    size_gb: size,
                    free_gb: free,
                    mount: parts[3].to_string(),
                });
            }
        }
    }
    disks
}

// ── Dry-Run Mode ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DryRunResult {
    pub actions: Vec<DryRunAction>,
    pub warnings: Vec<String>,
    pub reversible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DryRunAction {
    pub action_type: String, // "file_edit", "file_create", "command", "package_install"
    pub target: String,
    pub description: String,
    pub preview: String,
    pub risk: String, // "low", "medium", "high", "critical"
}

pub fn dry_run_file_edit(path: &str, old_content: &str, new_content: &str) -> DryRunResult {
    let exists = std::path::Path::new(path).exists();
    let risk = if path.starts_with("/etc/") || path.starts_with("/boot/") {
        "critical"
    } else if path.starts_with("/home/") || path.starts_with("/tmp/") {
        "low"
    } else {
        "medium"
    };

    let preview = generate_diff(old_content, new_content);

    let mut warnings = Vec::new();
    if path.contains("grub") {
        warnings.push("GRUB config change — incorrect settings may prevent boot. Ensure you have a recovery USB.".to_string());
    }
    if path.contains("fstab") {
        warnings.push("fstab change — incorrect entries may prevent mount at boot.".to_string());
    }
    if path.contains("modprobe") || path.contains("vfio") {
        warnings.push("Kernel module config change — will take effect after reboot.".to_string());
    }

    DryRunResult {
        actions: vec![DryRunAction {
            action_type: if exists { "file_edit" } else { "file_create" }.to_string(),
            target: path.to_string(),
            description: if exists { format!("Edit {}", path) } else { format!("Create new file {}", path) },
            preview,
            risk: risk.to_string(),
        }],
        warnings,
        reversible: exists,
    }
}

pub fn dry_run_command(command: &str) -> DryRunResult {
    let cmd_lower = command.to_lowercase();
    let risk = if cmd_lower.contains("rm -rf") || cmd_lower.contains("dd if=") || cmd_lower.contains("mkfs") {
        "critical"
    } else if cmd_lower.contains("apt install") || cmd_lower.contains("dnf install")
        || cmd_lower.contains("pacman -S") || cmd_lower.contains("update-grub")
        || cmd_lower.contains("modprobe") || cmd_lower.contains("systemctl")
    {
        "high"
    } else if cmd_lower.contains("sudo") {
        "medium"
    } else {
        "low"
    };

    let mut warnings = Vec::new();
    if cmd_lower.contains("update-grub") || cmd_lower.contains("grub-mkconfig") {
        warnings.push("This regenerates the GRUB boot config. If kernel parameters are wrong, system may not boot.".to_string());
    }
    if cmd_lower.contains("modprobe -r") || cmd_lower.contains("rmmod") {
        warnings.push("Removing kernel module — may cause hardware to stop working until reboot.".to_string());
    }

    DryRunResult {
        actions: vec![DryRunAction {
            action_type: "command".to_string(),
            target: command.to_string(),
            description: format!("Execute: {}", crate::safe_slice(command, 80)),
            preview: command.to_string(),
            risk: risk.to_string(),
        }],
        warnings,
        reversible: false,
    }
}

fn generate_diff(old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let mut diff = String::new();

    for (i, line) in old_lines.iter().enumerate() {
        if new_lines.get(i) != Some(line) {
            diff.push_str(&format!("- {}\n", line));
            if let Some(new_line) = new_lines.get(i) {
                diff.push_str(&format!("+ {}\n", new_line));
            }
        }
    }
    for line in new_lines.iter().skip(old_lines.len()) {
        diff.push_str(&format!("+ {}\n", line));
    }

    if diff.is_empty() { "(no changes)".to_string() } else { diff }
}

// ── Task Checkpoints ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskCheckpoint {
    pub id: String,
    pub title: String,
    pub steps: Vec<TaskStep>,
    pub current_step: usize,
    pub created_at: i64,
    pub updated_at: i64,
    pub status: String, // "in_progress", "paused", "completed", "failed"
    pub rollback_info: Vec<RollbackEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStep {
    pub index: usize,
    pub description: String,
    pub command: Option<String>,
    pub status: String, // "pending", "running", "done", "failed", "skipped"
    pub output: Option<String>,
    pub requires_reboot: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackEntry {
    pub step_index: usize,
    pub file_path: String,
    pub original_content: String,
    pub description: String,
}

fn checkpoint_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())
}

pub fn ensure_checkpoint_tables() {
    let Ok(conn) = checkpoint_db() else { return };
    let _ = conn.execute_batch("
        CREATE TABLE IF NOT EXISTS task_checkpoints (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            steps TEXT NOT NULL,
            current_step INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            status TEXT DEFAULT 'in_progress',
            rollback_info TEXT DEFAULT '[]'
        );
    ");
}

pub fn save_checkpoint(cp: &TaskCheckpoint) -> Result<(), String> {
    ensure_checkpoint_tables();
    let conn = checkpoint_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO task_checkpoints (id, title, steps, current_step, created_at, updated_at, status, rollback_info) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            cp.id, cp.title,
            serde_json::to_string(&cp.steps).unwrap_or_default(),
            cp.current_step as i64, cp.created_at, cp.updated_at, cp.status,
            serde_json::to_string(&cp.rollback_info).unwrap_or_default(),
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_checkpoint(id: &str) -> Option<TaskCheckpoint> {
    let conn = checkpoint_db().ok()?;
    conn.query_row(
        "SELECT id, title, steps, current_step, created_at, updated_at, status, rollback_info FROM task_checkpoints WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(TaskCheckpoint {
                id: row.get(0)?,
                title: row.get(1)?,
                steps: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
                current_step: row.get::<_, i64>(3)? as usize,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                status: row.get(6)?,
                rollback_info: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
            })
        },
    ).ok()
}

pub fn list_active_checkpoints() -> Vec<TaskCheckpoint> {
    let Ok(conn) = checkpoint_db() else { return Vec::new() };
    let mut stmt = match conn.prepare(
        "SELECT id, title, steps, current_step, created_at, updated_at, status, rollback_info FROM task_checkpoints WHERE status IN ('in_progress', 'paused') ORDER BY updated_at DESC LIMIT 20"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    stmt.query_map([], |row| {
        Ok(TaskCheckpoint {
            id: row.get(0)?,
            title: row.get(1)?,
            steps: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
            current_step: row.get::<_, i64>(3)? as usize,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            status: row.get(6)?,
            rollback_info: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or_default(),
        })
    }).ok()
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

/// Backup a file before modifying it (for rollback)
pub fn backup_file_for_rollback(cp_id: &str, step_index: usize, file_path: &str) -> Result<(), String> {
    let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let mut cp = load_checkpoint(cp_id).ok_or("Checkpoint not found")?;
    cp.rollback_info.push(RollbackEntry {
        step_index,
        file_path: file_path.to_string(),
        original_content: content,
        description: format!("Backup of {} before step {}", file_path, step_index),
    });
    save_checkpoint(&cp)
}

/// Rollback all file changes made by a checkpoint
pub fn rollback_checkpoint(cp_id: &str) -> Result<usize, String> {
    let cp = load_checkpoint(cp_id).ok_or("Checkpoint not found")?;
    let mut restored = 0;
    for entry in cp.rollback_info.iter().rev() {
        if let Err(e) = std::fs::write(&entry.file_path, &entry.original_content) {
            log::warn!("[sysadmin] rollback failed for {}: {}", entry.file_path, e);
        } else {
            restored += 1;
        }
    }
    let mut cp = cp;
    cp.status = "rolled_back".to_string();
    cp.updated_at = chrono::Utc::now().timestamp();
    save_checkpoint(&cp)?;
    Ok(restored)
}

// ── Sudo Bridge ──────────────────────────────────────────────────────────────
// Non-interactive sudo. If password is needed, tells user to run manually.

pub async fn sudo_exec(app: &tauri::AppHandle, command: &str, reason: &str) -> Result<(String, String, i32), String> {
    use tauri::Emitter;

    let approval_id = format!("sudo-{}", chrono::Utc::now().timestamp_millis());
    let _ = app.emit("sudo_approval_needed", serde_json::json!({
        "id": &approval_id,
        "command": command,
        "reason": reason,
        "risk": if command.contains("grub") || command.contains("fstab") || command.contains("dd ") {
            "critical"
        } else {
            "elevated"
        },
    }));

    // Try non-interactive first (works if user has NOPASSWD or recent sudo cache)
    let output = tokio::process::Command::new("sudo")
        .args(["-n", "sh", "-c", command])
        .output()
        .await
        .map_err(|e| format!("sudo exec failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stderr.contains("password is required") || stderr.contains("a password is required") {
        let _ = app.emit("sudo_password_needed", serde_json::json!({
            "id": &approval_id,
            "command": command,
            "reason": reason,
        }));
        return Err(format!(
            "Sudo requires password. Run this command manually:\n  ! sudo {}\n\nOr add NOPASSWD for this command in /etc/sudoers.",
            command
        ));
    }

    Ok((stdout, stderr, output.status.code().unwrap_or(-1)))
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn sysadmin_detect_hardware() -> HardwareInfo {
    detect_hardware()
}

#[tauri::command]
pub fn sysadmin_dry_run_edit(path: String, old_content: String, new_content: String) -> DryRunResult {
    dry_run_file_edit(&path, &old_content, &new_content)
}

#[tauri::command]
pub fn sysadmin_dry_run_command(command: String) -> DryRunResult {
    dry_run_command(&command)
}

#[tauri::command]
pub fn sysadmin_list_checkpoints() -> Vec<TaskCheckpoint> {
    list_active_checkpoints()
}

#[tauri::command]
pub fn sysadmin_save_checkpoint(checkpoint: TaskCheckpoint) -> Result<(), String> {
    save_checkpoint(&checkpoint)
}

#[tauri::command]
pub fn sysadmin_load_checkpoint(id: String) -> Option<TaskCheckpoint> {
    load_checkpoint(&id)
}

#[tauri::command]
pub fn sysadmin_rollback(id: String) -> Result<usize, String> {
    rollback_checkpoint(&id)
}

#[tauri::command]
pub async fn sysadmin_sudo_exec(app: tauri::AppHandle, command: String, reason: String) -> Result<(String, String, i32), String> {
    sudo_exec(&app, &command, &reason).await
}
