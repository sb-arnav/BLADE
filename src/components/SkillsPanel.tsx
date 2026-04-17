// SkillsPanel — shows BLADE's learned reflexes.
// Blade watches its own tool loops and synthesizes reusable skills when patterns
// repeat 3+ times. This panel makes the learning flywheel visible to the user.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Skill {
  id: string;
  name: string;
  trigger_pattern: string;
  prompt_modifier: string;
  tools_json: string;
  usage_count: number;
  active: boolean;
  created_at: number;
}

function parseTools(json: string): string[] {
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = useCallback(() => {
    invoke<Skill[]>("brain_get_skills")
      .then((s) => {
        setSkills(s);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();

    // Refresh when BLADE learns a new skill
    const unlistenSkill = listen("skill_learned", () => {
      reload();
    });

    return () => {
      unlistenSkill.then((fn) => fn());
    };
  }, [reload]);

  const toggleActive = useCallback(async (id: string, current: boolean) => {
    await invoke("brain_set_skill_active", { id, active: !current }).catch(() => {});
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !current } : s))
    );
  }, []);

  const deleteSkill = useCallback(async (id: string) => {
    await invoke("brain_delete_skill", { id }).catch(() => {});
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (expanded === id) setExpanded(null);
  }, [expanded]);

  if (loading) {
    return (
      <div className="p-4 text-blade-muted text-sm animate-pulse">
        Loading learned skills…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h3 className="text-sm font-semibold text-blade-text">Learned Skills</h3>
          <p className="text-xs text-blade-muted mt-0.5">
            Blade synthesizes reflexes from repeated tool patterns.
            {skills.length === 0 && " Use BLADE on a few similar tasks and it'll learn."}
          </p>
        </div>
        <span className="text-xs text-blade-muted bg-blade-surface px-2 py-0.5 rounded-full">
          {skills.filter((s) => s.active).length}/{skills.length} active
        </span>
      </div>

      {skills.length === 0 ? (
        <div className="text-sm text-blade-muted/60 italic px-1 py-6 text-center border border-dashed border-blade-border rounded-lg">
          No skills learned yet.
          <br />
          <span className="text-xs">Repeat a similar request 3+ times to trigger synthesis.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {skills.map((skill) => {
            const tools = parseTools(skill.tools_json);
            const isOpen = expanded === skill.id;
            return (
              <div
                key={skill.id}
                className={[
                  "rounded-lg border transition-all",
                  skill.active
                    ? "border-blade-accent/30 bg-blade-surface"
                    : "border-blade-border bg-blade-bg opacity-60",
                ].join(" ")}
              >
                {/* Row */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                  onClick={() => setExpanded(isOpen ? null : skill.id)}
                >
                  {/* Active dot */}
                  <div
                    className={[
                      "w-1.5 h-1.5 rounded-full flex-shrink-0",
                      skill.active ? "bg-blade-accent" : "bg-blade-muted/30",
                    ].join(" ")}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-blade-text truncate">
                        {skill.name}
                      </span>
                      <span className="text-xs text-blade-muted flex-shrink-0">
                        {skill.usage_count}× used
                      </span>
                    </div>
                    <div className="text-xs text-blade-muted/70 truncate">
                      {skill.trigger_pattern}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {tools.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1 py-0.5 bg-blade-surface-hover rounded text-blade-muted"
                      >
                        {t.replace("blade_", "")}
                      </span>
                    ))}
                    {tools.length > 3 && (
                      <span className="text-[10px] text-blade-muted">+{tools.length - 3}</span>
                    )}
                    <span className="text-blade-muted/40 ml-1">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* Expanded */}
                {isOpen && (
                  <div className="px-3 pb-3 flex flex-col gap-2 border-t border-blade-border/50">
                    <div className="pt-2">
                      <div className="text-[11px] text-blade-muted uppercase tracking-wide mb-1">
                        Prompt injection
                      </div>
                      <div className="text-xs text-blade-text/80 bg-blade-bg rounded p-2 font-mono leading-relaxed whitespace-pre-wrap">
                        {skill.prompt_modifier}
                      </div>
                    </div>

                    {tools.length > 0 && (
                      <div>
                        <div className="text-[11px] text-blade-muted uppercase tracking-wide mb-1">
                          Tool sequence
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {tools.map((t, i) => (
                            <span key={i} className="text-[11px] px-1.5 py-0.5 bg-blade-surface-hover rounded text-blade-text/70">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-blade-muted">
                        Learned {timeAgo(skill.created_at)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleActive(skill.id, skill.active)}
                          className="text-xs px-2 py-0.5 rounded border border-blade-border hover:bg-blade-surface-hover transition text-blade-muted"
                        >
                          {skill.active ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => deleteSkill(skill.id)}
                          className="text-xs px-2 py-0.5 rounded border border-red-500/30 hover:bg-red-500/10 transition text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
