import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

describe('theoclaw tui', () => {
  it('runs dist/tui/main.js with the token and port from the configuration file and the chosen session', async () => {
    const h = harness()
    const dist = join(h.io.cwd, 'dist')
    mkdirSync(join(dist, 'tui'), { recursive: true })
    const out = join(h.io.cwd, 'seen.json')
    writeFileSync(
      join(dist, 'tui', 'main.js'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify([process.env.THEOCLAW_CONTROL_TOKEN, process.env.THEOCLAW_PORT, process.env.THEOCLAW_SESSION]))\n`,
    )
    const config = join(h.io.cwd, 'theoclaw.env')
    writeFileSync(config, 'THEOCLAW_CONTROL_TOKEN=tttttttttttttttttttttttttttttttt\nTHEOCLAW_PORT=4321\n')
    const io = { ...h.io, entry: join(dist, 'main.js'), env: { ...h.io.env, THEOCLAW_CONFIG: config } }

    expect(await runCli(['tui', '--session', 'work'], io)).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['tttttttttttttttttttttttttttttttt', '4321', 'work'])
  })

  it('refuses a bad session id or a missing token with exit 1 before starting the TUI', async () => {
    const h = harness()
    const config = join(h.io.cwd, 'theoclaw.env')
    writeFileSync(config, `THEOCLAW_CONTROL_TOKEN=${'t'.repeat(32)}\nTHEOCLAW_PORT=4321\n`)
    const io = { ...h.io, env: { ...h.io.env, THEOCLAW_CONFIG: config } }
    expect(await runCli(['tui', '--session', 'bad id'], io)).toBe(1)
    expect(h.stderr()).toContain('THEOCLAW_SESSION')
    const none = harness()
    expect(await runCli(['tui'], none.io)).toBe(1)
  })

  it('is listed in --help and refuses stray arguments', async () => {
    const h = harness()
    expect(await runCli(['--help'], h.io)).toBe(0)
    expect(h.stdout()).toContain('theoclaw tui')
    expect(await runCli(['tui', 'x'], h.io)).toBe(2)
    expect(await runCli(['tui', '--session'], h.io)).toBe(2)
  })
})
