/**
 * BLADE GLASS PRIMITIVES
 *
 * Apple Liquid Glass building blocks. Every screen uses these.
 * Do not hand-roll glass styling — compose these instead.
 */

import React from "react";

// ─── GlassCard ────────────────────────────────────────────────────────────────

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  tier?: "inline" | "standard" | "floating";
  accent?: boolean;
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}

const PADDING_MAP = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
  xl: "p-6",
};

export function GlassCard({
  tier = "standard",
  accent = false,
  interactive = false,
  padding = "md",
  className = "",
  children,
  ...rest
}: GlassCardProps) {
  const base =
    tier === "floating"
      ? "blade-glass-floating"
      : tier === "inline"
        ? "blade-glass-inline"
        : "blade-glass";
  const accentClass = accent && tier === "standard" ? "blade-glass-accent" : "";
  const interactiveClass = interactive ? "is-interactive cursor-pointer" : "";

  return (
    <div
      className={[base, accentClass, interactiveClass, PADDING_MAP[padding], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}

// ─── GlassButton ──────────────────────────────────────────────────────────────

interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  children: React.ReactNode;
}

const BTN_SIZE = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-10 px-4 text-[13px]",
  lg: "h-12 px-6 text-[14px]",
};

export function GlassButton({
  variant = "primary",
  size = "md",
  leadingIcon,
  trailingIcon,
  className = "",
  children,
  disabled,
  ...rest
}: GlassButtonProps) {
  const base =
    "relative inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.005em] rounded-[12px] transition-all duration-200 select-none active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none overflow-hidden";

  const variantCls = {
    primary:
      // Accent gradient + specular + glow
      "text-white border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)] " +
      "bg-[linear-gradient(145deg,#8b95f9_0%,#6366f1_55%,#4f46e5_100%)] " +
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_14px_rgba(99,102,241,0.35),0_1px_2px_rgba(0,0,0,0.25)] " +
      "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_6px_20px_rgba(99,102,241,0.5),0_1px_2px_rgba(0,0,0,0.25)]",
    secondary:
      "text-[rgba(255,255,255,0.9)] backdrop-blur-xl " +
      "bg-[linear-gradient(155deg,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0.03)_100%)] " +
      "border border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.2)] " +
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.2)] " +
      "hover:bg-[linear-gradient(155deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.05)_100%)]",
    ghost:
      "text-[rgba(255,255,255,0.7)] hover:text-white " +
      "bg-transparent hover:bg-[rgba(255,255,255,0.05)] " +
      "border border-transparent hover:border-[rgba(255,255,255,0.08)]",
  }[variant];

  return (
    <button
      className={[base, variantCls, BTN_SIZE[size], className].filter(Boolean).join(" ")}
      disabled={disabled}
      {...rest}
    >
      {leadingIcon && <span className="flex-shrink-0 flex items-center">{leadingIcon}</span>}
      <span>{children}</span>
      {trailingIcon && <span className="flex-shrink-0 flex items-center">{trailingIcon}</span>}
    </button>
  );
}

// ─── GlassInput ───────────────────────────────────────────────────────────────

interface GlassInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  leadingIcon?: React.ReactNode;
}

export const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  ({ mono, leadingIcon, className = "", ...rest }, ref) => {
    const base =
      "w-full h-11 rounded-[12px] px-4 text-[14px] text-white " +
      "bg-[rgba(8,8,14,0.6)] border border-[rgba(255,255,255,0.1)] " +
      "placeholder:text-[rgba(255,255,255,0.28)] " +
      "outline-none transition-all duration-200 " +
      "hover:border-[rgba(255,255,255,0.16)] " +
      "focus:border-[rgba(129,140,248,0.55)] focus:bg-[rgba(8,8,14,0.85)] " +
      "focus:shadow-[0_0_0_4px_rgba(129,140,248,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]";
    const monoCls = mono ? "font-mono text-[13px]" : "";
    const iconCls = leadingIcon ? "pl-10" : "";

    if (leadingIcon) {
      return (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.35)] pointer-events-none">
            {leadingIcon}
          </span>
          <input ref={ref} className={[base, monoCls, iconCls, className].filter(Boolean).join(" ")} {...rest} />
        </div>
      );
    }
    return <input ref={ref} className={[base, monoCls, className].filter(Boolean).join(" ")} {...rest} />;
  }
);
GlassInput.displayName = "GlassInput";

// ─── Chip ─────────────────────────────────────────────────────────────────────

type ChipColor = "accent" | "green" | "amber" | "red" | "blue" | "dim";

interface ChipProps {
  color?: ChipColor;
  size?: "xs" | "sm" | "md";
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const CHIP_COLORS: Record<ChipColor, string> = {
  accent: "bg-[var(--accent-weak)] text-[#a5b4fc] border-[var(--accent-border)]",
  green: "bg-[var(--green-weak)] text-[#86efac] border-[var(--green-border)]",
  amber: "bg-[var(--amber-weak)] text-[#fcd34d] border-[var(--amber-border)]",
  red: "bg-[var(--red-weak)] text-[#fca5a5] border-[var(--red-border)]",
  blue: "bg-[var(--blue-weak)] text-[#93c5fd] border-[var(--blue-border)]",
  dim: "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.45)] border-[rgba(255,255,255,0.08)]",
};

const CHIP_SIZE = {
  xs: "text-[9px] px-[7px] py-[2px] tracking-[0.08em]",
  sm: "text-[10px] px-[9px] py-[3px] tracking-[0.06em]",
  md: "text-[11px] px-[12px] py-[4px] tracking-[0.04em]",
};

export function Chip({ color = "accent", size = "sm", children, className = "", dot = false }: ChipProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-[5px] font-bold uppercase rounded-full border",
        CHIP_COLORS[color],
        CHIP_SIZE[size],
        className,
      ].join(" ")}
    >
      {dot && <span className="w-[5px] h-[5px] rounded-full bg-current" style={{ boxShadow: "0 0 6px currentColor" }} />}
      {children}
    </span>
  );
}

// ─── Stat (big number + label; serif numerals) ────────────────────────────────

interface StatProps {
  value: string | number;
  label: string;
  delta?: { value: string; up?: boolean };
  size?: "sm" | "md" | "lg";
  color?: "accent" | "green" | "amber" | "red" | "blue" | "white";
}

const STAT_COLORS = {
  accent: "text-[#a5b4fc]",
  green: "text-[#4ade80]",
  amber: "text-[#fbbf24]",
  red: "text-[#f87171]",
  blue: "text-[#60a5fa]",
  white: "text-white",
};

const STAT_SIZES = {
  sm: { val: "text-[20px]", lbl: "text-[9px]" },
  md: { val: "text-[26px]", lbl: "text-[10px]" },
  lg: { val: "text-[44px]", lbl: "text-[11px]" },
};

export function Stat({ value, label, delta, size = "md", color = "white" }: StatProps) {
  const sz = STAT_SIZES[size];
  return (
    <div className="flex flex-col gap-[3px]">
      <div className={`${sz.val} font-serif font-semibold tracking-[-0.03em] leading-[0.95] ${STAT_COLORS[color]}`}
        style={{ fontVariationSettings: "'opsz' 144" }}>
        {value}
      </div>
      <div className="flex items-center gap-2">
        <span className={`${sz.lbl} font-bold tracking-[0.14em] uppercase text-[rgba(255,255,255,0.3)]`}>
          {label}
        </span>
        {delta && (
          <span className={`text-[10px] font-semibold ${delta.up ? "text-[#4ade80]" : "text-[#f87171]"}`}>
            {delta.up ? "↑" : "↓"} {delta.value}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── SectionLabel (tiny caps label above content) ─────────────────────────────

interface SectionLabelProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  accent?: boolean;
  className?: string;
}

export function SectionLabel({ icon, children, accent = false, className = "" }: SectionLabelProps) {
  return (
    <div className={`flex items-center gap-[7px] text-[9.5px] font-bold tracking-[0.18em] uppercase ${accent ? "text-[#a5b4fc]" : "text-[rgba(255,255,255,0.32)]"} ${className}`}>
      {icon && (
        <span className={`w-[18px] h-[18px] rounded-[5px] flex items-center justify-center ${accent ? "bg-[var(--accent-weak)] text-[#818cf8]" : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.45)]"}`}>
          {icon}
        </span>
      )}
      {children}
    </div>
  );
}

// ─── OrbLogo — the BLADE signature mark ───────────────────────────────────────

interface OrbLogoProps {
  size?: number;
  className?: string;
}

export function OrbLogo({ size = 34, className = "" }: OrbLogoProps) {
  const s = `${size}px`;
  return (
    <div
      className={`rounded-[10px] flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        width: s,
        height: s,
        background: "linear-gradient(145deg, #8b95f9 0%, #6366f1 55%, #3b82f6 100%)",
        boxShadow:
          "0 0 24px rgba(129,140,248,0.4), inset 0 1px 0 rgba(255,255,255,0.32), 0 4px 14px rgba(0,0,0,0.45)",
      }}
    >
      <div
        className="rounded-full bg-white"
        style={{
          width: size * 0.2,
          height: size * 0.2,
          boxShadow: "0 0 8px rgba(255,255,255,0.6)",
        }}
      />
    </div>
  );
}

// ─── Wordmark ─────────────────────────────────────────────────────────────────

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display font-bold tracking-[0.32em] text-white ${className}`}
      style={{ fontFeatureSettings: '"ss01"' }}
    >
      BLADE
    </span>
  );
}

// ─── Divider (subtle with gradient fade) ──────────────────────────────────────

export function Divider({ vertical = false, className = "" }: { vertical?: boolean; className?: string }) {
  if (vertical) {
    return (
      <div
        className={`w-px self-stretch ${className}`}
        style={{
          background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.1) 50%, transparent)",
        }}
      />
    );
  }
  return (
    <div
      className={`h-px w-full ${className}`}
      style={{
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.1) 50%, transparent)",
      }}
    />
  );
}

// ─── NavRow (list row with icon + label + chevron) ────────────────────────────

interface NavRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  variant?: "accent" | "default";
}

export function NavRow({ icon, title, subtitle, trailing, onClick, active = false, variant = "default" }: NavRowProps) {
  const border = active
    ? "border-[rgba(129,140,248,0.35)] bg-[rgba(129,140,248,0.06)]"
    : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] hover:border-[rgba(129,140,248,0.28)] hover:bg-[rgba(129,140,248,0.04)]";

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left flex items-center gap-3 px-4 py-[14px] rounded-[14px] border transition-all duration-200 ${border} active:scale-[0.99]`}
    >
      {icon && (
        <span
          className={`w-[32px] h-[32px] rounded-[9px] flex items-center justify-center flex-shrink-0 ${
            variant === "accent"
              ? "bg-[var(--accent-weak)] text-[#818cf8] border border-[var(--accent-border)]"
              : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border border-[rgba(255,255,255,0.06)]"
          }`}
        >
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-white tracking-[-0.005em]">{title}</div>
        {subtitle && (
          <div className="text-[11.5px] text-[rgba(255,255,255,0.45)] mt-[2px] leading-[1.4]">
            {subtitle}
          </div>
        )}
      </div>
      {trailing && <div className="flex-shrink-0">{trailing}</div>}
      <svg
        viewBox="0 0 16 16"
        className="w-4 h-4 text-[rgba(255,255,255,0.22)] group-hover:text-[#818cf8] group-hover:translate-x-[2px] transition-all flex-shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
    </button>
  );
}

// ─── AmbientBackground — the signature "mood lighting" behind cards ──────────

export function AmbientBackground({ variant = "default" }: { variant?: "default" | "violet" | "emerald" | "amber" }) {
  const colors = {
    default: {
      c1: "rgba(88,50,220,0.35)",
      c2: "rgba(40,20,140,0.3)",
      c3: "rgba(160,30,90,0.2)",
    },
    violet: {
      c1: "rgba(139,92,246,0.38)",
      c2: "rgba(79,70,229,0.28)",
      c3: "rgba(192,38,211,0.2)",
    },
    emerald: {
      c1: "rgba(52,211,153,0.3)",
      c2: "rgba(34,197,94,0.2)",
      c3: "rgba(16,185,129,0.18)",
    },
    amber: {
      c1: "rgba(251,191,36,0.25)",
      c2: "rgba(249,115,22,0.2)",
      c3: "rgba(244,63,94,0.18)",
    },
  }[variant];

  return (
    <>
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 80% 65% at 18% 25%, ${colors.c1} 0%, transparent 60%),
            radial-gradient(ellipse 70% 85% at 85% 18%, ${colors.c2} 0%, transparent 58%),
            radial-gradient(ellipse 85% 60% at 72% 88%, ${colors.c3} 0%, transparent 62%),
            #050508
          `,
        }}
      />
      {/* Fine grain overlay — adds "painted" texture to the gradient */}
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      {/* Dark scrim for text readability */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{ background: "rgba(0,0,0,0.28)" }}
      />
    </>
  );
}
