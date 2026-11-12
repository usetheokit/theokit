import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const packages = resolve(__dirname, '../../..')

describe('#1893 — every entry runs the same bootstrap function', () => {
  const entries = ['cli/src/main.ts', 'tui/src/main.tsx', 'agent/src/chat/chat-acp.ts']
  for (const entry of entries) {
    it(`${entry} imports and calls bootstrapSurface`, () => {
      const src = readFileSync(resolve(packages, entry), 'utf8')
      expect(src).toMatch(/import \{[^}]*\bbootstrapSurface\b[^}]*\} from '[^']*bootstrap[^']*'/)
      expect(src).toMatch(/bootstrapSurface\(\{/)
      expect(src, 'a hand-rolled step is back').not.toMatch(/installAuthHome\(/)
    })
  }
})
