import { readFileSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { teeToLogFile } from '../src/ops/log-tee.js'
import { spawn } from 'node:child_process'

import { PREDECESSOR_VARIABLE, waitForPredecessor } from '../src/ops/self-restart.js'
import { reloadConfiguration, watchConfiguration } from '../src/ops/hot-reload.js'
import { cleanScratch, harness } from './support/cli-harness.js'
import { parseEnv } from 'node:util'

afterEach(cleanScratch)

const KEY = 'sk-test-0123456789abcdef'

function configured(text: string, extra: NodeJS.ProcessEnv = {}) {
  const h = harness()
  const path = join(h.io.homeDir, 'theoclaw.env')
  writeFileSync(path, text)
  Object.assign(h.io.env, { THEOCLAW_CONFIG: path }, extra)
  return { h, path }
}

/** The settings a file holds, as the string map `reloadConfiguration` takes (`parseEnv` types each value as possibly undefined). */
function parsedFile(path: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (value !== undefined) parsed[key] = value
  }
  return parsed
}

describe('hot reload (OC-94)', () => {
  it('applies a model change to the running environment without a restart', () => {
    const { path } = configured(`THEOCLAW_MODEL="a"\nTHEOKIT_API_KEY="${KEY}"\n`)
    const previous = parsedFile(path)
    const env: Record<string, string | undefined> = { ...previous }
    writeFileSync(path, `THEOCLAW_MODEL="b"\nTHEOKIT_API_KEY="${KEY}"\nTHEOCLAW_PORT="9"\n`)

    const { result, accepted } = reloadConfiguration(path, env, previous)

    expect(env.THEOCLAW_MODEL).toBe('b')
    expect(result).toEqual({
      kind: 'applied',
      applied: ['THEOCLAW_MODEL'],
      restartRequired: ['THEOCLAW_PORT'],
    })
    expect(env.THEOCLAW_PORT).toBeUndefined()
    expect(accepted.THEOCLAW_MODEL).toBe('b')
  })

  it('leaves a caller-set variable and refuses a file that loses the model', () => {
    const { path } = configured(`THEOCLAW_MODEL="a"\nTHEOKIT_API_KEY="${KEY}"\n`)
    const previous = parsedFile(path)
    const env: Record<string, string | undefined> = { ...previous, THEOCLAW_MODEL: 'from-env' }
    writeFileSync(path, `THEOCLAW_MODEL="b"\nTHEOKIT_API_KEY="${KEY}"\n`)
    expect(reloadConfiguration(path, env, previous).result.kind).toBe('unchanged')
    expect(env.THEOCLAW_MODEL).toBe('from-env')

    const running: Record<string, string | undefined> = { ...previous }
    writeFileSync(path, `THEOKIT_API_KEY="${KEY}"\n`)
    const refused = reloadConfiguration(path, running, previous)
    expect(refused.result.kind).toBe('refused')
    expect(running.THEOCLAW_MODEL).toBe('a')
    expect(JSON.stringify(refused.result)).not.toContain(KEY)
  })

  it('the watcher applies an edit to the file after the debounce', async () => {
    const { path } = configured(`THEOCLAW_MODEL="a"\nTHEOKIT_API_KEY="${KEY}"\n`)
    const env: Record<string, string | undefined> = { ...parsedFile(path) }
    const lines: string[] = []
    const watcher = watchConfiguration(path, env, { debounceMs: 20, write: (l) => lines.push(l) })
    try {
      writeFileSync(path, `THEOCLAW_MODEL="c"\nTHEOKIT_API_KEY="${KEY}"\n`)
      const deadline = Date.now() + 3000
      while (env.THEOCLAW_MODEL !== 'c' && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 25))
      expect(env.THEOCLAW_MODEL).toBe('c')
      expect(lines.join('\n')).toContain('applied THEOCLAW_MODEL')
    } finally {
      watcher.close()
    }
  })
})

describe('self-restart on a restart-required change (B-716)', () => {
  it('the watcher asks for a restart when a start-only setting changed', async () => {
    const { path } = configured(`THEOCLAW_MODEL="a"\nTHEOKIT_API_KEY="${KEY}"\nTHEOCLAW_PORT="1"\n`)
    const env: Record<string, string | undefined> = { ...parsedFile(path) }
    const lines: string[] = []
    let restarts = 0
    const watcher = watchConfiguration(path, env, {
      debounceMs: 20,
      write: (l) => lines.push(l),
      restart: () => void restarts++,
    })
    try {
      writeFileSync(path, `THEOCLAW_MODEL="a"\nTHEOKIT_API_KEY="${KEY}"\nTHEOCLAW_PORT="2"\n`)
      const deadline = Date.now() + 3000
      while (restarts === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
      expect(restarts).toBe(1)
      expect(lines.join('\n')).toContain('restart required for THEOCLAW_PORT')
    } finally {
      watcher.close()
    }
  })

  it('a successor waits for its predecessor and clears the marker', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},300)'])
    const env: NodeJS.ProcessEnv = { [PREDECESSOR_VARIABLE]: String(child.pid) }
    const started = Date.now()
    await waitForPredecessor(env)
    expect(Date.now() - started).toBeGreaterThan(100)
    expect(env[PREDECESSOR_VARIABLE]).toBeUndefined()
  })
})

describe('doctor, status and logs (OC-95, OC-96)', () => {
  it('doctor exits 0 on a sound configuration', async () => {
    const { h } = configured(`THEOCLAW_MODEL="m"\nTHEOKIT_API_KEY="${KEY}"\n`)
    expect(await runCli(['doctor'], h.io)).toBe(0)
  })

  it('doctor exits non-zero on a broken credential without printing it', async () => {
    const bad = 'your-api-key'
    const { h } = configured(`THEOCLAW_MODEL="m"\nTHEOKIT_API_KEY="${bad}"\n`)
    expect(await runCli(['doctor'], h.io)).toBe(3)
    expect(h.stdout()).toContain('THEOKIT_API_KEY is a placeholder')
    expect(h.stdout()).not.toContain(bad)

    const spaced = configured(`THEOCLAW_MODEL="m"\nTHEOKIT_API_KEY="${KEY} tail"\n`)
    expect(await runCli(['doctor'], spaced.h.io)).toBe(3)
    expect(spaced.h.stdout()).not.toContain(KEY)
  })

  it('doctor fails when the model or key is missing', async () => {
    const { h } = configured('THEOKIT_API_KEY="short"\n')
    expect(await runCli(['doctor'], h.io)).toBe(3)
    expect(h.stdout()).toContain('THEOCLAW_MODEL')
  })

  it('status names the instance, model and service state, never a key', async () => {
    const { h } = configured(`THEOCLAW_MODEL="m1"\nTHEOKIT_API_KEY="${KEY}"\n`)
    h.useRunner(() => Promise.resolve({ code: 3, stdout: '', stderr: '' }))
    const code = await runCli(['status'], h.io)
    expect(code).not.toBe(0)
    expect(h.stdout()).toContain('model: m1')
    expect(h.stdout()).not.toContain(KEY)
  })

  it('logs masks configured credentials from a file', async () => {
    const { h } = configured(`THEOCLAW_MODEL="m"\nTHEOKIT_API_KEY="${KEY}"\n`)
    const log = join(h.io.homeDir, 'out.log')
    writeFileSync(log, `one\nkey ${KEY} leaked\nlast\n`)
    expect(await runCli(['logs', '--lines', '2', '--file', log], h.io)).toBe(0)
    expect(h.stdout()).toContain('[redacted]')
    expect(h.stdout()).not.toContain(KEY)
    expect(h.stdout()).not.toContain('one')
  })

  it('logs reads THEOCLAW_LOG_FILE as the container does, written by the tee, masked', async () => {
    const { h } = configured(`THEOCLAW_MODEL="m"\nTHEOKIT_API_KEY="${KEY}"\n`)
    const log = join(h.io.homeDir, 'state', 'theoclaw.log')
    const stream = { write: (_chunk: string): boolean => true }
    teeToLogFile({ THEOCLAW_LOG_FILE: log }, [stream])
    stream.write(`started\nkey ${KEY} leaked\n`)
    Object.assign(h.io.env, { THEOCLAW_LOG_FILE: log })
    h.useRunner(() => Promise.reject(new Error('journalctl must not run')))
    expect(await runCli(['logs', '--lines', '5'], h.io)).toBe(0)
    expect(h.stdout()).toContain('started')
    expect(h.stdout()).toContain('[redacted]')
    expect(h.stdout()).not.toContain(KEY)
  })

  it('logs falls back to the journal and reports its failure', async () => {
    const { h } = configured(`THEOCLAW_MODEL="m"\nTHEOKIT_API_KEY="${KEY}"\n`)
    const calls: string[][] = []
    h.useRunner((cmd, args) => {
      calls.push([cmd, ...args])
      return Promise.resolve({ code: 0, stdout: `x ${KEY}\n`, stderr: '' })
    })
    expect(await runCli(['logs'], h.io)).toBe(0)
    expect(calls[0]?.[0]).toBe('journalctl')
    expect(h.stdout()).not.toContain(KEY)

    h.useRunner(() => Promise.resolve({ code: 1, stdout: '', stderr: '' }))
    expect(await runCli(['logs'], h.io)).toBe(1)
    expect(await runCli(['logs', '--bogus'], h.io)).toBe(2)
  })
})
