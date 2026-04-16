import React from "react";

export type NavRailRoute =
  | "dashboard" | "chat" | "terminal" | "git"
  | "hive" | "agent-factory" | "security" | "settings"
  | "rewind" | "live-notes";

interface NavRailProps {
  activeRoute: string;
  onNavigate: (route: NavRailRoute) => void;
  onOpenHistory: () => void;
}

function Ico({ d, viewBox = "0 0 20 20" }: { d: React.ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} className="w-[16px] h-[16px]" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

interface NavBtnProps {
  tip: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function NavBtn({ tip, active, onClick, children }: NavBtnProps) {
  return (
    <button
      onClick={onClick}
      data-tip={tip}
      className={[
        "relative w-10 h-10 rounded-[11px] flex items-center justify-center cursor-pointer",
        "border transition-all duration-150 group",
        active
          ? "text-white bg-[rgba(129,140,248,0.2)] border-[rgba(129,140,248,0.35)] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          : "text-[rgba(255,255,255,0.3)] border-transparent hover:text-white hover:bg-[rgba(255,255,255,0.09)] hover:border-[rgba(255,255,255,0.12)]",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-[-10px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-sm bg-[#818cf8] shadow-[0_0_10px_#818cf8]" />
      )}
      {children}
      {/* Glass tooltip */}
      <span className="absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 -translate-x-1
        opacity-0 group-hover:opacity-100 group-hover:translate-x-0
        transition-all duration-100 pointer-events-none
        bg-[rgba(10,10,20,0.92)] backdrop-blur-xl border border-[rgba(255,255,255,0.14)]
        text-white text-[11.5px] font-medium px-[10px] py-[5px] rounded-lg whitespace-nowrap
        font-mono z-50">
        {tip}
      </span>
    </button>
  );
}

export function NavRail({ activeRoute, onNavigate, onOpenHistory }: NavRailProps) {
  return (
    <nav className="fixed top-[34px] left-0 bottom-0 w-[62px] flex flex-col items-center
      py-[18px] gap-[3px] z-[200]
      bg-[rgba(0,0,0,0.28)] backdrop-blur-[60px]
      border-r border-[rgba(255,255,255,0.09)]">

      {/* Logo */}
      <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center mb-[18px]
        bg-gradient-to-br from-[#7c3aed] via-[#6366f1] to-[#3b82f6] flex-shrink-0
        shadow-[0_0_22px_rgba(129,140,248,0.4),0_4px_14px_rgba(0,0,0,0.5)]
        text-white font-extrabold text-[14px]">
        B
      </div>

      <NavBtn tip="Dashboard" active={activeRoute === "dashboard"} onClick={() => onNavigate("dashboard")}>
        <Ico d={<><rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/></>} />
      </NavBtn>

      <NavBtn tip="Conversations" active={false} onClick={onOpenHistory}>
        <Ico d={<path d="M18 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h12a2 2 0 012 2v9z"/>} />
      </NavBtn>

      <NavBtn tip="Terminal" active={activeRoute === "terminal"} onClick={() => onNavigate("terminal")}>
        <Ico d={<><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M6 8l3 3-3 3M11 14h3"/></>} />
      </NavBtn>

      <NavBtn tip="Git" active={activeRoute === "git"} onClick={() => onNavigate("git")}>
        <Ico d={<><circle cx="5" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="5" cy="15" r="2"/><path d="M5 7v6M7 5h3a3 3 0 010 6H5"/></>} />
      </NavBtn>

      <NavBtn tip="Hive" active={activeRoute === "hive"} onClick={() => onNavigate("hive")}>
        <Ico d={<><polygon points="12,2 18,6 18,14 12,18 6,14 6,6"/><circle cx="12" cy="10" r="2"/></>} />
      </NavBtn>

      <NavBtn tip="Rewind" active={activeRoute === "rewind"} onClick={() => onNavigate("rewind")}>
        <Ico d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M7 4L4 7l3 3"/></>} />
      </NavBtn>

      <NavBtn tip="Live Notes" active={activeRoute === "live-notes"} onClick={() => onNavigate("live-notes")}>
        <Ico d={<><path d="M4 4h16v16H4z" fill="none"/><path d="M8 8h8M8 12h6M8 16h4"/></>} />
      </NavBtn>

      <div className="flex-1" />
      <div className="w-[26px] h-px bg-[rgba(255,255,255,0.08)] my-[6px]" />

      <NavBtn tip="Ghost Mode" active={false} onClick={() => onNavigate("settings")}>
        <Ico d={<path d="M10 2a6 6 0 016 6v8l-2-2-2 2-2-2-2 2-2-2-2 2V8a6 6 0 016-6z"/>} />
      </NavBtn>

      <NavBtn tip="Settings" active={activeRoute === "settings"} onClick={() => onNavigate("settings")}>
        <Ico d={<><circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/></>} />
      </NavBtn>
    </nav>
  );
}
