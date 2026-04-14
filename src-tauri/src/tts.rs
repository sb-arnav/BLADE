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
use std::sync::{Arc, Mutex};

// ── singleton process handle ──────────────────────────────────────────────────

static SPEAKING: std::sync::LazyLock<Arc<Mutex<Option<Child>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

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
    speak_with_voice(text, &voice);
}

/// Core speak — strips markdown, kills current speech, launches TTS.
fn speak_with_voice(text: &str, voice: &str) {
    let clean = strip_markdown(text);
    if clean.trim().is_empty() {
        return;
    }
    stop();

    if voice.starts_with("openai:") {
        let voice_name = voice.trim_start_matches("openai:").to_string();
        let text_owned = clean.clone();
        // Spawn async via tokio — don't block the call site
        tauri::async_runtime::spawn(async move {
            speak_openai(&text_owned, &voice_name).await;
        });
        return;
    }

    // OS-native
    let child = launch_tts_process(&clean, voice);
    if let Some(proc) = child {
        if let Ok(mut handle) = SPEAKING.lock() {
            *handle = Some(proc);
        }
        let speaking = SPEAKING.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(120));
            if let Ok(mut h) = speaking.lock() {
                if let Some(ref mut child) = *h {
                    let _ = child.try_wait();
                }
            }
        });
    }
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
}

// ── OpenAI TTS ────────────────────────────────────────────────────────────────

async fn speak_openai(text: &str, voice: &str) {
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

    let body = serde_json::json!({
        "model": "tts-1",
        "input": text,
        "voice": voice,
        "response_format": "mp3",
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
    #[cfg(target_os = "macos")]
    {
        tts_macos(text, voice)
    }
    #[cfg(target_os = "windows")]
    {
        tts_windows(text, voice)
    }
    #[cfg(target_os = "linux")]
    {
        tts_linux(text, voice)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (text, voice);
        None
    }
}

#[cfg(target_os = "macos")]
fn tts_macos(text: &str, voice: &str) -> Option<Child> {
    // Extract voice name from "system:VoiceName" or use default
    let voice_name = if voice.starts_with("system:") {
        voice.trim_start_matches("system:").to_string()
    } else {
        // Default to Samantha — much more natural than macOS default (Victoria)
        "Samantha".to_string()
    };

    Command::new("say")
        .arg("-v")
        .arg(&voice_name)
        .arg(text)
        .spawn()
        .ok()
}

#[cfg(target_os = "windows")]
fn tts_windows(text: &str, voice: &str) -> Option<Child> {
    let voice_filter = if voice.starts_with("system:") {
        let v = voice.trim_start_matches("system:");
        format!("$s.SelectVoice('{}');", v)
    } else {
        String::new()
    };

    let script = format!(
        "[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         Add-Type -AssemblyName System.Speech; \
         $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
         {} $s.Speak($env:TTS_TEXT)",
        voice_filter
    );
    crate::cmd_util::silent_cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .env("TTS_TEXT", text)
        .spawn()
        .ok()
}

#[cfg(target_os = "linux")]
fn tts_linux(text: &str, voice: &str) -> Option<Child> {
    // Extract voice variant if specified: "system:en+f3" → "-v en+f3"
    let voice_arg = if voice.starts_with("system:") {
        voice.trim_start_matches("system:").to_string()
    } else {
        // Better default: en+f3 is much less robotic than default espeak
        "en+f3".to_string()
    };

    // espeak-ng with a better voice
    if let Ok(child) = Command::new("espeak-ng")
        .args(["-v", &voice_arg, "-s", "150", text])
        .spawn()
    {
        return Some(child);
    }
    if let Ok(child) = Command::new("espeak")
        .args(["-v", &voice_arg, "-s", "150", text])
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
