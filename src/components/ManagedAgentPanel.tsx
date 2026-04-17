import { useState, useRef, useEffect } from "react";
import { useManagedAgents, ManagedAgentRun, AgentMessage } from "../hooks/useManagedAgents";
import { AgentTimeline, TimelineEvent } from "./AgentTimeline";

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// Real, useful one-click recipes — not generic labels
const RECIPES = [
  {
    id: "fix-ts-errors",
    label: "Fix TypeScript errors",
    icon: "🔴",
    desc: "Find and fix all TypeScript compilation errors in this project",
    prompt: "Run `npx tsc --noEmit`, find all TypeScript errors, and fix every single one. Verify the fix compiles cleanly.",
    tools: ["Read", "Edit", "Bash", "Glob", "Grep"],
    category: "code",
  },
  {
    id: "write-tests",
    label: "Write tests for untested code",
    icon: "🧪",
    desc: "Find files without test coverage and write comprehensive tests",
    prompt: "Find all source files that don't have corresponding test files. Write comprehensive unit tests for the 3 most critical untested files. Run the tests to verify they pass.",
    tools: ["Read", "Write", "Bash", "Glob", "Grep"],
    category: "code",
  },
  {
    id: "pr-review",
    label: "Review latest changes",
    icon: "👀",
    desc: "Review uncommitted changes for bugs, security issues, and improvements",
    prompt: "Run `git diff` and `git diff --staged`. Review all changes for: bugs, security vulnerabilities, performance issues, and code quality. Give a detailed review with specific line references.",
    tools: ["Read", "Bash", "Glob", "Grep"],
    category: "code",
  },
  {
    id: "refactor-file",
    label: "Refactor a messy file",
    icon: "♻️",
    desc: "Pick the messiest file and clean it up",
    prompt: "Find the largest or most complex source file in this project. Refactor it for clarity: extract functions, improve naming, add types, remove duplication. Keep behavior identical.",
    tools: ["Read", "Edit", "Glob", "Grep"],
    category: "code",
  },
  {
    id: "update-deps",
    label: "Update dependencies",
    icon: "📦",
    desc: "Check for outdated packages and update them safely",
    prompt: "Check for outdated npm packages with `npm outdated`. Update all patch and minor versions. Run `npx tsc --noEmit` after to verify nothing broke. Report what was updated.",
    tools: ["Read", "Edit", "Bash"],
    category: "ops",
  },
  {
    id: "security-audit",
    label: "Security audit",
    icon: "🔒",
    desc: "Scan codebase for security vulnerabilities and hardcoded secrets",
    prompt: "Search the entire codebase for: hardcoded API keys, passwords, tokens, insecure HTTP calls, SQL injection risks, XSS vulnerabilities, and unsafe eval/exec. Report all findings with severity ratings.",
    tools: ["Read", "Glob", "Grep"],
    category: "ops",
  },
  {
    id: "generate-docs",
    label: "Generate documentation",
    icon: "📝",
    desc: "Auto-generate README and API docs from code",
    prompt: "Analyze the project structure, read key files, and generate a comprehensive README.md with: project description, setup instructions, architecture overview, and API reference. Also create a CONTRIBUTING.md.",
    tools: ["Read", "Write", "Glob", "Grep"],
    category: "docs",
  },
  {
    id: "research-topic",
    label: "Research a topic",
    icon: "🔬",
    desc: "Deep research on any topic with web search",
    prompt: "",
    tools: ["WebSearch", "WebFetch", "Read", "Write"],
    category: "research",
    needsInput: true,
    inputPlaceholder: "What should I research?",
  },
  {
    id: "scaffold-feature",
    label: "Scaffold a new feature",
    icon: "🏗️",
    desc: "Create all the files and boilerplate for a new feature",
    prompt: "",
    tools: ["Read", "Write", "Bash", "Glob"],
    category: "code",
    needsInput: true,
    inputPlaceholder: "Describe the feature to scaffold...",
  },
  {
    id: "deploy-check",
    label: "Pre-deploy checklist",
    icon: "🚀",
    desc: "Run all checks before deploying: tests, types, lint, build",
    prompt: "Run a complete pre-deploy checklist: 1) `npx tsc --noEmit` for type errors, 2) check for uncommitted changes, 3) check branch status, 4) run build if available. Report pass/fail for each step.",
    tools: ["Bash", "Read", "Glob"],
    category: "ops",
  },
  {
    id: "explain-codebase",
    label: "Explain this codebase",
    icon: "🗺️",
    desc: "Generate a complete map of the project architecture",
    prompt: "Explore this entire project. Map out: directory structure, key modules, data flow, dependencies, entry points, and how everything connects. Create a clear architectural overview that a new developer could use to understand the codebase in 5 minutes.",
    tools: ["Read", "Glob", "Grep"],
    category: "docs",
  },
  {
    id: "custom",
    label: "Custom task",
    icon: "⚡",
    desc: "Describe any task — the agent figures out what tools to use",
    prompt: "",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
    category: "custom",
    needsInput: true,
    inputPlaceholder: "What do you want done?",
  },
];

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "code", label: "Code" },
  { id: "ops", label: "DevOps" },
  { id: "docs", label: "Docs" },
  { id: "research", label: "Research" },
  { id: "custom", label: "Custom" },
];

const TOOL_ICONS: Record<string, string> = {
  Read: "📖", Write: "✏️", Edit: "📝", Bash: "⚡",
  Glob: "🔍", Grep: "🔎", WebSearch: "🌐", WebFetch: "📡", Agent: "🤖",
};

function MessageLine({ msg }: { msg: AgentMessage }) {
  const typeStyles: Record<string, string> = {
    system: "text-blade-muted italic",
    assistant: "text-blade-text",
    tool_use: "text-amber-400",
    tool_result: "text-emerald-400",
    result: "text-blade-text font-medium",
    error: "text-red-400",
  };

  const icons: Record<string, string> = {
    system: "⚙️", assistant: "💬", tool_use: "🔧",
    tool_result: "📋", result: "✅", error: "❌",
  };

  return (
    <div className="flex items-start gap-2 py-1 text-xs font-mono">
      <span className="shrink-0 text-2xs mt-0.5">{icons[msg.type] || "•"}</span>
      <div className={`min-w-0 flex-1 ${typeStyles[msg.type] || "text-blade-secondary"}`}>
        {msg.metadata?.toolName && (
          <span className="text-2xs text-blade-muted/60 mr-1">{TOOL_ICONS[msg.metadata.toolName] || "🔧"}</span>
        )}
        <span className="whitespace-pre-wrap break-all text-2xs leading-relaxed">{msg.content}</span>
      </div>
      <span className="text-2xs text-blade-muted/20 shrink-0">
        {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}

function RunCard({ run, onResume, onSendToChat }: {
  run: ManagedAgentRun;
  onResume: (sessionId: string) => void;
  onSendToChat: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusColors: Record<string, string> = {
    starting: "bg-amber-500", running: "bg-blade-accent animate-pulse",
    completed: "bg-emerald-500", error: "bg-red-500", cancelled: "bg-blade-muted",
  };
  const duration = run.completedAt
    ? ((run.completedAt - run.startedAt) / 1000).toFixed(1) + "s"
    : "running...";

  return (
    <div className="border border-blade-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-blade-surface-hover transition-colors"
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColors[run.status]}`} />
        <span className="text-2xs text-blade-secondary truncate flex-1">{run.config.prompt}</span>
        <span className="text-2xs text-blade-muted/30">{duration}</span>
      </button>
      {expanded && (
        <div className="border-t border-blade-border/30 px-3 py-2 max-h-48 overflow-y-auto bg-blade-bg/30">
          {run.messages.map((msg) => <MessageLine key={msg.id} msg={msg} />)}
          <div className="flex gap-1.5 mt-2 pt-2 border-t border-blade-border/20">
            {run.sessionId && run.status === "completed" && (
              <button onClick={() => onResume(run.sessionId!)} className="text-2xs px-2 py-0.5 rounded bg-blade-accent/10 text-blade-accent">Resume</button>
            )}
            {run.messages.length > 0 && (
              <button onClick={() => {
                const result = run.messages.filter((m) => m.type === "result").map((m) => m.content).join("\n");
                onSendToChat(result || run.messages[run.messages.length - 1].content);
              }} className="text-2xs px-2 py-0.5 rounded bg-blade-surface-hover text-blade-secondary">To chat</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ManagedAgentPanel({ onBack, onSendToChat }: Props) {
  const {
    runs, activeRun, startAgent,
    cancelRun, resumeSession, clearRuns,
  } = useManagedAgents();

  const [category, setCategory] = useState("all");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [resumePrompt, setResumePrompt] = useState("");
  const [view, setView] = useState<"recipes" | "timeline">("recipes");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeRun) setView("timeline");
  }, [activeRun?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRun?.messages.length]);

  const filteredRecipes = category === "all"
    ? RECIPES
    : RECIPES.filter((r) => r.category === category);

  const handleLaunch = async (recipe: typeof RECIPES[0]) => {
    if (activeRun) return;
    const userInput = inputValues[recipe.id] || "";
    const prompt = recipe.needsInput
      ? (recipe.prompt ? `${recipe.prompt} ${userInput}` : userInput)
      : recipe.prompt;
    if (!prompt.trim()) return;

    await startAgent({
      prompt,
      tools: recipe.tools,
      permissionMode: recipe.tools.includes("Bash") ? "acceptEdits" : "default",
      maxTurns: 30,
    });
    setInputValues((prev) => ({ ...prev, [recipe.id]: "" }));
  };

  // Convert active run messages to timeline events
  const timelineEvents: TimelineEvent[] = (activeRun?.messages || []).map((msg) => ({
    id: msg.id,
    agentId: activeRun?.id || "main",
    agentName: "Main Agent",
    type: msg.type === "tool_use" ? "tool_call" : msg.type === "tool_result" ? "tool_result" : msg.type === "error" ? "error" : msg.type === "result" ? "complete" : "think",
    content: msg.content,
    timestamp: msg.timestamp,
    metadata: msg.metadata ? {
      toolName: msg.metadata.toolName,
      toolInput: typeof msg.metadata.toolInput === "string" ? msg.metadata.toolInput : JSON.stringify(msg.metadata.toolInput),
      costUsd: msg.metadata.costUsd,
    } : undefined,
  }));

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-blade-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-blade-muted hover:text-blade-secondary text-xs transition-colors">←</button>
          <div>
            <h1 className="text-sm font-semibold flex items-center gap-2">
              Managed Agents
              <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent/10 text-blade-accent font-normal">SDK</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* View toggle */}
          <div className="flex items-center bg-blade-surface rounded-md p-0.5 mr-2">
            {(["recipes", "timeline"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                  view === v ? "bg-blade-accent-muted text-blade-text" : "text-blade-muted hover:text-blade-secondary"
                }`}
              >
                {v === "recipes" ? "Recipes" : "Live"}
              </button>
            ))}
          </div>
          {activeRun && (
            <button onClick={cancelRun} className="text-2xs px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
              Stop
            </button>
          )}
          {runs.length > 0 && !activeRun && (
            <button onClick={clearRuns} className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      {view === "timeline" && activeRun ? (
        /* Live agent execution view */
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Active task banner */}
          <div className="px-4 py-2 bg-blade-accent/5 border-b border-blade-accent/10 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
            <span className="text-xs text-blade-secondary truncate flex-1">{activeRun.config.prompt}</span>
            <span className="text-2xs text-blade-muted font-mono">
              {((Date.now() - activeRun.startedAt) / 1000).toFixed(0)}s
            </span>
          </div>

          {/* Timeline */}
          <div className="flex-1 min-h-0">
            <AgentTimeline events={timelineEvents} title="Agent Execution" />
          </div>
        </div>
      ) : (
        /* Recipe selection + history */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
            {/* Category filter */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-lg text-2xs shrink-0 transition-colors ${
                    category === cat.id
                      ? "bg-blade-accent-muted text-blade-text"
                      : "text-blade-muted hover:text-blade-secondary"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Recipe grid */}
            <div className="grid grid-cols-2 gap-2">
              {filteredRecipes.map((recipe) => (
                <div
                  key={recipe.id}
                  className={`bg-blade-surface border border-blade-border rounded-xl p-3 transition-all ${
                    recipe.id === "custom" ? "col-span-2" : ""
                  } ${activeRun ? "opacity-50 pointer-events-none" : "hover:border-blade-accent/20"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-base mt-0.5">{recipe.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{recipe.label}</p>
                      <p className="text-2xs text-blade-muted mt-0.5 leading-relaxed">{recipe.desc}</p>

                      {recipe.needsInput ? (
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            value={inputValues[recipe.id] || ""}
                            onChange={(e) => setInputValues((prev) => ({ ...prev, [recipe.id]: e.target.value }))}
                            placeholder={recipe.inputPlaceholder}
                            className="flex-1 bg-blade-bg border border-blade-border rounded-lg px-2 py-1.5 text-2xs text-blade-text outline-none focus:border-blade-accent/30 transition-colors"
                            onKeyDown={(e) => e.key === "Enter" && handleLaunch(recipe)}
                          />
                          <button
                            onClick={() => handleLaunch(recipe)}
                            disabled={!inputValues[recipe.id]?.trim()}
                            className="text-2xs px-2.5 py-1.5 rounded-lg bg-blade-accent text-white hover:bg-blade-accent-hover disabled:opacity-30 transition-colors shrink-0"
                          >
                            Go
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleLaunch(recipe)}
                          className="mt-2 text-2xs px-2.5 py-1 rounded-lg bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors"
                        >
                          Run now
                        </button>
                      )}

                      {/* Tool badges */}
                      <div className="flex items-center gap-1 mt-2">
                        {recipe.tools.map((t) => (
                          <span key={t} className="text-2xs text-blade-muted/40" title={t}>
                            {TOOL_ICONS[t] || t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Resume session */}
            {resumeSessionId && (
              <div className="bg-blade-surface border border-blade-accent/30 rounded-xl p-3 animate-fade-in">
                <p className="text-2xs text-blade-muted mb-1.5">Resume — agent remembers everything:</p>
                <div className="flex gap-1.5">
                  <input
                    value={resumePrompt}
                    onChange={(e) => setResumePrompt(e.target.value)}
                    placeholder="What next?"
                    className="flex-1 bg-blade-bg border border-blade-border rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blade-accent/30"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && resumePrompt.trim()) {
                        resumeSession(resumeSessionId, resumePrompt.trim());
                        setResumeSessionId(null);
                        setResumePrompt("");
                      }
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      if (resumePrompt.trim()) {
                        resumeSession(resumeSessionId, resumePrompt.trim());
                        setResumeSessionId(null);
                        setResumePrompt("");
                      }
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blade-accent text-white"
                  >
                    Go
                  </button>
                  <button onClick={() => setResumeSessionId(null)} className="text-xs text-blade-muted">✕</button>
                </div>
              </div>
            )}

            {/* History */}
            {runs.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-2xs uppercase tracking-wider text-blade-muted/50">Recent runs</h3>
                {runs
                  .filter((r) => r.id !== activeRun?.id)
                  .sort((a, b) => b.startedAt - a.startedAt)
                  .slice(0, 10)
                  .map((run) => (
                    <RunCard
                      key={run.id}
                      run={run}
                      onResume={(sid) => { setResumeSessionId(sid); setResumePrompt(""); }}
                      onSendToChat={onSendToChat}
                    />
                  ))}
              </div>
            )}

            {/* Empty state */}
            {runs.length === 0 && !activeRun && (
              <div className="text-center py-8 animate-fade-in">
                <p className="text-2xs text-blade-muted/40">
                  Pick a recipe above or create a custom task.
                  <br />
                  Agents read files, run commands, search the web, and write code autonomously.
                </p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
