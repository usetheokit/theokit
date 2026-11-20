/**
 * `/memory forget <n>` removes a fact the SDK stores, and lists it through the SDK too.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listMemoryFacts } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleMemoryInfo } from '../../src/commands/session-commands.js'
import { resetWorkingDirectoryForTest, setWorkingDirectory } from '../../src/working-directory.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theocode-facts-'))
  mkdirSync(join(dir, '.theokit', 'memory'), { recursive: true })
  // BLOCKED on the SDK fact writer release: SDK 5.32.0 has no public fact writer, so MEMORY.md is
  // seeded by hand. Switch this to the SDK writer once one is released (theokit-sdk#1062).
  writeFileSync(
    join(dir, '.theokit', 'memory', 'MEMORY.md'),
    '# Memory\n\n## Facts\n- prefers tabs\n- uses pnpm\n',
  )
  setWorkingDirectory(dir)
})

afterEach(() => {
  resetWorkingDirectoryForTest()
  rmSync(dir, { recursive: true, force: true })
})

const settled = (fn: ReturnType<typeof vi.fn>) =>
  vi.waitFor(() => {
    expect(fn).toHaveBeenCalled()
  })

describe('/memory with SDK facts', () => {
  it('lists the SDK facts by number', async () => {
    const setPanel = vi.fn()
    handleMemoryInfo('', vi.fn(), setPanel)
    await settled(setPanel)
    const body = (setPanel.mock.calls[0]?.[0] as { body: string }).body
    expect(body).toContain('1. prefers tabs')
    expect(body).toContain('2. uses pnpm')
  })

  it('forget removes the chosen fact and keeps the other', async () => {
    expect((await listMemoryFacts(dir)).map((f) => f.text)).toEqual(['prefers tabs', 'uses pnpm'])
    const setToast = vi.fn()
    handleMemoryInfo('forget 1', setToast, vi.fn())
    await settled(setToast)
    expect(setToast.mock.calls[0]?.[0]).toMatchObject({ variant: 'success' })
    expect((await listMemoryFacts(dir)).map((f) => f.text)).toEqual(['uses pnpm'])
  })

  it('forget of a missing number reports an error and removes nothing', async () => {
    const setToast = vi.fn()
    handleMemoryInfo('forget 9', setToast, vi.fn())
    await settled(setToast)
    expect(setToast.mock.calls[0]?.[0]).toMatchObject({ variant: 'error' })
    expect(await listMemoryFacts(dir)).toHaveLength(2)
  })
})
