// src/hooks/usePrefs.ts — single source of truth for localStorage prefs
// (FOUND-09, D-12, D-42, P-13 prevention).
//
// Invariants:
//   - Single `blade_prefs_v1` localStorage key for the entire frontend.
//   - Read once on mount (useState lazy initializer) — never re-reads.
//   - Writes debounced at 250ms to avoid write-storm on rapid toggles.
//   - JSON.parse is try/catch wrapped (T-07-02): corrupt blob returns {} silently.
//
// P-13 enforcement: the Plan 09 CI grep asserts only usePrefs.ts may call
// `localStorage.getItem`/`setItem` for the `blade_prefs_v1` key. Feature code
// flows every pref through this hook.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-12, §D-42
// @see .planning/research/PITFALLS.md §P-13

import { useCallback, useRef, useState } from 'react';

const KEY = 'blade_prefs_v1';
const DEBOUNCE_MS = 250;

export interface Prefs {
  /** Route id to land on first boot. Phase 2 Settings writes this. */
  'app.defaultRoute'?: string;
  /** Route id user was on at last unmount — takes precedence over defaultRoute. */
  'app.lastRoute'?: string;
  /** Chat: show per-message timestamps. */
  'chat.showTimestamps'?: boolean;
  /** Chat: expand tool-call blocks inline vs collapsed. */
  'chat.inlineToolCalls'?: boolean;
  /** Ghost Mode: user has acknowledged Linux screen-capture warning. */
  'ghost.linuxWarningAcknowledged'?: boolean;
  /**
   * Phase 4 D-107 — Voice Orb corner position; persisted after drag-release
   * snap. Values: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
   * (stored as string because the index signature below is the widened type).
   */
  'voice_orb.corner'?: string;
  /**
   * Phase 2 D-57: JSON-encoded array of recent route ids (max 5) surfaced at
   * the top of CommandPalette when the query is empty. Stored as a string
   * because the Prefs index signature below is `string | number | boolean
   * | undefined`; CommandPalette JSON.parse/stringify around this key.
   *
   * Alternative considered — widening the index signature to include
   * `string[]` — rejected: it would ripple typechecks through every Phase 1
   * consumer of `Prefs[K]`.
   */
  'palette.recent'?: string;
  /**
   * Phase 2 D-47: set `true` after `deep_scan_start` completes once, so a
   * returning user does not re-trigger the 12-scanner pass. Phase 3 Settings
   * "Re-run onboarding" button clears this to force a re-run.
   */
  'onboarding.deep_scan_completed'?: boolean;
  // ───── Phase 5 (Plan 05-01, D-133) ─────
  /** AgentDashboard status filter — persisted per-session. */
  'agents.filterStatus'?: 'all' | 'running' | 'idle' | 'failed';
  /** Last-viewed agent id for AgentDetail deep-link from dashboard. */
  'agents.selectedAgent'?: string;
  /** KnowledgeBase tab memory. */
  'knowledge.lastTab'?: string;
  /** KnowledgeGraph sidebar collapsed state. */
  'knowledge.sidebarCollapsed'?: boolean;
  /** ScreenTimeline auto-load latest toggle. */
  'screenTimeline.autoLoadLatest'?: boolean;
  // ───── Phase 6 (Plan 06-01, D-165) ─────
  /** Life OS active tab (used by MeetingsView + any future tabbed life-os surface). */
  'lifeOs.activeTab'?: string;
  /** Health unit system default for display conversion. */
  'lifeOs.health.unit'?: 'metric' | 'imperial';
  /** Identity active tab (PersonaView 4-tab surface, NegotiationView 4-tab surface). */
  'identity.activeTab'?: string;
  /** Last-expanded trait id in PersonaView (deep-link reset on nav). */
  'identity.persona.expandedTrait'?: string;
  // ───── Phase 7 (Plan 07-01, D-192) ─────
  /** Dev Tools active tab (WorkflowBuilder tabs, ComputerUse tabs, DocumentGenerator mode). */
  'devTools.activeTab'?: string;
  /** Terminal current working directory memory — persisted so reopening lands you where you left off. */
  'devTools.terminal.cwd'?: string;
  /** FileBrowser expanded folder paths — newline-joined string (single-blob discipline D-12). */
  'devTools.fileBrowser.expandedPaths'?: string;
  /** Admin active tab (SecurityDashboard tabs, Diagnostics tabs, CapabilityReports sections). */
  'admin.activeTab'?: string;
  /** Last-expanded alert id in SecurityDashboard (scroll-restore-ish deep-link). */
  'admin.security.expandedAlert'?: string;
  // ───── Phase 8 — Body + Hive (Plan 08-01 / D-210) ───────────────────────
  /** BodyMap → BodySystemDetail cluster handoff (D-201, D-202). */
  'body.activeSystem'?: string;
  /** DNA route active tab: 'identity' | 'goals' | 'patterns' | 'query'. */
  'body.dna.activeDoc'?: string;
  /** HiveMesh → TentacleDetail cluster handoff (D-204). */
  'hive.activeTentacle'?: string;
  /** Last-expanded approval card in ApprovalQueue (D-205). */
  'hive.approval.expandedId'?: string;
  /** HiveMesh tentacle-status filter chips: 'all' | 'active' | 'dormant' | 'error' | 'disconnected'. */
  'hive.filterStatus'?: string;
  /** Forward-compat — other dotted keys accepted as string | number | boolean. */
  [k: string]: string | number | boolean | undefined;
}

function readOnce(): Prefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    // T-07-02: corrupt blob — swallow silently, return empty.
    return {};
  }
}

export function usePrefs() {
  // Single read on mount — lazy useState initializer. Never re-reads from storage.
  const [prefs, setPrefs] = useState<Prefs>(() => readOnce());
  const timeout = useRef<number | null>(null);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs(p => {
      const next = { ...p, [key]: value };
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(() => {
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* quota full / private-mode — silent. T-07-05 accepted. */
        }
      }, DEBOUNCE_MS);
      return next;
    });
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs({});
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* noop */
    }
  }, []);

  return { prefs, setPref, resetPrefs };
}
