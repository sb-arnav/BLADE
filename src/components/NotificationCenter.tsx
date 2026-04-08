import { useState, useCallback, useEffect } from "react";

export interface BladeNotification {
  id: string;
  type: "info" | "success" | "warning" | "error" | "agent" | "tool";
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  action?: {
    label: string;
    route?: string;
    callback?: () => void;
  };
}

const STORAGE_KEY = "blade-notifications";
const MAX_NOTIFICATIONS = 100;

function loadNotifications(): BladeNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotifications(items: BladeNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_NOTIFICATIONS)));
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<BladeNotification[]>(loadNotifications);

  const add = useCallback((notif: Omit<BladeNotification, "id" | "timestamp" | "read">) => {
    const item: BladeNotification = {
      ...notif,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      read: false,
    };
    setNotifications((prev) => {
      const next = [...prev, item].slice(-MAX_NOTIFICATIONS);
      saveNotifications(next);
      return next;
    });
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveNotifications(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      saveNotifications(next);
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id);
      saveNotifications(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, add, markRead, markAllRead, dismiss, clearAll };
}

function formatNotifTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

const TYPE_ICONS: Record<BladeNotification["type"], string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
  agent: "🤖",
  tool: "🔧",
};

const TYPE_COLORS: Record<BladeNotification["type"], string> = {
  info: "border-blue-500/20",
  success: "border-emerald-500/20",
  warning: "border-amber-500/20",
  error: "border-red-500/20",
  agent: "border-blade-accent/20",
  tool: "border-violet-500/20",
};

interface Props {
  open: boolean;
  onClose: () => void;
  notifications: BladeNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onAction?: (route: string) => void;
}

export function NotificationCenter({
  open,
  onClose,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearAll,
  onAction,
}: Props) {
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = filter === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;
  const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-80 h-full bg-blade-surface border-l border-blade-border flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {unreadCount > 0 && (
              <span className="text-2xs bg-blade-accent text-white px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onMarkAllRead}
              className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors px-1.5"
            >
              read all
            </button>
            <button
              onClick={onClearAll}
              className="text-2xs text-blade-muted hover:text-red-400 transition-colors px-1.5"
            >
              clear
            </button>
            <button
              onClick={onClose}
              className="text-blade-muted hover:text-blade-secondary transition-colors ml-1"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-blade-border/50">
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded-md text-2xs transition-colors ${
                filter === f
                  ? "bg-blade-accent-muted text-blade-text"
                  : "text-blade-muted hover:text-blade-secondary"
              }`}
            >
              {f === "all" ? "All" : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-blade-muted/40">
              <span className="text-2xl mb-2">🔔</span>
              <p className="text-xs">No notifications</p>
            </div>
          ) : (
            sorted.map((notif) => (
              <div
                key={notif.id}
                className={`px-4 py-3 border-b border-blade-border/30 hover:bg-blade-surface-hover transition-colors cursor-pointer ${
                  !notif.read ? "border-l-2 " + TYPE_COLORS[notif.type] : ""
                }`}
                onClick={() => {
                  onMarkRead(notif.id);
                  if (notif.action?.route && onAction) onAction(notif.action.route);
                  if (notif.action?.callback) notif.action.callback();
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <span className="text-xs shrink-0 mt-0.5">{TYPE_ICONS[notif.type]}</span>
                    <div className="min-w-0">
                      <p className={`text-xs ${notif.read ? "text-blade-secondary" : "text-blade-text font-medium"}`}>
                        {notif.title}
                      </p>
                      <p className="text-2xs text-blade-muted mt-0.5 line-clamp-2">{notif.message}</p>
                      {notif.action && (
                        <span className="text-2xs text-blade-accent mt-1 inline-block">
                          {notif.action.label} →
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-2xs text-blade-muted/40">{formatNotifTime(notif.timestamp)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDismiss(notif.id); }}
                      className="text-blade-muted/30 hover:text-blade-secondary transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
