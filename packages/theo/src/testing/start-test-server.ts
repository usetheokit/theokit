import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'

/** pid -> parent pid and a start stamp: a pid with another stamp is a different, reused, process. */
export type ProcTable = Map<number, { ppid: number; started: string }>

export interface StartTestServerOptions {
  /** The app's root (where theo.config.ts and node_modules/theokit live). */
  cwd: string
  /** 'dev' (default) or 'start'. 'start' expects a prior `theokit build`. */
  mode?: 'dev' | 'start'
  /** Extra env for the child; merged over process.env. */
  env?: Record<string, string>
  /** Boot deadline. Default 60_000. */
  timeoutMs?: number
  /** @internal Test hook: picks the port for each boot attempt. */
  pickPort?: () => Promise<number>
  /** @internal Test hook: the platform whose process-tree handling to use. Default process.platform. */
  platform?: NodeJS.Platform
  /** @internal Test hook: terminates a Windows process tree; resolves the exit code. Default taskkill. */
  killTree?: (pid: number) => Promise<number | null>
  /** @internal Test hook: the process table (pid -> parent, start stamp) for the Windows tree tracking; `root` is the child's pid. Default: a PowerShell snapshot. */
  processTable?: (root: number) => Promise<ProcTable>
  /** @internal Test hook: bound on one process-table snapshot. Default 10_000. */
  snapshotTimeoutMs?: number
  /** @internal Test hook: the port the child is told to bind, given the one the helper checks. Default: the same. */
  childPort?: (picked: number) => number
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

/** The child's output says its own bind failed because the port was already in use. */
const BIND_CONFLICT = /EADDRINUSE|address already in use|Port \d+ is already in use/i

const READY_TOKEN_HEADER = 'x-theokit-ready-token'

/** `taskkill /T /F`: ends the pid and every descendant. Resolves its exit code (null when it could not run). */
function taskkillTree(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    // An absolute path, so a writable PATH entry cannot stand in for it.
    const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const tk = spawn(exe, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    tk.once('error', () => {
      resolve(null)
    })
    tk.once('exit', (code) => {
      resolve(code)
    })
  })
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

/** Whether a listener on `port` exists that no process of the child's group holds (Linux only). */
function foreignListener(port: number, pgid: number): boolean {
  if (!existsSync('/proc/net/tcp')) return false
  const inodes = listeningInodes(port)
  if (inodes.size === 0) return false
  return !readdirSync('/proc').some((pid) => /^\d+$/.test(pid) && holdsSocket(pid, pgid, inodes))
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

/** A process snapshot that cannot be trusted as the whole table. */
export class ProcessSnapshotError extends Error {
  constructor(
    readonly pid: number,
    detail: string,
  ) {
    super(`process snapshot for pid ${String(pid)} rejected: ${detail}`)
    this.name = 'ProcessSnapshotError'
  }
}

/** @internal Parses PowerShell output into a table; rejects stderr output and any row that is not three integers. */
export function parseProcessSnapshot(pid: number, out: string, err: string): ProcTable {
  if (err.trim() !== '') throw new ProcessSnapshotError(pid, `stderr: ${err.trim().slice(0, 300)}`)
  const table: ProcTable = new Map()
  for (const line of out.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const m = /^(\d+)\s+(\d+)\s+(-?\d+)$/.exec(line.trim())
    if (m === null) throw new ProcessSnapshotError(pid, `malformed row ${JSON.stringify(line)}`)
    table.set(Number(m[1]), { ppid: Number(m[2]), started: m[3] })
  }
  return table
}

/** The process table from PowerShell (Windows only); rejects when it fails, is incomplete, or runs past `timeoutMs`. */
function snapshotProcesses(root: number, timeoutMs: number): Promise<ProcTable> {
  return new Promise((resolve, reject) => {
    const exe = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const cmd =
      '$ErrorActionPreference=\'Stop\'; Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.ToFileTimeUtc())" }'
    const ps = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    })
    let out = ''
    let err = ''
    ps.stdout.on('data', (d: Buffer) => (out += d.toString()))
    ps.stderr.on('data', (d: Buffer) => (err += d.toString()))
    ps.once('error', reject)
    ps.once('close', (code) => {
      if (code !== 0) {
        const detail = err.trim() === '' ? '' : `: ${err.trim()}`
        reject(new ProcessSnapshotError(root, `exit ${String(code)}${detail}`))
        return
      }
      try {
        resolve(parseProcessSnapshot(root, out, err))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} timed out after ${String(ms)}ms`))
    }, ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
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

/**
 * Tracks the child's tree by process identity (pid + start stamp) while the leader lives, because
 * taskkill cannot walk the tree of a leader that already exited and a bare pid may be reused.
 * `terminate` ends only processes still matching their recorded identity and confirms they are gone.
 */
function createTreeTracker(
  rootPid: number,
  table: () => Promise<ProcTable>,
  kill: (pid: number) => Promise<number | null>,
  mode: string,
) {
  const tracked = new Map<number, string>()
  const observe = (t: ProcTable): void => {
    const root = t.get(rootPid)
    if (root !== undefined && !tracked.has(rootPid)) tracked.set(rootPid, root.started)
    // Walk from every tracked pid, so descendants of an already-reparented branch are found too.
    const queue = [rootPid, ...tracked.keys()]
    for (let pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
      for (const [cpid, c] of t) {
        if (c.ppid === pid && cpid !== rootPid && !tracked.has(cpid)) {
          tracked.set(cpid, c.started)
          queue.push(cpid)
        }
      }
    }
    // Gone, or the pid now belongs to another process: never target it.
    for (const [pid, started] of tracked) if (t.get(pid)?.started !== started) tracked.delete(pid)
  }
  const live = (t: ProcTable): number[] =>
    [...tracked].filter(([pid, started]) => t.get(pid)?.started === started).map(([pid]) => pid)
  return {
    async track(): Promise<void> {
      observe(await table())
    },
    /** `leaderRunning`: the child handle itself proves the leader's identity when no snapshot works. */
    async terminate(leaderRunning: boolean): Promise<void> {
      let t: ProcTable
      try {
        t = await table()
      } catch (err) {
        if (leaderRunning) await kill(rootPid)
        throw new Error(
          `could not confirm theokit ${mode} process tree is gone: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      if (leaderRunning && !t.has(rootPid)) {
        // The handle says the leader lives: a table without it is incomplete, not "tree gone".
        await kill(rootPid)
        throw new Error(
          `could not confirm theokit ${mode} process tree is gone: ${new ProcessSnapshotError(rootPid, 'table lacks the running root pid').message}`,
        )
      }
      observe(t)
      const targets = live(t)
      const failed: string[] = []
      for (const pid of targets) {
        const code = await kill(pid)
        // 128: no such process, i.e. already gone.
        if (code !== 0 && code !== 128)
          failed.push(`${String(pid)} (taskkill exit ${String(code)})`)
      }
      if (failed.length > 0) {
        throw new Error(`could not terminate theokit ${mode} process tree: ${failed.join(', ')}`)
      }
      const until = Date.now() + GRACE_MS
      let left = targets
      while (left.length > 0) {
        left = live(await table()).filter((p) => targets.includes(p))
        if (left.length === 0 || Date.now() > until) break
        await sleep(100)
      }
      if (left.length > 0) {
        throw new Error(
          `theokit ${mode} process(es) ${left.join(', ')} still running after the process tree was terminated`,
        )
      }
    },
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
  const port = await (options.pickPort ?? freePort)()
  const origin = `http://localhost:${String(port)}`
  const token = randomUUID()
  const platform = options.platform ?? process.platform
  let output = ''
  let spawnError: Error | undefined
  const child = spawn(
    process.execPath,
    [bin, mode, '--port', String((options.childPort ?? ((p) => p))(port))],
    {
      cwd,
      env: { ...process.env, ...options.env, THEOKIT_TEST_READY_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  )
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
  const snapMs = options.snapshotTimeoutMs ?? 10_000
  const tree =
    platform === 'win32' && child.pid !== undefined
      ? createTreeTracker(
          child.pid,
          () =>
            withTimeout(
              (options.processTable ?? (() => snapshotProcesses(child.pid ?? 0, snapMs)))(
                child.pid ?? 0,
              ),
              snapMs,
              'process snapshot',
            ),
          options.killTree ?? taskkillTree,
          mode,
        )
      : undefined
  let closing: ReturnType<TestServer['close']> | undefined
  const close: TestServer['close'] = () => {
    closing ??= (async () => {
      if (platform === 'win32') {
        await tree?.terminate(!hasExited())
        return ended
      }
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
    let cleanup = ''
    try {
      await close()
    } catch (err) {
      // Not retryable: descendants may still run. Say so rather than hide it behind the boot error.
      cleanup = `; cleanup failed: ${err instanceof Error ? err.message : String(err)}`
      throw new TestServerBootError(`${message}${cleanup}`, output)
    }
    throw new Err(spawnError === undefined ? message : `${message}: ${spawnError.message}`, output)
  }

  // The child's own bind failure (strict port) means another process holds the port.
  const exitedFailure = async (): Promise<never> =>
    BIND_CONFLICT.test(output)
      ? fail(
          `port ${String(port)} was taken by another process before theokit ${mode} bound it`,
          PortSubstitutedError,
        )
      : fail(`theokit ${mode} exited before it was ready`)
  let foreignAnswer = false

  while (Date.now() < deadline) {
    if (hasExited()) return await exitedFailure()
    // Independent of the readiness answer: a foreign listener may reply 404, refuse, or not speak HTTP.
    if (platform === 'linux' && child.pid !== undefined && foreignListener(port, child.pid)) {
      return await fail(
        `port ${String(port)} was taken by another process before theokit ${mode} bound it`,
        PortSubstitutedError,
      )
    }
    if (tree !== undefined && !hasExited()) {
      try {
        await tree.track()
      } catch (err) {
        return await fail(
          `could not enumerate theokit ${mode} processes: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    let ready = false
    try {
      const res = await fetch(`${origin}/__theo/ready`, { signal: AbortSignal.timeout(1000) })
      // Only this attempt's child knows the token: a 200 without it is another server's.
      ready = res.status === 200 && res.headers.get(READY_TOKEN_HEADER) === token
      // Our child always sends the token: a 200 without it is a foreign server, retry elsewhere.
      if (res.status === 200 && !ready) foreignAnswer = true
    } catch {
      // not listening yet: only fetch errors are swallowed here
    }
    if (foreignAnswer) {
      return await fail(
        `port ${String(port)} was answered by another server, not theokit ${mode}`,
        PortSubstitutedError,
      )
    }
    if (ready) {
      if (hasExited()) return await exitedFailure()
      // Any server on the port can answer: only a listener held by the child's own group counts.
      if (
        platform === 'linux' &&
        child.pid !== undefined &&
        groupListensOn(port, child.pid) === false
      ) {
        return await fail(
          `port ${String(port)} was taken by another process before theokit ${mode} bound it`,
          PortSubstitutedError,
        )
      }
      return { origin, pid: child.pid, output: () => output, close }
    }
    await sleep(250)
  }
  return await fail(`theokit ${mode} was not ready within ${String(timeoutMs)}ms`)
}
