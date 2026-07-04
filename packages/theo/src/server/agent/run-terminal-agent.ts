/**
 * M5 (theokit-ai-first) — run a compiled agent in the terminal, reusing the M4 harness.
 *
 * The web `mountAgent` renders `streamAgentUIMessages` to an HTTP `Response` and resolves HITL
 * approvals via the approve route. This is its terminal sibling: SAME `compileAgentModule` + SAME
 * `streamAgentUIMessages` + SAME in-process approval registry — only the render surface (stdout) and
 * the approval input (a readline prompt) differ (ADR 0039 D2). In a single-process CLI the stream's
 * `awaitApproval` (→ `registry.register`) and the terminal prompt (→ `registry.resolve`) share the one
 * in-process registry — the M4 singleton's exact fit. No new runtime, no LLM call, no tool dispatch.
 */
import {
  compileAgentModule,
  streamAgentUIMessages,
  type HumanInTheLoopOptions,
} from '@theokit/agents'

import { getApprovalRegistry, type ApprovalRegistry } from './approval-registry.js'
import {
  promptTerminalApproval,
  renderAgentStreamToTerminal,
  type TerminalOut,
} from './render-terminal.js'

export interface RunTerminalAgentInput {
  message: string
  /** Resume key; a fresh id per run when omitted. */
  sessionId?: string
  /** Injectable sink (defaults to `process.stdout` at the CLI entry). */
  stdout?: TerminalOut
  /** Injectable shared registry (defaults to the process singleton). */
  registry?: ApprovalRegistry
  /** Injectable approval prompt (defaults to the readline prompt over the process streams). */
  promptApproval?: (req: { toolName: string; timeoutMs?: number }) => Promise<boolean>
  /** Labels a fail-fast `AgentDefinitionError` (the file path). */
  source?: string
}

/**
 * Compile the module (M4, gathers `@Mixin` toolboxes), stream it, and render to the terminal. When the
 * agent has `@HumanInTheLoop`-gated tools, the terminal prompts and resolves the shared registry —
 * approve runs the tool, deny/timeout/non-TTY denies and the run continues.
 */
export async function runAgentInTerminal(
  mod: unknown,
  apiKey: string,
  input: RunTerminalAgentInput,
): Promise<{ sawError: boolean }> {
  const compiled = compileAgentModule(mod, input.source)
  const stdout = input.stdout ?? process.stdout
  const registry = input.registry ?? getApprovalRegistry()
  const sessionId = input.sessionId ?? crypto.randomUUID()
  const promptApproval =
    input.promptApproval ??
    ((req: { toolName: string; timeoutMs?: number }) =>
      promptTerminalApproval(req, { input: process.stdin, output: process.stdout }, req.timeoutMs))

  // Mirror mount-agent's HITL wiring; absent ⇒ the non-HITL stream path (M2), unchanged.
  const gated = compiled.hitl
  const hitl =
    gated && gated.size > 0
      ? {
          gated,
          awaitApproval: (approvalId: string, opts: HumanInTheLoopOptions) =>
            registry.register(approvalId, {
              timeoutMs: opts.timeout ?? 300_000,
              onTimeout: opts.onTimeout ?? 'abort',
            }),
        }
      : undefined

  const chunks = streamAgentUIMessages(compiled, apiKey, {
    message: input.message,
    sessionId,
    hitl,
  })
  return renderAgentStreamToTerminal(chunks, {
    stdout,
    onApproval: async ({ approvalId, toolName }) => {
      // The renderer paused here (the SDK run is paused in its awaited pre_tool_call hook); prompt,
      // then resolve the SAME registry the stream registered into — the run resumes with the decision.
      // The prompt shares the gated tool's timeout so it can never outlive the registry-settled run.
      const timeoutMs = gated?.get(toolName)?.timeout ?? 300_000
      const approved = await promptApproval({ toolName, timeoutMs })
      registry.resolve(approvalId, approved)
    },
  })
}
