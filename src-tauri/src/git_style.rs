/// GIT STYLE — Learn your coding style from commit history.
///
/// Inspired by github.com/edgarpavlovsky/gitstyle.
/// Mines your git log: commit messages, file patterns, naming conventions,
/// testing habits. Compiles into a style wiki that gets injected into
/// BLADE's Engineering mode context so every suggestion matches how YOU code.
///
/// Pipeline: git log → sample by language cluster → LLM extract style →
/// compile wiki → cache to disk → inject into brain on Engineering calls.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[allow(dead_code)]
const WIKI_FILE: &str = "git_style_wiki.md";
const MAX_COMMITS_TO_SAMPLE: usize = 80;
const WIKI_STALE_AFTER_SECS: i64 = 86400 * 3; // 3 days

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStyleWiki {
    pub repo_path: String,
    pub generated_at: i64,
    pub style_guide: String,
    pub commit_count_sampled: usize,
    pub languages_detected: Vec<String>,
}

/// Load cached wiki for a repo, if fresh enough.
pub fn load_wiki(repo_path: &str) -> Option<GitStyleWiki> {
    let wiki_path = wiki_path_for(repo_path);
    let data = std::fs::read_to_string(&wiki_path).ok()?;
    let wiki: GitStyleWiki = serde_json::from_str(&data).ok()?;
    let age = chrono::Utc::now().timestamp() - wiki.generated_at;
    if age > WIKI_STALE_AFTER_SECS {
        return None; // stale, need re-mine
    }
    Some(wiki)
}

/// Get style context string for injection into system prompt.
/// Returns empty string if no wiki exists or repo_path is empty.
pub fn style_context_for_repo(repo_path: &str) -> String {
    if repo_path.is_empty() { return String::new(); }
    load_wiki(repo_path).map(|w| format!(
        "## Your Coding Style (from git history)\n\n{}\n",
        w.style_guide
    )).unwrap_or_default()
}

/// Mine git history and build a style wiki. Returns the style guide markdown.
pub async fn mine_git_style(repo_path: &str) -> Result<GitStyleWiki, String> {
    if !Path::new(repo_path).exists() {
        return Err(format!("Path does not exist: {}", repo_path));
    }

    // Step 1: Get git log — commits with stats
    let log_output = crate::cmd_util::silent_cmd("git")
        .args([
            "log",
            "--format=%H|%s|%ae",
            "--diff-filter=AM",
            &format!("-{}", MAX_COMMITS_TO_SAMPLE * 2), // overfetch, we'll sample
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git log failed: {}", e))?;

    if !log_output.status.success() {
        return Err("Not a git repository or git not available".to_string());
    }

    let log_text = String::from_utf8_lossy(&log_output.stdout);
    let commits: Vec<CommitEntry> = log_text
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() == 3 {
                Some(CommitEntry {
                    hash: parts[0].to_string(),
                    subject: parts[1].to_string(),
                    author_email: parts[2].to_string(),
                })
            } else {
                None
            }
        })
        .take(MAX_COMMITS_TO_SAMPLE)
        .collect();

    if commits.is_empty() {
        return Err("No commits found in repository".to_string());
    }

    // Step 2: Get diffs for a sample of commits (first 15 to stay under token budget)
    let mut diff_samples = Vec::new();
    let mut languages_seen = std::collections::HashSet::new();

    for commit in commits.iter().take(15) {
        let diff = crate::cmd_util::silent_cmd("git")
            .args(["show", "--stat", "--no-color", &commit.hash])
            .current_dir(repo_path)
            .output()
            .ok();

        if let Some(out) = diff {
            let text = String::from_utf8_lossy(&out.stdout);
            // Detect languages from file extensions
            for line in text.lines() {
                for ext in &[".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".cpp", ".c"] {
                    if line.contains(ext) {
                        languages_seen.insert(ext.trim_start_matches('.').to_string());
                    }
                }
            }
            // Take first 300 chars of stat only (not full diff — too expensive)
            let stat: String = text.chars().take(300).collect();
            diff_samples.push(format!("commit: {}\n{}", &commit.subject, stat));
        }
    }

    let languages: Vec<String> = languages_seen.into_iter().collect();

    // Step 3: Build analysis prompt
    let commit_subjects: Vec<String> = commits.iter()
        .take(40)
        .map(|c| format!("  - {}", c.subject))
        .collect();

    let analysis_prompt = format!(
        r#"Analyze this developer's coding style from their git history. Be specific and concrete.

COMMIT MESSAGES (last {} commits):
{}

RECENT COMMIT STATS (file changes):
{}

DETECTED LANGUAGES: {}

Extract a concise style guide covering:
1. **Commit conventions** — format (conventional commits? emoji? imperative?), typical length, patterns
2. **Naming patterns** — what naming conventions appear in file paths and commit subjects?
3. **Work habits** — how are changes scoped? Small focused commits or large batches?
4. **Testing approach** — do commits mention tests? What testing language/framework appears?
5. **Key patterns** — anything distinctive about how this developer works?

Write as a markdown style guide (bullet points, max 400 words). Be direct and specific — name actual patterns you see.
Do not hallucinate patterns not evidenced in the data."#,
        commits.len(),
        commit_subjects.join("\n"),
        diff_samples.join("\n\n"),
        languages.join(", ")
    );

    // Step 4: Call cheapest available model
    let config = crate::config::load_config();
    let cheap_model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let messages = vec![crate::providers::ConversationMessage::User(analysis_prompt)];
    let style_guide = match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &cheap_model,
        &messages,
        &[],
        config.base_url.as_deref(),
    ).await {
        Ok(turn) => turn.content,
        Err(e) => return Err(format!("Style analysis failed: {}", e)),
    };

    let wiki = GitStyleWiki {
        repo_path: repo_path.to_string(),
        generated_at: chrono::Utc::now().timestamp(),
        style_guide,
        commit_count_sampled: commits.len(),
        languages_detected: languages,
    };

    // Step 5: Cache to disk
    let wiki_path = wiki_path_for(repo_path);
    if let Ok(data) = serde_json::to_string_pretty(&wiki) {
        let _ = std::fs::write(&wiki_path, data);
    }

    Ok(wiki)
}

fn wiki_path_for(repo_path: &str) -> std::path::PathBuf {
    // Hash the path so different repos get different wiki files
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;
    let mut h = DefaultHasher::new();
    repo_path.hash(&mut h);
    let key = h.finish();
    crate::config::blade_config_dir().join(format!("git_style_{:x}.json", key))
}

#[derive(Debug)]
struct CommitEntry {
    hash: String,
    subject: String,
    #[allow(dead_code)]
    author_email: String,
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_style_mine(repo_path: String) -> Result<GitStyleWiki, String> {
    mine_git_style(&repo_path).await
}

#[tauri::command]
pub fn git_style_get(repo_path: String) -> Option<GitStyleWiki> {
    load_wiki(&repo_path)
}

#[tauri::command]
pub fn git_style_clear(repo_path: String) {
    let wiki_path = wiki_path_for(&repo_path);
    let _ = std::fs::remove_file(wiki_path);
}
