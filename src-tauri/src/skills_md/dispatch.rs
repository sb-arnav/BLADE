//! Trigger-matching for phase-57 skills. Given a user message, find the
//! highest-confidence matching `SkillManifest`. "Confidence" today is a
//! deterministic substring + word-boundary check. Semantic matching is
//! future work.
//!
//! ## Algorithm
//!
//! 1. Lowercase + normalize the user message (whitespace collapsed).
//! 2. For each registered trigger key, accept the match iff:
//!    - The trigger appears as a substring of the normalized message; AND
//!    - The substring is delimited by word boundaries on both sides
//!      (start-of-string, end-of-string, or non-alphanumeric char).
//! 3. On multiple matches, the *longest* trigger wins (most specific).
//!
//! This is intentionally simple. The OpenClaw pattern relies on the LLM
//! itself being the second-pass arbiter: false positives that match the
//! trigger but want a normal response are cheap because the skill body is
//! an LLM prompt, not an opaque code path.

use super::loader::{normalize_trigger, registry};
use super::manifest::SkillManifest;

/// Attempt to match a user message against the registered triggers. Returns
/// the manifest of the matched skill, or `None` if no trigger fires.
pub fn match_trigger(user_message: &str) -> Option<SkillManifest> {
    let normalized = normalize_trigger(user_message);
    if normalized.is_empty() {
        return None;
    }

    let reg = registry().read().ok()?;
    if reg.is_empty() {
        return None;
    }

    let mut best: Option<(usize, SkillManifest)> = None;

    for (trigger, manifest) in reg.iter() {
        if trigger.is_empty() {
            continue;
        }
        if has_word_boundary_match(&normalized, trigger) {
            let len = trigger.len();
            match &best {
                Some((blen, _)) if *blen >= len => {}
                _ => best = Some((len, manifest.clone())),
            }
        }
    }

    best.map(|(_, m)| m)
}

/// Return true iff `needle` appears in `haystack` delimited by non-alphanumeric
/// boundaries (or string ends).
///
/// Both inputs MUST be pre-normalized (lowercased, single-spaced).
fn has_word_boundary_match(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() || needle.len() > haystack.len() {
        return false;
    }
    // Walk every occurrence; accept if any has clean boundaries on both ends.
    let hbytes = haystack.as_bytes();
    let nbytes = needle.as_bytes();

    let mut start = 0usize;
    while start + nbytes.len() <= hbytes.len() {
        if let Some(off) = find_at(hbytes, nbytes, start) {
            let left_ok = off == 0
                || !is_alnum_byte(hbytes[off - 1]);
            let right_idx = off + nbytes.len();
            let right_ok = right_idx == hbytes.len()
                || !is_alnum_byte(hbytes[right_idx]);
            if left_ok && right_ok {
                return true;
            }
            start = off + 1;
        } else {
            return false;
        }
    }
    false
}

fn find_at(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from);
    }
    if from + needle.len() > hay.len() {
        return None;
    }
    'outer: for i in from..=hay.len() - needle.len() {
        for j in 0..needle.len() {
            if hay[i + j] != needle[j] {
                continue 'outer;
            }
        }
        return Some(i);
    }
    None
}

/// Match boundary char must be ASCII alphanumeric. Non-ASCII chars in user
/// content are treated as boundary characters (safe — accents/CJK still
/// trigger as word-separated).
fn is_alnum_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}

#[cfg(test)]
mod tests {
    use super::super::loader::{install_registry, user_skills_dir};
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
        let p = std::env::temp_dir().join(format!("blade-skills-disp-{tag}-{nanos}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn seed(name: &str, triggers: &[&str]) {
        let dir = user_skills_dir().join(name);
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

    #[test]
    fn word_boundary_does_not_match_inside_word() {
        assert!(!has_word_boundary_match("subsumption", "sub"));
        assert!(has_word_boundary_match("kill the tabs i don't want", "kill the tabs"));
    }

    #[test]
    fn case_insensitive_trigger_match() {
        let _g = ENV_LOCK.lock().unwrap();
        let root = fresh_root("case");
        std::env::set_var("BLADE_CONFIG_DIR", &root);

        seed("summarize-page", &["summarize this page"]);
        install_registry();

        let m = match_trigger("Hey BLADE, SUMMARIZE this PAGE for me");
        assert!(m.is_some(), "expected case-insensitive match");
        assert_eq!(m.unwrap().name, "summarize-page");

        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn longest_trigger_wins() {
        let _g = ENV_LOCK.lock().unwrap();
        let root = fresh_root("longest");
        std::env::set_var("BLADE_CONFIG_DIR", &root);

        seed("short", &["draft email"]);
        seed("long", &["draft followup email"]);
        install_registry();

        let m = match_trigger("please draft followup email to alex").unwrap();
        assert_eq!(m.name, "long");

        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
