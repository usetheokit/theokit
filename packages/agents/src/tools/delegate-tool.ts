// `createDelegateTool` — the one agent-facing capability the framework was missing.
//
// Measured (`discoveries/blueprints/theocode-baseline-gaps-blueprint.md`): `@theokit/agents/tools`
// ships 23 factories the agent can call mid-run, and `@theokit/agents` ships `delegate()`,
// `delegateWithScoring()`, `delegateBackground()` and `Squad` for the APP to call. Local sub-agent
// delegation was the single capability present on one side and absent on the other — the framework
// could delegate, and the agent had no way to ask it to. `createA2ATool` is not the counterpart:
// its target is a REMOTE peer over a network transport, with none of the parent's tools, budget or
// authority carried across.
//
// It cannot live beside the other 23. Those are `@theokit/sdk-tools`, and `delegate()` is
// framework-owned — an SDK-side factory would have the SDK importing the framework, inverting G1's
// dependency direction. It is re-exported through the same `./tools` subpath so the consumer sees
// one surface regardless of which side of the seam a factory is implemented on.
//
// THIN BY DESIGN (parsimony rung 6). `delegate()` already merges the parent's tools, clamps the
// budget and propagates authority. Re-deriving any of that here would put two owners on one rule,
// which is how the two copies diverge in silence (G12).
import { Tool } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { z } from 'zod'

import { delegate, type DelegateOptions } from '../bridge/agent-orchestrator.js'
import { DelegationTimeoutError } from '../bridge/delegation-lifecycle.js'
import type { DelegationPort, DelegationTarget } from '../bridge/delegation-scoring.js'
import {
  DelegationBudgetExceededError,
  DelegationError,
  type DelegationResult,
} from '../bridge/delegation-types.js'

/**
 * A roster misconfiguration — always raised at factory time, never at the model's first call.
 *
 * The distinction is the point. `delegate()` refuses an empty `apiKey` deep in its own call stack,
 * so a factory that forwards `{}` fails only when the model first reaches for the tool — by which
 * point the failure is a tool error the model will try to reason about, rather than a startup error
 * a human can read.
 */
export class DelegateToolConfigError extends TheokitAgentError {
  override readonly name = 'DelegateToolConfigError'

  constructor(
    message: string,
    readonly code: 'empty_roster' | 'duplicate_name' | 'missing_api_key',
  ) {
    super(message)
  }
}

/**
 * One delegation target, named.
 *
 * The name is carried here rather than read off the target because `DelegationPort` is `{run}` and
 * has no name to read — pairing them keeps a type guard out of every use site.
 */
export interface DelegateRosterEntry {
  readonly name: string
  readonly target: DelegationTarget
}

export interface CreateDelegateToolOptions {
  /** Who the agent may delegate to. Must be non-empty and free of duplicate names. */
  readonly roster: readonly DelegateRosterEntry[]
  /** Forwarded to `delegate()` verbatim. `apiKey` is required when any target is a `SubAgentSpec`. */
  readonly defaults?: DelegateOptions
  /** Defaults to `delegate`. Override when an app already exposes a tool by that name. */
  readonly name?: string
  /** Defaults to a description naming the roster. Override to describe the roster's semantics. */
  readonly description?: string
}

/** A port answers `run`; a spec carries `compiled`. The discriminant is structural, not a flag. */
function isPort(target: DelegationTarget): target is DelegationPort {
  return typeof (target as DelegationPort).run === 'function'
}

function assertUsableRoster(
  roster: readonly DelegateRosterEntry[],
  defaults: DelegateOptions | undefined,
): void {
  if (roster.length === 0) {
    throw new DelegateToolConfigError(
      'createDelegateTool: the roster is empty — a delegate tool with no reachable target is a defect, not a configuration.',
      'empty_roster',
    )
  }

  const seen = new Set<string>()
  for (const { name } of roster) {
    if (seen.has(name)) {
      // Two entries sharing a name collapse into one enum member and lookup then resolves to
      // whichever is found first — silent dispatch to the wrong sub-agent, which reads as success.
      throw new DelegateToolConfigError(
        `createDelegateTool: duplicate roster name ${JSON.stringify(name)} — each target must be uniquely addressable.`,
        'duplicate_name',
      )
    }
    seen.add(name)
  }

  const needsCredential = roster.some((entry) => !isPort(entry.target))
  if (needsCredential && !defaults?.apiKey) {
    throw new DelegateToolConfigError(
      "createDelegateTool: a SubAgentSpec target requires defaults.apiKey — delegate() refuses an empty key, and without this check the failure would surface at the model's first call instead of at startup.",
      'missing_api_key',
    )
  }
}

/** The stable code an error crosses into the model payload as. */
function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof DelegationBudgetExceededError) return 'delegation_budget_exceeded'
  if (error instanceof DelegationTimeoutError) return 'delegation_timeout'
  if (error instanceof DelegationError) return 'delegation_failed'
  return undefined
}

function describeRoster(roster: readonly DelegateRosterEntry[]): string {
  return roster.map((entry) => entry.name).join(', ')
}

/**
 * Build a tool that lets the agent delegate a task to one of `roster`.
 *
 * Recursion is bounded by BUDGET, not by depth — a sub-agent holding this same tool may delegate
 * again, and `delegate()` clamps the parent's remaining budget into each child. That guarantee is
 * conditional on the caller supplying `budget` / `parentBudgetRemaining` in `defaults`; both are
 * optional in `DelegateOptions`, and with neither set nothing at this layer bounds the descent.
 * Stated rather than fixed: a depth counter here would be a second owner of a rule `delegate()`
 * already owns.
 */
export function createDelegateTool(options: CreateDelegateToolOptions) {
  const { roster, defaults, name = 'delegate', description } = options

  assertUsableRoster(roster, defaults)

  const byName = new Map(roster.map((entry) => [entry.name, entry.target]))
  const names = roster.map((entry) => entry.name) as [string, ...string[]]

  const inputSchema = z.object({
    agent: z
      .enum(names)
      .describe(`Which sub-agent runs the task. One of: ${describeRoster(roster)}.`),
    task: z
      .string()
      .min(1)
      .describe(
        'What the sub-agent should do, stated so it can be acted on without further context.',
      ),
  })

  return Tool.create({
    name,
    description:
      description ??
      `Delegate a task to one of this app's sub-agents (${describeRoster(roster)}) and receive its answer. ` +
        'The sub-agent runs with its own turn and its own token cost, drawn from the same budget as this run — ' +
        'reach for it when the work is genuinely separable, not for something answerable directly. ' +
        'Returns JSON: { ok: true, response } on success, { ok: false, error, message } when delegation is refused.',
    inputSchema,
    handler: async (raw: unknown): Promise<string> => {
      // Validate at the boundary (rules/error-handling.md § 2): past this line the input is trusted.
      // Explicit rather than assumed — a schema the caller cannot see enforced is a schema that can
      // be dropped in a later edit without a test noticing.
      const { agent, task } = inputSchema.parse(raw)

      const target = byName.get(agent)
      if (!target) {
        // Unreachable through the enum; reachable if a caller hands the handler a raw object.
        throw new DelegateToolConfigError(
          `delegate: unknown agent ${JSON.stringify(agent)} — the roster holds ${describeRoster(roster)}.`,
          'duplicate_name',
        )
      }

      try {
        const result: DelegationResult = isPort(target)
          ? await target.run(task)
          : await delegate(target, task, defaults ?? {})

        return JSON.stringify({ ok: true, response: result.response })
      } catch (error) {
        const code = errorCodeOf(error)
        if (code === undefined) {
          // Not a delegation outcome — a defect (a malformed spec, a bug in a port). Catching it
          // would hand the model prose to reason about instead of failing where a human can see it.
          throw error
        }
        // A delegation refusal is INFORMATION the model can act on: delegate less, or finish the
        // work itself. Throwing here would end the parent's turn over a recoverable signal. Nothing
        // is swallowed — the typed error's identity crosses as a stable code, its message intact.
        return JSON.stringify({
          ok: false,
          error: code,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}
