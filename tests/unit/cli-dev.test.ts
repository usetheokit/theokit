import { describe, it, expect, beforeAll } from 'vitest'
import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

/**
 * Three cases that booted a real Vite dev server against `fixtures/wave1-hello-theo` — responds 200
 * on `/`, auto-assigns a port when `port: 0`, serves `text/html` — were REMOVED with `fixtures/`.
 *
 * They are not rebuilt in a tmpdir on purpose: a booting dev server needs an app whose `react` and
 * `theokit` imports resolve, and a project outside the repository resolves neither. Reproducing that
 * means putting an app back on disk inside the repo, which is the thing the fixtures were.
 *
 * So the honest state is: the happy path of `theokit dev` — that it boots at all — has NO automated
 * coverage. What survives below is the guard that needs no server.
 */
const TEMP_DIR = path.join(tmpdir(), `theo-cli-dev-${Date.now()}`)

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
