import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { parseAuthorizationPolicy } from '../src/authorization/policy.js'
import { loadConfiguration } from '../src/config-file.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readControlPlaneSettings } from '../src/control-plane/settings.js'
import { type OnboardIo, type OnboardOptions, onboard } from '../src/onboard.js'
import { readSessionSettings } from '../src/sessions/session-settings.js'

const KEY = 'sk-onboard-test-key-0123456789'
const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Harness {
  readonly home: string
  readonly io: OnboardIo
  readonly stdoutText: () => string
}

function harness(extraEnv: Record<string, string> = {}, tty = false): Harness {
  const home = mkdtempSync(join(tmpdir(), 'theoclaw-onboard-'))
  scratch.push(home)
  let stdoutText = ''
  const stdout = new PassThrough()
  stdout.on('data', (chunk: Buffer) => (stdoutText += chunk.toString()))
  const env: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'),
    ONBOARD_TEST_KEY: KEY,
    ...extraEnv,
  }
  const io: OnboardIo = { env, homeDir: home, stdin: new PassThrough(), stdout, isTTY: tty }
  return { home, io, stdoutText: () => stdoutText }
}

const FLAGS: OnboardOptions = {
  yes: true,
  force: false,
  model: 'openrouter/google/gemini-2.5-flash-lite',
  apiKeyEnv: 'ONBOARD_TEST_KEY',
  port: '8787',
  owners: 'telegram:1',
}

function configFile(h: Harness, name = 'theoclaw.env'): string {
  return join(h.home, 'config', 'theoclaw', name)
}

function readBack(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path }
  loadConfiguration(env, '/nonexistent')
  delete env.THEOCLAW_CONFIG
  return env
}

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

function listing(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true }).map(String).sort()
}

async function refusal(promise: Promise<unknown>): Promise<TheoClawConfigError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(TheoClawConfigError)
  return error as TheoClawConfigError
}

describe('theoclaw onboard', () => {
  it('onboarding writes the six settings at mode 0600 in a 0700 directory', async () => {
    const fresh = harness()
    const path = await onboard(FLAGS, fresh.io)
    expect(path).toBe(configFile(fresh))
    expect(mode(path)).toBe(0o600)
    expect(mode(dirname(path))).toBe(0o700)
    expect(Object.keys(readBack(path)).sort()).toEqual([
      'OPENROUTER_API_KEY',
      'THEOCLAW_CONTROL_TOKEN',
      'THEOCLAW_MODEL',
      'THEOCLAW_OWNERS',
      'THEOCLAW_PORT',
      'THEOCLAW_STATE_DIR',
      'THEOCLAW_WORKSPACE',
    ])
    expect(readBack(path).THEOCLAW_CONTROL_TOKEN).toMatch(/^[0-9a-f]{48}$/)
    expect(fresh.stdoutText()).toContain(`theoclaw: configuration written to ${path}`)

    const loose = harness()
    mkdirSync(dirname(configFile(loose)), { recursive: true, mode: 0o755 })
    chmodSync(dirname(configFile(loose)), 0o755)
    await onboard(FLAGS, loose.io)
    expect(mode(dirname(configFile(loose)))).toBe(0o700)
    expect(mode(configFile(loose))).toBe(0o600)
  })

  it('an onboarded file starts the entry', async () => {
    for (const profile of [undefined, 'a']) {
      const h = harness(profile === undefined ? {} : { THEOCLAW_PROFILE: profile })
      const path = await onboard(FLAGS, h.io)
      const env = readBack(path)
      if (profile !== undefined) env.THEOCLAW_STATE_DIR = join(h.home, '.theokit', 'profiles', profile, 'state')
      expect(() => readControlPlaneSettings(env)).not.toThrow()
      expect(() => parseAuthorizationPolicy(env)).not.toThrow()
      expect(readSessionSettings(env, statSync).workspace).toBe(env.THEOCLAW_WORKSPACE)
      expect(mode(env.THEOCLAW_WORKSPACE!)).toBe(0o700)
    }
  })

  it('a relative workspace is refused and nothing is created', async () => {
    const h = harness()
    const error = await refusal(onboard({ ...FLAGS, workspace: 'rel/dir' }, h.io))
    expect(error.variable).toBe('THEOCLAW_WORKSPACE')
    expect(existsSync(configFile(h))).toBe(false)
    expect(existsSync(join(h.home, 'data'))).toBe(false)
    expect(existsSync(join(h.home, 'rel'))).toBe(false)
  })

  it('onboarding refuses a value the start would refuse and writes nothing', async () => {
    const cases: Array<[Partial<OnboardOptions>, string]> = [
      [{ port: '70000' }, 'THEOCLAW_PORT'],
      [{ owners: 'nobody' }, 'THEOCLAW_OWNERS'],
      [{ owners: 'email:me@example.com' }, 'THEOCLAW_OWNERS'],
    ]
    for (const [override, variable] of cases) {
      const h = harness()
      const before = listing(h.home)
      const error = await refusal(onboard({ ...FLAGS, ...override }, h.io))
      expect(error.variable).toBe(variable)
      expect(error.message).not.toContain(KEY)
      expect(h.stdoutText()).not.toContain(KEY)
      expect(listing(h.home)).toEqual(before)
    }
  })

  it('onboarding keeps an existing file unless forced, then replaces it atomically', async () => {
    const h = harness()
    const path = configFile(h)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'OLD="1"\n')

    const error = await refusal(onboard(FLAGS, h.io))
    expect(error.message).toContain('--force')
    expect(readFileSync(path, 'utf8')).toBe('OLD="1"\n')

    await onboard({ ...FLAGS, force: true }, h.io)
    expect(readBack(path).OLD).toBeUndefined()
    expect(readBack(path).THEOCLAW_MODEL).toBe(FLAGS.model)
    expect(readdirSync(dirname(path)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('onboarding reads the key from the named variable and never from argv', async () => {
    const h = harness()
    const written = readBack(await onboard(FLAGS, h.io))
    expect(written.OPENROUTER_API_KEY).toBe(KEY)

    const unset = harness()
    const error = await refusal(onboard({ ...FLAGS, apiKeyEnv: 'ONBOARD_TEST_ABSENT' }, unset.io))
    expect(error.message).toContain('ONBOARD_TEST_ABSENT')
    expect(existsSync(configFile(unset))).toBe(false)
  })

  it('a profiled onboarding validates with the profile state directory', async () => {
    const h = harness({ THEOCLAW_PROFILE: 'a' })
    const path = await onboard(FLAGS, h.io)
    expect(path).toBe(configFile(h, 'theoclaw-a.env'))
    const written = readBack(path)
    expect(written.THEOCLAW_STATE_DIR).toBe(undefined)
    expect(written.THEOCLAW_WORKSPACE).toBe(join(h.home, '.theokit', 'profiles', 'a', 'workspace'))
  })

  it('onboarding values survive loadConfiguration unchanged', async () => {
    const values = { owners: 'matrix:@me:matrix.org', model: 'model # with a space', key: 'key=with=equals', apostrophe: "it's" }
    const h = harness({ ONBOARD_TEST_KEY: values.key })
    const written = readBack(await onboard({ ...FLAGS, owners: values.owners, model: values.model }, h.io))
    expect(written.THEOCLAW_OWNERS).toBe(values.owners)
    expect(written.THEOCLAW_MODEL).toBe(values.model)
    expect(written.OPENROUTER_API_KEY).toBe(values.key)

    const quoted = harness()
    const workspace = join(quoted.home, values.apostrophe)
    const back = readBack(await onboard({ ...FLAGS, workspace }, quoted.io))
    expect(back.THEOCLAW_WORKSPACE).toBe(workspace)
  })

  it('onboarding refuses a value holding a double quote, a backslash or a newline', async () => {
    for (const bad of ['mo"del', 'mo\\del', 'mo\ndel', 'mo\rdel']) {
      const h = harness()
      const error = await refusal(onboard({ ...FLAGS, model: bad }, h.io))
      expect(error.variable).toBe('THEOCLAW_MODEL')
      expect(error.message).not.toContain(bad)
      expect(existsSync(configFile(h))).toBe(false)
    }
  })

  it('onboarding without a terminal and without --yes is refused naming --yes', async () => {
    const h = harness()
    const error = await refusal(onboard({ yes: false, force: false }, h.io))
    expect(error.message).toContain('--yes')
    expect(existsSync(configFile(h))).toBe(false)

    const missing = await refusal(onboard({ yes: true, force: false, apiKeyEnv: 'ONBOARD_TEST_KEY' }, harness().io))
    expect(missing.message).toContain('--model')
  })

  it('interactive onboarding takes the model and port defaults and never echoes the key', async () => {
    const h = harness({}, true)
    const rawModeCalls: boolean[] = []
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode(value: boolean) {
        rawModeCalls.push(value)
        return this
      },
    })
    const stdout = h.io.stdout as PassThrough & { isTTY?: boolean; columns?: number }
    stdout.isTTY = true
    stdout.columns = 80
    const io: OnboardIo = { ...h.io, stdin }

    const done = onboard({ yes: false, force: false }, io)
    // Each answer is written only once its prompt is on stdout, as a person would type it.
    const answers: Array<[RegExp, string]> = [
      [/model/i, '\n'],
      [/key/i, 'sk-test-key\r'],
      [/port/i, '\n'],
      [/owners/i, 'telegram:1\n'],
      [/workspace/i, '\n'],
    ]
    let seen = 0
    for (const [prompt, answer] of answers) {
      const deadline = Date.now() + 5_000
      for (;;) {
        const rest = h.stdoutText().slice(seen)
        const match = prompt.exec(rest)
        if (match !== null) {
          seen += match.index + match[0].length
          break
        }
        if (Date.now() > deadline) throw new Error(`no prompt matching ${prompt} within 5 s: ${h.stdoutText()}`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      stdin.write(answer)
    }
    const written = readBack(await done)

    expect(written.THEOCLAW_WORKSPACE).toBe(join(h.home, 'data', 'theoclaw', 'workspace'))
    expect(written.THEOCLAW_MODEL).toBe('openrouter/google/gemini-2.5-flash-lite')
    expect(written.THEOCLAW_PORT).toBe('8787')
    expect(written.OPENROUTER_API_KEY).toBe('sk-test-key')
    expect(h.stdoutText()).not.toContain('sk-test-key')
    expect(rawModeCalls.at(-1)).toBe(false)
  })
})
