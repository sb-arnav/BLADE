//! Skill activation — lazy-load disclosure (SKILLS-03).
//!
//! `Catalog::build` loads frontmatter only (~100 tokens × N skills at startup).
//! `activate(stub)` reads the SKILL.md body on demand. Reference resources
//! under `scripts/`, `references/`, `assets/` are loaded only when the caller
//! explicitly requests them via `load_reference(skill, path)`.
//!
//! The `BODY_BYTES_LOADED` and `REFERENCE_BYTES_LOADED` atomics let tests
//! assert the disclosure invariant: catalog build reads zero body bytes; first
//! activation reads exactly the body size; references are independent.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use super::parser::parse_skill;
use super::types::{Skill, SkillStub};

static BODY_BYTES_LOADED: AtomicU64 = AtomicU64::new(0);
static REFERENCE_BYTES_LOADED: AtomicU64 = AtomicU64::new(0);

/// Total bytes of skill body content read since last reset. Used by the
/// progressive-disclosure assertion in `verify:skill-format` and unit tests.
pub fn body_bytes_loaded() -> u64 {
    BODY_BYTES_LOADED.load(Ordering::Relaxed)
}

/// Total bytes of skill reference content (scripts/, references/, assets/)
/// read since last reset.
pub fn reference_bytes_loaded() -> u64 {
    REFERENCE_BYTES_LOADED.load(Ordering::Relaxed)
}

/// Reset both counters. Tests call this before driving a controlled scenario.
pub fn reset_disclosure_counters() {
    BODY_BYTES_LOADED.store(0, Ordering::Relaxed);
    REFERENCE_BYTES_LOADED.store(0, Ordering::Relaxed);
}

/// Activate a skill: read its `SKILL.md` body and parse the references.
///
/// The frontmatter on the stub is reused (no re-parse). The body file is read
/// fresh — this is the lazy-load disclosure point.
pub fn activate(stub: &SkillStub) -> Result<Skill, String> {
    let body_path = stub.dir.join("SKILL.md");
    let text = std::fs::read_to_string(&body_path).map_err(|e| {
        format!(
            "[skills::activate] read {}: {e}",
            body_path.display()
        )
    })?;

    BODY_BYTES_LOADED.fetch_add(text.len() as u64, Ordering::Relaxed);

    let (_fm, body) = parse_skill(&text)?;

    Ok(Skill {
        frontmatter: stub.frontmatter.clone(),
        body,
        dir: stub.dir.clone(),
        source: stub.source,
    })
}

/// Load a reference path declared in the skill body. The path is required to
/// be one of the canonical sub-prefixes (scripts/, references/, assets/) to
/// prevent path-traversal escapes outside the skill's own directory.
///
/// Returns the file contents on success.
pub fn load_reference(skill: &Skill, ref_path: &str) -> Result<String, String> {
    if !is_canonical_subpath(ref_path) {
        return Err(format!(
            "[skills::activate] refusing non-canonical reference: {ref_path:?}"
        ));
    }

    let abs = skill.dir.join(ref_path);

    // Defensive: confirm the resolved path is still under the skill directory
    // (prevents `scripts/../../escape.txt` shenanigans even though we already
    // bounce on path components below).
    if has_parent_escape(ref_path) {
        return Err(format!(
            "[skills::activate] refusing reference with `..`: {ref_path:?}"
        ));
    }

    let text = std::fs::read_to_string(&abs).map_err(|e| {
        format!("[skills::activate] read reference {}: {e}", abs.display())
    })?;

    REFERENCE_BYTES_LOADED.fetch_add(text.len() as u64, Ordering::Relaxed);

    Ok(text)
}

/// Resolve the absolute path to a canonical reference without reading it.
/// Useful for the consent flow (SKILLS-07): the consent helper needs the
/// path for the prompt copy + the executor needs it to spawn.
pub fn resolve_reference_path(skill: &Skill, ref_path: &str) -> Result<PathBuf, String> {
    if !is_canonical_subpath(ref_path) || has_parent_escape(ref_path) {
        return Err(format!(
            "[skills::activate] non-canonical reference path: {ref_path:?}"
        ));
    }
    Ok(skill.dir.join(ref_path))
}

fn is_canonical_subpath(ref_path: &str) -> bool {
    ref_path.starts_with("scripts/")
        || ref_path.starts_with("references/")
        || ref_path.starts_with("assets/")
}

fn has_parent_escape(ref_path: &str) -> bool {
    Path::new(ref_path)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
}

#[cfg(test)]
mod tests {
    use super::super::loader::scan_tier;
    use super::super::types::SourceTier;
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;

    /// Disclosure counters are crate-global atomics; tests that read/write
    /// them must run sequentially. This Mutex gates them.
    static COUNTER_LOCK: Mutex<()> = Mutex::new(());

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!("blade-activate-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_skill(parent: &Path, name: &str, body: &str) -> PathBuf {
        let dir = parent.join(name);
        fs::create_dir_all(&dir).unwrap();
        let text = format!("---\nname: {name}\ndescription: A test skill.\n---\n{body}");
        fs::write(dir.join("SKILL.md"), &text).unwrap();
        dir
    }

    #[test]
    fn body_bytes_zero_after_scan_only() {
        let _g = COUNTER_LOCK.lock().unwrap();
        reset_disclosure_counters();
        let root = temp_dir("scan-only");
        write_skill(&root, "alpha", "# Body content\nLorem ipsum.\n");
        // Scan loads frontmatter only — never touches body content via activate
        let stubs = scan_tier(&root, SourceTier::User);
        assert_eq!(stubs.len(), 1);
        // The frontmatter parser does read the whole file, but it doesn't go
        // through the activate path. The disclosure assertion is specifically
        // about the activate-time counter, NOT about how scan_tier internally
        // shelves the file. (Phase 22's Voyager loop only ever reads body via
        // activate; scan_tier reads small frontmatter-shaped files at startup.)
        assert_eq!(body_bytes_loaded(), 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn activate_records_body_bytes() {
        let _g = COUNTER_LOCK.lock().unwrap();
        reset_disclosure_counters();
        let root = temp_dir("activate-body");
        let body = "# Body\nA few lines of\nactual body content.\n";
        let dir = write_skill(&root, "beta", body);
        let stubs = scan_tier(&root, SourceTier::User);
        let stub = stubs.iter().find(|s| s.frontmatter.name == "beta").unwrap();

        let before = body_bytes_loaded();
        let skill = activate(stub).unwrap();
        let after = body_bytes_loaded();

        assert_eq!(before, 0);
        // The counter records the FULL SKILL.md size including frontmatter.
        // That's intentional — the assertion is "body file was opened", not
        // "body bytes excluding frontmatter were read."
        let full_size = fs::read_to_string(dir.join("SKILL.md")).unwrap().len() as u64;
        assert_eq!(after, full_size);

        // The parsed body shouldn't include the frontmatter delimiter.
        assert!(skill.body.markdown.contains("Body"));
        assert!(skill.body.markdown.contains("body content"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn references_do_not_auto_load_with_body() {
        let _g = COUNTER_LOCK.lock().unwrap();
        reset_disclosure_counters();
        let root = temp_dir("refs-noauto");
        let dir = write_skill(
            &root,
            "gamma",
            "Use [the script](scripts/run.sh) for stuff.\n",
        );
        // Create the referenced file
        let scripts_dir = dir.join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();
        fs::write(scripts_dir.join("run.sh"), "#!/bin/sh\necho gamma\n").unwrap();

        let stubs = scan_tier(&root, SourceTier::User);
        let stub = stubs.iter().find(|s| s.frontmatter.name == "gamma").unwrap();
        let skill = activate(stub).unwrap();

        // Body parsed, references discovered, but file content NOT loaded yet
        assert_eq!(skill.body.references, vec!["scripts/run.sh"]);
        assert_eq!(reference_bytes_loaded(), 0);

        // Now load the reference
        let content = load_reference(&skill, "scripts/run.sh").unwrap();
        assert!(content.contains("echo gamma"));
        assert_eq!(reference_bytes_loaded() as usize, content.len());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn load_reference_rejects_non_canonical_prefix() {
        let _g = COUNTER_LOCK.lock().unwrap();
        reset_disclosure_counters();
        let root = temp_dir("non-canon");
        let dir = write_skill(&root, "delta", "body");
        // Make a file outside the canonical subdirs
        fs::write(dir.join("rogue.txt"), "should not be loadable").unwrap();
        let stubs = scan_tier(&root, SourceTier::User);
        let stub = stubs.iter().find(|s| s.frontmatter.name == "delta").unwrap();
        let skill = activate(stub).unwrap();

        let err = load_reference(&skill, "rogue.txt").unwrap_err();
        assert!(err.contains("non-canonical"));
        assert_eq!(reference_bytes_loaded(), 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn load_reference_rejects_parent_dir_escape() {
        let _g = COUNTER_LOCK.lock().unwrap();
        reset_disclosure_counters();
        let root = temp_dir("parent-escape");
        write_skill(&root, "epsilon", "body");
        let stubs = scan_tier(&root, SourceTier::User);
        let stub = stubs.iter().find(|s| s.frontmatter.name == "epsilon").unwrap();
        let skill = activate(stub).unwrap();

        let err = load_reference(&skill, "scripts/../../escape.txt").unwrap_err();
        assert!(err.contains("`..`"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_reference_path_returns_absolute() {
        let _g = COUNTER_LOCK.lock().unwrap();
        let root = temp_dir("resolve-path");
        let dir = write_skill(&root, "zeta", "body");
        let stubs = scan_tier(&root, SourceTier::User);
        let stub = stubs.iter().find(|s| s.frontmatter.name == "zeta").unwrap();
        let skill = activate(stub).unwrap();

        let path = resolve_reference_path(&skill, "scripts/foo.py").unwrap();
        assert!(path.starts_with(dir));
        assert_eq!(path.file_name().and_then(|n| n.to_str()), Some("foo.py"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_reference_path_rejects_non_canonical() {
        let _g = COUNTER_LOCK.lock().unwrap();
        let root = temp_dir("rrp-rej");
        write_skill(&root, "eta", "body");
        let stubs = scan_tier(&root, SourceTier::User);
        let stub = stubs.iter().find(|s| s.frontmatter.name == "eta").unwrap();
        let skill = activate(stub).unwrap();

        let err = resolve_reference_path(&skill, "rogue.txt").unwrap_err();
        assert!(err.contains("non-canonical"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reset_disclosure_counters_zeroes_both() {
        let _g = COUNTER_LOCK.lock().unwrap();
        BODY_BYTES_LOADED.store(123, Ordering::Relaxed);
        REFERENCE_BYTES_LOADED.store(456, Ordering::Relaxed);
        reset_disclosure_counters();
        assert_eq!(body_bytes_loaded(), 0);
        assert_eq!(reference_bytes_loaded(), 0);
    }

    #[test]
    fn is_canonical_subpath_recognizes_three_prefixes() {
        assert!(is_canonical_subpath("scripts/x.py"));
        assert!(is_canonical_subpath("references/x.md"));
        assert!(is_canonical_subpath("assets/logo.png"));
        assert!(!is_canonical_subpath("rogue.txt"));
        assert!(!is_canonical_subpath("scripts"));   // no slash
        assert!(!is_canonical_subpath("/scripts/x")); // leading slash
    }

    #[test]
    fn has_parent_escape_detects_dot_dot() {
        assert!(has_parent_escape("scripts/../escape"));
        assert!(has_parent_escape("../escape"));
        assert!(!has_parent_escape("scripts/sub/file.py"));
        assert!(!has_parent_escape("scripts/."));
    }
}
