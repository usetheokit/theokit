// Config — M31 builder-only: `config()` is the public authoring surface; `defineConfig` is now
// internal (imported by config-builder's `.build()` via source path), removed from the public API.
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
