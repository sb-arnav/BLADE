use enigo::{Enigo, Keyboard, Mouse, Key, Button, Direction, Coordinate, Axis, Settings};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutomationResult {
    pub success: bool,
    pub message: String,
}

fn get_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("Automation init failed: {}", e))
}

#[tauri::command]
pub fn auto_type_text(text: String) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    enigo.text(&text).map_err(|e| format!("Type failed: {}", e))?;
    Ok(AutomationResult {
        success: true,
        message: format!("Typed {} characters", text.len()),
    })
}

#[tauri::command]
pub fn auto_press_key(key: String) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    let k = parse_key(&key)?;
    enigo.key(k, Direction::Click).map_err(|e| format!("Key press failed: {}", e))?;
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
        enigo.key(k, Direction::Release).map_err(|e| e.to_string())?;
    }

    Ok(AutomationResult {
        success: true,
        message: format!("Key combo executed"),
    })
}

#[tauri::command]
pub fn auto_mouse_move(x: i32, y: i32) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
    Ok(AutomationResult {
        success: true,
        message: format!("Moved to ({}, {})", x, y),
    })
}

#[tauri::command]
pub fn auto_mouse_click(x: Option<i32>, y: Option<i32>, button: Option<String>) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;

    if let (Some(x), Some(y)) = (x, y) {
        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| e.to_string())?;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    let btn = match button.as_deref() {
        Some("right") => Button::Right,
        Some("middle") => Button::Middle,
        _ => Button::Left,
    };

    enigo.button(btn, Direction::Click).map_err(|e| e.to_string())?;

    Ok(AutomationResult {
        success: true,
        message: "Clicked".to_string(),
    })
}

#[tauri::command]
pub fn auto_scroll(dx: i32, dy: i32) -> Result<AutomationResult, String> {
    let mut enigo = get_enigo()?;
    if dx != 0 {
        enigo.scroll(dx, Axis::Horizontal).map_err(|e| e.to_string())?;
    }
    if dy != 0 {
        enigo.scroll(dy, Axis::Vertical).map_err(|e| e.to_string())?;
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
