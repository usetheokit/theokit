import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'
import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M35 (multi-surface) — the in-process agent-turn seam (Model A).
 *
 * The FRAMEWORK-owned sibling of the HTTP `mountAgent` and the stdout `runAgentInTerminal`: it runs a
 * compiled agent with the SAME `compileAgentModule` + SAME `streamAgentUIMessages` (G2 — reuses the
 * SDK runtime, reimplements nothing), but returns the raw `UIMessageChunk` generator so ANY consumer
 * drives it directly — the Ink TUI (M35), a Tauri window (M36), or a test — in a SINGLE process with
 * NO HTTP loopback, NO port, and NO CSRF (there is no network boundary to defend).
 *
 * The ONLY difference from the HTTP mount is HITL resolution: the mount pauses the run and resolves
 * the approval via a SECOND HTTP request to `/approve/:id` (the approval registry). In-process there
 * is no second request — the caller resolves the approval INLINE via `awaitApproval` (e.g. the Ink
 * TUI's y/n prompt). The gated-tool map is `compiled.hitl` verbatim, so the pause semantics are
 * byte-identical to the HTTP path; only the resolver differs. Parity with the mount is by
 * construction: both compile the module, resolve function-form skills, and call `streamAgentUIMessages`
 * with the same `{ message, sessionId, hitl }`.
 *
 * Consumers WILL still receive `tool-approval-request` chunks from the returned generator — they are
 * INFORMATIONAL (render them or ignore them). The authoritative human gate is `awaitApproval`, which
 * the SDK awaits BEFORE the gated tool runs; the chunk is not the gate.
 */

import { compileAgentModule, streamAgentUIMessages } from './bridge/agent-endpoint.js'
import type { ApprovalPosture } from './bridge/approval-posture.js'
import type { HitlDecision } from './bridge/hitl-plugin.js'
import { resolveEnabledSkills } from './skills-resolver.js'
import type { HumanInTheLoopOptions } from './types.js'

/** An inline approval request handed to the caller's `awaitApproval` (the Ink/Tauri prompt). */
export interface InProcessApprovalRequest {
  approvalId: string
  toolName: string
  opts: HumanInTheLoopOptions
}

/** Resolve one gated-tool approval inline (approve/deny, or a structured {@link HitlDecision}). */
export type InProcessAwaitApproval = (
  req: InProcessApprovalRequest,
) => Promise<boolean | HitlDecision>

export interface StreamAgentTurnInProcessInput {
  message: string
  /**
   * M35 (multimodal) — images to send alongside the text. Threaded to the SDK's structured
   * `SDKUserMessage { text, images }` send form. Absent ⇒ the string send path is byte-unchanged.
   */
  images?: Parameters<typeof streamAgentUIMessages>[2]['images']
  /** Resume key; a fresh id per run when omitted. */
  sessionId?: string
  /**
   * Inline HITL resolver — required IFF the agent has `@HumanInTheLoop`-gated tools. Omitting it for a
   * gated agent is a fail-fast error, never a silent bypass (Rule 8, the #99 lesson).
   */
  awaitApproval?: InProcessAwaitApproval
  /**
   * M96 — the declared {@link ApprovalPosture}, ADDITIVE by design (ADR D2 of the M96 plan).
   *
   * Omitting it preserves today's behaviour byte for byte, including the fail-closed refusal above:
   * this bridge was already the CORRECT side of the divergence the milestone closes, so breaking its
   * signature would charge five call sites — one of them outside this repo — a migration that fixes
   * no defect. What it lacked was the other half: the permissive posture was INEXPRESSIBLE here
   * while `toAgentFactory` reached it by omission. Naming it closes that asymmetry.
   */
  approvals?: ApprovalPosture
  /** Labels a fail-fast `AgentDefinitionError` (the file path). */
  source?: string
  /** Abort signal forwarded to the SDK stream (client disconnect / window close). */
  signal?: AbortSignal
  /**
   * theokit#189 — observe the SDK's typed `RunEvent`s for this turn.
   *
   * `agent-endpoint.ts` already threaded this sink on the HTTP path (theokit#132); this entry point
   * — the one an EMBEDDED surface uses — declared no field for it, so the sink had no way in and
   * every `RunEvent` was unobservable in-process. `streamAgentUIMessages` accepted it at the far end
   * the whole time; the hop in between simply did not pass it.
   *
   * Nothing failed while it was missing, because a sink nobody can install emits nothing to compare
   * against. That is what made it survive: the absence had no observable consequence to test.
   *
   * Absent ⇒ the key is omitted from the SDK call entirely, so the stream is byte-identical to
   * before.
   */
  onRunEvent?: Parameters<typeof streamAgentUIMessages>[2]['onRunEvent']
}

/** Injectable stream fn (defaults to the real SDK bridge) — lets tests drive a deterministic stream. */
export interface StreamAgentTurnDeps {
  stream: typeof streamAgentUIMessages
}

/**
 * Thrown when a gated agent is run in-process without an `awaitApproval` resolver. Refusing loudly is
 * the correct posture: silently running a `@HumanInTheLoop`-gated tool with no human gate is exactly
 * the #99 class of bug. Typed so callers can catch it distinctly.
 */
/**
 * M80 — extends {@link TheokitAgentError}, not plain `Error`.
 *
 * `isTransientError` is defined over `TheokitAgentError`, so a class outside that hierarchy is
 * INVISIBLE to it and the only recourse left to a consumer is matching on message text. `code` is
 * stable across a rename; `isRetryable` is DECLARED, because a default would be a retry policy
 * nobody chose.
 */
export class InProcessApprovalRequiredError extends TheokitAgentError {
  override readonly name = 'InProcessApprovalRequiredError'
  constructor(toolNames: readonly string[]) {
    super(
      `Agent has HITL-gated tool(s) [${toolNames.join(', ')}] but no \`awaitApproval\` resolver was ` +
        `supplied to streamAgentTurnInProcess. In-process runs must resolve approvals inline — pass ` +
        `awaitApproval, or remove the gate. Refused (fail-closed).`,

      {
        code: 'HITL_APPROVAL_REQUIRED',
        // a run refused for lack of an approver is refused the same way on every attempt.
        isRetryable: false,
      },
    )
  }
}

/**
 * M96 — the resolver a declared posture implies, or `undefined` when the posture installs no gate
 * (`owned-by-surface`: the serving surface asks by its own protocol) or when none was declared.
 *
 * `interactive` carries its own resolver; the two automatic postures answer without a human, in the
 * direction they name. An explicit `awaitApproval` still wins — it is the more specific answer.
 */
function postureResolver(
  posturePolicy: ApprovalPosture | undefined,
):
  | ((
      approvalId: string,
      opts: HumanInTheLoopOptions,
      toolName: string,
    ) => Promise<boolean | HitlDecision>)
  | undefined {
  if (posturePolicy === undefined) return undefined
  switch (posturePolicy.kind) {
    case 'interactive':
      return posturePolicy.awaitApproval
    case 'auto-approve':
      return () => Promise.resolve({ approved: true, reason: posturePolicy.reason })
    case 'auto-reject':
      return () => Promise.resolve({ approved: false, reason: posturePolicy.reason })
    case 'owned-by-surface':
      return undefined
  }
}

/**
 * Run a compiled agent in-process and return its `UIMessageChunk` stream. `apiKey` is resolved by the
 * caller (same contract as the HTTP mount). Validation + compile happen SYNCHRONOUSLY (so a gated
 * agent without a resolver throws at call time, not lazily on first iteration); the returned value is
 * the SDK's `streamAgentUIMessages` generator.
 */
export function streamAgentTurnInProcess(
  mod: unknown,
  apiKey: string,
  input: StreamAgentTurnInProcessInput,
  deps: StreamAgentTurnDeps = { stream: streamAgentUIMessages },
): AsyncGenerator<UIMessageChunk> {
  const compiled = compileAgentModule(mod, input.source)
  const gated = compiled.hitl

  // Fail-fast BEFORE building the stream: a gated agent with no inline resolver AND no declared
  // posture would silently bypass the human gate (the #99 class of bug). Refuse loudly (Rule 8,
  // fail-closed). A DECLARED posture is an answer to the same question, so it satisfies the guard —
  // an omission still does not.
  if (gated && gated.size > 0 && !input.awaitApproval && input.approvals === undefined) {
    throw new InProcessApprovalRequiredError([...gated.keys()])
  }
  const resolve = input.awaitApproval

  // Mirror mount-agent's HITL wiring cast-free (structural inference); absent gate ⇒ the non-HITL
  // stream path (M2), unchanged. The SDK calls (approvalId, opts, toolName); route to the caller.
  // An explicit `awaitApproval` wins over the posture: it is the more specific answer to the same
  // question, and honouring it keeps every pre-M96 call site byte-identical.
  const approvalResolver = resolve
    ? (approvalId: string, opts: HumanInTheLoopOptions, toolName: string) =>
        resolve({ approvalId, toolName, opts })
    : postureResolver(input.approvals)
  const hitl =
    gated && gated.size > 0 && approvalResolver
      ? { gated, awaitApproval: approvalResolver }
      : undefined

  const sessionId = input.sessionId ?? crypto.randomUUID()

  // Resolve function-form skills (`defineAgent({ skills: (ctx) => [...] })`) BEFORE streaming — exact
  // parity with mount-agent. Done INSIDE the returned generator so the synchronous fail-fast above is
  // preserved (the caller still gets a plain `AsyncGenerator`, no `await` at the call site). A static
  // skill list leaves `skillsResolver` undefined and this is a no-op.
  return (async function* () {
    if (compiled.skillsResolver) {
      const enabled = await resolveEnabledSkills(compiled.skillsResolver, compiled.runContext ?? {})
      if (enabled !== undefined) compiled.skills = { enabled, autoInject: true }
    }
    yield* deps.stream(compiled, apiKey, {
      message: input.message,
      // M35 — pass images through so the SDK send uses the structured `{ text, images }` form.
      ...(input.images !== undefined ? { images: input.images } : {}),
      sessionId,
      hitl,
      signal: input.signal,
      ...(input.onRunEvent !== undefined ? { onRunEvent: input.onRunEvent } : {}),
    })
  })()
}
