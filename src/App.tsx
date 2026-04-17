import { useEffect, useState } from "react";
import { getConfig, getOnboardingStatus } from "./lib/tauri";
import { getPlatform } from "./lib/platform";
import type { BladeConfig } from "./types/blade";

/**
 * Foundation smoke test. Proves:
 *   1. Tailwind v4 tokens render (bg-canvas, text-label, etc.)
 *   2. Platform detection wrote data-platform to <html>
 *   3. Tauri invoke works (get_config, get_onboarding_status)
 *
 * When the first real screen (QuickAsk) is built it replaces this component.
 */
export function App() {
  const [config, setConfig] = useState<BladeConfig | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const platform = getPlatform();

  useEffect(() => {
    (async () => {
      try {
        const [cfg, ob] = await Promise.all([getConfig(), getOnboardingStatus()]);
        setConfig(cfg);
        setOnboarded(ob);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  return (
    <main className="h-full w-full bg-canvas text-label font-sans flex flex-col">
      <header className="h-[var(--titlebar-h)] flex items-center px-4 border-b border-separator text-label-secondary text-[11px] tracking-wide uppercase">
        Blade · Foundation
      </header>

      <section className="flex-1 overflow-auto px-6 py-5 space-y-5">
        <Row k="platform" v={platform} />
        <Row k="onboarded" v={onboarded === null ? "…" : String(onboarded)} />

        {err && (
          <div className="rounded-[var(--radius-card)] border border-separator bg-window px-4 py-3 text-[13px]">
            <div className="text-label-secondary text-[11px] uppercase tracking-wide mb-1">Error</div>
            <pre className="font-mono text-[12px] whitespace-pre-wrap break-all">{err}</pre>
          </div>
        )}

        {config && (
          <div className="rounded-[var(--radius-card)] border border-separator bg-window">
            <div className="px-4 py-3 border-b border-separator text-label-secondary text-[11px] uppercase tracking-wide">
              blade config
            </div>
            <dl className="px-4 py-3 grid grid-cols-[160px_1fr] gap-y-1.5 gap-x-4 font-mono text-[12px]">
              <Field k="provider" v={config.provider} />
              <Field k="model" v={config.model} />
              <Field k="api_key" v={config.api_key} />
              <Field k="user_name" v={config.user_name || "—"} />
              <Field k="quick_ask_shortcut" v={config.quick_ask_shortcut} />
              <Field k="voice_shortcut" v={config.voice_shortcut} />
              <Field k="god_mode" v={`${config.god_mode} (${config.god_mode_tier})`} />
              <Field k="wake_word" v={`${config.wake_word_enabled} · "${config.wake_word_phrase}"`} />
              <Field k="timeline" v={`${config.screen_timeline_enabled} · ${config.timeline_capture_interval}s / ${config.timeline_retention_days}d`} />
              <Field k="active_role" v={config.active_role} />
            </dl>
          </div>
        )}
      </section>

      <footer className="h-7 flex items-center px-4 border-t border-separator text-label-tertiary text-[11px] font-mono">
        {config ? `${config.provider} · ${config.model}` : "loading…"}
      </footer>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[12px]">
      <span className="w-28 text-label-tertiary uppercase tracking-wide text-[11px]">{k}</span>
      <span className="text-label">{v}</span>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-label-tertiary">{k}</dt>
      <dd className="text-label">{v}</dd>
    </>
  );
}
