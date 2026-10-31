import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { afterEach, describe, expect, it } from 'vitest'

import { browserServer } from '../src/tools/browser-server.js'

/**
 * The stdio wrapper every browser server is started through (review round 1, F-dom-1 / LCR0134,
 * F-dom-2 / LCR0135). A stand-in server replaces Playwright's, so what the wrapper filters, refuses
 * and isolates is observed offline: the stand-in lists one unsafe tool beside two offered ones and
 * answers a call with the directory, arguments and environment it was started with.
 */
const DEADLINE_MS = 15_000

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const STAND_IN = `
import { createInterface } from 'node:readline'
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { seen: message.params } })
  else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'browser_navigate' }, { name: 'browser_run_code_unsafe' }, { name: 'browser_snapshot' }] } })
  } else {
    const env = Object.keys(process.env).filter((key) => key.startsWith('PLAYWRIGHT_MCP_'))
    send({ jsonrpc: '2.0', id: message.id, result: { called: message.params?.name, cwd: process.cwd(), argv: process.argv.slice(2), env, pid: process.pid } })
  }
})
`

function standInCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-stand-in-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'cli.mjs')
  writeFileSync(path, STAND_IN)
  return path
}

interface Answer {
  readonly id: number
  readonly result?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string }
}

/** Start the configured server, send `requests` (ids 1..n), and resolve with each answer by id once the child has closed. */
async function exchange(requests: readonly object[], env: NodeJS.ProcessEnv = process.env): Promise<Map<number, Answer>> {
  const server = browserServer({ cliPath: standInCli() }) as { command: string; args: string[] }
  const child = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const closed = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)))
  const answers = new Map<number, Answer>()
  const all = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`answers ${[...answers.keys()].join(',')} of ${requests.length}; stderr: ${stderr}`)), DEADLINE_MS)
    createInterface({ input: child.stdout }).on('line', (line) => {
      const answer = JSON.parse(line) as Answer
      answers.set(answer.id, answer)
      if (answers.size === requests.length) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  requests.forEach((request, index) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request })}\n`))
  await all
  child.stdin.end()
  await closed
  return answers
}

/** Resolve once `pid` is no longer running, or reject naming it after the deadline. */
async function processGone(pid: number): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    if (Date.now() > deadline) throw new Error(`process ${pid} still running ${DEADLINE_MS} ms after the wrapper got SIGTERM`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** Start the wrapper with `args` and resolve with its exit code and stderr once it closes. */
async function runWrapper(args: readonly string[]): Promise<{ readonly code: number | null; readonly stderr: string }> {
  const [proxy] = (browserServer({ cliPath: standInCli() }) as { args: string[] }).args
  const child = spawn(process.execPath, [proxy as string, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.stdin.end()
  const code = await new Promise<number | null>((resolve) => child.once('close', (exit) => resolve(exit)))
  return { code, stderr }
}

describe('the browser server wrapper', () => {
  it('lists no tool outside the offered set', async () => {
    const answers = await exchange([{ method: 'tools/list' }])
    const tools = (answers.get(1)?.result?.tools ?? []) as { name: string }[]
    expect(tools.map((tool) => tool.name)).toEqual(['browser_navigate', 'browser_snapshot'])
  })

  it('refuses a call to browser_run_code_unsafe without passing it to the server', async () => {
    const answers = await exchange([{ method: 'tools/call', params: { name: 'browser_run_code_unsafe', arguments: { code: '1' } } }])
    expect(answers.get(1)?.result).toBeUndefined()
    expect(answers.get(1)?.error?.message).toBe('theoclaw: the browser tool browser_run_code_unsafe is not offered')
  })

  it('starts the server in a fresh directory outside the workspace, its output directory, and removes it on exit', async () => {
    const answers = await exchange([{ method: 'tools/call', params: { name: 'browser_navigate', arguments: {} } }])
    const result = answers.get(1)?.result as { called: string; cwd: string; argv: string[] }
    expect(result.called).toBe('browser_navigate')
    expect(result.cwd).not.toBe(process.cwd())
    // The child reports its resolved cwd; a symlinked temp directory (macOS /var) is resolved too (F-tests-13).
    expect(result.cwd.startsWith(realpathSync(tmpdir()))).toBe(true)
    expect(result.argv.slice(-2)).toEqual(['--output-dir', result.cwd])
    expect(existsSync(result.cwd)).toBe(false)
  })

  it('drops PLAYWRIGHT_MCP_ variables from the server environment', async () => {
    const env = { ...process.env, PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS: 'true' }
    const answers = await exchange([{ method: 'tools/call', params: { name: 'browser_navigate', arguments: {} } }], env)
    expect((answers.get(1)?.result as { env: string[] }).env).toEqual([])
  })

  it('strips the roots capability from initialize, so the server keeps its own directory as the file root', async () => {
    const params = { protocolVersion: '2025-06-18', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 't', version: '0' } }
    const answers = await exchange([{ method: 'initialize', params }])
    const seen = answers.get(1)?.result?.seen as { capabilities: Record<string, unknown> }
    expect(seen.capabilities).toEqual({})
  })

  it('forwards SIGTERM to the server and removes its directory', async () => {
    // Review round 2 (F-tests-9): disposing an agent ends the wrapper by signal, not by closing stdin.
    const server = browserServer({ cliPath: standInCli() }) as { command: string; args: string[] }
    const child = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const closed = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)))
    const answer = await new Promise<Answer>((resolve) => {
      createInterface({ input: child.stdout }).once('line', (line) => resolve(JSON.parse(line) as Answer))
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_navigate', arguments: {} } })}\n`)
    })
    const { pid, cwd } = answer.result as { pid: number; cwd: string }
    child.kill('SIGTERM')
    // The stand-in dies of the forwarded signal, so the wrapper exits 1 (ended on a signal).
    expect(await closed).toBe(1)
    await processGone(pid)
    expect(existsSync(cwd)).toBe(false)
  })

  it('exits 2 naming its usage when started without a CLI', async () => {
    const { code, stderr } = await runWrapper([])
    expect(code).toBe(2)
    expect(stderr).toContain('usage: browser-proxy.mjs <playwright-mcp cli>')
  })

  it('exits with the server status and leaves no directory when the CLI does not exist', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'theoclaw-missing-')), 'cli.mjs')
    cleanups.push(() => rmSync(join(missing, '..'), { recursive: true, force: true }))
    const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('theoclaw-browser-')))
    const { code, stderr } = await runWrapper([missing])
    expect(code).toBe(1)
    expect(stderr).toContain('Cannot find module')
    const left = readdirSync(tmpdir()).filter((name) => name.startsWith('theoclaw-browser-') && !before.has(name))
    expect(left).toEqual([])
  })
})
