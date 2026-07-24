import type { CompiledAgentOptions } from '../bridge/agent-compiler.js'
import {
  compileContextWindow,
  type ContextWindowOptions,
} from '../bridge/compile-context-window.js'
import { compileSkills, type SkillsOptions } from '../bridge/compile-skills.js'
import { ConfigurationError } from '../errors.js'

import { type Capability, type CompiledAgentOptionsDraft, setOnce } from './capability.js'

/**
 * M53 — the capabilities that replace the waist-bound agent decorators, one per field the decorator
 * pipeline produces today (`docs/agents/decorator-to-capability.md` § A).
 *
 * M57 reverses ADR 0001 § 4 (which kept the pure-assignment ones as a factory function to avoid
 * "13 near-identical classes"): the authoring surface is now 100% classes, aligned with the SDK's
 * `X.create()`/class shape. The `FieldCapability` base keeps the assignment ones DRY (one line each);
 * the behaviour-carrying ones are written out. Rationale in ADR 0005.
 */

/**
 * Base for a capability whose only job is to assign one waist field — no validation, no merge, no
 * precedence. M57: this replaces the `fieldCapability(name, field)` factory function with a class, so
 * the authoring surface is 100% classes (aligned with the SDK's `X.create()` and the existing
 * `ModelCapability`). The subclasses below are one line each; the shared `apply` lives here (DRY).
 * NOT the Template-Method the ADR-0001 refused — that was inheritance of variable *behaviour*
 * (`shouldContinue`); here the base carries *data* (name/field) and `apply` is identical for all.
 */
export abstract class FieldCapability<
  K extends keyof CompiledAgentOptionsDraft,
> implements Capability {
  abstract readonly name: string
  protected abstract readonly field: K
  constructor(private readonly value: NonNullable<CompiledAgentOptionsDraft[K]>) {}
  apply(draft: CompiledAgentOptionsDraft): void {
    setOnce(draft, this.field, this.value as CompiledAgentOptionsDraft[K], this.name)
  }
}

/** `@Memory` → `memory`. */
export class MemoryCapability extends FieldCapability<'memory'> {
  readonly name = 'memory'
  protected readonly field = 'memory' as const
}
/**
 * `@ContextWindow` → `context`. DELEGATES to `compileContextWindow`, which is the canonical
 * `ContextWindowOptions → ContextSettings` conversion (it also reports the metadata-only knobs).
 * Taking a pre-converted value here would duplicate that knowledge — the exact divergence the M52
 * zero-behavior proof caught in `skills`.
 */
export class ContextWindowCapability implements Capability {
  readonly name = 'context-window'
  constructor(private readonly options: ContextWindowOptions) {}
  apply(draft: CompiledAgentOptionsDraft): void {
    setOnce(draft, 'context', compileContextWindow(this.options).context, this.name)
  }
}
/** `@ProjectContext` → `projectContext`. */
export class ProjectContextCapability extends FieldCapability<'projectContext'> {
  readonly name = 'project-context'
  protected readonly field = 'projectContext' as const
}
/** `@MCP` → `mcpServers`. */
export class McpServersCapability extends FieldCapability<'mcpServers'> {
  readonly name = 'mcp'
  protected readonly field = 'mcpServers' as const
}
/** `@Guardrails` → `guardrails`. */
export class GuardrailsCapability extends FieldCapability<'guardrails'> {
  readonly name = 'guardrails'
  protected readonly field = 'guardrails' as const
}
/**
 * `@Checkpoint` → `checkpoint`. Carries the non-durable WARNING the metadata walk used to emit: only
 * `'filesystem'` selects the SDK's durable store, so any other storage cannot resume across
 * requests. The warning moves WITH the feature — a declared checkpoint that silently cannot resume
 * is exactly the kind of no-op this project refuses to ship.
 */
export class CheckpointCapability implements Capability {
  readonly name = 'checkpoint'
  constructor(private readonly options: CompiledAgentOptions['checkpoint']) {}
  apply(draft: CompiledAgentOptionsDraft): void {
    if (this.options !== undefined && this.options.storage !== 'filesystem') {
      console.warn(
        `[THEO_AGENT_CHECKPOINT_STORAGE_METADATA_ONLY] checkpoint({ storage: '${this.options.storage ?? 'memory'}' }) ` +
          `does NOT resume across requests — only 'filesystem' selects the SDK's durable conversation ` +
          `store. Use checkpoint({ storage: 'filesystem' }) for cross-request resume.`,
      )
    }
    setOnce(draft, 'checkpoint', this.options, this.name)
  }
}
/**
 * `@HumanInTheLoop` → `hitl`, keyed `"<namespace>_<tool>"` — the same key `compileHitlGates` mints
 * via `toolRuntimeName`. The separator is `_`, not `.`: the dot is outside the charset the SDK
 * accepts, and a gate keyed with a dot silently failed to match its tool (theokit#145).
 */
export class HumanInTheLoopCapability extends FieldCapability<'hitl'> {
  readonly name = 'human-in-the-loop'
  protected readonly field = 'hitl' as const
}
/**
 * `@SubAgents` → `agents`. MERGES instead of `setOnce`: `agents` is a pre-seeded collection on the
 * draft (`createDraft` gives it `{}`), so a `setOnce` would conflict against the seed itself — the
 * same trap the pre-seeded `stream` sprang in M52. Merging also lets a preset declare a baseline
 * child set that a call site extends.
 */
export class SubAgentsCapability implements Capability {
  readonly name = 'sub-agents'
  constructor(private readonly children: CompiledAgentOptions['agents']) {}
  apply(draft: CompiledAgentOptionsDraft): void {
    for (const [name, child] of Object.entries(this.children)) {
      if (name in draft.agents && draft.agents[name] !== child) {
        throw new ConfigurationError(
          `sub-agents: filho "${name}" declarado duas vezes com definições diferentes`,
        )
      }
      draft.agents[name] = child
    }
    draft.provenance.push({ capability: this.name, contributed: ['agents'] })
  }
}
/**
 * `@Skills({ include, autoDiscover })` → `skills`. Delegates to `compileSkills` (same reason as
 * `contextWindow`). Distinct from the M52 `skills([...])`, which takes the plain name/inline list.
 */
export class SkillsOptionsCapability implements Capability {
  readonly name = 'skills'
  constructor(private readonly options: SkillsOptions) {}
  apply(draft: CompiledAgentOptionsDraft): void {
    setOnce(draft, 'skills', compileSkills(this.options), this.name)
  }
}

/** Functional-path fields that had no decorator source — closing the gap list, not adding surface. */
export class SettingSourcesCapability extends FieldCapability<'settingSources'> {
  readonly name = 'setting-sources'
  protected readonly field = 'settingSources' as const
}
export class PluginsCapability extends FieldCapability<'plugins'> {
  readonly name = 'plugins'
  protected readonly field = 'plugins' as const
}
export class RunContextCapability extends FieldCapability<'runContext'> {
  readonly name = 'run-context'
  protected readonly field = 'runContext' as const
}
export class SkillsResolverCapability extends FieldCapability<'skillsResolver'> {
  readonly name = 'skills-resolver'
  protected readonly field = 'skillsResolver' as const
}

/** The scalar agent config (name/route are HTTP concerns, never agent config). */
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
 * Scalar waist fields (formerly the `@Agent` options). CLASS, not a factory: it validates, and it is the one
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
