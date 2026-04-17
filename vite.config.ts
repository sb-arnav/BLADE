import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Port 1420 must match src-tauri/tauri.conf.json → build.devUrl.
// Each entry is a separate Tauri webview window created in src-tauri/src/lib.rs:
//   index.html    → main window   (label: main)
//   quickask.html → overlay pill   (label: quickask, 500×72, always-on-top)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    hmr: { host: "127.0.0.1", port: 1421 },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "chrome110",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        quickask: resolve(__dirname, "quickask.html"),
      },
    },
  },
});
