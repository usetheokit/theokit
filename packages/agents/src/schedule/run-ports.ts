// The stock `RunPort` and the file-backed transient job every scheduler host otherwise rewrites.
import { readFile } from 'node:fs/promises'

import type { SdkSendOptions } from '../bridge/sdk-adapter.js'

import type { ScheduledJob, ScheduleTarget } from './job-store.js'
import type { RunPort, TransientJobOptions } from './scheduler.js'

/**
 * The slice of an agent `agentRunPort` uses: `send`, and a turn that can be waited for and, when it
 * streams, drained. A full `SdkAgentHandle` and an app's own narrow agent both fit; neither needs an
 * id or a `dispose`, since `withAgent` owns the lifetime.
 */
export interface ScheduledRunAgent {
  send(
    message: string,
    options?: SdkSendOptions,
  ): Promise<{
    stream?: () => AsyncIterable<unknown>
    wait: () => Promise<{
      status?: string
      result?: string
      error?: { message?: string; code?: string }
    }>
  }>
}

/**
 * A `RunPort` that runs each prompt on the agent `withAgent` supplies: send with the scheduler's
 * signal, drain the stream if the turn has one, wait, and map `error`, `cancelled` and an empty
 * result to `{ ok: false }`. `withAgent` owns the agent's lifetime, so it disposes the agent even
 * when the run throws.
 */
export function agentRunPort(
  withAgent: <R>(work: (agent: ScheduledRunAgent) => Promise<R>) => Promise<R>,
  options: { sendOptions?: SdkSendOptions } = {},
): RunPort {
  return (prompt, signal) =>
    withAgent(async (agent) => {
      const turn = await agent.send(prompt, { ...options.sendOptions, signal })
      if (turn.stream) {
        // Drained only so the turn can finish; the result arrives through `wait()`.
        for await (const _event of turn.stream()) continue
      }
      const outcome = await turn.wait()
      if (outcome.status === 'error' || outcome.error) {
        // The SDK's error carries a `code` that the declared handle type omits.
        const err: { message?: string; code?: string } | undefined = outcome.error
        const named = err?.code ?? err?.message ?? 'unknown'
        return { ok: false as const, error: `run ended with error: ${named}` }
      }
      if (outcome.status === 'cancelled') {
        return { ok: false as const, error: 'run ended with status cancelled' }
      }
      if (!outcome.result) {
        return { ok: false as const, error: 'run finished without a result' }
      }
      return { ok: true as const, text: outcome.result }
    })
}

/**
 * A transient job whose prompt is `file`, re-read on each fire. An absent file (ENOENT) or blank
 * text means no run; any other read error rejects.
 */
export function fileTransientJob(options: {
  id: string
  cron: string
  target: ScheduleTarget
  file: string
}): { job: ScheduledJob; transient: TransientJobOptions } {
  const { id, cron, target, file } = options
  // `prompt` is a placeholder: a transient job's prompt is read from `file` on each fire.
  const job: ScheduledJob = { id, cron, target, prompt: '', createdAt: Date.now() }
  return {
    job,
    transient: {
      durable: false,
      prompt: async () => {
        let text: string
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller names the file
          text = await readFile(file, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw err
        }
        const trimmed = text.trim()
        return trimmed === '' ? undefined : trimmed
      },
    },
  }
}
