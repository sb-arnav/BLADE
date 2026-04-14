// src-tauri/src/iot_bridge.rs
// IoT / Smart Home bridge — Home Assistant REST API + Spotify local control

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Data Structures ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IoTEntity {
    pub entity_id: String,      // "light.living_room"
    pub friendly_name: String,  // "Living Room Light"
    pub domain: String,         // "light"
    pub state: String,          // "on" / "off" / "25.3"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IoTState {
    pub entity_id: String,
    pub state: String,
    pub attributes: Value,
    pub last_changed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyTrack {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    pub duration_ms: Option<u64>,
    pub progress_ms: Option<u64>,
}

// ─── Home Assistant ────────────────────────────────────────────────────────────

/// Build an authenticated reqwest client for Home Assistant.
fn ha_client(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    let auth_value = format!("Bearer {}", token);
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&auth_value)
            .map_err(|e| format!("Invalid token: {}", e))?,
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Get all entities (lights, switches, sensors, etc.) from Home Assistant.
pub async fn ha_get_entities(base_url: &str, token: &str) -> Result<Vec<IoTEntity>, String> {
    if base_url.is_empty() {
        return Err("Home Assistant base URL is not configured".to_string());
    }
    if token.is_empty() {
        return Err("Home Assistant token is not configured".to_string());
    }

    let client = ha_client(token)?;
    let url = format!("{}/api/states", base_url.trim_end_matches('/'));

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Home Assistant request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Home Assistant returned HTTP {}", resp.status()));
    }

    let states: Vec<Value> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HA response: {}", e))?;

    let entities = states
        .into_iter()
        .filter_map(|s| {
            let entity_id = s["entity_id"].as_str()?.to_string();
            let domain = entity_id.split('.').next().unwrap_or("unknown").to_string();
            let friendly_name = s["attributes"]["friendly_name"]
                .as_str()
                .unwrap_or(&entity_id)
                .to_string();
            let state = s["state"].as_str().unwrap_or("unknown").to_string();
            Some(IoTEntity {
                entity_id,
                friendly_name,
                domain,
                state,
            })
        })
        .collect();

    Ok(entities)
}

/// Get the state of a specific entity from Home Assistant.
pub async fn ha_get_state(
    base_url: &str,
    token: &str,
    entity_id: &str,
) -> Result<IoTState, String> {
    if base_url.is_empty() {
        return Err("Home Assistant base URL is not configured".to_string());
    }
    if token.is_empty() {
        return Err("Home Assistant token is not configured".to_string());
    }

    let client = ha_client(token)?;
    let url = format!(
        "{}/api/states/{}",
        base_url.trim_end_matches('/'),
        entity_id
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Home Assistant request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Home Assistant returned HTTP {} for entity '{}'",
            resp.status(),
            entity_id
        ));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HA response: {}", e))?;

    Ok(IoTState {
        entity_id: body["entity_id"]
            .as_str()
            .unwrap_or(entity_id)
            .to_string(),
        state: body["state"].as_str().unwrap_or("unknown").to_string(),
        attributes: body["attributes"].clone(),
        last_changed: body["last_changed"]
            .as_str()
            .unwrap_or("")
            .to_string(),
    })
}

/// Call a Home Assistant service (turn_on, turn_off, toggle, etc.).
/// `data` can carry extra service fields like brightness, color_temp, etc.
pub async fn ha_call_service(
    base_url: &str,
    token: &str,
    domain: &str,
    service: &str,
    entity_id: &str,
    data: Option<Value>,
) -> Result<(), String> {
    if base_url.is_empty() {
        return Err("Home Assistant base URL is not configured".to_string());
    }
    if token.is_empty() {
        return Err("Home Assistant token is not configured".to_string());
    }

    let client = ha_client(token)?;
    let url = format!(
        "{}/api/services/{}/{}",
        base_url.trim_end_matches('/'),
        domain,
        service
    );

    // Build the payload: always include entity_id, merge any extra data
    let mut payload = match data {
        Some(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };
    payload.insert(
        "entity_id".to_string(),
        Value::String(entity_id.to_string()),
    );

    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Home Assistant service call failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Home Assistant returned HTTP {} for {}/{}: {}",
            status, domain, service, body
        ));
    }

    Ok(())
}

// ─── Spotify Local ─────────────────────────────────────────────────────────────
// Uses the Spotify local HTTPS API (port 4381) on Windows/macOS.
// On Linux this API is absent — falls back gracefully with an informative error.

const SPOTIFY_LOCAL_PORT: u16 = 4381;

/// Quick TCP-connect check: is Spotify's local API port open?
/// Returns false immediately if the port is not listening so we can skip the
/// slower HTTPS call entirely.
async fn spotify_is_running() -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};
    let addr = format!("127.0.0.1:{}", SPOTIFY_LOCAL_PORT);
    timeout(Duration::from_millis(200), TcpStream::connect(&addr))
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
}

/// Build a reqwest client that skips TLS verification for the Spotify local API.
/// The local server uses a self-signed cert so we must accept it.
fn spotify_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build Spotify client: {}", e))
}

/// Fetch a CSRF token and OAuth token from the Spotify local API.
/// Returns (csrf_token, oauth_token).
async fn spotify_get_tokens() -> Result<(String, String), String> {
    let client = spotify_client()?;

    // Step 1: get CSRF token
    let csrf_url = format!(
        "https://127.0.0.1:{}/simplecsrf/token.json",
        SPOTIFY_LOCAL_PORT
    );
    let csrf_resp: Value = client
        .get(&csrf_url)
        .header("Origin", "https://open.spotify.com")
        .send()
        .await
        .map_err(|e| format!("Spotify local API unavailable (is Spotify running?): {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse CSRF response: {}", e))?;
    let csrf = csrf_resp["token"]
        .as_str()
        .ok_or("Missing CSRF token")?
        .to_string();

    // Step 2: get OAuth token
    let oauth_url = format!(
        "https://127.0.0.1:{}/oauth/token",
        SPOTIFY_LOCAL_PORT
    );
    let oauth_resp: Value = client
        .get(&oauth_url)
        .header("Origin", "https://open.spotify.com")
        .send()
        .await
        .map_err(|e| format!("Spotify OAuth endpoint error: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse OAuth response: {}", e))?;
    let oauth = oauth_resp["t"]
        .as_str()
        .ok_or("Missing OAuth token")?
        .to_string();

    Ok((csrf, oauth))
}

/// Get the currently playing track from Spotify desktop.
/// Returns None if Spotify is idle / nothing is playing.
pub async fn spotify_now_playing() -> Result<Option<SpotifyTrack>, String> {
    if !spotify_is_running().await {
        return Err("Spotify does not appear to be running (port 4381 not open).".to_string());
    }
    let client = spotify_client()?;
    let (csrf, oauth) = spotify_get_tokens().await?;

    let url = format!(
        "https://127.0.0.1:{}/remote/status.json",
        SPOTIFY_LOCAL_PORT
    );
    let resp: Value = client
        .get(&url)
        .header("Origin", "https://open.spotify.com")
        .header("X-CSRF-Token", &csrf)
        .header("X-OAuth-Token", &oauth)
        .send()
        .await
        .map_err(|e| format!("Failed to get Spotify status: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Spotify status: {}", e))?;

    // Spotify returns error 4804 when nothing is playing
    if resp["error"]["type"].as_str() == Some("4804") {
        return Ok(None);
    }

    let track = &resp["track"];
    if track.is_null() {
        return Ok(None);
    }

    let title = track["track_resource"]["name"]
        .as_str()
        .unwrap_or("Unknown")
        .to_string();
    let artist = track["artist_resource"]["name"]
        .as_str()
        .unwrap_or("Unknown")
        .to_string();
    let album = track["album_resource"]["name"]
        .as_str()
        .unwrap_or("Unknown")
        .to_string();
    let is_playing = resp["playing"].as_bool().unwrap_or(false);
    let duration_ms = track["length"].as_u64().map(|s| s * 1000);
    let progress_ms = resp["playing_position"]
        .as_f64()
        .map(|p| (p * 1000.0) as u64);

    Ok(Some(SpotifyTrack {
        title,
        artist,
        album,
        is_playing,
        duration_ms,
        progress_ms,
    }))
}

/// Toggle play/pause in Spotify desktop.
pub async fn spotify_play_pause() -> Result<(), String> {
    if !spotify_is_running().await {
        return Err("Spotify does not appear to be running (port 4381 not open).".to_string());
    }
    let client = spotify_client()?;
    let (csrf, oauth) = spotify_get_tokens().await?;

    // Get current state to determine what action to take
    let status_url = format!(
        "https://127.0.0.1:{}/remote/status.json",
        SPOTIFY_LOCAL_PORT
    );
    let status: Value = client
        .get(&status_url)
        .header("Origin", "https://open.spotify.com")
        .header("X-CSRF-Token", &csrf)
        .header("X-OAuth-Token", &oauth)
        .send()
        .await
        .map_err(|e| format!("Failed to get Spotify status: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Spotify status: {}", e))?;

    let is_playing = status["playing"].as_bool().unwrap_or(false);
    let pause_val = if is_playing { "true" } else { "false" };

    let url = format!(
        "https://127.0.0.1:{}/remote/pause.json?pause={}",
        SPOTIFY_LOCAL_PORT, pause_val
    );
    client
        .get(&url)
        .header("Origin", "https://open.spotify.com")
        .header("X-CSRF-Token", &csrf)
        .header("X-OAuth-Token", &oauth)
        .send()
        .await
        .map_err(|e| format!("Failed to toggle Spotify playback: {}", e))?;

    Ok(())
}

/// Skip to the next track in Spotify desktop.
pub async fn spotify_next_track() -> Result<(), String> {
    if !spotify_is_running().await {
        return Err("Spotify does not appear to be running (port 4381 not open).".to_string());
    }
    let client = spotify_client()?;
    let (csrf, oauth) = spotify_get_tokens().await?;

    let url = format!(
        "https://127.0.0.1:{}/remote/next.json",
        SPOTIFY_LOCAL_PORT
    );
    client
        .get(&url)
        .header("Origin", "https://open.spotify.com")
        .header("X-CSRF-Token", &csrf)
        .header("X-OAuth-Token", &oauth)
        .send()
        .await
        .map_err(|e| format!("Failed to skip Spotify track: {}", e))?;

    Ok(())
}

// ─── LLM Tool Definitions ──────────────────────────────────────────────────────

pub fn tool_definitions() -> Vec<crate::providers::ToolDefinition> {
    vec![
        crate::providers::ToolDefinition {
            name: "blade_iot_control".to_string(),
            description: "Control a smart home device via Home Assistant. Use to turn on/off lights, switches, run scenes, or adjust brightness. Returns confirmation of the service call.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "entity_id": {
                        "type": "string",
                        "description": "The Home Assistant entity ID, e.g. 'light.living_room', 'switch.coffee_maker', 'scene.movie_mode'"
                    },
                    "action": {
                        "type": "string",
                        "enum": ["turn_on", "turn_off", "toggle"],
                        "description": "The service action to call: turn_on, turn_off, or toggle"
                    },
                    "brightness": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 255,
                        "description": "Light brightness 0-255 (optional, only valid for light entities with turn_on)"
                    }
                },
                "required": ["entity_id", "action"]
            }),
        },
        crate::providers::ToolDefinition {
            name: "blade_spotify_control".to_string(),
            description: "Control Spotify music playback on the local desktop. Use to check what's playing, toggle play/pause, or skip to the next track.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["now_playing", "play_pause", "next"],
                        "description": "Action to perform: now_playing (get current track), play_pause (toggle), next (skip track)"
                    }
                },
                "required": ["action"]
            }),
        },
    ]
}

// ─── Tauri Commands ────────────────────────────────────────────────────────────

/// List all Home Assistant entities.
#[tauri::command]
pub async fn iot_get_entities() -> Result<Vec<IoTEntity>, String> {
    let config = crate::config::load_config();
    let token = crate::config::get_provider_key("homeassistant");
    ha_get_entities(&config.ha_base_url, &token).await
}

/// Get state of a specific Home Assistant entity.
#[tauri::command]
pub async fn iot_get_state(entity_id: String) -> Result<IoTState, String> {
    let config = crate::config::load_config();
    let token = crate::config::get_provider_key("homeassistant");
    ha_get_state(&config.ha_base_url, &token, &entity_id).await
}

/// Call a Home Assistant service (e.g. turn_on / turn_off / toggle).
#[tauri::command]
pub async fn iot_call_service(
    domain: String,
    service: String,
    entity_id: String,
    data: Option<Value>,
) -> Result<(), String> {
    let config = crate::config::load_config();
    let token = crate::config::get_provider_key("homeassistant");
    ha_call_service(&config.ha_base_url, &token, &domain, &service, &entity_id, data).await
}

/// Get the currently playing Spotify track.
#[tauri::command]
pub async fn spotify_now_playing_cmd() -> Result<Option<SpotifyTrack>, String> {
    spotify_now_playing().await
}

/// Toggle Spotify play/pause.
#[tauri::command]
pub async fn spotify_play_pause_cmd() -> Result<(), String> {
    spotify_play_pause().await
}

/// Skip to the next Spotify track.
#[tauri::command]
pub async fn spotify_next_cmd() -> Result<(), String> {
    spotify_next_track().await
}
