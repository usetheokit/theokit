import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
  /** @internal Test hook: picks the port for each boot attempt. */
  pickPort?: () => Promise<number>
  /** @internal Test hook: the platform whose process-tree handling to use. Default process.platform. */
  platform?: NodeJS.Platform
  /** @internal Test hook: terminates a Windows process tree; resolves the exit code. Default taskkill. */
  killTree?: (pid: number) => Promise<number | null>
  /** @internal Test hook: pids of the descendants of a live pid, for the Windows tree tracking. Default: a process-table snapshot. */
  listDescendants?: (pid: number) => Promise<number[]>
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

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Descendants of `root` from a process-table snapshot (PowerShell; Windows only). Once the leader
 * exits its children are no longer reachable from it, so they are recorded while it is alive.
 * Best effort: a snapshot that cannot run yields nothing new.
 */
function snapshotDescendants(root: number): Promise<number[]> {
  return new Promise((resolve) => {
    const exe = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const cmd =
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    const ps = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    ps.stdout.on('data', (d: Buffer) => (out += d.toString()))
    ps.once('error', () => {
      resolve([])
    })
    ps.once('close', () => {
      const children = new Map<number, number[]>()
      for (const line of out.split(/\r?\n/)) {
        const m = /^(\d+)\s+(\d+)$/.exec(line.trim())
        if (m === null) continue
        const pid = Number(m[1])
        const ppid = Number(m[2])
        children.set(ppid, [...(children.get(ppid) ?? []), pid])
      }
      const found: number[] = []
      for (const queue = [root]; queue.length > 0; ) {
        for (const c of children.get(queue.pop() ?? 0) ?? []) {
          if (c !== root && !found.includes(c)) {
            found.push(c)
            queue.push(c)
          }
        }
      }
      resolve(found)
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

/**
 * Ends the leader and every descendant recorded while it lived (taskkill cannot walk the tree of a
 * leader that already exited), then confirms none of them is still running.
 */
async function killWindowsTree(
  rootPid: number | undefined,
  tracked: ReadonlySet<number>,
  mode: string,
  kill: (pid: number) => Promise<number | null>,
): Promise<void> {
  if (rootPid === undefined) return
  const pids = [rootPid, ...[...tracked].filter((p) => p !== rootPid)]
  for (const pid of pids) {
    const code = await kill(pid)
    // 128: no such process, i.e. already gone.
    if (code !== 0 && code !== 128) {
      throw new Error(
        `could not terminate theokit ${mode} process tree (pid ${String(pid)}, taskkill exit ${String(code)})`,
      )
    }
  }
  const until = Date.now() + GRACE_MS
  while (pids.some(pidAlive) && Date.now() < until) await sleep(25)
  const left = pids.filter(pidAlive)
  if (left.length > 0) {
    throw new Error(
      `theokit ${mode} process(es) ${left.join(', ')} still running after the process tree was terminated`,
    )
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
  const tracked = new Set<number>()
  const track = async (): Promise<void> => {
    if (platform !== 'win32' || child.pid === undefined || hasExited()) return
    for (const pid of await (options.listDescendants ?? snapshotDescendants)(child.pid)) {
      tracked.add(pid)
    }
  }
  let closing: ReturnType<TestServer['close']> | undefined
  const close: TestServer['close'] = () => {
    closing ??= (async () => {
      if (platform === 'win32') {
        await track()
        await killWindowsTree(child.pid, tracked, mode, options.killTree ?? taskkillTree)
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
    await track()
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
