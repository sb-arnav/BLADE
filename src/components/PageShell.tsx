/**
 * PAGE SHELL — Consistent layout wrapper for all BLADE pages.
 *
 * Every page gets: back button, title, optional subtitle, optional actions,
 * proper padding, scrollable content area, consistent styling.
 *
 * Usage:
 *   <PageShell title="Focus" onBack={() => openRoute("dashboard")}>
 *     <YourContent />
 *   </PageShell>
 */

import React from "react";

interface PageShellProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
}

export function PageShell({ title, subtitle, onBack, actions, children, noPadding }: PageShellProps) {
  return (
    <div className="flex flex-col h-full text-white" style={{ background: "rgba(6,6,12,0.82)", backdropFilter: "blur(40px) saturate(1.4)", WebkitBackdropFilter: "blur(40px) saturate(1.4)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-[52px] flex-shrink-0 border-b border-[rgba(255,255,255,0.07)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[12px] text-[rgba(255,255,255,0.4)] hover:text-white transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-[14px] h-[14px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Back
          </button>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.08)]" />
          <div>
            <h1 className="text-[14px] font-semibold tracking-[-0.01em] leading-none">{title}</h1>
            {subtitle && <p className="text-[10px] text-[rgba(255,255,255,0.35)] mt-[2px]">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${noPadding ? "" : "p-5"}`}>
        {children}
      </div>
    </div>
  );
}

/**
 * SECTION CARD — Glass card for grouping related content within a page.
 */
interface SectionCardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export function SectionCard({ title, subtitle, children, className = "" }: SectionCardProps) {
  return (
    <div className={`rounded-2xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] p-4 ${className}`}
      style={{ backdropFilter: "blur(12px)" }}>
      {title && (
        <div className="mb-3">
          <h2 className="text-[12px] font-semibold tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="text-[10px] text-[rgba(255,255,255,0.35)] mt-[1px]">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * STATUS PILL — Small colored indicator (like "connected", "3 active", "error")
 */
interface StatusPillProps {
  color: "green" | "amber" | "red" | "blue" | "dim";
  children: React.ReactNode;
}

const PILL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  green: { bg: "rgba(74,222,128,0.1)", text: "#4ade80", border: "rgba(74,222,128,0.25)" },
  amber: { bg: "rgba(251,191,36,0.1)", text: "#fbbf24", border: "rgba(251,191,36,0.25)" },
  red: { bg: "rgba(248,113,113,0.1)", text: "#f87171", border: "rgba(248,113,113,0.25)" },
  blue: { bg: "rgba(129,140,248,0.1)", text: "#818cf8", border: "rgba(129,140,248,0.25)" },
  dim: { bg: "rgba(255,255,255,0.04)", text: "rgba(255,255,255,0.4)", border: "rgba(255,255,255,0.08)" },
};

export function StatusPill({ color, children }: StatusPillProps) {
  const c = PILL_COLORS[color] || PILL_COLORS.dim;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[10px] font-medium"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {children}
    </span>
  );
}
