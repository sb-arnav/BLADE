import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  title: string;
  status: string;
  progress?: number; // 0–100
}

interface CausalInsight {
  id: string;
  summary: string;
  severity?: string;
}

interface KnowledgeGap {
  id: string;
  topic: string;
  status: string;
}

interface WorldSummary {
  description: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const filled = Math.round((pct / 100) * 5);
  return (
    <span style={{ fontFamily: "monospace", color: "#39ff14", letterSpacing: "1px" }}>
      {"["}
      {"⬛".repeat(filled)}
      {"⬜".repeat(5 - filled)}
      {"]"}
    </span>
  );
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: "8px",
        left: "8px",
        right: "8px",
        background: "#1a1a1a",
        border: "1px solid #39ff14",
        borderRadius: "4px",
        padding: "6px 8px",
        fontSize: "10px",
        color: "#39ff14",
        zIndex: 10,
        wordBreak: "break-word",
      }}
    >
      {message}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function InsightsBar({ onNavigate }: { onNavigate: (route: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [insights, setInsights] = useState<CausalInsight[]>([]);
  const [dreamActive, setDreamActive] = useState(false);
  const [dreamLabel, setDreamLabel] = useState("consolidating memory...");
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [world, setWorld] = useState<WorldSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [celebrateId, setCelebrateId] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const activeRef = useRef(true);

  // ── Data fetchers ────────────────────────────────────────────────────────────

  const fetchGoals = useCallback(async () => {
    try {
      const all = await invoke<Goal[]>("goal_list");
      setGoals(
        all.filter((g) => g.status === "in_progress" || g.status === "active")
      );
    } catch {
      // backend may not have this command yet — degrade silently
    }
  }, []);

  const fetchInsights = useCallback(async () => {
    try {
      const data = await invoke<CausalInsight[]>("causal_get_insights", { limit: 3 });
      setInsights(data);
    } catch {
      // degrade silently
    }
  }, []);

  const fetchDream = useCallback(async () => {
    try {
      const active = await invoke<boolean>("dream_is_active");
      if (activeRef.current) setDreamActive(active);
    } catch {
      // degrade silently
    }
  }, []);

  const fetchGaps = useCallback(async () => {
    try {
      const all = await invoke<KnowledgeGap[]>("research_list_gaps");
      setGaps(all.filter((g) => g.status === "pending"));
    } catch {
      // degrade silently
    }
  }, []);

  const fetchWorld = useCallback(async () => {
    try {
      const summary = await invoke<WorldSummary>("world_get_summary");
      if (activeRef.current) setWorld(summary);
    } catch {
      // degrade silently
    }
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    activeRef.current = true;
    fetchGoals();
    fetchInsights();
    fetchDream();
    fetchGaps();
    fetchWorld();
    return () => { activeRef.current = false; };
  }, [fetchGoals, fetchInsights, fetchDream, fetchGaps, fetchWorld]);

  // ── Event listeners ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unlistenGoalProgress = listen("goal_progress", () => {
      fetchGoals();
    });

    const unlistenGoalCompleted = listen<{ id: string }>("goal_completed", (e) => {
      fetchGoals();
      setCelebrateId(e.payload.id);
      setTimeout(() => setCelebrateId(null), 2500);
    });

    const unlistenDreamStart = listen<{ label?: string }>("dream_mode_start", (e) => {
      setDreamActive(true);
      if (e.payload?.label) setDreamLabel(e.payload.label);
    });

    const unlistenDreamEnd = listen("dream_mode_end", () => {
      setDreamActive(false);
      setDreamLabel("consolidating memory...");
    });

    const unlistenLearned = listen<{ topic: string }>("blade_learned", (e) => {
      setToast(`Learned: ${e.payload.topic}`);
    });

    const unlistenInsights = listen("causal_insights", () => {
      fetchInsights();
    });

    const unlistenWorld = listen("world_state_updated", () => {
      fetchWorld();
    });

    return () => {
      unlistenGoalProgress.then((fn) => fn());
      unlistenGoalCompleted.then((fn) => fn());
      unlistenDreamStart.then((fn) => fn());
      unlistenDreamEnd.then((fn) => fn());
      unlistenLearned.then((fn) => fn());
      unlistenInsights.then((fn) => fn());
      unlistenWorld.then((fn) => fn());
    };
  }, [fetchGoals, fetchInsights, fetchWorld]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const root: React.CSSProperties = {
    position: "relative",
    width: "220px",
    minWidth: "220px",
    height: "100%",
    background: "#0d0d0d",
    borderLeft: "1px solid #222",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: "11px",
    color: "#ccc",
    overflowY: "auto",
    flexShrink: 0,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px 6px",
    borderBottom: "1px solid #222",
    color: "#39ff14",
    letterSpacing: "0.1em",
    fontSize: "10px",
    fontWeight: "bold",
    flexShrink: 0,
  };

  const sectionStyle: React.CSSProperties = {
    padding: "8px 10px 4px",
    borderBottom: "1px solid #1a1a1a",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "#666",
    letterSpacing: "0.08em",
    marginBottom: "4px",
  };

  const linkBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    color: "#555",
    fontSize: "10px",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.05em",
    marginTop: "4px",
    display: "block",
  };

  const goalRowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    marginBottom: "4px",
  };

  return (
    <div style={root}>
      {/* Header */}
      <div style={headerStyle}>
        <span>BLADE INTEL</span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{ background: "none", border: "none", color: "#39ff14", cursor: "pointer", fontSize: "12px", padding: 0 }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▶" : "▼"}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Goals */}
          <div style={sectionStyle}>
            <div style={labelStyle}>🎯 GOALS {goals.length > 0 && `(${goals.length} active)`}</div>
            {goals.length === 0 && (
              <div style={{ color: "#444", fontSize: "10px" }}>No active goals</div>
            )}
            {goals.map((g) => {
              const pct = g.progress ?? 0;
              const isCelebrating = celebrateId === g.id;
              return (
                <div key={g.id} style={goalRowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ color: isCelebrating ? "#ffb347" : "#39ff14", fontSize: "8px" }}>
                      {isCelebrating ? "★" : "●"}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: isCelebrating ? "#ffb347" : "#ccc",
                      }}
                      title={g.title}
                    >
                      {g.title}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", paddingLeft: "12px" }}>
                    <ProgressBar pct={pct} />
                    <span style={{ color: "#555", fontSize: "10px" }}>{pct}%</span>
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => onNavigate("goals")}
              style={{ ...linkBtn, color: "#39ff14", marginTop: "4px" }}
            >
              + New Goal
            </button>
          </div>

          {/* Insights */}
          <div style={sectionStyle}>
            <div style={labelStyle}>💡 INSIGHTS</div>
            {insights.length === 0 && (
              <div style={{ color: "#444", fontSize: "10px" }}>None yet</div>
            )}
            {insights.map((ins) => (
              <div key={ins.id} style={{ marginBottom: "4px" }}>
                <span style={{ color: "#ffb347", fontSize: "10px" }}>⚡ </span>
                <span style={{ color: "#aaa", fontSize: "10px", lineHeight: "1.4" }}>{ins.summary}</span>
              </div>
            ))}
            {insights.length > 0 && (
              <button style={linkBtn} onClick={() => onNavigate("knowledge")}>
                [See all]
              </button>
            )}
          </div>

          {/* Learning / Gaps */}
          <div style={sectionStyle}>
            <div style={labelStyle}>🧠 LEARNING</div>
            {dreamActive && (
              <div style={{ color: "#aaa", fontSize: "10px", marginBottom: "2px" }}>
                Researching: {dreamLabel}
              </div>
            )}
            <div style={{ color: "#555", fontSize: "10px" }}>
              Gaps:{" "}
              <span style={{ color: gaps.length > 0 ? "#ffb347" : "#555" }}>
                {gaps.length} pending
              </span>
            </div>
          </div>

          {/* Dream / Status */}
          <div style={sectionStyle}>
            {dreamActive ? (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ color: "#555", fontSize: "10px" }}>💤</span>
                <span style={{ color: "#aaa", fontSize: "10px" }}>
                  Dream Mode: Active ({dreamLabel})
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: "#39ff14",
                    display: "inline-block",
                    boxShadow: "0 0 5px #39ff14",
                  }}
                />
                <span style={{ color: "#39ff14", fontSize: "10px" }}>BLADE Active</span>
              </div>
            )}
          </div>

          {/* World */}
          <div style={{ ...sectionStyle, borderBottom: "none" }}>
            <div style={labelStyle}>🌍 WORLD</div>
            {world ? (
              <div style={{ color: "#aaa", fontSize: "10px", lineHeight: "1.5", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {world.description}
              </div>
            ) : (
              <div style={{ color: "#444", fontSize: "10px" }}>No world state</div>
            )}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={dismissToast} />}
    </div>
  );
}
