/**
 * T1.2 — devtools injection integration test.
 *
 * Spawns the Theo dev server and asserts:
 * - HTML served in dev contains `<script src="/@theo/devtools/entry.js">`
 * - The virtual module path returns 200 + JS
 * - `theo.config.ts.devtools = false` disables the injection
 *
 * NEVER use dangerouslySetInnerHTML in any devtools component — see plan EC-20.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { startDevServer } from '../../packages/theo/src/cli/commands/dev.js'
import { safeClose } from './helpers/safe-close.js'

function makeProject(opts: { devtoolsConfig?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'theo-devtools-inject-'))
  writeFileSync(
    join(root, 'index.html'),
    `<!DOCTYPE html>
<html>
  <head><title>devtools-inject-test</title></head>
  <body><div id="root"></div></body>
</html>`,
  )
  writeFileSync(join(root, 'theo.config.ts'), `export default ${opts.devtoolsConfig ?? '{}'}`)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tmp', type: 'module' }))
  mkdirSync(join(root, 'app'), { recursive: true })
  writeFileSync(
    join(root, 'app', 'page.tsx'),
    `export default function Page() { return <h1>devtools-test</h1> }`,
  )
  return root
}

describe('T1.2 — devtools injection (default — devtools enabled)', () => {
  let root: string
  let server: Awaited<ReturnType<typeof startDevServer>>
  let port: number

  beforeAll(async () => {
    // Phase 6 prereq escape hatch — makeProject() creates a tmp dir
    // without node_modules, so the native-binding ABI preflight
    // (preflight-node-version.ts) would fire on `startDevServer`. Tests
    // don't exercise better-sqlite3; opt out.
    process.env.THEOKIT_SKIP_NATIVE_PREFLIGHT = '1'
    root = makeProject({})
    server = await startDevServer(root, { port: 0 })
    const addr = (server.httpServer as Server).address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  }, 30000)

  afterAll(async () => {
    await safeClose(server)
    rmSync(root, { recursive: true, force: true })
  }, 15000)

  it('served HTML contains the devtools entry script tag in dev mode', async () => {
    const res = await fetch(`http://localhost:${port}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('/@theo/devtools/entry.js')
  })

  it('devtools script is injected BEFORE </head>', async () => {
    const html = await (await fetch(`http://localhost:${port}/`)).text()
    const scriptIdx = html.indexOf('/@theo/devtools/entry.js')
    const headCloseIdx = html.toLowerCase().indexOf('</head>')
    expect(scriptIdx).toBeGreaterThan(0)
    expect(scriptIdx).toBeLessThan(headCloseIdx)
  })

  it('virtual module /@theo/devtools/entry.js returns 200 JS', async () => {
    const res = await fetch(`http://localhost:${port}/@theo/devtools/entry.js`)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') ?? ''
    // Vite serves JS modules with javascript content type
    expect(ct.toLowerCase()).toMatch(/javascript|text\/jsx|jsx/)
    const body = await res.text()
    // The virtual module re-imports the real entry (Vite resolves the alias
    // to an absolute path before serving). After T2.4 (M3 sub-org of
    // devtools/), the entry moved from `devtools/entry.tsx` to
    // `devtools/dom/entry.tsx`. Vite resolves `theokit/devtools/entry`
    // to its absolute on-disk path, so the regex accepts either
    // `devtools/entry` (legacy flat) OR `devtools/dom/entry` (post-T2.4 sub-org).
    expect(body).toMatch(/devtools\/(dom\/)?entry/)
    expect(body).toContain('import')
  })

  it('entry-client script and devtools script BOTH present (independent injections)', async () => {
    const html = await (await fetch(`http://localhost:${port}/`)).text()
    expect(html).toContain('/@theo/entry-client')
    expect(html).toContain('/@theo/devtools/entry.js')
  })
})

describe('T1.2 — devtools opt-out (devtools: false)', () => {
  let root: string
  let server: Awaited<ReturnType<typeof startDevServer>>
  let port: number

  beforeAll(async () => {
    root = makeProject({ devtoolsConfig: '{ devtools: false }' })
    server = await startDevServer(root, { port: 0 })
    const addr = (server.httpServer as Server).address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  }, 30000)

  afterAll(async () => {
    await safeClose(server)
    rmSync(root, { recursive: true, force: true })
  }, 15000)

  it('served HTML does NOT contain devtools script tag when devtools: false', async () => {
    const html = await (await fetch(`http://localhost:${port}/`)).text()
    expect(html).not.toContain('/@theo/devtools/entry.js')
  })

  it('entry-client script is still present (only devtools is disabled)', async () => {
    const html = await (await fetch(`http://localhost:${port}/`)).text()
    expect(html).toContain('/@theo/entry-client')
  })
})
