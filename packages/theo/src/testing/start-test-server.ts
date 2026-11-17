import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    // already gone
  }
}

/**
 * Start the app's own `theokit dev|start` as a real process on a free port and resolve once
 * `/__theo/ready` answers 200.
 */
export async function startTestServer(options: StartTestServerOptions): Promise<TestServer> {
  const { cwd, mode = 'dev', timeoutMs = 60_000 } = options
  const bin = resolveTheokitBin(cwd)
  const port = await freePort()
  const origin = `http://localhost:${String(port)}`
  let output = ''
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
    child.once('exit', (code, signal) => {
      exited = true
      resolve({ code, signal })
    })
  })
  let closing: ReturnType<TestServer['close']> | undefined
  const close: TestServer['close'] = () => {
    closing ??= (async () => {
      if (!exited) {
        signalGroup(child, 'SIGTERM')
        const timer = setTimeout(() => {
          signalGroup(child, 'SIGKILL')
        }, GRACE_MS)
        const result = await ended
        clearTimeout(timer)
        // The leader may exit before the rest of the group; make sure none is left.
        signalGroup(child, 'SIGKILL')
        return result
      }
      signalGroup(child, 'SIGKILL')
      return ended
    })()
    return closing
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hasExited()) {
      await close()
      throw new TestServerBootError(`theokit ${mode} exited before it was ready`, output)
    }
    try {
      const res = await fetch(`${origin}/__theo/ready`, { signal: AbortSignal.timeout(1000) })
      if (res.status === 200) {
        return { origin, pid: child.pid, output: () => output, close }
      }
    } catch {
      // not listening yet
    }
    await sleep(250)
  }
  await close()
  throw new TestServerBootError(
    `theokit ${mode} was not ready within ${String(timeoutMs)}ms`,
    output,
  )
}
