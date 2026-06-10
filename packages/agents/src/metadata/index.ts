// Re-export setMeta/getMeta from http-decorators (DRY — single metadata engine)
// Relative path for workspace-local usage; vitest resolves via alias
export { setMeta, getMeta } from '@theokit/http-decorators'

export * from './keys.js'
