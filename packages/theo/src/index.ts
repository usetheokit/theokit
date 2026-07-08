// Config
export { defineConfig } from './config/define-config.js'
// M31 — the fluent `config()` builder (builder-only authoring API).
export { config, type ConfigBuilder } from './config/config-builder.js'
export { loadConfig, deepMerge } from './config/load-config.js'
export { theoConfigSchema } from './config/schema.js'
export type { TheoConfig } from './config/schema.js'
export { TheoConfigError } from './config/errors.js'
export type { ConfigIssue } from './config/errors.js'

// Core
export { validateProjectStructure } from './config/validate-structure.js'
export { TheoProjectError } from './core/errors.js'

// Vite Plugin
export { theoPlugin } from './vite-plugin/index.js'

// Router
export {
  scanRoutes,
  generateRouteManifest,
  generateEntryClient,
  isRouteFile,
} from './router/index.js'
export type { RouteNode } from './router/index.js'
