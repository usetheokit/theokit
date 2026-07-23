import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Peer — consumed via types, provided by the host.
  external: ['@theokit/sdk', 'ai'],
})
