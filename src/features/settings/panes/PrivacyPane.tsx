// src/features/settings/panes/PrivacyPane.tsx — SET-08 (D-88).
//
// Read-only surface that lists local-first promises + ONE destructive action:
// "Clear all conversation history" — runs historyListConversations() →
// historyDeleteConversation() in a sequential loop.
//
// Destructive action gated by confirmation Dialog (T-03-06-06 mitigation).
// Partial-failure path: report N succeeded, M failed in toast.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-88
// @see src-tauri/src/commands.rs:2248 history_list_conversations
// @see src-tauri/src/commands.rs:2243 history_delete_conversation

import { useEffect, useState } from 'react';
import { Button, Card, Dialog, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import {
  getAllProviderKeys,
  historyDeleteConversation,
  historyListConversations,
  TauriError,
  deepScanStart,
  setScanClassesEnabled,
} from '@/lib/tauri';
import type { ScanClassesEnabled } from '@/lib/tauri';
import { useConfig } from '@/lib/context';
import { useToast } from '@/lib/context';
import type { ProviderKeyList } from '@/types/provider';

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

// ---------------------------------------------------------------------------
// DeepScanPrivacySection — Phase 12 Plan 12-04 (D-65)
// Appended after the existing Privacy cards. Does NOT modify existing cards.
// ---------------------------------------------------------------------------

interface ToggleDef {
  id: keyof ScanClassesEnabled;
  label: string;
  description: string;
}

const SCAN_CLASS_TOGGLES: ToggleDef[] = [
  {
    id: 'fs_repos',
    label: 'Filesystem repo walk',
    description: 'Walks ~/Projects, ~/repos, ~/src, ~/code + custom parent dirs for every .git directory.',
  },
  {
    id: 'git_remotes',
    label: 'Git remote reads',
    description: 'Reads .git/config on each repo to extract org/repo + account handles. Never calls the remote — local only.',
  },
  {
    id: 'ide_workspaces',
    label: 'IDE workspace artifacts',
    description: 'Reads .code-workspace, .idea, VS Code workspaceStorage and Cursor recent-projects lists.',
  },
  {
    id: 'ai_sessions',
    label: 'AI session history',
    description: 'Reads local ~/.claude/projects, ~/.codex/sessions, ~/.cursor/ directories — filenames + timestamps.',
  },
  {
    id: 'shell_history',
    label: 'Shell history',
    description: 'Reads .bash_history / .zsh_history / .fish_history to detect tool + repo usage. Never uploaded.',
  },
  {
    id: 'mru',
    label: 'Filesystem MRU',
    description: 'Lists files edited within the selected window (7d default) under your home directory.',
  },
  {
    id: 'bookmarks',
    label: 'Browser bookmarks',
    description: 'Parses Chrome / Brave / Arc / Edge bookmark JSON — counts + top domains only, not full URLs.',
  },
  {
    id: 'which_sweep',
    label: 'Installed CLIs + apps',
    description: 'Runs `which` on a curated dev-CLI list + enumerates /Applications or XDG desktop entries.',
  },
];

const DEFAULT_CLASSES: ScanClassesEnabled = {
  fs_repos: true,
  git_remotes: true,
  ide_workspaces: true,
  ai_sessions: true,
  shell_history: true,
  mru: true,
  bookmarks: true,
  which_sweep: true,
};

function DeepScanPrivacySection() {
  const { config, reload: reloadConfig } = useConfig();
  const { show } = useToast();
  const [scanning, setScanning] = useState(false);

  // Read current values from BladeConfig (index-sig allows unknown fields)
  const stored = (config.scan_classes_enabled ?? DEFAULT_CLASSES) as ScanClassesEnabled;
  const [classes, setClasses] = useState<ScanClassesEnabled>(stored);

  // Sync when config changes externally
  useEffect(() => {
    setClasses((config.scan_classes_enabled ?? DEFAULT_CLASSES) as ScanClassesEnabled);
  }, [config.scan_classes_enabled]);

  const allOff = !Object.values(classes).some(Boolean);

  const handleToggle = async (id: keyof ScanClassesEnabled, next: boolean) => {
    const prev = classes;
    const updated = { ...prev, [id]: next };
    // Optimistic update
    setClasses(updated);
    try {
      await setScanClassesEnabled(updated);
      await reloadConfig();
      const className = SCAN_CLASS_TOGGLES.find((t) => t.id === id)?.label ?? id;
      // Screen reader announcement handled by aria-describedby on the checkbox
      show({ type: 'success', title: `${className} ${next ? 'on' : 'off'}. Change applies on next scan.` });
    } catch (e) {
      // Revert on error
      setClasses(prev);
      show({ type: 'error', title: `Couldn't save toggle. Try again.` });
    }
  };

  const handleRescan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      await deepScanStart();
      show({
        type: 'success',
        title: 'Scan started',
        message: 'Open Profile to watch progress.',
      });
    } catch (e) {
      show({ type: 'error', title: `Couldn't start scan. ${errMessage(e)}` });
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card>
      <section aria-labelledby="scan-classes-heading">
        <h3 id="scan-classes-heading">Deep Scan — Source Classes</h3>
        <p className="settings-notice">
          BLADE scans these 8 source classes on your machine to build your profile. Every class is on by default. Turn a class off to exclude it from future scans. Changes apply on next scan.
        </p>

        <GlassPanel tier={2} style={{ borderRadius: 'var(--r-md)', marginBottom: 'var(--s-4)' }}>
          {SCAN_CLASS_TOGGLES.map((toggle, idx) => {
            const enabled = classes[toggle.id] ?? true;
            const isLast = idx === SCAN_CLASS_TOGGLES.length - 1;
            return (
              <div
                key={toggle.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr',
                  gap: 'var(--s-2)',
                  minHeight: 56,
                  padding: 'var(--s-2) var(--s-3)',
                  borderBottom: isLast ? 'none' : '1px solid var(--line)',
                  alignItems: 'center',
                  opacity: enabled ? 1 : 0.5,
                }}
              >
                <input
                  type="checkbox"
                  id={`scan-class-${toggle.id}`}
                  checked={enabled}
                  aria-describedby={`scan-class-${toggle.id}-desc`}
                  onChange={(e) => handleToggle(toggle.id, e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--a-cool)' }}
                />
                <label htmlFor={`scan-class-${toggle.id}`} style={{ cursor: 'pointer' }}>
                  <div
                    className="t-body"
                    style={{ color: enabled ? 'var(--t-1)' : 'var(--t-3)', fontSize: 15, fontWeight: 400, marginBottom: 2 }}
                  >
                    {toggle.label}
                  </div>
                  <div
                    id={`scan-class-${toggle.id}-desc`}
                    className="t-small"
                    style={{ color: 'var(--t-3)', fontSize: 13, lineHeight: 1.45 }}
                  >
                    {toggle.description}
                  </div>
                </label>
              </div>
            );
          })}
        </GlassPanel>

        {allOff && (
          <p style={{ color: 'var(--status-error, #ff6b6b)', fontSize: 14, marginBottom: 'var(--s-3)' }}>
            All source classes are off. Enable at least one to scan.
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            size="md"
            onClick={handleRescan}
            disabled={scanning || allOff}
            aria-busy={scanning}
          >
            {scanning ? (
              <><GlassSpinner size={12} /> Scanning…</>
            ) : (
              'Re-scan now'
            )}
          </Button>
        </div>
      </section>
    </Card>
  );
}

export function PrivacyPane() {
  const { show } = useToast();
  const [keys, setKeys] = useState<ProviderKeyList | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [historyCount, setHistoryCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllProviderKeys().then((k) => { if (!cancelled) setKeys(k); }).catch(() => {});
    historyListConversations()
      .then((list) => { if (!cancelled) setHistoryCount(list.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleClear = async () => {
    setClearing(true);
    try {
      const list = await historyListConversations();
      let ok = 0;
      let fail = 0;
      for (const c of list) {
        try {
          await historyDeleteConversation(c.id);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setHistoryCount(0);
      setConfirmOpen(false);
      if (fail === 0) {
        show({ type: 'success', title: 'History cleared', message: `Deleted ${ok} conversations.` });
      } else {
        show({
          type: 'error',
          title: 'Partial clear',
          message: `Deleted ${ok}, failed ${fail}.`,
        });
      }
    } catch (e) {
      show({ type: 'error', title: 'Clear failed', message: errMessage(e) });
    } finally {
      setClearing(false);
    }
  };

  const storedProviders = keys?.providers.filter((p) => p.has_key) ?? [];

  return (
    <div className="settings-section">
      <h2>Privacy</h2>
      <p>BLADE runs entirely on your machine. Zero telemetry. All conversation, perception, and config data lives at <code>~/.blade</code>.</p>

      <Card>
        <h3>Local-first</h3>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--t-2)' }}>
          <li>No analytics, no crash-report uploads, no usage pings.</li>
          <li>Provider API keys live in your OS keyring — BLADE only fetches them at invoke time.</li>
          <li>Screen + audio timelines are stored on disk. Disable in Voice + Diagnostics if uncomfortable.</li>
          <li style={{ color: 'var(--t-3)', fontSize: 13 }}>
            See <code>docs/architecture/</code> in the repo for the full audit doc.
          </li>
        </ul>
      </Card>

      <Card>
        <h3>API keys</h3>
        {keys == null ? (
          <p>Loading…</p>
        ) : storedProviders.length === 0 ? (
          <p>No keys stored yet.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {storedProviders.map((p) => (
              <li key={p.provider} style={{ color: 'var(--t-2)', marginBottom: 4 }}>
                <strong style={{ color: 'var(--t-1)' }}>{p.provider}</strong>
                {' — '}
                <Pill tone="free">{p.masked || 'stored in keyring'}</Pill>
              </li>
            ))}
          </ul>
        )}
        <p className="settings-notice" style={{ marginTop: 12 }}>
          Manage keys in the Providers tab. BLADE never logs or transmits raw keys.
        </p>
      </Card>

      <Card>
        <h3>Conversation history</h3>
        <p>
          {historyCount == null
            ? 'Counting…'
            : historyCount === 0
              ? 'No stored conversations.'
              : `${historyCount} stored conversations on disk.`}
        </p>
        <div className="settings-actions left">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={clearing || historyCount === 0}
          >
            Clear all conversation history
          </Button>
        </div>
      </Card>

      <Card>
        <h3>Config directory</h3>
        <p>BLADE config + caches live at <code>~/.blade</code>. A "reveal in Finder/Explorer" button ships in a future phase.</p>
      </Card>

      <DeepScanPrivacySection />

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        ariaLabel="Confirm clear conversation history"
      >
        <h3>Clear all conversation history?</h3>
        <p>
          This permanently deletes all stored conversations (
          {historyCount ?? '?'} on disk). This action cannot be undone.
        </p>
        <div className="settings-dialog-actions">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(false)}
            disabled={clearing}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? 'Clearing…' : 'Clear all'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
