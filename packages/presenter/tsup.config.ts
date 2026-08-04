import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
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
  // Peer — consumed via types, provided by the host.
  external: ['@theokit/sdk', 'ai'],
})
