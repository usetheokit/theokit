import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * B-373: OC-26 (an OpenAI-compatible HTTP API) and OC-27 (tool invocation over HTTP) against a real
 * model, through the BUILT entry (`dist/main.js`), so the checks prove the process an operator
 * starts. Runs only with THEOCLAW_LIVE=1 and the model settings in the environment; without the
 * flag it skips, so CI stays offline. Build first: `pnpm --filter theoclaw run build`.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const TOKEN = `live-api-token-${randomBytes(16).toString('hex')}`
const MARKER_FILE = `oc-27-marker-${randomBytes(4).toString('hex')}.txt`

let child: ChildProcess | undefined
let output = ''
let port = 0
let home = ''

/** Poll the captured output for `pattern`; never a fixed sleep (`rules/testing.md` § 3). */
async function waitFor(pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const match = output.match(pattern)
    if (match !== null) return match
    if (child === undefined || child.exitCode !== null) throw new Error(`the entry exited before ${what}: ${output}`)
    if (Date.now() > deadline) throw new Error(`no ${what} within 15 s: ${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function startEntry(entry: string): ChildProcess {
  return spawn(process.execPath, [entry], {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      THEOCLAW_MODEL: process.env.THEOCLAW_MODEL,
      ...(process.env.THEOKIT_API_KEY ? { THEOKIT_API_KEY: process.env.THEOKIT_API_KEY } : {}),
      ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
      THEOCLAW_PORT: '0',
      THEOCLAW_CONTROL_TOKEN: TOKEN,
      THEOCLAW_OWNERS: 'telegram:owner',
      THEOCLAW_DM_POLICY: 'allowlist',
      THEOCLAW_WORKSPACE: home,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe.skipIf(!LIVE)('the HTTP API against a real model', () => {
  beforeAll(async () => {
    const modelKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
    if (!process.env.THEOCLAW_MODEL || !modelKey) {
      throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
    }
    const entry = join(APP_DIR, 'dist', 'main.js')
    if (!existsSync(entry)) throw new Error(`${entry} is missing: run pnpm --filter theoclaw run build`)
    // A scratch HOME and cwd: the start makes the tool root `files/` there.
    home = mkdtempSync(join(tmpdir(), 'theoclaw-live-api-'))
    child = startEntry(entry)
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const [, bound] = await waitFor(/theoclaw: control plane listening on 127\.0\.0\.1:(\d+)/, 'the listening line')
    port = Number(bound)
  }, 30_000)

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      const running = child
      const gone = new Promise((resolve) => running.once('exit', resolve))
      running.kill('SIGINT')
      const timer = setTimeout(() => running.kill('SIGKILL'), 5_000)
      await gone
      clearTimeout(timer)
    }
    if (home !== '') rmSync(home, { recursive: true, force: true })
  }, 15_000)

  it('an OpenAI client gets a real-model answer from the started process for OC-26', { timeout: 60_000 }, async () => {
    const model = String(process.env.THEOCLAW_MODEL)
    const client = new OpenAI({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: TOKEN, maxRetries: 0 })

    const models = await client.models.list()
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
    })

    expect(models.data.map((entry) => entry.id)).toContain(model)
    expect(completion.object).toBe('chat.completion')
    expect(completion.choices[0]?.message.content?.trim() ?? '').not.toBe('')
  })

  it('a tool invoked over HTTP returns its result from the started process for OC-27', { timeout: 30_000 }, async () => {
    writeFileSync(join(home, 'files', MARKER_FILE), 'written by the live test')

    const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'list_dir', args: { path: '.' } }),
    })
    const body = (await response.json()) as { ok?: unknown; result?: unknown }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(JSON.stringify(body.result)).toContain(MARKER_FILE)
  })

  it('never prints the control token in the process output', () => {
    expect(output).toMatch(/control plane listening on/)
    expect(output.split(TOKEN).length - 1).toBe(0)
  })
})
