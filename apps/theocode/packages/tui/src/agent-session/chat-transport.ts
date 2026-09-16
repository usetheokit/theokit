import { homedir } from 'node:os'
import { recordMcpWarning, startMcpFailureTurn } from './mcp-failure-record.js'
import { currentAttempts, startRetryTurn } from './retry-record-holder.js'
import { runEventSink } from './run-event-sink.js'
import { recordWiring } from './wiring-record.js'

import { InProcessTransport } from '@theokit/agents/client'
import { streamAgentTurnInProcess } from '@theokit/agents'
import { diagnosticsEnabled } from '@theocode/shared/diagnostic-sink'
import { turnErrorText } from '@theocode/shared/turn-error'

import { buildChatAgent } from '@theocode/agent'
import { resolveEffectiveConfig, type ReasoningEffort } from '@theocode/agent/config'
import {
  resolveCredentialForModel,
  routeToCredential,
  type ResolvedCredential,
} from '@theocode/agent/auth'
import type { AttachedImage } from '@theocode/agent/context'
import type { SessionPtyOwner } from '@theocode/agent/pty'
import { workingDirectory } from '../working-directory.js'
export interface ChatTransportDeps {
  getEffort: () => ReasoningEffort
  getSessionId: () => string
  takePendingImages: () => AttachedImage[] | undefined
  takePendingModel: () => string | undefined
  credential: () => ResolvedCredential | { error: Error }
  getSessionPty: () => SessionPtyOwner
  /**
   * B-055 — told when a PreToolUse hook blocks a tool call.
   *
   * A veto reaches the wire as a tool_result with `isError: false` and the message as content, by
   * the SDK's design, so the terminal cannot tell a blocked call from a completed one by looking at
   * it. That is why B-027 deleted the renderer that tried, and why this signal comes from the veto
   * site instead.
   */
  onHookVeto?: (veto: { tool: string; reason: string }) => void
}

export function createChatTransport(deps: ChatTransportDeps): InProcessTransport {
  return new InProcessTransport({
    run: (input) =>
      (async function* () {
        // B-088 — a failure belongs to the turn that hit it. Clearing here, at the start of the
        // run, is what stops `/mcp` reporting a server that has since recovered.
        startMcpFailureTurn()
        // A count carried over from the previous turn would be a number that is wrong, not missing.
        startRetryTurn()
        const images = deps.takePendingImages()
        const c = deps.credential()
        const commandModel = deps.takePendingModel()
        const model =
          commandModel ??
          routeToCredential(c, resolveEffectiveConfig({ cwd: workingDirectory() }).model)
        const key = (await resolveCredentialForModel(model, { env: process.env, home: homedir() }))
          .apiKey
        yield* streamAgentTurnInProcess(
          {
            // #96 — awaited. `buildChatAgent` became async in 0.7.0 and `compileAgentModule`
            // needs a RESOLVED definition: it accepts `AgentDefinition | CompiledAgentOptions` and
            // neither a promise nor a thunk. Unawaited, this surface could not start a turn at all.
            // `streamAgentTurnInProcess(mod: unknown, …)` states no contract, so nothing in the type
            // system guards this line — `chat-transport.smoke.test.ts` is what does.
            default: await buildChatAgent({
              // B-059 — from the TUI's single working-directory seam (B-057), which is the same
              // value `resolveEffectiveConfig` is given two lines above. They used to be able to
              // disagree: this call resolved its directory inside `buildChatAgent` from the process
              // while the config beside it came from the seam.
              cwd: workingDirectory(),
              reasoning_effort: deps.getEffort(),
              ...(model !== undefined ? { model } : {}),
              sessionPty: deps.getSessionPty(),
              ...(deps.onHookVeto === undefined ? {} : { onHookVeto: deps.onHookVeto }),
              // B-070 — capture what THIS build wired, so `/skills` reports the agent that exists
              // rather than re-reading config and describing one that might not.
              onWired: recordWiring,
              // M82 — a config warning reaches the SAME list a run failure does. Without this,
              // `loadMcpJson` wrote "server X was ignored" to stderr, which under the TUI is a log
              // file nobody has open — while `/mcp` listed the servers that DID load and gave the
              // user no way to learn one was missing.
              onMcpWarn: recordMcpWarning,
            }),
          },
          key,
          {
            ...input,
            sessionId: deps.getSessionId(),
            // Without this the framework masks every failure to "An error occurred." — the right
            // default for a public HTTP endpoint and the wrong one here, where the caller IS the
            // operator. Same policy as the CLI, from `@theocode/shared/turn-error`, so the two
            // surfaces cannot describe the same failure differently.
            onError: (error) =>
              turnErrorText(error, {
                // B-130 — the transport retries three times and said so only under an environment
                // variable nobody was told about. Same policy as the CLI, so the two surfaces cannot
                // describe the same failure differently.
                attempts: currentAttempts(),
                diagnosticsEnabled: diagnosticsEnabled(),
              }),
            // B-088 — subscribe to the SDK's typed run events. Two members are read and every other
            // is deliberately ignored: `mcp_server_failed` (see `mcpFailureSink`) so an MCP panel
            // never fills with unrelated runtime noise, and `rate_limit` (see `sinkRetryEvent`) so a
            // failure can say how many attempts it cost.
            onRunEvent: runEventSink,
            ...(images !== undefined ? { images } : {}),
          },
        )
      })(),
  })
}
