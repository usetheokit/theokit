import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadConfig } from '../../packages/theo/src/config/load-config.js'
import { configureStorageManagerFromConfig } from '../../packages/theo/src/cli/commands/start/bootstrap-stages.js'
import type { PostgresJobBackend } from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import {
  __resetSingletonForTests,
  getStorageManager,
} from '../../packages/theo/src/server/storage/storage-manager.js'

/**
 * `jobs.backend` is declared in `theo.config.ts`, and `PostgresJobBackend.fromStorageManager` is the
 * documented way to build one on the manager's pool. The `storage` block of the same file reaches the
 * manager only after the module has been evaluated, so the call resolved the pool too early and the
 * config failed to load with `Database "main" not configured` (usetheokit/theokit#1133).
 *
 * The config below is the one from the report, loaded by the real `loadConfig`.
 */
const REPO = resolve(__dirname, '../..')
const APP = resolve(__dirname, '..', '.tmp-jobs-backend-from-a-theo-config')

const POSTGRES_BACKEND = resolve(REPO, 'packages/theo/src/server/jobs/job-backend-postgres.ts')
const STORAGE_MANAGER = resolve(REPO, 'packages/theo/src/server/storage/storage-manager.ts')

beforeAll(() => {
  rmSync(APP, { recursive: true, force: true })
  mkdirSync(APP, { recursive: true })
  writeFileSync(join(APP, 'package.json'), '{ "type": "module" }')
  writeFileSync(
    join(APP, 'theo.config.ts'),
    `import { PostgresJobBackend } from ${JSON.stringify(POSTGRES_BACKEND)}
import { getStorageManager } from ${JSON.stringify(STORAGE_MANAGER)}

// Counts how many pools the factory built, on globalThis so the test can read it.
globalThis.__poolsBuilt = 0
const factory = () => {
  globalThis.__poolsBuilt += 1
  return { query: async () => ({ rows: [{ one: 1 }] }), end: async () => {} }
}

export default {
  storage: {
    servers: { primary: { host: 'localhost', port: 5432, user: 'app', password: 'x' } },
    databases: { main: { server: 'primary', database: 'app' } },
  },
  jobs: {
    backend: PostgresJobBackend.fromStorageManager(getStorageManager(), 'main', factory),
    worker: { enabled: false },
  },
}
`,
  )
})
afterAll(() => rmSync(APP, { recursive: true, force: true }))

describe('a theo.config.ts that builds its jobs backend on the storage manager', () => {
  it('test_the_config_loads_and_the_pool_is_resolved_when_the_backend_is_first_used', async () => {
    __resetSingletonForTests()
    ;(globalThis as { __poolsBuilt?: number }).__poolsBuilt = 0

    const config = await loadConfig(APP)
    expect(config.jobs?.backend).toBeDefined()
    expect((globalThis as { __poolsBuilt?: number }).__poolsBuilt).toBe(0)

    // What `theokit start` does next: apply the storage block, then talk to the backend.
    await configureStorageManagerFromConfig(config.storage)
    await (config.jobs?.backend as PostgresJobBackend).ping()

    expect((globalThis as { __poolsBuilt?: number }).__poolsBuilt).toBe(1)
    expect(getStorageManager().isConfigured()).toBe(true)
  })
})
