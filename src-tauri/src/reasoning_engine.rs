// reasoning_engine.rs
// BLADE System 2 — true multi-step reasoning.
//
// Instead of a single LLM call, complex questions are broken into sub-problems.
// Each step is analyzed, then self-critiqued before moving on. If confidence is
// low (< 0.6), the step is automatically revised. Finally all steps are
// synthesized into a final answer with an overall confidence score.
//
// Key distinction from a plain LLM call: mandatory self-critique after every step.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

// ── Structs ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningStep {
    pub step_num: i32,
    pub thought: String,
    pub confidence: f32,        // 0.0 – 1.0
    pub step_type: String,      // "decompose" | "analyze" | "hypothesize" | "verify" | "conclude"
    pub critiques: Vec<String>,
    pub revised: Option<String>, // revised thought when critique confidence < 0.6
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningTrace {
    pub id: String,
    pub question: String,
    pub steps: Vec<ReasoningStep>,
    pub final_answer: String,
    pub total_confidence: f32,
    pub reasoning_quality: f32, // self-assessed 0 – 10
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HypothesisTest {
    pub hypothesis: String,
    pub evidence_for: Vec<String>,
    pub evidence_against: Vec<String>,
    pub verdict: String,   // "supported" | "refuted" | "inconclusive"
    pub confidence: f32,
}

// Payload emitted for each completed step so the frontend can stream progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StepEvent {
    trace_id: String,
    step: ReasoningStep,
}

// ── Database helpers ───────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

pub fn ensure_tables() -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path())
        .map_err(|e| format!("DB open: {}", e))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reasoning_traces (
            id TEXT PRIMARY KEY,
            question TEXT NOT NULL,
            steps TEXT NOT NULL,
            final_answer TEXT NOT NULL,
            total_confidence REAL NOT NULL,
            reasoning_quality REAL NOT NULL,
            created_at INTEGER NOT NULL
        );"
    ).map_err(|e| format!("DB schema: {}", e))?;
    Ok(())
}

fn save_trace(trace: &ReasoningTrace) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path())
        .map_err(|e| format!("DB open: {}", e))?;
    let steps_json = serde_json::to_string(&trace.steps)
        .map_err(|e| format!("Serialize steps: {}", e))?;
    conn.execute(
        "INSERT OR REPLACE INTO reasoning_traces
            (id, question, steps, final_answer, total_confidence, reasoning_quality, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            trace.id,
            trace.question,
            steps_json,
            trace.final_answer,
            trace.total_confidence,
            trace.reasoning_quality,
            trace.created_at,
        ],
    ).map_err(|e| format!("DB insert: {}", e))?;
    Ok(())
}

fn load_trace_row(
    id: String,
    question: String,
    steps_json: String,
    final_answer: String,
    total_confidence: f64,
    reasoning_quality: f64,
    created_at: i64,
) -> Option<ReasoningTrace> {
    let steps: Vec<ReasoningStep> = serde_json::from_str(&steps_json).ok()?;
    Some(ReasoningTrace {
        id,
        question,
        steps,
        final_answer,
        total_confidence: total_confidence as f32,
        reasoning_quality: reasoning_quality as f32,
        created_at,
    })
}

// ── Provider selection ─────────────────────────────────────────────────────────

fn quality_provider() -> (String, String, String) {
    let config = crate::config::load_config();
    let task_type = crate::router::TaskType::Complex;
    crate::config::resolve_provider_for_task(&config, &task_type)
}

// ── LLM helper ────────────────────────────────────────────────────────────────

async fn llm(
    provider: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user_msg: &str,
) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(user_msg.to_string()),
    ];
    let turn = complete_turn(provider, api_key, model, &messages, &[], None).await?;
    Ok(turn.content)
}

/// Strip markdown fences from LLM JSON output.
fn strip_fences(s: &str) -> &str {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("```json").or_else(|| s.strip_prefix("```")) {
        if let Some(end) = inner.rfind("```") {
            return inner[..end].trim();
        }
        return inner.trim();
    }
    s
}

/// Parse f32 from a JSON Value that might be float or int.
fn parse_f32(v: &serde_json::Value) -> f32 {
    v.as_f64().unwrap_or(0.7) as f32
}

// ── Core pipeline ──────────────────────────────────────────────────────────────

/// Decompose a question into a list of sub-problems to tackle one at a time.
pub async fn decompose_problem(question: &str) -> Vec<String> {
    let (provider, api_key, model) = quality_provider();

    let system = "You are an expert problem decomposer. Break complex questions into a small, \
                  ordered list of distinct sub-problems. Each sub-problem should be independently \
                  solvable. Be precise and concrete.";

    let user_msg = format!(
        r#"Decompose this question into 3–6 concrete sub-problems:

Question: {question}

Respond ONLY as JSON:
{{"sub_problems": ["sub-problem 1", "sub-problem 2", "sub-problem 3"]}}"#
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .and_then(|v| {
                    v["sub_problems"].as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|s| s.as_str().map(String::from))
                            .collect()
                    })
                })
                .unwrap_or_else(|| vec![question.to_string()])
        }
        Err(_) => vec![question.to_string()],
    }
}

/// Analyze one sub-problem given the original question and prior reasoning steps.
pub async fn analyze_step(
    question: &str,
    sub_problem: &str,
    prior_steps: &[ReasoningStep],
    step_num: i32,
) -> ReasoningStep {
    let (provider, api_key, model) = quality_provider();

    let prior_context = if prior_steps.is_empty() {
        String::from("(No prior steps — this is the first.)")
    } else {
        prior_steps
            .iter()
            .map(|s| {
                let best = s.revised.as_deref().unwrap_or(&s.thought);
                format!("Step {}: {}", s.step_num, crate::safe_slice(best, 300))
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let system = "You are a rigorous analytical thinker. You reason step by step, avoid \
                  assumptions, and acknowledge uncertainty honestly. Never oversimplify.";

    let user_msg = format!(
        r#"You are working through a complex question step by step.

Original question: {question}

Prior reasoning:
{prior_context}

Current sub-problem to analyze: {sub_problem}

Think carefully through this sub-problem. Consider multiple angles. Identify key uncertainties.

Respond ONLY as JSON:
{{
  "thought": "your detailed analysis",
  "confidence": 0.0-1.0,
  "step_type": "analyze"
}}"#
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .map(|v| ReasoningStep {
                    step_num,
                    thought: v["thought"]
                        .as_str()
                        .unwrap_or(sub_problem)
                        .to_string(),
                    confidence: parse_f32(&v["confidence"]),
                    step_type: v["step_type"]
                        .as_str()
                        .unwrap_or("analyze")
                        .to_string(),
                    critiques: vec![],
                    revised: None,
                })
                .unwrap_or_else(|| ReasoningStep {
                    step_num,
                    thought: format!("Analysis of: {}", sub_problem),
                    confidence: 0.5,
                    step_type: "analyze".to_string(),
                    critiques: vec![],
                    revised: None,
                })
        }
        Err(e) => ReasoningStep {
            step_num,
            thought: format!("Failed to analyze sub-problem: {}", e),
            confidence: 0.3,
            step_type: "analyze".to_string(),
            critiques: vec![],
            revised: None,
        },
    }
}

/// Critique a reasoning step — finds logical flaws, missing context, hidden assumptions.
pub async fn critique_step(step: &ReasoningStep, question: &str) -> Vec<String> {
    let (provider, api_key, model) = quality_provider();

    let thought = step.revised.as_deref().unwrap_or(&step.thought);

    let system = "You are a ruthless logical critic. Your job is to find every flaw in a \
                  reasoning step: missed considerations, hidden assumptions, logical leaps, \
                  ignored counter-evidence. Be specific and actionable.";

    let user_msg = format!(
        r#"Original question: {question}

Reasoning step (type: {step_type}):
{thought}

Find every flaw in this reasoning. Specifically look for:
1. Hidden assumptions stated as facts
2. Important considerations that were ignored
3. Logical leaps without justification
4. Counter-evidence that wasn't considered
5. Overconfidence or underconfidence

Respond ONLY as JSON:
{{"critiques": ["critique 1", "critique 2", "critique 3"]}}"#,
        step_type = step.step_type,
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .and_then(|v| {
                    v["critiques"].as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|s| s.as_str().map(String::from))
                            .collect()
                    })
                })
                .unwrap_or_default()
        }
        Err(_) => vec![],
    }
}

/// Revise a step by addressing the identified critiques.
pub async fn revise_step(step: &ReasoningStep, critiques: &[String]) -> String {
    let (provider, api_key, model) = quality_provider();

    let thought = step.revised.as_deref().unwrap_or(&step.thought);
    let critiques_text = critiques
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{}. {}", i + 1, c))
        .collect::<Vec<_>>()
        .join("\n");

    let system = "You are an expert thinker revising your own reasoning after critique. \
                  Address every identified flaw directly. Be thorough and intellectually honest.";

    let user_msg = format!(
        r#"Your original reasoning:
{thought}

Critiques that must be addressed:
{critiques_text}

Revise your reasoning to address every critique. The revision should be more complete, \
more nuanced, and better justified than the original. Do not be defensive — improve it.

Respond with ONLY your revised thought as plain text (no JSON, no preamble)."#
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(revised) => revised.trim().to_string(),
        Err(_) => thought.to_string(),
    }
}

/// Synthesize all completed steps into a final answer with confidence estimate.
pub async fn synthesize_answer(
    question: &str,
    steps: &[ReasoningStep],
) -> (String, f32) {
    let (provider, api_key, model) = quality_provider();

    let steps_text = steps
        .iter()
        .map(|s| {
            let best = s.revised.as_deref().unwrap_or(&s.thought);
            format!(
                "Step {} [{}] (confidence {:.0}%):\n{}",
                s.step_num,
                s.step_type,
                s.confidence * 100.0,
                best,
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let system = "You are an expert synthesizer. Given a series of reasoning steps, you \
                  produce a clear, direct, well-justified final answer. Integrate all the \
                  steps coherently. Be honest about remaining uncertainty.";

    let user_msg = format!(
        r#"Question: {question}

Reasoning steps completed:
{steps_text}

Now synthesize a final, comprehensive answer that integrates all the reasoning above.
Be direct and actionable. Acknowledge remaining uncertainties honestly.

Respond ONLY as JSON:
{{
  "answer": "your final answer",
  "confidence": 0.0-1.0
}}"#
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .map(|v| {
                    let answer = v["answer"]
                        .as_str()
                        .unwrap_or("Unable to synthesize answer.")
                        .to_string();
                    let confidence = parse_f32(&v["confidence"]);
                    (answer, confidence)
                })
                .unwrap_or_else(|| {
                    (
                        "Unable to parse synthesized answer.".to_string(),
                        0.5,
                    )
                })
        }
        Err(e) => (format!("Synthesis failed: {}", e), 0.3),
    }
}

/// Test a hypothesis adversarially — tries to disprove it first.
pub async fn test_hypothesis(hypothesis: &str, evidence: &str) -> HypothesisTest {
    let (provider, api_key, model) = quality_provider();

    let system = "You are an adversarial hypothesis tester. Your primary job is to DISPROVE \
                  hypotheses. Steel-man the counter-argument first, then see if the evidence \
                  still holds up. Only conclude 'supported' if you genuinely cannot refute it.";

    let user_msg = format!(
        r#"Hypothesis: {hypothesis}

Available evidence:
{evidence}

Test this hypothesis adversarially:
1. First, try your hardest to DISPROVE it — find the strongest counter-evidence
2. Then list the evidence that genuinely supports it
3. Reach a verdict based on the full picture

Respond ONLY as JSON:
{{
  "evidence_for": ["evidence 1", "evidence 2"],
  "evidence_against": ["counter-evidence 1", "counter-evidence 2"],
  "verdict": "supported|refuted|inconclusive",
  "confidence": 0.0-1.0
}}"#
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .map(|v| {
                    let parse_str_arr = |key: &str| -> Vec<String> {
                        v[key]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|s| s.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default()
                    };
                    HypothesisTest {
                        hypothesis: hypothesis.to_string(),
                        evidence_for: parse_str_arr("evidence_for"),
                        evidence_against: parse_str_arr("evidence_against"),
                        verdict: v["verdict"]
                            .as_str()
                            .unwrap_or("inconclusive")
                            .to_string(),
                        confidence: parse_f32(&v["confidence"]),
                    }
                })
                .unwrap_or_else(|| HypothesisTest {
                    hypothesis: hypothesis.to_string(),
                    evidence_for: vec![],
                    evidence_against: vec![],
                    verdict: "inconclusive".to_string(),
                    confidence: 0.5,
                })
        }
        Err(_) => HypothesisTest {
            hypothesis: hypothesis.to_string(),
            evidence_for: vec![],
            evidence_against: vec![format!("LLM call failed")],
            verdict: "inconclusive".to_string(),
            confidence: 0.0,
        },
    }
}

/// Socratic drill-down: generate nested (question, answer) pairs exploring a topic.
pub async fn socratic_dialogue(
    question: &str,
    depth: usize,
) -> Vec<(String, String)> {
    let (provider, api_key, model) = quality_provider();
    let depth = depth.min(6).max(1);

    let system = "You are a Socratic tutor drilling deeper into a topic through probing questions \
                  and answers. Each answer should reveal a new layer of complexity or nuance.";

    let user_msg = format!(
        r#"Starting question: {question}

Generate a Socratic dialogue with {depth} levels of depth. Each round consists of a probing \
follow-up question and a thoughtful answer that reveals a deeper layer.

Respond ONLY as JSON:
{{
  "dialogue": [
    {{"question": "...", "answer": "..."}},
    {{"question": "...", "answer": "..."}}
  ]
}}"#
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .and_then(|v| {
                    v["dialogue"].as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|item| {
                                let q = item["question"].as_str()?.to_string();
                                let a = item["answer"].as_str()?.to_string();
                                Some((q, a))
                            })
                            .collect()
                    })
                })
                .unwrap_or_default()
        }
        Err(_) => vec![],
    }
}

/// Self-assess reasoning quality on a 0–10 scale.
async fn assess_quality(question: &str, steps: &[ReasoningStep], answer: &str) -> f32 {
    let (provider, api_key, model) = quality_provider();

    let step_count = steps.len();
    let revised_count = steps.iter().filter(|s| s.revised.is_some()).count();
    let avg_confidence: f32 = if steps.is_empty() {
        0.0
    } else {
        steps.iter().map(|s| s.confidence).sum::<f32>() / steps.len() as f32
    };

    let system = "You are a metacognitive evaluator assessing the quality of a multi-step \
                  reasoning process. Score honestly.";

    let user_msg = format!(
        r#"Evaluate this reasoning session:

Question: {question}
Steps completed: {step_count}
Steps revised after critique: {revised_count}
Average step confidence: {avg_confidence:.2}
Final answer preview: {answer_preview}

Score the overall reasoning quality 0–10, where:
- 0–3: Shallow, missed key considerations, poor logic
- 4–6: Adequate but incomplete, some flaws remain
- 7–8: Solid reasoning with proper critique integration
- 9–10: Exceptional depth, thorough critique, well-synthesized

Respond ONLY as JSON: {{"quality": 7.5}}"#,
        answer_preview = crate::safe_slice(answer, 200),
    );

    match llm(&provider, &api_key, &model, system, &user_msg).await {
        Ok(raw) => {
            let json_str = strip_fences(&raw);
            serde_json::from_str::<serde_json::Value>(json_str)
                .ok()
                .and_then(|v| v["quality"].as_f64())
                .map(|q| q as f32)
                .unwrap_or(avg_confidence * 10.0)
        }
        Err(_) => avg_confidence * 10.0,
    }
}

// ── Main reasoning pipeline ────────────────────────────────────────────────────

/// Full System 2 reasoning pipeline.
///
/// 1. Decomposes the question into sub-problems
/// 2. For each sub-problem: analyze → self-critique → (revise if needed)
/// 3. Synthesizes a final answer across all steps
/// 4. Emits `blade_reasoning_step` events as each step completes
pub async fn reason_through(
    question: &str,
    context: &str,
    max_steps: usize,
    app: tauri::AppHandle,
) -> Result<ReasoningTrace, String> {
    let _ = ensure_tables();

    let trace_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp_millis();

    // Combine question with any supplied context.
    let full_question = if context.is_empty() {
        question.to_string()
    } else {
        format!("{}\n\nContext:\n{}", question, context)
    };

    // Step 1: decompose
    let sub_problems = decompose_problem(&full_question).await;
    let sub_problems: Vec<String> = sub_problems
        .into_iter()
        .take(max_steps.max(1))
        .collect();

    let mut steps: Vec<ReasoningStep> = Vec::new();
    let mut step_num = 1i32;

    // Step 2: for each sub-problem, analyze → critique → maybe revise
    for sub_problem in &sub_problems {
        // Analyze
        let mut step = analyze_step(&full_question, sub_problem, &steps, step_num).await;

        // Self-critique
        let critiques = critique_step(&step, &full_question).await;
        step.critiques = critiques.clone();

        // Revise if confidence is low or critiques are substantial
        if step.confidence < 0.6 || !critiques.is_empty() {
            let revised = revise_step(&step, &critiques).await;
            step.revised = Some(revised);
        }

        steps.push(step.clone());

        // Emit event so the frontend can show live progress
        let _ = app.emit(
            "blade_reasoning_step",
            &StepEvent {
                trace_id: trace_id.clone(),
                step: step.clone(),
            },
        );

        step_num += 1;
    }

    // Step 3: synthesize
    let (final_answer, total_confidence) = synthesize_answer(&full_question, &steps).await;

    // Emit a conclude step
    let conclude_step = ReasoningStep {
        step_num,
        thought: crate::safe_slice(&final_answer, 500).to_string(),
        confidence: total_confidence,
        step_type: "conclude".to_string(),
        critiques: vec![],
        revised: None,
    };
    let _ = app.emit(
        "blade_reasoning_step",
        &StepEvent {
            trace_id: trace_id.clone(),
            step: conclude_step.clone(),
        },
    );

    // Step 4: self-assess quality
    let reasoning_quality = assess_quality(&full_question, &steps, &final_answer).await;

    let mut all_steps = steps;
    all_steps.push(conclude_step);

    let trace = ReasoningTrace {
        id: trace_id,
        question: question.to_string(),
        steps: all_steps,
        final_answer,
        total_confidence,
        reasoning_quality,
        created_at,
    };

    let _ = save_trace(&trace);

    Ok(trace)
}

// ── History queries ────────────────────────────────────────────────────────────

pub fn get_recent_traces(limit: usize) -> Vec<ReasoningTrace> {
    let conn = match rusqlite::Connection::open(db_path()) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut stmt = match conn.prepare(
        "SELECT id, question, steps, final_answer, total_confidence, reasoning_quality, created_at \
         FROM reasoning_traces ORDER BY created_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![limit as i64], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })
    .ok()
    .map(|rows| {
        rows.filter_map(|r| r.ok())
            .filter_map(|(id, question, steps_json, final_answer, total_confidence, reasoning_quality, created_at)| {
                load_trace_row(id, question, steps_json, final_answer, total_confidence, reasoning_quality, created_at)
            })
            .collect()
    })
    .unwrap_or_default()
}

#[allow(dead_code)]
pub fn get_trace(id: &str) -> Option<ReasoningTrace> {
    let conn = rusqlite::Connection::open(db_path()).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, question, steps, final_answer, total_confidence, reasoning_quality, created_at \
             FROM reasoning_traces WHERE id = ?1",
        )
        .ok()?;

    stmt.query_row(params![id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })
    .ok()
    .and_then(|(id, question, steps_json, final_answer, total_confidence, reasoning_quality, created_at)| {
        load_trace_row(id, question, steps_json, final_answer, total_confidence, reasoning_quality, created_at)
    })
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

/// Full multi-step reasoning pipeline with streaming step events.
#[tauri::command]
pub async fn reasoning_think(
    app: tauri::AppHandle,
    question: String,
    context: Option<String>,
    max_steps: Option<usize>,
) -> Result<ReasoningTrace, String> {
    let ctx = context.unwrap_or_default();
    let steps = max_steps.unwrap_or(5).min(10).max(1);
    reason_through(&question, &ctx, steps, app).await
}

/// Decompose a question into sub-problems without running the full pipeline.
#[tauri::command]
pub async fn reasoning_decompose(question: String) -> Result<Vec<String>, String> {
    Ok(decompose_problem(&question).await)
}

/// Adversarial hypothesis testing — tries to disprove before confirming.
#[tauri::command]
pub async fn reasoning_test_hypothesis(
    hypothesis: String,
    evidence: String,
) -> Result<HypothesisTest, String> {
    Ok(test_hypothesis(&hypothesis, &evidence).await)
}

/// Socratic depth-drilling on a topic.
#[tauri::command]
pub async fn reasoning_socratic(
    question: String,
    depth: Option<usize>,
) -> Result<Vec<(String, String)>, String> {
    let d = depth.unwrap_or(3);
    Ok(socratic_dialogue(&question, d).await)
}

/// Return recent reasoning traces.
#[tauri::command]
pub fn reasoning_get_traces(limit: Option<usize>) -> Vec<ReasoningTrace> {
    let _ = ensure_tables();
    get_recent_traces(limit.unwrap_or(20))
}
