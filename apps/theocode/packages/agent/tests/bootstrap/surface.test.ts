/** #1893 — one bootstrap function, called by all three surfaces. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const pkgs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (p: string): string => readFileSync(join(pkgs, p), 'utf8')

describe('#1893 — every surface calls bootstrapSurface', () => {
  it.each([
    ['cli/src/main.ts', '@theocode/agent/bootstrap'],
    ['tui/src/main.tsx', '@theocode/agent/bootstrap'],
    ['agent/src/chat/chat-acp.ts', '../bootstrap/index.js'],
  ])('%s imports and calls it', (file, from) => {
    const src = read(file)
    expect(src).toContain(`import { bootstrapSurface } from '${from}'`)
    expect(src).toMatch(/bootstrapSurface\(\{/)
  })

  it('the TUI composition no longer installs the steps itself', () => {
    const src = read('tui/src/composition/use-tui-composition.ts')
    expect(src).not.toMatch(/installAuthHome\(|installClaudeProjectDir\(/)
  })

  it('runs the steps in the CLI order', () => {
    const src = read('agent/src/bootstrap/surface.ts')
    const order = [
      'loadProjectEnv(env)',
      'installConfiguredHome({',
      'installAuthHome(env',
      'installClaudeProjectDir(env',
    ]
    const at = order.map((s) => src.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })
})
