/// Deep Learn — Blade's mission zero.
///
/// Blade reads the user's digital life (with explicit permission) and becomes them.
/// Shell history, git commits, obsidian vault, code dirs, browser bookmarks,
/// VS Code settings, existing conversations — all ingested, embedded, synthesized
/// into the character bible.
///
/// This is not onboarding. This is Blade's first act of intelligence.
#[allow(dead_code)]

use serde::{Deserialize, Serialize};

use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSource {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: Option<String>,
    pub available: bool,
    pub size_hint: String, // e.g. "~2,400 lines"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearnProgress {
    pub source: String,
    pub status: String, // "reading" | "embedding" | "synthesizing" | "done" | "error"
    pub detail: String,
    pub chunks: usize,
}

/// Discover what's available to read on this machine
#[tauri::command]
pub async fn deeplearn_discover_sources() -> Result<Vec<DataSource>, String> {
    let mut sources = Vec::new();

    // Shell history
    let shell_sources = [
        ("~/.bash_history", "bash"),
        ("~/.zsh_history", "zsh"),
        ("~/.local/share/fish/fish_history", "fish"),
    ];
    for (path, shell) in &shell_sources {
        let expanded = expand_path(path);
        if expanded.exists() {
            let lines = count_lines(&expanded);
            sources.push(DataSource {
                id: format!("{}_history", shell),
                name: format!("{} history", shell.to_uppercase()),
                description: format!("Every command you've ever typed in {}", shell),
                path: Some(expanded.to_string_lossy().to_string()),
                available: true,
                size_hint: format!("~{} commands", lines),
            });
        }
    }

    // Git: recent commits across common repos
    let git_dirs = discover_git_repos();
    if !git_dirs.is_empty() {
        sources.push(DataSource {
            id: "git_commits".to_string(),
            name: "Git commit history".to_string(),
            description: "What you've built — commit messages from recent repos".to_string(),
            path: None,
            available: true,
            size_hint: format!("~{} repos found", git_dirs.len()),
        });
    }

    // VS Code / Cursor settings and recent files
    let vscode_dirs = [
        "~/.config/Code/User/settings.json",
        "~/.config/Cursor/User/settings.json",
        "~/AppData/Roaming/Code/User/settings.json",
        "~/Library/Application Support/Code/User/settings.json",
    ];
    for path in &vscode_dirs {
        let expanded = expand_path(path);
        if expanded.exists() {
            sources.push(DataSource {
                id: "vscode_settings".to_string(),
                name: "VS Code / Cursor settings".to_string(),
                description: "Editor preferences, keybinds, extensions — how you work".to_string(),
                path: Some(expanded.to_string_lossy().to_string()),
                available: true,
                size_hint: "settings + extensions".to_string(),
            });
            break;
        }
    }

    // Obsidian vault (if configured)
    let config = crate::config::load_config();
    if !config.obsidian_vault_path.is_empty() {
        let vault_path = std::path::PathBuf::from(&config.obsidian_vault_path);
        if vault_path.exists() {
            let md_count = count_markdown_files(&vault_path);
            sources.push(DataSource {
                id: "obsidian_vault".to_string(),
                name: "Obsidian vault".to_string(),
                description: "Your notes, thoughts, daily logs — the inside of your head".to_string(),
                path: Some(config.obsidian_vault_path.clone()),
                available: true,
                size_hint: format!("~{} notes", md_count),
            });
        }
    }

    // Existing Blade conversations
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if db_path.exists() {
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM conversations", [], |r| r.get(0))
                .unwrap_or(0);
            if count > 0 {
                sources.push(DataSource {
                    id: "blade_conversations".to_string(),
                    name: "Existing Blade conversations".to_string(),
                    description: "What you've already talked to Blade about".to_string(),
                    path: Some(db_path.to_string_lossy().to_string()),
                    available: true,
                    size_hint: format!("~{} conversations", count),
                });
            }
        }
    }

    // README files in home projects directory
    let proj_dirs = [
        "~/projects", "~/code", "~/dev", "~/src", "~/work", "~/repos",
    ];
    for dir in &proj_dirs {
        let expanded = expand_path(dir);
        if expanded.is_dir() {
            let readme_count = count_readmes(&expanded);
            if readme_count > 0 {
                sources.push(DataSource {
                    id: "project_readmes".to_string(),
                    name: "Project READMEs".to_string(),
                    description: format!("What you're building — READMEs from {}", dir),
                    path: Some(expanded.to_string_lossy().to_string()),
                    available: true,
                    size_hint: format!("~{} projects", readme_count),
                });
                break;
            }
        }
    }

    Ok(sources)
}

/// Run the deep learn ingestion for the selected sources.
/// Emits progress events: `deeplearn_progress`
/// Returns a synthesis summary when complete.
#[tauri::command]
pub async fn deeplearn_run(
    app: tauri::AppHandle,
    source_ids: Vec<String>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
) -> Result<String, String> {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return Err("No API key configured".to_string());
    }

    let db_path = crate::config::blade_config_dir().join("blade.db");
    let mut all_chunks: Vec<String> = Vec::new();

    for source_id in &source_ids {
        emit_progress(&app, source_id, "reading", "Starting...", 0);

        let chunks = match source_id.as_str() {
            id if id.ends_with("_history") => read_shell_history(id),
            "git_commits" => read_git_commits(),
            "vscode_settings" => read_vscode_settings(),
            "obsidian_vault" => read_obsidian_vault(&config.obsidian_vault_path),
            "blade_conversations" => read_blade_conversations(&db_path),
            "project_readmes" => read_project_readmes(),
            _ => Vec::new(),
        };

        let chunk_count = chunks.len();
        emit_progress(&app, source_id, "embedding", &format!("Embedding {} chunks...", chunk_count), chunk_count);

        // Embed chunks into persistent vector store
        let source_type = "deeplearn";
        for chunk in &chunks {
            if let Ok(embeddings) = crate::embeddings::embed_texts(&[chunk.clone()]) {
                if let Some(embedding) = embeddings.into_iter().next() {
                    if let Ok(mut store) = vector_store.inner().lock() {
                        store.add(chunk.clone(), embedding, source_type.to_string(), source_id.clone());
                    }
                }
            }
        }

        all_chunks.extend(chunks);
        emit_progress(&app, source_id, "done", &format!("Ingested {} chunks", chunk_count), chunk_count);
    }

    emit_progress(&app, "synthesis", "synthesizing", "Building your character model...", all_chunks.len());

    // LLM synthesis: distill everything into structured identity
    let synthesis = synthesize_identity(&config, &all_chunks).await?;

    // Write synthesis into brain tables
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        write_synthesis_to_brain(&conn, &synthesis)?;
    }

    emit_progress(&app, "synthesis", "done", "Character model complete", 0);

    Ok(synthesis.summary)
}

#[derive(Debug)]
struct IdentitySynthesis {
    summary: String,
    preferences: Vec<String>,
    style_tags: Vec<String>,
    memories: Vec<String>,
    identity_name: Option<String>,
    identity_role: Option<String>,
}

async fn synthesize_identity(
    config: &crate::config::BladeConfig,
    chunks: &[String],
) -> Result<IdentitySynthesis, String> {
    // Sample up to 8000 chars of data for synthesis
    let sample = chunks
        .iter()
        .take(60)
        .map(|c| c.as_str())
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");
    let sample = crate::safe_slice(&sample, 8000);

    let prompt = format!(
        r#"You are reading someone's digital life — their shell history, git commits, notes, and code. Your job is to build a deep psychological and professional model of who this person is.

Output valid JSON only. No markdown, no explanation.

{{
  "name": "their name if found anywhere, else null",
  "role": "what they do professionally in 5 words or less",
  "summary": "2-3 sentences — who are they really? What do they care about? What are they building? Be specific, not generic.",
  "preferences": [
    "list of specific behavioral preferences inferred from their data",
    "e.g. 'prefers TypeScript over JavaScript'",
    "e.g. 'commits frequently with short messages'",
    "e.g. 'works late — most activity after midnight'"
  ],
  "style_tags": ["ships-fast", "systems-thinker", ...],
  "memories": [
    "specific facts worth remembering",
    "e.g. 'Has a project called Staq — a fintech app for Indian teens'",
    "e.g. 'Uses Obsidian for daily notes, has been doing so since 2023'"
  ]
}}

Rules:
- preferences: 5-12 items, highly specific to this person's actual patterns
- style_tags: 3-6 short lowercase descriptors (e.g. "ships-fast", "no-fluff", "night-owl")
- memories: 5-15 concrete facts, each < 120 chars
- If data is thin, infer carefully. If truly nothing, return minimal valid JSON.

Data:
{}

JSON:"#,
        sample
    );

    let conversation = crate::providers::build_conversation(
        vec![crate::providers::ChatMessage {
            role: "user".to_string(),
            content: prompt,
            image_base64: None,
        }],
        None,
    );

    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &config.model,
        &conversation,
        &[],
        config.base_url.as_deref(),
    )
    .await?;

    let raw = result.content.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("Synthesis parse error: {} — raw: {}", e, crate::safe_slice(&raw, 200)))?;

    let preferences = parsed["preferences"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let style_tags = parsed["style_tags"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let memories = parsed["memories"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    Ok(IdentitySynthesis {
        summary: parsed["summary"].as_str().unwrap_or("").to_string(),
        preferences,
        style_tags,
        memories,
        identity_name: parsed["name"].as_str().map(String::from),
        identity_role: parsed["role"].as_str().map(String::from),
    })
}

fn write_synthesis_to_brain(conn: &rusqlite::Connection, s: &IdentitySynthesis) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();

    // B4 — do NOT write to brain_identity from deeplearn. The audit
    // (Abhinav, 2026-05-09) found `role: Web Developer` written into
    // brain_identity for a Founder/CEO based on filename inference.
    // Identity should only come from explicit user statements
    // (persona.md / onboarding), not LLM inference over shell history.
    // Name + role are intentionally dropped here.
    let _ = (&s.identity_name, &s.identity_role); // silence unused-warn

    // Style tags — kept (these are descriptors, not factual claims).
    for tag in &s.style_tags {
        let id = format!("dl:{}", tag.replace(' ', "-"));
        let _ = conn.execute(
            "INSERT OR IGNORE INTO brain_style_tags(id,tag) VALUES(?1,?2)",
            rusqlite::params![id, tag],
        );
    }

    // B4 — Preferences written below the 0.75 injection threshold used by
    // embeddings::smart_context_recall. The data still exists in brain_preferences
    // for inspection / promotion, but inferred facts no longer pollute the
    // system prompt as if they were user-confirmed truth.
    // Audit findings: 'uses Visual Studio Dark theme' (0.8), 'uses MesloLSG
    // Nerd Font' (0.8) — both auto-injected on every turn before this fix.
    for pref in &s.preferences {
        let id = format!("dl:pref:{}", uuid::Uuid::new_v4());
        let _ = conn.execute(
            "INSERT OR IGNORE INTO brain_preferences(id,text,confidence,source,updated_at) VALUES(?1,?2,0.5,'deeplearn',?3)",
            rusqlite::params![id, pref, now],
        );
    }

    // B4 — Memories likewise lowered. Audit findings: 'Working on ranking
    // functionality in a Node.js project', 'Has a main script file called
    // jp.js' — both fabrications traced to deeplearn parsing
    // /Applications/Claude.app/Contents/Resources/ja-JP.json as 'jp.js'.
    // Lowered confidence ensures any future read path that gates on it
    // (≥0.75 typical) won't surface these as authoritative.
    for mem in &s.memories {
        let id = format!("dl:mem:{}", uuid::Uuid::new_v4());
        let _ = conn.execute(
            "INSERT OR IGNORE INTO brain_memories(id,text,source_conversation_id,entities_json,confidence,created_at) VALUES(?1,?2,'deeplearn','[]',0.5,?3)",
            rusqlite::params![id, mem, now],
        );
    }

    Ok(())
}

// ── Data readers ──────────────────────────────────────────────────────────────

fn read_shell_history(source_id: &str) -> Vec<String> {
    let paths: &[&str] = match source_id {
        "bash_history" => &["~/.bash_history"],
        "zsh_history" => &["~/.zsh_history"],
        "fish_history" => &["~/.local/share/fish/fish_history"],
        _ => &[],
    };

    let mut commands: Vec<String> = Vec::new();
    for path in paths {
        let expanded = expand_path(path);
        if let Ok(content) = std::fs::read_to_string(&expanded) {
            for line in content.lines().rev().take(2000) {
                let cleaned = line
                    .trim_start_matches(": \\d+:\\d+;") // zsh timestamp format
                    .trim();
                if !cleaned.is_empty() && cleaned.len() > 3 {
                    commands.push(cleaned.to_string());
                }
            }
        }
    }

    // Chunk: group 30 commands per chunk
    commands
        .chunks(30)
        .map(|chunk| format!("Shell commands:\n{}", chunk.join("\n")))
        .collect()
}

fn read_git_commits() -> Vec<String> {
    let repos = discover_git_repos();
    let mut chunks = Vec::new();

    for repo in repos.iter().take(10) {
        let output = crate::cmd_util::silent_cmd("git")
            .args(["-C", &repo, "log", "--oneline", "--no-merges", "-200"])
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let log = String::from_utf8_lossy(&out.stdout).to_string();
                if !log.trim().is_empty() {
                    chunks.push(format!("Git commits from {}:\n{}", repo, crate::safe_slice(&log, 3000)));
                }
            }
        }
    }

    chunks
}

fn read_vscode_settings() -> Vec<String> {
    let paths = [
        "~/.config/Code/User/settings.json",
        "~/.config/Cursor/User/settings.json",
        "~/AppData/Roaming/Code/User/settings.json",
        "~/Library/Application Support/Code/User/settings.json",
    ];

    for path in &paths {
        let expanded = expand_path(path);
        if let Ok(content) = std::fs::read_to_string(&expanded) {
            // Also try to read extensions list
            let ext_path = expanded
                .parent()
                .map(|p| p.join("../extensions"))
                .unwrap_or_default();
            let extensions = if ext_path.is_dir() {
                std::fs::read_dir(&ext_path)
                    .ok()
                    .map(|entries| {
                        entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.file_name().to_string_lossy().to_string())
                            .take(50)
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .unwrap_or_default()
            } else {
                String::new()
            };

            let mut chunk = format!("VS Code / Cursor settings:\n{}", crate::safe_slice(&content, 2000));
            if !extensions.is_empty() {
                chunk.push_str(&format!("\n\nExtensions installed:\n{}", extensions));
            }
            return vec![chunk];
        }
    }
    Vec::new()
}

fn read_obsidian_vault(vault_path: &str) -> Vec<String> {
    if vault_path.is_empty() {
        return Vec::new();
    }
    let vault = std::path::PathBuf::from(vault_path);
    if !vault.is_dir() {
        return Vec::new();
    }

    let mut chunks = Vec::new();

    // Read daily notes (last 30 days — most recent life context)
    let daily_dirs = ["Daily Notes", "daily", "Journal", "journal"];
    for daily_dir in &daily_dirs {
        let dir = vault.join(daily_dir);
        if dir.is_dir() {
            let mut entries: Vec<_> = std::fs::read_dir(&dir)
                .ok()
                .map(|d| d.filter_map(|e| e.ok()).collect())
                .unwrap_or_default();
            entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));

            for entry in entries.iter().take(30) {
                let path = entry.path();
                if path.extension().map(|e| e == "md").unwrap_or(false) {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if !content.trim().is_empty() {
                            let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                            chunks.push(format!("Obsidian daily note ({}):\n{}", name, crate::safe_slice(&content, 1500)));
                        }
                    }
                }
            }
            break;
        }
    }

    // Read up to 20 random non-daily notes for broader context
    let mut all_notes: Vec<_> = walkdir_md(&vault, 3)
        .into_iter()
        .filter(|p| !p.contains("Daily") && !p.contains("daily") && !p.contains("Journal"))
        .take(20)
        .collect();
    all_notes.sort();

    for path in all_notes {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if content.trim().len() > 100 {
                let name = std::path::Path::new(&path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                chunks.push(format!("Obsidian note ({}):\n{}", name, crate::safe_slice(&content, 1000)));
            }
        }
    }

    chunks
}

fn read_blade_conversations(db_path: &std::path::Path) -> Vec<String> {
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT m.role, m.content FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         ORDER BY m.timestamp DESC LIMIT 500"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let pairs: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .ok()
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    // Group into chunks of 10 messages
    pairs
        .chunks(10)
        .map(|chunk| {
            let text = chunk
                .iter()
                .map(|(role, content)| format!("{}: {}", role, crate::safe_slice(content, 300)))
                .collect::<Vec<_>>()
                .join("\n");
            format!("Past Blade conversation:\n{}", text)
        })
        .collect()
}

fn read_project_readmes() -> Vec<String> {
    let proj_dirs = [
        "~/projects", "~/code", "~/dev", "~/src", "~/work", "~/repos",
    ];

    for dir in &proj_dirs {
        let expanded = expand_path(dir);
        if !expanded.is_dir() {
            continue;
        }

        let readmes: Vec<_> = std::fs::read_dir(&expanded)
            .ok()
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter_map(|entry| {
                        let readme = entry.path().join("README.md");
                        if readme.exists() { Some(readme) } else {
                            let readme_lower = entry.path().join("readme.md");
                            if readme_lower.exists() { Some(readme_lower) } else { None }
                        }
                    })
                    .take(20)
                    .collect()
            })
            .unwrap_or_default();

        if !readmes.is_empty() {
            return readmes
                .into_iter()
                .filter_map(|p| {
                    std::fs::read_to_string(&p).ok().map(|content| {
                        let name = p.parent()
                            .and_then(|d| d.file_name())
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        format!("Project README ({}):\n{}", name, crate::safe_slice(&content, 1500))
                    })
                })
                .collect();
        }
    }

    Vec::new()
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn expand_path(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") {
        dirs::home_dir()
            .unwrap_or_default()
            .join(&path[2..])
    } else {
        std::path::PathBuf::from(path)
    }
}

fn count_lines(path: &std::path::Path) -> usize {
    std::fs::read_to_string(path)
        .map(|c| c.lines().count())
        .unwrap_or(0)
}

fn count_markdown_files(dir: &std::path::Path) -> usize {
    walkdir_md(dir, 4).len()
}

fn count_readmes(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    let readme = e.path().join("README.md");
                    let readme_lower = e.path().join("readme.md");
                    readme.exists() || readme_lower.exists()
                })
                .count()
        })
        .unwrap_or(0)
}

fn discover_git_repos() -> Vec<String> {
    let search_dirs = [
        "~/projects", "~/code", "~/dev", "~/src", "~/work", "~/repos", "~",
    ];

    let mut repos = Vec::new();
    for dir in &search_dirs {
        let expanded = expand_path(dir);
        if !expanded.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&expanded) {
            for entry in entries.filter_map(|e| e.ok()) {
                let git_dir = entry.path().join(".git");
                if git_dir.is_dir() {
                    repos.push(entry.path().to_string_lossy().to_string());
                    if repos.len() >= 20 {
                        return repos;
                    }
                }
            }
        }
    }
    repos
}

fn walkdir_md(dir: &std::path::Path, max_depth: usize) -> Vec<String> {
    fn walk(dir: &std::path::Path, depth: usize, max_depth: usize, acc: &mut Vec<String>) {
        if depth > max_depth {
            return;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    if !name.starts_with('.') {
                        walk(&path, depth + 1, max_depth, acc);
                    }
                } else if path.extension().map(|e| e == "md").unwrap_or(false) {
                    acc.push(path.to_string_lossy().to_string());
                    if acc.len() >= 200 {
                        return;
                    }
                }
            }
        }
    }
    let mut acc = Vec::new();
    walk(dir, 0, max_depth, &mut acc);
    acc
}

fn emit_progress(app: &tauri::AppHandle, source: &str, status: &str, detail: &str, chunks: usize) {
    let _ = app.emit_to("main", "deeplearn_progress",
        LearnProgress {
            source: source.to_string(),
            status: status.to_string(),
            detail: detail.to_string(),
            chunks,
        },
    );
}
