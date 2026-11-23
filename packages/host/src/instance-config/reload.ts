import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

import type { InstanceKey } from './index.js'

/** No event carries a value from the file. */
export type ReloadEvent =
  | { kind: 'applied'; applied: readonly string[]; restartRequired: readonly string[] }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reason: string }
  | { kind: 'watch-failed'; cause: unknown }

export interface ReloadResult {
  result: ReloadEvent
  accepted: Readonly<Record<string, string>>
}

export function readSnapshot(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (v !== undefined) out[k] = v
  }
  return out
}

type Lookup = Readonly<Record<string, string | undefined>>

function setOrDelete(target: NodeJS.ProcessEnv, name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(target, name)
  else target[name] = value
}

function parses(key: InstanceKey, value: string | undefined): boolean {
  if (value === undefined || key.parse === undefined) return true
  try {
    key.parse(value)
    return true
  } catch {
    return false
  }
}

function refuses(
  validate:
    | ((candidate: Readonly<NodeJS.ProcessEnv>, successor: Readonly<NodeJS.ProcessEnv>) => void)
    | undefined,
  candidate: NodeJS.ProcessEnv,
  successor: NodeJS.ProcessEnv,
): boolean {
  try {
    validate?.(candidate, successor)
    return false
  } catch {
    return true
  }
}

export function reloadInstanceConfig(
  keys: Readonly<Record<string, InstanceKey>>,
  path: string,
  env: NodeJS.ProcessEnv,
  previous: Readonly<Record<string, string>>,
  validate?: (
    candidate: Readonly<NodeJS.ProcessEnv>,
    successor: Readonly<NodeJS.ProcessEnv>,
  ) => void,
): ReloadResult {
  const refuse = (reason: string): ReloadResult => ({
    result: { kind: 'refused', reason },
    accepted: previous,
  })
  let next: Lookup
  try {
    next = readSnapshot(path)
  } catch {
    return refuse(`cannot read ${path}`)
  }
  const before: Lookup = previous
  const applied: string[] = []
  const restartRequired: string[] = []
  const candidate: NodeJS.ProcessEnv = { ...env }
  // What a restart would start from: the candidate plus every changed start-only key the caller did not set.
  const successor: NodeJS.ProcessEnv = { ...env }
  const names = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort((a, b) =>
    a.localeCompare(b),
  )
  for (const name of names) {
    if (before[name] === next[name]) continue
    const key = Object.hasOwn(keys, name) ? keys[name] : undefined
    if (key?.hot !== true) {
      restartRequired.push(name)
      if (env[name] === before[name]) setOrDelete(successor, name, next[name])
      continue
    }
    if (!parses(key, next[name])) return refuse(`${name} does not parse`)
    // the caller set this variable: leave it alone
    if (env[name] !== before[name]) continue
    setOrDelete(candidate, name, next[name])
    setOrDelete(successor, name, next[name])
    applied.push(name)
  }
  if (applied.length === 0 && restartRequired.length === 0)
    return { result: { kind: 'unchanged' }, accepted: readonlyRecord(next) }
  if (refuses(validate, candidate, successor)) {
    return refuse('the candidate configuration was refused by validation')
  }
  for (const name of applied) setOrDelete(env, name, candidate[name])
  const result: ReloadEvent = { kind: 'applied', applied, restartRequired }
  return { result, accepted: readonlyRecord(next) }
}

function readonlyRecord(l: Lookup): Readonly<Record<string, string>> {
  return l as Readonly<Record<string, string>>
}
