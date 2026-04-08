import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="h-10 border-b border-blade-border bg-blade-bg/95 backdrop-blur flex items-center justify-between px-3 shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-xs text-blade-muted">
        <div className="w-2 h-2 rounded-full bg-blade-accent" />
        <span className="font-medium tracking-wide uppercase">Blade</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => appWindow.minimize()}
          className="w-8 h-8 rounded-lg text-blade-muted hover:text-blade-text hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Minimize window"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-8 h-8 rounded-lg text-blade-muted hover:text-blade-text hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Maximize window"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-8 rounded-lg text-blade-muted hover:text-red-400 hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Close window"
        >
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
