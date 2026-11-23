import { homedir } from 'node:os'

import { auditInstanceConfig, fixInstanceConfig } from './audit.js'
import { InstanceConfigError } from './errors.js'
import { loadInstanceConfig } from './load.js'
import { onboardInstanceConfig, type OnboardIo, type OnboardOptions } from './onboard.js'
import { assertAppName, defaultVariable, resolveConfigPath } from './path.js'
import { reloadInstanceConfig, type ReloadEvent } from './reload.js'
import { watchInstanceConfig, type WatchOptions } from './watch.js'
import { writeInstanceConfig } from './write.js'

export { InstanceConfigError }
export type { OnboardIo, OnboardOptions } from './onboard.js'
export type { ReloadEvent } from './reload.js'
export type { WatchOptions } from './watch.js'

export interface InstanceKey {
  readonly secret?: boolean
  readonly hot?: boolean
  readonly parse?: (raw: string) => unknown
  /** Onboarding writes `generate()`'s value for this key and never asks for it; answers and the environment do not override it. */
  readonly generate?: () => string
}

export interface InstanceConfigOptions<K extends string> {
  /** [a-z0-9-]+, refused otherwise. */
  readonly app: string
  readonly keys: Readonly<Record<K, InstanceKey>>
  /** Default `${APP}_CONFIG`. */
  readonly pathVariable?: string
  /** Default `${APP}_PROFILE`. */
  readonly profileVariable?: string
}

export interface AuditFinding {
  readonly id: 'file-mode' | 'directory-mode'
  readonly path: string
  readonly mode: number
  readonly fixable: true
}

export interface InstanceConfig<K extends string> {
  path(env: NodeJS.ProcessEnv, homeDir: string): string
  /** Copies absent declared keys into env; returns the path read or undefined for a missing default file. */
  load(env: NodeJS.ProcessEnv, homeDir: string): string | undefined
  write(
    path: string,
    entries: Readonly<Partial<Record<K, string>>>,
    options: { force: boolean },
  ): Promise<void>
  /**
   * First-run setup: collects every declared key (answers, then `secretFromEnv`, then prompts; a `secret` key is read
   * with echo off), checks the values with each key's `parse` and `validate`, and writes the file. Without `force`
   * an existing file is refused by `write` itself. Nothing printed or thrown holds a value.
   */
  onboard(
    io: OnboardIo,
    options: OnboardOptions<K>,
  ): Promise<{ path: string; written: readonly K[] }>
  /**
   * The arguments to put in `ServiceSpec.args`: `--config <path>` (the resolved path) and, when set, `--profile <name>`.
   * Defaults to `process.env` and the user's home directory.
   */
  entryArgs(env?: NodeJS.ProcessEnv, homeDir?: string): string[]
  /**
   * The entry's parser: sets the path and profile variables from `--config` and `--profile`. Nothing else is
   * accepted; a malformed list throws `InstanceConfigError` and leaves `env` unchanged.
   */
  applyEntryArgs(argv: readonly string[], env: NodeJS.ProcessEnv): void
  audit(path: string): AuditFinding[]
  /** Applies chmod to each finding and returns the findings that were fixed. */
  fix(findings: readonly AuditFinding[]): AuditFinding[]
  /**
   * Re-reads the file and applies changed `hot` keys to env, leaving a variable alone when the caller set it.
   * Other changed keys are listed in `restartRequired`. `previous` is the file's last accepted content;
   * a refused file returns it unchanged as `accepted`. Events name keys, never values.
   */
  reload(
    path: string,
    env: NodeJS.ProcessEnv,
    previous: Readonly<Record<string, string>>,
  ): { result: ReloadEvent; accepted: Readonly<Record<string, string>> }
  /** Watches the file's directory (so a rename-over is seen), debounced; the watcher is unref'd. */
  watch(path: string, env: NodeJS.ProcessEnv, options: WatchOptions): { close(): void }
}

export function defineInstanceConfig<K extends string>(
  options: InstanceConfigOptions<K>,
): InstanceConfig<K> {
  const { app, keys } = options
  assertAppName(app)
  const pathVariable = options.pathVariable ?? defaultVariable(app, 'CONFIG')
  const profileVariable = options.profileVariable ?? defaultVariable(app, 'PROFILE')
  const declared = new Set<string>(Object.keys(keys))
  const resolve = (env: NodeJS.ProcessEnv, homeDir: string) =>
    resolveConfigPath(app, pathVariable, profileVariable, env, homeDir)
  return {
    path: (env, homeDir) => resolve(env, homeDir).path,
    load: (env, homeDir) => loadInstanceConfig(resolve(env, homeDir), declared, env),
    write: (path, entries, opts) => writeInstanceConfig(app, keys, path, entries, opts),
    onboard: (io, opts) =>
      onboardInstanceConfig(
        keys,
        (env, homeDir) => resolve(env, homeDir).path,
        (path, entries, writeOptions) =>
          writeInstanceConfig(app, keys, path, entries, writeOptions),
        io,
        opts,
      ),
    entryArgs: (env = process.env, homeDir = homedir()) => {
      const profile = env[profileVariable]
      const args = ['--config', resolve(env, homeDir).path]
      if (profile !== undefined && profile !== '') args.push('--profile', profile)
      return args
    },
    applyEntryArgs: (argv, env) => {
      const flags: Readonly<Record<string, string>> = {
        '--config': pathVariable,
        '--profile': profileVariable,
      }
      const found = new Map<string, string>()
      for (let index = 0; index < argv.length; index += 2) {
        const flag = argv[index]
        const variable = Object.hasOwn(flags, flag) ? flags[flag] : undefined
        if (variable === undefined)
          throw new InstanceConfigError(
            'instance_config_bad_entry_args',
            `unexpected argument ${flag}; expected --config <path> or --profile <name>`,
          )
        const value = argv[index + 1]
        if (value === undefined || Object.hasOwn(flags, value))
          throw new InstanceConfigError('instance_config_bad_entry_args', `${flag} needs a value`)
        if (found.has(variable))
          throw new InstanceConfigError('instance_config_bad_entry_args', `${flag} was given twice`)
        found.set(variable, value)
      }
      for (const [variable, value] of found) env[variable] = value
    },
    audit: (path) => auditInstanceConfig(app, path),
    fix: (findings) => fixInstanceConfig(findings),
    reload: (path, env, previous) => reloadInstanceConfig(keys, path, env, previous),
    watch: (path, env, opts) => watchInstanceConfig(keys, path, env, opts),
  }
}
