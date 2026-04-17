// src-tauri/src/system_control.rs
// Phase 7: System Control — BLADE's autonomous desktop management layer.
//
// All functions use crate::cmd_util::silent_cmd / silent_tokio_cmd so no
// console window flashes on Windows. Provides both Tauri commands (for
// frontend use) and an LLM tool catalogue that the AI can invoke directly.

use serde_json::json;

const SYSTEM_CONTROL_TOOLS: &[&str] = &[
    "blade_lock_screen",
    "blade_set_volume",
    "blade_set_brightness",
    "blade_launch_app",
    "blade_kill_app",
    "blade_focus_window",
    "blade_battery_status",
    "blade_network_status",
];

/// Check if a tool name belongs to the system_control module.
pub fn is_system_control_tool(name: &str) -> bool {
    SYSTEM_CONTROL_TOOLS.contains(&name)
}

// ── Screen & Power ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn lock_screen() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::cmd_util::silent_cmd("rundll32")
            .args(["user32.dll,LockWorkStation"])
            .spawn()
            .map_err(|e| format!("Failed to lock screen: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        crate::cmd_util::silent_cmd("pmset")
            .args(["displaysleepnow"])
            .spawn()
            .map_err(|e| format!("Failed to lock screen: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Try common lockers in order
        for cmd in &["gnome-screensaver-command", "xdg-screensaver", "loginctl"] {
            let args: &[&str] = match *cmd {
                "gnome-screensaver-command" => &["--lock"],
                "xdg-screensaver" => &["lock"],
                _ => &["lock-session"],
            };
            if crate::cmd_util::silent_cmd(cmd).args(args).spawn().is_ok() {
                return Ok(());
            }
        }
        Err("Could not lock screen: no supported locker found".to_string())
    }
}

#[tauri::command]
pub async fn sleep_computer() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // SetSuspendState(false, false, false): sleep, not hibernate, not force
        crate::cmd_util::silent_cmd("rundll32")
            .args(["powrprof.dll,SetSuspendState", "0", "1", "0"])
            .spawn()
            .map_err(|e| format!("Failed to sleep: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        crate::cmd_util::silent_cmd("pmset")
            .args(["sleepnow"])
            .spawn()
            .map_err(|e| format!("Failed to sleep: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        crate::cmd_util::silent_cmd("systemctl")
            .args(["suspend"])
            .spawn()
            .map_err(|e| format!("Failed to sleep: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn set_brightness(level: u32) -> Result<(), String> {
    let level = level.min(100);
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, {})",
            level
        );
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Set brightness failed: {}", err.trim()));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        // brightness CLI tool (brew install brightness) or fallback osascript
        let fraction = level as f32 / 100.0;
        let script = format!(
            "tell application \"System Events\" to set brightness of screen 1 to {}",
            fraction
        );
        crate::cmd_util::silent_cmd("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Failed to set brightness: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Try brightnessctl if available
        let _ = crate::cmd_util::silent_cmd("brightnessctl")
            .args(["set", &format!("{}%", level)])
            .spawn();
        Ok(())
    }
}

#[tauri::command]
pub async fn set_volume(level: u32) -> Result<(), String> {
    let level = level.min(100);
    #[cfg(target_os = "windows")]
    {
        // Use PowerShell with the Windows Audio API via COM
        let script = format!(
            r#"
$obj = New-Object -ComObject WScript.Shell
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {{
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
    int GetMute(out bool pbMute);
}}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {{
    int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {{
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorClass {{}}
public class AudioManager {{
    public static void SetVolume(float level) {{
        var enumeratorGuid = typeof(IMMDeviceEnumerator).GUID;
        var enumerator = (IMMDeviceEnumerator) new MMDeviceEnumeratorClass();
        IMMDevice device;
        enumerator.GetDefaultAudioEndpoint(0, 0, out device);
        var IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
        IAudioEndpointVolume aev;
        device.Activate(ref IID_IAudioEndpointVolume, 23, 0, out aev);
        aev.SetMasterVolumeLevelScalar(level, System.Guid.Empty);
    }}
}}
'@
[AudioManager]::SetVolume({} / 100.0f)
"#,
            level
        );
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        if !out.status.success() {
            // Fallback: use nircmd if available
            let fallback = crate::cmd_util::silent_tokio_cmd("nircmd")
                .args(["setsysvolume", &format!("{}", (level as u32 * 655))])
                .output()
                .await;
            if fallback.map(|o| o.status.success()).unwrap_or(false) {
                return Ok(());
            }
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Set volume failed: {}", err.trim()));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("set volume output volume {}", level);
        crate::cmd_util::silent_cmd("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Failed to set volume: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("amixer")
            .args(["sset", "Master", &format!("{}%", level)])
            .output()
            .await
            .map_err(|e| format!("amixer error: {}", e))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Set volume failed: {}", err.trim()));
        }
        Ok(())
    }
}

// ── App Management ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn launch_app(name: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // Sanitize app name to prevent PowerShell injection
        let sanitized = name.replace(['\'', '"', '`', ';', '|', '&', '$', '(', ')', '{', '}'], "");
        if sanitized.is_empty() {
            return Err("Invalid app name".to_string());
        }
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("Start-Process '{}'", sanitized),
            ])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        if out.status.success() {
            Ok(format!("Launched '{}'", name))
        } else {
            // Fallback: try the name directly as a shell command
            match crate::cmd_util::silent_tokio_cmd(&name).spawn() {
                Ok(_) => Ok(format!("Launched '{}'", name)),
                Err(_) => {
                    let err = String::from_utf8_lossy(&out.stderr);
                    Err(format!("Could not launch '{}': {}", name, err.trim()))
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("open")
            .args(["-a", &name])
            .output()
            .await
            .map_err(|e| format!("open error: {}", e))?;
        if out.status.success() {
            Ok(format!("Launched '{}'", name))
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("Could not launch '{}': {}", name, err.trim()))
        }
    }
    #[cfg(target_os = "linux")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("xdg-open")
            .arg(&name)
            .output()
            .await
            .map_err(|e| format!("xdg-open error: {}", e))?;
        if out.status.success() {
            Ok(format!("Launched '{}'", name))
        } else {
            // Try gtk-launch for .desktop entries
            let out2 = crate::cmd_util::silent_tokio_cmd("gtk-launch")
                .arg(&name)
                .output()
                .await;
            match out2 {
                Ok(o) if o.status.success() => Ok(format!("Launched '{}'", name)),
                _ => {
                    let err = String::from_utf8_lossy(&out.stderr);
                    Err(format!("Could not launch '{}': {}", name, err.trim()))
                }
            }
        }
    }
}

#[tauri::command]
pub async fn kill_app(name: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // Add .exe if not present for ease of use
        let exe = if name.ends_with(".exe") {
            name.clone()
        } else {
            format!("{}.exe", name)
        };
        let out = crate::cmd_util::silent_tokio_cmd("taskkill")
            .args(["/F", "/IM", &exe])
            .output()
            .await
            .map_err(|e| format!("taskkill error: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if out.status.success() {
            Ok(format!("Killed '{}'. {}", exe, stdout))
        } else {
            Err(format!("Could not kill '{}': {}", exe, if stderr.is_empty() { stdout } else { stderr }))
        }
    }
    #[cfg(target_os = "macos")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("pkill")
            .args(["-f", &name])
            .output()
            .await
            .map_err(|e| format!("pkill error: {}", e))?;
        if out.status.success() {
            Ok(format!("Killed '{}'", name))
        } else {
            Err(format!("No process matching '{}'", name))
        }
    }
    #[cfg(target_os = "linux")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("pkill")
            .args(["-f", &name])
            .output()
            .await
            .map_err(|e| format!("pkill error: {}", e))?;
        if out.status.success() {
            Ok(format!("Killed '{}'", name))
        } else {
            Err(format!("No process matching '{}'", name))
        }
    }
}

#[tauri::command]
pub async fn list_running_apps() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .await
            .map_err(|e| format!("tasklist error: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        // Parse CSV: "ImageName","PID","SessionName","Session#","Mem Usage"
        let mut apps: Vec<String> = stdout
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(2, ',').collect();
                let name = parts.first()?.trim_matches('"');
                if name.is_empty() { None } else { Some(name.to_string()) }
            })
            .collect();
        apps.sort();
        apps.dedup();
        // Filter system noise — keep user-facing processes
        let filtered: Vec<String> = apps
            .into_iter()
            .filter(|n| {
                !n.eq_ignore_ascii_case("System")
                    && !n.eq_ignore_ascii_case("Idle")
                    && !n.starts_with("smss")
                    && !n.starts_with("csrss")
                    && !n.starts_with("wininit")
                    && !n.starts_with("winlogon")
                    && !n.starts_with("services")
                    && !n.starts_with("lsass")
                    && !n.starts_with("svchost")
                    && !n.starts_with("conhost")
            })
            .collect();
        Ok(filtered)
    }
    #[cfg(target_os = "macos")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("ps")
            .args(["-axco", "comm"])
            .output()
            .await
            .map_err(|e| format!("ps error: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let mut apps: Vec<String> = stdout
            .lines()
            .skip(1)
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        apps.sort();
        apps.dedup();
        Ok(apps)
    }
    #[cfg(target_os = "linux")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("ps")
            .args(["-axco", "comm"])
            .output()
            .await
            .map_err(|e| format!("ps error: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let mut apps: Vec<String> = stdout
            .lines()
            .skip(1)
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        apps.sort();
        apps.dedup();
        Ok(apps)
    }
}

// ── Window Management ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sc_focus_window(title_pattern: String) -> Result<(), String> {
    // Sanitize to prevent shell injection — only allow alphanumeric, spaces, hyphens, dots
    let sanitized: String = title_pattern.chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '.' || *c == '_')
        .collect();
    if sanitized.is_empty() {
        return Err("Invalid window title pattern".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"
$wshell = New-Object -ComObject wscript.shell
$proc = Get-Process | Where-Object {{ $_.MainWindowTitle -like '*{}*' }} | Select-Object -First 1
if ($proc) {{
    $wshell.AppActivate($proc.Id)
    Write-Output "Focused: $($proc.MainWindowTitle)"
}} else {{
    Write-Error "No window matching '{}'"
}}
"#,
            sanitized, sanitized
        );
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("Could not focus window '{}': {}", title_pattern, err.trim()))
        }
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"tell application "System Events"
    set procs to processes whose name contains "{}"
    if (count of procs) > 0 then
        set frontmost of item 1 of procs to true
    end if
end tell"#,
            sanitized
        );
        crate::cmd_util::silent_cmd("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Failed to focus window: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("wmctrl")
            .args(["-a", &title_pattern])
            .output()
            .await
            .map_err(|e| format!("wmctrl error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!("Could not focus window '{}'. Ensure wmctrl is installed.", title_pattern))
        }
    }
}

#[tauri::command]
pub async fn minimize_all() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Win+D equivalent via shell
        let script = r#"
$wshell = New-Object -ComObject wscript.shell
$wshell.SendKeys("^{ESC}")
(New-Object -ComObject Shell.Application).MinimizeAll()
"#;
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("Minimize all failed: {}", err.trim()))
        }
    }
    #[cfg(target_os = "macos")]
    {
        let script = r#"tell application "System Events" to keystroke "m" using {command down, option down}"#;
        crate::cmd_util::silent_cmd("osascript")
            .args(["-e", script])
            .spawn()
            .map_err(|e| format!("Failed to minimize all: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // wmctrl or xdotool
        let _ = crate::cmd_util::silent_cmd("xdotool")
            .args(["key", "super+d"])
            .spawn();
        Ok(())
    }
}

// ── System Info ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_battery_status() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
$b = Get-WmiObject -Class Win32_Battery
if ($b) {
    $charging = if ($b.BatteryStatus -eq 2) { "charging" } else { "discharging" }
    "$($b.EstimatedChargeRemaining)% $charging, est. $($b.EstimatedRunTime) min remaining"
} else {
    "No battery (desktop or battery not detected)"
}
"#;
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        let result = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if result.is_empty() { "Battery info unavailable".to_string() } else { result })
    }
    #[cfg(target_os = "macos")]
    {
        let out = crate::cmd_util::silent_tokio_cmd("pmset")
            .args(["-g", "batt"])
            .output()
            .await
            .map_err(|e| format!("pmset error: {}", e))?;
        let result = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if result.is_empty() { "Battery info unavailable".to_string() } else { result })
    }
    #[cfg(target_os = "linux")]
    {
        // Try upower
        let out = crate::cmd_util::silent_tokio_cmd("upower")
            .args(["-i", "/org/freedesktop/UPower/devices/battery_BAT0"])
            .output()
            .await;
        match out {
            Ok(o) if o.status.success() => {
                Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
            }
            _ => {
                // Fallback: read /sys/class/power_supply
                let cap = std::fs::read_to_string("/sys/class/power_supply/BAT0/capacity")
                    .unwrap_or_else(|_| "?".to_string());
                let status = std::fs::read_to_string("/sys/class/power_supply/BAT0/status")
                    .unwrap_or_else(|_| "Unknown".to_string());
                Ok(format!("{}% {}", cap.trim(), status.trim()))
            }
        }
    }
}

#[tauri::command]
pub async fn get_network_status() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
$wifi = netsh wlan show interfaces 2>$null | Select-String 'SSID' | Select-Object -First 1
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
$vpn = (Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*VPN*' -or $_.InterfaceDescription -like '*TAP*' -or $_.InterfaceDescription -like '*WireGuard*' } | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1)
$ssid = if ($wifi) { ($wifi -replace '.*SSID\s*:\s*', '').Trim() } else { 'Ethernet/unknown' }
$vpnName = if ($vpn) { "VPN: $($vpn.Name)" } else { "No VPN" }
"SSID: $ssid | IP: $ip | $vpnName"
"#;
        let out = crate::cmd_util::silent_tokio_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .await
            .map_err(|e| format!("PowerShell error: {}", e))?;
        let result = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if result.is_empty() { "Network info unavailable".to_string() } else { result })
    }
    #[cfg(target_os = "macos")]
    {
        let ssid_out = crate::cmd_util::silent_tokio_cmd("networksetup")
            .args(["-getairportnetwork", "en0"])
            .output()
            .await;
        let ssid = ssid_out
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                Some(s.replace("Current Wi-Fi Network: ", ""))
            })
            .unwrap_or_else(|| "Unknown".to_string());

        let ip_out = crate::cmd_util::silent_tokio_cmd("ipconfig")
            .args(["getifaddr", "en0"])
            .output()
            .await;
        let ip = ip_out
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "Unknown".to_string());

        Ok(format!("SSID: {} | IP: {}", ssid, ip))
    }
    #[cfg(target_os = "linux")]
    {
        let ssid_out = crate::cmd_util::silent_tokio_cmd("iwgetid")
            .args(["-r"])
            .output()
            .await;
        let ssid = ssid_out
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_else(|| "Unknown/Ethernet".to_string());

        let ip_out = crate::cmd_util::silent_tokio_cmd("hostname")
            .args(["-I"])
            .output()
            .await;
        let ip = ip_out
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .split_whitespace()
                    .next()
                    .unwrap_or("Unknown")
                    .to_string()
            })
            .unwrap_or_else(|| "Unknown".to_string());

        Ok(format!("SSID: {} | IP: {}", ssid, ip))
    }
}

// ── LLM Tool Definitions ───────────────────────────────────────────────────────

pub fn tool_definitions() -> Vec<crate::providers::ToolDefinition> {
    vec![
        crate::providers::ToolDefinition {
            name: "blade_lock_screen".to_string(),
            description: "Lock the computer screen immediately. Use when the user asks BLADE to lock their screen, is stepping away, or when security requires it.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_set_volume".to_string(),
            description: "Set the system audio volume to a specific level (0-100). Use when the user says 'turn it up', 'mute', 'set volume to 50', etc.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "level": {
                        "type": "integer",
                        "description": "Volume level 0-100 (0 = mute, 100 = max)",
                        "minimum": 0,
                        "maximum": 100
                    }
                },
                "required": ["level"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_set_brightness".to_string(),
            description: "Set display brightness to a specific level (0-100). Use when the user says 'dim the screen', 'increase brightness', etc.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "level": {
                        "type": "integer",
                        "description": "Brightness level 0-100",
                        "minimum": 0,
                        "maximum": 100
                    }
                },
                "required": ["level"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_launch_app".to_string(),
            description: "Launch an application by name. Works with app names ('Chrome', 'Notepad', 'VS Code'), executable names ('code.exe'), or app bundle names on macOS. Use when the user asks to open an app.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Application name or executable to launch, e.g. 'Chrome', 'Notepad', 'code', 'Spotify'"
                    }
                },
                "required": ["name"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_kill_app".to_string(),
            description: "Force-kill a running application by name. Use when the user wants to close an app that's frozen or needs to be terminated. Add .exe for Windows if needed.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Process or application name to kill, e.g. 'chrome', 'notepad', 'spotify'"
                    }
                },
                "required": ["name"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_focus_window".to_string(),
            description: "Bring a window to the foreground by matching its title. Use when the user wants to switch to a specific open window (e.g. 'focus my browser', 'switch to Visual Studio').".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title_pattern": {
                        "type": "string",
                        "description": "Partial window title to match (case-insensitive), e.g. 'Chrome', 'Visual Studio', 'Spotify'"
                    }
                },
                "required": ["title_pattern"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_battery_status".to_string(),
            description: "Get current battery status: charge percentage, charging/discharging state, and estimated time remaining. Use when the user asks about battery level.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_network_status".to_string(),
            description: "Get current network status: WiFi SSID, IP address, and VPN connection info. Use when the user asks about their network connection, IP address, or WiFi.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        },
    ]
}

/// Dispatch system control tool calls from native_tools.rs
pub async fn execute_tool(name: &str, _args: &serde_json::Value) -> Option<(String, bool)> {
    match name {
        "blade_lock_screen" => Some(match lock_screen().await {
            Ok(()) => ("Screen locked.".to_string(), false),
            Err(e) => (e, true),
        }),
        "blade_set_volume" => {
            let level = _args["level"].as_u64().unwrap_or(50) as u32;
            Some(match set_volume(level).await {
                Ok(()) => (format!("Volume set to {}%.", level), false),
                Err(e) => (e, true),
            })
        }
        "blade_set_brightness" => {
            let level = _args["level"].as_u64().unwrap_or(70) as u32;
            Some(match set_brightness(level).await {
                Ok(()) => (format!("Brightness set to {}%.", level), false),
                Err(e) => (e, true),
            })
        }
        "blade_launch_app" => {
            let name = match _args["name"].as_str() {
                Some(n) => n.to_string(),
                None => return Some(("Missing required argument: name".to_string(), true)),
            };
            Some(match launch_app(name).await {
                Ok(msg) => (msg, false),
                Err(e) => (e, true),
            })
        }
        "blade_kill_app" => {
            let name = match _args["name"].as_str() {
                Some(n) => n.to_string(),
                None => return Some(("Missing required argument: name".to_string(), true)),
            };
            Some(match kill_app(name).await {
                Ok(msg) => (msg, false),
                Err(e) => (e, true),
            })
        }
        "blade_focus_window" => {
            let pattern = match _args["title_pattern"].as_str() {
                Some(p) => p.to_string(),
                None => return Some(("Missing required argument: title_pattern".to_string(), true)),
            };
            Some(match sc_focus_window(pattern).await {
                Ok(()) => ("Window focused.".to_string(), false),
                Err(e) => (e, true),
            })
        }
        "blade_battery_status" => Some(match get_battery_status().await {
            Ok(status) => (status, false),
            Err(e) => (e, true),
        }),
        "blade_network_status" => Some(match get_network_status().await {
            Ok(status) => (status, false),
            Err(e) => (e, true),
        }),
        _ => None,
    }
}
