//! Skill-script consent — typed wrapper over `crate::consent` for the
//! (skill_name, script_basename) tuple class.
//!
//! Per `21-RESEARCH.md` Q3, the v1.2 `consent_decisions` SQLite schema
//! accommodates SKILLS-07 without migration:
//!
//!   intent_class   = "skill_script"
//!   target_service = "<skill_name>:<script_basename>"
//!
//! This module gives Phase 22's Voyager loop (and any callers that ship
//! before it) a typed surface to:
//!
//!   - Build the canonical target_service from `(skill, ref_path)`.
//!   - Check the persisted decision via `crate::consent::consent_check_at`.
//!   - Persist allow_always / denied via `crate::consent::consent_set_decision`.
//!   - Drive the runtime prompt via the existing tokio::oneshot flow
//!     (Phase 22 hook; not exercised in Phase 21).
//!
//! `allow_once` is in-memory only per T-18-CARRY-15 (Plan 18-14). The `set`
//! helper here rejects it explicitly so a hand-edited caller can't smuggle
//! it past the v1.2 invariant.

use std::path::Path;

use crate::consent::{consent_check_at, ConsentVerdict};

use super::types::Skill;

/// Canonical intent class for skill-script consent, persisted across all
/// (skill, script) tuples.
pub const INTENT_CLASS: &str = "skill_script";

/// Build the canonical `target_service` string from a skill + script-relative
/// path. The basename is taken to keep the persisted value small and stable;
/// callers that need disambiguation between two scripts of the same name in
/// different skills get it from the `<skill_name>:` prefix.
pub fn target_service(skill: &Skill, script_relative_path: &str) -> String {
    let basename = Path::new(script_relative_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(script_relative_path);
    format!("{}:{}", skill.frontmatter.name, basename)
}

/// Check the persisted decision for a skill-script tuple.
///
/// Returns:
///   - `ConsentVerdict::Allow` if the user previously chose `allow_always`
///   - `ConsentVerdict::Deny`  if the user previously chose `denied`
///   - `ConsentVerdict::NeedsPrompt` if no decision is recorded yet
pub fn check_persisted(db_path: &Path, skill: &Skill, script_relative_path: &str) -> ConsentVerdict {
    consent_check_at(db_path, INTENT_CLASS, &target_service(skill, script_relative_path))
}

/// Persist a decision for a skill-script tuple. Decision must be one of
/// `"allow_always"` or `"denied"`. `"allow_once"` is rejected (per
/// T-18-CARRY-15); the dispatcher is expected to handle the in-memory case
/// without writing.
///
/// Uses `crate::consent::open_db_at` indirectly via consent_set_decision's
/// SQLite path. Schema is unchanged from v1.2; this is purely additive.
pub fn set_persisted(skill: &Skill, script_relative_path: &str, decision: &str) -> Result<(), String> {
    if decision != "allow_always" && decision != "denied" {
        return Err(format!(
            "[skills::consent] invalid decision: {decision:?} (allowed: allow_always, denied)"
        ));
    }
    crate::consent::consent_set_decision(
        INTENT_CLASS.to_string(),
        target_service(skill, script_relative_path),
        decision.to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::super::activate::activate;
    use super::super::loader::scan_tier;
    use super::super::types::SourceTier;
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-skill-consent-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_skill_with_script(parent: &Path, name: &str) -> Skill {
        let dir = parent.join(name);
        fs::create_dir_all(dir.join("scripts")).unwrap();
        let text = format!(
            "---\nname: {name}\ndescription: Skill with a script.\n---\nRun [it](scripts/run.sh).\n"
        );
        fs::write(dir.join("SKILL.md"), text).unwrap();
        fs::write(dir.join("scripts").join("run.sh"), "#!/bin/sh\necho ok\n").unwrap();
        let stubs = scan_tier(parent, SourceTier::User);
        let stub = stubs.into_iter().find(|s| s.frontmatter.name == name).unwrap();
        activate(&stub).unwrap()
    }

    #[test]
    fn target_service_combines_skill_and_basename() {
        let parent = temp_dir("ts");
        let skill = write_skill_with_script(&parent, "alpha");
        let svc = target_service(&skill, "scripts/run.sh");
        assert_eq!(svc, "alpha:run.sh");
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn target_service_handles_nested_path() {
        let parent = temp_dir("ts-nested");
        let skill = write_skill_with_script(&parent, "beta");
        let svc = target_service(&skill, "scripts/sub/inner.py");
        assert_eq!(svc, "beta:inner.py");
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn target_service_falls_back_when_path_has_no_basename() {
        let parent = temp_dir("ts-edge");
        let skill = write_skill_with_script(&parent, "gamma");
        // pathological input — but the helper must not panic
        let svc = target_service(&skill, "");
        assert_eq!(svc, "gamma:");
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn check_persisted_returns_needs_prompt_for_unknown() {
        let parent = temp_dir("check-unknown");
        let db_dir = temp_dir("check-unknown-db");
        let db_path = db_dir.join("blade.db");
        let skill = write_skill_with_script(&parent, "delta");

        let verdict = check_persisted(&db_path, &skill, "scripts/run.sh");
        assert_eq!(verdict, ConsentVerdict::NeedsPrompt);
        let _ = fs::remove_dir_all(&parent);
        let _ = fs::remove_dir_all(&db_dir);
    }

    #[test]
    fn set_persisted_rejects_allow_once() {
        let parent = temp_dir("rej-once");
        let skill = write_skill_with_script(&parent, "epsilon");

        let err = set_persisted(&skill, "scripts/run.sh", "allow_once").unwrap_err();
        assert!(err.contains("invalid decision"));
        assert!(err.contains("allow_once"));
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn set_persisted_rejects_arbitrary_string() {
        let parent = temp_dir("rej-arb");
        let skill = write_skill_with_script(&parent, "zeta");

        let err = set_persisted(&skill, "scripts/run.sh", "yes please").unwrap_err();
        assert!(err.contains("invalid decision"));
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn intent_class_is_skill_script() {
        assert_eq!(INTENT_CLASS, "skill_script");
    }
}
