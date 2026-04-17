/**
 * AUTO-SHOW OVERLAY — BLADE proactively shows you things it learned you want to see.
 *
 * Renders as a floating panel that slides in from the right. Shows content
 * based on learned patterns (show_engine.rs). User can dismiss → BLADE
 * learns to stop showing that content in that context.
 *
 * Listens to: blade_auto_show event from backend
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface AutoShowItem {
  trigger: string;
  show_type: string;
  content_query: string;
  content: string;
  times_shown: number;
  pattern_id: string;
}

export function AutoShowOverlay() {
  const [items, setItems] = useState<AutoShowItem[]>([]);

  useEffect(() => {
    const unlisten = listen<AutoShowItem>("blade_auto_show", (event) => {
      const item = event.payload;
      if (!item.content || item.content.length < 5) return;
      setItems((prev) => {
        // Don't duplicate
        if (prev.some((p) => p.pattern_id === item.pattern_id)) return prev;
        return [...prev, item].slice(-3); // max 3 overlays at once
      });
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const dismiss = (patternId: string) => {
    const item = items.find((i) => i.pattern_id === patternId);
    if (item) {
      invoke("show_dismiss", { trigger: item.trigger, showType: item.show_type }).catch(() => null);
    }
    setItems((prev) => prev.filter((i) => i.pattern_id !== patternId));
  };

  if (items.length === 0) return null;

  return (
    <div className="fixed right-4 top-[50px] z-[9990] flex flex-col gap-2 max-w-[380px] pointer-events-auto">
      {items.map((item, i) => {
        const typeIcon = item.show_type === "transcript" ? "🎙️"
          : item.show_type === "diff" ? "📝"
          : item.show_type === "screenshot" ? "📸"
          : item.show_type === "status" ? "💓"
          : item.show_type === "document" ? "📄"
          : "💡";

        return (
          <div
            key={item.pattern_id}
            className="animate-[blade-card-in_0.4s_cubic-bezier(0.22,1,0.36,1)_both]"
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            <div
              className="rounded-2xl border border-[rgba(255,255,255,0.12)] overflow-hidden"
              style={{
                background: "rgba(12,12,18,0.92)",
                backdropFilter: "blur(24px) saturate(1.6)",
                WebkitBackdropFilter: "blur(24px) saturate(1.6)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06) inset",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgba(255,255,255,0.07)]">
                <div className="flex items-center gap-2">
                  <span className="text-[14px]">{typeIcon}</span>
                  <span className="text-[11px] font-semibold text-[rgba(255,255,255,0.7)]">
                    {item.content_query}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-[rgba(255,255,255,0.25)]">
                    auto · shown {item.times_shown}x
                  </span>
                  <button
                    onClick={() => dismiss(item.pattern_id)}
                    className="ml-2 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[rgba(255,255,255,0.3)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[11px]"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="px-4 py-3 max-h-[200px] overflow-y-auto">
                <pre className="text-[11px] text-[rgba(255,255,255,0.6)] whitespace-pre-wrap font-mono leading-[1.5]">
                  {item.content.substring(0, 500)}
                </pre>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
