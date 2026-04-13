import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoalSubtask {
  id: string;
  description: string;
  status: "pending" | "done" | "retrying";
  attempts: number;
  result: string;
}

interface Goal {
  id: string;
  title: string;
  description: string;
  priority: number;
  status: "active" | "in_progress" | "blocked" | "completed";
  strategy: string;
  attempts: number;
  subtasks: GoalSubtask[];
  result: string;
  created_at: number;
  completed_at: number | null;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const p = {
  bg: "#0a0a0a",
  panel: "#10150f",
  panelAlt: "#0d120d",
  green: "#00ff41",
  amber: "#ffb000",
  red: "#ff0040",
  orange: "#ff6b00",
  yellow: "#ffe000",
  line: "rgba(0, 255, 65, 0.24)",
  dim: "rgba(0, 255, 65, 0.54)",
  muted: "rgba(164, 255, 188, 0.74)",
  glow: "rgba(0, 255, 65, 0.18)",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function priorityColor(p_num: number): string {
  if (p_num >= 10) return "#ff0040";
  if (p_num >= 7) return "#ff6b00";
  if (p_num >= 5) return "#ffe000";
  return "#00ff41";
}

function priorityLabel(p_num: number): string {
  if (p_num >= 10) return "CRITICAL";
  if (p_num >= 7) return "HIGH";
  if (p_num >= 5) return "MED";
  return "LOW";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionFrame({
  title,
  children,
  accent = p.amber,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <section
      style={{
        border: `1px solid ${p.line}`,
        background: `linear-gradient(180deg, ${p.panel} 0%, ${p.panelAlt} 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(0,255,65,0.06), 0 0 18px ${p.glow}`,
        position: "relative",
        overflow: "hidden",
        padding: "1rem",
      }}
    >
      {/* scanlines */}
      <div
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          opacity: 0.3,
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            marginBottom: "1rem",
            fontSize: "11px",
            fontWeight: "bold",
            textTransform: "uppercase",
            letterSpacing: "0.28em",
            color: accent,
          }}
        >
          {`=== ${title} ===`}
        </div>
        {children}
      </div>
    </section>
  );
}

function SubtaskRow({ subtask }: { subtask: GoalSubtask }) {
  const icon =
    subtask.status === "done" ? "▣" : subtask.status === "retrying" ? "↺" : "□";
  const color =
    subtask.status === "done" ? p.green : subtask.status === "retrying" ? p.amber : p.muted;

  return (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-start",
        padding: "0.35rem 0.5rem",
        borderBottom: `1px solid rgba(0,255,65,0.08)`,
        fontSize: "10px",
        fontFamily: "monospace",
        letterSpacing: "0.12em",
      }}
    >
      <span style={{ color, flexShrink: 0, marginTop: "1px" }}>{icon}</span>
      <span style={{ color: p.muted, flex: 1, lineHeight: 1.5 }}>{subtask.description}</span>
      {subtask.attempts > 0 && (
        <span style={{ color: p.dim, flexShrink: 0 }}>x{subtask.attempts}</span>
      )}
      {subtask.status === "done" && subtask.result && (
        <span
          style={{
            color: p.dim,
            maxWidth: "10rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title={subtask.result}
        >
          {subtask.result}
        </span>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  onDelete,
  onComplete,
  onPursue,
  onPriorityChange: _onPriorityChange,
  currentSubtask,
  fanfare,
}: {
  goal: Goal;
  onDelete: (id: string) => void;
  onComplete: (id: string) => void;
  onPursue: (id: string) => void;
  onPriorityChange?: (id: string, p: number) => void;
  currentSubtask: string | null;
  fanfare: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const doneSubtasks = goal.subtasks.filter((s) => s.status === "done").length;
  const totalSubtasks = goal.subtasks.length;
  const progress = totalSubtasks > 0 ? doneSubtasks / totalSubtasks : 0;

  const statusColor =
    goal.status === "in_progress"
      ? p.green
      : goal.status === "blocked"
      ? p.red
      : goal.status === "completed"
      ? p.amber
      : p.dim;

  const statusPulse =
    goal.status === "in_progress" || goal.status === "blocked";

  const pColor = priorityColor(goal.priority);

  const cardBorder = fanfare
    ? p.amber
    : goal.status === "in_progress"
    ? `rgba(0,255,65,0.5)`
    : p.line;

  const handleBtn = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${cardBorder}`,
        background: fanfare
          ? `linear-gradient(180deg, rgba(255,176,0,0.06) 0%, ${p.panel} 100%)`
          : p.panel,
        boxShadow: fanfare
          ? `0 0 24px rgba(255,176,0,0.25), inset 0 0 0 1px rgba(255,176,0,0.1)`
          : goal.status === "in_progress"
          ? `0 0 14px rgba(0,255,65,0.12)`
          : "none",
        transition: "border-color 0.3s, box-shadow 0.3s",
        marginBottom: "0.5rem",
      }}
    >
      {/* Card header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          padding: "0.75rem 0.75rem 0.5rem",
        }}
      >
        {/* Priority badge */}
        <div
          style={{
            flexShrink: 0,
            border: `1px solid ${pColor}`,
            color: pColor,
            fontSize: "9px",
            fontWeight: "bold",
            letterSpacing: "0.18em",
            padding: "2px 6px",
            backgroundColor: `${pColor}14`,
            boxShadow: `0 0 8px ${pColor}22`,
            marginTop: "2px",
          }}
        >
          P{goal.priority} {priorityLabel(goal.priority)}
        </div>

        {/* Title + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: "bold",
              color: "#d5ffd8",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              lineHeight: 1.3,
            }}
          >
            {goal.title}
          </div>
          {goal.description && (
            <div
              style={{
                fontSize: "10px",
                color: p.dim,
                marginTop: "3px",
                letterSpacing: "0.1em",
                lineHeight: 1.5,
              }}
            >
              {goal.description}
            </div>
          )}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              marginTop: "5px",
              fontSize: "9px",
              letterSpacing: "0.16em",
              color: p.muted,
              textTransform: "uppercase",
            }}
          >
            <span>Created {relTime(goal.created_at)}</span>
            {goal.attempts > 0 && <span>Attempts: {goal.attempts}</span>}
            {goal.completed_at && <span>Done {relTime(goal.completed_at)}</span>}
          </div>
        </div>

        {/* Status badge */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: `1px solid ${statusColor}`,
            color: statusColor,
            fontSize: "9px",
            fontWeight: "bold",
            letterSpacing: "0.18em",
            padding: "3px 7px",
            backgroundColor: `${statusColor}12`,
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              display: "block",
              width: "6px",
              height: "6px",
              backgroundColor: statusColor,
              flexShrink: 0,
              animation: statusPulse
                ? "goal-blink 1.2s steps(2, end) infinite"
                : undefined,
              boxShadow: `0 0 8px ${statusColor}88`,
            }}
          />
          {goal.status === "in_progress" ? "IN PROG" : goal.status.toUpperCase()}
        </div>
      </div>

      {/* Progress bar */}
      {totalSubtasks > 0 && (
        <div style={{ padding: "0 0.75rem", marginBottom: "0.5rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "9px",
              color: p.dim,
              letterSpacing: "0.14em",
              marginBottom: "4px",
              textTransform: "uppercase",
            }}
          >
            <span>Subtasks</span>
            <span>
              {doneSubtasks}/{totalSubtasks}
            </span>
          </div>
          <div
            style={{
              height: "4px",
              background: "rgba(0,255,65,0.1)",
              border: `1px solid ${p.line}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                background: progress === 1 ? p.amber : p.green,
                boxShadow: `0 0 8px ${progress === 1 ? p.amber : p.green}66`,
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* Current subtask status */}
      {currentSubtask && goal.status === "in_progress" && (
        <div
          style={{
            margin: "0 0.75rem 0.5rem",
            padding: "4px 8px",
            border: `1px solid rgba(0,255,65,0.2)`,
            backgroundColor: "rgba(0,255,65,0.04)",
            fontSize: "9px",
            color: p.green,
            letterSpacing: "0.12em",
            fontFamily: "monospace",
          }}
        >
          ▶ {currentSubtask}
        </div>
      )}

      {/* Fanfare */}
      {fanfare && (
        <div
          style={{
            margin: "0 0.75rem 0.5rem",
            padding: "6px 10px",
            border: `1px solid rgba(255,176,0,0.4)`,
            backgroundColor: "rgba(255,176,0,0.08)",
            fontSize: "10px",
            color: p.amber,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: "bold",
            textAlign: "center",
          }}
        >
          ★ GOAL COMPLETED — BLADE DELIVERED ★
        </div>
      )}

      {/* Expandable subtasks */}
      {totalSubtasks > 0 && (
        <div style={{ padding: "0 0.75rem 0.5rem" }}>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              background: "none",
              border: "none",
              color: p.dim,
              fontSize: "9px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              cursor: "pointer",
              padding: "2px 0",
            }}
          >
            {expanded ? "▼ Hide subtasks" : `▶ Show ${totalSubtasks} subtasks`}
          </button>
          {expanded && (
            <div
              style={{
                marginTop: "6px",
                border: `1px solid ${p.line}`,
                backgroundColor: "rgba(0,0,0,0.3)",
              }}
            >
              {goal.subtasks.map((st) => (
                <SubtaskRow key={st.id} subtask={st} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Strategy */}
      {goal.strategy && expanded && (
        <div
          style={{
            margin: "0 0.75rem 0.5rem",
            fontSize: "9px",
            color: p.dim,
            letterSpacing: "0.1em",
            lineHeight: 1.5,
            borderTop: `1px solid rgba(0,255,65,0.1)`,
            paddingTop: "6px",
          }}
        >
          <span style={{ color: p.amber }}>STRATEGY: </span>
          {goal.strategy}
        </div>
      )}

      {/* Action buttons */}
      {goal.status !== "completed" && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem 0.75rem",
            borderTop: `1px solid rgba(0,255,65,0.1)`,
          }}
        >
          <button
            disabled={busy}
            onClick={() => handleBtn(async () => { onPursue(goal.id); })}
            style={{
              border: `1px solid ${p.green}`,
              color: p.green,
              background: "rgba(0,255,65,0.06)",
              fontSize: "9px",
              fontWeight: "bold",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "4px 10px",
              cursor: "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Pursue Now
          </button>
          <button
            disabled={busy}
            onClick={() => handleBtn(async () => { onComplete(goal.id); })}
            style={{
              border: `1px solid ${p.amber}`,
              color: p.amber,
              background: "rgba(255,176,0,0.06)",
              fontSize: "9px",
              fontWeight: "bold",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "4px 10px",
              cursor: "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Complete
          </button>
          <div style={{ flex: 1 }} />
          <button
            disabled={busy}
            onClick={() => handleBtn(async () => { onDelete(goal.id); })}
            style={{
              border: `1px solid rgba(255,0,64,0.4)`,
              color: "rgba(255,0,64,0.7)",
              background: "none",
              fontSize: "9px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "4px 8px",
              cursor: "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GoalView({ onBack }: { onBack: () => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineRunning, setEngineRunning] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [fanfareIds, setFanfareIds] = useState<Set<string>>(new Set());
  const [currentSubtasks, setCurrentSubtasks] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // New goal form
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPriority, setFormPriority] = useState(5);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const unsubscribers = useRef<(() => void)[]>([]);

  // ── Data loading ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const list = await invoke<Goal[]>("goal_list");
      setGoals(list);
      setEngineRunning(list.some((g) => g.status === "in_progress"));
    } catch (e) {
      console.error("[GoalView] load:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  // ── Tauri event listeners ─────────────────────────────────────────────────

  useEffect(() => {
    const setup = async () => {
      const unsub1 = await listen<{ goal: Goal }>("goal_progress", (ev) => {
        setGoals((prev) =>
          prev.map((g) => (g.id === ev.payload.goal.id ? ev.payload.goal : g))
        );
        setEngineRunning(true);
        setStatusMsg(`Pursuing: ${ev.payload.goal.title}`);
      });

      const unsub2 = await listen<{ goal: Goal }>("goal_completed", (ev) => {
        setGoals((prev) =>
          prev.map((g) => (g.id === ev.payload.goal.id ? { ...ev.payload.goal, status: "completed" } : g))
        );
        setFanfareIds((prev) => new Set(prev).add(ev.payload.goal.id));
        setStatusMsg(`Goal completed: ${ev.payload.goal.title}`);
        setTimeout(() => {
          setFanfareIds((prev) => {
            const n = new Set(prev);
            n.delete(ev.payload.goal.id);
            return n;
          });
        }, 8000);
      });

      const unsub3 = await listen<{ goal_id: string; subtask: string }>(
        "goal_subtask_update",
        (ev) => {
          setCurrentSubtasks((prev) => ({
            ...prev,
            [ev.payload.goal_id]: ev.payload.subtask,
          }));
          setStatusMsg(`Working on: ${ev.payload.subtask}`);
        }
      );

      unsubscribers.current = [unsub1, unsub2, unsub3];
    };

    setup();
    return () => {
      unsubscribers.current.forEach((fn) => fn());
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!formTitle.trim()) {
      setFormError("Title required.");
      return;
    }
    setFormBusy(true);
    setFormError(null);
    try {
      await invoke("goal_add", {
        title: formTitle.trim(),
        description: formDesc.trim(),
        priority: formPriority,
        tags: [],
      });
      setFormTitle("");
      setFormDesc("");
      setFormPriority(5);
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(String(e));
    } finally {
      setFormBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    await invoke("goal_delete", { id });
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleComplete = async (id: string) => {
    await invoke("goal_complete", { id });
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: "completed" as const } : g))
    );
  };

  const handlePursue = async (id: string) => {
    await invoke("goal_pursue_now", { id });
    setEngineRunning(true);
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: "in_progress" as const } : g))
    );
  };

  const handlePriority = async (id: string, priority: number) => {
    await invoke("goal_update_priority", { id, priority });
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, priority } : g)));
  };

  // ── Derived lists ─────────────────────────────────────────────────────────

  const activeGoals = goals
    .filter((g) => g.status !== "completed")
    .sort((a, b) => b.priority - a.priority);

  const completedGoals = goals
    .filter((g) => g.status === "completed")
    .sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          fontFamily: "monospace",
          fontSize: "12px",
          textTransform: "uppercase",
          letterSpacing: "0.3em",
          color: p.green,
          backgroundColor: p.bg,
          textShadow: `0 0 10px ${p.green}88`,
        }}
      >
        Initializing goal engine...
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontFamily: "monospace",
        background:
          "radial-gradient(circle at top, rgba(0,255,65,0.08) 0%, rgba(0,255,65,0.02) 18%, #0a0a0a 55%), #0a0a0a",
        color: p.green,
        position: "relative",
      }}
    >
      <style>{`
        @keyframes goal-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.3; }
        }
        @keyframes goal-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(0,255,65,0.4); }
          50% { box-shadow: 0 0 20px rgba(0,255,65,0.8); }
        }
        @keyframes goal-flicker {
          0%, 100% { opacity: 0.18; }
          50% { opacity: 0.24; }
        }
        @keyframes goal-fanfare {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>

      {/* CRT overlay */}
      <div
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 4px)",
          animation: "goal-flicker 4s linear infinite",
          zIndex: 0,
        }}
      />

      {/* ── Header ── */}
      <header
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          borderBottom: `1px solid ${p.line}`,
          backgroundColor: "rgba(10,16,10,0.92)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            border: `1px solid ${p.line}`,
            color: p.amber,
            background: "none",
            padding: "4px 12px",
            fontSize: "11px",
            fontWeight: "bold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          &lt; Back
        </button>

        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: "bold",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "#d5ffd8",
            }}
          >
            GOAL ENGINE
          </div>
          <div
            style={{
              marginTop: "2px",
              fontSize: "10px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: p.dim,
            }}
          >
            Autonomous goal pursuit — BLADE never gives up
          </div>
        </div>

        {/* Engine running indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: `1px solid ${engineRunning ? p.green : p.line}`,
            backgroundColor: engineRunning ? "rgba(0,255,65,0.08)" : "rgba(0,0,0,0.2)",
            padding: "4px 12px",
            fontSize: "10px",
            fontWeight: "bold",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: engineRunning ? p.green : p.muted,
          }}
        >
          <span
            style={{
              display: "block",
              width: "8px",
              height: "8px",
              backgroundColor: engineRunning ? p.green : "rgba(0,255,65,0.2)",
              animation: engineRunning ? "goal-blink 1s steps(2, end) infinite" : undefined,
              boxShadow: engineRunning ? `0 0 10px ${p.green}` : "none",
            }}
          />
          {engineRunning ? "Engine Running" : "Idle"}
        </div>

        <button
          onClick={() => setShowForm((s) => !s)}
          style={{
            border: `1px solid ${p.green}`,
            color: p.green,
            background: showForm ? "rgba(0,255,65,0.12)" : "rgba(0,255,65,0.05)",
            padding: "4px 14px",
            fontSize: "11px",
            fontWeight: "bold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          {showForm ? "Cancel" : "+ New Goal"}
        </button>
      </header>

      {/* ── Status message bar ── */}
      {statusMsg && (
        <div
          style={{
            position: "relative",
            zIndex: 10,
            padding: "5px 1rem",
            fontSize: "10px",
            letterSpacing: "0.14em",
            color: p.green,
            borderBottom: `1px solid rgba(0,255,65,0.12)`,
            backgroundColor: "rgba(0,255,65,0.04)",
            flexShrink: 0,
            fontFamily: "monospace",
          }}
        >
          ▶ {statusMsg}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          overflowY: "auto",
          padding: "0.75rem 1rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {/* New goal form */}
        {showForm && (
          <SectionFrame title="NEW GOAL" accent={p.green}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "9px",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: p.amber,
                    marginBottom: "5px",
                  }}
                >
                  Title
                </label>
                <input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="What do you want BLADE to achieve?"
                  style={{
                    width: "100%",
                    background: "rgba(0,0,0,0.4)",
                    border: `1px solid ${p.line}`,
                    color: "#d5ffd8",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    padding: "8px 10px",
                    outline: "none",
                    letterSpacing: "0.06em",
                    boxSizing: "border-box",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAdd()}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "9px",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: p.amber,
                    marginBottom: "5px",
                  }}
                >
                  Description (optional)
                </label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Any extra context, constraints, or desired outcome..."
                  rows={3}
                  style={{
                    width: "100%",
                    background: "rgba(0,0,0,0.4)",
                    border: `1px solid ${p.line}`,
                    color: "#d5ffd8",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    padding: "8px 10px",
                    outline: "none",
                    resize: "vertical",
                    letterSpacing: "0.06em",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "9px",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: p.amber,
                    marginBottom: "8px",
                  }}
                >
                  <span>Priority</span>
                  <span style={{ color: priorityColor(formPriority) }}>
                    {formPriority} — {priorityLabel(formPriority)}
                  </span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={formPriority}
                  onChange={(e) => setFormPriority(Number(e.target.value))}
                  style={{
                    width: "100%",
                    accentColor: priorityColor(formPriority),
                    cursor: "pointer",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "8px",
                    color: p.dim,
                    letterSpacing: "0.14em",
                    marginTop: "3px",
                  }}
                >
                  <span>1 LOW</span>
                  <span>5 MED</span>
                  <span>10 CRITICAL</span>
                </div>
              </div>

              {formError && (
                <div
                  style={{
                    fontSize: "10px",
                    color: p.red,
                    letterSpacing: "0.14em",
                    border: `1px solid rgba(255,0,64,0.3)`,
                    padding: "5px 8px",
                    backgroundColor: "rgba(255,0,64,0.05)",
                  }}
                >
                  {formError}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={handleAdd}
                  disabled={formBusy || !formTitle.trim()}
                  style={{
                    border: `1px solid ${p.green}`,
                    color: p.green,
                    background: "rgba(0,255,65,0.08)",
                    fontSize: "11px",
                    fontWeight: "bold",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    padding: "8px 20px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    opacity: formBusy || !formTitle.trim() ? 0.5 : 1,
                  }}
                >
                  {formBusy ? "Adding..." : "Add Goal"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setFormError(null); }}
                  style={{
                    border: `1px solid ${p.line}`,
                    color: p.muted,
                    background: "none",
                    fontSize: "11px",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontFamily: "monospace",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </SectionFrame>
        )}

        {/* Active goals */}
        {activeGoals.length === 0 && !showForm ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "16rem",
              gap: "1rem",
              border: `1px solid ${p.line}`,
              backgroundColor: "rgba(0,255,65,0.02)",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.28em",
                color: p.dim,
                textAlign: "center",
                maxWidth: "28rem",
                lineHeight: 2,
              }}
            >
              No goals set.
              <br />
              BLADE will pursue any goal you give it — relentlessly.
            </div>
            <button
              onClick={() => setShowForm(true)}
              style={{
                border: `1px solid ${p.green}`,
                color: p.green,
                background: "rgba(0,255,65,0.06)",
                fontSize: "11px",
                fontWeight: "bold",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                padding: "8px 20px",
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              + Set First Goal
            </button>
          </div>
        ) : activeGoals.length > 0 ? (
          <SectionFrame title={`ACTIVE GOALS [${activeGoals.length}]`}>
            {activeGoals.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                onDelete={handleDelete}
                onComplete={handleComplete}
                onPursue={handlePursue}
                onPriorityChange={handlePriority}
                currentSubtask={currentSubtasks[g.id] ?? null}
                fanfare={fanfareIds.has(g.id)}
              />
            ))}
          </SectionFrame>
        ) : null}

        {/* Completed goals */}
        {completedGoals.length > 0 && (
          <div>
            <button
              onClick={() => setShowCompleted((s) => !s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "none",
                border: "none",
                color: p.dim,
                fontSize: "10px",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                cursor: "pointer",
                padding: "6px 0",
                fontFamily: "monospace",
                width: "100%",
              }}
            >
              <span>{showCompleted ? "▼" : "▶"}</span>
              <span>
                Completed Goals [{completedGoals.length}]
              </span>
            </button>
            {showCompleted && (
              <div style={{ marginTop: "0.5rem" }}>
                <SectionFrame title={`COMPLETED [${completedGoals.length}]`} accent={p.amber}>
                  {completedGoals.map((g) => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      onDelete={handleDelete}
                      onComplete={handleComplete}
                      onPursue={handlePursue}
                      onPriorityChange={handlePriority}
                      currentSubtask={null}
                      fanfare={false}
                    />
                  ))}
                </SectionFrame>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flexShrink: 0,
          borderTop: `1px solid ${p.line}`,
          padding: "6px 1rem",
          display: "flex",
          justifyContent: "center",
          backgroundColor: "rgba(10,16,10,0.85)",
        }}
      >
        <div
          style={{
            fontSize: "9px",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: p.dim,
          }}
        >
          BLADE never gives up. Every goal finds a way.
        </div>
      </div>
    </div>
  );
}
