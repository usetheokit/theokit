import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSharedBrowser, type LaunchedBrowser } from '../../src/browser/index.js'

const dir = () => join(mkdtempSync(join(tmpdir(), 'host-shared-')), 'profile')

describe('createSharedBrowser', () => {
  it('launches once for concurrent callers and closes the browser', async () => {
    const close = vi.fn(async () => undefined)
    const launch = vi.fn(
      async (): Promise<LaunchedBrowser> => ({ endpoint: 'http://127.0.0.1:1', close }),
    )
    const shared = createSharedBrowser(dir(), launch)
    expect(await Promise.all([shared.start(), shared.start()])).toEqual([
      'http://127.0.0.1:1',
      'http://127.0.0.1:1',
    ])
    expect(launch).toHaveBeenCalledTimes(1)
    await shared.close()
    expect(close).toHaveBeenCalledTimes(1)
    await expect(shared.start()).rejects.toThrow(/closed/)
  })

  it('retries after a failed launch and relaunches after the browser exits', async () => {
    let exit: () => void = () => undefined
    const launch = vi
      .fn<() => Promise<LaunchedBrowser>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async () => ({
        endpoint: 'a',
        close: async () => undefined,
        exited: new Promise<void>((r) => (exit = r)),
      }))
      .mockImplementation(async () => ({ endpoint: 'b', close: async () => undefined }))
    const shared = createSharedBrowser(dir(), launch)
    await expect(shared.start()).rejects.toThrow('boom')
    expect(await shared.start()).toBe('a')
    exit()
    await new Promise((r) => setTimeout(r, 0))
    expect(await shared.start()).toBe('b')
  })

  it('close is safe before start', async () => {
    await expect(createSharedBrowser(dir(), vi.fn()).close()).resolves.toBeUndefined()
  })
})
