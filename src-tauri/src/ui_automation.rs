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
