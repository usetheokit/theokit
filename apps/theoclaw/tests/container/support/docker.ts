import { spawn, spawnSync } from 'node:child_process'

/**
 * `docker` for the container checks (B-374, T5.2). Every call has a deadline and keeps its raw
 * stdout and stderr in memory, before the workflow's redactor sees anything, so a check can assert
 * that no secret was printed by any command it ran (NFR-004).
 */
export interface DockerResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly elapsedMs: number
}

export interface Capture {
  readonly command: string
  readonly output: string
}

export class Docker {
  readonly captures: Capture[] = []

  /** Fails naming `docker` when the CLI or its daemon is missing, rather than skipping green. */
  static require(): Docker {
    const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' })
    if (probe.error !== undefined || probe.status !== 0) {
      throw new Error(`THEOCLAW_CONTAINER=1 needs docker and a running daemon: ${probe.error?.message ?? probe.stderr}`)
    }
    return new Docker()
  }

  /**
   * Runs `docker <args>` and resolves when it exits or `deadlineMs` passes (then it is killed and
   * `code` is null). `capture: false` keeps the output out of `captures`, for a read of a secret.
   */
  run(args: readonly string[], deadlineMs: number, options: { capture?: boolean; input?: string; cwd?: string } = {}): Promise<DockerResult> {
    const started = Date.now()
    const child = spawn('docker', [...args], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env, cwd: options.cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.stdin.end(options.input ?? '')
    return new Promise((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), deadlineMs)
      child.once('close', (code) => {
        clearTimeout(timer)
        const label = `docker ${args.slice(0, 3).join(' ')}`
        if (options.capture !== false) this.captures.push({ command: label, output: `${stdout}\n${stderr}` })
        resolve({ code, stdout, stderr, elapsedMs: Date.now() - started })
      })
    })
  }

  /** The commands whose captured output contains `secret`, by label; the secret itself is never returned. */
  leaks(secret: string): string[] {
    if (secret === '') return []
    return this.captures.filter((capture) => capture.output.includes(secret)).map((capture) => capture.command)
  }
}

/** Polls `check` until it answers true, failing at the deadline with `what` named. */
export async function waitUntil(check: () => Promise<boolean>, deadlineMs: number, what: string): Promise<void> {
  const deadline = Date.now() + deadlineMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`${what} within ${deadlineMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/**
 * A `/control` turn client run inside a container by `node`, from a directory where `ws` resolves
 * (the installed checkout's `apps/theoclaw`). It waits for `/health`, sends one prompt and prints
 * one JSON line: status, the reply's first 200 characters, and when the turn finished.
 */
export const TURN_CLIENT = `
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import WebSocket from 'ws'
const [port, configPath, deadlineAt] = process.argv.slice(1)
const config = parseEnv(readFileSync(configPath, 'utf8'))
const deadline = Number(deadlineAt)
const out = (result) => { process.stdout.write(JSON.stringify(result) + '\\n'); process.exit(0) }
for (;;) {
  const ok = await fetch('http://127.0.0.1:' + port + '/health').then((r) => r.status === 200, () => false)
  if (ok) break
  if (Date.now() > deadline) out({ status: 'timeout', text: '', finishedAt: Date.now(), error: 'no /health' })
  await new Promise((r) => setTimeout(r, 200))
}
const socket = new WebSocket('ws://127.0.0.1:' + port + '/control', { headers: { Authorization: 'Bearer ' + config.THEOCLAW_CONTROL_TOKEN } })
let text = ''
const errors = []
socket.on('message', (raw) => {
  const frame = JSON.parse(String(raw))
  if (frame.type === 'event' && frame.event.type === 'text_delta' && typeof frame.event.content === 'string') text += frame.event.content
  if (frame.type === 'event' && frame.event.type === 'error') errors.push(frame.event)
  if (frame.type === 'done') out({ status: 'finished', text: text.slice(0, 200), finishedAt: Date.now(), error: '' })
  if (frame.type === 'error') out({ status: 'failed', text: text.slice(0, 200), finishedAt: Date.now(), error: JSON.stringify([...errors, frame]) })
})
socket.on('open', () => socket.send(JSON.stringify({ type: 'chat', message: 'Reply with the single word: pong' })))
socket.on('error', (error) => out({ status: 'failed', text: '', finishedAt: Date.now(), error: String(error) }))
setTimeout(() => out({ status: 'timeout', text: text.slice(0, 200), finishedAt: Date.now(), error: 'no final frame' }), Math.max(0, deadline - Date.now()))
`

export interface ContainerTurn {
  readonly status: 'finished' | 'failed' | 'timeout'
  readonly text: string
  readonly finishedAt: number
  readonly error: string
}

export function parseTurn(result: DockerResult): ContainerTurn {
  const line = result.stdout.trim().split('\n').at(-1) ?? ''
  try {
    return JSON.parse(line) as ContainerTurn
  } catch {
    return { status: 'failed', text: '', finishedAt: Date.now(), error: `the turn client printed no result (exit ${result.code}): ${result.stderr.slice(0, 500)}` }
  }
}
