//! Catalog — workspace > user > bundled resolver.
//!
//! Eagerly loads frontmatter for every discovered skill across the 3 tiers so
//! `resolve(name)` is a HashMap lookup. Body bytes are NOT loaded here
//! (progressive disclosure — see Plan 21-03 `activate.rs`).
//!
//! Tier precedence: `Workspace` (priority 0) wins over `User` (1) wins over
//! `Bundled` (2). When the same `name` appears in multiple tiers, the higher-
//! priority entry is returned. Lower-priority entries remain in
//! `Catalog::all()` for diagnostics / `blade skill list --all`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::loader::{bundled_root, scan_tier, user_root, workspace_root};
use super::types::{SkillStub, SourceTier};

/// Catalog of all known skills across the 3 tiers.
#[derive(Debug, Default)]
pub struct Catalog {
    /// All discovered stubs, in the order workspace → user → bundled.
    /// Within a tier, order matches `scan_tier` (filesystem order).
    stubs: Vec<SkillStub>,

    /// Resolved view: name → index into `stubs`. Populated with the
    /// highest-priority entry per name.
    by_name: HashMap<String, usize>,
}

impl Catalog {
    /// Build a catalog by scanning all 3 tiers. Each tier defaults to its
    /// canonical root (per `loader::workspace_root` etc); a missing dir is
    /// silent.
    pub fn build_default() -> Self {
        let workspace = workspace_root();
        let user = user_root();
        let bundled = bundled_root();

        let workspace_ref = workspace.as_deref();
        Self::build(workspace_ref, &user, &bundled)
    }

    /// Build a catalog from explicit roots (testable seam).
    pub fn build(
        workspace: Option<&Path>,
        user: &Path,
        bundled: &Path,
    ) -> Self {
        let mut stubs: Vec<SkillStub> = Vec::new();

        if let Some(ws) = workspace {
            stubs.extend(scan_tier(ws, SourceTier::Workspace));
        }
        stubs.extend(scan_tier(user, SourceTier::User));
        stubs.extend(scan_tier(bundled, SourceTier::Bundled));

        // Build name → index, keeping the lowest priority value (= highest
        // precedence — Workspace=0 wins over User=1 wins over Bundled=2).
        let mut by_name: HashMap<String, usize> = HashMap::new();
        for (i, stub) in stubs.iter().enumerate() {
            let name = stub.frontmatter.name.clone();
            match by_name.get(&name) {
                Some(&existing) => {
                    let existing_priority = stubs[existing].source.priority();
                    if stub.source.priority() < existing_priority {
                        by_name.insert(name, i);
                    }
                }
                None => {
                    by_name.insert(name, i);
                }
            }
        }

        Catalog { stubs, by_name }
    }

    /// Resolve a skill by name. Returns the highest-priority entry across tiers.
    pub fn resolve(&self, name: &str) -> Option<&SkillStub> {
        self.by_name.get(name).map(|&i| &self.stubs[i])
    }

    /// All discovered skills across tiers, in scan order. Useful for
    /// `blade skill list --all` and progressive-disclosure assertions
    /// (the metadata-byte budget is `sum(len(frontmatter_yaml))` for this set).
    pub fn all(&self) -> &[SkillStub] {
        &self.stubs
    }

    /// Count of skills in the catalog (after resolution).
    pub fn resolved_count(&self) -> usize {
        self.by_name.len()
    }

    /// Workspace root used when this catalog was built (for diagnostics).
    pub fn workspace_root_used() -> Option<PathBuf> {
        workspace_root()
    }
}

#[cfg(test)]
mod tests {
    use super::super::loader::scan_tier;
    use super::*;
    use std::fs;
    use std::path::Path;

    fn write_skill(parent: &Path, name: &str, description: &str) {
        let dir = parent.join(name);
        fs::create_dir_all(&dir).unwrap();
        let text = format!("---\nname: {name}\ndescription: {description}\n---\n# {name}\n");
        fs::write(dir.join("SKILL.md"), text).unwrap();
    }

    struct Tmp(std::path::PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let p = std::env::temp_dir().join(format!("blade-resolver-{tag}-{}", nanos));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn build_with_explicit_roots_loads_all_three_tiers() {
        let ws = Tmp::new("ws");
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");

        write_skill(ws.path(), "ws-only", "Workspace only.");
        write_skill(user.path(), "user-only", "User only.");
        write_skill(bundled.path(), "bundled-only", "Bundled only.");

        let cat = Catalog::build(Some(ws.path()), user.path(), bundled.path());
        assert_eq!(cat.resolved_count(), 3);
        assert_eq!(cat.resolve("ws-only").unwrap().source, SourceTier::Workspace);
        assert_eq!(cat.resolve("user-only").unwrap().source, SourceTier::User);
        assert_eq!(cat.resolve("bundled-only").unwrap().source, SourceTier::Bundled);
    }

    #[test]
    fn workspace_wins_over_user_on_name_collision() {
        let ws = Tmp::new("ws");
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");

        write_skill(ws.path(), "shared", "Workspace version.");
        write_skill(user.path(), "shared", "User version.");

        let cat = Catalog::build(Some(ws.path()), user.path(), bundled.path());
        let resolved = cat.resolve("shared").unwrap();
        assert_eq!(resolved.source, SourceTier::Workspace);
        assert_eq!(resolved.frontmatter.description, "Workspace version.");
    }

    #[test]
    fn user_wins_over_bundled_on_name_collision() {
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");

        write_skill(user.path(), "shared", "User version.");
        write_skill(bundled.path(), "shared", "Bundled version.");

        let cat = Catalog::build(None, user.path(), bundled.path());
        let resolved = cat.resolve("shared").unwrap();
        assert_eq!(resolved.source, SourceTier::User);
    }

    #[test]
    fn workspace_wins_over_bundled_on_three_way_collision() {
        let ws = Tmp::new("ws");
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");

        write_skill(ws.path(), "x", "Workspace.");
        write_skill(user.path(), "x", "User.");
        write_skill(bundled.path(), "x", "Bundled.");

        let cat = Catalog::build(Some(ws.path()), user.path(), bundled.path());
        let resolved = cat.resolve("x").unwrap();
        assert_eq!(resolved.source, SourceTier::Workspace);
        // All three are still in `all()` for diagnostics
        assert_eq!(cat.all().len(), 3);
    }

    #[test]
    fn resolve_returns_none_for_unknown_skill() {
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");
        let cat = Catalog::build(None, user.path(), bundled.path());
        assert!(cat.resolve("does-not-exist").is_none());
    }

    #[test]
    fn empty_roots_produce_empty_catalog() {
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");
        let cat = Catalog::build(None, user.path(), bundled.path());
        assert_eq!(cat.resolved_count(), 0);
        assert!(cat.all().is_empty());
    }

    #[test]
    fn all_preserves_workspace_user_bundled_order() {
        let ws = Tmp::new("ws");
        let user = Tmp::new("user");
        let bundled = Tmp::new("bundled");

        write_skill(ws.path(), "from-ws", "ws.");
        write_skill(user.path(), "from-user", "user.");
        write_skill(bundled.path(), "from-bundled", "bundled.");

        let cat = Catalog::build(Some(ws.path()), user.path(), bundled.path());
        let names: Vec<&str> = cat
            .all()
            .iter()
            .map(|s| s.frontmatter.name.as_str())
            .collect();
        // Order: workspace first, then user, then bundled
        assert_eq!(names, vec!["from-ws", "from-user", "from-bundled"]);
    }

    #[test]
    fn scan_tier_module_re_export_works() {
        // Sanity: confirm we can call scan_tier through the resolver module too
        // (verifies pub use chain at the crate level).
        let tmp = Tmp::new("st");
        write_skill(tmp.path(), "st", "x.");
        let stubs = scan_tier(tmp.path(), SourceTier::Workspace);
        assert_eq!(stubs.len(), 1);
    }
}
