import { Agent, buildModelSelection, reasoningEffortOf } from '@theokit/agents'
import type { CustomTool, HookHandlers, SDKAgent, SubagentDefinition } from '@theokit/agents'

import { discoverRoles } from './role-discovery.js'
import { ConfigurationError } from '@theokit/agents'
import type { SandboxBackend } from '@theokit/agents/sandbox'
import { SDK_FOREIGN_SURFACES } from '../setting-sources.js'
import { ToolRegistry, type ToolScope } from '../tools/index.js'
import { hooksForMember } from './hooks-for-member.js'
import { declareAgent, toolsNamed, type SpecContext } from '../composition/agent-spec.js'
import { EFFORT_LEVELS, parseEffort } from '../config/index.js'
import type { ReasoningEffort, TrustPosture } from '../config/index.js'

export const TEAM_ROLES = ['explorer', 'worker'] as const

type AgentOptions = Parameters<typeof Agent.create>[0]

interface RoleConfig {
  name: string
  model?: string
  reasoning_effort?: ReasoningEffort
  sandbox?: boolean
  tools: string[]
}

interface ParentDefaults {
  model: string
  reasoning_effort: ReasoningEffort
}

export interface RoleAgentContext {
  apiKey: string | (() => string | Promise<string>)
  parent: ParentDefaults
  cwd?: string
  writeRoot?: string
  /**
   * B-006 — required, like `ToolScope.sandbox`. While it was optional, a delegated squad member
   * could be handed tools with the sandbox silently omitted: an unconfined shell for a sub-agent,
   * with no error. Every caller builds it from `resolveToolScope`, which always supplies one.
   */
  sandbox: SandboxBackend
  posture: TrustPosture
  hooks?: HookHandlers
  /**
   * B-061 — the seam that makes a role's composition assertable without a credential.
   *
   * Deliberately the SAME shape as `ReviewFactoryDeps.createInstance` (`review/create-agent.ts:42`)
   * rather than a second convention: this repository builds agents at three sites, and two of them
   * now expose the SDK entry the same way. Production callers omit it and get `Agent.create`.
   *
   * A role's tool list IS its authority, and nothing else in the suite reads it. Without a seam the
   * only way to observe what a member was handed is to hold a real key and create a real agent,
   * which is why it had gone unasserted.
   */
  createAgent?: (opts: Parameters<typeof Agent.create>[0]) => Promise<SDKAgent>
}

/**
 * B-059 — a role's tools go through the same composition entry the reviewer uses.
 *
 * The role names come from its `.theokit/agents/<name>.md`, so this is the one of the three sites
 * whose list is DATA rather than source — which is exactly why it must share the entry: the fail-
 * loud resolution and the provenance record apply to a repository-supplied list too.
 */
function resolveRoleTools(
  name: string,
  names: readonly string[],
  opts: ToolScope,
  model: { model: string; reasoning_effort: ReasoningEffort },
): CustomTool[] {
  const registry = new ToolRegistry(opts)
  const ctx: SpecContext = { registry, ...model }
  return [...declareAgent(name, ctx, [toolsNamed(registry, names)]).tools]
}

function roleConfigFrom(def: SubagentDefinition, name = ''): RoleConfig {
  const model = def.model
  const selection = typeof model === 'string' ? undefined : model
  const selectedEffort = selection === undefined ? undefined : reasoningEffortOf(selection)
  return {
    name,
    ...(selection !== undefined ? { model: selection.id } : {}),
    ...(selectedEffort === undefined ? {} : { reasoning_effort: wireEffort(selectedEffort, name) }),
    ...(def.sandbox === undefined ? {} : { sandbox: def.sandbox }),
    tools: [...(def.tools ?? [])],
  }
}

function wireEffort(raw: string, name: string): ReasoningEffort {
  const level = parseEffort(raw)
  if (level === null) {
    throw new ConfigurationError(
      `role "${name}": reasoning_effort "${raw}" is not an accepted level. The levels are ` +
        `${EFFORT_LEVELS.join(', ')}. Fix the \`reasoning_effort:\` in ` +
        `.theokit/agents/${name}.md — the role is NOT materialised with a silently inherited effort, ` +
        'because that would run the subagent at an effort different from the declared one with ' +
        'no warning at all.',
      { code: 'role_reasoning_effort_invalid' },
    )
  }
  return level
}

function unresolvedRole(name: string, posture: TrustPosture): ConfigurationError {
  if (!posture.allows.subagents) {
    return new ConfigurationError(
      `role "${name}" could not be loaded: the \`project\` subagent source is OFF ` +
        `because this directory is NOT trusted. In that state a repository \`.theokit/agents/${name}.md\` ` +
        `is not read — whether it exists or not. Your OWN \`~/.theokit/agents/${name}.md\` is read ` +
        `regardless, so defining the role there is the other way out. Trust this directory (the TUI ` +
        `asks on the first run) to enable project roles. For CI, set the trust-all-directories ` +
        `environment variable — see \`config/env-knobs.ts\`, which is the registry of every knob.`,
      { code: 'role_source_untrusted' },
    )
  }
  // #65 — naming both roots, because both are searched now. "is not in .theokit/agents" sent the
  // reader to look in one place when the definition could belong in either.
  return new ConfigurationError(
    `role "${name}" is not in .theokit/agents — neither this project's nor your own`,
    { code: 'role_not_found' },
  )
}

function inheritFromParent(
  role: ReturnType<typeof roleConfigFrom>,
  ctx: RoleAgentContext,
): { cwd: string; writeRoot: string; modelId: string; effort: string } {
  const cwd = ctx.cwd ?? process.cwd()
  return {
    cwd,
    writeRoot: ctx.writeRoot ?? cwd,
    modelId: role.model ?? ctx.parent.model,
    effort: role.reasoning_effort ?? ctx.parent.reasoning_effort,
  }
}

function requireResolvedCredential(apiKey: unknown): string {
  if (typeof apiKey !== 'string') {
    throw new TypeError(
      'roleAgentOptions requires the credential ALREADY RESOLVED — use buildRoleAgent',
    )
  }
  return apiKey
}

async function roleAgentOptions(
  name: string,
  ctx: RoleAgentContext,
): Promise<Parameters<typeof Agent.create>[0]> {
  // #74 — the roots this role may read, decided once and used twice: to FIND its definition, and to
  // tell the child agent what it may read once it exists. They were two answers before, and the
  // child got neither — so a squad member ran with a narrower view of the workspace than the agent
  // that spawned it, and said so once per delegation the moment the SDK's notice reached stderr
  // (usetheokit/theokit-sdk#563).
  // Mutable, because `LocalOptions.settingSources` is — a `readonly` array does not assign to it,
  // and widening the SDK's type from here would be this product deciding a contract it does not own.
  const sources: 'project'[] = ctx.posture.allows.subagents ? ['project'] : []
  // #65 — both roots. The project's is gated by the posture above; the operator's own is not, for
  // the reason `context/user-agents-md.ts` states for instructions. See `role-discovery.ts`.
  const found = await discoverRoles({
    cwd: ctx.cwd ?? process.cwd(),
    projectAllowed: ctx.posture.allows.subagents,
  })
  const def = found[name]
  if (def === undefined) throw unresolvedRole(name, ctx.posture)
  const role = roleConfigFrom(def, name)
  const { cwd, writeRoot, modelId, effort } = inheritFromParent(role, ctx)
  const hooksPlugin = ctx.hooks !== undefined ? hooksForMember(ctx.hooks) : undefined
  return {
    apiKey: requireResolvedCredential(ctx.apiKey),
    model: buildModelSelection(modelId, effort),
    // #80 — the framework registers a `shell` tool for every local agent whether or not the caller
    // asks, "including when you pass `tools: []`" (`LocalOptions` docblock, `@theokit/sdk@5.0.1`).
    // A role therefore carried authority its definition never granted: measured on the built binary,
    // a child declared with three read tools enumerated `shell` first in its catalog, while the test
    // asserting its declared list went on passing. The list was right; the catalog was not.
    //
    // Safe for the roles that legitimately execute: this product's shell is the CUSTOM `run_shell`,
    // resolved per role from the registry under a different name. What goes is only the builtin
    // nobody declared, and a role that lost a tool it needed would fail loudly rather than quietly —
    // the right direction for this to be wrong in.
    withheldBuiltinTools: ['shell' as const],
    local: {
      cwd,
      settingSources: sources,
      // The foreign dialect travels WITH the native one and never past it: `.claude/` is
      // repository-controlled and holds a `hooks.json` that executes shell, so the second root takes
      // the evidence the first one takes — the rule `setting-sources.ts` states for the parent,
      // applied to the child that inherits its workspace.
      // #188 — the child carries the parent's declaration, not a fourth wide literal. Before this
      // the list could name a surface while a delegated role admitted all of them.
      ...(sources.length > 0
        ? { compatSources: [{ kind: 'claude-code' as const, import: SDK_FOREIGN_SURFACES }] }
        : {}),
      ...(role.sandbox !== undefined ? { sandboxOptions: { enabled: role.sandbox } } : {}),
    },
    tools: resolveRoleTools(
      name,
      role.tools,
      { cwd, writeRoot, sandbox: ctx.sandbox },
      { model: modelId, reasoning_effort: effort as ReasoningEffort },
    ),
    ...(hooksPlugin !== undefined
      ? { plugins: [hooksPlugin] as unknown as AgentOptions['plugins'] }
      : {}),
  }
}

export async function buildRoleAgent(name: string, ctx: RoleAgentContext): Promise<SDKAgent> {
  const apiKey = typeof ctx.apiKey === 'function' ? await ctx.apiKey() : ctx.apiKey
  const create = ctx.createAgent ?? Agent.create
  return create(await roleAgentOptions(name, { ...ctx, apiKey }))
}
