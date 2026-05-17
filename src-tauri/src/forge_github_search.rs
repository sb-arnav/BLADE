//! Phase 63 (v2.3) — FORGE-GITHUB-FIRST.
//!
//! Operator surfaced 2026-05-17: "first blade goes and tools for if the tool
//! is available on github right?- it should cause it is easier." Reuse >
//! rewrite. Before forge writes a tool from scratch, query GitHub for an
//! existing MCP server / Tauri command / shell script that matches the
//! capability gap. Only fall back to scratch on miss.
//!
//! This module is the SEARCH + RANK layer. The EVAL (LLM "does this plausibly
//! solve the gap?") and INSTALL (sandbox shell exec) layers are scaffolded
//! with TODOs and land in v2.3.1 polish. The full Phase 63 spec in
//! `.planning/milestones/v2.3-REQUIREMENTS.md` enumerates the surface area.
//!
//! Wired into `tool_forge::pre_check_with_mcp_state` as a new branch that
//! fires BEFORE forge-from-scratch. Returns `Some(GitHubMatch)` on a credible
//! repo hit; returns `None` on miss (graceful fallback — forge proceeds
//! exactly as before).
//!
//! @see `.planning/decisions.md` 2026-05-17 — HARNESS-REBUILD-ON-CLAW position
//! @see `.planning/milestones/v2.3-REQUIREMENTS.md` — Phase 63 full scope
//! @see `src-tauri/src/autonomous_research.rs:198` — existing GitHub search pattern
//!      that this module mirrors (curl + serde_json parse + summary string)

use serde::{Deserialize, Serialize};

/// A candidate GitHub repository that might solve a capability gap.
///
/// Populated from GitHub's `/search/repositories` API. Ranking signal is
/// stars (high-star → more likely maintained + tested), with a recency tie-break
/// from `pushed_at` (recent push → still alive vs abandoned).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepoCandidate {
    pub full_name: String,
    pub description: String,
    pub html_url: String,
    pub stars: u64,
    pub pushed_at: String,
    /// 1-line classification — e.g. "mcp-server", "tauri-plugin", "cli-tool", "unknown".
    /// Heuristic only; the EVAL layer (v2.3.1) re-classifies with an LLM.
    pub kind: RepoKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RepoKind {
    McpServer,
    TauriPlugin,
    CliTool,
    Library,
    Unknown,
}

impl RepoKind {
    fn from_name_and_desc(name: &str, desc: &str) -> Self {
        let blob = format!("{} {}", name.to_lowercase(), desc.to_lowercase());
        if blob.contains("mcp-server") || blob.contains("mcp server") || blob.contains("model context protocol") {
            RepoKind::McpServer
        } else if blob.contains("tauri-plugin") || blob.contains("tauri plugin") {
            RepoKind::TauriPlugin
        } else if blob.contains("cli") || blob.contains("command-line") || blob.contains("command line") {
            RepoKind::CliTool
        } else if blob.contains("library") || blob.contains(" sdk ") || blob.contains("crate") {
            RepoKind::Library
        } else {
            RepoKind::Unknown
        }
    }
}

/// Build the GitHub search query string for a capability gap.
///
/// Heuristic ordering: prefer MCP server matches (BLADE's native tool surface),
/// fall back to a broader capability keyword search. The query is URL-encoded
/// downstream by `urlencoding::encode`.
///
/// For "convert mp4 to GIF" the query is roughly:
///   `mcp-server in:name OR (mp4 GIF in:name,description)`
pub fn build_search_query(capability: &str) -> String {
    let cap_trimmed = capability.trim();
    // Strip obvious noise words — verbs that don't help GitHub search ranking.
    let keywords: Vec<&str> = cap_trimmed
        .split_whitespace()
        .filter(|w| {
            let lower = w.to_lowercase();
            !matches!(
                lower.as_str(),
                "a" | "an" | "the" | "to" | "from" | "into" | "and" | "or" | "of" | "for"
                    | "with" | "my" | "your" | "i" | "me" | "is" | "are" | "was" | "be"
            )
        })
        .collect();
    let keyword_blob = keywords.join(" ");
    format!(
        "{keyword_blob} mcp OR {keyword_blob} cli sort:stars-desc",
        keyword_blob = keyword_blob
    )
}

/// Query GitHub's repository search API for candidates matching the capability.
///
/// Uses the existing `native_tools::run_shell` curl pattern (mirrors
/// `autonomous_research.rs:198`) so this module doesn't introduce a new HTTP
/// client dependency. Public API to allow direct invocation from
/// `tool_forge::pre_check_with_mcp_state` and from tests.
///
/// `per_page` caps the number of candidates returned (default 5). The full
/// Phase 63 spec sets a 24h cache (SHA256 of capability as key); this MVP
/// hits GitHub every call. The 10 req/min unauthenticated rate limit means
/// callers should debounce — `tool_forge::pre_check_with_mcp_state` fires
/// once per forge invocation, well under that ceiling.
pub async fn search_repositories(capability: &str, per_page: u8) -> Vec<RepoCandidate> {
    let q = build_search_query(capability);
    // URL-encode the query — GitHub search API is sensitive to unescaped spaces / colons.
    let encoded = urlencoding::encode(&q);
    let url = format!(
        "https://api.github.com/search/repositories?q={}&per_page={}",
        encoded, per_page
    );
    // Use curl via the shell native tool so we share the same network path as
    // `autonomous_research::research_topic`. --max-time bounds the call so a
    // stalled GitHub doesn't hang the forge loop. The User-Agent header is
    // required by GitHub's API spec for unauthenticated requests.
    let cmd = format!(
        r#"curl -s --max-time 8 -H "Accept: application/vnd.github+json" -H "User-Agent: blade-forge-github" "{}""#,
        url
    );
    let raw = crate::native_tools::run_shell(cmd, None).await.unwrap_or_default();
    parse_candidates_from_json(&raw)
}

/// Parse the GitHub `/search/repositories` JSON response into `RepoCandidate`s.
///
/// Pulled out for unit-testability — `search_repositories` is integration-only
/// (real curl), this function is the deterministic core.
pub fn parse_candidates_from_json(raw: &str) -> Vec<RepoCandidate> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let items = v["items"].as_array().cloned().unwrap_or_default();
    items
        .iter()
        .filter_map(|item| {
            let full_name = item["full_name"].as_str()?.to_string();
            let description = item["description"].as_str().unwrap_or("").to_string();
            let html_url = item["html_url"].as_str()?.to_string();
            let stars = item["stargazers_count"].as_u64().unwrap_or(0);
            let pushed_at = item["pushed_at"].as_str().unwrap_or("").to_string();
            let kind = RepoKind::from_name_and_desc(&full_name, &description);
            Some(RepoCandidate {
                full_name,
                description,
                html_url,
                stars,
                pushed_at,
                kind,
            })
        })
        .collect()
}

/// Result of a Phase 63 GitHub-first probe — what `tool_forge::pre_check_with_mcp_state`
/// should consume.
#[derive(Debug, Clone, PartialEq)]
pub enum GitHubProbeOutcome {
    /// At least one credible MCP server candidate found. The first item is
    /// the highest-ranked (most stars, MCP kind).
    McpServerHit { candidates: Vec<RepoCandidate> },
    /// At least one credible candidate found, but no MCP server — Tauri plugin
    /// or CLI tool. Forge should consider these but with lower confidence.
    OtherKindHit { candidates: Vec<RepoCandidate> },
    /// GitHub search returned zero credible candidates. Forge falls through
    /// to write-from-scratch.
    NoHit,
}

/// High-level entrypoint: search + classify + return the right outcome.
///
/// "Credible" today = stars >= 10 OR description matches the capability
/// keyword substring. The Phase 63 spec's LLM-eval layer (v2.3.1) refines
/// this with a model call; this MVP uses simple heuristics so the integration
/// can land + be observed in real use.
pub async fn probe_github(capability: &str) -> GitHubProbeOutcome {
    let candidates = search_repositories(capability, 5).await;
    if candidates.is_empty() {
        return GitHubProbeOutcome::NoHit;
    }

    let cap_lower = capability.to_lowercase();
    let credible: Vec<RepoCandidate> = candidates
        .into_iter()
        .filter(|c| {
            c.stars >= 10
                || c.description.to_lowercase().contains(&cap_lower)
                || c.full_name.to_lowercase().contains(&cap_lower)
        })
        .collect();

    if credible.is_empty() {
        return GitHubProbeOutcome::NoHit;
    }

    let has_mcp = credible.iter().any(|c| c.kind == RepoKind::McpServer);
    if has_mcp {
        let mut mcp_first: Vec<RepoCandidate> = credible
            .iter()
            .filter(|c| c.kind == RepoKind::McpServer)
            .cloned()
            .collect();
        mcp_first.sort_by(|a, b| b.stars.cmp(&a.stars));
        GitHubProbeOutcome::McpServerHit { candidates: mcp_first }
    } else {
        GitHubProbeOutcome::OtherKindHit { candidates: credible }
    }
}

// TODO(v2.3.1 — Phase 63 polish):
// - evaluate_candidate(candidate, capability, &llm_client) -> EvalVerdict
//   LLM call: "Read this README; does it plausibly solve {capability}?
//   Return {plausible: bool, install_command: Option<String>, confidence: f32}"
// - install_from_readme(candidate, &shell_sandbox) -> InstallOutcome
//   Fetch README → parse install instructions → execute in sandboxed shell
//   → capture stdout/stderr/exit code → re-fetch tool list.
// - cache layer: SHA256(capability) keyed file cache in ~/.cache/blade/forge_gh/
//   with 24h TTL. probe_github checks cache before hitting GitHub.
// - integration test against a mock GitHub API surface (tests/forge_github_integration.rs)
//   that asserts the McpServerHit / OtherKindHit / NoHit branches all dispatch correctly.

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_search_query_strips_noise_words() {
        let q = build_search_query("convert a mp4 to GIF for me");
        // "a", "to", "for", "me" stripped
        assert!(q.contains("convert"));
        assert!(q.contains("mp4"));
        assert!(q.contains("GIF"));
        assert!(!q.contains(" a "));
        assert!(!q.contains(" to "));
    }

    #[test]
    fn repo_kind_detects_mcp_server() {
        let kind = RepoKind::from_name_and_desc(
            "modelcontextprotocol/servers",
            "Reference MCP servers for the Model Context Protocol",
        );
        assert_eq!(kind, RepoKind::McpServer);
    }

    #[test]
    fn repo_kind_detects_tauri_plugin() {
        let kind = RepoKind::from_name_and_desc(
            "tauri-apps/tauri-plugin-fs",
            "Filesystem APIs for Tauri apps",
        );
        assert_eq!(kind, RepoKind::TauriPlugin);
    }

    #[test]
    fn repo_kind_falls_back_to_unknown() {
        let kind = RepoKind::from_name_and_desc("foo/bar", "some random project");
        assert_eq!(kind, RepoKind::Unknown);
    }

    #[test]
    fn parse_candidates_from_json_extracts_fields() {
        let raw = r#"{
            "items": [
                {
                    "full_name": "modelcontextprotocol/servers",
                    "description": "Reference MCP servers for the Model Context Protocol",
                    "html_url": "https://github.com/modelcontextprotocol/servers",
                    "stargazers_count": 5000,
                    "pushed_at": "2026-05-15T10:00:00Z"
                },
                {
                    "full_name": "noop/empty",
                    "description": null,
                    "html_url": "https://github.com/noop/empty",
                    "stargazers_count": 0,
                    "pushed_at": "2024-01-01T00:00:00Z"
                }
            ]
        }"#;
        let cands = parse_candidates_from_json(raw);
        assert_eq!(cands.len(), 2);
        assert_eq!(cands[0].full_name, "modelcontextprotocol/servers");
        assert_eq!(cands[0].stars, 5000);
        assert_eq!(cands[0].kind, RepoKind::McpServer);
        assert_eq!(cands[1].description, "");
        assert_eq!(cands[1].kind, RepoKind::Unknown);
    }

    #[test]
    fn parse_candidates_from_json_handles_malformed_input() {
        assert_eq!(parse_candidates_from_json("not json").len(), 0);
        assert_eq!(parse_candidates_from_json("{}").len(), 0);
        assert_eq!(parse_candidates_from_json(r#"{"items": []}"#).len(), 0);
    }
}
