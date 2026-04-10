use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowContext {
    pub app_name: String,
    pub window_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WindowListEntry {
    #[serde(rename = "ProcessName")]
    process_name: String,
    #[serde(rename = "MainWindowTitle")]
    main_window_title: String,
}

/// Get the currently focused window info
/// Uses platform-specific APIs
#[tauri::command]
pub fn get_active_window() -> Result<WindowContext, String> {
    #[cfg(target_os = "windows")]
    {
        get_active_window_windows()
    }

    #[cfg(target_os = "linux")]
    {
        get_active_window_linux()
    }

    #[cfg(target_os = "macos")]
    {
        Ok(WindowContext {
            app_name: "Unknown".to_string(),
            window_title: "macOS support pending".to_string(),
        })
    }
}

#[tauri::command]
pub fn list_open_windows() -> Result<Vec<WindowContext>, String> {
    list_open_windows_internal()
}

pub(crate) fn list_open_windows_internal() -> Result<Vec<WindowContext>, String> {
    #[cfg(target_os = "windows")]
    {
        list_open_windows_windows()
    }

    #[cfg(target_os = "linux")]
    {
        list_open_windows_linux()
    }

    #[cfg(target_os = "macos")]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn focus_window(title_contains: String) -> Result<(), String> {
    focus_window_internal(&title_contains)
}

pub(crate) fn focus_window_internal(title_contains: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        focus_window_windows(title_contains)
    }

    #[cfg(target_os = "linux")]
    {
        focus_window_linux(title_contains)
    }

    #[cfg(target_os = "macos")]
    {
        Err("Focus window is not supported on macOS yet".to_string())
    }
}

#[cfg(target_os = "windows")]
fn get_active_window_windows() -> Result<WindowContext, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    unsafe {
        let hwnd = winapi_GetForegroundWindow();
        if hwnd.is_null() {
            return Ok(WindowContext::default());
        }

        // Get window title
        let mut title_buf = [0u16; 512];
        let len = winapi_GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let title = if len > 0 {
            OsString::from_wide(&title_buf[..len as usize])
                .to_string_lossy()
                .to_string()
        } else {
            String::new()
        };

        // Get process name
        let mut pid: u32 = 0;
        winapi_GetWindowThreadProcessId(hwnd, &mut pid);

        let app_name = get_process_name(pid).unwrap_or_else(|| "Unknown".to_string());

        Ok(WindowContext {
            app_name,
            window_title: title,
        })
    }
}

#[cfg(target_os = "windows")]
fn get_process_name(pid: u32) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    unsafe {
        let handle = winapi_OpenProcess(0x0400 | 0x0010, 0, pid); // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
        if handle.is_null() {
            return None;
        }

        let mut name_buf = [0u16; 260];
        let mut size = name_buf.len() as u32;
        let ok = winapi_QueryFullProcessImageNameW(handle, 0, name_buf.as_mut_ptr(), &mut size);
        winapi_CloseHandle(handle);

        if ok != 0 {
            let full_path = OsString::from_wide(&name_buf[..size as usize])
                .to_string_lossy()
                .to_string();
            // Extract just the exe name
            full_path
                .rsplit('\\')
                .next()
                .map(|s| s.trim_end_matches(".exe").to_string())
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn list_open_windows_windows() -> Result<Vec<WindowContext>, String> {
    let script = r#"
Get-Process |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  Select-Object ProcessName, MainWindowTitle |
  ConvertTo-Json -Compress
"#;

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .map_err(|e| format!("Failed to list open windows: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Ok(Vec::new());
    }

    let parsed = if raw.starts_with('[') {
        serde_json::from_str::<Vec<WindowListEntry>>(&raw).unwrap_or_default()
    } else {
        serde_json::from_str::<WindowListEntry>(&raw)
            .map(|value| vec![value])
            .unwrap_or_default()
    };

    Ok(parsed
        .into_iter()
        .map(|entry| WindowContext {
            app_name: entry.process_name,
            window_title: entry.main_window_title,
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn focus_window_windows(title_contains: &str) -> Result<(), String> {
    let escaped = title_contains.replace('\'', "''");
    let script = format!(
        "(New-Object -ComObject WScript.Shell).AppActivate('{}') | Out-Null",
        escaped
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("Failed to focus window: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to focus a window matching `{}`: {}",
            title_contains,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

// Windows FFI declarations
#[cfg(target_os = "windows")]
extern "system" {
    #[link_name = "GetForegroundWindow"]
    fn winapi_GetForegroundWindow() -> *mut std::ffi::c_void;

    #[link_name = "GetWindowTextW"]
    fn winapi_GetWindowTextW(
        hwnd: *mut std::ffi::c_void,
        lpstring: *mut u16,
        nmaxcount: i32,
    ) -> i32;

    #[link_name = "GetWindowThreadProcessId"]
    fn winapi_GetWindowThreadProcessId(hwnd: *mut std::ffi::c_void, lpdwprocessid: *mut u32)
        -> u32;

    #[link_name = "OpenProcess"]
    fn winapi_OpenProcess(
        dwdesiredaccess: u32,
        binherithandle: i32,
        dwprocessid: u32,
    ) -> *mut std::ffi::c_void;

    #[link_name = "QueryFullProcessImageNameW"]
    fn winapi_QueryFullProcessImageNameW(
        hprocess: *mut std::ffi::c_void,
        dwflags: u32,
        lpexename: *mut u16,
        lpdwsize: *mut u32,
    ) -> i32;

    #[link_name = "CloseHandle"]
    fn winapi_CloseHandle(hobject: *mut std::ffi::c_void) -> i32;
}

#[cfg(target_os = "linux")]
fn get_active_window_linux() -> Result<WindowContext, String> {
    // Try xdotool
    let output = std::process::Command::new("xdotool")
        .args(["getactivewindow", "getwindowname"])
        .output();

    let title = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    };

    // Try to get the WM_CLASS for app name
    let pid_output = std::process::Command::new("xdotool")
        .args(["getactivewindow", "getwindowpid"])
        .output();

    let app_name = match pid_output {
        Ok(o) if o.status.success() => {
            let pid = String::from_utf8_lossy(&o.stdout).trim().to_string();
            // Read /proc/PID/comm for process name
            std::fs::read_to_string(format!("/proc/{}/comm", pid))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "Unknown".to_string())
        }
        _ => "Unknown".to_string(),
    };

    Ok(WindowContext {
        app_name,
        window_title: title,
    })
}

#[cfg(target_os = "linux")]
fn list_open_windows_linux() -> Result<Vec<WindowContext>, String> {
    let output = std::process::Command::new("wmctrl")
        .arg("-lp")
        .output()
        .map_err(|e| format!("Failed to list open windows: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let windows = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let _window_id = parts.next()?;
            let _desktop_id = parts.next()?;
            let pid = parts.next()?.to_string();
            let _host = parts.next()?;
            let title = parts.collect::<Vec<_>>().join(" ");
            if title.trim().is_empty() {
                return None;
            }
            let app_name = std::fs::read_to_string(format!("/proc/{}/comm", pid))
                .map(|value| value.trim().to_string())
                .unwrap_or_else(|_| "Unknown".to_string());
            Some(WindowContext {
                app_name,
                window_title: title,
            })
        })
        .collect();

    Ok(windows)
}

#[cfg(target_os = "linux")]
fn focus_window_linux(title_contains: &str) -> Result<(), String> {
    let output = std::process::Command::new("wmctrl")
        .args(["-a", title_contains])
        .output()
        .map_err(|e| format!("Failed to focus window: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to focus a window matching `{}`: {}",
            title_contains,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// Detect what the user is likely doing based on the active window
pub fn infer_activity(ctx: &WindowContext) -> String {
    let app = ctx.app_name.to_lowercase();
    let title = ctx.window_title.to_lowercase();

    if app.contains("code")
        || app.contains("cursor")
        || app.contains("vim")
        || app.contains("neovim")
    {
        if title.contains(".rs") {
            return "Writing Rust code".to_string();
        }
        if title.contains(".ts") || title.contains(".tsx") {
            return "Writing TypeScript code".to_string();
        }
        if title.contains(".py") {
            return "Writing Python code".to_string();
        }
        if title.contains(".go") {
            return "Writing Go code".to_string();
        }
        return "Coding in an editor".to_string();
    }

    if app.contains("chrome")
        || app.contains("firefox")
        || app.contains("edge")
        || app.contains("brave")
    {
        if title.contains("github") {
            return "Browsing GitHub".to_string();
        }
        if title.contains("stack overflow") || title.contains("stackoverflow") {
            return "Looking up a programming question".to_string();
        }
        if title.contains("docs") || title.contains("documentation") {
            return "Reading documentation".to_string();
        }
        return "Browsing the web".to_string();
    }

    if app.contains("terminal")
        || app.contains("powershell")
        || app.contains("cmd")
        || app.contains("wt")
    {
        return "Working in the terminal".to_string();
    }

    if app.contains("slack") || app.contains("discord") || app.contains("teams") {
        return "In a chat/messaging app".to_string();
    }

    if app.contains("figma") || app.contains("sketch") {
        return "Designing".to_string();
    }

    if app.contains("notion") || app.contains("obsidian") {
        return "Taking notes".to_string();
    }

    format!("Using {}", ctx.app_name)
}

#[tauri::command]
pub fn get_user_activity() -> Result<String, String> {
    let ctx = get_active_window()?;
    Ok(infer_activity(&ctx))
}
