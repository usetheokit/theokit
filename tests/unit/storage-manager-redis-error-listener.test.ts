import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetSingletonForTests,
  getStorageManager,
} from '../../packages/theo/src/server/storage/storage-manager.js'
import type { StorageConfig } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * node-redis (`redis@4`) re-emits a socket error with a plain `emit('error')`, and Node throws an
 * `error` event nobody listens to: one ECONNRESET exited the process with `Unhandled 'error' event`
 * (usetheokit/theokit#1029). `useRedis` cached the factory's client with no listener, the gap
 * #1019 closed for `usePostgres`.
 *
 * The fake client is a real `EventEmitter`, which both node-redis and ioredis clients extend.
 */
const TEST_PW = 'test-only-stub'
const config = (): StorageConfig => ({
  redis: { cache: { host: 'redis.example.com', port: 6379, user: 'default', password: TEST_PW } },
})

class FakeRedis extends EventEmitter {
  quit = () => Promise.resolve('OK')
  disconnect = () => {}
}

beforeEach(() => {
  __resetSingletonForTests()
  vi.restoreAllMocks()
})

describe('useRedis keeps the process alive when the client reports an error', () => {
  it('an error emitted by the client does not throw', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const client = new FakeRedis()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    manager.useRedis('cache', () => client)

    expect(() =>
      client.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })),
    ).not.toThrow()
  })

  it('the error is logged as structured JSON naming the server and the code', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const client = new FakeRedis()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    manager.useRedis('cache', () => client)

    client.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))

    const entries = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(entries).toContainEqual(
      expect.objectContaining({ server: 'cache', code: 'ECONNRESET', error: 'read ECONNRESET' }),
    )
  })

  it('a listener the factory attached stays the only one', () => {
    const manager = getStorageManager()
    manager.configure(config())
    const client = new FakeRedis()
    const own = vi.fn()
    client.on('error', own)
    manager.useRedis('cache', () => client)

    expect(client.listenerCount('error')).toBe(1)
  })
})
