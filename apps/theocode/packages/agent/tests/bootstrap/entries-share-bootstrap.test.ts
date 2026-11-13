import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const ENTRIES = {
  cli: '../../../cli/src/main.ts',
  tui: '../../../tui/src/main.tsx',
  acp: '../../src/chat/chat-acp.ts',
}

for (const [name, rel] of Object.entries(ENTRIES)) {
  it(`the ${name} entry imports and calls bootstrapSurface`, () => {
    const src = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(src).toMatch(
      /import \{[^}]*\bbootstrapSurface\b[^}]*\} from '[^']*bootstrap(\/index\.js)?'/,
    )
    expect(src).toMatch(/\bbootstrapSurface\(/)
    expect(src).not.toMatch(/\binstallAuthHome\(/)
    expect(src).not.toMatch(/\bloadProjectEnv\(/)
  })
}
