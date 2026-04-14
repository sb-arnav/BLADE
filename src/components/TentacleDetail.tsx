// src/components/TentacleDetail.tsx
// Slide-out panel for inspecting a single tentacle's status, history, and config.

import { useState, useEffect, useRef } from "react";

export interface TentacleNode {
  id: string;
  platform: string;
  icon: string;
  status: "online" | "degraded" | "offline" | "dormant";
  uptime: number; // seconds
  messageCount: number;
  actionsToday: number;
  headModel: string;
  autonomyOverride?: number; // 0-100, undefined = use global
  notificationsEnabled: boolean;
  lastSeen: number; // unix seconds
  recentMessages: Array<{
    id: string;
    summary: string;
    priority: "critical" | "high" | "normal" | "low";
    timestamp: number;
  }>;
  recentActions: Array<{
    id: string;
    action: string;
    status: "done" | "failed" | "pending";
    timestamp: number;
  }>;
}

interface TentacleDetailProps {
  tentacle: TentacleNode | null;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<TentacleNode>) => void;
  onReconnect: (id: string) => void;
}

const STATUS_META = {
  online:   { color: "#22c55e", label: "Online",   glow: "rgba(34,197,94,0.3)" },
  degraded: { color: "#f59e0b", label: "Degraded", glow: "rgba(245,158,11,0.3)" },
  offline:  { color: "#ef4444", label: "Offline",  glow: "rgba(239,68,68,0.3)" },
  dormant:  { color: "#6b7280", label: "Dormant",  glow: "rgba(107,114,128,0.2)" },
};

const PRIORITY_COLORS = {
  critical: { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)", text: "#fca5a5" },
  high:     { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)", text: "#fcd34d" },
  normal:   { bg: "rgba(99,102,241,0.12)", border: "rgba(99,102,241,0.3)", text: "#a5b4fc" },
  low:      { bg: "rgba(107,114,128,0.1)", border: "rgba(107,114,128,0.2)", text: "#9ca3af" },
};

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TentacleDetail({ tentacle, onClose, onUpdate, onReconnect }: TentacleDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [autonomyVal, setAutonomyVal] = useState<number>(tentacle?.autonomyOverride ?? 50);
  const [notifs, setNotifs] = useState(tentacle?.notificationsEnabled ?? true);
  const [activeTab, setActiveTab] = useState<"messages" | "actions" | "config">("messages");

  // Sync state when tentacle changes
  useEffect(() => {
    if (tentacle) {
      setAutonomyVal(tentacle.autonomyOverride ?? 50);
      setNotifs(tentacle.notificationsEnabled);
    }
  }, [tentacle?.id]);

  // Click-outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (!tentacle) return null;

  const meta = STATUS_META[tentacle.status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
    >
      <div
        ref={panelRef}
        className="w-[400px] flex flex-col overflow-hidden animate-slide-in-right"
        style={{
          background: "linear-gradient(180deg, #0e0e12 0%, #0a0a0e 100%)",
          borderLeft: "1px solid rgba(99,102,241,0.2)",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.6), inset 1px 0 0 rgba(99,102,241,0.08)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(99,102,241,0.12)" }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.2)",
              boxShadow: `0 0 12px ${meta.glow}`,
            }}
          >
            {tentacle.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{tentacle.platform}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: meta.color,
                  boxShadow: `0 0 6px ${meta.glow}`,
                }}
              />
              <span className="text-[10px] font-medium" style={{ color: meta.color }}>
                {meta.label}
              </span>
              {tentacle.status === "online" && (
                <span className="text-[10px] text-gray-500">— up {fmtUptime(tentacle.uptime)}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Stats row */}
        <div
          className="grid grid-cols-3 gap-px shrink-0"
          style={{ background: "rgba(99,102,241,0.1)", borderBottom: "1px solid rgba(99,102,241,0.12)" }}
        >
          {[
            { label: "Head model", value: tentacle.headModel.split("/").pop()?.slice(0, 14) ?? tentacle.headModel },
            { label: "Msgs today", value: tentacle.messageCount.toLocaleString() },
            { label: "Actions today", value: tentacle.actionsToday.toLocaleString() },
          ].map((s) => (
            <div
              key={s.label}
              className="px-3 py-2.5"
              style={{ background: "#0e0e12" }}
            >
              <div className="text-[9px] uppercase tracking-widest text-gray-600 mb-0.5">{s.label}</div>
              <div className="text-xs font-semibold text-gray-200 truncate">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Last seen */}
        <div
          className="flex items-center justify-between px-4 py-2 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
        >
          <span className="text-[10px] text-gray-600">Last message</span>
          <span className="text-[10px] text-gray-400">{relTime(tentacle.lastSeen)}</span>
        </div>

        {/* Tabs */}
        <div
          className="flex shrink-0"
          style={{ borderBottom: "1px solid rgba(99,102,241,0.12)" }}
        >
          {(["messages", "actions", "config"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-2 text-[10px] uppercase tracking-widest font-medium transition-colors"
              style={{
                color: activeTab === tab ? "#818cf8" : "#4b5563",
                borderBottom: activeTab === tab ? "1px solid #818cf8" : "1px solid transparent",
                background: activeTab === tab ? "rgba(99,102,241,0.06)" : "transparent",
                marginBottom: -1,
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto min-h-0 py-3 px-4">
          {activeTab === "messages" && (
            <div className="space-y-2">
              {tentacle.recentMessages.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center py-6">No recent messages</p>
              ) : (
                tentacle.recentMessages.map((msg) => {
                  const pc = PRIORITY_COLORS[msg.priority];
                  return (
                    <div
                      key={msg.id}
                      className="rounded-lg p-2.5"
                      style={{ background: pc.bg, border: `1px solid ${pc.border}` }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span
                          className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
                          style={{ color: pc.text, background: "rgba(0,0,0,0.3)" }}
                        >
                          {msg.priority}
                        </span>
                        <span className="text-[9px] text-gray-600">{relTime(msg.timestamp)}</span>
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed">{msg.summary}</p>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === "actions" && (
            <div className="space-y-2">
              {tentacle.recentActions.length === 0 ? (
                <p className="text-[11px] text-gray-600 text-center py-6">No recent actions</p>
              ) : (
                tentacle.recentActions.map((act) => (
                  <div
                    key={act.id}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                      style={{
                        background:
                          act.status === "done" ? "#22c55e"
                          : act.status === "failed" ? "#ef4444"
                          : "#f59e0b",
                        boxShadow: `0 0 5px ${
                          act.status === "done" ? "rgba(34,197,94,0.4)"
                          : act.status === "failed" ? "rgba(239,68,68,0.4)"
                          : "rgba(245,158,11,0.4)"
                        }`,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-gray-300 leading-snug">{act.action}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span
                          className="text-[9px] uppercase font-medium"
                          style={{
                            color:
                              act.status === "done" ? "#4ade80"
                              : act.status === "failed" ? "#f87171"
                              : "#fbbf24",
                          }}
                        >
                          {act.status}
                        </span>
                        <span className="text-[9px] text-gray-600">{relTime(act.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "config" && (
            <div className="space-y-5">
              {/* Autonomy override */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-gray-300">Autonomy override</span>
                  <span className="text-[11px] font-mono text-indigo-400">{autonomyVal}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={autonomyVal}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setAutonomyVal(v);
                    onUpdate(tentacle.id, { autonomyOverride: v });
                  }}
                  className="w-full accent-indigo-500"
                />
                <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
                  <span>Ask always</span>
                  <span>Full auto</span>
                </div>
              </div>

              {/* Notifications */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium text-gray-300">Notifications</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">Surface reports to hive feed</div>
                </div>
                <button
                  onClick={() => {
                    const next = !notifs;
                    setNotifs(next);
                    onUpdate(tentacle.id, { notificationsEnabled: next });
                  }}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ background: notifs ? "rgba(99,102,241,0.7)" : "rgba(107,114,128,0.3)" }}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                    style={{
                      background: "white",
                      left: notifs ? "calc(100% - 18px)" : "2px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                    }}
                  />
                </button>
              </div>

              {/* Enable / Disable */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium text-gray-300">Tentacle enabled</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">Allow this tentacle to process messages</div>
                </div>
                <button
                  onClick={() => {
                    const next = tentacle.status === "dormant" ? "online" : "dormant";
                    onUpdate(tentacle.id, { status: next });
                  }}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{
                    background:
                      tentacle.status !== "dormant" ? "rgba(99,102,241,0.7)" : "rgba(107,114,128,0.3)",
                  }}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                    style={{
                      background: "white",
                      left: tentacle.status !== "dormant" ? "calc(100% - 18px)" : "2px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                    }}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: "1px solid rgba(99,102,241,0.12)" }}
        >
          {tentacle.status === "offline" && (
            <button
              onClick={() => onReconnect(tentacle.id)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                color: "#4ade80",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.25)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(34,197,94,0.15)";
              }}
            >
              Reconnect
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#6b7280",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
