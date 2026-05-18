// Phase 77 (v2.4) — macOS Accessibility (AX) tree introspection.
//
// Fixes Mac UAT 2026-05-17 B1: "AX bridge regression — accessibility surface
// broken on macOS." computer_use.rs / system_control.rs had no native AX path.
//
// Pattern-lift from antbotlab/mac-use-mcp `src/tools/accessibility.ts` (MIT)
// which calls a Swift helper binary. v2.4 first pass uses osascript + JXA
// (JavaScript-for-Automation) instead — zero new Cargo deps, covers the
// chat-driven query case. Loop-driven introspection at <10ms/query needs the
// Swift helper sidecar; deferred to v2.5+ if the JXA path proves insufficient.
//
// Module is #[cfg(target_os = "macos")] for the subprocess wrappers; the
// pure-Rust parser is always available so falsification tests run on any host.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AxPoint { pub x: i32, pub y: i32 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AxSize { pub width: i32, pub height: i32 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UIElement {
    pub role: String,
    pub title: String,
    pub position: AxPoint,
    pub size: AxSize,
    #[serde(default)]
    pub children: Vec<UIElement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AxQuery {
    /// Target app name. None → frontmost app.
    pub app: Option<String>,
    /// Filter by AX role (e.g. "AXButton", "AXTextField"). None → all roles.
    pub role: Option<String>,
    /// Filter by element title (substring, case-insensitive). None → no filter.
    pub title: Option<String>,
    /// Max tree traversal depth. Default 5, hard cap 10.
    pub max_depth: u32,
}

impl Default for AxQuery {
    fn default() -> Self {
        Self { app: None, role: None, title: None, max_depth: 5 }
    }
}

/// Parse JXA-emitted JSON UI-tree output into BLADE's UIElement shape.
/// Lifted shape mirrors mac-use-mcp's get_ui_elements response.
pub fn parse_ax_output(json_str: &str) -> Result<Vec<UIElement>, String> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() { return Ok(vec![]); }
    serde_json::from_str::<Vec<UIElement>>(trimmed)
        .map_err(|e| format!("AX output parse error: {} — raw: {}", e, crate::safe_slice(trimmed, 200)))
}

/// Apply role + title filters (post-parse). Mirrors mac-use-mcp filter semantics:
/// role match is exact, title match is substring + case-insensitive.
pub fn filter_elements(elements: &[UIElement], role: Option<&str>, title: Option<&str>) -> Vec<UIElement> {
    let title_lower = title.map(|t| t.to_lowercase());
    elements.iter()
        .filter(|el| {
            role.is_none_or(|r| el.role == r)
                && title_lower.as_ref().is_none_or(|t| el.title.to_lowercase().contains(t))
        })
        .cloned()
        .collect()
}

// ── macOS subprocess wrappers ───────────────────────────────────────────

#[cfg(target_os = "macos")]
fn build_jxa_script(app: Option<&str>, max_depth: u32) -> String {
    let depth_cap = max_depth.clamp(1, 10);
    let app_clause = match app {
        Some(name) => format!(
            r#"var procs = se.processes.whose({{ name: "{}" }});
var proc = procs.length > 0 ? procs[0] : null;"#,
            name.replace('"', "\\\"")
        ),
        None => "var proc = se.processes.whose({ frontmost: true })[0];".to_string(),
    };
    format!(r#"
var se = Application('System Events');
se.includeStandardAdditions = true;
{app_clause}
if (!proc) {{ return '[]'; }}

function walk(el, depth) {{
    if (depth > {depth_cap}) return null;
    var role = ''; var title = '';
    try {{ role = el.role(); }} catch (e) {{}}
    try {{ title = el.title() || el.value() || ''; }} catch (e) {{}}
    var pos = [0, 0]; var sz = [0, 0];
    try {{ pos = el.position(); }} catch (e) {{}}
    try {{ sz = el.size(); }} catch (e) {{}}
    var kids = [];
    try {{
        var entries = el.uiElements();
        for (var i = 0; i < entries.length; i++) {{
            var child = walk(entries[i], depth + 1);
            if (child) kids.push(child);
        }}
    }} catch (e) {{}}
    return {{
        role: role || 'AXUnknown',
        title: title || '',
        position: {{ x: pos[0] || 0, y: pos[1] || 0 }},
        size: {{ width: sz[0] || 0, height: sz[1] || 0 }},
        children: kids
    }};
}}

var roots = [];
try {{
    var wins = proc.windows();
    for (var i = 0; i < wins.length; i++) {{
        var t = walk(wins[i], 1);
        if (t) roots.push(t);
    }}
}} catch (e) {{}}
JSON.stringify(roots);
"#)
}

/// Query the AX tree of the target (or frontmost) app via osascript+JXA.
#[cfg(target_os = "macos")]
pub fn get_ui_elements(query: &AxQuery) -> Result<Vec<UIElement>, String> {
    use std::process::Command;
    let script = build_jxa_script(query.app.as_deref(), query.max_depth);
    let out = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", &script])
        .output()
        .map_err(|e| format!("osascript spawn failed: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        // Accessibility permission denied is the canonical first-run failure mode.
        if stderr.contains("not allowed assistive access") || stderr.contains("1002") {
            return Err("Accessibility permission required (System Settings → Privacy & Security → Accessibility)".to_string());
        }
        return Err(format!("osascript error: {}", stderr));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let elements = parse_ax_output(&stdout)?;
    Ok(filter_elements(&elements, query.role.as_deref(), query.title.as_deref()))
}

#[cfg(not(target_os = "macos"))]
pub fn get_ui_elements(_query: &AxQuery) -> Result<Vec<UIElement>, String> {
    Err("macos_ax::get_ui_elements is macOS-only".to_string())
}

// ── Tauri command surface ───────────────────────────────────────────────

#[tauri::command]
pub fn macos_ax_get_ui_elements(
    app: Option<String>,
    role: Option<String>,
    title: Option<String>,
    max_depth: Option<u32>,
) -> Result<Vec<UIElement>, String> {
    let query = AxQuery {
        app,
        role,
        title,
        max_depth: max_depth.unwrap_or(5).clamp(1, 10),
    };
    get_ui_elements(&query)
}

#[tauri::command]
pub fn macos_ax_available() -> bool {
    cfg!(target_os = "macos")
}

// ── Phase 77 falsification — runnable tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> &'static str {
        r#"[
            {
                "role": "AXWindow",
                "title": "Untitled",
                "position": {"x": 100, "y": 50},
                "size": {"width": 800, "height": 600},
                "children": [
                    {
                        "role": "AXButton",
                        "title": "OK",
                        "position": {"x": 120, "y": 580},
                        "size": {"width": 80, "height": 30},
                        "children": []
                    },
                    {
                        "role": "AXTextField",
                        "title": "Search",
                        "position": {"x": 120, "y": 100},
                        "size": {"width": 200, "height": 24},
                        "children": []
                    }
                ]
            }
        ]"#
    }

    #[test]
    fn parse_ax_output_handles_known_shape() {
        let elements = parse_ax_output(sample_json()).expect("parse ok");
        assert_eq!(elements.len(), 1, "one root window");
        let win = &elements[0];
        assert_eq!(win.role, "AXWindow");
        assert_eq!(win.position, AxPoint { x: 100, y: 50 });
        assert_eq!(win.size, AxSize { width: 800, height: 600 });
        assert_eq!(win.children.len(), 2);
        assert_eq!(win.children[0].role, "AXButton");
        assert_eq!(win.children[1].role, "AXTextField");
    }

    #[test]
    fn parse_ax_output_empty_returns_empty() {
        assert_eq!(parse_ax_output("").unwrap(), vec![]);
        assert_eq!(parse_ax_output("[]").unwrap(), vec![]);
        assert_eq!(parse_ax_output("   ").unwrap(), vec![]);
    }

    #[test]
    fn parse_ax_output_malformed_errors_does_not_panic() {
        assert!(parse_ax_output("not json").is_err());
        assert!(parse_ax_output("{").is_err());
        assert!(parse_ax_output("{\"missing_fields\": true}").is_err());
    }

    #[test]
    fn filter_elements_by_role_exact_match() {
        let elements = parse_ax_output(sample_json()).unwrap();
        let buttons = filter_elements(&elements[0].children, Some("AXButton"), None);
        assert_eq!(buttons.len(), 1);
        assert_eq!(buttons[0].title, "OK");
        let none = filter_elements(&elements[0].children, Some("AXSlider"), None);
        assert!(none.is_empty(), "filter rejects non-matching roles");
    }

    #[test]
    fn filter_elements_by_title_substring_case_insensitive() {
        let elements = parse_ax_output(sample_json()).unwrap();
        let search = filter_elements(&elements[0].children, None, Some("SEARCH"));
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].role, "AXTextField");
        let nothing = filter_elements(&elements[0].children, None, Some("doesnotexist"));
        assert!(nothing.is_empty());
    }

    #[test]
    fn ax_query_defaults_match_upstream() {
        let q = AxQuery::default();
        assert!(q.app.is_none(), "default targets frontmost app");
        assert!(q.role.is_none());
        assert!(q.title.is_none());
        assert_eq!(q.max_depth, 5, "matches mac-use-mcp default depth");
    }

    #[test]
    fn macos_ax_available_matches_compile_target() {
        assert_eq!(macos_ax_available(), cfg!(target_os = "macos"));
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn non_macos_get_ui_elements_errors_gracefully() {
        let q = AxQuery::default();
        let result = get_ui_elements(&q);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("macOS-only"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_get_ui_elements_returns_or_permission_err() {
        // Integration: on macOS, either returns Ok(elements) or Err with the
        // canonical permission message. Either is the contract; the test only
        // fails on panic.
        let q = AxQuery::default();
        match get_ui_elements(&q) {
            Ok(els) => {
                eprintln!("macos AX returned {} root window(s)", els.len());
            }
            Err(e) => {
                assert!(
                    e.contains("Accessibility") || e.contains("osascript") || e.contains("not allowed"),
                    "unexpected error shape: {}", e
                );
            }
        }
    }
}
