//! Phase 57 first-run seeding. Copies the bundled seed SKILL.md files into
//! the user's `skills_md/` directory on first launch (or when the user
//! explicitly invokes `blade_seed_skills`).
//!
//! The seed corpus is shipped as a static `&[(name, body)]` slice compiled
//! into the binary via `include_str!`. This keeps the seed install path
//! independent of Tauri's resource-bundling config (the project's
//! `tauri.conf.json` has no `resources` field today). Authoring location:
//! `assets/seed-skills/{name}/SKILL.md`.

use super::loader::{install_registry, user_skills_dir};

/// (name, SKILL.md contents). Held as a `&[(...)]` so Wave 1 doesn't need
/// any filesystem-resource plumbing.
pub fn seed_corpus() -> &'static [(&'static str, &'static str)] {
    &[
        (
            "summarize-page",
            include_str!("../../../assets/seed-skills/summarize-page/SKILL.md"),
        ),
        (
            "draft-followup-email",
            include_str!("../../../assets/seed-skills/draft-followup-email/SKILL.md"),
        ),
        (
            "extract-todos-from-notes",
            include_str!("../../../assets/seed-skills/extract-todos-from-notes/SKILL.md"),
        ),
        (
            "morning-context",
            include_str!("../../../assets/seed-skills/morning-context/SKILL.md"),
        ),
        (
            "kill-tabs-i-dont-need",
            include_str!("../../../assets/seed-skills/kill-tabs-i-dont-need/SKILL.md"),
        ),
    ]
}

/// Copy each seed skill into `user_skills_dir()/{name}/SKILL.md` if the file
/// is not already present. Existing user-customized skills are NEVER
/// overwritten. Returns the number of skills installed this call.
pub fn seed_skills_into_user_dir() -> usize {
    let root = user_skills_dir();
    if let Err(e) = std::fs::create_dir_all(&root) {
        log::warn!("[skills_md::seed] create_dir_all {}: {}", root.display(), e);
        return 0;
    }

    let mut written = 0usize;
    for (name, body) in seed_corpus() {
        let dir = root.join(name);
        let target = dir.join("SKILL.md");
        if target.is_file() {
            continue; // user already has it; respect any local edits
        }
        if let Err(e) = std::fs::create_dir_all(&dir) {
            log::warn!("[skills_md::seed] create {}: {}", dir.display(), e);
            continue;
        }
        if let Err(e) = std::fs::write(&target, body) {
            log::warn!("[skills_md::seed] write {}: {}", target.display(), e);
            continue;
        }
        written += 1;
    }

    if written > 0 {
        let _ = install_registry();
    }

    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn fresh_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-skills-seed-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn seed_corpus_has_five_skills() {
        let c = seed_corpus();
        assert_eq!(c.len(), 5);
        let names: Vec<&str> = c.iter().map(|(n, _)| *n).collect();
        assert!(names.contains(&"summarize-page"));
        assert!(names.contains(&"draft-followup-email"));
        assert!(names.contains(&"extract-todos-from-notes"));
        assert!(names.contains(&"morning-context"));
        assert!(names.contains(&"kill-tabs-i-dont-need"));
    }

    #[test]
    fn seed_writes_files_idempotently() {
        let _g = ENV_LOCK.lock().unwrap();
        let root = fresh_root("seed-idem");
        std::env::set_var("BLADE_CONFIG_DIR", &root);

        let n1 = seed_skills_into_user_dir();
        assert!(n1 >= 1, "first seed should write something");
        let n2 = seed_skills_into_user_dir();
        assert_eq!(n2, 0, "second seed should be a no-op");

        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
