/// GITHUB DEEP TENTACLE — BLADE lives inside GitHub.
///
/// This tentacle goes far beyond notification polling. It:
///   - Reviews PRs by fetching diffs and running LLM code-review
///   - Triages unlabelled issues (classify → label → deduplicate → close stale)
///   - Drafts release changelogs from commits since the last tag
///   - Auto-merges Dependabot PRs when all checks pass and no conflicts exist
///   - Generates a weekly community health report (stars, forks, response time,
///     contributor churn)
///
/// All GitHub calls use the token stored under the "github" keyring entry via
/// `crate::config::get_provider_key("github")`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── GitHub REST types (minimal — only the fields we use) ─────────────────────

#[derive(Debug, Clone, Deserialize)]
struct GhFile {
    filename: String,
    status: String,        // "added" | "modified" | "removed" | "renamed"
    additions: u32,
    deletions: u32,
    #[serde(default)]
    patch: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GhIssue {
    number: u32,
    title: String,
    body: Option<String>,
    state: String,
    labels: Vec<GhLabel>,
    user: GhUser,
    updated_at: String,
    created_at: String,
    pull_request: Option<serde_json::Value>, // present only on PR objects
}

#[derive(Debug, Clone, Deserialize)]
struct GhLabel {
    name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhUser {
    login: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhPull {
    number: u32,
    title: String,
    body: Option<String>,
    user: GhUser,
    head: GhRef,
    base: GhRef,
    mergeable: Option<bool>,
    draft: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct GhRef {
    #[serde(rename = "ref")]
    ref_name: String,
    sha: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhCheckRun {
    status: String,     // "completed" | "in_progress" | "queued"
    conclusion: Option<String>, // "success" | "failure" | "neutral" | …
}

#[derive(Debug, Clone, Deserialize)]
struct GhCheckRunsResponse {
    check_runs: Vec<GhCheckRun>,
}

#[derive(Debug, Clone, Deserialize)]
struct GhCommit {
    sha: String,
    commit: GhCommitDetail,
}

#[derive(Debug, Clone, Deserialize)]
struct GhCommitDetail {
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhCompareResponse {
    commits: Vec<GhCommit>,
}

#[derive(Debug, Clone, Deserialize)]
struct GhRelease {
    tag_name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhRepo {
    stargazers_count: u32,
    forks_count: u32,
    open_issues_count: u32,
}

// ── Public output types ───────────────────────────────────────────────────────

/// A structured code-review result from the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrReview {
    /// The PR number that was reviewed.
    pub pr_number: u32,
    /// GitHub review ID returned after posting (empty if posting failed).
    pub github_review_id: Option<u64>,
    /// Summary body posted to GitHub.
    pub body: String,
    /// Flat list of review categories flagged.
    pub categories: Vec<String>,
    /// "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
    pub verdict: String,
}

/// A single issue after triage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriagedIssue {
    pub number: u32,
    pub title: String,
    /// "bug" | "feature" | "question" | "duplicate" | "stale"
    pub classification: String,
    /// Labels actually applied on GitHub.
    pub labels_applied: Vec<String>,
    /// Set if we detected a likely duplicate issue number.
    pub duplicate_of: Option<u32>,
    /// True if the issue was closed as stale.
    pub closed_as_stale: bool,
}

/// Community health snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunityReport {
    pub owner: String,
    pub repo: String,
    pub stars: u32,
    pub forks: u32,
    pub open_issues: u32,
    /// Average hours from issue open to first comment (sampled).
    pub avg_response_hours: f64,
    /// Contributor logins seen in the last 30 days.
    pub active_contributors: Vec<String>,
    /// Contributor logins who were active 90+ days ago but not recently.
    pub churned_contributors: Vec<String>,
    /// Human-readable weekly health summary from LLM.
    pub summary: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn github_token() -> String {
    crate::config::get_provider_key("github")
}

/// Build a reqwest client with GitHub auth + JSON accept headers.
fn gh_client() -> reqwest::Client {
    reqwest::Client::new()
}

async fn gh_get(url: &str, token: &str) -> Result<reqwest::Response, String> {
    gh_client()
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "BLADE-Hive/1.0")
        .send()
        .await
        .map_err(|e| format!("[github_deep] GET {url} failed: {e}"))
}

async fn gh_post(
    url: &str,
    token: &str,
    body: serde_json::Value,
) -> Result<reqwest::Response, String> {
    gh_client()
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "BLADE-Hive/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("[github_deep] POST {url} failed: {e}"))
}

async fn gh_put(
    url: &str,
    token: &str,
    body: serde_json::Value,
) -> Result<reqwest::Response, String> {
    gh_client()
        .put(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "BLADE-Hive/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("[github_deep] PUT {url} failed: {e}"))
}

/// Call the BLADE LLM (user's current provider + model) with a simple
/// system + user prompt and return the assistant response text.
async fn llm_call(system: &str, user: &str) -> Result<String, String> {
    let config = crate::config::load_config();
    let model = format!("{}/{}", config.provider, config.model);
    let no_tools: Vec<crate::providers::ToolDefinition> = vec![];
    let messages = vec![
        crate::providers::ConversationMessage::System(system.to_string()),
        crate::providers::ConversationMessage::User(user.to_string()),
    ];
    match crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &no_tools,
        config.base_url.as_deref(),
    )
    .await
    {
        Ok(turn) => Ok(turn.content),
        Err(e) => Err(format!("[github_deep] LLM call failed: {e}")),
    }
}

// ── 1. PR Review ──────────────────────────────────────────────────────────────

/// Review a pull request: fetch its diff, send to LLM, post results back to GitHub.
///
/// Categories flagged: bug_risk, style, performance, security.
/// The coding-style context from git_style is appended to the system prompt when
/// a local repo path is discoverable from the BLADE config.
pub async fn review_pr(
    owner: &str,
    repo: &str,
    pr_number: u32,
) -> Result<PrReview, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured. Set it in BLADE settings under the 'github' provider.".to_string());
    }

    // --- Fetch PR metadata -------------------------------------------------------
    let pr_url = format!("https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}");
    let pr_resp = gh_get(&pr_url, &token).await?;
    if !pr_resp.status().is_success() {
        return Err(format!(
            "[github_deep] Failed to fetch PR #{pr_number}: HTTP {}",
            pr_resp.status()
        ));
    }
    let pr: GhPull = pr_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PR response: {e}"))?;

    // --- Fetch diff files -------------------------------------------------------
    let files_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
    );
    let files_resp = gh_get(&files_url, &token).await?;
    if !files_resp.status().is_success() {
        return Err(format!(
            "[github_deep] Failed to fetch PR files: HTTP {}",
            files_resp.status()
        ));
    }
    let files: Vec<GhFile> = files_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PR files: {e}"))?;

    // Build a compact diff summary for the LLM (cap at ~8 KB to stay within context)
    let mut diff_text = format!(
        "PR #{pr_number}: {}\nBranch: {} → {}\n\n",
        pr.title,
        pr.head.ref_name,
        pr.base.ref_name
    );
    let mut total_chars = diff_text.len();
    const MAX_DIFF_CHARS: usize = 8_000;

    for file in &files {
        let entry = format!(
            "--- {}\n+{} -{} ({})\n{}\n",
            file.filename,
            file.additions,
            file.deletions,
            file.status,
            file.patch.as_deref().unwrap_or("(binary or no diff)")
        );
        if total_chars + entry.len() > MAX_DIFF_CHARS {
            diff_text.push_str("... (diff truncated)\n");
            break;
        }
        diff_text.push_str(&entry);
        total_chars += entry.len();
    }

    // Optionally inject the user's coding style wiki
    let config = crate::config::load_config();
    let style_context = crate::git_style::style_context_for_repo(
        &config.blade_source_path,
    );

    let system_prompt = format!(
        "You are an expert code reviewer. Review the GitHub pull request diff below.\n\
         Categorise any findings into four categories: BUG_RISK, STYLE, PERFORMANCE, SECURITY.\n\
         Format your response as:\n\
         VERDICT: APPROVE | REQUEST_CHANGES | COMMENT\n\
         CATEGORIES: comma-separated list (e.g. STYLE, PERFORMANCE)\n\
         BODY:\n<markdown review body with inline code snippets where relevant>\n\n\
         Be concise and actionable. If there are no issues, say so briefly.\n\
         {style_context}"
    );

    let review_text = llm_call(&system_prompt, &diff_text).await?;

    // --- Parse LLM output -------------------------------------------------------
    let verdict = if review_text.contains("VERDICT: APPROVE") {
        "APPROVE"
    } else if review_text.contains("VERDICT: REQUEST_CHANGES") {
        "REQUEST_CHANGES"
    } else {
        "COMMENT"
    }
    .to_string();

    let categories: Vec<String> = {
        let line = review_text
            .lines()
            .find(|l| l.starts_with("CATEGORIES:"))
            .unwrap_or("CATEGORIES:");
        line.trim_start_matches("CATEGORIES:")
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    };

    // Extract the body section (everything after "BODY:")
    let body = review_text
        .split_once("BODY:")
        .map(|(_, b)| b.trim().to_string())
        .unwrap_or_else(|| review_text.clone());

    // --- Post review to GitHub --------------------------------------------------
    let review_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
    );
    let payload = serde_json::json!({
        "body": body,
        "event": verdict,
        "comments": []
    });

    let post_resp = gh_post(&review_url, &token, payload).await?;
    let github_review_id: Option<u64> = if post_resp.status().is_success() {
        post_resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("id").and_then(|id| id.as_u64()))
    } else {
        let status = post_resp.status();
        log::warn!(
            "[github_deep] Failed to post review for PR #{pr_number}: HTTP {status}"
        );
        None
    };

    Ok(PrReview {
        pr_number,
        github_review_id,
        body,
        categories,
        verdict,
    })
}

// ── 2. Issue Triage ───────────────────────────────────────────────────────────

/// Triage all open issues that currently have no labels.
///
/// For each issue:
///   1. LLM classifies it as bug / feature / question / duplicate.
///   2. The corresponding label is applied (created if it doesn't exist).
///   3. Duplicates are detected by comparing title+body against ALL open issues.
///   4. Issues with no activity for 90+ days are closed with a polite message.
pub async fn triage_issues(
    owner: &str,
    repo: &str,
) -> Result<Vec<TriagedIssue>, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    // --- Fetch ALL open issues (for duplicate detection) -----------------------
    let all_issues_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=100"
    );
    let all_resp = gh_get(&all_issues_url, &token).await?;
    if !all_resp.status().is_success() {
        return Err(format!(
            "[github_deep] Failed to fetch issues: HTTP {}",
            all_resp.status()
        ));
    }
    let all_issues: Vec<GhIssue> = all_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse issues: {e}"))?;

    // Filter out PRs (GitHub returns PRs in the issues list)
    let real_issues: Vec<&GhIssue> = all_issues
        .iter()
        .filter(|i| i.pull_request.is_none())
        .collect();

    // The unlabelled subset is what we actively triage
    let unlabelled: Vec<&GhIssue> = real_issues
        .iter()
        .copied()
        .filter(|i| i.labels.is_empty())
        .collect();

    // Build a summary corpus of all issues for duplicate detection
    let corpus: Vec<(u32, String)> = real_issues
        .iter()
        .map(|i| {
            (
                i.number,
                format!(
                    "#{}: {}",
                    i.number,
                    crate::safe_slice(&i.title, 120)
                ),
            )
        })
        .collect();

    let mut results = Vec::new();
    let now_timestamp = chrono::Utc::now();

    for issue in unlabelled {
        let body_text = issue.body.as_deref().unwrap_or("").trim().to_string();
        let age_days = {
            // Parse ISO 8601 updated_at
            chrono::DateTime::parse_from_rfc3339(&issue.updated_at)
                .map(|dt| {
                    now_timestamp
                        .signed_duration_since(dt)
                        .num_days()
                })
                .unwrap_or(0)
        };

        // --- Stale check (90+ days without activity) ---------------------------
        if age_days >= 90 {
            let stale_comment = format!(
                "This issue has been inactive for {age_days} days. \
                 Closing as stale — if it's still relevant, please reopen \
                 with updated details. Thank you for your contribution!"
            );
            let comment_url = format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{}/comments",
                issue.number
            );
            let _ = gh_post(
                &comment_url,
                &token,
                serde_json::json!({ "body": stale_comment }),
            )
            .await;

            let close_url = format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{}",
                issue.number
            );
            let _ = gh_client()
                .patch(&close_url)
                .header("Authorization", format!("Bearer {token}"))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "BLADE-Hive/1.0")
                .json(&serde_json::json!({ "state": "closed", "state_reason": "not_planned" }))
                .send()
                .await
                .ok();

            results.push(TriagedIssue {
                number: issue.number,
                title: issue.title.clone(),
                classification: "stale".to_string(),
                labels_applied: vec!["stale".to_string()],
                duplicate_of: None,
                closed_as_stale: true,
            });
            continue;
        }

        // --- LLM classification ------------------------------------------------
        let corpus_str = corpus
            .iter()
            .filter(|(n, _)| *n != issue.number)
            .map(|(_, s)| s.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let system = "You are a GitHub issue triage assistant. \
                      Classify the issue as exactly one of: bug, feature, question, duplicate. \
                      If duplicate, state which issue number it duplicates (e.g. 'duplicate of #42'). \
                      Reply in this exact format:\n\
                      CLASSIFICATION: <bug|feature|question|duplicate>\n\
                      REASON: <one sentence>\n\
                      DUPLICATE_OF: <number or none>";

        let user = format!(
            "Title: {}\nBody: {}\n\nExisting open issues for duplicate check:\n{corpus_str}",
            issue.title,
            crate::safe_slice(&body_text, 600)
        );

        let classification_raw = llm_call(system, &user).await.unwrap_or_default();

        let classification = {
            let line = classification_raw
                .lines()
                .find(|l| l.starts_with("CLASSIFICATION:"))
                .unwrap_or("CLASSIFICATION: question");
            let raw = line
                .trim_start_matches("CLASSIFICATION:")
                .trim()
                .to_lowercase();
            // Sanitise to known values
            match raw.as_str() {
                "bug" | "feature" | "question" | "duplicate" => raw,
                _ => "question".to_string(),
            }
        };

        let duplicate_of: Option<u32> = if classification == "duplicate" {
            classification_raw
                .lines()
                .find(|l| l.starts_with("DUPLICATE_OF:"))
                .and_then(|l| {
                    l.trim_start_matches("DUPLICATE_OF:")
                        .trim()
                        .trim_start_matches('#')
                        .parse::<u32>()
                        .ok()
                })
        } else {
            None
        };

        // --- Map classification to GitHub label --------------------------------
        let label = match classification.as_str() {
            "bug" => "bug",
            "feature" => "enhancement",
            "question" => "question",
            "duplicate" => "duplicate",
            _ => "needs-triage",
        };

        // Apply label
        let label_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/issues/{}/labels",
            issue.number
        );
        let label_resp = gh_post(
            &label_url,
            &token,
            serde_json::json!({ "labels": [label] }),
        )
        .await;

        let labels_applied = match label_resp {
            Ok(r) if r.status().is_success() => vec![label.to_string()],
            Ok(r) => {
                log::warn!(
                    "[github_deep] Could not apply label '{label}' to #{}: HTTP {}",
                    issue.number,
                    r.status()
                );
                vec![]
            }
            Err(e) => {
                log::warn!("[github_deep] Label POST error: {e}");
                vec![]
            }
        };

        // If duplicate — add a comment pointing to the original
        if let Some(orig) = duplicate_of {
            let dup_comment = format!(
                "This appears to be a duplicate of #{orig}. \
                 Marking as duplicate — please continue the discussion there."
            );
            let comment_url = format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{}/comments",
                issue.number
            );
            let _ = gh_post(
                &comment_url,
                &token,
                serde_json::json!({ "body": dup_comment }),
            )
            .await;
        }

        results.push(TriagedIssue {
            number: issue.number,
            title: issue.title.clone(),
            classification,
            labels_applied,
            duplicate_of,
            closed_as_stale: false,
        });
    }

    Ok(results)
}

// ── 3. Release Management ─────────────────────────────────────────────────────

/// Draft a GitHub release with an LLM-generated changelog.
///
/// Fetches commits since the last tag and groups them into Features, Fixes,
/// and Breaking Changes. Returns the URL of the created draft release.
pub async fn draft_release(
    owner: &str,
    repo: &str,
    tag: &str,
) -> Result<String, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    // --- Find the previous release tag -----------------------------------------
    let releases_url =
        format!("https://api.github.com/repos/{owner}/{repo}/releases?per_page=10");
    let releases_resp = gh_get(&releases_url, &token).await?;
    let releases: Vec<GhRelease> = if releases_resp.status().is_success() {
        releases_resp
            .json()
            .await
            .unwrap_or_default()
    } else {
        vec![]
    };

    let last_tag = releases
        .first()
        .map(|r| r.tag_name.clone())
        .unwrap_or_else(|| "HEAD~50".to_string()); // fallback: last 50 commits

    // --- Fetch commits since last tag ------------------------------------------
    let compare_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/compare/{last_tag}...HEAD"
    );
    let compare_resp = gh_get(&compare_url, &token).await?;
    if !compare_resp.status().is_success() {
        return Err(format!(
            "[github_deep] Failed to compare {last_tag}...HEAD: HTTP {}",
            compare_resp.status()
        ));
    }
    let compare: GhCompareResponse = compare_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse compare response: {e}"))?;

    if compare.commits.is_empty() {
        return Err(format!(
            "[github_deep] No commits between {last_tag} and HEAD — nothing to release."
        ));
    }

    // Build commit list (cap at 100 commits)
    let commit_lines: Vec<String> = compare
        .commits
        .iter()
        .take(100)
        .map(|c| {
            format!(
                "- {} ({})",
                crate::safe_slice(c.commit.message.lines().next().unwrap_or(""), 120),
                &c.sha[..8]
            )
        })
        .collect();
    let commits_text = commit_lines.join("\n");

    // --- LLM changelog generation ----------------------------------------------
    let system = "You are a technical writer generating a GitHub release changelog. \
                  Given a list of commits, produce a clean changelog grouped into exactly \
                  three sections: ## Features, ## Fixes, ## Breaking Changes. \
                  If a section has no entries, write 'No changes in this release.' under it. \
                  Use bullet points. Keep each bullet under 80 characters. \
                  Do not include commit SHAs in the output. \
                  Start directly with the ## Features heading — no preamble.";

    let user = format!(
        "Repository: {owner}/{repo}\nNew tag: {tag}\nPrevious tag: {last_tag}\n\nCommits:\n{commits_text}"
    );

    let changelog = llm_call(system, &user).await?;

    // --- Create draft release on GitHub ----------------------------------------
    let release_url =
        format!("https://api.github.com/repos/{owner}/{repo}/releases");
    let payload = serde_json::json!({
        "tag_name": tag,
        "name": format!("{tag}"),
        "body": changelog,
        "draft": true,
        "prerelease": false
    });

    let create_resp = gh_post(&release_url, &token, payload).await?;
    if !create_resp.status().is_success() {
        let status = create_resp.status();
        let body = create_resp.text().await.unwrap_or_default();
        return Err(format!(
            "[github_deep] Failed to create draft release: HTTP {status} — {body}"
        ));
    }

    let release_json: serde_json::Value = create_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse release response: {e}"))?;

    let html_url = release_json
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("(URL unavailable)")
        .to_string();

    Ok(html_url)
}

// ── 4. Dependabot Auto-merge ──────────────────────────────────────────────────

/// Auto-approve and merge open Dependabot PRs that are safe to merge.
///
/// Criteria for merging:
///   - PR author login starts with "dependabot"
///   - Not a draft
///   - `mergeable` is true (no conflicts)
///   - All check runs have concluded with "success" or "neutral" or "skipped"
///
/// Returns the number of PRs successfully merged.
pub async fn auto_merge_dependabot(
    owner: &str,
    repo: &str,
) -> Result<u32, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    // List open PRs
    let pulls_url =
        format!("https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page=100");
    let pulls_resp = gh_get(&pulls_url, &token).await?;
    if !pulls_resp.status().is_success() {
        return Err(format!(
            "[github_deep] Failed to list PRs: HTTP {}",
            pulls_resp.status()
        ));
    }
    let pulls: Vec<GhPull> = pulls_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PRs: {e}"))?;

    let dependabot_prs: Vec<&GhPull> = pulls
        .iter()
        .filter(|p| {
            p.user.login.starts_with("dependabot")
                && !p.draft
                && p.mergeable.unwrap_or(false)
        })
        .collect();

    let mut merged = 0u32;

    for pr in dependabot_prs {
        // Verify checks
        let checks_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/commits/{}/check-runs",
            pr.head.sha
        );
        let checks_resp = gh_get(&checks_url, &token).await;
        let all_clear = match checks_resp {
            Ok(r) if r.status().is_success() => {
                let data: Result<GhCheckRunsResponse, _> = r.json().await;
                match data {
                    Ok(cr) => {
                        if cr.check_runs.is_empty() {
                            // No checks — treat as clear (common for small dep bumps)
                            true
                        } else {
                            cr.check_runs.iter().all(|c| {
                                c.status == "completed"
                                    && matches!(
                                        c.conclusion.as_deref(),
                                        Some("success") | Some("neutral") | Some("skipped")
                                    )
                            })
                        }
                    }
                    Err(_) => false,
                }
            }
            _ => false,
        };

        if !all_clear {
            log::info!(
                "[github_deep] Skipping dependabot PR #{} — checks not all passing",
                pr.number
            );
            continue;
        }

        // Approve first
        let reviews_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/pulls/{}/reviews",
            pr.number
        );
        let approve_resp = gh_post(
            &reviews_url,
            &token,
            serde_json::json!({
                "body": "BLADE auto-approving: all checks pass, Dependabot dependency update.",
                "event": "APPROVE"
            }),
        )
        .await;

        if let Ok(r) = approve_resp {
            if !r.status().is_success() {
                log::warn!(
                    "[github_deep] Failed to approve PR #{}: HTTP {}",
                    pr.number,
                    r.status()
                );
                continue;
            }
        }

        // Merge
        let merge_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/pulls/{}/merge",
            pr.number
        );
        let merge_resp = gh_put(
            &merge_url,
            &token,
            serde_json::json!({
                "commit_title": format!("chore(deps): merge dependabot PR #{}", pr.number),
                "merge_method": "squash"
            }),
        )
        .await?;

        if merge_resp.status().is_success() {
            log::info!(
                "[github_deep] Merged dependabot PR #{} in {owner}/{repo}",
                pr.number
            );
            merged += 1;
        } else {
            log::warn!(
                "[github_deep] Failed to merge PR #{}: HTTP {}",
                pr.number,
                merge_resp.status()
            );
        }
    }

    Ok(merged)
}

// ── 5. Community Health ───────────────────────────────────────────────────────

/// Generate a community health report for a repository.
///
/// Collects: stars/forks, open issues, average first-response time on issues,
/// active vs churned contributors. The LLM generates a plain-English weekly
/// health summary from all the numbers.
pub async fn check_community_health(owner: &str, repo: &str) -> CommunityReport {
    let token = github_token();
    let mut report = CommunityReport {
        owner: owner.to_string(),
        repo: repo.to_string(),
        stars: 0,
        forks: 0,
        open_issues: 0,
        avg_response_hours: 0.0,
        active_contributors: vec![],
        churned_contributors: vec![],
        summary: String::new(),
    };

    if token.is_empty() {
        report.summary = "No GitHub token configured — cannot generate health report.".to_string();
        return report;
    }

    // --- Basic repo stats -------------------------------------------------------
    let repo_url = format!("https://api.github.com/repos/{owner}/{repo}");
    if let Ok(resp) = gh_get(&repo_url, &token).await {
        if let Ok(r) = resp.json::<GhRepo>().await {
            report.stars = r.stargazers_count;
            report.forks = r.forks_count;
            report.open_issues = r.open_issues_count;
        }
    }

    // --- Recent issues (last 30 days) for response-time analysis ---------------
    let issues_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/issues?state=all&per_page=50&sort=created&direction=desc"
    );
    let issues: Vec<GhIssue> = if let Ok(resp) = gh_get(&issues_url, &token).await {
        resp.json().await.unwrap_or_default()
    } else {
        vec![]
    };

    // Estimate average response time (created_at vs first comment).
    // We approximate using (updated_at - created_at) for issues that have been
    // touched, since fetching individual issue timelines would cost N API calls.
    let mut response_hours: Vec<f64> = Vec::new();
    for issue in &issues {
        if issue.pull_request.is_some() {
            continue;
        }
        if let (Ok(created), Ok(updated)) = (
            chrono::DateTime::parse_from_rfc3339(&issue.created_at),
            chrono::DateTime::parse_from_rfc3339(&issue.updated_at),
        ) {
            let diff_hours = updated
                .signed_duration_since(created)
                .num_minutes() as f64
                / 60.0;
            // Only count if updated quickly (< 7 days) — proxy for a response
            if diff_hours > 0.0 && diff_hours < 168.0 {
                response_hours.push(diff_hours);
            }
        }
    }
    if !response_hours.is_empty() {
        report.avg_response_hours =
            response_hours.iter().sum::<f64>() / response_hours.len() as f64;
    }

    // --- Contributor activity (commits in last 30 vs 30–90 days) ---------------
    let now = chrono::Utc::now();
    let thirty_days_ago = now - chrono::Duration::days(30);
    let ninety_days_ago = now - chrono::Duration::days(90);

    let commits_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/commits?per_page=100&since={}",
        ninety_days_ago.to_rfc3339()
    );

    let commits: Vec<serde_json::Value> =
        if let Ok(resp) = gh_get(&commits_url, &token).await {
            resp.json().await.unwrap_or_default()
        } else {
            vec![]
        };

    let mut recent_authors: HashMap<String, u32> = HashMap::new();
    let mut older_authors: HashMap<String, u32> = HashMap::new();

    for commit in &commits {
        let login = commit
            .get("author")
            .and_then(|a| a.get("login"))
            .and_then(|l| l.as_str())
            .unwrap_or_else(|| {
                commit
                    .get("commit")
                    .and_then(|c| c.get("author"))
                    .and_then(|a| a.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown")
            })
            .to_string();

        let date_str = commit
            .get("commit")
            .and_then(|c| c.get("author"))
            .and_then(|a| a.get("date"))
            .and_then(|d| d.as_str())
            .unwrap_or("");

        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(date_str) {
            if dt > thirty_days_ago {
                *recent_authors.entry(login).or_insert(0) += 1;
            } else {
                *older_authors.entry(login).or_insert(0) += 1;
            }
        }
    }

    report.active_contributors = recent_authors.keys().cloned().collect();
    report.active_contributors.sort();

    report.churned_contributors = older_authors
        .keys()
        .filter(|login| !recent_authors.contains_key(*login))
        .cloned()
        .collect();
    report.churned_contributors.sort();

    // --- LLM health summary ----------------------------------------------------
    let stats_text = format!(
        "Repository: {owner}/{repo}\n\
         Stars: {stars} | Forks: {forks} | Open issues: {open_issues}\n\
         Avg first-response time: {response:.1} hours\n\
         Active contributors (last 30 days): {active}\n\
         Churned contributors (active 30-90 days ago, silent since): {churned}\n",
        stars = report.stars,
        forks = report.forks,
        open_issues = report.open_issues,
        response = report.avg_response_hours,
        active = if report.active_contributors.is_empty() {
            "none".to_string()
        } else {
            report.active_contributors.join(", ")
        },
        churned = if report.churned_contributors.is_empty() {
            "none".to_string()
        } else {
            report.churned_contributors.join(", ")
        },
    );

    let system = "You are a developer-relations analyst. Given repository health metrics, \
                  write a concise weekly health summary in 3-5 bullet points. \
                  Highlight trends (growing/shrinking community, response quality, \
                  contributor retention). Be specific, not generic. \
                  Start with a one-line overall verdict, then the bullets.";

    report.summary = llm_call(system, &stats_text)
        .await
        .unwrap_or_else(|_| stats_text.clone());

    report
}

// ── 6. Smart Reviewer Assignment ─────────────────────────────────────────────

/// Result of smart reviewer assignment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewerAssignment {
    pub pr_number: u32,
    pub recommended: String,
    pub reason: String,
    pub expertise_files: Vec<String>,
    pub open_review_count: u32,
    pub similar_pr_count: u32,
}

/// Pick the best reviewer for a PR based on:
///   - Git blame expertise on the changed files
///   - Open review load (fewest pending reviews)
///   - History of reviewing similar code paths
pub async fn smart_assign_reviewer(
    owner: &str,
    repo: &str,
    pr_number: u32,
) -> Result<ReviewerAssignment, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    // Fetch the PR's changed files
    let files_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
    );
    let files_resp = gh_get(&files_url, &token).await?;
    let files: Vec<GhFile> = files_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PR files: {e}"))?;

    let changed_files: Vec<String> = files.iter().map(|f| f.filename.clone()).collect();

    // For each changed file, fetch git blame stats (contributors via /contributors or commits per file)
    // We approximate via commits-per-path
    let mut author_file_touches: HashMap<String, u32> = HashMap::new();
    for file in changed_files.iter().take(10) {
        let commits_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/commits?path={file}&per_page=20"
        );
        if let Ok(resp) = gh_get(&commits_url, &token).await {
            if let Ok(commits) = resp.json::<Vec<serde_json::Value>>().await {
                for commit in commits {
                    let login = commit
                        .get("author")
                        .and_then(|a| a.get("login"))
                        .and_then(|l| l.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !login.is_empty() {
                        *author_file_touches.entry(login).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    // Fetch open review requests to gauge bandwidth
    // We use the search API: PRs where the user is a requested reviewer
    let open_prs_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls?state=open&per_page=100"
    );
    let open_prs: Vec<serde_json::Value> = if let Ok(resp) = gh_get(&open_prs_url, &token).await {
        resp.json().await.unwrap_or_default()
    } else {
        vec![]
    };

    let mut reviewer_open_reviews: HashMap<String, u32> = HashMap::new();
    for pr in &open_prs {
        if let Some(reviewers) = pr.get("requested_reviewers").and_then(|r| r.as_array()) {
            for reviewer in reviewers {
                let login = reviewer
                    .get("login")
                    .and_then(|l| l.as_str())
                    .unwrap_or("")
                    .to_string();
                if !login.is_empty() {
                    *reviewer_open_reviews.entry(login).or_insert(0) += 1;
                }
            }
        }
    }

    // Fetch PR author to exclude self-review
    let pr_url = format!("https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}");
    let pr_author: String = if let Ok(resp) = gh_get(&pr_url, &token).await {
        resp.json::<GhPull>()
            .await
            .map(|p| p.user.login)
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Fetch closed PR reviews to find who has reviewed similar code paths before.
    // We look at the last 50 merged PRs and record who reviewed PRs that touched
    // the same directories as this one.
    let changed_dirs: std::collections::HashSet<String> = changed_files
        .iter()
        .filter_map(|f| std::path::Path::new(f).parent().and_then(|p| p.to_str()).map(|s| s.to_string()))
        .collect();

    let mut prior_reviewer_score: HashMap<String, u32> = HashMap::new();
    let closed_prs_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls?state=closed&per_page=50"
    );
    if let Ok(resp) = gh_get(&closed_prs_url, &token).await {
        if let Ok(closed_prs) = resp.json::<Vec<serde_json::Value>>().await {
            for closed_pr in &closed_prs {
                let pr_num = closed_pr.get("number").and_then(|n| n.as_u64()).unwrap_or(0);
                if pr_num == 0 { continue; }

                // Fetch files for this closed PR
                let cf_url = format!(
                    "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_num}/files"
                );
                let cf_files: Vec<GhFile> = if let Ok(r) = gh_get(&cf_url, &token).await {
                    r.json().await.unwrap_or_default()
                } else {
                    continue
                };

                // Check if any of its files share a directory with our PR
                let pr_dirs: std::collections::HashSet<String> = cf_files
                    .iter()
                    .filter_map(|f| std::path::Path::new(&f.filename).parent().and_then(|p| p.to_str()).map(|s| s.to_string()))
                    .collect();

                if pr_dirs.is_disjoint(&changed_dirs) {
                    continue; // no overlap
                }

                // Count reviewers who approved or commented on this closed PR
                let reviews_url = format!(
                    "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_num}/reviews"
                );
                if let Ok(r) = gh_get(&reviews_url, &token).await {
                    if let Ok(reviews) = r.json::<Vec<serde_json::Value>>().await {
                        for review in &reviews {
                            let login = review
                                .get("user")
                                .and_then(|u| u.get("login"))
                                .and_then(|l| l.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !login.is_empty() && login != pr_author {
                                *prior_reviewer_score.entry(login).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // Score: expertise_touches * 2 + prior_similar_reviews * 1 - open_reviews * 1
    // Higher is better
    let mut candidates: Vec<(String, i64)> = author_file_touches
        .iter()
        .filter(|(login, _)| *login != &pr_author && !login.starts_with("dependabot"))
        .map(|(login, &touches)| {
            let load = *reviewer_open_reviews.get(login).unwrap_or(&0) as i64;
            let prior = *prior_reviewer_score.get(login).unwrap_or(&0) as i64;
            let score = (touches as i64) * 2 + prior - load;
            (login.clone(), score)
        })
        .collect();

    // Also consider reviewers from prior reviews who didn't commit to the files directly
    for (login, &prior) in &prior_reviewer_score {
        if login == &pr_author || login.starts_with("dependabot") {
            continue;
        }
        if candidates.iter().any(|(l, _)| l == login) {
            continue; // already scored above
        }
        let load = *reviewer_open_reviews.get(login).unwrap_or(&0) as i64;
        candidates.push((login.clone(), prior as i64 - load));
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    let best = candidates.first().cloned().unwrap_or_else(|| ("(no candidates found)".to_string(), 0));
    let open_count = *reviewer_open_reviews.get(&best.0).unwrap_or(&0);
    let expertise_count = *author_file_touches.get(&best.0).unwrap_or(&0);

    // Ask LLM to generate a human-friendly reason
    let prior_reviews = *prior_reviewer_score.get(&best.0).unwrap_or(&0);
    let reason_prompt = format!(
        "In one sentence, explain why {} is the best reviewer for PR #{} in {}/{} \
         given they have touched {} of the changed files, reviewed {} similar PRs before, \
         and currently have {} open review requests pending.",
        best.0, pr_number, owner, repo, expertise_count, prior_reviews, open_count
    );
    let reason = llm_call(
        "You are a concise engineering manager.",
        &reason_prompt,
    )
    .await
    .unwrap_or_else(|_| format!("{} has the most expertise and bandwidth.", best.0));

    // Assign the reviewer via GitHub API
    let assign_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/requested_reviewers"
    );
    let _ = gh_post(
        &assign_url,
        &token,
        serde_json::json!({ "reviewers": [best.0] }),
    )
    .await;

    Ok(ReviewerAssignment {
        pr_number,
        recommended: best.0,
        reason,
        expertise_files: changed_files,
        open_review_count: open_count,
        similar_pr_count: prior_reviews,
    })
}

// ── 7. Breaking Change Detection ─────────────────────────────────────────────

/// A detected breaking change in a PR diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakingChange {
    pub kind: String,   // "removed_function" | "changed_signature" | "db_schema" | "deleted_import"
    pub file: String,
    pub description: String,
    pub severity: String, // "critical" | "high" | "medium"
}

/// Analyse a PR diff for breaking changes:
///   - Removed public functions / methods
///   - Changed API signatures (function parameter changes)
///   - Modified database schemas (ALTER TABLE / DROP COLUMN)
///   - Deleted files that other files import
pub async fn detect_breaking_changes(
    owner: &str,
    repo: &str,
    pr_number: u32,
) -> Result<Vec<BreakingChange>, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    let files_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
    );
    let files_resp = gh_get(&files_url, &token).await?;
    let files: Vec<GhFile> = files_resp
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PR files: {e}"))?;

    let mut breaking: Vec<BreakingChange> = Vec::new();

    // Heuristic pass — fast, no LLM
    for file in &files {
        let patch = file.patch.as_deref().unwrap_or("");

        // Deleted files that others might import
        if file.status == "removed" {
            breaking.push(BreakingChange {
                kind: "deleted_import".to_string(),
                file: file.filename.clone(),
                description: format!(
                    "`{}` was deleted — any files importing it will break.",
                    file.filename
                ),
                severity: "critical".to_string(),
            });
            continue;
        }

        // Database schema changes
        let patch_lower = patch.to_lowercase();
        let schema_patterns = ["drop table", "drop column", "alter table", "rename column", "rename table"];
        for pat in &schema_patterns {
            if patch_lower.contains(pat) {
                breaking.push(BreakingChange {
                    kind: "db_schema".to_string(),
                    file: file.filename.clone(),
                    description: format!(
                        "Database schema change detected (`{}`) in `{}`.",
                        pat, file.filename
                    ),
                    severity: "critical".to_string(),
                });
            }
        }

        // Removed public functions (lines starting with `-pub fn`, `-pub async fn`, `-export function`, etc.)
        for line in patch.lines() {
            let trimmed = line.trim_start_matches('-');
            let is_removal = line.starts_with('-') && !line.starts_with("---");
            if !is_removal {
                continue;
            }
            let tl = trimmed.trim();
            if (tl.starts_with("pub fn ")
                || tl.starts_with("pub async fn ")
                || tl.starts_with("export function ")
                || tl.starts_with("export default function ")
                || tl.starts_with("export const "))
                && !tl.contains("//")
            {
                let fn_name = tl
                    .split_whitespace()
                    .skip_while(|w| !w.contains("fn") && !w.contains("function") && !w.contains("const"))
                    .nth(1)
                    .unwrap_or("unknown")
                    .trim_end_matches('(')
                    .to_string();

                breaking.push(BreakingChange {
                    kind: "removed_function".to_string(),
                    file: file.filename.clone(),
                    description: format!(
                        "Public function/export `{}` was removed from `{}`.",
                        fn_name, file.filename
                    ),
                    severity: "high".to_string(),
                });
            }
        }
    }

    // LLM deep-pass on the full diff for signature changes
    let diff_text: String = files
        .iter()
        .map(|f| {
            format!(
                "// {}\n{}",
                f.filename,
                f.patch.as_deref().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    if !diff_text.trim().is_empty() {
        let system = "You are a breaking-change detector. Analyse this pull request diff for API changes.\n\
                      Look for: changed function signatures (added/removed/retyped parameters), \
                      renamed exports, modified interface/struct fields, changed return types.\n\
                      For each breaking change output exactly:\n\
                      FILE: <filename>\n\
                      KIND: changed_signature\n\
                      DESCRIPTION: <one sentence>\n\
                      SEVERITY: critical|high|medium\n\
                      ---\n\
                      If no signature changes, output: NONE";

        let llm_resp = llm_call(system, &crate::safe_slice(&diff_text, 6000))
            .await
            .unwrap_or_default();

        if !llm_resp.trim().eq_ignore_ascii_case("none") {
            for block in llm_resp.split("---") {
                let file = extract_field(block, "FILE");
                let kind = extract_field(block, "KIND");
                let description = extract_field(block, "DESCRIPTION");
                let severity = extract_field(block, "SEVERITY");
                if !file.is_empty() && !description.is_empty() {
                    breaking.push(BreakingChange {
                        kind: if kind.is_empty() { "changed_signature".to_string() } else { kind },
                        file,
                        description,
                        severity: if severity.is_empty() { "medium".to_string() } else { severity },
                    });
                }
            }
        }
    }

    Ok(breaking)
}

fn extract_field(block: &str, field: &str) -> String {
    block
        .lines()
        .find(|l| l.trim().starts_with(&format!("{field}:")))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

// ── 8. Smart PR Review (enhanced) ────────────────────────────────────────────

/// Enhanced PR review that includes: repo coding conventions, recent commit
/// patterns, and context about whether the PR author is a first-time contributor.
pub async fn smart_review_pr(
    owner: &str,
    repo: &str,
    pr_number: u32,
) -> Result<PrReview, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    // Fetch PR metadata
    let pr_url = format!("https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}");
    let pr: GhPull = gh_get(&pr_url, &token)
        .await?
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PR: {e}"))?;

    // Fetch PR files
    let files_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files"
    );
    let files: Vec<GhFile> = gh_get(&files_url, &token)
        .await?
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse PR files: {e}"))?;

    // Check if author is a first-time contributor
    let author = &pr.user.login;
    let contrib_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/commits?author={author}&per_page=5"
    );
    let author_commits: Vec<serde_json::Value> =
        if let Ok(resp) = gh_get(&contrib_url, &token).await {
            resp.json().await.unwrap_or_default()
        } else {
            vec![]
        };
    let is_first_time = author_commits.is_empty();

    // Fetch recent commits for pattern context
    let recent_commits_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/commits?per_page=10"
    );
    let recent_commits: Vec<serde_json::Value> =
        if let Ok(resp) = gh_get(&recent_commits_url, &token).await {
            resp.json().await.unwrap_or_default()
        } else {
            vec![]
        };
    let recent_commit_msgs: Vec<String> = recent_commits
        .iter()
        .filter_map(|c| {
            c.get("commit")
                .and_then(|commit| commit.get("message"))
                .and_then(|m| m.as_str())
                .map(|m| m.lines().next().unwrap_or("").to_string())
        })
        .collect();

    // Coding conventions from git_style
    let config = crate::config::load_config();
    let style_context = crate::git_style::style_context_for_repo(&config.blade_source_path);

    // Build diff text
    let mut diff_text = format!(
        "PR #{pr_number}: {}\nBranch: {} → {}\nAuthor: {}{}\n\n",
        pr.title,
        pr.head.ref_name,
        pr.base.ref_name,
        author,
        if is_first_time { " (FIRST-TIME CONTRIBUTOR)" } else { "" }
    );
    let mut total_chars = diff_text.len();
    const MAX_DIFF_CHARS: usize = 7_000;

    for file in &files {
        let entry = format!(
            "--- {}\n+{} -{} ({})\n{}\n",
            file.filename,
            file.additions,
            file.deletions,
            file.status,
            file.patch.as_deref().unwrap_or("(binary or no diff)")
        );
        if total_chars + entry.len() > MAX_DIFF_CHARS {
            diff_text.push_str("... (diff truncated)\n");
            break;
        }
        diff_text.push_str(&entry);
        total_chars += entry.len();
    }

    let first_time_guidance = if is_first_time {
        "\nNOTE: This is a FIRST-TIME contributor. Be welcoming and educational in your \
         review. Explain the 'why' behind requests, not just the 'what'. Thank them \
         for contributing."
    } else {
        ""
    };

    let recent_patterns = if !recent_commit_msgs.is_empty() {
        format!(
            "\nRecent commit message patterns in this repo:\n{}",
            recent_commit_msgs.iter().take(5).map(|m| format!("  - {m}")).collect::<Vec<_>>().join("\n")
        )
    } else {
        String::new()
    };

    let system_prompt = format!(
        "You are an expert code reviewer embedded in this project.\n\
         Categorise findings into: BUG_RISK, STYLE, PERFORMANCE, SECURITY.\n\
         Format your response as:\n\
         VERDICT: APPROVE | REQUEST_CHANGES | COMMENT\n\
         CATEGORIES: comma-separated list\n\
         BODY:\n<markdown review body>\n\n\
         Be concise and actionable. If there are no issues, say so briefly.\n\
         {style_context}{first_time_guidance}{recent_patterns}"
    );

    let review_text = llm_call(&system_prompt, &diff_text).await?;

    let verdict = if review_text.contains("VERDICT: APPROVE") {
        "APPROVE"
    } else if review_text.contains("VERDICT: REQUEST_CHANGES") {
        "REQUEST_CHANGES"
    } else {
        "COMMENT"
    }
    .to_string();

    let categories: Vec<String> = {
        let line = review_text
            .lines()
            .find(|l| l.starts_with("CATEGORIES:"))
            .unwrap_or("CATEGORIES:");
        line.trim_start_matches("CATEGORIES:")
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    };

    let body = review_text
        .split_once("BODY:")
        .map(|(_, b)| b.trim().to_string())
        .unwrap_or_else(|| review_text.clone());

    // Post review to GitHub
    let review_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
    );
    let payload = serde_json::json!({
        "body": body,
        "event": verdict,
        "comments": []
    });
    let post_resp = gh_post(&review_url, &token, payload).await?;
    let github_review_id: Option<u64> = if post_resp.status().is_success() {
        post_resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("id").and_then(|id| id.as_u64()))
    } else {
        log::warn!(
            "[github_deep] Failed to post smart review for PR #{pr_number}: HTTP {}",
            post_resp.status()
        );
        None
    };

    Ok(PrReview {
        pr_number,
        github_review_id,
        body,
        categories,
        verdict,
    })
}

// ── 9. Smart Issue Triage (reporter history aware) ────────────────────────────

/// Triage issues with awareness of reporter history:
/// serial reporters (many open issues) get a different response than one-off reporters.
pub async fn smart_triage_issues(
    owner: &str,
    repo: &str,
) -> Result<Vec<TriagedIssue>, String> {
    let token = github_token();
    if token.is_empty() {
        return Err("[github_deep] No GitHub token configured.".to_string());
    }

    // Fetch all open issues
    let all_issues_url = format!(
        "https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=100"
    );
    let all_issues: Vec<GhIssue> = gh_get(&all_issues_url, &token)
        .await?
        .json()
        .await
        .map_err(|e| format!("[github_deep] Failed to parse issues: {e}"))?;

    let real_issues: Vec<&GhIssue> = all_issues
        .iter()
        .filter(|i| i.pull_request.is_none())
        .collect();

    let unlabelled: Vec<&GhIssue> = real_issues
        .iter()
        .copied()
        .filter(|i| i.labels.is_empty())
        .collect();

    // Count open issues per reporter to detect serial reporters
    let mut reporter_issue_counts: HashMap<String, u32> = HashMap::new();
    for issue in &real_issues {
        *reporter_issue_counts
            .entry(issue.user.login.clone())
            .or_insert(0) += 1;
    }

    let corpus: Vec<(u32, String)> = real_issues
        .iter()
        .map(|i| (i.number, format!("#{}: {}", i.number, crate::safe_slice(&i.title, 120))))
        .collect();

    let mut results = Vec::new();
    let now_timestamp = chrono::Utc::now();

    for issue in unlabelled {
        let body_text = issue.body.as_deref().unwrap_or("").trim().to_string();
        let age_days = chrono::DateTime::parse_from_rfc3339(&issue.updated_at)
            .map(|dt| now_timestamp.signed_duration_since(dt).num_days())
            .unwrap_or(0);

        if age_days >= 90 {
            let stale_comment = format!(
                "This issue has been inactive for {age_days} days. \
                 Closing as stale — if it's still relevant, please reopen with updated details."
            );
            let comment_url = format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{}/comments",
                issue.number
            );
            let _ = gh_post(&comment_url, &token, serde_json::json!({ "body": stale_comment })).await;
            let close_url = format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{}",
                issue.number
            );
            let _ = gh_client()
                .patch(&close_url)
                .header("Authorization", format!("Bearer {token}"))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "BLADE-Hive/1.0")
                .json(&serde_json::json!({ "state": "closed", "state_reason": "not_planned" }))
                .send()
                .await
                .ok();
            results.push(TriagedIssue {
                number: issue.number,
                title: issue.title.clone(),
                classification: "stale".to_string(),
                labels_applied: vec!["stale".to_string()],
                duplicate_of: None,
                closed_as_stale: true,
            });
            continue;
        }

        let reporter = &issue.user.login;
        let reporter_count = *reporter_issue_counts.get(reporter).unwrap_or(&1);
        let is_serial_reporter = reporter_count >= 3;

        let corpus_str = corpus
            .iter()
            .filter(|(n, _)| *n != issue.number)
            .map(|(_, s)| s.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let reporter_context = if is_serial_reporter {
            format!(
                "\nReporter context: @{reporter} has {reporter_count} open issues in this repo \
                 (serial reporter). Consider whether this issue is a duplicate or part of a \
                 broader theme — suggest linking related issues in your response."
            )
        } else {
            format!(
                "\nReporter context: @{reporter} is a one-off reporter. \
                 Be welcoming and ask for any missing reproduction steps."
            )
        };

        let system = format!(
            "You are a GitHub issue triage assistant. \
             Classify the issue as exactly one of: bug, feature, question, duplicate. \
             If duplicate, state which issue number it duplicates (e.g. 'duplicate of #42'). \
             Reply in this exact format:\n\
             CLASSIFICATION: <bug|feature|question|duplicate>\n\
             REASON: <one sentence>\n\
             DUPLICATE_OF: <number or none>{reporter_context}"
        );

        let user = format!(
            "Title: {}\nBody: {}\n\nExisting open issues:\n{corpus_str}",
            issue.title,
            crate::safe_slice(&body_text, 600)
        );

        let classification_raw = llm_call(&system, &user).await.unwrap_or_default();

        let classification = {
            let line = classification_raw
                .lines()
                .find(|l| l.starts_with("CLASSIFICATION:"))
                .unwrap_or("CLASSIFICATION: question");
            let raw = line.trim_start_matches("CLASSIFICATION:").trim().to_lowercase();
            match raw.as_str() {
                "bug" | "feature" | "question" | "duplicate" => raw,
                _ => "question".to_string(),
            }
        };

        let duplicate_of: Option<u32> = if classification == "duplicate" {
            classification_raw
                .lines()
                .find(|l| l.starts_with("DUPLICATE_OF:"))
                .and_then(|l| {
                    l.trim_start_matches("DUPLICATE_OF:")
                        .trim()
                        .trim_start_matches('#')
                        .parse::<u32>()
                        .ok()
                })
        } else {
            None
        };

        let label = match classification.as_str() {
            "bug" => "bug",
            "feature" => "enhancement",
            "question" => "question",
            "duplicate" => "duplicate",
            _ => "needs-triage",
        };

        let label_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/issues/{}/labels",
            issue.number
        );
        let label_resp = gh_post(&label_url, &token, serde_json::json!({ "labels": [label] })).await;

        let labels_applied = match label_resp {
            Ok(r) if r.status().is_success() => vec![label.to_string()],
            _ => vec![],
        };

        if let Some(orig) = duplicate_of {
            let dup_comment = format!(
                "This appears to be a duplicate of #{orig}. Marking as duplicate."
            );
            let comment_url = format!(
                "https://api.github.com/repos/{owner}/{repo}/issues/{}/comments",
                issue.number
            );
            let _ = gh_post(&comment_url, &token, serde_json::json!({ "body": dup_comment })).await;
        }

        results.push(TriagedIssue {
            number: issue.number,
            title: issue.title.clone(),
            classification,
            labels_applied,
            duplicate_of,
            closed_as_stale: false,
        });
    }

    Ok(results)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Tauri command: review a PR and post the review to GitHub.
#[tauri::command]
pub async fn github_review_pr(
    owner: String,
    repo: String,
    pr_number: u32,
) -> Result<PrReview, String> {
    review_pr(&owner, &repo, pr_number).await
}

/// Tauri command: triage all unlabelled open issues in a repo.
#[tauri::command]
pub async fn github_triage_issues(
    owner: String,
    repo: String,
) -> Result<Vec<TriagedIssue>, String> {
    triage_issues(&owner, &repo).await
}

/// Tauri command: create a draft GitHub release with an LLM changelog.
#[tauri::command]
pub async fn github_draft_release(
    owner: String,
    repo: String,
    tag: String,
) -> Result<String, String> {
    draft_release(&owner, &repo, &tag).await
}

/// Tauri command: auto-merge safe Dependabot PRs.
#[tauri::command]
pub async fn github_auto_merge_dependabot(
    owner: String,
    repo: String,
) -> Result<u32, String> {
    auto_merge_dependabot(&owner, &repo).await
}

/// Tauri command: generate a community health report.
#[tauri::command]
pub async fn github_community_health(
    owner: String,
    repo: String,
) -> CommunityReport {
    check_community_health(&owner, &repo).await
}

/// Tauri command: smart-assign the best reviewer for a PR.
#[tauri::command]
pub async fn github_smart_assign_reviewer(
    owner: String,
    repo: String,
    pr_number: u32,
) -> Result<ReviewerAssignment, String> {
    smart_assign_reviewer(&owner, &repo, pr_number).await
}

/// Tauri command: detect breaking changes in a PR.
#[tauri::command]
pub async fn github_detect_breaking_changes(
    owner: String,
    repo: String,
    pr_number: u32,
) -> Result<Vec<BreakingChange>, String> {
    detect_breaking_changes(&owner, &repo, pr_number).await
}

/// Tauri command: smart PR review with author history + coding conventions.
#[tauri::command]
pub async fn github_smart_review_pr(
    owner: String,
    repo: String,
    pr_number: u32,
) -> Result<PrReview, String> {
    smart_review_pr(&owner, &repo, pr_number).await
}

/// Tauri command: smart issue triage with reporter-history awareness.
#[tauri::command]
pub async fn github_smart_triage_issues(
    owner: String,
    repo: String,
) -> Result<Vec<TriagedIssue>, String> {
    smart_triage_issues(&owner, &repo).await
}
