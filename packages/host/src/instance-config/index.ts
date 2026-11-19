import { auditInstanceConfig, fixInstanceConfig } from './audit.js'
import { loadInstanceConfig } from './load.js'
import { assertAppName, defaultVariable, resolveConfigPath } from './path.js'
import { writeInstanceConfig } from './write.js'

export { InstanceConfigError } from './errors.js'

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
  audit(path: string): AuditFinding[]
  /** Applies chmod to each finding and returns the findings that were fixed. */
  fix(findings: readonly AuditFinding[]): AuditFinding[]
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
    write: (path, entries, opts) =>
      writeInstanceConfig(
        app,
        keys,
        path,
        entries as Readonly<Record<string, string | undefined>>,
        opts,
      ),
    audit: (path) => auditInstanceConfig(app, path),
    fix: (findings) => fixInstanceConfig(findings),
  }
}
