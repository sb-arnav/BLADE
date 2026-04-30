//! github_outbound.rs — GitHub PR comment + issue create write paths
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-05 (priority-1 native tentacle).
//! Reuses the github_deep.rs::github_token() / gh_post() pattern (l.164-200).
//! Wave 0 skeleton: 2 Tauri commands + return shapes + test stub.
//! Bodies land in Plan 12.

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

/// Create a comment on a GitHub PR. POST /repos/{owner}/{repo}/issues/{pr_number}/comments.
/// Wave 0 skeleton — Plan 12 implements the gh_post body.
#[tauri::command]
pub async fn github_outbound_create_pr_comment(
    _app: AppHandle,
    owner: String,
    repo: String,
    pr_number: u64,
    body: String,
) -> Result<GhCommentResult, String> {
    crate::ecosystem::assert_observe_only_allowed("github", "create_pr_comment")?;
    let _ = (owner, repo, pr_number, body);
    Err("[github_outbound] not yet implemented (Wave 0 skeleton)".to_string())
}

/// Create a GitHub issue. POST /repos/{owner}/{repo}/issues.
/// Wave 0 skeleton — Plan 12 implements the gh_post body.
#[tauri::command]
pub async fn github_outbound_create_issue(
    _app: AppHandle,
    owner: String,
    repo: String,
    title: String,
    body: String,
) -> Result<GhIssueResult, String> {
    crate::ecosystem::assert_observe_only_allowed("github", "create_issue")?;
    let _ = (owner, repo, title, body);
    Err("[github_outbound] not yet implemented (Wave 0 skeleton)".to_string())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn skeleton_returns_not_implemented() {
        // Real tests land in Plan 12:
        //  - create_pr_comment_posts (mocked reqwest)
        //  - create_issue_posts (mocked reqwest)
        //  - hard_fail_on_missing_pat (D-10)
        //  - assert_observe_only_allowed gates the call
    }
}
