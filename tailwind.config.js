/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        blade: {
          bg: "#0a0a0a",
          surface: "#111111",
          border: "#1f1f1f",
          accent: "#6366f1",
          text: "#e5e5e5",
          muted: "#666666",
        }
      }
    },
  },
  plugins: [],
}
