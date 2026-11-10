import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import type { AgentToolOptions } from '../../src/tools/tool-registry.js'
import { controlAgentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'
import { stopProcessGroup } from '../stop-process-group.js'

/**
 * OC-62 (B-676): the `computer` tool on a real model, on a virtual display. Xvfb runs with
 * `-fbdir`, a headed Chromium fills the screen with a page holding a code line and an autofocused
 * text box, and the agent is built the process's way: `/control` options over `createTheoClawAgent`.
 * It asserts that the actions happened, that the typed word arrived and that a token only the
 * screen showed was reported; not the describer's coordinate accuracy. Runs only with
 * THEOCLAW_LIVE=1; with Xvfb, xdotool or Chromium missing it fails naming what is missing.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const SCREEN = { width: 1024, height: 768 }
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function liveModel(): { readonly model: string; readonly apiKey: string } {
  const model = process.env.THEOCLAW_MODEL
  const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!apiKey) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  return { model, apiKey }
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function randomText(length: number): string {
  return Array.from({ length }, () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)]).join('')
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once('exit', () => resolve())
    child.kill('SIGKILL')
  })
}

/** Xvfb on a free display, its framebuffer under `directory`; resolves with the display, e.g. `:99`. */
async function startXvfb(directory: string): Promise<string> {
  const child = spawn(
    'Xvfb',
    [
      '-displayfd',
      '3',
      '-screen',
      '0',
      `${SCREEN.width}x${SCREEN.height}x24`,
      '-fbdir',
      directory,
      '-nolisten',
      'tcp',
    ],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    },
  )
  cleanups.push(() => stopProcess(child))
  const pipe = child.stdio[3]
  if (pipe === null || pipe === undefined || !('on' in pipe))
    throw new Error('Xvfb gave no display pipe; is Xvfb installed?')
  const number = await new Promise<string>((resolve, reject) => {
    let text = ''
    pipe.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      if (text.includes('\n')) resolve(text.trim())
    })
    child.once('error', (error) => reject(new Error(`Xvfb did not start: ${error.message}`)))
    child.once('exit', (code) =>
      reject(new Error(`Xvfb exited with ${code} before naming a display`)),
    )
  })
  return `:${number}`
}

function chromiumBinary(): string {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright')
  const build = readdirSync(base).find((name) => /^chromium-\d+$/.test(name))
  if (build === undefined)
    throw new Error(`no chromium build in ${base}; run the browser:install script`)
  return join(base, build, 'chrome-linux64', 'chrome')
}

interface Page {
  readonly url: string
  readonly typed: () => string
  readonly loaded: () => boolean
}

/** A loopback page: a large `CODE <token>` line, and a textarea filling the rest that reports what it holds. */
async function servePage(token: string): Promise<Page> {
  let typed = ''
  let loaded = false
  const html = `<!doctype html><html><body style="margin:0;font-family:sans-serif">
<div style="font-size:64px;padding:16px;height:100px">CODE ${token}</div>
<textarea autofocus style="position:absolute;top:130px;left:0;right:0;bottom:0;width:100%;font-size:32px;box-sizing:border-box"
 oninput="fetch('/typed',{method:'POST',body:this.value})"></textarea></body></html>`
  const server: Server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/typed') {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        typed = body
        response.end('ok')
      })
      return
    }
    if (request.url === '/') loaded = true
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/`, typed: () => typed, loaded: () => loaded }
}

async function waitUntil(condition: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} did not happen within ${timeoutMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe.skipIf(!LIVE)('the computer tool against a real model', () => {
  it(
    'a real model takes a screenshot, moves the pointer and types into a window for OC-62',
    { timeout: 240_000 },
    async () => {
      const token = randomText(6)
      const word = randomText(8).toLowerCase()
      const page = await servePage(token)
      const framebufferDirectory = mkdtempSync(join(tmpdir(), 'theoclaw-computer-live-'))
      cleanups.push(() => rmSync(framebufferDirectory, { recursive: true, force: true }))
      const display = await startXvfb(framebufferDirectory)
      const profile = mkdtempSync(join(tmpdir(), 'theoclaw-computer-profile-'))
      cleanups.push(() =>
        rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
      )
      // This host's Chromium needs `--no-sandbox` (no usable user-namespace sandbox) and the shared libraries in LD_LIBRARY_PATH: harness details, never a TheoClaw setting (plan Q2).
      const chromium = spawn(
        chromiumBinary(),
        [
          `--app=${page.url}`,
          `--user-data-dir=${profile}`,
          '--no-first-run',
          '--no-sandbox',
          '--window-position=0,0',
          `--window-size=${SCREEN.width},${SCREEN.height}`,
        ],
        {
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
            DISPLAY: display,
          },
          stdio: 'ignore',
          detached: true,
        },
      )
      cleanups.push(() => stopProcessGroup(chromium))
      await waitUntil(page.loaded, 'the window loading the page', 15_000)

      const workspace = makeHostToolsWorkspace()
      cleanups.push(() => workspace.remove())
      const settings = resolveToolSettings(
        {
          THEOCLAW_HOST_TOOLS: 'on',
          THEOCLAW_COMPUTER: 'on',
          DISPLAY: display,
          THEOCLAW_COMPUTER_FRAMEBUFFER: join(framebufferDirectory, 'Xvfb_screen0'),
          PATH: process.env.PATH,
        },
        workspace.path,
      )
      const { model, apiKey } = liveModel()
      const build = (toolOptions: AgentToolOptions) =>
        createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions }))
      const agent = await build(controlAgentToolOptions(settings, build))
      const actions: string[] = []
      let answer = ''
      try {
        const run = await agent.send(
          `Use the computer tool. Take a screenshot, move the pointer onto the text box, type the word ${word}, then take another screenshot. Tell me the code shown after the word CODE.`,
        )
        for await (const event of run.stream()) {
          if (event.type !== 'tool_call' || !('name' in event) || event.name !== 'computer')
            continue
          if ('status' in event && event.status === 'running' && 'args' in event)
            actions.push(String((event.args as { action?: unknown })?.action))
        }
        const outcome = await run.wait()
        if (outcome.status !== 'finished')
          throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
        answer = String(outcome.result ?? '')
      } finally {
        await agent[Symbol.asyncDispose]()
      }
      console.log(
        `OC-62 live: model=${model} actions=${JSON.stringify(actions)} typed=${JSON.stringify(page.typed())} answer=${JSON.stringify(answer)}`,
      )
      expect(actions).toEqual(expect.arrayContaining(['screenshot', 'mouse_move', 'type']))
      expect(page.typed()).toContain(word)
      expect(answer).toContain(token)
    },
  )
})
