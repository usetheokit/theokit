import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import { parseAuthorizationPolicy } from './authorization/policy.js'
import { asConfigError, assertWritable, configurationPath, theoclawConfig } from './config-file.js'
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

function defaultWorkspace(io: OnboardIo, instance: TheoClawInstance): string {
  if (instance.workspace !== undefined) return instance.workspace
  const data = io.env.XDG_DATA_HOME?.trim() || join(io.homeDir, '.local', 'share')
  return join(data, 'theoclaw', 'workspace')
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new TheoClawConfigError(`theoclaw onboard --yes needs ${flag}`)
  return value
}

/** The keys onboarding collects, in the order it asks; the generated token is never asked for. */
const ONBOARD_KEYS = ['THEOCLAW_MODEL', 'OPENROUTER_API_KEY', 'THEOCLAW_PORT', 'THEOCLAW_OWNERS', 'THEOCLAW_WORKSPACE', 'THEOCLAW_STATE_DIR', 'THEOCLAW_CONTROL_TOKEN'] as const
type OnboardKey = (typeof ONBOARD_KEYS)[number]

/** The model key's variable and the values the flags give (`--yes`), checked before anything is asked. */
function fromFlags(opts: OnboardOptions, io: OnboardIo, instance: TheoClawInstance): { variable: string; answers: Partial<Record<OnboardKey, string>> } {
  const variable = required(opts.apiKeyEnv, '--api-key-env <NAME>')
  const key = io.env[variable]
  if (key === undefined || key === '') {
    throw new TheoClawConfigError(`--api-key-env names ${variable}, which is not set`, { variable })
  }
  return {
    variable,
    answers: {
      THEOCLAW_MODEL: required(opts.model, '--model'),
      THEOCLAW_PORT: required(opts.port, '--port'),
      THEOCLAW_OWNERS: required(opts.owners, '--owners'),
      THEOCLAW_WORKSPACE: opts.workspace ?? defaultWorkspace(io, instance),
    },
  }
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
  const flags = opts.yes ? fromFlags(opts, io, instance) : undefined
  const workspace = flags?.answers.THEOCLAW_WORKSPACE ?? instance.workspace ?? defaultWorkspace(io, instance)
  if (instance.workspace !== undefined && workspace !== instance.workspace) {
    throw new TheoClawConfigError(`THEOCLAW_PROFILE sets the workspace to ${instance.workspace}; unset the profile to choose another`, {
      variable: 'THEOCLAW_WORKSPACE',
    })
  }
  const state = io.env.XDG_STATE_HOME?.trim() || join(io.homeDir, '.local', 'state')
  // A profile sets what it owns itself and refuses an explicit value beside it (src/instance.ts).
  const only = ONBOARD_KEYS.filter((key) => !Object.hasOwn(instance.overrides, key))
  // A profile owns its workspace, so there is nothing to ask.
  let refusal: unknown
  try {
    await theoclawConfig.onboard(
      { stdin: io.stdin, stdout: io.stdout, env: io.env, homeDir: io.homeDir },
      {
        interactive: !opts.yes,
        force: opts.force,
        only,
        answers: { ...flags?.answers, THEOCLAW_STATE_DIR: join(state, 'theoclaw') },
        ...(flags === undefined ? {} : { secretFromEnv: { OPENROUTER_API_KEY: flags.variable } }),
        prompts: {
          THEOCLAW_MODEL: { question: 'Model', default: DEFAULT_MODEL },
          OPENROUTER_API_KEY: { question: 'OpenRouter API key (not shown)' },
          THEOCLAW_PORT: { question: 'Port', default: DEFAULT_PORT },
          THEOCLAW_OWNERS: { question: 'Owners, as platform:senderId separated by commas' },
          THEOCLAW_WORKSPACE: { question: 'Workspace directory', default: workspace },
        },
        validate: (entries) => {
          // The package hides what validation threw; the refusal the start would make is kept and rethrown below.
          try {
            assertWritable(entries)
            validate(entries, io, entries.THEOCLAW_WORKSPACE ?? workspace)
            mkdirSync(entries.THEOCLAW_WORKSPACE ?? workspace, { recursive: true, mode: 0o700 })
            const stateDir = entries.THEOCLAW_STATE_DIR ?? instance.overrides.THEOCLAW_STATE_DIR
            if (stateDir !== undefined) mkdirSync(stateDir, { recursive: true, mode: 0o700 })
          } catch (error) {
            refusal = error
            throw error
          }
        },
      },
    )
  } catch (error) {
    throw refusal ?? asConfigError(error, path)
  }
  io.stdout.write(`theoclaw: configuration written to ${path}\n`)
  return path
}
