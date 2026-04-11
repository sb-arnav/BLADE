// src/components/TelegramBridge.tsx
// Settings panel for connecting BLADE to a Telegram bot.
// Users create a bot via @BotFather, paste the token here, and BLADE
// starts listening for messages — auto-reconnecting on restart.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

interface TelegramStatus {
  running: boolean;
  token_set: boolean;
  messages_handled: number;
  error: string | null;
}

export function TelegramBridge() {
  const [status, setStatus] = useState<TelegramStatus>({
    running: false,
    token_set: false,
    messages_handled: 0,
    error: null,
  });
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Load current status on mount
  useEffect(() => {
    void invoke<TelegramStatus>("telegram_status").then(setStatus).catch(() => {});
  }, []);

  // Listen for message events (live counter update)
  useEffect(() => {
    const unlisten = listen<number>("telegram_message_handled", (event) => {
      setStatus((s) => ({ ...s, messages_handled: event.payload, error: null }));
    });
    return () => { void unlisten.then((u) => u()); };
  }, []);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setConnecting(true);
    try {
      await invoke("telegram_start", { token: token.trim() });
      setStatus(await invoke<TelegramStatus>("telegram_status"));
      setToken(""); // clear after successful connect
    } catch (e) {
      setStatus((s) => ({
        ...s,
        error: typeof e === "string" ? e : String(e),
      }));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("telegram_disconnect");
      setStatus(await invoke<TelegramStatus>("telegram_status"));
    } catch {}
  };

  return (
    <div className="rounded-xl border border-blade-border bg-blade-surface/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border/40">
        {/* Telegram paper-plane icon */}
        <div className="w-8 h-8 rounded-lg bg-[#2AABEE]/10 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#2AABEE]">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-blade-text">Telegram</p>
            {status.running && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 tracking-wide">
                LIVE
              </span>
            )}
            {status.token_set && !status.running && !connecting && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-400 tracking-wide">
                OFFLINE
              </span>
            )}
          </div>
          <p className="text-[11px] text-blade-muted mt-0.5">
            Chat with BLADE from anywhere via Telegram
          </p>
        </div>
        {status.running && (
          <div className="text-right shrink-0">
            <p className="text-xs font-semibold text-blade-accent">
              {status.messages_handled}
            </p>
            <p className="text-[10px] text-blade-muted">messages</p>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Error banner */}
        {status.error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
            {status.error}
          </div>
        )}

        {!status.running && (
          <>
            {/* Setup guide */}
            <div className="text-[11px] text-blade-muted space-y-1">
              <p>
                1.{" "}
                <button
                  className="text-blade-accent hover:underline"
                  onClick={() => void openUrl("https://t.me/BotFather")}
                >
                  Open @BotFather on Telegram
                </button>
                {" "}and send <code className="font-mono text-blade-secondary">/newbot</code>
              </p>
              <p>2. Copy the token BotFather gives you and paste it below</p>
            </div>

            {/* Token input */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && token.trim()) void handleConnect(); }}
                  placeholder="1234567890:AAF..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg pl-3 pr-8 py-2 text-xs text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted/60 transition-colors font-mono"
                  autoComplete="off"
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-blade-muted hover:text-blade-secondary transition-colors"
                  onClick={() => setShowToken(!showToken)}
                  tabIndex={-1}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    {showToken
                      ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></>
                      : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                    }
                  </svg>
                </button>
              </div>
              <button
                onClick={() => void handleConnect()}
                disabled={!token.trim() || connecting}
                className="px-3 py-2 text-xs font-medium bg-blade-accent text-white rounded-lg disabled:opacity-30 hover:bg-blade-accent-hover transition-colors shrink-0"
              >
                {connecting ? (
                  <div className="w-3.5 h-3.5 rounded-full border border-white/40 border-t-white animate-spin" />
                ) : "Connect"}
              </button>
            </div>
          </>
        )}

        {status.running && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/6 border border-emerald-500/12">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-slow shrink-0" />
              <p className="text-xs text-emerald-400">Bot is running — message it on Telegram</p>
            </div>
            <p className="text-[11px] text-blade-muted">
              Use <code className="font-mono text-blade-secondary">/clear</code> in Telegram to reset conversation history.
            </p>
            <button
              onClick={() => void handleDisconnect()}
              className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Reconnect button if token is set but not running */}
        {status.token_set && !status.running && !connecting && !status.error && (
          <button
            onClick={() => {
              setConnecting(true);
              // Pass "__saved__" sentinel — Rust side reads from keyring
              void invoke("telegram_start_saved")
                .then(() => invoke<TelegramStatus>("telegram_status"))
                .then(setStatus)
                .catch(async (e: unknown) => {
                  const s = await invoke<TelegramStatus>("telegram_status");
                  setStatus({ ...s, error: typeof e === "string" ? e : String(e) });
                })
                .finally(() => setConnecting(false));
            }}
            className="text-xs text-blade-accent hover:text-blade-accent-hover transition-colors"
          >
            Reconnect with saved token
          </button>
        )}
      </div>
    </div>
  );
}
