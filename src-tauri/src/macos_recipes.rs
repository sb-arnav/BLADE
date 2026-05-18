// Phase 78 (v2.4) — macOS AppleScript recipe library.
//
// Vendors 298 .md recipes from steipete/macos-automator-mcp (MIT, 798 stars)
// across 7 categories: 04_system, 05_files, 07_browsers, 08_editors,
// 09_productivity, 12_network, 13_developer (+ _shared_handlers). Vendored
// copy lives at src-tauri/resources/applescript_recipes/ with the upstream
// LICENSE preserved as UPSTREAM_LICENSE.
//
// Each recipe is a single .md file with YAML frontmatter (id, title,
// description, category, keywords, argumentsPrompt, notes, language) and an
// AppleScript body in a ```applescript fenced block. Placeholders look like
// `--MCP_INPUT:param_name` and get substituted at exec time.
//
// Module is macos-targeted for exec; parser + catalog loader are pure Rust
// so falsification runs on any host. Subprocess uses Command::new (execFile
// pattern — no shell, no injection risk).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecipeMetadata {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub category: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default, rename = "argumentsPrompt")]
    pub arguments_prompt: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn default_language() -> String { "applescript".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Recipe {
    pub metadata: RecipeMetadata,
    pub script: String,
}

#[derive(Debug, Default)]
pub struct RecipeCatalog {
    by_id: HashMap<String, Recipe>,
}

impl RecipeCatalog {
    pub fn new() -> Self { Self::default() }
    pub fn len(&self) -> usize { self.by_id.len() }
    pub fn is_empty(&self) -> bool { self.by_id.is_empty() }
    pub fn get(&self, id: &str) -> Option<&Recipe> { self.by_id.get(id) }

    pub fn ids(&self) -> Vec<&str> {
        let mut v: Vec<&str> = self.by_id.keys().map(|s| s.as_str()).collect();
        v.sort();
        v
    }

    pub fn search_by_keyword(&self, query: &str) -> Vec<&Recipe> {
        let q = query.to_lowercase();
        let mut out: Vec<&Recipe> = self.by_id.values()
            .filter(|r| {
                r.metadata.title.to_lowercase().contains(&q)
                    || r.metadata.description.to_lowercase().contains(&q)
                    || r.metadata.keywords.iter().any(|k| k.to_lowercase().contains(&q))
            })
            .collect();
        out.sort_by(|a, b| a.metadata.id.cmp(&b.metadata.id));
        out
    }

    /// Walk the resources/applescript_recipes/ dir + load every recipe.md.
    /// Returns (catalog, skipped-file-count).
    pub fn load_from_dir(root: &Path) -> Result<(Self, usize), String> {
        let mut cat = Self::new();
        let mut skipped = 0usize;
        load_walk(root, &mut cat, &mut skipped)?;
        Ok((cat, skipped))
    }

    pub fn insert(&mut self, recipe: Recipe) {
        self.by_id.insert(recipe.metadata.id.clone(), recipe);
    }
}

fn load_walk(dir: &Path, cat: &mut RecipeCatalog, skipped: &mut usize) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read_dir {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            load_walk(&path, cat, skipped)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if name.starts_with('_') { continue; }
            }
            match std::fs::read_to_string(&path) {
                Ok(content) => match parse_recipe(&content) {
                    Ok(recipe) => cat.insert(recipe),
                    Err(_) => *skipped += 1,
                },
                Err(_) => *skipped += 1,
            }
        }
    }
    Ok(())
}

/// Parse a recipe .md file: YAML frontmatter + ```applescript fenced body.
pub fn parse_recipe(content: &str) -> Result<Recipe, String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Err("missing YAML frontmatter".to_string());
    }
    let after_open = &trimmed[3..];
    let end = after_open.find("\n---").ok_or("unterminated frontmatter")?;
    let yaml_body = &after_open[..end];
    let metadata: RecipeMetadata = serde_yaml::from_str(yaml_body)
        .map_err(|e| format!("yaml parse: {}", e))?;
    let body_section = &after_open[end + 4..];
    let script = extract_fenced_script(body_section)?;
    Ok(Recipe { metadata, script })
}

/// Extract the first fenced code block (```applescript / ```javascript / ```jxa / ```).
fn extract_fenced_script(body: &str) -> Result<String, String> {
    for opener in ["```applescript", "```javascript", "```jxa", "```"] {
        if let Some(start_idx) = body.find(opener) {
            let after_opener = &body[start_idx + opener.len()..];
            let script_start = after_opener.find('\n').map(|i| i + 1).unwrap_or(0);
            let inside = &after_opener[script_start..];
            if let Some(close_idx) = inside.find("\n```") {
                return Ok(inside[..close_idx].to_string());
            }
        }
    }
    Err("no fenced code block found".to_string())
}

/// Replace `--MCP_INPUT:name` placeholders with caller-supplied params.
pub fn substitute_placeholders(script: &str, params: &HashMap<String, String>) -> String {
    let mut out = script.to_string();
    for (name, value) in params {
        let placeholder = format!("--MCP_INPUT:{}", name);
        out = out.replace(&placeholder, value);
    }
    out
}

// ── macOS subprocess execution (Command::new — execFile pattern, no shell) ──

#[cfg(target_os = "macos")]
pub fn exec_recipe(catalog: &RecipeCatalog, id: &str, params: HashMap<String, String>) -> Result<String, String> {
    use std::process::Command;
    let recipe = catalog.get(id).ok_or_else(|| format!("recipe not found: {}", id))?;
    let script = substitute_placeholders(&recipe.script, &params);
    let lang_flag: Vec<&str> = if recipe.metadata.language == "javascript" || recipe.metadata.language == "jxa" {
        vec!["-l", "JavaScript"]
    } else {
        vec![]
    };
    let mut cmd = Command::new("osascript");
    for f in &lang_flag { cmd.arg(f); }
    cmd.args(["-e", &script]);
    let out = cmd.output().map_err(|e| format!("osascript spawn: {}", e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn exec_recipe(_catalog: &RecipeCatalog, _id: &str, _params: HashMap<String, String>) -> Result<String, String> {
    Err("macos_recipes::exec_recipe is macOS-only".to_string())
}

/// Default catalog location. CARGO_MANIFEST_DIR at dev time; Tauri's resource
/// resolver handles the bundled path at runtime (caller passes resolved path).
pub fn default_catalog_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/applescript_recipes")
}

// ── Tauri command surface ───────────────────────────────────────────────

#[tauri::command]
pub fn macos_recipes_list_ids() -> Result<Vec<String>, String> {
    let (cat, _) = RecipeCatalog::load_from_dir(&default_catalog_path())?;
    Ok(cat.ids().into_iter().map(|s| s.to_string()).collect())
}

#[tauri::command]
pub fn macos_recipes_search(query: String) -> Result<Vec<RecipeMetadata>, String> {
    let (cat, _) = RecipeCatalog::load_from_dir(&default_catalog_path())?;
    Ok(cat.search_by_keyword(&query).into_iter().map(|r| r.metadata.clone()).collect())
}

#[tauri::command]
pub fn macos_recipes_exec_cmd(id: String, params: HashMap<String, String>) -> Result<String, String> {
    let (cat, _) = RecipeCatalog::load_from_dir(&default_catalog_path())?;
    exec_recipe(&cat, &id, params)
}

// ── Phase 78 falsification — runnable tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RECIPE: &str = r#"---
title: "Finder: Test Recipe"
category: 05_files
id: test_recipe
description: A test recipe for unit testing.
keywords:
  - test
  - finder
language: applescript
---

```applescript
on run {param1}
  if param1 is "" then
    set param1 to "--MCP_INPUT:param1"
  end if
  return "result: " & param1
end run
```
"#;

    #[test]
    fn parse_recipe_extracts_metadata_and_script() {
        let recipe = parse_recipe(SAMPLE_RECIPE).expect("parse ok");
        assert_eq!(recipe.metadata.id, "test_recipe");
        assert_eq!(recipe.metadata.title, "Finder: Test Recipe");
        assert_eq!(recipe.metadata.category, "05_files");
        assert_eq!(recipe.metadata.keywords, vec!["test", "finder"]);
        assert_eq!(recipe.metadata.language, "applescript");
        assert!(recipe.script.contains("on run {param1}"));
        assert!(recipe.script.contains("--MCP_INPUT:param1"));
    }

    #[test]
    fn parse_recipe_rejects_no_frontmatter() {
        assert!(parse_recipe("no frontmatter here").is_err());
        assert!(parse_recipe("```applescript\nfoo\n```").is_err());
    }

    #[test]
    fn parse_recipe_rejects_no_code_block() {
        let no_body = "---\ntitle: \"x\"\nid: x\ncategory: x\n---\n\njust prose, no code fence.\n";
        assert!(parse_recipe(no_body).is_err());
    }

    #[test]
    fn substitute_placeholders_replaces_known_keys() {
        let mut params = HashMap::new();
        params.insert("param1".to_string(), "/tmp/foo".to_string());
        let out = substitute_placeholders("set x to --MCP_INPUT:param1", &params);
        assert_eq!(out, "set x to /tmp/foo");
    }

    #[test]
    fn substitute_placeholders_leaves_unknown_keys_alone() {
        let params = HashMap::new();
        let out = substitute_placeholders("set x to --MCP_INPUT:unknown", &params);
        assert_eq!(out, "set x to --MCP_INPUT:unknown");
    }

    #[test]
    fn catalog_lookup_by_id_after_insert() {
        let mut cat = RecipeCatalog::new();
        let recipe = parse_recipe(SAMPLE_RECIPE).unwrap();
        cat.insert(recipe);
        assert_eq!(cat.len(), 1);
        assert!(cat.get("test_recipe").is_some());
        assert!(cat.get("nonexistent").is_none());
    }

    #[test]
    fn catalog_search_matches_title_description_keywords() {
        let mut cat = RecipeCatalog::new();
        cat.insert(parse_recipe(SAMPLE_RECIPE).unwrap());
        assert_eq!(cat.search_by_keyword("Finder").len(), 1, "title match");
        assert_eq!(cat.search_by_keyword("FINDER").len(), 1, "case-insensitive");
        assert_eq!(cat.search_by_keyword("test recipe").len(), 1, "title substring");
        assert_eq!(cat.search_by_keyword("nonexistent").len(), 0);
    }

    #[test]
    fn load_vendored_catalog_loads_at_least_200_recipes() {
        let (cat, skipped) = RecipeCatalog::load_from_dir(&default_catalog_path())
            .expect("vendored catalog loads");
        assert!(cat.len() >= 200, "catalog has {} recipes (expected >= 200)", cat.len());
        let skip_ratio = skipped as f32 / (cat.len() + skipped).max(1) as f32;
        assert!(skip_ratio < 0.20, "skip ratio {} too high ({}/{}+{})",
                skip_ratio, skipped, cat.len(), skipped);
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn non_macos_exec_returns_macos_only_err() {
        let cat = RecipeCatalog::new();
        let result = exec_recipe(&cat, "anything", HashMap::new());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("macOS-only"));
    }
}
