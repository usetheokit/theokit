import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

import { browserServer, readBrowser } from '../src/tools/browser-server.js'

const DEADLINE_MS = 30_000

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface StdioCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** How long a child that ignored SIGTERM gets before SIGKILL, so cleanup never outlives the test. */
const KILL_GRACE_MS = 2_000

/**
 * Spawn `server`, send `initialize`, `notifications/initialized` and `tools/list` as
 * newline-delimited JSON-RPC, and resolve with the tool names of the `tools/list` answer. Rejects
 * naming the exit and stderr when the child closes first, a stdout line that is not JSON, or what
 * never arrived at the deadline. The child is ended and its close awaited before the promise
 * settles. `close`, not `exit`: it fires after stdout and stderr have drained.
 */
function listTools(server: StdioCommand, env: NodeJS.ProcessEnv): Promise<string[]> {
  const child = spawn(server.command, [...server.args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const closed = new Promise<string>((resolve) => child.once('close', (code, signal) => resolve(`${String(code)} (signal ${String(signal)})`)))
  const lines = createInterface({ input: child.stdout })
  const answered = new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no tools/list answer within ${DEADLINE_MS} ms; stderr: ${stderr}`)), DEADLINE_MS)
    timer.unref()
    lines.on('line', (line) => {
      let message: { id?: number; result?: { tools?: { name: string }[] } }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        reject(new Error(`the server wrote a stdout line that is not JSON-RPC: ${line}`))
        return
      }
      if (message.id !== 2) return
      clearTimeout(timer)
      resolve((message.result?.tools ?? []).map((tool) => tool.name))
    })
    void closed.then((how) => {
      clearTimeout(timer)
      reject(new Error(`the server exited with ${how} before answering; stderr: ${stderr}`))
    })
  })
  // A child that exited closes its stdin; the close is what the test reports, not the EPIPE.
  child.stdin.on('error', () => undefined)
  const send = (message: object): void => void child.stdin.write(`${JSON.stringify(message)}\n`)
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'theoclaw-test', version: '0' } },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  return answered.finally(async () => {
    lines.close()
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end()
      child.kill('SIGTERM')
      const grace = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      await closed
      clearTimeout(grace)
    } else await closed
  })
}

describe('the browser server over stdio', () => {
  it('lists browser_navigate and browser_snapshot over stdio', async () => {
    // EC-2: no browser in the browsers directory, so the list must answer without one.
    const emptyBrowsers = mkdtempSync(join(tmpdir(), 'theoclaw-no-browsers-'))
    cleanups.push(() => rmSync(emptyBrowsers, { recursive: true, force: true }))
    // The CLI is the installed package's, resolved by the start's own resolver; the Chromium check
    // is satisfied by a stand-in directory, since this test launches no browser.
    const standIn = mkdtempSync(join(tmpdir(), 'theoclaw-browsers-'))
    cleanups.push(() => rmSync(standIn, { recursive: true, force: true }))
    mkdirSync(join(standIn, 'chromium-1'))
    const settings = readBrowser({ THEOCLAW_BROWSER: 'on' }, { browsersDir: standIn })
    expect(settings?.cliPath).toMatch(/@playwright[/\\]mcp[/\\]cli\.js$/)
    const server = browserServer(settings as NonNullable<typeof settings>) as StdioCommand
    // The whole environment, not the SDK's scrubbed one: this pins the server's tool list, not the scrub.
    const names = await listTools(server, { ...process.env, PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers })
    expect(names).toContain('browser_navigate')
    expect(names).toContain('browser_snapshot')
  }, DEADLINE_MS + 5_000)

  it('defines browser:install as the bundled Playwright install', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['browser:install']).toBe('node tools/install-browser.mjs')
  })

  it('fails naming the stderr when the server exits before answering', async () => {
    const dying = { command: process.execPath, args: ['-e', "process.stderr.write('dying'); process.exit(3)"] }
    await expect(listTools(dying, process.env)).rejects.toThrow(/exited with 3 \(signal null\) before answering; stderr: dying/)
  })
})
