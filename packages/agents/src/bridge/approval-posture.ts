/**
 * M96 U1 — the approval posture: what a surface does when a gated tool asks for approval.
 *
 * ## Why a closed type, and why mandatory
 *
 * The defect this module closes was one of TYPE, not of behaviour. The "no HITL" posture was not
 * representable as a value, so it was expressed as ABSENCE — and an absence has no exhaustive
 * `match`, appears in no log, and fails no test. `toAgentFactory` compiled the `compiled.hitl` map
 * that `.approvals({…})` produces and threw it away, with the discard admitted in writing in the
 * JSDoc, while the sibling bridge REFUSED for the same definition.
 *
 * The permissive posture remains entirely expressible — as a NAMED VALUE, with a written reason.
 * What stops existing is the omission.
 *
 * ## Os peers
 *
 * `codex` models the posture as a four-variant `enum AskForApproval` in the protocol crate, and
 * makes forgetting it a compile error through the `ToolRuntime: Approvable + Sandboxable` supertrait;
 * a mandatory field is the closest this type system gets to that. `codex` also resolves the
 * ambiguity of omission in the safe direction (`GranularApprovalConfig`: an absent field is
 * auto-REJECTED, never auto-approved), and names the human's stand-in rather than inferring it from
 * the absence of one (`ApprovalReviewer::{Guardian, User}`). `opencode` does the same inside out:
 * an absent rule resolves to `ask`.
 */
import { debugLog } from '../debug-log.js'
import type { HumanInTheLoopOptions } from '../types.js'

import type { ApprovalRequiredEvent } from './agent-stream-events.js'
import { createHitlPlugin, type HitlDecision } from './hitl-plugin.js'
import { createToolHooksPlugin } from './tool-hooks-plugin.js'

/** The map of gated tools that `compileAgentDefinition` produces (`compiled.hitl`). */
export type GatedTools = ReadonlyMap<string, HumanInTheLoopOptions>

/**
 * What this surface does when a gated tool asks for approval. Four variants, none of them
 * "omission" — each with a concrete consumer and a written reason.
 */
export type ApprovalPosture =
  | {
      /** There is a human: the request is EMITTED and execution pauses until the decision arrives. */
      kind: 'interactive'
      /**
       * Pushes the `ApprovalRequiredEvent` into the surface's stream. MANDATORY: `toAgentFactory`
       * returns a raw handle, with no stream and no translator, so the sink comes from whoever passes
       * the posture — which is precisely the surface that owns the stream. A no-op default would
       * bring the silent discard back through the back door: the request would be "emitted" nowhere.
       */
      emit: (event: ApprovalRequiredEvent) => void
      /** Resolves the human decision; execution stays paused until this settles. */
      awaitApproval: (
        approvalId: string,
        opts: HumanInTheLoopOptions,
        toolName: string,
      ) => Promise<boolean | HitlDecision>
    }
  | {
      /** Nobody asks and the tool runs. Legitimate when something else confines the execution. */
      kind: 'auto-approve'
      reason: string
    }
  | {
      /** Nobody asks and the tool does NOT run — the safe reading of omission (codex `GranularApprovalConfig`). */
      kind: 'auto-reject'
      reason: string
    }
  | {
      /**
       * The gate is driven by the SERVING SURFACE (the ACP client, through the protocol itself), so
       * the layer installs no plugin at all. It is a bypass — but a NAMED bypass, with a written
       * reason, that shows up in the `match`, shows up in logs and can be counted by a gate. What it
       * replaces is worse: today the same effect happens by omission, with none of that.
       */
      kind: 'owned-by-surface'
      reason: string
    }

/** The declared reason, for the variants that carry one (logging and diagnostics). */
function reasonOf(posturePolicy: ApprovalPosture): string {
  return posturePolicy.kind === 'interactive'
    ? 'human approver on this surface'
    : posturePolicy.reason
}

/**
 * Writes the plugins the posture requires into `extra` — the object `toAgentFactory` spreads AFTER
 * `m8` into the `Agent.create` options, and which therefore wins. Plugins already present (from the
 * agent, via `m8`, and from an override, via `extra`) are preserved: running them over is the M14
 * regression that `buildExtraCreateOptions` already carries a guard against.
 *
 * The legacy `plugins` shape (an `{ enabled }` object) cannot carry both, so a posture that needs to
 * install a plugin alongside it is refused LOUD AND CLEAR, rather than resolved by dropping one of
 * them: silently dropping the approval gate is exactly the class of defect this milestone closes
 * (Rule 8, fail-closed).
 */
export function applyPosture(
  extra: Record<string, unknown>,
  // Only the field read is declared: `M8CreateOptions` has no index signature, and requiring one
  // here would couple this function to the whole options shape for the sake of a single field.
  m8: { plugins?: unknown },
  posturePolicy: ApprovalPosture,
  gated: GatedTools | undefined,
): void {
  const ofThePosture = posturePlugins(posturePolicy, gated)
  if (ofThePosture.length === 0) return
  const currentOnes = extra.plugins ?? m8.plugins
  if (currentOnes !== undefined && !Array.isArray(currentOnes)) {
    throw new Error(
      `[@theokit/agents] approval posture "${posturePolicy.kind}" needs to install a plugin, but ` +
        `\`plugins\` was supplied in the legacy object form, which cannot carry both. Pass ` +
        `\`plugins\` as an array so the approval gate is not dropped.`,
    )
  }
  extra.plugins = [...((currentOnes as readonly unknown[] | undefined) ?? []), ...ofThePosture]
}

/**
 * The plugins the posture requires. Each variant picks the plugin that satisfies it — none is
 * invented here: `createHitlPlugin` and `createToolHooksPlugin` already existed and were already the
 * way to pause and to veto. What was missing was being reached by this path.
 *
 * With no gated tool there is no plugin to install under any variant: the posture describes what to
 * do with a gate, and an agent with no gate has nothing to decide.
 */
function posturePlugins(
  posturePolicy: ApprovalPosture,
  gated: GatedTools | undefined,
): readonly unknown[] {
  debugLog('[theokit] approval posture', {
    kind: posturePolicy.kind,
    reason: reasonOf(posturePolicy),
  })
  if (gated === undefined || gated.size === 0) return []

  switch (posturePolicy.kind) {
    case 'interactive':
      return [
        createHitlPlugin({
          gated: gated as Map<string, HumanInTheLoopOptions>,
          emit: posturePolicy.emit,
          awaitApproval: posturePolicy.awaitApproval,
        }),
      ]
    case 'auto-approve':
      // A hook that always allows is observable, and that is the difference between the NAMED
      // permissive posture and today's discard: every gated tool that runs without a human leaves a
      // trace at runtime.
      return [
        createToolHooksPlugin({
          beforeToolCall: (ctx) => {
            if (gated.has(ctx.name)) {
              debugLog('[theokit] gated tool auto-approved', {
                tool: ctx.name,
                reason: posturePolicy.reason,
              })
            }
            return undefined
          },
        }),
      ]
    case 'auto-reject':
      return [
        createToolHooksPlugin({
          // Only GATED tools are refused: the posture describes the gate, not a universal block.
          // Refusing everything would break every agent with a free tool next to a gated one.
          beforeToolCall: (ctx) =>
            gated.has(ctx.name)
              ? {
                  block: true,
                  message:
                    `Tool '${ctx.name}' requires human approval, and this surface has no approver ` +
                    `(approval posture: auto-reject — ${posturePolicy.reason}). Refused (fail-closed).`,
                }
              : undefined,
        }),
      ]
    case 'owned-by-surface':
      // The serving surface already asks through the protocol. Installing the layer's gate here
      // would produce TWO requests for the same tool — a usability regression dressed as security.
      return []
  }
}
