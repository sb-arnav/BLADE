#![allow(dead_code)] // Trait framework — implementations wire up gradually

/// JOINTS — Trait-based contracts between BLADE modules.
///
/// In biology, joints connect bones and define how they can move relative
/// to each other. In BLADE, traits define how modules connect — what they
/// must provide, what callers can expect.
///
/// Without joints, modules connect via raw function names. If a function
/// signature changes, callers break silently (the compiler catches type
/// mismatches but not semantic mismatches). Traits make the contract explicit.
///
/// Three joint types:
///   ContextProvider — anything that provides context for the system prompt
///   BackgroundService — anything that runs a background loop
///   MemoryStore — anything that stores and retrieves memories
///
/// New modules MUST implement the relevant trait.
/// Existing modules should migrate over time.

use serde::{Deserialize, Serialize};

// ── Joint 1: ContextProvider ─────────────────────────────────────────────────
//
// Anything that provides context for brain.rs should implement this.
// brain.rs can then iterate over providers instead of hardcoding calls.

/// A block of context to inject into the system prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextBlock {
    /// Machine-readable name (e.g. "hive_digest", "dna_identity", "perception")
    pub name: String,
    /// Priority: lower = always kept, higher = dropped when budget is tight.
    /// 0-5 = critical, 6-10 = important, 11-15 = nice-to-have, 16+ = optional
    pub priority: u8,
    /// The actual content to inject into the prompt
    pub content: String,
    /// How relevant this block is to the current query (0.0-1.0)
    /// Set by the provider based on query keywords. Blocks below the
    /// thalamus threshold are dropped.
    pub relevance: f32,
}

/// Trait for modules that provide context to brain.rs.
/// Implement this to register your module as a context source.
pub trait ContextProvider: Send + Sync {
    /// Machine-readable name of this provider
    fn name(&self) -> &str;

    /// Produce a context block given the current user query.
    /// Return None if this provider has nothing relevant to add.
    fn provide_context(&self, user_query: &str) -> Option<ContextBlock>;
}

// ── Joint 2: BackgroundService ───────────────────────────────────────────────
//
// Anything that runs a background loop (36 of them!) should implement this.
// Standardizes start/stop/status so lib.rs can manage them uniformly.

/// Status of a background service.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ServiceStatus {
    /// Not started yet
    Stopped,
    /// Running normally
    Running,
    /// Running but in conservation mode (reduced frequency)
    Conserving,
    /// Encountered an error but still trying
    Degraded,
}

/// Trait for background services (loops, pollers, watchers).
pub trait BackgroundService: Send + Sync {
    /// Machine-readable name
    fn name(&self) -> &str;

    /// Human-readable description
    fn description(&self) -> &str;

    /// Current status
    fn status(&self) -> ServiceStatus;

    /// How often this service ticks (in seconds, approximate)
    fn tick_interval_secs(&self) -> u64;

    /// Whether this service is essential (should always run)
    /// vs optional (can be paused in conservation mode)
    fn essential(&self) -> bool;
}

// ── Joint 3: MemoryStore ─────────────────────────────────────────────────────
//
// Anything that stores and retrieves memories should implement this.
// Standardizes store/recall/prune so the hippocampus can manage them.

/// A single memory entry (the common denominator across all memory types).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    /// Unique identifier
    pub id: String,
    /// The actual content
    pub content: String,
    /// How confident BLADE is in this memory (0.0-1.0)
    pub confidence: f64,
    /// Where this memory came from ("conversation", "hive", "screen", etc.)
    pub source: String,
    /// When this memory was created (unix timestamp)
    pub created_at: i64,
    /// How many times this memory has been accessed
    pub access_count: i64,
}

/// Trait for memory storage modules.
pub trait MemoryStore: Send + Sync {
    /// Machine-readable name
    fn name(&self) -> &str;

    /// Store a new memory. Returns the assigned ID.
    fn store(&self, content: &str, source: &str, confidence: f64) -> Result<String, String>;

    /// Recall memories relevant to a query. Returns up to `limit` entries
    /// sorted by relevance.
    fn recall(&self, query: &str, limit: usize) -> Vec<MemoryEntry>;

    /// Prune old/low-confidence memories. Returns number pruned.
    fn prune(&self, max_age_days: u32, min_confidence: f64) -> u32;

    /// Total number of memories in this store.
    fn count(&self) -> u64;
}

// ── Registry ─────────────────────────────────────────────────────────────────
//
// Static registries so brain.rs can discover all context providers,
// and lib.rs can discover all background services.

use std::sync::{Mutex, OnceLock};

static CONTEXT_PROVIDERS: OnceLock<Mutex<Vec<Box<dyn ContextProvider>>>> = OnceLock::new();
static MEMORY_STORES: OnceLock<Mutex<Vec<Box<dyn MemoryStore>>>> = OnceLock::new();

fn context_providers() -> &'static Mutex<Vec<Box<dyn ContextProvider>>> {
    CONTEXT_PROVIDERS.get_or_init(|| Mutex::new(Vec::new()))
}

fn memory_stores() -> &'static Mutex<Vec<Box<dyn MemoryStore>>> {
    MEMORY_STORES.get_or_init(|| Mutex::new(Vec::new()))
}

/// Register a context provider. Called by modules during init.
pub fn register_context_provider(provider: Box<dyn ContextProvider>) {
    if let Ok(mut providers) = context_providers().lock() {
        // Don't register duplicates
        let name = provider.name().to_string();
        if !providers.iter().any(|p| p.name() == name) {
            providers.push(provider);
        }
    }
}

/// Register a memory store.
pub fn register_memory_store(store: Box<dyn MemoryStore>) {
    if let Ok(mut stores) = memory_stores().lock() {
        let name = store.name().to_string();
        if !stores.iter().any(|s| s.name() == name) {
            stores.push(store);
        }
    }
}

/// Get context blocks from ALL registered providers for a given query.
/// brain.rs calls this instead of hardcoding individual module calls.
pub fn get_all_context(user_query: &str) -> Vec<ContextBlock> {
    let providers = match context_providers().lock() {
        Ok(p) => p,
        Err(_) => return vec![],
    };

    let mut blocks: Vec<ContextBlock> = providers
        .iter()
        .filter_map(|p| p.provide_context(user_query))
        .collect();

    // Sort by priority (lower = more important)
    blocks.sort_by_key(|b| b.priority);
    blocks
}

/// Recall across ALL registered memory stores.
pub fn recall_all(query: &str, limit_per_store: usize) -> Vec<MemoryEntry> {
    let stores = match memory_stores().lock() {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let mut all: Vec<MemoryEntry> = stores
        .iter()
        .flat_map(|s| s.recall(query, limit_per_store))
        .collect();

    // Sort by confidence descending
    all.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    all.truncate(limit_per_store * 3); // cap total
    all
}

/// Prune across ALL registered memory stores.
pub fn prune_all(max_age_days: u32, min_confidence: f64) -> u32 {
    let stores = match memory_stores().lock() {
        Ok(s) => s,
        Err(_) => return 0,
    };
    stores.iter().map(|s| s.prune(max_age_days, min_confidence)).sum()
}

// ── Built-in implementations ─────────────────────────────────────────────────
// Wrap existing modules as trait implementations.

/// Hive digest as a ContextProvider
pub struct HiveContextProvider;

impl ContextProvider for HiveContextProvider {
    fn name(&self) -> &str { "hive_digest" }

    fn provide_context(&self, _user_query: &str) -> Option<ContextBlock> {
        let digest = crate::hive::get_hive_digest();
        if digest.is_empty() { return None; }
        Some(ContextBlock {
            name: "hive_digest".to_string(),
            priority: 7,
            content: digest,
            relevance: 1.0, // always relevant when hive is active
        })
    }
}

/// DNA query as a ContextProvider
pub struct DnaContextProvider;

impl ContextProvider for DnaContextProvider {
    fn name(&self) -> &str { "dna" }

    fn provide_context(&self, user_query: &str) -> Option<ContextBlock> {
        let ctx = crate::dna::query_for_brain(user_query);
        if ctx.is_empty() { return None; }
        Some(ContextBlock {
            name: "dna".to_string(),
            priority: 8,
            content: ctx,
            relevance: 0.8,
        })
    }
}

/// Organ roster as a ContextProvider
pub struct OrganRosterProvider;

impl ContextProvider for OrganRosterProvider {
    fn name(&self) -> &str { "organ_roster" }

    fn provide_context(&self, _user_query: &str) -> Option<ContextBlock> {
        let roster = crate::organ::get_organ_roster_for_brain();
        if roster.is_empty() { return None; }
        Some(ContextBlock {
            name: "organ_roster".to_string(),
            priority: 9,
            content: roster,
            relevance: 0.6,
        })
    }
}

/// Register all built-in providers. Called from skeleton::init_all_tables.
pub fn register_builtins() {
    register_context_provider(Box::new(HiveContextProvider));
    register_context_provider(Box::new(DnaContextProvider));
    register_context_provider(Box::new(OrganRosterProvider));
}

// ── Tauri Commands ───────────────────────────────────────────────────────────

/// List all registered context providers (for debugging/dashboard).
#[tauri::command]
pub fn joints_list_providers() -> Vec<String> {
    context_providers()
        .lock()
        .map(|p| p.iter().map(|provider| provider.name().to_string()).collect())
        .unwrap_or_default()
}

/// List all registered memory stores.
#[tauri::command]
pub fn joints_list_stores() -> Vec<String> {
    memory_stores()
        .lock()
        .map(|s| s.iter().map(|store| store.name().to_string()).collect())
        .unwrap_or_default()
}
