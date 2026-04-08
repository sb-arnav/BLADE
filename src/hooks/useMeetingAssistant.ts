import { useState, useCallback, useMemo, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ActionItem {
  task: string;
  assignee: string;
  deadline: string;
  completed: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  agenda: string[];
  notes: string;
  actionItems: ActionItem[];
  decisions: string[];
  followUps: string[];
  transcript: string;
  summary: string;
  status: "upcoming" | "in-progress" | "completed";
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MeetingTemplate {
  id: string;
  name: string;
  icon: string;
  agendaItems: string[];
  description: string;
}

export interface MeetingStats {
  totalMeetings: number;
  completedMeetings: number;
  upcomingMeetings: number;
  totalActionItems: number;
  completedActionItems: number;
  avgDurationMinutes: number;
  topAttendees: Array<{ name: string; count: number }>;
  meetingsThisWeek: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-meetings";

const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: "standup",
    name: "Standup",
    icon: "\u26A1",
    description: "Quick daily sync — blockers, progress, plans",
    agendaItems: [
      "What did you accomplish yesterday?",
      "What are you working on today?",
      "Any blockers or impediments?",
      "Quick announcements",
    ],
  },
  {
    id: "sprint-planning",
    name: "Sprint Planning",
    icon: "\uD83D\uDCCB",
    description: "Plan the upcoming sprint — goals, capacity, backlog",
    agendaItems: [
      "Review previous sprint outcomes",
      "Discuss sprint goals",
      "Estimate team capacity",
      "Select backlog items for sprint",
      "Assign ownership and dependencies",
      "Define acceptance criteria",
    ],
  },
  {
    id: "one-on-one",
    name: "1-on-1",
    icon: "\uD83E\uDD1D",
    description: "Dedicated time for mentoring, feedback, and growth",
    agendaItems: [
      "Check-in: How are you doing?",
      "Progress on current goals",
      "Challenges and support needed",
      "Feedback exchange",
      "Career development and growth",
      "Action items from last meeting",
    ],
  },
  {
    id: "brainstorm",
    name: "Brainstorm",
    icon: "\uD83D\uDCA1",
    description: "Ideation session — diverge, converge, decide",
    agendaItems: [
      "Define the problem statement",
      "Silent brainstorming (5 min)",
      "Share and group ideas",
      "Discuss top ideas",
      "Vote on best approaches",
      "Define next steps",
    ],
  },
  {
    id: "decision-review",
    name: "Decision Review",
    icon: "\u2696\uFE0F",
    description: "Evaluate options and make a final decision",
    agendaItems: [
      "State the decision to be made",
      "Present options with pros/cons",
      "Open discussion",
      "Risk assessment",
      "Final decision and rationale",
      "Communication plan",
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function loadMeetings(): Meeting[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMeetings(meetings: Meeting[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meetings));
}

function nowISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTime(): string {
  return new Date().toTimeString().slice(0, 5);
}

function parseDuration(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMeetingAssistant() {
  const [meetings, setMeetings] = useState<Meeting[]>(loadMeetings);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

  // Persist on change
  useEffect(() => {
    saveMeetings(meetings);
  }, [meetings]);

  // ── Derived state ──────────────────────────────────────────────────────

  const activeMeeting = useMemo(
    () => meetings.find((m) => m.id === activeMeetingId) ?? null,
    [meetings, activeMeetingId]
  );

  const templates = MEETING_TEMPLATES;

  // ── CRUD ───────────────────────────────────────────────────────────────

  const createMeeting = useCallback(
    (
      partial: Partial<Meeting> & Pick<Meeting, "title">,
      templateId?: string
    ): Meeting => {
      const tpl = templateId
        ? MEETING_TEMPLATES.find((t) => t.id === templateId)
        : undefined;
      const now = Date.now();
      const meeting: Meeting = {
        id: uid(),
        title: partial.title,
        date: partial.date ?? nowISO(),
        startTime: partial.startTime ?? "",
        endTime: partial.endTime ?? "",
        attendees: partial.attendees ?? [],
        agenda: partial.agenda ?? tpl?.agendaItems ?? [],
        notes: partial.notes ?? "",
        actionItems: partial.actionItems ?? [],
        decisions: partial.decisions ?? [],
        followUps: partial.followUps ?? [],
        transcript: partial.transcript ?? "",
        summary: partial.summary ?? "",
        status: partial.status ?? "upcoming",
        tags: partial.tags ?? (tpl ? [tpl.name.toLowerCase()] : []),
        createdAt: now,
        updatedAt: now,
      };
      setMeetings((prev) => [meeting, ...prev]);
      return meeting;
    },
    []
  );

  const updateMeeting = useCallback(
    (id: string, changes: Partial<Meeting>): void => {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, ...changes, updatedAt: Date.now() } : m
        )
      );
    },
    []
  );

  const deleteMeeting = useCallback(
    (id: string): void => {
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      if (activeMeetingId === id) setActiveMeetingId(null);
    },
    [activeMeetingId]
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────

  const startMeeting = useCallback(
    (id: string): void => {
      updateMeeting(id, { status: "in-progress", startTime: nowTime() });
      setActiveMeetingId(id);
    },
    [updateMeeting]
  );

  const endMeeting = useCallback(
    (id: string): void => {
      updateMeeting(id, { status: "completed", endTime: nowTime() });
    },
    [updateMeeting]
  );

  // ── Note-taking helpers ────────────────────────────────────────────────

  const addNote = useCallback(
    (id: string, text: string): void => {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                notes: m.notes ? m.notes + "\n" + text : text,
                updatedAt: Date.now(),
              }
            : m
        )
      );
    },
    []
  );

  const addActionItem = useCallback(
    (id: string, item: ActionItem): void => {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                actionItems: [...m.actionItems, item],
                updatedAt: Date.now(),
              }
            : m
        )
      );
    },
    []
  );

  const addDecision = useCallback(
    (id: string, decision: string): void => {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                decisions: [...m.decisions, decision],
                updatedAt: Date.now(),
              }
            : m
        )
      );
    },
    []
  );

  // ── AI Features ────────────────────────────────────────────────────────

  const generateSummary = useCallback(
    (id: string): string => {
      const m = meetings.find((mt) => mt.id === id);
      if (!m) return "";

      const sections: string[] = [];
      sections.push(`# Meeting Summary: ${m.title}`);
      sections.push(`**Date:** ${m.date} | **Time:** ${m.startTime || "N/A"} \u2013 ${m.endTime || "N/A"}`);

      if (m.attendees.length > 0) {
        sections.push(`**Attendees:** ${m.attendees.join(", ")}`);
      }

      if (m.agenda.length > 0) {
        sections.push("\n## Agenda");
        m.agenda.forEach((a, i) => sections.push(`${i + 1}. ${a}`));
      }

      if (m.notes.trim()) {
        sections.push("\n## Key Discussion Points");
        const noteLines = m.notes.split("\n").filter((l) => l.trim());
        noteLines.forEach((n) => sections.push(`- ${n.trim()}`));
      }

      if (m.decisions.length > 0) {
        sections.push("\n## Decisions Made");
        m.decisions.forEach((d, i) => sections.push(`${i + 1}. ${d}`));
      }

      if (m.actionItems.length > 0) {
        sections.push("\n## Action Items");
        m.actionItems.forEach((a) => {
          const status = a.completed ? "\u2705" : "\u2B1C";
          sections.push(
            `${status} **${a.task}** \u2014 Assigned to: ${a.assignee || "Unassigned"}${a.deadline ? ` | Due: ${a.deadline}` : ""}`
          );
        });
      }

      if (m.followUps.length > 0) {
        sections.push("\n## Follow-ups");
        m.followUps.forEach((f, i) => sections.push(`${i + 1}. ${f}`));
      }

      const openItems = m.actionItems.filter((a) => !a.completed).length;
      sections.push("\n## Summary Statistics");
      sections.push(`- Total action items: ${m.actionItems.length} (${openItems} open)`);
      sections.push(`- Decisions made: ${m.decisions.length}`);
      if (m.startTime && m.endTime) {
        sections.push(`- Duration: ${parseDuration(m.startTime, m.endTime)} minutes`);
      }

      const summary = sections.join("\n");
      updateMeeting(id, { summary });
      return summary;
    },
    [meetings, updateMeeting]
  );

  const generateFollowUpEmail = useCallback(
    (id: string): string => {
      const m = meetings.find((mt) => mt.id === id);
      if (!m) return "";

      const lines: string[] = [];
      lines.push(`Subject: Follow-Up \u2014 ${m.title} (${m.date})\n`);
      lines.push(`Hi ${m.attendees.length > 0 ? m.attendees.join(", ") : "team"},\n`);
      lines.push(
        `Thank you for attending "${m.title}" on ${m.date}. Below is a recap of what we discussed and the next steps.\n`
      );

      if (m.decisions.length > 0) {
        lines.push("**Key Decisions:**");
        m.decisions.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`));
        lines.push("");
      }

      const openItems = m.actionItems.filter((a) => !a.completed);
      if (openItems.length > 0) {
        lines.push("**Action Items:**");
        openItems.forEach((a) => {
          lines.push(
            `  - ${a.task} \u2192 ${a.assignee || "TBD"}${a.deadline ? ` (due ${a.deadline})` : ""}`
          );
        });
        lines.push("");
      }

      if (m.followUps.length > 0) {
        lines.push("**Follow-ups:**");
        m.followUps.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
        lines.push("");
      }

      lines.push(
        "Please review the action items and let me know if anything needs to be adjusted. Looking forward to our continued progress!\n"
      );
      lines.push("Best regards");

      return lines.join("\n");
    },
    [meetings]
  );

  // ── Queries ────────────────────────────────────────────────────────────

  const searchMeetings = useCallback(
    (query: string): Meeting[] => {
      const q = query.toLowerCase().trim();
      if (!q) return meetings;
      return meetings.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.notes.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)) ||
          m.attendees.some((a) => a.toLowerCase().includes(q)) ||
          m.decisions.some((d) => d.toLowerCase().includes(q))
      );
    },
    [meetings]
  );

  const getUpcoming = useCallback((): Meeting[] => {
    const today = nowISO();
    return meetings
      .filter((m) => m.status === "upcoming" && m.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [meetings]);

  const getActionItems = useCallback((): Array<ActionItem & { meetingId: string; meetingTitle: string }> => {
    const items: Array<ActionItem & { meetingId: string; meetingTitle: string }> = [];
    meetings.forEach((m) => {
      m.actionItems
        .filter((a) => !a.completed)
        .forEach((a) => {
          items.push({ ...a, meetingId: m.id, meetingTitle: m.title });
        });
    });
    return items.sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }, [meetings]);

  // ── Stats ──────────────────────────────────────────────────────────────

  const stats = useMemo((): MeetingStats => {
    const completed = meetings.filter((m) => m.status === "completed");
    const upcoming = meetings.filter((m) => m.status === "upcoming");
    const allActions = meetings.flatMap((m) => m.actionItems);
    const completedActions = allActions.filter((a) => a.completed);

    // Average duration
    const durations = completed
      .map((m) => parseDuration(m.startTime, m.endTime))
      .filter((d) => d > 0);
    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : 0;

    // Top attendees
    const attendeeMap: Record<string, number> = {};
    meetings.forEach((m) => {
      m.attendees.forEach((a) => {
        const name = a.trim();
        if (name) attendeeMap[name] = (attendeeMap[name] || 0) + 1;
      });
    });
    const topAttendees = Object.entries(attendeeMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // This week
    const week = getWeekRange();
    const meetingsThisWeek = meetings.filter(
      (m) => m.date >= week.start && m.date <= week.end
    ).length;

    return {
      totalMeetings: meetings.length,
      completedMeetings: completed.length,
      upcomingMeetings: upcoming.length,
      totalActionItems: allActions.length,
      completedActionItems: completedActions.length,
      avgDurationMinutes: avgDuration,
      topAttendees,
      meetingsThisWeek,
    };
  }, [meetings]);

  // ── Return ─────────────────────────────────────────────────────────────

  return {
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
  };
}
