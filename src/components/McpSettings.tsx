import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { McpServerConfig, McpTool, ToolPermission, ImportedMcpServer } from "../types";

interface Props {
  onServersChanged: () => Promise<void>;
}

const PERM_CYCLE: ToolPermission[] = ["Auto", "Ask", "Blocked"];

export function McpSettings({ onServersChanged }: Props) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [serverStatuses, setServerStatuses] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [toolPermissions, setToolPermissions] = useState<Record<string, ToolPermission>>({});
  const [toolOverrides, setToolOverrides] = useState<Record<string, ToolPermission>>({});
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const classifyTools = async (toolList: McpTool[]) => {
    const perms: Record<string, ToolPermission> = {};
    await Promise.all(
      toolList.map(async (tool) => {
        try {
          const perm = await invoke<ToolPermission>("classify_mcp_tool", {
            name: tool.qualified_name,
            description: tool.description,
          });
          perms[tool.qualified_name] = perm;
        } catch {
          perms[tool.qualified_name] = "Ask";
        }
      })
    );
    setToolPermissions((prev) => ({ ...prev, ...perms }));
  };

  const loadOverrides = async () => {
    try {
      const overrides = await invoke<Record<string, ToolPermission>>("get_tool_overrides");
      setToolOverrides(overrides);
    } catch {
      // Command may not exist yet
    }
  };

  const loadServerStatuses = async () => {
    try {
      const statuses = await invoke<[string, boolean][]>("mcp_server_status");
      const map: Record<string, boolean> = {};
      for (const [sName, running] of statuses) {
        map[sName] = running;
      }
      setServerStatuses(map);
    } catch {
      // Command may not exist yet
    }
  };

  const loadState = async () => {
    const [nextServers, nextTools] = await Promise.all([
      invoke<McpServerConfig[]>("mcp_get_servers"),
      invoke<McpTool[]>("mcp_get_tools").catch(() => []),
    ]);
    setServers(nextServers);
    setTools(nextTools);
    if (nextTools.length > 0) classifyTools(nextTools);
    loadOverrides();
    loadServerStatuses();
  };

  useEffect(() => {
    loadState().catch((cause) => {
      setError(typeof cause === "string" ? cause : String(cause));
    });
  }, []);

  const toolsByServer = useMemo(() => {
    return tools.reduce<Record<string, McpTool[]>>((acc, tool) => {
      acc[tool.server_name] = acc[tool.server_name] ?? [];
      acc[tool.server_name].push(tool);
      return acc;
    }, {});
  }, [tools]);

  const handleDiscover = async () => {
    setStatus("Discovering tools...");
    setError(null);
    try {
      const discovered = await invoke<McpTool[]>("mcp_discover_tools");
      setTools(discovered);
      await classifyTools(discovered);
      await loadServerStatuses();
      setStatus(`Discovered ${discovered.length} tools.`);
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleImportServers = async () => {
    setImporting(true);
    setStatus("Scanning for MCP servers...");
    setError(null);
    try {
      const imported = await invoke<ImportedMcpServer[]>("discover_mcp_servers");
      if (imported.length === 0) {
        setStatus("No new MCP servers found.");
      } else {
        // Add each imported server
        for (const server of imported) {
          try {
            await invoke("mcp_add_server", {
              name: server.name,
              command: server.command,
              args: server.args,
            });
          } catch {
            // Server may already exist
          }
        }
        await loadState();
        await onServersChanged();
        setStatus(`Imported ${imported.length} server${imported.length > 1 ? "s" : ""} from ${imported[0].source}.`);
      }
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
    setImporting(false);
  };

  const handleAdd = async () => {
    setStatus("Adding MCP server...");
    setError(null);

    try {
      await invoke("mcp_add_server", {
        name,
        command,
        args: args
          .split(" ")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setName("");
      setCommand("");
      setArgs("");
      await loadState();
      await onServersChanged();
      setStatus("Server added.");
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleRemove = async (serverName: string) => {
    setStatus(`Removing ${serverName}...`);
    setError(null);

    try {
      await invoke("mcp_remove_server", { name: serverName });
      await loadState();
      await onServersChanged();
      setStatus(`${serverName} removed.`);
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleToggleTrust = async (toolName: string) => {
    const current = toolOverrides[toolName] ?? toolPermissions[toolName] ?? "Ask";
    const nextIndex = (PERM_CYCLE.indexOf(current) + 1) % PERM_CYCLE.length;
    const next = PERM_CYCLE[nextIndex];

    try {
      await invoke("set_tool_trust", { name: toolName, risk: next });
      setToolOverrides((prev) => ({ ...prev, [toolName]: next }));
      setToolPermissions((prev) => ({ ...prev, [toolName]: next }));
    } catch {
      // Silently fail
    }
  };

  const handleResetTrust = async (toolName: string) => {
    try {
      await invoke("reset_tool_trust", { name: toolName });
      setToolOverrides((prev) => {
        const next = { ...prev };
        delete next[toolName];
        return next;
      });
      // Re-classify to get the pattern-based default
      const tool = tools.find((t) => t.qualified_name === toolName);
      if (tool) {
        try {
          const perm = await invoke<ToolPermission>("classify_mcp_tool", {
            name: tool.qualified_name,
            description: tool.description,
          });
          setToolPermissions((prev) => ({ ...prev, [toolName]: perm }));
        } catch {
          // leave as-is
        }
      }
    } catch {
      // Silently fail
    }
  };

  return (
    <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">MCP Servers</h2>
          <p className="text-sm text-blade-muted">Register tools Blade can call automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImportServers}
            disabled={importing}
            className="px-3 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm hover:border-blade-muted transition-colors disabled:opacity-40"
          >
            {importing ? "Importing..." : "Import from Claude Code"}
          </button>
          <button
            onClick={handleDiscover}
            className="px-3 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm hover:border-blade-muted transition-colors"
          >
            Refresh tools
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Server name"
          className="bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
        />
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Command"
          className="bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
        />
        <input
          value={args}
          onChange={(event) => setArgs(event.target.value)}
          placeholder="Args separated by spaces"
          className="bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
        />
      </div>

      <button
        onClick={handleAdd}
        disabled={!name.trim() || !command.trim()}
        className="px-4 py-2 rounded-xl bg-blade-accent text-white text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        Add server
      </button>

      <div className="space-y-3">
        {servers.length === 0 && <p className="text-sm text-blade-muted">No MCP servers configured yet.</p>}
        {servers.map((server) => {
          const isRunning = serverStatuses[server.name];
          return (
            <div key={server.name} className="border border-blade-border rounded-xl p-3 bg-blade-bg/70">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isRunning === true
                        ? "bg-green-400"
                        : isRunning === false
                          ? "bg-red-400"
                          : "bg-blade-muted"
                    }`}
                    title={isRunning === true ? "Running" : isRunning === false ? "Stopped" : "Unknown"}
                  />
                  <div>
                    <p className="text-sm font-medium">{server.name}</p>
                    <p className="text-xs text-blade-muted break-all">
                      {server.command} {server.args.join(" ")}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(server.name)}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  remove
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <p className="text-xs uppercase tracking-wide text-blade-muted">Tools</p>
                {(toolsByServer[server.name] ?? []).length === 0 ? (
                  <p className="text-xs text-blade-muted">No tools discovered yet.</p>
                ) : (
                  (toolsByServer[server.name] ?? []).map((tool) => {
                    const effectivePerm = toolOverrides[tool.qualified_name] ?? toolPermissions[tool.qualified_name];
                    const isOverridden = tool.qualified_name in toolOverrides;
                    return (
                      <div key={tool.qualified_name} className="rounded-lg border border-blade-border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium truncate">{tool.qualified_name}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isOverridden && (
                              <button
                                onClick={() => handleResetTrust(tool.qualified_name)}
                                className="text-[10px] text-blade-muted hover:text-blade-text transition-colors"
                                title="Reset to default"
                              >
                                reset
                              </button>
                            )}
                            {effectivePerm && (
                              <button onClick={() => handleToggleTrust(tool.qualified_name)}>
                                <PermissionBadge permission={effectivePerm} interactive />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-blade-muted mt-0.5">{tool.description || "No description"}</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {status && <p className="text-xs text-green-400">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}

const PERM_STYLES: Record<ToolPermission, { bg: string; text: string; label: string }> = {
  Auto: { bg: "bg-green-950 border-green-900", text: "text-green-400", label: "auto" },
  Ask: { bg: "bg-amber-950 border-amber-900", text: "text-amber-400", label: "ask" },
  Blocked: { bg: "bg-red-950 border-red-900", text: "text-red-400", label: "blocked" },
};

function PermissionBadge({ permission, interactive }: { permission: ToolPermission; interactive?: boolean }) {
  const style = PERM_STYLES[permission];
  return (
    <span
      className={`text-[10px] uppercase tracking-wider font-medium rounded-full border px-2 py-0.5 ${style.bg} ${style.text} ${
        interactive ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
      }`}
      title={interactive ? "Click to cycle: Auto → Ask → Blocked" : undefined}
    >
      {style.label}
    </span>
  );
}
