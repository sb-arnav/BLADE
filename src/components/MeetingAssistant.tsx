import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  useMeetingAssistant,
  Meeting,
  MeetingTemplate,
} from "../hooks/useMeetingAssistant";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(time: string): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusColor(status: Meeting["status"]): string {
  switch (status) {
    case "upcoming":
      return "text-blue-400 bg-blue-500/15";
    case "in-progress":
      return "text-emerald-400 bg-emerald-500/15";
    case "completed":
      return "text-zinc-400 bg-zinc-500/15";
  }
}

function statusLabel(status: Meeting["status"]): string {
  switch (status) {
    case "upcoming":
      return "Upcoming";
    case "in-progress":
      return "In Progress";
    case "completed":
      return "Completed";
  }
}

type View = "list" | "active" | "create";
type Tab = "notes" | "actions" | "decisions" | "summary";
type FilterStatus = "all" | "upcoming" | "in-progress" | "completed";

// ── Component ────────────────────────────────────────────────────────────────

export default function MeetingAssistant({ onBack, onSendToChat }: Props) {
  const {
    meetings,
    activeMeeting,
    activeMeetingId,
    setActiveMeetingId,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    startMeeting,
    endMeeting,
    addNote,
    addActionItem,
    addDecision,
    generateSummary,
    generateFollowUpEmail,
    searchMeetings,
    getUpcoming,
    getActionItems,
    templates,
    stats,
  } = useMeetingAssistant();

  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<Tab>("notes");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Create form state ──────────────────────────────────────────────────

  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState(todayStr());
  const [formStartTime, setFormStartTime] = useState("09:00");
  const [formEndTime, setFormEndTime] = useState("10:00");
  const [formAttendees, setFormAttendees] = useState("");
  const [formAgenda, setFormAgenda] = useState("");
  const [formTemplate, setFormTemplate] = useState<string>("");

  // ── Inline add state ───────────────────────────────────────────────────

  const [newNote, setNewNote] = useState("");
  const [newActionTask, setNewActionTask] = useState("");
  const [newActionAssignee, setNewActionAssignee] = useState("");
  const [newActionDeadline, setNewActionDeadline] = useState("");
  const [newDecision, setNewDecision] = useState("");

  // ── Timer for in-progress meetings ─────────────────────────────────────

  useEffect(() => {
    if (activeMeeting?.status === "in-progress") {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeMeeting?.status, activeMeetingId]);

  // ── Filtered meetings ──────────────────────────────────────────────────

  const filteredMeetings = useMemo(() => {
    let list = search ? searchMeetings(search) : meetings;
    if (filterStatus !== "all") {
      list = list.filter((m) => m.status === filterStatus);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [meetings, search, filterStatus, searchMeetings]);

  const upcomingMeetings = useMemo(() => getUpcoming(), [getUpcoming]);
  const allOpenActions = useMemo(() => getActionItems(), [getActionItems]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    if (!formTitle.trim()) return;
    const tpl = templates.find((t) => t.id === formTemplate);
    const agendaItems = formAgenda
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const meeting = createMeeting(
      {
        title: formTitle.trim(),
        date: formDate,
        startTime: formStartTime,
        endTime: formEndTime,
        attendees: formAttendees
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        agenda: agendaItems.length > 0 ? agendaItems : tpl?.agendaItems ?? [],
      },
      formTemplate || undefined
    );
    setActiveMeetingId(meeting.id);
    setView("active");
    setTab("notes");
    // Reset form
    setFormTitle("");
    setFormDate(todayStr());
    setFormStartTime("09:00");
    setFormEndTime("10:00");
    setFormAttendees("");
    setFormAgenda("");
    setFormTemplate("");
  }, [
    formTitle, formDate, formStartTime, formEndTime, formAttendees,
    formAgenda, formTemplate, createMeeting, templates, setActiveMeetingId,
  ]);

  const handleTemplateSelect = useCallback(
    (tpl: MeetingTemplate) => {
      setFormTemplate(tpl.id);
      setFormAgenda(tpl.agendaItems.join("\n"));
      if (!formTitle) setFormTitle(tpl.name);
    },
    [formTitle]
  );

  const handleAddNote = useCallback(() => {
    if (!activeMeetingId || !newNote.trim()) return;
    addNote(activeMeetingId, newNote.trim());
    setNewNote("");
  }, [activeMeetingId, newNote, addNote]);

  const handleAddAction = useCallback(() => {
    if (!activeMeetingId || !newActionTask.trim()) return;
    addActionItem(activeMeetingId, {
      task: newActionTask.trim(),
      assignee: newActionAssignee.trim(),
      deadline: newActionDeadline,
      completed: false,
    });
    setNewActionTask("");
    setNewActionAssignee("");
    setNewActionDeadline("");
  }, [activeMeetingId, newActionTask, newActionAssignee, newActionDeadline, addActionItem]);

  const handleAddDecision = useCallback(() => {
    if (!activeMeetingId || !newDecision.trim()) return;
    addDecision(activeMeetingId, newDecision.trim());
    setNewDecision("");
  }, [activeMeetingId, newDecision, addDecision]);

  const handleToggleAction = useCallback(
    (idx: number) => {
      if (!activeMeeting) return;
      const updated = [...activeMeeting.actionItems];
      updated[idx] = { ...updated[idx], completed: !updated[idx].completed };
      updateMeeting(activeMeeting.id, { actionItems: updated });
    },
    [activeMeeting, updateMeeting]
  );

  const handleGenerateSummary = useCallback(() => {
    if (!activeMeetingId) return;
    generateSummary(activeMeetingId);
    setTab("summary");
  }, [activeMeetingId, generateSummary]);

  const handleFollowUpEmail = useCallback(() => {
    if (!activeMeetingId) return;
    const email = generateFollowUpEmail(activeMeetingId);
    onSendToChat(email);
  }, [activeMeetingId, generateFollowUpEmail, onSendToChat]);

  const openMeeting = useCallback(
    (id: string) => {
      setActiveMeetingId(id);
      setView("active");
      setTab("notes");
    },
    [setActiveMeetingId]
  );

  // ── Render: Create view ────────────────────────────────────────────────

  const renderCreateView = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setView("list")}
          className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold text-zinc-200">New Meeting</h2>
      </div>

      {/* Template selector */}
      <div>
        <label className="block text-xs text-zinc-500 mb-2">Template</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setFormTemplate(""); setFormAgenda(""); }}
            className={`p-2.5 rounded-lg border text-left text-xs transition ${
              !formTemplate
                ? "border-accent/50 bg-accent/10 text-zinc-200"
                : "border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5"
            }`}
          >
            <span className="mr-1.5">{"\uD83D\uDCC4"}</span> Blank
          </button>
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => handleTemplateSelect(tpl)}
              className={`p-2.5 rounded-lg border text-left text-xs transition ${
                formTemplate === tpl.id
                  ? "border-accent/50 bg-accent/10 text-zinc-200"
                  : "border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5"
              }`}
            >
              <span className="mr-1.5">{tpl.icon}</span> {tpl.name}
              <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{tpl.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Title</label>
        <input
          type="text"
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          placeholder="Meeting title..."
          className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40"
        />
      </div>

      {/* Date / Time */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Date</label>
          <input
            type="date"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/40"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Start</label>
          <input
            type="time"
            value={formStartTime}
            onChange={(e) => setFormStartTime(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/40"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">End</label>
          <input
            type="time"
            value={formEndTime}
            onChange={(e) => setFormEndTime(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-accent/40"
          />
        </div>
      </div>

      {/* Attendees */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Attendees (comma separated)</label>
        <input
          type="text"
          value={formAttendees}
          onChange={(e) => setFormAttendees(e.target.value)}
          placeholder="Alice, Bob, Charlie..."
          className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40"
        />
      </div>

      {/* Agenda */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Agenda (one item per line)</label>
        <textarea
          value={formAgenda}
          onChange={(e) => setFormAgenda(e.target.value)}
          rows={4}
          placeholder="Enter agenda items..."
          className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40 resize-none"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleCreate}
        disabled={!formTitle.trim()}
        className="w-full py-2.5 rounded-lg bg-accent/80 hover:bg-accent text-white text-sm font-medium transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Create Meeting
      </button>
    </div>
  );

  // ── Render: Active meeting view ────────────────────────────────────────

  const renderActiveView = () => {
    if (!activeMeeting) return null;
    const m = activeMeeting;
    const isLive = m.status === "in-progress";

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start gap-2 mb-3">
          <button
            onClick={() => { setView("list"); setActiveMeetingId(null); }}
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 mt-0.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-zinc-200 truncate">{m.title}</h2>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
              <span>{formatDate(m.date)}</span>
              {m.startTime && <span>{formatTime(m.startTime)}</span>}
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor(m.status)}`}>
                {statusLabel(m.status)}
              </span>
            </div>
            {m.attendees.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {m.attendees.map((a, i) => (
                  <span key={i} className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 text-zinc-400">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isLive && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {formatElapsed(elapsed)}
              </span>
            )}
            {m.status === "upcoming" && (
              <button
                onClick={() => startMeeting(m.id)}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-medium transition"
              >
                Start
              </button>
            )}
            {isLive && (
              <button
                onClick={() => endMeeting(m.id)}
                className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium transition"
              >
                End
              </button>
            )}
          </div>
        </div>

        {/* Agenda bar */}
        {m.agenda.length > 0 && (
          <div className="mb-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Agenda</p>
            <div className="space-y-0.5">
              {m.agenda.map((item, i) => (
                <p key={i} className="text-xs text-zinc-400">
                  <span className="text-zinc-600 mr-1.5">{i + 1}.</span>{item}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0.5 mb-3 p-0.5 rounded-lg bg-white/[0.02]">
          {(["notes", "actions", "decisions", "summary"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${
                tab === t
                  ? "bg-white/10 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-400"
              }`}
            >
              {t === "notes" && "Notes"}
              {t === "actions" && `Actions (${m.actionItems.length})`}
              {t === "decisions" && `Decisions (${m.decisions.length})`}
              {t === "summary" && "Summary"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* ── Notes Tab ─────────────────────────────────────── */}
          {tab === "notes" && (
            <div className="space-y-3">
              {m.notes && (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
                    {m.notes}
                  </pre>
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote();
                  }}
                  className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40 resize-none"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="px-3 self-end rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-xs font-medium transition disabled:opacity-30"
                >
                  Add
                </button>
              </div>
              {/* Full notes editor */}
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Full Notes</label>
                <textarea
                  value={m.notes}
                  onChange={(e) => updateMeeting(m.id, { notes: e.target.value })}
                  rows={8}
                  placeholder="Type meeting notes here..."
                  className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40 resize-none leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* ── Actions Tab ───────────────────────────────────── */}
          {tab === "actions" && (
            <div className="space-y-3">
              {/* Add form */}
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 space-y-2">
                <input
                  type="text"
                  value={newActionTask}
                  onChange={(e) => setNewActionTask(e.target.value)}
                  placeholder="Action item..."
                  className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newActionAssignee}
                    onChange={(e) => setNewActionAssignee(e.target.value)}
                    placeholder="Assignee"
                    className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40"
                  />
                  <input
                    type="date"
                    value={newActionDeadline}
                    onChange={(e) => setNewActionDeadline(e.target.value)}
                    className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent/40"
                  />
                  <button
                    onClick={handleAddAction}
                    disabled={!newActionTask.trim()}
                    className="px-3 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-xs font-medium transition disabled:opacity-30"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Action list */}
              {m.actionItems.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-6">No action items yet</p>
              ) : (
                <div className="space-y-1">
                  {m.actionItems.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                        item.completed
                          ? "border-white/5 bg-white/[0.01] opacity-50"
                          : "border-white/5 bg-white/[0.02]"
                      }`}
                    >
                      <button
                        onClick={() => handleToggleAction(idx)}
                        className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${
                          item.completed
                            ? "bg-emerald-500/30 border-emerald-500/50 text-emerald-400"
                            : "border-white/10 hover:border-accent/40"
                        }`}
                      >
                        {item.completed && (
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs ${item.completed ? "line-through text-zinc-500" : "text-zinc-200"}`}>
                          {item.task}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.assignee && (
                            <span className="text-[10px] text-zinc-500">{item.assignee}</span>
                          )}
                          {item.deadline && (
                            <span className="text-[10px] text-zinc-600">Due {item.deadline}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Decisions Tab ─────────────────────────────────── */}
          {tab === "decisions" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDecision}
                  onChange={(e) => setNewDecision(e.target.value)}
                  placeholder="Record a decision..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddDecision();
                  }}
                  className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40"
                />
                <button
                  onClick={handleAddDecision}
                  disabled={!newDecision.trim()}
                  className="px-3 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-xs font-medium transition disabled:opacity-30"
                >
                  Add
                </button>
              </div>

              {m.decisions.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-6">No decisions recorded yet</p>
              ) : (
                <div className="space-y-1.5">
                  {m.decisions.map((d, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                      <span className="w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] flex items-center justify-center flex-shrink-0 font-semibold mt-0.5">
                        {i + 1}
                      </span>
                      <p className="text-xs text-zinc-300 leading-relaxed">{d}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Summary Tab ───────────────────────────────────── */}
          {tab === "summary" && (
            <div className="space-y-3">
              {!m.summary ? (
                <div className="text-center py-8">
                  <p className="text-xs text-zinc-500 mb-3">
                    Generate an AI-powered summary of this meeting
                  </p>
                  <button
                    onClick={handleGenerateSummary}
                    className="px-4 py-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-xs font-medium transition"
                  >
                    Generate Summary
                  </button>
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {m.summary}
                    </pre>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleGenerateSummary}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 text-xs transition"
                    >
                      Regenerate
                    </button>
                    <button
                      onClick={() => onSendToChat(m.summary)}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 text-xs transition"
                    >
                      Send to Chat
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Bottom actions */}
        <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
          <button
            onClick={handleFollowUpEmail}
            className="flex-1 py-2 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs font-medium transition"
          >
            Follow-Up Email
          </button>
          <button
            onClick={() => {
              if (confirm("Delete this meeting?")) {
                deleteMeeting(m.id);
                setView("list");
              }
            }}
            className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition"
          >
            Delete
          </button>
        </div>
      </div>
    );
  };

  // ── Render: List view ──────────────────────────────────────────────────

  const renderListView = () => (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Total", value: stats.totalMeetings },
          { label: "Upcoming", value: stats.upcomingMeetings },
          { label: "This Week", value: stats.meetingsThisWeek },
          { label: "Open Tasks", value: stats.totalActionItems - stats.completedActionItems },
        ].map((s) => (
          <div key={s.label} className="p-2 rounded-lg bg-white/[0.02] border border-white/5 text-center">
            <p className="text-sm font-semibold text-zinc-200">{s.value}</p>
            <p className="text-[10px] text-zinc-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search & filter */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <svg
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search meetings..."
            className="w-full bg-white/[0.03] border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/40"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
          className="bg-white/[0.03] border border-white/5 rounded-lg px-2 py-1.5 text-xs text-zinc-400 outline-none focus:border-accent/40"
        >
          <option value="all">All</option>
          <option value="upcoming">Upcoming</option>
          <option value="in-progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Create button */}
      <button
        onClick={() => setView("create")}
        className="w-full py-2.5 rounded-lg border border-dashed border-white/10 hover:border-accent/30 hover:bg-accent/5 text-zinc-400 hover:text-accent text-xs font-medium transition"
      >
        + New Meeting
      </button>

      {/* Open action items */}
      {allOpenActions.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <p className="text-[10px] uppercase tracking-wider text-amber-500/70 mb-2">
            Open Action Items ({allOpenActions.length})
          </p>
          <div className="space-y-1.5">
            {allOpenActions.slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-amber-500/50 mt-0.5">{"\u25CB"}</span>
                <div className="min-w-0">
                  <p className="text-zinc-300 truncate">{a.task}</p>
                  <p className="text-[10px] text-zinc-600">
                    {a.meetingTitle}{a.assignee ? ` \u2022 ${a.assignee}` : ""}{a.deadline ? ` \u2022 Due ${a.deadline}` : ""}
                  </p>
                </div>
              </div>
            ))}
            {allOpenActions.length > 5 && (
              <p className="text-[10px] text-zinc-600 ml-4">+{allOpenActions.length - 5} more...</p>
            )}
          </div>
        </div>
      )}

      {/* Upcoming meetings */}
      {upcomingMeetings.length > 0 && filterStatus === "all" && !search && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Upcoming</p>
          <div className="space-y-1.5">
            {upcomingMeetings.slice(0, 3).map((m) => (
              <button
                key={m.id}
                onClick={() => openMeeting(m.id)}
                className="w-full p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] text-left transition"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-200 truncate">{m.title}</p>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor(m.status)}`}>
                    {statusLabel(m.status)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
                  <span>{formatDate(m.date)}</span>
                  {m.startTime && <span>{formatTime(m.startTime)}</span>}
                  {m.attendees.length > 0 && (
                    <span>{m.attendees.length} attendee{m.attendees.length !== 1 ? "s" : ""}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All meetings */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
          {search ? `Results (${filteredMeetings.length})` : "All Meetings"}
        </p>
        {filteredMeetings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-zinc-600">
              {search ? "No meetings found" : "No meetings yet. Create one to get started!"}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredMeetings.map((m) => (
              <button
                key={m.id}
                onClick={() => openMeeting(m.id)}
                className="w-full p-3 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] text-left transition"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-200 truncate">{m.title}</p>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor(m.status)}`}>
                    {statusLabel(m.status)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
                  <span>{formatDate(m.date)}</span>
                  {m.startTime && <span>{formatTime(m.startTime)}</span>}
                  {m.attendees.length > 0 && (
                    <span>{m.attendees.length} attendee{m.attendees.length !== 1 ? "s" : ""}</span>
                  )}
                  {m.actionItems.length > 0 && (
                    <span>{m.actionItems.filter((a) => !a.completed).length} open tasks</span>
                  )}
                </div>
                {m.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {m.tags.map((t, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-zinc-500">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      {view === "list" && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-sm font-semibold text-zinc-200">Meeting Assistant</h1>
          </div>
          <span className="text-[10px] text-zinc-600">{meetings.length} meetings</span>
        </div>
      )}

      {/* Views */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {view === "list" && renderListView()}
        {view === "create" && renderCreateView()}
        {view === "active" && renderActiveView()}
      </div>
    </div>
  );
}
