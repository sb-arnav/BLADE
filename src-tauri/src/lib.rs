use std::process::Command;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[derive(serde::Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[tauri::command]
fn send_message(messages: Vec<ChatMessage>) -> Result<String, String> {
    // Build prompt from conversation history
    let mut prompt_parts: Vec<String> = messages
        .iter()
        .map(|m| format!("{}: {}", m.role.to_uppercase(), m.content))
        .collect();
    prompt_parts.push("ASSISTANT:".to_string());
    let prompt = prompt_parts.join("\n\n");

    let output = Command::new("claude")
        .args(["-p", &prompt])
        .output()
        .map_err(|e| format!("Failed to run claude: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Claude error: {}", stderr));
    }

    let response = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(response)
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![send_message])
        .setup(|app| {
            // Register Alt+Space global hotkey (Win+Space is reserved on Windows)
            let handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::ALT), Code::Space),
                move |_app, _shortcut, _event| {
                    toggle_window(&handle);
                },
            );

            // System tray
            let quit = MenuItem::with_id(app, "quit", "Quit Blade", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let handle2 = app.handle().clone();
            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => toggle_window(&handle2),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_window(app);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide instead of close when X is pressed
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running blade");
}
