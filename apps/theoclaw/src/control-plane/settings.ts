import { type BindEnvironment, parsePort, resolveBindAddress } from './bind.js'
import { TheoClawConfigError } from './errors.js'

/** Everything the control plane reads from its environment, read once at start. */
export interface ControlPlaneSettings {
  readonly host: string
  readonly port: number
  readonly model: string
  readonly modelKey: string
  /** `undefined` when `THEOCLAW_CONTROL_TOKEN` is unset or empty: the control socket is then off. */
  readonly controlToken: string | undefined
}

/** The shortest control token accepted; the control socket checks the same constant. */
export const MIN_CONTROL_TOKEN_LENGTH = 32

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * The key the SDK is given: `THEOKIT_API_KEY`, else `OPENROUTER_API_KEY`, a blank value counting as
 * unset. The one place the precedence lives, read by the settings and by the agent factory (plan D4).
 */
export function resolveModelKey(env: BindEnvironment): string | undefined {
  return nonBlank(env.THEOKIT_API_KEY) ?? nonBlank(env.OPENROUTER_API_KEY)
}

/**
 * The model and its key, or the refusal naming what is missing. Shared by the start and the agent
 * factory, so both refuse with the same words.
 */
export function requireModel(env: BindEnvironment): { readonly model: string; readonly modelKey: string } {
  const model = nonBlank(env.THEOCLAW_MODEL)
  if (model === undefined) {
    throw new TheoClawConfigError('THEOCLAW_MODEL must name the model TheoClaw runs', {
      variable: 'THEOCLAW_MODEL',
    })
  }
  const modelKey = resolveModelKey(env)
  if (modelKey === undefined) {
    // `variable` names the preferred of the two; the message names both.
    throw new TheoClawConfigError('set THEOKIT_API_KEY or OPENROUTER_API_KEY to the model key', {
      variable: 'THEOKIT_API_KEY',
    })
  }
  return { model, modelKey }
}

function readControlToken(env: BindEnvironment): string | undefined {
  const token = env.THEOCLAW_CONTROL_TOKEN
  if (token === undefined || token === '') return undefined
  // A token padded with whitespace is almost always an env file's trailing newline or a quoting
  // slip, and 32 spaces would otherwise switch the socket on. Refused rather than trimmed, so the
  // value the operator's client sends is the value compared.
  if (token.trim() !== token) {
    throw new TheoClawConfigError('THEOCLAW_CONTROL_TOKEN must not begin or end with whitespace', {
      variable: 'THEOCLAW_CONTROL_TOKEN',
    })
  }
  if (token.length < MIN_CONTROL_TOKEN_LENGTH) {
    throw new TheoClawConfigError(
      `THEOCLAW_CONTROL_TOKEN must be at least ${MIN_CONTROL_TOKEN_LENGTH} characters`,
      { variable: 'THEOCLAW_CONTROL_TOKEN' },
    )
  }
  return token
}

/**
 * Read and check the control plane's settings, in a fixed order: model, model key, port, control
 * token, bind address. The first bad value throws (`TheoClawConfigError` naming its variable, or
 * `TheoClawBindError`), so nothing opens on a configuration that cannot serve a turn. No message
 * contains a value: the key and the token are secrets, and the others would teach a log to hold them.
 */
export function readControlPlaneSettings(env: BindEnvironment): ControlPlaneSettings {
  const { model, modelKey } = requireModel(env)
  const port = parsePort(env.THEOCLAW_PORT)
  const controlToken = readControlToken(env)
  return { host: resolveBindAddress(env), port, model, modelKey, controlToken }
}
