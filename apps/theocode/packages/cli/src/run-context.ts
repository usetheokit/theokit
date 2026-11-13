import {
  trustStorePath,
  resolveEffectiveConfig,
  resolveTrustPosture,
  type EffectiveConfig,
} from '@theocode/agent/config'

import type { CliOverrides } from './runtime/index.js'

/**
 * The seams `run` and `goal` share: where the directory, trust store, operator root and environment
 * come from. Production passes none.
 */
export interface CompositionSeams {
  readonly cwd?: string
  readonly store?: string
  readonly userDir?: string
  readonly env?: Record<string, string | undefined>
}

export interface RunContext {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly store: string
  readonly posture: ReturnType<typeof resolveTrustPosture>
  readonly cfg: EffectiveConfig
}

/**
 * B-033 — one environment feeds posture, store and config. Shared by `run` and `goal` so neither
 * can read one of them from the ambient `process.env` while the other does not.
 */
export function resolveRunContext(overrides: CliOverrides, seams: CompositionSeams = {}): RunContext {
  const cwd = seams.cwd ?? process.cwd()
  const env = seams.env ?? process.env
  const store = seams.store ?? trustStorePath(env)
  const posture = resolveTrustPosture(cwd, store, env)
  const cfg = resolveEffectiveConfig({
    cwd,
    store,
    ...(seams.userDir !== undefined ? { userDir: seams.userDir } : {}),
    env,
    cli: overrides,
  })
  return { cwd, env, store, posture, cfg }
}

/**
 * The model a turn runs on: an explicit `-m` wins over the configured one, and the result is routed
 * for the credential that will serve it. Routing comes AFTER the choice, so `-m` is routed too.
 */
export function routeRequestedModel(
  requested: string | undefined,
  cfg: Pick<EffectiveConfig, 'model'>,
  route?: (model: string) => string,
): string {
  const model = requested ?? cfg.model
  return route === undefined ? model : route(model)
}
