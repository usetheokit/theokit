/* eslint-disable security/detect-non-literal-fs-filename --
 * Config loader. Reads `theo.config.{ts,js,mjs}` under the user's `cwd`.
 * Names are a fixed set of literals; `cwd` is a CLI arg resolved to
 * absolute. Build-time tool — no HTTP input.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { TheoConfigError } from './errors.js'
import { importUserModule } from './import-user-module.js'
import { loadEnv } from './load-env.js'
import { theoConfigSchema } from './schema.js'
import type { TheoConfig } from './schema.js'

const CONFIG_FILE = 'theo.config.ts'

/**
 * Deep merges two plain objects. Override values take precedence.
 * Arrays are replaced (not concatenated).
 * Protects against prototype pollution (EC-4).
 */
export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    // EC-4: Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue

    const baseVal = base[key]
    const overVal = override[key]

    if (
      overVal !== null &&
      typeof overVal === 'object' &&
      !Array.isArray(overVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      )
    } else {
      result[key] = overVal
    }
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The config object a config module exports by default.
 *
 * #1100 — on a Node that cannot strip types, tsx compiles a `.ts` config in a package without
 * `"type": "module"` as CommonJS, and the namespace arrives as `{ default: { default: config } }`.
 * Reading one level handed the schema `{ default: config }`; the schema drops unknown keys, so
 * every command ran on the defaults and said nothing. A wrapper (`default`, optionally with
 * `__esModule`) is unwrapped; a `default` key next to anything else is a shape this loader does not
 * understand, and it says so rather than guessing.
 */
function readDefaultExport(
  mod: Record<string, unknown>,
  filePath: string,
): Record<string, unknown> {
  let value = mod.default
  while (
    isRecord(value) &&
    Object.hasOwn(value, 'default') &&
    Object.keys(value).every((key) => key === 'default' || key === '__esModule')
  ) {
    value = value.default
  }

  if (!isRecord(value)) {
    throw new TheoConfigError(
      [
        {
          field: '_export',
          message: 'theo.config.ts must use export default defineConfig({...})',
        },
      ],
      filePath,
    )
  }
  if (Object.hasOwn(value, 'default')) {
    throw new TheoConfigError(
      [
        {
          field: '_export',
          message:
            'the default export carries a `default` key beside other keys, which is not a config ' +
            'object. Export the config itself: export default config()...build()',
        },
      ],
      filePath,
    )
  }
  return value
}

export async function loadConfig(dir: string): Promise<TheoConfig> {
  // T1.3 — Load .env BEFORE reading theo.config.ts. Defensive: CLI commands
  // (dev/build/start) already call loadEnv() first, but programmatic users
  // who call loadConfig directly (tests, custom scripts) need this too.
  // Module-level cache makes the second call a Map-lookup (no FS).
  loadEnv({ cwd: dir })

  const configPath = resolve(dir, CONFIG_FILE)

  if (!existsSync(configPath)) {
    return theoConfigSchema.parse({})
  }

  let mod: Record<string, unknown>
  try {
    mod = await importUserModule(configPath)
  } catch (err) {
    throw new TheoConfigError([{ field: '_file', message: (err as Error).message }], configPath)
  }

  // Merge with per-environment config if NODE_ENV is set
  let rawConfig = readDefaultExport(mod, configPath)
  const nodeEnv = process.env.NODE_ENV

  if (nodeEnv) {
    const envFile = `theo.config.${nodeEnv}.ts`
    const envPath = resolve(dir, envFile)

    if (existsSync(envPath)) {
      let envMod: Record<string, unknown>
      try {
        envMod = await importUserModule(envPath)
      } catch (err) {
        throw new TheoConfigError([{ field: '_file', message: (err as Error).message }], envPath)
      }
      rawConfig = deepMerge(rawConfig, readDefaultExport(envMod, envPath))
    }
  }

  const result = theoConfigSchema.safeParse(rawConfig)

  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }))
    throw new TheoConfigError(issues, configPath)
  }

  return result.data
}
