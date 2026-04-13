import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";

const appWindow = getCurrentWindow();

interface BladeRole {
  id: string;
  name: string;
  icon: string;
  tagline: string;
}

const ROLES: BladeRole[] = [
  { id: "engineering", name: "Engineering", icon: "⚙", tagline: "Build, ship, debug" },
  { id: "research",    name: "Research",    icon: "◎", tagline: "Deep dive, synthesize" },
  { id: "marketing",  name: "Marketing",   icon: "◈", tagline: "Copy, reach, convert" },
  { id: "operations", name: "Operations",  icon: "▦", tagline: "Organize, delegate" },
  { id: "trading",    name: "Trading",     icon: "▲", tagline: "Analyze, position" },
  { id: "security",   name: "Security",    icon: "◆", tagline: "Find it first" },
];

function RoleSwitcher() {
  const [activeRole, setActiveRole] = useState("engineering");
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    invoke<BladeRole>("roles_get_active").then((r) => setActiveRole(r.id)).catch(() => {});
  }, []);

  const switchRole = async (id: string) => {
    setSwitching(true);
    try {
      await invoke("roles_set_active", { id });
      setActiveRole(id);
      setOpen(false);
    } catch {
      // revert optimistic state on failure — nothing to do since we didn't update yet
    } finally {
      setSwitching(false);
    }
  };

  const current = ROLES.find((r) => r.id === activeRole) ?? ROLES[0];

  return (
    <div className="relative" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <button
        onClick={() => !switching && setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] text-blade-muted hover:text-blade-text hover:bg-blade-surface transition-colors"
        title={switching ? "Switching role..." : current.tagline}
        disabled={switching}
      >
        {switching ? (
          <span className="w-2 h-2 rounded-full bg-blade-accent/50 animate-pulse" />
        ) : (
          <span className="font-mono text-blade-accent">{current.icon}</span>
        )}
        <span className={`tracking-wide ${switching ? "text-blade-muted/50" : ""}`}>{current.name.toUpperCase()}</span>
        <span className="text-blade-muted/40 ml-0.5">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-blade-surface border border-blade-border rounded-lg shadow-xl overflow-hidden min-w-[160px]">
          {ROLES.map((role) => (
            <button
              key={role.id}
              onClick={() => switchRole(role.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[10px] transition-colors ${
                role.id === activeRole
                  ? "bg-blade-accent/10 text-blade-accent"
                  : "text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover"
              }`}
            >
              <span className="font-mono w-3 text-center">{role.icon}</span>
              <div>
                <div className="font-medium">{role.name}</div>
                <div className="text-[9px] text-blade-muted/60">{role.tagline}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelBadge() {
  const [routing, setRouting] = useState<{ provider: string; model: string } | null>(null);

  useEffect(() => {
    const unlisten = listen<{ provider: string; model: string }>("chat_routing", (e) => {
      setRouting(e.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (!routing) return null;

  // Show a compact model name (strip long prefixes)
  const shortModel = routing.model
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/^gemini-/, "")
    .replace(/-\d{8}$/, "")       // strip date suffixes
    .replace(/^accounts\/.*\/models\//, "");  // strip Fireworks prefixes

  return (
    <span
      className="text-[9px] font-mono text-blade-muted/50 tracking-wide px-1.5 py-0.5 rounded border border-blade-border/30"
      title={`${routing.provider} / ${routing.model}`}
    >
      {shortModel}
    </span>
  );
}

export function TitleBar() {
  const minimize = async () => {
    try { await appWindow.minimize(); } catch {}
  };

  const toggleMaximize = async () => {
    try { await appWindow.toggleMaximize(); } catch {}
  };

  const closeWindow = async () => {
    try { await appWindow.close(); } catch {}
  };

  return (
    <div
      className="h-9 bg-blade-bg flex items-center gap-3 px-3 shrink-0 select-none border-b border-blade-border/40"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-1.5 shrink-0 pointer-events-none" data-tauri-drag-region>
        <div className="w-2 h-2 rounded-full bg-blade-accent shadow-[0_0_10px_rgba(99,102,241,0.45)]" />
        <span className="text-2xs font-semibold tracking-[0.3em] text-blade-muted">
          BLADE
        </span>
      </div>

      <div className="flex-1 h-full flex items-center justify-center gap-2" data-tauri-drag-region>
        <RoleSwitcher />
        <ModelBadge />
      </div>

      <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={minimize}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Minimize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={toggleMaximize}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Maximize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="5" y="5" width="14" height="14" rx="1.5" />
          </svg>
        </button>
        <button
          onClick={closeWindow}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-red-400 hover:bg-red-400/10 transition-colors flex items-center justify-center"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
