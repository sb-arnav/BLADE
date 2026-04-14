import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  /** ms, default 4000 */
  duration?: number;
}

interface ToastContextValue {
  add: (toast: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ── Visual config per type ───────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  ToastType,
  { bar: string; icon: React.ReactNode; label: string }
> = {
  success: {
    bar: "#22c55e",
    label: "success",
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="#22c55e" strokeWidth="2">
        <path d="M3 8l3.5 3.5L13 5" />
      </svg>
    ),
  },
  error: {
    bar: "#ef4444",
    label: "error",
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="#ef4444" strokeWidth="2">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    ),
  },
  info: {
    bar: "#3b82f6",
    label: "info",
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="#3b82f6" strokeWidth="2">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7v5M8 5.5v.5" />
      </svg>
    ),
  },
  warning: {
    bar: "#f59e0b",
    label: "warning",
    icon: (
      <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="#f59e0b" strokeWidth="2">
        <path d="M8 2L1.5 13h13L8 2z" />
        <path d="M8 7v3M8 11.5v.5" />
      </svg>
    ),
  },
};

// ── Single Toast ──────────────────────────────────────────────────────────────

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);
  const cfg = TYPE_CONFIG[toast.type];
  const duration = toast.duration ?? 4000;

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 220);
  }, [onDismiss, toast.id]);

  // Auto-dismiss
  useEffect(() => {
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
  }, [dismiss, duration]);

  return (
    <div
      className={exiting ? "toast-exit" : "toast-enter"}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "0.625rem",
        background: "rgba(17, 17, 21, 0.97)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(30, 30, 36, 0.7)",
        borderLeft: `3px solid ${cfg.bar}`,
        borderRadius: "0.625rem",
        padding: "0.625rem 0.75rem",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(30,30,36,0.4)",
        minWidth: "260px",
        maxWidth: "340px",
        marginBottom: "0.5rem",
        cursor: "pointer",
        userSelect: "none",
      }}
      onClick={dismiss}
    >
      {/* Icon */}
      <div style={{ paddingTop: "1px", flexShrink: 0 }}>{cfg.icon}</div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#f4f4f5",
            lineHeight: 1.3,
            marginBottom: toast.message ? "0.2rem" : 0,
          }}
        >
          {toast.title}
        </div>
        {toast.message && (
          <div
            style={{
              fontSize: "0.6875rem",
              color: "#71717a",
              lineHeight: 1.45,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {toast.message}
          </div>
        )}
      </div>

      {/* Dismiss X */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        style={{
          flexShrink: 0,
          color: "#52525b",
          fontSize: "0.7rem",
          lineHeight: 1,
          padding: "2px",
          background: "none",
          border: "none",
          cursor: "pointer",
          marginTop: "1px",
          transition: "color 150ms ease",
        }}
        onMouseEnter={(e) => ((e.target as HTMLButtonElement).style.color = "#a1a1aa")}
        onMouseLeave={(e) => ((e.target as HTMLButtonElement).style.color = "#52525b")}
        aria-label="Dismiss"
      >
        ✕
      </button>

      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: "2px",
          background: cfg.bar,
          opacity: 0.5,
          borderRadius: "0 0 0.5rem 0.5rem",
          animation: `toastProgress ${duration}ms linear forwards`,
        }}
      />
    </div>
  );
}

// ── Stack ────────────────────────────────────────────────────────────────────

const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const add = useCallback((item: Omit<ToastItem, "id">): string => {
    const id = `toast-${++counterRef.current}`;
    setToasts((prev) => {
      const next = [...prev, { ...item, id }];
      // Keep only the last MAX_TOASTS
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ add, dismiss }}>
      {children}

      {/* Toast portal — fixed top-right */}
      <div
        style={{
          position: "fixed",
          top: "2.75rem", // below the Tauri titlebar (~2.25rem) + small gap
          right: "1rem",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          pointerEvents: toasts.length > 0 ? "auto" : "none",
        }}
      >
        <style>{`
          @keyframes toastProgress {
            from { width: 100%; }
            to   { width: 0%; }
          }
        `}</style>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
