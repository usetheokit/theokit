import { describe, it, expect, beforeAll } from 'vitest'
import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

/**
 * The happy path of `theokit dev` — that it boots at all, serves `/`, assigns a port — has NO
 * automated coverage. A booting dev server needs an app whose `react` and `theokit` imports
 * resolve, and a project created in a tmpdir resolves neither.
 *
 * What follows is the guard that needs no server.
 */ const TEMP_DIR = path.join(tmpdir(), `theo-cli-dev-${Date.now()}`)

beforeAll(() => {
  const noAppDir = path.join(TEMP_DIR, 'invalid-no-app')
  mkdirSync(noAppDir, { recursive: true })
  writeFileSync(path.join(noAppDir, 'theo.config.ts'), 'export default {}')
  writeFileSync(path.join(noAppDir, 'package.json'), '{ "type": "module" }')
})

describe('theo dev command', () => {
  it('should throw TheoProjectError when app/ directory is missing', async () => {
    await expect(
      startDevServer(path.join(TEMP_DIR, 'invalid-no-app'), { port: 0 }),
    ).rejects.toThrow('Missing required directory: app/')
  })
})
