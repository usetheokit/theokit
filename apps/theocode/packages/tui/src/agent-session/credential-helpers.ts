import { homedir } from 'node:os'

import { describeSource } from '@theocode/agent/auth'
import { resolveCredential, type ResolvedCredential } from '@theocode/agent/auth'
import type { ProjectEnvRecord } from '@theokit/agents/config'

let projectEnv: ProjectEnvRecord | undefined

/** Hands over what the startup `.env` step loaded; call it once, after `bootstrapSurface`. */
export const recordProjectEnv = (record: ProjectEnvRecord | undefined): void => {
  projectEnv = record
}

const dotenvKeys = (): ReadonlySet<string> => new Set(projectEnv?.loaded)
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
  const label = describeSource(c.source, dotenvKeys(), dotenvPath())
  return c.inferred ? `${label} (provider inferred)` : label
}
