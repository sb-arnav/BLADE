import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { McpServerConfig, McpTool } from "../types";

interface Props {
  onServersChanged: () => Promise<void>;
}

export function McpSettings({ onServersChanged }: Props) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadState = async () => {
    const [nextServers, nextTools] = await Promise.all([
      invoke<McpServerConfig[]>("mcp_get_servers"),
      invoke<McpTool[]>("mcp_get_tools").catch(() => []),
    ]);
    setServers(nextServers);
    setTools(nextTools);
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
      setStatus(`Discovered ${discovered.length} tools.`);
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
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

  return (
    <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">MCP Servers</h2>
          <p className="text-sm text-blade-muted">Register tools Blade can call automatically.</p>
        </div>
        <button
          onClick={handleDiscover}
          className="px-3 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm hover:border-blade-muted transition-colors"
        >
          Refresh tools
        </button>
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
        {servers.map((server) => (
          <div key={server.name} className="border border-blade-border rounded-xl p-3 bg-blade-bg/70">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{server.name}</p>
                <p className="text-xs text-blade-muted break-all">
                  {server.command} {server.args.join(" ")}
                </p>
              </div>
              <button
                onClick={() => handleRemove(server.name)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                remove
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <p className="text-xs uppercase tracking-wide text-blade-muted">Discovered tools</p>
              {(toolsByServer[server.name] ?? []).length === 0 ? (
                <p className="text-xs text-blade-muted">No tools discovered yet.</p>
              ) : (
                (toolsByServer[server.name] ?? []).map((tool) => (
                  <div key={tool.qualified_name} className="rounded-lg border border-blade-border px-3 py-2">
                    <p className="text-xs font-medium">{tool.qualified_name}</p>
                    <p className="text-xs text-blade-muted">{tool.description || "No description"}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {status && <p className="text-xs text-green-400">{status}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
