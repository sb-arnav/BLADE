mod brain;
mod clipboard;
mod commands;
mod config;
mod crypto;
mod db;
mod discovery;
mod history;
mod mcp;
mod memory;
mod permissions;
mod router;
mod providers;
mod screen;
mod trace;
mod voice;

use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};

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
    let approval_map: commands::ApprovalMap =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let setup_manager = mcp_manager.clone();

    // Initialize database
    let db_conn = db::init_db().expect("Failed to initialize database");
    let shared_db = Arc::new(std::sync::Mutex::new(db_conn));

    tauri::Builder::default()
        // --- Plugins ---
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when second instance launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_log::Builder::new()
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir { file_name: Some("blade".into()) }),
            ])
            .build())
        // --- State ---
        .manage(mcp_manager)
        .manage(approval_map)
        .manage(shared_db)
        .invoke_handler(tauri::generate_handler![
            commands::send_message_stream,
            commands::get_config,
            commands::debug_config,
            commands::reset_onboarding,
            commands::set_config,
            commands::test_provider,
            commands::mcp_add_server,
            commands::mcp_discover_tools,
            commands::mcp_call_tool,
            commands::mcp_get_tools,
            commands::mcp_get_servers,
            commands::mcp_remove_server,
            commands::mcp_server_status,
            commands::respond_tool_approval,
            commands::history_list_conversations,
            commands::history_load_conversation,
            commands::history_save_conversation,
            commands::history_delete_conversation,
            brain::get_persona,
            brain::set_persona,
            brain::get_context,
            brain::set_context,
            clipboard::get_clipboard,
            clipboard::set_clipboard,
            discovery::run_discovery,
            discovery::discover_mcp_servers,
            permissions::classify_mcp_tool,
            permissions::set_tool_trust,
            permissions::reset_tool_trust,
            permissions::get_tool_overrides,
            trace::get_recent_traces,
            voice::voice_start_recording,
            voice::voice_stop_recording,
            voice::voice_transcribe,
            screen::capture_screen,
            screen::capture_screen_region,
            memory::learn_from_conversation,
            memory::get_memory_log,
            router::classify_message,
        ])
        .setup(move |app| {
            // Ensure window is visible and focused on startup
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
                let _ = window.show();
                let _ = window.set_focus();
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
            let icon = tauri::image::Image::from_path("icons/32x32.png")
                .or_else(|_| tauri::image::Image::from_path("icons/icon.png"))
                .ok();

            let mut tray_builder = TrayIconBuilder::new().menu(&menu);
            if let Some(icon) = icon {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder
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
