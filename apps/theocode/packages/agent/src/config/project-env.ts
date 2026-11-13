import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'

/**
 * Keys a project `.env` may never set: the SDK's own sovereign keys plus TheoCode's. Built from the
 * imported list so it stays in step with the SDK.
 */
export const PROJECT_ENV_PROTECTED_KEYS: readonly string[] = [
  ...new Set<string>([
    ...SOVEREIGN_ENV_KEYS,
    'THEOCODE_TRUST_ALL_DIRS',
    'THEOKIT_TRUST_ALL_DIRS',
    'THEOCODE_HOME',
    'THEOKIT_HOME',
    'THEOKIT_AUTH_HOME',
  ]),
]

interface MutableEnv {
  [key: string]: string | undefined
}

/** Load the project `.env`, then restore every protected key to the value it had before. */
export function loadProjectEnv(
  env: MutableEnv = process.env,
  load: (() => void) | undefined = typeof process.loadEnvFile === 'function'
    ? () => {
        process.loadEnvFile()
      }
    : undefined,
): void {
  if (load === undefined) return

  const sovereign = new Map<string, string | undefined>(
    PROJECT_ENV_PROTECTED_KEYS.map((k) => [k, env[k]] as const),
  )

  try {
    load()
  } catch {
    // no .env on disk — rely on the ambient environment
  }

  for (const [key, realValue] of sovereign) {
    if (realValue === undefined) delete env[key]
    else env[key] = realValue
  }
}
