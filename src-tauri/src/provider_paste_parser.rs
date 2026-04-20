/// PROVIDER PASTE PARSER — Extracts provider / model / base_url / api_key from
/// cURL, JSON-blob, or Python-SDK snippets pasted by the user.
///
/// Detection order (D-51):
///   1. cURL      — leading `curl ` (or `curl\\` continuation)
///   2. JSON blob — leading `{` that parses as JSON object
///   3. Python SDK — `OpenAI(...)` / `Anthropic(...)` / `Groq(...)` / `Client(...)`
///
/// `parse(input)` returns `Ok(ParsedProviderConfig)` or `Err(descriptive_string)`.
/// Never panics. All errors are user-facing. No retry, no silent fallback.
///
/// @see .planning/phases/11-smart-provider-setup/11-RESEARCH.md §Paste Sample Corpus
/// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-51
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// Structured result of parsing a provider-config paste.
///
/// `provider_guess` is one of: openai | anthropic | groq | gemini |
/// openrouter | ollama | custom. Empty-string / None fields are intentional
/// — the UI fills them in from the user if the paste didn't carry them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedProviderConfig {
    pub provider_guess: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub headers: HashMap<String, String>,
}

impl ParsedProviderConfig {
    fn empty(provider_guess: &str) -> Self {
        Self {
            provider_guess: provider_guess.to_string(),
            base_url: None,
            api_key: None,
            model: None,
            headers: HashMap::new(),
        }
    }
}

// ---------- Regex registry (compile-once) ---------------------------------

fn re_curl_url() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        // curl [options] URL  — URL can be bare, single-quoted, or double-quoted.
        Regex::new(r#"curl\s+(?:-X\s+\w+\s+)?(?:--url\s+)?['"]?(https?://[^\s'"]+)"#)
            .expect("curl url regex compiles")
    })
}

fn re_curl_auth_bearer() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?i)(?:-H|--header)\s*['"]?Authorization:\s*Bearer\s+([\w\-\.]+)['"]?"#)
            .expect("curl auth bearer regex compiles")
    })
}

fn re_curl_x_api_key() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?i)(?:-H|--header)\s*['"]?x-api-key:\s*([\w\-\.]+)['"]?"#)
            .expect("curl x-api-key regex compiles")
    })
}

fn re_curl_u_basic() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"-u\s*['"]?:([\w\-\.]+)['"]?"#)
            .expect("curl -u basic regex compiles")
    })
}

fn re_curl_query_key() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"[?&]key=([\w\-]+)"#).expect("curl ?key= regex compiles")
    })
}

fn re_curl_data_payload_single() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        // Matches  -d '{…}'  /  --data '{…}'  /  --data-raw '[…]'  — single-quoted.
        // rust-regex has no backreferences, so we use two quote-specific regexes.
        Regex::new(r#"(?:-d|--data(?:-raw|-binary)?)\s+'([\{\[][\s\S]*?)'"#)
            .expect("curl data payload single-quote regex compiles")
    })
}

fn re_curl_data_payload_double() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"(?:-d|--data(?:-raw|-binary)?)\s+"([\{\[][\s\S]*?)""#)
            .expect("curl data payload double-quote regex compiles")
    })
}

fn re_curl_header_any() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        // Generic -H / --header 'Name: value'  — used AFTER auth/x-api-key have been peeled off.
        Regex::new(r#"(?:-H|--header)\s+['"]([^:'"\s][^:'"]*):\s*([^'"]+)['"]"#)
            .expect("curl header regex compiles")
    })
}

fn re_gemini_model_in_url() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"/models/([^:?\s]+):"#).expect("gemini model regex compiles")
    })
}

fn re_py_constructor() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        // (?m) multiline so ^ can match per-line. Captures optional module + class.
        Regex::new(r#"(?m)^(?:\s*\w+\s*=\s*)?(?:(\w+)\.)?(OpenAI|Anthropic|Groq|Client)\s*\("#)
            .expect("python constructor regex compiles")
    })
}

fn re_py_api_key() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"api_key\s*=\s*['"]([\w\-\.]+)['"]"#).expect("python api_key regex compiles")
    })
}

fn re_py_base_url() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"base_url\s*=\s*['"]([^'"]+)['"]"#).expect("python base_url regex compiles")
    })
}

fn re_py_model() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r#"model\s*=\s*['"]([^'"]+)['"]"#).expect("python model regex compiles")
    })
}

// ---------- Public entry -------------------------------------------------

/// Parse a raw paste into `ParsedProviderConfig`. See module doc for detection order.
pub fn parse(input: &str) -> Result<ParsedProviderConfig, String> {
    let preprocessed = preprocess(input);
    let trimmed = preprocessed.trim();

    if trimmed.is_empty() {
        return Err("Paste is empty".to_string());
    }

    if trimmed.starts_with("curl ") || trimmed.starts_with("curl\\") || trimmed.starts_with("curl\t") {
        if let Ok(result) = detect_curl(trimmed) {
            return Ok(result);
        }
    } else if trimmed.starts_with('{') {
        if let Ok(result) = detect_json(trimmed) {
            return Ok(result);
        }
    } else if let Ok(result) = detect_python_sdk(trimmed) {
        return Ok(result);
    }

    Err(format!(
        "Could not detect provider from that input. Supported: cURL command, JSON config object, or Python SDK snippet. Your input started with: \"{}...\"",
        crate::safe_slice(input, 40)
    ))
}

// ---------- Pre-processing ------------------------------------------------

/// Clean user input for parser consumption:
///   1. trim (no-op on the return value; kept verbose for readability)
///   2. collapse `\<newline>` continuations into a single space
///   3. strip leading `#` comment lines (Python / bash)
fn preprocess(input: &str) -> String {
    // Replace backslash-newline continuations with a space.
    let joined = input.replace("\\\n", " ").replace("\\\r\n", " ");

    // Strip comment lines. We keep inline `#` content in-place because the only
    // false-positive risk is a URL-fragment `#…` — and cURL URLs don't typically
    // include fragments.
    let mut out = String::with_capacity(joined.len());
    for line in joined.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

// ---------- cURL detector -------------------------------------------------

fn detect_curl(input: &str) -> Result<ParsedProviderConfig, String> {
    let mut cfg = ParsedProviderConfig::empty("custom");

    // URL + provider guess from hostname.
    let url = re_curl_url()
        .captures(input)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    if let Some(ref u) = url {
        cfg.provider_guess = guess_from_hostname(u);
        cfg.base_url = Some(canonical_base_url(u, &cfg.provider_guess));
    }

    // Authorization: Bearer …
    if let Some(c) = re_curl_auth_bearer().captures(input) {
        if let Some(m) = c.get(1) {
            cfg.api_key = Some(m.as_str().to_string());
        }
    }

    // x-api-key (Anthropic)
    if cfg.api_key.is_none() {
        if let Some(c) = re_curl_x_api_key().captures(input) {
            if let Some(m) = c.get(1) {
                cfg.api_key = Some(m.as_str().to_string());
            }
        }
    }

    // -u :key (basic auth shorthand)
    if cfg.api_key.is_none() {
        if let Some(c) = re_curl_u_basic().captures(input) {
            if let Some(m) = c.get(1) {
                cfg.api_key = Some(m.as_str().to_string());
            }
        }
    }

    // Gemini `?key=` inline
    if cfg.api_key.is_none() {
        if let Some(c) = re_curl_query_key().captures(input) {
            if let Some(m) = c.get(1) {
                cfg.api_key = Some(m.as_str().to_string());
            }
        }
    }

    // Drop bash variable placeholders like `$OPENAI_API_KEY` — not an error,
    // we simply leave api_key empty so the UI prompts for a resolved value.
    if let Some(ref k) = cfg.api_key.clone() {
        if k.starts_with('$') {
            cfg.api_key = None;
        }
    }

    // Model — prefer JSON body `-d '{"model":"…"}'`. Try single-quoted first
    // (the common form) and fall back to double-quoted. No backreferences in
    // rust-regex, so we use two patterns keyed on the outer quote character.
    let payload_capture = re_curl_data_payload_single()
        .captures(input)
        .or_else(|| re_curl_data_payload_double().captures(input));
    if let Some(c) = payload_capture {
        if let Some(m) = c.get(1) {
            let body = m.as_str();
            if !body.starts_with('$') {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
                    if let Some(model) = v.get("model").and_then(|m| m.as_str()) {
                        cfg.model = Some(model.to_string());
                    }
                }
            }
        }
    }

    // Gemini model encoded in URL path: /models/gemini-2.0-flash:generateContent
    if cfg.model.is_none() {
        if let Some(ref u) = url {
            if let Some(c) = re_gemini_model_in_url().captures(u) {
                if let Some(m) = c.get(1) {
                    cfg.model = Some(m.as_str().to_string());
                }
            }
        }
    }

    // Extra headers (skip auth / x-api-key which are already captured).
    for cap in re_curl_header_any().captures_iter(input) {
        let name = cap.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        let value = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        let lname = name.to_ascii_lowercase();
        if lname == "authorization" || lname == "x-api-key" || lname == "content-type" {
            continue;
        }
        if !name.is_empty() && !value.is_empty() {
            cfg.headers.insert(name, value);
        }
    }

    // If URL missing AND nothing else extracted, tell the caller we couldn't detect.
    if url.is_none() && cfg.api_key.is_none() && cfg.model.is_none() {
        return Err("Could not detect provider from cURL: no URL or auth found".to_string());
    }

    // Reject unknown hostnames unless SOMETHING provider-shaped was extracted.
    // If provider_guess is "custom" AND we have NO evidence (no key, no model,
    // no known hostname from the table) -> likely a non-LLM cURL (e.g. GitHub API).
    if cfg.provider_guess == "custom"
        && cfg.api_key.is_none()
        && cfg.model.is_none()
        && !url.as_deref().map(is_known_custom_provider_host).unwrap_or(false)
    {
        return Err(format!(
            "Could not detect provider from that input. Hostname '{}' is not a known LLM provider.",
            url.as_deref().unwrap_or("(unknown)")
        ));
    }

    Ok(cfg)
}

// ---------- JSON detector -------------------------------------------------

fn detect_json(input: &str) -> Result<ParsedProviderConfig, String> {
    let value: serde_json::Value = serde_json::from_str(input)
        .map_err(|e| format!("Could not detect provider from JSON: {}", e))?;

    let obj = value.as_object().ok_or_else(|| {
        "Could not detect provider from JSON: top-level is not an object".to_string()
    })?;

    let mut cfg = ParsedProviderConfig::empty("custom");

    // Explicit provider key wins over hostname heuristic.
    let explicit_provider = obj.get("provider").and_then(|v| v.as_str()).map(String::from);

    // api_key | apiKey
    if let Some(k) = obj
        .get("api_key")
        .or_else(|| obj.get("apiKey"))
        .and_then(|v| v.as_str())
    {
        cfg.api_key = Some(k.to_string());
    }

    // base_url | baseURL | api_base
    let base_url = obj
        .get("base_url")
        .or_else(|| obj.get("baseURL"))
        .or_else(|| obj.get("api_base"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // model
    if let Some(m) = obj.get("model").and_then(|v| v.as_str()) {
        cfg.model = Some(m.to_string());
    }

    // headers
    if let Some(headers_val) = obj.get("headers").and_then(|v| v.as_object()) {
        for (k, v) in headers_val {
            if let Some(sv) = v.as_str() {
                cfg.headers.insert(k.clone(), sv.to_string());
            }
        }
    }

    // provider_guess resolution.
    if let Some(p) = explicit_provider {
        cfg.provider_guess = p;
    } else if let Some(ref url) = base_url {
        cfg.provider_guess = guess_from_hostname(url);
    }

    cfg.base_url = base_url;

    // If nothing provider-shaped was recognized, surface an Err.
    if cfg.api_key.is_none()
        && cfg.base_url.is_none()
        && cfg.model.is_none()
        && cfg.provider_guess == "custom"
    {
        return Err("Could not detect provider from JSON: no recognized keys".to_string());
    }

    Ok(cfg)
}

// ---------- Python-SDK detector ------------------------------------------

fn detect_python_sdk(input: &str) -> Result<ParsedProviderConfig, String> {
    let caps = re_py_constructor()
        .captures(input)
        .ok_or_else(|| "Could not detect provider from Python input: no SDK constructor found".to_string())?;

    let class_name = caps.get(2).map(|m| m.as_str()).unwrap_or("");

    let mut cfg = ParsedProviderConfig::empty(match class_name {
        "OpenAI" => "openai",
        "Anthropic" => "anthropic",
        "Groq" => "groq",
        _ => "custom",
    });

    // api_key kwarg
    if let Some(c) = re_py_api_key().captures(input) {
        if let Some(m) = c.get(1) {
            let key = m.as_str();
            if !key.starts_with('$') {
                cfg.api_key = Some(key.to_string());
            }
        }
    }

    // base_url kwarg — also may override provider_guess
    if let Some(c) = re_py_base_url().captures(input) {
        if let Some(m) = c.get(1) {
            let url = m.as_str().to_string();
            let host_guess = guess_from_hostname(&url);
            // Sample P3: OpenAI constructor with custom base_url overrides provider.
            // If hostname maps to a non-openai provider (or localhost -> ollama),
            // use the hostname-derived guess in preference to the constructor.
            if host_guess != "custom" || cfg.provider_guess == "custom" {
                if host_guess != cfg.provider_guess {
                    cfg.provider_guess = host_guess;
                }
            } else {
                // host_guess == "custom" AND constructor gave a real provider ->
                // the user pointed an OpenAI(...) client at a non-canonical host.
                // Respect the custom host and demote provider_guess to "custom".
                cfg.provider_guess = "custom".to_string();
            }
            cfg.base_url = Some(url);
        }
    }

    // model kwarg (captures `model=` either in constructor or later `.create(model=…)`)
    if let Some(c) = re_py_model().captures(input) {
        if let Some(m) = c.get(1) {
            cfg.model = Some(m.as_str().to_string());
        }
    }

    // Generic `Client(...)` with no base_url + no api_key is too ambiguous; reject.
    if class_name == "Client" && cfg.base_url.is_none() && cfg.api_key.is_none() {
        return Err(
            "Could not detect provider from Python input: generic Client() needs base_url or api_key".to_string(),
        );
    }

    Ok(cfg)
}

// ---------- Hostname heuristics -----------------------------------------

/// Map a URL (or bare host) to a provider_guess. Returns "custom" for unknown
/// hosts. Ordering matters: longer / more-specific matches go first.
fn guess_from_hostname(url_or_host: &str) -> String {
    let lower = url_or_host.to_ascii_lowercase();

    if lower.contains("api.openai.com") {
        return "openai".to_string();
    }
    if lower.contains("api.anthropic.com") {
        return "anthropic".to_string();
    }
    if lower.contains("api.groq.com") {
        return "groq".to_string();
    }
    if lower.contains("generativelanguage.googleapis.com") {
        return "gemini".to_string();
    }
    if lower.contains("openrouter.ai") {
        return "openrouter".to_string();
    }
    // Localhost family → ollama (OpenAI-compatible local servers assumed Ollama).
    if lower.contains("://localhost")
        || lower.contains("://127.0.0.1")
        || lower.contains("://[::1]")
        || lower.contains("://::1")
    {
        return "ollama".to_string();
    }

    // Known OpenAI-compatible custom providers — still "custom" per RESEARCH.md table.
    if is_known_custom_provider_host(url_or_host) {
        return "custom".to_string();
    }

    "custom".to_string()
}

/// Whether the URL's host matches a known custom-OpenAI-compatible provider.
/// Used as a positive signal that a `custom` guess is legit (vs. random cURL).
fn is_known_custom_provider_host(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("api.deepseek.com")
        || lower.contains("integrate.api.nvidia.com")
        || lower.contains("build.nvidia.com")
        || lower.contains("api.mistral.ai")
        || lower.contains("api.perplexity.ai")
        || lower.contains("api.together.xyz")
        || lower.contains(".azure.openai.com")
        || lower.contains(".openai.azure.com")
        || lower.contains("api.cohere.ai")
}

/// Collapse a full cURL URL down to the canonical base. For OpenAI-compatible
/// providers we want `https://host/v1` — strips trailing `/chat/completions`
/// etc. For Gemini the raw URL is the model endpoint; we keep the origin +
/// `/v1beta` prefix. For unknown hosts we strip query string + path tail.
fn canonical_base_url(url: &str, provider: &str) -> String {
    // Remove any query string.
    let without_query = url.split('?').next().unwrap_or(url).to_string();

    match provider {
        "openai" => trim_to_suffix(&without_query, "/v1"),
        "groq" => trim_to_suffix(&without_query, "/openai/v1"),
        "anthropic" => trim_to_suffix(&without_query, "/v1"),
        "openrouter" => trim_to_suffix(&without_query, "/api/v1"),
        "gemini" => {
            // Canonical: https://generativelanguage.googleapis.com
            if let Some(idx) = without_query.find("/v1beta") {
                return without_query[..idx + "/v1beta".len()].to_string();
            }
            if let Some(idx) = without_query.find("/v1") {
                return without_query[..idx + "/v1".len()].to_string();
            }
            without_query
        }
        "ollama" => trim_to_suffix(&without_query, "/v1"),
        _ => {
            // Custom: try to match /v1 as a reasonable default; else strip path after host.
            if without_query.contains("/v1") {
                trim_to_suffix(&without_query, "/v1")
            } else {
                without_query
            }
        }
    }
}

/// If the URL contains `suffix`, return the prefix up to and including `suffix`.
/// Otherwise return the input unchanged.
fn trim_to_suffix(url: &str, suffix: &str) -> String {
    if let Some(idx) = url.find(suffix) {
        return url[..idx + suffix.len()].to_string();
    }
    url.to_string()
}

// ---------- Tests ---------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -------- cURL samples (RESEARCH.md §Paste Sample Corpus) -----------

    #[test]
    fn test_curl_openai_single_line() {
        let input = r#"curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer sk-proj-abc123" -H "Content-Type: application/json" -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hi"}]}'"#;
        let r = parse(input).expect("C1 parses");
        assert_eq!(r.provider_guess, "openai");
        assert_eq!(r.base_url.as_deref(), Some("https://api.openai.com/v1"));
        assert_eq!(r.api_key.as_deref(), Some("sk-proj-abc123"));
        assert_eq!(r.model.as_deref(), Some("gpt-4o"));
    }

    #[test]
    fn test_curl_anthropic_multiline_x_api_key() {
        let input = "curl https://api.anthropic.com/v1/messages \\\n  --header \"x-api-key: sk-ant-api03-xyz789\" \\\n  --header \"anthropic-version: 2023-06-01\" \\\n  --header \"content-type: application/json\" \\\n  --data '{\"model\":\"claude-sonnet-4-20250514\",\"max_tokens\":1024,\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}'";
        let r = parse(input).expect("C2 parses");
        assert_eq!(r.provider_guess, "anthropic");
        assert_eq!(r.api_key.as_deref(), Some("sk-ant-api03-xyz789"));
        assert_eq!(r.model.as_deref(), Some("claude-sonnet-4-20250514"));
        assert_eq!(
            r.headers.get("anthropic-version").map(String::as_str),
            Some("2023-06-01")
        );
    }

    #[test]
    fn test_curl_groq() {
        let input = r#"curl https://api.groq.com/openai/v1/chat/completions -H "Authorization: Bearer gsk_abc123def456" -H "Content-Type: application/json" -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hi"}]}'"#;
        let r = parse(input).expect("C3 parses");
        assert_eq!(r.provider_guess, "groq");
        assert_eq!(r.base_url.as_deref(), Some("https://api.groq.com/openai/v1"));
        assert_eq!(r.model.as_deref(), Some("llama-3.3-70b-versatile"));
    }

    #[test]
    fn test_curl_openrouter() {
        let input = "curl https://openrouter.ai/api/v1/chat/completions \\\n  -H \"Authorization: Bearer sk-or-v1-abcdef\" \\\n  -H \"HTTP-Referer: https://blade.ai\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"model\":\"meta-llama/llama-3.3-70b-instruct:free\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}'";
        let r = parse(input).expect("C4 parses");
        assert_eq!(r.provider_guess, "openrouter");
        assert_eq!(
            r.model.as_deref(),
            Some("meta-llama/llama-3.3-70b-instruct:free")
        );
    }

    #[test]
    fn test_curl_gemini_query_key() {
        let input = "curl \"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAbCdEfGh\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"contents\":[{\"parts\":[{\"text\":\"Hi\"}]}]}'";
        let r = parse(input).expect("C5 parses");
        assert_eq!(r.provider_guess, "gemini");
        assert_eq!(r.api_key.as_deref(), Some("AIzaSyAbCdEfGh"));
        assert_eq!(r.model.as_deref(), Some("gemini-2.0-flash"));
    }

    #[test]
    fn test_curl_custom_deepseek() {
        let input = "curl https://api.deepseek.com/v1/chat/completions \\\n  -H \"Authorization: Bearer sk-deepseek-xyz\" \\\n  -d '{\"model\":\"deepseek-chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}'";
        let r = parse(input).expect("C6 parses");
        assert_eq!(r.provider_guess, "custom");
        assert_eq!(r.base_url.as_deref(), Some("https://api.deepseek.com/v1"));
        assert_eq!(r.model.as_deref(), Some("deepseek-chat"));
    }

    #[test]
    fn test_curl_localhost_ollama() {
        let input = "curl http://localhost:8000/v1/chat/completions \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"model\":\"meta-llama/Llama-3.3-70B-Instruct\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}'";
        let r = parse(input).expect("C7 parses");
        assert_eq!(r.provider_guess, "ollama");
        assert!(r.api_key.is_none(), "no api_key in local server curl");
        assert_eq!(
            r.model.as_deref(),
            Some("meta-llama/Llama-3.3-70B-Instruct")
        );
    }

    #[test]
    fn test_curl_payload_variable_edge() {
        // E1 — bash variable substitution; must NOT panic.
        let input = "curl https://api.openai.com/v1/chat/completions \\\n  -H \"Authorization: Bearer $OPENAI_API_KEY\" \\\n  -d \"$PAYLOAD\"";
        let r = parse(input).expect("E1 parses without panic");
        assert_eq!(r.provider_guess, "openai");
        assert!(r.api_key.is_none(), "bash var leaves api_key empty");
        assert!(r.model.is_none(), "bash var leaves model empty");
    }

    // -------- JSON samples ------------------------------------------------

    #[test]
    fn test_json_litellm_blob() {
        let input = r#"{"model":"gpt-4o","api_base":"https://api.openai.com/v1","api_key":"sk-proj-abc123"}"#;
        let r = parse(input).expect("J1 parses");
        assert_eq!(r.provider_guess, "openai");
        assert_eq!(r.model.as_deref(), Some("gpt-4o"));
    }

    #[test]
    fn test_json_explicit_provider_camel() {
        let input = r#"{"provider":"anthropic","apiKey":"sk-ant-xyz789","model":"claude-opus-4-20250514","baseURL":"https://api.anthropic.com/v1"}"#;
        let r = parse(input).expect("J2 parses");
        assert_eq!(r.provider_guess, "anthropic");
        assert_eq!(r.api_key.as_deref(), Some("sk-ant-xyz789"));
        assert_eq!(r.model.as_deref(), Some("claude-opus-4-20250514"));
        assert_eq!(r.base_url.as_deref(), Some("https://api.anthropic.com/v1"));
    }

    #[test]
    fn test_json_minimal() {
        let input = r#"{"provider":"groq","api_key":"gsk_xyz"}"#;
        let r = parse(input).expect("J3 parses");
        assert_eq!(r.provider_guess, "groq");
        assert!(r.model.is_none(), "empty model — user picks later");
    }

    // -------- Python samples ---------------------------------------------

    #[test]
    fn test_python_openai_constructor() {
        let input = "from openai import OpenAI\nclient = OpenAI(api_key=\"sk-proj-abc123\")\nresponse = client.chat.completions.create(model=\"gpt-4o\", messages=[{\"role\":\"user\",\"content\":\"Hi\"}])";
        let r = parse(input).expect("P1 parses");
        assert_eq!(r.provider_guess, "openai");
        assert_eq!(r.api_key.as_deref(), Some("sk-proj-abc123"));
        assert_eq!(r.model.as_deref(), Some("gpt-4o"));
    }

    #[test]
    fn test_python_anthropic_module_dot_class() {
        let input = "import anthropic\nclient = anthropic.Anthropic(api_key=\"sk-ant-xyz\")\nmsg = client.messages.create(model=\"claude-sonnet-4-20250514\", max_tokens=1024, messages=[])";
        let r = parse(input).expect("P2 parses");
        assert_eq!(r.provider_guess, "anthropic");
        assert_eq!(r.api_key.as_deref(), Some("sk-ant-xyz"));
        assert_eq!(r.model.as_deref(), Some("claude-sonnet-4-20250514"));
    }

    #[test]
    fn test_python_openai_custom_base_url() {
        let input =
            "client = OpenAI(api_key=\"sk-deepseek-xyz\", base_url=\"https://api.deepseek.com/v1\")\nresponse = client.chat.completions.create(model=\"deepseek-chat\", messages=[])";
        let r = parse(input).expect("P3 parses");
        assert_eq!(
            r.provider_guess, "custom",
            "custom base_url overrides OpenAI constructor"
        );
        assert_eq!(r.base_url.as_deref(), Some("https://api.deepseek.com/v1"));
        assert_eq!(r.model.as_deref(), Some("deepseek-chat"));
    }

    // -------- Negative cases ---------------------------------------------

    #[test]
    fn test_negative_github_curl() {
        let input = "curl https://api.github.com/repos/anthropics/claude-code -H \"Accept: application/vnd.github+json\"";
        let err = parse(input).expect_err("N1 rejects non-LLM curl");
        assert!(
            err.contains("Could not detect provider"),
            "error message mentions detection failure: {err}"
        );
    }

    #[test]
    fn test_negative_json_no_signals() {
        let input = r#"{"foo":"bar","count":42}"#;
        let err = parse(input).expect_err("N3 rejects unrelated JSON");
        assert!(
            err.contains("Could not detect provider"),
            "error: {err}"
        );
    }

    #[test]
    fn test_negative_python_no_sdk() {
        let input = "print(\"hello world\")";
        let err = parse(input).expect_err("N4 rejects plain python");
        assert!(
            err.contains("Could not detect provider"),
            "error: {err}"
        );
    }

    // -------- Edge: non-ASCII safe slicing -------------------------------

    #[test]
    fn test_non_ascii_safe_slice() {
        let input = "日本語curl not-a-real-command";
        // MUST NOT panic on the safe_slice() call inside the error path.
        let err = parse(input).expect_err("non-ASCII prefix yields Err");
        assert!(err.contains("Could not detect provider"), "error: {err}");
    }

    // -------- Edge: empty input ------------------------------------------

    #[test]
    fn test_empty_input() {
        let err = parse("   \n  \t").expect_err("empty input errors");
        assert_eq!(err, "Paste is empty");
    }
}
