#![allow(dead_code)]

//! Scanner: bookmarks — extracts domain frequency from Chromium-format Bookmarks JSON.
//!
//! Threat mitigations (T-12-08):
//! - NEVER stores full URLs — only the hostname/domain
//! - Walk capped at 5000 nodes to prevent OOM on giant bookmark files
//! - No network calls

use std::collections::HashMap;
use std::path::PathBuf;

use crate::deep_scan::leads::Lead;

/// Row type for browser bookmarks (domain frequency summary).
#[derive(Debug, Clone)]
pub struct BookmarkRow {
    pub row_id: String,
    pub browser: String,
    pub count: usize,
    pub top_domains: Vec<String>,
    pub source: String,
}

/// Run the bookmarks scanner for a given lead.
/// Returns Vec<BookmarkRow> — one row per detected browser with bookmarks.
pub fn run(_lead: &Lead) -> Vec<BookmarkRow> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut rows: Vec<BookmarkRow> = Vec::new();

    // Chromium-layout browser paths (Linux / WSL)
    let browser_paths: &[(&str, &str)] = &[
        ("chrome",  ".config/google-chrome/Default/Bookmarks"),
        ("brave",   ".config/BraveSoftware/Brave-Browser/Default/Bookmarks"),
        ("edge",    ".config/microsoft-edge/Default/Bookmarks"),
    ];

    for (browser_name, rel_path) in browser_paths {
        let bm_file = home.join(rel_path);
        if !bm_file.is_file() { continue; }
        let Ok(content) = std::fs::read_to_string(&bm_file) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else { continue };

        let mut domain_freq: HashMap<String, usize> = HashMap::new();
        let mut total_count = 0usize;
        let mut node_budget = 5000usize;

        // Walk bookmark_bar + other roots
        if let Some(roots) = json.get("roots") {
            for root_key in ["bookmark_bar", "other", "synced"] {
                if let Some(root) = roots.get(root_key) {
                    walk_bookmark_node(root, &mut domain_freq, &mut total_count, &mut node_budget);
                }
            }
        }

        if total_count == 0 { continue; }

        // Top-10 domains by frequency
        let mut sorted: Vec<(String, usize)> = domain_freq.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        let top_domains: Vec<String> = sorted.into_iter().take(10).map(|(d, _)| d).collect();

        rows.push(BookmarkRow {
            row_id: format!("bookmark:{}", browser_name),
            browser: browser_name.to_string(),
            count: total_count,
            top_domains,
            source: "bookmarks".to_string(),
        });
    }

    rows
}

/// Recursively walk a bookmark tree node, extracting domains.
/// Caps at `node_budget` nodes to prevent OOM.
fn walk_bookmark_node(
    node: &serde_json::Value,
    domain_freq: &mut HashMap<String, usize>,
    total_count: &mut usize,
    node_budget: &mut usize,
) {
    if *node_budget == 0 { return; }
    *node_budget -= 1;

    match node.get("type").and_then(|t| t.as_str()) {
        Some("url") => {
            if let Some(url) = node.get("url").and_then(|u| u.as_str()) {
                if let Some(domain) = extract_domain(url) {
                    *domain_freq.entry(domain).or_insert(0) += 1;
                    *total_count += 1;
                }
            }
        }
        Some("folder") | None => {
            if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
                for child in children {
                    if *node_budget == 0 { break; }
                    walk_bookmark_node(child, domain_freq, total_count, node_budget);
                }
            }
        }
        _ => {}
    }
}

/// Extract hostname from a URL string.
/// Returns None if the URL cannot be parsed.
fn extract_domain(url: &str) -> Option<String> {
    // Simple regex-free extraction: find "://" then take until next "/" or "?" or "#" or end
    let after_scheme = url.splitn(2, "://").nth(1)?;
    // Strip port and path
    let host_with_port = after_scheme.split('/').next()?.split('?').next()?.split('#').next()?;
    let host = host_with_port.split(':').next()?;
    if host.is_empty() { return None; }
    // Normalize: lowercase, strip www. prefix
    let normalized = host.trim_start_matches("www.").to_lowercase();
    if normalized.is_empty() { return None; }
    Some(normalized)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chromium_json(urls: &[(&str, &str)]) -> serde_json::Value {
        let children: Vec<serde_json::Value> = urls.iter().map(|(name, url)| {
            serde_json::json!({
                "type": "url",
                "name": name,
                "url": url
            })
        }).collect();
        serde_json::json!({
            "roots": {
                "bookmark_bar": {
                    "type": "folder",
                    "name": "Bookmarks bar",
                    "children": children
                },
                "other": {
                    "type": "folder",
                    "name": "Other bookmarks",
                    "children": []
                }
            }
        })
    }

    #[test]
    fn test_parses_chrome_json() {
        let fixture = make_chromium_json(&[
            ("Example", "https://example.com/path?q=1"),
            ("GitHub",  "https://github.com/user/repo"),
            ("Docs",    "https://docs.google.com/spreadsheets"),
        ]);

        let mut domain_freq: HashMap<String, usize> = HashMap::new();
        let mut total_count = 0usize;
        let mut node_budget = 5000usize;

        if let Some(roots) = fixture.get("roots") {
            if let Some(bm_bar) = roots.get("bookmark_bar") {
                walk_bookmark_node(bm_bar, &mut domain_freq, &mut total_count, &mut node_budget);
            }
        }

        assert_eq!(total_count, 3, "expected 3 bookmarks, got {}", total_count);

        let domains: Vec<String> = {
            let mut sorted: Vec<(String, usize)> = domain_freq.into_iter().collect();
            sorted.sort_by(|a, b| b.1.cmp(&a.1));
            sorted.into_iter().map(|(d, _)| d).collect()
        };

        assert!(domains.contains(&"example.com".to_string()), "expected example.com in domains: {:?}", domains);
        assert!(domains.contains(&"github.com".to_string()), "expected github.com in domains: {:?}", domains);
        assert!(domains.contains(&"docs.google.com".to_string()), "expected docs.google.com in domains: {:?}", domains);
    }

    #[test]
    fn test_no_full_urls_stored() {
        let fixture = make_chromium_json(&[
            ("Secret Page", "https://secret.example.com/private?token=super-secret"),
            ("Work",        "https://internal.corp.example.org/dashboard"),
        ]);

        let mut domain_freq: HashMap<String, usize> = HashMap::new();
        let mut total_count = 0usize;
        let mut node_budget = 5000usize;

        if let Some(roots) = fixture.get("roots") {
            if let Some(bm_bar) = roots.get("bookmark_bar") {
                walk_bookmark_node(bm_bar, &mut domain_freq, &mut total_count, &mut node_budget);
            }
        }

        let mut sorted: Vec<(String, usize)> = domain_freq.into_iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(&a.1));
        let top_domains: Vec<String> = sorted.into_iter().take(10).map(|(d, _)| d).collect();

        let row = BookmarkRow {
            row_id: "bookmark:chrome".to_string(),
            browser: "chrome".to_string(),
            count: total_count,
            top_domains,
            source: "bookmarks".to_string(),
        };

        let debug_str = format!("{:?}", row);

        // Full URLs must NEVER appear in the stored row
        assert!(!debug_str.contains("https://secret.example.com/private"),
            "Full URL must not appear in BookmarkRow. Debug: {}", debug_str);
        assert!(!debug_str.contains("super-secret"),
            "URL parameters must not appear in BookmarkRow. Debug: {}", debug_str);
        assert!(!debug_str.contains("https://internal.corp.example.org"),
            "Full URL must not appear in BookmarkRow. Debug: {}", debug_str);
    }

    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("https://www.github.com/user/repo"), Some("github.com".to_string()));
        assert_eq!(extract_domain("http://example.com:8080/path"), Some("example.com".to_string()));
        assert_eq!(extract_domain("https://docs.google.com/doc"), Some("docs.google.com".to_string()));
        assert_eq!(extract_domain("file:///local/path"), Some("".to_string()).filter(|s| !s.is_empty()).or(None));
        assert_eq!(extract_domain("not-a-url"), None);
    }
}
