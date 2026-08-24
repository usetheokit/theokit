import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/wire/index.ts'],
  // One `external`, deliberately. There were two keys in this literal, and the second silently won
  // (CodeQL `js/overwritten-property`, alert 258): `external: ['zod', '@theokit/sdk']` here and
  // `external: ['@theokit/sdk', 'ai']` below. So the line naming `zod` had no effect at all.
  //
  // It did not break, and the reason it did not is worth writing down: `zod` is a peerDependency,
  // and tsup externalises peers by default — so the built output imports `zod` rather than bundling
  // it, protected by a mechanism nobody was relying on. Move `zod` out of `peerDependencies` and it
  // would start bundling with nothing to say so.
  //
  // Why that matters: a second `zod` instance in a consumer's process disagrees with the first on
  // `instanceof` checks, in ways that are miserable to diagnose. `ai` and `@theokit/sdk` are peers
  // consumed through types and provided by the host.
  external: ['zod', '@theokit/sdk', 'ai'],
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
})
