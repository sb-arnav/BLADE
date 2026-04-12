mod agent_commands;
mod autoskills;
mod git_style;
mod roles;
mod ambient;
mod evolution;
mod research;
mod background_agent;
mod cron;
mod execution_memory;
mod health;
mod indexer;
mod self_upgrade;
mod session_handoff;
mod computer_use;
mod deeplearn;
mod discord;
mod obsidian;
mod journal;
mod pulse;
mod reminders;
mod skill_engine;
mod telegram;
mod thread;
mod tts;
mod watcher;
mod godmode;
mod native_tools;
mod agents;
mod automation;
mod brain;
mod browser_native;
mod character;
mod clipboard;
mod commands;
mod config;
mod context;
mod crypto;
mod db;
mod db_commands;
mod discovery;
mod embeddings;
mod files;
mod history;
mod managed_agents;
mod mcp;
mod memory;
mod permissions;
mod plugins;
mod providers;
mod rag;
mod reports;
mod router;
mod runtimes;
mod screen;
mod screen_timeline;
mod screen_timeline_commands;
mod swarm;
mod swarm_planner;
mod swarm_commands;
mod wake_word;
mod soul_commands;
mod trace;
mod tray;
mod ui_automation;
mod voice;
mod voice_global;
mod voice_local;

use chrono::Timelike;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
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

/// Parse a human-readable shortcut string into a Tauri Shortcut.
/// Supported format: "Modifier+Modifier+Key", e.g. "Ctrl+Shift+V", "Alt+Space"
fn parse_shortcut(s: &str) -> Option<Shortcut> {
    let parts: Vec<&str> = s.split('+').collect();
    let mut mods = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for part in &parts {
        match part.trim().to_lowercase().as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "shift" => mods |= Modifiers::SHIFT,
            "alt" | "option" => mods |= Modifiers::ALT,
            "super" | "meta" | "cmd" | "command" => mods |= Modifiers::SUPER,
            key => {
                key_code = match key {
                    "space" => Some(Code::Space),
                    "enter" | "return" => Some(Code::Enter),
                    "escape" | "esc" => Some(Code::Escape),
                    "tab" => Some(Code::Tab),
                    "backspace" => Some(Code::Backspace),
                    "delete" => Some(Code::Delete),
                    "a" => Some(Code::KeyA), "b" => Some(Code::KeyB),
                    "c" => Some(Code::KeyC), "d" => Some(Code::KeyD),
                    "e" => Some(Code::KeyE), "f" => Some(Code::KeyF),
                    "g" => Some(Code::KeyG), "h" => Some(Code::KeyH),
                    "i" => Some(Code::KeyI), "j" => Some(Code::KeyJ),
                    "k" => Some(Code::KeyK), "l" => Some(Code::KeyL),
                    "m" => Some(Code::KeyM), "n" => Some(Code::KeyN),
                    "o" => Some(Code::KeyO), "p" => Some(Code::KeyP),
                    "q" => Some(Code::KeyQ), "r" => Some(Code::KeyR),
                    "s" => Some(Code::KeyS), "t" => Some(Code::KeyT),
                    "u" => Some(Code::KeyU), "v" => Some(Code::KeyV),
                    "w" => Some(Code::KeyW), "x" => Some(Code::KeyX),
                    "y" => Some(Code::KeyY), "z" => Some(Code::KeyZ),
                    "0" => Some(Code::Digit0), "1" => Some(Code::Digit1),
                    "2" => Some(Code::Digit2), "3" => Some(Code::Digit3),
                    "4" => Some(Code::Digit4), "5" => Some(Code::Digit5),
                    "6" => Some(Code::Digit6), "7" => Some(Code::Digit7),
                    "8" => Some(Code::Digit8), "9" => Some(Code::Digit9),
                    "f1" => Some(Code::F1), "f2" => Some(Code::F2),
                    "f3" => Some(Code::F3), "f4" => Some(Code::F4),
                    "f5" => Some(Code::F5), "f6" => Some(Code::F6),
                    "f7" => Some(Code::F7), "f8" => Some(Code::F8),
                    "f9" => Some(Code::F9), "f10" => Some(Code::F10),
                    "f11" => Some(Code::F11), "f12" => Some(Code::F12),
                    _ => None,
                };
            }
        }
    }

    let code = key_code?;
    let modifiers = if mods.is_empty() { None } else { Some(mods) };
    Some(Shortcut::new(modifiers, code))
}

/// Register all global shortcuts from config. Call on startup and after config change.
fn register_all_shortcuts(app: &tauri::AppHandle) {
    let config = crate::config::load_config();

    // Quick Ask shortcut
    let qa_shortcut = parse_shortcut(&config.quick_ask_shortcut)
        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::ALT), Code::Space));
    let qa_handle = app.clone();
    let _ = app.global_shortcut().on_shortcut(qa_shortcut, move |_app, _sc, _ev| {
        toggle_quickask(&qa_handle);
    });

    // Voice input shortcut (Ctrl+Shift+V by default)
    let voice_sc = parse_shortcut(&config.voice_shortcut)
        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV));
    let voice_handle = app.clone();
    let _ = app.global_shortcut().on_shortcut(voice_sc, move |_app, _sc, _ev| {
        voice_global::toggle_voice_input(&voice_handle);
    });
}

/// Tauri command: update a specific shortcut and re-register all shortcuts.
#[tauri::command]
fn update_shortcuts(
    app: tauri::AppHandle,
    quick_ask: Option<String>,
    voice: Option<String>,
) -> Result<(), String> {
    let mut config = crate::config::load_config();
    if let Some(s) = quick_ask { config.quick_ask_shortcut = s; }
    if let Some(s) = voice { config.voice_shortcut = s; }

    // Validate both shortcuts parse before saving
    if parse_shortcut(&config.quick_ask_shortcut).is_none() {
        return Err(format!("Invalid shortcut: {}", config.quick_ask_shortcut));
    }
    if parse_shortcut(&config.voice_shortcut).is_none() {
        return Err(format!("Invalid shortcut: {}", config.voice_shortcut));
    }

    crate::config::save_config(&config).map_err(|e| e.to_string())?;

    // Unregister all and re-register with new values
    let _ = app.global_shortcut().unregister_all();
    register_all_shortcuts(&app);

    Ok(())
}

#[tauri::command]
fn open_screen_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Check if overlay already exists
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let overlay_builder = tauri::WebviewWindowBuilder::new(
        &app,
        "overlay",
        tauri::WebviewUrl::App("overlay.html".into()),
    )
    .title("Screen Capture")
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true);

    // transparent() requires macosPrivateApi in tauri.conf.json on macOS (configured there)
    let overlay_builder = overlay_builder.transparent(true);

    overlay_builder.build().map_err(|e| e.to_string())?;

    Ok(())
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
    let runtime_registry: runtimes::SharedRuntimeRegistry =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let runtime_tasks: runtimes::SharedTaskGraphRegistry =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let runtime_missions: runtimes::SharedMissionRegistry =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let runtime_company_objects: runtimes::SharedCompanyObjectRegistry =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let runtime_security_engagements: runtimes::SharedSecurityEngagementRegistry =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let runtime_servers: runtimes::SharedRuntimeServerRegistry =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));

    // Vector store for semantic search
    let vector_store: embeddings::SharedVectorStore =
        Arc::new(std::sync::Mutex::new(embeddings::VectorStore::new()));

    tauri::Builder::default()
        // --- Plugins ---
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // SQLite handled by db.rs via rusqlite directly
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when second instance launched
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("blade".into()),
                    }),
                ])
                .build(),
        )
        // --- State ---
        .manage(mcp_manager)
        .manage(approval_map)
        .manage(shared_db)
        .manage(agent_queue)
        .manage(vector_store)
        .manage(runtime_registry)
        .manage(runtime_tasks)
        .manage(runtime_missions)
        .manage(runtime_company_objects)
        .manage(runtime_security_engagements)
        .manage(runtime_servers)
        .invoke_handler(tauri::generate_handler![
            commands::send_message_stream,
            commands::cancel_chat,
            roles::roles_list,
            roles::roles_get_active,
            roles::roles_set_active,
            git_style::git_style_mine,
            git_style::git_style_get,
            git_style::git_style_clear,
            commands::toggle_god_mode,
            commands::get_config,
            config::get_all_provider_keys,
            config::store_provider_key,
            config::switch_provider,
            commands::debug_config,
            commands::reset_onboarding,
            commands::set_config,
            commands::update_init_prefs,
            commands::test_provider,
            commands::mcp_add_server,
            commands::mcp_install_catalog_server,
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
            // Database commands
            db_commands::db_list_conversations,
            db_commands::db_get_conversation,
            db_commands::db_save_conversation,
            db_commands::db_delete_conversation,
            db_commands::db_search_messages,
            db_commands::db_pin_conversation,
            db_commands::db_rename_conversation,
            db_commands::db_conversation_stats,
            db_commands::db_list_knowledge,
            db_commands::db_get_knowledge,
            db_commands::db_add_knowledge,
            db_commands::db_update_knowledge,
            db_commands::db_delete_knowledge,
            db_commands::db_search_knowledge,
            db_commands::db_knowledge_by_tag,
            db_commands::db_knowledge_tags,
            db_commands::db_knowledge_stats,
            db_commands::db_track_event,
            db_commands::db_events_since,
            db_commands::db_prune_analytics,
            db_commands::db_analytics_summary,
            db_commands::db_get_setting,
            db_commands::db_set_setting,
            db_commands::db_get_all_settings,
            db_commands::db_delete_setting,
            db_commands::db_list_templates,
            db_commands::db_add_template,
            db_commands::db_delete_template,
            db_commands::db_increment_template_usage,
            brain::get_persona,
            brain::set_persona,
            brain::get_context,
            brain::brain_extract_from_exchange,
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
            voice::voice_transcribe_blob,
            screen::capture_screen,
            screen::capture_screen_region,
            memory::learn_from_conversation,
            managed_agents::run_managed_agent,
            runtimes::discover_ai_runtimes,
            runtimes::runtime_list_task_graphs,
            runtimes::runtime_save_mission,
            runtimes::runtime_list_missions,
            runtimes::runtime_save_company_object,
            runtimes::runtime_list_company_objects,
            runtimes::runtime_list_capability_blueprints,
            runtimes::security_create_engagement,
            runtimes::security_list_engagements,
            runtimes::security_mark_engagement_verified,
            runtimes::route_operator_task,
            runtimes::design_operator_mission,
            runtimes::runtime_plan_next_mission_stage,
            runtimes::runtime_continue_mission,
            runtimes::runtime_run_mission,
            runtimes::runtime_list_sessions,
            runtimes::runtime_prepare_install,
            runtimes::runtime_start_server,
            runtimes::runtime_stop_server,
            runtimes::runtime_start_task,
            runtimes::runtime_resume_session,
            runtimes::runtime_stop_task,
            runtimes::list_mission_specs,
            runtimes::save_mission_spec,
            runtimes::delete_mission_spec,
            runtimes::learn_from_mission_stage,
            runtimes::get_due_scheduled_missions,
            reports::report_gap,
            reports::get_reports,
            reports::update_report_status,
            reports::set_report_webhook,
            reports::get_report_webhook,
            agent_commands::agent_create,
            agent_commands::agent_create_desktop,
            agent_commands::agent_respond_desktop_action,
            agent_commands::agent_list,
            agent_commands::agent_get,
            agent_commands::agent_pause,
            agent_commands::agent_resume,
            agent_commands::agent_cancel,
            automation::auto_type_text,
            automation::auto_press_key,
            automation::auto_key_combo,
            automation::auto_mouse_move,
            automation::auto_get_mouse_position,
            automation::auto_mouse_click,
            automation::auto_mouse_click_relative,
            automation::auto_mouse_double_click,
            automation::auto_mouse_drag,
            automation::auto_scroll,
            automation::auto_open_url,
            automation::auto_open_path,
            automation::auto_launch_app,
            automation::auto_copy_to_clipboard,
            automation::auto_paste_clipboard,
            browser_native::web_action,
            browser_native::browser_describe_page,
            ui_automation::uia_get_active_window_snapshot,
            ui_automation::uia_describe_active_window,
            ui_automation::uia_click_element,
            ui_automation::uia_invoke_element,
            ui_automation::uia_focus_element,
            ui_automation::uia_set_element_value,
            ui_automation::uia_wait_for_element,
            context::get_active_window,
            context::list_open_windows,
            context::focus_window,
            context::get_user_activity,
            character::consolidate_character,
            character::consolidate_reactions_to_preferences,
            character::blade_get_soul,
            character::get_character_bible,
            character::update_character_section,
            memory::get_memory_log,
            router::classify_message,
            tray::set_tray_status,
            pulse::pulse_get_last_thought,
            pulse::pulse_now,
            pulse::pulse_explain,
            pulse::pulse_get_digest,
            journal::journal_get_recent,
            journal::journal_write_now,
            deeplearn::deeplearn_discover_sources,
            deeplearn::deeplearn_run,
            thread::blade_thread_update,
            thread::blade_thread_get,
            thread::blade_thread_auto_update,
            computer_use::computer_use_task,
            computer_use::computer_use_stop,
            computer_use::computer_use_screenshot,
            open_screen_overlay,
            voice_local::whisper_model_available,
            voice_local::whisper_download_model,
            voice_local::whisper_model_info,
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
            // Brain (Character Bible)
            db_commands::brain_get_identity,
            db_commands::brain_set_identity,
            db_commands::brain_get_style_tags,
            db_commands::brain_get_style_tag_entries,
            db_commands::brain_add_style_tag,
            db_commands::brain_remove_style_tag,
            db_commands::brain_get_preferences,
            db_commands::brain_upsert_preference,
            db_commands::brain_delete_preference,
            db_commands::brain_get_memories,
            db_commands::brain_add_memory,
            db_commands::brain_delete_memory,
            db_commands::brain_clear_memories,
            db_commands::brain_get_nodes,
            db_commands::brain_upsert_node,
            db_commands::brain_delete_node,
            db_commands::brain_get_edges,
            db_commands::brain_upsert_edge,
            db_commands::brain_get_skills,
            db_commands::brain_upsert_skill,
            db_commands::brain_delete_skill,
            db_commands::brain_set_skill_active,
            db_commands::brain_add_reaction,
            db_commands::brain_get_reactions,
            db_commands::brain_get_context,
            db_commands::timeline_get_recent,
            db_commands::timeline_prune_old,
            telegram::telegram_start,
            telegram::telegram_start_saved,
            telegram::telegram_stop,
            telegram::telegram_status,
            telegram::telegram_disconnect,
            tts::tts_speak,
            tts::tts_stop,
            tts::tts_available,
            tts::tts_list_voices,
            update_shortcuts,
            discord::discord_connect,
            discord::discord_disconnect,
            discord::discord_status,
            discord::discord_post,
            watcher::watcher_add,
            watcher::watcher_list_all,
            watcher::watcher_remove,
            watcher::watcher_toggle,
            obsidian::obsidian_ensure_daily_note,
            obsidian::obsidian_save_conversation,
            obsidian::obsidian_append_note,
            obsidian::obsidian_today_note,
            obsidian::obsidian_vault_configured,
            health::health_get_scan,
            health::health_scan_now,
            health::health_summary_all,
            cron::cron_add,
            cron::cron_list,
            cron::cron_delete,
            cron::cron_toggle,
            session_handoff::session_handoff_clear,
            session_handoff::session_handoff_write,
            session_handoff::session_handoff_get,
            self_upgrade::self_upgrade_install,
            self_upgrade::self_upgrade_catalog,
            self_upgrade::self_upgrade_audit,
            self_upgrade::pentest_authorize,
            self_upgrade::pentest_check_auth,
            self_upgrade::pentest_revoke,
            self_upgrade::pentest_list_auth,
            self_upgrade::pentest_check_model_safety,
            background_agent::agent_spawn,
            background_agent::agent_list_background,
            background_agent::agent_get_background,
            background_agent::agent_cancel_background,
            background_agent::agent_detect_available,
            background_agent::agent_get_output,
            indexer::blade_index_project,
            indexer::blade_find_symbol,
            indexer::blade_list_indexed_projects,
            indexer::blade_reindex_file,
            indexer::blade_project_summary,
            execution_memory::exmem_record,
            execution_memory::exmem_search,
            execution_memory::exmem_recent,
            reminders::reminder_add,
            reminders::reminder_add_natural,
            reminders::reminder_list,
            reminders::reminder_delete,
            reminders::reminder_parse_time,
            evolution::evolution_get_level,
            evolution::evolution_get_suggestions,
            evolution::evolution_dismiss_suggestion,
            evolution::evolution_install_suggestion,
            evolution::evolution_run_now,
            evolution::evolution_log_capability_gap,
            research::research_get_recent,
            research::research_query,
            research::research_clear,
            wake_word::wake_word_start,
            wake_word::wake_word_stop,
            wake_word::wake_word_status,
            soul_commands::soul_get_state,
            soul_commands::soul_take_snapshot,
            soul_commands::soul_delete_preference,
            soul_commands::soul_update_bible_section,
            soul_commands::soul_refresh_bible,
            screen_timeline_commands::timeline_search_cmd,
            screen_timeline_commands::timeline_browse_cmd,
            screen_timeline_commands::timeline_get_screenshot,
            screen_timeline_commands::timeline_get_thumbnail,
            screen_timeline_commands::timeline_get_config,
            screen_timeline_commands::timeline_set_config,
            screen_timeline_commands::timeline_get_stats_cmd,
            screen_timeline_commands::timeline_cleanup,
            swarm_commands::swarm_create,
            swarm_commands::swarm_list,
            swarm_commands::swarm_get,
            swarm_commands::swarm_pause,
            swarm_commands::swarm_resume,
            swarm_commands::swarm_cancel,
            swarm_commands::swarm_write_scratchpad,
            swarm_commands::swarm_read_scratchpad,
        ])
        .setup(move |app| {
            // Window state (position/size) handled by tauri-plugin-window-state
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Create the Quick Ask floating widget window — always hidden on startup
            // (window-state plugin can restore it as visible, so force-hide after build)
            let quickask_builder = tauri::WebviewWindowBuilder::new(
                app,
                "quickask",
                tauri::WebviewUrl::App("quickask.html".into()),
            )
            .title("Blade Quick Ask")
            .inner_size(500.0, 72.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center()
            .visible(false);

            // transparent() requires macosPrivateApi in tauri.conf.json on macOS (configured there)
            let quickask_builder = quickask_builder.transparent(true);

            let quickask = quickask_builder.build()?;
            // Force hidden regardless of any restored window state
            let _ = quickask.hide();

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

            // Start ambient intelligence monitor
            ambient::start_ambient_monitor(app.handle().clone());

            // Start Blade's pulse — the heartbeat that makes it alive
            pulse::start_pulse(app.handle().clone());

            // Morning briefing — fires once per day if it's morning
            let briefing_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Brief delay so the window is visible before briefing fires
                tokio::time::sleep(tokio::time::Duration::from_secs(8)).await;
                pulse::maybe_morning_briefing(briefing_app).await;
            });

            // Evening journal + weekly soul evolution
            tauri::async_runtime::spawn(async move {
                loop {
                    let hour = chrono::Local::now().hour();
                    if hour >= 20 {
                        journal::maybe_write_journal().await;
                        // Weekly: BLADE evolves its own self-characterization
                        character::maybe_evolve_soul().await;
                    }
                    // Check once per hour
                    tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
                }
            });

            // Proactive code health scanner — scans indexed projects every 30 min
            health::start_health_scanner(app.handle().clone());

            // BLADE Cron — autonomous scheduled tasks
            cron::start_cron_loop(app.handle().clone());

            // Write session handoff on startup (captures what happened last session)
            let handoff_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Small delay so execution memory is initialized
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                session_handoff::write_session_handoff();
                // Keep updating every 15 minutes during the session
                let _ = handoff_app; // keep handle alive
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(900)).await;
                    session_handoff::write_session_handoff();
                }
            });

            // Start god mode if enabled
            let startup_god_config = config::load_config();
            if startup_god_config.god_mode {
                godmode::start_god_mode(app.handle().clone(), &startup_god_config.god_mode_tier);
            } else if startup_god_config.screen_timeline_enabled {
                // Timeline can run independently of god mode
                screen_timeline::start_timeline_capture_loop(app.handle().clone());
            }

            // Start wake word listener if enabled
            if startup_god_config.wake_word_enabled {
                wake_word::start_wake_word_listener(app.handle().clone());
            }

            // EVOLUTION ENGINE — BLADE's self-improvement loop.
            // Watches what you use and progressively wires BLADE into your stack.
            evolution::start_evolution_loop(app.handle().clone());

            // Auto-start Telegram bot if a token was previously saved
            let tg_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                telegram::auto_start_if_configured(tg_app).await;
            });

            // Start URL/resource watcher loop
            watcher::start_watcher_loop(app.handle().clone());

            // Create today's Obsidian daily note if vault is configured
            obsidian::ensure_daily_note();

            // Start reminder loop — checks every 30s for due reminders
            reminders::start_reminder_loop(app.handle().clone());

            // Register shortcuts from config (or defaults)
            register_all_shortcuts(app.handle());

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
