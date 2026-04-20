#![allow(dead_code)]

//! Priority lead queue for the Smart Deep Scan.
//!
//! Drains Hot → Warm → Cold. Deduplication via visited HashSet<PathBuf>.
//! SCAN_CANCEL AtomicBool allows the orchestrator to abort between leads.

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use super::leads::{Lead, Tier};

/// Set to true to stop the drain loop after the current lead finishes.
pub static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

/// Priority queue with three tiers and a visited-path dedup set.
pub struct LeadQueue {
    hot: VecDeque<Lead>,
    warm: VecDeque<Lead>,
    cold: VecDeque<Lead>,
    visited: HashSet<PathBuf>,
}

impl LeadQueue {
    /// Create a new empty queue.
    pub fn new() -> Self {
        Self {
            hot: VecDeque::new(),
            warm: VecDeque::new(),
            cold: VecDeque::new(),
            visited: HashSet::new(),
        }
    }

    /// Enqueue a lead into the tier that matches its `priority_tier`.
    pub fn enqueue(&mut self, lead: Lead) {
        match lead.priority_tier {
            Tier::Hot => self.hot.push_back(lead),
            Tier::Warm => self.warm.push_back(lead),
            Tier::Cold => self.cold.push_back(lead),
        }
    }

    /// Dequeue the highest-priority lead: Hot first, then Warm, then Cold.
    pub fn dequeue(&mut self) -> Option<Lead> {
        if let Some(lead) = self.hot.pop_front() {
            return Some(lead);
        }
        if let Some(lead) = self.warm.pop_front() {
            return Some(lead);
        }
        self.cold.pop_front()
    }

    /// Mark a path as visited so it won't be re-enqueued.
    pub fn mark_visited(&mut self, path: PathBuf) {
        self.visited.insert(path);
    }

    /// Check whether a path has already been visited.
    pub fn is_visited(&self, path: &PathBuf) -> bool {
        self.visited.contains(path)
    }

    /// Total number of leads across all tiers.
    pub fn len(&self) -> usize {
        self.hot.len() + self.warm.len() + self.cold.len()
    }

    /// Whether the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Number of Hot-tier leads.
    pub fn hot_count(&self) -> usize {
        self.hot.len()
    }

    /// Number of Warm-tier leads.
    pub fn warm_count(&self) -> usize {
        self.warm.len()
    }

    /// Number of Cold-tier leads.
    pub fn cold_count(&self) -> usize {
        self.cold.len()
    }

    /// Check whether a scan cancellation has been requested.
    pub fn is_cancelled() -> bool {
        SCAN_CANCEL.load(Ordering::SeqCst)
    }

    /// Reset the cancel flag (called at the start of each new scan).
    pub fn reset_cancel() {
        SCAN_CANCEL.store(false, Ordering::SeqCst);
    }
}

impl Default for LeadQueue {
    fn default() -> Self {
        Self::new()
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::deep_scan::leads::{Lead, LeadKind, Tier};

    fn make_lead(kind: LeadKind, tier: Tier, path: &str) -> Lead {
        Lead::new(kind, tier, "test", serde_json::json!({ "path": path }))
    }

    #[test]
    fn test_tier_ordering() {
        let mut q = LeadQueue::new();
        q.enqueue(make_lead(LeadKind::FsRepoWalk, Tier::Cold, "/cold"));
        q.enqueue(make_lead(LeadKind::FsRepoWalk, Tier::Hot, "/hot"));
        q.enqueue(make_lead(LeadKind::FsRepoWalk, Tier::Warm, "/warm"));

        let first = q.dequeue().expect("should have lead");
        assert_eq!(first.priority_tier, Tier::Hot, "Hot must come first");

        let second = q.dequeue().expect("should have lead");
        assert_eq!(second.priority_tier, Tier::Warm, "Warm must come second");

        let third = q.dequeue().expect("should have lead");
        assert_eq!(third.priority_tier, Tier::Cold, "Cold must come last");

        assert!(q.dequeue().is_none(), "Queue should be empty after draining");
    }

    #[test]
    fn test_visited_dedupes() {
        let mut q = LeadQueue::new();
        let path = PathBuf::from("/some/repo");

        // Mark visited before enqueuing
        q.mark_visited(path.clone());
        assert!(q.is_visited(&path), "Path should be marked visited");

        // Simulate orchestrator dedup check
        let lead = make_lead(LeadKind::FsRepoWalk, Tier::Hot, "/some/repo");
        if !q.is_visited(&lead.path_hint()) {
            q.enqueue(lead);
        }
        // Enqueue a second time — should also be blocked
        let lead2 = make_lead(LeadKind::GitRemoteRead, Tier::Warm, "/some/repo");
        if !q.is_visited(&lead2.path_hint()) {
            q.enqueue(lead2);
        }

        assert_eq!(q.len(), 0, "Visited path should not be enqueued");
    }

    #[test]
    fn test_cancel_stops_drain() {
        // Reset first to ensure clean state from any prior test
        LeadQueue::reset_cancel();
        SCAN_CANCEL.store(true, Ordering::SeqCst);

        let mut q = LeadQueue::new();
        q.enqueue(make_lead(LeadKind::FsRepoWalk, Tier::Hot, "/repo1"));
        q.enqueue(make_lead(LeadKind::FsRepoWalk, Tier::Hot, "/repo2"));

        let mut drained = 0usize;
        while let Some(_lead) = q.dequeue() {
            if LeadQueue::is_cancelled() {
                break;
            }
            drained += 1;
        }

        // Cancel fires immediately — we break before processing any lead
        assert_eq!(drained, 0, "Drain should stop immediately when cancelled");

        // Cleanup
        LeadQueue::reset_cancel();
    }

    #[test]
    fn test_queue_counts() {
        let mut q = LeadQueue::new();

        for i in 0..3 {
            q.enqueue(make_lead(LeadKind::FsRepoWalk, Tier::Hot, &format!("/hot/{}", i)));
        }
        for i in 0..2 {
            q.enqueue(make_lead(LeadKind::MruWalk, Tier::Warm, &format!("/warm/{}", i)));
        }
        q.enqueue(make_lead(LeadKind::GitRemoteRead, Tier::Cold, "/cold/0"));

        assert_eq!(q.len(), 6, "Total count should be 6");
        assert_eq!(q.hot_count(), 3, "Hot count should be 3");
        assert_eq!(q.warm_count(), 2, "Warm count should be 2");
        assert_eq!(q.cold_count(), 1, "Cold count should be 1");
    }
}
