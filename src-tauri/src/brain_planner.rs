/// BRAIN PLANNER — BLADE's task decomposition layer.
///
/// When the user asks something complex ("post on X about what I'm working on",
/// "deploy and notify the team", "research competitors and write a report"),
/// the Brain planner makes a SEPARATE LLM call to produce a structured plan
/// BEFORE the main chat model runs.
///
/// The plan is injected into the system prompt so the chat model's tool loop
/// has clear directions instead of figuring it out ad-hoc.
///
/// Brain prompt is small (~2000-3000 tokens): identity + organ roster + user query.
/// No hallucination bait — just "here's what you have, here's what was asked, make a plan."

/// Produce a structured plan for a complex user request.
///
/// Returns a markdown plan string to inject into the system prompt,
/// or empty string if planning fails or isn't needed.
pub async fn plan_task(
    user_query: &str,
    hive_digest: &str,
    dna_context: &str,
) -> String {
    let config = crate::config::load_config();
    if config.api_key.is_empty() && config.provider != "ollama" {
        return String::new();
    }

    // Use the fast task routing if configured (e.g. Groq for speed),
    // otherwise fall back to cheap model on the active provider
    let (provider, api_key, model) = {
        let (p, k, m) = crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Simple);
        // If routing gave us a fast provider, use it; otherwise use cheap model
        if p != config.provider && !k.is_empty() {
            (p, k, m)
        } else {
            let cheap = crate::config::cheap_model_for_provider(&config.provider, &config.model);
            (config.provider.clone(), config.api_key.clone(), cheap)
        }
    };

    // Get the organ roster so Brain knows exactly what each organ can do
    let organ_roster = crate::organ::get_organ_roster_for_brain();

    let system = format!(
        r#"You are BLADE's Brain — the planning layer of a distributed AI agent system.

Your job: given a user request, produce a CONCRETE execution plan.

You know the following about BLADE's body:

{organ_roster}

{hive_digest}

{dna_context}

RULES:
- Produce 3-8 numbered steps, each one clear action
- Reference specific organs/tools when possible (e.g. "use GitHub organ to check PRs")
- If a step needs user approval before proceeding, mark it with [APPROVAL]
- If you don't have an organ for something, say "use browser to..." or "use bash to..."
- Be specific — "check recent commits" not "gather context"
- Think about what data you need BEFORE you act (gather first, then execute)
- End with what to show the user

Respond with ONLY the numbered plan. No preamble, no explanation, no markdown headers."#
    );

    let user_msg = format!("User request: {}", user_query);

    let messages = vec![
        crate::providers::ConversationMessage::System(system),
        crate::providers::ConversationMessage::User(user_msg),
    ];

    let result = crate::providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &crate::providers::no_tools(),
        None, // Brain planner always uses standard endpoints
    )
    .await;

    match result {
        Ok(turn) => {
            let plan = turn.content.trim().to_string();
            if plan.is_empty() || plan.len() < 20 {
                return String::new();
            }
            format!(
                "## BLADE Brain Plan\n\n\
                 The Brain analyzed this request and produced this execution plan. \
                 Follow it step by step, adapting if a step fails:\n\n\
                 {}\n\n\
                 Execute this plan now using your available tools. \
                 If a step is marked [APPROVAL], show the result and wait for user confirmation before continuing.",
                plan
            )
        }
        Err(e) => {
            log::warn!("[BrainPlanner] Planning failed: {}", e);
            String::new()
        }
    }
}
