/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./quickask.html", "./overlay.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        blade: {
          // Core palette — true black foundation
          bg:               "#08080a",
          surface:          "#111115",
          "surface-hover":  "#17171c",
          "surface-active": "#1c1c24",

          // Borders — barely-there, not thick gray
          border:           "#1e1e24",
          "border-hover":   "#2a2a35",
          "border-strong":  "#3a3a48",

          // Accent — indigo with glow
          accent:           "#6366f1",
          "accent-hover":   "#7c7ffa",
          "accent-muted":   "rgba(99, 102, 241, 0.10)",
          "accent-glow":    "rgba(99, 102, 241, 0.25)",

          // Text hierarchy
          text:             "#e4e4e7",
          secondary:        "#a1a1aa",
          muted:            "#71717a",
          "muted-dim":      "#52525b",

          // Semantic colors
          success:          "#22c55e",
          error:            "#ef4444",
          warning:          "#f59e0b",
          info:             "#3b82f6",
        }
      },

      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Consolas", "monospace"],
      },

      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
        "3xs": ["0.55rem", { lineHeight: "0.85rem" }],
      },

      boxShadow: {
        // Accent glow — used on primary buttons and focused elements
        "glow-accent": "0 0 0 1px rgba(99,102,241,0.15), 0 0 20px rgba(99,102,241,0.2), 0 0 40px rgba(99,102,241,0.06)",
        "glow-accent-sm": "0 0 12px rgba(99,102,241,0.25), 0 0 4px rgba(99,102,241,0.1)",
        "glow-success": "0 0 12px rgba(34,197,94,0.25)",
        "glow-error":   "0 0 12px rgba(239,68,68,0.25)",

        // Elevated surfaces
        "surface-sm":  "0 1px 4px rgba(0,0,0,0.4), 0 0 0 1px rgba(30,30,36,0.6)",
        "surface-md":  "0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(30,30,36,0.5)",
        "surface-lg":  "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(30,30,36,0.4)",
        "surface-xl":  "0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(30,30,36,0.3)",

        // Inner glow for inputs
        "inner-focus": "inset 0 0 0 1px rgba(99,102,241,0.3), 0 0 0 3px rgba(99,102,241,0.1)",
      },

      backdropBlur: {
        xs: "4px",
      },

      animation: {
        // Existing
        "fade-in":     "fadeIn 0.18s ease-out",
        "slide-in":    "slideIn 0.2s ease-out",
        "pulse-slow":  "pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite",

        // New premium animations
        "fade-up":        "fadeUp 0.22s ease-out",
        "slide-in-right": "slideInRight 0.2s ease-out",
        "pulse-subtle":   "pulseSubtle 2s ease-in-out infinite",
        "send-pulse":     "sendPulse 2s ease-in-out infinite",

        // Status dots
        "ping-slow":  "ping 2s cubic-bezier(0, 0, 0.2, 1) infinite",
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
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%":   { opacity: "0", transform: "translateX(10px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1",   transform: "scale(1)" },
          "50%":       { opacity: "0.6", transform: "scale(0.92)" },
        },
        sendPulse: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(99, 102, 241, 0)" },
          "50%":       { boxShadow: "0 0 0 4px rgba(99, 102, 241, 0.15)" },
        },
      },

      transitionDuration: {
        150:  "150ms",
        200:  "200ms",
        300:  "300ms",
      },

      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
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
