import { useState, useRef, useEffect } from "react";
import { useManagedAgents, ManagedAgentRun, AgentMessage } from "../hooks/useManagedAgents";

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

const PRESETS = [
  { id: "code-reviewer", label: "Code Reviewer", icon: "🔍", desc: "Review code for quality, bugs, and best practices" },
  { id: "bug-fixer", label: "Bug Fixer", icon: "🐛", desc: "Find and fix bugs autonomously" },
  { id: "researcher", label: "Researcher", icon: "🔬", desc: "Research topics on the web and summarize findings" },
  { id: "project-scaffolder", label: "Scaffolder", icon: "🏗️", desc: "Create new projects, files, and boilerplate" },
  { id: "refactorer", label: "Refactorer", icon: "♻️", desc: "Refactor code for clarity and performance" },
];

const TOOL_BADGES: Record<string, { color: string; label: string }> = {
  Read: { color: "bg-emerald-500/10 text-emerald-400", label: "Read" },
  Write: { color: "bg-blue-500/10 text-blue-400", label: "Write" },
  Edit: { color: "bg-amber-500/10 text-amber-400", label: "Edit" },
  Bash: { color: "bg-red-500/10 text-red-400", label: "Bash" },
  Glob: { color: "bg-cyan-500/10 text-cyan-400", label: "Glob" },
  Grep: { color: "bg-violet-500/10 text-violet-400", label: "Grep" },
  WebSearch: { color: "bg-pink-500/10 text-pink-400", label: "Web" },
  WebFetch: { color: "bg-orange-500/10 text-orange-400", label: "Fetch" },
  Agent: { color: "bg-blade-accent/10 text-blade-accent", label: "Agent" },
};

function MessageLine({ msg }: { msg: AgentMessage }) {
  const typeStyles: Record<string, string> = {
    system: "text-blade-muted italic",
    assistant: "text-blade-text",
    tool_use: "text-amber-400 font-mono",
    tool_result: "text-emerald-400 font-mono",
    result: "text-blade-text font-medium",
    error: "text-red-400",
  };

  const icons: Record<string, string> = {
    system: "⚙️",
    assistant: "🤖",
    tool_use: "🔧",
    tool_result: "📋",
    result: "✅",
    error: "❌",
  };

  return (
    <div className="flex items-start gap-2 py-1.5 text-xs">
      <span className="shrink-0 mt-0.5">{icons[msg.type] || "•"}</span>
      <div className={`min-w-0 ${typeStyles[msg.type] || "text-blade-secondary"}`}>
        {msg.metadata?.toolName && (
          <span className="text-2xs text-blade-muted mr-1.5">[{msg.metadata.toolName}]</span>
        )}
        <span className="whitespace-pre-wrap break-all">{msg.content}</span>
      </div>
      <span className="text-2xs text-blade-muted/30 shrink-0 ml-auto">
        {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}

function RunCard({ run, onResume, onSendToChat }: { run: ManagedAgentRun; onResume: (sessionId: string) => void; onSendToChat: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors: Record<string, string> = {
    starting: "bg-amber-500",
    running: "bg-blade-accent animate-pulse",
    completed: "bg-emerald-500",
    error: "bg-red-500",
    cancelled: "bg-blade-muted",
  };

  const duration = run.completedAt
    ? ((run.completedAt - run.startedAt) / 1000).toFixed(1) + "s"
    : "running...";

  return (
    <div className="border border-blade-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-blade-surface-hover transition-colors"
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[run.status]}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate">{run.config.prompt}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-2xs text-blade-muted">{run.status}</span>
            <span className="text-2xs text-blade-muted/40">•</span>
            <span className="text-2xs text-blade-muted/40">{duration}</span>
            <span className="text-2xs text-blade-muted/40">•</span>
            <span className="text-2xs text-blade-muted/40">{run.messages.length} msgs</span>
            {run.totalCostUsd > 0 && (
              <>
                <span className="text-2xs text-blade-muted/40">•</span>
                <span className="text-2xs text-blade-muted/40">${run.totalCostUsd.toFixed(4)}</span>
              </>
            )}
          </div>
        </div>
        <svg
          viewBox="0 0 24 24"
          className={`w-3 h-3 text-blade-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-blade-border">
          {/* Tools used */}
          <div className="px-4 py-2 flex items-center gap-1.5 flex-wrap border-b border-blade-border/50">
            {run.config.tools.map((tool) => (
              <span
                key={tool}
                className={`text-2xs px-1.5 py-0.5 rounded ${TOOL_BADGES[tool]?.color || "bg-blade-surface text-blade-muted"}`}
              >
                {TOOL_BADGES[tool]?.label || tool}
              </span>
            ))}
          </div>

          {/* Messages */}
          <div className="px-4 py-2 max-h-60 overflow-y-auto bg-blade-bg/50">
            {run.messages.length === 0 ? (
              <p className="text-2xs text-blade-muted/40 py-2">No messages yet</p>
            ) : (
              run.messages.map((msg) => <MessageLine key={msg.id} msg={msg} />)
            )}
          </div>

          {/* Actions */}
          <div className="px-4 py-2 flex items-center gap-2 border-t border-blade-border/50">
            {run.sessionId && run.status === "completed" && (
              <button
                onClick={() => onResume(run.sessionId!)}
                className="text-2xs px-2 py-1 rounded-md bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors"
              >
                Resume session
              </button>
            )}
            {run.messages.length > 0 && (
              <button
                onClick={() => {
                  const result = run.messages.filter((m) => m.type === "result").map((m) => m.content).join("\n");
                  onSendToChat(result || run.messages[run.messages.length - 1].content);
                }}
                className="text-2xs px-2 py-1 rounded-md bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
              >
                Send to chat
              </button>
            )}
            {run.error && (
              <span className="text-2xs text-red-400 truncate flex-1">{run.error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ManagedAgentPanel({ onBack, onSendToChat }: Props) {
  const {
    runs, activeRun, startAgent, startPresetAgent,
    cancelRun, resumeSession, clearRuns, availableTools,
  } = useManagedAgents();

  const [mode, setMode] = useState<"presets" | "custom">("presets");
  const [prompt, setPrompt] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>(["Read", "Glob", "Grep"]);
  const [resumePrompt, setResumePrompt] = useState("");
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRun?.messages.length]);

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || activeRun) return;

    if (mode === "custom") {
      await startAgent({
        prompt: trimmed,
        tools: selectedTools,
        permissionMode: "default",
        maxTurns: 20,
      });
    }
    setPrompt("");
  };

  const handleResume = (sessionId: string) => {
    setResumeSessionId(sessionId);
    setResumePrompt("");
  };

  const handleResumeSubmit = async () => {
    if (!resumeSessionId || !resumePrompt.trim()) return;
    await resumeSession(resumeSessionId, resumePrompt.trim());
    setResumeSessionId(null);
    setResumePrompt("");
  };

  const toggleTool = (tool: string) => {
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );
  };

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-blade-muted hover:text-blade-secondary text-xs transition-colors">
            ← back
          </button>
          <div>
            <h1 className="text-sm font-semibold">Managed Agents</h1>
            <p className="text-2xs text-blade-muted">Powered by Claude Agent SDK</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeRun && (
            <button
              onClick={cancelRun}
              className="text-2xs px-2 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Cancel
            </button>
          )}
          {runs.length > 0 && (
            <button
              onClick={clearRuns}
              className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors"
            >
              Clear history
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-blade-surface rounded-lg p-0.5">
            {(["presets", "custom"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs transition-colors ${
                  mode === m ? "bg-blade-accent-muted text-blade-text" : "text-blade-muted hover:text-blade-secondary"
                }`}
              >
                {m === "presets" ? "Preset Agents" : "Custom Agent"}
              </button>
            ))}
          </div>

          {/* Presets */}
          {mode === "presets" && (
            <div className="space-y-2">
              {PRESETS.map((preset) => (
                <div key={preset.id} className="bg-blade-surface border border-blade-border rounded-xl p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{preset.icon}</span>
                    <div className="flex-1">
                      <p className="text-xs font-medium">{preset.label}</p>
                      <p className="text-2xs text-blade-muted mt-0.5">{preset.desc}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="text"
                          placeholder={`What should ${preset.label} do?`}
                          className="flex-1 bg-blade-bg border border-blade-border rounded-lg px-2 py-1.5 text-2xs text-blade-text outline-none focus:border-blade-accent/30 transition-colors"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const input = e.currentTarget;
                              if (input.value.trim()) {
                                startPresetAgent(preset.id, input.value.trim());
                                input.value = "";
                              }
                            }
                          }}
                          disabled={!!activeRun}
                        />
                        <button
                          onClick={() => {
                            const input = document.querySelector<HTMLInputElement>(`[data-preset="${preset.id}"]`);
                            if (input?.value.trim()) {
                              startPresetAgent(preset.id, input.value.trim());
                              input.value = "";
                            }
                          }}
                          disabled={!!activeRun}
                          className="text-2xs px-2 py-1.5 rounded-lg bg-blade-accent text-white hover:bg-blade-accent-hover disabled:opacity-30 transition-colors"
                        >
                          Run
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Custom agent */}
          {mode === "custom" && (
            <div className="bg-blade-surface border border-blade-border rounded-xl p-4 space-y-3">
              <div>
                <label className="text-2xs uppercase tracking-wider text-blade-muted">Task</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want the agent to do..."
                  rows={3}
                  className="w-full mt-1 bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none focus:border-blade-accent/30 resize-y transition-colors"
                  disabled={!!activeRun}
                />
              </div>

              <div>
                <label className="text-2xs uppercase tracking-wider text-blade-muted">Tools</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {availableTools.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => toggleTool(tool.name)}
                      className={`text-2xs px-2 py-1 rounded-lg border transition-colors ${
                        selectedTools.includes(tool.name)
                          ? "border-blade-accent bg-blade-accent-muted text-blade-text"
                          : "border-blade-border text-blade-muted hover:border-blade-muted"
                      }`}
                      title={tool.description}
                    >
                      {tool.name}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || !!activeRun}
                className="w-full py-2 rounded-lg bg-blade-accent text-white text-xs font-medium hover:bg-blade-accent-hover disabled:opacity-30 transition-colors"
              >
                {activeRun ? "Agent running..." : "Launch Agent"}
              </button>
            </div>
          )}

          {/* Resume session modal */}
          {resumeSessionId && (
            <div className="bg-blade-surface border border-blade-accent/30 rounded-xl p-4 space-y-2">
              <p className="text-xs text-blade-secondary">Resume session — agent has full context from before:</p>
              <div className="flex gap-2">
                <input
                  value={resumePrompt}
                  onChange={(e) => setResumePrompt(e.target.value)}
                  placeholder="What next?"
                  className="flex-1 bg-blade-bg border border-blade-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blade-accent/30"
                  onKeyDown={(e) => e.key === "Enter" && handleResumeSubmit()}
                  autoFocus
                />
                <button onClick={handleResumeSubmit} className="text-xs px-3 py-1.5 rounded-lg bg-blade-accent text-white">
                  Resume
                </button>
                <button onClick={() => setResumeSessionId(null)} className="text-xs text-blade-muted hover:text-blade-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Active run live view */}
          {activeRun && (
            <div className="bg-blade-surface border border-blade-accent/20 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-blade-border/50 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
                <span className="text-xs text-blade-secondary">Running: {activeRun.config.prompt.slice(0, 60)}</span>
              </div>
              <div className="px-4 py-2 max-h-80 overflow-y-auto bg-blade-bg/30 font-mono">
                {activeRun.messages.map((msg) => (
                  <MessageLine key={msg.id} msg={msg} />
                ))}
                <div ref={bottomRef} />
              </div>
            </div>
          )}

          {/* Run history */}
          {runs.filter((r) => r.id !== activeRun?.id).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-2xs uppercase tracking-wider text-blade-muted">History</h3>
              {runs
                .filter((r) => r.id !== activeRun?.id)
                .sort((a, b) => b.startedAt - a.startedAt)
                .map((run) => (
                  <RunCard key={run.id} run={run} onResume={handleResume} onSendToChat={onSendToChat} />
                ))}
            </div>
          )}

          {/* Empty state */}
          {runs.length === 0 && (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">🤖</div>
              <p className="text-sm text-blade-secondary">No agents have run yet</p>
              <p className="text-2xs text-blade-muted mt-1">
                Choose a preset or create a custom agent above.
                <br />
                Agents can read files, run commands, search the web, and more.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
