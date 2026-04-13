import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface SidecarDevice {
  id: string;
  name: string;
  address: string;
  status: "online" | "offline" | "unknown";
  last_seen: number | null;
  capabilities: string[];
  os: string;
  hostname: string;
}

interface SidecarPing {
  latency_ms: number;
  status: string;
}

const palette = {
  bg: "#0a0a0a",
  panel: "#10150f",
  panelAlt: "#0d120d",
  green: "#00ff41",
  amber: "#ffb000",
  red: "#ff0040",
  blue: "#00b8ff",
  cyan: "#00e5ff",
  line: "rgba(0, 255, 65, 0.24)",
  dim: "rgba(0, 255, 65, 0.54)",
  muted: "rgba(164, 255, 188, 0.74)",
  glow: "rgba(0, 255, 65, 0.18)",
} as const;

function relTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusColor(status: SidecarDevice["status"]): string {
  if (status === "online") return "#00ff41";
  if (status === "offline") return "#ff0040";
  return "rgba(164,255,188,0.4)";
}

function SectionFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={`relative overflow-hidden border p-4 ${className}`}
      style={{
        borderColor: palette.line,
        background: `linear-gradient(180deg, ${palette.panel} 0%, ${palette.panelAlt} 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(0, 255, 65, 0.06), 0 0 18px ${palette.glow}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div className="relative">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: palette.amber }}>
          {`=== ${title} ===`}
        </div>
        {children}
      </div>
    </section>
  );
}

function DeviceNode({
  device,
  selected,
  onSelect,
  onPing,
  onRemove,
  pingResult,
  pinging,
}: {
  device: SidecarDevice;
  selected: boolean;
  onSelect: () => void;
  onPing: () => void;
  onRemove: () => void;
  pingResult: SidecarPing | null;
  pinging: boolean;
}) {
  const sc = statusColor(device.status);
  const osEmoji = device.os.toLowerCase().includes("win")
    ? "WIN"
    : device.os.toLowerCase().includes("mac") || device.os.toLowerCase().includes("darwin")
    ? "MAC"
    : device.os.toLowerCase().includes("linux")
    ? "LNX"
    : "???";

  return (
    <div
      className="border p-3 cursor-pointer transition-all"
      style={{
        borderColor: selected ? `${palette.cyan}66` : `${sc}33`,
        backgroundColor: selected ? `${palette.cyan}08` : `${sc}06`,
        boxShadow: selected ? `inset 0 0 0 1px ${palette.cyan}22` : "none",
      }}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        {/* Status dot */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <div
            className="h-3 w-3 shrink-0"
            style={{
              backgroundColor: sc,
              boxShadow: device.status === "online" ? `0 0 12px ${sc}88` : "none",
              animation: device.status === "online" ? "sidecar-pulse 2s ease-in-out infinite" : undefined,
            }}
          />
          <div
            className="text-[8px] font-bold uppercase tracking-[0.1em] border px-1"
            style={{ borderColor: `${sc}44`, color: sc }}
          >
            {osEmoji}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[12px] truncate" style={{ color: "#d5ffd8" }}>
            {device.hostname || device.name}
          </div>
          <div className="text-[10px] truncate mt-0.5" style={{ color: palette.dim }}>
            {device.address}
          </div>
          <div className="text-[10px] mt-1 uppercase tracking-[0.12em]" style={{ color: sc }}>
            {device.status} · last {relTime(device.last_seen)}
          </div>
          {device.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {device.capabilities.slice(0, 4).map((cap) => (
                <span
                  key={cap}
                  className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]"
                  style={{
                    borderColor: `${palette.cyan}33`,
                    color: palette.cyan,
                    backgroundColor: `${palette.cyan}08`,
                  }}
                >
                  {cap}
                </span>
              ))}
            </div>
          )}
          {pingResult && (
            <div className="mt-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: palette.green }}>
              Ping: {pingResult.latency_ms}ms · {pingResult.status}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onPing(); }}
            disabled={pinging}
            className="border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] disabled:opacity-40"
            style={{ borderColor: `${palette.cyan}44`, color: palette.cyan }}
          >
            {pinging ? "..." : "Ping"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]"
            style={{ borderColor: `${palette.red}44`, color: palette.red }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function SidecarView({ onBack }: { onBack: () => void }) {
  const [devices, setDevices] = useState<SidecarDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, SidecarPing>>({});
  const [pinging, setPinging] = useState<Record<string, boolean>>({});

  // Add device form
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [addName, setAddName] = useState("");
  const [addAddress, setAddAddress] = useState("http://");
  const [addSecret, setAddSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Server form
  const [serverPort, setServerPort] = useState("7878");
  const [serverSecret, setServerSecret] = useState("");
  const [serverRunning, setServerRunning] = useState(false);
  const [serverResult, setServerResult] = useState<string | null>(null);

  // Broadcast command
  const [broadcastCmd, setBroadcastCmd] = useState("");
  const [broadcastRunning, setBroadcastRunning] = useState(false);
  const [broadcastResults, setBroadcastResults] = useState<any[]>([]);

  // Per-device terminal
  const [terminalCmd, setTerminalCmd] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const devs = await invoke<SidecarDevice[]>("sidecar_list_devices");
      setDevices(devs);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("sidecar_status_update", () => {
      load();
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [load]);

  async function pingDevice(id: string) {
    setPinging((p) => ({ ...p, [id]: true }));
    try {
      const result = await invoke<SidecarPing>("sidecar_ping_device", { id });
      setPingResults((p) => ({ ...p, [id]: result }));
      await load();
    } catch {
      // silent
    } finally {
      setPinging((p) => ({ ...p, [id]: false }));
    }
  }

  async function removeDevice(id: string) {
    await invoke("sidecar_remove_device", { id }).catch(() => {});
    if (selectedDevice === id) setSelectedDevice(null);
    await load();
  }

  async function addDevice() {
    if (!addName.trim() || !addAddress.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await invoke<string>("sidecar_register_device", {
        name: addName,
        address: addAddress,
        secret: addSecret,
      });
      setAddName(""); setAddAddress("http://"); setAddSecret("");
      setShowAddDevice(false);
      await load();
    } catch (e: any) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  }

  async function startServer() {
    setServerRunning(true);
    try {
      const result = await invoke<string>("sidecar_start_server", {
        port: parseInt(serverPort) || 7878,
        secret: serverSecret,
      });
      setServerResult(result);
    } catch (e: any) {
      setServerResult(`ERROR: ${e}`);
    } finally {
      setServerRunning(false);
    }
  }

  async function broadcast() {
    if (!broadcastCmd.trim()) return;
    setBroadcastRunning(true);
    setBroadcastResults([]);
    try {
      const results = await invoke<any[]>("sidecar_run_all", { command: broadcastCmd });
      setBroadcastResults(results);
    } catch (e: any) {
      setBroadcastResults([{ error: String(e) }]);
    } finally {
      setBroadcastRunning(false);
    }
  }

  async function runOnDevice(deviceId: string) {
    if (!terminalCmd.trim()) return;
    setTerminalRunning(true);
    setTerminalOutput(null);
    try {
      const output = await invoke<string>("sidecar_run_command", {
        deviceId,
        command: terminalCmd,
      });
      setTerminalOutput(output);
    } catch (e: any) {
      setTerminalOutput(`ERROR: ${e}`);
    } finally {
      setTerminalRunning(false);
    }
  }

  const onlineCount = devices.filter((d) => d.status === "online").length;
  const selectedDev = devices.find((d) => d.id === selectedDevice) ?? null;

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center font-mono text-sm uppercase tracking-[0.3em]"
        style={{ color: palette.green, backgroundColor: palette.bg, textShadow: `0 0 10px ${palette.green}88` }}
      >
        Scanning network...
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden font-mono"
      style={{
        background:
          "radial-gradient(circle at top, rgba(0,229,255,0.05) 0%, rgba(0,255,65,0.02) 18%, rgba(10,10,10,1) 55%), #0a0a0a",
        color: palette.green,
      }}
    >
      <style>{`
        @keyframes sidecar-pulse {
          0%, 100% { box-shadow: 0 0 6px rgba(0,255,65,0.5); }
          50% { box-shadow: 0 0 16px rgba(0,255,65,0.9); }
        }
        @keyframes sidecar-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.45; }
        }
        @keyframes sidecar-flicker {
          0%, 100% { opacity: 0.18; }
          50% { opacity: 0.26; }
        }
        @keyframes sidecar-scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)",
          animation: "sidecar-flicker 4s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 90px rgba(0,0,0,0.72)" }}
      />

      {/* Header */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: palette.line, backgroundColor: "rgba(10, 16, 10, 0.92)" }}
      >
        <button
          onClick={onBack}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ borderColor: palette.line, color: palette.amber }}
        >
          &lt; Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="grid grid-cols-3 gap-[3px] shrink-0">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[5px] w-[5px]"
                  style={{
                    backgroundColor: i < onlineCount ? palette.cyan : "rgba(0,229,255,0.2)",
                    boxShadow: i < onlineCount ? `0 0 6px ${palette.cyan}88` : "none",
                  }}
                />
              ))}
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.32em]" style={{ color: "#d5ffd8" }}>
              BLADE Network
            </div>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.dim }}>
            {onlineCount}/{devices.length} nodes online | sidecar mesh protocol
          </div>
        </div>
        <button
          onClick={load}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ borderColor: palette.line, color: palette.green }}
        >
          Refresh
        </button>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="space-y-4">

          {/* Device Map */}
          <SectionFrame title={`CONNECTED NODES [${devices.length}]`}>
            <button
              onClick={() => setShowAddDevice(!showAddDevice)}
              className="mb-4 border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]"
              style={{ borderColor: palette.cyan, color: palette.cyan }}
            >
              {showAddDevice ? "Cancel" : "+ Add Device"}
            </button>

            {/* Add Device Form */}
            {showAddDevice && (
              <div className="mb-4 space-y-3 border p-3" style={{ borderColor: `${palette.cyan}44` }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: palette.cyan }}>
                  Register Device
                </div>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Device name"
                  className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                />
                <input
                  value={addAddress}
                  onChange={(e) => setAddAddress(e.target.value)}
                  placeholder="http://192.168.1.x:7878"
                  className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                />
                <input
                  type="password"
                  value={addSecret}
                  onChange={(e) => setAddSecret(e.target.value)}
                  placeholder="Shared secret"
                  className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                />
                {addError && (
                  <div className="text-[11px]" style={{ color: palette.red }}>
                    {addError}
                  </div>
                )}
                <button
                  onClick={addDevice}
                  disabled={adding || !addName.trim()}
                  className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                  style={{ borderColor: palette.cyan, color: palette.cyan }}
                >
                  {adding ? "Registering..." : "Register Device"}
                </button>
              </div>
            )}

            {devices.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No devices registered. Add a device or start the sidecar server on another machine.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {devices.map((device) => (
                  <DeviceNode
                    key={device.id}
                    device={device}
                    selected={selectedDevice === device.id}
                    onSelect={() =>
                      setSelectedDevice((prev) => (prev === device.id ? null : device.id))
                    }
                    onPing={() => pingDevice(device.id)}
                    onRemove={() => removeDevice(device.id)}
                    pingResult={pingResults[device.id] ?? null}
                    pinging={pinging[device.id] ?? false}
                  />
                ))}
              </div>
            )}
          </SectionFrame>

          {/* Per-Device Terminal */}
          {selectedDev && (
            <SectionFrame title={`TERMINAL :: ${selectedDev.hostname || selectedDev.name}`}>
              <div className="space-y-3">
                <div
                  className="flex items-center gap-2 border px-3 py-2"
                  style={{ borderColor: `${palette.cyan}44`, backgroundColor: "rgba(0,0,0,0.22)" }}
                >
                  <span style={{ color: palette.cyan }}>
                    {selectedDev.hostname}$
                  </span>
                  <input
                    value={terminalCmd}
                    onChange={(e) => setTerminalCmd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !terminalRunning) runOnDevice(selectedDev.id);
                    }}
                    placeholder="Enter command..."
                    className="flex-1 bg-transparent text-[12px] outline-none"
                    style={{ color: palette.green, caretColor: palette.green }}
                    autoFocus
                  />
                  <button
                    onClick={() => runOnDevice(selectedDev.id)}
                    disabled={terminalRunning || !terminalCmd.trim()}
                    className="border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] disabled:opacity-40"
                    style={{ borderColor: `${palette.cyan}55`, color: palette.cyan }}
                  >
                    {terminalRunning ? "..." : "Run"}
                  </button>
                </div>
                {terminalOutput && (
                  <div
                    className="border p-3 text-[11px] leading-relaxed"
                    style={{
                      borderColor: palette.line,
                      backgroundColor: "rgba(0,0,0,0.4)",
                      color: palette.green,
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                      maxHeight: "200px",
                      overflowY: "auto",
                    }}
                  >
                    {terminalOutput}
                  </div>
                )}
              </div>
            </SectionFrame>
          )}

          {/* Command Broadcast */}
          <SectionFrame title="BROADCAST COMMAND">
            <div className="text-[10px] mb-3 uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              Execute command on all online devices simultaneously
            </div>
            <div className="space-y-3">
              <div
                className="flex items-center gap-2 border px-3 py-2"
                style={{ borderColor: `${palette.amber}44`, backgroundColor: "rgba(0,0,0,0.22)" }}
              >
                <span style={{ color: palette.amber }}>ALL$</span>
                <textarea
                  value={broadcastCmd}
                  onChange={(e) => setBroadcastCmd(e.target.value)}
                  rows={2}
                  placeholder="Command to run on all devices..."
                  className="flex-1 resize-none bg-transparent text-[12px] outline-none"
                  style={{ color: palette.green, caretColor: palette.green }}
                />
              </div>
              <button
                onClick={broadcast}
                disabled={broadcastRunning || !broadcastCmd.trim() || onlineCount === 0}
                className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                style={{ borderColor: palette.amber, color: palette.amber }}
              >
                {broadcastRunning
                  ? "Broadcasting..."
                  : `Run on All [${onlineCount} online]`}
              </button>
              {broadcastResults.length > 0 && (
                <div className="space-y-2">
                  {broadcastResults.map((result: any, i) => (
                    <div
                      key={i}
                      className="border p-2"
                      style={{ borderColor: palette.line, backgroundColor: "rgba(0,0,0,0.22)" }}
                    >
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: palette.amber }}>
                        {devices[i]?.hostname ?? `Device ${i + 1}`}
                      </div>
                      <div
                        className="text-[11px] leading-relaxed"
                        style={{ color: palette.green, whiteSpace: "pre-wrap" }}
                      >
                        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionFrame>

          {/* This Machine / Server */}
          <SectionFrame title="THIS MACHINE :: SIDECAR SERVER">
            <div className="text-[10px] mb-3 uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              Start BLADE sidecar server on this machine so other devices can connect
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.amber }}>
                    Port
                  </label>
                  <input
                    type="number"
                    value={serverPort}
                    onChange={(e) => setServerPort(e.target.value)}
                    className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.amber }}>
                    Shared Secret
                  </label>
                  <input
                    type="password"
                    value={serverSecret}
                    onChange={(e) => setServerSecret(e.target.value)}
                    placeholder="Secret key"
                    className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
              </div>
              <button
                onClick={startServer}
                disabled={serverRunning}
                className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                style={{ borderColor: palette.green, color: palette.green }}
              >
                {serverRunning ? (
                  <span style={{ animation: "sidecar-blink 1s steps(2) infinite" }}>
                    Starting server...
                  </span>
                ) : `Start Sidecar Server [:${serverPort}]`}
              </button>
              {serverResult && (
                <div
                  className="border p-3 text-[11px] leading-relaxed"
                  style={{
                    borderColor: serverResult.startsWith("ERROR") ? palette.red : palette.green,
                    color: serverResult.startsWith("ERROR") ? palette.red : palette.green,
                    backgroundColor: "rgba(0,0,0,0.22)",
                  }}
                >
                  {serverResult}
                </div>
              )}
            </div>
          </SectionFrame>

        </div>
      </div>
    </div>
  );
}
