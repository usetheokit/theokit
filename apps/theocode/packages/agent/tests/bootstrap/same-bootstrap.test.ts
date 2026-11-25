import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { bootstrapSurface } from '../../src/bootstrap/index.js'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

it('the CLI, the TUI and the ACP entry all call the same bootstrapSurface, awaited, once each', () => {
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

it('one awaited call has installed the home, and left CLAUDE_PROJECT_DIR alone, when it resolves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'once-'))
  try {
    const env: Record<string, string | undefined> = {}
    await bootstrapSurface({ env, cwd: dir, home: dir, onWarn: () => {} })
    expect(env.CLAUDE_PROJECT_DIR).toBeUndefined()
    expect(env.THEOKIT_HOME).toBeDefined()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('a CLAUDE_PROJECT_DIR already in the environment is left as it was', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'once-'))
  try {
    const env: Record<string, string | undefined> = { CLAUDE_PROJECT_DIR: '/operator/own' }
    await bootstrapSurface({ env, cwd: dir, home: dir, onWarn: () => {} })
    expect(env.CLAUDE_PROJECT_DIR).toBe('/operator/own')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
