import { useCallback, useEffect, useState } from "react";

const ACCENT_COLORS = [
  "#6366f1", // indigo (default)
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
] as const;

const STORAGE_KEY = "blade-accent";
const DEFAULT_ACCENT = "#6366f1";

export function useAccentColor() {
  const [accent, setAccentState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ACCENT;
    } catch {
      return DEFAULT_ACCENT;
    }
  });

  const setAccent = useCallback((color: string) => {
    setAccentState(color);
    try {
      localStorage.setItem(STORAGE_KEY, color);
    } catch {
      // storage unavailable
    }
    document.documentElement.style.setProperty("--blade-accent", color);
  }, []);

  // Apply on mount
  useEffect(() => {
    document.documentElement.style.setProperty("--blade-accent", accent);
  }, [accent]);

  return { accent, setAccent };
}

interface AccentPickerProps {
  current: string;
  onChange: (color: string) => void;
}

export default function AccentPicker({ current, onChange }: AccentPickerProps) {
  return (
    <div className="flex items-center gap-2">
      {ACCENT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={`w-6 h-6 rounded-full cursor-pointer transition-all ${
            current === color ? "ring-2 ring-white/30" : ""
          }`}
          style={{ backgroundColor: color }}
          aria-label={`Select accent color ${color}`}
        />
      ))}
    </div>
  );
}
