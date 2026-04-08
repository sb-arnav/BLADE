import { useState, useCallback, useMemo } from "react";

/**
 * Color Tools — color picker, palette generator, contrast checker.
 * Essential for designers and frontend devs using Blade.
 */

export interface Color {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  name?: string;
}

export interface ColorPalette {
  id: string;
  name: string;
  colors: Color[];
  type: "custom" | "complementary" | "analogous" | "triadic" | "monochromatic";
  createdAt: number;
}

export interface ContrastResult {
  ratio: number;
  aa: boolean;       // passes AA (4.5:1)
  aaa: boolean;      // passes AAA (7:1)
  aaLarge: boolean;   // passes AA Large (3:1)
}

// Color conversion utilities
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(color1: Color, color2: Color): ContrastResult {
  const l1 = getRelativeLuminance(color1.rgb.r, color1.rgb.g, color1.rgb.b);
  const l2 = getRelativeLuminance(color2.rgb.r, color2.rgb.g, color2.rgb.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: Math.round(ratio * 100) / 100,
    aa: ratio >= 4.5,
    aaa: ratio >= 7,
    aaLarge: ratio >= 3,
  };
}

function parseColor(input: string): Color | null {
  // Hex
  const hexMatch = input.match(/^#?([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 6 || hex.length === 8) {
      const rgb = hexToRgb("#" + hex.slice(0, 6));
      return { hex: "#" + hex.slice(0, 6), rgb, hsl: rgbToHsl(rgb.r, rgb.g, rgb.b) };
    }
  }

  // RGB
  const rgbMatch = input.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]), g = parseInt(rgbMatch[2]), b = parseInt(rgbMatch[3]);
    return { hex: rgbToHex(r, g, b), rgb: { r, g, b }, hsl: rgbToHsl(r, g, b) };
  }

  // HSL
  const hslMatch = input.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/i);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]), s = parseInt(hslMatch[2]), l = parseInt(hslMatch[3]);
    const rgb = hslToRgb(h, s, l);
    return { hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl: { h, s, l } };
  }

  return null;
}

// Generate palette variations
function generatePalette(baseColor: Color, type: ColorPalette["type"]): Color[] {
  const { h, s, l } = baseColor.hsl;
  const colors: Color[] = [baseColor];

  switch (type) {
    case "complementary": {
      const compH = (h + 180) % 360;
      const rgb = hslToRgb(compH, s, l);
      colors.push({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl: { h: compH, s, l } });
      break;
    }
    case "analogous": {
      for (const offset of [-30, 30]) {
        const newH = (h + offset + 360) % 360;
        const rgb = hslToRgb(newH, s, l);
        colors.push({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl: { h: newH, s, l } });
      }
      break;
    }
    case "triadic": {
      for (const offset of [120, 240]) {
        const newH = (h + offset) % 360;
        const rgb = hslToRgb(newH, s, l);
        colors.push({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl: { h: newH, s, l } });
      }
      break;
    }
    case "monochromatic": {
      for (const newL of [20, 40, 60, 80]) {
        if (newL === l) continue;
        const rgb = hslToRgb(h, s, newL);
        colors.push({ hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, hsl: { h, s, l: newL } });
      }
      break;
    }
  }

  return colors;
}

const STORAGE_KEY = "blade-palettes";

function loadPalettes(): ColorPalette[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function savePalettes(palettes: ColorPalette[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));
}

export function useColorTools() {
  const [palettes, setPalettes] = useState<ColorPalette[]>(loadPalettes);
  const [activeColor, setActiveColor] = useState<Color>({
    hex: "#6366f1",
    rgb: { r: 99, g: 102, b: 241 },
    hsl: { h: 239, s: 84, l: 67 },
  });

  const setColorFromString = useCallback((input: string) => {
    const parsed = parseColor(input);
    if (parsed) setActiveColor(parsed);
  }, []);

  const generatePaletteFromActive = useCallback((type: ColorPalette["type"], name?: string): string => {
    const colors = generatePalette(activeColor, type);
    const palette: ColorPalette = {
      id: crypto.randomUUID(),
      name: name || `${type} palette`,
      colors,
      type,
      createdAt: Date.now(),
    };
    setPalettes((prev) => {
      const next = [...prev, palette];
      savePalettes(next);
      return next;
    });
    return palette.id;
  }, [activeColor]);

  const deletePalette = useCallback((id: string) => {
    setPalettes((prev) => {
      const next = prev.filter((p) => p.id !== id);
      savePalettes(next);
      return next;
    });
  }, []);

  const contrast = useMemo(() => {
    const white: Color = { hex: "#ffffff", rgb: { r: 255, g: 255, b: 255 }, hsl: { h: 0, s: 0, l: 100 } };
    const black: Color = { hex: "#000000", rgb: { r: 0, g: 0, b: 0 }, hsl: { h: 0, s: 0, l: 0 } };
    return {
      onWhite: getContrastRatio(activeColor, white),
      onBlack: getContrastRatio(activeColor, black),
    };
  }, [activeColor]);

  const cssString = useMemo(() => ({
    hex: activeColor.hex,
    rgb: `rgb(${activeColor.rgb.r}, ${activeColor.rgb.g}, ${activeColor.rgb.b})`,
    hsl: `hsl(${activeColor.hsl.h}, ${activeColor.hsl.s}%, ${activeColor.hsl.l}%)`,
    tailwind: `bg-[${activeColor.hex}]`,
  }), [activeColor]);

  return {
    activeColor,
    setActiveColor,
    setColorFromString,
    parseColor,
    contrast,
    cssString,
    palettes,
    generatePaletteFromActive,
    deletePalette,
    getContrastRatio,
    generatePalette,
  };
}
