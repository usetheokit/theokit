/**
 * #1893 — one bootstrap function for every surface. The behavioural check is the ACP test; this
 * one pins that the CLI, the TUI and the ACP entry all use it and none re-implements the steps.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const ENTRIES = {
  cli: { src: read('../../cli/src/main.ts'), from: '@theocode/agent/bootstrap' },
  tui: { src: read('../../tui/src/main.tsx'), from: '@theocode/agent/bootstrap' },
  acp: { src: read('../src/chat/chat-acp.ts'), from: '../bootstrap-surface.js' },
}

describe('#1893 — every entry calls bootstrapSurface', () => {
  for (const [name, { src, from }] of Object.entries(ENTRIES)) {
    it(`test_${name}_entry_imports_and_calls_bootstrapSurface`, () => {
      expect(src).toContain(`import { bootstrapSurface } from '${from}'`)
      expect(src).toMatch(/bootstrapSurface\(\{/)
    })

    it(`test_${name}_entry_does_not_repeat_the_steps`, () => {
      expect(src).not.toMatch(/installAuthHome\(|installConfiguredHome\(|installClaudeProjectDir\(/)
    })
  }
})
