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

// Role accent colors — subtle tint per domain
const ROLE_COLOR: Record<string, string> = {
  engineering: "text-indigo-400",
  research:    "text-sky-400",
  marketing:   "text-pink-400",
  operations:  "text-amber-400",
  trading:     "text-emerald-400",
  security:    "text-red-400",
};

function RoleSwitcher() {
  const [activeRole, setActiveRole] = useState("engineering");
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    invoke<BladeRole>("roles_get_active").then((r) => setActiveRole(r.id)).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const switchRole = async (id: string) => {
    setSwitching(true);
    try {
      await invoke("roles_set_active", { id });
      setActiveRole(id);
      setOpen(false);
    } catch {
      // keep previous state on failure
    } finally {
      setSwitching(false);
    }
  };

  const current = ROLES.find((r) => r.id === activeRole) ?? ROLES[0];
  const roleColor = ROLE_COLOR[activeRole] ?? "text-blade-accent";

  return (
    <div
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => !switching && setOpen((o) => !o)}
        disabled={switching}
        title={switching ? "Switching…" : current.tagline}
        className={`
          flex items-center gap-1.5 h-6 px-2.5 rounded-md
          text-2xs font-medium tracking-wide
          border border-transparent
          transition-all duration-200
          ${open
            ? "bg-blade-surface-active border-blade-border text-blade-text"
            : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface hover:border-blade-border/50"
          }
        `}
      >
        {switching ? (
          <span className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse-subtle" />
        ) : (
          <span className={`font-mono text-[11px] ${roleColor}`}>{current.icon}</span>
        )}
        <span className={`uppercase tracking-[0.12em] ${switching ? "opacity-50" : ""}`}>
          {current.name}
        </span>
        <svg
          viewBox="0 0 10 6"
          className={`w-2 h-2 text-blade-muted/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          className="
            absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50
            min-w-[188px] overflow-hidden
            bg-blade-surface/95 backdrop-blur-xl
            border border-blade-border
            rounded-xl shadow-surface-xl
            animate-fade-up
          "
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-blade-border/60">
            <p className="text-3xs font-semibold uppercase tracking-[0.2em] text-blade-muted/50">
              Active Role
            </p>
          </div>

          {ROLES.map((role) => {
            const isActive = role.id === activeRole;
            const color = ROLE_COLOR[role.id] ?? "text-blade-accent";
            return (
              <button
                key={role.id}
                onClick={() => switchRole(role.id)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2.5 text-left
                  transition-all duration-150
                  ${isActive
                    ? "bg-blade-accent/10 text-blade-text"
                    : "text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover"
                  }
                `}
              >
                <span className={`font-mono text-[12px] w-4 text-center shrink-0 ${isActive ? color : "text-blade-muted/60"}`}>
                  {role.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-medium">{role.name}</span>
                  </div>
                  <p className="text-3xs text-blade-muted/50 mt-0.5">{role.tagline}</p>
                </div>
                {isActive && (
                  <svg viewBox="0 0 12 12" className={`w-2.5 h-2.5 shrink-0 ${color}`} fill="currentColor">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
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

  const shortModel = routing.model
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/^gemini-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/^accounts\/.*\/models\//, "");

  return (
    <span
      title={`${routing.provider} / ${routing.model}`}
      className="
        flex items-center gap-1
        text-2xs font-mono text-blade-muted/40
        px-2 py-0.5 rounded-md
        border border-blade-border/30
        bg-blade-surface/50
        tracking-wide
        hover:text-blade-muted/70 hover:border-blade-border/60
        transition-all duration-200 cursor-default
      "
    >
      <span className="w-1 h-1 rounded-full bg-blade-accent/40" />
      {shortModel}
    </span>
  );
}

export function TitleBar() {
  const minimize = async () => { try { await appWindow.minimize(); } catch {} };
  const toggleMaximize = async () => { try { await appWindow.toggleMaximize(); } catch {} };
  const closeWindow = async () => { try { await appWindow.close(); } catch {} };

  return (
    <div
      className="
        h-[34px] shrink-0 select-none
        flex items-center gap-3 px-[14px]
        border-b border-[rgba(255,255,255,0.1)]
        fixed top-0 left-0 right-0 z-[300]
      "
      data-tauri-drag-region
      style={{
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(40px) saturate(1.4)",
        WebkitBackdropFilter: "blur(40px) saturate(1.4)",
      }}
    >
      {/* Left: BLADE logotype */}
      <div
        className="flex items-center gap-2 shrink-0 pointer-events-none"
        data-tauri-drag-region
      >
        {/* Orb */}
        <div
          className="w-2 h-2 rounded-full bg-blade-accent"
          style={{ boxShadow: "0 0 8px rgba(99,102,241,0.6), 0 0 16px rgba(99,102,241,0.2)" }}
        />
        <span
          className="text-2xs font-bold tracking-[0.35em] text-blade-text/80"
          style={{ fontFeatureSettings: '"cpsp" 1' }}
        >
          BLADE
        </span>
      </div>

      {/* Center: role + model */}
      <div
        className="flex-1 h-full flex items-center justify-center gap-2"
        data-tauri-drag-region
      >
        <RoleSwitcher />
        <ModelBadge />
      </div>

      {/* Right: window controls */}
      <div
        className="flex items-center gap-0.5 shrink-0"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={minimize}
          className="
            w-7 h-7 rounded-md
            flex items-center justify-center
            text-blade-muted/40 hover:text-blade-secondary hover:bg-blade-surface
            transition-all duration-150
          "
          aria-label="Minimize"
        >
          <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 10h12" />
          </svg>
        </button>

        <button
          onClick={toggleMaximize}
          className="
            w-7 h-7 rounded-md
            flex items-center justify-center
            text-blade-muted/40 hover:text-blade-secondary hover:bg-blade-surface
            transition-all duration-150
          "
          aria-label="Maximize"
        >
          <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="4" width="12" height="12" rx="2" />
          </svg>
        </button>

        <button
          onClick={closeWindow}
          className="
            w-7 h-7 rounded-md
            flex items-center justify-center
            text-blade-muted/40 hover:text-red-400 hover:bg-red-500/10
            transition-all duration-150
          "
          aria-label="Close"
        >
          <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
