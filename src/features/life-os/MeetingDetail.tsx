// src/features/life-os/MeetingDetail.tsx — Plan 06-03 Task 3 (LIFE-05 half).
//
// Detail pane for MeetingsView. Renders the selected meeting's header +
// summary + action items, and — for future-dated meetings — also surfaces
// the temporal_meeting_prep briefing as a top banner.
//
// Wrapper-signature notes (Plan 06-02 SUMMARY §§3, 10):
//   - meeting_complete_action takes {meeting_id, item_index: usize}. The
//     Rust ActionItem shape has no id field, so we use the array index.
//   - meeting_follow_up_email takes {meeting_id, recipient: String}; the
//     frontend resolves recipient from the first participant or falls
//     back to a prompt.
//   - temporal_meeting_prep takes a topic string (NOT a meeting id); we
//     feed meeting.title as the topic.
//
// Date-based future detection: Meeting.date is "YYYY-MM-DD" (not a
// timestamp). We parse that into a Date at local midnight and compare
// with Date.now (D-148 client-side gate).
//
// @see .planning/phases/06-life-os-identity/06-03-PLAN.md Task 3
// @see src/lib/tauri/life_os.ts (meeting* + temporalMeetingPrep)

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  meetingGet,
  meetingGetActionItems,
  meetingCompleteAction,
  meetingFollowUpEmail,
  meetingDelete,
  temporalMeetingPrep,
} from '@/lib/tauri/life_os';
import type { Meeting, MeetingActionItem } from './types';

interface MeetingDetailProps {
  meetingId: string | null;
  onDeleted?: (id: string) => void;
}

/** Parse "YYYY-MM-DD" into a timestamp (local midnight). Returns NaN on bad input. */
function parseMeetingDate(dateStr: string | undefined | null): number {
  if (!dateStr || typeof dateStr !== 'string') return NaN;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const d = Date.parse(dateStr);
    return Number.isFinite(d) ? d : NaN;
  }
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
}

function isFutureMeeting(meeting: Meeting | null): boolean {
  if (!meeting) return false;
  const ts = parseMeetingDate(meeting.date);
  if (!Number.isFinite(ts)) return false;
  // End-of-day tolerance: treat a meeting scheduled today as "future" until
  // 23:59:59 local so prep panes stay available all day.
  const endOfDay = ts + 24 * 60 * 60 * 1000 - 1;
  return endOfDay > Date.now();
}

export function MeetingDetail({ meetingId, onDeleted }: MeetingDetailProps) {
  const toast = useToast();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [actionItems, setActionItems] = useState<MeetingActionItem[]>([]);
  const [prepBriefing, setPrepBriefing] = useState<string | null>(null);
  const [prepBusy, setPrepBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  // Complete-action busy state keyed by item index.
  const [completingIdx, setCompletingIdx] = useState<number | null>(null);

  // Follow-up email dialog
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpRecipient, setFollowUpRecipient] = useState('');
  const [followUpOutput, setFollowUpOutput] = useState<string | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);

  // Delete-confirm dialog
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!meetingId) {
      setMeeting(null);
      setActionItems([]);
      setPrepBriefing(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPrepBriefing(null);

    (async () => {
      const results = await Promise.allSettled([
        meetingGet(meetingId),
        meetingGetActionItems(),
      ]);
      if (cancelled) return;

      const fetched = results[0].status === 'fulfilled' ? results[0].value : null;
      setMeeting(fetched);

      // meeting_get_action_items returns the GLOBAL open items list (Plan
      // 06-02 §§2). Filter client-side to only the selected meeting when
      // possible. Fall back to the meeting's embedded action_items array
      // if the global query fails.
      let items: MeetingActionItem[] = [];
      if (results[1].status === 'fulfilled') {
        const global = results[1].value;
        const filtered = global.filter((raw) => {
          const mid =
            (raw as { meeting_id?: unknown }).meeting_id ??
            (raw as { meetingId?: unknown }).meetingId;
          return mid === meetingId;
        });
        items = filtered.length > 0
          ? (filtered as unknown as MeetingActionItem[])
          : (fetched?.action_items ?? []);
      } else if (fetched?.action_items) {
        items = fetched.action_items;
      }
      setActionItems(items);
      setLoading(false);

      // Pre-meeting prep briefing for future meetings only.
      if (fetched && isFutureMeeting(fetched)) {
        setPrepBusy(true);
        try {
          const prep = await temporalMeetingPrep(fetched.title);
          if (!cancelled) setPrepBriefing(prep);
        } catch (err) {
          if (!cancelled) {
            toast.show({
              type: 'warn',
              title: 'Prep briefing unavailable',
              message: err instanceof Error ? err.message : String(err),
            });
          }
        } finally {
          if (!cancelled) setPrepBusy(false);
        }
      }
    })().catch((err: unknown) => {
      if (!cancelled) {
        toast.show({
          type: 'error',
          title: 'Could not load meeting',
          message: err instanceof Error ? err.message : String(err),
        });
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [meetingId, toast]);

  const handleCompleteAction = useCallback(
    async (idx: number) => {
      if (!meetingId) return;
      setCompletingIdx(idx);
      try {
        await meetingCompleteAction({ meetingId, itemIndex: idx });
        setActionItems((prev) => prev.map((it, i) => (i === idx ? { ...it, completed: true } : it)));
        toast.show({ type: 'success', title: 'Action completed' });
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Could not complete action',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setCompletingIdx(null);
      }
    },
    [meetingId, toast],
  );

  const openFollowUp = useCallback(() => {
    // Best-effort pre-fill: first participant that looks like an email, else
    // the first participant, else blank. User can override.
    const first = meeting?.participants ?? [];
    const maybeEmail = first.find((p) => /@/.test(p));
    setFollowUpRecipient(maybeEmail ?? first[0] ?? '');
    setFollowUpOutput(null);
    setFollowUpOpen(true);
  }, [meeting]);

  const handleFollowUpDraft = useCallback(async () => {
    if (!meetingId || followUpBusy) return;
    const recipient = followUpRecipient.trim();
    if (!recipient) return;
    setFollowUpBusy(true);
    try {
      const draft = await meetingFollowUpEmail({ meetingId, recipient });
      setFollowUpOutput(draft);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Draft failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFollowUpBusy(false);
    }
  }, [meetingId, followUpRecipient, followUpBusy, toast]);

  const handleCopyFollowUp = useCallback(async () => {
    if (!followUpOutput) return;
    try {
      await navigator.clipboard.writeText(followUpOutput);
      toast.show({ type: 'success', title: 'Copied to clipboard' });
    } catch (err) {
      toast.show({
        type: 'warn',
        title: 'Copy failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [followUpOutput, toast]);

  const handleDelete = useCallback(async () => {
    if (!meetingId) return;
    try {
      await meetingDelete(meetingId);
      toast.show({ type: 'success', title: 'Meeting deleted' });
      setDeleteOpen(false);
      onDeleted?.(meetingId);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [meetingId, toast, onDeleted]);

  if (!meetingId) {
    return (
      <div className="meeting-detail-pane" data-testid="meeting-detail-root">
        <div className="life-empty">Select a meeting from the sidebar.</div>
      </div>
    );
  }

  if (loading && !meeting) {
    return (
      <div className="meeting-detail-pane" data-testid="meeting-detail-root">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading meeting" />
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="meeting-detail-pane" data-testid="meeting-detail-root">
        <div className="life-empty">This meeting could not be loaded.</div>
      </div>
    );
  }

  return (
    <div className="meeting-detail-pane" data-testid="meeting-detail-root">
      {prepBusy || prepBriefing ? (
        <div className="meeting-detail-banner" data-testid="meeting-prep-banner">
          <strong style={{ color: 'var(--t-1)' }}>Pre-meeting briefing</strong>
          <div style={{ marginTop: 'var(--s-1)' }}>
            {prepBusy ? 'Gathering context…' : prepBriefing}
          </div>
        </div>
      ) : null}

      <header className="meeting-detail-header">
        <h2 className="meeting-detail-title">{meeting.title}</h2>
        <div className="meeting-detail-meta">
          {meeting.date}
          {meeting.duration_minutes ? ` · ${meeting.duration_minutes} min` : ''}
          {meeting.participants && meeting.participants.length > 0
            ? ` · ${meeting.participants.length} participant${meeting.participants.length === 1 ? '' : 's'}`
            : ''}
        </div>
        {meeting.meeting_type ? (
          <div className="meeting-detail-meta">
            Type · {meeting.meeting_type}
            {meeting.sentiment ? ` · sentiment ${meeting.sentiment}` : ''}
          </div>
        ) : null}
      </header>

      <div className="meeting-detail-actions">
        <Button variant="primary" size="sm" onClick={openFollowUp}>
          Draft follow-up
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete meeting
        </Button>
      </div>

      {meeting.summary ? (
        <>
          <h3 className="life-section-title" style={{ marginTop: 0 }}>
            Summary
          </h3>
          <div className="meeting-detail-summary">{meeting.summary}</div>
        </>
      ) : null}

      {meeting.decisions && meeting.decisions.length > 0 ? (
        <>
          <h3 className="life-section-title">Decisions</h3>
          <ul style={{ color: 'var(--t-2)', fontSize: 13, lineHeight: 1.6 }}>
            {meeting.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="life-section-title">Action items</h3>
      {actionItems.length === 0 ? (
        <div className="life-empty">No action items.</div>
      ) : (
        actionItems.map((it, idx) => (
          <div
            key={idx}
            className="meeting-action-item"
            data-testid="meeting-action-item"
            data-completed={it.completed}
          >
            <div>
              <div className="meeting-action-item-text">{it.description}</div>
              {it.owner || it.due_date ? (
                <div className="meeting-action-item-meta">
                  {it.owner ? `Owner: ${it.owner}` : ''}
                  {it.owner && it.due_date ? ' · ' : ''}
                  {it.due_date ? `Due: ${it.due_date}` : ''}
                </div>
              ) : null}
            </div>
            <Button
              variant={it.completed ? 'ghost' : 'secondary'}
              size="sm"
              onClick={() => void handleCompleteAction(idx)}
              disabled={it.completed || completingIdx === idx}
            >
              {it.completed ? 'Done' : completingIdx === idx ? 'Completing…' : 'Complete'}
            </Button>
          </div>
        ))
      )}

      {meeting.open_questions && meeting.open_questions.length > 0 ? (
        <>
          <h3 className="life-section-title">Open questions</h3>
          <ul style={{ color: 'var(--t-2)', fontSize: 13, lineHeight: 1.6 }}>
            {meeting.open_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      ) : null}

      {/* ─── Follow-up draft dialog ──────────────────────────────── */}
      <Dialog
        open={followUpOpen}
        onClose={() => {
          setFollowUpOpen(false);
          setFollowUpOutput(null);
        }}
        ariaLabel="Draft a follow-up email"
      >
        <form
          className="life-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleFollowUpDraft();
          }}
        >
          <h3 className="life-dialog-heading">Draft follow-up email</h3>
          <div className="life-dialog-grid-field">
            <label htmlFor="meeting-followup-recipient">Recipient</label>
            <Input
              id="meeting-followup-recipient"
              type="text"
              value={followUpRecipient}
              onChange={(e) => setFollowUpRecipient(e.target.value)}
              placeholder="name@example.com or participant name"
              disabled={followUpBusy}
              autoFocus
            />
          </div>
          {followUpBusy ? (
            <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <GlassSpinner size={18} label="Drafting" />
              <span style={{ color: 'var(--t-3)', fontSize: 13 }}>Drafting…</span>
            </div>
          ) : null}
          {followUpOutput ? (
            <pre className="meeting-compose-pre" data-testid="meeting-followup-output">
              {followUpOutput}
            </pre>
          ) : null}
          <div className="life-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFollowUpOpen(false);
                setFollowUpOutput(null);
              }}
              disabled={followUpBusy}
            >
              Close
            </Button>
            {followUpOutput ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyFollowUp()}>
                Copy to clipboard
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!followUpRecipient.trim() || followUpBusy}
            >
              {followUpBusy ? 'Drafting…' : followUpOutput ? 'Regenerate' : 'Draft'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Delete confirm dialog ───────────────────────────────── */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} ariaLabel="Confirm delete meeting">
        <div className="life-dialog-body">
          <h3 className="life-dialog-heading">Delete this meeting?</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0 }}>
            The transcript, summary, and action items will be permanently removed.
          </p>
          <div className="life-dialog-actions">
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
