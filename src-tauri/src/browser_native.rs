use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

const CDP_BASE_URL: &str = "http://127.0.0.1:9222";

// ── Browser detection ─────────────────────────────────────────────────────────

/// Detect the user's default browser by reading the OS registry / settings.
/// Returns a lowercase browser name: "chrome", "edge", "brave", "firefox", or "unknown".
pub fn detect_default_browser() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
            KEY_READ,
        ) {
            if let Ok(prog_id) = key.get_value::<String, _>("ProgId") {
                return map_prog_id_to_browser(&prog_id);
            }
        }
        return "unknown".to_string();
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: query Launch Services via defaults
        if let Ok(out) = std::process::Command::new("defaults")
            .args(["read", "com.apple.LaunchServices/com.apple.launchservices.secure"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            if text.contains("com.google.chrome") { return "chrome".to_string(); }
            if text.contains("com.brave.browser") { return "brave".to_string(); }
            if text.contains("com.microsoft.edgemac") { return "edge".to_string(); }
            if text.contains("org.mozilla.firefox") { return "firefox".to_string(); }
        }
        return "unknown".to_string();
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = std::process::Command::new("xdg-settings")
            .args(["get", "default-web-browser"])
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
            if text.contains("chrome") { return "chrome".to_string(); }
            if text.contains("brave") { return "brave".to_string(); }
            if text.contains("edge") { return "edge".to_string(); }
            if text.contains("firefox") { return "firefox".to_string(); }
        }
        return "unknown".to_string();
    }

    #[allow(unreachable_code)]
    "unknown".to_string()
}

fn map_prog_id_to_browser(prog_id: &str) -> String {
    // Edge installed via Microsoft Store uses a long AppX ID
    if prog_id.contains("ChromeHTML") || prog_id.contains("Chrome") {
        "chrome".to_string()
    } else if prog_id.contains("FirefoxURL") || prog_id.contains("Firefox") {
        "firefox".to_string()
    } else if prog_id.contains("MSEdgeHTM") || prog_id.contains("Edge")
        || prog_id.contains("AppXq0fevzme2pys62n3e0fbqa7peapykr8v")
    {
        "edge".to_string()
    } else if prog_id.contains("BraveHTML") || prog_id.contains("Brave") {
        "brave".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Return the default remote-debugging port for a browser.
/// Chrome, Edge, and Brave all default to 9222.
pub fn get_browser_debug_port(browser: &str) -> u16 {
    match browser {
        "chrome" | "edge" | "brave" => 9222,
        _ => 9223,
    }
}

// ── Connect to user's running browser ────────────────────────────────────────

/// Try to connect to the user's default browser.
///
/// - For Chromium-based browsers: first checks if a debug port is already open;
///   if not, launches the browser with `--remote-debugging-port`.
/// - For Firefox: returns an explanatory error.
/// - On success: returns a `session_id` string that callers can use with
///   `web_action` / `browser_describe_page`.
#[tauri::command]
pub async fn connect_to_user_browser() -> Result<String, String> {
    let browser = detect_default_browser();

    if browser == "firefox" {
        return Err(
            "Firefox automation requires geckodriver — Chromium-based browsers (Chrome, Edge, Brave) are supported natively.".to_string()
        );
    }

    let port = get_browser_debug_port(&browser);
    let base = format!("http://127.0.0.1:{}", port);

    // Check if already running with debug port
    let already_running = reqwest::get(format!("{}/json/version", base))
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    if !already_running {
        // Launch the user's browser with remote debugging
        launch_user_browser(&browser, port).await?;

        // Wait up to 15 s for the debug port to open
        let deadline = std::time::Instant::now();
        let mut connected = false;
        while deadline.elapsed() < std::time::Duration::from_secs(15) {
            if reqwest::get(format!("{}/json/version", base))
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                connected = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
        if !connected {
            return Err(format!(
                "Could not open a remote-debugging connection to {}. \
                 Try closing all {} windows and retrying.",
                browser, browser
            ));
        }
    }

    // Create a new tab and return its session id
    let session_id = format!("user_browser_{}", browser);
    // Seed the session by opening a blank page so the store entry exists
    let _ = get_or_create_session_on_port(&session_id, None, port).await?;
    Ok(session_id)
}

async fn launch_user_browser(browser: &str, port: u16) -> Result<(), String> {
    let port_arg = format!("--remote-debugging-port={}", port);
    let flag_no_first = "--no-first-run";

    #[cfg(target_os = "windows")]
    {
        let candidates: &[&str] = match browser {
            "chrome" => &[
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            ],
            "edge" => &[
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            ],
            "brave" => &[
                r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                r"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
            ],
            _ => &[],
        };
        for bin in candidates {
            if std::path::Path::new(bin).exists() {
                let _ = crate::cmd_util::silent_cmd(bin)
                    .args([&port_arg, flag_no_first])
                    .spawn();
                return Ok(());
            }
        }
        return Err(format!("Could not find {} executable on this system.", browser));
    }

    #[cfg(target_os = "macos")]
    {
        let app: &str = match browser {
            "chrome" => "Google Chrome",
            "edge" => "Microsoft Edge",
            "brave" => "Brave Browser",
            _ => return Err(format!("No known macOS app for browser '{}'", browser)),
        };
        let _ = std::process::Command::new("open")
            .args(["-a", app, "--args", &port_arg, flag_no_first])
            .spawn();
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let bins: &[&str] = match browser {
            "chrome" => &["google-chrome", "google-chrome-stable"],
            "edge" => &["microsoft-edge", "microsoft-edge-stable"],
            "brave" => &["brave-browser", "brave"],
            _ => &[],
        };
        for bin in bins {
            let r = std::process::Command::new(bin)
                .args([&port_arg, flag_no_first])
                .spawn();
            if r.is_ok() { return Ok(()); }
        }
        return Err(format!("Could not find {} binary on PATH.", browser));
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for browser launch.".to_string())
}

/// Like `get_or_create_session` but targets an arbitrary CDP port.
async fn get_or_create_session_on_port(
    session_id: &str,
    initial_url: Option<&str>,
    port: u16,
) -> Result<BrowserSession, String> {
    if let Some(existing) = session_store().lock().await.get(session_id).cloned() {
        return Ok(existing);
    }

    let base = format!("http://127.0.0.1:{}", port);
    let url = initial_url.unwrap_or("about:blank");
    let client = reqwest::Client::new();
    let encoded = urlencoding::encode(url);
    let endpoint = format!("{}/json/new?{}", base, encoded);

    let response = match client.put(&endpoint).send().await {
        Ok(r) => r,
        Err(_) => client.get(&endpoint).send().await
            .map_err(|e| format!("Failed to create browser target: {}", e))?,
    };

    let target: CdpTarget = response.json().await
        .map_err(|e| format!("Failed to parse browser target: {}", e))?;

    let session = BrowserSession {
        target_id: target.id,
        ws_url: target.web_socket_debugger_url
            .ok_or("Browser target missing websocket URL".to_string())?,
    };
    store_session(session_id, session.clone()).await;
    Ok(session)
}

/// Expose the current page screenshot as raw base64 PNG.
/// Used by the agent loop — returns just the base64 data string.
pub(crate) async fn capture_screenshot_b64(session_id: &str) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let session = get_or_create_session(session_id, None).await?;
    cdp_call(&session.ws_url, "Page.enable", json!({})).await?;
    let response = cdp_call(
        &session.ws_url,
        "Page.captureScreenshot",
        json!({ "format": "png" }),
    )
    .await?;
    let b64 = response
        .get("data")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(b64)
}

/// Navigate a CDP session to a URL (used by browser_agent).
pub(crate) async fn navigate_session(session_id: &str, url: &str) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let mut session = get_or_create_session(session_id, Some(url)).await?;
    cdp_call(&session.ws_url, "Page.enable", json!({})).await?;
    cdp_call(&session.ws_url, "Page.navigate", json!({ "url": url })).await?;
    wait_for_page_ready(&session.ws_url).await?;
    refresh_session(&mut session).await?;
    store_session(session_id, session).await;
    Ok(format!("Navigated to {}", url))
}

/// Read the text content of the current page.
pub(crate) async fn read_page_content(session_id: &str) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let session = get_or_create_session(session_id, None).await?;
    wait_for_page_ready(&session.ws_url).await?;
    let text = eval_js(&session.ws_url, "document.body ? document.body.innerText : ''").await?;
    const MAX: usize = 20_000;
    if text.chars().count() > MAX {
        Ok(format!(
            "{}…\n[Truncated at {} chars]",
            text.chars().take(MAX).collect::<String>(),
            MAX
        ))
    } else {
        Ok(text)
    }
}

/// Click a selector.
pub(crate) async fn click_selector(session_id: &str, selector: &str) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let session = get_or_create_session(session_id, None).await?;
    let sel_json = serde_json::to_string(selector).unwrap_or_default();
    let result = eval_js(
        &session.ws_url,
        &format!(
            "(function() {{ var el = document.querySelector({s}); if (!el) return 'not_found'; el.scrollIntoView({{block:'center'}}); el.click(); return 'clicked'; }})();",
            s = sel_json
        ),
    )
    .await?;
    if result == "not_found" {
        Err(format!("No element matched selector `{}`", selector))
    } else {
        Ok(format!("Clicked `{}`", selector))
    }
}

/// Type text into a selector.
pub(crate) async fn type_into_selector(session_id: &str, selector: &str, text: &str) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let session = get_or_create_session(session_id, None).await?;
    let sel_json = serde_json::to_string(selector).unwrap_or_default();
    let val_json = serde_json::to_string(text).unwrap_or_default();
    let result = eval_js(
        &session.ws_url,
        &format!(
            "(function() {{ var el = document.querySelector({s}); if (!el) return 'not_found'; el.focus(); el.value = {v}; el.dispatchEvent(new Event('input', {{bubbles:true}})); el.dispatchEvent(new Event('change', {{bubbles:true}})); return 'typed'; }})();",
            s = sel_json, v = val_json
        ),
    )
    .await?;
    if result == "not_found" {
        Err(format!("No element matched selector `{}`", selector))
    } else {
        Ok(format!("Typed into `{}`", selector))
    }
}

/// Wait for a CSS selector (polls every 500 ms, up to `timeout_ms`).
pub(crate) async fn wait_for_selector_agent(
    session_id: &str,
    selector: &str,
    timeout_ms: u64,
) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let session = get_or_create_session(session_id, None).await?;
    wait_for_selector(&session.ws_url, selector, timeout_ms.min(10_000)).await?;
    Ok(format!("Selector `{}` appeared", selector))
}

fn managed_chromium_dir() -> PathBuf {
    crate::config::blade_config_dir().join("chromium")
}

pub(crate) fn browser_profile_dir() -> PathBuf {
    crate::config::blade_config_dir().join("browser_profile")
}

fn managed_chromium_binary() -> PathBuf {
    let dir = managed_chromium_dir();
    if cfg!(target_os = "windows") {
        dir.join("chrome-win64").join("chrome.exe")
    } else if cfg!(target_os = "macos") {
        dir.join("chrome-mac-x64").join("Google Chrome for Testing.app")
            .join("Contents").join("MacOS").join("Google Chrome for Testing")
    } else {
        dir.join("chrome-linux64").join("chrome")
    }
}

async fn ensure_chromium() -> Result<PathBuf, String> {
    let binary = managed_chromium_binary();
    if binary.exists() {
        return Ok(binary);
    }
    download_chromium(&managed_chromium_dir()).await?;
    if binary.exists() {
        Ok(binary)
    } else {
        Err("Chromium download completed but binary not found at expected path.".to_string())
    }
}

async fn download_chromium(target_dir: &Path) -> Result<(), String> {
    let platform = if cfg!(target_os = "windows") {
        "win64"
    } else if cfg!(target_os = "macos") {
        // Detect ARM vs x64
        if std::env::consts::ARCH == "aarch64" { "mac-arm64" } else { "mac-x64" }
    } else {
        "linux64"
    };

    // Fetch latest stable version manifest
    let manifest_url = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let manifest: serde_json::Value = client
        .get(manifest_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Chromium manifest: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse Chromium manifest: {}", e))?;

    // Find the chrome download URL for our platform
    let download_url = manifest["channels"]["Stable"]["downloads"]["chrome"]
        .as_array()
        .and_then(|arr| {
            arr.iter().find(|item| {
                item["platform"].as_str() == Some(platform)
            })
        })
        .and_then(|item| item["url"].as_str())
        .ok_or_else(|| format!("No Chromium download found for platform: {}", platform))?
        .to_string();

    // Download zip to temp file
    let zip_path = std::env::temp_dir().join("blade-chromium.zip");
    let mut response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download Chromium: {}", e))?;

    let mut file = tokio::fs::File::create(&zip_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Download error: {}", e))? {
        file.write_all(&chunk).await.map_err(|e| format!("Write error: {}", e))?;
    }
    drop(file);

    // Extract zip
    std::fs::create_dir_all(target_dir)
        .map_err(|e| format!("Failed to create chromium dir: {}", e))?;

    let zip_file = std::fs::File::open(&zip_path)
        .map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read zip: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Zip error: {}", e))?;
        let outpath = target_dir.join(file.name());
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;

            // chmod +x on unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if file.unix_mode().map(|m| m & 0o111 != 0).unwrap_or(false) {
                    std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(0o755)).ok();
                }
            }
        }
    }

    let _ = std::fs::remove_file(&zip_path);
    Ok(())
}

#[tauri::command]
pub async fn browser_session_status() -> Result<serde_json::Value, String> {
    let running = browser_debugger_available().await;
    let profile_path = browser_profile_dir();
    let has_profile = profile_path.exists();
    let chromium_ready = managed_chromium_binary().exists();
    Ok(json!({
        "running": running,
        "has_profile": has_profile,
        "chromium_ready": chromium_ready,
        "profile_path": profile_path.to_string_lossy(),
    }))
}

#[derive(Debug, Clone)]
struct BrowserSession {
    target_id: String,
    ws_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct CdpTarget {
    id: String,
    #[serde(rename = "type")]
    target_type: String,
    title: String,
    url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: Option<String>,
}

fn session_store() -> &'static Arc<tokio::sync::Mutex<HashMap<String, BrowserSession>>> {
    static STORE: OnceLock<Arc<tokio::sync::Mutex<HashMap<String, BrowserSession>>>> =
        OnceLock::new();
    STORE.get_or_init(|| Arc::new(tokio::sync::Mutex::new(HashMap::new())))
}

#[tauri::command]
pub async fn browser_describe_page(session_id: String) -> Result<String, String> {
    browser_describe_page_internal(&session_id).await
}

#[tauri::command]
pub async fn web_action(
    session_id: String,
    action_type: String,
    target: String,
    value: String,
) -> Result<String, String> {
    web_action_internal(&session_id, &action_type, &target, &value).await
}

pub(crate) async fn browser_describe_page_internal(session_id: &str) -> Result<String, String> {
    ensure_browser_debugger().await?;
    let session = get_or_create_session(session_id, None).await?;
    cdp_call(&session.ws_url, "Page.enable", json!({})).await?;
    wait_for_page_ready(&session.ws_url).await?;
    let summary = eval_js(
        &session.ws_url,
        r#"(function() {
  const title = document.title || "";
  const url = location.href || "";
  const nodes = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"]'))
    .filter(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })
    .slice(0, 18)
    .map(el => {
      const tag = (el.tagName || '').toLowerCase();
      const role = el.getAttribute('role') || '';
      const type = el.getAttribute('type') || '';
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      const name = el.getAttribute('name') || el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('placeholder') || '';
      return `${tag}${id}${cls} role=${role || '-'} type=${type || '-'} text=${String(name).trim().slice(0, 80)}`;
    });
  return JSON.stringify({ title, url, elements: nodes });
})();"#,
    )
    .await?;

    let parsed = serde_json::from_str::<serde_json::Value>(&summary).unwrap_or_else(|_| json!({}));
    let title = parsed.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let url = parsed.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let elements = parsed
        .get("elements")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect::<Vec<_>>();

    let rendered_elements = if elements.is_empty() {
        "No visible interactive elements detected".to_string()
    } else {
        elements
            .into_iter()
            .map(|line| format!("- {}", line))
            .collect::<Vec<_>>()
            .join("\n")
    };

    Ok(format!(
        "Browser page\n- title: {}\n- url: {}\n- visible controls:\n{}",
        if title.trim().is_empty() {
            "Untitled"
        } else {
            title
        },
        if url.trim().is_empty() {
            "unknown"
        } else {
            url
        },
        rendered_elements
    ))
}

pub(crate) async fn web_action_internal(
    session_id: &str,
    action_type: &str,
    target: &str,
    value: &str,
) -> Result<String, String> {
    ensure_browser_debugger().await?;

    let mut session = get_or_create_session(
        session_id,
        if action_type == "navigate" && !target.trim().is_empty() {
            Some(target)
        } else {
            None
        },
    )
    .await?;

    let outcome = match action_type {
        "navigate" => {
            if target.trim().is_empty() {
                return Err("Navigate action requires a URL target.".to_string());
            }
            cdp_call(&session.ws_url, "Page.enable", json!({})).await?;
            cdp_call(&session.ws_url, "Page.navigate", json!({ "url": target })).await?;
            wait_for_page_ready(&session.ws_url).await?;
            refresh_session(&mut session).await?;
            format!("Navigated to {}", target)
        }
        "click" => {
            let selector = require_target(&target, "click")?;
            let result = eval_js(
                &session.ws_url,
                &format!(
                    r#"(function() {{
  const el = document.querySelector({selector});
  if (!el) return "not_found";
  el.scrollIntoView({{block: "center", inline: "center"}});
  el.click();
  return "clicked";
}})();"#,
                    selector =
                        serde_json::to_string(&selector).unwrap_or_else(|_| "\"\"".to_string())
                ),
            )
            .await?;
            if result == "not_found" {
                return Err(format!(
                    "No browser element matched selector `{}`",
                    selector
                ));
            }
            format!("Clicked `{}` in the browser", selector)
        }
        "type" => {
            let selector = require_target(&target, "type")?;
            let result = eval_js(
                &session.ws_url,
                &format!(
                    r#"(function() {{
  const el = document.querySelector({selector});
  if (!el) return "not_found";
  el.focus();
  el.value = {value};
  el.dispatchEvent(new Event("input", {{ bubbles: true }}));
  el.dispatchEvent(new Event("change", {{ bubbles: true }}));
  return "typed";
}})();"#,
                    selector =
                        serde_json::to_string(&selector).unwrap_or_else(|_| "\"\"".to_string()),
                    value = serde_json::to_string(&value).unwrap_or_else(|_| "\"\"".to_string())
                ),
            )
            .await?;
            if result == "not_found" {
                return Err(format!(
                    "No browser element matched selector `{}`",
                    selector
                ));
            }
            format!("Typed into `{}` in the browser", selector)
        }
        "scroll" => {
            let mode = if value.trim().is_empty() {
                "bottom"
            } else {
                value.trim()
            };
            let script = match mode {
                "top" => "window.scrollTo({ top: 0, behavior: 'instant' }); 'scrolled_top';",
                "bottom" => "window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }); 'scrolled_bottom';",
                _ => {
                    let delta = mode.parse::<i32>().unwrap_or(800);
                    return eval_js(
                        &session.ws_url,
                        &format!(
                            "window.scrollBy({{ top: {}, behavior: 'instant' }}); 'scrolled';",
                            delta
                        ),
                    )
                    .await
                    .map(|_| format!("Scrolled browser by {}", delta));
                }
            };
            eval_js(&session.ws_url, script).await?;
            format!("Scrolled browser {}", mode)
        }
        "extract" => {
            let selector = if target.trim().is_empty() {
                "body"
            } else {
                target.trim()
            };
            let property = if value.trim().is_empty() {
                "textContent"
            } else {
                value.trim()
            };
            let result = eval_js(
                &session.ws_url,
                &format!(
                    r#"(function() {{
  const el = document.querySelector({selector});
  if (!el) return "";
  const prop = {property};
  if (prop === "outerHTML") return el.outerHTML || "";
  if (prop === "innerHTML") return el.innerHTML || "";
  return String(el[prop] ?? "");
}})();"#,
                    selector =
                        serde_json::to_string(&selector).unwrap_or_else(|_| "\"body\"".to_string()),
                    property = serde_json::to_string(&property)
                        .unwrap_or_else(|_| "\"textContent\"".to_string())
                ),
            )
            .await?;
            result
        }
        "wait" => {
            if !target.trim().is_empty() {
                wait_for_selector(&session.ws_url, target.trim(), parse_timeout(&value)).await?;
                format!("Waited for browser selector `{}`", target.trim())
            } else {
                tokio::time::sleep(std::time::Duration::from_millis(parse_timeout(&value))).await;
                format!("Waited {}ms", parse_timeout(&value))
            }
        }
        "screenshot" => {
            cdp_call(&session.ws_url, "Page.enable", json!({})).await?;
            let response = cdp_call(
                &session.ws_url,
                "Page.captureScreenshot",
                json!({ "format": "png" }),
            )
            .await?;
            let bytes = response
                .get("data")
                .and_then(|value| value.as_str())
                .map(|value| value.len())
                .unwrap_or(0);
            format!("Captured browser screenshot ({} base64 chars)", bytes)
        }
        other => return Err(format!("Unsupported browser action `{}`", other)),
    };

    store_session(session_id, session).await;
    Ok(outcome)
}

async fn ensure_browser_debugger() -> Result<(), String> {
    if browser_debugger_available().await {
        return Ok(());
    }

    launch_browser_debugger().await?;
    let started = std::time::Instant::now();
    while started.elapsed() < std::time::Duration::from_secs(20) {
        if browser_debugger_available().await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    Err("Blade could not start a browser with remote debugging enabled.".to_string())
}

async fn browser_debugger_available() -> bool {
    reqwest::get(format!("{}/json/version", CDP_BASE_URL))
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

async fn launch_browser_debugger() -> Result<(), String> {
    // Use BLADE's managed Chromium binary with a persistent profile dir.
    // If no managed Chromium, fall back to system browsers.
    let profile_dir = browser_profile_dir();
    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create browser profile dir: {}", e))?;
    let profile = profile_dir.to_string_lossy().to_string();

    let args = [
        format!("--remote-debugging-port=9222"),
        format!("--user-data-dir={}", profile),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-background-networking".to_string(),
    ];

    // Try managed Chromium first (auto-download if needed)
    let managed = ensure_chromium().await;
    if let Ok(binary) = managed {
        let result = crate::cmd_util::silent_cmd(&binary)
            .args(&args)
            .spawn();
        if result.is_ok() {
            return Ok(());
        }
    }

    // Fall back to system-installed browsers
    #[cfg(target_os = "windows")]
    {
        let binaries = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ];
        for binary in &binaries {
            let result = crate::cmd_util::silent_cmd(binary).args(&args).spawn();
            if result.is_ok() {
                return Ok(());
            }
        }
        return Err("No browser found. BLADE will download Chromium automatically next time.".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let binaries = ["google-chrome", "chromium-browser", "chromium", "microsoft-edge", "google-chrome-stable"];
        for binary in &binaries {
            let result = crate::cmd_util::silent_cmd(binary).args(&args).spawn();
            if result.is_ok() {
                return Ok(());
            }
        }
        return Err("No browser found. BLADE will download Chromium automatically — try again in a moment.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // Try system Chrome/Chromium first
        let binaries = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for binary in &binaries {
            let result = crate::cmd_util::silent_cmd(binary).args(&args).spawn();
            if result.is_ok() {
                return Ok(());
            }
        }
        return Err("No browser found. BLADE will download Chromium automatically — try again in a moment.".to_string());
    }
}

async fn get_or_create_session(
    session_id: &str,
    initial_url: Option<&str>,
) -> Result<BrowserSession, String> {
    if let Some(existing) = session_store().lock().await.get(session_id).cloned() {
        return Ok(existing);
    }

    let url = initial_url.unwrap_or("about:blank");
    let created = create_target(url).await?;
    let session = BrowserSession {
        target_id: created.id,
        ws_url: created
            .web_socket_debugger_url
            .ok_or("Browser target is missing a websocket debugger URL.".to_string())?,
    };
    store_session(session_id, session.clone()).await;
    Ok(session)
}

async fn create_target(url: &str) -> Result<CdpTarget, String> {
    let client = reqwest::Client::new();
    let encoded = urlencoding::encode(url);
    let endpoint = format!("{}/json/new?{}", CDP_BASE_URL, encoded);
    let response = match client.put(&endpoint).send().await {
        Ok(response) => response,
        Err(_) => client
            .get(&endpoint)
            .send()
            .await
            .map_err(|error| format!("Failed to create browser target: {}", error))?,
    };

    response
        .json::<CdpTarget>()
        .await
        .map_err(|error| format!("Failed to parse browser target: {}", error))
}

async fn refresh_session(session: &mut BrowserSession) -> Result<(), String> {
    let targets = reqwest::get(format!("{}/json/list", CDP_BASE_URL))
        .await
        .map_err(|error| format!("Failed to query browser targets: {}", error))?
        .json::<Vec<CdpTarget>>()
        .await
        .map_err(|error| format!("Failed to parse browser targets: {}", error))?;

    if let Some(target) = targets
        .into_iter()
        .find(|target| target.id == session.target_id)
    {
        if let Some(ws_url) = target.web_socket_debugger_url {
            session.ws_url = ws_url;
        }
    }
    Ok(())
}

async fn store_session(session_id: &str, session: BrowserSession) {
    session_store()
        .lock()
        .await
        .insert(session_id.to_string(), session);
}

async fn cdp_call(
    ws_url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (mut stream, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .map_err(|error| format!("Failed to connect to browser debugger: {}", error))?;

    let message = json!({
        "id": 1,
        "method": method,
        "params": params,
    });
    stream
        .send(tokio_tungstenite::tungstenite::Message::Text(
            message.to_string(),
        ))
        .await
        .map_err(|error| format!("Failed to send browser debugger command: {}", error))?;

    while let Some(frame) = stream.next().await {
        let frame = frame.map_err(|error| format!("Browser debugger read failed: {}", error))?;
        if let tokio_tungstenite::tungstenite::Message::Text(text) = frame {
            let value: serde_json::Value = serde_json::from_str(&text)
                .map_err(|error| format!("Invalid browser debugger response: {}", error))?;
            if value.get("id").and_then(|id| id.as_i64()) == Some(1) {
                if let Some(error) = value.get("error") {
                    return Err(format!("Browser debugger command failed: {}", error));
                }
                return Ok(value.get("result").cloned().unwrap_or_else(|| json!({})));
            }
        }
    }

    Err("Browser debugger connection closed before returning a response.".to_string())
}

async fn eval_js(ws_url: &str, expression: &str) -> Result<String, String> {
    let result = cdp_call(
        ws_url,
        "Runtime.evaluate",
        json!({
            "expression": expression,
            "awaitPromise": true,
            "returnByValue": true,
        }),
    )
    .await?;

    Ok(result
        .get("result")
        .and_then(|value| value.get("value"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string())
}

async fn wait_for_page_ready(ws_url: &str) -> Result<(), String> {
    let started = std::time::Instant::now();
    while started.elapsed() < std::time::Duration::from_secs(10) {
        let state = eval_js(ws_url, "document.readyState")
            .await
            .unwrap_or_default();
        if state == "complete" || state == "interactive" {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Ok(())
}

async fn wait_for_selector(ws_url: &str, selector: &str, timeout_ms: u64) -> Result<(), String> {
    let started = std::time::Instant::now();
    let timeout = timeout_ms.clamp(200, 15000);
    let selector_json = serde_json::to_string(selector).unwrap_or_else(|_| "\"body\"".to_string());
    while started.elapsed() < std::time::Duration::from_millis(timeout) {
        let result = eval_js(
            ws_url,
            &format!(
                "(function() {{ return document.querySelector({}) ? 'found' : 'missing'; }})();",
                selector_json
            ),
        )
        .await
        .unwrap_or_default();
        if result == "found" {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    Err(format!(
        "Timed out waiting for browser selector `{}` after {}ms",
        selector, timeout
    ))
}

fn require_target<'a>(target: &'a str, action: &str) -> Result<&'a str, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        Err(format!(
            "Browser action `{}` requires a target selector.",
            action
        ))
    } else {
        Ok(trimmed)
    }
}

fn parse_timeout(value: &str) -> u64 {
    value
        .trim()
        .parse::<u64>()
        .unwrap_or(1000)
        .clamp(100, 15000)
}
