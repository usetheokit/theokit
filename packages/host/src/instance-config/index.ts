import { auditInstanceConfig, fixInstanceConfig } from './audit.js'
import { loadInstanceConfig } from './load.js'
import { onboardInstanceConfig, type OnboardIo, type OnboardOptions } from './onboard.js'
import { assertAppName, defaultVariable, resolveConfigPath } from './path.js'
import { reloadInstanceConfig, type ReloadEvent } from './reload.js'
import { watchInstanceConfig, type WatchOptions } from './watch.js'
import { writeInstanceConfig } from './write.js'

export { InstanceConfigError } from './errors.js'
export type { OnboardIo, OnboardOptions } from './onboard.js'
export type { ReloadEvent } from './reload.js'
export type { WatchOptions } from './watch.js'

export interface InstanceKey {
  readonly secret?: boolean
  readonly hot?: boolean
  readonly parse?: (raw: string) => unknown
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
    audit: (path) => auditInstanceConfig(app, path),
    fix: (findings) => fixInstanceConfig(findings),
    reload: (path, env, previous) => reloadInstanceConfig(keys, path, env, previous),
    watch: (path, env, opts) => watchInstanceConfig(keys, path, env, opts),
  }
}
