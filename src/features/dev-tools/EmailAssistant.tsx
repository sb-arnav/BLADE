// src/features/dev-tools/EmailAssistant.tsx
//
// DEV-07 — Draft/learn/batch + reminder follow-up surface.
// Wires auto_reply::* (3 commands) + reminders::reminder_add_natural +
// reminders::reminder_parse_time.
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 1 — DEV-07)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-178
// @see src-tauri/src/auto_reply.rs:223,241,275 (emit sites)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlassPanel, Button } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import {
  autoReplyDraft,
  autoReplyLearnFromEdit,
  autoReplyDraftBatch,
  reminderAddNatural,
  reminderParseTime,
} from '@/lib/tauri/dev_tools';
import type { AutoReplyBatchItem } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-b.css';

type MainTab = 'single' | 'batch' | 'followup';
type Intent = 'reply' | 'followup' | 'introduce';

const TAB_PREFIX = 'email:';

interface BatchRow {
  sender: string;
  message: string;
  platform: string;
}

function intentToPlatform(intent: Intent): string {
  // Backend `auto_reply_draft` takes `platform` (email/slack/etc). We piggy-back
  // intent onto the platform field for now — backend prompt templating uses it
  // as a hint. Real multi-channel platform picker is Phase 9 polish.
  return intent === 'introduce' ? 'introduce' : intent === 'followup' ? 'followup' : 'email';
}

function parseCsv(text: string): BatchRow[] {
  // Minimal CSV: "sender,message,platform" per row. Quoted values not supported
  // (Phase 9 polish to swap in a real CSV library). Empty lines skipped.
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      const [sender = '', message = '', platform = 'email'] = parts;
      return { sender, message, platform };
    })
    .filter((r) => r.sender && r.message);
}

export function EmailAssistant() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();

  // Tab state ────────────────────────────────────────────────────────────
  const rawTab = prefs['devTools.activeTab'];
  const activeTab: MainTab =
    typeof rawTab === 'string' && rawTab.startsWith(TAB_PREFIX)
      ? ((rawTab.slice(TAB_PREFIX.length) as MainTab) ?? 'single')
      : 'single';
  const setActiveTab = (t: MainTab) => setPref('devTools.activeTab', `${TAB_PREFIX}${t}`);

  // Single draft state ────────────────────────────────────────────────────
  const [sender, setSender] = useState('');
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState<Intent>('reply');
  const [draft, setDraft] = useState<string>('');
  const [editedDraft, setEditedDraft] = useState<string>('');
  const [drafting, setDrafting] = useState(false);
  const [learningSaving, setLearningSaving] = useState(false);

  const handleDraft = async () => {
    if (drafting || !sender.trim() || !message.trim()) return;
    setDrafting(true);
    try {
      const result = await autoReplyDraft({
        sender,
        message,
        platform: intentToPlatform(intent),
      });
      setDraft(result);
      setEditedDraft(result);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Draft failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDrafting(false);
    }
  };

  const handleSaveLearning = async () => {
    if (learningSaving || !draft || editedDraft === draft || !sender.trim()) return;
    setLearningSaving(true);
    try {
      await autoReplyLearnFromEdit({
        sender,
        original: draft,
        edited: editedDraft,
      });
      toast.show({
        type: 'success',
        title: 'Learning saved',
        message: 'Style preferences captured for future drafts.',
      });
      setDraft(editedDraft);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Save learning failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLearningSaving(false);
    }
  };

  // Batch state ───────────────────────────────────────────────────────────
  const [batchCsv, setBatchCsv] = useState('');
  const [batchResults, setBatchResults] = useState<AutoReplyBatchItem[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const parsedBatch = useMemo(() => parseCsv(batchCsv), [batchCsv]);

  const handleBatch = async () => {
    if (batchBusy || parsedBatch.length === 0) return;
    setBatchBusy(true);
    try {
      // Rust `auto_reply_draft_batch` takes Vec<serde_json::Value>; each item is
      // a free-form object the backend inspects for sender/message/platform.
      const results = await autoReplyDraftBatch(
        parsedBatch.map((r) => ({ sender: r.sender, message: r.message, platform: r.platform })),
      );
      setBatchResults(results);
      toast.show({
        type: 'success',
        title: `Batch drafted (${results.length})`,
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Batch failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBatchBusy(false);
    }
  };

  // Follow-up reminder state ──────────────────────────────────────────────
  const [reminderText, setReminderText] = useState('');
  const [parsedTs, setParsedTs] = useState<number | null>(null);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderNote, setReminderNote] = useState('');
  const [schedBusy, setSchedBusy] = useState(false);
  const debounceTimer = useRef<number | null>(null);

  const doParse = useCallback(async (text: string) => {
    if (!text.trim()) {
      setParsedTs(null);
      return;
    }
    try {
      const ts = await reminderParseTime(text);
      setParsedTs(ts);
    } catch {
      setParsedTs(null);
    }
  }, []);

  useEffect(() => {
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      void doParse(reminderText);
    }, 300);
    return () => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current);
    };
  }, [reminderText, doParse]);

  const handleSchedule = async () => {
    if (schedBusy || !reminderText.trim() || !reminderTitle.trim()) return;
    setSchedBusy(true);
    try {
      await reminderAddNatural({
        title: reminderTitle,
        note: reminderNote,
        timeExpression: reminderText,
      });
      toast.show({
        type: 'success',
        title: 'Follow-up scheduled',
        message: parsedTs
          ? `Fires at ${new Date(parsedTs * 1000).toLocaleString()}`
          : 'Reminder queued.',
      });
      setReminderText('');
      setReminderTitle('');
      setReminderNote('');
      setParsedTs(null);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Schedule failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSchedBusy(false);
    }
  };

  // UI ────────────────────────────────────────────────────────────────────
  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="email-assistant-root">
      <div className="dev-tab-row" data-testid="email-assistant-tabs">
        {(['single', 'batch', 'followup'] as MainTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="dev-tab-pill"
            data-active={String(activeTab === t)}
            onClick={() => setActiveTab(t)}
            data-testid="email-assistant-tab"
          >
            {t === 'single' ? 'Single' : t === 'batch' ? 'Batch' : 'Follow-up'}
          </button>
        ))}
      </div>

      {activeTab === 'single' && (
        <div className="email-assistant-layout">
          <div className="dev-card email-assistant-form">
            <div className="devtools-b-section-header">
              <h3>Incoming message</h3>
            </div>
            <label style={{ fontSize: 12, color: 'var(--t-3)' }}>Sender (recipient)</label>
            <input
              className="web-automation-selector-input"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="alice@example.com"
              data-testid="email-assistant-sender-input"
            />
            <label style={{ fontSize: 12, color: 'var(--t-3)' }}>Message</label>
            <textarea
              className="email-assistant-textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Paste the incoming email or message here…"
              data-testid="email-assistant-message-input"
            />
            <div className="devtools-b-radio-row">
              {(['reply', 'followup', 'introduce'] as Intent[]).map((i) => (
                <button
                  key={i}
                  type="button"
                  className="devtools-b-radio-pill"
                  data-active={String(intent === i)}
                  onClick={() => setIntent(i)}
                  data-testid={`email-assistant-intent-${i}`}
                >
                  {i === 'reply' ? 'Reply' : i === 'followup' ? 'Follow-up' : 'Introduce'}
                </button>
              ))}
            </div>
            <Button
              variant="primary"
              onClick={handleDraft}
              disabled={drafting || !sender.trim() || !message.trim()}
              data-testid="email-assistant-draft-button"
            >
              {drafting ? 'Drafting…' : 'Draft'}
            </Button>
          </div>

          <div className="dev-card email-assistant-form">
            <div className="devtools-b-section-header">
              <h3>Draft</h3>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveLearning}
                disabled={learningSaving || !draft || editedDraft === draft}
                data-testid="email-assistant-learn-button"
              >
                {learningSaving ? 'Saving…' : 'Save learning'}
              </Button>
            </div>
            {draft ? (
              <>
                <textarea
                  className="email-assistant-textarea"
                  value={editedDraft}
                  onChange={(e) => setEditedDraft(e.target.value)}
                  data-testid="email-assistant-draft-output"
                />
                <p style={{ fontSize: 11, color: 'var(--t-3)', margin: 0 }}>
                  Edit freely, then press <strong>Save learning</strong> to capture your style
                  preferences for future drafts.
                </p>
              </>
            ) : (
              <div className="dev-placeholder-hint">
                No draft yet — fill in sender + message, pick an intent, press Draft.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'batch' && (
        <div className="dev-card" style={{ marginTop: 'var(--s-2)' }}>
          <div className="devtools-b-section-header">
            <h3>Batch draft</h3>
            <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
              {parsedBatch.length} parsed row{parsedBatch.length === 1 ? '' : 's'}
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--t-3)', margin: 0 }}>
            Paste CSV with columns: <code>sender,message,platform</code> — one message per line.
          </p>
          <textarea
            className="email-assistant-textarea"
            value={batchCsv}
            onChange={(e) => setBatchCsv(e.target.value)}
            placeholder={'alice@example.com,Quick question about the pricing,email\nbob@slack,retro notes?,slack'}
            rows={6}
            data-testid="email-assistant-batch-input"
          />
          <Button
            variant="primary"
            onClick={handleBatch}
            disabled={batchBusy || parsedBatch.length === 0}
            data-testid="email-assistant-batch-button"
          >
            {batchBusy ? 'Drafting…' : `Draft batch (${parsedBatch.length})`}
          </Button>
          {batchResults.length > 0 && (
            <div
              className="email-assistant-batch-list"
              data-testid="email-assistant-batch-items"
            >
              {batchResults.map((item, i) => (
                <div key={i} className="email-assistant-batch-item">
                  <strong>Row {i + 1}:</strong>
                  <pre style={{ margin: 'var(--s-1) 0 0', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(item, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'followup' && (
        <div className="dev-card" style={{ marginTop: 'var(--s-2)' }}>
          <div className="devtools-b-section-header">
            <h3>Schedule follow-up reminder</h3>
            {parsedTs !== null ? (
              <span className="email-assistant-parsed-chip" data-valid="true">
                {new Date(parsedTs * 1000).toLocaleString()}
              </span>
            ) : reminderText.trim() ? (
              <span className="email-assistant-parsed-chip" data-valid="false">
                Unparsed
              </span>
            ) : null}
          </div>
          <label style={{ fontSize: 12, color: 'var(--t-3)' }}>Title</label>
          <input
            className="web-automation-selector-input"
            value={reminderTitle}
            onChange={(e) => setReminderTitle(e.target.value)}
            placeholder="Follow up with Alice on pricing"
            data-testid="email-assistant-reminder-title"
          />
          <label style={{ fontSize: 12, color: 'var(--t-3)' }}>Note</label>
          <input
            className="web-automation-selector-input"
            value={reminderNote}
            onChange={(e) => setReminderNote(e.target.value)}
            placeholder="She'd asked for an updated quote"
          />
          <label style={{ fontSize: 12, color: 'var(--t-3)' }}>When</label>
          <input
            className="web-automation-selector-input"
            value={reminderText}
            onChange={(e) => setReminderText(e.target.value)}
            placeholder="in 3 days at 10am"
            data-testid="email-assistant-reminder-when"
          />
          <Button
            variant="primary"
            onClick={handleSchedule}
            disabled={schedBusy || !reminderText.trim() || !reminderTitle.trim()}
            data-testid="email-assistant-schedule-button"
          >
            {schedBusy ? 'Scheduling…' : 'Schedule follow-up'}
          </Button>
        </div>
      )}
    </GlassPanel>
  );
}
