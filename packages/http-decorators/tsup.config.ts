import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/theokit-plugin.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['theokit', 'reflect-metadata', 'zod'],
})
