import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'
import {
  __resetSingletonForTests,
  getStorageManager,
} from '../../packages/theo/src/server/storage/storage-manager.js'

/**
 * `theokit start` applies `theo.config.ts > storage` to the storage manager; `theokit dev` did not,
 * so every `usePostgres('main', ...)` threw `Database "main" not configured` in development and a
 * Postgres-backed route was only exercisable after a production build (usetheokit/theokit#1020).
 *
 * This boots the real dev server on an ephemeral port. The app lives under the repository so that
 * `react` and `vite` resolve from the workspace, and is removed afterwards.
 */

const APP = resolve(__dirname, '..', '.tmp-dev-applies-storage')

let server: Awaited<ReturnType<typeof startDevServer>> | undefined

describe('theokit dev applies the storage block of theo.config.ts (#1020)', () => {
  beforeAll(() => {
    __resetSingletonForTests()
    rmSync(APP, { recursive: true, force: true })
    mkdirSync(join(APP, 'app'), { recursive: true })
    writeFileSync(join(APP, 'package.json'), '{ "type": "module" }')
    writeFileSync(join(APP, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
    writeFileSync(
      join(APP, 'theo.config.ts'),
      `export default {
  storage: {
    servers: { local: { host: 'localhost', port: 5432, user: 'app', password: 'dev-only' } },
    databases: { main: { server: 'local', database: 'app' } },
  },
}
`,
    )
  })

  afterAll(async () => {
    await server?.close()
    __resetSingletonForTests()
    rmSync(APP, { recursive: true, force: true })
  })

  it('test_use_postgres_finds_the_configured_database_after_dev_boots', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    server = await startDevServer(APP, { port: 0 })
    const factory = vi.fn((srv: { host: string }, db: { database: string }) => ({
      query: () => Promise.resolve({ rows: [{ host: srv.host, db: db.database }] }),
    }))

    expect(() => getStorageManager().usePostgres('main', factory)).not.toThrow()
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 5432 }),
      expect.objectContaining({ database: 'app' }),
    )
  })
})
