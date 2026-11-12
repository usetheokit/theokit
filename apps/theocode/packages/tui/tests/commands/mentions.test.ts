import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { resolveMentions } from '../../src/commands/mentions.js'
import { sendMessage } from '../../src/commands/command-content.js'
import type { ToastPayload } from '../../src/screen-types.js'

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mentions-'))
  mkdirSync(join(cwd, 'src'))
  writeFileSync(join(cwd, 'src/a.ts'), 'export const a = 1\n')
  return cwd
}

describe('resolveMentions', () => {
  it.each(['look at @src/a.ts', 'look at @src/a.ts, please', 'is @src/a.ts.', '(@src/a.ts)?'])(
    'attaches src/a.ts for %s',
    (text) => {
      expect(resolveMentions(text, project()).attached).toEqual(['src/a.ts'])
    },
  )

  it('reports a missing file with a reason', () => {
    const r = resolveMentions('see @missing.ts', project())
    expect(r.attached).toEqual([])
    expect(r.skipped).toEqual([{ ref: 'missing.ts', reason: 'file not found' }])
  })

  it('reports ~/ paths the @ menu offers, with a reason', () => {
    const r = resolveMentions('see @~/notes.md', project())
    expect(r.skipped[0]?.ref).toBe('~/notes.md')
    expect(r.skipped[0]?.reason).toContain('~')
  })

  it('the toast lists skipped mentions', () => {
    const setToast = vi.fn() as unknown as Dispatch<SetStateAction<ToastPayload | null>>
    const last: MutableRefObject<string | null> = { current: null }
    sendMessage('see @missing.ts', false, { send: vi.fn(), reset: vi.fn(), abort: vi.fn() }, last, setToast)
    const payload = vi.mocked(setToast).mock.calls[0]?.[0] as ToastPayload
    expect(payload.message).toContain('@missing.ts (file not found)')
  })
})
