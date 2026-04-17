/**
 * Sidebar — BLADE's persistent left navigation.
 *
 * Layout: icons + labels, ~200px expanded / ~52px collapsed.
 * Three spaces: Home · Work · Life — plus Security & Settings at bottom.
 */

import React, { useState } from "react";

export type NavRoute =
  | "dashboard"
  | "chat"
  | "terminal"
  | "git"
  | "bg-agents"
  | "files"
  | "web-auto"
  | "hive"
  | "agent-factory"
  | "health"
  | "finance"
  | "meetings"
  | "social-graph"
  | "security"
  | "settings";

interface NavItem {
  id: NavRoute;
  label: string;
  icon: React.ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconHome() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5L10 3l7 5.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V8.5z" />
      <path d="M7 18v-7h6v7" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h12a2 2 0 012 2v9z" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d="M6 7l3 3-3 3M11 13h4" />
    </svg>
  );
}

function IconGit() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="1.5" />
      <circle cx="5" cy="15" r="1.5" />
      <circle cx="15" cy="8" r="1.5" />
      <path d="M5 6.5v7M5 6.5c0-1 .8-2.5 2-3l3-1.5M6.5 15c0 0 5 .5 7-3v-2.5" />
    </svg>
  );
}

function IconAgents() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="7" r="2.5" />
      <circle cx="4" cy="15" r="2" />
      <circle cx="10" cy="15" r="2" />
      <circle cx="16" cy="15" r="2" />
      <path d="M10 9.5v3.5M4 13V11c0-2 2-3 4-3h4c2 0 4 1 4 3v2" />
    </svg>
  );
}

function IconBrowse() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="12" rx="2" />
      <path d="M2 7h16" />
      <circle cx="5" cy="5.5" r=".75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="5.5" r=".75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconHive() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l7 4v8l-7 4-7-4V6l7-4z" />
      <path d="M10 2v16M3 6l7 4 7-4" />
    </svg>
  );
}

function IconHealth() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h2.5l2-4 3 8 2-5 1.5 1H17" />
    </svg>
  );
}

function IconFinance() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 6v1.5m0 5V14m-2.5-5.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.5-1.2 1.4-2.5 1.5c-1.3.1-2.5.8-2.5 1.8 0 1 1 1.7 2.5 1.7s2.5-.6 2.5-1.5" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="14" rx="2" />
      <path d="M6 2v3M14 2v3M2 9h16" />
      <circle cx="7" cy="13" r=".75" fill="currentColor" stroke="none" />
      <circle cx="10" cy="13" r=".75" fill="currentColor" stroke="none" />
      <circle cx="13" cy="13" r=".75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPeople() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="6" r="2.5" />
      <path d="M2 17c0-3 2.5-5 6-5s6 2 6 5" />
      <circle cx="15" cy="7" r="2" />
      <path d="M14 17h4c0-2.2-1.8-4-4-4" />
    </svg>
  );
}

function IconSecurity() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" />
      <path d="M7 10l2 2 4-4" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M2 10h2M16 10h2M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </svg>
  );
}

// ── Nav Sections ─────────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Home",
    items: [
      { id: "dashboard", label: "Home", icon: <IconHome /> },
      { id: "chat", label: "Chat", icon: <IconChat /> },
    ],
  },
  {
    title: "Work",
    items: [
      { id: "terminal", label: "Code", icon: <IconTerminal /> },
      { id: "git", label: "Git", icon: <IconGit /> },
      { id: "files", label: "Browse", icon: <IconBrowse /> },
      { id: "hive", label: "Hive", icon: <IconHive /> },
      { id: "bg-agents", label: "Agents", icon: <IconAgents /> },
    ],
  },
  {
    title: "Life",
    items: [
      { id: "health", label: "Health", icon: <IconHealth /> },
      { id: "finance", label: "Finance", icon: <IconFinance /> },
      { id: "meetings", label: "Calendar", icon: <IconCalendar /> },
      { id: "social-graph", label: "People", icon: <IconPeople /> },
    ],
  },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: "security", label: "Security", icon: <IconSecurity /> },
  { id: "settings", label: "Settings", icon: <IconSettings /> },
];

// ── NavBtn ────────────────────────────────────────────────────────────────────

function NavBtn({
  item,
  badge,
  collapsed,
  activeRoute,
  onNavigate,
}: {
  item: NavItem;
  badge?: number;
  collapsed: boolean;
  activeRoute: string;
  onNavigate: (route: NavRoute) => void;
}) {
  const isActive = activeRoute === item.id;

  return (
    <button
      onClick={() => onNavigate(item.id)}
      title={collapsed ? item.label : undefined}
      className={`
        relative w-full flex items-center gap-3 rounded-lg
        transition-all duration-200
        ${collapsed ? "justify-center px-0 py-2" : "px-3 py-2"}
        ${isActive
          ? "bg-white/10 text-white"
          : "text-[#8e8e93] hover:text-white hover:bg-white/[0.06]"
        }
      `}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full"
          style={{ background: "#5856D6" }}
        />
      )}

      <span className={`shrink-0 ${isActive ? "text-white" : ""}`}>
        {item.icon}
      </span>

      {!collapsed && (
        <span className="text-[13px] font-medium leading-none truncate">{item.label}</span>
      )}

      {/* Badge */}
      {badge !== undefined && badge > 0 && (
        <span
          className={`
            ml-auto shrink-0 min-w-[18px] h-[18px] rounded-full
            flex items-center justify-center
            text-[9px] font-bold text-white
            ${collapsed ? "absolute -top-1 -right-1" : ""}
          `}
          style={{ background: "#5856D6" }}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  activeRoute: NavRoute | string;
  onNavigate: (route: NavRoute) => void;
  chatUnread?: number;
}

export function Sidebar({ activeRoute, onNavigate, chatUnread = 0 }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="flex flex-col bg-[#111113] border-r border-white/[0.06] shrink-0 relative select-none"
      style={{
        width: collapsed ? 52 : 200,
        transition: "width 250ms cubic-bezier(0.25,0.1,0.25,1)",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 pt-3 pb-2 space-y-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/25">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavBtn
                  key={item.id}
                  item={item}
                  badge={item.id === "chat" ? chatUnread : undefined}
                  collapsed={collapsed}
                  activeRoute={activeRoute}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Separator */}
      <div className="mx-3 h-px bg-white/[0.06] shrink-0" />

      {/* Bottom items */}
      <div className="px-2 py-2 space-y-0.5">
        {BOTTOM_ITEMS.map((item) => (
          <NavBtn
            key={item.id}
            item={item}
            collapsed={collapsed}
            activeRoute={activeRoute}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Collapse toggle */}
      <div className="px-2 pb-3 pt-1">
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full flex items-center justify-center h-7 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.04] transition-all duration-200"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <svg
            viewBox="0 0 20 20"
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: collapsed ? "rotate(180deg)" : "none", transition: "transform 250ms" }}
          >
            <path d="M13 5l-5 5 5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
