/**
 * M39 (ADR-0048) — shared agent-run streamer builders, extracted from
 * `mount-agent.ts` (DRY / G12) so the thread routes drive the SAME SDK run path
 * as the plain POST. Reuses SDK primitives (`compileAgentModule` +
 * `streamAgentUIMessages`) — it does NOT reimplement the loop (G2).
 */

import {
  compileAgentModule,
  type HumanInTheLoopOptions,
  resolveEnabledSkills,
  streamAgentUIMessages,
} from '@theokit/agents'
import type { UIMessageChunk } from 'ai'

import { getApprovalRegistry } from './approval-registry.js'

type Compiled = ReturnType<typeof compileAgentModule>

/**
 * Build the HITL wiring for a compiled agent: gated tools register a pending
 * approval in the shared registry (the Promise that PAUSES the run). `undefined`
 * when the agent has no `@HumanInTheLoop`-gated tools. Extracted verbatim from
 * `mountAgent` so both the plain POST and the thread routes wire HITL identically.
 */
export function buildAgentHitl(compiled: Compiled) {
  const gated = compiled.hitl
  if (gated === undefined || gated.size === 0) return undefined
  const registry = getApprovalRegistry()
  return {
    gated,
    awaitApproval: (approvalId: string, opts: HumanInTheLoopOptions, toolName: string) =>
      registry.register(approvalId, {
        timeoutMs: opts.timeout ?? 300_000,
        onTimeout: opts.onTimeout ?? 'abort',
        toolName,
        question: opts.question,
        ...(opts.payloadSchema !== undefined ? { payloadSchema: opts.payloadSchema } : {}),
      }),
  }
}

/**
 * A `startRun(sessionId, message)` closure for the thread dispatcher. Per run it
 * compiles the module fresh (skills resolution mutates `compiled`), resolves
 * per-request skills, builds HITL, and streams. Headless — no request signal (a
 * thread continuation runs to completion into the durable cache, not to a client).
 */
export function makeThreadStartRun(
  mod: unknown,
  apiKey: string,
  source: string,
): (sessionId: string, message: string) => AsyncIterable<UIMessageChunk> {
  return (sessionId, message) =>
    (async function* () {
      const compiled = compileAgentModule(mod, source)
      if (compiled.skillsResolver) {
        const enabled = await resolveEnabledSkills(
          compiled.skillsResolver,
          compiled.runContext ?? {},
        )
        if (enabled !== undefined) compiled.skills = { enabled, autoInject: true }
      }
      const hitl = buildAgentHitl(compiled)
      yield* streamAgentUIMessages(compiled, apiKey, { message, sessionId, hitl })
    })()
}
