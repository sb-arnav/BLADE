// src/lib/colorUtils.ts
// Ported from industry standard hex/hsl parsers akin to d3-color & polished.js

export interface RGB { r: number, g: number, b: number }
export interface HSL { h: number, s: number, l: number }

export class ColorUtils {
  
  /**
   * Converts a HEX string (e.g., "#818cf8") to RGB.
   */
  static hexToRgb(hex: string): RGB {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    if (!result) throw new Error(`Invalid hex color: ${hex}`);
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    };
  }

  /**
   * Converts RGB to perceived luminance to calculate contrast correctly.
   */
  static getLuminance({ r, g, b }: RGB): number {
    const [rs, gs, bs] = [r, g, b].map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  /**
   * Determine whether white or black text should overlay a background hex color
   * to satisfy WCAG AA ratio standards.
   */
  static getContrastForeground(bgHex: string): string {
    const rgb = this.hexToRgb(bgHex);
    const luminance = this.getLuminance(rgb);
    // If luminance is high, return dark color; else light.
    return luminance > 0.179 ? '#09090b' : '#fafafa';
  }

  /**
   * Helper to fade a hex color by turning it into rgba(r,g,b,alpha)
   */
  static alpha(hex: string, alpha: number): string {
    const { r, g, b } = this.hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }
}
