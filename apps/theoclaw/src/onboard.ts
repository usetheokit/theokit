import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'

import { parseAuthorizationPolicy } from './authorization/policy.js'
import { assertWritable, configurationPath, writeConfiguration } from './config-file.js'
import { TheoClawConfigError } from './control-plane/errors.js'
import { readControlPlaneSettings, requireModel } from './control-plane/settings.js'
import { resolveInstance, type TheoClawInstance } from './instance.js'
import { readSessionSettings } from './sessions/session-settings.js'

/**
 * `theoclaw onboard` (B-374, OC-31): asks for, or takes from flags, the settings a start needs,
 * checks them with the start's own parsers, and writes the configuration file. A file onboarding
 * accepts is a file the start accepts, and a refusal writes nothing. No value is ever printed.
 */

export interface OnboardOptions {
  readonly yes: boolean
  readonly force: boolean
  readonly model?: string
  /** The NAME of the variable holding the model key; the key itself never comes from argv. */
  readonly apiKeyEnv?: string
  readonly port?: string
  readonly owners?: string
  readonly workspace?: string
}

/** A terminal's input: readline needs a stream, the key prompt needs raw mode. */
export type OnboardInput = Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown }

export interface OnboardIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdin: OnboardInput
  readonly stdout: Writable
  readonly isTTY: boolean
}

const DEFAULT_MODEL = 'openrouter/google/gemini-2.5-flash-lite'
const DEFAULT_PORT = '8787'

interface Answers {
  readonly model: string
  readonly key: string
  readonly port: string
  readonly owners: string
  readonly workspace: string
}

function defaultWorkspace(io: OnboardIo, instance: TheoClawInstance): string {
  if (instance.workspace !== undefined) return instance.workspace
  const data = io.env.XDG_DATA_HOME?.trim() || join(io.homeDir, '.local', 'share')
  return join(data, 'theoclaw', 'workspace')
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new TheoClawConfigError(`theoclaw onboard --yes needs ${flag}`)
  return value
}

function fromFlags(opts: OnboardOptions, io: OnboardIo, instance: TheoClawInstance): Answers {
  const variable = required(opts.apiKeyEnv, '--api-key-env <NAME>')
  const key = io.env[variable]
  if (key === undefined || key === '') {
    throw new TheoClawConfigError(`--api-key-env names ${variable}, which is not set`, { variable })
  }
  return {
    model: required(opts.model, '--model'),
    key,
    port: required(opts.port, '--port'),
    owners: required(opts.owners, '--owners'),
    workspace: opts.workspace ?? defaultWorkspace(io, instance),
  }
}

async function question(io: OnboardIo, prompt: string, fallback?: string): Promise<string> {
  // One interface per question: an interface left open in terminal mode echoes every keypress,
  // the key's included, so it is closed before the key is read.
  const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: true })
  try {
    const answer = (await rl.question(fallback === undefined ? `${prompt}: ` : `${prompt} [${fallback}]: `)).trim()
    return answer === '' && fallback !== undefined ? fallback : answer
  } finally {
    rl.close()
  }
}

/** The key, read in raw mode with nothing written back; Enter is `\r` or `\n`, Ctrl-C aborts. */
async function secret(io: OnboardIo, prompt: string): Promise<string> {
  const input = io.stdin
  const setRawMode = input.setRawMode?.bind(input)
  if (setRawMode === undefined) throw new TheoClawConfigError('theoclaw onboard needs a terminal; pass --yes and flags instead')
  io.stdout.write(`${prompt}: `)
  setRawMode(true)
  input.resume()
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = ''
      const onData = (chunk: Buffer | string): void => {
        for (const character of chunk.toString()) {
          if (character === '\r' || character === '\n') return finish(() => resolve(value))
          if (character === '\u0003') return finish(() => reject(new TheoClawConfigError('theoclaw onboard: interrupted')))
          value = character === '\u007f' || character === '\b' ? value.slice(0, -1) : value + character
        }
      }
      const finish = (settle: () => void): void => {
        input.removeListener('data', onData)
        settle()
      }
      input.on('data', onData)
    })
  } finally {
    setRawMode(false)
    input.pause()
    io.stdout.write('\n')
  }
}

async function ask(io: OnboardIo, instance: TheoClawInstance): Promise<Answers> {
  const model = await question(io, 'Model', DEFAULT_MODEL)
  const key = await secret(io, 'OpenRouter API key (not shown)')
  const port = await question(io, 'Port', DEFAULT_PORT)
  const owners = await question(io, 'Owners, as platform:senderId separated by commas')
  // A profile owns its workspace, so there is nothing to ask.
  const workspace = instance.workspace ?? (await question(io, 'Workspace directory', defaultWorkspace(io, instance)))
  return { model, key, port, owners, workspace }
}

function entriesFor(answers: Answers, io: OnboardIo, instance: TheoClawInstance): Record<string, string> {
  if (instance.workspace !== undefined && answers.workspace !== instance.workspace) {
    throw new TheoClawConfigError(`THEOCLAW_PROFILE sets the workspace to ${instance.workspace}; unset the profile to choose another`, {
      variable: 'THEOCLAW_WORKSPACE',
    })
  }
  const state = io.env.XDG_STATE_HOME?.trim() || join(io.homeDir, '.local', 'state')
  const entries: Record<string, string> = {
    THEOCLAW_MODEL: answers.model,
    OPENROUTER_API_KEY: answers.key,
    THEOCLAW_PORT: answers.port,
    THEOCLAW_OWNERS: answers.owners,
    THEOCLAW_WORKSPACE: answers.workspace,
    THEOCLAW_STATE_DIR: join(state, 'theoclaw'),
    THEOCLAW_CONTROL_TOKEN: randomBytes(24).toString('hex'),
  }
  // A profile sets what it owns itself and refuses an explicit value beside it (src/instance.ts).
  for (const name of Object.keys(instance.overrides)) delete entries[name]
  return entries
}

/**
 * What the start does with the file (src/main.ts): load it under the caller's profile, resolve the
 * instance, which refuses a setting the profile owns, then run the start's parsers. The first
 * refusal is rethrown unchanged.
 */
function validate(entries: Readonly<Record<string, string>>, io: OnboardIo, workspace: string): void {
  const env: Record<string, string> = { ...entries }
  if (io.env.THEOCLAW_PROFILE !== undefined) env.THEOCLAW_PROFILE = io.env.THEOCLAW_PROFILE
  Object.assign(env, resolveInstance(env, { homeDir: io.homeDir }).overrides)
  requireModel(env)
  readControlPlaneSettings(env)
  parseAuthorizationPolicy(env)
  // The workspace is created only once everything passed, so its absence is not a refusal here.
  readSessionSettings(env, (path) => (path === workspace && !existsSync(path) ? { isDirectory: () => true } : statSync(path)))
}

export async function onboard(opts: OnboardOptions, io: OnboardIo): Promise<string> {
  const path = configurationPath(io.env, io.homeDir)
  if (existsSync(path) && !opts.force) {
    throw new TheoClawConfigError(`${path} exists; pass --force to replace it`, { variable: 'THEOCLAW_CONFIG' })
  }
  if (!opts.yes && !io.isTTY) throw new TheoClawConfigError('theoclaw onboard needs a terminal; pass --yes and flags instead')
  const instance = resolveInstance(io.env, { homeDir: io.homeDir })
  const answers = opts.yes ? fromFlags(opts, io, instance) : await ask(io, instance)
  const entries = entriesFor(answers, io, instance)
  assertWritable(entries)
  validate(entries, io, answers.workspace)
  mkdirSync(answers.workspace, { recursive: true, mode: 0o700 })
  writeConfiguration(path, entries, { force: opts.force, ownsDirectory: !io.env.THEOCLAW_CONFIG?.trim() })
  io.stdout.write(`theoclaw: configuration written to ${path}\n`)
  return path
}
