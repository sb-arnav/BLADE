use crate::providers::{self, ChatMessage};

// ---------------------------------------------------------------------------
// Complexity detection
// ---------------------------------------------------------------------------

/// Returns true if the query is complex enough to warrant Tree-of-Thoughts
/// multi-path reasoning before planning.
///
/// Short queries (<8 words) are fast-pathed to avoid unnecessary LLM calls.
/// Longer queries are checked for keywords that signal debugging, design,
/// architecture, or open-ended problem-solving tasks.
pub fn is_complex_task(query: &str) -> bool {
    let query_lower = query.to_lowercase();

    let complex_indicators = [
        "debug",
        "why is",
        "design",
        "architect",
        "optimize",
        "fix",
        "error",
        "not working",
        "broken",
        "crash",
        "how to implement",
        "build a",
        "create a system",
        "compare",
        "tradeoff",
        "best approach",
        "should i",
    ];

    let word_count = query.split_whitespace().count();
    if word_count < 8 {
        return false;
    }

    complex_indicators
        .iter()
        .any(|&ind| query_lower.contains(ind))
}

// ---------------------------------------------------------------------------
// Path generation
// ---------------------------------------------------------------------------

/// Ask the LLM to propose `n_paths` distinct approaches for solving `goal`.
/// Returns a Vec of approach strings, one per path.
///
/// Falls back to an empty Vec on any LLM failure — callers must handle that.
async fn generate_thought_paths(
    goal: &str,
    n_paths: usize,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<Vec<String>, String> {
    let prompt = format!(
        "Generate {n} different approaches to solve this problem. \
For each approach, give a brief (2-3 sentence) reasoning chain showing how you would tackle it. \
Number them clearly (1., 2., 3., ...). \
Goal: {goal}",
        n = n_paths,
        goal = goal
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);
    let no_tools: &[providers::ToolDefinition] = &[];
    let turn = providers::complete_turn(provider, api_key, model, &conversation, no_tools, base_url).await?;

    let paths = split_numbered_paths(&turn.content, n_paths);
    if paths.is_empty() {
        return Err("No thought paths parsed from LLM response".to_string());
    }
    Ok(paths)
}

/// Split a numbered-list response into individual path strings.
///
/// Handles patterns like "1.", "2.", "3." at the start of a line.
fn split_numbered_paths(text: &str, expected: usize) -> Vec<String> {
    // Build a regex-free splitter: find lines that start with "N." or "N)"
    let mut paths: Vec<String> = Vec::new();
    let mut current: Vec<&str> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        // Detect lines like "1.", "2.", ..., "9." at the beginning
        let is_new_path = trimmed
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
            && (trimmed.starts_with("1.")
                || trimmed.starts_with("2.")
                || trimmed.starts_with("3.")
                || trimmed.starts_with("4.")
                || trimmed.starts_with("5.")
                || trimmed.starts_with("1)")
                || trimmed.starts_with("2)")
                || trimmed.starts_with("3)")
                || trimmed.starts_with("4)")
                || trimmed.starts_with("5)"));

        if is_new_path && !current.is_empty() {
            let joined = current.join("\n").trim().to_string();
            if !joined.is_empty() {
                paths.push(joined);
            }
            current.clear();
        }
        current.push(line);
    }

    // Push the last segment
    if !current.is_empty() {
        let joined = current.join("\n").trim().to_string();
        if !joined.is_empty() {
            paths.push(joined);
        }
    }

    // If parsing failed (e.g. LLM didn't number its output), fall back to
    // splitting by double newlines and taking the first `expected` chunks.
    if paths.is_empty() || paths.len() == 1 {
        let chunks: Vec<String> = text
            .split("\n\n")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .take(expected)
            .collect();
        if chunks.len() > 1 {
            return chunks;
        }
        // Last resort: return the whole text as a single path
        return vec![text.trim().to_string()];
    }

    paths.into_iter().take(expected).collect()
}

// ---------------------------------------------------------------------------
// Path scoring
// ---------------------------------------------------------------------------

/// Ask the LLM to rate how well `path` addresses `goal`. Returns 0.0–10.0.
///
/// Uses `cheap_model_for_provider` so the full-quality model is reserved for
/// generation; scoring only needs a fast yes/no-style judgment.
///
/// Never fails — returns 0.0 on any error so the caller can still select among
/// the remaining paths.
async fn score_thought_path(
    path: &str,
    goal: &str,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> f32 {
    let prompt = format!(
        "Score this approach 0-10 for solving the following goal. \
Reply with ONLY a number (integer or decimal).\n\
Goal: {goal}\n\
Approach: {path}\n\
Score (0-10):",
        goal = goal,
        path = path
    );

    let messages = vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
        image_base64: None,
    }];
    let conversation = providers::build_conversation(messages, None);
    let no_tools: &[providers::ToolDefinition] = &[];
    let result =
        providers::complete_turn(provider, api_key, model, &conversation, no_tools, base_url).await;

    match result {
        Ok(turn) => parse_score(&turn.content),
        Err(_) => 0.0,
    }
}

/// Extract the first float found in the first 20 characters of the response.
fn parse_score(text: &str) -> f32 {
    let snippet = text.trim().chars().take(20).collect::<String>();
    // Try to parse each whitespace-separated token as a float
    for token in snippet.split_whitespace() {
        // Strip trailing punctuation
        let clean: String = token
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if let Ok(score) = clean.parse::<f32>() {
            return score.clamp(0.0, 10.0);
        }
    }
    5.0 // neutral fallback
}

// ---------------------------------------------------------------------------
// Best-path selection
// ---------------------------------------------------------------------------

/// Given a list of `(score, path)` pairs, return the highest-scoring path.
fn select_best_path(mut scored: Vec<(f32, String)>) -> Option<String> {
    if scored.is_empty() {
        return None;
    }
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().next().map(|(_, path)| path)
}

// ---------------------------------------------------------------------------
// Full ToT pipeline
// ---------------------------------------------------------------------------

/// Run the full Tree-of-Thoughts pipeline for `goal`:
/// 1. Generate `n_paths` thought paths (full model — higher quality).
/// 2. Score each path with a cheap model (fast, low-cost).
/// 3. Return the highest-scoring path text.
///
/// On any failure the error is propagated so callers can fall back gracefully.
pub async fn tot_plan(
    goal: &str,
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    n_paths: usize,
) -> Result<String, String> {
    // Step 1: generate N distinct approaches using the full model
    let paths =
        generate_thought_paths(goal, n_paths, provider, api_key, model, base_url).await?;

    // Step 2: score each path using a cheap/fast model
    let cheap_model = crate::config::cheap_model_for_provider(provider, model);
    let cheap_model_ref: &str = &cheap_model;

    let mut scored: Vec<(f32, String)> = Vec::with_capacity(paths.len());
    for path in &paths {
        let score =
            score_thought_path(path, goal, provider, api_key, cheap_model_ref, base_url).await;
        scored.push((score, path.clone()));
    }

    // Step 3: pick the winner
    let best = select_best_path(scored)
        .or_else(|| paths.into_iter().next())
        .unwrap_or_default();

    Ok(best)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_complex_task_short_query() {
        assert!(!is_complex_task("hello"));
        assert!(!is_complex_task("what time is it"));
    }

    #[test]
    fn test_is_complex_task_long_simple() {
        // Long but no complex indicators
        assert!(!is_complex_task(
            "tell me something interesting about the color blue please"
        ));
    }

    #[test]
    fn test_is_complex_task_debug() {
        assert!(is_complex_task(
            "why is my Rust application crashing when I call this function"
        ));
    }

    #[test]
    fn test_is_complex_task_design() {
        assert!(is_complex_task(
            "design a distributed caching system that can handle millions of requests per second"
        ));
    }

    #[test]
    fn test_is_complex_task_optimize() {
        assert!(is_complex_task(
            "optimize the database query performance in our production environment today"
        ));
    }

    #[test]
    fn test_parse_score_integer() {
        assert!((parse_score("8") - 8.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_score_decimal() {
        assert!((parse_score("7.5\n\nSome explanation") - 7.5).abs() < 0.01);
    }

    #[test]
    fn test_parse_score_clamped() {
        assert!((parse_score("12") - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_parse_score_fallback() {
        // No digits → neutral 5.0
        assert!((parse_score("excellent!") - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_split_numbered_paths_basic() {
        let text = "1. First approach: do X\nExplanation here.\n\n2. Second approach: do Y\nMore detail.\n\n3. Third approach: do Z\nFinal detail.";
        let paths = split_numbered_paths(text, 3);
        assert_eq!(paths.len(), 3);
        assert!(paths[0].contains("First approach"));
        assert!(paths[1].contains("Second approach"));
        assert!(paths[2].contains("Third approach"));
    }

    #[test]
    fn test_select_best_path() {
        let scored = vec![
            (3.0, "mediocre".to_string()),
            (9.0, "excellent".to_string()),
            (5.0, "average".to_string()),
        ];
        let best = select_best_path(scored).unwrap();
        assert_eq!(best, "excellent");
    }

    #[test]
    fn test_select_best_path_empty() {
        assert!(select_best_path(vec![]).is_none());
    }
}
