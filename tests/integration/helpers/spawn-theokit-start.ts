import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const REPO = resolve(__dirname, '../../..')
// The local binaries by absolute path, never through PATH (sonarjs/no-os-command-from-path).
const TSX = resolve(REPO, 'node_modules/.bin/tsx')
const CLI = resolve(REPO, 'packages/theo/src/cli/index.ts')

export interface StartedTheokit {
  readonly origin: string
  /** Everything the process wrote to stdout and stderr so far. */
  output(): string
  /** SIGTERM, then resolve with how the process ended. */
  stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer()
    srv.once('error', fail)
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => {
        ok(port)
      })
    })
  })
}

async function waitForHealth(
  origin: string,
  child: ChildProcess,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`theokit start exited early:\n${log()}`)
    try {
      await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  throw new Error(`theokit start did not answer within 60s:\n${log()}`)
}

/**
 * Run `theokit start` from source (through tsx) in `cwd`, as a real process, and wait until its
 * built-in `/health` route answers. The CLI is the one under test, so the process is the unit:
 * signal handling, boot order and stdout are part of what is asserted.
 */
export async function spawnTheokitStart(cwd: string): Promise<StartedTheokit> {
  const port = await freePort()
  let output = ''
  const child = spawn(TSX, [CLI, 'start', '--port', String(port)], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (d: Buffer) => (output += d.toString()))
  child.stderr?.on('data', (d: Buffer) => (output += d.toString()))
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((ok) => {
    child.once('exit', (code, signal) => {
      ok({ code, signal })
    })
  })
  const origin = `http://localhost:${String(port)}`
  try {
    await waitForHealth(origin, child, () => output)
  } catch (err) {
    child.kill('SIGKILL')
    throw err
  }
  return {
    origin,
    output: () => output,
    stop: () => {
      child.kill('SIGTERM')
      return exited
    },
  }
}
