import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'

/**
 * `theokit dev` had no cron code path and said nothing about crons, so a developer who added one
 * saw it neither fire nor get explained (usetheokit/theokit#1017). Now dev schedules them when
 * asked (`theokit dev --crons`), and otherwise prints that they are not scheduled and how to
 * schedule them. Off by default because a cron's side effect (an email, a charge) firing on every
 * dev boot is the surprise a developer did not ask for.
 *
 * The cron is a plain object in the shape `defineCron` returns, with a seconds field so a tick
 * arrives within a second; the scheduler parses six fields, `defineCron` only validates five.
 */
const ROOT = resolve(__dirname, '..', '.tmp-dev-schedules-crons-on-request')

function writeApp(name: string): string {
  const app = join(ROOT, name)
  rmSync(app, { recursive: true, force: true })
  mkdirSync(join(app, 'server', 'crons'), { recursive: true })
  mkdirSync(join(app, 'app'), { recursive: true })
  writeFileSync(join(app, 'package.json'), '{ "type": "module" }')
  writeFileSync(join(app, 'theo.config.ts'), 'export default {}\n')
  writeFileSync(join(app, 'app', 'page.tsx'), 'export default function Page() { return null }\n')
  writeFileSync(
    join(app, 'server', 'crons', 'tick.ts'),
    `import { writeFileSync } from 'node:fs'
export default {
  name: 'tick',
  schedule: '* * * * * *',
  concurrency: 'forbid',
  handler: () => {
    writeFileSync(${JSON.stringify(join(app, 'cron-ran'))}, 'yes')
  },
}
`,
  )
  return app
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

describe('theokit dev and crons', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  afterAll(() => {
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('with crons: true, a declared cron fires in dev', async () => {
    const app = writeApp('on')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startDevServer(app, { port: 0, crons: true })
    try {
      expect(await waitForFile(join(app, 'cron-ran'), 4000)).toBe(true)
      const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(printed).toMatch(/Crons: 1 scheduled in dev \(--crons\)/)
    } finally {
      await server.close()
    }
  }, 60_000)

  it('without it, the cron does not fire and dev says how to schedule it', async () => {
    const app = writeApp('off')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startDevServer(app, { port: 0 })
    try {
      expect(await waitForFile(join(app, 'cron-ran'), 1500)).toBe(false)
      const printed = log.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(printed).toMatch(/Crons: 1 declared, not scheduled in dev/)
      expect(printed).toContain('theokit dev --crons')
    } finally {
      await server.close()
    }
  }, 60_000)
})
