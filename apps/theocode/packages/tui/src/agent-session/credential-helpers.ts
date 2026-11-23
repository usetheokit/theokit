import { homedir } from 'node:os'

import { describeSource } from '@theocode/agent/auth'
import { resolveCredential, type ResolvedCredential } from '@theocode/agent/auth'
import type { ProjectEnvRecord } from '@theokit/agents/config'

let projectEnv: ProjectEnvRecord | undefined

/** Called once after bootstrap; an absent record means no key was loaded from `.env`. */
export const setProjectEnvRecord = (record: ProjectEnvRecord | undefined): void => {
  projectEnv = record
}

const loadedKeys = (): ReadonlySet<string> => new Set(projectEnv?.loaded ?? [])
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
