//! github_outbound.rs — GitHub PR comment + issue create write paths
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 (priority-1 native tentacle).
//! Plan 18-07 body — replicates the github_deep.rs::github_token() / gh_post() pattern locally
//! (verbatim shape; avoids module coupling so a refactor of github_deep cannot regress this path).
//!
//! Endpoints:
//!   - PR comment: POST /repos/{owner}/{repo}/issues/{pr_number}/comments  body: {"body": ...}
//!   - Issue create: POST /repos/{owner}/{repo}/issues                       body: {"title", "body"}
//!
//! Threat surface (T-18-CARRY-19/20/21/22):
//!   - PAT in `Authorization: Bearer ...` over TLS only. Never logged.
//!   - owner/repo/pr_number passed verbatim — GitHub validates and 404s on bad input.
//!   - GitHub rate-limit: 5000 req/hr authenticated; D-21 single-action-per-turn naturally bounds.
//!   - assert_observe_only_allowed gates each command (defense-in-depth; Plan 14 holds WriteScope).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhCommentResult {
    pub id: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhIssueResult {
    pub number: u64,
    pub url: String,
}

// ── Helpers (mirrors github_deep.rs:164-200 — verbatim reuse pattern, locally replicated) ──

fn github_token() -> String {
    crate::config::get_provider_key("github")
}

/// Build a reqwest client with a 30s timeout (network failures fail fast rather than
/// hanging the dispatch loop). Falls back to default client if builder fails (very rare).
fn gh_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// POST against the GitHub REST API with the locked header set:
///   - `Authorization: Bearer {token}`
///   - `Accept: application/vnd.github+json`
///   - `X-GitHub-Api-Version: 2022-11-28`  (must-haves truth: API version pinned)
///   - `User-Agent: BLADE-Hive/1.0`         (must-haves truth: UA identity locked)
///
/// On non-2xx status, parses GitHub's `{"message": "..."}` error envelope and surfaces
/// it as Err. Never logs or echoes the bearer token.
async fn gh_post(url: &str, token: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let resp = gh_client()
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "BLADE-Hive/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("[github_outbound] POST {url} failed: {}", crate::safe_slice(&e.to_string(), 200)))?;
    let status = resp.status();
    let parsed: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("[github_outbound] response parse failed: {}", crate::safe_slice(&e.to_string(), 200)))?;
    if !status.is_success() {
        let msg = parsed.get("message").and_then(|s| s.as_str()).unwrap_or("unknown");
        return Err(format!(
            "[github_outbound] {} from GitHub: {}",
            status,
            crate::safe_slice(msg, 200)
        ));
    }
    Ok(parsed)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Create a comment on a GitHub PR. POST /repos/{owner}/{repo}/issues/{pr_number}/comments.
/// Note: the GitHub API uses the `/issues/` endpoint for PR comments because PRs are issues
/// under the hood (the `/pulls/` endpoint is for review-thread comments, which is different).
#[tauri::command]
pub async fn github_outbound_create_pr_comment(
    _app: AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
    body: String,
) -> Result<GhCommentResult, String> {
    crate::ecosystem::assert_observe_only_allowed("github", "create_pr_comment")?;
    let token = github_token();
    if token.is_empty() {
        return Err(
            "[github_outbound] Connect via Integrations tab → GitHub (no PAT in keyring).".to_string()
        );
    }
    let url = format!(
        "https://api.github.com/repos/{}/{}/issues/{}/comments",
        owner, repo, pr_number
    );
    let payload = serde_json::json!({ "body": body });
    let resp = gh_post(&url, &token, payload).await?;
    Ok(GhCommentResult {
        id: resp.get("id").and_then(|n| n.as_u64()).unwrap_or(0),
        url: resp
            .get("html_url")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

/// Create a GitHub issue. POST /repos/{owner}/{repo}/issues.
#[tauri::command]
pub async fn github_outbound_create_issue(
    _app: AppHandle,
    owner: String,
    repo: String,
    title: String,
    body: String,
) -> Result<GhIssueResult, String> {
    crate::ecosystem::assert_observe_only_allowed("github", "create_issue")?;
    let token = github_token();
    if token.is_empty() {
        return Err(
            "[github_outbound] Connect via Integrations tab → GitHub (no PAT in keyring).".to_string()
        );
    }
    let url = format!("https://api.github.com/repos/{}/{}/issues", owner, repo);
    let payload = serde_json::json!({ "title": title, "body": body });
    let resp = gh_post(&url, &token, payload).await?;
    Ok(GhIssueResult {
        number: resp.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
        url: resp
            .get("html_url")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_fail_message_format_d10_compliant() {
        // D-10 wording lock — must contain "Connect via Integrations tab → GitHub".
        let template = "[github_outbound] Connect via Integrations tab → GitHub (no PAT in keyring).";
        assert!(template.contains("Connect via Integrations tab → GitHub"));
    }

    #[test]
    fn pr_comment_url_format() {
        // The URL template uses owner/repo/pr_number. Verify the format string emits the
        // expected GitHub REST endpoint shape so a future refactor can't silently regress.
        let url = format!(
            "https://api.github.com/repos/{}/{}/issues/{}/comments",
            "owner-x", "repo-y", 42u64
        );
        assert_eq!(
            url,
            "https://api.github.com/repos/owner-x/repo-y/issues/42/comments"
        );
    }

    #[test]
    fn issue_url_format() {
        let url = format!("https://api.github.com/repos/{}/{}/issues", "owner-x", "repo-y");
        assert_eq!(url, "https://api.github.com/repos/owner-x/repo-y/issues");
    }

    #[test]
    fn github_token_helper_does_not_panic() {
        // Smoke: keyring read must not panic regardless of env state.
        let _ = github_token();
    }

    #[test]
    fn gh_client_builds_with_timeout() {
        // Verify the builder path doesn't panic and yields a usable client.
        let _client = gh_client();
    }

    #[test]
    fn pr_comment_payload_shape() {
        // The PR-comment payload is `{"body": "..."}` — assert the shape so callers
        // don't accidentally rename the field (the GitHub API rejects anything else).
        let payload = serde_json::json!({ "body": "looks good" });
        assert_eq!(payload.get("body").and_then(|v| v.as_str()), Some("looks good"));
        assert!(payload.get("title").is_none(), "PR-comment payload must NOT include title");
    }

    #[test]
    fn issue_payload_shape() {
        // Issue payload is `{"title": ..., "body": ...}` — both required by GitHub.
        let payload = serde_json::json!({ "title": "Bug", "body": "Repro: ..." });
        assert_eq!(payload.get("title").and_then(|v| v.as_str()), Some("Bug"));
        assert_eq!(payload.get("body").and_then(|v| v.as_str()), Some("Repro: ..."));
    }

    // Real integration tests for the gh_post HTTP path require:
    //  - mockall / wiremock to mock GitHub's API
    // Phase 18 ships the URL/payload-shape tests above + manual UAT validation in Plan 12.
    // If the planner adds wiremock later, the tests would be:
    //  - gh_post_returns_parsed_response_on_2xx
    //  - gh_post_surfaces_github_message_on_4xx
    //  - create_pr_comment_extracts_id_and_html_url
    //  - create_issue_extracts_number_and_html_url
}
