mod accountability;
mod agent_commands;
mod cmd_util;
mod autoskills;
mod git_style;
mod multimodal;
mod roles;
mod ambient;
mod autonomous_research;
mod dream_mode;
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
mod goal_engine;
mod learning_engine;
mod self_critique;
mod tool_forge;
mod sidecar;
mod proactive_engine;
mod native_tools;
mod code_sandbox;
mod causal_graph;
mod memory_palace;
mod authority_engine;
mod kali;
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
mod audit;
mod body_registry;
mod brain_planner;
mod cardiovascular;
mod consequence;
mod discovery;
mod dna;
mod homeostasis;
mod file_indexer;
mod immune_system;
mod joints;
mod metacognition;
mod organ;
mod prefrontal;
mod proactive_vision;
mod reproductive;
mod show_engine;
mod skeleton;
mod social_cognition;
mod symbolic;
mod supervisor;
mod urinary;
mod embeddings;
mod files;
mod history;
mod managed_agents;
mod mcp;
mod mcp_memory_server;
mod mcp_fs_server;
mod memory;
mod permissions;
mod plugins;
mod providers;
mod rag;
mod reports;
mod router;
mod runtimes;
mod audio_timeline;
mod vad;
mod deepgram;
mod screen;
mod screen_timeline;
mod screen_timeline_commands;
mod swarm;
mod swarm_planner;
mod ai_delegate;
mod self_code;
mod swarm_commands;
mod wake_word;
mod soul_commands;
mod persona_engine;
mod negotiation_engine;
mod trace;
mod tray;
mod ui_automation;
mod voice;
mod voice_global;
mod voice_intelligence;
mod voice_local;
mod whisper_local;
mod world_model;
mod workflow_builder;
mod context_engine;
mod financial_brain;
mod reasoning_engine;
mod social_graph;
mod health_tracker;
mod document_intelligence;
mod meeting_intelligence;
mod habit_engine;
mod knowledge_graph;
mod emotional_intelligence;
mod prediction_engine;
mod activity_monitor;
mod action_tags;
mod browser_agent;
mod perception_fusion;
mod decision_gate;
mod deep_scan;
mod integration_bridge;
mod system_control;
mod notification_listener;
mod security_monitor;
mod health_guardian;
mod temporal_intel;
mod iot_bridge;
mod typed_memory;
mod personality_mirror;
mod ghost_mode;
mod overlay_manager;
mod people_graph;
mod auto_reply;
mod streak_stats;
mod hive;
mod auto_fix;
mod tentacles;
mod agent_factory;

use chrono::Timelike;
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager, WindowEvent};

/// Safely truncate a string at a char boundary.
/// Unlike `&s[..n]`, this never panics on non-ASCII (emoji, CJK, etc.).
#[allow(dead_code)]
pub(crate) fn safe_slice(s: &str, n: usize) -> &str {
    if s.len() <= n { return s; }
    let end = s.char_indices().nth(n).map(|(i, _)| i).unwrap_or(s.len());
    &s[..end]
}

/// Strip markdown fences from an LLM JSON response.
/// Handles ` ```json ... ``` ` and ` ``` ... ``` ` wrappers.
#[allow(dead_code)]
pub(crate) fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("```json").or_else(|| s.strip_prefix("```")) {
        let inner = inner.trim_start_matches('\n');
        if let Some(end) = inner.rfind("```") {
            return inner[..end].trim();
        }
        return inner.trim();
    }
    s
}
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

    // Quick Ask shortcut (default: Ctrl+Space — Alt+Space conflicts with Windows system menu)
    let qa_shortcut = parse_shortcut(&config.quick_ask_shortcut)
        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::CONTROL), Code::Space));
    let qa_handle = app.clone();
    if let Err(e) = app.global_shortcut().on_shortcut(qa_shortcut, move |_app, _sc, _ev| {
        toggle_quickask(&qa_handle);
    }) {
        log::error!("Failed to register Quick Ask shortcut '{}': {}", config.quick_ask_shortcut, e);
        let _ = app.emit("shortcut_registration_failed", serde_json::json!({
            "shortcut": &config.quick_ask_shortcut,
            "name": "Quick Ask",
            "error": e.to_string()
        }));
    }

    // Voice input shortcut (default: Ctrl+Shift+B — Ctrl+Shift+V conflicts with paste-without-formatting)
    let voice_sc = parse_shortcut(&config.voice_shortcut)
        .unwrap_or_else(|| Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyB));
    let voice_handle = app.clone();
    if let Err(e) = app.global_shortcut().on_shortcut(voice_sc, move |_app, _sc, _ev| {
        voice_global::toggle_voice_input(&voice_handle);
    }) {
        log::error!("Failed to register Voice shortcut '{}': {}", config.voice_shortcut, e);
        let _ = app.emit("shortcut_registration_failed", serde_json::json!({
            "shortcut": &config.voice_shortcut,
            "name": "Voice Input",
            "error": e.to_string()
        }));
    }

    // Ghost response card toggle: Ctrl+G
    // Emits ghost_toggle_card to the HUD and ghost overlay windows.
    let ghost_handle = app.clone();
    let ghost_sc = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyG);
    if let Err(e) = app.global_shortcut().on_shortcut(ghost_sc, move |_app, _sc, _ev| {
        let _ = ghost_handle.emit("ghost_toggle_card", serde_json::json!({}));
    }) {
        log::warn!("Failed to register Ctrl+G ghost shortcut: {}", e);
    }
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

    // Ensure default BLADE.md exists (identity/rules file, loaded first in every prompt)
    brain::ensure_default_blade_md();

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
            config::get_task_routing,
            config::set_task_routing,
            config::save_config_field,
            commands::debug_config,
            commands::reset_onboarding,
            commands::get_onboarding_status,
            commands::complete_onboarding,
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
            commands::mcp_server_health,
            commands::respond_tool_approval,
            commands::history_list_conversations,
            commands::history_load_conversation,
            commands::history_save_conversation,
            commands::history_rename_conversation,
            commands::auto_title_conversation,
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
            clipboard::get_clipboard_prefetch,
            native_tools::run_code_block,
            native_tools::run_shell,
            native_tools::ask_ai,
            ai_delegate::ai_delegate_introduce,
            ai_delegate::ai_delegate_check,
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
            voice_intelligence::voice_intel_start_session,
            voice_intelligence::voice_intel_end_session,
            voice_intelligence::voice_intel_add_segment,
            voice_intelligence::voice_intel_analyze_emotion,
            voice_intelligence::voice_intel_get_context,
            voice_intelligence::voice_intel_get_session,
            voice_intelligence::voice_intel_detect_language,
            screen::capture_screen,
            screen::capture_screen_region,
            screen::get_monitors,
            screen::move_to_monitor,
            multimodal::multimodal_analyze_file,
            multimodal::multimodal_analyze_base64,
            multimodal::multimodal_extract_code,
            multimodal::multimodal_extract_diagram,
            multimodal::multimodal_ocr,
            multimodal::multimodal_analyze_ui,
            multimodal::multimodal_supports_vision,
            self_code::blade_self_code,
            self_code::blade_source_path_resolve,
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
            character::reaction_instant_rule,
            character::blade_get_soul,
            character::get_character_bible,
            character::update_character_section,
            memory::get_memory_log,
            memory::get_memory_blocks,
            memory::set_memory_block,
            memory::run_weekly_memory_consolidation,
            character::apply_reaction_to_traits,
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
            whisper_local::whisper_transcribe_local,
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
            tts::tts_classify_style,
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
            cron::cron_run_now,
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
            background_agent::agent_auto_spawn,
            background_agent::agent_spawn_codex,
            background_agent::get_active_agents,
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
            voice_global::start_voice_conversation,
            voice_global::stop_voice_conversation,
            voice_global::voice_conversation_active,
            soul_commands::soul_get_state,
            soul_commands::soul_take_snapshot,
            soul_commands::soul_delete_preference,
            soul_commands::soul_update_bible_section,
            soul_commands::soul_refresh_bible,
            soul_commands::get_user_profile,
            screen_timeline_commands::timeline_search_cmd,
            screen_timeline_commands::timeline_browse_cmd,
            screen_timeline_commands::timeline_get_screenshot,
            screen_timeline_commands::timeline_get_thumbnail,
            screen_timeline_commands::timeline_get_config,
            screen_timeline_commands::timeline_set_config,
            screen_timeline_commands::timeline_get_stats_cmd,
            screen_timeline_commands::timeline_cleanup,
            screen_timeline_commands::timeline_search_everything,
            screen_timeline_commands::timeline_get_audio,
            screen_timeline_commands::timeline_meeting_summary,
            screen_timeline_commands::timeline_get_action_items,
            screen_timeline_commands::timeline_set_audio_capture,
            screen_timeline_commands::timeline_detect_meeting,
            swarm_commands::swarm_create,
            swarm_commands::swarm_list,
            swarm_commands::swarm_get,
            swarm_commands::swarm_pause,
            swarm_commands::swarm_resume,
            swarm_commands::swarm_cancel,
            swarm_commands::swarm_write_scratchpad,
            swarm_commands::swarm_write_scratchpad_entry,
            swarm_commands::swarm_read_scratchpad,
            swarm_commands::swarm_get_progress,
            goal_engine::goal_add,
            goal_engine::goal_list,
            goal_engine::goal_complete,
            goal_engine::goal_delete,
            goal_engine::goal_update_priority,
            goal_engine::goal_pursue_now,
            learning_engine::learning_get_patterns,
            learning_engine::learning_get_predictions,
            learning_engine::learning_run_analysis,
            learning_engine::learning_weekly_summary,
            self_critique::self_critique_response,
            self_critique::self_critique_history,
            self_critique::self_critique_deep_roast,
            self_critique::self_critique_weekly_meta,
            kali::kali_recon,
            kali::kali_crack_hash,
            kali::kali_analyze_ctf,
            kali::kali_explain_exploit,
            kali::kali_generate_payload,
            kali::kali_check_tools,
            world_model::world_get_state,
            world_model::world_get_summary,
            world_model::world_refresh,
            autonomous_research::research_list_gaps,
            autonomous_research::research_add_gap,
            autonomous_research::research_trigger_now,
            dream_mode::dream_is_active,
            dream_mode::dream_trigger_now,
            dream_mode::dream_record_activity,
            causal_graph::causal_get_insights,
            causal_graph::causal_acknowledge,
            causal_graph::causal_analyze,
            causal_graph::causal_record_event,
            causal_graph::causal_run_full_analysis,
            // Memory Palace — episodic long-term memory
            memory_palace::memory_search,
            memory_palace::memory_get_recent,
            memory_palace::memory_recall,
            memory_palace::memory_add_manual,
            memory_palace::memory_delete,
            memory_palace::memory_consolidate_now,
            // Typed Memory — Omi-inspired structured memory categories
            typed_memory::memory_store_typed,
            typed_memory::memory_recall_category,
            typed_memory::memory_get_all_typed,
            typed_memory::memory_delete_typed,
            typed_memory::memory_generate_user_summary,
            // Tool Forge — self-expanding capability engine
            tool_forge::forge_new_tool,
            tool_forge::forge_list_tools,
            tool_forge::forge_delete_tool,
            tool_forge::forge_test_tool,
            // Authority Engine — 9 specialist agents with auditable delegation
            authority_engine::authority_get_agents,
            authority_engine::authority_get_audit_log,
            authority_engine::authority_get_delegations,
            authority_engine::authority_delegate,
            authority_engine::authority_route_and_run,
            authority_engine::authority_run_chain,
            // Sidecar — cross-device coordination
            sidecar::sidecar_list_devices,
            sidecar::sidecar_register_device,
            sidecar::sidecar_remove_device,
            sidecar::sidecar_ping_device,
            sidecar::sidecar_run_command,
            sidecar::sidecar_run_all,
            sidecar::sidecar_start_server,
            // Accountability — objectives, key results, daily actions, nudges
            accountability::accountability_get_objectives,
            accountability::accountability_create_objective,
            accountability::accountability_update_kr,
            accountability::accountability_daily_plan,
            accountability::accountability_complete_action,
            accountability::accountability_checkin,
            accountability::accountability_progress_report,
            accountability::accountability_get_daily_actions,
            // Proactive Engine — autonomous initiative layer
            proactive_engine::proactive_get_pending,
            proactive_engine::proactive_accept,
            proactive_engine::proactive_dismiss,
            proactive_engine::proactive_get_rules,
            proactive_engine::proactive_toggle_rule,
            proactive_engine::proactive_trigger_check,
            // Persona Engine — soul deepening, personal trait learning
            persona_engine::persona_get_traits,
            persona_engine::persona_get_relationship,
            persona_engine::persona_update_trait,
            persona_engine::persona_get_context,
            persona_engine::persona_analyze_now,
            persona_engine::persona_record_outcome,
            persona_engine::persona_analyze_now_weekly,
            // Persona Engine v2 — UserModel, behavioral prediction, expertise tracking
            persona_engine::get_user_model,
            persona_engine::predict_next_need_cmd,
            persona_engine::get_expertise_map,
            persona_engine::update_expertise,
            persona_engine::persona_estimate_mood,
            // Code Sandbox — safe multi-language code execution
            code_sandbox::sandbox_run,
            code_sandbox::sandbox_run_explain,
            code_sandbox::sandbox_fix_and_run,
            code_sandbox::sandbox_detect_language,
            // Workflow Builder — visual n8n-style automation
            workflow_builder::workflow_list,
            workflow_builder::workflow_get,
            workflow_builder::workflow_create,
            workflow_builder::workflow_update,
            workflow_builder::workflow_delete,
            workflow_builder::workflow_run_now,
            workflow_builder::workflow_get_runs,
            workflow_builder::workflow_generate_from_description,
            // Context Engine — smart RAG context assembly
            context_engine::context_assemble,
            context_engine::context_score_chunk,
            context_engine::context_clear_cache,
            // Financial Brain — personal finance intelligence
            financial_brain::finance_add_transaction,
            financial_brain::finance_get_transactions,
            financial_brain::finance_delete_transaction,
            financial_brain::finance_get_snapshot,
            financial_brain::finance_generate_insights,
            financial_brain::finance_get_goals,
            financial_brain::finance_create_goal,
            financial_brain::finance_update_goal,
            financial_brain::finance_investment_suggestions,
            financial_brain::finance_budget_recommendation,
            financial_brain::finance_get_context,
            // Negotiation Engine — debate coach + negotiation assistant
            negotiation_engine::negotiation_build_argument,
            negotiation_engine::negotiation_steelman,
            negotiation_engine::negotiation_find_common_ground,
            negotiation_engine::negotiation_start_debate,
            negotiation_engine::negotiation_round,
            negotiation_engine::negotiation_conclude,
            negotiation_engine::negotiation_analyze,
            negotiation_engine::negotiation_roleplay,
            negotiation_engine::negotiation_critique_move,
            negotiation_engine::negotiation_get_debates,
            negotiation_engine::negotiation_get_scenarios,
            // Reasoning Engine — System 2 slow-thinking brain
            reasoning_engine::reasoning_think,
            reasoning_engine::reasoning_decompose,
            reasoning_engine::reasoning_test_hypothesis,
            reasoning_engine::reasoning_socratic,
            reasoning_engine::reasoning_get_traces,
            // Social Graph — personal CRM with emotional intelligence
            social_graph::social_add_contact,
            social_graph::social_get_contact,
            social_graph::social_search_contacts,
            social_graph::social_update_contact,
            social_graph::social_delete_contact,
            social_graph::social_list_contacts,
            social_graph::social_log_interaction,
            social_graph::social_get_interactions,
            social_graph::social_analyze_interaction,
            social_graph::social_get_insights,
            social_graph::social_how_to_approach,
            // Health Tracker — wellbeing intelligence
            health_tracker::health_log,
            health_tracker::health_get_today,
            health_tracker::health_update_today,
            health_tracker::health_get_logs,
            health_tracker::health_get_stats,
            health_tracker::health_get_insights,
            health_tracker::health_get_context,
            health_tracker::health_correlate_productivity,
            health_tracker::health_streak_info,
            // Document Intelligence — deep document reading and Q&A library
            document_intelligence::doc_ingest,
            document_intelligence::doc_search,
            document_intelligence::doc_get,
            document_intelligence::doc_list,
            document_intelligence::doc_delete,
            document_intelligence::doc_answer_question,
            document_intelligence::doc_cross_synthesis,
            document_intelligence::doc_generate_study_notes,
            // Habit Engine — streak tracking, friction analysis, smart reminders
            habit_engine::habit_create,
            habit_engine::habit_list,
            habit_engine::habit_get,
            habit_engine::habit_complete,
            habit_engine::habit_skip,
            habit_engine::habit_get_logs,
            habit_engine::habit_get_today,
            habit_engine::habit_insights,
            habit_engine::habit_suggest_design,
            habit_engine::habit_get_context,
            // Meeting Intelligence — capture, extract, and track meetings
            meeting_intelligence::meeting_process,
            meeting_intelligence::meeting_get,
            meeting_intelligence::meeting_list,
            meeting_intelligence::meeting_search,
            meeting_intelligence::meeting_delete,
            meeting_intelligence::meeting_get_action_items,
            meeting_intelligence::meeting_complete_action,
            meeting_intelligence::meeting_follow_up_email,
            meeting_intelligence::meeting_compare,
            meeting_intelligence::meeting_recurring_themes,
            // Knowledge Graph — semantic concept network across all BLADE knowledge
            knowledge_graph::graph_add_node,
            knowledge_graph::graph_search_nodes,
            knowledge_graph::graph_traverse,
            knowledge_graph::graph_find_path,
            knowledge_graph::graph_extract_from_text,
            knowledge_graph::graph_answer,
            knowledge_graph::graph_get_stats,
            knowledge_graph::graph_delete_node,
            // Prediction Engine — anticipatory intelligence, pattern-based foresight
            prediction_engine::prediction_get_pending,
            prediction_engine::prediction_accept,
            prediction_engine::prediction_dismiss,
            prediction_engine::prediction_generate_now,
            prediction_engine::prediction_contextual,
            prediction_engine::prediction_get_patterns,
            // Emotional Intelligence — adaptive empathy engine
            emotional_intelligence::emotion_get_current,
            emotional_intelligence::emotion_get_trend,
            emotional_intelligence::emotion_get_readings,
            emotional_intelligence::emotion_analyze_patterns,
            emotional_intelligence::emotion_get_context,
            // Browser Native — embedded browser sessions
            browser_native::browser_session_status,
            browser_native::connect_to_user_browser,
            config::toggle_background_ai,
            // Browser Agent — CDP-backed browser automation + autonomous agent loop
            browser_agent::browser_action,
            browser_agent::browser_agent_loop,
            // Perception Fusion — fused sensory state for God Mode JARVIS layer
            perception_fusion::perception_get_latest,
            perception_fusion::perception_update,
            // Decision Gate — autonomous signal classifier (act / ask / queue / ignore)
            decision_gate::get_decision_log,
            decision_gate::decision_feedback,
            decision_gate::decision_evaluate,
            // God Mode — proactive task queue exposed to frontend
            godmode::get_proactive_tasks,
            godmode::dismiss_proactive_task,
            godmode::get_god_mode_context,
            // Deep Scan -- full machine identity discovery
            deep_scan::deep_scan_start,
            deep_scan::deep_scan_results,
            deep_scan::deep_scan_summary,
            // Integration Bridge — Phase 4 MCP real-world integrations
            integration_bridge::integration_get_state,
            integration_bridge::integration_toggle,
            integration_bridge::integration_poll_now,
            // System Control — Phase 7 autonomous desktop management
            system_control::lock_screen,
            system_control::sleep_computer,
            system_control::set_brightness,
            system_control::set_volume,
            system_control::launch_app,
            system_control::kill_app,
            system_control::list_running_apps,
            system_control::sc_focus_window,
            system_control::minimize_all,
            system_control::get_battery_status,
            system_control::get_network_status,
            // Notification Listener — Phase 5 partial
            notification_listener::notification_get_recent,
            notification_listener::notification_listener_start,
            // Security Monitor — Phase 9 security fortress
            security_monitor::security_scan_network,
            security_monitor::security_check_breach,
            security_monitor::security_check_password_hash,
            security_monitor::security_scan_sensitive_files,
            security_monitor::security_check_url,
            security_monitor::security_overview,
            // Security Monitor — Phase 10 Decepticon-inspired chained pipeline
            security_monitor::security_run_audit,
            security_monitor::security_audit_deps,
            security_monitor::security_scan_code,
            // Financial Brain — Phase 8A CSV import + analytics
            financial_brain::finance_import_csv,
            financial_brain::finance_auto_categorize,
            financial_brain::finance_spending_summary,
            financial_brain::finance_detect_subscriptions,
            // Health Guardian — Phase 8B screen time monitoring
            health_guardian::health_guardian_stats,
            health_guardian::health_take_break,
            // Temporal Intelligence — Phase 8C time-aware context
            temporal_intel::temporal_what_was_i_doing,
            temporal_intel::temporal_daily_standup,
            temporal_intel::temporal_detect_patterns,
            temporal_intel::temporal_meeting_prep,
            // IoT Bridge — Home Assistant + Spotify
            iot_bridge::iot_get_entities,
            iot_bridge::iot_get_state,
            iot_bridge::iot_call_service,
            iot_bridge::spotify_now_playing_cmd,
            iot_bridge::spotify_play_pause_cmd,
            iot_bridge::spotify_next_cmd,
            // Personality Mirror -- chat-style extraction + injection
            personality_mirror::personality_analyze,
            personality_mirror::personality_import_chats,
            personality_mirror::personality_get_profile,
            // Ghost Mode -- invisible AI overlay for meetings and chat
            ghost_mode::ghost_start,
            ghost_mode::ghost_stop,
            ghost_mode::ghost_set_position,
            ghost_mode::ghost_get_status,
            // Overlay Manager -- HUD bar + toast notifications
            overlay_manager::overlay_show_hud,
            overlay_manager::overlay_hide_hud,
            overlay_manager::overlay_update_hud,
            overlay_manager::overlay_show_notification,
            // People Graph -- relationship memory and reply style intelligence
            people_graph::people_list,
            people_graph::people_get,
            people_graph::people_upsert,
            people_graph::people_delete,
            people_graph::people_suggest_reply_style,
            people_graph::people_learn_from_conversation,
            people_graph::people_get_context_for_prompt,
            // Auto Reply -- draft replies in your style
            auto_reply::auto_reply_draft,
            auto_reply::auto_reply_learn_from_edit,
            auto_reply::auto_reply_draft_batch,
            // Daily Digest -- rich morning briefing
            pulse::pulse_daily_digest,
            pulse::pulse_get_daily_digest,
            // Streak & Stats -- gamification layer
            streak_stats::streak_get_stats,
            streak_stats::streak_record_activity,
            streak_stats::streak_get_display,
            // HIVE — distributed agent mesh across every platform
            hive::hive_start,
            hive::hive_stop,
            hive::hive_get_status,
            hive::hive_get_digest,
            hive::hive_spawn_tentacle,
            dna::dna_get_identity,
            dna::dna_get_goals,
            dna::dna_get_patterns,
            dna::dna_query,
            file_indexer::file_index_scan_now,
            file_indexer::file_index_search,
            file_indexer::file_index_recent,
            file_indexer::file_index_stats,
            immune_system::immune_resolve_gap,
            organ::organ_get_registry,
            organ::organ_get_roster,
            organ::organ_set_autonomy,
            organ::organ_get_autonomy,
            joints::joints_list_providers,
            joints::joints_list_stores,
            cardiovascular::cardio_get_blood_pressure,
            cardiovascular::cardio_get_event_registry,
            cardiovascular::blade_vital_signs,
            supervisor::supervisor_get_health,
            supervisor::supervisor_get_service,
            urinary::urinary_flush,
            urinary::immune_get_status,
            reproductive::reproductive_get_dna,
            reproductive::reproductive_spawn,
            audit::audit_get_log,
            body_registry::body_get_map,
            body_registry::body_get_system,
            body_registry::body_get_summary,
            consequence::consequence_predict,
            metacognition::metacognition_assess,
            social_cognition::social_get_advice,
            show_engine::show_record_request,
            show_engine::show_dismiss,
            show_engine::show_get_patterns,
            symbolic::symbolic_check_policy,
            symbolic::symbolic_list_policies,
            symbolic::symbolic_add_policy,
            symbolic::symbolic_verify_plan,
            homeostasis::homeostasis_get,
            homeostasis::homeostasis_get_directive,
            homeostasis::homeostasis_get_circadian,
            homeostasis::homeostasis_relearn_circadian,
            prefrontal::prefrontal_get,
            prefrontal::prefrontal_clear,
            proactive_vision::proactive_get_cards,
            proactive_vision::proactive_get_focus_score,
            proactive_vision::proactive_dismiss_card,
            hive::hive_get_reports,
            hive::hive_approve_decision,
            hive::hive_set_autonomy,
            // Auto-Fix Pipeline — autonomous CI repair engine
            auto_fix::auto_fix_analyze,
            auto_fix::auto_fix_execute,
            auto_fix::auto_fix_full_pipeline,
            // GitHub Deep Tentacle — PR review, issue triage, releases, dependabot, health
            tentacles::github_deep::github_review_pr,
            tentacles::github_deep::github_triage_issues,
            tentacles::github_deep::github_draft_release,
            tentacles::github_deep::github_auto_merge_dependabot,
            tentacles::github_deep::github_community_health,
            // GitHub Smart — reviewer assignment, breaking change detection, smart review/triage
            tentacles::github_deep::github_smart_assign_reviewer,
            tentacles::github_deep::github_detect_breaking_changes,
            tentacles::github_deep::github_smart_review_pr,
            tentacles::github_deep::github_smart_triage_issues,
            // Calendar Tentacle — schedule, meeting prep, focus blocks, post-meeting summaries
            tentacles::calendar_tentacle::calendar_get_today,
            tentacles::calendar_tentacle::calendar_prep_meeting,
            tentacles::calendar_tentacle::calendar_auto_block_focus,
            tentacles::calendar_tentacle::calendar_post_meeting_summary,
            // Calendar Smart — meeting load, double-booking detection, smart prep, summary drafts
            tentacles::calendar_tentacle::calendar_analyze_meeting_load,
            tentacles::calendar_tentacle::calendar_detect_double_bookings,
            tentacles::calendar_tentacle::calendar_smart_prep_meeting,
            tentacles::calendar_tentacle::calendar_post_meeting_with_draft,
            // Filesystem Tentacle — approve a suggested file move (learning loop)
            tentacles::filesystem_watch::filesystem_approve_move,
            // Discord Deep Tentacle — community management, moderation, summaries, welcomes
            tentacles::discord_deep::discord_process_mentions,
            tentacles::discord_deep::discord_moderate_server,
            tentacles::discord_deep::discord_summarize_channels,
            tentacles::discord_deep::discord_welcome_new_members,
            // Linear/Jira Tentacle — Git→ticket sync, blocker detection, sprint reports
            tentacles::linear_jira::linear_sync_git_to_tickets,
            tentacles::linear_jira::linear_detect_blockers,
            tentacles::linear_jira::linear_generate_sprint_report,
            tentacles::linear_jira::linear_auto_create_ticket,
            // Log Monitor Tentacle — tail, anomaly detection, error chains, Sentry groups
            tentacles::log_monitor::log_start_tailing,
            tentacles::log_monitor::log_detect_anomalies,
            tentacles::log_monitor::log_correlate_errors,
            tentacles::log_monitor::log_get_error_groups,
            tentacles::log_monitor::log_search,
            // Cloud Costs Tentacle — AWS Cost Explorer, anomalies, savings, weekly report
            tentacles::cloud_costs::cloud_check_aws_costs,
            tentacles::cloud_costs::cloud_detect_cost_anomalies,
            tentacles::cloud_costs::cloud_suggest_savings,
            tentacles::cloud_costs::cloud_weekly_cost_report,
            tentacles::cloud_costs::cloud_weekly_cost_report_live,
            // Agent Factory — NosShip-inspired "describe it, deploy it" agent builder
            agent_factory::factory_create_agent,
            agent_factory::factory_deploy_agent,
            agent_factory::factory_list_agents,
            agent_factory::factory_pause_agent,
            agent_factory::factory_delete_agent,
            commands::get_wallpaper_path,
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
                // Register built-in in-process servers first
                manager.register_built_in_servers();
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

            // MCP server health monitor — checks every RECONNECT_INTERVAL_SECS and
            // auto-reconnects dead servers. Fresh lock per iteration keeps tool calls unblocked.
            let health_manager = setup_manager.clone();
            let health_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(
                        mcp::RECONNECT_INTERVAL_SECS,
                    )).await;
                    let health = {
                        let manager = health_manager.lock().await;
                        manager.get_server_health()
                    };
                    for server in &health {
                        if !server.connected && server.reconnect_attempts < 3 {
                            // Try to reconnect: acquire lock, attempt reconnect
                            let mut manager = health_manager.lock().await;
                            if let Err(e) = manager.try_reconnect(&server.name).await {
                                log::warn!(
                                    "MCP auto-reconnect for '{}' failed: {}",
                                    server.name, e
                                );
                            } else {
                                // Re-discover tools now that it's back
                                let _ = manager.discover_all_tools().await;
                                let _ = health_app.emit(
                                    "mcp_server_reconnected",
                                    serde_json::json!({ "server": &server.name }),
                                );
                            }
                        }
                    }
                }
            });

            // SKELETON: initialize ALL database tables before any background thread starts.
            // Without this, modules that query tables before their first ensure_tables()
            // call would fail silently. This is the skull — structural integrity.
            skeleton::init_all_tables();

            // Start HUD update loop (pushes data every 10s when HUD is visible)
            overlay_manager::start_hud_update_loop(app.handle().clone());

            // Start clipboard watcher
            clipboard::start_clipboard_watcher(app.handle().clone());

            // Start homeostasis — the hypothalamus that regulates the whole body
            homeostasis::start_hypothalamus(app.handle().clone());

            // Start perception fusion loop — keeps get_latest() fresh for all consumers
            perception_fusion::start_perception_loop(app.handle().clone());

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

            // Evening journal + weekly soul evolution + daily character consolidation
            tauri::async_runtime::spawn(async move {
                loop {
                    let hour = chrono::Local::now().hour();
                    if hour >= 20 {
                        journal::maybe_write_journal().await;
                        // Weekly: BLADE evolves its own self-characterization
                        character::maybe_evolve_soul().await;
                    }
                    // Daily: merge accumulated raw context into the character bible.
                    // Raw context grows from every conversation via learn_from_conversation.
                    // Without periodic consolidation it accumulates forever and never shapes BLADE's behavior.
                    let _ = character::consolidate_character().await;
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

            // BLADE always sees, always hears, always aware.
            // There is no "God Mode off" — that's just another ChatGPT wrapper.
            // The ambient awareness IS the product.
            let startup_god_config = config::load_config();
            let god_tier = if startup_god_config.god_mode_tier.is_empty() {
                "intermediate".to_string()
            } else {
                startup_god_config.god_mode_tier.clone()
            };
            godmode::start_god_mode(app.handle().clone(), &god_tier);
            // Screen timeline always runs — BLADE always sees your screen
            screen_timeline::start_timeline_capture_loop(app.handle().clone());

            // Proactive vision — listen for context switches from screen_timeline
            // and run lightweight assistants (task extraction, focus detection, insights)
            {
                let pv_app = app.handle().clone();
                app.listen("screen_context_switch", move |event| {
                    let payload = event.payload().to_string();
                    let app_clone = pv_app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
                            let from = v["from_app"].as_str().unwrap_or("");
                            let to = v["to_app"].as_str().unwrap_or("");
                            let title = v["to_title"].as_str().unwrap_or("");
                            proactive_vision::on_context_switch(&app_clone, from, to, title).await;
                        }
                    });
                });
            }

            // File indexer — indexes ALL files on the machine (not just code)
            file_indexer::start_file_indexer(app.handle().clone());

            // Audio: always listening — "Hey BLADE" wake word + ambient capture
            audio_timeline::start_audio_timeline_capture(app.handle().clone());
            wake_word::start_wake_word_listener(app.handle().clone());

            // EVOLUTION ENGINE — BLADE's self-improvement loop.
            // Watches what you use and progressively wires BLADE into your stack.
            evolution::start_evolution_loop(app.handle().clone());

            // GOAL ENGINE — autonomous AGI goal pursuit. Goals never fail.
            goal_engine::start_goal_engine(app.handle().clone());

            // LEARNING ENGINE — behavioral pattern detection and proactive prediction.
            learning_engine::start_learning_engine(app.handle().clone());

            // CAUSAL ENGINE — temporal reasoning: blockers, regressions, progress patterns.
            causal_graph::start_causal_engine(app.handle().clone());

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

            // Start world model — situational awareness engine (updates every 60s)
            world_model::start_world_model(app.handle().clone());

            // Autonomous research — BLADE identifies and fills its own knowledge gaps
            autonomous_research::start_autonomous_research(app.handle().clone());

            // Dream mode — background consolidation when user is away
            dream_mode::start_dream_monitor(app.handle().clone());

            // Accountability loop — nudges every 6 hours if check-ins are overdue or KRs are behind
            accountability::start_accountability_loop(app.handle().clone());

            // Health Tracker — wellbeing nudges every 2 hours
            health_tracker::start_health_nudge_loop(app.handle().clone());

            // Habit Engine — checks every 15 min for due habits and fires reminders
            habit_engine::start_habit_reminder_loop(app.handle().clone());

            // Activity Monitor — passive window + file watcher, feeds persona engine
            activity_monitor::start_activity_monitor();

            // Sidecar monitor — ping registered devices every 5 minutes
            sidecar::start_sidecar_monitor(app.handle().clone());

            // Proactive engine — monitors signals and acts before being asked
            proactive_engine::start_proactive_engine(app.handle().clone());

            // Prediction engine — runs inside learning_engine's 30-min tick (no separate loop)

            // Workflow Builder scheduler — checks every 60s for due scheduled workflows
            workflow_builder::start_workflow_scheduler(app.handle().clone());

            // Integration Bridge — Phase 4 MCP always-on service polling
            if startup_god_config.integration_polling_enabled {
                let integration_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    integration_bridge::start_integration_polling(integration_app).await;
                });
            }

            // Notification Listener — Phase 5 partial: poll OS notifications every 30s
            notification_listener::notification_listener_start(app.handle().clone());

            // Health Guardian — Phase 8B: screen time + wellbeing monitor (every 5 min)
            health_guardian::start_health_monitor(app.handle().clone());

            // Security Cache — refresh network suspicious-connection count every 5 min.
            // Runs netstat once in background so brain.rs can read it without blocking.
            tauri::async_runtime::spawn(async {
                loop {
                    security_monitor::update_security_cache();
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                }
            });

            // Temporal Intelligence — ensure tables ready on startup
            temporal_intel::ensure_tables();

            // People Graph — relationship memory
            people_graph::ensure_tables();

            // Streak & Stats — gamification layer
            streak_stats::ensure_tables();

            // HIVE — distributed agent mesh (opt-in; starts tick loop if enabled)
            if startup_god_config.hive_enabled {
                hive::start_hive(app.handle().clone(), startup_god_config.hive_autonomy);
            }

            // Agent Factory — restore previously-deployed agents as Hive tentacles
            agent_factory::restore_active_agents_to_hive();

            // Hive Tentacles — always-on background watchers
            tentacles::terminal_watch::start_terminal_watcher(app.handle().clone());
            tentacles::filesystem_watch::start_filesystem_watcher(app.handle().clone());

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
