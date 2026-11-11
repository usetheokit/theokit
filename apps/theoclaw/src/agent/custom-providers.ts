import { Provider } from '@theokit/sdk'
import type { Plugin, ProviderProfile } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'

const VARIABLE = 'THEOCLAW_PROVIDERS'
const NAME = /^[a-z][a-z0-9-]*$/
const KEY_ENV = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One OpenAI-compatible provider the operator registers (OC-119, OC-120). */
export interface CustomProvider {
  /** The prefix of `THEOCLAW_MODEL=<name>/<model>`. */
  readonly name: string
  readonly baseUrl: string
  /** The environment variable holding the key; the value is never part of the setting. */
  readonly keyEnv: string
}

function fail(message: string): never {
  throw new TheoClawConfigError(`${VARIABLE} ${message}`, { variable: VARIABLE })
}

/**
 * Read `THEOCLAW_PROVIDERS`: a JSON array of `{ "name", "baseUrl", "keyEnv" }`, e.g.
 * `[{"name":"particle","baseUrl":"https://api.particle.ai/v1","keyEnv":"PARTICLE_API_KEY"}]`.
 * Unset or blank: none. Anything malformed refuses the start, naming the variable and never a value.
 */
export function parseCustomProviders(env: Readonly<Record<string, string | undefined>>): CustomProvider[] {
  const raw = env[VARIABLE]?.trim()
  if (raw === undefined || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('must be a JSON array of { name, baseUrl, keyEnv }')
  }
  if (!Array.isArray(parsed)) return fail('must be a JSON array of { name, baseUrl, keyEnv }')
  const seen = new Set<string>()
  return parsed.map((entry: unknown, index) => {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const { name, baseUrl, keyEnv } = item
    if (typeof name !== 'string' || !NAME.test(name)) return fail(`entry ${index} needs a lowercase name`)
    if (seen.has(name)) return fail(`names ${name} twice`)
    seen.add(name)
    if (typeof baseUrl !== 'string' || !/^https?:\/\/\S+$/.test(baseUrl)) return fail(`entry ${name} needs an http(s) baseUrl`)
    if (typeof keyEnv !== 'string' || !KEY_ENV.test(keyEnv)) return fail(`entry ${name} needs keyEnv, the name of the variable holding its key`)
    return { name, baseUrl, keyEnv }
  })
}

/** The providers as SDK plugins, registered on every agent through `Provider.create`. */
export function customProviderPlugins(providers: readonly CustomProvider[]): Plugin[] {
  return providers.map((provider) => {
    const profile: ProviderProfile = {
      name: provider.name,
      apiMode: 'chat_completions',
      envVars: [provider.keyEnv],
      authType: 'api_key',
      baseUrl: provider.baseUrl.replace(/\/+$/, ''),
      fallbackModels: [],
    }
    return Provider.create(profile)
  })
}

/** The provider `model` (`<name>/<id>`) is routed to, or `undefined` when it is not a custom one. */
export function customProviderOf(env: Readonly<Record<string, string | undefined>>, model: string): CustomProvider | undefined {
  return parseCustomProviders(env).find((provider) => model.startsWith(`${provider.name}/`))
}
