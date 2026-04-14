import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  show: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  show: () => {},
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

function IconSuccess() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function IconError() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}
function IconWarning() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
    </svg>
  );
}

const TYPE_CONFIG = {
  success: {
    icon: <IconSuccess />,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    border: "border-emerald-500/20",
    bar: "bg-emerald-400",
  },
  error: {
    icon: <IconError />,
    iconBg: "bg-red-500/10",
    iconColor: "text-red-400",
    border: "border-red-500/20",
    bar: "bg-red-400",
  },
  info: {
    icon: <IconInfo />,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
    border: "border-blue-500/20",
    bar: "bg-blue-400",
  },
  warning: {
    icon: <IconWarning />,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    border: "border-amber-500/20",
    bar: "bg-amber-400",
  },
} as const;

type InternalToast = ToastItem & { exiting: boolean };

function ToastCard({ toast, onDismiss }: { toast: InternalToast; onDismiss: (id: string) => void }) {
  const cfg = TYPE_CONFIG[toast.type];
  return (
    <div
      className={`
        relative overflow-hidden rounded-xl border backdrop-blur-xl shadow-surface-lg
        w-72 bg-blade-surface/95 ${cfg.border}
        ${toast.exiting ? "toast-exit" : "toast-enter"}
      `}
    >
      <div
        className={`absolute bottom-0 left-0 h-0.5 ${cfg.bar} opacity-40`}
        style={{
          animation: `toast-progress ${toast.duration ?? 4000}ms linear forwards`,
        }}
      />
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center mt-0.5 ${cfg.iconBg} ${cfg.iconColor}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-blade-text leading-tight">{toast.title}</p>
          {toast.message && (
            <p className="text-2xs text-blade-muted/70 mt-0.5 leading-relaxed line-clamp-2">{toast.message}</p>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 mt-0.5 w-5 h-5 rounded-md flex items-center justify-center text-blade-muted/40 hover:text-blade-muted/80 hover:bg-blade-surface-hover transition-all duration-150"
        >
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<InternalToast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    const cleanup = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(`${id}_cleanup`);
    }, 260);
    timersRef.current.set(`${id}_cleanup`, cleanup);
  }, []);

  const show = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const duration = toast.duration ?? 4000;
      setToasts((prev) => [...prev, { ...toast, id, exiting: false }].slice(-3));
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div
        className="fixed top-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastCard toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
