import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    decorators: 'src/decorators-entry.ts',
    bridge: 'src/bridge-entry.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@theokit/http', '@theokit/sdk', 'reflect-metadata', 'zod'],
})
