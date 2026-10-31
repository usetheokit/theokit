import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfiguration } from '../../src/config-file.js'
import { type DaemonIo, daemonInstall, daemonUninstall, runCommand, unitPath } from '../../src/daemon.js'
import { onboard } from '../../src/onboard.js'
import { type ControlTurn, runControlTurn } from './support/control-turn.js'

/**
 * OC-32 against a real model (B-374, T3.2): a real `systemd --user` unit on this host, installed by
 * `daemonInstall` from a file `onboard` wrote, answers one `/control` turn and is uninstalled. It
 * runs only with THEOCLAW_LIVE=1, a model key and a built entry: `pnpm --filter theoclaw run build`.
 * Each run uses a fresh profile `t<6 hex>`, so the unit, `~/.theokit/profiles/<profile>` and the
 * port are its own; `afterEach` removes all three even when the test fails.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const ENTRY = join(APP_DIR, 'dist', 'main.js')
const HOME = homedir()

interface Run {
  readonly profile: string
  readonly dir: string
  readonly io: DaemonIo
  readonly output: () => string
}

let run: Run | undefined

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new Error('no port from a socket bound to 0')
  return address.port
}

/** A scratch configuration file for a fresh profile, onboarded with `key`, and the io to install it. */
async function prepare(key: string): Promise<{ port: number; token: string }> {
  const profile = `t${randomBytes(3).toString('hex')}`
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-daemon-live-'))
  let output = ''
  const sink = new PassThrough()
  sink.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: join(dir, 'theoclaw.env'), THEOCLAW_PROFILE: profile, LIVE_KEY: key, USER: process.env.USER }
  const io: DaemonIo = { env, homeDir: HOME, cwd: dir, platform: process.platform, nodePath: process.execPath, entry: ENTRY, stdout: sink, stderr: sink }
  run = { profile, dir, io, output: () => output }
  const port = await freePort()
  await onboard(
    { yes: true, force: false, model: process.env.THEOCLAW_MODEL!, apiKeyEnv: 'LIVE_KEY', port: String(port), owners: 'telegram:owner' },
    { env, homeDir: HOME, stdin: new PassThrough(), stdout: sink, isTTY: false },
  )
  const written: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: env.THEOCLAW_CONFIG }
  loadConfiguration(written, HOME)
  return { port, token: written.THEOCLAW_CONTROL_TOKEN! }
}

async function waitForHealth(port: number, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    const status = await fetch(`http://127.0.0.1:${port}/health`).then(
      (response) => response.status,
      () => 0,
    )
    if (status === 200) return
    if (Date.now() > deadline) throw new Error(`GET /health on ${port} did not answer 200 within ${deadlineMs} ms: ${journal()}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

function journal(): string {
  if (run === undefined) return ''
  try {
    return execFileSync('journalctl', ['--user', '-u', `theoclaw-${run.profile}.service`, '--no-pager', '-o', 'cat'], { encoding: 'utf8' })
  } catch (error) {
    return `journalctl failed: ${String(error)}`
  }
}

/** Installs the unit and runs one turn; the turn's deadline counts from the moment `enable --now` returned. */
async function installAndTurn(port: number, token: string): Promise<ControlTurn & { sinceStartMs: number }> {
  expect(await daemonInstall(run!.io, runCommand), run!.output()).toBe(0)
  const startedAt = Date.now()
  await waitForHealth(port, 30_000)
  const turn = await runControlTurn(port, token, 'Reply with the single word: pong', 60_000 - (Date.now() - startedAt))
  return { ...turn, sinceStartMs: Date.now() - startedAt }
}

function expectAbsent(secret: string, what: string, captured: Record<string, string>): void {
  for (const [source, text] of Object.entries(captured)) {
    expect(text.includes(secret), `${what} appeared in ${source}`).toBe(false)
  }
}

afterEach(async () => {
  const current = run
  run = undefined
  if (current === undefined) return
  try {
    expect(await daemonUninstall(current.io, runCommand), current.output()).toBe(0)
    expect(existsSync(unitPath(`theoclaw-${current.profile}`, HOME))).toBe(false)
    const state = await runCommand('systemctl', ['--user', 'is-active', `theoclaw-${current.profile}.service`])
    expect(state.stdout.trim()).not.toBe('active')
  } finally {
    rmSync(join(HOME, '.theokit', 'profiles', current.profile), { recursive: true, force: true })
    rmSync(current.dir, { recursive: true, force: true })
  }
}, 30_000)

describe.skipIf(!LIVE)('TheoClaw as a systemd user unit against a real model', () => {
  it('a systemd user unit answers a real-model turn and uninstalls cleanly', { timeout: 120_000 }, async () => {
    const key = process.env.THEOKIT_API_KEY || process.env.OPENROUTER_API_KEY
    if (!process.env.THEOCLAW_MODEL || !key) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and OPENROUTER_API_KEY')
    if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing: run pnpm --filter theoclaw run build`)
    const { port, token } = await prepare(key)

    const turn = await installAndTurn(port, token)

    expect(turn.status, `${JSON.stringify(turn.frames)}\n${journal()}`).toBe('finished')
    expect(turn.text.trim().length).toBeGreaterThan(0)
    expect(turn.sinceStartMs).toBeLessThan(60_000)
    const captured = { 'command output': run!.output(), journal: journal(), turn: JSON.stringify(turn.frames) }
    expectAbsent(key, 'the model key', captured)
    expectAbsent(token, 'the control token', captured)
  })

  it('a key the provider refuses ends the turn with the provider error', { timeout: 120_000 }, async () => {
    if (!process.env.THEOCLAW_MODEL) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
    if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing: run pnpm --filter theoclaw run build`)
    const invalid = 'sk-or-v1-invalid-theoclaw-check'
    const { port, token } = await prepare(invalid)

    const turn = await installAndTurn(port, token)
    const log = journal()

    expect(turn.status).not.toBe('finished')
    expect(`${turn.error}\n${log}`).toMatch(/401|unauthori[sz]ed|invalid/i)
    expectAbsent(invalid, 'the invalid key', { 'command output': run!.output(), journal: log, turn: JSON.stringify(turn.frames) })
  })
})
