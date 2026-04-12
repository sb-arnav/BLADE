import { useState, useMemo } from "react";
import { useSwarm, Swarm, SwarmTask } from "../hooks/useSwarm";

interface Props {
  onBack: () => void;
}

const STATUS_COLORS: Record<SwarmTask["status"], string> = {
  pending: "bg-blade-border text-blade-muted",
  blocked: "bg-blade-border/50 text-blade-muted",
  ready: "bg-blue-500/20 text-blue-400",
  running: "bg-blade-accent/20 text-blade-accent",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
};

const SWARM_STATUS_COLORS: Record<Swarm["status"], string> = {
  planning: "text-blade-muted",
  running: "text-blade-accent",
  paused: "text-yellow-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

function TaskNode({
  task,
  selected,
  onClick,
}: {
  task: SwarmTask;
  selected: boolean;
  onClick: () => void;
}) {
  const typeIcon = { code: "⚡", research: "🔍", desktop: "🖥" }[task.task_type] ?? "⚡";

  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-lg border transition-all ${
        selected
          ? "border-blade-accent bg-blade-accent/10"
          : "border-blade-border bg-blade-surface hover:border-blade-accent/40"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">{typeIcon}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[task.status]}`}>
          {task.status}
        </span>
      </div>
      <div className="text-xs text-blade-text font-medium leading-tight">{task.title}</div>
      {task.depends_on.length > 0 && (
        <div className="text-[9px] text-blade-muted mt-1">
          Needs: {task.depends_on.join(", ")}
        </div>
      )}
      {task.status === "running" && (
        <div className="mt-2 h-0.5 bg-blade-border rounded overflow-hidden">
          <div className="h-full bg-blade-accent animate-pulse w-3/4" />
        </div>
      )}
    </button>
  );
}

function DagView({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: SwarmTask[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Group tasks into layers based on dependency depth
  const layers = useMemo(() => {
    const depth: Record<string, number> = {};
    const getDepth = (id: string): number => {
      if (id in depth) return depth[id];
      const task = tasks.find((t) => t.id === id);
      if (!task || task.depends_on.length === 0) {
        depth[id] = 0;
        return 0;
      }
      const d = 1 + Math.max(...task.depends_on.map(getDepth));
      depth[id] = d;
      return d;
    };
    tasks.forEach((t) => getDepth(t.id));

    const maxDepth = Math.max(0, ...Object.values(depth));
    return Array.from({ length: maxDepth + 1 }, (_, i) =>
      tasks.filter((t) => depth[t.id] === i)
    );
  }, [tasks]);

  const completed = tasks.filter((t) => t.status === "completed").length;
  const pct = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-blade-muted mb-1">
          <span>{completed}/{tasks.length} tasks done</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-blade-border rounded-full overflow-hidden">
          <div
            className="h-full bg-blade-accent transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* DAG layers */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {layers.map((layer, li) => (
          <div key={li} className="flex flex-col gap-2 min-w-[180px]">
            <div className="text-[9px] uppercase tracking-widest text-blade-muted text-center">
              {li === 0 ? "Start" : `Layer ${li + 1}`}
            </div>
            {layer.map((task) => (
              <TaskNode
                key={task.id}
                task={task}
                selected={selectedId === task.id}
                onClick={() => onSelect(task.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskDetail({ task }: { task: SwarmTask }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-1">Goal</div>
        <div className="text-xs text-blade-secondary bg-blade-surface rounded-lg p-3 leading-relaxed">
          {task.goal}
        </div>
      </div>

      {task.result && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-1">Result</div>
          <div className="text-xs text-blade-text bg-blade-surface rounded-lg p-3 leading-relaxed max-h-48 overflow-y-auto">
            {task.result}
          </div>
        </div>
      )}

      {task.error && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-red-400 mb-1">Error</div>
          <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-3 leading-relaxed">
            {task.error}
          </div>
        </div>
      )}

      {task.agent_id && (
        <div className="text-[10px] text-blade-muted font-mono">
          Agent: {task.agent_id.slice(0, 12)}…
        </div>
      )}
    </div>
  );
}

function SwarmDetail({
  swarm,
  onPause,
  onResume,
  onCancel,
}: {
  swarm: Swarm;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = swarm.tasks.find((t) => t.id === selectedTaskId) ?? null;
  const scratchpadEntries = Object.entries(swarm.scratchpad);

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
      {/* Swarm header */}
      <div className="bg-blade-surface border border-blade-border rounded-lg p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-blade-text leading-snug">{swarm.goal}</div>
            <div className={`text-xs mt-1 font-medium ${SWARM_STATUS_COLORS[swarm.status]}`}>
              {swarm.status}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {swarm.status === "running" && (
              <button
                onClick={onPause}
                className="text-xs px-2.5 py-1 rounded border border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-accent/40 transition-colors"
              >
                Pause
              </button>
            )}
            {swarm.status === "paused" && (
              <button
                onClick={onResume}
                className="text-xs px-2.5 py-1 rounded border border-blade-accent text-blade-accent hover:bg-blade-accent/10 transition-colors"
              >
                Resume
              </button>
            )}
            {["running", "paused"].includes(swarm.status) && (
              <button
                onClick={onCancel}
                className="text-xs px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* DAG */}
      <DagView
        tasks={swarm.tasks}
        selectedId={selectedTaskId}
        onSelect={(id) => setSelectedTaskId((prev) => (prev === id ? null : id))}
      />

      {/* Task detail panel */}
      {selectedTask && (
        <div className="bg-blade-surface border border-blade-accent/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-blade-text">{selectedTask.title}</div>
            <button
              onClick={() => setSelectedTaskId(null)}
              className="text-blade-muted hover:text-blade-text text-sm"
            >
              ×
            </button>
          </div>
          <TaskDetail task={selectedTask} />
        </div>
      )}

      {/* Final result */}
      {swarm.final_result && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-widest text-green-400 mb-2">Final Result</div>
          <div className="text-xs text-blade-text leading-relaxed whitespace-pre-wrap">
            {swarm.final_result}
          </div>
        </div>
      )}

      {/* Scratchpad */}
      {scratchpadEntries.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-2">Shared Scratchpad</div>
          <div className="space-y-2">
            {scratchpadEntries.map(([key, val]) => (
              <div key={key} className="bg-blade-surface border border-blade-border rounded-lg p-3">
                <div className="text-[10px] text-blade-accent font-mono mb-1">{key}</div>
                <div className="text-xs text-blade-secondary max-h-24 overflow-y-auto">
                  {val.slice(0, 400)}{val.length > 400 ? "…" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SwarmView({ onBack }: Props) {
  const sw = useSwarm();
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!sw.goalInput.trim()) return;
    setError(null);
    try {
      await sw.createSwarm(sw.goalInput.trim());
      sw.setGoalInput("");
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold">BLADE Swarm</div>
          <div className="text-[10px] text-blade-muted">Parallel multi-agent task orchestration</div>
        </div>
        {sw.activeSwarm && (
          <button
            onClick={() => sw.setActiveSwarm(null)}
            className="text-xs text-blade-muted hover:text-blade-text transition-colors"
          >
            All swarms
          </button>
        )}
      </div>

      {/* Create form */}
      {!sw.activeSwarm && (
        <div className="px-4 py-4 border-b border-blade-border/40 shrink-0">
          <div className="text-xs text-blade-muted mb-2">
            Describe a complex goal. BLADE will decompose it into parallel tasks and run them simultaneously.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={sw.goalInput}
              onChange={(e) => sw.setGoalInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCreate()}
              placeholder="e.g. Research React vs Vue performance in 2025 and write a comparison"
              className="flex-1 bg-blade-surface border border-blade-border rounded px-3 py-2 text-xs placeholder-blade-muted focus:outline-none focus:border-blade-accent/60"
            />
            <button
              onClick={handleCreate}
              disabled={sw.creating || !sw.goalInput.trim()}
              className="px-4 py-2 rounded bg-blade-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
            >
              {sw.creating ? "Planning…" : "Launch Swarm"}
            </button>
          </div>
          {error && (
            <div className="mt-2 text-xs text-red-400">{error}</div>
          )}
        </div>
      )}

      {/* Active swarm detail */}
      {sw.activeSwarm ? (
        <SwarmDetail
          swarm={sw.activeSwarm}
          onPause={() => sw.pauseSwarm(sw.activeSwarm!.id)}
          onResume={() => sw.resumeSwarm(sw.activeSwarm!.id)}
          onCancel={() => sw.cancelSwarm(sw.activeSwarm!.id)}
        />
      ) : (
        /* Swarm list */
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
          {sw.swarms.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-blade-muted text-sm">
              No swarms yet. Launch one above.
            </div>
          ) : (
            <div className="space-y-2">
              {sw.swarms.map((swarm) => {
                const completed = swarm.tasks.filter((t) => t.status === "completed").length;
                const total = swarm.tasks.length;
                return (
                  <button
                    key={swarm.id}
                    onClick={() => sw.setActiveSwarm(swarm)}
                    className="w-full text-left bg-blade-surface border border-blade-border rounded-lg p-4 hover:border-blade-accent/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-blade-text truncate">{swarm.goal}</div>
                        <div className="text-[10px] text-blade-muted mt-0.5">
                          {completed}/{total} tasks · {new Date(swarm.created_at * 1000).toLocaleDateString()}
                        </div>
                      </div>
                      <div className={`text-[10px] font-medium ${SWARM_STATUS_COLORS[swarm.status]}`}>
                        {swarm.status}
                      </div>
                    </div>
                    {total > 0 && (
                      <div className="mt-2 h-1 bg-blade-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blade-accent transition-all"
                          style={{ width: `${(completed / total) * 100}%` }}
                        />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
