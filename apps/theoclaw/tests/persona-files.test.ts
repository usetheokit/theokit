import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { PERSONA_FILE_LIMIT, readPersonaPrompt } from '../src/control-plane/agent-factory.js'

const dirs: string[] = []
const workspace = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'persona-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readPersonaPrompt', () => {
  it('is empty for a workspace with no persona file', () => {
    expect(readPersonaPrompt(workspace())).toBe('')
  })

  it('injects each present file under its heading, skipping blank ones and HEARTBEAT.md', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'SOUL.md'), 'Be terse.\n')
    writeFileSync(join(dir, 'USER.md'), '   \n')
    writeFileSync(join(dir, 'HEARTBEAT.md'), 'check mail')
    writeFileSync(join(dir, 'AGENTS.md'), 'Rules')
    expect(readPersonaPrompt(dir)).toBe('## SOUL.md\n\nBe terse.\n\n## AGENTS.md\n\nRules')
  })

  it('cuts a file over the limit', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'SOUL.md'), 'x'.repeat(PERSONA_FILE_LIMIT + 5))
    expect(readPersonaPrompt(dir)).toBe(`## SOUL.md\n\n${'x'.repeat(PERSONA_FILE_LIMIT)}\n[truncated]`)
  })

  it('loads all five files in the fixed order, each capped on its own', () => {
    const dir = workspace()
    for (const name of ['STANDING-ORDERS.md', 'AGENTS.md', 'USER.md', 'IDENTITY.md', 'SOUL.md']) {
      writeFileSync(join(dir, name), 'y'.repeat(PERSONA_FILE_LIMIT + 1))
    }
    const cut = `${'y'.repeat(PERSONA_FILE_LIMIT)}\n[truncated]`
    expect(readPersonaPrompt(dir)).toBe(
      ['SOUL.md', 'IDENTITY.md', 'USER.md', 'AGENTS.md', 'STANDING-ORDERS.md'].map((n) => `## ${n}\n\n${cut}`).join('\n\n'),
    )
  })
})
