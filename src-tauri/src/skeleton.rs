/// SKELETON — Central database schema initialization.
///
/// The skeleton ensures ALL 85+ database tables exist at startup,
/// not lazily on first access. Without this, a query to a table that
/// hasn't been initialized yet fails silently.
///
/// This module calls every module's ensure_tables() in one place.
/// It's the skull protecting the brain — structural integrity.

/// Initialize all database tables. Called once at startup before any
/// background threads start. Ensures the full skeleton exists.
pub fn init_all_tables() {
    log::info!("[skeleton] Initializing all database tables...");

    // Core DB tables (conversations, messages, settings, etc.)
    let _ = crate::db::init_db();
    let db_path = crate::config::blade_config_dir().join("blade.db");

    // Module-specific tables
    crate::activity_monitor::ensure_table();
    crate::persona_engine::ensure_tables();
    crate::people_graph::ensure_tables();
    crate::knowledge_graph::ensure_tables();
    crate::autonomous_research::ensure_tables();
    crate::prediction_engine::ensure_tables();
    crate::meeting_intelligence::ensure_tables();
    crate::social_graph::ensure_tables();
    crate::financial_brain::ensure_tables();
    crate::negotiation_engine::ensure_tables();
    crate::habit_engine::ensure_tables();
    crate::health_guardian::ensure_tables();
    crate::health_tracker::ensure_tables();
    crate::streak_stats::ensure_tables();
    crate::workflow_builder::ensure_tables();
    crate::document_intelligence::ensure_tables();
    crate::temporal_intel::ensure_tables();
    crate::voice_intelligence::ensure_tables();
    crate::emotional_intelligence::ensure_tables();
    crate::tentacles::log_monitor::ensure_tables();
    crate::file_indexer::ensure_table();

    // Tables with Result return (ignore errors — they log internally)
    let _ = crate::self_critique::ensure_tables();
    let _ = crate::reasoning_engine::ensure_tables();

    // Tables created inline by other modules (ensure via DB connection)
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        // proactive_engine tables
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS proactive_actions (
                id TEXT PRIMARY KEY,
                action_type TEXT NOT NULL,
                trigger TEXT NOT NULL,
                content TEXT NOT NULL,
                confidence REAL NOT NULL,
                accepted INTEGER DEFAULT -1,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS proactive_rules (
                id TEXT PRIMARY KEY,
                rule_type TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                threshold REAL DEFAULT 0.7,
                cooldown_minutes INTEGER DEFAULT 30,
                last_fired INTEGER
            );"
        );

        // proactive_cards (proactive_vision.rs)
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS proactive_cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                source_app TEXT NOT NULL,
                confidence REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                dismissed INTEGER DEFAULT 0
            );"
        );

        // plan_memory (brain_planner.rs)
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS plan_memory (
                request_hash TEXT PRIMARY KEY,
                request_text TEXT NOT NULL,
                plan TEXT NOT NULL,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                last_used INTEGER NOT NULL
            );"
        );

        // decision_gate thresholds (stored in settings table, already created by db.rs)
        // authority_engine tables
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_delegations (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                delegated_to TEXT NOT NULL,
                delegated_by TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                result TEXT DEFAULT '',
                denied_reason TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                completed_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS authority_audit_log (
                id TEXT PRIMARY KEY,
                agent_type TEXT NOT NULL,
                action TEXT NOT NULL,
                allowed INTEGER NOT NULL,
                reason TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );"
        );
    }

    // Register trait-based joint contracts (context providers, memory stores)
    crate::joints::register_builtins();

    log::info!("[skeleton] All tables initialized, joints registered");
}
