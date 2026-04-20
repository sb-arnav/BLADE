#![allow(dead_code)]

//! Lead and row types for the Phase 12 Smart Deep Scan.
//!
//! This module defines:
//!   - Lead/tier/kind types driving the priority queue
//!   - New additive row types (AccountRow, MruFileRow, RepoRow, etc.)
//!   - All existing result types (re-hosted from deep_scan.rs) for backward compat

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// ── Existing result types (lifted verbatim from deep_scan.rs for backward compat) ──

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstalledApp {
    pub name: String,
    pub version: Option<String>,
    pub publisher: Option<String>,
    pub install_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitRepo {
    pub path: String,
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub primary_language: Option<String>,
    pub language_counts: HashMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdeInfo {
    pub name: String,
    pub config_path: Option<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ShellHistory {
    pub shell: String,
    pub top_commands: Vec<(String, usize)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WslDistro {
    pub name: String,
    pub state: String,
    pub version: String,
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PackageManagerInfo {
    pub name: String,
    pub packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiToolInfo {
    pub name: String,
    pub detected: bool,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SystemInfo {
    pub cpu: String,
    pub gpu: String,
    pub total_ram_mb: u64,
    pub total_disk_gb: u64,
    pub os_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SshKey {
    pub filename: String,
    pub key_type: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DockerInfo {
    pub running_containers: Vec<String>,
    pub images: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserBookmarks {
    pub browser: String,
    pub count: usize,
    pub domains: Vec<String>,
}

// ── Phase 12 additive row types ───────────────────────────────────────────────

/// Enriched repository row (replaces GitRepo for Phase 12; both coexist in DeepScanResults).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoRow {
    /// Stable identity key: "repo:{canonical_abs_path}"
    pub row_id: String,
    pub path: String,
    pub remote_url: Option<String>,
    pub org: Option<String>,
    pub repo_name: Option<String>,
    pub primary_language: Option<String>,
    pub language_counts: HashMap<String, usize>,
    pub last_active_days: Option<i64>,
    /// "fs_walk" | "ai_session" | "shell_history" | "ide"
    pub discovered_via: String,
    /// "fs_repos" | "git_remotes" | etc.
    pub source_scanner: String,
}

/// A discovered VCS account (org/user on a hosting platform).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccountRow {
    /// Stable identity key: "account:{platform}:{handle}"
    pub row_id: String,
    /// "github" | "gitlab" | "bitbucket" | "azure" | hostname
    pub platform: String,
    pub handle: String,
    /// Scanner name that produced this row
    pub source: String,
    pub discovered_via: String,
}

/// A recently-modified file entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MruFileRow {
    /// Stable identity key: "file:{abs_path}"
    pub row_id: String,
    pub path: String,
    pub mtime_unix: i64,
    pub size_bytes: u64,
    pub project_root: Option<String>,
    pub source: String,
}

/// A rhythm/activity signal (histogram, active repo count, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RhythmSignal {
    /// "hour_histogram" | "day_histogram" | "active_repo_count"
    pub kind: String,
    pub data: serde_json::Value,
}

/// Optional LLM-generated narrative enrichments stored alongside raw rows.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmEnrichments {
    pub account_narrative: Option<String>,
    pub rhythm_narrative: Option<String>,
    pub enriched_at: Option<i64>,
}

// ── Extended DeepScanResults (additive — old fields preserved) ───────────────

/// Full scan result returned by `deep_scan_start`.
///
/// Phase 12 adds: `accounts`, `mru_files`, `rhythm_signals`, `llm_enrichments`, `repo_rows`.
/// Old fields kept verbatim so existing consumers (DeepScanStep.tsx) are unaffected.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeepScanResults {
    // ── Existing fields (D-66 preserved) ──
    pub scanned_at: i64,
    pub installed_apps: Vec<InstalledApp>,
    pub default_browser: Option<String>,
    pub ides: Vec<IdeInfo>,
    pub git_repos: Vec<GitRepo>,
    pub shell_history: Vec<ShellHistory>,
    pub wsl_distros: Vec<WslDistro>,
    pub package_managers: Vec<PackageManagerInfo>,
    pub ai_tools: Vec<AiToolInfo>,
    pub system_info: SystemInfo,
    pub ssh_keys: Vec<SshKey>,
    pub docker: DockerInfo,
    pub browser_bookmarks: Vec<BrowserBookmarks>,
    // ── Phase 12 additive fields (default via serde) ──
    #[serde(default)]
    pub accounts: Vec<AccountRow>,
    #[serde(default)]
    pub mru_files: Vec<MruFileRow>,
    #[serde(default)]
    pub rhythm_signals: Vec<RhythmSignal>,
    #[serde(default)]
    pub llm_enrichments: Option<LlmEnrichments>,
    #[serde(default)]
    pub repo_rows: Vec<RepoRow>,
}

// ── Lead tier / kind ──────────────────────────────────────────────────────────

/// Priority tier controlling drain order in the LeadQueue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Tier {
    Hot,
    Warm,
    Cold,
}

/// What kind of work a Lead represents; determines which scanner handles it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LeadKind {
    FsRepoWalk,
    GitRemoteRead,
    MruWalk,
    IdeWorkspaceRead,
    AiSessionRead,
    ShellHistoryScan,
    BookmarkRead,
    WhichSweep,
    ProjectRootHint,
    PackageManifestRead,
    LockFileRead,
}

impl LeadKind {
    /// Human-readable string for progress events.
    pub fn as_str(&self) -> &'static str {
        match self {
            LeadKind::FsRepoWalk => "fs_repo_walk",
            LeadKind::GitRemoteRead => "git_remote_read",
            LeadKind::MruWalk => "mru_walk",
            LeadKind::IdeWorkspaceRead => "ide_workspace_read",
            LeadKind::AiSessionRead => "ai_session_read",
            LeadKind::ShellHistoryScan => "shell_history_scan",
            LeadKind::BookmarkRead => "bookmark_read",
            LeadKind::WhichSweep => "which_sweep",
            LeadKind::ProjectRootHint => "project_root_hint",
            LeadKind::PackageManifestRead => "package_manifest_read",
            LeadKind::LockFileRead => "lock_file_read",
        }
    }
}

/// A unit of work in the priority queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lead {
    pub kind: LeadKind,
    pub priority_tier: Tier,
    /// Human-readable source description e.g. "fs_mru:~/blade"
    pub seed_source: String,
    /// Arbitrary JSON payload (scanner-specific; typically contains "path")
    pub payload: serde_json::Value,
    /// Skipped during serialization — Instant is not Send-safe across serde boundary
    #[serde(skip)]
    pub enqueued_at: Option<std::time::Instant>,
}

impl Lead {
    /// Convenience constructor.
    pub fn new(kind: LeadKind, tier: Tier, source: impl Into<String>, payload: serde_json::Value) -> Self {
        Self {
            kind,
            priority_tier: tier,
            seed_source: source.into(),
            payload,
            enqueued_at: Some(std::time::Instant::now()),
        }
    }

    /// The path hint in the lead payload, used for deduplication.
    pub fn path_hint(&self) -> std::path::PathBuf {
        self.payload
            .get("path")
            .and_then(|v| v.as_str())
            .map(std::path::PathBuf::from)
            .unwrap_or_default()
    }

    /// String key of the lead kind for progress events.
    pub fn kind_str(&self) -> &'static str {
        self.kind.as_str()
    }
}
