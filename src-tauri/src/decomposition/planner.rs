//! DECOMP-01: step counter + role-selection heuristic.
//!
//! `count_independent_steps_grouped(query, &config)` returns
//! `Some(Vec<StepGroup>)` when `max(verb_groups, file_groups, tool_families)
//! >= config.decomposition.min_steps_to_decompose` (default 5), else `None`.
//!
//! Phase 35 Plan 35-03: filled. Plan 35-02 stub deleted.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::agents::AgentRole;
use crate::config::BladeConfig;

/// One step in a decomposed plan. Output by DECOMP-01's heuristic; consumed
/// by DECOMP-02's executor (built into a SwarmTask + spawn_isolated_subagent).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepGroup {
    pub step_index: u32,
    /// safe_slice'd to 500 chars at construction time.
    pub goal: String,
    pub role: AgentRole,
    /// By step_index — empty for independent groups.
    pub depends_on: Vec<u32>,
    /// "fast" | "medium" | "slow" — used by ActivityStrip estimate displays.
    pub estimated_duration: String,
}

#[cfg(test)]
thread_local! {
    /// Plan 35-03 — tests inject a step count without crafting real complex
    /// queries. When set to Some(n), count_independent_steps_grouped returns
    /// Some(synthetic groups of length n). Production builds carry zero
    /// overhead.
    pub(crate) static DECOMP_FORCE_STEP_COUNT: std::cell::Cell<Option<u32>> =
        std::cell::Cell::new(None);
}

/// Plan 35-03 — DECOMP-01 trigger detector. Returns Some(groups) when
/// `max(verb_groups, file_groups, tool_families) >= min_steps_to_decompose`,
/// else None. auto_decompose_enabled=false short-circuits to None.
pub fn count_independent_steps_grouped(
    query: &str,
    config: &BladeConfig,
) -> Option<Vec<StepGroup>> {
    #[cfg(test)]
    {
        if let Some(forced) = DECOMP_FORCE_STEP_COUNT.with(|c| c.get()) {
            return Some(synthetic_groups(query, forced));
        }
    }
    if !config.decomposition.auto_decompose_enabled {
        return None;
    }
    let q_lower = query.to_lowercase();
    let verb_groups = count_verb_groups(&q_lower);
    let file_groups = count_file_groups(query);
    let tool_families = count_tool_families(&q_lower);
    let n = verb_groups.max(file_groups).max(tool_families);
    if n < config.decomposition.min_steps_to_decompose {
        return None;
    }
    Some(build_step_groups(query, n))
}

/// Verb-axis count — connectors + action verbs + comparison heuristic.
/// Mirrors commands.rs:671 count_task_steps logic.
fn count_verb_groups(q_lower: &str) -> u32 {
    let connectors = [
        " and then ", " then ", " after that ", " afterwards ",
        " next ", " also ", " as well", " plus ", " followed by ",
        " once ", " before ", " finally ", " lastly ",
    ];
    let connector_count = connectors.iter()
        .filter(|c| q_lower.contains(*c))
        .count();
    let action_verbs = [
        "compare", "fetch", "get", "read", "check", "show", "display",
        "calculate", "find", "search", "run", "open", "send", "create",
        "write", "analyze", "summarize", "visualize", "graph", "chart",
        "list", "download", "upload", "format", "convert", "export",
    ];
    let verb_count = action_verbs.iter()
        .filter(|v| q_lower.contains(*v))
        .count();
    let has_comparison = q_lower.contains(" vs ")
        || q_lower.contains(" versus ")
        || q_lower.contains("compared to")
        || q_lower.contains("compare");
    let mut score = connector_count;
    if verb_count >= 2 {
        score += verb_count.saturating_sub(1);
    }
    if has_comparison {
        score += 1;
    }
    score as u32
}

/// File/project-noun axis — unique paths + URLs + repo nouns.
fn count_file_groups(q_raw: &str) -> u32 {
    // Best-effort regex compilation. If regex fails (shouldn't with literals),
    // contribute 0 to that sub-axis rather than panicking.
    let mut unique: HashSet<String> = HashSet::new();
    if let Ok(path_re) = regex::Regex::new(r"\b[\w./-]+\.\w{1,5}\b") {
        for m in path_re.find_iter(q_raw) {
            unique.insert(m.as_str().to_string());
        }
    }
    if let Ok(url_re) = regex::Regex::new(r"https?://\S+") {
        for m in url_re.find_iter(q_raw) {
            unique.insert(m.as_str().to_string());
        }
    }
    if let Ok(repo_re) = regex::Regex::new(r"\bthe-[\w-]+\b") {
        for m in repo_re.find_iter(q_raw) {
            unique.insert(m.as_str().to_string());
        }
    }
    unique.len() as u32
}

/// Tool-family axis — count distinct keyword groups in the query.
fn count_tool_families(q_lower: &str) -> u32 {
    let families: &[&[&str]] = &[
        &["bash", "shell", "run ", "execute"],     // bash family
        &["read ", "cat ", "show ", "open "],      // read_file family
        &["search", "grep", "find "],              // search family
        &["web ", "fetch", "curl", "http"],        // web_fetch family
        &["write ", "save ", "create "],           // write_file family
    ];
    families.iter()
        .filter(|kws| kws.iter().any(|k| q_lower.contains(k)))
        .count() as u32
}

/// Role-selection heuristic per CONTEXT lock §Brain Planner Step Counter.
fn select_role_for_goal(goal: &str) -> AgentRole {
    let g = goal.to_lowercase();
    if matches_any(&g, &["write code", "fix bug", "refactor", "function", "implement", "edit ", "patch"]) {
        AgentRole::Coder
    } else if matches_any(&g, &["test ", "review", "audit", "verify", " check"]) {
        AgentRole::Reviewer
    } else if matches_any(&g, &["doc ", "documentation", "email", "report", "blog", "post "]) {
        AgentRole::Writer
    } else if matches_any(&g, &["compare", "analyze", "summarize", "compute", "decide", "calculate"]) {
        AgentRole::Analyst
    } else if matches_any(&g, &["fetch", "find", "search", "look up", "read", "get ", "show"]) {
        AgentRole::Researcher
    } else {
        AgentRole::Researcher  // default fallback (broadest tool footprint)
    }
}

fn matches_any(text: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|p| text.contains(p))
}

/// Build N StepGroups by splitting at connector boundaries (best-effort).
/// If no connectors, every group gets the full query as its goal — the
/// sub-agent's own LLM interprets the sub-task.
fn build_step_groups(query: &str, n: u32) -> Vec<StepGroup> {
    let parts: Vec<String> = split_at_connectors(query);
    (0..n).map(|i| {
        let raw_goal = parts.get(i as usize).cloned()
            .unwrap_or_else(|| query.to_string());
        let goal = crate::safe_slice(&raw_goal, 500).to_string();
        let role = select_role_for_goal(&goal);
        StepGroup {
            step_index: i,
            goal,
            role,
            depends_on: vec![],  // independent by default
            estimated_duration: "medium".to_string(),
        }
    }).collect()
}

fn split_at_connectors(query: &str) -> Vec<String> {
    let connectors = [
        " and then ", " then ", " after that ", " afterwards ",
        " also ", " followed by ", " finally ", " lastly ",
    ];
    let mut current = query.to_string();
    let mut parts: Vec<String> = Vec::new();
    'outer: loop {
        let lower = current.to_lowercase();
        for c in &connectors {
            if let Some(idx) = lower.find(c) {
                let (left, right) = current.split_at(idx);
                parts.push(left.trim().to_string());
                current = right[c.len()..].to_string();
                continue 'outer;
            }
        }
        break;
    }
    parts.push(current.trim().to_string());
    parts.into_iter().filter(|s| !s.is_empty()).collect()
}

#[cfg(test)]
fn synthetic_groups(query: &str, n: u32) -> Vec<StepGroup> {
    (0..n).map(|i| StepGroup {
        step_index: i,
        goal: crate::safe_slice(&format!("synthetic step {} of: {}", i, query), 500).to_string(),
        role: AgentRole::Researcher,
        depends_on: vec![],
        estimated_duration: "fast".to_string(),
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> BladeConfig { BladeConfig::default() }

    #[test]
    fn phase35_step_group_serde_roundtrip() {
        let g = StepGroup {
            step_index: 0,
            goal: "test".to_string(),
            role: AgentRole::Coder,
            depends_on: vec![],
            estimated_duration: "fast".to_string(),
        };
        let json = serde_json::to_string(&g).expect("serialize");
        let parsed: StepGroup = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.step_index, g.step_index);
        assert_eq!(parsed.goal, g.goal);
    }

    #[test]
    fn phase35_decomp_01_step_counter_thresholds() {
        let cfg = cfg();
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None));
        // 1-verb query: should NOT trigger
        let r = count_independent_steps_grouped("read the file", &cfg);
        assert!(r.is_none(), "single-verb query should not trip threshold 5");

        // 6-step query: should trigger
        let multi = "read the file and then summarize it then write a report \
                     also fetch the data also analyze the trends finally export the result";
        let r = count_independent_steps_grouped(multi, &cfg);
        assert!(r.is_some(), "6-step query should trip threshold 5");
        let groups = r.unwrap();
        assert!(groups.len() >= 5, "groups.len()={} should be >= 5", groups.len());
    }

    #[test]
    fn phase35_decomp_01_role_selection_heuristic() {
        assert_eq!(select_role_for_goal("write code for the foo function"), AgentRole::Coder);
        assert_eq!(select_role_for_goal("fetch the URL contents"), AgentRole::Researcher);
        assert_eq!(select_role_for_goal("compare option A and B"), AgentRole::Analyst);
        assert_eq!(select_role_for_goal("write a doc about it"), AgentRole::Writer);
        assert_eq!(select_role_for_goal("review the PR"), AgentRole::Reviewer);
        assert_eq!(select_role_for_goal("xyzzy unknown verb"), AgentRole::Researcher);
    }

    #[test]
    fn phase35_decomp_01_disabled_returns_none() {
        let mut cfg = cfg();
        cfg.decomposition.auto_decompose_enabled = false;
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None));
        let multi = "read and write and search and fetch and create and run";
        assert!(count_independent_steps_grouped(multi, &cfg).is_none(),
            "auto_decompose_enabled=false must short-circuit to None");
    }

    #[test]
    fn phase35_decomp_01_file_groups_axis() {
        let cfg = cfg();
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None));
        // 5 unique file paths but only 1 verb — should still trip via file axis
        let q = "summarize /tmp/a.txt /tmp/b.txt /tmp/c.txt /tmp/d.txt /tmp/e.txt";
        let r = count_independent_steps_grouped(q, &cfg);
        assert!(r.is_some(), "5 file nouns should trip threshold via file axis");
    }

    #[test]
    fn phase35_decomp_01_tool_families_axis() {
        let cfg = cfg();
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None));
        // 5 distinct tool families: bash, read, search, web, write
        let q = "bash run ls then read the output then search for errors then fetch curl http://x.com then write report.txt";
        let r = count_independent_steps_grouped(q, &cfg);
        assert!(r.is_some(), "5 tool families should trip threshold via tool-family axis");
    }

    #[test]
    fn phase35_decomp_01_goal_safe_slice_to_500() {
        let cfg = cfg();
        let long = "read ".repeat(200) + " and then write " + &"x".repeat(2000);
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(Some(3)));
        let r = count_independent_steps_grouped(&long, &cfg);
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None));
        let groups = r.expect("should have groups via seam");
        for g in &groups {
            assert!(g.goal.len() <= 500,
                "goal must be safe_slice'd to <= 500 chars, got {}", g.goal.len());
        }
    }

    #[test]
    fn phase35_decomp_force_step_count_seam_returns_synthetic_groups() {
        let cfg = BladeConfig::default();
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(Some(7)));
        let result = count_independent_steps_grouped("anything", &cfg);
        DECOMP_FORCE_STEP_COUNT.with(|c| c.set(None)); // teardown
        let groups = result.expect("seam should produce groups");
        assert_eq!(groups.len(), 7);
        assert_eq!(groups[0].step_index, 0);
        assert_eq!(groups[6].step_index, 6);
    }
}
