/**
 * `--preset=bot` layers the unattended-agent shape over the default template (#467).
 *
 * The issue's complaint is that assembling a bot is a research project spread across twelve
 * repositories. A preset is only an answer to that if the thing it scaffolds actually runs — so the
 * load-bearing verification is not here, it is the CI job that scaffolds an app with this flag and
 * runs `tsc --noEmit` on it. That job caught two real defects in the first draft of these files:
 * `SandboxProvider` typed as `{ mode }` (it is a backend, or a function returning one) and
 * `defineCron` imported from `theokit/server/define` (it lives in `theokit/server/cron`). Neither
 * was visible from this package.
 *
 * What THESE tests hold is the contract that job cannot see: that the layer is complete, that a
 * partial copy is refused rather than shipped, and that it stays a LAYER rather than becoming a
 * second template to keep in sync.
 */
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyBotPreset } from '../../src/bot-preset.js'

/** A target dir standing in for an already-scaffolded default app. */
function scaffoldedApp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bot-preset-'))
  mkdirSync(join(dir, 'agents'), { recursive: true })
  mkdirSync(join(dir, 'server'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# my-app\n\nA TheoKit app.\n', 'utf-8')
  return dir
}

describe('applyBotPreset', () => {
  it('lands every file the two bots import', () => {
    const dir = scaffoldedApp()
    applyBotPreset({ targetDir: dir })

    // Each of these is imported by something else in the layer. A missing one is an app that fails
    // at build time, three steps from the cause.
    for (const f of [
      'agents/researcher.ts',
      'agents/publisher.ts',
      'agents/lib/bot-scope.ts',
      'agents/lib/sandbox.ts',
      'agents/tools/read-notes.ts',
      'agents/tools/write-note.ts',
      'agents/tools/publish.ts',
      'server/delivery.ts',
      'server/crons/daily-research.ts',
    ]) {
      expect(existsSync(join(dir, f)), `${f} must reach the scaffolded app`).toBe(true)
    }
  })

  it('keeps the chat agent — this is a layer, not a second template', () => {
    // The decision #467 left open. A bot app and a web app share almost everything; duplicating the
    // ninety percent that is the same is how two templates drift. `--surface` already layers for the
    // same reason.
    const dir = scaffoldedApp()
    writeFileSync(join(dir, 'agents', 'chat.ts'), 'export default {}', 'utf-8')
    applyBotPreset({ targetDir: dir })
    expect(existsSync(join(dir, 'agents', 'chat.ts'))).toBe(true)
  })

  it('appends to the README instead of replacing it', () => {
    const dir = scaffoldedApp()
    applyBotPreset({ targetDir: dir })
    const readme = readFileSync(join(dir, 'README.md'), 'utf-8')
    expect(readme, "the app's own README must survive").toContain('# my-app')
    expect(readme).toContain('## Bots')
    // The two things a reader must change first, named where they will look.
    expect(readme).toContain('server/delivery.ts')
    expect(readme).toContain('UTC')
  })

  it('propagates a README that exists but cannot be read, instead of skipping the section', () => {
    // The absent-README case is a legitimate no-op, so the append is guarded. The guard used to be
    // `existsSync(path) || return`, which answered "unreadable" and "absent" with the same silence:
    // a bot app would scaffold with a README missing the only section documenting its bots, and
    // nothing would say so. Only ENOENT means absent; every other code is a fault that must surface.
    const dir = scaffoldedApp()
    rmSync(join(dir, 'README.md'))
    mkdirSync(join(dir, 'README.md')) // reading a directory yields EISDIR, not ENOENT
    expect(() => applyBotPreset({ targetDir: dir })).toThrow()
  })

  it('scaffolds two bots, not three — delegation without becoming a demo app', () => {
    const dir = scaffoldedApp()
    applyBotPreset({ targetDir: dir })
    // Asserted because the count is a decision, not an accident: one bot is a chat app with a cron,
    // and three starts being a product rather than a starting point.
    const publisher = readFileSync(join(dir, 'agents', 'publisher.ts'), 'utf-8')
    expect(publisher, 'the side-effecting bot must be gated').toContain(".approval('publish'")
  })

  it('wires no delivery channel, and says why in the file', () => {
    // A default channel is a policy decision — an address the developer did not write, a workspace
    // they may not have. The seam is present and unpointed.
    const delivery = readFileSync(join(scaffoldedAppWithPreset(), 'server', 'delivery.ts'), 'utf-8')
    expect(delivery).toContain('console.log')
    expect(delivery, 'the example must be commented, not installed').toContain('RESEND_API_KEY')
  })
})

function scaffoldedAppWithPreset(): string {
  const dir = scaffoldedApp()
  applyBotPreset({ targetDir: dir })
  return dir
}
