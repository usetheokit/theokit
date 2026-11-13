/**
 * Custom-command templates through the TUI path (#1899): shell output is never re-scanned for
 * `@file`, `KEY=!`cmd`` is not executed, `\$1` stays literal, fences and failures send nothing, and
 * `@../x` is not inlined.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { handleCustomCommand } from '../../src/commands/config-commands.js'
import type { CustomCommand } from '../../src/commands/custom-commands.js'

let root: string
let project: string
const prevCwd = process.cwd()

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tk-cmdtpl-'))
  project = join(root, 'project')
  mkdirSync(project)
  writeFileSync(join(project, 'SECRET.txt'), 'TOPSECRET')
  writeFileSync(join(root, 'outside.txt'), 'OUTSIDE')
  process.chdir(project)
})
afterAll(() => {
  process.chdir(prevCwd)
  rmSync(root, { recursive: true, force: true })
})

async function run(template: string, arg = ''): Promise<{ sent: string[]; toasts: string[] }> {
  const sent: string[] = []
  const toasts: string[] = []
  const command: CustomCommand = { name: 't', template, hints: [] }
  handleCustomCommand('t', arg, `/t ${arg}`, command, {
    send: (m) => sent.push(m),
    setLastSent: () => {},
    setPendingModel: () => {},
    setToast: ((t: { message: string } | null) => {
      if (t) toasts.push(t.message)
    }) as never,
  })
  await vi.waitFor(() => expect(sent.length + toasts.length).toBeGreaterThan(0))
  return { sent, toasts }
}

describe('custom command template expansion', () => {
  it('does not inline a file named in shell output', async () => {
    const { sent } = await run('recent: !`echo see @SECRET.txt`')
    expect(sent[0]).toContain('@SECRET.txt')
    expect(sent[0]).not.toContain('TOPSECRET')
  })

  it('does not execute a shell segment glued to a word', async () => {
    const { sent } = await run('KEY=!`echo boom`')
    expect(sent[0]).toBe('KEY=!`echo boom`')
  })

  it('keeps an escaped $1 literal', async () => {
    const { sent } = await run('price \\$1.00', 'alpha')
    expect(sent[0]).not.toContain('alpha')
    expect(sent[0]).toContain('$1.00')
  })

  it('shows an error and sends nothing for a fenced command block', async () => {
    const { sent, toasts } = await run('before\n```!\nls\n```\n')
    expect(sent).toEqual([])
    expect(toasts.join('\n')).toContain('fenced')
  })

  it('shows an error and sends nothing for a failed command', async () => {
    const { sent, toasts } = await run('x !`exit 3`')
    expect(sent).toEqual([])
    expect(toasts.length).toBeGreaterThan(0)
  })

  it('inlines a file inside the working directory', async () => {
    const { sent } = await run('read @SECRET.txt')
    expect(sent[0]).toContain('TOPSECRET')
  })

  it('does not inline a file outside the working directory', async () => {
    const { sent } = await run('read @../outside.txt')
    expect(sent[0]).not.toContain('OUTSIDE')
  })
})
