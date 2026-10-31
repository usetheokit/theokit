/**
 * The configuration file through the real process entry (B-374, T1.1): a file at the path
 * `configurationPath` names supplies every setting the start needs, the entry reads it with
 * `loadConfiguration`, and a variable set in the environment still wins over the file. A file
 * `onboard` wrote (T1.2) starts the same entry with nothing else in the environment.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { configurationPath, loadConfiguration } from '../../src/config-file.js'
import { onboard } from '../../src/onboard.js'

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(APP_DIR, 'src', 'main.ts')
const TSX_LOADER = import.meta.resolve('tsx')

let dir: string | undefined
let child: ChildProcess | undefined

afterEach(async () => {
  const running = child
  child = undefined
  if (running !== undefined && running.exitCode === null && running.signalCode === null) {
    const gone = new Promise((resolve) => running.once('exit', resolve))
    running.kill('SIGKILL')
    await gone
  }
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

async function waitForOutput(read: () => string, pattern: RegExp, process: ChildProcess): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const match = read().match(pattern)
    if (match !== null) return match
    if (process.exitCode !== null) throw new Error(`the entry exited ${process.exitCode}: ${read()}`)
    if (Date.now() > deadline) throw new Error(`no line matching ${pattern} within 30 s: ${read()}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('the configuration file read by the process entry', () => {
  it('an entry started with only a configuration file listens on the port the file names, the environment winning', { timeout: 45_000 }, async () => {
    dir = mkdtempSync(join(tmpdir(), 'theoclaw-config-entry-'))
    const workspace = join(dir, 'work')
    mkdirSync(workspace)
    const configHome = join(dir, 'config')
    const env = { XDG_CONFIG_HOME: configHome }
    const path = configurationPath(env, dir)
    mkdirSync(dirname(path), { recursive: true })
    const token = randomBytes(24).toString('hex')
    writeFileSync(
      path,
      [
        'THEOCLAW_MODEL="stub"',
        `OPENROUTER_API_KEY="key-${randomBytes(8).toString('hex')}"`,
        'THEOCLAW_PORT="1"',
        `THEOCLAW_CONTROL_TOKEN="${token}"`,
        'THEOCLAW_OWNERS="telegram:owner"',
        'THEOCLAW_DM_POLICY="allowlist"',
        `THEOCLAW_WORKSPACE="${workspace}"`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    )
    // The same read the entry makes, so the test states what the file holds.
    const loaded: NodeJS.ProcessEnv = { ...env }
    expect(loadConfiguration(loaded, dir)).toBe(path)
    expect(loaded.THEOCLAW_PORT).toBe('1')

    let output = ''
    child = spawn(process.execPath, ['--import', TSX_LOADER, ENTRY], {
      cwd: dir,
      // THEOCLAW_PORT=0 in the environment wins over the file's port 1, which would need root.
      env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: configHome, THEOCLAW_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()))

    const [, port] = await waitForOutput(() => output, /control plane listening on 127\.0\.0\.1:(\d+)/, child)
    expect(Number(port)).toBeGreaterThan(1)
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)
    expect(output).not.toContain(token)
  })

  it('a file onboard wrote starts the entry with nothing else in the environment', { timeout: 45_000 }, async () => {
    dir = mkdtempSync(join(tmpdir(), 'theoclaw-onboard-entry-'))
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_STATE_HOME: join(dir, 'state'), KEY_VAR: `key-${randomBytes(8).toString('hex')}` }
    const path = await onboard(
      { yes: true, force: false, model: 'stub', apiKeyEnv: 'KEY_VAR', port: '0', owners: 'telegram:owner' },
      { env, homeDir: dir, stdin: new PassThrough(), stdout: new PassThrough(), isTTY: false },
    )

    let output = ''
    child = spawn(process.execPath, ['--import', TSX_LOADER, ENTRY], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, THEOCLAW_CONFIG: path },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()))

    const [, port] = await waitForOutput(() => output, /control plane listening on 127\.0\.0\.1:(\d+)/, child)
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)
    expect(output).not.toContain(env.KEY_VAR)
  })
})
