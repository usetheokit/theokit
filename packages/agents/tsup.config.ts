import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ask: 'src/ask/index.ts',
    commands: 'src/commands/index.ts',
    doctor: 'src/doctor/index.ts',
    usage: 'src/usage/index.ts',
    'mcp-health': 'src/mcp-health-entry.ts',
    // B-407 (F-arch-5) — the A2A client: remote delegation most agents never import.
    a2a: 'src/a2a-entry.ts',
    // B-413 — run cases against an agent and read a verdict per case; development-time tooling.
    evals: 'src/evals-entry.ts',
    // B-410 — a conversation one agent hands to another; an app-facing orchestrator.
    handoff: 'src/handoff-entry.ts',
    // A stub, not the backend: `./pty` resolves so an upgrading consumer gets a migration
    // sentence instead of ERR_MODULE_NOT_FOUND. It imports nothing (#460).
    pty: 'src/pty-entry.ts',
    'tool-scope': 'src/tools/index.ts',
    bridge: 'src/bridge-entry.ts',
    testing: 'src/testing/index.ts',
    // M58 — pass-through subpaths mirroring the SDK's own split.
    sandbox: 'src/sandbox-entry.ts',
    persistence: 'src/persistence-entry.ts',
    interactive: 'src/interactive-entry.ts',
    // M60 — enriched auth domain.
    auth: 'src/auth-entry.ts',
    // Agent configuration, trust and the instruction tree — moved out of `theokit`
    // (the WEB package) so an agent builder reaches them from the package they install.
    config: 'src/config-entry.ts',
    // M62 — pass-through of the sdk-tools factories.
    tools: 'src/tools-entry.ts',
    // B-386 — scripts that call tools by RPC, over an injected sandbox; imports no VM.
    'code-mode': 'src/code-mode-entry.ts',
    // B-386 — the QuickJS-WASM sandbox. The only entry that imports the VM, an optional peer.
    'code-mode-quickjs': 'src/code-mode-quickjs-entry.ts',
    // M84 — the client chain came from the CLI; its own subpath because `use-agent` imports React.
    client: 'src/client-entry.ts',
    'client-react': 'src/client-react-entry.ts',
    // M71 — the session LIFECYCLE vocabulary. Its own subpath because it is composition over the
    // persistence primitives, not another pass-through of them.
    session: 'src/session/index.ts',
    // M75 — the hook engine as a subpath: reachable by anyone who wants it, paid for only by them.
    hooks: 'src/hooks/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // theokit#154 — keep the mapping, drop the embedded sources.
  //
  // `sourcemap: true` alone shipped `sourcesContent`, which embeds the ORIGINAL TypeScript in the
  // published map. Measured on @theokit/agents before this change: 652K of a 1.2M `dist` was maps
  // (54%), and the largest one carried 303 889 bytes of source across 48 files. Nobody decided to
  // publish the sources — it fell out of the bundler default.
  //
  // `sourcesContent: false` keeps what the map is FOR (a readable stack trace pointing at file and
  // line) and drops what it was leaking. The alternative, turning sourcemaps off entirely, would
  // also take the stack traces, which is a real loss for a consumer debugging against our dist.
  esbuildOptions(options) {
    options.sourcesContent = false
  },
  clean: true,
  external: [
    '@jitl/quickjs-wasmfile-release-sync',
    '@theokit/http',
    '@theokit/presenter',
    '@theokit/sdk',
    '@theokit/sdk-tools',
    'quickjs-emscripten-core',
    'zod',
  ],
})
