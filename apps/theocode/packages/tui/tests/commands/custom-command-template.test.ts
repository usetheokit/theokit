import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleCustomCommand } from '../../src/commands/config-commands.js'
import type { CustomCommand } from '../../src/commands/custom-commands.js'

let project = ''

vi.mock('../../src/working-directory.js', () => ({ workingDirectory: () => project }))

function cmd(template: string): CustomCommand {
  return { template, hints: [] } as unknown as CustomCommand
}

async function run(template: string, arg = ''): Promise<{ sent: string[]; toasts: string[] }> {
  const sent: string[] = []
  const toasts: string[] = []
  handleCustomCommand('t', arg, `/t ${arg}`, cmd(template), {
    send: (m) => sent.push(m),
    setLastSent: () => {},
    setPendingModel: () => {},
    setToast: (t) => {
      if (t !== null && typeof t === 'object') toasts.push(t.message)
    },
  })
  await vi.waitFor(() => {
    expect(sent.length + toasts.length).toBeGreaterThan(0)
  })
  return { sent, toasts }
}

describe('custom command templates', () => {
  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'tpl-'))
    project = join(base, 'project')
    mkdirSync(project)
    writeFileSync(join(project, 'SECRET.txt'), 'TOPSECRET')
    writeFileSync(join(base, 'outside.txt'), 'OUTSIDE')
  })
  afterEach(() => vi.restoreAllMocks())

  it('does not inline a file named in shell output', async () => {
    const { sent } = await run('recent: !`echo fix: see @SECRET.txt`')
    expect(sent[0]).toContain('@SECRET.txt')
    expect(sent[0]).not.toContain('TOPSECRET')
  })

  it('does not run a command without a word boundary', async () => {
    const { sent } = await run('KEY=!`echo boom`')
    expect(sent[0]).toBe('KEY=!`echo boom`')
  })

  it('keeps an escaped placeholder literal', async () => {
    const { sent } = await run('price \\$1.00', 'alpha')
    expect(sent[0]).toBe('price $1.00')
    expect(sent[0]).not.toContain('alpha')
  })

  it('shows an error and sends nothing for a fenced command block', async () => {
    const { sent, toasts } = await run('before\n```!\necho hi\n```\n')
    expect(sent).toEqual([])
    expect(toasts.join('\n')).toContain('fenced')
  })

  it('inlines a file inside the working directory but not @../outside.txt', async () => {
    const inside = await run('see @SECRET.txt')
    expect(inside.sent[0]).toContain('TOPSECRET')
    const outside = await run('see @../outside.txt')
    expect(outside.sent[0]).not.toContain('OUTSIDE')
  })
})
