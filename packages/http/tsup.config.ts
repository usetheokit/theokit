import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/theokit-plugin.ts', 'src/app.ts', 'src/runtime-node.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Peer deps + heavy optional deps externalized (not bundled)
  external: [
    'theokit',
    'reflect-metadata',
    'zod',
    '@swc/core',
    '@theokit/agents',
    'react',
    'react-dom',
    'react-dom/server',
  ],
})
