import { homedir } from 'node:os'

import { describeSource } from '@theocode/agent/auth'
import { resolveCredential, type ResolvedCredential } from '@theocode/agent/auth'
import type { ProjectEnvRecord } from '@theokit/agents/config'

// Only the TUI sets this; the CLI and ACP surfaces show no credential label, so they never read it.
let projectEnv: ProjectEnvRecord | undefined
let loaded: ReadonlySet<string> = new Set()

/** Called once after bootstrap; an absent record means no key was loaded from `.env`. */
export const setProjectEnvRecord = (record: ProjectEnvRecord | undefined): void => {
  projectEnv = record
  loaded = new Set(record?.loaded ?? [])
}

const loadedKeys = (): ReadonlySet<string> => loaded
const dotenvPath = (): string => projectEnv?.file ?? '.env'

export const credential = (): ResolvedCredential | { error: Error } => {
  try {
    return resolveCredential({ env: process.env, home: homedir() })
  } catch (err) {
    return { error: err as Error }
  }
}

export const credentialError = (): string | undefined => {
  const c = credential()
  return 'error' in c ? c.error.message : undefined
}

export const credentialSource = (): string => {
  const c = credential()
  if ('error' in c) return 'none'
  if (c.kind === 'oauth') {
    return describeSource({ kind: 'oauth', provider: c.provider }, loadedKeys(), dotenvPath())
  }
  const isEnvVar = /^[A-Z][A-Z0-9_]*$/.test(c.source)
  const label = isEnvVar
    ? describeSource({ kind: 'env', varName: c.source }, loadedKeys(), dotenvPath())
    : describeSource({ kind: 'file', path: c.source }, loadedKeys(), dotenvPath())
  return c.inferred ? `${label} (provider inferred)` : label
}
