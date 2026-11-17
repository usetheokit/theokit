import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'

export interface StartTestServerOptions {
  /** The app's root (where theo.config.ts and node_modules/theokit live). */
  cwd: string
  /** 'dev' (default) or 'start'. 'start' expects a prior `theokit build`. */
  mode?: 'dev' | 'start'
  /** Extra env for the child; merged over process.env. */
  env?: Record<string, string>
  /** Boot deadline. Default 60_000. */
  timeoutMs?: number
}

export interface TestServer {
  /** e.g. http://localhost:43127 */
  readonly origin: string
  /** The child's pid (also its process-group id on POSIX). */
  readonly pid: number | undefined
  /** Everything the child wrote to stdout and stderr so far. */
  output(): string
  /** SIGTERM the whole process group, SIGKILL after a grace period; idempotent. */
  close(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

/** The child exited or the deadline passed before the server answered. Carries the child's output. */
export class TestServerBootError extends Error {
  readonly output: string
  constructor(message: string, output: string) {
    super(`${message}\n--- child output ---\n${output}`)
    this.name = 'TestServerBootError'
    this.output = output
  }
}

const GRACE_MS = 5000
const PORT_ATTEMPTS = 3

/** The port was taken by another process between picking it and the child binding it. */
class PortSubstitutedError extends TestServerBootError {}

/** Inodes of the sockets listening on `port`, from /proc/net/tcp and tcp6 (state 0A is LISTEN). */
function listeningInodes(port: number): Set<string> {
  const inodes = new Set<string>()
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      // no IPv6 table
    }
    for (const line of text.split('\n').slice(1)) {
      const col = line.trim().split(/\s+/)
      const local = Number.parseInt(col[1]?.split(':')[1] ?? '', 16)
      if (col[3] === '0A' && local === port) inodes.add(col[9])
    }
  }
  return inodes
}

/** Whether `pid` is in group `pgid` and holds one of `inodes` as an open socket. */
function holdsSocket(pid: string, pgid: number, inodes: Set<string>): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // After the ")" closing the command name: state, ppid, pgrp.
    if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2] !== String(pgid)) return false
    return readdirSync(`/proc/${pid}/fd`).some((fd) => {
      const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`))
      return m?.[1] !== undefined && inodes.has(m[1])
    })
  } catch {
    return false // the process went away or is not ours to read
  }
}

/**
 * Whether a process of the child's group holds the listening socket on `port`, read from /proc.
 * `undefined` where /proc is unavailable (not Linux): ownership cannot be established there.
 */
function groupListensOn(port: number, pgid: number): boolean | undefined {
  if (!existsSync('/proc/net/tcp')) return undefined
  const inodes = listeningInodes(port)
  if (inodes.size === 0) return false
  return readdirSync('/proc').some((pid) => /^\d+$/.test(pid) && holdsSocket(pid, pgid, inodes))
}

function resolveTheokitBin(cwd: string): string {
  const req = createRequire(join(cwd, 'package.json'))
  let pkgPath: string
  try {
    pkgPath = req.resolve('theokit/package.json')
  } catch {
    throw new Error(`theokit not found from ${cwd}. Run: npm install -D theokit`)
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.theokit
  if (rel === undefined) throw new Error('theokit has no "theokit" bin in its package.json')
  return resolve(dirname(pkgPath), rel)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => {
        resolve(port)
      })
    })
  })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

function groupAlive(child: ChildProcess): boolean {
  if (process.platform === 'win32' || child.pid === undefined) return false
  try {
    process.kill(-child.pid, 0)
    return true
  } catch {
    return false
  }
}

/** Resolves true once the whole group is gone, false when `ms` passes first. */
async function groupGone(child: ChildProcess, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (groupAlive(child)) {
    if (Date.now() > until) return false
    await sleep(25)
  }
  return true
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // already gone
  }
}

export async function startTestServer(options: StartTestServerOptions): Promise<TestServer> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs
  const cwd = resolve(options.cwd)
  const bin = resolveTheokitBin(cwd)
  for (let attempt = 1; ; attempt++) {
    try {
      return await bootOnce(options, cwd, bin, deadline, timeoutMs)
    } catch (err) {
      // The port is only free when picked, not reserved: retry on another one.
      if (!(err instanceof PortSubstitutedError) || attempt >= PORT_ATTEMPTS) throw err
    }
  }
}

async function bootOnce(
  options: StartTestServerOptions,
  cwd: string,
  bin: string,
  deadline: number,
  timeoutMs: number,
): Promise<TestServer> {
  const mode = options.mode ?? 'dev'
  const port = await freePort()
  const origin = `http://localhost:${String(port)}`
  let output = ''
  let spawnError: Error | undefined
  const child = spawn(process.execPath, [bin, mode, '--port', String(port)], {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  child.stdout.on('data', (d: Buffer) => (output += d.toString()))
  child.stderr.on('data', (d: Buffer) => (output += d.toString()))
  let exited = false
  const hasExited = (): boolean => exited
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    // A failed spawn emits `error` and need not emit `exit`: settle on either.
    child.once('error', (err) => {
      spawnError = err
      exited = true
      resolve({ code: null, signal: null })
    })
    child.once('exit', (code, signal) => {
      exited = true
      resolve({ code, signal })
    })
  })
  let closing: ReturnType<TestServer['close']> | undefined
  const close: TestServer['close'] = () => {
    closing ??= (async () => {
      if (!exited || groupAlive(child)) {
        signalGroup(child, 'SIGTERM')
        // The leader can exit before its descendants: wait for the whole group, then escalate.
        if (!(await groupGone(child, GRACE_MS))) {
          signalGroup(child, 'SIGKILL')
          await groupGone(child, GRACE_MS)
        }
      }
      return ended
    })()
    return closing
  }

  const fail = async (
    message: string,
    Err: typeof TestServerBootError = TestServerBootError,
  ): Promise<never> => {
    await close()
    throw new Err(spawnError === undefined ? message : `${message}: ${spawnError.message}`, output)
  }

  while (Date.now() < deadline) {
    if (hasExited()) return await fail(`theokit ${mode} exited before it was ready`)
    try {
      const res = await fetch(`${origin}/__theo/ready`, { signal: AbortSignal.timeout(1000) })
      if (res.status === 200) {
        if (hasExited()) return await fail(`theokit ${mode} exited before it was ready`)
        // Any server on the port can answer: only a listener held by the child's own group counts.
        if (child.pid !== undefined && groupListensOn(port, child.pid) === false) {
          return await fail(
            `port ${String(port)} was taken by another process before theokit ${mode} bound it`,
            PortSubstitutedError,
          )
        }
        return { origin, pid: child.pid, output: () => output, close }
      }
    } catch {
      // not listening yet
    }
    await sleep(250)
  }
  return await fail(`theokit ${mode} was not ready within ${String(timeoutMs)}ms`)
}
