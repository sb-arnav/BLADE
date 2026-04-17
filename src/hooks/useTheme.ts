import { useState, useEffect, useCallback, useMemo } from "react";

export interface BladeTheme {
  id: string;
  name: string;
  description: string;
  colors: {
    bg: string;
    surface: string;
    surfaceHover: string;
    border: string;
    borderHover: string;
    accent: string;
    accentHover: string;
    accentMuted: string;
    text: string;
    secondary: string;
    muted: string;
  };
  isDark: boolean;
}

const BUILT_IN_THEMES: BladeTheme[] = [
  {
    id: "midnight",
    name: "Midnight",
    description: "Default dark theme",
    isDark: true,
    colors: {
      bg: "#09090b",
      surface: "#0f0f12",
      surfaceHover: "#151519",
      border: "#1c1c22",
      borderHover: "#2a2a33",
      accent: "#6366f1",
      accentHover: "#818cf8",
      accentMuted: "rgba(99, 102, 241, 0.12)",
      text: "#ececef",
      secondary: "#a1a1aa",
      muted: "#52525b",
    },
  },
  {
    id: "abyss",
    name: "Abyss",
    description: "Deep blue darkness",
    isDark: true,
    colors: {
      bg: "#080c14",
      surface: "#0c1220",
      surfaceHover: "#111828",
      border: "#1a2332",
      borderHover: "#243044",
      accent: "#3b82f6",
      accentHover: "#60a5fa",
      accentMuted: "rgba(59, 130, 246, 0.12)",
      text: "#e2e8f0",
      secondary: "#94a3b8",
      muted: "#475569",
    },
  },
  {
    id: "emerald",
    name: "Emerald",
    description: "Green-tinted dark",
    isDark: true,
    colors: {
      bg: "#080d0a",
      surface: "#0c140e",
      surfaceHover: "#111c14",
      border: "#1a291e",
      borderHover: "#243a29",
      accent: "#10b981",
      accentHover: "#34d399",
      accentMuted: "rgba(16, 185, 129, 0.12)",
      text: "#e2f0e8",
      secondary: "#94b8a4",
      muted: "#476957",
    },
  },
  {
    id: "rose",
    name: "Rosewood",
    description: "Warm dark with rose accent",
    isDark: true,
    colors: {
      bg: "#0d0809",
      surface: "#14100e",
      surfaceHover: "#1c1614",
      border: "#291e1c",
      borderHover: "#3a2a27",
      accent: "#f43f5e",
      accentHover: "#fb7185",
      accentMuted: "rgba(244, 63, 94, 0.12)",
      text: "#f0e2e4",
      secondary: "#b8949a",
      muted: "#694750",
    },
  },
  {
    id: "amber",
    name: "Sandstorm",
    description: "Warm amber dark",
    isDark: true,
    colors: {
      bg: "#0d0b08",
      surface: "#141110",
      surfaceHover: "#1c1814",
      border: "#29221c",
      borderHover: "#3a3027",
      accent: "#f59e0b",
      accentHover: "#fbbf24",
      accentMuted: "rgba(245, 158, 11, 0.12)",
      text: "#f0ece2",
      secondary: "#b8a894",
      muted: "#695847",
    },
  },
  {
    id: "purple",
    name: "Nebula",
    description: "Purple space theme",
    isDark: true,
    colors: {
      bg: "#0b080d",
      surface: "#110e16",
      surfaceHover: "#17131f",
      border: "#221c2e",
      borderHover: "#302742",
      accent: "#a855f7",
      accentHover: "#c084fc",
      accentMuted: "rgba(168, 85, 247, 0.12)",
      text: "#ece2f4",
      secondary: "#a894c0",
      muted: "#584770",
    },
  },
  {
    id: "mono",
    name: "Monochrome",
    description: "Pure grayscale, no color",
    isDark: true,
    colors: {
      bg: "#0a0a0a",
      surface: "#111111",
      surfaceHover: "#181818",
      border: "#222222",
      borderHover: "#333333",
      accent: "#ffffff",
      accentHover: "#e0e0e0",
      accentMuted: "rgba(255, 255, 255, 0.08)",
      text: "#e8e8e8",
      secondary: "#999999",
      muted: "#555555",
    },
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic inspired",
    isDark: true,
    colors: {
      bg: "#2e3440",
      surface: "#3b4252",
      surfaceHover: "#434c5e",
      border: "#4c566a",
      borderHover: "#5e6779",
      accent: "#88c0d0",
      accentHover: "#8fbcbb",
      accentMuted: "rgba(136, 192, 208, 0.12)",
      text: "#eceff4",
      secondary: "#d8dee9",
      muted: "#7b88a1",
    },
  },
];

const STORAGE_KEY = "blade-theme";

function applyTheme(theme: BladeTheme) {
  const root = document.documentElement;
  const { colors } = theme;

  root.style.setProperty("--blade-bg", colors.bg);
  root.style.setProperty("--blade-surface", colors.surface);
  root.style.setProperty("--blade-surface-hover", colors.surfaceHover);
  root.style.setProperty("--blade-border", colors.border);
  root.style.setProperty("--blade-border-hover", colors.borderHover);
  root.style.setProperty("--blade-accent", colors.accent);
  root.style.setProperty("--blade-accent-hover", colors.accentHover);
  root.style.setProperty("--blade-accent-muted", colors.accentMuted);
  root.style.setProperty("--blade-text", colors.text);
  root.style.setProperty("--blade-secondary", colors.secondary);
  root.style.setProperty("--blade-muted", colors.muted);

  // Also update body background for non-Tailwind elements
  document.body.style.background = colors.bg;
}

function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "midnight";
  } catch {
    return "midnight";
  }
}

function saveThemeId(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable
  }
}

export function useTheme() {
  const [themeId, setThemeId] = useState(loadThemeId);

  const themes = useMemo(() => BUILT_IN_THEMES, []);

  const currentTheme = useMemo(
    () => themes.find((t) => t.id === themeId) ?? themes[0],
    [themes, themeId],
  );

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  return {
    themes,
    currentTheme,
    themeId,
    setTheme,
  };
}
