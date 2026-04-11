// src-tauri/src/tts.rs
// BLADE Text-to-Speech — OS-native, zero new dependencies.
//
// Uses the platform's built-in speech synthesis:
//   macOS  → `say`
//   Linux  → `espeak-ng` (falls back to `espeak`, then `spd-say`)
//   Windows → PowerShell System.Speech.Synthesis
//
// Text is passed via environment variable (TTS_TEXT) to avoid any shell
// injection risk. A static singleton ensures only one utterance plays at a
// time — new speak() calls interrupt the previous one.

use std::process::{Child, Command};
use std::sync::{Arc, Mutex};

// ── singleton process handle ──────────────────────────────────────────────────

static SPEAKING: std::sync::LazyLock<Arc<Mutex<Option<Child>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(None)));

/// Speak `text` asynchronously. Interrupts any in-progress speech.
/// If `voice_mode` in config is not "tts" or "voice", does nothing.
pub fn speak(text: &str) {
    let config = crate::config::load_config();
    if config.voice_mode != "tts" && config.voice_mode != "voice" {
        return;
    }
    speak_unconditional(text);
}

/// Speak without checking voice_mode. Used internally (e.g. pulse thoughts).
pub fn speak_unconditional(text: &str) {
    // Strip markdown — nobody wants to hear "asterisk asterisk bold asterisk asterisk"
    let clean = strip_markdown(text);
    if clean.trim().is_empty() {
        return;
    }

    // Kill any currently-playing speech
    stop();

    let child = launch_tts_process(&clean);

    if let Some(proc) = child {
        if let Ok(mut handle) = SPEAKING.lock() {
            *handle = Some(proc);
        }
        // Reap in background so we don't leave zombies
        let speaking = SPEAKING.clone();
        std::thread::spawn(move || {
            // Wait up to 60s then give up
            std::thread::sleep(std::time::Duration::from_secs(60));
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

// ── platform dispatch ─────────────────────────────────────────────────────────

fn launch_tts_process(text: &str) -> Option<Child> {
    #[cfg(target_os = "macos")]
    {
        tts_macos(text)
    }
    #[cfg(target_os = "windows")]
    {
        tts_windows(text)
    }
    #[cfg(target_os = "linux")]
    {
        tts_linux(text)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = text;
        None
    }
}

#[cfg(target_os = "macos")]
fn tts_macos(text: &str) -> Option<Child> {
    // `say` is always available on macOS
    Command::new("say")
        .arg(text)
        .spawn()
        .ok()
}

#[cfg(target_os = "windows")]
fn tts_windows(text: &str) -> Option<Child> {
    // Pass text via env var to avoid any PS injection risk
    let script = "[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
                  Add-Type -AssemblyName System.Speech; \
                  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
                  $s.Speak($env:TTS_TEXT)";
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("TTS_TEXT", text)
        .spawn()
        .ok()
}

#[cfg(target_os = "linux")]
fn tts_linux(text: &str) -> Option<Child> {
    // Try espeak-ng, espeak, then spd-say in order
    for bin in &["espeak-ng", "espeak", "spd-say"] {
        if let Ok(child) = Command::new(bin)
            .arg(text)
            .spawn()
        {
            return Some(child);
        }
    }
    // Fallback: pico2wave + aplay pipeline
    let tmp = std::env::temp_dir().join("blade_tts.wav");
    if Command::new("pico2wave")
        .args(["-w", tmp.to_str().unwrap_or("/tmp/blade_tts.wav"), text])
        .status()
        .is_ok()
    {
        return Command::new("aplay")
            .arg(tmp)
            .spawn()
            .ok();
    }
    None
}

// ── markdown stripper ─────────────────────────────────────────────────────────

fn strip_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            // Skip bold/italic markers: **, *, __, _
            '*' | '_' => {
                // consume a second matching char if present
                if chars.peek() == Some(&ch) {
                    chars.next();
                }
                // replace with space so words don't run together
                out.push(' ');
            }
            // Skip backticks (inline code)
            '`' => {
                // triple backtick — skip entire code block
                if chars.peek() == Some(&'`') {
                    chars.next();
                    if chars.peek() == Some(&'`') {
                        chars.next();
                        // consume until closing ```
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
                    // single backtick — skip until closing
                    while let Some(c) = chars.next() {
                        if c == '`' { break; }
                    }
                    out.push(' ');
                }
            }
            // Strip markdown heading markers
            '#' => {
                while chars.peek() == Some(&'#') { chars.next(); }
                out.push(' ');
            }
            // Strip link syntax [text](url) → "text"
            '[' => {
                let mut label = String::new();
                while let Some(c) = chars.next() {
                    if c == ']' { break; }
                    label.push(c);
                }
                // consume (url)
                if chars.peek() == Some(&'(') {
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == ')' { break; }
                    }
                }
                out.push_str(&label);
            }
            // Convert multiple newlines to a pause (period)
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

    // Collapse multiple spaces
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

/// Speak a text string using the OS TTS engine. No-op if voice_mode ≠ "tts".
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
    { true } // `say` always present

    #[cfg(target_os = "windows")]
    { true } // PowerShell always present

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
