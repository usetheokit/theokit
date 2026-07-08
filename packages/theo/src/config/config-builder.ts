/**
 * M31 Phase 3 — `config()`, the fluent builder that replaces `defineConfig({...})`.
 *
 * Config is a ~30-field flat bag — a pure setter chain would be worse DX than an object literal
 * (Vite/Nuxt/Astro keep config as identity for this reason). So `config()` is HYBRID (ADR-M31-3):
 * chainable setters for the common fields PLUS a `.set(partial)` escape hatch for the long tail.
 * `.build()` delegates to the internal {@link defineConfig} (identity) — `loadConfig` is UNCHANGED.
 *
 *   export default config()
 *     .serverDir('core')
 *     .agentsDir('core/agents')
 *     .appDir('apps/web')
 *     .set({ security: { csrf: 'strict' } })
 *     .build()
 */
import { defineConfig } from './define-config.js'
import type { TheoConfig } from './schema.js'

/** The fluent config builder. No field is required; `.set()` merges arbitrary config fields. */
export interface ConfigBuilder {
  /** Project identifier (DNS-1123) — used by `.theokit/services.json`. */
  name(value: TheoConfig['name']): ConfigBuilder
  /** Backend root dir (route/action/agent discovery). Default `'server'`. */
  serverDir(value: TheoConfig['serverDir']): ConfigBuilder
  /** Frontend root dir (file-based router). Default `'app'`. */
  appDir(value: TheoConfig['appDir']): ConfigBuilder
  /** Agents root dir. Default `'agents'`. */
  agentsDir(value: TheoConfig['agentsDir']): ConfigBuilder
  /** Build output dir. Default `'.theokit'`. */
  distDir(value: TheoConfig['distDir']): ConfigBuilder
  /** Dev/prod port. Default `3000`. */
  port(value: TheoConfig['port']): ConfigBuilder
  /** Bind host. Default `'localhost'`. */
  host(value: TheoConfig['host']): ConfigBuilder
  /** Enable server-side rendering. Default `false`. */
  ssr(value: TheoConfig['ssr']): ConfigBuilder
  /** Escape hatch — merge any config fields not covered by a dedicated setter (rate-limit, security…). */
  set(partial: Partial<TheoConfig>): ConfigBuilder
  /** Resolve to the `Partial<TheoConfig>` — the SAME value `defineConfig({...})` returns. */
  build(): Partial<TheoConfig>
}

function makeConfigBuilder(spec: Partial<TheoConfig>): ConfigBuilder {
  const merge = (patch: Partial<TheoConfig>): ConfigBuilder =>
    makeConfigBuilder({ ...spec, ...patch })
  return {
    name: (value) => merge({ name: value }),
    serverDir: (value) => merge({ serverDir: value }),
    appDir: (value) => merge({ appDir: value }),
    agentsDir: (value) => merge({ agentsDir: value }),
    distDir: (value) => merge({ distDir: value }),
    port: (value) => merge({ port: value }),
    host: (value) => merge({ host: value }),
    ssr: (value) => merge({ ssr: value }),
    set: (partial) => merge(partial),
    build: () => defineConfig(spec),
  }
}

/**
 * Start a fluent config definition. Chain the common setters and/or `.set(partial)`, then `.build()`.
 */
export function config(): ConfigBuilder {
  return makeConfigBuilder({})
}
