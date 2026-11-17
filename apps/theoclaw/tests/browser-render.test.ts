import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createInterface } from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

import { browserServer, readBrowser } from '../src/tools/browser-server.js'

/**
 * Issue #1417: `browser_navigate` against a local page whose JavaScript renders a value, through
 * the real wrapper and the real `@playwright/mcp` on the Chromium `browser:install` puts in
 * Playwright's browsers directory (the one the live-model job installs). It needs that Chromium, so
 * it runs where one is installed and always with THEOCLAW_LIVE=1 (a missing Chromium then fails
 * it); any other machine without one skips it.
 */
const DEADLINE_MS = 90_000
const CHROMIUM = (() => {
  // The live job (THEOCLAW_LIVE=1) installs Chromium: there a missing one fails loudly instead of skipping.
  if (process.env.THEOCLAW_LIVE === '1') return true
  try {
    return readBrowser({ THEOCLAW_BROWSER: 'on', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }) !== undefined
  } catch {
    return false
  }
})()

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

interface Reply {
  readonly result?: { readonly isError?: boolean; readonly content?: readonly { readonly text?: string }[] }
  readonly error?: { readonly message: string }
}

describe.skipIf(!CHROMIUM)('browser_navigate on the installed Chromium', () => {
  it('reads a value the page renders with JavaScript', { timeout: DEADLINE_MS + 10_000 }, async () => {
    const value = `tok-${randomBytes(6).toString('hex')}`
    const reversed = [...value].reverse().join('')
    const body = `<!doctype html><html><body><div id="v"></div><script>document.getElementById('v').textContent='${reversed}'.split('').reverse().join('')</script></body></html>`
    const http = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(body)
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())))
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/`

    const settings = readBrowser({ THEOCLAW_BROWSER: 'on', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH })
    const server = browserServer(settings as NonNullable<typeof settings>) as { command: string; args: string[] }
    const child = spawn(server.command, server.args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdin.on('error', () => undefined)
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    cleanups.push(async () => {
      child.stdin.end()
      child.kill('SIGTERM')
      await closed
    })
    const waiting = new Map<number, (reply: Reply) => void>()
    createInterface({ input: child.stdout }).on('line', (line) => {
      const message = JSON.parse(line) as Reply & { id?: number }
      if (message.id !== undefined) waiting.get(message.id)?.(message)
    })
    let next = 0
    const request = (method: string, params: object): Promise<Reply> =>
      new Promise((resolve, reject) => {
        const id = ++next
        const timer = setTimeout(() => reject(new Error(`no answer to ${method} in ${DEADLINE_MS} ms; stderr: ${stderr}`)), DEADLINE_MS)
        waiting.set(id, (reply) => {
          clearTimeout(timer)
          resolve(reply)
        })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    const textOf = (reply: Reply): string => (reply.result?.content ?? []).map((part) => part.text ?? '').join('\n')

    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'theoclaw-test', version: '0' } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

    const navigated = await request('tools/call', { name: 'browser_navigate', arguments: { url } })
    const navigatedText = textOf(navigated)
    expect(navigated.error, `stderr: ${stderr}`).toBeUndefined()
    expect(navigatedText, `stderr: ${stderr}`).not.toMatch(/no open pages/i)
    expect(navigated.result?.isError, navigatedText).not.toBe(true)
    // The snapshot the navigate returns is the rendered page, so the script has run.
    expect(navigatedText).toContain(value)

    const snapshot = await request('tools/call', { name: 'browser_snapshot', arguments: {} })
    expect(textOf(snapshot)).toContain(value)
  })
})
