/**
 * B-097 — the DERIVATION is `@theokit/sdk`'s: pick a level, and gate every declared capability on
 * it, with `allows` built FROM the declared list so a ninth capability cannot be forgotten. What
 * stays here is everything that is this product's: the eight capabilities and what withholding each
 * one actually costs, the environment variable's name, its deprecated alias, and where the operator
 * records a trusted directory.
 */
import {
  resolveTrustPosture as resolvePosture,
  type TrustPosture as SdkTrustPosture,
} from '@theokit/agents'

import { ENV_TRUST_ALL_DIRS, ENV_TRUST_ALL_DIRS_LEGACY } from './env-knobs.js'
import { isTrusted, trustStorePath } from './trust-store.js'

export interface TrustCapability {
  readonly key: string
  readonly loaders: readonly string[]
  readonly effect: string
}

export const TRUST_CAPABILITIES = [
  {
    key: 'projectConfig',
    loaders: [],
    effect:
      'The project layer of `config.toml` is not read: the repository model, effort, `sandbox_mode`, `approval_policy` and hook list stop applying.',
  },
  {
    key: 'agentsMd',
    loaders: ['loadAgentsMd', 'loadRules'],
    effect:
      'The project `AGENTS.md` and `.theokit/rules/` do not enter the persona — this is the direct defence against a repository trying to hijack the agent through instructions.',
  },
  {
    key: 'hooks',
    loaders: ['buildHookHandlers'],
    effect:
      'No repository `[[hooks]]` enters the handler set: a hook is arbitrary command execution on every tool call.',
  },
  {
    key: 'memory',
    loaders: [],
    effect:
      'Durable memory stays off — the store WRITES into `.theokit/memory/` inside the cwd, and recall is auto-injected into the prompt.',
  },
  {
    key: 'mcp',
    loaders: ['loadMcpJson'],
    effect:
      'No `.mcp.json` server is started. They are external processes SPAWNED while the agent is built, before any per-tool approval.',
  },
  {
    key: 'skills',
    loaders: [],
    effect:
      'No skill from `.theokit/skills/<name>/SKILL.md` is loaded — a repository `SKILL.md` is instruction that steers the model.',
  },
  {
    key: 'customCommands',
    loaders: ['loadCustomCommands'],
    effect:
      'Commands from `<cwd>/.theokit/commands/` are not loaded — the `!cmd` body of a project command runs a shell while the prompt is being built. The own commands of the user (`~/.theokit/commands/`) still apply.',
  },
  {
    key: 'subagents',
    loaders: ['discoverSubagents'],
    effect:
      'The `project` source is dropped entirely: a repository `.theokit/agents/<role>.md` no longer redirects the model, the effort or the `sandbox` of a squad member. The source is shared with `hooks` — enabling it also loads repository-declared hooks through the SDK — so it requires BOTH capabilities (see `config/project-source.ts`).',
  },
] as const satisfies readonly TrustCapability[]

type TrustCapabilityKey = (typeof TRUST_CAPABILITIES)[number]['key']

export type TrustPosture = SdkTrustPosture<TrustCapabilityKey>

let aliasAlreadyWarned = false

function warnAboutTheAlias(): void {
  if (aliasAlreadyWarned) return
  aliasAlreadyWarned = true
  process.stderr.write(
    // B-046 — this used to promise removal "in M99". There is no ROADMAP.md in this repository and
    // no milestone by that name, so the promise named a date that did not exist. A deprecation
    // warning that cites nothing is more honest than one that cites a fiction.
    `[trust] ${ENV_TRUST_ALL_DIRS_LEGACY} is DEPRECATED: rename it to ${ENV_TRUST_ALL_DIRS}. ` +
      `Until you do, it keeps granting trust to EVERY directory — the defence against a hostile ` +
      `repository stays off.\n`,
  )
}

/**
 * Whether the operator switched trust on for EVERY directory, in this product's own vocabulary.
 *
 * `false` means "did not switch it on", never "switched it off" — an unset variable must not
 * override a directory the operator recorded as trusted.
 */
function environmentGrantsTrust(env: Record<string, string | undefined>): boolean {
  if (env[ENV_TRUST_ALL_DIRS] === '1') return true
  if (env[ENV_TRUST_ALL_DIRS_LEGACY] === '1') {
    warnAboutTheAlias()
    return true
  }
  return false
}

/**
 * B-033 — `env` reaches HERE, which is the only entry any caller can use.
 *
 * B-006 added the parameter to the private `trustOrigin` and this function kept calling it with two
 * arguments, so the seam existed and was unreachable: all nine production call sites read the
 * ambient environment. `cli/run-composition.ts` then took the posture from the ambient environment
 * and passed `seams.env` into config resolution on the next line — one run, two sources, for the
 * decision that governs whether a repository's hooks and AGENTS.md are honoured.
 */
export function resolveTrustPosture(
  cwd: string,
  // Resolved from `env` below rather than defaulted here, because a default parameter cannot see a
  // later one. Defaulting to the ambient store while the caller injected an environment would
  // reintroduce the very split B-006 and B-033 closed: one run reading the posture from one source
  // and the configuration it describes from another.
  store: string | undefined = undefined,
  // B-006 — injected so a caller that resolves configuration from an explicit environment gets a
  // trust decision from that same environment. Reading the ambient one meant the posture could
  // disagree with the config it was supposed to describe.
  env: Record<string, string | undefined> = process.env,
): TrustPosture {
  const resolved = store ?? trustStorePath(env)
  return resolvePosture({
    capabilities: TRUST_CAPABILITIES.map((c) => c.key),
    // A function rather than a boolean: it reads the trust store off disk, and the framework skips
    // it entirely when the environment already granted trust.
    isTrusted: () => isTrusted(cwd, resolved),
    envOverride: environmentGrantsTrust(env),
  })
}
