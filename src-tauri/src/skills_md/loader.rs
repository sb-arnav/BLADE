//! Phase 57 loader — walks `~/.config/blade/skills_md/` + parses each
//! `{name}/SKILL.md` into a [`SkillManifest`]. Exposes a process-global
//! [`SkillsRegistry`] keyed by trigger phrase for dispatch.
//!
//! Wave 1 (REQ 2) provides the eager directory scan. Filesystem-change watch
//! is handled by `install_registry` re-scanning on demand (e.g. after
//! `blade_install_skill`). A full `notify`-crate watcher is deferred — the
//! directory is small (<100 entries expected at personal scale) and re-scan
//! on install is sufficient. See `seed::seed_skills_into_user_dir` for first
//! run.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

use super::manifest::SkillManifest;

/// Registry of installed skills.
///
/// Keyed by *normalized trigger phrase* (lowercased, single-spaced). A skill
/// with multiple triggers appears under each key. The same `SkillManifest` is
/// shared via clone — manifests are small (description + a body string).
pub type SkillsRegistry = RwLock<HashMap<String, SkillManifest>>;

static REGISTRY: OnceLock<SkillsRegistry> = OnceLock::new();

/// Process-global registry handle. Lazily constructed.
pub fn registry() -> &'static SkillsRegistry {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Resolve `~/.config/blade/skills_md/` (or the BLADE_CONFIG_DIR override).
pub fn user_skills_dir() -> PathBuf {
    crate::config::blade_config_dir().join("skills_md")
}

/// Scan a directory for `{name}/SKILL.md` files. Malformed files are skipped
/// with a `log::warn!` line — one bad skill should not break the registry.
///
/// Returns the list of parsed manifests. Folder-name / `name` mismatches are
/// rejected.
pub fn scan_directory(root: &Path) -> Vec<SkillManifest> {
    let mut out: Vec<SkillManifest> = Vec::new();

    let entries = match std::fs::read_dir(root) {
        Ok(rd) => rd,
        Err(_) => return out, // not-yet-created — silent
    };

    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        // Skip dotfiles (`.archived/`, `.git/`, etc.)
        if dir
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }

        let skill_md = dir.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        let text = match std::fs::read_to_string(&skill_md) {
            Ok(t) => t,
            Err(e) => {
                log::warn!(
                    "[skills_md::loader] read {}: {} — skipping",
                    skill_md.display(),
                    e
                );
                continue;
            }
        };

        let manifest = match SkillManifest::parse_skill_md(&text) {
            Ok(m) => m,
            Err(e) => {
                log::warn!(
                    "[skills_md::loader] parse {}: {} — skipping",
                    skill_md.display(),
                    e
                );
                continue;
            }
        };

        let folder_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !folder_name.is_empty() && folder_name != manifest.name {
            log::warn!(
                "[skills_md::loader] {} folder '{}' != manifest.name '{}' — skipping",
                skill_md.display(),
                folder_name,
                manifest.name
            );
            continue;
        }

        out.push(manifest);
    }

    out
}

/// Normalize a trigger phrase for lookup: lowercased + single-spaced + trimmed.
pub fn normalize_trigger(phrase: &str) -> String {
    let lower = phrase.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut prev_ws = false;
    for ch in lower.chars() {
        if ch.is_whitespace() {
            if !prev_ws && !out.is_empty() {
                out.push(' ');
            }
            prev_ws = true;
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Replace the registry contents with a fresh scan of `user_skills_dir()`.
///
/// Returns the number of skills installed. Logs at info level. Idempotent:
/// safe to call from startup AND after every install.
pub fn install_registry() -> usize {
    let root = user_skills_dir();
    // Best-effort dir creation so subsequent installs have a place to land.
    let _ = std::fs::create_dir_all(&root);

    let manifests = scan_directory(&root);
    let mut map: HashMap<String, SkillManifest> = HashMap::new();
    let mut skill_count = 0usize;

    for m in manifests {
        skill_count += 1;
        for trig in &m.triggers {
            let key = normalize_trigger(trig);
            if key.is_empty() {
                continue;
            }
            // Last-write-wins on duplicate trigger across skills. Log the
            // collision so operators can disambiguate.
            if let Some(prev) = map.get(&key) {
                if prev.name != m.name {
                    log::warn!(
                        "[skills_md::loader] trigger '{}' claimed by both '{}' and '{}' \
                         — '{}' wins",
                        key,
                        prev.name,
                        m.name,
                        m.name
                    );
                }
            }
            map.insert(key, m.clone());
        }
    }

    let reg = registry();
    if let Ok(mut guard) = reg.write() {
        *guard = map;
    } else {
        log::error!("[skills_md::loader] registry RwLock poisoned");
    }

    log::info!(
        "[skills_md::loader] registry rebuilt: {} skills at {}",
        skill_count,
        root.display()
    );
    skill_count
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn write_skill(root: &Path, name: &str, triggers: &[&str]) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        let trigs_yaml: String = triggers
            .iter()
            .map(|t| format!("  - \"{}\"\n", t))
            .collect();
        let text = format!(
            "---\nname: {name}\ndescription: Test {name}.\ntriggers:\n{trigs_yaml}---\nbody for {name}\n"
        );
        fs::write(dir.join("SKILL.md"), text).unwrap();
    }

    fn fresh_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-skills-md-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn scan_empty_dir_returns_empty() {
        let root = fresh_root("scan-empty");
        let v = scan_directory(&root);
        assert!(v.is_empty());
    }

    #[test]
    fn scan_loads_one_well_formed_skill() {
        let root = fresh_root("scan-one");
        write_skill(&root, "alpha", &["do the thing"]);
        let v = scan_directory(&root);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "alpha");
        assert_eq!(v[0].triggers, vec!["do the thing"]);
    }

    #[test]
    fn normalize_trigger_lowercases_and_single_spaces() {
        assert_eq!(normalize_trigger("Summarize THIS page"), "summarize this page");
        assert_eq!(
            normalize_trigger("  hello   world  "),
            "hello world"
        );
    }

    #[test]
    fn install_registry_populates_global() {
        let _g = ENV_LOCK.lock().unwrap();
        let root = fresh_root("install-global");
        std::env::set_var("BLADE_CONFIG_DIR", &root);

        write_skill(
            &user_skills_dir(),
            "kill-tabs",
            &["kill the tabs", "close everything"],
        );

        let n = install_registry();
        assert_eq!(n, 1);

        let reg = registry().read().unwrap();
        assert!(reg.contains_key("kill the tabs"));
        assert!(reg.contains_key("close everything"));

        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
