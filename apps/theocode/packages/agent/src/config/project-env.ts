import { SOVEREIGN_ENV_KEYS } from '@theokit/sdk'

/**
 * Keys a project `.env` may never set: the SDK's own sovereign keys plus TheoCode's. Building the
 * list from the imported SDK constant keeps it in step when the SDK adds one.
 */
export const PROTECTED_ENV_KEYS: readonly string[] = [
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

  const before = new Map<string, string | undefined>(PROTECTED_ENV_KEYS.map((k) => [k, env[k]]))

  try {
    load()
  } catch {
    return
  }

  for (const [key, realValue] of before) {
    if (realValue === undefined) delete env[key]
    else env[key] = realValue
  }
}
