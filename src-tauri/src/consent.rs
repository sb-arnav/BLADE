//! consent.rs — per-action consent decisions persisted in SQLite blade.db
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-08, D-09, D-10
//! and 18-RESEARCH.md § Consent Persistence Verdict (SQLite, NOT keyring).
//! Wave 0 skeleton: schema constant + Tauri command stubs + tests stubbed.
//! Body lands in Plan 10.

#[derive(Debug, Clone, PartialEq)]
pub enum ConsentVerdict {
    Allow,
    Deny,
    NeedsPrompt,
}

const CONSENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS consent_decisions (
    intent_class    TEXT NOT NULL,
    target_service  TEXT NOT NULL,
    decision        TEXT NOT NULL,
    decided_at      INTEGER NOT NULL,
    PRIMARY KEY (intent_class, target_service)
);
"#;

/// Wave 0 skeleton — Plan 10 implements the SQLite round-trip.
#[tauri::command]
pub fn consent_get_decision(_intent_class: String, _target_service: String) -> Option<String> {
    let _ = CONSENT_SCHEMA;
    None
}

/// Wave 0 skeleton — Plan 10 implements INSERT OR REPLACE.
#[tauri::command]
pub fn consent_set_decision(
    _intent_class: String,
    _target_service: String,
    _decision: String,
) -> Result<(), String> {
    Ok(())
}

/// Wave 0 skeleton — Plan 10 implements DELETE FROM consent_decisions.
#[tauri::command]
pub fn consent_revoke_all() -> Result<(), String> {
    Ok(())
}

/// Internal helper consumed by jarvis_dispatch::dispatch_action BEFORE invoking outbound.
/// Wave 0 skeleton — Plan 10 implements lookup + NeedsPrompt routing.
pub fn consent_check(_intent_class: &str, _target_service: &str) -> ConsentVerdict {
    ConsentVerdict::NeedsPrompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skeleton_returns_needs_prompt() {
        assert_eq!(consent_check("a", "b"), ConsentVerdict::NeedsPrompt);
    }

    #[test]
    fn schema_string_present() {
        assert!(CONSENT_SCHEMA.contains("CREATE TABLE IF NOT EXISTS consent_decisions"));
    }

    // Real tests land in Plan 10:
    //  - set_persists (consent_set_decision then consent_get_decision returns Some)
    //  - get_returns_none_for_unknown (no row → None)
    //  - revoke_all_clears (set 3 rows → revoke → get returns None for all)
}
