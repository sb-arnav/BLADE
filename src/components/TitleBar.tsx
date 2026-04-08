import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="h-9 bg-blade-bg flex items-center justify-between px-3 shrink-0 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-1.5">
        <div className="w-[7px] h-[7px] rounded-full bg-blade-accent" />
        <span className="text-2xs font-medium tracking-widest uppercase text-blade-muted">
          Blade
        </span>
      </div>

      <div className="flex items-center">
        <button
          onClick={() => appWindow.minimize()}
          className="w-7 h-7 rounded text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Minimize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-7 h-7 rounded text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Maximize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="5" y="5" width="14" height="14" rx="1.5" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-7 h-7 rounded text-blade-muted/60 hover:text-red-400 hover:bg-red-400/10 transition-colors flex items-center justify-center"
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
