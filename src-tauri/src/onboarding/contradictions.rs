//! Phase 49 — HUNT-06-ADV — thematic contradiction detection.
//!
//! After the main hunt LLM session accumulates findings, run a SECOND LLM
//! pass with a cheaper model to classify the findings into thematic clusters
//! (work / personal / hobby / past-self) and surface contradictions where
//! clusters disagree on the user's primary identity.
//!
//! If contradictions exist, the caller (hunt::start_hunt) emits the first
//! contradiction's `question` as a `hunt_question` chat-line and parks
//! waiting for the user's choice via `blade_hunt_user_answer`.
//!
//! Hard budget: < 5s on the cheap model. If the model isn't available, the
//! pass is skipped — basic contradiction surfacing via the main-hunt system
//! prompt stays in effect.

use crate::onboarding::hunt::HuntFindings;
use crate::providers::{self, ConversationMessage, ToolDefinition};
use serde::{Deserialize, Serialize};

/// One thematic cluster extracted from the hunt findings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    pub name: String,
    /// Free-form findings that landed in this cluster (paths / project names /
    /// languages / signal phrases).
    #[serde(default)]
    pub findings: Vec<String>,
    /// Free-form recency label: "this-week" | "this-month" | "older" | "unknown".
    #[serde(default)]
    pub recency: String,
}

/// One contradiction between two clusters. `question` is the spec-Act-6
/// sharp question BLADE will surface to the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contradiction {
    pub cluster_a: String,
    pub cluster_b: String,
    pub question: String,
}

/// Full report returned by the LLM. Both fields are arrays; either can be
/// empty when the LLM doesn't find anything.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HuntContradictionReport {
    #[serde(default)]
    pub clusters: Vec<Cluster>,
    #[serde(default)]
    pub contradictions: Vec<Contradiction>,
}

/// 5s hard timeout per phase-brief budget.
const CONTRADICTION_TIMEOUT_SECS: u64 = 5;

/// Run the second-pass LLM classification. Returns:
///   - `Ok(Some(report))` on success
///   - `Ok(None)` when the cheap-model path isn't available (skip silently)
///   - `Err(_)` on provider error (caller logs but continues)
pub async fn detect_contradictions(
    _app: &tauri::AppHandle,
    cfg: &crate::config::BladeConfig,
    findings: &HuntFindings,
) -> Result<Option<HuntContradictionReport>, String> {
    let provider = cfg.provider.clone();
    let api_key = crate::config::get_provider_key(&provider);
    if api_key.is_empty() && provider != "ollama" {
        // No key — basic contradiction surfacing via the main hunt prompt stays.
        return Ok(None);
    }
    // Route to the cheapest model available for this provider. `cheap_model_for_provider`
    // already returns the user's model for openrouter/ollama (BYOK), and a
    // dedicated cheap model for the cloud providers.
    let model = crate::config::cheap_model_for_provider(&provider, &cfg.model);

    let prompt = build_contradiction_prompt(findings);
    let conversation = vec![ConversationMessage::User(prompt)];
    let no_tools: Vec<ToolDefinition> = Vec::new();

    let fut = providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &conversation,
        &no_tools,
        cfg.base_url.as_deref(),
    );

    let turn = match tokio::time::timeout(
        std::time::Duration::from_secs(CONTRADICTION_TIMEOUT_SECS),
        fut,
    ).await {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => return Err(format!("provider error: {}", e)),
        Err(_) => {
            log::warn!("[contradictions] {}s budget exceeded; skipping pass", CONTRADICTION_TIMEOUT_SECS);
            return Ok(None);
        }
    };

    let raw = turn.content.trim();
    if raw.is_empty() {
        return Ok(None);
    }

    let json_str = extract_json_blob(raw);
    match serde_json::from_str::<HuntContradictionReport>(json_str) {
        Ok(report) => Ok(Some(report)),
        Err(e) => {
            log::warn!(
                "[contradictions] failed to parse LLM response as JSON: {} — raw: {}",
                e,
                crate::safe_slice(raw, 240)
            );
            Ok(None)
        }
    }
}

fn build_contradiction_prompt(findings: &HuntFindings) -> String {
    // Compact summary of the hunt findings. Keep it short — the cheap model
    // has limited context.
    let mut summary = String::new();
    summary.push_str("Hunt findings:\n");
    summary.push_str(&format!(
        "- OS: {} / arch: {}\n",
        findings.initial.os, findings.initial.arch
    ));
    for line in findings.chat_lines.iter().take(20) {
        summary.push_str(&format!("- {}\n", crate::safe_slice(line, 160)));
    }
    for probe in findings.probes.iter().take(15) {
        if !probe.ok || probe.tool == "hunt_emit_chat_line" {
            continue;
        }
        summary.push_str(&format!(
            "- probe[{}] {} → {}\n",
            probe.tool,
            crate::safe_slice(&probe.argument, 60),
            crate::safe_slice(&probe.snippet, 120)
        ));
    }

    format!(
        r#"You are BLADE's contradiction detector. Given these hunt findings, classify them into thematic clusters: work / personal / hobby / past-self. Identify contradictions where clusters disagree on the user's primary identity (e.g. year-old Python iOS app vs this-week TypeScript SaaS).

Return STRICT JSON only, no prose. Schema:

{{
  "clusters": [
    {{"name": "work", "findings": ["..."], "recency": "this-week"}},
    {{"name": "hobby", "findings": ["..."], "recency": "older"}}
  ],
  "contradictions": [
    {{
      "cluster_a": "work",
      "cluster_b": "past-self",
      "question": "I'm seeing two stories — <terse summary>. Which one are you now?"
    }}
  ]
}}

Empty arrays are fine. If no contradictions exist, return `"contradictions": []`. If you can't classify reliably, return both arrays empty.

{}
"#,
        summary
    )
}

/// Some providers wrap JSON in markdown fences. Strip to the outer `{...}`.
fn extract_json_blob(raw: &str) -> &str {
    if let Some(start) = raw.find('{') {
        if let Some(end) = raw.rfind('}') {
            if end >= start {
                return &raw[start..=end];
            }
        }
    }
    raw
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_json_strips_fences() {
        let raw = "```json\n{\"clusters\":[]}\n```";
        assert_eq!(extract_json_blob(raw), "{\"clusters\":[]}");
    }

    #[test]
    fn extract_json_passes_through_clean() {
        let raw = "{\"x\":1}";
        assert_eq!(extract_json_blob(raw), "{\"x\":1}");
    }

    #[test]
    fn report_parses_minimal() {
        let raw = r#"{"clusters":[],"contradictions":[]}"#;
        let r: HuntContradictionReport = serde_json::from_str(raw).unwrap();
        assert!(r.clusters.is_empty());
        assert!(r.contradictions.is_empty());
    }

    #[test]
    fn report_parses_full() {
        let raw = r#"{
            "clusters": [
                {"name": "work", "findings": ["clarify"], "recency": "this-week"},
                {"name": "past-self", "findings": ["python-ios-app"], "recency": "older"}
            ],
            "contradictions": [
                {"cluster_a": "work", "cluster_b": "past-self", "question": "Which one are you now?"}
            ]
        }"#;
        let r: HuntContradictionReport = serde_json::from_str(raw).unwrap();
        assert_eq!(r.clusters.len(), 2);
        assert_eq!(r.contradictions.len(), 1);
        assert_eq!(r.contradictions[0].cluster_a, "work");
    }
}
