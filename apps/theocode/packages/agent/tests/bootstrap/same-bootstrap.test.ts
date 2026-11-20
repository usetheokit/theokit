import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { bootstrapSurface } from '../../src/bootstrap/index.js'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

it('the CLI, the TUI and the ACP entry each await the same bootstrapSurface once', () => {
  const entries: readonly [file: string, importLine: RegExp][] = [
    [
      '../../../cli/src/main.ts',
      /import \{ bootstrapSurface \} from '@theocode\/agent\/bootstrap'/,
    ],
    [
      '../../../tui/src/main.tsx',
      /import \{ bootstrapSurface \} from '@theocode\/agent\/bootstrap'/,
    ],
    [
      '../../src/chat/chat-acp.ts',
      /import \{ bootstrapSurface \} from '\.\.\/bootstrap\/index\.js'/,
    ],
  ]
  for (const [file, importLine] of entries) {
    const src = read(file)
    expect(src).toMatch(importLine)
    expect(src.match(/await bootstrapSurface\(/g)).toHaveLength(1)
    expect(src.match(/bootstrapSurface\(/g)).toHaveLength(1)
  }
})

it('one call runs each framework bootstrap step exactly once, in order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'once-'))
  try {
    const env: Record<string, string | undefined> = {}
    await bootstrapSurface({ env, cwd: dir, home: dir, onWarn: () => {} })
    expect(env.CLAUDE_PROJECT_DIR).toBe(dir)
    expect(env.THEOKIT_HOME).toBeDefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
