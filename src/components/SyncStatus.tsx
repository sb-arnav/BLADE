import { useState, useCallback } from "react";

// Sync is Phase G — this is a preview UI with simulated state.
// Will be wired to real sync engine later.

export type SyncState = "idle" | "syncing" | "error" | "offline" | "disabled";

interface SyncDevice {
  id: string;
  name: string;
  platform: "windows" | "macos" | "linux" | "unknown";
  lastSeen: number;
  isCurrentDevice: boolean;
}

interface SyncConfig {
  enabled: boolean;
  provider: "none" | "gdrive" | "dropbox" | "custom";
  lastSync: number | null;
  syncConversations: boolean;
  syncSettings: boolean;
  syncKnowledge: boolean;
  syncTemplates: boolean;
}

const DEFAULT_CONFIG: SyncConfig = {
  enabled: false,
  provider: "none",
  lastSync: null,
  syncConversations: true,
  syncSettings: true,
  syncKnowledge: true,
  syncTemplates: true,
};

function formatSyncTime(timestamp: number | null): string {
  if (!timestamp) return "Never";
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function PlatformIcon({ platform }: { platform: string }) {
  const icons: Record<string, string> = {
    windows: "🪟",
    macos: "🍎",
    linux: "🐧",
    unknown: "💻",
  };
  return <span>{icons[platform] || "💻"}</span>;
}

interface StatusProps {
  compact?: boolean;
}

export function SyncStatusBadge({ compact }: StatusProps) {
  const [state] = useState<SyncState>("disabled");
  const [config] = useState<SyncConfig>(DEFAULT_CONFIG);

  const colors: Record<SyncState, string> = {
    idle: "bg-emerald-500",
    syncing: "bg-blade-accent animate-pulse",
    error: "bg-red-500",
    offline: "bg-amber-500",
    disabled: "bg-blade-muted/30",
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={`Sync: ${state}`}>
        <div className={`w-1.5 h-1.5 rounded-full ${colors[state]}`} />
        {state === "syncing" && (
          <span className="text-2xs text-blade-muted">Syncing...</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-2xs text-blade-muted">
      <div className={`w-1.5 h-1.5 rounded-full ${colors[state]}`} />
      <span>
        {config.enabled
          ? `Last sync: ${formatSyncTime(config.lastSync)}`
          : "Sync disabled"}
      </span>
    </div>
  );
}

interface SettingsProps {
  onBack: () => void;
}

export function SyncSettings({ onBack }: SettingsProps) {
  const [config, setConfig] = useState<SyncConfig>(DEFAULT_CONFIG);
  const [devices] = useState<SyncDevice[]>([
    {
      id: "current",
      name: "This Device",
      platform: "windows",
      lastSeen: Date.now(),
      isCurrentDevice: true,
    },
  ]);

  const toggleSync = useCallback((key: keyof SyncConfig) => {
    setConfig((prev) => ({ ...prev, [key]: !prev[key as keyof SyncConfig] }));
  }, []);

  const providers = [
    { id: "none" as const, name: "None", description: "Sync disabled", icon: "⭕" },
    { id: "gdrive" as const, name: "Google Drive", description: "Sync via Google Drive", icon: "📁" },
    { id: "dropbox" as const, name: "Dropbox", description: "Sync via Dropbox", icon: "📦" },
    { id: "custom" as const, name: "Custom Server", description: "Your own sync endpoint", icon: "🔧" },
  ];

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Sync Settings</h1>
            <p className="text-sm text-blade-muted">
              Keep Blade in sync across your devices.
            </p>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-blade-muted hover:text-blade-text transition-colors"
          >
            back
          </button>
        </div>

        {/* Status */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${config.enabled ? "bg-emerald-500" : "bg-blade-muted/30"}`} />
              <div>
                <p className="text-sm font-medium">{config.enabled ? "Sync Active" : "Sync Disabled"}</p>
                <p className="text-2xs text-blade-muted">
                  {config.enabled
                    ? `Last sync: ${formatSyncTime(config.lastSync)}`
                    : "Enable sync to keep data across devices"}
                </p>
              </div>
            </div>
            <button
              onClick={() => toggleSync("enabled")}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                config.enabled ? "bg-blade-accent" : "bg-blade-border"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  config.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </section>

        {/* Provider selection */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <h2 className="text-base font-semibold">Sync Provider</h2>
          <div className="grid grid-cols-2 gap-2">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => setConfig((prev) => ({ ...prev, provider: p.id }))}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  config.provider === p.id
                    ? "border-blade-accent bg-blade-accent-muted"
                    : "border-blade-border hover:border-blade-muted"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{p.icon}</span>
                  <div>
                    <p className="text-xs font-medium">{p.name}</p>
                    <p className="text-2xs text-blade-muted">{p.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* What to sync */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <h2 className="text-base font-semibold">What to Sync</h2>
          {[
            { key: "syncConversations" as const, label: "Conversations", desc: "Chat history and messages" },
            { key: "syncSettings" as const, label: "Settings", desc: "Provider config, preferences" },
            { key: "syncKnowledge" as const, label: "Knowledge Base", desc: "Saved entries and notes" },
            { key: "syncTemplates" as const, label: "Templates", desc: "Custom prompt templates" },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between py-1">
              <div>
                <p className="text-xs font-medium">{item.label}</p>
                <p className="text-2xs text-blade-muted">{item.desc}</p>
              </div>
              <button
                onClick={() => toggleSync(item.key)}
                className={`relative w-8 h-4 rounded-full transition-colors ${
                  config[item.key] ? "bg-blade-accent" : "bg-blade-border"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                    config[item.key] ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          ))}
        </section>

        {/* Devices */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <h2 className="text-base font-semibold">Devices</h2>
          {devices.map((device) => (
            <div key={device.id} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <PlatformIcon platform={device.platform} />
                <div>
                  <p className="text-xs font-medium">
                    {device.name}
                    {device.isCurrentDevice && (
                      <span className="ml-1.5 text-2xs text-blade-accent">(this device)</span>
                    )}
                  </p>
                  <p className="text-2xs text-blade-muted">
                    Last seen: {formatSyncTime(device.lastSeen)}
                  </p>
                </div>
              </div>
              {!device.isCurrentDevice && (
                <button className="text-2xs text-red-400 hover:text-red-300 transition-colors">
                  Remove
                </button>
              )}
            </div>
          ))}
          <p className="text-2xs text-blade-muted/50 pt-2">
            Sync is encrypted end-to-end. Your data never leaves your control.
          </p>
        </section>
      </div>
    </div>
  );
}
