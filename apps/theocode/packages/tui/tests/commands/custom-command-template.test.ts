/**
 * Custom command templates through the TUI's own path (`handleCustomCommand`): shell output is never
 * scanned for `@file`, shell/`@file` need a word boundary, `\$N` stays literal, a fenced command
 * block or a failed command sends nothing, and `@file` cannot leave the working directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCustomCommand } from '../../src/commands/config-commands.js'
import { resetWorkingDirectoryForTest, setWorkingDirectory } from '../../src/working-directory.js'

let root: string
let project: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tpl-'))
  project = join(root, 'project')
  mkdirSync(project)
  writeFileSync(join(project, 'SECRET.txt'), 'TOPSECRET')
  writeFileSync(join(project, 'inside.txt'), 'INSIDE')
  writeFileSync(join(root, 'outside.txt'), 'OUTSIDE')
  resetWorkingDirectoryForTest()
  setWorkingDirectory(project)
})

afterEach(() => {
  resetWorkingDirectoryForTest()
  rmSync(root, { recursive: true, force: true })
})

async function run(template: string, arg = '') {
  const send = vi.fn()
  const setToast = vi.fn()
  handleCustomCommand(
    't',
    arg,
    `/t ${arg}`,
    { name: 't', template, hints: [] },
    {
      send,
      setLastSent: vi.fn(),
      setPendingModel: vi.fn(),
      setToast,
    },
  )
  await vi.waitFor(() => {
    expect(
      send.mock.calls.length + setToast.mock.calls.filter((c) => c[0].variant === 'error').length,
    ).toBeGreaterThan(0)
  })
  return { send, setToast }
}

describe('custom command templates', () => {
  it('does not inline a file named in shell output', async () => {
    const { send } = await run("recent: !`echo 'see @SECRET.txt'`")
    const sent = send.mock.calls[0]?.[0] as string
    expect(sent).toContain('@SECRET.txt')
    expect(sent).not.toContain('TOPSECRET')
  })

  it('does not run a shell segment glued to a word', async () => {
    const { send } = await run('KEY=!`echo boom`')
    expect(send.mock.calls[0]?.[0]).toBe('KEY=!`echo boom`')
  })

  it('keeps an escaped \\$1 literal', async () => {
    const { send } = await run('price \\$1.00', 'alpha')
    expect(send.mock.calls[0]?.[0]).toContain('$1.00')
    expect(send.mock.calls[0]?.[0]).not.toContain('alpha')
  })

  it('shows an error and sends nothing for a ```! block', async () => {
    const { send, setToast } = await run('before\n```!\necho hi\n```\n')
    expect(send).not.toHaveBeenCalled()
    expect(setToast.mock.calls.at(-1)?.[0].variant).toBe('error')
  })

  it('shows an error and sends nothing when a command fails', async () => {
    const { send, setToast } = await run('x !`exit 3`')
    expect(send).not.toHaveBeenCalled()
    expect(setToast.mock.calls.at(-1)?.[0].variant).toBe('error')
  })

  it('does not inline @../outside.txt but inlines a project file', async () => {
    const out = await run('look @../outside.txt')
    expect(JSON.stringify(out.send.mock.calls)).not.toContain('OUTSIDE')
    const inside = await run('look @inside.txt')
    expect(inside.send.mock.calls[0]?.[0]).toContain('INSIDE')
  })
})
