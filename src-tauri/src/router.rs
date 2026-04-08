use serde::{Deserialize, Serialize};

/// Classify what kind of task a message is, to route to the right model
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskType {
    /// Simple chat, greetings, quick answers
    Simple,
    /// Code generation, debugging, technical
    Code,
    /// Analysis, reasoning, complex questions
    Complex,
    /// Image/vision related
    Vision,
    /// Creative writing, brainstorming
    Creative,
}

/// Classify a user message to determine routing
pub fn classify_task(message: &str, has_image: bool) -> TaskType {
    if has_image {
        return TaskType::Vision;
    }

    let lower = message.to_lowercase();

    // Code signals
    let code_signals = [
        "code", "function", "error", "bug", "debug", "compile", "syntax",
        "implement", "refactor", "api", "endpoint", "database", "query",
        "```", "def ", "fn ", "class ", "import ", "const ", "let ", "var ",
        "rust", "python", "javascript", "typescript",
    ];
    let code_score: usize = code_signals.iter().filter(|s| lower.contains(*s)).count();

    // Complex signals
    let complex_signals = [
        "explain", "analyze", "compare", "why", "how does", "trade-off",
        "architecture", "design", "strategy", "plan", "review",
        "what are the implications", "pros and cons",
    ];
    let complex_score: usize = complex_signals.iter().filter(|s| lower.contains(*s)).count();

    // Creative signals
    let creative_signals = [
        "write", "draft", "compose", "story", "poem", "essay",
        "brainstorm", "ideas", "name", "slogan", "tagline",
    ];
    let creative_score: usize = creative_signals.iter().filter(|s| lower.contains(*s)).count();

    // Simple: short messages, greetings, yes/no
    if message.len() < 20 {
        return TaskType::Simple;
    }

    if code_score >= 2 {
        return TaskType::Code;
    }
    if complex_score >= 2 {
        return TaskType::Complex;
    }
    if creative_score >= 2 {
        return TaskType::Creative;
    }

    // Default based on length
    if message.len() > 200 {
        TaskType::Complex
    } else {
        TaskType::Simple
    }
}

/// Suggest the best model for a task type given the provider
pub fn suggest_model(provider: &str, task: &TaskType) -> Option<String> {
    match provider {
        "groq" => match task {
            TaskType::Simple => Some("llama-3.3-70b-versatile".to_string()),
            TaskType::Code => Some("llama-3.3-70b-versatile".to_string()),
            TaskType::Complex => Some("llama-3.3-70b-versatile".to_string()),
            TaskType::Vision => Some("llama-3.2-90b-vision-preview".to_string()),
            TaskType::Creative => Some("llama-3.3-70b-versatile".to_string()),
        },
        "openai" => match task {
            TaskType::Simple => Some("gpt-4o-mini".to_string()),
            TaskType::Code | TaskType::Complex => Some("gpt-4o".to_string()),
            TaskType::Vision => Some("gpt-4o".to_string()),
            TaskType::Creative => Some("gpt-4o".to_string()),
        },
        "anthropic" => match task {
            TaskType::Simple => Some("claude-haiku-4-5-20251001".to_string()),
            TaskType::Code | TaskType::Complex => Some("claude-sonnet-4-20250514".to_string()),
            TaskType::Vision => Some("claude-sonnet-4-20250514".to_string()),
            TaskType::Creative => Some("claude-sonnet-4-20250514".to_string()),
        },
        "gemini" => match task {
            TaskType::Simple => Some("gemini-2.0-flash".to_string()),
            TaskType::Code | TaskType::Complex => Some("gemini-2.5-pro-preview-06-05".to_string()),
            TaskType::Vision => Some("gemini-2.0-flash".to_string()),
            TaskType::Creative => Some("gemini-2.5-pro-preview-06-05".to_string()),
        },
        _ => None,
    }
}

#[tauri::command]
pub fn classify_message(message: String, has_image: bool) -> TaskType {
    classify_task(&message, has_image)
}
