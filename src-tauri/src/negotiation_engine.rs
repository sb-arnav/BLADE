/// BLADE Negotiation Engine — Debate Coach + Negotiation Assistant
///
/// Gives BLADE the ability to argue, debate, and negotiate on complex topics.
/// When the user faces a decision, BLADE can simulate multiple perspectives,
/// argue both sides, predict counterarguments, and help craft winning positions.
///
/// Think: a debate coach, devil's advocate, and negotiation strategist in one.
#[allow(dead_code)]

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

// ── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Argument {
    pub position: String,
    pub supporting_points: Vec<String>,
    pub evidence: Vec<String>,
    pub weaknesses: Vec<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateRound {
    pub round_num: i32,
    pub user_argument: Argument,
    pub opponent_argument: Argument,
    pub blade_coaching: String, // BLADE's private coaching to the user
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateSession {
    pub id: String,
    pub topic: String,
    pub user_position: String,
    pub opponent_position: String,
    pub rounds: Vec<DebateRound>,
    pub verdict: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NegotiationScenario {
    pub id: String,
    pub context: String,        // "salary negotiation", "contract terms", "conflict resolution"
    pub user_goal: String,
    pub their_likely_goal: String,
    pub tactics: Vec<String>,
    pub scripts: Vec<String>,   // word-for-word what to say
    pub batna: String,          // Best Alternative To Negotiated Agreement
    pub created_at: i64,
}

// ── Database ──────────────────────────────────────────────────────────────────

fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("negotiation.db");
    rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("NegotiationDB open error: {e}"))
}

pub fn ensure_tables() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => { eprintln!("negotiation_engine: ensure_tables failed: {e}"); return; }
    };

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS debate_sessions (
            id          TEXT PRIMARY KEY,
            topic       TEXT NOT NULL,
            user_pos    TEXT NOT NULL,
            opp_pos     TEXT NOT NULL,
            rounds_json TEXT NOT NULL DEFAULT '[]',
            verdict     TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS negotiation_scenarios (
            id              TEXT PRIMARY KEY,
            context         TEXT NOT NULL,
            user_goal       TEXT NOT NULL,
            their_goal      TEXT NOT NULL,
            tactics_json    TEXT NOT NULL DEFAULT '[]',
            scripts_json    TEXT NOT NULL DEFAULT '[]',
            batna           TEXT NOT NULL DEFAULT '',
            created_at      INTEGER NOT NULL
        );"
    );
}

// ── LLM helpers ───────────────────────────────────────────────────────────────

fn get_quality_provider() -> (String, String, String) {
    let config = crate::config::load_config();
    // Complex / strategic tasks always go to the best available model
    crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex)
}

fn strip_json_fences(s: &str) -> &str {
    crate::strip_json_fences(s)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, uuid_v4())
}

fn uuid_v4() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    now_secs().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    format!("{:016x}{:016x}", h.finish(), h.finish().wrapping_mul(6364136223846793005))
}

// ── Argumentation ─────────────────────────────────────────────────────────────

/// Build a rigorous argument for the given position on a topic.
pub async fn build_argument(topic: &str, position: &str, context: &str) -> Result<Argument, String> {
    let (provider, api_key, model) = get_quality_provider();

    let prompt = format!(
        "You are a master debate coach. Build a rigorous argument for this position.\n\n\
         Topic: {}\n\
         Position to argue: {}\n\
         Context: {}\n\n\
         Return ONLY a JSON object with this structure:\n\
         {{\n\
           \"position\": \"clear restatement of the position\",\n\
           \"supporting_points\": [\"point 1\", \"point 2\", \"point 3\", \"point 4\"],\n\
           \"evidence\": [\"specific example or data 1\", \"specific example or data 2\", \"specific example or data 3\"],\n\
           \"weaknesses\": [\"honest weakness 1\", \"honest weakness 2\"],\n\
           \"confidence\": 0.8\n\
         }}\n\n\
         Make supporting_points concrete and persuasive. Evidence should be specific. \
         Weaknesses should be honest (this helps us prepare counter-arguments). \
         Confidence is 0.0-1.0 based on how strong this position truly is.",
        topic, position, context
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in build_argument: {e}"))?;

    let raw = strip_json_fences(turn.content.trim());
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("JSON parse error in build_argument: {e}\nRaw: {}", crate::safe_slice(raw, 200)))?;

    Ok(Argument {
        position: v["position"].as_str().unwrap_or(position).to_string(),
        supporting_points: v["supporting_points"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        evidence: v["evidence"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        weaknesses: v["weaknesses"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        confidence: v["confidence"].as_f64().unwrap_or(0.7) as f32,
    })
}

/// Steel-man the opposing view — constructs the strongest possible version of their argument.
pub async fn steelman_opponent(topic: &str, opponent_position: &str) -> Result<Argument, String> {
    let (provider, api_key, model) = get_quality_provider();

    let prompt = format!(
        "You are a steel-manning expert. Your job is to construct the STRONGEST possible \
         version of the opposing argument — not a straw man, but the best version that \
         a brilliant, well-informed advocate would make.\n\n\
         Topic: {}\n\
         Their position: {}\n\n\
         Return ONLY a JSON object:\n\
         {{\n\
           \"position\": \"the strongest possible restatement of their position\",\n\
           \"supporting_points\": [\"their best argument 1\", \"their best argument 2\", \"their best argument 3\", \"their best argument 4\"],\n\
           \"evidence\": [\"their strongest evidence 1\", \"their strongest evidence 2\", \"their strongest evidence 3\"],\n\
           \"weaknesses\": [\"even this strong version has weakness 1\", \"weakness 2\"],\n\
           \"confidence\": 0.75\n\
         }}\n\n\
         Be intellectually honest. If their position has genuine merit, show it clearly. \
         This is for debate prep — we need to know exactly what we're up against.",
        topic, opponent_position
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in steelman_opponent: {e}"))?;

    let raw = strip_json_fences(turn.content.trim());
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("JSON parse error in steelman_opponent: {e}"))?;

    Ok(Argument {
        position: v["position"].as_str().unwrap_or(opponent_position).to_string(),
        supporting_points: v["supporting_points"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        evidence: v["evidence"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        weaknesses: v["weaknesses"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        confidence: v["confidence"].as_f64().unwrap_or(0.7) as f32,
    })
}

/// Find synthesis or middle ground between two positions.
pub async fn find_common_ground(pos_a: &str, pos_b: &str, topic: &str) -> Result<String, String> {
    let (provider, api_key, model) = get_quality_provider();

    let prompt = format!(
        "Two people are in disagreement. Your job is to find genuine common ground and \
         a potential synthesis that both sides could accept.\n\n\
         Topic: {}\n\
         Position A: {}\n\
         Position B: {}\n\n\
         Analyze:\n\
         1. What values do both sides actually share?\n\
         2. Where do they factually agree?\n\
         3. What is a potential synthesis or compromise that honors both positions' core concerns?\n\
         4. What would it take for each side to accept this synthesis?\n\n\
         Write a thoughtful 3-5 paragraph response. Be specific, not vague. \
         Do not just say 'find a middle ground' — articulate exactly what that middle ground is.",
        topic, pos_a, pos_b
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in find_common_ground: {e}"))?;

    Ok(turn.content.trim().to_string())
}

// ── Debate ─────────────────────────────────────────────────────────────────────

fn save_debate_session(session: &DebateSession) -> Result<(), String> {
    let conn = open_db()?;
    let rounds_json = serde_json::to_string(&session.rounds)
        .map_err(|e| format!("Serialize rounds error: {e}"))?;

    conn.execute(
        "INSERT INTO debate_sessions (id, topic, user_pos, opp_pos, rounds_json, verdict, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
             rounds_json = ?5,
             verdict     = ?6",
        params![
            session.id,
            session.topic,
            session.user_position,
            session.opponent_position,
            rounds_json,
            session.verdict,
            session.created_at
        ],
    ).map_err(|e| format!("DB save debate session error: {e}"))?;

    Ok(())
}

fn load_debate_session(session_id: &str) -> Option<DebateSession> {
    let conn = open_db().ok()?;

    let result = conn.query_row(
        "SELECT id, topic, user_pos, opp_pos, rounds_json, verdict, created_at
         FROM debate_sessions WHERE id = ?1",
        params![session_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, i64>(6)?,
            ))
        },
    ).ok()?;

    let (id, topic, user_pos, opp_pos, rounds_json, verdict, created_at) = result;
    let rounds: Vec<DebateRound> = serde_json::from_str(&rounds_json).unwrap_or_default();

    Some(DebateSession {
        id,
        topic,
        user_position: user_pos,
        opponent_position: opp_pos,
        rounds,
        verdict,
        created_at,
    })
}

/// Create a new debate session with initial arguments built for both sides.
pub async fn start_debate(topic: &str, user_position: &str) -> Result<DebateSession, String> {
    ensure_tables();

    // Build the user's argument and steel-man the opponent simultaneously
    let user_arg = build_argument(topic, user_position, "Initial debate round").await?;

    // Derive opponent position as the negation/alternative
    let opp_position = format!("The opposing view to: {}", crate::safe_slice(user_position, 200));
    let opp_arg = steelman_opponent(topic, &opp_position).await?;

    // Generate initial BLADE coaching
    let (provider, api_key, model) = get_quality_provider();
    let coaching_prompt = format!(
        "You are a private debate coach advising the user who is arguing: '{}'\n\n\
         The opponent's steel-manned position is: '{}'\n\n\
         Their strongest points are: {}\n\n\
         Give the user 3-4 specific tactical coaching tips for this debate. \
         What should they lead with? What traps should they avoid? \
         What is the opponent's Achilles heel? Keep it punchy and actionable.",
        crate::safe_slice(user_position, 300),
        crate::safe_slice(&opp_arg.position, 300),
        opp_arg.supporting_points.iter().take(2).cloned().collect::<Vec<_>>().join("; ")
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(coaching_prompt)];
    let coaching_turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error generating coaching: {e}"))?;

    let first_round = DebateRound {
        round_num: 1,
        user_argument: user_arg,
        opponent_argument: opp_arg.clone(),
        blade_coaching: coaching_turn.content.trim().to_string(),
    };

    let session = DebateSession {
        id: new_id("debate"),
        topic: topic.to_string(),
        user_position: user_position.to_string(),
        opponent_position: opp_arg.position,
        rounds: vec![first_round],
        verdict: None,
        created_at: now_secs(),
    };

    save_debate_session(&session)?;
    Ok(session)
}

/// Simulate opponent responding to user's latest message and give BLADE coaching.
/// Emits `blade_debate_update` event with round data.
pub async fn debate_round(
    session_id: &str,
    user_message: &str,
    app: tauri::AppHandle,
) -> Result<DebateRound, String> {
    let mut session = load_debate_session(session_id)
        .ok_or_else(|| format!("Debate session not found: {session_id}"))?;

    let round_num = session.rounds.len() as i32 + 1;
    let (provider, api_key, model) = get_quality_provider();

    // Build context from previous rounds
    let history_summary = if session.rounds.is_empty() {
        String::new()
    } else {
        let prev: Vec<String> = session.rounds.iter().map(|r| {
            format!(
                "Round {}: User argued '{}'. Opponent argued '{}'.",
                r.round_num,
                crate::safe_slice(&r.user_argument.position, 150),
                crate::safe_slice(&r.opponent_argument.position, 150)
            )
        }).collect();
        prev.join("\n")
    };

    use crate::providers::{complete_turn, ConversationMessage};

    // Build user's argument from their message
    let user_arg_prompt = format!(
        "You are helping formalize a debate argument. \
         Topic: '{}'\n\
         User's position: '{}'\n\
         User's current message/argument: '{}'\n\
         Previous rounds: {}\n\n\
         Formalize this into a structured argument. Return ONLY JSON:\n\
         {{\n\
           \"position\": \"clear position statement\",\n\
           \"supporting_points\": [\"point 1\", \"point 2\", \"point 3\"],\n\
           \"evidence\": [\"evidence 1\", \"evidence 2\"],\n\
           \"weaknesses\": [\"weakness 1\"],\n\
           \"confidence\": 0.75\n\
         }}",
        session.topic, session.user_position,
        crate::safe_slice(user_message, 500),
        crate::safe_slice(&history_summary, 400)
    );

    let user_conv = vec![ConversationMessage::User(user_arg_prompt)];
    let user_turn = complete_turn(&provider, &api_key, &model, &user_conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error building user argument: {e}"))?;

    let user_arg_raw = strip_json_fences(user_turn.content.trim());
    let user_v: serde_json::Value = serde_json::from_str(user_arg_raw).unwrap_or_else(|_| {
        serde_json::json!({
            "position": user_message,
            "supporting_points": [],
            "evidence": [],
            "weaknesses": [],
            "confidence": 0.7
        })
    });

    let user_argument = Argument {
        position: user_v["position"].as_str().unwrap_or(user_message).to_string(),
        supporting_points: user_v["supporting_points"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        evidence: user_v["evidence"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        weaknesses: user_v["weaknesses"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        confidence: user_v["confidence"].as_f64().unwrap_or(0.7) as f32,
    };

    // Generate opponent's counter-argument
    let opp_prompt = format!(
        "You are roleplaying as a skilled debater opposing the position: '{}'\n\
         Topic: '{}'\n\
         The user just argued: '{}'\n\
         Previous debate history: {}\n\n\
         Generate a sharp, intelligent counter-argument. \
         Attack their weakest points, introduce new evidence, and advance your own position. \
         Return ONLY JSON:\n\
         {{\n\
           \"position\": \"your counter-position\",\n\
           \"supporting_points\": [\"counter-point 1\", \"counter-point 2\", \"counter-point 3\"],\n\
           \"evidence\": [\"evidence against them 1\", \"evidence for you 1\"],\n\
           \"weaknesses\": [\"where your counter-argument is vulnerable\"],\n\
           \"confidence\": 0.8\n\
         }}",
        session.opponent_position,
        session.topic,
        crate::safe_slice(user_message, 400),
        crate::safe_slice(&history_summary, 400)
    );

    let opp_conv = vec![ConversationMessage::User(opp_prompt)];
    let opp_turn = complete_turn(&provider, &api_key, &model, &opp_conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error generating opponent argument: {e}"))?;

    let opp_raw = strip_json_fences(opp_turn.content.trim());
    let opp_v: serde_json::Value = serde_json::from_str(opp_raw).unwrap_or_else(|_| {
        serde_json::json!({
            "position": "Opponent counter-argument",
            "supporting_points": [],
            "evidence": [],
            "weaknesses": [],
            "confidence": 0.7
        })
    });

    let opponent_argument = Argument {
        position: opp_v["position"].as_str().unwrap_or("Counter-position").to_string(),
        supporting_points: opp_v["supporting_points"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        evidence: opp_v["evidence"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        weaknesses: opp_v["weaknesses"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        confidence: opp_v["confidence"].as_f64().unwrap_or(0.7) as f32,
    };

    // BLADE coaches the user on how to respond to the opponent's counter-argument
    let coaching_prompt = format!(
        "You are a private debate coach. The user is arguing: '{}'\n\
         The opponent just countered with: '{}'\n\
         Their strongest points: {}\n\n\
         Give the user 3 specific, tactical pieces of advice for their NEXT response. \
         What is the opponent's weakest point to attack? What new evidence should they introduce? \
         What rhetorical move will be most effective? Be direct and specific — no fluff.",
        crate::safe_slice(&session.user_position, 200),
        crate::safe_slice(&opponent_argument.position, 200),
        opponent_argument.supporting_points.iter().take(2).cloned().collect::<Vec<_>>().join("; ")
    );

    let coach_conv = vec![ConversationMessage::User(coaching_prompt)];
    let coach_turn = complete_turn(&provider, &api_key, &model, &coach_conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error generating coaching: {e}"))?;

    let round = DebateRound {
        round_num,
        user_argument,
        opponent_argument,
        blade_coaching: coach_turn.content.trim().to_string(),
    };

    session.rounds.push(round.clone());
    save_debate_session(&session)?;

    // Emit event with round data
    let _ = app.emit_to("main", "blade_debate_update", serde_json::json!({
        "session_id": session_id,
        "round_num": round_num,
        "round": round
    }));

    Ok(round)
}

/// LLM judges who made stronger arguments overall and suggests improvements.
pub async fn conclude_debate(session_id: &str) -> Result<String, String> {
    let mut session = load_debate_session(session_id)
        .ok_or_else(|| format!("Debate session not found: {session_id}"))?;

    if session.rounds.is_empty() {
        return Err("No rounds to judge — debate hasn't started".to_string());
    }

    let (provider, api_key, model) = get_quality_provider();

    // Summarize the debate for the judge
    let rounds_summary: Vec<String> = session.rounds.iter().map(|r| {
        format!(
            "Round {}: User — '{}' (confidence: {:.0}%). Opponent — '{}' (confidence: {:.0}%).",
            r.round_num,
            crate::safe_slice(&r.user_argument.position, 200),
            r.user_argument.confidence * 100.0,
            crate::safe_slice(&r.opponent_argument.position, 200),
            r.opponent_argument.confidence * 100.0
        )
    }).collect();

    let prompt = format!(
        "You are an impartial debate judge. Evaluate this debate and render a verdict.\n\n\
         Topic: {}\n\
         User's position: {}\n\
         Opponent's position: {}\n\n\
         Debate summary:\n{}\n\n\
         Provide a comprehensive judgment covering:\n\
         1. Who made the stronger overall argument and why\n\
         2. The 2-3 strongest moments for the user\n\
         3. Where the user lost ground and why\n\
         4. Specific improvements for next time\n\
         5. Final verdict: who won this debate, and by what margin (decisive/narrow/draw)\n\n\
         Be honest, specific, and educational. This is for learning.",
        session.topic,
        session.user_position,
        session.opponent_position,
        rounds_summary.join("\n")
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in conclude_debate: {e}"))?;

    let verdict = turn.content.trim().to_string();
    session.verdict = Some(verdict.clone());
    save_debate_session(&session)?;

    Ok(verdict)
}

// ── Negotiation ───────────────────────────────────────────────────────────────

fn save_negotiation_scenario(scenario: &NegotiationScenario) -> Result<(), String> {
    let conn = open_db()?;
    let tactics_json = serde_json::to_string(&scenario.tactics)
        .map_err(|e| format!("Serialize tactics error: {e}"))?;
    let scripts_json = serde_json::to_string(&scenario.scripts)
        .map_err(|e| format!("Serialize scripts error: {e}"))?;

    conn.execute(
        "INSERT INTO negotiation_scenarios
             (id, context, user_goal, their_goal, tactics_json, scripts_json, batna, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
             tactics_json = ?5,
             scripts_json = ?6,
             batna        = ?7",
        params![
            scenario.id,
            scenario.context,
            scenario.user_goal,
            scenario.their_likely_goal,
            tactics_json,
            scripts_json,
            scenario.batna,
            scenario.created_at
        ],
    ).map_err(|e| format!("DB save negotiation scenario error: {e}"))?;

    Ok(())
}

fn load_negotiation_scenario(scenario_id: &str) -> Option<NegotiationScenario> {
    let conn = open_db().ok()?;

    let result = conn.query_row(
        "SELECT id, context, user_goal, their_goal, tactics_json, scripts_json, batna, created_at
         FROM negotiation_scenarios WHERE id = ?1",
        params![scenario_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
            ))
        },
    ).ok()?;

    let (id, context, user_goal, their_goal, tactics_json, scripts_json, batna, created_at) = result;

    Some(NegotiationScenario {
        id,
        context,
        user_goal,
        their_likely_goal: their_goal,
        tactics: serde_json::from_str(&tactics_json).unwrap_or_default(),
        scripts: serde_json::from_str(&scripts_json).unwrap_or_default(),
        batna,
        created_at,
    })
}

/// Full negotiation prep: analyzes the scenario and produces tactics, scripts, and BATNA.
pub async fn analyze_negotiation(
    context: &str,
    user_goal: &str,
    their_info: &str,
) -> Result<NegotiationScenario, String> {
    ensure_tables();

    let (provider, api_key, model) = get_quality_provider();

    let prompt = format!(
        "You are a world-class negotiation strategist trained in Harvard Negotiation Project \
         principles, FBI hostage negotiation tactics, and corporate deal-making.\n\n\
         Negotiation context: {}\n\
         What the user wants to achieve: {}\n\
         Information about the other party: {}\n\n\
         Create a comprehensive negotiation playbook. Return ONLY a JSON object:\n\
         {{\n\
           \"their_likely_goal\": \"what they probably want most\",\n\
           \"tactics\": [\n\
             \"Tactic 1: Anchoring — [specific instruction]\",\n\
             \"Tactic 2: Mirroring — [specific instruction]\",\n\
             \"Tactic 3: ZOPA analysis — [specific instruction]\",\n\
             \"Tactic 4: Strategic concession — [specific instruction]\",\n\
             \"Tactic 5: Time pressure — [specific instruction]\"\n\
           ],\n\
           \"scripts\": [\n\
             \"Opening: '[exact words to say]'\",\n\
             \"When they resist: '[exact words to say]'\",\n\
             \"Closing: '[exact words to say]'\",\n\
             \"If it falls apart: '[exact words to say]'\"\n\
           ],\n\
           \"batna\": \"Your best alternative if this negotiation fails: [specific alternative and why it matters]\"\n\
         }}\n\n\
         Scripts must be word-for-word, ready to say out loud. Tactics must be specific \
         to this scenario, not generic advice.",
        context, user_goal, their_info
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in analyze_negotiation: {e}"))?;

    let raw = strip_json_fences(turn.content.trim());
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| format!("JSON parse error in analyze_negotiation: {e}\nRaw: {}", crate::safe_slice(raw, 200)))?;

    let scenario = NegotiationScenario {
        id: new_id("nego"),
        context: context.to_string(),
        user_goal: user_goal.to_string(),
        their_likely_goal: v["their_likely_goal"].as_str().unwrap_or("Unknown").to_string(),
        tactics: v["tactics"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        scripts: v["scripts"].as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.to_string()).collect())
            .unwrap_or_default(),
        batna: v["batna"].as_str().unwrap_or("No clear alternative identified").to_string(),
        created_at: now_secs(),
    };

    save_negotiation_scenario(&scenario)?;
    Ok(scenario)
}

/// BLADE plays the opponent — the user practices their negotiation responses.
pub async fn roleplay_negotiation(scenario_id: &str, their_message: &str) -> Result<String, String> {
    let scenario = load_negotiation_scenario(scenario_id)
        .ok_or_else(|| format!("Negotiation scenario not found: {scenario_id}"))?;

    let (provider, api_key, model) = get_quality_provider();

    let prompt = format!(
        "You are roleplaying as the OTHER PARTY in a negotiation. Stay fully in character.\n\n\
         Negotiation context: {}\n\
         Your character's likely goal: {}\n\
         The user (negotiating with you) just said: {}\n\n\
         Respond as the other party would — push back, probe, make demands, or show interest \
         based on what they said. Be realistic: sometimes resist, sometimes show openness, \
         sometimes throw in a curveball. \
         Keep your response to 2-4 sentences — this is a real-time roleplay.",
        scenario.context,
        scenario.their_likely_goal,
        crate::safe_slice(their_message, 500)
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in roleplay_negotiation: {e}"))?;

    Ok(turn.content.trim().to_string())
}

/// BLADE critiques the user's proposed negotiation move before they make it.
pub async fn critique_negotiation_move(scenario_id: &str, user_move: &str) -> Result<String, String> {
    let scenario = load_negotiation_scenario(scenario_id)
        .ok_or_else(|| format!("Negotiation scenario not found: {scenario_id}"))?;

    let (provider, api_key, model) = get_quality_provider();

    let prompt = format!(
        "You are a tough negotiation coach reviewing a move before it's made.\n\n\
         Negotiation context: {}\n\
         User wants to achieve: {}\n\
         Other party likely wants: {}\n\
         User's BATNA: {}\n\
         Recommended tactics: {}\n\n\
         The user is about to say/do: '{}'\n\n\
         Give a direct, honest critique:\n\
         1. What's RIGHT about this move (be specific)\n\
         2. What's WRONG or risky about this move (be direct — don't soften)\n\
         3. How the other party will likely REACT\n\
         4. A BETTER alternative move to consider\n\n\
         Be a tough coach, not a cheerleader. If it's a bad move, say so clearly.",
        scenario.context,
        scenario.user_goal,
        scenario.their_likely_goal,
        crate::safe_slice(&scenario.batna, 200),
        scenario.tactics.iter().take(3).cloned().collect::<Vec<_>>().join("; "),
        crate::safe_slice(user_move, 400)
    );

    use crate::providers::{complete_turn, ConversationMessage};
    let conv = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &conv, &crate::providers::no_tools(), None).await
        .map_err(|e| format!("LLM error in critique_negotiation_move: {e}"))?;

    Ok(turn.content.trim().to_string())
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

pub fn get_debate_sessions(limit: usize) -> Vec<DebateSession> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, topic, user_pos, opp_pos, rounds_json, verdict, created_at
         FROM debate_sessions ORDER BY created_at DESC LIMIT ?1"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, i64>(6)?,
        ))
    });

    match rows {
        Ok(r) => r.filter_map(|row| row.ok()).map(|(id, topic, user_pos, opp_pos, rounds_json, verdict, created_at)| {
            DebateSession {
                id,
                topic,
                user_position: user_pos,
                opponent_position: opp_pos,
                rounds: serde_json::from_str(&rounds_json).unwrap_or_default(),
                verdict,
                created_at,
            }
        }).collect(),
        Err(_) => Vec::new(),
    }
}

pub fn get_negotiation_scenarios(limit: usize) -> Vec<NegotiationScenario> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut stmt = match conn.prepare(
        "SELECT id, context, user_goal, their_goal, tactics_json, scripts_json, batna, created_at
         FROM negotiation_scenarios ORDER BY created_at DESC LIMIT ?1"
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, i64>(7)?,
        ))
    });

    match rows {
        Ok(r) => r.filter_map(|row| row.ok()).map(|(id, context, user_goal, their_goal, tactics_json, scripts_json, batna, created_at)| {
            NegotiationScenario {
                id,
                context,
                user_goal,
                their_likely_goal: their_goal,
                tactics: serde_json::from_str(&tactics_json).unwrap_or_default(),
                scripts: serde_json::from_str(&scripts_json).unwrap_or_default(),
                batna,
                created_at,
            }
        }).collect(),
        Err(_) => Vec::new(),
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn negotiation_build_argument(
    topic: String,
    position: String,
    context: String,
) -> Result<Argument, String> {
    ensure_tables();
    build_argument(&topic, &position, &context).await
}

#[tauri::command]
pub async fn negotiation_steelman(
    topic: String,
    opponent_position: String,
) -> Result<Argument, String> {
    ensure_tables();
    steelman_opponent(&topic, &opponent_position).await
}

#[tauri::command]
pub async fn negotiation_find_common_ground(
    pos_a: String,
    pos_b: String,
    topic: String,
) -> Result<String, String> {
    negotiation_common_ground_inner(&pos_a, &pos_b, &topic).await
}

async fn negotiation_common_ground_inner(pos_a: &str, pos_b: &str, topic: &str) -> Result<String, String> {
    find_common_ground(pos_a, pos_b, topic).await
}

#[tauri::command]
pub async fn negotiation_start_debate(
    topic: String,
    user_position: String,
) -> Result<DebateSession, String> {
    start_debate(&topic, &user_position).await
}

#[tauri::command]
pub async fn negotiation_round(
    session_id: String,
    user_message: String,
    app: tauri::AppHandle,
) -> Result<DebateRound, String> {
    debate_round(&session_id, &user_message, app).await
}

#[tauri::command]
pub async fn negotiation_conclude(session_id: String) -> Result<String, String> {
    conclude_debate(&session_id).await
}

#[tauri::command]
pub async fn negotiation_analyze(
    context: String,
    user_goal: String,
    their_info: String,
) -> Result<NegotiationScenario, String> {
    analyze_negotiation(&context, &user_goal, &their_info).await
}

#[tauri::command]
pub async fn negotiation_roleplay(
    scenario_id: String,
    their_message: String,
) -> Result<String, String> {
    roleplay_negotiation(&scenario_id, &their_message).await
}

#[tauri::command]
pub async fn negotiation_critique_move(
    scenario_id: String,
    user_move: String,
) -> Result<String, String> {
    critique_negotiation_move(&scenario_id, &user_move).await
}

#[tauri::command]
pub fn negotiation_get_debates(limit: usize) -> Vec<DebateSession> {
    ensure_tables();
    get_debate_sessions(limit)
}

#[tauri::command]
pub fn negotiation_get_scenarios(limit: usize) -> Vec<NegotiationScenario> {
    ensure_tables();
    get_negotiation_scenarios(limit)
}
