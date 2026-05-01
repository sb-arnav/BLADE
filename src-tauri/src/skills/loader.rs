//! Skill loader — walks a tier's root dir, parses each `<sub>/SKILL.md`
//! frontmatter into a [`SkillStub`], skipping malformed entries with a logged
//! warning rather than failing the whole scan.
//!
//! See `21-RESEARCH.md` Q4 for path resolution semantics.

use std::fs;
use std::path::{Path, PathBuf};

use super::parser::parse_skill;
use super::types::{SkillStub, SourceTier};

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
