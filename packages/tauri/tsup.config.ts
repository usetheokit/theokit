import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Webview glue (browser) — imports theokit/client/core (React-free).
    index: 'src/index.ts',
    // Node sidecar helper — imports theokit/server (streamAgentTurnInProcess).
    sidecar: 'src/sidecar.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  external: ['theokit', '@theokit/sdk', '@theokit/agents', '@tauri-apps/api', 'ai', 'react'],
})
