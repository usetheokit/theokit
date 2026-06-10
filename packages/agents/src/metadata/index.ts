// Re-export setMeta/getMeta from http-decorators (DRY — single metadata engine)
// Imported via package barrel — NOT relative path (per architecture.md Invariant 3)
export { setMeta, getMeta } from '@theokit/http-decorators'

export * from './keys.js'
