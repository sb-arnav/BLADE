//! Phase 57 install path — `blade_install_skill(url)`.
//!
//! Downloads a `SKILL.md` from a trusted HTTPS URL, validates the YAML +
//! invariants, and writes it to `~/.config/blade/skills_md/{name}/SKILL.md`.
//! Re-installs the in-memory registry on success so the new skill is
//! immediately dispatch-routable.
//!
//! ### Trust model
//!
//! - HTTPS-only. `http://` URLs are rejected.
//! - URL size cap: 256 KB. SKILL.md is a markdown file; larger payloads are
//!   refused to bound abuse.
//! - The downloaded body MUST parse as a valid `SkillManifest` AND its `name`
//!   field is the only path component used to construct the install dir.
//!   Path-traversal attempts via `name` (e.g. `../escape`) are rejected by
//!   the validate() ASCII-lowercase-and-hyphens-only check.
//! - Tarball (`.tar.gz`) install is documented as future work; this wave
//!   ships single-SKILL.md installs only.

use super::loader::{install_registry, user_skills_dir};
use super::manifest::SkillManifest;

const MAX_SKILL_BYTES: usize = 256 * 1024;

/// Install a skill from a URL. Returns the installed skill's `name` on success.
///
/// Errors are user-friendly single-line strings suitable for surfacing in chat.
pub async fn install_from_url(url: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("only https:// urls are allowed".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client init failed: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("download returned http {}", resp.status().as_u16()));
    }

    // Hard cap on body size.
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body: {e}"))?;
    if bytes.len() > MAX_SKILL_BYTES {
        return Err(format!(
            "skill body {} bytes exceeds {}KB cap",
            bytes.len(),
            MAX_SKILL_BYTES / 1024
        ));
    }

    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "skill body is not valid utf-8".to_string())?;

    install_from_text(text)
}

/// Direct-text installer (factored out of `install_from_url` so tests can
/// drive the validation/write path without standing up a webserver).
pub fn install_from_text(text: &str) -> Result<String, String> {
    let manifest = SkillManifest::parse_skill_md(text)
        .map_err(|e| format!("invalid skill: {e}"))?;

    // Defense-in-depth: validate() is already called by parse_skill_md, but a
    // direct caller could synthesize a SkillManifest; re-check.
    manifest.validate().map_err(|e| format!("invalid skill: {e}"))?;

    let root = user_skills_dir();
    std::fs::create_dir_all(&root).map_err(|e| format!("create skills dir: {e}"))?;

    let dir = root.join(&manifest.name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create skill dir: {e}"))?;

    std::fs::write(dir.join("SKILL.md"), text)
        .map_err(|e| format!("write SKILL.md: {e}"))?;

    let _ = install_registry();

    Ok(manifest.name)
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
        let p = std::env::temp_dir().join(format!("blade-skills-install-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn rejects_non_https_url_sync() {
        // The http:// guard is enforced before any IO, so we can assert it
        // even with a sync test by polling once on a dummy runtime.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt.block_on(install_from_url("http://example.com/SKILL.md")).err().unwrap();
        assert!(err.contains("https"));
    }

    #[test]
    fn installs_valid_skill_text() {
        let _g = ENV_LOCK.lock().unwrap();
        let root = fresh_root("valid");
        std::env::set_var("BLADE_CONFIG_DIR", &root);

        let text = "---\nname: my-skill\ndescription: hi\ntriggers:\n  - hello\n---\nbody\n";
        let name = install_from_text(text).expect("should install");
        assert_eq!(name, "my-skill");

        let f = root.join("skills_md").join("my-skill").join("SKILL.md");
        assert!(f.is_file(), "SKILL.md not written");

        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn rejects_invalid_skill_text() {
        let _g = ENV_LOCK.lock().unwrap();
        let root = fresh_root("invalid");
        std::env::set_var("BLADE_CONFIG_DIR", &root);

        let text = "---\nname: NOT-LOWER\ndescription: x\ntriggers:\n  - t\n---\nbody\n";
        let err = install_from_text(text).err().unwrap();
        assert!(err.contains("invalid skill"));

        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
