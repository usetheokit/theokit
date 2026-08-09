/**
 * Type declarations for sync-template-versions.mjs (T2.1 of the cross-repo-integration-cohesion plan).
 *
 * The script is a plain .mjs ES module with no TS. This declaration exists so the unit test
 * (`tests/unit/sync-template-versions.test.ts`) can import `syncTemplates` typed rather than as
 * `any`.
 */

export interface SyncTemplatesTruth {
  theokit?: string
  '@usetheo/sdk'?: string
  '@usetheo/ui'?: string
}

export interface SyncDriftEntry {
  tpl: string
  bucket: 'dependencies' | 'devDependencies'
  dep: string
  current: string
  expected: string
}

export interface SyncTemplatesResult {
  drifted: SyncDriftEntry[]
  written: number
  total: number
}

export interface SyncTemplatesOptions {
  mode?: 'check' | 'write'
  templatesDir?: string
  truth?: SyncTemplatesTruth
}

/**
 * Sync `package.json.tmpl` files under `templatesDir` against `truth`.
 * Mode 'check' reports drift without modifying; mode 'write' rewrites files.
 *
 * Walks recursively 2 levels deep (covers `services/agent-{node,python}/`).
 * Ignores `workspace:*` deps and absent deps (no force-add).
 */
export function syncTemplates(options?: SyncTemplatesOptions): SyncTemplatesResult
