import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetSingletonForTests,
  getStorageManager,
} from '../../packages/theo/src/server/storage/storage-manager.js'
import type { StorageConfig } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * `pg.Pool` emits `error` when Postgres drops an idle pooled connection (restart, failover,
 * `pg_terminate_backend`, a proxy idle timeout). Node throws on an `error` event with no listener,
 * so the whole server exited and every in-flight request was lost (usetheokit/theokit#1019). The
 * pool comes from a user factory, and nothing told the user to attach a listener.
 *
 * The fake pool is a real `EventEmitter`, which is what `pg.Pool` extends, so an unhandled `error`
 * throws here exactly as it does in production.
 */

const TEST_PW = 'test-only-stub'
const config = (): StorageConfig => ({
  servers: { primary: { host: 'pg.example.com', port: 5432, user: 'theo', password: TEST_PW } },
  databases: { main: { server: 'primary', database: 'app' } },
})

class FakePool extends EventEmitter {
  query = () => Promise.resolve({ rows: [] })
  end = () => Promise.resolve()
}

beforeEach(() => {
  __resetSingletonForTests()
  vi.restoreAllMocks()
})

describe('usePostgres keeps the process alive when the pool reports an idle-client error (#1019)', () => {
  it('test_an_error_emitted_by_the_pool_does_not_throw', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const pool = new FakePool()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    manager.usePostgres('main', () => pool)

    expect(() =>
      pool.emit('error', Object.assign(new Error('terminating connection'), { code: '57P01' })),
    ).not.toThrow()
  })

  it('test_the_error_is_logged_as_structured_json_naming_the_database_and_the_code', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const pool = new FakePool()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    manager.usePostgres('main', () => pool)

    pool.emit('error', Object.assign(new Error('terminating connection'), { code: '57P01' }))

    const entries = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        component: 'theokit:storage',
        database: 'main',
        code: '57P01',
        error: 'terminating connection',
      }),
    )
  })

  it('test_a_listener_the_factory_attached_is_left_as_the_only_one', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const pool = new FakePool()
    const own = vi.fn()
    pool.on('error', own)
    manager.usePostgres('main', () => pool)

    expect(pool.listenerCount('error')).toBe(1)
  })

  it('test_a_pool_without_an_event_api_is_accepted_unchanged', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const plain = { query: () => Promise.resolve({ rows: [] }) }

    expect(manager.usePostgres('main', () => plain)).toBe(plain)
  })
})
