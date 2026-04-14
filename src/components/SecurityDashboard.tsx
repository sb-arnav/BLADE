import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface NetworkConnection {
  remote_addr?: string;
  local_addr?: string;
  protocol?: string;
  state?: string;
  process?: string;
  suspicious: boolean;
  [key: string]: unknown;
}

interface NetworkOverview {
  total_connections: number;
  suspicious_count: number;
  connections: NetworkConnection[];
}

interface SensitiveFile {
  path: string;
  gitignored?: boolean;
  protected?: boolean;
  [key: string]: unknown;
}

interface SecurityOverview {
  network: NetworkOverview;
  sensitive_files: SensitiveFile[];
  last_scan: string | null;
}

interface UrlCheckResult {
  safe: boolean;
  score?: number;
  categories?: string[];
  message?: string;
  [key: string]: unknown;
}

function formatLastScan(ts: string | null): string {
  if (!ts) return "Never";
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString();
  } catch {
    return ts;
  }
}

function StatusCard({
  label,
  value,
  status,
  detail,
}: {
  label: string;
  value: string;
  status: "green" | "yellow" | "red" | "neutral";
  detail?: string;
}) {
  const statusClasses = {
    green: "border-green-700/50 bg-green-500/5",
    yellow: "border-yellow-700/50 bg-yellow-500/5",
    red: "border-red-700/50 bg-red-500/5",
    neutral: "border-blade-border bg-blade-surface",
  };
  const dotClasses = {
    green: "bg-green-400",
    yellow: "bg-yellow-400",
    red: "bg-red-400",
    neutral: "bg-blade-muted",
  };
  const valueClasses = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
    neutral: "text-blade-text",
  };
  return (
    <div className={`border rounded-lg p-3 space-y-1 ${statusClasses[status]}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[status]}`} />
        <span className="text-[10px] text-blade-muted uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-base font-bold ${valueClasses[status]}`}>{value}</p>
      {detail && <p className="text-[10px] text-blade-muted">{detail}</p>}
    </div>
  );
}

export function SecurityDashboard({ onBack }: { onBack: () => void }) {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [urlInput, setUrlInput] = useState("");
  const [urlChecking, setUrlChecking] = useState(false);
  const [urlResult, setUrlResult] = useState<UrlCheckResult | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<SecurityOverview>("security_overview");
      setOverview(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleScanNow() {
    setScanning(true);
    try {
      await Promise.all([
        invoke("security_scan_network").catch(() => {}),
        invoke("security_scan_sensitive_files").catch(() => {}),
      ]);
      await load();
    } finally {
      setScanning(false);
    }
  }

  async function handleCheckUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setUrlChecking(true);
    setUrlResult(null);
    setUrlError(null);
    try {
      const result = await invoke<UrlCheckResult>("security_check_url", { url });
      setUrlResult(result);
    } catch (e) {
      setUrlError(String(e));
    } finally {
      setUrlChecking(false);
    }
  }

  const networkStatus = (): "green" | "yellow" | "red" => {
    if (!overview) return "neutral" as "green";
    if (overview.network.suspicious_count === 0) return "green";
    if (overview.network.suspicious_count <= 2) return "yellow";
    return "red";
  };

  const unprotectedCount = overview?.sensitive_files.filter(
    (f) => !f.gitignored && !f.protected
  ).length ?? 0;

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-blade-border bg-blade-surface/60 sticky top-0 z-10">
        <button
          onClick={onBack}
          className="text-blade-muted hover:text-blade-accent transition-colors"
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
        </button>
        <span className="text-blade-accent text-sm font-semibold tracking-wide">Security</span>
        <div className="flex-1" />
        <button
          onClick={handleScanNow}
          disabled={scanning || loading}
          className="px-3 py-1 text-xs font-medium rounded border border-blade-border text-blade-secondary hover:border-blade-accent/50 hover:text-blade-accent transition-all disabled:opacity-40 bg-blade-surface"
        >
          {scanning ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
          </div>
        )}
        {error && (
          <div className="border border-red-700/40 rounded-lg bg-red-900/10 p-4 text-xs text-red-400">
            Failed to load security overview: {error}
          </div>
        )}

        {!loading && overview && (
          <>
            {/* Status cards */}
            <div className="grid grid-cols-3 gap-3">
              <StatusCard
                label="Network"
                value={`${overview.network.suspicious_count} suspicious`}
                status={networkStatus()}
                detail={`${overview.network.total_connections} total connections`}
              />
              <StatusCard
                label="Sensitive Files"
                value={`${unprotectedCount} exposed`}
                status={unprotectedCount === 0 ? "green" : unprotectedCount <= 3 ? "yellow" : "red"}
                detail={`${overview.sensitive_files.length} files tracked`}
              />
              <StatusCard
                label="Last Scan"
                value={formatLastScan(overview.last_scan)}
                status="neutral"
                detail="Network + files"
              />
            </div>

            {/* Network connections */}
            <div className="border border-blade-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-blade-border bg-blade-surface/60">
                <span className="text-xs font-semibold text-blade-secondary uppercase tracking-wide">
                  Network Connections
                </span>
                <span className="ml-auto text-[10px] text-blade-muted">
                  {overview.network.total_connections} total
                  {overview.network.suspicious_count > 0 && (
                    <span className="text-red-400 ml-1">· {overview.network.suspicious_count} suspicious</span>
                  )}
                </span>
              </div>
              {overview.network.connections.length === 0 ? (
                <div className="px-3 py-4 text-xs text-blade-muted italic text-center">No connections recorded</div>
              ) : (
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-blade-surface/90">
                      <tr className="text-blade-muted text-[10px] uppercase tracking-wide">
                        <th className="text-left px-3 py-1.5">Remote</th>
                        <th className="text-left px-3 py-1.5">Protocol</th>
                        <th className="text-left px-3 py-1.5">State</th>
                        <th className="text-left px-3 py-1.5">Process</th>
                        <th className="text-left px-3 py-1.5">Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.network.connections.map((conn, i) => (
                        <tr
                          key={i}
                          className={`border-t border-blade-border/40 transition-colors ${conn.suspicious ? "bg-red-900/10 hover:bg-red-900/15" : "hover:bg-blade-surface/40"}`}
                        >
                          <td className={`px-3 py-1.5 font-mono text-[11px] ${conn.suspicious ? "text-red-400" : "text-blade-text"}`}>
                            {conn.remote_addr ?? "—"}
                          </td>
                          <td className="px-3 py-1.5 text-blade-muted">{conn.protocol ?? "—"}</td>
                          <td className="px-3 py-1.5 text-blade-muted">{conn.state ?? "—"}</td>
                          <td className="px-3 py-1.5 text-blade-muted truncate max-w-[120px]">{conn.process ?? "—"}</td>
                          <td className="px-3 py-1.5">
                            {conn.suspicious ? (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-700/40 font-medium">
                                suspicious
                              </span>
                            ) : (
                              <span className="text-[9px] text-blade-muted">ok</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Sensitive files */}
            <div className="border border-blade-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-blade-border bg-blade-surface/60">
                <span className="text-xs font-semibold text-blade-secondary uppercase tracking-wide">
                  Sensitive Files
                </span>
                <span className="ml-auto text-[10px] text-blade-muted">{overview.sensitive_files.length} tracked</span>
              </div>
              {overview.sensitive_files.length === 0 ? (
                <div className="px-3 py-4 text-xs text-blade-muted italic text-center">No sensitive files detected</div>
              ) : (
                <div className="max-h-52 overflow-y-auto">
                  {overview.sensitive_files.map((file, i) => {
                    const isProtected = file.gitignored || file.protected;
                    return (
                      <div
                        key={i}
                        className={`flex items-center justify-between gap-3 px-3 py-2 border-t border-blade-border/40 text-xs ${
                          i === 0 ? "border-t-0" : ""
                        } ${!isProtected ? "bg-yellow-500/3" : ""}`}
                      >
                        <span className={`font-mono text-[11px] truncate ${!isProtected ? "text-yellow-400/80" : "text-blade-muted"}`}>
                          {file.path}
                        </span>
                        <div className="flex gap-1.5 shrink-0">
                          {file.gitignored && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-700/30">
                              gitignored
                            </span>
                          )}
                          {file.protected && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-700/30">
                              protected
                            </span>
                          )}
                          {!isProtected && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-700/30">
                              exposed
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* URL checker */}
        <div className="border border-blade-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-blade-border bg-blade-surface/60">
            <span className="text-xs font-semibold text-blade-secondary uppercase tracking-wide">URL Safety Check</span>
          </div>
          <div className="p-3 space-y-3">
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCheckUrl(); }}
                placeholder="https://example.com"
                className="flex-1 bg-blade-bg border border-blade-border rounded px-3 py-1.5 text-xs text-blade-text placeholder-blade-muted focus:outline-none focus:border-blade-accent/50 font-mono"
              />
              <button
                onClick={handleCheckUrl}
                disabled={urlChecking || !urlInput.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded border border-blade-border text-blade-secondary hover:border-blade-accent/50 hover:text-blade-accent transition-all disabled:opacity-40 bg-blade-surface shrink-0"
              >
                {urlChecking ? "Checking..." : "Check"}
              </button>
            </div>

            {urlError && (
              <div className="text-xs text-red-400 border border-red-700/40 rounded bg-red-900/10 px-3 py-2">
                {urlError}
              </div>
            )}

            {urlResult && (
              <div className={`border rounded px-3 py-2 space-y-1 ${urlResult.safe ? "border-green-700/50 bg-green-500/5" : "border-red-700/50 bg-red-900/10"}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${urlResult.safe ? "bg-green-400" : "bg-red-400"}`} />
                  <span className={`text-xs font-semibold ${urlResult.safe ? "text-green-400" : "text-red-400"}`}>
                    {urlResult.safe ? "Safe" : "Potentially unsafe"}
                  </span>
                  {urlResult.score !== undefined && (
                    <span className="text-[10px] text-blade-muted ml-auto">Score: {urlResult.score}</span>
                  )}
                </div>
                {urlResult.message && (
                  <p className="text-xs text-blade-secondary">{urlResult.message}</p>
                )}
                {urlResult.categories && urlResult.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {urlResult.categories.map((cat, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-blade-border/30 text-blade-muted border border-blade-border/20">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
