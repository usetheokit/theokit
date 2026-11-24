import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

import { browserServer, readBrowser } from '../src/tools/browser-server.js'
import { createSharedBrowser } from '@theokit/host/browser'

/**
 * Issue #1152: the instance's shared browser, through the real wrapper and `@playwright/mcp` on the
 * installed Chromium (see `browser-render.test.ts`, which it follows: it runs where Chromium is
 * installed and always with THEOCLAW_LIVE=1, and skips elsewhere).
 */
const DEADLINE_MS = 90_000
const CHROMIUM = (() => {
  // The live job (THEOCLAW_LIVE=1) installs Chromium: there a missing one fails loudly instead of skipping.
  if (process.env.THEOCLAW_LIVE === '1') return true
  try {
    return (
      readBrowser({
        THEOCLAW_BROWSER: 'on',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      }) !== undefined
    )
  } catch {
    return false
  }
})()

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

interface Reply {
  readonly result?: {
    readonly isError?: boolean
    readonly content?: readonly { readonly text?: string }[]
  }
  readonly error?: { readonly message: string }
}

/** One MCP client over a started browser server: `call` runs a tool, `stop` ends the server. */
function mcpClient(command: string, args: readonly string[]) {
  const child = spawn(command, [...args], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.stdin.on('error', () => undefined)
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const waiting = new Map<number, (reply: Reply) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as Reply & { id?: number }
    if (message.id !== undefined) waiting.get(message.id)?.(message)
  })
  let next = 0
  const request = (method: string, params: object): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const id = ++next
      const timer = setTimeout(
        () => reject(new Error(`no answer to ${method}; stderr: ${stderr}`)),
        DEADLINE_MS,
      )
      waiting.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  return {
    async start() {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'theoclaw-test', version: '0' },
      })
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      )
    },
    async call(name: string, args: object): Promise<string> {
      const reply = await request('tools/call', { name, arguments: args })
      return (reply.result?.content ?? []).map((part) => part.text ?? '').join('\n')
    },
    async stop() {
      child.stdin.end()
      child.kill('SIGTERM')
      await closed
    },
  }
}

/** A tiny site: `/login` sets the cookie `sid=ok`; any other path greets a signed-in browser. */
async function startSite(): Promise<string> {
  const http = createServer((req, res) => {
    const signedIn = /(^|; )sid=ok/.test(req.headers.cookie ?? '')
    const page = (text: string): void => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        ...(req.url === '/login' ? { 'set-cookie': 'sid=ok; Path=/; Max-Age=3600' } : {}),
      })
      res.end(`<!doctype html><title>t</title><h1>${text}</h1>`)
    }
    if (req.url === '/login') page('Signed in')
    else page(signedIn ? 'Welcome back' : 'Please sign in')
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())))
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  return base
}

describe.skipIf(!CHROMIUM)('the shared browser on the installed Chromium', () => {
  it(
    'keeps a login after the browser is closed and started again on the same profile',
    { timeout: 4 * DEADLINE_MS },
    async () => {
      const base = await startSite()

      const profile = mkdtempSync(join(tmpdir(), 'theoclaw-shared-profile-'))
      const profileDir = join(profile, 'browser-profile')
      cleanups.push(() => rmSync(profile, { recursive: true, force: true }))
      const settings = readBrowser({
        THEOCLAW_BROWSER: 'on',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      })
      /** A fresh browser process on the profile, and a session attached to it. */
      const session = async () => {
        const shared = createSharedBrowser(profileDir)
        cleanups.push(() => shared.close())
        const cdpEndpoint = await shared.start()
        const server = browserServer({
          ...(settings as NonNullable<typeof settings>),
          cdpEndpoint,
        }) as { command: string; args: string[] }
        const client = mcpClient(server.command, server.args)
        cleanups.push(() => client.stop())
        await client.start()
        return {
          client,
          end: async () => {
            await client.stop()
            await shared.close()
          },
        }
      }

      const first = await session()
      expect(await first.client.call('browser_navigate', { url: `${base}/me` })).toContain(
        'Please sign in',
      )
      expect(await first.client.call('browser_navigate', { url: `${base}/login` })).toContain(
        'Signed in',
      )
      await first.end()

      // A new Chromium process: only the profile on disk carries the login over.
      const second = await session()
      expect(await second.client.call('browser_navigate', { url: `${base}/me` })).toContain(
        'Welcome back',
      )
    },
  )

  it(
    'serves two sessions at once on one signed-in browser, each on its own page',
    { timeout: 4 * DEADLINE_MS },
    async () => {
      const base = await startSite()
      const profile = mkdtempSync(join(tmpdir(), 'theoclaw-shared-profile-'))
      cleanups.push(() => rmSync(profile, { recursive: true, force: true }))
      const settings = readBrowser({
        THEOCLAW_BROWSER: 'on',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      })
      const shared = createSharedBrowser(join(profile, 'browser-profile'))
      cleanups.push(() => shared.close())
      const cdpEndpoint = await shared.start()
      const attach = async () => {
        const server = browserServer({
          ...(settings as NonNullable<typeof settings>),
          cdpEndpoint,
        }) as { command: string; args: string[] }
        const client = mcpClient(server.command, server.args)
        cleanups.push(() => client.stop())
        await client.start()
        return client
      }
      const [one, two] = [await attach(), await attach()]
      expect(await one.call('browser_navigate', { url: `${base}/login` })).toContain('Signed in')

      const [a, b] = await Promise.all([
        one.call('browser_navigate', { url: `${base}/me?who=one` }),
        two.call('browser_navigate', { url: `${base}/me?who=two` }),
      ])
      expect(a).toContain('Welcome back')
      expect(a).toContain('who=one')
      expect(b).toContain('Welcome back')
      expect(b).toContain('who=two')
      // Each session still sits on its own page: a shared tab would show the last navigation to both.
      expect(await one.call('browser_tabs', { action: 'list' })).toContain('who=one')
      expect(await two.call('browser_tabs', { action: 'list' })).toContain('who=two')
    },
  )

  it(
    'keeps the signed-in browser usable after the session that signed in has ended',
    { timeout: 4 * DEADLINE_MS },
    async () => {
      const base = await startSite()
      const profile = mkdtempSync(join(tmpdir(), 'theoclaw-shared-profile-'))
      cleanups.push(() => rmSync(profile, { recursive: true, force: true }))
      const settings = readBrowser({
        THEOCLAW_BROWSER: 'on',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      })
      const shared = createSharedBrowser(join(profile, 'browser-profile'))
      cleanups.push(() => shared.close())
      const cdpEndpoint = await shared.start()
      const attach = async () => {
        const server = browserServer({
          ...(settings as NonNullable<typeof settings>),
          cdpEndpoint,
        }) as { command: string; args: string[] }
        const client = mcpClient(server.command, server.args)
        cleanups.push(() => client.stop())
        await client.start()
        return client
      }
      const first = await attach()
      expect(await first.call('browser_navigate', { url: `${base}/login` })).toContain('Signed in')
      await first.stop()

      // The Chromium process is the same: only the MCP session ended.
      expect(await shared.start()).toBe(cdpEndpoint)
      const second = await attach()
      expect(await second.call('browser_navigate', { url: `${base}/me` })).toContain('Welcome back')
    },
  )
})
