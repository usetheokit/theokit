import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const ENTRIES = {
  cli: read('../../../cli/src/main.ts'),
  tui: read('../../../tui/src/main.tsx'),
  acp: read('../../src/chat/chat-acp.ts'),
}

describe('every surface entry runs the same bootstrap', () => {
  for (const [name, src] of Object.entries(ENTRIES)) {
    it(`${name} imports and calls bootstrapSurface`, () => {
      expect(src).toMatch(/import \{[^}]*\bbootstrapSurface\b[^}]*\} from '[^']*bootstrap[^']*'/)
      expect(src).toMatch(/bootstrapSurface\(/)
    })
  }

  it('no entry hand-rolls the steps any more', () => {
    for (const src of Object.values(ENTRIES)) {
      expect(src).not.toMatch(/^\s*(installAuthHome|installConfiguredHome|loadEnvFile)\(/m)
    }
  })

  it('the TUI composition no longer installs them at import', () => {
    const src = read('../../../tui/src/composition/use-tui-composition.ts')
    expect(src).not.toMatch(/installAuthHome|installClaudeProjectDir/)
  })
})
