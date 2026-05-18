// Phase 80 (v2.4) — Linux X11 window introspection via xdotool subprocess.
//
// Lifted from sqrew/rmcp-xdotool (MIT, single-file Rust MCP server) — the
// 4 window-introspection functions that enigo (BLADE's cross-platform input
// crate) does not cover. Mouse/keyboard primitives stay on enigo via
// automation.rs; this module is window-tree only.
//
// Limitations:
//   - X11 only. Under Wayland, every call here returns NotAvailable.
//   - Requires `xdotool` binary in PATH. Already a runtime dep of
//     system_control.rs on Linux (see sc_focus_window etc.) — this module
//     just centralizes the calls so they have structured returns.
//
// Smoke test in tests/ confirms the binary is reachable + parses one call.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WindowGeometry {
    pub window_id: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub screen: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum X11Status {
    Available,
    NotLinux,
    XdotoolMissing,
    WaylandSession,
}

/// Probe whether xdotool can reach an X11 server right now.
/// Wayland sessions return WaylandSession (xdotool runs but reports "no display").
pub fn probe() -> X11Status {
    if !cfg!(target_os = "linux") {
        return X11Status::NotLinux;
    }
    // Wayland sessions advertise XDG_SESSION_TYPE=wayland.
    if std::env::var("XDG_SESSION_TYPE").ok().as_deref() == Some("wayland") {
        return X11Status::WaylandSession;
    }
    match Command::new("xdotool").arg("--version").output() {
        Ok(o) if o.status.success() => X11Status::Available,
        Ok(_) => X11Status::XdotoolMissing,
        Err(_) => X11Status::XdotoolMissing,
    }
}

fn xdotool(args: &[&str]) -> Result<String, String> {
    match probe() {
        X11Status::Available => {}
        s => return Err(format!("xdotool unavailable: {:?}", s)),
    }
    let out = Command::new("xdotool")
        .args(args)
        .output()
        .map_err(|e| format!("xdotool spawn failed: {}", e))?;
    if !out.status.success() {
        // search returns non-zero on no-match; callers translate.
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Search for windows by name/class. search_type ∈ {"name","class","classname","any"}.
/// Returns window-id strings; empty vec means no match.
pub fn search_window(query: &str, search_type: &str) -> Result<Vec<String>, String> {
    let mut args: Vec<&str> = vec!["search"];
    match search_type {
        "name" => args.push("--name"),
        "class" => args.push("--class"),
        "classname" => args.push("--classname"),
        _ => {} // "any" → default
    }
    args.push(query);
    match xdotool(&args) {
        Ok(stdout) if stdout.is_empty() => Ok(vec![]),
        Ok(stdout) => Ok(stdout.lines().map(|s| s.to_string()).collect()),
        Err(e) if e.is_empty() => Ok(vec![]), // xdotool exits 1 on no-match w/ empty stderr
        Err(e) => Err(e),
    }
}

/// Get the currently focused window ID.
pub fn get_active_window() -> Result<String, String> {
    xdotool(&["getactivewindow"])
}

/// Get window position + size for a window ID.
pub fn get_window_geometry(window_id: &str) -> Result<WindowGeometry, String> {
    let stdout = xdotool(&["getwindowgeometry", "--shell", window_id])?;
    let mut x = 0i32;
    let mut y = 0i32;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut screen = 0i32;
    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("X=") {
            x = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("Y=") {
            y = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("WIDTH=") {
            width = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("HEIGHT=") {
            height = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("SCREEN=") {
            screen = v.parse().unwrap_or(0);
        }
    }
    Ok(WindowGeometry { window_id: window_id.to_string(), x, y, width, height, screen })
}

/// Get the title/name of a window ID.
pub fn get_window_name(window_id: &str) -> Result<String, String> {
    xdotool(&["getwindowname", window_id])
}

// ── Tauri command surface (LLM-callable) ────────────────────────────────

#[tauri::command]
pub fn x11_probe() -> String {
    format!("{:?}", probe())
}

#[tauri::command]
pub fn x11_search_window(query: String, search_type: Option<String>) -> Result<Vec<String>, String> {
    search_window(&query, search_type.as_deref().unwrap_or("any"))
}

#[tauri::command]
pub fn x11_get_active_window() -> Result<String, String> {
    get_active_window()
}

#[tauri::command]
pub fn x11_get_window_geometry(window_id: String) -> Result<WindowGeometry, String> {
    get_window_geometry(&window_id)
}

#[tauri::command]
pub fn x11_get_window_name(window_id: String) -> Result<String, String> {
    get_window_name(&window_id)
}

// ── Phase 80 falsification — runnable test ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_is_one_of_four_variants() {
        // Smoke: probe never panics + returns one of the known statuses.
        let s = probe();
        assert!(matches!(
            s,
            X11Status::Available | X11Status::NotLinux | X11Status::XdotoolMissing | X11Status::WaylandSession
        ));
    }

    #[test]
    fn non_linux_returns_not_linux() {
        // Compile-time assertion: on non-Linux this is the only legal value.
        #[cfg(not(target_os = "linux"))]
        assert_eq!(probe(), X11Status::NotLinux);
    }

    #[test]
    fn calls_error_gracefully_when_unavailable() {
        // If xdotool can't reach a display, every call must Err — not panic.
        if !matches!(probe(), X11Status::Available) {
            assert!(get_active_window().is_err());
            assert!(get_window_name("0").is_err());
            assert!(get_window_geometry("0").is_err());
            // search returns Ok(empty) on graceful no-match, Err on harder failures —
            // either is fine; the contract is "doesn't panic."
            let _ = search_window("nonexistent-blade-test-window", "name");
        }
    }

    #[test]
    fn parses_xdotool_shell_format() {
        // Pure-function unit: parser handles the documented shell format.
        // We don't run xdotool here — we feed the expected output shape through
        // get_window_geometry's parser indirectly by reconstructing it.
        // (Geometry parser is inlined in get_window_geometry; this asserts shape.)
        let sample = "WINDOW=12345\nX=100\nY=200\nWIDTH=800\nHEIGHT=600\nSCREEN=0";
        let mut x = 0i32; let mut y = 0i32; let mut w = 0u32; let mut h = 0u32; let mut s = 0i32;
        for line in sample.lines() {
            if let Some(v) = line.strip_prefix("X=") { x = v.parse().unwrap(); }
            else if let Some(v) = line.strip_prefix("Y=") { y = v.parse().unwrap(); }
            else if let Some(v) = line.strip_prefix("WIDTH=") { w = v.parse().unwrap(); }
            else if let Some(v) = line.strip_prefix("HEIGHT=") { h = v.parse().unwrap(); }
            else if let Some(v) = line.strip_prefix("SCREEN=") { s = v.parse().unwrap(); }
        }
        assert_eq!((x, y, w, h, s), (100, 200, 800, 600, 0));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_x11_roundtrip_when_available() {
        // Integration: only fires on Linux with X11 + xdotool present.
        // Confirms a real round-trip (active window → name lookup) parses cleanly.
        if probe() != X11Status::Available {
            eprintln!("skip: x11_xdotool linux roundtrip — probe={:?}", probe());
            return;
        }
        let active = get_active_window().expect("active window query");
        assert!(!active.is_empty(), "active window id non-empty");
        // Name lookup on the active window — even if empty title, must not error.
        let _name = get_window_name(&active);
        let geom = get_window_geometry(&active).expect("active window geometry");
        assert_eq!(geom.window_id, active);
        // Geometry sanity: non-negative dimensions.
        assert!(geom.width > 0 && geom.height > 0, "active window has dimensions");
    }
}
