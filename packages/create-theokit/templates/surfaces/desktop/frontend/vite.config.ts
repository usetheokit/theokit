import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * M47 — the desktop webview bundle. A React app (`@theokit/ui` + `useAgent`) that imports bare specifiers
 * (`theokit/client`, `@theokit/ui`, `@theokit/tauri`), so it must be bundled; Vite emits `frontend/dist`,
 * which `src-tauri/tauri.conf.json` serves as `frontendDist`. `@vitejs/plugin-react` compiles the JSX.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  clearScreen: false,
})
