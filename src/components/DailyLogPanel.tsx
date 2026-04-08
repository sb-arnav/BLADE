import { useState, useMemo, useCallback } from "react";
import { useDailyLog, Habit, DailyStats, WeekDay, MonthDay } from "../hooks/useDailyLog";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (prompt: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOOD_FACES = [
  { value: 1, emoji: "\u{1F629}", label: "Awful" },
  { value: 2, emoji: "\u{1F61E}", label: "Bad" },
  { value: 3, emoji: "\u{1F610}", label: "Okay" },
  { value: 4, emoji: "\u{1F60A}", label: "Good" },
  { value: 5, emoji: "\u{1F929}", label: "Great" },
] as const;

const ENERGY_LEVELS = [
  { value: 1, label: "Drained" },
  { value: 2, label: "Low" },
  { value: 3, label: "Medium" },
  { value: 4, label: "High" },
  { value: 5, label: "Supercharged" },
] as const;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateAdd(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function moodColor(mood: number): string {
  if (mood >= 4) return "bg-emerald-500";
  if (mood === 3) return "bg-amber-400";
  if (mood === 2) return "bg-orange-400";
  return "bg-red-400";
}

function moodBgFaint(mood: number): string {
  if (mood >= 4) return "bg-emerald-500/15";
  if (mood === 3) return "bg-amber-400/15";
  if (mood === 2) return "bg-orange-400/15";
  return "bg-red-400/15";
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ListEditor({ items, onUpdate, placeholder, accentClass }: {
  items: string[];
  onUpdate: (items: string[]) => void;
  placeholder: string;
  accentClass?: string;
}) {
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onUpdate([...items, trimmed]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 group">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${accentClass ?? "bg-blade-accent"}`} />
          <span className="text-sm text-blade-primary flex-1">{item}</span>
          <button
            onClick={() => onUpdate(items.filter((_, j) => j !== i))}
            className="opacity-0 group-hover:opacity-100 text-blade-muted hover:text-red-400 text-xs transition-opacity"
          >
            x
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={placeholder}
          className="flex-1 bg-blade-surface border border-blade-border rounded-lg px-2.5 py-1.5 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40"
        />
        <button
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="text-xs px-2 py-1.5 rounded-lg bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 disabled:opacity-30 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function MoodPicker({ value, onChange }: { value: number; onChange: (v: 1 | 2 | 3 | 4 | 5) => void }) {
  return (
    <div className="flex items-center gap-1">
      {MOOD_FACES.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          title={m.label}
          className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
            value === m.value
              ? "bg-blade-accent/15 ring-2 ring-blade-accent/40 scale-110"
              : "bg-blade-surface hover:bg-blade-surface/80 opacity-50 hover:opacity-80"
          }`}
        >
          {m.emoji}
        </button>
      ))}
    </div>
  );
}

function EnergySlider({ value, onChange }: { value: number; onChange: (v: 1 | 2 | 3 | 4 | 5) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {ENERGY_LEVELS.map((e) => (
        <button
          key={e.value}
          onClick={() => onChange(e.value)}
          title={e.label}
          className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-all ${
            value >= e.value
              ? "bg-blade-accent/15 text-blade-accent"
              : "bg-blade-surface text-blade-muted/40 hover:text-blade-muted/60"
          }`}
        >
          <div className="flex items-end gap-px h-4">
            <div className={`w-1 rounded-sm transition-all ${value >= e.value ? "bg-blade-accent" : "bg-current"}`} style={{ height: `${e.value * 20}%` }} />
            <div className={`w-1 rounded-sm transition-all ${value >= e.value ? "bg-blade-accent/60" : "bg-current/30"}`} style={{ height: `${Math.max(20, e.value * 15)}%` }} />
          </div>
          <span className="text-2xs">{e.value}</span>
        </button>
      ))}
    </div>
  );
}

function HabitChecklist({ habits, date, onToggle }: { habits: Habit[]; date: string; onToggle: (habitId: string) => void }) {
  return (
    <div className="space-y-1">
      {habits.map((h) => {
        const done = h.completedDates.includes(date);
        return (
          <button
            key={h.id}
            onClick={() => onToggle(h.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
              done ? "bg-blade-accent/10" : "bg-blade-surface hover:bg-blade-surface/80"
            }`}
          >
            <span className="text-lg">{h.icon}</span>
            <span className={`text-sm flex-1 text-left ${done ? "text-blade-accent font-medium" : "text-blade-primary"}`}>
              {h.name}
            </span>
            {h.streak > 0 && (
              <span className="text-2xs text-blade-muted bg-blade-bg px-1.5 py-0.5 rounded-full">
                {h.streak}d streak
              </span>
            )}
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
              done ? "border-blade-accent bg-blade-accent text-white" : "border-blade-border"
            }`}>
              {done && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AddHabitForm({ onAdd, onCancel }: { onAdd: (h: { name: string; icon: string; color: string; frequency: "daily" | "weekday" | "weekly" }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("\u{2B50}");
  const [color, setColor] = useState("#3b82f6");
  const [frequency, setFrequency] = useState<"daily" | "weekday" | "weekly">("daily");

  const PRESET_ICONS = ["\u{2B50}", "\u{1F4AA}", "\u{1F3AF}", "\u{1F525}", "\u{1F331}", "\u{1F4DD}", "\u{1F6B6}", "\u{1F4A7}", "\u{1F3B5}", "\u{1F34E}"];
  const PRESET_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

  return (
    <div className="bg-blade-surface border border-blade-border rounded-xl p-3 space-y-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Habit name..."
        className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40"
        autoFocus
      />
      <div>
        <div className="text-2xs text-blade-muted uppercase tracking-wider mb-1.5">Icon</div>
        <div className="flex gap-1 flex-wrap">
          {PRESET_ICONS.map((e) => (
            <button
              key={e}
              onClick={() => setIcon(e)}
              className={`w-8 h-8 rounded-lg text-base flex items-center justify-center ${icon === e ? "bg-blade-accent/15 ring-1 ring-blade-accent/40" : "bg-blade-bg hover:bg-blade-bg/80"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="text-2xs text-blade-muted uppercase tracking-wider mb-1.5">Color</div>
        <div className="flex gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-white/20" : "hover:scale-110"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="text-2xs text-blade-muted uppercase tracking-wider mb-1.5">Frequency</div>
        <div className="flex gap-1.5">
          {(["daily", "weekday", "weekly"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFrequency(f)}
              className={`px-3 py-1.5 rounded-lg text-xs capitalize transition-colors ${
                frequency === f ? "bg-blade-accent/15 text-blade-accent" : "bg-blade-bg text-blade-muted hover:text-blade-secondary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => name.trim() && onAdd({ name: name.trim(), icon, color, frequency })}
          disabled={!name.trim()}
          className="flex-1 py-2 rounded-lg text-sm font-medium bg-blade-accent text-white hover:bg-blade-accent/90 disabled:opacity-40 transition-colors"
        >
          Add Habit
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-blade-muted hover:text-blade-secondary bg-blade-bg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StatsSidebar({ stats, expanded, onToggle }: { stats: DailyStats; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-t border-blade-border">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-blade-secondary hover:text-blade-primary transition-colors">
        <span className="font-medium">Stats (30 days)</span>
        <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blade-bg rounded-xl px-3 py-2">
              <div className="text-2xs text-blade-muted uppercase tracking-wider">Avg Mood</div>
              <div className="text-lg font-semibold mt-0.5">{stats.averageMood || "--"}<span className="text-xs text-blade-muted">/5</span></div>
            </div>
            <div className="bg-blade-bg rounded-xl px-3 py-2">
              <div className="text-2xs text-blade-muted uppercase tracking-wider">Avg Energy</div>
              <div className="text-lg font-semibold mt-0.5">{stats.averageEnergy || "--"}<span className="text-xs text-blade-muted">/5</span></div>
            </div>
            <div className="bg-blade-bg rounded-xl px-3 py-2">
              <div className="text-2xs text-blade-muted uppercase tracking-wider">Entries</div>
              <div className="text-lg font-semibold mt-0.5">{stats.totalEntries}</div>
            </div>
            <div className="bg-blade-bg rounded-xl px-3 py-2">
              <div className="text-2xs text-blade-muted uppercase tracking-wider">Consistency</div>
              <div className="text-lg font-semibold mt-0.5">{stats.consistency}<span className="text-xs text-blade-muted">%</span></div>
            </div>
          </div>
          {stats.topHabits.length > 0 && (
            <div>
              <div className="text-2xs text-blade-muted uppercase tracking-wider mb-1.5">Habit Completion</div>
              <div className="space-y-1.5">
                {stats.topHabits.slice(0, 5).map((h) => (
                  <div key={h.name} className="flex items-center gap-2">
                    <span className="text-xs text-blade-secondary flex-1 truncate">{h.name}</span>
                    <div className="w-20 h-1.5 bg-blade-bg rounded-full overflow-hidden">
                      <div className="h-full bg-blade-accent rounded-full transition-all" style={{ width: `${h.rate}%` }} />
                    </div>
                    <span className="text-2xs text-blade-muted w-8 text-right">{h.rate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.currentStreaks.length > 0 && (
            <div>
              <div className="text-2xs text-blade-muted uppercase tracking-wider mb-1.5">Active Streaks</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.currentStreaks.map((s) => (
                  <span key={s.name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {s.name}: {s.streak}d
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeekView({ weekData, habits, selectedDate, onSelectDate }: {
  weekData: WeekDay[];
  habits: Habit[];
  selectedDate: string;
  onSelectDate: (d: string) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1">
        {weekData.map((day) => (
          <button
            key={day.date}
            onClick={() => onSelectDate(day.date)}
            className={`flex flex-col items-center gap-1 py-2 rounded-xl transition-all ${
              day.date === selectedDate
                ? "bg-blade-accent/15 ring-1 ring-blade-accent/30"
                : day.isToday
                ? "bg-blade-surface ring-1 ring-blade-border"
                : "hover:bg-blade-surface/60"
            }`}
          >
            <span className="text-2xs text-blade-muted">{DAY_LABELS[new Date(day.date + "T00:00:00").getDay() === 0 ? 6 : new Date(day.date + "T00:00:00").getDay() - 1]}</span>
            <span className={`text-sm font-medium ${day.isToday ? "text-blade-accent" : "text-blade-primary"}`}>
              {new Date(day.date + "T00:00:00").getDate()}
            </span>
            {day.entry && (
              <div className={`w-2.5 h-2.5 rounded-full ${moodColor(day.entry.mood)}`} title={`Mood: ${day.entry.mood}`} />
            )}
          </button>
        ))}
      </div>

      {/* Habit grid */}
      <div className="bg-blade-surface rounded-xl border border-blade-border p-3">
        <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Habit Completion</div>
        <div className="space-y-1.5">
          {habits.map((h) => (
            <div key={h.id} className="flex items-center gap-2">
              <span className="text-xs w-20 truncate flex items-center gap-1">
                <span>{h.icon}</span>
                <span className="text-blade-secondary">{h.name}</span>
              </span>
              <div className="flex-1 grid grid-cols-7 gap-1">
                {weekData.map((day) => {
                  const done = day.habitCompletions[h.id];
                  return (
                    <div
                      key={day.date}
                      className={`h-5 rounded transition-colors ${
                        done ? "bg-blade-accent/30" : "bg-blade-bg"
                      }`}
                      title={`${h.name} - ${day.date}: ${done ? "Done" : "Not done"}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Highlights summary */}
      <div className="bg-blade-surface rounded-xl border border-blade-border p-3">
        <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Week Highlights</div>
        <div className="space-y-1">
          {weekData.filter((d) => d.entry && d.entry.highlights.length > 0).length === 0 && (
            <span className="text-xs text-blade-muted/50">No highlights recorded this week</span>
          )}
          {weekData.filter((d) => d.entry && d.entry.highlights.length > 0).map((day) => (
            <div key={day.date} className="flex gap-2 text-xs">
              <span className="text-blade-muted shrink-0">{formatDateShort(day.date).split(",")[0]}</span>
              <span className="text-blade-secondary">{day.entry!.highlights.join(", ")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthView({ monthData, year, month, onSelectDate, selectedDate }: {
  monthData: MonthDay[];
  year: number;
  month: number;
  onSelectDate: (d: string) => void;
  selectedDate: string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-center text-sm font-medium text-blade-primary">
        {MONTH_NAMES[month]} {year}
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-2xs text-blade-muted py-1">{d}</div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-1">
        {monthData.map((day) => (
          <button
            key={day.date}
            onClick={() => onSelectDate(day.date)}
            className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs transition-all ${
              !day.isCurrentMonth
                ? "opacity-30"
                : day.date === selectedDate
                ? "ring-1 ring-blade-accent/40 bg-blade-accent/10"
                : day.isToday
                ? "ring-1 ring-blade-border bg-blade-surface"
                : "hover:bg-blade-surface/60"
            } ${day.entry ? moodBgFaint(day.entry.mood) : ""}`}
          >
            <span className={day.isToday ? "text-blade-accent font-semibold" : "text-blade-secondary"}>
              {new Date(day.date + "T00:00:00").getDate()}
            </span>
            {day.entry && (
              <div className={`w-1.5 h-1.5 rounded-full ${moodColor(day.entry.mood)}`} />
            )}
          </button>
        ))}
      </div>

      {/* Habit heatmap */}
      <div className="bg-blade-surface rounded-xl border border-blade-border p-3">
        <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Habit Heatmap</div>
        <div className="text-xs text-blade-muted/50 mb-2">Days with more habits completed appear brighter</div>
        <div className="grid grid-cols-7 gap-1">
          {monthData.filter((d) => d.isCurrentMonth).map((day) => {
            const entry = day.entry;
            const completedCount = entry ? Object.values(entry.habits).filter(Boolean).length : 0;
            const maxOpacity = Math.min(completedCount * 0.2, 1);
            return (
              <div
                key={day.date}
                className="aspect-square rounded"
                style={{ backgroundColor: `rgba(var(--blade-accent-rgb, 59, 130, 246), ${maxOpacity || 0.05})` }}
                title={`${day.date}: ${completedCount} habits`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DailyLogPanel({ onBack, onSendToChat }: Props) {
  const {
    habits, today, updateEntry, getEntry, addHabit,
    toggleHabit, getWeekView, getMonthView, getStats, generateInsights,
  } = useDailyLog();

  const [activeTab, setActiveTab] = useState<"today" | "week" | "month">("today");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [showAddHabit, setShowAddHabit] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const currentEntry = useMemo(() => getEntry(selectedDate) ?? today, [getEntry, selectedDate, today]);
  const weekData = useMemo(() => getWeekView(selectedDate), [getWeekView, selectedDate]);
  const monthData = useMemo(() => getMonthView(viewMonth.year, viewMonth.month), [getMonthView, viewMonth]);
  const stats = useMemo(() => getStats(), [getStats]);

  const navigateDate = useCallback((dir: -1 | 0 | 1) => {
    if (dir === 0) {
      setSelectedDate(todayStr());
    } else {
      setSelectedDate((prev) => dateAdd(prev, dir));
    }
  }, []);

  const navigateMonth = useCallback((dir: -1 | 1) => {
    setViewMonth((prev) => {
      let m = prev.month + dir;
      let y = prev.year;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      return { year: y, month: m };
    });
  }, []);

  const handleInsights = useCallback(() => {
    const prompt = generateInsights();
    onSendToChat(prompt);
  }, [generateInsights, onSendToChat]);

  const TABS = [
    { key: "today" as const, label: "Today" },
    { key: "week" as const, label: "Week" },
    { key: "month" as const, label: "Month" },
  ];

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-primary">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-blade-surface text-blade-muted hover:text-blade-primary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <button onClick={() => navigateDate(-1)} className="p-1 rounded hover:bg-blade-surface text-blade-muted">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button onClick={() => navigateDate(0)} className="text-sm font-medium hover:text-blade-accent transition-colors">
              {selectedDate === todayStr() ? "Today" : formatDateShort(selectedDate)}
            </button>
            <button onClick={() => navigateDate(1)} className="p-1 rounded hover:bg-blade-surface text-blade-muted">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <div className="text-2xs text-blade-muted">{formatDateFull(selectedDate)}</div>
        </div>
        <button
          onClick={handleInsights}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          AI Insights
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-blade-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === t.key
                ? "bg-blade-accent/15 text-blade-accent"
                : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
        {activeTab === "month" && (
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => navigateMonth(-1)} className="p-1 rounded hover:bg-blade-surface text-blade-muted text-xs">&lt;</button>
            <span className="text-xs text-blade-secondary">{MONTH_NAMES[viewMonth.month].slice(0, 3)} {viewMonth.year}</span>
            <button onClick={() => navigateMonth(1)} className="p-1 rounded hover:bg-blade-surface text-blade-muted text-xs">&gt;</button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {activeTab === "today" && (
            <>
              {/* Mood */}
              <section>
                <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Mood</div>
                <MoodPicker value={currentEntry.mood} onChange={(v) => updateEntry(selectedDate, { mood: v })} />
              </section>

              {/* Energy */}
              <section>
                <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Energy Level</div>
                <EnergySlider value={currentEntry.energyLevel} onChange={(v) => updateEntry(selectedDate, { energyLevel: v })} />
              </section>

              {/* Habits */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xs text-blade-muted uppercase tracking-wider">Habits</div>
                  <button
                    onClick={() => setShowAddHabit((v) => !v)}
                    className="text-2xs text-blade-accent hover:text-blade-accent/80"
                  >
                    {showAddHabit ? "Cancel" : "+ Add"}
                  </button>
                </div>
                {showAddHabit && (
                  <div className="mb-3">
                    <AddHabitForm
                      onAdd={(h) => { addHabit(h); setShowAddHabit(false); }}
                      onCancel={() => setShowAddHabit(false)}
                    />
                  </div>
                )}
                <HabitChecklist habits={habits} date={selectedDate} onToggle={(id) => toggleHabit(selectedDate, id)} />
              </section>

              {/* Highlights */}
              <section>
                <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Highlights</div>
                <ListEditor
                  items={currentEntry.highlights}
                  onUpdate={(items) => updateEntry(selectedDate, { highlights: items })}
                  placeholder="What went well?"
                  accentClass="bg-emerald-400"
                />
              </section>

              {/* Challenges */}
              <section>
                <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Challenges</div>
                <ListEditor
                  items={currentEntry.challenges}
                  onUpdate={(items) => updateEntry(selectedDate, { challenges: items })}
                  placeholder="What was difficult?"
                  accentClass="bg-orange-400"
                />
              </section>

              {/* Gratitude */}
              <section>
                <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Gratitude</div>
                <ListEditor
                  items={currentEntry.gratitude}
                  onUpdate={(items) => updateEntry(selectedDate, { gratitude: items })}
                  placeholder="What are you grateful for?"
                  accentClass="bg-violet-400"
                />
              </section>

              {/* Notes */}
              <section>
                <div className="text-2xs text-blade-muted uppercase tracking-wider mb-2">Notes</div>
                <textarea
                  value={currentEntry.notes}
                  onChange={(e) => updateEntry(selectedDate, { notes: e.target.value })}
                  placeholder="Free-form thoughts..."
                  rows={3}
                  className="w-full bg-blade-surface border border-blade-border rounded-xl px-3 py-2.5 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40 resize-none"
                />
              </section>
            </>
          )}

          {activeTab === "week" && (
            <WeekView
              weekData={weekData}
              habits={habits}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          )}

          {activeTab === "month" && (
            <MonthView
              monthData={monthData}
              year={viewMonth.year}
              month={viewMonth.month}
              onSelectDate={(d) => { setSelectedDate(d); setActiveTab("today"); }}
              selectedDate={selectedDate}
            />
          )}
        </div>
      </div>

      {/* Stats sidebar (collapsible at bottom) */}
      <StatsSidebar stats={stats} expanded={showStats} onToggle={() => setShowStats((v) => !v)} />
    </div>
  );
}
