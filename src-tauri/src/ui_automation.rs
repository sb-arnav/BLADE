use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UiBounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UiElementSummary {
    pub name: String,
    pub automation_id: String,
    pub class_name: String,
    pub control_type: String,
    pub localized_control_type: String,
    pub framework_id: String,
    pub has_keyboard_focus: bool,
    pub is_enabled: bool,
    pub bounds: UiBounds,
    pub children: Vec<UiElementSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UiWindowSnapshot {
    pub window_name: String,
    pub window_class_name: String,
    pub window_control_type: String,
    pub bounds: UiBounds,
    pub focused_element: Option<UiElementSummary>,
    pub elements: Vec<UiElementSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UiSelector {
    pub name: Option<String>,
    pub automation_id: Option<String>,
    pub class_name: Option<String>,
    pub control_type: Option<String>,
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{UiBounds, UiElementSummary, UiSelector, UiWindowSnapshot};
    use uiautomation::controls::ControlType;
    use uiautomation::patterns::{UIInvokePattern, UIValuePattern};
    use uiautomation::types::TreeScope;
    use uiautomation::{UIAutomation, UIElement};

    #[tauri::command]
    pub fn uia_get_active_window_snapshot(
        max_depth: Option<u32>,
        max_children: Option<u32>,
    ) -> Result<UiWindowSnapshot, String> {
        active_window_snapshot_internal(max_depth, max_children)
    }

    #[tauri::command]
    pub fn uia_describe_active_window(
        max_depth: Option<u32>,
        max_children: Option<u32>,
        max_lines: Option<u32>,
    ) -> Result<String, String> {
        describe_active_window_ui_internal(max_depth, max_children, max_lines)
    }

    #[tauri::command]
    pub fn uia_click_element(selector: UiSelector) -> Result<String, String> {
        let element = find_matching_element(&selector)?;
        let label = summarize_label(&element);
        element
            .click()
            .map_err(|error| format!("UI Automation click failed: {}", error))?;
        Ok(format!("Clicked {}", label))
    }

    #[tauri::command]
    pub fn uia_invoke_element(selector: UiSelector) -> Result<String, String> {
        let element = find_matching_element(&selector)?;
        let label = summarize_label(&element);
        if let Ok(pattern) = element.get_pattern::<UIInvokePattern>() {
            pattern
                .invoke()
                .map_err(|error| format!("UI Automation invoke failed: {}", error))?;
        } else {
            element.click().map_err(|error| {
                format!("UI Automation invoke fallback click failed: {}", error)
            })?;
        }
        Ok(format!("Invoked {}", label))
    }

    #[tauri::command]
    pub fn uia_focus_element(selector: UiSelector) -> Result<String, String> {
        let element = find_matching_element(&selector)?;
        let label = summarize_label(&element);
        element
            .set_focus()
            .map_err(|error| format!("UI Automation focus failed: {}", error))?;
        Ok(format!("Focused {}", label))
    }

    #[tauri::command]
    pub fn uia_set_element_value(selector: UiSelector, value: String) -> Result<String, String> {
        let element = find_matching_element(&selector)?;
        let label = summarize_label(&element);
        if let Ok(pattern) = element.get_pattern::<UIValuePattern>() {
            pattern
                .set_value(&value)
                .map_err(|error| format!("UI Automation set value failed: {}", error))?;
        } else {
            element
                .set_focus()
                .map_err(|error| format!("UI Automation focus before typing failed: {}", error))?;
            element
                .send_keys("^a", 20)
                .map_err(|error| format!("UI Automation select-all failed: {}", error))?;
            element
                .send_text(&value, 20)
                .map_err(|error| format!("UI Automation type fallback failed: {}", error))?;
        }
        Ok(format!("Set value for {}", label))
    }

    #[tauri::command]
    pub fn uia_wait_for_element(
        selector: UiSelector,
        timeout_ms: Option<u64>,
    ) -> Result<String, String> {
        uia_wait_for_element_internal(selector, timeout_ms.unwrap_or(5000))
    }

    pub(crate) fn describe_active_window_ui_internal(
        max_depth: Option<u32>,
        max_children: Option<u32>,
        max_lines: Option<u32>,
    ) -> Result<String, String> {
        let snapshot = active_window_snapshot_internal(max_depth, max_children)?;
        let mut lines = vec![format!(
            "- window: {} [{}]",
            blank_as_unknown(&snapshot.window_name),
            blank_as_unknown(&snapshot.window_control_type)
        )];
        if let Some(focused) = snapshot.focused_element.as_ref() {
            lines.push(format!(
                "- focused: {} [{}]",
                blank_as_unknown(&focused.name),
                blank_as_unknown(&focused.localized_control_type)
            ));
        }
        flatten_lines(
            &snapshot.elements,
            0,
            &mut lines,
            max_lines.unwrap_or(24) as usize,
        );
        Ok(lines.join("\n"))
    }

    pub(crate) fn uia_click_internal(selector: UiSelector) -> Result<String, String> {
        uia_click_element(selector)
    }

    pub(crate) fn uia_invoke_internal(selector: UiSelector) -> Result<String, String> {
        uia_invoke_element(selector)
    }

    pub(crate) fn uia_focus_internal(selector: UiSelector) -> Result<String, String> {
        uia_focus_element(selector)
    }

    pub(crate) fn uia_set_value_internal(
        selector: UiSelector,
        value: String,
    ) -> Result<String, String> {
        uia_set_element_value(selector, value)
    }

    pub(crate) fn uia_wait_for_element_internal(
        selector: UiSelector,
        timeout_ms: u64,
    ) -> Result<String, String> {
        let timeout = timeout_ms.clamp(200, 15000);
        let started = std::time::Instant::now();
        loop {
            if let Ok(element) = find_matching_element(&selector) {
                return Ok(format!("Found {}", summarize_label(&element)));
            }

            if started.elapsed() >= std::time::Duration::from_millis(timeout) {
                return Err(format!(
                    "Blade timed out waiting for a matching native control after {}ms.",
                    timeout
                ));
            }

            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    }

    fn active_window_snapshot_internal(
        max_depth: Option<u32>,
        max_children: Option<u32>,
    ) -> Result<UiWindowSnapshot, String> {
        let automation =
            UIAutomation::new().map_err(|error| format!("UI Automation init failed: {}", error))?;
        let focused = automation
            .get_focused_element()
            .map_err(|error| format!("UI Automation could not get focused element: {}", error))?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|error| format!("UI Automation walker failed: {}", error))?;
        let window = find_window_ancestor(&walker, &focused)?;
        let focus_summary = summarize_element(&focused, 0, 0, 0);
        let mut node_budget = 0usize;
        let elements = collect_children(
            &walker,
            &window,
            0,
            max_depth.unwrap_or(2),
            max_children.unwrap_or(12),
            &mut node_budget,
            80,
        );

        Ok(UiWindowSnapshot {
            window_name: window.get_name().unwrap_or_default(),
            window_class_name: window.get_classname().unwrap_or_default(),
            window_control_type: format!(
                "{:?}",
                window.get_control_type().unwrap_or(ControlType::Window)
            ),
            bounds: element_bounds(&window),
            focused_element: Some(focus_summary),
            elements,
        })
    }

    fn find_matching_element(selector: &UiSelector) -> Result<UIElement, String> {
        let automation =
            UIAutomation::new().map_err(|error| format!("UI Automation init failed: {}", error))?;
        let focused = automation
            .get_focused_element()
            .map_err(|error| format!("UI Automation could not get focused element: {}", error))?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|error| format!("UI Automation walker failed: {}", error))?;
        let window = find_window_ancestor(&walker, &focused)?;
        let candidates = window
            .find_all(
                TreeScope::Descendants,
                &automation
                    .create_true_condition()
                    .map_err(|error| format!("UI Automation condition failed: {}", error))?,
            )
            .map_err(|error| format!("UI Automation search failed: {}", error))?;

        let mut best_score = 0i32;
        let mut best_element: Option<UIElement> = None;
        for candidate in candidates {
            let score = score_element(&candidate, selector);
            if score > best_score {
                best_score = score;
                best_element = Some(candidate);
            }
        }

        if best_score <= 0 {
            return Err(
                "Blade could not find a matching native UI element in the active window."
                    .to_string(),
            );
        }

        best_element.ok_or("Blade could not resolve the matched native UI element.".to_string())
    }

    fn score_element(element: &UIElement, selector: &UiSelector) -> i32 {
        let name = element.get_name().unwrap_or_default().to_ascii_lowercase();
        let automation_id = element
            .get_automation_id()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let class_name = element
            .get_classname()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let control_type = format!(
            "{:?}",
            element.get_control_type().unwrap_or(ControlType::Custom)
        )
        .to_ascii_lowercase();
        let localized_control_type = element
            .get_localized_control_type()
            .unwrap_or_default()
            .to_ascii_lowercase();

        let mut score = 0;

        if let Some(value) = selector
            .automation_id
            .as_ref()
            .map(|value| value.to_ascii_lowercase())
        {
            if automation_id == value {
                score += 12;
            } else if automation_id.contains(&value) {
                score += 8;
            } else {
                return 0;
            }
        }

        if let Some(value) = selector
            .name
            .as_ref()
            .map(|value| value.to_ascii_lowercase())
        {
            if name == value {
                score += 10;
            } else if name.contains(&value) {
                score += 6;
            } else {
                return 0;
            }
        }

        if let Some(value) = selector
            .class_name
            .as_ref()
            .map(|value| value.to_ascii_lowercase())
        {
            if class_name == value {
                score += 4;
            } else if class_name.contains(&value) {
                score += 2;
            } else {
                return 0;
            }
        }

        if let Some(value) = selector
            .control_type
            .as_ref()
            .map(|value| value.to_ascii_lowercase())
        {
            if control_type == value || localized_control_type == value {
                score += 4;
            } else if control_type.contains(&value) || localized_control_type.contains(&value) {
                score += 2;
            } else {
                return 0;
            }
        }

        if score == 0 && !name.is_empty() {
            score = 1;
        }

        score
    }

    fn find_window_ancestor(
        walker: &uiautomation::UITreeWalker,
        focused: &UIElement,
    ) -> Result<UIElement, String> {
        let mut current = focused.clone();
        for _ in 0..20 {
            if matches!(current.get_control_type(), Ok(ControlType::Window)) {
                return Ok(current);
            }
            match walker.get_parent(&current) {
                Ok(parent) => current = parent,
                Err(_) => break,
            }
        }
        Ok(current)
    }

    fn collect_children(
        walker: &uiautomation::UITreeWalker,
        root: &UIElement,
        depth: u32,
        max_depth: u32,
        max_children: u32,
        node_budget: &mut usize,
        max_nodes: usize,
    ) -> Vec<UiElementSummary> {
        if depth >= max_depth || *node_budget >= max_nodes {
            return Vec::new();
        }

        let mut items = Vec::new();
        let mut current = match walker.get_first_child(root) {
            Ok(child) => Some(child),
            Err(_) => None,
        };
        let mut count = 0u32;

        while let Some(element) = current {
            if *node_budget >= max_nodes || count >= max_children {
                break;
            }
            *node_budget += 1;
            count += 1;
            let mut summary = summarize_element(&element, depth + 1, *node_budget, max_nodes);
            summary.children = collect_children(
                walker,
                &element,
                depth + 1,
                max_depth,
                max_children,
                node_budget,
                max_nodes,
            );
            items.push(summary);
            current = walker.get_next_sibling(&element).ok();
        }

        items
    }

    fn summarize_element(
        element: &UIElement,
        _depth: u32,
        _index: usize,
        _max_nodes: usize,
    ) -> UiElementSummary {
        UiElementSummary {
            name: element.get_name().unwrap_or_default(),
            automation_id: element.get_automation_id().unwrap_or_default(),
            class_name: element.get_classname().unwrap_or_default(),
            control_type: format!(
                "{:?}",
                element.get_control_type().unwrap_or(ControlType::Custom)
            ),
            localized_control_type: element.get_localized_control_type().unwrap_or_default(),
            framework_id: element.get_framework_id().unwrap_or_default(),
            has_keyboard_focus: element.has_keyboard_focus().unwrap_or(false),
            is_enabled: element.is_enabled().unwrap_or(true),
            bounds: element_bounds(element),
            children: Vec::new(),
        }
    }

    fn element_bounds(element: &UIElement) -> UiBounds {
        let rect = match element.get_bounding_rectangle() {
            Ok(rect) => rect,
            Err(_) => return UiBounds::default(),
        };
        let left = rect.get_left();
        let top = rect.get_top();
        let right = rect.get_right();
        let bottom = rect.get_bottom();
        UiBounds {
            left,
            top,
            right,
            bottom,
            width: right.saturating_sub(left),
            height: bottom.saturating_sub(top),
        }
    }

    fn summarize_label(element: &UIElement) -> String {
        let name = element.get_name().unwrap_or_default();
        let control_type = element.get_localized_control_type().unwrap_or_default();
        if name.trim().is_empty() {
            format!("{} element", blank_as_unknown(&control_type))
        } else {
            format!("`{}` [{}]", name, blank_as_unknown(&control_type))
        }
    }

    fn flatten_lines(
        elements: &[UiElementSummary],
        depth: usize,
        lines: &mut Vec<String>,
        max_lines: usize,
    ) {
        for element in elements {
            if lines.len() >= max_lines {
                break;
            }
            let indent = "  ".repeat(depth);
            let mut bits = vec![format!(
                "{}- {} [{}]",
                indent,
                blank_as_unknown(&element.name),
                blank_as_unknown(&element.localized_control_type)
            )];
            if !element.automation_id.trim().is_empty() {
                bits.push(format!("id={}", element.automation_id));
            }
            if !element.class_name.trim().is_empty() {
                bits.push(format!("class={}", element.class_name));
            }
            lines.push(bits.join(" "));
            flatten_lines(&element.children, depth + 1, lines, max_lines);
        }
    }

    fn blank_as_unknown(value: &str) -> String {
        if value.trim().is_empty() {
            "unknown".to_string()
        } else {
            value.to_string()
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::{UiSelector, UiWindowSnapshot};

    #[tauri::command]
    pub fn uia_get_active_window_snapshot(
        _max_depth: Option<u32>,
        _max_children: Option<u32>,
    ) -> Result<UiWindowSnapshot, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    #[tauri::command]
    pub fn uia_describe_active_window(
        _max_depth: Option<u32>,
        _max_children: Option<u32>,
        _max_lines: Option<u32>,
    ) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    #[tauri::command]
    pub fn uia_click_element(_selector: UiSelector) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    #[tauri::command]
    pub fn uia_invoke_element(_selector: UiSelector) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    #[tauri::command]
    pub fn uia_focus_element(_selector: UiSelector) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    #[tauri::command]
    pub fn uia_set_element_value(_selector: UiSelector, _value: String) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    #[tauri::command]
    pub fn uia_wait_for_element(
        _selector: UiSelector,
        _timeout_ms: Option<u64>,
    ) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    pub(crate) fn describe_active_window_ui_internal(
        _max_depth: Option<u32>,
        _max_children: Option<u32>,
        _max_lines: Option<u32>,
    ) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    pub(crate) fn uia_click_internal(_selector: UiSelector) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    pub(crate) fn uia_invoke_internal(_selector: UiSelector) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    pub(crate) fn uia_focus_internal(_selector: UiSelector) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    pub(crate) fn uia_set_value_internal(
        _selector: UiSelector,
        _value: String,
    ) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }

    pub(crate) fn uia_wait_for_element_internal(
        _selector: UiSelector,
        _timeout_ms: u64,
    ) -> Result<String, String> {
        Err("Windows UI Automation is only available on Windows.".to_string())
    }
}

pub use imp::*;

// ───────────────────────────────────────────────────────────────────────────
// CLICK hand (v3.0 OPERATOR) — A11Y grounding resolver.
//
// Platform-independent. Operates on a captured `UiElementSummary` tree (the
// thing `uia_get_active_window_snapshot` returns on Windows) and turns a
// natural-language target — "click the Submit button", "the search field" —
// into ranked, addressable element candidates. This is the deterministic,
// model-free, OFFLINE core of the CLICK hand: the "accessibility-tree +
// Set-of-Mark" grounding the 2026 computer-use research found beats raw
// pixel-vision 3-5x with far fewer misclicks. It needs no API key, so it is
// fully buildable + unit-testable here (the live UIA read/click is Windows-only
// above; the model-driven vision fallback is a later phase).
// ───────────────────────────────────────────────────────────────────────────

/// A scored grounding candidate — the element plus an explainable reason.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroundedElement {
    pub element: UiElementSummary,
    pub score: f32,
    /// Click point — center of the element's bounds (screen coords).
    pub center: (i32, i32),
    pub reason: String,
}

/// Role keywords a user might say, mapped to UIA control-type substrings.
/// Matched case-insensitively against `control_type` + `localized_control_type`.
const ROLE_HINTS: &[(&str, &[&str])] = &[
    ("button", &["button"]),
    ("btn", &["button"]),
    ("link", &["hyperlink", "link"]),
    ("tab", &["tab"]),
    ("menu", &["menu"]),
    ("checkbox", &["checkbox", "check box"]),
    ("radio", &["radio"]),
    ("field", &["edit", "text", "combo", "document"]),
    ("input", &["edit", "text", "combo"]),
    ("textbox", &["edit", "text"]),
    ("box", &["edit", "combo", "check box", "list"]),
    ("dropdown", &["combo", "list"]),
    ("combo", &["combo"]),
    ("list", &["list"]),
    ("item", &["item", "list item", "menu item"]),
    ("icon", &["button", "image"]),
    ("toggle", &["button", "checkbox"]),
    ("switch", &["button", "checkbox"]),
];

/// Stop-words stripped from a target query before label matching, so
/// "click the Submit button" reduces to the meaningful token "submit".
const QUERY_STOPWORDS: &[&str] = &[
    "click", "press", "tap", "select", "choose", "open", "the", "a", "an",
    "on", "in", "to", "please", "go", "hit", "this", "that", "my",
];

fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}

fn tokens(s: &str) -> Vec<String> {
    normalize(s)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}

/// Role substrings implied by the query's role words, if any.
fn role_targets(query_tokens: &[String]) -> Vec<&'static str> {
    let mut out = Vec::new();
    for (word, subs) in ROLE_HINTS {
        if query_tokens.iter().any(|t| t == word) {
            for s in *subs {
                if !out.contains(s) {
                    out.push(*s);
                }
            }
        }
    }
    out
}

/// Meaningful label tokens of the query (role words + stop-words removed).
fn label_tokens(query_tokens: &[String]) -> Vec<String> {
    let role_words: Vec<&str> = ROLE_HINTS.iter().map(|(w, _)| *w).collect();
    query_tokens
        .iter()
        .filter(|t| !QUERY_STOPWORDS.contains(&t.as_str()) && !role_words.contains(&t.as_str()))
        .cloned()
        .collect()
}

/// Flatten the element tree depth-first into a flat list (Set-of-Mark indexing).
pub fn flatten_elements(root: &[UiElementSummary]) -> Vec<UiElementSummary> {
    let mut out = Vec::new();
    fn walk(el: &UiElementSummary, out: &mut Vec<UiElementSummary>) {
        let mut shallow = el.clone();
        shallow.children = Vec::new(); // flat copy — children live as their own entries
        out.push(shallow);
        for child in &el.children {
            walk(child, out);
        }
    }
    for el in root {
        walk(el, &mut out);
    }
    out
}

fn control_type_matches(el: &UiElementSummary, role_subs: &[&str]) -> bool {
    if role_subs.is_empty() {
        return false;
    }
    let ct = normalize(&el.control_type);
    let lct = normalize(&el.localized_control_type);
    role_subs.iter().any(|s| ct.contains(s) || lct.contains(s))
}

/// Score how well an element's label matches the query's label tokens.
/// 0.0 (no overlap) .. 1.0 (exact). Considers exact, substring, and token
/// overlap so "save" hits "Save All" and "submit" hits "Submit order".
fn label_score(el_name: &str, query_label: &[String]) -> f32 {
    if query_label.is_empty() {
        return 0.0; // role-only query — handled separately
    }
    let name_norm = normalize(el_name);
    if name_norm.is_empty() {
        return 0.0;
    }
    let joined = query_label.join(" ");
    if name_norm == joined {
        return 1.0;
    }
    let name_toks = tokens(el_name);
    if name_toks.is_empty() {
        return 0.0;
    }
    // Whole-query substring of the label (or vice-versa) → strong.
    if name_norm.contains(&joined) || joined.contains(&name_norm) {
        return 0.9;
    }
    // Token overlap: fraction of query-label tokens present in the label.
    let hits = query_label
        .iter()
        .filter(|qt| name_toks.iter().any(|nt| nt == *qt || nt.contains(qt.as_str())))
        .count();
    if hits == 0 {
        return 0.0;
    }
    0.5 + 0.4 * (hits as f32 / query_label.len() as f32)
}

/// Resolve a natural-language target against a captured UIA tree. Returns
/// candidates ranked best-first (empty when nothing clears the floor).
///
/// Deterministic scoring (no model): label match dominates; role affinity,
/// enabled, focus, and addressability adjust; invisible/disabled elements are
/// penalized. `center` is the click point. This is what lets the agent loop
/// say "click Submit" and get a reliable target instead of guessing pixels.
pub fn resolve_target(root: &[UiElementSummary], query: &str) -> Vec<GroundedElement> {
    let q_tokens = tokens(query);
    let role_subs = role_targets(&q_tokens);
    let q_label = label_tokens(&q_tokens);
    let role_only = q_label.is_empty() && !role_subs.is_empty();

    let mut scored: Vec<GroundedElement> = Vec::new();
    for el in flatten_elements(root) {
        // Addressability: must have a name or automation_id to be actionable.
        let addressable = !el.name.trim().is_empty() || !el.automation_id.trim().is_empty();
        if !addressable {
            continue;
        }

        let lscore = label_score(&el.name, &q_label);
        let role_hit = control_type_matches(&el, &role_subs);

        // Base must come from either a label hit or (for role-only queries) a
        // role hit — otherwise this element isn't a candidate at all.
        if lscore == 0.0 && !(role_only && role_hit) {
            continue;
        }

        let mut score = lscore;
        let mut why: Vec<String> = Vec::new();
        if lscore > 0.0 {
            why.push(format!("label~{:.2}", lscore));
        }
        if role_hit {
            score += 0.25;
            // Role-only query ("the button") has no label to score — the role
            // match IS the signal, so give it a base above the floor.
            if role_only {
                score += 0.35;
            }
            why.push("role".into());
        } else if !role_subs.is_empty() && !role_only {
            // Query named a role but this element is a different type → mild penalty.
            score -= 0.10;
        }
        if el.is_enabled {
            score += 0.05;
        } else {
            score -= 0.30;
            why.push("disabled".into());
        }
        if el.has_keyboard_focus {
            score += 0.05;
            why.push("focused".into());
        }
        // Invisible / zero-size elements are not clickable targets.
        if el.bounds.width <= 0 || el.bounds.height <= 0 {
            score -= 0.50;
            why.push("zero-size".into());
        }

        let center = (
            el.bounds.left + el.bounds.width / 2,
            el.bounds.top + el.bounds.height / 2,
        );
        scored.push(GroundedElement {
            element: el,
            score,
            center,
            reason: why.join("+"),
        });
    }

    // Rank best-first; drop anything below a confidence floor.
    scored.retain(|g| g.score >= 0.35);
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored
}

#[cfg(test)]
mod grounding_tests {
    use super::*;

    fn el(name: &str, ct: &str, enabled: bool, w: i32, h: i32) -> UiElementSummary {
        UiElementSummary {
            name: name.to_string(),
            automation_id: String::new(),
            class_name: String::new(),
            control_type: ct.to_string(),
            localized_control_type: ct.to_lowercase(),
            framework_id: String::new(),
            has_keyboard_focus: false,
            is_enabled: enabled,
            bounds: UiBounds { left: 10, top: 20, right: 10 + w, bottom: 20 + h, width: w, height: h },
            children: Vec::new(),
        }
    }

    #[test]
    fn exact_label_ranks_first() {
        let tree = vec![
            el("Cancel", "Button", true, 80, 30),
            el("Submit", "Button", true, 80, 30),
            el("Submit order details", "Text", true, 200, 20),
        ];
        let r = resolve_target(&tree, "click the Submit button");
        assert!(!r.is_empty());
        assert_eq!(r[0].element.name, "Submit", "exact label + role beats partial text");
    }

    #[test]
    fn role_word_disambiguates_same_label() {
        // A Text and a Button both say "Save". "Save button" → the Button wins.
        let tree = vec![
            el("Save", "Text", true, 60, 18),
            el("Save", "Button", true, 60, 30),
        ];
        let r = resolve_target(&tree, "save button");
        assert_eq!(r[0].element.control_type, "Button");
    }

    #[test]
    fn disabled_ranks_below_enabled_twin() {
        let tree = vec![
            el("Next", "Button", false, 70, 30),
            el("Next", "Button", true, 70, 30),
        ];
        let r = resolve_target(&tree, "Next");
        assert!(r[0].element.is_enabled, "enabled twin outranks disabled");
    }

    #[test]
    fn finds_nested_children() {
        let mut root = el("Toolbar", "ToolBar", true, 400, 40);
        root.children = vec![el("Bold", "Button", true, 30, 30), el("Italic", "Button", true, 30, 30)];
        let r = resolve_target(&[root], "Italic");
        assert!(r.iter().any(|g| g.element.name == "Italic"), "nested child resolved via flatten");
    }

    #[test]
    fn fuzzy_partial_label_matches() {
        let tree = vec![el("Save All Files", "Button", true, 120, 30)];
        let r = resolve_target(&tree, "save");
        assert!(!r.is_empty() && r[0].element.name == "Save All Files");
    }

    #[test]
    fn no_match_returns_empty() {
        let tree = vec![el("Submit", "Button", true, 80, 30)];
        assert!(resolve_target(&tree, "purchase quantum widgets").is_empty());
    }

    #[test]
    fn center_is_bounds_center() {
        let tree = vec![el("OK", "Button", true, 100, 40)]; // left10 top20 → center (60,40)
        let r = resolve_target(&tree, "OK");
        assert_eq!(r[0].center, (60, 40));
    }

    #[test]
    fn unaddressable_elements_skipped() {
        // No name, no automation_id → not a candidate even with a role hit.
        let blank = el("", "Button", true, 50, 30);
        assert!(resolve_target(&[blank], "button").is_empty());
    }

    #[test]
    fn role_only_query_returns_buttons() {
        let tree = vec![
            el("Open", "Button", true, 60, 30),
            el("Filename", "Edit", true, 200, 24),
        ];
        let r = resolve_target(&tree, "the button");
        assert!(r.iter().all(|g| g.element.control_type == "Button"));
        assert!(!r.is_empty());
    }
}
