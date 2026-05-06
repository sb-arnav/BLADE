// src-tauri/src/session/mod.rs
//
// Phase 34 — Session persistence module. Houses SESS-01 (`log.rs`,
// SessionWriter + SessionEvent), SESS-02 (`resume.rs`, load_session), and
// SESS-03/SESS-04 (`list.rs`, list_sessions + fork_session +
// get_conversation_cost Tauri commands).
//
// Plan 34-03 ships the EMPTY scaffolding. Plan 34-08 fills SessionWriter.
// Plan 34-09 fills resume::load_session. Plan 34-10 fills the list/fork
// Tauri commands.

pub mod log;
pub mod resume;
pub mod list;
