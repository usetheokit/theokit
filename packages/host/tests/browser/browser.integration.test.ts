import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { browserMcpServer } from '../../src/browser/index.js'
import { buildProxy, type Reply, start } from './helpers.js'

const browsersDir =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright')
const hasChromium =
  existsSync(browsersDir) &&
  readdirSync(browsersDir).some((n) => n.startsWith('chromium_headless_shell-'))

describe.skipIf(!hasChromium)('browser capability against a real Chromium', () => {
  let http: Server
  let url: string
  let scratch: string
  let proxyPath: string
  beforeAll(async () => {
    http = createServer((_req, res) =>
      res.setHeader('content-type', 'text/html').end('<h1>Hello theokit</h1>'),
    )
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/`
    scratch = mkdtempSync(join(tmpdir(), 'host-browser-it-'))
    proxyPath = await buildProxy(scratch)
  })
  afterAll(() => {
    http.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('opens a page and reads its text; unsafe tool absent; files stay in outputDir', async () => {
    const outputDir = join(scratch, 'out')
    const config = browserMcpServer({ mode: 'isolated', outputDir }, { proxyPath })
    const p = start(config)
    const text = (r: Reply): string => JSON.stringify(r.result?.content ?? r.error)
    try {
      await p.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      })
      const names = ((await p.call('tools/list')).result.tools as { name: string }[]).map(
        (t) => t.name,
      )
      expect(names).toContain('browser_navigate')
      expect(names).not.toContain('browser_run_code_unsafe')
      expect(
        text(await p.call('tools/call', { name: 'browser_navigate', arguments: { url } })),
      ).toContain('Hello theokit')
      await p.call('tools/call', {
        name: 'browser_take_screenshot',
        arguments: { filename: '../../escaped.png' },
      })
      await p.call('tools/call', {
        name: 'browser_take_screenshot',
        arguments: { filename: join(scratch, 'abs-escape.png') },
      })
      expect(existsSync(join(scratch, 'abs-escape.png'))).toBe(false)
      expect(existsSync(join(scratch, 'escaped.png'))).toBe(false)
      expect(existsSync(join(outputDir, '..', '..', 'escaped.png'))).toBe(false)
    } finally {
      p.close()
    }
  }, 60_000)
})
