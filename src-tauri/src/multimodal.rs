use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs;

// ─── Structs ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAnalysis {
    /// What's visible in the image — objects, scene, layout
    pub description: String,
    /// All text detected in the image (verbatim, OCR-style)
    pub text_content: String,
    /// Any code blocks found in the image
    pub code_blocks: Vec<String>,
    /// Action items suggested by the image content
    pub action_items: Vec<String>,
    /// Questions BLADE has about the image
    pub questions: Vec<String>,
    /// "screenshot" | "diagram" | "code" | "chart" | "handwriting" | "ui_mockup" | "other"
    pub category: String,
    pub analyzed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagramExtraction {
    pub nodes: Vec<String>,
    pub relationships: Vec<String>,
    /// Valid Mermaid.js code attempting to represent the diagram
    pub mermaid_code: String,
    pub description: String,
}

// ─── Vision support check ────────────────────────────────────────────────────

/// Returns true when the given provider is known to support image inputs.
/// For ollama the model name determines support — if it contains "vision" or "llava" it counts.
pub fn supports_vision(provider: &str) -> bool {
    match provider {
        "anthropic" | "openai" | "gemini" | "openrouter" => true,
        "groq" => false,
        "ollama" => false, // overridden per-model in the caller when model contains "vision"/"llava"
        _ => false,
    }
}

// ─── File helpers ────────────────────────────────────────────────────────────

/// Read an image file from disk and return raw base64 (no data-URI prefix).
pub fn image_to_base64(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read image '{}': {}", path, e))?;
    Ok(B64.encode(&bytes))
}

/// Detect MIME type from file extension (used for informational purposes).
#[allow(dead_code)]
pub fn mime_from_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/png" // sensible default
    }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/// Resolve the provider/key/model to use for a vision call.
/// Prefers the `vision` task-routing override when set and vision-capable,
/// falls back to the active provider.
fn resolve_vision_config() -> Result<(String, String, String), String> {
    let config = crate::config::load_config();

    // Check task routing for vision override
    let (provider, api_key) = if let Some(ref vision_provider) = config.task_routing.vision {
        if !vision_provider.is_empty() {
            // Try to get the key for the routed provider
            let key = crate::config::get_provider_key(vision_provider);
            if !key.is_empty() || vision_provider == "ollama" {
                (vision_provider.clone(), key)
            } else {
                (config.provider.clone(), config.api_key.clone())
            }
        } else {
            (config.provider.clone(), config.api_key.clone())
        }
    } else {
        (config.provider.clone(), config.api_key.clone())
    };

    // Validate that this provider supports vision
    let model_lc = config.model.to_lowercase();
    let provider_ok = supports_vision(&provider)
        || (provider == "ollama"
            && (model_lc.contains("vision") || model_lc.contains("llava")));

    if !provider_ok {
        return Err(format!(
            "Provider '{}' does not support vision. Use anthropic, openai, gemini, or an ollama vision model.",
            provider
        ));
    }

    if api_key.is_empty() && provider != "ollama" {
        return Err(format!(
            "No API key found for provider '{}'. Configure it in Settings.",
            provider
        ));
    }

    Ok((provider, api_key, config.model.clone()))
}

/// Send a single user message with an optional image to the configured vision provider
/// and return the raw text response.
async fn vision_complete(
    image_base64: &str,
    prompt: &str,
) -> Result<String, String> {
    use crate::providers::{self, ConversationMessage};

    let (provider, api_key, model) = resolve_vision_config()?;

    let messages = vec![ConversationMessage::UserWithImage {
        text: prompt.to_string(),
        image_base64: image_base64.to_string(),
    }];

    let turn = providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &[],
        None, // base_url — vision routing uses the standard endpoint
    )
    .await?;

    let text = turn.content.trim().to_string();
    if text.is_empty() {
        return Err("Vision provider returned an empty response.".to_string());
    }
    Ok(text)
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/// Pull all fenced code blocks from a markdown-style text response.
fn extract_code_blocks_from_text(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut in_block = false;
    let mut current: Vec<&str> = Vec::new();

    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            if in_block {
                // closing fence
                blocks.push(current.join("\n"));
                current.clear();
                in_block = false;
            } else {
                // opening fence — skip the fence line itself
                in_block = true;
            }
        } else if in_block {
            current.push(line);
        }
    }
    blocks
}

/// Extract the first fenced code block whose opening fence contains `lang`.
fn extract_named_block<'a>(text: &'a str, lang: &str) -> Option<String> {
    let lang_lower = lang.to_lowercase();
    let mut in_target = false;
    let mut current: Vec<&'a str> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if in_target {
                // closing fence
                return Some(current.join("\n"));
            }
            // opening fence — check language tag
            let fence_rest = trimmed.trim_start_matches('`').to_lowercase();
            if fence_rest.contains(&lang_lower) {
                in_target = true;
            }
        } else if in_target {
            current.push(line);
        }
    }
    None
}

/// Split a section of text by common list delimiters into a Vec<String>.
fn lines_to_vec(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| {
            l.trim()
                .trim_start_matches(|c: char| c == '-' || c == '*' || c == '•' || c.is_ascii_digit() || c == '.')
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .collect()
}

/// Best-effort parse of the `analyze_image` prompt response into an ImageAnalysis.
/// The prompt is structured so the LLM uses section headers — we find those and grab
/// the text under each one.
fn parse_analysis_response(text: &str, ts: i64) -> ImageAnalysis {
    // Helper: grab everything between two headings (or end of string)
    fn between<'a>(haystack: &'a str, start_marker: &str, end_markers: &[&str]) -> &'a str {
        let lower = haystack.to_lowercase();
        let start_lower = start_marker.to_lowercase();
        let pos = match lower.find(&start_lower) {
            Some(p) => p + start_marker.len(),
            None => return "",
        };
        let slice = &haystack[pos..];
        let slice_lower = slice.to_lowercase();
        let end = end_markers
            .iter()
            .filter_map(|m| slice_lower.find(&m.to_lowercase()))
            .min()
            .unwrap_or(slice.len());
        slice[..end].trim()
    }

    // Description — section 1
    let description_raw = between(
        text,
        "## 1",
        &["## 2", "## 3", "## 4", "## 5", "2)", "3)", "4)", "5)", "\n\n\n"],
    );
    let description = if description_raw.is_empty() {
        // Fallback: use the first paragraph
        text.splitn(3, "\n\n").next().unwrap_or(text).trim().to_string()
    } else {
        description_raw.to_string()
    };

    // Text content — section 2
    let text_content = between(
        text,
        "## 2",
        &["## 3", "## 4", "## 5", "3)", "4)", "5)", "\n\n\n"],
    )
    .to_string();

    // Code blocks — section 3 or from fenced blocks
    let code_raw = between(
        text,
        "## 3",
        &["## 4", "## 5", "4)", "5)", "\n\n\n"],
    );
    let code_blocks = if code_raw.contains("```") {
        extract_code_blocks_from_text(code_raw)
    } else if code_raw.trim().is_empty() {
        // Fall back to all code blocks in the whole text
        extract_code_blocks_from_text(text)
    } else {
        vec![]
    };

    // Action items — section 4
    let actions_raw = between(
        text,
        "## 4",
        &["## 5", "5)", "category:", "##category", "\n\n\n"],
    );
    let action_items = lines_to_vec(actions_raw);

    // Questions — section 5 (optional)
    let questions_raw = between(
        text,
        "## 5",
        &["category:", "##category", "**category", "\n\n\n"],
    );
    let questions = lines_to_vec(questions_raw);

    // Category — look for "Category:" label anywhere
    let category = {
        let lower = text.to_lowercase();
        let cat_pos = lower
            .find("category:")
            .or_else(|| lower.find("**category"))
            .or_else(|| lower.find("## category"));

        let raw_cat = if let Some(pos) = cat_pos {
            let rest = &text[pos..];
            rest.lines()
                .next()
                .unwrap_or("")
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_matches(|c: char| c == '*' || c == '#' || c == ' ')
                .to_lowercase()
        } else {
            String::new()
        };

        // Normalise to the known set
        match raw_cat.as_str() {
            s if s.contains("screenshot") => "screenshot".to_string(),
            s if s.contains("diagram") || s.contains("flowchart") || s.contains("architecture") => {
                "diagram".to_string()
            }
            s if s.contains("code") => "code".to_string(),
            s if s.contains("chart") || s.contains("graph") => "chart".to_string(),
            s if s.contains("handwrit") => "handwriting".to_string(),
            s if s.contains("ui") || s.contains("mockup") || s.contains("design") => {
                "ui_mockup".to_string()
            }
            _ => "other".to_string(),
        }
    };

    ImageAnalysis {
        description,
        text_content: text_content.to_string(),
        code_blocks,
        action_items,
        questions,
        category,
        analyzed_at: ts,
    }
}

// ─── Core analysis functions ──────────────────────────────────────────────────

/// Analyze an image given as raw base64 (no data-URI prefix).
/// `prompt` overrides the default structured analysis prompt when provided.
pub async fn analyze_image(
    image_base64: &str,
    prompt: Option<&str>,
) -> Result<ImageAnalysis, String> {
    let default_prompt = "Analyze this image thoroughly and respond using exactly these sections:\n\
        ## 1) What you see\n\
        Describe the image in detail — objects, layout, colours, context.\n\n\
        ## 2) Text content\n\
        Copy every piece of text visible verbatim. If there is none, write \"(none)\".\n\n\
        ## 3) Code blocks\n\
        Reproduce any code exactly, wrapped in fenced code blocks with the language tag.\n\
        If there is none, write \"(none)\".\n\n\
        ## 4) Action items\n\
        List concrete things a developer/analyst should do based on this image.\n\n\
        ## 5) Questions\n\
        List any questions you have about the image or what is unclear.\n\n\
        Category: [screenshot | diagram | code | chart | handwriting | ui_mockup | other]\n\n\
        Be specific and technical.";

    let effective_prompt = prompt.unwrap_or(default_prompt);
    let response = vision_complete(image_base64, effective_prompt).await?;
    let ts = chrono::Local::now().timestamp();
    Ok(parse_analysis_response(&response, ts))
}

/// Read an image from `path`, base64-encode it, then run `analyze_image`.
pub async fn analyze_screenshot(
    path: &str,
    prompt: Option<&str>,
) -> Result<ImageAnalysis, String> {
    let b64 = image_to_base64(path)?;
    analyze_image(&b64, prompt).await
}

/// Specialized extraction: find all code blocks in the image and return them.
pub async fn extract_code_from_image(image_base64: &str) -> Result<Vec<String>, String> {
    let prompt = "Extract ALL code visible in this image. Return each code block separately \
        with its language. Format: ```language\ncode\n``` for each block. \
        If there is no code, reply with the single word \"none\".";

    let response = vision_complete(image_base64, prompt).await?;

    if response.trim().eq_ignore_ascii_case("none") {
        return Ok(vec![]);
    }

    let blocks = extract_code_blocks_from_text(&response);
    Ok(blocks)
}

/// Specialized extraction: parse a diagram into nodes, edges, and Mermaid code.
pub async fn extract_diagram(image_base64: &str) -> Result<DiagramExtraction, String> {
    let prompt = "This image contains a diagram, flowchart, or architecture diagram.\n\
        Extract the following and format your response with these exact headers:\n\n\
        ## Nodes\n\
        List every node / component (one per line, use a dash prefix).\n\n\
        ## Relationships\n\
        List every connection with direction (e.g. \"A --> B : label\") one per line.\n\n\
        ## Description\n\
        A concise paragraph describing what this diagram represents.\n\n\
        ## Mermaid\n\
        Generate valid Mermaid.js code (in a ```mermaid fenced block) that represents \
        this diagram as accurately as possible.";

    let response = vision_complete(image_base64, prompt).await?;

    // Parse sections
    fn section<'a>(text: &'a str, header: &str, next_headers: &[&str]) -> &'a str {
        let lower = text.to_lowercase();
        let header_lower = header.to_lowercase();
        let pos = match lower.find(&header_lower) {
            Some(p) => {
                // skip past the header line
                text[p..].find('\n').map(|n| p + n + 1).unwrap_or(p + header.len())
            }
            None => return "",
        };
        let slice = &text[pos..];
        let slice_lower = slice.to_lowercase();
        let end = next_headers
            .iter()
            .filter_map(|h| slice_lower.find(&h.to_lowercase()))
            .min()
            .unwrap_or(slice.len());
        slice[..end].trim()
    }

    let nodes_raw = section(&response, "## nodes", &["## relationships", "## description", "## mermaid"]);
    let rels_raw = section(&response, "## relationships", &["## description", "## mermaid"]);
    let desc_raw = section(&response, "## description", &["## mermaid"]);
    let mermaid_section = section(&response, "## mermaid", &[]);

    let nodes = lines_to_vec(nodes_raw);
    let relationships = lines_to_vec(rels_raw);
    let description = desc_raw.to_string();
    let mermaid_code = extract_named_block(mermaid_section, "mermaid")
        .or_else(|| extract_code_blocks_from_text(mermaid_section).into_iter().next())
        .unwrap_or_else(|| mermaid_section.to_string());

    Ok(DiagramExtraction {
        nodes,
        relationships,
        mermaid_code,
        description,
    })
}

/// Pure OCR: return all text visible in the image, preserving layout as much as possible.
pub async fn ocr_image(image_base64: &str) -> Result<String, String> {
    let prompt = "Extract ALL text from this image exactly as it appears, preserving formatting \
        as closely as possible. Include everything — code, labels, captions, watermarks, \
        numbers, special characters. Return only the extracted text, nothing else.";
    vision_complete(image_base64, prompt).await
}

/// Analyze a UI mockup or design screenshot and produce a component hierarchy.
pub async fn analyze_ui_mockup(image_base64: &str) -> Result<String, String> {
    let prompt = "This is a UI mockup or design. Perform two tasks:\n\n\
        1) **Component inventory**: Describe every visible component — layout structure, \
        navigation elements, sidebars, headers, footers, forms, buttons, text fields, \
        dropdowns, modals, cards, lists. Include their relative positions and groupings.\n\n\
        2) **React component hierarchy**: Generate a JSX outline (not full code, just the \
        component tree with placeholder names) that would implement this design. Use \
        descriptive component names based on what each piece does.\n\n\
        Format section 2 as a fenced JSX block.";
    vision_complete(image_base64, prompt).await
}

/// Compare two images and answer a question about their differences.
/// Both images are sent in a single message when the provider supports multiple images;
/// for providers that only handle one image at a time, each is analysed separately and
/// the descriptions are compared by a second LLM call.
#[allow(dead_code)]
pub async fn compare_images(
    img1_base64: &str,
    img2_base64: &str,
    question: &str,
) -> Result<String, String> {
    use crate::providers::{self, ConversationMessage};

    let effective_question = if question.trim().is_empty() {
        "What are the differences between these two images?"
    } else {
        question
    };

    let (provider, api_key, model) = resolve_vision_config()?;

    // Anthropic, OpenAI, and Gemini all support multiple images in one message.
    // We try the two-image path first.
    let multi_image_providers = ["anthropic", "openai", "gemini", "openrouter"];
    if multi_image_providers.contains(&provider.as_str()) {
        // Build a message with both images — use a multi-part content strategy
        // by encoding both images into consecutive UserWithImage messages and letting
        // the provider handle them. However, providers::ConversationMessage only carries
        // one image per turn. To send two images we use two consecutive user turns with
        // a continuation prompt on the second.
        let messages = vec![
            ConversationMessage::UserWithImage {
                text: "This is image 1.".to_string(),
                image_base64: img1_base64.to_string(),
            },
            ConversationMessage::UserWithImage {
                text: format!(
                    "This is image 2. Now answer this question about both images: {}",
                    effective_question
                ),
                image_base64: img2_base64.to_string(),
            },
        ];

        let turn = providers::complete_turn(
            &provider,
            &api_key,
            &model,
            &messages,
            &[],
            None,
        )
        .await?;

        let text = turn.content.trim().to_string();
        if !text.is_empty() {
            return Ok(text);
        }
    }

    // Fallback: analyse each image separately then compare.
    let desc1 = ocr_image(img1_base64).await.unwrap_or_else(|_| "(analysis failed)".to_string());
    let desc2 = ocr_image(img2_base64).await.unwrap_or_else(|_| "(analysis failed)".to_string());

    let comparison_prompt = format!(
        "Here are descriptions of two images:\n\n\
        **Image 1:**\n{}\n\n\
        **Image 2:**\n{}\n\n\
        Question: {}",
        desc1, desc2, effective_question
    );

    let messages = vec![ConversationMessage::User(comparison_prompt)];
    let turn = providers::complete_turn(
        &provider,
        &api_key,
        &model,
        &messages,
        &[],
        None,
    )
    .await?;

    Ok(turn.content.trim().to_string())
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Analyze an image file on disk.
#[tauri::command]
pub async fn multimodal_analyze_file(
    path: String,
    prompt: Option<String>,
) -> Result<ImageAnalysis, String> {
    analyze_screenshot(&path, prompt.as_deref()).await
}

/// Analyze an image provided as a raw base64 string (no data-URI prefix).
#[tauri::command]
pub async fn multimodal_analyze_base64(
    image_base64: String,
    prompt: Option<String>,
) -> Result<ImageAnalysis, String> {
    analyze_image(&image_base64, prompt.as_deref()).await
}

/// Extract code blocks from an image.
#[tauri::command]
pub async fn multimodal_extract_code(image_base64: String) -> Result<Vec<String>, String> {
    extract_code_from_image(&image_base64).await
}

/// Extract nodes, relationships, and Mermaid code from a diagram image.
#[tauri::command]
pub async fn multimodal_extract_diagram(image_base64: String) -> Result<DiagramExtraction, String> {
    extract_diagram(&image_base64).await
}

/// OCR: extract all text from an image verbatim.
#[tauri::command]
pub async fn multimodal_ocr(image_base64: String) -> Result<String, String> {
    ocr_image(&image_base64).await
}

/// Analyze a UI mockup and return a component hierarchy outline.
#[tauri::command]
pub async fn multimodal_analyze_ui(image_base64: String) -> Result<String, String> {
    analyze_ui_mockup(&image_base64).await
}

/// Return whether the currently configured provider supports vision.
#[tauri::command]
pub fn multimodal_supports_vision() -> bool {
    let config = crate::config::load_config();
    let model_lc = config.model.to_lowercase();
    supports_vision(&config.provider)
        || (config.provider == "ollama"
            && (model_lc.contains("vision") || model_lc.contains("llava")))
}
