import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SkillPackEntry {
  name: string;
  package: string;
  command: string;
  args: string[];
  auto_install: boolean;
  description: string;
}

interface BladeRole {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  skill_pack: SkillPackEntry[];
}

interface Props {
  onBack: () => void;
}

export function SkillPackView({ onBack }: Props) {
  const [roles, setRoles] = useState<BladeRole[]>([]);
  const [activeRole, setActiveRole] = useState<string>("engineering");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<BladeRole[]>("roles_list").then(setRoles).catch(() => {});
    invoke<BladeRole>("roles_get_active").then((r) => setActiveRole(r.id)).catch(() => {});
  }, []);

  const currentRole = roles.find((r) => r.id === activeRole);

  const installSkill = async (skill: SkillPackEntry) => {
    setInstalling(skill.name);
    setError(null);
    try {
      const count = await invoke<number>("mcp_install_catalog_server", {
        name: skill.name,
        command: skill.command,
        args: skill.args,
        env: {},
      });
      setInstalled((prev) => new Set([...prev, skill.name]));
      console.log(`Installed ${skill.name}: ${count} tools`);
    } catch (e) {
      setError(`Failed to install ${skill.name}: ${String(e)}`);
    } finally {
      setInstalling(null);
    }
  };

  const switchRole = async (id: string) => {
    try {
      await invoke("roles_set_active", { id });
      setActiveRole(id);
    } catch {}
  };

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold">Skill Packs</div>
          <div className="text-[10px] text-blade-muted">
            Domain-specific MCP tools bundled per role — inspired by Vibe-Trading's 64-skill model
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Role sidebar */}
        <div className="w-36 border-r border-blade-border shrink-0 overflow-y-auto py-2">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => switchRole(role.id)}
              className={`w-full flex flex-col items-start px-3 py-2.5 text-left transition-colors ${
                role.id === activeRole
                  ? "bg-blade-accent/10 border-r-2 border-blade-accent text-blade-accent"
                  : "text-blade-muted hover:text-blade-text hover:bg-blade-surface"
              }`}
            >
              <div className="text-[11px] font-medium">{role.name}</div>
              <div className="text-[9px] text-blade-muted/60 mt-0.5">{role.skill_pack.length} skills</div>
            </button>
          ))}
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {currentRole ? (
            <>
              <div className="mb-4">
                <div className="text-sm font-semibold text-blade-text">{currentRole.name} Mode</div>
                <div className="text-xs text-blade-muted mt-0.5">{currentRole.description}</div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                  {error}
                </div>
              )}

              {currentRole.skill_pack.length === 0 ? (
                <div className="text-xs text-blade-muted italic text-center py-8">
                  No skill pack for this role — it uses built-in tools only.
                </div>
              ) : (
                currentRole.skill_pack.map((skill) => {
                  const isInstalled = installed.has(skill.name);
                  const isInstalling = installing === skill.name;

                  return (
                    <div
                      key={skill.name}
                      className="bg-blade-surface border border-blade-border rounded-lg p-3 flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-blade-text">{skill.name}</span>
                          {skill.auto_install && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                              auto
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-blade-muted mt-0.5">{skill.description}</div>
                        <div className="text-[9px] text-blade-muted/40 mt-1 font-mono">{skill.package}</div>
                      </div>
                      <button
                        onClick={() => installSkill(skill)}
                        disabled={isInstalled || isInstalling}
                        className={`shrink-0 text-[10px] px-3 py-1.5 rounded transition-colors ${
                          isInstalled
                            ? "bg-green-500/10 text-green-400 border border-green-500/20 cursor-default"
                            : isInstalling
                            ? "opacity-50 bg-blade-accent/10 text-blade-accent border border-blade-accent/30"
                            : "bg-blade-accent/10 text-blade-accent border border-blade-accent/30 hover:bg-blade-accent/20"
                        }`}
                      >
                        {isInstalled ? "Installed" : isInstalling ? "Installing…" : "Install"}
                      </button>
                    </div>
                  );
                })
              )}

              <div className="pt-2 text-[10px] text-blade-muted/50">
                Skills are MCP servers installed via npx. They give BLADE new tools for this domain.
                {currentRole.skill_pack.some((s) => !s.auto_install) && (
                  <span> Some require API keys — configure them in Settings after install.</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-blade-muted text-sm text-center py-8">Select a role</div>
          )}
        </div>
      </div>
    </div>
  );
}
