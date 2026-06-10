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
  external: ['@theokit/http-decorators', '@theokit/sdk', 'reflect-metadata', 'zod'],
})
