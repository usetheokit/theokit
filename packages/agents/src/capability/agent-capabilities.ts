import type { CompiledAgentOptions } from '../bridge/agent-compiler.js'
import {
  compileContextWindow,
  type ContextWindowOptions,
} from '../bridge/compile-context-window.js'
import { compileSkills, type SkillsOptions } from '../bridge/compile-skills.js'

import { ConfigurationError } from './capabilities.js'
import { type Capability, type CompiledAgentOptionsDraft, setOnce } from './capability.js'

/**
 * M53 — the capabilities that replace the waist-bound agent decorators, one per field the decorator
 * pipeline produces today (`docs/agents/decorator-to-capability.md` § A).
 *
 * Most are pure assignment: a class per field would be 13 near-identical classes, which ADR 0001 § 4
 * already rejects as ceremony. They are built by one factory instead; the two that carry real
 * behavior (`AgentConfigCapability`, `MainLoopCapability`) are written out.
 */

/**
 * A capability for a waist field that is pure data — no validation, no merge, no precedence.
 * The declared field name doubles as the capability's identity in `provenance` and conflicts.
 */
function fieldCapability<K extends keyof CompiledAgentOptionsDraft>(
  name: string,
  field: K,
): (value: NonNullable<CompiledAgentOptionsDraft[K]>) => Capability {
  return (value) => ({
    name,
    apply: (draft) => {
      setOnce(draft, field, value as CompiledAgentOptionsDraft[K], name)
    },
  })
}

/** `@Memory` → `memory`. */
export const memory = fieldCapability('memory', 'memory')
/**
 * `@ContextWindow` → `context`. DELEGATES to `compileContextWindow`, which is the canonical
 * `ContextWindowOptions → ContextSettings` conversion (it also reports the metadata-only knobs).
 * Taking a pre-converted value here would duplicate that knowledge — the exact divergence the M52
 * zero-behavior proof caught in `skills`.
 */
export const contextWindow = (options: ContextWindowOptions): Capability => ({
  name: 'context-window',
  apply: (draft) => {
    setOnce(draft, 'context', compileContextWindow(options).context, 'context-window')
  },
})
/** `@ProjectContext` → `projectContext`. */
export const projectContext = fieldCapability('project-context', 'projectContext')
/** `@MCP` → `mcpServers`. */
export const mcpServers = fieldCapability('mcp', 'mcpServers')
/** `@Guardrails` → `guardrails`. */
export const guardrails = fieldCapability('guardrails', 'guardrails')
/** `@Checkpoint` → `checkpoint`. */
export const checkpoint = fieldCapability('checkpoint', 'checkpoint')
/** `@HumanInTheLoop` → `hitl` (keyed `"<toolbox>.<tool>"`, as `compileHitlGates` keys it today). */
export const humanInTheLoop = fieldCapability('human-in-the-loop', 'hitl')
/**
 * `@SubAgents` → `agents`. MERGES instead of `setOnce`: `agents` is a pre-seeded collection on the
 * draft (`createDraft` gives it `{}`), so a `setOnce` would conflict against the seed itself — the
 * same trap the pre-seeded `stream` sprang in M52. Merging also lets a preset declare a baseline
 * child set that a call site extends.
 */
export const subAgents = (children: CompiledAgentOptions['agents']): Capability => ({
  name: 'sub-agents',
  apply: (draft) => {
    for (const [name, child] of Object.entries(children)) {
      if (name in draft.agents && draft.agents[name] !== child) {
        throw new ConfigurationError(
          `sub-agents: filho "${name}" declarado duas vezes com definições diferentes`,
        )
      }
      draft.agents[name] = child
    }
    draft.provenance.push({ capability: 'sub-agents', contributed: ['agents'] })
  },
})
/**
 * `@Skills({ include, autoDiscover })` → `skills`. Delegates to `compileSkills` (same reason as
 * `contextWindow`). Distinct from the M52 `skills([...])`, which takes the plain name/inline list.
 */
export const skillsOptions = (options: SkillsOptions): Capability => ({
  name: 'skills',
  apply: (draft) => {
    setOnce(draft, 'skills', compileSkills(options), 'skills')
  },
})

/** Functional-path fields that had no decorator source — closing the gap list, not adding surface. */
export const settingSources = fieldCapability('setting-sources', 'settingSources')
export const plugins = fieldCapability('plugins', 'plugins')
export const runContext = fieldCapability('run-context', 'runContext')
export const skillsResolver = fieldCapability('skills-resolver', 'skillsResolver')

/** The scalar half of `@Agent` (its `name`/`route` are HTTP concerns, never agent config). */
export interface AgentConfig {
  readonly systemPrompt?: CompiledAgentOptions['systemPrompt']
  readonly parseThinkTags?: boolean
  readonly stripToolDialect?: boolean
  readonly recoverLeakedToolCalls?: boolean
  readonly stream?: boolean
  readonly maxIterations?: number
  readonly timeoutMs?: number
}

/**
 * `@Agent({...})` → the scalar waist fields. CLASS, not a factory: it validates, and it is the one
 * capability that writes fields another capability may legitimately override (see
 * {@link MainLoopCapability}).
 */
export class AgentConfigCapability implements Capability {
  readonly name = 'agent-config'
  constructor(private readonly config: AgentConfig) {
    // The registry hands this `unknown` straight from a config file, so the guard is real at
    // runtime even though the declared type makes it look redundant to the compiler.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- boundary check: the value may not be an object at runtime
    if (typeof config !== 'object' || config === null) {
      throw new ConfigurationError('agent-config: esperava um objeto de configuração')
    }
    for (const field of ['maxIterations', 'timeoutMs'] as const) {
      const value = config[field]
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new ConfigurationError(`agent-config: \`${field}\` deve ser um número positivo`)
      }
    }
  }

  apply(draft: CompiledAgentOptionsDraft): void {
    // `maxIterations`/`timeoutMs` are the two fields `main-loop` outranks (see MainLoopCapability).
    // Skipping them when main-loop already contributed makes the precedence ORDER-INDEPENDENT while
    // still letting two agent-config declarations conflict with each other.
    const claimedByMainLoop = (field: string): boolean =>
      draft.provenance.some((p) => p.capability === 'main-loop' && p.contributed.includes(field))
    if (!claimedByMainLoop('maxIterations')) {
      setOnce(draft, 'maxIterations', this.config.maxIterations, this.name)
    }
    if (!claimedByMainLoop('timeoutMs')) {
      setOnce(draft, 'timeoutMs', this.config.timeoutMs, this.name)
    }
    setOnce(draft, 'systemPrompt', this.config.systemPrompt, this.name)
    setOnce(draft, 'parseThinkTags', this.config.parseThinkTags, this.name)
    setOnce(draft, 'stripToolDialect', this.config.stripToolDialect, this.name)
    setOnce(draft, 'recoverLeakedToolCalls', this.config.recoverLeakedToolCalls, this.name)
    setOnce(draft, 'stream', this.config.stream, this.name)
  }
}

/**
 * `@MainLoop({ maxIterations, timeoutMs })` → the same two fields `@Agent` can write.
 *
 * PRECEDENCE, preserved deliberately: `compileAgent` resolves these as
 * `mainLoop.x ?? agentConfig.x` — the main-loop declaration WINS when both are present. A plain
 * `setOnce` would raise a conflict where the pipeline has a defined winner, so this capability
 * OVERRIDES instead. That is the one place in the layer where a later write beats an earlier one,
 * and it exists to keep behavior identical, not for convenience.
 */
export class MainLoopCapability implements Capability {
  readonly name = 'main-loop'
  constructor(private readonly config: { maxIterations?: number; timeoutMs?: number }) {}

  apply(draft: CompiledAgentOptionsDraft): void {
    const contributed: string[] = []
    if (this.config.maxIterations !== undefined) {
      draft.maxIterations = this.config.maxIterations
      contributed.push('maxIterations')
    }
    if (this.config.timeoutMs !== undefined) {
      draft.timeoutMs = this.config.timeoutMs
      contributed.push('timeoutMs')
    }
    if (contributed.length > 0) draft.provenance.push({ capability: this.name, contributed })
  }
}
