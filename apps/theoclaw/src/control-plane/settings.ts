import {
  CredentialNotFoundError,
  isSubscriptionRoute,
  resolveAgentCredential,
  type CredentialProviderDescriptor as ProviderDescriptor,
} from '@theokit/agents/auth'

import { parseThinkingLevel } from '../agent/create-agent.js'
import { customProviderOf, parseCustomProviders } from '../agent/custom-providers.js'
import { readBearerToken } from './bearer.js'
import { type BindEnvironment, parsePort, resolveControlHost } from './bind.js'
import { TheoClawConfigError } from './errors.js'

/** Everything the control plane reads from its environment, read once at start. */
export interface ControlPlaneSettings {
  readonly host: string
  readonly port: number
  readonly model: string
  readonly modelKey: string
  /** `undefined` when `THEOCLAW_CONTROL_TOKEN` is unset or empty: the control socket is then off. */
  readonly controlToken: string | undefined
  /** `undefined` when `THEOCLAW_WEBCHAT_TOKEN` is unset or empty: `/webchat` is then off. */
  readonly webchatToken: string | undefined
}

const KEYLESS_MODEL_KEY = 'local'

/** The default route's keys, in order; any key shape, as before (no `keyPrefix`). */
const DEFAULT_KEY_PROVIDERS: readonly ProviderDescriptor[] = [
  { name: 'theokit', envKey: 'THEOKIT_API_KEY', priority: 0, custom: true },
  { name: 'openrouter', envKey: 'OPENROUTER_API_KEY', priority: 1, custom: true },
]

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * The key the SDK is given: `THEOKIT_API_KEY`, else `OPENROUTER_API_KEY`, a blank value counting as
 * unset. The one place the precedence lives, read by the settings and by the agent factory (plan D4).
 */
export function resolveModelKey(env: BindEnvironment): string | undefined {
  try {
    // No `home`/`store`: TheoClaw does not read the credentials file. No `model`: the key never
    // depends on a prefix. The pin variable is one nobody sets, so a stray THEOKIT_PROVIDER is inert.
    return resolveAgentCredential({
      env: {
        THEOKIT_API_KEY: nonBlank(env.THEOKIT_API_KEY),
        OPENROUTER_API_KEY: nonBlank(env.OPENROUTER_API_KEY),
      },
      providers: DEFAULT_KEY_PROVIDERS,
      declaredProviderEnvVar: 'THEOCLAW_NO_PROVIDER_PIN',
    }).apiKey
  } catch (error) {
    if (error instanceof CredentialNotFoundError) return undefined
    throw error
  }
}

/**
 * The model and its key, or the refusal naming what is missing. Shared by the start and the agent
 * factory, so both refuse with the same words.
 */
export function requireModel(env: BindEnvironment): {
  readonly model: string
  readonly modelKey: string
} {
  const model = nonBlank(env.THEOCLAW_MODEL)
  if (model === undefined) {
    throw new TheoClawConfigError('THEOCLAW_MODEL must name the model TheoClaw runs', {
      variable: 'THEOCLAW_MODEL',
    })
  }
  // A model on a registered custom provider (THEOCLAW_PROVIDERS) runs on that provider's own key.
  const custom = customProviderOf(env, model)
  if (custom !== undefined) {
    if (nonBlank(env[custom.keyEnv]) === undefined) {
      throw new TheoClawConfigError(`set ${custom.keyEnv} to the ${custom.name} provider key`, {
        variable: custom.keyEnv,
      })
    }
    // The framework chain: the custom provider's own variable, for a model carrying its prefix.
    const { apiKey } = resolveAgentCredential({
      env,
      model,
      customProviders: parseCustomProviders(env),
    })
    return { model, modelKey: apiKey }
  }
  // The ChatGPT subscription route authenticates with the stored login, so it needs no API key. 'local'
  // is the SDK's keyless sentinel: it builds the agent and never reaches a provider as a credential.
  if (isSubscriptionRoute(model))
    return { model, modelKey: resolveModelKey(env) ?? KEYLESS_MODEL_KEY }
  const modelKey = resolveModelKey(env)
  if (modelKey === undefined) {
    // `variable` names the preferred of the two; the message names both.
    throw new TheoClawConfigError('set THEOKIT_API_KEY or OPENROUTER_API_KEY to the model key', {
      variable: 'THEOKIT_API_KEY',
    })
  }
  return { model, modelKey }
}

/**
 * Read and check the control plane's settings, in a fixed order: model, model key, port, control
 * token, WebChat token, bind address. The first bad value throws (`TheoClawConfigError` naming its variable, or
 * `TheoClawBindError`), so nothing opens on a configuration that cannot serve a turn. No message
 * contains a value: the key and the token are secrets, and the others would teach a log to hold them.
 */
export function readControlPlaneSettings(env: BindEnvironment): ControlPlaneSettings {
  const { model, modelKey } = requireModel(env)
  try {
    parseThinkingLevel(env.THEOCLAW_THINKING)
  } catch (error) {
    throw new TheoClawConfigError(error instanceof Error ? error.message : 'THEOCLAW_THINKING is invalid', { variable: 'THEOCLAW_THINKING' })
  }
  const port = parsePort(env.THEOCLAW_PORT)
  const controlToken = readBearerToken(env, 'THEOCLAW_CONTROL_TOKEN')
  const webchatToken = readBearerToken(env, 'THEOCLAW_WEBCHAT_TOKEN')
  return { host: resolveControlHost(env), port, model, modelKey, controlToken, webchatToken }
}
