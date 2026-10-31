import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { type CliIo, runCli } from '../src/cli.js'
import { loadConfiguration } from '../src/config-file.js'

const scratch: string[] = []

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-cli-'))
  scratch.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the theoclaw command line', () => {
  it('start loads the configuration file without overwriting the environment', () => {
    const dir = scratchDir()
    const path = join(dir, 'theoclaw.env')
    const unset = `THEOCLAW_CLI_TEST_${process.pid}`
    writeFileSync(path, `THEOCLAW_MODEL="from-file"\n${unset}="loaded"\n`)
    const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path, THEOCLAW_MODEL: 'from-env' }

    loadConfiguration(env, dir)

    expect(env.THEOCLAW_MODEL).toBe('from-env')
    expect(env[unset]).toBe('loaded')
    expect(process.env[unset]).toBeUndefined()
  })

  it('help names start, onboard and help, and an undefined one exits 2', async () => {
    const help = harness()
    expect(await runCli(['--help'], help.io)).toBe(0)
    for (const name of ['start', 'onboard', '--help']) expect(help.stdout()).toContain(name)
    expect(help.stderr()).toBe('')

    const unknown = harness()
    expect(await runCli(['frobnicate'], unknown.io)).toBe(2)
    expect(unknown.stderr()).toContain('theoclaw start')
    expect(unknown.stdout()).toBe('')

    const none = harness()
    expect(await runCli([], none.io)).toBe(2)
  })

  it('a refused subcommand prints its message and exits 1', async () => {
    const h = harness()
    expect(await runCli(['onboard'], h.io)).toBe(1)
    expect(h.stderr()).toMatch(/^theoclaw: .*--yes/m)

    const badFlag = harness()
    expect(await runCli(['onboard', '--no-such-flag'], badFlag.io)).toBe(2)
  })

  it('start runs the built entry and forwards SIGTERM', { timeout: 20_000 }, async () => {
    const { h, log } = stubEntry()
    const done = runCli(['start', log], h.io)
    await waitForLog(log, /^ready /m)
    h.signals.emit('SIGTERM', 'SIGTERM')

    expect(await done).toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/^SIGTERM$/m)
  })

  it('a terminal interrupt stops the entry once', { timeout: 20_000 }, async () => {
    const { h, log } = stubEntry()
    const done = runCli(['start', log], h.io)
    const [, childGroup] = (await waitForLog(log, /^ready (\d+)$/m))
    // The entry runs in its own process group, so a terminal's SIGINT, sent to the foreground
    // group, reaches only this command, which forwards it once.
    expect(childGroup).not.toBe(processGroup(process.pid))
    h.signals.emit('SIGINT', 'SIGINT')

    expect(await done).toBe(0)
    expect(readFileSync(log, 'utf8').match(/^shutdown/gm)).toHaveLength(1)
  })
})

interface Harness {
  readonly io: CliIo
  readonly signals: EventEmitter
  readonly stdout: () => string
  readonly stderr: () => string
}

function harness(entry = '/nonexistent/main.js'): Harness {
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
  }
  return { io, signals, stdout: () => out, stderr: () => err }
}

function processGroup(pid: number): string {
  return execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)]).toString().trim()
}

/** A stand-in for `dist/main.js` that logs its process group and each signal to the file it is given. */
function stubEntry(): { h: Harness; log: string } {
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

async function waitForLog(log: string, pattern: RegExp): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const text = existsSync(log) ? readFileSync(log, 'utf8') : ''
    const match = pattern.exec(text)
    if (match !== null) return match
    if (Date.now() > deadline) throw new Error(`no line matching ${pattern} in the entry's log within 10 s: ${text}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
