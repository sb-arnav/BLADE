use crate::clipboard;
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MousePosition {
    pub x: i32,
    pub y: i32,
}

fn get_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("Automation init failed: {}", e))
}

#[tauri::command]
pub fn auto_type_text(text: String) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    enigo
        .text(&text)
        .map_err(|e| format!("Type failed: {}", e))?;
    Ok(AutomationResult {
        success: true,
        message: format!("Typed {} characters", text.len()),
    })
}

#[tauri::command]
pub fn auto_press_key(key: String) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    let k = parse_key(&key)?;
    enigo
        .key(k, Direction::Click)
        .map_err(|e| format!("Key press failed: {}", e))?;
    Ok(AutomationResult {
        success: true,
        message: format!("Pressed key: {}", key),
    })
}

#[tauri::command]
pub fn auto_key_combo(modifiers: Vec<String>, key: String) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;

    for m in &modifiers {
        let k = parse_modifier(m)?;
        enigo.key(k, Direction::Press).map_err(|e| e.to_string())?;
    }

    let k = parse_key(&key)?;
    enigo.key(k, Direction::Click).map_err(|e| e.to_string())?;

    for m in modifiers.iter().rev() {
        let k = parse_modifier(m)?;
        enigo
            .key(k, Direction::Release)
            .map_err(|e| e.to_string())?;
    }

    Ok(AutomationResult {
        success: true,
        message: format!("Key combo executed"),
    })
}

#[tauri::command]
pub fn auto_mouse_move(x: i32, y: i32) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| e.to_string())?;
    Ok(AutomationResult {
        success: true,
        message: format!("Moved to ({}, {})", x, y),
    })
}

#[tauri::command]
pub fn auto_get_mouse_position() -> Result<MousePosition, String> {
    let enigo = get_enigo()?;
    let (x, y) = enigo.location().map_err(|e| e.to_string())?;
    Ok(MousePosition { x, y })
}

#[tauri::command]
pub fn auto_mouse_click(
    x: Option<i32>,
    y: Option<i32>,
    button: Option<String>,
) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;

    if let (Some(x), Some(y)) = (x, y) {
        enigo
            .move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let btn = parse_button(button.as_deref());

    enigo
        .button(btn, Direction::Click)
        .map_err(|e| e.to_string())?;

    Ok(AutomationResult {
        success: true,
        message: "Clicked".to_string(),
    })
}

#[tauri::command]
pub fn auto_mouse_click_relative(
    dx: i32,
    dy: i32,
    button: Option<String>,
) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    let (current_x, current_y) = enigo.location().map_err(|e| e.to_string())?;
    let target_x = current_x.saturating_add(dx);
    let target_y = current_y.saturating_add(dy);

    enigo
        .move_mouse(target_x, target_y, Coordinate::Abs)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));

    let btn = parse_button(button.as_deref());
    enigo
        .button(btn, Direction::Click)
        .map_err(|e| e.to_string())?;

    Ok(AutomationResult {
        success: true,
        message: format!(
            "Clicked relative by ({}, {}) at ({}, {})",
            dx, dy, target_x, target_y
        ),
    })
}

#[tauri::command]
pub fn auto_mouse_double_click(
    x: Option<i32>,
    y: Option<i32>,
    button: Option<String>,
) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;

    if let (Some(x), Some(y)) = (x, y) {
        enigo
            .move_mouse(x, y, Coordinate::Abs)
            .map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let btn = parse_button(button.as_deref());
    enigo
        .button(btn, Direction::Click)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    enigo
        .button(btn, Direction::Click)
        .map_err(|e| e.to_string())?;

    Ok(AutomationResult {
        success: true,
        message: "Double clicked".to_string(),
    })
}

#[tauri::command]
pub fn auto_mouse_drag(
    from_x: i32,
    from_y: i32,
    to_x: i32,
    to_y: i32,
    button: Option<String>,
) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    let btn = parse_button(button.as_deref());

    enigo
        .move_mouse(from_x, from_y, Coordinate::Abs)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(60));
    enigo
        .button(btn, Direction::Press)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(60));
    enigo
        .move_mouse(to_x, to_y, Coordinate::Abs)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(60));
    enigo
        .button(btn, Direction::Release)
        .map_err(|e| e.to_string())?;

    Ok(AutomationResult {
        success: true,
        message: format!(
            "Dragged from ({}, {}) to ({}, {})",
            from_x, from_y, to_x, to_y
        ),
    })
}

#[tauri::command]
pub fn auto_open_url(url: String) -> Result<AutomationResult, String> {
    open_target(&url)?;
    Ok(AutomationResult {
        success: true,
        message: format!("Opened URL: {}", url),
    })
}

#[tauri::command]
pub fn auto_launch_app(
    command: String,
    args: Option<Vec<String>>,
) -> Result<AutomationResult, String> {
    let mut child = std::process::Command::new(&command);
    if let Some(args) = args {
        child.args(args);
    }
    child
        .spawn()
        .map_err(|e| format!("Failed to launch app `{}`: {}", command, e))?;
    Ok(AutomationResult {
        success: true,
        message: format!("Launched app: {}", command),
    })
}

#[tauri::command]
pub fn auto_open_path(path: String) -> Result<AutomationResult, String> {
    open_target(&path)?;
    Ok(AutomationResult {
        success: true,
        message: format!("Opened path: {}", path),
    })
}

#[tauri::command]
pub fn auto_copy_to_clipboard(text: String) -> Result<AutomationResult, String> {
    clipboard::set_clipboard(text.clone())?;
    Ok(AutomationResult {
        success: true,
        message: format!("Copied {} characters to clipboard", text.len()),
    })
}

#[tauri::command]
pub fn auto_paste_clipboard() -> Result<AutomationResult, String> {
    #[cfg(target_os = "macos")]
    {
        return auto_key_combo(vec!["meta".to_string()], "v".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        return auto_key_combo(vec!["ctrl".to_string()], "v".to_string());
    }
}

#[tauri::command]
pub fn auto_scroll(dx: i32, dy: i32) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    if dx != 0 {
        enigo
            .scroll(dx, Axis::Horizontal)
            .map_err(|e| e.to_string())?;
    }
    if dy != 0 {
        enigo
            .scroll(dy, Axis::Vertical)
            .map_err(|e| e.to_string())?;
    }
    Ok(AutomationResult {
        success: true,
        message: format!("Scrolled ({}, {})", dx, dy),
    })
}

fn parse_key(key: &str) -> Result<Key, String> {
    match key.to_lowercase().as_str() {
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "escape" | "esc" => Ok(Key::Escape),
        "backspace" => Ok(Key::Backspace),
        "delete" => Ok(Key::Delete),
        "space" => Ok(Key::Space),
        "up" => Ok(Key::UpArrow),
        "down" => Ok(Key::DownArrow),
        "left" => Ok(Key::LeftArrow),
        "right" => Ok(Key::RightArrow),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" => Ok(Key::PageUp),
        "pagedown" => Ok(Key::PageDown),
        "f1" => Ok(Key::F1),
        "f2" => Ok(Key::F2),
        "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4),
        "f5" => Ok(Key::F5),
        other if other.len() == 1 => Ok(Key::Unicode(other.chars().next().unwrap())),
        _ => Err(format!("Unknown key: {}", key)),
    }
}

fn parse_modifier(m: &str) -> Result<Key, String> {
    match m.to_lowercase().as_str() {
        "ctrl" | "control" => Ok(Key::Control),
        "shift" => Ok(Key::Shift),
        "alt" => Ok(Key::Alt),
        "meta" | "win" | "super" => Ok(Key::Meta),
        _ => Err(format!("Unknown modifier: {}", m)),
    }
}

fn parse_button(button: Option<&str>) -> Button {
    match button {
        Some("right") => Button::Right,
        Some("middle") => Button::Middle,
        _ => Button::Left,
    }
}

fn open_target(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
            .spawn()
            .map_err(|e| format!("Open target failed: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Open target failed: {}", e))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Open target failed: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening URLs is not supported on this platform".to_string())
}
