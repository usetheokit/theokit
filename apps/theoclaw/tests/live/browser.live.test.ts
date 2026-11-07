import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import { agentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'

/**
 * OC-60 (B-383): the browser on a real model, built from `resolveToolSettings`, `agentToolOptions`
 * and `createTheoClawAgent`. The process builds `/control` agents through `controlAgentToolOptions`,
 * which delegates the browser to `agentToolOptions`, and `main.ts`'s own `Agent.create` spread; that
 * composition is pinned offline by browser-settings.test.ts's `/control` turn. It runs only with
 * THEOCLAW_LIVE=1; with it set and no Chromium installed, `resolveToolSettings` refuses naming
 * `browser:install`, so the case fails loudly instead of skipping. The page writes a token made at
 * test time with JavaScript, so the raw body (what `web_fetch` reads) does not hold it.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const DISPOSE_DEADLINE_MS = 10_000

function liveModel(): { readonly model: string; readonly apiKey: string } {
  const model = process.env.THEOCLAW_MODEL
  const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!apiKey) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  return { model, apiKey }
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * A loopback page whose element `v` gets `value` only once its script runs. The script carries the
 * value reversed, so the raw body (what `web_fetch` reads) never holds it.
 */
async function renderedPage(value: string): Promise<{ readonly url: string; readonly rawBody: string }> {
  const reversed = [...value].reverse().join('')
  const rawBody = `<!doctype html><html><body><div id="v"></div><script>document.getElementById('v').textContent='${reversed}'.split('').reverse().join('')</script></body></html>`
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(rawBody)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, rawBody }
}

/**
 * `pgrep -f` reads its pattern as a regular expression, and the CLI path holds `+` and `.`
 * (`@playwright+mcp@0.0.83`), so the path is escaped to match only itself.
 */
function literalPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The pids of the processes whose command line holds `path` (pgrep's `-f`). The CLI path is the
 * shared pnpm-store one, so a test compares sets taken before and after its own turn rather than
 * reading any match as its own server (review round 1, F-tests-3).
 */
function serverPids(path: string): Set<number> {
  const out = spawnSync('pgrep', ['-f', literalPattern(path)], { encoding: 'utf8' }).stdout
  return new Set(out.split('\n').filter((line) => line.trim() !== '').map(Number))
}

/** Wait until none of `pids` is running, or fail naming the ones left. */
async function waitForGone(path: string, pids: ReadonlySet<number>): Promise<void> {
  const deadline = Date.now() + DISPOSE_DEADLINE_MS
  for (;;) {
    const running = serverPids(path)
    const left = [...pids].filter((pid) => running.has(pid))
    if (left.length === 0) return
    if (Date.now() > deadline) throw new Error(`browser server still running ${DISPOSE_DEADLINE_MS} ms after dispose: pids ${left.join(' ')}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** The wrapper's working directories (browser-proxy.mjs) present under the system temp directory now. */
function wrapperDirs(): Set<string> {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('theoclaw-browser-') && !name.startsWith('theoclaw-browser-live-')))
}

/** Wait until none of `dirs` exists under the temp directory, or fail naming the ones left. */
async function waitForRemoved(dirs: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + DISPOSE_DEADLINE_MS
  for (;;) {
    const left = [...dirs].filter((name) => existsSync(join(tmpdir(), name)))
    if (left.length === 0) return
    if (Date.now() > deadline) throw new Error(`browser server directory still present ${DISPOSE_DEADLINE_MS} ms after dispose: ${left.join(' ')}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe.skipIf(!LIVE)('the browser against a real model', () => {
  it('a real model reads a value a page renders with JavaScript for OC-60', { timeout: 180_000 }, async () => {
    const value = `tok-${randomBytes(6).toString('hex')}`
    const page = await renderedPage(value)
    // The discrimination against web_fetch: the token exists only after the script runs.
    expect(page.rawBody).not.toContain(value)

    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-browser-live-'))
    cleanups.push(() => rmSync(workspace, { recursive: true, force: true }))
    // The browsers directory the spawned server will read, so the start check and the launch agree.
    const settings = resolveToolSettings({ THEOCLAW_BROWSER: 'on', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }, workspace)
    const cliPath = settings.browser?.cliPath
    expect(cliPath, 'THEOCLAW_BROWSER=on resolved a CLI').toBeDefined()

    const { model, apiKey } = liveModel()
    const agent = await createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions: agentToolOptions(settings) }))
    let answer = ''
    const toolCalls: string[] = []
    try {
      const run = await agent.send(
        `Open ${page.url} in the browser and tell me the exact text shown in the element with id v.`,
      )
      for await (const event of run.stream()) {
        if (event.type === 'tool_call' && 'name' in event && 'status' in event && event.status === 'running') toolCalls.push(String(event.name))
      }
      const outcome = await run.wait()
      if (outcome.status !== 'finished') throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
      answer = String((outcome as { result?: unknown }).result ?? '')
    } finally {
      await agent[Symbol.asyncDispose]()
    }
    console.log(`OC-60 live: model=${model} toolCalls=${JSON.stringify(toolCalls)} answer=${JSON.stringify(answer)}`)
    expect(toolCalls.some((name) => name.includes('browser_navigate')), JSON.stringify(toolCalls)).toBe(true)
    expect(answer).toContain(value)
  })

  it('leaves no browser server or its directory behind after the agent is disposed', { timeout: 180_000 }, async () => {
    const page = await renderedPage(`tok-${randomBytes(6).toString('hex')}`)
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-browser-live-'))
    cleanups.push(() => rmSync(workspace, { recursive: true, force: true }))
    const settings = resolveToolSettings({ THEOCLAW_BROWSER: 'on', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }, workspace)
    const cliPath = settings.browser?.cliPath
    expect(cliPath, 'THEOCLAW_BROWSER=on resolved a CLI').toBeDefined()

    const { model, apiKey } = liveModel()
    const before = serverPids(cliPath as string)
    const dirsBefore = wrapperDirs()
    const agent = await createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions: agentToolOptions(settings) }))
    let own = new Set<number>()
    let ownDirs = new Set<string>()
    try {
      // The server is spawned by the first browser call, not by `create`, so the case runs a turn.
      const run = await agent.send(`Open ${page.url} in the browser and tell me the text of the element with id v.`)
      await run.wait()
      own = new Set([...serverPids(cliPath as string)].filter((pid) => !before.has(pid)))
      expect(own.size, 'this agent started a browser server before dispose').toBeGreaterThan(0)
      ownDirs = new Set([...wrapperDirs()].filter((name) => !dirsBefore.has(name)))
      expect(ownDirs.size, 'the wrapper made its working directory before dispose').toBeGreaterThan(0)
    } finally {
      await agent[Symbol.asyncDispose]()
    }
    // EC-1: a disposed agent leaves no browser server of its own running, and the wrapper removed the
    // directory the server wrote its output in (the README's claim on the dispose path; review round 2).
    await waitForGone(cliPath as string, own)
    await waitForRemoved(ownDirs)
  })
})
