/** Custom-command templates go through the framework's expansion, with containment on `@file`. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { expansionDeps, handleCustomCommand } from '../../src/commands/config-commands.js'
import {
  resetWorkingDirectoryForTest,
  setWorkingDirectory,
} from '../../src/working-directory.js'

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'tpl-'))
  project = join(base, 'project')
  mkdirSync(project)
  writeFileSync(join(project, 'SECRET.txt'), 'TOPSECRET')
  writeFileSync(join(project, 'ok.txt'), 'INSIDE')
  writeFileSync(join(base, 'outside.txt'), 'OUTSIDE')
  resetWorkingDirectoryForTest()
  setWorkingDirectory(project)
})
afterEach(() => {
  resetWorkingDirectoryForTest()
  rmSync(base, { recursive: true, force: true })
})

async function run(template: string, arg = '') {
  const send = vi.fn()
  const setToast = vi.fn()
  handleCustomCommand('t', arg, `/t ${arg}`, { name: 't', template, hints: [] }, {
    send,
    setLastSent: vi.fn(),
    setPendingModel: vi.fn(),
    setToast,
  })
  await vi.waitFor(() => {
    expect(send.mock.calls.length + setToast.mock.calls.length).toBeGreaterThan(0)
  })
  return { send, setToast }
}

describe('custom command templates', () => {
  it('does not inline a file named in shell output', async () => {
    const { send } = await run('recent: !`echo see @SECRET.txt`')
    const sent = String(send.mock.calls[0]?.[0])
    expect(sent).toContain('see @SECRET.txt')
    expect(sent).not.toContain('TOPSECRET')
  })

  it('does not run a command that follows a non-space character', async () => {
    const { send } = await run('KEY=!`echo boom`')
    expect(send).toHaveBeenCalledWith('KEY=!`echo boom`')
  })

  it('keeps an escaped $1 literal', async () => {
    const { send } = await run('price \\$1.00', 'alpha')
    expect(String(send.mock.calls[0]?.[0])).toContain('price $1.00')
  })

  it('shows an error and sends nothing for a fenced command block', async () => {
    const { send, setToast } = await run('```!\necho hi\n```')
    expect(send).not.toHaveBeenCalled()
    expect(setToast.mock.calls[0]?.[0]).toMatchObject({ variant: 'error' })
  })

  it('inlines a file inside the working directory but not one outside it', async () => {
    const { send } = await run('a @ok.txt b @../outside.txt')
    const sent = String(send.mock.calls[0]?.[0])
    expect(sent).toContain('INSIDE')
    expect(sent).not.toContain('OUTSIDE')
  })

  it('readFile refuses ../ and absolute paths', () => {
    const { readFile } = expansionDeps(() => {}, 1000)
    expect(readFile('../outside.txt')).toBeUndefined()
    expect(readFile(join(base, 'outside.txt'))).toBeUndefined()
    expect(readFile('ok.txt')).toBe('INSIDE')
  })
})
