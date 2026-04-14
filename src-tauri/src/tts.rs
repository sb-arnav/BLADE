// src-tauri/src/tts.rs
// BLADE Text-to-Speech — OS-native + OpenAI TTS.
//
// Voice selection:
//   "system"           → OS default (macOS `say`, Windows SAPI, Linux espeak-ng)
//   "system:Samantha"  → macOS `say -v Samantha`
//   "system:Alex"      → macOS `say -v Alex`
//   "openai:alloy"     → OpenAI TTS API, alloy voice
//   "openai:nova"      → OpenAI TTS API, nova voice (warm, female)
//   "openai:shimmer"   → OpenAI TTS API, shimmer voice
//   "openai:echo"      → OpenAI TTS API, echo voice (male)
//   "openai:fable"     → OpenAI TTS API, fable voice (British)
//   "openai:onyx"      → OpenAI TTS API, onyx voice (deep male)
//
// Text is passed safely (not via shell args directly on Linux/macOS for OS voices).
// A static singleton ensures only one utterance plays at a time.

use std::process::Child;
#[cfg(not(target_os = "windows"))]
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

// ── Voice style ───────────────────────────────────────────────────────────────

/// Describes how BLADE should deliver a spoken response.
#[derive(Debug, Clone, PartialEq)]
pub enum VoiceStyle {
    /// Single-word / very short confirmations: "sure", "done", "on it"
    Quick,
    /// Normal conversational replies (default).
    Normal,
    /// Multi-sentence explanations or instructions.
    Explanation,
    /// Emotionally charged or important statement — slight weight added.
    Emphasis,
}

/// Classify the speaking style for `text` based on length, keywords, and tone cues.
///
/// Rules applied in order:
/// 1. Very short (≤ 5 words) → Quick
/// 2. Contains "let me explain", "here's how", "there are", numbered lists → Explanation
/// 3. Contains "important", "warning", "note", "but", "however", "actually" as leading words → Emphasis
/// 4. Medium length with a punchline indicator ("…right?", "get it?") → Emphasis (for humor)
/// 5. Everything else → Normal
pub fn select_voice_style(text: &str) -> VoiceStyle {
    let trimmed = text.trim();
    let word_count = trimmed.split_whitespace().count();
    let lower = trimmed.to_lowercase();

    if word_count <= 5 {
        return VoiceStyle::Quick;
    }

    // Explanation triggers
    let explanation_triggers = [
        "let me explain",
        "here's how",
        "here is how",
        "there are",
        "first,",
        "first of all",
        "step 1",
        "step one",
        "to summarize",
        "in other words",
        "what this means",
    ];
    if explanation_triggers.iter().any(|t| lower.contains(t)) {
        return VoiceStyle::Explanation;
    }
    // Multi-sentence explanation heuristic: 3+ sentences
    let sentence_count = trimmed.matches(['.', '!', '?']).count();
    if sentence_count >= 3 && word_count > 30 {
        return VoiceStyle::Explanation;
    }

    // Emphasis triggers
    let emphasis_triggers = [
        "important",
        "warning",
        "careful",
        "note that",
        "actually,",
        "actually ",
        "but wait",
        "however,",
        "however ",
        "the thing is",
        "here's the thing",
    ];
    if emphasis_triggers.iter().any(|t| lower.contains(t)) {
        return VoiceStyle::Emphasis;
    }
    // Punchline humor: ends with "right?" / "get it?" / "heh" / "haha"
    let humor_endings = ["right?", "get it?", "heh", "haha", "ha."];
    if humor_endings.iter().any(|e| lower.ends_with(e)) {
        return VoiceStyle::Emphasis;
    }

    VoiceStyle::Normal
}

/// Map a `VoiceStyle` to a speed multiplier relative to the user's base `tts_speed`.
pub fn style_speed_multiplier(style: &VoiceStyle) -> f32 {
    match style {
        VoiceStyle::Quick       => 1.15,
        VoiceStyle::Normal      => 1.0,
        VoiceStyle::Explanation => 0.9,
        VoiceStyle::Emphasis    => 0.92,
    }
}

/// Insert brief natural pauses into text before "but" / "however" and between
/// sentences.  The SSML-like pause markers are only meaningful for TTS engines
/// that support them; for others the comma/period punctuation already helps.
///
/// We add a short pause (comma) before contrast words and a slightly longer
/// pause (period + space) after each sentence-ending punctuation when the next
/// word is the start of a new thought.
pub fn insert_pauses(text: &str) -> String {
    // Add a beat before "but" and "however" when they're clause-starters.
    let text = text.replace(", but ", ",  but ")  // double space = small pause hint
                   .replace(". But ", ".  But ")
                   .replace(", however,", ",  however,")
                   .replace(". However,", ".  However,");
    text
}

// ── singleton process handle ──────────────────────────────────────────────────

static SPEAKING: std::sync::LazyLock<Arc<Mutex<Option<Child>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

/// Set to true when TTS is actively playing (used by speak_and_wait and interruption detection).
static TTS_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Returns true if TTS is currently playing.
pub fn is_speaking() -> bool {
    TTS_ACTIVE.load(Ordering::SeqCst)
}

/// Speak `text` using the configured voice. Checks voice_mode in config.
pub fn speak(text: &str) {
    let config = crate::config::load_config();
    if config.voice_mode != "tts" && config.voice_mode != "voice" {
        return;
    }
    let voice = config.tts_voice.clone();
    speak_with_voice(text, &voice);
}

/// Speak unconditionally with the configured voice (for pulse/cron outputs).
#[allow(dead_code)]
pub fn speak_unconditional(text: &str) {
    let config = crate::config::load_config();
    let voice = config.tts_voice.clone();
    let speed = config.tts_speed;
    speak_with_voice_speed(text, &voice, speed);
}

/// Core speak — strips markdown, kills current speech, launches TTS.
fn speak_with_voice(text: &str, voice: &str) {
    let config = crate::config::load_config();
    speak_with_voice_speed(text, voice, config.tts_speed);
}

/// Core speak with explicit speed control.
fn speak_with_voice_speed(text: &str, voice: &str, speed: f32) {
    // Determine speaking style and adjust speed accordingly
    let style = select_voice_style(text);
    let adjusted_speed = speed * style_speed_multiplier(&style);

    // Insert natural pauses into the clean text
    let clean_raw = strip_markdown(text);
    let clean = insert_pauses(&clean_raw);
    if clean.trim().is_empty() {
        return;
    }

    stop();
    TTS_ACTIVE.store(true, Ordering::SeqCst);
    let speed = adjusted_speed;

    if voice.starts_with("openai:") {
        let voice_name = voice.trim_start_matches("openai:").to_string();
        let text_owned = clean.clone();
        // Spawn async via tokio — don't block the call site
        tauri::async_runtime::spawn(async move {
            speak_openai(&text_owned, &voice_name, speed).await;
            TTS_ACTIVE.store(false, Ordering::SeqCst);
        });
        return;
    }

    // OS-native
    let child = launch_tts_process_speed(&clean, voice, speed);
    if let Some(proc) = child {
        if let Ok(mut handle) = SPEAKING.lock() {
            *handle = Some(proc);
        }
        let speaking = SPEAKING.clone();
        std::thread::spawn(move || {
            // Wait for the child process to finish
            let finished = {
                let mut waited = false;
                for _ in 0..240 { // wait up to 120s (checked every 500ms)
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if let Ok(mut h) = speaking.lock() {
                        if let Some(ref mut child) = *h {
                            if let Ok(Some(_)) = child.try_wait() {
                                waited = true;
                                break;
                            }
                        } else {
                            // handle was cleared by stop()
                            break;
                        }
                    }
                }
                waited
            };
            let _ = finished;
            TTS_ACTIVE.store(false, Ordering::SeqCst);
        });
    } else {
        TTS_ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// Speak text and asynchronously wait until TTS finishes (or is interrupted).
/// Used by the voice conversation loop — always speaks regardless of voice_mode setting
/// (the conversation loop is explicitly opted-in by the user clicking the mic button).
pub async fn speak_and_wait(app: &tauri::AppHandle, text: &str) -> Result<(), String> {
    use tauri::Emitter;
    let config = crate::config::load_config();
    let voice = config.tts_voice.clone();
    let speed = config.tts_speed;
    speak_with_voice_speed(text, &voice, speed);

    // Poll until TTS finishes or is externally stopped.
    // Interruption grace period: the conversation loop sets TTS_INTERRUPT_AT when
    // the user starts speaking. We only cut the speech after 500 ms have elapsed —
    // this prevents back-channel words ("uh huh", "right") from killing the response.
    loop {
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        if !TTS_ACTIVE.load(Ordering::SeqCst) {
            break;
        }
        // Check for interruption grace period
        let interrupt_at = crate::voice_global::tts_interrupt_at();
        if interrupt_at > 0 {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            if now_ms.saturating_sub(interrupt_at) >= 500 {
                // Grace period elapsed — actually interrupt
                stop();
                TTS_ACTIVE.store(false, Ordering::SeqCst);
                let _ = app.emit("tts_interrupted", ());
                break;
            }
        }
        // Legacy direct interrupt flag (kept for compatibility)
        if crate::voice_global::is_tts_interrupted() {
            stop();
            TTS_ACTIVE.store(false, Ordering::SeqCst);
            let _ = app.emit("tts_interrupted", ());
            break;
        }
    }
    Ok(())
}

/// Interrupt any in-progress speech.
pub fn stop() {
    if let Ok(mut handle) = SPEAKING.lock() {
        if let Some(ref mut child) = *handle {
            let _ = child.kill();
            let _ = child.wait();
        }
        *handle = None;
    }
    TTS_ACTIVE.store(false, Ordering::SeqCst);
}

// ── OpenAI TTS ────────────────────────────────────────────────────────────────

async fn speak_openai(text: &str, voice: &str, speed: f32) {
    let config = crate::config::load_config();
    // Use OpenAI key if provider is openai, otherwise look in keyring
    let api_key = if config.provider == "openai" {
        config.api_key.clone()
    } else {
        keyring::Entry::new("blade-ai", "openai")
            .and_then(|e| e.get_password())
            .unwrap_or_default()
    };
    if api_key.is_empty() {
        log::warn!("[tts] OpenAI TTS: no API key available, falling back to system");
        speak_with_voice(text, "system");
        return;
    }

    // Clamp speed to OpenAI's supported range [0.25, 4.0]
    let clamped_speed = speed.max(0.25_f32).min(4.0_f32);
    let body = serde_json::json!({
        "model": "tts-1",
        "input": text,
        "voice": voice,
        "response_format": "mp3",
        "speed": clamped_speed,
    });

    let client = reqwest::Client::new();
    let response = match client
        .post("https://api.openai.com/v1/audio/speech")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[tts] OpenAI TTS request failed: {}", e);
            return;
        }
    };

    if !response.status().is_success() {
        log::warn!("[tts] OpenAI TTS error: {}", response.status());
        return;
    }

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            log::warn!("[tts] OpenAI TTS read error: {}", e);
            return;
        }
    };

    // Write to temp file and play with platform-native player
    let tmp = std::env::temp_dir().join("blade_tts_openai.mp3");
    if std::fs::write(&tmp, &bytes).is_ok() {
        let _ = play_audio_file(&tmp);
    }
}

fn play_audio_file(path: &std::path::Path) -> Option<()> {
    let path_str = path.to_str()?;

    #[cfg(target_os = "macos")]
    {
        let child = Command::new("afplay").arg(path_str).spawn().ok()?;
        if let Ok(mut handle) = SPEAKING.lock() {
            *handle = Some(child);
        }
        return Some(());
    }

    #[cfg(target_os = "windows")]
    {
        // Use PowerShell to play the mp3
        let script = format!(
            "(New-Object Media.SoundPlayer '{}').PlaySync()",
            path_str.replace('\'', "''")
        );
        let child = crate::cmd_util::silent_cmd("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .spawn()
            .ok()?;
        if let Ok(mut handle) = SPEAKING.lock() {
            *handle = Some(child);
        }
        return Some(());
    }

    #[cfg(target_os = "linux")]
    {
        // Try mpv, then ffplay, then mplayer, then cvlc
        for player in &["mpv", "ffplay", "mplayer", "cvlc"] {
            if let Ok(child) = Command::new(player)
                .args(if *player == "ffplay" {
                    vec!["-nodisp", "-autoexit", path_str]
                } else if *player == "cvlc" {
                    vec!["--play-and-exit", path_str]
                } else {
                    vec![path_str]
                })
                .spawn()
            {
                if let Ok(mut handle) = SPEAKING.lock() {
                    *handle = Some(child);
                }
                return Some(());
            }
        }
        None
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = path_str;
        None
    }
}

// ── OS-native TTS ─────────────────────────────────────────────────────────────

fn launch_tts_process(text: &str, voice: &str) -> Option<Child> {
    launch_tts_process_speed(text, voice, 1.0)
}

fn launch_tts_process_speed(text: &str, voice: &str, speed: f32) -> Option<Child> {
    #[cfg(target_os = "macos")]
    {
        tts_macos_speed(text, voice, speed)
    }
    #[cfg(target_os = "windows")]
    {
        tts_windows_speed(text, voice, speed)
    }
    #[cfg(target_os = "linux")]
    {
        tts_linux_speed(text, voice, speed)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (text, voice, speed);
        None
    }
}

#[cfg(target_os = "macos")]
fn tts_macos(text: &str, voice: &str) -> Option<Child> {
    tts_macos_speed(text, voice, 1.0)
}

#[cfg(target_os = "macos")]
fn tts_macos_speed(text: &str, voice: &str, speed: f32) -> Option<Child> {
    // Extract voice name from "system:VoiceName" or use default
    let voice_name = if voice.starts_with("system:") {
        voice.trim_start_matches("system:").to_string()
    } else {
        // Default to Samantha — much more natural than macOS default (Victoria)
        "Samantha".to_string()
    };

    // `say -r` takes words-per-minute; default ~180, scale by speed
    let wpm = ((180.0 * speed) as u32).max(80).min(600);
    Command::new("say")
        .arg("-v")
        .arg(&voice_name)
        .arg("-r")
        .arg(wpm.to_string())
        .arg(text)
        .spawn()
        .ok()
}

#[cfg(target_os = "windows")]
fn tts_windows(text: &str, voice: &str) -> Option<Child> {
    tts_windows_speed(text, voice, 1.0)
}

#[cfg(target_os = "windows")]
fn tts_windows_speed(text: &str, voice: &str, speed: f32) -> Option<Child> {
    let voice_filter = if voice.starts_with("system:") {
        let v = voice.trim_start_matches("system:");
        format!("$s.SelectVoice('{}');", v)
    } else {
        String::new()
    };

    // SAPI rate: -10 (slowest) to 10 (fastest). Default 0 = 1.0x.
    // Map: speed 0.5 → -5, 1.0 → 0, 2.0 → 5 (capped to ±10)
    let rate = ((speed - 1.0) * 5.0).round() as i32;
    let rate_clamped = rate.max(-10).min(10);

    let script = format!(
        "[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         Add-Type -AssemblyName System.Speech; \
         $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
         {} $s.Rate = {}; $s.Speak($env:TTS_TEXT)",
        voice_filter, rate_clamped
    );
    crate::cmd_util::silent_cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .env("TTS_TEXT", text)
        .spawn()
        .ok()
}

#[cfg(target_os = "linux")]
fn tts_linux(text: &str, voice: &str) -> Option<Child> {
    tts_linux_speed(text, voice, 1.0)
}

#[cfg(target_os = "linux")]
fn tts_linux_speed(text: &str, voice: &str, speed: f32) -> Option<Child> {
    // Extract voice variant if specified: "system:en+f3" → "-v en+f3"
    let voice_arg = if voice.starts_with("system:") {
        voice.trim_start_matches("system:").to_string()
    } else {
        // Better default: en+f3 is much less robotic than default espeak
        "en+f3".to_string()
    };

    // espeak uses words-per-minute (-s); default ~175 wpm, scale by speed
    let wpm = ((175.0 * speed) as u32).max(80).min(600);
    let wpm_str = wpm.to_string();

    // espeak-ng with a better voice
    if let Ok(child) = Command::new("espeak-ng")
        .args(["-v", &voice_arg, "-s", &wpm_str, text])
        .spawn()
    {
        return Some(child);
    }
    if let Ok(child) = Command::new("espeak")
        .args(["-v", &voice_arg, "-s", &wpm_str, text])
        .spawn()
    {
        return Some(child);
    }
    // spd-say doesn't support -v arg the same way
    if let Ok(child) = Command::new("spd-say").arg(text).spawn() {
        return Some(child);
    }
    // pico2wave fallback — much better quality than espeak
    let tmp = std::env::temp_dir().join("blade_tts.wav");
    if Command::new("pico2wave")
        .args(["-w", tmp.to_str().unwrap_or("/tmp/blade_tts.wav"), text])
        .status()
        .is_ok()
    {
        return Command::new("aplay").arg(&tmp).spawn().ok();
    }
    None
}

// ── markdown stripper ─────────────────────────────────────────────────────────

fn strip_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '*' | '_' => {
                if chars.peek() == Some(&ch) {
                    chars.next();
                }
                out.push(' ');
            }
            '`' => {
                if chars.peek() == Some(&'`') {
                    chars.next();
                    if chars.peek() == Some(&'`') {
                        chars.next();
                        loop {
                            match chars.next() {
                                None => break,
                                Some('`') if chars.peek() == Some(&'`') => {
                                    chars.next();
                                    if chars.peek() == Some(&'`') {
                                        chars.next();
                                        break;
                                    }
                                }
                                _ => {}
                            }
                        }
                        out.push(' ');
                    }
                } else {
                    while let Some(c) = chars.next() {
                        if c == '`' { break; }
                    }
                    out.push(' ');
                }
            }
            '#' => {
                while chars.peek() == Some(&'#') { chars.next(); }
                out.push(' ');
            }
            '[' => {
                let mut label = String::new();
                while let Some(c) = chars.next() {
                    if c == ']' { break; }
                    label.push(c);
                }
                if chars.peek() == Some(&'(') {
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == ')' { break; }
                    }
                }
                out.push_str(&label);
            }
            '\n' => {
                if out.ends_with('\n') {
                    out.push('.');
                    out.push(' ');
                } else {
                    out.push(' ');
                }
            }
            other => out.push(other),
        }
    }

    let mut result = String::with_capacity(out.len());
    let mut prev_space = false;
    for ch in out.chars() {
        if ch == ' ' {
            if !prev_space { result.push(ch); }
            prev_space = true;
        } else {
            prev_space = false;
            result.push(ch);
        }
    }

    result.trim().to_string()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Speak a text string using the configured voice.
#[tauri::command]
pub fn tts_speak(text: String) {
    speak(&text);
}

/// Classify the voice style for `text` and return it as a string.
/// Frontend can use this to show hints about how the response will be delivered.
#[tauri::command]
pub fn tts_classify_style(text: String) -> String {
    match select_voice_style(&text) {
        VoiceStyle::Quick       => "quick".to_string(),
        VoiceStyle::Normal      => "normal".to_string(),
        VoiceStyle::Explanation => "explanation".to_string(),
        VoiceStyle::Emphasis    => "emphasis".to_string(),
    }
}

/// Stop any in-progress speech.
#[tauri::command]
pub fn tts_stop() {
    stop();
}

/// Returns true if a TTS engine is likely available on this platform.
#[tauri::command]
pub fn tts_available() -> bool {
    #[cfg(target_os = "macos")]
    { true }

    #[cfg(target_os = "windows")]
    { true }

    #[cfg(target_os = "linux")]
    {
        for bin in &["espeak-ng", "espeak", "spd-say", "pico2wave"] {
            if Command::new("which")
                .arg(bin)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return true;
            }
        }
        false
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    { false }
}

/// Returns available TTS voice options for this platform + OpenAI.
#[tauri::command]
pub fn tts_list_voices() -> Vec<serde_json::Value> {
    let mut voices = vec![];

    // OpenAI voices (always available if user has OpenAI key)
    for (id, label, desc) in &[
        ("openai:nova",    "Nova (OpenAI)",    "Warm, natural female voice"),
        ("openai:alloy",   "Alloy (OpenAI)",   "Balanced, neutral voice"),
        ("openai:shimmer", "Shimmer (OpenAI)", "Soft, gentle female voice"),
        ("openai:echo",    "Echo (OpenAI)",    "Clear male voice"),
        ("openai:onyx",    "Onyx (OpenAI)",    "Deep, authoritative male voice"),
        ("openai:fable",   "Fable (OpenAI)",   "British English male voice"),
    ] {
        voices.push(serde_json::json!({
            "id": id, "label": label, "description": desc, "provider": "openai"
        }));
    }

    // Platform voices
    #[cfg(target_os = "macos")]
    {
        for (id, label, desc) in &[
            ("system:Samantha", "Samantha (macOS)", "Default high-quality US female"),
            ("system:Alex",     "Alex (macOS)",     "US male voice"),
            ("system:Victoria", "Victoria (macOS)", "US female, softer tone"),
            ("system:Karen",    "Karen (macOS)",    "Australian female voice"),
            ("system:Daniel",   "Daniel (macOS)",   "British male voice"),
            ("system:Moira",    "Moira (macOS)",    "Irish female voice"),
            ("system",          "macOS Default",    "System default voice"),
        ] {
            voices.push(serde_json::json!({
                "id": id, "label": label, "description": desc, "provider": "system"
            }));
        }
    }

    #[cfg(target_os = "windows")]
    {
        for (id, label, desc) in &[
            ("system:Microsoft Zira Desktop", "Zira (Windows)", "US female voice"),
            ("system:Microsoft David Desktop","David (Windows)","US male voice"),
            ("system", "Windows Default", "System default SAPI voice"),
        ] {
            voices.push(serde_json::json!({
                "id": id, "label": label, "description": desc, "provider": "system"
            }));
        }
    }

    #[cfg(target_os = "linux")]
    {
        for (id, label, desc) in &[
            ("system:en+f3",  "Female 3 (espeak)", "More natural female voice"),
            ("system:en+f4",  "Female 4 (espeak)", "Alternative female voice"),
            ("system:en+m3",  "Male 3 (espeak)",   "More natural male voice"),
            ("system:en",     "English (espeak)",  "Standard espeak voice"),
            ("system",        "System Default",    "Default espeak voice"),
        ] {
            voices.push(serde_json::json!({
                "id": id, "label": label, "description": desc, "provider": "system"
            }));
        }
    }

    voices
}
