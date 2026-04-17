/// BLADE Deepgram Streaming STT Client
///
/// Replaces batch Whisper (5s latency) with Deepgram WebSocket streaming (~200ms).
/// Architecture: Cluely uses Deepgram with streaming WebSocket + speaker diarization.
///
/// Protocol:
///   WS connect → send binary PCM chunks → receive JSON transcripts → speech_final=true → done
///
/// Speaker diarization: words come with speaker: 0/1/2 tags.
///   Speaker 0 = first detected voice (assumed "other person" in ghost mode context).
///   BLADE maps speaker 0 → "them", speaker 1+ → additional participants.

use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

// ── Response Types ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DeepgramResponse {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub is_final: Option<bool>,
    pub speech_final: Option<bool>,
    pub channel: Option<Channel>,
}

#[derive(Debug, Deserialize)]
pub struct Channel {
    pub alternatives: Vec<Alternative>,
}

#[derive(Debug, Deserialize)]
pub struct Alternative {
    pub transcript: String,
    pub words: Option<Vec<Word>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Word {
    pub word: String,
    pub speaker: Option<u32>,
}

/// A finalized transcript segment from Deepgram.
#[derive(Debug, Clone)]
pub struct Transcript {
    pub text: String,
    /// Speaker index (0-based). None if diarization disabled or unavailable.
    pub speaker: Option<u32>,
    /// True when Deepgram detected end of utterance (speech_final).
    pub is_utterance_end: bool,
}

// ── Streaming Session ─────────────────────────────────────────────────────────

/// Transcribe a single speech segment (WAV bytes) using Deepgram's streaming API.
/// Returns the final transcript when Deepgram signals speech_final.
///
/// Falls back to empty string if no API key or connection fails.
pub async fn transcribe_segment(wav_bytes: &[u8], sample_rate: u32) -> Option<Transcript> {
    let api_key = crate::config::get_provider_key("deepgram");
    if api_key.is_empty() {
        return None;
    }

    // Deepgram streaming endpoint
    let url = format!(
        "wss://api.deepgram.com/v1/listen\
         ?model=nova-2\
         &encoding=linear16\
         &sample_rate={sample_rate}\
         &channels=1\
         &diarize=true\
         &punctuate=true\
         &smart_format=true\
         &utterances=false\
         &interim_results=false"
    );

    let mut request = match url.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[deepgram] build request: {e}");
            return None;
        }
    };

    match format!("Token {api_key}").parse() {
        Ok(v) => { request.headers_mut().insert("Authorization", v); }
        Err(e) => {
            log::warn!("[deepgram] invalid API key format: {e}");
            return None;
        }
    }

    let (ws_stream, _) = match connect_async(request).await {
        Ok(r) => r,
        Err(e) => {
            log::warn!("[deepgram] connect: {e}");
            return None;
        }
    };

    let (mut write, mut read) = ws_stream.split();

    // Skip the WAV header (44 bytes) — send raw PCM only
    let pcm = if wav_bytes.len() > 44 { &wav_bytes[44..] } else { wav_bytes };

    // Send audio in 4KB chunks (Deepgram recommends small chunks for low latency)
    for chunk in pcm.chunks(4096) {
        if let Err(e) = write.send(Message::Binary(chunk.to_vec())).await {
            log::warn!("[deepgram] send chunk: {e}");
            return None;
        }
    }

    // Signal end of audio stream
    let close_msg = serde_json::json!({"type": "CloseStream"}).to_string();
    let _ = write.send(Message::Text(close_msg)).await;

    // Collect transcripts until we get speech_final or connection closes
    let mut final_text = String::new();
    let mut final_speaker: Option<u32> = None;
    let timeout = tokio::time::Duration::from_secs(15);

    let result = tokio::time::timeout(timeout, async {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    match serde_json::from_str::<DeepgramResponse>(&text) {
                        Ok(resp) => {
                            if resp.msg_type == "SpeechStarted" {
                                continue;
                            }

                            let is_final = resp.is_final.unwrap_or(false);
                            if !is_final {
                                continue; // Skip interim results
                            }

                            if let Some(channel) = &resp.channel {
                                if let Some(alt) = channel.alternatives.first() {
                                    let t = alt.transcript.trim();
                                    if !t.is_empty() {
                                        final_text = t.to_string();

                                        // Extract dominant speaker from words
                                        if let Some(words) = &alt.words {
                                            // Most common speaker tag in this segment
                                            let mut counts: std::collections::HashMap<u32, usize> =
                                                std::collections::HashMap::new();
                                            for w in words {
                                                if let Some(s) = w.speaker {
                                                    *counts.entry(s).or_insert(0) += 1;
                                                }
                                            }
                                            final_speaker = counts
                                                .into_iter()
                                                .max_by_key(|(_, c)| *c)
                                                .map(|(s, _)| s);
                                        }
                                    }
                                }
                            }

                            // speech_final = end of utterance
                            if resp.speech_final.unwrap_or(false) {
                                return;
                            }
                        }
                        Err(e) => {
                            log::debug!("[deepgram] JSON parse: {e} — {}", &text[..text.len().min(80)]);
                        }
                    }
                }
                Ok(Message::Close(_)) => return,
                _ => {}
            }
        }
    })
    .await;

    if result.is_err() {
        log::warn!("[deepgram] timeout waiting for transcript");
    }

    if final_text.is_empty() {
        None
    } else {
        Some(Transcript {
            text: final_text,
            speaker: final_speaker,
            is_utterance_end: true,
        })
    }
}

/// Transcribe using Deepgram if key available, else fall back to Groq Whisper batch API.
/// This is the primary STT function for ghost_mode.
pub async fn transcribe_with_fallback(
    wav_bytes: &[u8],
    samples: &[f32],
    sample_rate: u32,
) -> Option<Transcript> {
    // Try Deepgram first
    if !crate::config::get_provider_key("deepgram").is_empty() {
        if let Some(t) = transcribe_segment(wav_bytes, sample_rate).await {
            log::debug!("[deepgram] transcript: {}", crate::safe_slice(&t.text, 60));
            return Some(t);
        }
    }

    // Fallback: Groq Whisper batch (existing ghost_mode logic)
    let text = transcribe_via_groq(wav_bytes).await;
    if text.is_empty() {
        None
    } else {
        Some(Transcript {
            text,
            speaker: None,
            is_utterance_end: true,
        })
    }
}

/// Groq Whisper batch fallback (extracted from ghost_mode's transcribe_chunk).
async fn transcribe_via_groq(wav_bytes: &[u8]) -> String {
    let groq_key = crate::config::get_provider_key("groq");
    let config = crate::config::load_config();
    let api_key = if !groq_key.is_empty() {
        groq_key
    } else if !config.api_key.is_empty() {
        config.api_key
    } else {
        return String::new();
    };

    let url = "https://api.groq.com/openai/v1/audio/transcriptions";
    let client = reqwest::Client::new();

    let part = reqwest::multipart::Part::bytes(wav_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .unwrap_or_else(|_| reqwest::multipart::Part::bytes(vec![]));

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-large-v3-turbo")
        .text("language", "en")
        .text("response_format", "text");

    match client
        .post(url)
        .bearer_auth(&api_key)
        .multipart(form)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            resp.text().await.unwrap_or_default().trim().to_string()
        }
        Ok(resp) => {
            log::warn!("[deepgram/groq_fallback] HTTP {}", resp.status());
            String::new()
        }
        Err(e) => {
            log::warn!("[deepgram/groq_fallback] request failed: {e}");
            String::new()
        }
    }
}
