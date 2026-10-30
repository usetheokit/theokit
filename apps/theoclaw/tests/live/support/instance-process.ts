import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Spawns built TheoClaw processes for the instance-profiles live test (B-514) and waits on what
 * they report. Every wait is a condition with a deadline (`rules/testing.md` § 3); nothing sleeps
 * before an assertion.
 */
export const ENTRY = join(fileURLToPath(new URL('../../..', import.meta.url)), 'dist', 'main.js')

export interface StartedInstance {
  readonly child: ChildProcess
  readonly port: number
  readonly token: string
  /** Everything the child wrote to stdout and stderr so far. */
  readonly output: () => string
}

export interface InstanceOptions {
  readonly profile: string
  readonly home: string
  readonly cwd: string
  /** The model settings and any variable the start requires; no platform variable. */
  readonly env: Readonly<Record<string, string>>
  /** The command spawned; the built entry by default. */
  readonly argv?: readonly string[]
}

/** A port nothing listens on now, read from a socket bound to 0 and closed. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new Error('no port from a socket bound to 0')
  return address.port
}

export async function startInstance(options: InstanceOptions): Promise<StartedInstance> {
  const port = await freePort()
  const token = randomBytes(24).toString('base64url')
  const child = spawn(process.execPath, [...(options.argv ?? [ENTRY])], {
    cwd: options.cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: options.home,
      ...options.env,
      THEOCLAW_PROFILE: options.profile,
      THEOCLAW_PORT: String(port),
      THEOCLAW_CONTROL_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()))
  return { child, port, token, output: () => output }
}

/**
 * The start line `theoclaw-<profile>: instance started…`, read from what the child already wrote,
 * so a line written before this call is not missed; rejects naming the profile at the deadline or
 * when the child exits first.
 */
export async function waitForStartLine(instance: StartedInstance, profile: string, deadlineMs = 30_000): Promise<string> {
  const deadline = Date.now() + deadlineMs
  const prefix = `theoclaw-${profile}: instance started`
  for (;;) {
    const line = instance.output().split('\n').find((candidate) => candidate.startsWith(prefix))
    if (line !== undefined) return line
    const { child } = instance
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`instance ${profile}: exited before its start line`)
    if (Date.now() >= deadline) throw new Error(`instance ${profile}: no start line within ${deadlineMs} ms`)
    // The poll interval of a condition wait with a deadline.
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function connects(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** Resolves once `port` accepts a connection; the start line is written before the listener binds. */
export async function waitForListener(child: ChildProcess, port: number, profile: string, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    if (await connects(port)) return
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`instance ${profile}: exited before its listener on ${port}`)
    if (Date.now() > deadline) throw new Error(`instance ${profile}: listener on ${port} not ready within ${deadlineMs} ms`)
    // The poll interval of a condition wait with a deadline, not a guess at how long the start takes.
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function closed(child: ChildProcess, deadlineMs: number, what: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.stdout?.closed !== false && child.stderr?.closed !== false) return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: not closed within ${deadlineMs} ms`)), deadlineMs)
    child.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** SIGTERM, then the `close` event, emitted once stdout and stderr have closed, so the output is complete. */
export function stopInstance(child: ChildProcess, profile: string, deadlineMs = 10_000): Promise<void> {
  const done = closed(child, deadlineMs, `instance ${profile}`)
  child.kill('SIGTERM')
  return done
}

/** Teardown: a child still alive gets SIGTERM, then SIGKILL after the deadline, and is awaited. */
export async function killInstance(child: ChildProcess, deadlineMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    await stopInstance(child, 'teardown', deadlineMs)
  } catch {
    // The shutdown ignores repeated signals while it stops; SIGKILL cannot be ignored.
    const done = closed(child, deadlineMs, 'teardown after SIGKILL')
    child.kill('SIGKILL')
    await done
  }
}
