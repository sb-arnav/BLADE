//! Skill loader — walks a tier's root dir, parses each `<sub>/SKILL.md`
//! frontmatter into a [`SkillStub`], skipping malformed entries with a logged
//! warning rather than failing the whole scan.
//!
//! See `21-RESEARCH.md` Q4 for path resolution semantics.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::parser::parse_skill;
use super::types::{SkillStub, SourceTier};

/// Phase 24 (v1.3) — flat reference to a skill across all 4 sources, used
/// by `session_handoff::SessionHandoff.skills_snapshot` and the
/// `skill_validator list --diff` CLI subcommand. Carries enough metadata to
/// distinguish forged_tools (which have `last_used` + `forged_from`) from
/// SKILL.md tier skills (which carry only `name` + `source`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SkillRef {
    pub name: String,
    pub source: String,                    // "forged" | "bundled" | "user" | "archived"
    pub last_used: Option<i64>,
    pub forged_from: Option<String>,
}

/// Scan a tier root for skills.
///
/// Each immediate subdir of `root` is checked for a `SKILL.md` file. If
/// present and parseable, a [`SkillStub`] is returned. If the file is missing
/// or malformed, the directory is skipped (with a `log::warn!` line) — a single
/// bad skill should not break the catalog.
///
/// Returns an empty `Vec` if `root` doesn't exist (e.g. user has no skills yet).
pub fn scan_tier(root: &Path, source: SourceTier) -> Vec<SkillStub> {
    let mut out = Vec::new();

    let entries = match fs::read_dir(root) {
        Ok(rd) => rd,
        Err(_) => return out, // not-a-directory or doesn't-exist — silent (expected)
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

        let text = match fs::read_to_string(&skill_md) {
            Ok(t) => t,
            Err(e) => {
                log::warn!(
                    "[skills::loader] read {}: {} — skipping",
                    skill_md.display(),
                    e
                );
                continue;
            }
        };

        let (frontmatter, _body) = match parse_skill(&text) {
            Ok(parsed) => parsed,
            Err(e) => {
                log::warn!(
                    "[skills::loader] parse {}: {} — skipping",
                    skill_md.display(),
                    e
                );
                continue;
            }
        };

        // agentskills.io spec: name must match folder name. Reject mismatch
        // here; the validator (Plan 21-04) will surface a typed error to the
        // CLI. For loader-time scan, we log + skip.
        let folder_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if !folder_name.is_empty() && folder_name != frontmatter.name {
            log::warn!(
                "[skills::loader] {} folder name '{}' != frontmatter name '{}' — skipping",
                skill_md.display(),
                folder_name,
                frontmatter.name
            );
            continue;
        }

        out.push(SkillStub {
            frontmatter,
            dir,
            source,
        });
    }

    out
}

/// Resolve the workspace skill root: `<cwd>/skills/` if it exists.
pub fn workspace_root() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let root = cwd.join("skills");
    if root.is_dir() { Some(root) } else { None }
}

/// Resolve the user skill root: `blade_config_dir()/skills/`.
pub fn user_root() -> PathBuf {
    crate::config::blade_config_dir().join("skills")
}

/// Resolve the bundled skill root.
///
/// Production: would resolve via `tauri::path::resource_dir()` — but that
/// requires an `&AppHandle` not available at module-level helpers. Phase 21
/// uses the dev-fallback (`<cargo_workspace>/skills/bundled/`) for the
/// bundled tier. Phase 22+ can wire the production path through the AppHandle
/// when the loader is invoked from `lib.rs::run` setup.
pub fn bundled_root() -> PathBuf {
    let manifest = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest).join("..").join("skills").join("bundled")
}

/// Phase 24 (v1.3) — flatten all 4 skill sources into a single snapshot
/// vec for session_handoff persistence + CLI diff consumption.
///
/// Sources:
///   - `forged`   — rows from `forged_tools` SQLite (name + last_used + forged_from)
///   - `bundled`  — SKILL.md skills under `bundled_root()` (no usage metadata)
///   - `user`     — SKILL.md skills under `user_root()` (excluding dotfile dirs)
///   - `archived` — SKILL.md skills under `<user_root>/.archived/` (Phase 24 prune destination)
pub fn list_skills_snapshot() -> Vec<SkillRef> {
    let mut out: Vec<SkillRef> = Vec::new();

    // Forged tools — DB-backed, carry usage metadata.
    for ft in crate::tool_forge::get_forged_tools() {
        out.push(SkillRef {
            name: ft.name,
            source: "forged".to_string(),
            last_used: ft.last_used,
            forged_from: if ft.forged_from.is_empty() { None } else { Some(ft.forged_from) },
        });
    }

    // Bundled — SKILL.md skills shipped with BLADE.
    for stub in scan_tier(&bundled_root(), super::types::SourceTier::Bundled) {
        out.push(SkillRef {
            name: stub.frontmatter.name,
            source: "bundled".to_string(),
            last_used: None,
            forged_from: None,
        });
    }

    // User — SKILL.md skills under user_root() (scan_tier already skips dotfiles).
    for stub in scan_tier(&user_root(), super::types::SourceTier::User) {
        out.push(SkillRef {
            name: stub.frontmatter.name,
            source: "user".to_string(),
            last_used: None,
            forged_from: None,
        });
    }

    // Archived — explicit walk of <user_root>/.archived/ (scan_tier skips
    // dotfile-prefixed PARENT dirs, but here we feed it the dotfile dir
    // directly as the root, so its inner subdirs are NOT dotfile-prefixed
    // and will be enumerated correctly).
    let archived_root = user_root().join(".archived");
    for stub in scan_tier(&archived_root, super::types::SourceTier::User) {
        out.push(SkillRef {
            name: stub.frontmatter.name,
            source: "archived".to_string(),
            last_used: None,
            forged_from: None,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_skill(dir: &Path, name: &str, body: &str) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        let text = format!(
            "---\nname: {name}\ndescription: Test skill {name}.\n---\n{body}\n"
        );
        fs::write(skill_dir.join("SKILL.md"), text).unwrap();
    }

    fn temp_root() -> tempfile_like::TempDir {
        tempfile_like::TempDir::new()
    }

    #[test]
    fn scan_tier_returns_empty_for_missing_dir() {
        let stubs = scan_tier(Path::new("/nonexistent/path/here"), SourceTier::User);
        assert!(stubs.is_empty());
    }

    #[test]
    fn scan_tier_loads_one_well_formed_skill() {
        let tmp = temp_root();
        write_skill(tmp.path(), "alpha", "# Alpha");
        let stubs = scan_tier(tmp.path(), SourceTier::Workspace);
        assert_eq!(stubs.len(), 1);
        assert_eq!(stubs[0].frontmatter.name, "alpha");
        assert_eq!(stubs[0].source, SourceTier::Workspace);
    }

    #[test]
    fn scan_tier_skips_dotfiles() {
        let tmp = temp_root();
        write_skill(tmp.path(), ".archived", "# archived");
        let stubs = scan_tier(tmp.path(), SourceTier::User);
        assert!(stubs.is_empty());
    }

    #[test]
    fn scan_tier_skips_dirs_without_skill_md() {
        let tmp = temp_root();
        fs::create_dir_all(tmp.path().join("empty-dir")).unwrap();
        let stubs = scan_tier(tmp.path(), SourceTier::User);
        assert!(stubs.is_empty());
    }

    #[test]
    fn scan_tier_skips_malformed_skill_without_failing_others() {
        let tmp = temp_root();
        write_skill(tmp.path(), "good", "# good body");
        // Malformed skill — missing closing ---
        let bad_dir = tmp.path().join("bad");
        fs::create_dir_all(&bad_dir).unwrap();
        fs::write(
            bad_dir.join("SKILL.md"),
            "---\nname: bad\ndescription: oops\n# body without closing delim\n",
        )
        .unwrap();
        let stubs = scan_tier(tmp.path(), SourceTier::User);
        assert_eq!(stubs.len(), 1);
        assert_eq!(stubs[0].frontmatter.name, "good");
    }

    #[test]
    fn scan_tier_skips_folder_name_mismatch() {
        let tmp = temp_root();
        // Folder is "alias" but frontmatter says "real-name"
        let dir = tmp.path().join("alias");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            "---\nname: real-name\ndescription: Mismatch.\n---\n# body\n",
        )
        .unwrap();
        let stubs = scan_tier(tmp.path(), SourceTier::User);
        assert!(stubs.is_empty());
    }

    #[test]
    fn user_root_uses_blade_config_dir() {
        // Set BLADE_CONFIG_DIR override and verify user_root() honours it.
        let tmp = temp_root();
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        let root = user_root();
        assert!(root.starts_with(tmp.path()));
        assert_eq!(root.file_name().and_then(|n| n.to_str()), Some("skills"));
        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn bundled_root_resolves_relative_to_manifest() {
        let root = bundled_root();
        // Ends with skills/bundled regardless of where CARGO_MANIFEST_DIR is.
        let suffix: PathBuf = ["skills", "bundled"].iter().collect();
        assert!(
            root.ends_with(&suffix),
            "expected bundled root to end with skills/bundled, got {root:?}"
        );
    }

    #[test]
    fn list_skills_snapshot_includes_all_4_sources() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());

        // Seed 1 forged tool via direct INSERT (avoid LLM path).
        let conn = rusqlite::Connection::open(tmp.path().join("blade.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS forged_tools (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
                language TEXT NOT NULL, script_path TEXT NOT NULL, usage TEXT NOT NULL,
                parameters TEXT DEFAULT '[]', test_output TEXT DEFAULT '',
                created_at INTEGER NOT NULL, last_used INTEGER, use_count INTEGER DEFAULT 0,
                forged_from TEXT DEFAULT ''
            );"
        ).unwrap();
        conn.execute(
            "INSERT INTO forged_tools (id, name, description, language, script_path, usage, created_at, last_used, forged_from) \
             VALUES ('id1', 'forged_one', 'd', 'bash', '/tmp/f.sh', 'u', 100, 100, 'cap')",
            [],
        ).unwrap();
        drop(conn);

        // Seed 1 user SKILL.md.
        let user = tmp.path().join("skills").join("user-one");
        std::fs::create_dir_all(&user).unwrap();
        std::fs::write(
            user.join("SKILL.md"),
            "---\nname: user-one\ndescription: x\n---\n# user-one\n"
        ).unwrap();

        // Seed 1 archived SKILL.md under .archived/.
        let arch = tmp.path().join("skills").join(".archived").join("archived-one");
        std::fs::create_dir_all(&arch).unwrap();
        std::fs::write(
            arch.join("SKILL.md"),
            "---\nname: archived-one\ndescription: x\n---\n# archived-one\n"
        ).unwrap();

        let snap = list_skills_snapshot();
        assert!(snap.iter().any(|r| r.source == "forged" && r.name == "forged_one"));
        assert!(snap.iter().any(|r| r.source == "user" && r.name == "user-one"));
        assert!(snap.iter().any(|r| r.source == "archived" && r.name == "archived-one"));

        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn list_skills_snapshot_handles_missing_dirs() {
        // Fresh tempdir with NO seeded data — function must not panic on
        // missing user_root / archived_root / forged_tools table.
        let tmp = tempfile::TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        let snap = list_skills_snapshot();
        // Bundled may surface entries from <workspace>/skills/bundled/ via
        // the dev-fallback bundled_root(); accept any non-bundled entries
        // are absent.
        for r in &snap {
            assert!(
                r.source == "bundled",
                "expected only bundled entries in fresh tempdir, got source={}",
                r.source
            );
        }
        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}

/// Tiny temp-dir helper. We don't pull in the `tempfile` crate just for tests;
/// this gives us an auto-cleaning tmp dir scoped to a single test invocation.
#[cfg(test)]
mod tempfile_like {
    use std::path::{Path, PathBuf};

    pub struct TempDir(PathBuf);

    impl TempDir {
        pub fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let pid = std::process::id();
            let path = std::env::temp_dir().join(format!("blade-skills-test-{pid}-{nanos}"));
            std::fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
