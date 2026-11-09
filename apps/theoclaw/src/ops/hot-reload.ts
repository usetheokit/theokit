import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs'
import { basename, dirname } from 'node:path'
import { parseEnv } from 'node:util'

import { requireModel } from '../control-plane/settings.js'

/**
 * Hot reload of the configuration file (B-399, OC-94). The agent factories read the model, its
 * key, the fallback and the thinking level from the environment each time they build an agent, so
 * a change to those applies to the next session or turn without a restart. Every other setting is
 * read once at the start: a change to one is reported and, where the entry gives a `restart`
 * (B-716), the process restarts itself onto the new file; it never holds half of a new configuration. A candidate file that fails the
 * model check is refused whole and the running values stay. No result carries a value.
 */

type Env = Record<string, string | undefined>

/** The settings read per agent. */
export const HOT_KEYS: readonly string[] = [
  'THEOCLAW_MODEL',
  'THEOCLAW_MODEL_FALLBACK',
  'THEOCLAW_THINKING',
  'THEOKIT_API_KEY',
  'OPENROUTER_API_KEY',
]

export type ReloadResult =
  | {
      readonly kind: 'applied'
      readonly applied: readonly string[]
      readonly restartRequired: readonly string[]
    }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string }

function readFile(path: string): Record<string, string> | string {
  try {
    return parseEnv(readFileSync(path, 'utf8')) as Record<string, string>
  } catch (error) {
    return `cannot read the file: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`
  }
}

/**
 * Re-read `path` and apply its hot settings to `env`. `previous` is the file's last accepted
 * content: a variable whose current value is not the file's last one was set by the caller and is
 * left alone, as at the start. Returns the new accepted content with the result.
 */
export function reloadConfiguration(
  path: string,
  env: Env,
  previous: Readonly<Record<string, string>>,
): { readonly result: ReloadResult; readonly accepted: Readonly<Record<string, string>> } {
  const refuse = (reason: string) => ({
    result: { kind: 'refused', reason } as const,
    accepted: previous,
  })
  if (!existsSync(path)) return refuse('the file is gone; keeping the running configuration')
  const next = readFile(path)
  if (typeof next === 'string') return refuse(next)
  const candidate: Env = { ...env }
  const applied: string[] = []
  for (const key of HOT_KEYS) {
    if (next[key] === previous[key] || env[key] !== previous[key]) continue
    if (next[key] === undefined) delete candidate[key]
    else candidate[key] = next[key]
    applied.push(key)
  }
  const restartRequired = [...new Set([...Object.keys(next), ...Object.keys(previous)])]
    .filter((key) => !HOT_KEYS.includes(key) && next[key] !== previous[key])
    .sort()
  if (applied.length === 0 && restartRequired.length === 0)
    return { result: { kind: 'unchanged' }, accepted: next }
  try {
    requireModel(candidate)
  } catch (error) {
    return refuse(`${(error as Error).message}; keeping the running configuration`)
  }
  for (const key of applied) {
    if (candidate[key] === undefined) delete env[key]
    else env[key] = candidate[key]
  }
  return { result: { kind: 'applied', applied, restartRequired }, accepted: next }
}

export interface ConfigWatcher {
  close(): void
}

export interface WatchOptions {
  readonly debounceMs?: number
  readonly write: (line: string) => void
  /** Called after a reload left settings that are read once at the start changed: the owner's restart, done by the process. */
  readonly restart?: () => void
}

/** One line per reload outcome, naming variables only. */
export function describeReload(result: ReloadResult): string | undefined {
  if (result.kind === 'unchanged') return undefined
  if (result.kind === 'refused') return `config: reload refused: ${result.reason}`
  const parts = [
    ...(result.applied.length > 0 ? [`applied ${result.applied.join(', ')}`] : []),
    ...(result.restartRequired.length > 0
      ? [`restart required for ${result.restartRequired.join(', ')}`]
      : []),
  ]
  return `config: reloaded: ${parts.join('; ')}`
}

/** Watch the file's directory (an editor's rename-over replaces the inode) and reload after a quiet `debounceMs`. */
export function watchConfiguration(path: string, env: Env, options: WatchOptions): ConfigWatcher {
  const parsed = existsSync(path) ? readFile(path) : {}
  let accepted: Readonly<Record<string, string>> = typeof parsed === 'string' ? {} : parsed
  let timer: NodeJS.Timeout | undefined
  const run = (): void => {
    const outcome = reloadConfiguration(path, env, accepted)
    accepted = outcome.accepted
    const line = describeReload(outcome.result)
    if (line !== undefined) options.write(line)
    if (
      outcome.result.kind === 'applied' &&
      outcome.result.restartRequired.length > 0 &&
      options.restart !== undefined
    ) {
      options.write('config: restarting to apply them')
      options.restart()
    }
  }
  const file = basename(path)
  let watcher: FSWatcher
  try {
    watcher = watch(dirname(path), (_event, name) => {
      if (name !== null && name !== file) return
      clearTimeout(timer)
      timer = setTimeout(run, options.debounceMs ?? 250)
      timer.unref()
    })
  } catch {
    options.write('config: cannot watch the configuration directory; changes need a restart')
    return { close: () => undefined }
  }
  watcher.on('error', () => options.write('config: the watch failed; changes need a restart'))
  watcher.unref()
  return {
    close: () => {
      clearTimeout(timer)
      watcher.close()
    },
  }
}
