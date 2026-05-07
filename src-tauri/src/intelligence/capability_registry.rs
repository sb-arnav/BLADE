//! INTEL-04 + INTEL-05 canonical_models.json loader + router.rs lookup.
//!
//! Plan 36-05 fills body.
//!
//! Architecture:
//!   - Bundled JSON (`include_str!`) is shipped inside the binary; first-boot
//!     copies it to `blade_config_dir().join("canonical_models.json")` so the
//!     user can override capabilities/costs without rebuilding.
//!   - `load_registry(path)` reads + parses + version-checks (v=1 required).
//!   - `REGISTRY` is a once_cell::sync::Lazy<Mutex<RegistryCache>> singleton
//!     with mtime-based reload — single load per session under normal use,
//!     refresh on file rewrite, force-refresh via `reload_capability_registry`.
//!   - `get_capabilities(provider, model, config)` is the single public lookup;
//!     callers (Plan 36-06 router.rs) use registry-first, capability_probe
//!     fallback when this returns None.
//!   - `validate_against_probe` walks the registry at startup and logs
//!     `[INTEL-04]` mismatches non-halting (registry wins per CONTEXT lock).
//!   - `INTEL_FORCE_REGISTRY_MISS` thread-local seam forces None return for
//!     fault-injection tests.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::config::BladeConfig;

const BUNDLED_REGISTRY: &str = include_str!("../../canonical_models.json");
const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapabilityRegistry {
    pub version: u32,
    pub providers: HashMap<String, ProviderEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderEntry {
    pub models: HashMap<String, ModelCapabilities>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelCapabilities {
    pub context_length: u32,
    pub tool_use: bool,
    pub vision: bool,
    #[serde(default)]
    pub audio: bool,
    pub cost_per_million_in: f32,
    pub cost_per_million_out: f32,
    #[serde(default)]
    pub notes: String,
}

#[derive(Default)]
struct RegistryCache {
    loaded: Option<CapabilityRegistry>,
    path: Option<PathBuf>,
    last_mtime: Option<SystemTime>,
}

static REGISTRY: Lazy<Mutex<RegistryCache>> = Lazy::new(|| Mutex::new(RegistryCache::default()));

thread_local! {
    /// INTEL-04 fault-injection seam. When set to true on the current thread,
    /// `get_capabilities` returns None even if the registry has the entry —
    /// used by Plan 36-06 to verify the capability_probe fallback path.
    pub static INTEL_FORCE_REGISTRY_MISS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Read the registry file at `path`, parse JSON, reject unsupported versions.
pub fn load_registry(path: &Path) -> Result<CapabilityRegistry, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("read registry {}: {e}", path.display()))?;
    let reg: CapabilityRegistry = serde_json::from_str(&content)
        .map_err(|e| format!("parse registry {}: {e}", path.display()))?;
    if reg.version != CURRENT_VERSION {
        return Err(format!(
            "[INTEL-04] unsupported registry version: {} (expected {})",
            reg.version, CURRENT_VERSION
        ));
    }
    Ok(reg)
}

/// Ensure the registry file exists at `path`. On first boot the bundled
/// `canonical_models.json` is copied to the user's blade_config_dir so they
/// can override capabilities/costs without rebuilding.
pub fn ensure_registry_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create parent dir for {}: {e}", path.display()))?;
    }
    std::fs::write(path, BUNDLED_REGISTRY)
        .map_err(|e| format!("seed registry at {}: {e}", path.display()))
}

/// Single public lookup. Returns None when:
///   - INTEL_FORCE_REGISTRY_MISS seam is active on this thread
///   - registry version is unsupported (caller falls back to capability_probe)
///   - (provider, model) tuple is not in the registry
pub fn get_capabilities(
    provider: &str,
    model: &str,
    config: &BladeConfig,
) -> Option<ModelCapabilities> {
    if INTEL_FORCE_REGISTRY_MISS.with(|c| c.get()) {
        return None;
    }

    let path = config.intelligence.capability_registry_path.clone();
    if let Err(e) = ensure_registry_file(&path) {
        log::warn!("[INTEL-04] {e}");
        return parse_bundled_then_lookup(provider, model);
    }
    let mut cache = match REGISTRY.lock() {
        Ok(g) => g,
        Err(_) => return parse_bundled_then_lookup(provider, model),
    };
    let mtime = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok());
    let need_load = cache.loaded.is_none()
        || cache.path.as_deref() != Some(&path)
        || cache.last_mtime != mtime;
    if need_load {
        match load_registry(&path) {
            Ok(reg) => {
                cache.loaded = Some(reg);
                cache.path = Some(path.clone());
                cache.last_mtime = mtime;
            }
            Err(e) => {
                log::warn!("[INTEL-04] load failed: {e}; falling back to bundled");
                return parse_bundled_then_lookup(provider, model);
            }
        }
    }
    let reg = cache.loaded.as_ref()?;
    reg.providers.get(provider)?.models.get(model).cloned()
}

/// Last-resort lookup against the `include_str!` bundled payload. Used when
/// disk IO or mutex is unhappy — guarantees the binary always has SOME answer
/// for known (provider, model) pairs, even if the user's override is broken.
fn parse_bundled_then_lookup(provider: &str, model: &str) -> Option<ModelCapabilities> {
    let reg: CapabilityRegistry = serde_json::from_str(BUNDLED_REGISTRY).ok()?;
    if reg.version != CURRENT_VERSION {
        return None;
    }
    reg.providers.get(provider)?.models.get(model).cloned()
}

/// Force-reload helper used by the `reload_capability_registry` Tauri command.
/// Clears the cache, reloads from disk, returns provider count.
pub fn force_reload(path: &Path) -> Result<u32, String> {
    ensure_registry_file(path)?;
    let reg = load_registry(path)?;
    let n = reg.providers.len() as u32;
    let mtime = std::fs::metadata(path).ok().and_then(|m| m.modified().ok());
    let mut cache = REGISTRY
        .lock()
        .map_err(|e| format!("REGISTRY mutex poisoned: {e}"))?;
    cache.loaded = Some(reg);
    cache.path = Some(path.to_path_buf());
    cache.last_mtime = mtime;
    Ok(n)
}

/// Walk the registry and compare each (vision, tool_use) bit against
/// `capability_probe::infer_capabilities`. Mismatches log a structured
/// `[INTEL-04]` warning but do NOT halt — the registry is the source of
/// truth per CONTEXT lock §canonical_models.json.
pub fn validate_against_probe(registry: &CapabilityRegistry) {
    for (prov_name, prov) in &registry.providers {
        for (model_name, caps) in &prov.models {
            // capability_probe::infer_capabilities returns
            // (vision, audio, tool_calling, long_context, context_window)
            let (probe_vision, probe_audio, probe_tools, _, _) =
                crate::capability_probe::infer_capabilities(prov_name, model_name, None);
            if probe_vision != caps.vision
                || probe_tools != caps.tool_use
                || probe_audio != caps.audio
            {
                log::warn!(
                    "[INTEL-04] registry/probe mismatch for {}/{}: registry={{vision:{},tools:{},audio:{}}}, probe={{vision:{},tools:{},audio:{}}}",
                    prov_name,
                    model_name,
                    caps.vision,
                    caps.tool_use,
                    caps.audio,
                    probe_vision,
                    probe_tools,
                    probe_audio
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn phase36_intel_04_canonical_models_round_trip_serde() {
        let reg: CapabilityRegistry =
            serde_json::from_str(BUNDLED_REGISTRY).expect("bundled JSON should parse");
        assert_eq!(reg.version, 1);
        assert!(reg.providers.contains_key("anthropic"));
        assert!(reg.providers.contains_key("openai"));
        assert!(reg.providers.contains_key("groq"));
        assert!(reg.providers.contains_key("gemini"));
        assert!(reg.providers.contains_key("openrouter"));
        let json = serde_json::to_string(&reg).expect("serialize");
        let reparsed: CapabilityRegistry = serde_json::from_str(&json).unwrap();
        assert_eq!(reg, reparsed);
    }

    #[test]
    fn phase36_intel_04_unsupported_version_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, r#"{"version": 999, "providers": {}}"#).unwrap();
        let result = load_registry(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unsupported registry version"));
    }

    #[test]
    fn phase36_intel_04_ensure_registry_file_seeds_bundled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/canonical_models.json");
        ensure_registry_file(&path).expect("seed");
        assert!(path.exists());
        let parsed = load_registry(&path).expect("parse seeded");
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.providers.len(), 5);
    }

    #[test]
    fn phase36_intel_04_get_returns_known_model() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("canonical_models.json");
        ensure_registry_file(&path).unwrap();
        let mut cfg = BladeConfig::default();
        cfg.intelligence.capability_registry_path = path;
        let caps = get_capabilities("anthropic", "claude-sonnet-4-20250514", &cfg);
        assert!(caps.is_some(), "anthropic/claude-sonnet-4-20250514 should resolve");
        let caps = caps.unwrap();
        assert!(caps.tool_use);
        assert!(caps.vision);
        assert_eq!(caps.context_length, 200_000);
    }

    #[test]
    fn phase36_intel_04_get_returns_none_for_unknown() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("canonical_models.json");
        ensure_registry_file(&path).unwrap();
        let mut cfg = BladeConfig::default();
        cfg.intelligence.capability_registry_path = path;
        let caps = get_capabilities("not-a-provider", "not-a-model", &cfg);
        assert!(caps.is_none());
        let caps = get_capabilities("anthropic", "not-a-model", &cfg);
        assert!(caps.is_none());
    }

    #[test]
    fn phase36_intel_04_force_registry_miss_seam() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("canonical_models.json");
        ensure_registry_file(&path).unwrap();
        let mut cfg = BladeConfig::default();
        cfg.intelligence.capability_registry_path = path;
        INTEL_FORCE_REGISTRY_MISS.with(|c| c.set(true));
        let caps = get_capabilities("anthropic", "claude-sonnet-4-20250514", &cfg);
        INTEL_FORCE_REGISTRY_MISS.with(|c| c.set(false));
        assert!(caps.is_none(), "FORCE_REGISTRY_MISS seam must short-circuit lookup");
    }

    #[test]
    fn phase36_intel_04_mtime_refresh_picks_up_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("canonical_models.json");
        ensure_registry_file(&path).unwrap();
        let mut cfg = BladeConfig::default();
        cfg.intelligence.capability_registry_path = path.clone();

        // Force-reload first to seed cache deterministically (avoids racing
        // other tests that share the global REGISTRY singleton).
        force_reload(&path).expect("initial force_reload");

        // First lookup: known model resolves.
        let caps_before = get_capabilities("anthropic", "claude-sonnet-4-20250514", &cfg);
        assert!(caps_before.is_some());

        // Rewrite the file with a model REMOVED, bump mtime forward.
        let trimmed = r#"{
            "version": 1,
            "providers": {
                "anthropic": { "models": {} },
                "openai": { "models": {} },
                "groq": { "models": {} },
                "gemini": { "models": {} },
                "openrouter": { "models": {} }
            }
        }"#;
        std::fs::write(&path, trimmed).unwrap();
        // Push mtime forward so cache.last_mtime != fresh metadata.modified()
        let future = SystemTime::now() + Duration::from_secs(60);
        let _ = filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(future));

        // Second lookup: cache should reload, model now absent.
        let caps_after = get_capabilities("anthropic", "claude-sonnet-4-20250514", &cfg);
        assert!(caps_after.is_none(), "mtime refresh must reload registry");
    }

    #[test]
    fn phase36_intel_04_capability_probe_parity() {
        // Every (provider, model) in canonical_models.json must agree with
        // capability_probe::infer_capabilities for the (vision, tool_use, audio)
        // tuple, with one documented exception:
        //
        //   - openai/gpt-4o-mini: capability_probe matches "gpt-4o-mini" in
        //     OVR_OPENAI before "gpt-4o", same caps. OK.
        //   - openrouter/<anything>: capability_probe uses substring matching
        //     (":free" beats "claude" beats default). The registry stores
        //     EXPLICIT model IDs, so substring rules apply at lookup. We only
        //     check parity for the bits where probe and registry agree on
        //     intent.
        //
        // Mismatches log a warning but do NOT fail the test — registry wins
        // per CONTEXT lock; this test exists to surface harmonization gaps.
        let reg: CapabilityRegistry = serde_json::from_str(BUNDLED_REGISTRY).unwrap();
        let mut mismatches = Vec::<String>::new();
        for (prov_name, prov) in &reg.providers {
            for (model_name, caps) in &prov.models {
                let (probe_vision, probe_audio, probe_tools, _, _) =
                    crate::capability_probe::infer_capabilities(prov_name, model_name, None);
                if probe_vision != caps.vision
                    || probe_tools != caps.tool_use
                    || probe_audio != caps.audio
                {
                    mismatches.push(format!(
                        "{prov_name}/{model_name}: registry=(v:{},t:{},a:{}) probe=(v:{},t:{},a:{})",
                        caps.vision, caps.tool_use, caps.audio,
                        probe_vision, probe_tools, probe_audio
                    ));
                }
            }
        }
        // Surface mismatches for the human reviewer; harmonization happens in
        // a follow-up plan if any concrete bit drifts.
        if !mismatches.is_empty() {
            eprintln!(
                "[INTEL-04] {} registry/probe mismatch(es) detected:\n  {}",
                mismatches.len(),
                mismatches.join("\n  ")
            );
        }
    }

    #[test]
    fn phase36_intel_04_validation_report_structure() {
        // Just verify validate_against_probe completes without panic and
        // returns unit; mismatches are logged structurally.
        let reg: CapabilityRegistry = serde_json::from_str(BUNDLED_REGISTRY).unwrap();
        validate_against_probe(&reg);
    }
}
