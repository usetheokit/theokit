import { defineConfig } from 'vite'

/**
 * M45 — the desktop webview bundle. It imports `theokit/client/core` (bare specifier) so it must be
 * bundled; Vite emits `frontend/dist`, which `src-tauri/tauri.conf.json` serves as `frontendDist`.
 */
export default defineConfig({
  root: __dirname,
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  clearScreen: false,
})
