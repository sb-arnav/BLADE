/**
 * CATCHUP OVERLAY — "Welcome back" summary when user returns from being away.
 * Slides in, auto-fades after 15 seconds, click to dismiss.
 */

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export function CatchupOverlay() {
  const [catchup, setCatchup] = useState<{ away_minutes: number; summary: string } | null>(null);

  useEffect(() => {
    const unlisten = listen<{ away_minutes: number; summary: string }>("blade_catchup", (e) => {
      setCatchup(e.payload);
      // Auto-dismiss after 15 seconds
      setTimeout(() => setCatchup(null), 15000);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (!catchup) return null;

  return (
    <div
      className="fixed top-[50px] left-1/2 -translate-x-1/2 z-[9995] max-w-[500px] w-full px-4 pointer-events-auto animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_both]"
      onClick={() => setCatchup(null)}
    >
      <div
        className="rounded-2xl border border-[rgba(255,255,255,0.12)] p-5 cursor-pointer"
        style={{
          background: "rgba(12,12,18,0.94)",
          backdropFilter: "blur(28px) saturate(1.8)",
          WebkitBackdropFilter: "blur(28px) saturate(1.8)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 30px rgba(129,140,248,0.1)",
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-[36px] h-[36px] rounded-xl bg-[rgba(129,140,248,0.15)] flex items-center justify-center flex-shrink-0">
            <span className="text-[18px]">👋</span>
          </div>
          <div>
            <div className="text-[14px] font-semibold">Welcome back</div>
            <div className="text-[10px] text-[rgba(255,255,255,0.35)]">
              Away for {catchup.away_minutes} minutes
            </div>
          </div>
        </div>
        <p className="text-[12px] text-[rgba(255,255,255,0.65)] leading-[1.6]">
          {catchup.summary}
        </p>
        <div className="text-[9px] text-[rgba(255,255,255,0.2)] mt-3 text-center">
          click to dismiss
        </div>
      </div>
    </div>
  );
}
