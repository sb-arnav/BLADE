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
import { Button, Card, Dialog, Pill } from '@/design-system/primitives';
import {
  getAllProviderKeys,
  historyDeleteConversation,
  historyListConversations,
  TauriError,
} from '@/lib/tauri';
import { useToast } from '@/lib/context';
import type { ProviderKeyList } from '@/types/provider';

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
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
          <li>
            <a
              href="docs/architecture/2026-04-16-blade-body-architecture-design.md"
              target="_blank"
              rel="noopener noreferrer"
              className="settings-link"
            >
              Architecture audit doc
            </a>
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
