// DiscordBridge — Connect BLADE to a Discord channel via webhook.
// BLADE will post pulse thoughts and morning briefings there automatically.
// No bot token needed — just a webhook URL from Discord channel settings.

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DiscordStatus {
  connected: boolean;
  webhook_set: boolean;
  error: string | null;
}

export function DiscordBridge() {
  const [status, setStatus] = useState<DiscordStatus>({
    connected: false,
    webhook_set: false,
    error: null,
  });
  const [webhookUrl, setWebhookUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    invoke<DiscordStatus>("discord_status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  const handleConnect = async () => {
    if (!webhookUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("discord_connect", { webhookUrl: webhookUrl.trim() });
      const s = await invoke<DiscordStatus>("discord_status");
      setStatus(s);
      setWebhookUrl("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await invoke("discord_disconnect");
      setStatus({ connected: false, webhook_set: false, error: null });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!testMsg.trim()) return;
    setLoading(true);
    try {
      await invoke("discord_post", { content: testMsg.trim() });
      setTestMsg("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl border border-blade-border bg-blade-surface/30 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-[#5865F2]/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.032.054a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Discord</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
              status.connected
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-blade-surface border border-blade-border text-blade-muted"
            }`}>
              {status.connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <p className="text-[10px] text-blade-muted mt-0.5">
            BLADE posts pulse thoughts and briefings to your channel.
          </p>
        </div>
      </div>

      {status.connected ? (
        <div className="space-y-3">
          {/* Quick post */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-blade-muted font-medium uppercase tracking-wide">Send a message</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePost()}
                placeholder="Post something to Discord..."
                className="flex-1 px-3 py-1.5 text-xs bg-blade-bg border border-blade-border rounded-lg focus:outline-none focus:border-[#5865F2]/50 placeholder:text-blade-muted"
              />
              <button
                onClick={handlePost}
                disabled={loading || !testMsg.trim()}
                className="px-3 py-1.5 rounded-lg bg-[#5865F2] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                Send
              </button>
            </div>
          </div>

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            disabled={loading}
            className="w-full px-3 py-2 rounded-xl border border-red-500/30 text-red-400 text-xs hover:bg-red-500/5 transition-colors disabled:opacity-40"
          >
            Disconnect webhook
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Setup guide */}
          <div className="text-[10px] text-blade-muted space-y-1 bg-blade-bg rounded-xl p-3">
            <p className="font-medium text-blade-secondary">How to get a webhook URL:</p>
            <p>1. Open a Discord channel → Edit Channel → Integrations</p>
            <p>2. Create Webhook → Copy Webhook URL</p>
            <p>3. Paste it below and click Connect</p>
          </div>

          <div className="space-y-1.5">
            <div className="relative">
              <input
                type={showUrl ? "text" : "password"}
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 pr-10 text-xs bg-blade-bg border border-blade-border rounded-xl focus:outline-none focus:border-[#5865F2]/50 placeholder:text-blade-muted font-mono"
              />
              <button
                type="button"
                onClick={() => setShowUrl((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-blade-muted hover:text-blade-secondary"
                tabIndex={-1}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  {showUrl ? (
                    <path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" />
                  ) : (
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={handleConnect}
            disabled={loading || !webhookUrl.trim()}
            className="w-full px-3 py-2 rounded-xl bg-[#5865F2] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? "Connecting..." : "Connect Discord"}
          </button>
        </div>
      )}
    </div>
  );
}
