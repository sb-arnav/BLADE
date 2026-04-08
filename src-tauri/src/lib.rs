mod brain;
mod clipboard;
mod commands;
mod config;
mod history;
mod mcp;
mod providers;

use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, PhysicalSize, Position, Size, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

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
    let mcp_manager: commands::SharedMcpManager =
        Arc::new(tokio::sync::Mutex::new(mcp::McpManager::default()));
    let setup_manager = mcp_manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(mcp_manager)
        .invoke_handler(tauri::generate_handler![
            commands::send_message_stream,
            commands::get_config,
            commands::set_config,
            commands::test_provider,
            commands::mcp_add_server,
            commands::mcp_discover_tools,
            commands::mcp_call_tool,
            commands::mcp_get_tools,
            commands::mcp_get_servers,
            commands::mcp_remove_server,
            commands::history_list_conversations,
            commands::history_load_conversation,
            commands::history_save_conversation,
            brain::get_persona,
            brain::set_persona,
            brain::get_context,
            brain::set_context,
            clipboard::get_clipboard,
            clipboard::set_clipboard,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(window_state) = config::load_config().window_state {
                    let _ = window.set_size(Size::Physical(PhysicalSize::new(
                        window_state.width,
                        window_state.height,
                    )));
                    let _ = window.set_position(Position::Physical(PhysicalPosition::new(
                        window_state.x,
                        window_state.y,
                    )));
                }
            }

            let startup_config = config::load_config();
            let manager = setup_manager.clone();
            tauri::async_runtime::spawn(async move {
                let mut manager = manager.lock().await;
                for server in startup_config.mcp_servers {
                    manager.register_server(
                        server.name,
                        mcp::McpServerConfig {
                            command: server.command,
                            args: server.args,
                            env: server.env,
                        },
                    );
                }

                let _ = manager.discover_all_tools().await;
            });

            // Start clipboard watcher
            clipboard::start_clipboard_watcher(app.handle().clone());

            let handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::ALT), Code::Space),
                move |_app, _shortcut, _event| {
                    toggle_window(&handle);
                },
            );

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
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }

            if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
                if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
                    let _ = config::update_window_state(config::WindowState {
                        x: position.x,
                        y: position.y,
                        width: size.width,
                        height: size.height,
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running blade");
}
