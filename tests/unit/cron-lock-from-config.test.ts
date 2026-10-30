import { describe, expect, it } from 'vitest'

import { cronLockFromConfig } from '../../packages/theo/src/server/cron/cron-lock-from-config.js'
import type { CronLock } from '../../packages/theo/src/server/cron/cron-lock.js'

/**
 * Which lock `theokit start` hands the cron scheduler (usetheokit/theokit#1016). A single process
 * with no shared backend keeps the old behaviour, and the boot line says so.
 */
const lock: CronLock = { acquire: () => Promise.resolve(true) }

describe('cronLockFromConfig', () => {
  it('no cron.lock and no backend: no lock, and the description warns about replicas', () => {
    const resolved = cronLockFromConfig({})
    expect(resolved.lock).toBeUndefined()
    expect(resolved.description).toMatch(/every process running theokit start fires each cron/)
  })

  it('cron.lock wins', () => {
    expect(cronLockFromConfig({ cron: { lock } }).lock).toBe(lock)
  })

  it('cron.lock: false opts out even with a backend that offers a lock', () => {
    const backend = { name: 'postgres', cronLock: () => lock }
    const resolved = cronLockFromConfig({ cron: { lock: false }, jobs: { backend } as never })
    expect(resolved.lock).toBeUndefined()
    expect(resolved.description).toContain('cron.lock: false')
  })

  it('a jobs backend that offers cronLock() provides the lock, called on the backend', () => {
    const backend = {
      name: 'postgres',
      cronLock(this: { name: string }) {
        expect(this.name).toBe('postgres')
        return lock
      },
    }
    const resolved = cronLockFromConfig({ jobs: { backend } as never })
    expect(resolved.lock).toBe(lock)
    expect(resolved.description).toContain('postgres jobs backend')
  })

  it('a backend without cronLock() (the memory one) provides none', () => {
    expect(
      cronLockFromConfig({ jobs: { backend: { name: 'memory' } } as never }).lock,
    ).toBeUndefined()
  })
})
