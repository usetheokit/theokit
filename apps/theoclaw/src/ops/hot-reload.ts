import { type ReloadEvent } from '@theokit/host/instance-config'

import { theoclawConfig } from '../config-file.js'
import { readControlPlaneSettings, requireModel } from '../control-plane/settings.js'

export { HOT_KEYS } from '../config-file.js'

/**
 * Hot reload of the configuration file (B-399, OC-94), on `theoclawConfig.reload` and `.watch`. The
 * agent factories read the model, its key, the fallback and the thinking level from the environment
 * each time they build an agent, so a change to those applies without a restart. Every other setting
 * is read once at the start: a change to one is not applied to the running process. Where the entry
 * gives a `restart` (B-716), the process restarts onto the file once the whole new file checks out. A
 * candidate that fails the check is refused whole and the running values stay. No result carries a value.
 */

type Env = Record<string, string | undefined>

export type ReloadResult = ReloadEvent

/** The successor reads every setting: a file it would refuse must not stop the running instance. */
function validate(candidate: Readonly<NodeJS.ProcessEnv>, successor: Readonly<NodeJS.ProcessEnv>): void {
  const restarts = [...new Set([...Object.keys(candidate), ...Object.keys(successor)])].some((key) => candidate[key] !== successor[key])
  if (restarts) readControlPlaneSettings(successor)
  else requireModel(candidate)
}

/** Re-read `path` and apply its hot settings to `env`; `previous` is the file's last accepted content. */
export function reloadConfiguration(
  path: string,
  env: Env,
  previous: Readonly<Record<string, string>>,
): { readonly result: ReloadResult; readonly accepted: Readonly<Record<string, string>> } {
  return theoclawConfig.reload(path, env, previous, validate)
}

export interface ConfigWatcher {
  close(): void
}

export interface WatchOptions {
  readonly debounceMs?: number
  readonly write: (line: string) => void
  /** Called after a reload that left start-only settings changed and the whole new file checked out (B-716). */
  readonly restart?: () => void
}

/** One line per reload outcome, naming variables only. */
export function describeReload(result: ReloadResult): string | undefined {
  if (result.kind === 'unchanged') return undefined
  if (result.kind === 'refused') return `config: reload refused: ${result.reason}`
  if (result.kind === 'watch-failed') return 'config: cannot watch the configuration directory; changes need a restart'
  const parts = [
    ...(result.applied.length > 0 ? [`applied ${result.applied.join(', ')}`] : []),
    ...(result.restartRequired.length > 0 ? [`restart required for ${result.restartRequired.join(', ')}`] : []),
  ]
  return `config: reloaded: ${parts.join('; ')}`
}

/** Watch the file's directory and reload after a quiet `debounceMs`. */
export function watchConfiguration(path: string, env: Env, options: WatchOptions): ConfigWatcher {
  return theoclawConfig.watch(path, env, {
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
    validate,
    onEvent: (event) => {
      const line = describeReload(event)
      if (line !== undefined) options.write(line)
      if (event.kind === 'applied' && event.restartRequired.length > 0 && options.restart !== undefined) {
        options.write('config: restarting to apply them')
        options.restart()
      }
    },
  })
}
