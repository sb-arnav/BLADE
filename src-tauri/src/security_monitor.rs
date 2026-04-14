// src-tauri/src/security_monitor.rs
// Phase 9 — Security Fortress
// Network monitoring, password breach detection, sensitive file scanning,
// phishing URL detection, and a unified security dashboard.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// ── Data Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConnection {
    pub protocol: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub suspicious: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreachResult {
    pub email: String,
    pub breached: bool,
    pub breach_count: usize,
    pub breaches: Vec<BreachEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreachEntry {
    pub name: String,
    pub domain: String,
    pub breach_date: String,
    pub data_classes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensitiveFile {
    pub path: String,
    pub category: String,
    pub risk: String,       // "critical" | "high" | "medium"
    pub in_gitignore: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlSafetyResult {
    pub url: String,
    pub safe: bool,
    pub risk_level: String, // "safe" | "suspicious" | "dangerous"
    pub flags: Vec<String>,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityOverview {
    pub network_total: usize,
    pub network_suspicious: usize,
    pub files_found: usize,
    pub files_unprotected: usize,
    pub last_scan_ts: i64,
    pub summary: String,
}

// ── 1. Network Monitor ────────────────────────────────────────────────────────

/// Run `netstat -an` and parse active connections.
/// Flags suspicious ones: known-bad IP ranges, unusual ports, IP-only hosts on sensitive ports.
pub async fn scan_network_connections() -> Result<Vec<NetworkConnection>, String> {
    let output = crate::cmd_util::silent_tokio_cmd("netstat")
        .args(["-an"])
        .output()
        .await
        .map_err(|e| format!("netstat failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut connections: Vec<NetworkConnection> = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();

        if parts.is_empty() {
            continue;
        }

        // netstat output varies by platform:
        // Windows: Proto  Local Address  Foreign Address  State
        //   TCP    0.0.0.0:80    0.0.0.0:0    LISTENING
        // Linux:   Proto RecvQ SendQ Local Foreign State
        //   tcp    0     0     0.0.0.0:22  0.0.0.0:*  LISTEN
        // Match on lowercase proto first column.
        let proto_lower = parts[0].to_lowercase();
        if !matches!(proto_lower.as_str(), "tcp" | "tcp6" | "udp" | "udp6") {
            continue;
        }

        // Determine layout: if parts[1] parses as integer it's Linux RecvQ/SendQ layout
        let (local, remote, state) = if parts.len() >= 6 && parts[1].parse::<u64>().is_ok() {
            // Linux: proto recvq sendq local remote state [pid/program]
            (parts[3], parts[4], parts[5])
        } else if parts.len() >= 4 {
            // Windows: proto local remote state
            (parts[1], parts[2], parts[3])
        } else {
            continue;
        };

        let (suspicious, reason) = is_suspicious_connection(&proto_lower, remote, state);

        connections.push(NetworkConnection {
            protocol: proto_lower,
            local_addr: local.to_string(),
            remote_addr: remote.to_string(),
            state: state.to_string(),
            suspicious,
            reason: if suspicious { Some(reason) } else { None },
        });
    }

    Ok(connections)
}

/// Returns true and a description if this connection looks suspicious.
fn is_suspicious_connection(proto: &str, remote: &str, state: &str) -> (bool, String) {
    // Only care about established / syn-sent outbound connections
    let state_upper = state.to_uppercase();
    if state_upper == "LISTEN" || state_upper == "TIME_WAIT" || state_upper == "CLOSE_WAIT" {
        return (false, String::new());
    }

    // Extract remote IP and port
    let (remote_ip, remote_port) = split_addr(remote);

    // 1. Known-bad / unusual destination ports for outbound TCP
    if proto.starts_with("tcp") && !remote_ip.is_empty() {
        let port_num: u16 = remote_port.parse().unwrap_or(0);

        // Unusual high ports to external IPs — common malware C2 ranges
        let suspicious_ports: &[u16] = &[
            4444, 4445, 5555, 6666, 7777, 8888, 9999, // classic shells
            31337, 12345, 54321,                        // historical RAT defaults
            1080, 9050, 9051,                           // SOCKS proxies (Tor)
        ];
        if suspicious_ports.contains(&port_num) && !is_loopback(&remote_ip) {
            return (true, format!("outbound connection to unusual port {} (possible C2/proxy)", port_num));
        }

        // Connections to raw IP on port 80/443 without a domain name are occasionally used
        // for C2 — flag only non-private, non-loopback IPs.
        if (port_num == 80 || port_num == 443)
            && is_bare_ip(&remote_ip)
            && !is_private_ip(&remote_ip)
            && !is_loopback(&remote_ip)
        {
            return (true, format!(
                "outbound HTTPS/HTTP to raw IP {} (no hostname — possible C2 or tracker)",
                remote_ip
            ));
        }

        // Connections to RFC 5737 / test ranges that should never appear in production
        if remote_ip.starts_with("0.") {
            return (true, format!("connection to 0.x.x.x (invalid source/destination address)"));
        }
    }

    (false, String::new())
}

/// Compact one-line summary suitable for brain.rs context injection.
/// Uses the synchronous cached_network_counts() — safe to call from non-async context.
pub fn get_network_summary() -> String {
    let (total, suspicious) = cached_network_counts();
    if total == 0 {
        "network scan unavailable".to_string()
    } else {
        format!("{} active connections, {} flagged suspicious", total, suspicious)
    }
}

// ── Prompt-safe security alert cache ─────────────────────────────────────────
// Populated by a background task so brain.rs never calls netstat inline.
// Each entry: (suspicious_count, timestamp_secs)

static SECURITY_ALERT_CACHE: OnceLock<Mutex<Option<(usize, i64)>>> = OnceLock::new();

fn security_cache() -> &'static Mutex<Option<(usize, i64)>> {
    SECURITY_ALERT_CACHE.get_or_init(|| Mutex::new(None))
}

/// Called from a background task (not on the hot prompt path) to update the cache.
pub fn update_security_cache() {
    let (_, suspicious) = cached_network_counts();
    let ts = Utc::now().timestamp();
    if let Ok(mut guard) = security_cache().lock() {
        *guard = Some((suspicious, ts));
    }
}

/// Returns a ONE-line security alert for brain.rs, or None if clean / no data.
/// Never blocks — reads only from the static cache.
pub fn get_security_alert_for_prompt() -> Option<String> {
    let guard = security_cache().lock().ok()?;
    let (suspicious, ts) = (*guard)?;
    // Ignore stale data (older than 10 minutes)
    if Utc::now().timestamp() - ts > 600 {
        return None;
    }
    if suspicious == 0 {
        return None;
    }
    Some(format!(
        "Security: {} suspicious network connection{} detected.",
        suspicious,
        if suspicious == 1 { "" } else { "s" }
    ))
}

// ── 2. Password Health ────────────────────────────────────────────────────────

/// Check an email against the Have I Been Pwned v3 API.
/// Requires the HIBP API key stored in BLADE keyring under "hibp".
/// If no key is set, returns a clear error prompting the user to set one via blade_set_api_key.
pub async fn check_password_breach(email: String) -> Result<BreachResult, String> {
    let api_key = crate::config::get_provider_key("hibp");
    if api_key.is_empty() {
        return Err(
            "HIBP API key not configured. Use blade_set_api_key with provider='hibp' to store your key. \
             Free keys available at https://haveibeenpwned.com/API/Key"
                .to_string(),
        );
    }

    let url = format!(
        "https://haveibeenpwned.com/api/v3/breachedaccount/{}?truncateResponse=false",
        urlencoding::encode(&email)
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("hibp-api-key", &api_key)
        .header("user-agent", "BLADE-SecurityMonitor/1.0")
        .send()
        .await
        .map_err(|e| format!("HIBP request failed: {}", e))?;

    match response.status().as_u16() {
        404 => {
            // Not found = not breached
            return Ok(BreachResult {
                email,
                breached: false,
                breach_count: 0,
                breaches: vec![],
            });
        }
        200 => {}
        429 => return Err("HIBP rate limit hit — wait 1.5 seconds and retry".to_string()),
        401 => return Err("HIBP API key invalid or expired".to_string()),
        code => return Err(format!("HIBP returned HTTP {}", code)),
    }

    let raw: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("HIBP JSON parse failed: {}", e))?;

    let breaches: Vec<BreachEntry> = raw
        .iter()
        .map(|b| BreachEntry {
            name: b["Name"].as_str().unwrap_or("Unknown").to_string(),
            domain: b["Domain"].as_str().unwrap_or("").to_string(),
            breach_date: b["BreachDate"].as_str().unwrap_or("").to_string(),
            data_classes: b["DataClasses"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect();

    let count = breaches.len();
    Ok(BreachResult {
        email,
        breached: count > 0,
        breach_count: count,
        breaches,
    })
}

/// Check a SHA-1 password hash against the HIBP k-anonymity range API.
/// Pass the full lowercase SHA-1 hex string.
/// Returns true if the password has been seen in a breach.
pub async fn check_password_hash(password_hash: String) -> Result<bool, String> {
    if password_hash.len() < 5 {
        return Err("Password hash must be at least 5 characters (SHA-1 hex)".to_string());
    }

    let prefix = password_hash[..5].to_uppercase();
    let suffix = password_hash[5..].to_uppercase();

    let url = format!("https://api.pwnedpasswords.com/range/{}", prefix);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("user-agent", "BLADE-SecurityMonitor/1.0")
        .send()
        .await
        .map_err(|e| format!("HIBP password range request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HIBP range API returned {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("HIBP range response read failed: {}", e))?;

    // Response format: SUFFIX:COUNT\r\n per line
    for line in body.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() == 2 && parts[0].eq_ignore_ascii_case(&suffix) {
            let count: u64 = parts[1].trim().parse().unwrap_or(1);
            if count > 0 {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

// ── 3. Sensitive File Detection ───────────────────────────────────────────────

/// Scan common locations for sensitive files: .env, private keys, credential files.
/// Flags files that are NOT in a .gitignore (potential leak risk).
pub fn scan_sensitive_files() -> Vec<SensitiveFile> {
    let mut results: Vec<SensitiveFile> = Vec::new();

    // Directories to scan (relative to home)
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let scan_roots: Vec<PathBuf> = vec![
        home.clone(),
        home.join("Documents"),
        home.join("Desktop"),
        home.join("Downloads"),
        home.join("Projects"),
        home.join("dev"),
        home.join("src"),
        home.join("code"),
    ];

    for root in &scan_roots {
        if root.is_dir() {
            scan_dir_for_sensitive(root, &mut results, 0, 4);
        }
    }

    results
}

fn scan_dir_for_sensitive(
    dir: &Path,
    results: &mut Vec<SensitiveFile>,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip heavy dirs
        if path.is_dir() {
            let skip = matches!(
                name.as_str(),
                "node_modules" | ".git" | "target" | ".cache" | "venv" | "__pycache__" | "dist" | "build"
            );
            if !skip {
                scan_dir_for_sensitive(&path, results, depth + 1, max_depth);
            }
            continue;
        }

        if !path.is_file() {
            continue;
        }

        // Check filename patterns
        let (category, risk, note) = classify_sensitive_file(&name, &path);
        if category.is_empty() {
            continue;
        }

        // Check if this file would be caught by a .gitignore
        let in_gitignore = check_in_gitignore(&path);

        results.push(SensitiveFile {
            path: path.to_string_lossy().to_string(),
            category,
            risk,
            in_gitignore,
            note,
        });
    }
}

fn classify_sensitive_file(name: &str, path: &Path) -> (String, String, String) {
    let name_lower = name.to_lowercase();

    // Private key files
    if name_lower.ends_with(".pem")
        || name_lower.ends_with(".key")
        || name_lower == "id_rsa"
        || name_lower == "id_dsa"
        || name_lower == "id_ecdsa"
        || name_lower == "id_ed25519"
        || name_lower.ends_with(".ppk")
    {
        return (
            "private_key".to_string(),
            "critical".to_string(),
            "Private key file — ensure it is not committed to any repository".to_string(),
        );
    }

    // .env files — check content for secrets
    if name_lower == ".env"
        || name_lower.starts_with(".env.")
        || name_lower.ends_with(".env")
    {
        let has_secrets = file_contains_any(path, &["API_KEY", "PASSWORD", "SECRET", "TOKEN", "PASS="]);
        let risk = if has_secrets { "critical" } else { "high" };
        let note = if has_secrets {
            "Environment file containing credentials/API keys".to_string()
        } else {
            "Environment file — may contain secrets".to_string()
        };
        return ("env_file".to_string(), risk.to_string(), note);
    }

    // Known credential JSON files
    if name_lower == "credentials.json"
        || name_lower == "token.json"
        || name_lower == "service_account.json"
        || name_lower == "keyfile.json"
        || name_lower == "auth.json"
        || name_lower == "secrets.json"
    {
        return (
            "credential_file".to_string(),
            "critical".to_string(),
            format!("Known credential file type: {}", name),
        );
    }

    // AWS / cloud credential files
    if name_lower == "credentials" && path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) == Some(".aws") {
        return (
            "cloud_credentials".to_string(),
            "critical".to_string(),
            "AWS credentials file — contains access keys".to_string(),
        );
    }

    // SSH config / known_hosts
    if name_lower == "config"
        && path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) == Some(".ssh")
    {
        return (
            "ssh_config".to_string(),
            "medium".to_string(),
            "SSH config file — may expose host aliases and key paths".to_string(),
        );
    }

    // Keystore / certificate bundles
    if name_lower.ends_with(".jks") || name_lower.ends_with(".keystore") || name_lower.ends_with(".pfx") || name_lower.ends_with(".p12") {
        return (
            "keystore".to_string(),
            "high".to_string(),
            "Java/PKCS12 keystore — contains certificates and private keys".to_string(),
        );
    }

    // SQLite/database files — check for password columns
    if name_lower.ends_with(".db")
        || name_lower.ends_with(".sqlite")
        || name_lower.ends_with(".sqlite3")
    {
        // We do not parse binary DB here; just flag as medium if name is suspicious
        if name_lower.contains("password") || name_lower.contains("credential") || name_lower.contains("auth") {
            return (
                "database".to_string(),
                "high".to_string(),
                "Database file with suspicious name — may contain unencrypted credentials".to_string(),
            );
        }
    }

    (String::new(), String::new(), String::new())
}

/// Returns true if the file appears in a .gitignore somewhere in its ancestor tree.
fn check_in_gitignore(file_path: &Path) -> bool {
    let mut dir = file_path.parent();
    while let Some(d) = dir {
        let gitignore = d.join(".gitignore");
        if gitignore.exists() {
            if let Ok(content) = std::fs::read_to_string(&gitignore) {
                let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                for pattern in content.lines() {
                    let p = pattern.trim().trim_start_matches('/');
                    if p.is_empty() || p.starts_with('#') {
                        continue;
                    }
                    // Simple: check if the pattern matches the filename or ends with it
                    if file_name == p || file_path.to_string_lossy().ends_with(p) {
                        return true;
                    }
                    // Glob: *.env, *.key, etc.
                    if p.starts_with('*') {
                        let ext = &p[1..]; // e.g. ".env"
                        if file_name.ends_with(ext) {
                            return true;
                        }
                    }
                }
            }
        }
        if d.join(".git").exists() {
            // Reached repo root — stop searching
            break;
        }
        dir = d.parent();
    }
    false
}

fn file_contains_any(path: &Path, needles: &[&str]) -> bool {
    if let Ok(content) = std::fs::read_to_string(path) {
        return needles.iter().any(|n| content.contains(n));
    }
    false
}

// ── 4. Phishing / URL Safety ──────────────────────────────────────────────────

/// Basic heuristic URL safety check.
pub fn check_url_safety(url: &str) -> UrlSafetyResult {
    let mut flags: Vec<String> = Vec::new();

    // Normalise
    let url_lower = url.to_lowercase();

    // 1. Homograph attack — Cyrillic chars that look like Latin
    if contains_homograph_chars(url) {
        flags.push(
            "HOMOGRAPH: URL contains look-alike Unicode characters (e.g. Cyrillic) — possible IDN homograph attack"
                .to_string(),
        );
    }

    // 2. Suspicious TLD with brand name in domain
    let suspicious_tld_brands = detect_suspicious_tld_brand(&url_lower);
    flags.extend(suspicious_tld_brands);

    // 3. URL shortener — flag as "verify destination"
    if is_url_shortener(&url_lower) {
        flags.push(
            "URL_SHORTENER: This is a link-shortening service. The real destination is hidden — expand before clicking"
                .to_string(),
        );
    }

    // 4. Bare IP address URL
    if is_ip_url(&url_lower) {
        flags.push(
            "IP_URL: URL uses a raw IP address instead of a domain name — unusual for legitimate services"
                .to_string(),
        );
    }

    // 5. Excessive subdomain depth (e.g. login.paypal.com.evil.site)
    if let Some(brand_squatting) = detect_subdomain_squatting(url) {
        flags.push(brand_squatting);
    }

    // 6. HTTP (not HTTPS) for login-looking pages
    if url_lower.starts_with("http://") && (url_lower.contains("login") || url_lower.contains("signin") || url_lower.contains("password")) {
        flags.push(
            "INSECURE_LOGIN: Login/password URL over plain HTTP — credentials sent unencrypted"
                .to_string(),
        );
    }

    // 7. Data URLs or javascript: URLs
    if url_lower.starts_with("javascript:") || url_lower.starts_with("data:") {
        flags.push(
            "DANGEROUS_SCHEME: URL uses a dangerous scheme (javascript: or data:) that can execute code"
                .to_string(),
        );
    }

    let risk_level = if flags.iter().any(|f| f.starts_with("HOMOGRAPH") || f.starts_with("DANGEROUS") || f.starts_with("SUBDOMAIN_SQUAT")) {
        "dangerous"
    } else if !flags.is_empty() {
        "suspicious"
    } else {
        "safe"
    };

    let recommendation = match risk_level {
        "dangerous" => "Do NOT click this link. It shows strong indicators of a phishing or malware attempt.".to_string(),
        "suspicious" => "Proceed with caution. Verify the destination before entering any credentials.".to_string(),
        _ => "No obvious phishing signals detected. Still use standard caution online.".to_string(),
    };

    UrlSafetyResult {
        url: url.to_string(),
        safe: risk_level == "safe",
        risk_level: risk_level.to_string(),
        flags,
        recommendation,
    }
}

/// Detect Cyrillic or other look-alike Unicode characters in the host part of a URL.
fn contains_homograph_chars(url: &str) -> bool {
    // Extract the host (between :// and the first /)
    let host = extract_host(url);

    // Common Cyrillic chars that look like Latin
    // а=\u{0430}, е=\u{0435}, о=\u{043E}, р=\u{0440}, с=\u{0441}, х=\u{0445}
    // і=\u{0456} (Ukrainian), ѕ=\u{0455}
    const CONFUSABLES: &[char] = &[
        '\u{0430}', '\u{0435}', '\u{043E}', '\u{0440}', '\u{0441}', '\u{0445}',
        '\u{0456}', '\u{0455}', '\u{04CF}', '\u{0501}',
        // Greek
        '\u{03BF}', '\u{03C1}', '\u{03B1}', '\u{03B5}',
    ];

    host.chars().any(|c| CONFUSABLES.contains(&c))
}

fn detect_suspicious_tld_brand(url: &str) -> Vec<String> {
    let mut flags = Vec::new();

    // Suspicious TLDs commonly used in phishing
    let suspicious_tlds = &[".xyz", ".tk", ".ml", ".cf", ".ga", ".gq", ".pw", ".top", ".click", ".link"];
    // Major brands often impersonated
    let brands = &[
        "paypal", "google", "microsoft", "apple", "amazon", "netflix",
        "facebook", "instagram", "twitter", "bank", "chase", "wellsfargo",
        "citibank", "hsbc", "irs", "gov", "bitcoin", "crypto", "coinbase",
        "binance", "office365", "outlook", "yahoo", "gmail",
    ];

    let host = extract_host(url).to_lowercase();

    for tld in suspicious_tlds {
        if host.ends_with(tld) {
            let mut brand_found = false;
            for brand in brands {
                if host.contains(brand) {
                    flags.push(format!(
                        "BRAND_TLD: Domain '{}' combines brand name '{}' with suspicious TLD '{}' — common phishing pattern",
                        host, brand, tld
                    ));
                    brand_found = true;
                    break;
                }
            }
            if !brand_found {
                // Flag the suspicious TLD even without a brand
                flags.push(format!(
                    "SUSPICIOUS_TLD: Domain uses '{}' — a TLD frequently associated with phishing/spam",
                    tld
                ));
            }
            // Only report the first matching TLD
            break;
        }
    }

    flags
}

fn is_url_shortener(url: &str) -> bool {
    let host = extract_host(url).to_lowercase();
    let shorteners = &[
        "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd",
        "buff.ly", "adf.ly", "bc.vc", "cutt.ly", "rb.gy", "shorturl.at",
        "tiny.cc", "x.co", "snip.ly", "bl.ink", "short.io",
    ];
    shorteners.iter().any(|s| host == *s || host.ends_with(&format!(".{}", s)))
}

fn is_ip_url(url: &str) -> bool {
    let host = extract_host(url);
    is_bare_ip(&host)
}

fn detect_subdomain_squatting(url: &str) -> Option<String> {
    let host = extract_host(url).to_lowercase();
    let parts: Vec<&str> = host.split('.').collect();

    // Need at least: subdomain.brand.tld.evil.tld = 5 parts
    if parts.len() < 4 {
        return None;
    }

    // The "real" TLD+1 is the last two parts
    let real_domain = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);

    // Legit domains — if the effective domain matches a known brand, it is fine
    let trusted_domains = &[
        "paypal.com", "google.com", "microsoft.com", "apple.com", "amazon.com",
        "netflix.com", "facebook.com", "instagram.com", "twitter.com",
        "chase.com", "wellsfargo.com", "github.com", "googleapis.com",
    ];
    if trusted_domains.contains(&real_domain.as_str()) {
        return None; // Legitimate domain with subdomains
    }

    // Now check if any of the subdomains (not the TLD+1) look like brand impersonation
    let subdomains = &parts[..parts.len() - 2];
    let brands = &[
        "paypal", "google", "microsoft", "apple", "amazon", "netflix",
        "facebook", "instagram", "twitter", "bank", "chase", "wellsfargo",
        "support", "secure", "login", "verify", "account",
    ];

    for sub in subdomains {
        for brand in brands {
            if sub.contains(brand) {
                return Some(format!(
                    "SUBDOMAIN_SQUAT: '{}' uses subdomain '{}' to impersonate '{}' — the real domain is '{}' which is unrelated",
                    host, sub, brand, real_domain
                ));
            }
        }
    }

    None
}

// ── 5. Security Dashboard ─────────────────────────────────────────────────────

/// Combine all security data into a single overview snapshot.
/// This is synchronous so it can be called quickly from a Tauri command.
pub fn get_security_overview() -> SecurityOverview {
    let sensitive = scan_sensitive_files();
    let files_found = sensitive.len();
    let files_unprotected = sensitive.iter().filter(|f| !f.in_gitignore).count();

    // Network: try a quick cached result, else show zeroes
    let (network_total, network_suspicious) = cached_network_counts();

    let last_scan_ts = Utc::now().timestamp();

    let mut parts: Vec<String> = Vec::new();
    if network_suspicious > 0 {
        parts.push(format!("{} suspicious connection(s)", network_suspicious));
    }
    if files_unprotected > 0 {
        parts.push(format!("{} sensitive file(s) not in .gitignore", files_unprotected));
    }
    let summary = if parts.is_empty() {
        format!(
            "No immediate issues detected. {} connections, {} sensitive files (all protected).",
            network_total, files_found
        )
    } else {
        format!("ATTENTION: {}", parts.join("; "))
    };

    SecurityOverview {
        network_total,
        network_suspicious,
        files_found,
        files_unprotected,
        last_scan_ts,
        summary,
    }
}

/// Returns (total, suspicious) from a quick synchronous netstat run.
/// Falls back to (0, 0) if netstat is unavailable.
fn cached_network_counts() -> (usize, usize) {
    let output = crate::cmd_util::silent_cmd("netstat")
        .args(["-an"])
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let mut total = 0usize;
            let mut suspicious = 0usize;
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 {
                    continue;
                }
                let proto = parts[0].to_lowercase();
                if !proto.starts_with("tcp") && !proto.starts_with("udp") {
                    continue;
                }
                total += 1;
                let remote = if parts.len() >= 3 { parts[2] } else { "" };
                let state = if parts.len() >= 4 { parts[3] } else { "" };
                let (flag, _) = is_suspicious_connection(&proto, remote, state);
                if flag {
                    suspicious += 1;
                }
            }
            (total, suspicious)
        }
        Err(_) => (0, 0),
    }
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn security_scan_network() -> Result<Vec<NetworkConnection>, String> {
    scan_network_connections().await
}

#[tauri::command]
pub async fn security_check_breach(email: String) -> Result<BreachResult, String> {
    check_password_breach(email).await
}

#[tauri::command]
pub async fn security_check_password_hash(hash: String) -> Result<bool, String> {
    check_password_hash(hash).await
}

#[tauri::command]
pub fn security_scan_sensitive_files() -> Vec<SensitiveFile> {
    scan_sensitive_files()
}

#[tauri::command]
pub fn security_check_url(url: String) -> UrlSafetyResult {
    check_url_safety(&url)
}

#[tauri::command]
pub fn security_overview() -> SecurityOverview {
    get_security_overview()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract the host portion from a URL string.
fn extract_host(url: &str) -> String {
    // Strip scheme
    let without_scheme = if let Some(pos) = url.find("://") {
        &url[pos + 3..]
    } else {
        url
    };
    // Strip path/query/fragment
    let host = without_scheme
        .split(['/', '?', '#', '@'])
        .next()
        .unwrap_or(without_scheme);
    // Strip port
    let host = if let Some(bracket_end) = host.rfind(']') {
        // IPv6 [::1]:port
        &host[..=bracket_end]
    } else if let Some(colon) = host.rfind(':') {
        &host[..colon]
    } else {
        host
    };
    host.to_string()
}

/// Return (ip, port) from "1.2.3.4:80" or "[::1]:443"
fn split_addr(addr: &str) -> (String, String) {
    if addr.starts_with('[') {
        // IPv6
        if let Some(bracket) = addr.rfind(']') {
            let ip = addr[1..bracket].to_string();
            let port = if addr.len() > bracket + 2 {
                addr[bracket + 2..].to_string()
            } else {
                String::new()
            };
            return (ip, port);
        }
    }
    if let Some(last_colon) = addr.rfind(':') {
        let ip = addr[..last_colon].to_string();
        let port = addr[last_colon + 1..].to_string();
        (ip, port)
    } else {
        (addr.to_string(), String::new())
    }
}

fn is_bare_ip(s: &str) -> bool {
    // IPv4: four octets
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() == 4 {
        return parts.iter().all(|p| p.parse::<u8>().is_ok());
    }
    // IPv6: contains ':'
    s.contains(':')
}

fn is_loopback(ip: &str) -> bool {
    ip == "127.0.0.1" || ip == "::1" || ip.starts_with("127.")
}

fn is_private_ip(ip: &str) -> bool {
    ip.starts_with("10.")
        || ip.starts_with("192.168.")
        || ip.starts_with("172.16.")
        || ip.starts_with("172.17.")
        || ip.starts_with("172.18.")
        || ip.starts_with("172.19.")
        || ip.starts_with("172.2")
        || ip.starts_with("172.30.")
        || ip.starts_with("172.31.")
        || ip.starts_with("fe80:") // link-local IPv6
        || ip.starts_with("fc") // ULA IPv6
        || ip.starts_with("fd")
}

#[allow(dead_code)]
fn is_state_word(s: &str) -> bool {
    matches!(
        s.to_uppercase().as_str(),
        "ESTABLISHED" | "LISTEN" | "TIME_WAIT" | "CLOSE_WAIT" | "SYN_SENT" | "SYN_RECV"
            | "FIN_WAIT1" | "FIN_WAIT2" | "CLOSING" | "LAST_ACK" | "CLOSED"
    )
}

// ── LLM tool definitions (wired into native_tools.rs) ────────────────────────

use crate::providers::ToolDefinition;

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "blade_security_scan".to_string(),
            description: "Run a full BLADE security scan: check network connections for suspicious activity, scan the filesystem for exposed credentials/keys, and return a summary. Use proactively when the user asks about security, or when you notice suspicious URLs/files in conversation.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "include_network": {"type": "boolean", "description": "Include network connection scan (default true)"},
                    "include_files": {"type": "boolean", "description": "Include sensitive file scan (default true)"}
                }
            }),
        },
        ToolDefinition {
            name: "blade_check_url_safety".to_string(),
            description: "Check whether a URL is safe or a likely phishing/malware attempt. Detects homograph attacks, brand-squatting, URL shorteners, bare IP addresses, and excessive subdomain depth. Use whenever a URL appears in clipboard, conversation, or browser navigation.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to analyse for phishing or safety signals"}
                },
                "required": ["url"]
            }),
        },
    ]
}

/// Dispatch security LLM tool calls. Called from native_tools::execute().
pub async fn execute_tool(name: &str, args: &serde_json::Value) -> Option<(String, bool)> {
    match name {
        "blade_security_scan" => {
            let include_network = args["include_network"].as_bool().unwrap_or(true);
            let include_files = args["include_files"].as_bool().unwrap_or(true);

            let mut output_parts: Vec<String> = Vec::new();

            if include_network {
                match scan_network_connections().await {
                    Ok(conns) => {
                        let suspicious: Vec<_> = conns.iter().filter(|c| c.suspicious).collect();
                        output_parts.push(format!(
                            "Network: {} total connections, {} suspicious\n{}",
                            conns.len(),
                            suspicious.len(),
                            suspicious
                                .iter()
                                .map(|c| format!("  [!] {} → {} ({})", c.local_addr, c.remote_addr, c.reason.as_deref().unwrap_or("")))
                                .collect::<Vec<_>>()
                                .join("\n")
                        ));
                    }
                    Err(e) => output_parts.push(format!("Network scan failed: {}", e)),
                }
            }

            if include_files {
                let files = scan_sensitive_files();
                let unprotected: Vec<_> = files.iter().filter(|f| !f.in_gitignore).collect();
                output_parts.push(format!(
                    "Sensitive files: {} found, {} not in .gitignore (leak risk)\n{}",
                    files.len(),
                    unprotected.len(),
                    unprotected
                        .iter()
                        .take(20)
                        .map(|f| format!("  [{}] {} — {}", f.risk, f.path, f.note))
                        .collect::<Vec<_>>()
                        .join("\n")
                ));
            }

            let result = output_parts.join("\n\n");
            Some((result, false))
        }

        "blade_check_url_safety" => {
            let url = match args["url"].as_str() {
                Some(u) => u,
                None => return Some(("Missing required argument: url".to_string(), true)),
            };
            let result = check_url_safety(url);
            let text = format!(
                "URL: {}\nRisk level: {}\nFlags:\n{}\nRecommendation: {}",
                result.url,
                result.risk_level,
                if result.flags.is_empty() {
                    "  (none)".to_string()
                } else {
                    result.flags.iter().map(|f| format!("  • {}", f)).collect::<Vec<_>>().join("\n")
                },
                result.recommendation
            );
            Some((text, false))
        }

        _ => None,
    }
}

