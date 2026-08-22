/**
 * Which configuration a deploy target's emitted handler actually applies.
 *
 * `theo.config.ts` validates `rateLimit`, `security.cors`, `security.csrf`,
 * `security.disallowed` and `serialization` for every target. Applying them is
 * the handler's job, and the six Web-standards adapters build `executeRoute`'s
 * context from a subset of its fields, so the rest fall back to hard-coded
 * defaults on a deployed app (usetheokit/theokit#410). `security.cors` was read
 * only by the dev server until #409 wired it into `theokit start`; the six Web
 * targets still drop it.
 *
 * This module does not fix that. It makes it **audible at build time**: a
 * config key that is parsed and then dropped is named, with the target that
 * drops it and the next action. Silence was the defect — an operator who
 * declares a rate limit and gets none has no reason to look.
 *
 * It warns rather than refuses, deliberately. Refusing would break every
 * deployment that declares `rateLimit` today, and the real fix — wiring a
 * limiter that needs a per-runtime client address — is not a build away
 * (`docs/program/journeys/j07-rate-limit.md` § Correction measured what it
 * costs). Forcing an operator to delete valid configuration in order to ship
 * would trade a silent gap for a loud one that also loses information.
 */
import type { TheoConfig } from '../config/schema.js'

import { nodeAdapter } from './node.js'
import type { ConfigConcern, DeployAdapter } from './types.js'

/**
 * The closed set. A concern belongs here when it is (a) declarable in
 * `theo.config.ts` and (b) applied by a request handler rather than at build
 * time — a build-time key cannot be silently dropped by a runtime.
 */
export const CONFIG_CONCERNS = [
  'rateLimit',
  'cors',
  'csrf',
  'disallowed',
  'serialization',
  'plugins',
  'securityHeaders',
] as const satisfies readonly ConfigConcern[]

/**
 * Does any production target apply this concern?
 *
 * DERIVED from what the `node` adapter declares, rather than listed. This was a hand-maintained
 * `APPLIED_BY_NO_TARGET` set holding `cors`, kept in step with `nodeAdapter.appliesConfig` by a
 * test — and #409, which taught `theokit start` to apply `cors`, emptied it. An empty hardcoded
 * set is not merely redundant: it makes the branch below provably unreachable, which the linter
 * says out loud (`sonarjs/no-empty-collection`).
 *
 * Deriving keeps the branch honest AND reachable: the moment a concern is added that `node` does
 * not apply, the advice stops claiming a target exists for it, with nothing to remember.
 */
function appliedByNoTarget(concern: ConfigConcern): boolean {
  const applied = nodeAdapter.appliesConfig
  if (applied === undefined || applied === 'runtime-not-emitted-here') return true
  return !applied.includes(concern)
}

/** Where each concern lives in the config, for a message the operator can grep. */
const CONFIG_KEY: Record<ConfigConcern, string> = {
  rateLimit: 'rateLimit',
  cors: 'security.cors',
  csrf: 'security.csrf',
  disallowed: 'security.disallowed',
  serialization: 'serialization',
  plugins: 'plugins',
  securityHeaders: 'security.headers',
}

function isDeclared(config: TheoConfig, concern: ConfigConcern): boolean {
  const security = config.security
  switch (concern) {
    case 'rateLimit':
      return config.rateLimit !== undefined
    case 'cors':
      return security?.cors !== undefined
    case 'csrf':
      // `csrf` carries `.default('strict')` (config/schemas/security.ts:100) and
      // the deployed fallback is also `'strict'` (server/http/execute.ts:144).
      // A config that says `'strict'` therefore gets what it asked for, by
      // coincidence rather than by wiring -- reporting it dropped would be noise
      // over an identical outcome. Only a weaker setting is silently ignored.
      return security?.csrf !== undefined && security.csrf !== 'strict'
    case 'disallowed':
      return security?.disallowed !== undefined && security.disallowed.routes.length > 0
    case 'securityHeaders':
      return security?.headers !== undefined
    case 'serialization':
      // Same shape: `.default('json')` (config/schema.ts:147), and a target with
      // no transformer serializes as JSON. `'json'` is honoured by coincidence;
      // `'superjson'` is the case where the deployed app quietly disagrees with
      // the file.
      return config.serialization !== 'json'
    case 'plugins':
      return config.plugins !== undefined && config.plugins.length > 0
  }
}

/**
 * The concerns this config declares and this adapter does not apply.
 *
 * An adapter that emits no request handler of its own answers
 * `'runtime-not-emitted-here'` and is never reported against: it is not that
 * the configuration is dropped, it is that this build cannot know. Saying
 * nothing is the honest output, and it is a different fact from saying no.
 */
export function findUnappliedConfig(
  config: TheoConfig,
  adapter: Pick<DeployAdapter, 'appliesConfig'>,
): ConfigConcern[] {
  const applied = adapter.appliesConfig ?? []
  if (applied === 'runtime-not-emitted-here') return []
  return CONFIG_CONCERNS.filter(
    (concern) => isDeclared(config, concern) && !applied.includes(concern),
  )
}

/**
 * The build-time message. Empty string when nothing was dropped, so the caller
 * neither branches nor prints a header over an empty list.
 */
export function describeUnappliedConfig(target: string, dropped: readonly ConfigConcern[]): string {
  if (dropped.length === 0) return ''
  const one = dropped.length === 1
  const list = dropped.map((concern) => `      - ${CONFIG_KEY[concern]}`).join('\n')
  const elsewhere = dropped.filter((concern) => !appliedByNoTarget(concern))
  const nowhere = dropped.filter(appliedByNoTarget)

  // The advice has to change with the target, or it degenerates. Building for
  // `node` with only `security.cors` dropped once produced "deploy to `node`,
  // which applies all of the above except security.cors" -- an instruction to
  // do what you are already doing, about the one key it then excepts.
  const actions: string[] = []
  if (elsewhere.length > 0 && target !== 'node') {
    actions.push(
      `    - ${elsewhere.map((c) => CONFIG_KEY[c]).join(', ')}: build for \`node\` and run \`theokit start\`,`,
      `      which applies ${elsewhere.length === 1 ? 'it' : 'them'}; or remove ${elsewhere.length === 1 ? 'it' : 'them'} so the file states what runs.`,
    )
  } else if (elsewhere.length > 0) {
    actions.push(
      `    - ${elsewhere.map((c) => CONFIG_KEY[c]).join(', ')}: remove ${elsewhere.length === 1 ? 'it' : 'them'} so the file states what runs.`,
    )
  }
  if (nowhere.length > 0) {
    actions.push(
      `    - ${nowhere.map((c) => CONFIG_KEY[c]).join(', ')}: no production target applies ${nowhere.length === 1 ? 'this' : 'these'} today`,
      `      (usetheokit/theokit#409) -- terminate it in front of the app, or remove it.`,
    )
  }

  return [
    `  ! ${String(dropped.length)} configuration ${one ? 'key is' : 'keys are'} validated and NOT applied on \`${target}\`:`,
    list,
    `    The handler this target emits never reads ${one ? 'it' : 'them'}, so the deployed app`,
    `    behaves as if ${one ? 'the key were' : 'the keys were'} absent.`,
    `    What to do:`,
    ...actions,
    `    Tracked: usetheokit/theokit#410 (deploy targets), usetheokit/theokit#409 (cors).`,
  ].join('\n')
}

/**
 * Emit the warning, if there is one. The sink is injected so the behaviour is
 * exercisable without driving a whole build: the alternative was a caller that
 * only a full `theokit build` could reach, which in practice means a caller
 * nothing tests.
 */
export function warnUnappliedConfig(
  config: TheoConfig,
  adapter: Pick<DeployAdapter, 'appliesConfig'>,
  target: string,
  log: (message: string) => void,
): void {
  const dropped = findUnappliedConfig(config, adapter)
  if (dropped.length === 0) return
  log(`\n${describeUnappliedConfig(target, dropped)}\n`)
}
