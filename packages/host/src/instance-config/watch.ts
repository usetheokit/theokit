import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'

import { readSnapshot, reloadInstanceConfig, type ReloadEvent } from './reload.js'

import type { InstanceKey } from './index.js'

export interface WatchOptions {
  /** Default 250. */
  readonly debounceMs?: number
  /** Throw to refuse the candidate environment. */
  readonly validate?: (candidate: Readonly<NodeJS.ProcessEnv>) => void
  readonly onEvent: (event: ReloadEvent) => void
}

export function watchInstanceConfig(
  keys: Readonly<Record<string, InstanceKey>>,
  path: string,
  env: NodeJS.ProcessEnv,
  options: WatchOptions,
): { close(): void } {
  let accepted: Readonly<Record<string, string>> = {}
  try {
    accepted = readSnapshot(path)
  } catch {
    // an unreadable file starts from nothing; the next change is checked
  }
  let closed = false
  let timer: NodeJS.Timeout | undefined
  let watcher: FSWatcher | undefined
  const close = (): void => {
    closed = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    watcher?.close()
  }
  const emit = (event: ReloadEvent): void => {
    if (!closed) options.onEvent(event)
  }
  const run = (): void => {
    timer = undefined
    if (closed) return
    const { result, accepted: next } = reloadInstanceConfig(
      keys,
      path,
      env,
      accepted,
      options.validate,
    )
    accepted = next
    if (result.kind !== 'unchanged') emit(result)
  }
  const fail = (cause: unknown): void => {
    const was = closed
    close()
    if (!was) options.onEvent({ kind: 'watch-failed', cause })
  }
  const name = basename(path)
  try {
    watcher = fsWatch(dirname(path), (_type, file) => {
      if (closed || (file !== null && file !== name)) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(run, options.debounceMs ?? 250)
      timer.unref()
    })
    watcher.unref()
    watcher.on('error', fail)
  } catch (cause) {
    fail(cause)
  }
  return { close }
}
