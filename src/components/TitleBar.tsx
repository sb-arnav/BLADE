import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const minimize = async () => {
    try { await appWindow.minimize(); } catch {}
  };

  const toggleMaximize = async () => {
    try { await appWindow.toggleMaximize(); } catch {}
  };

  const closeWindow = async () => {
    try { await appWindow.close(); } catch {}
  };

  return (
    <div
      className="h-9 bg-blade-bg flex items-center gap-3 px-3 shrink-0 select-none border-b border-blade-border/40"
      data-tauri-drag-region
    >
      <div className="flex items-center gap-1.5 shrink-0 pointer-events-none" data-tauri-drag-region>
        <div className="w-2 h-2 rounded-full bg-blade-accent shadow-[0_0_10px_rgba(99,102,241,0.45)]" />
        <span className="text-2xs font-semibold tracking-[0.3em] text-blade-muted">
          BLADE
        </span>
      </div>

      <div className="flex-1 h-full" data-tauri-drag-region />

      <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={minimize}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Minimize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={toggleMaximize}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Maximize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="5" y="5" width="14" height="14" rx="1.5" />
          </svg>
        </button>
        <button
          onClick={closeWindow}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-red-400 hover:bg-red-400/10 transition-colors flex items-center justify-center"
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
