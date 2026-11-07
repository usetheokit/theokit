import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { type CliIo } from '../../src/cli.js'

const scratch: string[] = []

export function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-cli-'))
  scratch.push(dir)
  return dir
}
export interface Harness {
  readonly io: CliIo
  readonly signals: EventEmitter
  readonly stdout: () => string
  readonly stderr: () => string
}

export function harness(entry = '/nonexistent/main.js'): Harness {
  const dir = scratchDir()
  let out = ''
  let err = ''
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
  const signals = new EventEmitter()
  const io: CliIo = {
    env: { XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_STATE_HOME: join(dir, 'state') },
    homeDir: dir,
    stdin: new PassThrough(),
    stdout,
    stderr,
    isTTY: false,
    entry,
    signals,
    cwd: dir,
    platform: 'linux',
    nodePath: process.execPath,
    runner: () => Promise.reject(new Error('no command expected')),
  }
  return { io, signals, stdout: () => out, stderr: () => err }
}

export function processGroup(pid: number): string {
  return execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)]).toString().trim()
}

/** A stand-in for `dist/main.js` that logs its process group and each signal to the file it is given. */
export function stubEntry(): { h: Harness; log: string } {
  const dir = scratchDir()
  const entry = join(dir, 'entry.mjs')
  const log = join(dir, 'entry.log')
  writeFileSync(
    entry,
    [
      "import { appendFileSync } from 'node:fs'",
      "import { execFileSync } from 'node:child_process'",
      'const log = process.argv[2]',
      "process.on('SIGTERM', () => { appendFileSync(log, 'SIGTERM\\n'); process.exit(0) })",
      "process.on('SIGHUP', () => { appendFileSync(log, 'SIGHUP\\n'); process.exit(0) })",
      // A second SIGINT within 300 ms would log a second line, which is what the test counts.
      "process.on('SIGINT', () => { appendFileSync(log, 'shutdown SIGINT\\n'); setTimeout(() => process.exit(0), 300) })",
      "const group = execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)]).toString().trim()",
      'appendFileSync(log, `ready ${group}\\n`)',
      'setInterval(() => {}, 1000)',
      '',
    ].join('\n'),
  )
  return { h: harness(entry), log }
}

export async function waitForLog(log: string, pattern: RegExp): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
    const match = pattern.exec(text)
    if (match !== null) return match
    if (Date.now() > deadline) throw new Error(`no line matching ${pattern} in the entry's log within 10 s: ${text}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Removes every scratch directory made since the last call. */
export function cleanScratch(): void {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
}
