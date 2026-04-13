// src/components/MeetingView.tsx
// Meeting capture and intelligence: process transcripts, extract insights, generate follow-ups.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActionItem {
  description: string;
  owner?: string;
  due_date?: string;
  completed: boolean;
  meeting_id?: string;
  item_index?: number;
  meeting_title?: string;
}

interface Meeting {
  id: string;
  title: string;
  date: string;
  meeting_type: string;
  sentiment: "productive" | "tense" | "energetic" | "inconclusive";
  duration_minutes?: number;
  participants: string[];
  summary?: string;
  decisions: string[];
  action_items: ActionItem[];
  open_questions: string[];
  transcript?: string;
}

// ── Sentiment badge ───────────────────────────────────────────────────────────

const SENTIMENT_STYLES: Record<Meeting["sentiment"], { border: string; text: string; bg: string }> = {
  productive:  { border: "border-green-600",  text: "text-green-400",  bg: "bg-green-950/30" },
  tense:       { border: "border-red-700",    text: "text-red-400",    bg: "bg-red-950/30" },
  energetic:   { border: "border-blue-600",   text: "text-blue-400",   bg: "bg-blue-950/30" },
  inconclusive:{ border: "border-gray-600",   text: "text-gray-400",   bg: "bg-gray-900" },
};

function SentimentBadge({ sentiment }: { sentiment: Meeting["sentiment"] }) {
  const s = SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES.inconclusive;
  return (
    <span className={`text-2xs font-mono px-2 py-0.5 rounded border ${s.border} ${s.text} ${s.bg}`}>
      {sentiment}
    </span>
  );
}

// ── Meeting type badge ────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="text-2xs font-mono px-2 py-0.5 rounded border border-gray-700 text-gray-400 bg-gray-800">
      {type}
    </span>
  );
}

// ── New meeting form ──────────────────────────────────────────────────────────

function NewMeetingForm({ onProcessed }: { onProcessed: (meeting: Meeting) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [participants, setParticipants] = useState("");
  const [duration, setDuration] = useState("");
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  async function process() {
    if (!title.trim() || !transcript.trim()) {
      setError("Title and transcript are required.");
      return;
    }
    setError("");
    setProcessing(true);
    try {
      const meeting = await invoke<Meeting>("meeting_process", {
        title: title.trim(),
        date,
        transcript: transcript.trim(),
        participants: participants.split(",").map((p) => p.trim()).filter(Boolean),
        durationMinutes: duration ? parseInt(duration) : undefined,
      });
      onProcessed(meeting);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-green-400 font-mono text-xs uppercase tracking-widest">New Meeting</h2>

      {error && (
        <div className="border border-red-800 rounded p-2 text-red-400 text-xs font-mono">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-gray-500 text-2xs font-mono">Title *</label>
          <input
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q4 planning meeting"
          />
        </div>
        <div>
          <label className="text-gray-500 text-2xs font-mono">Date</label>
          <input
            type="date"
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-gray-500 text-2xs font-mono">Duration (minutes)</label>
          <input
            type="number"
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="60"
          />
        </div>
        <div className="col-span-2">
          <label className="text-gray-500 text-2xs font-mono">Participants (comma-separated)</label>
          <input
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-green-500"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="Alice, Bob, Carol"
          />
        </div>
        <div className="col-span-2">
          <label className="text-gray-500 text-2xs font-mono">Transcript / Notes *</label>
          <textarea
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded p-3 text-xs font-mono resize-none h-48 focus:outline-none focus:border-green-500"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste or type meeting notes / transcript here..."
          />
        </div>
      </div>

      <button
        onClick={process}
        disabled={processing || !title.trim() || !transcript.trim()}
        className="w-full py-2.5 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed font-mono"
      >
        {processing ? (
          <span className="animate-pulse">BLADE is extracting insights...</span>
        ) : (
          "Process Meeting →"
        )}
      </button>
    </div>
  );
}

// ── Meeting detail ────────────────────────────────────────────────────────────

function MeetingDetail({ meeting, onActionComplete }: { meeting: Meeting; onActionComplete: () => void }) {
  const [followUpEmail, setFollowUpEmail] = useState("");
  const [recipient, setRecipient] = useState("");
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [copied, setCopied] = useState(false);

  async function completeAction(index: number) {
    await invoke("meeting_complete_action", { meetingId: meeting.id, itemIndex: index });
    onActionComplete();
  }

  async function generateFollowUp() {
    if (!recipient.trim()) return;
    setGeneratingEmail(true);
    try {
      const email = await invoke<string>("meeting_follow_up_email", {
        meetingId: meeting.id,
        recipient: recipient.trim(),
      });
      setFollowUpEmail(email);
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingEmail(false);
    }
  }

  async function copyEmail() {
    await navigator.clipboard.writeText(followUpEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const openActions = meeting.action_items.filter((a) => !a.completed);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-gray-100 font-mono text-base font-semibold">{meeting.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500 text-xs font-mono">{meeting.date}</span>
          <TypeBadge type={meeting.meeting_type} />
          <SentimentBadge sentiment={meeting.sentiment} />
          {meeting.duration_minutes && (
            <span className="text-gray-500 text-2xs font-mono">⏱ {meeting.duration_minutes}m</span>
          )}
        </div>
        {meeting.participants.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {meeting.participants.map((p) => (
              <span key={p} className="text-2xs font-mono bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-300">
                {p}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      {meeting.summary && (
        <div className="bg-amber-950/30 border border-amber-800 rounded-lg p-4">
          <p className="text-amber-400 text-2xs font-mono uppercase tracking-wider mb-2">Summary</p>
          <p className="text-gray-200 text-xs font-mono leading-relaxed">{meeting.summary}</p>
        </div>
      )}

      {/* Decisions */}
      {meeting.decisions.length > 0 && (
        <div>
          <p className="text-gray-500 text-2xs font-mono uppercase tracking-wider mb-2">⚖️ Decisions</p>
          <ol className="space-y-1.5">
            {meeting.decisions.map((d, i) => (
              <li key={i} className="flex gap-3 text-xs font-mono text-gray-200">
                <span className="text-gray-600 flex-shrink-0">{i + 1}.</span>
                <span>{d}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Action Items */}
      {meeting.action_items.length > 0 && (
        <div>
          <p className="text-gray-500 text-2xs font-mono uppercase tracking-wider mb-2">
            ✅ Action Items ({openActions.length} open)
          </p>
          <div className="space-y-2">
            {meeting.action_items.map((item, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 border rounded p-2.5 ${
                  item.completed
                    ? "border-gray-800 opacity-50"
                    : "border-gray-700 bg-gray-900"
                }`}
              >
                <button
                  onClick={() => !item.completed && completeAction(i)}
                  disabled={item.completed}
                  className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded border text-center text-2xs leading-none ${
                    item.completed
                      ? "border-green-700 bg-green-900 text-green-400"
                      : "border-gray-600 hover:border-green-600"
                  }`}
                >
                  {item.completed ? "✓" : ""}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-mono ${item.completed ? "line-through text-gray-600" : "text-gray-200"}`}>
                    {item.description}
                  </p>
                  <div className="flex gap-2 mt-0.5">
                    {item.owner && (
                      <span className="text-2xs font-mono bg-blue-900/40 border border-blue-800 rounded px-1.5 py-0.5 text-blue-400">
                        {item.owner}
                      </span>
                    )}
                    {item.due_date && (
                      <span className="text-2xs font-mono text-gray-500">{item.due_date}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Questions */}
      {meeting.open_questions.length > 0 && (
        <div>
          <p className="text-gray-500 text-2xs font-mono uppercase tracking-wider mb-2">? Open Questions</p>
          <div className="space-y-1.5">
            {meeting.open_questions.map((q, i) => (
              <div key={i} className="flex gap-3 text-xs font-mono text-gray-300 border border-gray-800 rounded p-2">
                <span className="text-gray-600">?</span>
                <span>{q}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up email */}
      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <p className="text-gray-400 text-2xs font-mono uppercase tracking-wider mb-3">Generate Follow-up Email</p>
        <div className="flex gap-2 mb-3">
          <input
            className="flex-1 bg-black border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-green-500"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="recipient@example.com"
          />
          <button
            onClick={generateFollowUp}
            disabled={generatingEmail || !recipient.trim()}
            className="px-3 py-1.5 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 font-mono"
          >
            {generatingEmail ? "Generating..." : "Generate →"}
          </button>
        </div>
        {followUpEmail && (
          <div className="relative">
            <textarea
              readOnly
              className="w-full bg-black border border-gray-700 rounded p-3 text-xs font-mono resize-none h-40 text-gray-300"
              value={followUpEmail}
            />
            <button
              onClick={copyEmail}
              className="absolute top-2 right-2 text-2xs font-mono px-2 py-1 border border-gray-700 rounded bg-gray-900 text-gray-400 hover:text-green-400 hover:border-green-700"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  meetings,
  selectedId,
  onSelect,
  onNewMeeting,
  searchQuery,
  setSearchQuery,
  onSearch,
  globalActions,
}: {
  meetings: Meeting[];
  selectedId: string | null;
  onSelect: (m: Meeting) => void;
  onNewMeeting: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSearch: () => void;
  globalActions: ActionItem[];
}) {
  const openGlobal = globalActions.filter((a) => !a.completed);

  return (
    <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-950 flex-shrink-0">
      {/* Search */}
      <div className="p-3 border-b border-gray-800">
        <div className="flex gap-1.5">
          <input
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-green-500"
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
          />
          <button
            onClick={onSearch}
            className="text-xs border border-gray-700 rounded px-2 py-1.5 hover:border-gray-500 text-gray-400"
          >
            ↵
          </button>
        </div>
      </div>

      {/* New meeting button */}
      <div className="p-3 border-b border-gray-800">
        <button
          onClick={onNewMeeting}
          className="w-full text-xs text-green-400 border border-green-700 rounded py-1.5 hover:bg-green-900/30 font-mono"
        >
          + New Meeting
        </button>
      </div>

      {/* Global open action items */}
      {openGlobal.length > 0 && (
        <div className="p-3 border-b border-gray-800">
          <p className="text-amber-500 text-2xs font-mono uppercase tracking-wider mb-2">
            Open Actions ({openGlobal.length})
          </p>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {openGlobal.slice(0, 8).map((a, i) => (
              <div key={i} className="text-2xs font-mono text-gray-400 border border-gray-800 rounded px-2 py-1">
                <div className="truncate">{a.description}</div>
                {a.meeting_title && (
                  <div className="text-gray-600 truncate mt-0.5">{a.meeting_title}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meeting list */}
      <div className="flex-1 overflow-y-auto">
        {meetings.length === 0 && (
          <p className="text-gray-700 text-2xs font-mono p-3 text-center">No meetings yet.</p>
        )}
        {meetings.map((m) => {
          const openCount = m.action_items.filter((a) => !a.completed).length;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m)}
              className={`w-full text-left p-3 border-b border-gray-800 hover:bg-gray-900 transition-colors ${
                selectedId === m.id ? "bg-gray-900 border-l-2 border-l-green-500" : ""
              }`}
            >
              <div className="text-xs font-mono text-gray-200 truncate">{m.title}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xs text-gray-600 font-mono">{m.date}</span>
                <TypeBadge type={m.meeting_type} />
                {openCount > 0 && (
                  <span className="text-2xs font-mono bg-amber-900/50 border border-amber-700 text-amber-400 rounded px-1.5 py-0.5 ml-auto">
                    {openCount} open
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── More tools tab ────────────────────────────────────────────────────────────

function MoreTools({ meetings }: { meetings: Meeting[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<string>("");
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [themes, setThemes] = useState<string[]>([]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function compare() {
    if (selectedIds.length < 2) return;
    setComparing(true);
    setCompareResult("");
    try {
      const result = await invoke<string>("meeting_compare", { ids: selectedIds });
      setCompareResult(result);
    } catch (e) {
      console.error(e);
    } finally {
      setComparing(false);
    }
  }

  async function findThemes() {
    setLoadingThemes(true);
    setThemes([]);
    try {
      const result = await invoke<string[]>("meeting_recurring_themes", { daysBack: 30 });
      setThemes(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingThemes(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Compare meetings */}
      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <h3 className="text-green-400 font-mono text-xs mb-3">Compare Meetings</h3>
        <p className="text-gray-500 text-2xs font-mono mb-3">Select 2+ meetings to compare:</p>
        <div className="space-y-1 max-h-48 overflow-y-auto mb-3">
          {meetings.map((m) => (
            <label
              key={m.id}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer border ${
                selectedIds.includes(m.id)
                  ? "border-green-700 bg-green-950/20"
                  : "border-gray-800 hover:border-gray-700"
              }`}
            >
              <input
                type="checkbox"
                className="accent-green-500"
                checked={selectedIds.includes(m.id)}
                onChange={() => toggleSelect(m.id)}
              />
              <span className="text-xs font-mono text-gray-200">{m.title}</span>
              <span className="text-2xs text-gray-600 font-mono ml-auto">{m.date}</span>
            </label>
          ))}
        </div>
        <button
          onClick={compare}
          disabled={comparing || selectedIds.length < 2}
          className="px-3 py-1.5 text-xs text-blue-400 border border-blue-700 rounded hover:bg-blue-900/20 disabled:opacity-40 font-mono"
        >
          {comparing ? "Comparing..." : `Compare (${selectedIds.length} selected)`}
        </button>
        {compareResult && (
          <div className="mt-3 border border-gray-700 rounded p-3 text-xs font-mono text-gray-200 whitespace-pre-wrap">
            {compareResult}
          </div>
        )}
      </div>

      {/* Recurring themes */}
      <div className="border border-gray-700 rounded-lg p-4 bg-gray-900">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-green-400 font-mono text-xs">Find Recurring Themes (30 days)</h3>
          <button
            onClick={findThemes}
            disabled={loadingThemes}
            className="text-xs text-purple-400 border border-purple-700 rounded px-2 py-1 hover:bg-purple-900/20 disabled:opacity-40 font-mono"
          >
            {loadingThemes ? "Analyzing..." : "Analyze →"}
          </button>
        </div>
        {themes.length > 0 && (
          <div className="space-y-1.5">
            {themes.map((theme, i) => (
              <div key={i} className="border border-gray-800 rounded px-3 py-2 text-xs font-mono text-gray-200">
                {i + 1}. {theme}
              </div>
            ))}
          </div>
        )}
        {themes.length === 0 && !loadingThemes && (
          <p className="text-gray-600 text-xs font-mono">Click Analyze to find recurring themes across your recent meetings.</p>
        )}
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function MeetingView({ onBack }: { onBack: () => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [view, setView] = useState<"detail" | "new" | "more">("new");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalActions, setGlobalActions] = useState<ActionItem[]>([]);

  const loadMeetings = useCallback(async () => {
    try {
      const list = await invoke<Meeting[]>("meeting_list");
      setMeetings(list);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadGlobalActions = useCallback(async () => {
    try {
      const actions = await invoke<ActionItem[]>("meeting_get_action_items");
      setGlobalActions(actions);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadMeetings();
    loadGlobalActions();
  }, [loadMeetings, loadGlobalActions]);

  async function search() {
    if (!searchQuery.trim()) {
      loadMeetings();
      return;
    }
    try {
      const results = await invoke<Meeting[]>("meeting_search", { query: searchQuery });
      setMeetings(results);
    } catch (e) {
      console.error(e);
    }
  }

  function handleProcessed(meeting: Meeting) {
    setMeetings((prev) => [meeting, ...prev]);
    setSelectedMeeting(meeting);
    setView("detail");
    loadGlobalActions();
  }

  function handleSelect(m: Meeting) {
    setSelectedMeeting(m);
    setView("detail");
  }

  function handleActionComplete() {
    // Refresh meeting detail
    if (selectedMeeting) {
      invoke<Meeting>("meeting_get", { meetingId: selectedMeeting.id })
        .then(setSelectedMeeting)
        .catch(console.error);
    }
    loadGlobalActions();
  }

  return (
    <div className="flex flex-col h-screen bg-black text-gray-200 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-300 text-xs border border-gray-800 rounded px-2 py-1"
          >
            ← Back
          </button>
          <span className="text-green-400 text-sm font-mono">📋 Meetings</span>
        </div>
        <button
          onClick={() => setView("more")}
          className={`text-xs border rounded px-2 py-1 font-mono ${
            view === "more"
              ? "border-purple-600 text-purple-400"
              : "border-gray-700 text-gray-500 hover:border-gray-600"
          }`}
        >
          More Tools
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <Sidebar
          meetings={meetings}
          selectedId={selectedMeeting?.id ?? null}
          onSelect={handleSelect}
          onNewMeeting={() => { setSelectedMeeting(null); setView("new"); }}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearch={search}
          globalActions={globalActions}
        />

        {/* Main panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {view === "new" && (
            <NewMeetingForm onProcessed={handleProcessed} />
          )}
          {view === "detail" && selectedMeeting && (
            <MeetingDetail
              meeting={selectedMeeting}
              onActionComplete={handleActionComplete}
            />
          )}
          {view === "more" && (
            <div className="space-y-4">
              <h2 className="text-green-400 font-mono text-xs uppercase tracking-widest">More Tools</h2>
              <MoreTools meetings={meetings} />
            </div>
          )}
          {view === "detail" && !selectedMeeting && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-700 text-xs font-mono">Select a meeting from the sidebar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
