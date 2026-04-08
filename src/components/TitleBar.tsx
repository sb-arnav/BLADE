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
          className="w-8 h-8 rounded-lg text-blade-muted hover:text-blade-text hover:bg-blade-surface transition-colors"
          aria-label="Minimize window"
        >
          _
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-8 rounded-lg text-blade-muted hover:text-blade-text hover:bg-blade-surface transition-colors"
          aria-label="Hide window"
        >
          x
        </button>
      </div>
    </div>
  );
}
