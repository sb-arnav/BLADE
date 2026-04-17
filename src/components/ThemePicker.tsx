import { useTheme, BladeTheme } from "../hooks/useTheme";

interface Props {
  open: boolean;
  onClose: () => void;
}

function ThemePreview({ theme, isActive, onClick }: { theme: BladeTheme; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition-all ${
        isActive
          ? "border-blade-accent ring-1 ring-blade-accent/30"
          : "border-blade-border hover:border-blade-border-hover"
      }`}
    >
      {/* Color preview bar */}
      <div className="flex gap-1 mb-2.5">
        <div
          className="w-6 h-6 rounded-lg border border-white/5"
          style={{ backgroundColor: theme.colors.bg }}
          title="Background"
        />
        <div
          className="w-6 h-6 rounded-lg border border-white/5"
          style={{ backgroundColor: theme.colors.surface }}
          title="Surface"
        />
        <div
          className="w-6 h-6 rounded-lg border border-white/5"
          style={{ backgroundColor: theme.colors.accent }}
          title="Accent"
        />
        <div
          className="w-6 h-6 rounded-lg border border-white/5"
          style={{ backgroundColor: theme.colors.text }}
          title="Text"
        />
        <div
          className="w-6 h-6 rounded-lg border border-white/5"
          style={{ backgroundColor: theme.colors.muted }}
          title="Muted"
        />
      </div>

      {/* Mini preview */}
      <div
        className="rounded-lg p-2 mb-2 border"
        style={{
          backgroundColor: theme.colors.bg,
          borderColor: theme.colors.border,
        }}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.colors.accent }} />
          <span className="text-2xs font-medium" style={{ color: theme.colors.muted }}>Blade</span>
        </div>
        <div className="space-y-1">
          <div
            className="text-right"
          >
            <span
              className="inline-block rounded-xl px-2 py-0.5 text-2xs"
              style={{ backgroundColor: theme.colors.accent, color: "#fff", opacity: 0.9 }}
            >
              Hello Blade
            </span>
          </div>
          <div
            className="text-2xs rounded px-1.5 py-0.5 border-l-2"
            style={{
              color: theme.colors.secondary,
              borderColor: theme.colors.border,
            }}
          >
            Hey! How can I help?
          </div>
        </div>
      </div>

      {/* Name and description */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">{theme.name}</p>
          <p className="text-2xs text-blade-muted">{theme.description}</p>
        </div>
        {isActive && (
          <span className="text-2xs text-blade-accent font-medium uppercase tracking-wider">Active</span>
        )}
      </div>
    </button>
  );
}

export function ThemePicker({ open, onClose }: Props) {
  const { themes, themeId, setTheme } = useTheme();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-blade-surface border border-blade-border rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-fade-in mx-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Themes</h2>
            <p className="text-2xs text-blade-muted mt-0.5">Choose your Blade aesthetic</p>
          </div>
          <button
            onClick={onClose}
            className="text-blade-muted hover:text-blade-secondary transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {themes.map((theme) => (
            <ThemePreview
              key={theme.id}
              theme={theme}
              isActive={theme.id === themeId}
              onClick={() => setTheme(theme.id)}
            />
          ))}
        </div>

        <p className="text-2xs text-blade-muted/50 mt-4 text-center">
          Theme changes apply instantly. Your choice is saved.
        </p>
      </div>
    </div>
  );
}
