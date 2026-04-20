#![allow(dead_code)]

//! Scanner: ide_workspaces — finds VS Code, Cursor, and IntelliJ workspace artifacts.
//!
//! Threat mitigations:
//! - All path truncations use crate::safe_slice (never &str[..n])
//! - No network calls (T-12-11 verify gate enforces this)
//! - URI-decode file:// prefixes before path resolution

use std::path::{Path, PathBuf};

use crate::deep_scan::leads::{Lead, LeadKind, Tier};

/// Row type for a detected IDE installation with recent projects.
#[derive(Debug, Clone)]
pub struct IdeRow {
    pub row_id: String,
    pub name: String,
    pub config_path: Option<String>,
    pub recent_projects: Vec<String>,
    pub source: String,
}

/// Run the ide_workspaces scanner for a given lead.
///
/// Returns (Vec<IdeRow>, Vec<Lead>) where the Lead vec contains
/// `ProjectRootHint` follow-up leads for each resolved project path.
pub fn run(lead: &Lead) -> (Vec<IdeRow>, Vec<Lead>) {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut rows: Vec<IdeRow> = Vec::new();
    let mut follow_ups: Vec<Lead> = Vec::new();

    // Probe path hint from lead payload (for .code-workspace or .idea lookup)
    let lead_path = lead.payload.get("path").and_then(|v| v.as_str()).map(PathBuf::from);

    // VS Code workspaceStorage
    scan_vscode_workspaces(&home.join(".config").join("Code").join("User").join("workspaceStorage"),
        "vscode", &mut rows, &mut follow_ups);

    // Cursor workspaceStorage
    scan_vscode_workspaces(&home.join(".config").join("Cursor").join("User").join("workspaceStorage"),
        "cursor", &mut rows, &mut follow_ups);

    // .code-workspace file in lead path
    if let Some(ref lp) = lead_path {
        scan_code_workspace_file(lp, &mut rows, &mut follow_ups);
        // IntelliJ .idea/workspace.xml
        let idea_ws = lp.join(".idea").join("workspace.xml");
        if idea_ws.exists() {
            scan_idea_workspace(&idea_ws, lp, &mut rows, &mut follow_ups);
        }
    }

    (rows, follow_ups)
}

/// Scan a workspaceStorage directory (VS Code / Cursor layout).
/// Each subdirectory may contain a workspace.json with a "folder" key.
fn scan_vscode_workspaces(storage_dir: &Path, ide_name: &str, rows: &mut Vec<IdeRow>, follow_ups: &mut Vec<Lead>) {
    if !storage_dir.is_dir() { return; }

    let mut recent: Vec<String> = Vec::new();

    let Ok(entries) = std::fs::read_dir(storage_dir) else { return };
    for entry in entries.filter_map(|e| e.ok()).take(500) {
        let ws_json = entry.path().join("workspace.json");
        if !ws_json.is_file() { continue; }
        let Ok(content) = std::fs::read_to_string(&ws_json) else { continue };
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(folder) = val.get("folder").and_then(|v| v.as_str()) {
                let decoded = decode_file_uri(folder);
                if !decoded.is_empty() {
                    recent.push(decoded);
                }
            }
        }
    }

    if recent.is_empty() && !storage_dir.exists() { return; }

    let row = IdeRow {
        row_id: format!("ide:{}", ide_name),
        name: ide_name.to_string(),
        config_path: Some(storage_dir.to_string_lossy().to_string()),
        recent_projects: recent.clone(),
        source: "ide_workspaces".to_string(),
    };
    rows.push(row);

    // Emit ProjectRootHint follow-up leads for each valid project path
    for project_path in &recent {
        let pb = PathBuf::from(project_path);
        if pb.exists() {
            follow_ups.push(Lead::new(
                LeadKind::ProjectRootHint,
                Tier::Warm,
                format!("ide_workspaces:{}", crate::safe_slice(project_path, 80)),
                serde_json::json!({ "path": project_path }),
            ));
        }
    }
}

/// Decode a file:// URI to a filesystem path.
/// Handles file:///home/user/project → /home/user/project
fn decode_file_uri(uri: &str) -> String {
    let path = if uri.starts_with("file:///") {
        &uri[7..]
    } else if uri.starts_with("file://") {
        &uri[7..]
    } else {
        return uri.to_string();
    };
    // Decode common percent-encoded sequences
    path.replace("%20", " ")
        .replace("%21", "!")
        .replace("%23", "#")
        .replace("%24", "$")
        .replace("%25", "%")
        .replace("%26", "&")
        .replace("%27", "'")
        .replace("%28", "(")
        .replace("%29", ")")
        .replace("%2B", "+")
        .replace("%2C", ",")
        .replace("%3B", ";")
        .replace("%3D", "=")
        .replace("%40", "@")
}

/// Scan a .code-workspace JSON file for its `folders[].path` entries.
fn scan_code_workspace_file(lead_path: &Path, rows: &mut Vec<IdeRow>, follow_ups: &mut Vec<Lead>) {
    // Look for .code-workspace file in the directory or as the path itself
    let ws_file = if lead_path.extension().map(|e| e == "code-workspace").unwrap_or(false) {
        lead_path.to_path_buf()
    } else {
        // Scan the directory for a .code-workspace file
        let Ok(rd) = std::fs::read_dir(lead_path) else { return };
        let found = rd.filter_map(|e| e.ok()).find(|e| {
            e.path().extension().map(|ext| ext == "code-workspace").unwrap_or(false)
        });
        match found {
            Some(e) => e.path(),
            None => return,
        }
    };

    let Ok(content) = std::fs::read_to_string(&ws_file) else { return };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) else { return };

    let mut project_paths: Vec<String> = Vec::new();
    if let Some(folders) = val.get("folders").and_then(|f| f.as_array()) {
        for folder in folders {
            if let Some(path_str) = folder.get("path").and_then(|p| p.as_str()) {
                let full = if Path::new(path_str).is_absolute() {
                    PathBuf::from(path_str)
                } else {
                    // Relative to the workspace file directory
                    ws_file.parent().unwrap_or(Path::new(".")).join(path_str)
                };
                if full.exists() {
                    let full_str = full.to_string_lossy().to_string();
                    project_paths.push(full_str.clone());
                    follow_ups.push(Lead::new(
                        LeadKind::ProjectRootHint,
                        Tier::Warm,
                        format!("code_workspace:{}", crate::safe_slice(&full_str, 80)),
                        serde_json::json!({ "path": full_str }),
                    ));
                }
            }
        }
    }

    if !project_paths.is_empty() {
        rows.push(IdeRow {
            row_id: "ide:code-workspace".to_string(),
            name: "vscode-workspace".to_string(),
            config_path: Some(ws_file.to_string_lossy().to_string()),
            recent_projects: project_paths,
            source: "ide_workspaces".to_string(),
        });
    }
}

/// Scan an IntelliJ .idea/workspace.xml for project information.
fn scan_idea_workspace(idea_ws: &Path, project_root: &Path, rows: &mut Vec<IdeRow>, follow_ups: &mut Vec<Lead>) {
    let Ok(content) = std::fs::read_to_string(idea_ws) else { return };
    // Simple string search for ProjectViewState component content
    let project_path = project_root.to_string_lossy().to_string();

    if content.contains("ProjectViewState") || content.contains("component") {
        rows.push(IdeRow {
            row_id: format!("ide:intellij:{}", crate::safe_slice(&project_path, 60)),
            name: "intellij".to_string(),
            config_path: Some(idea_ws.to_string_lossy().to_string()),
            recent_projects: vec![project_path.clone()],
            source: "ide_workspaces".to_string(),
        });
        follow_ups.push(Lead::new(
            LeadKind::ProjectRootHint,
            Tier::Warm,
            format!("idea_workspace:{}", crate::safe_slice(&project_path, 80)),
            serde_json::json!({ "path": project_path }),
        ));
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn make_lead(path: &str) -> Lead {
        Lead::new(
            LeadKind::IdeWorkspaceRead,
            Tier::Warm,
            "test",
            serde_json::json!({ "path": path }),
        )
    }

    #[test]
    fn test_parses_workspace_json() {
        let dir = tempdir().unwrap();
        // Create a workspaceStorage subdirectory with workspace.json
        let storage = dir.path().join("workspaceStorage").join("abc123def456");
        fs::create_dir_all(&storage).unwrap();
        let project_dir = dir.path().join("myproject");
        fs::create_dir_all(&project_dir).unwrap();
        let folder_uri = format!("file://{}", project_dir.to_string_lossy());
        let ws_json = serde_json::json!({ "folder": folder_uri });
        fs::write(storage.join("workspace.json"), serde_json::to_string(&ws_json).unwrap()).unwrap();

        // Directly call the internal scan fn with the temp dir
        let mut rows: Vec<IdeRow> = Vec::new();
        let mut follow_ups: Vec<Lead> = Vec::new();
        scan_vscode_workspaces(&dir.path().join("workspaceStorage"), "vscode_test", &mut rows, &mut follow_ups);

        assert!(!rows.is_empty(), "expected at least one IdeRow");
        let row = &rows[0];
        assert!(
            row.recent_projects.iter().any(|p| p.contains("myproject")),
            "expected recent_projects to contain myproject path, got: {:?}", row.recent_projects
        );
    }

    #[test]
    fn test_returns_project_root_hint() {
        let dir = tempdir().unwrap();
        // Create workspaceStorage with a workspace.json pointing at an existing directory
        let storage = dir.path().join("workspaceStorage").join("xyz789");
        fs::create_dir_all(&storage).unwrap();
        let project_dir = dir.path().join("myproject");
        fs::create_dir_all(&project_dir).unwrap();
        let folder_uri = format!("file://{}", project_dir.to_string_lossy());
        let ws_json = serde_json::json!({ "folder": folder_uri });
        fs::write(storage.join("workspace.json"), serde_json::to_string(&ws_json).unwrap()).unwrap();

        let mut rows: Vec<IdeRow> = Vec::new();
        let mut follow_ups: Vec<Lead> = Vec::new();
        scan_vscode_workspaces(&dir.path().join("workspaceStorage"), "vscode_test", &mut rows, &mut follow_ups);

        // The existing project path should produce a ProjectRootHint follow-up lead
        let has_hint = follow_ups.iter().any(|fl| {
            fl.kind == LeadKind::ProjectRootHint &&
            fl.payload.get("path").and_then(|v| v.as_str()).map(|p| p.contains("myproject")).unwrap_or(false)
        });
        assert!(has_hint, "expected ProjectRootHint lead for myproject, follow_ups: {:?}",
            follow_ups.iter().map(|f| &f.payload).collect::<Vec<_>>());
    }
}
