import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  // `@theokit/sdk-pty` is a real dependency and must stay external: bundling a package with a
  // native install step would copy its JS and leave its binding behind.
  external: ['@theokit/sdk-pty'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // theokit#154 — keep the mapping, drop the embedded sources.
  esbuildOptions(options) {
    options.sourcesContent = false
  },
  clean: true,
})
