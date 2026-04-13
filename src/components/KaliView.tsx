import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
  recommendation: string;
}

interface ScanResult {
  target: string;
  tool: string;
  output: string;
  findings: Finding[];
  timestamp: number;
}

type Tab = "recon" | "hash" | "ctf" | "payload" | "explain";

// ── Palette ───────────────────────────────────────────────────────────────────

const p = {
  bg: "#020d02",
  panel: "#041004",
  panelAlt: "#030d03",
  green: "#00ff41",
  greenDim: "rgba(0,255,65,0.6)",
  greenFaint: "rgba(0,255,65,0.12)",
  amber: "#ffb000",
  red: "#ff0040",
  orange: "#ff6b00",
  yellow: "#ffe000",
  critical: "#ff0040",
  high: "#ff6b00",
  medium: "#ffe000",
  low: "#00ff41",
  info: "rgba(0,255,65,0.5)",
  line: "rgba(0,255,65,0.22)",
  dim: "rgba(0,255,65,0.5)",
  muted: "rgba(130,255,160,0.65)",
} as const;

const TOOL_NAMES = [
  "nmap", "hashcat", "john", "nikto", "sqlmap", "gobuster",
  "metasploit", "hydra", "aircrack", "wireshark",
];

const HASH_TYPES = [
  { value: "", label: "Auto-detect" },
  { value: "md5", label: "MD5" },
  { value: "sha1", label: "SHA-1" },
  { value: "sha256", label: "SHA-256" },
  { value: "ntlm", label: "NTLM" },
  { value: "bcrypt", label: "bcrypt" },
];

const CTF_CATEGORIES = ["pwn", "web", "crypto", "forensics", "rev", "misc"];

const PAYLOAD_TYPES = [
  { key: "xss", label: "XSS", color: p.yellow },
  { key: "sqli", label: "SQLi", color: p.amber },
  { key: "command", label: "Command Inj", color: p.orange },
  { key: "reverse_shell", label: "Reverse Shell", color: p.red },
];

const SEVERITY_COLOR: Record<Finding["severity"], string> = {
  critical: p.critical,
  high: p.high,
  medium: p.medium,
  low: p.low,
  info: p.info,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function useAnimDots(active: boolean): string {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    if (!active) { setDots("."); return; }
    const id = setInterval(() => setDots((d) => d.length >= 3 ? "." : d + "."), 420);
    return () => clearInterval(id);
  }, [active]);
  return dots;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    /* silently fail in Tauri context */
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TerminalBlock({
  content,
  minHeight = "8rem",
  placeholder = "",
}: {
  content: string;
  minHeight?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [content]);

  return (
    <div
      ref={ref}
      style={{
        background: "#000",
        border: `1px solid ${p.line}`,
        minHeight,
        maxHeight: "22rem",
        overflowY: "auto",
        padding: "0.6rem 0.75rem",
        fontFamily: "monospace",
        fontSize: "11px",
        color: content ? p.green : p.dim,
        letterSpacing: "0.06em",
        lineHeight: 1.7,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        boxShadow: `inset 0 0 20px rgba(0,0,0,0.6)`,
      }}
    >
      {content || placeholder}
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLOR[f.severity];

  return (
    <div
      style={{
        border: `1px solid ${color}33`,
        backgroundColor: `${color}08`,
        marginBottom: "4px",
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          width: "100%",
          background: "none",
          border: "none",
          padding: "6px 8px",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "monospace",
        }}
      >
        <span
          style={{
            fontSize: "8px",
            fontWeight: "bold",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color,
            border: `1px solid ${color}`,
            padding: "1px 5px",
            flexShrink: 0,
          }}
        >
          {f.severity}
        </span>
        <span
          style={{
            fontSize: "11px",
            color: "#c8ffd0",
            fontWeight: "bold",
            letterSpacing: "0.08em",
            flex: 1,
          }}
        >
          {f.title}
        </span>
        <span style={{ color: p.dim, fontSize: "10px" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ padding: "0 8px 8px", fontSize: "10px", lineHeight: 1.7, letterSpacing: "0.06em" }}>
          <div style={{ color: p.muted, marginBottom: "4px" }}>{f.detail}</div>
          {f.recommendation && (
            <div style={{ color: p.amber }}>
              ▶ REC: {f.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? p.greenFaint : "none",
        border: `1px solid ${active ? p.green : p.line}`,
        color: active ? p.green : p.muted,
        fontSize: "10px",
        fontWeight: active ? "bold" : "normal",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        padding: "6px 14px",
        cursor: "pointer",
        fontFamily: "monospace",
        boxShadow: active ? `0 0 10px rgba(0,255,65,0.18)` : "none",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function InputField({
  value,
  onChange,
  placeholder,
  style: extraStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "#000",
        border: `1px solid ${p.line}`,
        color: p.green,
        fontFamily: "monospace",
        fontSize: "12px",
        padding: "7px 10px",
        outline: "none",
        letterSpacing: "0.06em",
        width: "100%",
        boxSizing: "border-box",
        ...extraStyle,
      }}
    />
  );
}

function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        background: "#000",
        border: `1px solid ${p.line}`,
        color: p.green,
        fontFamily: "monospace",
        fontSize: "11px",
        padding: "7px 10px",
        outline: "none",
        letterSpacing: "0.06em",
        width: "100%",
        resize: "vertical",
        boxSizing: "border-box",
      }}
    />
  );
}

function RunBtn({
  onClick,
  loading,
  label,
  loadingLabel,
  color = p.green,
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
  loadingLabel?: string;
  color?: string;
}) {
  const dots = useAnimDots(loading);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        border: `1px solid ${color}`,
        color,
        background: `${color}0d`,
        fontSize: "11px",
        fontWeight: "bold",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        padding: "8px 20px",
        cursor: loading ? "not-allowed" : "pointer",
        fontFamily: "monospace",
        opacity: loading ? 0.7 : 1,
        flexShrink: 0,
      }}
    >
      {loading ? (loadingLabel ?? label) + dots : label}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "9px",
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: p.amber,
        marginBottom: "5px",
      }}
    >
      {children}
    </div>
  );
}

// ── Tab: RECON ────────────────────────────────────────────────────────────────

function ReconTab() {
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dots = useAnimDots(loading);

  const run = async () => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await invoke<ScanResult>("kali_recon", { target: target.trim() });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <Label>Target (IP, domain, or URL)</Label>
          <InputField
            value={target}
            onChange={setTarget}
            placeholder="192.168.1.1 | example.com | https://target.io"
          />
        </div>
        <RunBtn
          onClick={run}
          loading={loading}
          label="Run Recon"
          loadingLabel="Running nmap"
          color={p.green}
        />
      </div>

      {loading && (
        <div
          style={{
            fontSize: "11px",
            color: p.green,
            fontFamily: "monospace",
            letterSpacing: "0.12em",
            padding: "6px 0",
            animation: "kali-blink 1s steps(2,end) infinite",
          }}
        >
          Running nmap{dots} scanning {target || "target"}...
        </div>
      )}

      {error && (
        <div
          style={{
            border: `1px solid rgba(255,0,64,0.4)`,
            backgroundColor: "rgba(255,0,64,0.05)",
            padding: "8px 10px",
            fontSize: "10px",
            color: p.red,
            letterSpacing: "0.1em",
            fontFamily: "monospace",
          }}
        >
          ERR: {error}
        </div>
      )}

      {result && (
        <>
          <div>
            <Label>Raw Output — {result.tool}</Label>
            <TerminalBlock content={result.output} placeholder="Awaiting scan results..." />
          </div>

          {result.findings.length > 0 && (
            <div>
              <Label>Findings [{result.findings.length}]</Label>
              {result.findings.map((f, i) => (
                <FindingRow key={i} f={f} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab: HASH CRACK ───────────────────────────────────────────────────────────

function HashTab() {
  const [hash, setHash] = useState("");
  const [hashType, setHashType] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!hash.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await invoke<string>("kali_crack_hash", {
        hash: hash.trim(),
        hashType: hashType || null,
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <Label>Hash</Label>
        <InputField
          value={hash}
          onChange={setHash}
          placeholder="Paste hash here — MD5, SHA1, NTLM, bcrypt..."
        />
      </div>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <Label>Hash Type</Label>
          <select
            value={hashType}
            onChange={(e) => setHashType(e.target.value)}
            style={{
              width: "100%",
              background: "#000",
              border: `1px solid ${p.line}`,
              color: p.green,
              fontFamily: "monospace",
              fontSize: "11px",
              padding: "7px 10px",
              outline: "none",
              letterSpacing: "0.06em",
              cursor: "pointer",
            }}
          >
            {HASH_TYPES.map((ht) => (
              <option key={ht.value} value={ht.value}>
                {ht.label}
              </option>
            ))}
          </select>
        </div>
        <RunBtn
          onClick={run}
          loading={loading}
          label="Crack"
          loadingLabel="Cracking"
          color={p.amber}
        />
      </div>

      {error && (
        <div
          style={{
            border: `1px solid rgba(255,0,64,0.4)`,
            backgroundColor: "rgba(255,0,64,0.05)",
            padding: "8px 10px",
            fontSize: "10px",
            color: p.red,
            letterSpacing: "0.1em",
            fontFamily: "monospace",
          }}
        >
          ERR: {error}
        </div>
      )}

      {result !== null && (
        <div>
          <Label>Result</Label>
          <TerminalBlock content={result} placeholder="" minHeight="4rem" />
        </div>
      )}
    </div>
  );
}

// ── Tab: CTF SOLVER ───────────────────────────────────────────────────────────

function CtfTab() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("web");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await invoke<string>("kali_analyze_ctf", {
        name,
        category,
        description,
        files: [],
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.75rem" }}>
        <div>
          <Label>Challenge Name</Label>
          <InputField value={name} onChange={setName} placeholder="e.g. baby-rop, jwt-master, magic-bytes" />
        </div>
        <div>
          <Label>Category</Label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              background: "#000",
              border: `1px solid ${p.line}`,
              color: p.green,
              fontFamily: "monospace",
              fontSize: "11px",
              padding: "7px 10px",
              outline: "none",
              letterSpacing: "0.06em",
              cursor: "pointer",
              textTransform: "uppercase",
              height: "100%",
            }}
          >
            {CTF_CATEGORIES.map((c) => (
              <option key={c} value={c} style={{ textTransform: "uppercase" }}>
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label>Description / Challenge Text</Label>
        <TextAreaField
          value={description}
          onChange={setDescription}
          placeholder="Paste the challenge description, hints, or any context..."
          rows={5}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <RunBtn
          onClick={run}
          loading={loading}
          label="Get Attack Plan"
          loadingLabel="Analyzing"
          color={p.green}
        />
      </div>

      {error && (
        <div
          style={{
            border: `1px solid rgba(255,0,64,0.4)`,
            backgroundColor: "rgba(255,0,64,0.05)",
            padding: "8px 10px",
            fontSize: "10px",
            color: p.red,
            letterSpacing: "0.1em",
            fontFamily: "monospace",
          }}
        >
          ERR: {error}
        </div>
      )}

      {result !== null && (
        <div>
          <Label>Attack Plan</Label>
          <TerminalBlock content={result} placeholder="" minHeight="10rem" />
        </div>
      )}
    </div>
  );
}

// ── Tab: PAYLOAD GEN ──────────────────────────────────────────────────────────

function PayloadTab() {
  const [payloadType, setPayloadType] = useState("xss");
  const [targetInfo, setTargetInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const r = await invoke<string>("kali_generate_payload", {
        payloadType,
        targetInfo,
      });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (result) {
      copyToClipboard(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <Label>Payload Type</Label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {PAYLOAD_TYPES.map((pt) => (
            <button
              key={pt.key}
              onClick={() => setPayloadType(pt.key)}
              style={{
                border: `1px solid ${pt.color}`,
                color: payloadType === pt.key ? "#000" : pt.color,
                background: payloadType === pt.key ? pt.color : `${pt.color}0d`,
                fontSize: "10px",
                fontWeight: "bold",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                padding: "6px 14px",
                cursor: "pointer",
                fontFamily: "monospace",
                transition: "all 0.12s",
              }}
            >
              {pt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>Target Info (optional — context helps)</Label>
        <TextAreaField
          value={targetInfo}
          onChange={setTargetInfo}
          placeholder="e.g. Apache 2.4 on Ubuntu, PHP backend, WAF detected, parameter: ?name="
          rows={3}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <RunBtn
          onClick={run}
          loading={loading}
          label="Generate"
          loadingLabel="Generating"
          color={PAYLOAD_TYPES.find((pt) => pt.key === payloadType)?.color ?? p.green}
        />
      </div>

      {error && (
        <div
          style={{
            border: `1px solid rgba(255,0,64,0.4)`,
            backgroundColor: "rgba(255,0,64,0.05)",
            padding: "8px 10px",
            fontSize: "10px",
            color: p.red,
            letterSpacing: "0.1em",
            fontFamily: "monospace",
          }}
        >
          ERR: {error}
        </div>
      )}

      {result !== null && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "5px",
            }}
          >
            <Label>Generated Payloads</Label>
            <button
              onClick={handleCopy}
              style={{
                background: "none",
                border: `1px solid ${p.line}`,
                color: copied ? p.green : p.muted,
                fontSize: "9px",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                padding: "3px 10px",
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              {copied ? "Copied!" : "Copy All"}
            </button>
          </div>
          <TerminalBlock content={result} placeholder="" minHeight="10rem" />
        </div>
      )}
    </div>
  );
}

// ── Tab: EXPLOIT EXPLAIN ──────────────────────────────────────────────────────

function ExplainTab() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await invoke<string>("kali_explain_exploit", { code: code.trim() });
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <Label>Exploit / PoC Code</Label>
        <TextAreaField
          value={code}
          onChange={setCode}
          placeholder={"Paste exploit code, PoC, shellcode, or any security script...\n\n# Python, C, bash, JS — anything goes"}
          rows={9}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <RunBtn
          onClick={run}
          loading={loading}
          label="Explain"
          loadingLabel="Analyzing"
          color={p.amber}
        />
      </div>

      {error && (
        <div
          style={{
            border: `1px solid rgba(255,0,64,0.4)`,
            backgroundColor: "rgba(255,0,64,0.05)",
            padding: "8px 10px",
            fontSize: "10px",
            color: p.red,
            letterSpacing: "0.1em",
            fontFamily: "monospace",
          }}
        >
          ERR: {error}
        </div>
      )}

      {result !== null && (
        <div>
          <Label>Explanation</Label>
          <TerminalBlock content={result} placeholder="" minHeight="10rem" />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function KaliView({ onBack }: { onBack: () => void }) {
  const [tools, setTools] = useState<Record<string, boolean>>({});
  const [toolsLoaded, setToolsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("recon");
  const [cursorOn, setCursorOn] = useState(true);

  // Blinking cursor for header
  useEffect(() => {
    const id = setInterval(() => setCursorOn((c) => !c), 600);
    return () => clearInterval(id);
  }, []);

  // Load tool inventory
  const loadTools = useCallback(async () => {
    try {
      const t = await invoke<Record<string, boolean>>("kali_check_tools");
      setTools(t);
    } catch {
      // If command doesn't exist yet, populate with defaults
      const defaults: Record<string, boolean> = {};
      TOOL_NAMES.forEach((n) => (defaults[n] = false));
      setTools(defaults);
    } finally {
      setToolsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const installedCount = Object.values(tools).filter(Boolean).length;
  const totalCount = Object.keys(tools).length || TOOL_NAMES.length;

  const TAB_CONFIG: { id: Tab; label: string }[] = [
    { id: "recon", label: "RECON" },
    { id: "hash", label: "HASH CRACK" },
    { id: "ctf", label: "CTF SOLVER" },
    { id: "payload", label: "PAYLOAD GEN" },
    { id: "explain", label: "EXPLOIT EXPLAIN" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontFamily: "monospace",
        background: p.bg,
        color: p.green,
        position: "relative",
      }}
    >
      <style>{`
        @keyframes kali-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.25; }
        }
        @keyframes kali-scanline {
          0% { background-position: 0 0; }
          100% { background-position: 0 100%; }
        }
        @keyframes kali-flicker {
          0%, 100% { opacity: 0.12; }
          47% { opacity: 0.17; }
          50% { opacity: 0.09; }
          53% { opacity: 0.17; }
        }
        @keyframes kali-matrix-drift {
          0% { transform: translateY(-100%); opacity: 0.6; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
      `}</style>

      {/* CRT scanline overlay */}
      <div
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(180deg, rgba(0,255,65,0.025) 0px, rgba(0,255,65,0.025) 1px, transparent 1px, transparent 3px)",
          animation: "kali-flicker 5s linear infinite",
          zIndex: 0,
        }}
      />
      {/* Vignette */}
      <div
        style={{
          pointerEvents: "none",
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 100px rgba(0,0,0,0.85)",
          zIndex: 0,
        }}
      />

      {/* ── Header ── */}
      <header
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          borderBottom: `1px solid ${p.line}`,
          backgroundColor: "rgba(2,13,2,0.96)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            border: `1px solid ${p.line}`,
            color: p.amber,
            background: "none",
            padding: "4px 12px",
            fontSize: "11px",
            fontWeight: "bold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
            fontFamily: "monospace",
          }}
        >
          &lt; Back
        </button>

        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: p.green,
              textShadow: `0 0 14px ${p.green}88`,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            BLADE SECURITY OPS
            <span
              style={{
                display: "inline-block",
                width: "2px",
                height: "14px",
                backgroundColor: p.green,
                marginLeft: "2px",
                opacity: cursorOn ? 1 : 0,
                transition: "opacity 0.05s",
                boxShadow: `0 0 8px ${p.green}`,
              }}
            />
          </div>
          <div
            style={{
              marginTop: "2px",
              fontSize: "9px",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: p.dim,
            }}
          >
            {toolsLoaded
              ? `${installedCount}/${totalCount} tools installed — red team ops center`
              : "Scanning tool inventory..."}
          </div>
        </div>

        {/* Tool count badge */}
        <div
          style={{
            border: `1px solid ${installedCount > 0 ? p.green : p.red}`,
            backgroundColor: installedCount > 0 ? "rgba(0,255,65,0.06)" : "rgba(255,0,64,0.06)",
            color: installedCount > 0 ? p.green : p.red,
            fontSize: "10px",
            fontWeight: "bold",
            letterSpacing: "0.18em",
            padding: "4px 12px",
            textTransform: "uppercase",
          }}
        >
          {installedCount}/{totalCount} READY
        </div>
      </header>

      {/* ── Tool inventory grid ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flexShrink: 0,
          padding: "0.5rem 1rem",
          borderBottom: `1px solid ${p.line}`,
          backgroundColor: "rgba(0,0,0,0.4)",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: "8px",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: p.amber,
            marginRight: "4px",
            flexShrink: 0,
          }}
        >
          Tools:
        </span>
        {(Object.keys(tools).length > 0 ? Object.keys(tools) : TOOL_NAMES).map((tool) => {
          const installed = tools[tool] ?? false;
          return (
            <span
              key={tool}
              style={{
                border: `1px solid ${installed ? p.green : p.red}`,
                color: installed ? p.green : p.red,
                backgroundColor: installed
                  ? "rgba(0,255,65,0.07)"
                  : "rgba(255,0,64,0.06)",
                fontSize: "8px",
                fontWeight: "bold",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                padding: "2px 7px",
                boxShadow: installed ? `0 0 6px rgba(0,255,65,0.15)` : "none",
              }}
            >
              {tool}
            </span>
          );
        })}
      </div>

      {/* ── Tabs ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flexShrink: 0,
          display: "flex",
          gap: "0",
          padding: "0.5rem 1rem",
          borderBottom: `1px solid ${p.line}`,
          backgroundColor: "rgba(2,13,2,0.85)",
          flexWrap: "wrap",
          rowGap: "0.35rem",
        }}
      >
        {TAB_CONFIG.map((tab) => (
          <TabBtn
            key={tab.id}
            label={tab.label}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      {/* ── Tab content ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          overflowY: "auto",
          padding: "1rem",
          backgroundColor: "rgba(2,13,2,0.6)",
        }}
      >
        {activeTab === "recon" && <ReconTab />}
        {activeTab === "hash" && <HashTab />}
        {activeTab === "ctf" && <CtfTab />}
        {activeTab === "payload" && <PayloadTab />}
        {activeTab === "explain" && <ExplainTab />}
      </div>

      {/* ── Disclaimer footer ── */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          flexShrink: 0,
          borderTop: `1px solid ${p.line}`,
          padding: "5px 1rem",
          display: "flex",
          justifyContent: "center",
          backgroundColor: "rgba(2,13,2,0.9)",
        }}
      >
        <div
          style={{
            fontSize: "8px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(255,0,64,0.55)",
            textAlign: "center",
          }}
        >
          For authorized security testing, CTF competitions, and educational use only.
        </div>
      </div>
    </div>
  );
}
