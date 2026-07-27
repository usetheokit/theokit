import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bridge: 'src/bridge-entry.ts',
    testing: 'src/testing/index.ts',
    // M58 — pass-through subpaths mirroring the SDK's own split.
    sandbox: 'src/sandbox-entry.ts',
    persistence: 'src/persistence-entry.ts',
    interactive: 'src/interactive-entry.ts',
    pty: 'src/pty-entry.ts',
    // M60 — enriched auth domain.
    auth: 'src/auth-entry.ts',
    // M62 — pass-through of the sdk-tools factories.
    tools: 'src/tools-entry.ts',
    // M84 — a cadeia de cliente veio do CLI; subpath próprio porque `use-agent` importa React.
    client: 'src/client-entry.ts',
    'client-react': 'src/client-react-entry.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@theokit/http', '@theokit/sdk', '@theokit/sdk-pty', '@theokit/sdk-tools', 'zod'],
})
