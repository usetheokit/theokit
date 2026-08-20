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
import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'

import { getObservabilityAdapter } from '../observability-bootstrap.js'

import type { ApiKeyResolver } from './api-key-resolver.js'
import { getApprovalRegistry } from './approval-registry.js'
import { observeAgentRun } from './observe-agent-run.js'

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
 *
 * `apiKey` accepts a resolved string or an {@link ApiKeyResolver}. The resolver form exists for
 * the same reason it does on `mountAgent` (theokit#327): the credential depends on the model, and
 * the model is only known once the module is compiled — which happens inside the generator below.
 * The caller resolved before that, so an agent declaring `anthropic/…` was handed whichever key
 * env priority picked first and every follow-up died with `auth_failed`. Fixed on the agent
 * endpoint by #327; this is the same defect on the thread route (theokit#328).
 */
export function makeThreadStartRun(
  mod: unknown,
  apiKey: string | ApiKeyResolver,
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
      // Now that the model is known, let the caller pick the credential for THAT provider.
      const resolvedApiKey = typeof apiKey === 'function' ? apiKey(compiled.model) : apiKey
      const stream = streamAgentUIMessages(compiled, resolvedApiKey, { message, sessionId, hitl })
      // M8 — the thread route runs the same agent and must produce the same
      // spans. Instrumenting only the plain POST would make a run's telemetry
      // depend on which endpoint reached it (usetheokit/theokit#353).
      const adapter = getObservabilityAdapter()
      yield* adapter === undefined
        ? stream
        : observeAgentRun(stream, adapter, { agent: source, sessionId })
    })()
}
