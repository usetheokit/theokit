import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import {
  ENTRY,
  killInstance,
  startInstance,
  type StartedInstance,
  stopInstance,
  waitForListener,
  waitForStartLine,
} from './support/instance-process.js'

/**
 * B-514 (OC-28, profile half): two TheoClaw processes on one host, profiles `a` and `b`, one scratch
 * HOME and one working directory, each running one real-model turn on its own `/control` socket.
 * Only two processes can show the separation (`THEOKIT_HOME` is process-wide), and only this run
 * proves the order the process entry owns (plan D2). Runs with THEOCLAW_LIVE=1 and the model
 * settings in the environment; skipped otherwise. Build first: `pnpm --filter theoclaw run build`.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

function modelEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const variable of ['THEOCLAW_MODEL', 'THEOKIT_API_KEY', 'OPENROUTER_API_KEY']) {
    const value = process.env[variable]
    if (value !== undefined && value !== '') env[variable] = value
  }
  if (env.THEOCLAW_MODEL === undefined || (env.THEOKIT_API_KEY ?? env.OPENROUTER_API_KEY) === undefined) {
    throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
  }
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing: run pnpm --filter theoclaw run build`)
  // B-371: the start refuses an instance with no owner; nobody messages this one but the test.
  return { ...env, THEOCLAW_OWNERS: 'telegram:owner', THEOCLAW_DM_POLICY: 'allowlist', THEOCLAW_MDNS: 'off' }
}

/** Every regular file under `root`, as paths relative to it. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((path) => statSync(join(root, path)).isFile())
}

function filesHolding(root: string, marker: string, suffix: string): string[] {
  return filesUnder(root).filter((path) => path.endsWith(suffix) && readFileSync(join(root, path), 'utf8').includes(marker))
}

/** One chat turn on the instance's `/control` socket, resolved on its `done` frame. */
async function turn(instance: StartedInstance, message: string): Promise<void> {
  const socket = new WebSocket(`ws://127.0.0.1:${instance.port}/control`, { headers: { Authorization: `Bearer ${instance.token}` } })
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no done frame within 90000 ms on port ${instance.port}`)), 90_000)
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string; code?: string; message?: string }
        if (frame.type === 'done') {
          clearTimeout(timer)
          resolve()
        } else if (frame.type === 'error') {
          clearTimeout(timer)
          reject(new Error(`turn failed: ${frame.code ?? ''} ${frame.message ?? ''}`))
        }
      })
      socket.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      socket.send(JSON.stringify({ type: 'chat', message }))
    })
  } finally {
    socket.close()
  }
}

describe.skipIf(!LIVE)('several TheoClaw instances on one host', () => {
  const children: StartedInstance[] = []
  const scratch: string[] = []

  function temp(name: string): string {
    const dir = mkdtempSync(join(tmpdir(), `theoclaw-${name}-`))
    scratch.push(dir)
    return dir
  }

  afterEach(async () => {
    const failures: unknown[] = []
    for (const instance of children.splice(0)) {
      try {
        await killInstance(instance.child)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
    if (failures.length > 0) throw new AggregateError(failures, 'teardown could not stop every instance')
  })

  async function startBoth() {
    const env = modelEnv()
    const home = temp('home')
    const cwd = temp('cwd')
    const [a, b] = await Promise.all(['a', 'b'].map((profile) => startInstance({ profile, home, cwd, env })))
    children.push(a!, b!)
    const [lineA, lineB] = await Promise.all([waitForStartLine(a!, 'a'), waitForStartLine(b!, 'b')])
    await Promise.all([waitForListener(a!.child, a!.port, 'a'), waitForListener(b!.child, b!.port, 'b')])
    return { a: a!, b: b!, lineA, lineB, home, cwd }
  }

  it('two profiled instances keep separate state and report distinct labels on a real-model turn', async () => {
    const { a, b, lineA, lineB, home, cwd } = await startBoth()
    const ps = (instance: StartedInstance) => execFileSync('ps', ['-o', 'args=', '-p', String(instance.child.pid)]).toString().trim()
    const titles = [ps(a), ps(b)]

    const markers = { a: `marker-a-${randomUUID()}`, b: `marker-b-${randomUUID()}` }
    await turn(a, `Reply OK. ${markers.a}`)
    await turn(b, `Reply OK. ${markers.b}`)
    await Promise.all([stopInstance(a.child, 'a'), stopInstance(b.child, 'b')])

    const profiles = join(home, '.theokit', 'profiles')
    expect(lineA).toBe(`theoclaw-a: instance started, profile directory ${join(profiles, 'a')}`)
    expect(lineB).toBe(`theoclaw-b: instance started, profile directory ${join(profiles, 'b')}`)
    expect(titles[0]).toMatch(/^theoclaw-a/)
    expect(titles[1]).toMatch(/^theoclaw-b/)

    for (const [own, other] of [['a', 'b'], ['b', 'a']] as const) {
      const marker = markers[own]
      expect(filesHolding(join(profiles, own, 'projects'), marker, '.jsonl'), `${own}'s turn record`).not.toEqual([])
      expect(filesHolding(join(profiles, other), marker, ''), `${own}'s marker under ${other}`).toEqual([])
    }

    // B-378: each profile keeps its chat sessions in its own workspace, never in the shared cwd.
    for (const own of ['a', 'b'] as const) {
      const sessions = join(profiles, own, 'workspace', '.theoclaw')
      expect(statSync(sessions).mode & 0o777, `${own}'s chat session directory`).toBe(0o700)
    }
    expect(existsSync(join(cwd, '.theoclaw')), 'a .theoclaw in the shared working directory').toBe(false)

    const strays = filesUnder(join(home, '.theokit')).filter((path) => !/^profiles[/\\][ab][/\\]/.test(path.split(sep).join('/')))
    expect(strays, 'files under HOME/.theokit outside the two profiles').toEqual([])
    expect(existsSync(join(cwd, '.theokit')), 'a .theokit in the shared working directory').toBe(false)
  })

  it('fails naming the profile when an instance never writes its start line', async () => {
    const silent = await startInstance({
      profile: 'quiet',
      home: temp('home'),
      cwd: temp('cwd'),
      env: {},
      argv: ['-e', 'setInterval(() => {}, 1000)'],
    })
    children.push(silent)
    const started = Date.now()
    await expect(waitForStartLine(silent, 'quiet')).rejects.toThrow('instance quiet: no start line within 30000 ms')
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(30_000)
    expect(elapsed).toBeLessThan(33_000)
  })

  it('prints neither model key nor control token from either instance', async () => {
    const { a, b } = await startBoth()
    await turn(a, 'Reply OK.')
    await Promise.all([stopInstance(a.child, 'a'), stopInstance(b.child, 'b')])
    const output = a.output() + b.output()
    const secrets = [process.env.THEOKIT_API_KEY, process.env.OPENROUTER_API_KEY, a.token, b.token].filter(
      (value): value is string => value !== undefined && value !== '',
    )
    expect(secrets.length).toBeGreaterThanOrEqual(3)
    for (const secret of secrets) expect(output.includes(secret), 'a secret in the output').toBe(false)
  })
})
