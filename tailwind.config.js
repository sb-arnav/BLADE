/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./quickask.html", "./overlay.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        blade: {
          // Apple dark palette
          bg:               "#09090b",
          surface:          "#1c1c1e",        // Apple's dark surface
          "surface-2":      "#2c2c2e",        // elevated surface
          "surface-hover":  "#2c2c2e",
          "surface-active": "#3a3a3c",

          // Separators — Apple's subtle dark borders
          border:           "#38383a",        // Apple's dark separator
          "border-hover":   "#48484a",
          "border-strong":  "#545456",

          // Accent — Apple purple + blue
          accent:           "#5856D6",        // Apple purple
          "accent-blue":    "#007AFF",        // Apple blue
          "accent-hover":   "#6E6CE8",
          "accent-muted":   "rgba(88, 86, 214, 0.12)",
          "accent-glow":    "rgba(88, 86, 214, 0.20)",

          // Text hierarchy — Apple's text colors
          text:             "#ffffff",
          secondary:        "#ebebf5cc",      // Apple secondary label
          muted:            "#8e8e93",        // Apple secondary text
          "muted-dim":      "#636366",

          // Semantic colors
          success:          "#30d158",        // Apple green
          error:            "#ff453a",        // Apple red
          warning:          "#ffd60a",        // Apple yellow
          info:             "#007AFF",        // Apple blue
        }
      },

      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "sans-serif"],
        mono: ["SF Mono", "JetBrains Mono", "Consolas", "monospace"],
      },

      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
        "3xs": ["0.55rem", { lineHeight: "0.85rem" }],
      },

      boxShadow: {
        // Apple-style layered shadows — no glow, real depth
        "card":       "0 0 0 1px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)",
        "card-hover": "0 0 0 1px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.08), 0 8px 20px rgba(0,0,0,0.12)",
        "modal":      "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.6), 0 32px 64px rgba(0,0,0,0.4)",
        "popover":    "0 0 0 1px rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.4), 0 16px 32px rgba(0,0,0,0.3)",

        // Legacy names kept for compatibility
        "glow-accent":    "0 0 0 1px rgba(88,86,214,0.15), 0 0 12px rgba(88,86,214,0.15)",
        "glow-accent-sm": "0 0 8px rgba(88,86,214,0.2)",
        "glow-success":   "0 0 8px rgba(48,209,88,0.2)",
        "glow-error":     "0 0 8px rgba(255,69,58,0.2)",

        "surface-sm":  "0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04)",
        "surface-md":  "0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
        "surface-lg":  "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
        "surface-xl":  "0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",

        "inner-focus": "inset 0 0 0 1px rgba(88,86,214,0.3), 0 0 0 3px rgba(88,86,214,0.1)",
      },

      backdropBlur: {
        xs: "4px",
      },

      animation: {
        "fade-in":     "fadeIn 0.18s ease-out",
        "slide-in":    "slideIn 0.2s ease-out",
        "pulse-slow":  "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",

        "fade-up":        "fadeUp 0.22s cubic-bezier(0.25, 0.1, 0.25, 1)",
        "slide-in-right": "slideInRight 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)",
        "pulse-subtle":   "pulseSubtle 2.5s ease-in-out infinite",

        "ping-slow":  "ping 3s cubic-bezier(0, 0, 0.2, 1) infinite",
      },

      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%":   { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        fadeUp: {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%":   { opacity: "0", transform: "translateX(8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1",   transform: "scale(1)" },
          "50%":       { opacity: "0.6", transform: "scale(0.94)" },
        },
      },

      transitionDuration: {
        150:  "150ms",
        200:  "200ms",
        250:  "250ms",
        300:  "300ms",
      },

      transitionTimingFunction: {
        // Apple's default easing
        smooth: "cubic-bezier(0.25, 0.1, 0.25, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },

      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
    },
  },
  plugins: [],
}
