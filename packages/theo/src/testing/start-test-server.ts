import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { Agent, get as httpGet } from 'node:http'
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

interface Answer {
  status: number
  clientPort: number | undefined
  release: () => void
}

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

export interface ProcFs {
  readFileSync: (path: string, enc: 'utf8') => string
  readdirSync: (path: string) => string[]
  readlinkSync: (path: string) => string
}

/** The `inodes` that `pid` holds as open sockets, when it is in group `pgid`. */
export function socketsHeldBy(
  pid: string,
  pgid: number,
  inodes: Set<string>,
  fs: ProcFs = { readFileSync, readdirSync, readlinkSync },
): string[] {
  let fds: string[]
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    // After the ")" closing the command name: state, ppid, pgrp.
    if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2] !== String(pgid)) return []
    fds = fs.readdirSync(`/proc/${pid}/fd`)
  } catch {
    return [] // the process went away or is not ours to read
  }
  const held: string[] = []
  for (const fd of fds) {
    let target: string
    try {
      target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`)
    } catch {
      continue // this descriptor was closed since the listing; the others still count
    }
    const m = /^socket:\[(\d+)\]$/.exec(target)
    if (m?.[1] !== undefined && inodes.has(m[1])) held.push(m[1])
  }
  return held
}

type Listeners = 'none' | 'own' | 'foreign'

/** `identity` names the listening sockets (inodes, or pid and descriptor), so a rebind changes it. */
interface Ownership {
  owner: Listeners
  identity: string
  /** `proc`: sockets named by inode, a rebind changes `identity`. `tool`: lsof / netstat, it may not. */
  source: 'proc' | 'tool'
}

/**
 * Who listens on `port`, read from /proc: `own` when every listening socket (IPv4 and IPv6) is held
 * by the child's group, `foreign` when any is not, `none` when nothing listens.
 * `undefined` where /proc is unavailable (not Linux): ownership cannot be established there.
 */
function groupListensOn(port: number, pgid: number): Ownership | undefined {
  if (!existsSync('/proc/net/tcp')) return undefined
  const inodes = listeningInodes(port)
  if (inodes.size === 0) return { owner: 'none', identity: '', source: 'proc' }
  const held = new Set<string>()
  for (const pid of readdirSync('/proc')) {
    if (/^\d+$/.test(pid)) for (const i of socketsHeldBy(pid, pgid, inodes)) held.add(i)
  }
  const identity = [...inodes].sort((a, b) => a.localeCompare(b)).join(',')
  return {
    owner: [...inodes].every((i) => held.has(i)) ? 'own' : 'foreign',
    identity,
    source: 'proc',
  }
}

/** Runs a command and returns its stdout; throws when it cannot run or exits non-zero. */
export type RunCommand = (cmd: string, args: string[]) => string

const runCommand: RunCommand = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * The listeners on `port`: `lsof` on macOS and other POSIX, `netstat -ano` on Windows. `ids` tells the
 * sockets apart (`pid:fd` from lsof, the pid alone from netstat).
 */
function listeners(
  port: number,
  platform: NodeJS.Platform,
  run: RunCommand,
): { pids: number[]; ids: string[] } {
  if (platform === 'win32') {
    const pids: number[] = []
    for (const line of run('netstat', ['-ano', '-p', 'tcp']).split('\n')) {
      const col = line.trim().split(/\s+/)
      // Proto, Local Address, Foreign Address, State, PID
      if (col[3] === 'LISTENING' && (col[1] ?? '').endsWith(`:${String(port)}`)) {
        pids.push(Number(col[4]))
      }
    }
    return { pids, ids: pids.map(String) }
  }
  const out = runLsof(run, ['-nP', '-w', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpf'])
  const pids: number[] = []
  const ids: string[] = []
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pids.push(Number(line.slice(1)))
    else if (line.startsWith('f')) ids.push(`${String(pids.at(-1))}:${line.slice(1)}`)
  }
  return { pids, ids: ids.length > 0 ? ids : pids.map(String) }
}

/**
 * lsof exits 1 with no output and no message when nothing matches: that is an answer ("nobody").
 * Exit 1 with a message (or output) is an error, and says so rather than looking like "nobody".
 */
function runLsof(run: RunCommand, args: string[]): string {
  try {
    return run('lsof', args)
  } catch (err) {
    const e = err as { status?: number; stderr?: unknown; stdout?: unknown; message: string }
    const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
    if (e.status === 1 && text(e.stderr) === '' && text(e.stdout) === '') return ''
    const status = e.status === undefined ? '' : ` with status ${String(e.status)}`
    throw new Error(`lsof failed${status}: ${text(e.stderr) || e.message}`)
  }
}

/**
 * Pids holding the server side of the established connection from client port `clientPort` to `port`:
 * the process that really answered, whatever listened before or after.
 */
function connectionPids(
  port: number,
  clientPort: number,
  platform: NodeJS.Platform,
  run: RunCommand,
): number[] {
  const pids: number[] = []
  if (platform === 'win32') {
    for (const line of run('netstat', ['-ano', '-p', 'tcp']).split('\n')) {
      const col = line.trim().split(/\s+/)
      // Proto, Local Address, Foreign Address, State, PID
      if (
        col[3] === 'ESTABLISHED' &&
        (col[1] ?? '').endsWith(`:${String(port)}`) &&
        (col[2] ?? '').endsWith(`:${String(clientPort)}`)
      ) {
        pids.push(Number(col[4]))
      }
    }
    return pids
  }
  let pid = Number.NaN
  for (const line of runLsof(run, ['-nP', '-w', `-iTCP:${String(clientPort)}`, '-Fpn']).split(
    '\n',
  )) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    // The server side reads `local:port->peer:clientPort`; our own end reads the other way round.
    else if (line.startsWith('n') && line.includes(`:${String(port)}->`)) pids.push(pid)
  }
  return pids
}

/**
 * Who holds the connection a readiness answer came over (lsof / netstat platforms): this ties the
 * answer to a process, which a listener snapshot taken before and after the request cannot.
 * `none`: the connection is not visible (the server closed it).
 */
export function connectionOwnership(
  port: number,
  clientPort: number,
  childPid: number,
  probe: PortOwnerProbe = {},
): { owner: Listeners } | { owner: 'unknown'; reason: string } {
  const platform = probe.platform ?? process.platform
  const run = probe.run ?? runCommand
  try {
    const pids = connectionPids(port, clientPort, platform, run)
    if (pids.length === 0) return { owner: 'none' }
    return {
      owner: pids.every((p) => descendsFrom(p, childPid, platform, run)) ? 'own' : 'foreign',
    }
  } catch (err) {
    return {
      owner: 'unknown',
      reason: `cannot tell who answered on port ${String(port)} on ${platform}: ${(err as Error).message}`,
    }
  }
}

function parentPid(pid: number, platform: NodeJS.Platform, run: RunCommand): number {
  const out =
    platform === 'win32'
      ? run('powershell', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").ParentProcessId`,
        ])
      : run('ps', ['-o', 'ppid=', '-p', String(pid)])
  return Number(out.trim())
}

/** Whether `pid` is `root` or one of its descendants. */
function descendsFrom(pid: number, root: number, platform: NodeJS.Platform, run: RunCommand) {
  let cur = pid
  for (let depth = 0; depth < 32 && Number.isInteger(cur) && cur > 0; depth++) {
    if (cur === root) return true
    cur = parentPid(cur, platform, run)
  }
  return false
}

export interface PortOwnerProbe {
  platform?: NodeJS.Platform
  run?: RunCommand
}

/**
 * Who listens on `port`: `own` when every listener is the child or a descendant, `foreign` when any
 * is not, `none` when nothing listens.
 * Linux reads /proc; macOS and Windows ask lsof / netstat for the listening pids and walk their
 * parents up to the child. `unknown` carries why ownership could not be established: never treat
 * it as `own`.
 */
export function portOwnership(
  port: number,
  childPid: number,
  probe: PortOwnerProbe = {},
): Ownership | { owner: 'unknown'; reason: string } {
  const platform = probe.platform ?? process.platform
  if (probe.run === undefined && platform === 'linux') {
    const viaProc = groupListensOn(port, childPid)
    if (viaProc !== undefined) return viaProc
  }
  const run = probe.run ?? runCommand
  try {
    const { pids, ids } = listeners(port, platform, run)
    if (pids.length === 0) return { owner: 'none', identity: '', source: 'tool' }
    // Every listener counts: a foreign one on the other address family can answer `localhost` too.
    const all = pids.every((p) => descendsFrom(p, childPid, platform, run))
    return { owner: all ? 'own' : 'foreign', identity: ids.join(','), source: 'tool' }
  } catch (err) {
    const tool = platform === 'win32' ? 'netstat' : 'lsof'
    return {
      owner: 'unknown',
      reason: `cannot tell who listens on port ${String(port)} on ${platform}: ${tool} failed (${(err as Error).message})`,
    }
  }
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
    if (process.platform === 'win32' && child.pid !== undefined) {
      // No process groups: end the whole tree, synchronously, so no descendant outlives the child.
      try {
        runCommand('taskkill', ['/pid', String(child.pid), '/T', '/F'])
        return
      } catch {
        // taskkill failed: fall back to the child itself
      }
    }
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

  /** The readiness answer, with the client port of its connection (kept open until `release`). */
  const answers = (): Promise<Answer | undefined> =>
    new Promise((resolve) => {
      const agent = new Agent({ keepAlive: true })
      const release = (): void => {
        agent.destroy()
      }
      const req = httpGet(
        { host: 'localhost', port, path: '/__theo/ready', agent, timeout: 1000 },
        (res) => {
          const clientPort = res.socket.localPort
          res.once('error', () => {
            release()
            resolve(undefined)
          })
          res.once('end', () => {
            resolve({ status: res.statusCode ?? 0, clientPort, release })
          })
          res.resume()
        },
      )
      req.once('error', () => {
        release()
        resolve(undefined) // not listening yet
      })
      req.once('timeout', () => {
        req.destroy()
      })
    })

  /** Names the listeners when the child owns all of them; fails on a foreign or unknowable one. */
  const childListens = async (): Promise<Ownership | undefined> => {
    const own = child.pid === undefined ? undefined : portOwnership(port, child.pid)
    if (own?.owner === 'unknown') return await fail(own.reason)
    if (own?.owner === 'foreign') {
      return await fail(
        `port ${String(port)} was taken by another process before theokit ${mode} bound it`,
        PortSubstitutedError,
      )
    }
    if (own === undefined) return { owner: 'own', identity: '', source: 'proc' }
    return own.owner === 'own' ? own : undefined
  }

  while (Date.now() < deadline) {
    if (hasExited()) return await fail(`theokit ${mode} exited before it was ready`)
    // Checked on every poll, whatever the listener answers: a foreign server that returns 404 or
    // does not speak HTTP would otherwise make Vite bind another port while we wait for the deadline.
    const before = await childListens()
    // The answer counts only if the same listening sockets, all the child's, stood before and after
    // the request: a listener that was swapped, even for a moment, cannot have its 200 accepted.
    const answer = before === undefined ? undefined : await answers()
    if (before !== undefined && answer?.status === 200) {
      let accepted = false
      try {
        if (before.source === 'proc') {
          accepted = before.identity === (await childListens())?.identity
        } else if (answer.clientPort !== undefined && child.pid !== undefined) {
          // lsof / netstat cannot name sockets reliably: ask who holds the connection that answered.
          const conn = connectionOwnership(port, answer.clientPort, child.pid)
          if (conn.owner === 'unknown') return await fail(conn.reason)
          if (conn.owner === 'foreign') {
            return await fail(
              `port ${String(port)} was taken by another process before theokit ${mode} bound it`,
              PortSubstitutedError,
            )
          }
          accepted = conn.owner === 'own'
        }
      } finally {
        answer.release()
      }
      if (accepted) {
        if (hasExited()) return await fail(`theokit ${mode} exited before it was ready`)
        return { origin, pid: child.pid, output: () => output, close }
      }
    } else answer?.release()
    await sleep(250)
  }
  return await fail(`theokit ${mode} was not ready within ${String(timeoutMs)}ms`)
}
