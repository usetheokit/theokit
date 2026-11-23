import { homedir } from 'node:os'
import { join } from 'node:path'

import { describeSource, dotenvNames } from '@theocode/agent/auth'
import { resolveCredential, type ResolvedCredential } from '@theocode/agent/auth'
import { workingDirectory } from '../working-directory.js'

const DOTENV_PATH = join(workingDirectory(), '.env')
const DOTENV_KEYS = dotenvNames(DOTENV_PATH)

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
    return describeSource({ kind: 'oauth', provider: c.provider }, DOTENV_KEYS, DOTENV_PATH)
  }
  const isEnvVar = /^[A-Z][A-Z0-9_]*$/.test(c.source)
  const label = isEnvVar
    ? describeSource({ kind: 'env', varName: c.source }, DOTENV_KEYS, DOTENV_PATH)
    : describeSource({ kind: 'file', path: c.source }, DOTENV_KEYS, DOTENV_PATH)
  return c.inferred ? `${label} (provider inferred)` : label
}
