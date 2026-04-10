import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const handleDragStart = async () => {
    try {
      await appWindow.startDragging();
    } catch {
      // Ignore drag failures on unsupported platforms.
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch {
      // Ignore window control failures.
    }
  };

  return (
    <div className="h-9 bg-blade-bg flex items-center gap-3 px-3 shrink-0 select-none border-b border-blade-border/40">
      <div
        className="flex items-center gap-1.5 shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
        onDoubleClick={handleToggleMaximize}
        title="Drag window"
      >
        <div className="w-2 h-2 rounded-full bg-blade-accent shadow-[0_0_10px_rgba(99,102,241,0.45)]" />
        <span className="text-2xs font-medium tracking-[0.35em] uppercase text-blade-muted">
          Blade
        </span>
      </div>

      <div
        className="flex-1 h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
        onDoubleClick={handleToggleMaximize}
        title="Drag window"
      />

      <div className="flex items-center gap-0.5 titlebar-no-drag shrink-0">
        <button
          onClick={() => appWindow.minimize()}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Minimize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={handleToggleMaximize}
          className="w-8 h-8 rounded-md text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface transition-colors flex items-center justify-center"
          aria-label="Maximize"
        >
          <svg viewBox="0 0 24 24" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="5" y="5" width="14" height="14" rx="1.5" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
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
