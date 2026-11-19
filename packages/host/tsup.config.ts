import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // theokit#154 — keep the mapping, drop the embedded sources.
  esbuildOptions(options) {
    options.sourcesContent = false
  },
  clean: true,
})
