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
  saveConfigField,
} from '@/lib/tauri';
import { useConfig } from '@/lib/context';
import { useToast } from '@/lib/context';
import type { ProviderKeyList } from '@/types/provider';

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

// v1.6 narrowing — DeepScanPrivacySection cut (deep_scan removed).
// Kept as a stub so the existing PrivacyPane render call at line 496 still
// resolves — renders nothing.
function DeepScanPrivacySection() {
  return null;
  // eslint-disable-next-line @typescript-eslint/no-unreachable
}

// ---------------------------------------------------------------------------
// ScreenTimelineSection — Phase 14 Plan 14-02 (WIRE2-03)
// Appended after DeepScanPrivacySection. ADDITIVE ONLY.
// ---------------------------------------------------------------------------

function ScreenTimelineSection() {
  const { config, reload } = useConfig();
  const { show } = useToast();
  const [savingField, setSavingField] = useState<string | null>(null);

  const enabled = Boolean(config.screen_timeline_enabled);
  const captureInterval = Number(config.timeline_capture_interval ?? 30);
  const retentionDays = Number(config.timeline_retention_days ?? 7);

  const saveField = async (field: string, value: string) => {
    setSavingField(field);
    try {
      await saveConfigField(field, value);
      await reload();
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSavingField(null);
    }
  };

  return (
    <Card>
      <section aria-labelledby="screen-timeline-heading">
        <h3 id="screen-timeline-heading">Screen Timeline</h3>

        <div className="settings-field">
          <label
            htmlFor="screen-timeline-enabled"
            className="settings-field-label"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}
          >
            <input
              id="screen-timeline-enabled"
              type="checkbox"
              checked={enabled}
              aria-label="Enable screen timeline"
              aria-describedby="screen-timeline-desc"
              disabled={savingField === 'screen_timeline_enabled'}
              onChange={(e) => saveField('screen_timeline_enabled', String(e.target.checked))}
              style={{ width: 16, height: 16, accentColor: 'var(--a-cool)', cursor: 'pointer' }}
            />
            Enable screen timeline
          </label>
          <p id="screen-timeline-desc" className="settings-notice" style={{ marginTop: 'var(--s-1)' }}>
            Screenshot every N seconds for Total Recall context. Stored locally at <code>~/.blade</code>.
          </p>
        </div>

        {enabled && (
          <>
            <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
              <label htmlFor="timeline-capture-interval" className="settings-field-label">
                Capture interval (seconds)
              </label>
              <input
                id="timeline-capture-interval"
                type="number"
                min={10}
                max={300}
                defaultValue={captureInterval}
                aria-label="Screen capture interval in seconds"
                disabled={savingField === 'timeline_capture_interval'}
                onBlur={(e) => saveField('timeline_capture_interval', e.target.value)}
                style={{ width: 100 }}
              />
            </div>
          </>
        )}

        <div className="settings-field" style={{ marginTop: 'var(--s-3)' }}>
          <label htmlFor="timeline-retention-days" className="settings-field-label">
            Retain history (days)
          </label>
          <input
            id="timeline-retention-days"
            type="number"
            min={1}
            max={365}
            defaultValue={retentionDays}
            aria-label="Number of days to retain screen timeline history"
            disabled={savingField === 'timeline_retention_days'}
            onBlur={(e) => saveField('timeline_retention_days', e.target.value)}
            style={{ width: 100 }}
          />
        </div>
      </section>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AudioCaptureSection — Phase 14 Plan 14-02 (WIRE2-03)
// ---------------------------------------------------------------------------

function AudioCaptureSection() {
  const { config, reload } = useConfig();
  const { show } = useToast();
  const [savingField, setSavingField] = useState<string | null>(null);

  const enabled = Boolean(config.audio_capture_enabled);

  const saveField = async (field: string, value: string) => {
    setSavingField(field);
    try {
      await saveConfigField(field, value);
      await reload();
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSavingField(null);
    }
  };

  return (
    <Card>
      <section aria-labelledby="audio-capture-heading">
        <h3 id="audio-capture-heading">Audio Capture</h3>

        <div className="settings-field">
          <label
            htmlFor="audio-capture-enabled"
            className="settings-field-label"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', cursor: 'pointer' }}
          >
            <input
              id="audio-capture-enabled"
              type="checkbox"
              checked={enabled}
              aria-label="Enable always-on audio capture"
              aria-describedby="audio-capture-desc"
              disabled={savingField === 'audio_capture_enabled'}
              onChange={(e) => saveField('audio_capture_enabled', String(e.target.checked))}
              style={{ width: 16, height: 16, accentColor: 'var(--a-cool)', cursor: 'pointer' }}
            />
            Enable audio capture
          </label>
          <p id="audio-capture-desc" className="settings-notice" style={{ marginTop: 'var(--s-1)' }}>
            Always-on ambient audio for meeting detection and voice recall. Audio is processed locally — never uploaded.
          </p>
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

      <ScreenTimelineSection />
      <AudioCaptureSection />

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
