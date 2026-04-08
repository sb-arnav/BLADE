mod agent_commands;
mod agents;
mod automation;
mod brain;
mod context;
mod character;
mod clipboard;
mod commands;
mod config;
mod crypto;
mod db;
mod discovery;
mod embeddings;
mod files;
mod history;
mod mcp;
mod memory;
mod permissions;
mod plugins;
mod router;
mod providers;
mod rag;
mod screen;
mod trace;
mod tray;
mod voice;

use std::sync::Arc;
use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};

pub(crate) fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub(crate) fn toggle_quickask(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quickask") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            // Re-center each time so it appears near the middle of the screen
            let _ = window.center();
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

    // Agent queue
    let agent_queue: agents::queue::SharedAgentQueue =
        Arc::new(tokio::sync::Mutex::new(agents::queue::AgentQueue::default()));

    // Vector store for semantic search
    let vector_store: embeddings::SharedVectorStore =
        Arc::new(std::sync::Mutex::new(embeddings::VectorStore::new()));

    tauri::Builder::default()
        // --- Plugins ---
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // SQLite handled by db.rs via rusqlite directly
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
        .manage(agent_queue)
        .manage(vector_store)
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
            agent_commands::agent_create,
            agent_commands::agent_list,
            agent_commands::agent_get,
            agent_commands::agent_pause,
            agent_commands::agent_resume,
            agent_commands::agent_cancel,
            automation::auto_type_text,
            automation::auto_press_key,
            automation::auto_key_combo,
            automation::auto_mouse_move,
            automation::auto_mouse_click,
            automation::auto_scroll,
            context::get_active_window,
            context::get_user_activity,
            character::consolidate_character,
            character::get_character_bible,
            character::update_character_section,
            memory::get_memory_log,
            router::classify_message,
            tray::set_tray_status,
            embeddings::embed_and_store,
            embeddings::semantic_search,
            embeddings::vector_store_size,
            plugins::registry::plugin_list,
            plugins::registry::plugin_install,
            plugins::registry::plugin_uninstall,
            plugins::registry::plugin_toggle,
            plugins::registry::plugin_get_commands,
            rag::rag_ingest_file,
            rag::rag_ingest_directory,
            rag::rag_query,
            files::file_read,
            files::file_write,
            files::file_list,
            files::file_tree,
            files::file_exists,
            files::file_mkdir,
        ])
        .setup(move |app| {
            // Window state (position/size) handled by tauri-plugin-window-state
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Create the Quick Ask floating widget window
            let _quickask = tauri::WebviewWindowBuilder::new(
                app,
                "quickask",
                tauri::WebviewUrl::App("quickask.html".into()),
            )
            .title("Blade Quick Ask")
            .inner_size(500.0, 72.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false)
            .build()?;

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

            // Alt+Space → toggle Quick Ask floating widget
            let handle = app.handle().clone();
            let _ = app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::ALT), Code::Space),
                move |_app, _shortcut, _event| {
                    toggle_quickask(&handle);
                },
            );

            tray::create_tray(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            // Window state (position/size) saved by tauri-plugin-window-state
        })
        .run(tauri::generate_context!())
        .expect("error running blade");
}
