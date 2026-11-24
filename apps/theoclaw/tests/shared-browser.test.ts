import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSharedBrowser } from '@theokit/host/browser'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function profile(): string {
  const root = mkdtempSync(join(tmpdir(), 'theoclaw-shared-'))
  dirs.push(root)
  return join(root, 'profile')
}

describe('the shared browser', () => {
  it('launches one browser for concurrent starts, on a profile it creates', async () => {
    const dir = profile()
    const close = vi.fn(() => Promise.resolve())
    const launch = vi.fn(() => Promise.resolve({ endpoint: 'http://127.0.0.1:1234', close }))
    const shared = createSharedBrowser(dir, launch)
    const ends = await Promise.all([shared.start(), shared.start(), shared.start()])
    expect(ends).toEqual(Array(3).fill('http://127.0.0.1:1234'))
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith(dir)
    expect(existsSync(dir)).toBe(true)
  })

  it('launches a replacement on the same profile after the browser exited by itself', async () => {
    const dir = profile()
    let crash: () => void = () => undefined
    let n = 0
    const launch = vi.fn((_dir: string) => {
      const endpoint = `http://127.0.0.1:${++n}`
      const exited = new Promise<void>((resolve) => {
        crash = resolve
      })
      return Promise.resolve({ endpoint, close: () => Promise.resolve(), exited })
    })
    const shared = createSharedBrowser(dir, launch)
    expect(await shared.start()).toBe('http://127.0.0.1:1')
    expect(await shared.start()).toBe('http://127.0.0.1:1')
    crash()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await shared.start()).toBe('http://127.0.0.1:2')
    expect(launch).toHaveBeenCalledTimes(2)
    expect(launch).toHaveBeenLastCalledWith(dir)
  })

  it('retries after a failed launch', async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('profile in use'))
      .mockResolvedValueOnce({ endpoint: 'http://127.0.0.1:9', close: () => Promise.resolve() })
    const shared = createSharedBrowser(profile(), launch)
    await expect(shared.start()).rejects.toThrow('profile in use')
    await expect(shared.start()).resolves.toBe('http://127.0.0.1:9')
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('closes the browser once, and refuses to start after', async () => {
    const close = vi.fn(() => Promise.resolve())
    const shared = createSharedBrowser(profile(), () =>
      Promise.resolve({ endpoint: 'http://127.0.0.1:2', close }),
    )
    await shared.start()
    await shared.close()
    await shared.close()
    expect(close).toHaveBeenCalledTimes(1)
    await expect(shared.start()).rejects.toThrow('closed')
  })

  it('closes a browser that was still launching', async () => {
    const close = vi.fn(() => Promise.resolve())
    const shared = createSharedBrowser(
      profile(),
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ endpoint: 'http://127.0.0.1:3', close }), 20),
        ),
    )
    const started = shared.start()
    await shared.close()
    await started.catch(() => undefined)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes without a start', async () => {
    await expect(
      createSharedBrowser(profile(), () => Promise.reject(new Error('never'))).close(),
    ).resolves.toBeUndefined()
  })
})
