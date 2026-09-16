const SOVEREIGN_KEYS = [
  'THEOCODE_TRUST_ALL_DIRS',
  'THEOKIT_TRUST_ALL_DIRS',
  'THEOCODE_HOME',
  'THEOKIT_HOME',
  'THEOKIT_AUTH_HOME',
] as const

interface MutableEnv {
  [key: string]: string | undefined
}

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
    SOVEREIGN_KEYS.map((k) => [k, env[k]] as const),
  )

  try {
    load()
  } catch {
    return
  }

  for (const [key, realValue] of sovereign) {
    if (realValue === undefined) delete env[key]
    else env[key] = realValue
  }
}
